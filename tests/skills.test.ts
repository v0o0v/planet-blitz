import { describe, it, expect } from 'vitest';
import { buildRunConfig } from '../src/run/runConfig.js';
import {
  SKILLS,
  SKILL_NODE_COUNT,
  SKILL_TOTAL_CAPACITY,
  SKILL_TREES,
  NODES_PER_TREE,
  treeRange,
} from '../data/skills.js';
import { computeSkillStats, zeroStatSums } from '../src/items/skills.js';
import { computeLoadoutStats, neutralLoadout } from '../src/items/loadout.js';
import {
  defaultProfile,
  investSkill,
  respecSkills,
  respecCost,
  totalInvested,
  activeShip,
  zeroSkillInvest,
} from '../src/save/profile.js';
import type { Profile } from '../src/save/profile.js';
import {
  SHIP_TYPES,
  DEFAULT_SHIP_TYPE,
  NO_SIGNATURE_BIT,
  shipTypeDef,
  shipSkillNodeCount,
  zeroSkillInvest as registryZeroInvest,
} from '../data/ships/index.js';
import { hasCapstone } from '../src/sim/capstones.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { WorldConfig, InputFrame } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import type { Item, StatKey } from '../src/items/types.js';

/** Points a level-100 pilot banks (settlement grants 1/level, GDD §4). */
const BANKED_AT_CAP = 99;

describe('skill data — shape + capacity gate (AC1, master §3 gate ②)', () => {
  it('has 63 nodes (60 base 3 trees × 20 + 3 capstones)', () => {
    expect(SKILL_NODE_COUNT).toBe(63);
    expect(SKILL_TREES).toHaveLength(3);
    for (const tree of SKILL_TREES) {
      const { start, end } = treeRange(tree);
      expect(end - start).toBe(NODES_PER_TREE);
      for (let i = start; i < end; i++) expect(SKILLS[i]?.tree).toBe(tree);
      // base 20노드는 캡스톤이 아니다.
      for (let i = start; i < end; i++) expect(SKILLS[i]?.capstone).not.toBe(true);
    }
    // 인덱스 60·61·62 는 계열별 캡스톤(재번호 금지).
    expect(SKILLS[60]?.capstone).toBe(true);
    expect(SKILLS[60]?.tree).toBe('firepower');
    expect(SKILLS[61]?.tree).toBe('survival');
    expect(SKILLS[62]?.tree).toBe('mobility');
  });

  it('every node costs 1..5 points; base per tree ~83, capstones 1pt each', () => {
    for (const n of SKILLS) {
      expect(n.maxPoints).toBeGreaterThanOrEqual(1);
      expect(n.maxPoints).toBeLessThanOrEqual(5);
    }
    // 캡스톤 3노드(각 1pt) 포함 총 용량 = 250 base + 3 = 253.
    expect(SKILL_TOTAL_CAPACITY).toBe(253);
    for (const tree of SKILL_TREES) {
      const { start, end } = treeRange(tree);
      let cap = 0;
      for (let i = start; i < end; i++) cap += SKILLS[i]?.maxPoints ?? 0;
      expect(cap).toBeGreaterThanOrEqual(80);
      expect(cap).toBeLessThanOrEqual(90);
    }
  });

  it('99 banked points cover ≤40% of the base tree (capacity + node count)', () => {
    // 게이트는 base 60 수치 노드에 대한 것 — 캡스톤은 별도의 질적 해금이므로 제외한다.
    const baseNodes = SKILLS.filter((n) => n.capstone !== true);
    expect(baseNodes).toHaveLength(60);
    const baseCapacity = baseNodes.reduce((s, n) => s + n.maxPoints, 0);
    expect(baseCapacity).toBe(250);
    // Capacity reading: 99 points is ≤40% of the 250-point base capacity.
    expect(BANKED_AT_CAP / baseCapacity).toBeLessThanOrEqual(0.4);
    // Node-count reading: spending greedily on the cheapest base nodes first, 99
    // points fully funds at most 24 nodes = 40% of 60.
    const costs = baseNodes.map((n) => n.maxPoints).sort((a, b) => a - b);
    let pts = BANKED_AT_CAP;
    let count = 0;
    for (const c of costs) {
      if (pts >= c) {
        pts -= c;
        count++;
      } else break;
    }
    expect(count).toBeLessThanOrEqual(Math.floor(baseNodes.length * 0.4));
  });
});

describe('computeSkillStats — derivation + synergy (AC1)', () => {
  it('no investment → all-zero stat sums', () => {
    expect(computeSkillStats(zeroSkillInvest())).toEqual(zeroStatSums());
  });

  it('investing a damage node yields damagePct, and is deterministic', () => {
    const invest = zeroSkillInvest();
    invest[0] = 4; // firepower tier0 node0 (damagePct, perPoint 3)
    const a = computeSkillStats(invest);
    const b = computeSkillStats(invest.slice());
    expect(a).toEqual(b);
    expect(a.damagePct).toBeGreaterThan(0);
  });

  it('lower-tier investment amplifies a higher-tier node (synergy, OQ-M3-2)', () => {
    const capstoneIdx = 16; // firepower tier4 node0 — damagePct capstone
    expect(SKILLS[capstoneIdx]?.tier).toBe(4);
    expect(SKILLS[capstoneIdx]?.stat).toBe('damagePct');

    const soloInvest = zeroSkillInvest();
    soloInvest[capstoneIdx] = 5;
    const solo = computeSkillStats(soloInvest);

    // Add a NON-damage lower-tier node (bulletSpeed, tier0) so the only way the
    // capstone's damagePct can rise is the lower-tier synergy amplifier.
    const withLower = soloInvest.slice();
    withLower[3] = 4; // firepower tier0 node3 — bulletSpeedPct
    const amped = computeSkillStats(withLower);

    expect(amped.damagePct).toBeGreaterThan(solo.damagePct);
  });

  it('integer-typed stats (pierce/bulletCount) stay whole', () => {
    const invest = zeroSkillInvest();
    invest[7] = 2; // firepower tier1 node3 — pierce, perPoint 0.5 → 2×0.5 = 1
    const s = computeSkillStats(invest);
    expect(Number.isInteger(s.pierce)).toBe(true);
    expect(s.pierce).toBe(1);
  });

  it('clamps an over-invested / corrupt vector to node maxima', () => {
    const invest = zeroSkillInvest();
    invest[0] = 999; // node max is 4
    const s = computeSkillStats(invest);
    const capped = zeroSkillInvest();
    capped[0] = SKILLS[0]?.maxPoints ?? 0;
    expect(s).toEqual(computeSkillStats(capped));
  });

  it('never grants mineralFind (meta-only stat)', () => {
    const invest = zeroSkillInvest().map(() => 5);
    expect(computeSkillStats(invest).mineralFindPct).toBe(0);
  });
});

describe('computeLoadoutStats — skill integration (plan A2)', () => {
  it('no invest reproduces the M2 gear-only result', () => {
    expect(computeLoadoutStats([]).loadout).toEqual(neutralLoadout());
    expect(computeLoadoutStats([], zeroSkillInvest()).loadout).toEqual(neutralLoadout());
  });

  it('skill investment strengthens the derived block', () => {
    const invest = zeroSkillInvest();
    invest[0] = 4; // damagePct
    invest[40] = 4; // mobility tier0 node0 — moveSpeedPct
    const { loadout } = computeLoadoutStats([], invest);
    expect(loadout.damageMult).toBeGreaterThan(1);
    expect(loadout.moveSpeedMult).toBeGreaterThan(1);
  });
});

describe('profile — invest + respec (AC1, plan A3)', () => {
  it('invests banked points and refuses when maxed or empty', () => {
    const p = defaultProfile();
    p.skillPoints = 3;
    expect(investSkill(p, 0)).toBe(true);
    expect(activeShip(p).skillInvest[0]).toBe(1);
    expect(p.skillPoints).toBe(2);
    // Fill to the node max, then further invest is refused.
    const max = SKILLS[0]?.maxPoints ?? 0;
    p.skillPoints = 10;
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
    expect(activeShip(p).skillInvest).toEqual(zeroSkillInvest());
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

// ===========================================================================
// M8-L4 — 파생 스탯의 타입 인식 확장 (설계서 §4·§5)
// ===========================================================================

const M8_SRC = { planet: 0, tier: 0 } as const;

function m8Item(slot: 'main' | 'sub' | 'armor', affixes: { stat: StatKey; value: number }[]): Item {
  return {
    id: `m8-${slot}`,
    slot,
    rarity: 'rare',
    affixes: affixes.map((a, i) => ({ id: `a${i}`, stat: a.stat, value: a.value })),
    source: M8_SRC,
  };
}

/** 스트라이커 63노드 벡터를 인덱스 규칙으로 채운다(테스트 전용 결정론 패턴). */
function strikerVec(fn: (i: number) => number): number[] {
  const v = zeroSkillInvest(0);
  for (let i = 0; i < v.length; i++) v[i] = fn(i);
  return v;
}

/** 골든이 걸린 기준 벡터 — 세 계열·여러 티어를 고르게 건드린다. */
const GOLDEN_VEC = strikerVec((i) => (i % 3 === 0 ? 2 : i % 5 === 0 ? 4 : 0));

describe('⚠️ 스트라이커 불변 관문 — typeId 미지정 === typeId 0 (설계서 §5)', () => {
  const GEAR: readonly Item[] = [
    m8Item('main', [{ stat: 'damagePct', value: 12 }]),
    m8Item('armor', [
      { stat: 'maxHpFlat', value: 30 },
      { stat: 'moveSpeedPct', value: 5 },
    ]),
  ];
  const VECTORS: Record<string, number[] | undefined> = {
    미지정: undefined,
    무투자: zeroSkillInvest(0),
    혼합: GOLDEN_VEC,
    만투자: strikerVec((i) => SKILLS[i]?.maxPoints ?? 0),
    손상초과: strikerVec(() => 999),
  };

  for (const [name, inv] of Object.entries(VECTORS)) {
    it(`${name}: (eq, inv) === (eq, inv, 0) === (eq, inv, undefined, 0)`, () => {
      const bare = computeLoadoutStats(GEAR, inv);
      // 프롬프트가 못 박은 절대 조건(3번째 인자 = shipBonusBp 0).
      expect(computeLoadoutStats(GEAR, inv, 0)).toEqual(bare);
      // typeId 를 명시적으로 0 으로 준 경우도 완전히 동일해야 한다.
      expect(computeLoadoutStats(GEAR, inv, undefined, 0)).toEqual(bare);
      expect(computeLoadoutStats(GEAR, inv, undefined, DEFAULT_SHIP_TYPE)).toEqual(bare);
      expect(computeLoadoutStats(GEAR, inv, 0, 0)).toEqual(bare);
      // 계보 보너스가 붙어도 typeId 축은 독립적으로 무연산이어야 한다.
      const withBonus = computeLoadoutStats(GEAR, inv, 2500);
      expect(computeLoadoutStats(GEAR, inv, 2500, 0)).toEqual(withBonus);
      // 장비 없는 경로도 동일.
      expect(computeLoadoutStats([], inv, undefined, 0)).toEqual(computeLoadoutStats([], inv));
    });
  }

  it('computeSkillStats: 미지정 === 0', () => {
    for (const inv of Object.values(VECTORS)) {
      if (inv === undefined) continue;
      expect(computeSkillStats(inv, 0)).toEqual(computeSkillStats(inv));
      expect(computeSkillStats(inv, DEFAULT_SHIP_TYPE)).toEqual(computeSkillStats(inv));
    }
  });

  it('범위 밖·손상 typeId 는 스트라이커로 되돌아간다(조용한 중립 금지)', () => {
    const bare = computeLoadoutStats([], GOLDEN_VEC);
    for (const bad of [-1, 999, 4.7 + 100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(computeLoadoutStats([], GOLDEN_VEC, undefined, bad)).toEqual(bare);
      expect(computeSkillStats(GOLDEN_VEC, bad)).toEqual(computeSkillStats(GOLDEN_VEC));
    }
  });

  it('스트라이커는 시그니처 비트가 없다 → uniqueMask 가 커지지 않는다', () => {
    expect(shipTypeDef(0).signatureBit).toBe(NO_SIGNATURE_BIT);
    expect(computeLoadoutStats([], zeroSkillInvest(0), 0, 0).loadout.uniqueMask).toBe(0);
  });
});

describe('스트라이커 63노드 파생 골든 (회귀 탐지기 — 설계서 §5)', () => {
  it('computeSkillStats 골든', () => {
    // ⚠️ 이 숫자는 M8 착수 전(HEAD) 구현으로 실측해 옮긴 값이다. 바뀌면 스트라이커 빌드의
    // 파생 스탯이 변했다는 뜻이고, 곧 기존 런의 리플레이 해시가 발산한다는 뜻이다.
    expect(computeSkillStats(GOLDEN_VEC)).toEqual({
      damagePct: 16.64,
      fireRatePct: 14.512,
      bulletCount: 0,
      pierce: 1,
      bulletSpeedPct: 35.024,
      rangeFlat: 81.28,
      moveSpeedPct: 39.552,
      maxHpFlat: 68.768,
      maxHpPct: 16.896,
      dashCdPct: 31.872,
      magnetPct: 43.856,
      xpPct: 6.384,
      mineralFindPct: 0,
      fireDmg: 0,
      coldSlow: 0,
      lightning: 0,
    });
  });

  it('computeLoadoutStats 골든 (같은 벡터의 파생 블록 전량)', () => {
    expect(computeLoadoutStats([], GOLDEN_VEC).loadout).toEqual({
      weaponType: 0,
      subWeaponType: -1,
      damageMult: 1.1663999999999999,
      fireRateMult: 0.85488,
      bulletCountAdd: 0,
      pierceAdd: 1,
      bulletSpeedMult: 1.3502399999999999,
      spreadAdd: 0,
      rangeAdd: 81.28,
      moveSpeedMult: 1.3955199999999999,
      maxHpAdd: 85.768,
      dashCdMult: 0.68128,
      magnetMult: 1.43856,
      xpMult: 1.06384,
      uniqueMask: 0,
      fireDmg: 0,
      coldSlow: 0,
      lightning: 0,
    });
  });

  it('만투자 골든 (티어 시너지 상한 경로까지 덮는다)', () => {
    const full = computeSkillStats(strikerVec((i) => SKILLS[i]?.maxPoints ?? 0));
    expect(full.damagePct).toBe(120.59200000000001);
    expect(full.moveSpeedPct).toBe(151.68800000000002);
    expect(full.maxHpFlat).toBe(306.35200000000003);
    expect(full.pierce).toBe(7);
    expect(full.bulletCount).toBe(3);
  });
});

describe('기체 타입 baseBp — 정수 bp, 단일 나눗셈 (설계서 §4)', () => {
  it('스트라이커는 전 축 0 이라 무연산', () => {
    expect(shipTypeDef(0).baseBp).toEqual({ damageBp: 0, fireRateBp: 0, maxHpBp: 0, moveSpeedBp: 0 });
    expect(computeLoadoutStats([], undefined, undefined, 0).loadout).toEqual(neutralLoadout());
  });

  it('브루저(타입 1)의 4축이 basis-point 정의대로 적용된다', () => {
    const bp = shipTypeDef(1).baseBp;
    const lo = computeLoadoutStats([], undefined, undefined, 1).loadout;
    expect(lo.damageMult).toBe((10000 + bp.damageBp) / 10000);
    // fireRateMult 는 발사 간격 배율 — 음수 bp(연사 ↓) 는 간격을 늘린다.
    expect(lo.fireRateMult).toBe(10000 / (10000 + bp.fireRateBp));
    expect(lo.fireRateMult).toBeGreaterThan(1);
    expect(lo.maxHpAdd).toBe(Math.round((100 * bp.maxHpBp) / 10000));
    expect(lo.moveSpeedMult).toBe((10000 + bp.moveSpeedBp) / 10000);
    expect(lo.moveSpeedMult).toBeLessThan(1);
  });

  it('전 타입: maxHpAdd 는 항상 정수이고 배율은 유한 양수 (단일 나눗셈 산술)', () => {
    for (const def of SHIP_TYPES) {
      const lo = computeLoadoutStats([], undefined, undefined, def.id).loadout;
      expect(Number.isInteger(lo.maxHpAdd)).toBe(true);
      expect(lo.maxHpAdd).toBe(Math.round((100 * def.baseBp.maxHpBp) / 10000));
      for (const mult of [lo.damageMult, lo.fireRateMult, lo.moveSpeedMult]) {
        expect(Number.isFinite(mult)).toBe(true);
        expect(mult).toBeGreaterThan(0);
      }
    }
  });

  it('baseBp 는 장비·스킬·계보와 곱해져도 결정론적으로 재현된다', () => {
    const gear = [m8Item('main', [{ stat: 'damagePct', value: 20 }])];
    const inv = registryZeroInvest(1);
    const a = computeLoadoutStats(gear, inv, 1500, 1).loadout;
    const b = computeLoadoutStats(gear, inv.slice(), 1500, 1).loadout;
    expect(a).toEqual(b);
  });
});

describe('시그니처 비트 OR-in (설계서 §4 — §10-1 예측 결함)', () => {
  it('typeId ≥ 1 은 자기 시그니처 비트를 실제로 켠다(hasCapstone 확인)', () => {
    for (const def of SHIP_TYPES) {
      const mask = computeLoadoutStats([], registryZeroInvest(def.id), 0, def.id).loadout.uniqueMask;
      if (def.signatureBit < 0) {
        expect(def.id).toBe(0); // 스트라이커만 시그니처 없음
        expect(mask).toBe(0);
        continue;
      }
      expect(def.signatureBit).toBeGreaterThanOrEqual(18);
      expect(hasCapstone(mask, def.signatureBit)).toBe(true);
      // 다른 타입의 시그니처 비트는 절대 켜지지 않는다(비트 혼선 = 다른 기체 패시브 발동).
      for (const other of SHIP_TYPES) {
        if (other.id === def.id || other.signatureBit < 0) continue;
        expect(hasCapstone(mask, other.signatureBit)).toBe(false);
      }
    }
  });

  it('시그니처 비트는 invest 미지정에서도 켜진다(투자와 무관한 타입 고유 속성)', () => {
    const mask = computeLoadoutStats([], undefined, undefined, 1).loadout.uniqueMask;
    expect(hasCapstone(mask, shipTypeDef(1).signatureBit)).toBe(true);
  });
});

describe('타입별 트리 슬라이스 (computeSkillStats(invest, typeId))', () => {
  it('벡터 길이 초과분은 무시된다 — 슬라이스 경계가 타입별이다', () => {
    for (const def of SHIP_TYPES) {
      const n = shipSkillNodeCount(def.id);
      const exact = registryZeroInvest(def.id).map(() => 3);
      const withTail = [...exact, 9, 9, 9, 9];
      expect(exact.length).toBe(n);
      expect(computeSkillStats(withTail, def.id)).toEqual(computeSkillStats(exact, def.id));
    }
  });

  it('짧은/빈 벡터도 안전(누락 = 0)', () => {
    for (const def of SHIP_TYPES) {
      expect(computeSkillStats([], def.id)).toEqual(zeroStatSums());
      expect(computeSkillStats([1, 2], def.id)).not.toBeUndefined();
    }
  });

  it('flat 인덱스 0 투자는 **그 타입의** 트리0 노드0 정의대로 접힌다', () => {
    // 데이터 비의존 증명: 티어 0 노드는 하위 티어가 없어 시너지 증폭이 0 이므로,
    // 결과가 정확히 `pts × perPoint` 여야 한다. 스트라이커 노드표를 쓰면 값이 틀어진다.
    for (const def of SHIP_TYPES) {
      const node = def.trees[0]?.nodes[0];
      expect(node).toBeDefined();
      if (node === undefined) continue;
      expect(node.tier).toBe(0);
      const pts = Math.min(4, node.maxPoints);
      const v = registryZeroInvest(def.id);
      v[0] = pts;
      const sums = computeSkillStats(v, def.id);
      const raw = pts * node.perPoint;
      const expected = node.stat === 'pierce' || node.stat === 'bulletCount' ? Math.floor(raw) : raw;
      expect(sums[node.stat]).toBe(expected);
    }
  });

  it('같은 벡터라도 타입이 다르면 다른 트리로 접힌다', () => {
    const v = GOLDEN_VEC; // 스트라이커 길이(63) — 신규 4종도 현재 63 이라 그대로 쓸 수 있다
    const striker = computeSkillStats(v, 0);
    expect(striker.damagePct).toBeGreaterThan(0);
    for (const def of SHIP_TYPES) {
      if (def.id === 0) continue;
      expect(computeSkillStats(v, def.id)).not.toEqual(striker);
    }
  });
});

// ---------------------------------------------------------------------------
// 정규 경로 통합 — 설계서 §10 ("단위 테스트 그린인데 배선이 통째로 없다")
//
// ⚠️ M8-L7 이 `buildRunConfig(profile)` 를 추출하면 아래 헬퍼를 지우고 그 함수를 직접
// 호출할 것. 그 순간 이 테스트가 "앱 경로가 실제로 typeId 를 파생 레이어에 넘긴다" 를
// 문자 그대로 증명한다(지금은 main.ts 3중복 조립을 재현한 근사다).
// ---------------------------------------------------------------------------

// ✅ M8-L7 완료: 조립을 재현하지 않고 실제 앱(`src/main.ts`)이 부르는 `buildRunConfig` 를
// 그대로 호출한다. `playerHp` 만 테스트가 덮는데, 그것은 프로필 파생값이 아니라 무대 상수다.
function assembleRunConfigLikeMain(profile: Profile): WorldConfig {
  return { ...buildRunConfig(profile, { planet: 0, tier: 0 }), playerHp: 100_000_000 };
}

function runHashes(seed: number, config: WorldConfig, ticks: number): number[] {
  const state = createWorld(seed, config);
  const frame: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };
  const out: number[] = [];
  for (let t = 0; t < ticks; t++) {
    stepWorld(state, frame);
    out.push(hashWorld(state));
  }
  return out;
}

describe('정규 경로 통합 — Profile → 파생 → createWorld/stepWorld', () => {
  it('기본(스트라이커) 프로필의 런은 시그니처 비트 없이 실제로 돈다', () => {
    const cfg = assembleRunConfigLikeMain(defaultProfile());
    expect(cfg.loadout?.uniqueMask).toBe(0);
    const hashes = runHashes(4242, cfg, 120);
    // 월드가 정지해 있으면(전부 같은 해시) 이 테스트는 아무것도 증명하지 못한다.
    expect(new Set(hashes).size).toBeGreaterThan(60);
  });

  it('typeId=1 프로필은 시그니처 비트가 sim 까지 도달하고 해시 스트림이 갈린다', () => {
    const striker = defaultProfile();
    const bruiser = defaultProfile();
    const ship = activeShip(bruiser);
    ship.typeId = 1;
    ship.skillInvest = registryZeroInvest(1);

    const cfgB = assembleRunConfigLikeMain(bruiser);
    expect(hasCapstone(cfgB.loadout?.uniqueMask ?? 0, shipTypeDef(1).signatureBit)).toBe(true);
    // baseBp 도 파생 블록에 실제로 실렸다.
    expect(cfgB.loadout?.maxHpAdd).toBe(25);

    const a = runHashes(4242, assembleRunConfigLikeMain(striker), 120);
    const b = runHashes(4242, cfgB, 120);
    expect(b).not.toEqual(a); // 배선이 없으면 두 스트림이 같아진다
    // 그리고 재실행은 여전히 결정론적이다(ADR-0005).
    expect(runHashes(4242, assembleRunConfigLikeMain(bruiser), 120)).toEqual(b);
  });
});
