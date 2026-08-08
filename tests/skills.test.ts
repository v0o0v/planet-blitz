/**
 * 스킬 투자 벡터의 파생·조회 층 계약 (ADR-0049) + `computeLoadoutStats` 타입 인식 축.
 *
 * ## 무엇이 없어졌나
 * 구 버전(60노드 파생 스탯 파이프라인 — `computeSkillStats`·티어 시너지·`computeLoadoutStats`
 * 의 `invest` 인자)은 ADR-0049 가 스킬을 **스탯에서 메커닉으로** 옮기며 전량 폐기됐다
 * (`src/items/skills.ts`·`src/items/loadout.ts` 헤더 참조). 껍데기만 남겨 되살리지 않는다 —
 * 항상 0 을 돌려주는 함수를 계속 부르면 "효과가 반영된다"는 오해가 남고, 이 리포의 반복 결함
 * 8건이 전부 그 형태였다.
 *
 * ## 이 파일이 지금 지키는 것
 *   ① `src/items/skills.ts` 의 순수 조회 함수(axisOfIndex·axisInvested·skillPoints·
 *      skillDefAt·hasAnyInvestment) — 입력 벡터를 변형하지 않는 순수 함수라는 계약.
 *   ② `computeLoadoutStats` 의 타입 인식 축 — `invest` 인자가 사라진 뒤에도 남아 있는
 *      기체 타입 baseBp 적용 · uniqueMask 시그니처 비트 OR · 손상 typeId 정규화.
 *   ③ `src/save/profile.ts` 의 investSkill/respec 왕복(스킬 포인트 보존 불변식).
 *
 * `tests/shipSkillLayout.test.ts` 가 flat 레이아웃 구조 계약(210종·id 유니크·축 정합)을
 * 이미 지키므로 여기서 되풀이하지 않는다.
 */

import { describe, it, expect } from 'vitest';
import {
  axisOfIndex,
  axisInvested,
  skillPoints,
  skillDefAt,
  hasAnyInvestment,
  zeroStatSums,
} from '../src/items/skills.js';
import { computeLoadoutStats, neutralLoadout } from '../src/items/loadout.js';
import { DEFAULT_CONFIG } from '../src/sim/world.js';
import {
  defaultProfile,
  investSkill,
  respecSkills,
  respecCost,
  totalInvested,
  activeShip,
} from '../src/save/profile.js';
import {
  SHIP_TYPES,
  DEFAULT_SHIP_TYPE,
  shipTypeDef,
  flattenShipNodes,
  zeroSkillInvest as registryZeroInvest,
} from '../data/ships/index.js';
import { hasSignature, SIG_STRIKER_MARKSMAN } from '../src/sim/shipSignature.js';
import type { Item, StatKey } from '../src/items/types.js';

function m8Item(slot: 'main' | 'sub' | 'armor', affixes: { stat: StatKey; value: number }[]): Item {
  return {
    id: `m8-${slot}`,
    slot,
    rarity: 'rare',
    affixes: affixes.map((a, i) => ({ id: `a${i}`, stat: a.stat, value: a.value })),
    source: { planet: 0, stage: 1 },
  };
}

describe('src/items/skills.ts — 순수 조회 함수 (ADR-0049)', () => {
  it('axisOfIndex: flat 인덱스 → affinity, 범위 밖은 undefined', () => {
    const striker = shipTypeDef(0);
    for (let i = 0; i < 30; i++) {
      const expected = striker.trees[Math.floor(i / 10)]?.affinity;
      expect(axisOfIndex(i, 0), `인덱스 ${i}`).toBe(expected);
    }
    for (const bad of [-1, 30, 999, Number.NaN]) {
      expect(axisOfIndex(bad, 0), `범위 밖 ${bad}`).toBeUndefined();
    }
  });

  it('axisOfIndex 는 typeId 미지정이면 스트라이커(0)로 취급한다', () => {
    expect(axisOfIndex(15)).toBe(axisOfIndex(15, 0));
    expect(axisOfIndex(15)).toBe('defense');
  });

  it('axisInvested: 한 축의 누적 투자만 합산하고 다른 축은 섞이지 않는다', () => {
    const def = shipTypeDef(0);
    const v = registryZeroInvest(0);
    v[0] = 3;
    v[9] = 2; // 축0(offense) 끝단
    v[10] = 5; // 축1(defense) 시작
    expect(axisInvested(v, def, 0)).toBe(5);
    expect(axisInvested(v, def, 1)).toBe(5);
    expect(axisInvested(v, def, 2)).toBe(0);
  });

  it('axisInvested 는 손상·짧은 벡터에서도 안전하다(누락 칸 = 0)', () => {
    const def = shipTypeDef(0);
    expect(axisInvested([], def, 0)).toBe(0);
    expect(axisInvested([5], def, 0)).toBe(5);
  });

  it('skillPoints: 정수 절삭 + 음수·비유한·범위 밖은 0', () => {
    const v = registryZeroInvest(0);
    v[0] = 7.9;
    v[1] = -3;
    v[2] = Number.NaN;
    expect(skillPoints(v, 0)).toBe(7);
    expect(skillPoints(v, 1)).toBe(0);
    expect(skillPoints(v, 2)).toBe(0);
    expect(skillPoints(v, 999)).toBe(0);
  });

  it('skillDefAt: flat 인덱스 → 스킬 정의, 범위 밖은 undefined', () => {
    const def = skillDefAt(0, 0);
    expect(def?.axis).toBe('offense');
    expect(def?.maxPoints).toBe(20);
    expect(skillDefAt(-1, 0)).toBeUndefined();
    expect(skillDefAt(999, 0)).toBeUndefined();
  });

  it('hasAnyInvestment: 하나라도 양수면 참, undefined·전부 0 이면 거짓', () => {
    expect(hasAnyInvestment(undefined)).toBe(false);
    expect(hasAnyInvestment(registryZeroInvest(0))).toBe(false);
    const v = registryZeroInvest(0);
    v[5] = 1;
    expect(hasAnyInvestment(v)).toBe(true);
  });

  it('네 조회 함수 모두 입력 벡터를 변형하지 않는다(순수 함수 계약)', () => {
    const def = shipTypeDef(0);
    const v = registryZeroInvest(0);
    v[0] = 3;
    v[15] = 4;
    const snapshot = v.slice();
    axisOfIndex(0, 0);
    axisInvested(v, def, 0);
    skillPoints(v, 0);
    skillDefAt(0, 0);
    hasAnyInvestment(v);
    expect(v).toEqual(snapshot);
  });

  it('zeroStatSums: 19개 StatKey 전부 0(어픽스 누산기 초기값 형태 정본, 스킬 어픽스 3종 포함)', () => {
    const sums = zeroStatSums();
    expect(Object.keys(sums)).toHaveLength(19);
    for (const [key, v] of Object.entries(sums)) expect(v, key).toBe(0);
  });
});

describe('profile — invest + respec (AC1, plan A3)', () => {
  it('invests banked points and refuses when maxed or empty', () => {
    const p = defaultProfile();
    p.skillPoints = 3;
    expect(investSkill(p, 0)).toBe(true);
    expect(activeShip(p).skillInvest[0]).toBe(1);
    expect(p.skillPoints).toBe(2);
    // Fill to the node max (SKILL_MAX_LEVEL = 20), then further invest is refused.
    const max = flattenShipNodes(shipTypeDef(0))[0]?.maxPoints ?? 0;
    p.skillPoints = 30;
    while ((activeShip(p).skillInvest[0] ?? 0) < max) investSkill(p, 0);
    expect(investSkill(p, 0)).toBe(false);
    // Out-of-range index is a no-op.
    expect(investSkill(p, 999)).toBe(false);
  });

  it('refuses to invest with no banked points', () => {
    const p = defaultProfile();
    p.skillPoints = 0;
    expect(investSkill(p, 5)).toBe(false);
  });

  it('respec refunds all points and charges level-scaled credits', () => {
    const p = defaultProfile();
    p.skillPoints = 5;
    investSkill(p, 0);
    investSkill(p, 1);
    investSkill(p, 0);
    const invested = totalInvested(p);
    expect(invested).toBe(3);
    const bankedBefore = p.skillPoints;
    activeShip(p).level = 7;
    p.credits = respecCost(p); // exactly affordable
    expect(respecSkills(p)).toBe(true);
    expect(p.credits).toBe(0);
    expect(totalInvested(p)).toBe(0);
    expect(p.skillPoints).toBe(bankedBefore + invested); // points conserved
    expect(activeShip(p).skillInvest).toEqual(registryZeroInvest(0));
  });

  it('respec refused when nothing invested or credits short', () => {
    const p = defaultProfile();
    expect(respecSkills(p)).toBe(false); // nothing invested
    p.skillPoints = 2;
    investSkill(p, 0);
    activeShip(p).level = 9;
    p.credits = respecCost(p) - 1; // one short
    expect(respecSkills(p)).toBe(false);
    expect(totalInvested(p)).toBe(1); // unchanged
  });
});

describe('기체 타입 baseBp — 정수 bp, 단일 나눗셈 (설계서 §4)', () => {
  it('스트라이커는 baseBp 전 축 0 이라 스탯 무연산(uniqueMask 는 예외 — 자기 시그니처 비트가 켜진다)', () => {
    // ⚠️ 2026-08-06 — ADR-0049 로 스트라이커도 시그니처(정조준 사이클, 비트24)를 갖는다.
    // baseBp 무연산(스탯 축 불변)과 uniqueMask 무연산(시그니처 없음)은 별개 계약이었는데,
    // 후자는 폐기됐다 — 전자만 지금도 참이다.
    expect(shipTypeDef(0).baseBp).toEqual({ damageBp: 0, fireRateBp: 0, maxHpBp: 0, moveSpeedBp: 0 });
    expect(computeLoadoutStats([], undefined, 0).loadout).toEqual({
      ...neutralLoadout(),
      uniqueMask: 1 << SIG_STRIKER_MARKSMAN,
    });
  });

  it('브루저(타입 1)의 4축이 basis-point 정의대로 적용된다', () => {
    const bp = shipTypeDef(1).baseBp;
    const lo = computeLoadoutStats([], undefined, 1).loadout;
    expect(lo.damageMult).toBe((10000 + bp.damageBp) / 10000);
    // fireRateMult 는 발사 간격 배율 — 음수 bp(연사 ↓) 는 간격을 늘린다.
    expect(lo.fireRateMult).toBe(10000 / (10000 + bp.fireRateBp));
    expect(lo.fireRateMult).toBeGreaterThan(1);
    // 기준 HP 는 **리터럴이 아니라 정본 파생**이다 — `loadout.ts` 의 `BASE_HP_REF` 가 자기 주석에
    // "matches DEFAULT_CONFIG" 를 계약으로 적어 두었고, 그 값은 밸런스 튜닝 대상이다
    // (2026-08-08 에 100 → 151). 리터럴로 두면 튜닝할 때마다 이 케이스가 빨개진다.
    expect(lo.maxHpAdd).toBe(Math.round((DEFAULT_CONFIG.playerHp * bp.maxHpBp) / 10000));
    expect(lo.moveSpeedMult).toBe((10000 + bp.moveSpeedBp) / 10000);
    expect(lo.moveSpeedMult).toBeLessThan(1);
  });

  it('전 타입: maxHpAdd 는 항상 정수이고 배율은 유한 양수 (단일 나눗셈 산술)', () => {
    for (const def of SHIP_TYPES) {
      const lo = computeLoadoutStats([], undefined, def.id).loadout;
      expect(Number.isInteger(lo.maxHpAdd)).toBe(true);
      expect(lo.maxHpAdd).toBe(Math.round((DEFAULT_CONFIG.playerHp * def.baseBp.maxHpBp) / 10000));
      for (const mult of [lo.damageMult, lo.fireRateMult, lo.moveSpeedMult]) {
        expect(Number.isFinite(mult)).toBe(true);
        expect(mult).toBeGreaterThan(0);
      }
    }
  });

  it('baseBp 는 장비·계보와 곱해져도 결정론적으로 재현된다', () => {
    const gear = [m8Item('main', [{ stat: 'damagePct', value: 20 }])];
    const a = computeLoadoutStats(gear, 1500, 1).loadout;
    const b = computeLoadoutStats(gear, 1500, 1).loadout;
    expect(a).toEqual(b);
  });
});

describe('시그니처 비트 OR-in (설계서 §4 — §10-1 예측 결함)', () => {
  it('전 타입(스트라이커 포함)이 자기 시그니처 비트만 켠다(hasSignature 확인)', () => {
    // ⚠️ 2026-08-06 — 스트라이커도 이제 유효한 signatureBit(24, ADR-0049)을 가지므로 "타입 0 은
    // 예외" 분기(구 버전)는 더 이상 밟히지 않는다. 전 타입이 같은 규율을 따른다.
    for (const def of SHIP_TYPES) {
      const mask = computeLoadoutStats([], 0, def.id).loadout.uniqueMask;
      expect(def.signatureBit, def.slug).toBeGreaterThanOrEqual(18);
      expect(hasSignature(mask, def.signatureBit), def.slug).toBe(true);
      // 다른 타입의 시그니처 비트는 절대 켜지지 않는다(비트 혼선 = 다른 기체 패시브 발동).
      for (const other of SHIP_TYPES) {
        if (other.id === def.id) continue;
        expect(hasSignature(mask, other.signatureBit), `${def.slug} vs ${other.slug}`).toBe(false);
      }
    }
  });

  it('시그니처 비트는 typeId 미지정에서도 켜진다(투자와 무관한 타입 고유 속성)', () => {
    const mask = computeLoadoutStats([], undefined, 1).loadout.uniqueMask;
    expect(hasSignature(mask, shipTypeDef(1).signatureBit)).toBe(true);
  });
});

describe('computeLoadoutStats — 손상 typeId 정규화 (조용한 중립 금지)', () => {
  const GEAR: readonly Item[] = [
    m8Item('main', [{ stat: 'damagePct', value: 12 }]),
    m8Item('armor', [
      { stat: 'maxHpFlat', value: 30 },
      { stat: 'moveSpeedPct', value: 5 },
    ]),
  ];

  it('typeId 미지정 === 0 명시', () => {
    const bare = computeLoadoutStats(GEAR);
    expect(computeLoadoutStats(GEAR, undefined, 0)).toEqual(bare);
    expect(computeLoadoutStats(GEAR, undefined, DEFAULT_SHIP_TYPE)).toEqual(bare);
    const withBonus = computeLoadoutStats(GEAR, 2500);
    expect(computeLoadoutStats(GEAR, 2500, 0)).toEqual(withBonus);
    // 장비 없는 경로도 동일.
    expect(computeLoadoutStats([], undefined, 0)).toEqual(computeLoadoutStats([]));
  });

  it('범위 밖·손상 typeId 는 스트라이커로 되돌아간다(조용한 중립 loadout 방지)', () => {
    const bare = computeLoadoutStats([]);
    for (const bad of [-1, 999, 4.7 + 100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(computeLoadoutStats([], undefined, bad)).toEqual(bare);
    }
  });

  it('스트라이커도 자기 시그니처 비트(24)를 uniqueMask 에 켠다 — "시그니처 없음"은 더 이상 존재하지 않는다', () => {
    // ⚠️ 2026-08-06 — 구 계약("타입 0 은 시그니처 없음 · uniqueMask 는 절대 0 을 벗어나지 않는다")
    // 은 ADR-0049 가 스트라이커에 정조준 사이클(비트24)을 부여하며 폐기됐다. 지금 참인 것은
    // "스트라이커도 6기체와 같은 규율로 자기 비트 하나만 켠다"이다.
    expect(shipTypeDef(0).signatureBit).toBe(SIG_STRIKER_MARKSMAN);
    expect(computeLoadoutStats([], 0, 0).loadout.uniqueMask).toBe(1 << SIG_STRIKER_MARKSMAN);
  });

  it('호출이 equipped 아이템·어픽스 배열을 변형하지 않는다(벡터 불변)', () => {
    const gear = GEAR.map((it) => ({ ...it, affixes: it.affixes.map((a) => ({ ...a })) }));
    const snapshot = JSON.stringify(gear);
    computeLoadoutStats(gear, 2500, 1);
    expect(JSON.stringify(gear)).toBe(snapshot);
  });
});
