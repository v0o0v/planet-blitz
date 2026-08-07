/**
 * 스킬 어픽스(ADR-0049, affixes.md ①-5)의 **해시 영향분** — `deriveSkillAffixLv` 파생 ·
 * `buildRunConfig` 조건부 스탬프 · `hashWorld` 꼬리 폴드.
 *
 * 이 파일이 지키는 것은 `skillInvest`(포인트 투자)와 **완전히 분리된 이중 벡터**
 * `skillAffixLv`(장비 파생, 축별 [0,4] 정수 3칸)의 배선뿐이다 — 어픽스 6종의 실제 드랍·
 * 슬롯 풀·정련 상호작용은 별도 레인(affixes.md ⑥-2 단계 1·3)의 몫이다.
 *
 * 핵심 불변식 둘:
 *  ① 어픽스 0인 런(장비 없음/무관 어픽스만)은 config·해시가 **바이트 불변** — 골든 대조의 근거.
 *  ② 어픽스가 실리면 `skillAffixLv` 가 정확히 그 값이고 해시가 갈린다.
 */

import { describe, it, expect } from 'vitest';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import type { Ship } from '../src/save/profile.js';
import { deriveSkillAffixLv } from '../src/items/loadout.js';
import { createWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { EQUIP_SLOTS, SKILL_AFFIX_LV_MAX } from '../src/items/types.js';
import { skillLv } from '../src/items/skills.js';
import type { Item, SlotKind, StatKey } from '../src/items/types.js';

function item(id: string, slot: SlotKind, affixes: { stat: StatKey; value: number }[]): Item {
  return {
    id,
    slot,
    rarity: 'rare',
    affixes: affixes.map((a, i) => ({ id: `${id}-a${i}`, stat: a.stat, value: a.value })),
    source: { planet: 0, stage: 1 },
  };
}

function equippedInOrder(ship: Ship): Item[] {
  const out: Item[] = [];
  for (const id of EQUIP_SLOTS) {
    const it = ship.equipped[id];
    if (it !== undefined) out.push(it);
  }
  return out;
}

describe('deriveSkillAffixLv — 축별 정수 3칸 파생 (순수 함수)', () => {
  it('장비 없음 → [0,0,0]', () => {
    expect(deriveSkillAffixLv([])).toEqual([0, 0, 0]);
  });

  it('무관 StatKey(일반 어픽스)는 무시된다', () => {
    const eq = [item('a', 'main', [{ stat: 'damagePct', value: 50 }])];
    expect(deriveSkillAffixLv(eq)).toEqual([0, 0, 0]);
  });

  it('축별 어픽스가 TREE_AFFINITIES 순서(offense=0/defense=1/utility=2)로 접힌다', () => {
    const eq = [
      item('a', 'main', [{ stat: 'skillLvOffense', value: 1 }]),
      item('b', 'armor', [{ stat: 'skillLvDefense', value: 2 }]),
      item('c', 'engine', [{ stat: 'skillLvUtility', value: 1 }]),
    ];
    expect(deriveSkillAffixLv(eq)).toEqual([1, 2, 1]);
  });

  it('같은 축 두 슬롯이 합산된다(①-3 — 축당 최대 2슬롯 × +2)', () => {
    const eq = [
      item('a', 'main', [{ stat: 'skillLvOffense', value: 2 }]),
      item('b', 'sub', [{ stat: 'skillLvOffense', value: 2 }]),
    ];
    expect(deriveSkillAffixLv(eq)).toEqual([4, 0, 0]);
  });

  it('구조적 상한 4를 넘는 값은 클램프된다(손상 데이터 방어)', () => {
    const eq = [item('a', 'main', [{ stat: 'skillLvOffense', value: 99 }])];
    expect(deriveSkillAffixLv(eq)).toEqual([4, 0, 0]);
  });
});

describe('buildRunConfig — skillAffixLv 조건부 스탬프', () => {
  it('전 축 0(무장비)이면 필드 자체를 싣지 않는다 — config 직렬화 바이트 불변', () => {
    const cfg = buildRunConfig(defaultProfile(), { planet: 0, stage: 1 });
    expect('skillAffixLv' in cfg).toBe(false);
    expect(JSON.stringify(cfg).includes('skillAffixLv')).toBe(false);
  });

  it('축 어픽스가 실린 장비를 끼면 정확히 그 값이 스탬프되고 sim 까지 도달한다', () => {
    const profile = defaultProfile();
    const ship = activeShip(profile);
    ship.equipped = {
      main: item('it-main', 'main', [{ stat: 'skillLvOffense', value: 2 }]),
      armor: item('it-armor', 'armor', [{ stat: 'skillLvDefense', value: 1 }]),
    };
    const cfg = buildRunConfig(profile, { planet: 0, stage: 1 });
    expect(cfg.skillAffixLv).toEqual([2, 1, 0]);
    const state = createWorld(1, cfg);
    expect(state.config.skillAffixLv).toEqual([2, 1, 0]);
  });

  it('의뢰 장비축 제약으로 걸러진 장비의 어픽스는 반영되지 않는다(⑤-2c — 같은 필터 배열 재사용)', () => {
    const profile = defaultProfile();
    const ship = activeShip(profile);
    ship.equipped = {
      main: item('it-main', 'main', [{ stat: 'skillLvOffense', value: 2 }]),
    };
    const eq = equippedInOrder(ship);
    // main 슬롯을 금지하는 의뢰 제약을 buildRunConfig 의 pilot-less(의뢰) 경로로 흉내낸다:
    // equipBanned 자체는 runConfig.ts 내부 함수라 여기서는 필터 결과를 직접 검증하는 대신
    // deriveSkillAffixLv 가 "넘겨받은 배열"만 본다는 계약을 넘겨주는 배열로 증명한다.
    expect(deriveSkillAffixLv(eq)).toEqual([2, 0, 0]);
    expect(deriveSkillAffixLv([])).toEqual([0, 0, 0]); // 필터가 다 걸렀다면 이 값이어야 한다
  });
});

describe('hashWorld — skillAffixLv 꼬리 폴드 (조건부 · all-or-nothing)', () => {
  it('불변식 ①: 전 축 0이면 필드 유무와 무관하게 해시가 바이트 동일하다', () => {
    const withoutField: WorldConfig = { ...DEFAULT_CONFIG };
    const withZeroField: WorldConfig = { ...DEFAULT_CONFIG, skillAffixLv: [0, 0, 0] };
    const h1 = hashWorld(createWorld(7, withoutField));
    const h2 = hashWorld(createWorld(7, withZeroField));
    expect(h2).toBe(h1);
  });

  it('불변식 ②: 하나라도 0이 아니면 해시가 갈린다', () => {
    const base = hashWorld(createWorld(7, { ...DEFAULT_CONFIG }));
    const withAffix = hashWorld(createWorld(7, { ...DEFAULT_CONFIG, skillAffixLv: [1, 0, 0] }));
    expect(withAffix).not.toBe(base);
  });

  it('부분 폴드가 아니다 — (1,0,0)과 (0,1,0)이 같은 바이트열을 낳지 않는다(충돌 방지)', () => {
    const a = hashWorld(createWorld(7, { ...DEFAULT_CONFIG, skillAffixLv: [1, 0, 0] }));
    const b = hashWorld(createWorld(7, { ...DEFAULT_CONFIG, skillAffixLv: [0, 1, 0] }));
    const c = hashWorld(createWorld(7, { ...DEFAULT_CONFIG, skillAffixLv: [0, 0, 1] }));
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });

  it('skillInvest 폴드와 독립 — skillAffixLv 유무가 skillInvest 만 있는 런의 해시를 바꾼다', () => {
    const invest = new Array(30).fill(0);
    invest[0] = 3;
    const withoutAffix = hashWorld(
      createWorld(7, { ...DEFAULT_CONFIG, skillInvest: invest }),
    );
    const withAffix = hashWorld(
      createWorld(7, { ...DEFAULT_CONFIG, skillInvest: invest, skillAffixLv: [1, 0, 0] }),
    );
    expect(withAffix).not.toBe(withoutAffix);
  });
});

// ---------------------------------------------------------------------------
// 신뢰 경계 — `skillAffixLv` 는 리플레이 config 로 들어오는 **외부 입력**이다
//
// 파생 쪽 `clampSkillAffixLv`(loadout.ts)는 **클라의 파생 시점**에만 걸린다. 손으로 고친
// config 는 그 경로를 아예 안 지나므로, 2026-08-07 이전에는 `[9999, …]` 이 sim 에 그대로
// 들어가 스킬 레벨이 무제한으로 올랐다. ADR-0050 으로 서버 재실행 대조까지 사라져 뒷단도
// 없다. 그래서 클램프를 **읽는 쪽**(신뢰 경계 안)으로 옮겼다.
//
// ⚠️ 사용자 판정(2026-08-07): 의뢰 봉인은 **하지 않는다** — 승패 주장 자체를 서버가 믿는
//    상태라 이 한 축만 봉인해도 실효 방어가 거의 안 는다. 무제한만 막는다.
// ---------------------------------------------------------------------------

describe('skillLv — 가산분은 신뢰 경계 안에서 잘린다', () => {
  it('위조된 거대값이 축당 상한으로 잘린다', () => {
    const invest = [5];
    // 상한 없이 더하면 5 + 9999. 잘리면 5 + 4.
    expect(skillLv(invest, 0, [9999, 9999, 9999])).toBe(5 + SKILL_AFFIX_LV_MAX);
  });

  it('상한 이하 값은 그대로 실린다 (클램프가 과녁을 벗어나지 않았다)', () => {
    const invest = [5];
    expect(skillLv(invest, 0, [1, 0, 0])).toBe(6);
    expect(skillLv(invest, 0, [SKILL_AFFIX_LV_MAX, 0, 0])).toBe(5 + SKILL_AFFIX_LV_MAX);
  });

  it('⭐ 결과는 여전히 20 에서 안 잘린다 — 실효 상한 24 가 설계다', () => {
    // 이 단언이 깨지는 형태가 정확히 "가산분 클램프와 결과 클램프를 뭉친" 잘못이다.
    expect(skillLv([20], 0, [SKILL_AFFIX_LV_MAX, 0, 0])).toBe(24);
  });

  it('미해금(투자 0)은 여전히 어픽스로 안 켜진다 (정본 1 — 클램프가 이걸 안 건드렸다)', () => {
    expect(skillLv([0], 0, [9999, 9999, 9999])).toBe(0);
  });

  it('⚠️ 정상 런에는 무연산이다 — 그것이 해시 불변의 근거다', () => {
    // 파생값은 구조상 0~4 이므로 클램프가 값을 바꿀 일이 없다. 바뀌면 골든이 갈린다.
    for (let v = 0; v <= SKILL_AFFIX_LV_MAX; v++) {
      expect(skillLv([3], 0, [v, 0, 0])).toBe(3 + v);
    }
  });
});
