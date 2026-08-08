/**
 * 촉매 **드랍 축**이 설계도·의뢰서 확률에 닿는다 (2026-08-08 2차 사용자 지시).
 *
 * 지시: *"설계도와 의뢰서도 아이템이다. 촉매의 드랍 추가 확률에 의해서 이것들도 영향을 받게 하라."*
 *
 * ## 이 파일이 재는 것 넷
 *  1. **실측이지 주장이 아니다** — 카드를 꽂기만 하고 조건을 못 채우면 배율이 정확히 1이다.
 *  2. **축 상한 클램프** — 규칙이 곱해져 상한을 넘어도 잘린다(실측값은 상한을 넘을 수 있다).
 *  3. **총량이 실제로 오른다** — 설계도 히트율이 배율과 함께 오른다.
 *  4. **무촉매 런 불변** — 배율 미지정 경로가 구 경로와 결과까지 같다.
 *
 * ## ⚠️ 확률 축 테스트 3규칙 (2026-08-08 확률 레인이 값비싸게 배운 것)
 *  ① **표본을 늘리려면 레코드가 아니라 런을 늘려라.** 게이트는 런당 한 번만 굴린다 —
 *     한 런에 300건을 밀어 넣어도 기대 히트는 안 움직인다.
 *  ② **비지 않음을 명시로 못 박아라.** 게이트 도입 후 "고정 시드 결과 대조" 단언들이 조용히
 *     `[] 와 [] 를 비교`하기 시작했고 초록이라 아무도 안 봤다.
 *  ③ **"안 나온다" 를 단일 런으로 재지 마라.** 3% 를 못 뚫어서 통과하는 것과 구분되지 않는다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, DEFAULT_CONFIG, catalystLootMultOf } from '../src/sim/world.js';
import { creditLootCount } from '../src/sim/catalyst/fx.js';
import { axisCapMultWithResonance } from '../src/data/catalystResonance.js';
import { scaleGateChanceCp, GATE_CP_MAX } from '../src/data/catalystDrops.js';
import { blueprintDropsFromLoot } from '../data/planets/index.js';
import { BLUEPRINT_RUN_CHANCE_CP, RARITY_RARE, RARITY_UNIQUE } from '../src/sim/drops.js';

/** 드랍 축 카드 셋 — 전수 스윕이 낸 최악 조합(#15 extraction + #20 resonance + #34 royal-jelly). */
const DROP_AXIS_TRIO = [15, 20, 34];

function catalystWorld(ids: readonly number[]) {
  return createWorld(1234, { ...DEFAULT_CONFIG, catalysts: [...ids] });
}

describe('드랍 축 실측 배율 — catalystLootMultOf', () => {
  it('무촉매 런은 채널 자체가 없다', () => {
    const w = createWorld(1, { ...DEFAULT_CONFIG });
    creditLootCount(w, 5); // 무촉매면 무연산이어야 한다.
    expect(catalystLootMultOf(w)).toBeUndefined();
    expect(w.catalystLootTally).toBeUndefined();
  });

  it('⭐ 카드를 꽂아도 조건을 못 채우면 배율이 없다 (주장이 아니라 실측)', () => {
    // 이것이 헌장 §상한 근거 규율의 요구다. 주입 목록에서 파생했다면 여기서 x3.0 이 나온다.
    const w = catalystWorld(DROP_AXIS_TRIO);
    for (let i = 0; i < 20; i++) creditLootCount(w, 0); // 롤은 있었고 추가분이 0
    expect(w.catalystLootTally).toEqual({ base: 20, bonus: 0 });
    expect(catalystLootMultOf(w)).toBeUndefined();
  });

  it('전리품이 한 건도 없는 런도 배율이 없다', () => {
    const w = catalystWorld(DROP_AXIS_TRIO);
    expect(catalystLootMultOf(w)).toBeUndefined();
  });

  it('실제로 추가된 수만큼의 비율을 낸다', () => {
    const w = catalystWorld(DROP_AXIS_TRIO);
    for (let i = 0; i < 4; i++) creditLootCount(w, 1); // 롤 4회, 추가 4건 → x2.0
    expect(catalystLootMultOf(w)).toBeCloseTo(2, 10);
  });

  it('⭐ 축 상한을 넘는 실측값은 잘린다 (규칙이 곱해지므로 넘을 수 있다)', () => {
    const w = catalystWorld(DROP_AXIS_TRIO);
    const cap = axisCapMultWithResonance(DROP_AXIS_TRIO, 'drop');
    // 롤 1회에 추가 99건 = 실측 x100. 클램프가 없으면 그대로 새어 나간다.
    creditLootCount(w, 99);
    const mult = catalystLootMultOf(w);
    expect(mult).toBeDefined();
    expect(mult).toBeCloseTo(cap, 10);
    // 그리고 그 상한은 전수 스윕이 낸 최댓값 x3.0 이다(공명 snare 포함).
    expect(cap).toBeCloseTo(3, 10);
  });

  it('상한 미만의 실측값은 그대로 통과한다 (클램프가 상시 무는 게 아니다)', () => {
    const w = catalystWorld(DROP_AXIS_TRIO);
    for (let i = 0; i < 10; i++) creditLootCount(w, i < 5 ? 1 : 0); // 10롤 5추가 → x1.5
    expect(catalystLootMultOf(w)).toBeCloseTo(1.5, 10);
  });
});

describe('확률 게이트 스케일 — scaleGateChanceCp', () => {
  it('미지정·1 이하는 base 를 정수 그대로 돌려준다', () => {
    // 무촉매 런이 반올림 왕복조차 겪지 않아야 구 경로와 정수 동일이다.
    expect(scaleGateChanceCp(300, undefined)).toBe(300);
    expect(scaleGateChanceCp(300, 1)).toBe(300);
    expect(scaleGateChanceCp(300, 0.5)).toBe(300);
  });

  it('설계도 base 3% 가 최대 배율에서 9% 가 된다', () => {
    expect(scaleGateChanceCp(BLUEPRINT_RUN_CHANCE_CP, 3)).toBe(900);
  });

  it('100% 를 넘지 않는다', () => {
    expect(scaleGateChanceCp(9000, 3)).toBe(GATE_CP_MAX);
  });
});

// ---------------------------------------------------------------------------
// 설계도 총량 — 런을 늘려서 잰다 (규칙 ①)
// ---------------------------------------------------------------------------

/** 클리어 런 1건의 전리품. 보스 확정 rare 1 + 엘리트 unique 1 — 후보가 비지 않는다. */
function runLoot(i: number): { seed: number; rarity: number; planet: number; stage: number }[] {
  return [
    { seed: (i * 2654435761) >>> 0, rarity: RARITY_RARE, planet: 3, stage: 20 },
    { seed: (i * 40503 + 7) >>> 0, rarity: RARITY_UNIQUE, planet: 3, stage: 20 },
  ];
}

/** N 런을 돌려 설계도가 나온 런 수를 센다. */
function hitCount(runs: number, mult?: number): number {
  let hits = 0;
  for (let i = 0; i < runs; i++) {
    if (blueprintDropsFromLoot(runLoot(i), true, mult).length > 0) hits++;
  }
  return hits;
}

describe('설계도 총량이 드랍 축을 탄다', () => {
  const RUNS = 4000;

  it('⭐ 배율이 없을 때와 최대일 때의 히트 수가 유의하게 다르다', () => {
    const base = hitCount(RUNS);
    const boosted = hitCount(RUNS, 3);

    // 규칙 ② — 비지 않음을 **명시로** 못 박는다. 둘 다 0 이면 아래 부등식이 공허해진다.
    expect(base, '기저 히트가 0 이다 — 게이트가 아예 안 열린다').toBeGreaterThan(0);
    expect(boosted, '증폭 히트가 0 이다').toBeGreaterThan(0);

    // 기대: 3% → 120 · 9% → 360. 표본 4000 이면 2배 부등식은 편안하다(sd 각각 11 · 18).
    expect(boosted).toBeGreaterThan(base * 2);
  });

  it('히트율이 게이트 cp 를 실제로 따라간다 (±30%)', () => {
    // "배율이 곱해졌다"만으론 부족하다 — 곱해진 **값**이 맞는지 본다.
    for (const mult of [undefined, 1.5, 3] as const) {
      const expectedCp = scaleGateChanceCp(BLUEPRINT_RUN_CHANCE_CP, mult);
      const observed = (hitCount(RUNS, mult) / RUNS) * 10000;
      expect(observed, `배율 ${String(mult)} 에서 관측 ${observed.toFixed(0)}cp`).toBeGreaterThan(
        expectedCp * 0.7,
      );
      expect(observed).toBeLessThan(expectedCp * 1.3);
    }
  });

  it('무촉매 경로가 구 호출부(2인자)와 결과까지 같다', () => {
    // 배선을 넣으면서 무촉매 런의 거동이 흔들리지 않았음을 런 단위로 대조한다.
    let compared = 0;
    for (let i = 0; i < 500; i++) {
      const loot = runLoot(i);
      const old = blueprintDropsFromLoot(loot, true);
      const now = blueprintDropsFromLoot(loot, true, undefined);
      expect(now).toEqual(old);
      if (old.length > 0) compared++;
    }
    // 규칙 ② — 500 런 중 히트가 하나도 없었다면 위 비교는 `[] 대 []` 뿐이다.
    expect(compared, '히트가 0 이라 대조가 공허하다').toBeGreaterThan(0);
  });

  it('배율이 있어도 클리어 게이트는 그대로다 (규칙 ③ — 같은 런 집합을 두 조건으로)', () => {
    // 단일 런으로 "안 나온다"를 재면 3% 를 못 뚫어서 통과하는 것과 구분이 안 된다.
    // 같은 500 런을 victory=true/false 로 각각 돌려 **대조**한다.
    let won = 0;
    let lost = 0;
    for (let i = 0; i < 500; i++) {
      const loot = runLoot(i);
      if (blueprintDropsFromLoot(loot, true, 3).length > 0) won++;
      if (blueprintDropsFromLoot(loot, false, 3).length > 0) lost++;
    }
    expect(won, '승리 쪽 히트가 0 이면 대조가 공허하다').toBeGreaterThan(0);
    expect(lost).toBe(0);
  });
});
