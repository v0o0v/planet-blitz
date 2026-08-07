/**
 * 촉매 **정련 결**(id 5~9)의 배선 계측 — `src/sim/catalyst/refine.ts`.
 *
 * ## 왜 앵커를 **직접** 부르는가 (전 런 대조를 안 쓰는 이유)
 * "촉매를 실은 런과 안 실은 런의 RNG 스트림을 비교한다"는 이 그룹에서 **원리적으로 못 쓴다** —
 * `id 6 gilding` 은 적 속도를, `id 8 alchemy` 는 바닥 전리품을 바꾸므로 전개 자체가 갈리고,
 * 그러면 `dropRng`/`waveRng` 가 **정당하게** 달라진다. 즉 그 대조는 결함이 아니라 카드가
 * 작동한다는 사실을 잡아 빨개진다.
 *
 * 그래서 잰다: **앵커 하나가 자기 스트림을 소비하는가**를 앵커 호출 전후의 `getState()` 로
 * 직접 본다. 이것이 헌장 §공통-B 가 실제로 요구하는 것이고(재롤 금지), 전 런 대조보다 좁은
 * 대신 **정확히 그 축만** 잰다.
 *
 * ## 음성 대조의 형태 — `catalysts: [1]`
 * `catalysts: []` 와 비교하면 `catalystOn` 게이트만 재고 **카드 소지 게이트(`carries`)는 못
 * 잰다** — 그 게이트가 빠지면 아무 촉매 한 장에 그룹 전체가 발동하는데, 빈 배열 대조는 그것을
 * 통과시킨다. 그래서 음성 대조는 **다른 카드 한 장을 실은 런**이다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import { addEntity, blankEntity } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { readMark, writeMark } from '../src/sim/catalystMarks.js';
import { readCatalystSlot } from '../src/sim/catalystSlots.js';
import { RefinementSlot } from '../src/sim/catalystSlots.js';
import { isCatalystHazard, isCatalystProspectShielded } from '../src/sim/catalyst/shared.js';
import {
  CARD_ALCHEMY,
  CARD_GILDING,
  CARD_PROSPECT,
  CARD_REFINEMENT,
  refineOnCatalystHazards,
  refineOnEnemyDamaged,
  refineOnEnemyStep,
  refineOnLootCollected,
  refineOnLootRoll,
  refineOnPowerupOffer,
  refineOnTick,
  refineOnWaveAdvanced,
} from '../src/sim/catalyst/refine.js';

/** 다른 결의 카드 한 장만 실은 런 — `carries` 게이트의 음성 대조용. */
const OTHER_CARD = 1;

function world(cards: number[]): WorldState {
  return createWorld(0xca7a, { ...DEFAULT_CONFIG, catalysts: cards });
}

function enemy(state: WorldState, x: number, y: number): Entity {
  const e = blankEntity('enemy');
  e.x = x;
  e.y = y;
  // ⚠️ `blankEntity` 의 `enemyType` 기본값은 `-1` 이라 `enemyDefFor` 가 `undefined` 를 낸다.
  // 이 파일은 앵커를 직접 부르므로 이동 단계를 안 타지만, 실런과 같은 모양으로 세워 둔다.
  e.enemyType = 0;
  e.hp = 10;
  e.maxHp = 10;
  return addEntity(state, e);
}

function loot(state: WorldState, x: number, y: number, rarityCode: number): Entity {
  const l = blankEntity('loot');
  l.x = x;
  l.y = y;
  l.hp = 1;
  l.damage = 12345; // drop seed
  l.enemyType = rarityCode; // rarity code
  return addEntity(state, l);
}

function ledgerOf(state: WorldState, id: number): { fired: number; earned: number; missed: number } {
  const row = state.catalystLedger?.find((r) => r.id === id);
  return { fired: row?.fired ?? 0, earned: row?.earned ?? 0, missed: row?.missed ?? 0 };
}

function hazardCount(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) if (!e.dead && isCatalystHazard(e)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// id 5 refinement — 정련로
// ---------------------------------------------------------------------------

describe('id 5 refinement', () => {
  it('음성 대조 — 안 실으면 수거가 억제되지도, 슬롯이 움직이지도 않는다', () => {
    const s = world([OTHER_CARD]);
    const l = loot(s, 0, 0, 0);
    expect(refineOnLootCollected(s, l)).toBe(false);
    expect(l.enemyType).toBe(0);
    expect(readCatalystSlot(s.catalystSlots, RefinementSlot.StockLow)).toBe(0);
    expect(readCatalystSlot(s.catalystSlots, RefinementSlot.StockHigh)).toBe(0);
  });

  it('이득과 대가가 둘 다 관측된다 — 앞의 둘은 삼켜지고 셋째가 승급한다', () => {
    const s = world([CARD_REFINEMENT]);
    const a = loot(s, 0, 0, 0);
    const b = loot(s, 0, 0, 0);
    const c = loot(s, 0, 0, 0);

    // 대가 ① — 앞의 둘은 인벤으로 안 간다(억제 = `true`).
    expect(refineOnLootCollected(s, a)).toBe(true);
    expect(readCatalystSlot(s.catalystSlots, RefinementSlot.StockLow)).toBe(1);
    expect(refineOnLootCollected(s, b)).toBe(true);
    expect(readCatalystSlot(s.catalystSlots, RefinementSlot.StockLow)).toBe(2);

    // 이득 — 셋째는 실리되 **한 단계 위**로 승급한다.
    expect(refineOnLootCollected(s, c)).toBe(false);
    expect(c.enemyType).toBe(1);
    // 재고는 비워진다(같은 등급 셋을 소진했다).
    expect(readCatalystSlot(s.catalystSlots, RefinementSlot.StockLow)).toBe(0);

    const led = ledgerOf(s, CARD_REFINEMENT);
    expect(led.missed).toBe(2); // 대가
    expect(led.earned).toBe(1); // 이득
    expect(led.fired).toBe(3);
  });

  it('등급 구간이 두 칸으로 갈린다 — 매직은 StockLow 상위 8비트, 레어는 StockHigh', () => {
    const s = world([CARD_REFINEMENT]);
    refineOnLootCollected(s, loot(s, 0, 0, 1));
    expect(readCatalystSlot(s.catalystSlots, RefinementSlot.StockLow)).toBe(1 << 8);
    refineOnLootCollected(s, loot(s, 0, 0, 2));
    expect(readCatalystSlot(s.catalystSlots, RefinementSlot.StockHigh)).toBe(1);
    // 노말 재고를 얹어도 매직 재고를 침범하지 않는다(비트 절삭 계약).
    refineOnLootCollected(s, loot(s, 0, 0, 0));
    expect(readCatalystSlot(s.catalystSlots, RefinementSlot.StockLow)).toBe((1 << 8) | 1);
  });

  it('최상 등급은 정련로에 안 들어간다 — 올릴 칸이 없다(축소 작동)', () => {
    const s = world([CARD_REFINEMENT]);
    const l = loot(s, 0, 0, 3);
    expect(refineOnLootCollected(s, l)).toBe(false);
    expect(l.enemyType).toBe(3);
    expect(readCatalystSlot(s.catalystSlots, RefinementSlot.StockHigh)).toBe(0);
  });

  it('정산 채널로 나간다 — 잔량이 슬롯 24칸에 실려 나온다', () => {
    const s = world([CARD_REFINEMENT]);
    refineOnLootCollected(s, loot(s, 0, 0, 0));
    // `catalystSettlementOf` 는 슬롯 배열의 **복사본**이므로 여기서 값만 확인한다.
    expect(readCatalystSlot(s.catalystSlots, RefinementSlot.StockLow)).toBe(1);
  });

  it('⭐ RNG 미소비 — 수거 앵커도 3택 앵커도 어느 스트림도 안 밀린다', () => {
    const s = world([CARD_REFINEMENT]);
    const offers = [3, 5, 7];
    const before = {
      drop: s.dropRng.getState(),
      wave: s.waveRng.getState(),
      powerup: s.powerupRng.getState(),
    };
    refineOnLootCollected(s, loot(s, 0, 0, 0));
    refineOnPowerupOffer(s, offers);
    expect(s.dropRng.getState()).toBe(before.drop);
    expect(s.waveRng.getState()).toBe(before.wave);
    expect(s.powerupRng.getState()).toBe(before.powerup);
    // ⚠️ 3택 자리를 **한 칸도 안 건드린다**(재추첨은 물론 자리 덮기도 안 한다).
    expect(offers).toEqual([3, 5, 7]);
  });
});

// ---------------------------------------------------------------------------
// id 6 gilding — 도금
// ---------------------------------------------------------------------------

describe('id 6 gilding', () => {
  it('음성 대조 — 안 실으면 시계도 안 돌고 속도 배율이 정확히 1 이다', () => {
    const s = world([OTHER_CARD]);
    const e = enemy(s, 0, 0);
    s.tick = 1800;
    refineOnTick(s, s.entities[0] as Entity);
    expect(readMark(e, 'gilding')).toBe(0);
    expect(refineOnEnemyStep(s, e)).toBe(1);
  });

  it('30초 경계마다 한 단계씩 오르고 3 에서 멈춘다', () => {
    const s = world([CARD_GILDING]);
    const e = enemy(s, 100, 100);
    for (let k = 1; k <= 5; k++) {
      s.tick = 1800 * k;
      refineOnTick(s, e);
    }
    expect(readMark(e, 'gilding')).toBe(3);
  });

  it('이득(전리품 등급)과 대가(적 속도)가 둘 다 관측된다', () => {
    const s = world([CARD_GILDING]);
    const e = enemy(s, 40, 60);
    writeMark(e, 'gilding', 3);
    // 대가 — 도금된 적은 그만큼 빠르다.
    expect(refineOnEnemyStep(s, e)).toBeCloseTo(1 + 0.12 * 3, 10);
    // 이득 — 전리품 등급이 도금 단계를 따라간다(카탈로그 상한 ×2.2 와 정확히 같다).
    e.dead = true;
    expect(refineOnLootRoll(s, 40, 60, true).rarity).toBeCloseTo(2.2, 10);
  });

  it('⭐ `aux0` 촉매 구역만 쓰고 `aux1` 은 불변이다', () => {
    const s = world([CARD_GILDING]);
    const e = enemy(s, 0, 0);
    // 중반 격전 마커가 점유하는 칸을 미리 세워 둔다 — 촉매가 덮으면 세그먼트 전진이 공짜다.
    e.aux1 = 0x1234;
    s.tick = 1800;
    refineOnTick(s, e);
    expect(readMark(e, 'gilding')).toBe(1);
    expect(e.aux1).toBe(0x1234);
    // 촉매 비트 구역 **밖**(25비트 이상)도 안 건드린다.
    expect(e.aux0 >>> 25).toBe(0);
  });

  it('처치하면 도금이 가장 가까운 적에게 옮겨 붙는다 (시체 표식은 남긴다)', () => {
    const s = world([CARD_GILDING]);
    const dying = enemy(s, 0, 0);
    const far = enemy(s, 500, 0);
    const near = enemy(s, 30, 0);
    writeMark(dying, 'gilding', 2);
    dying.dead = true;
    refineOnEnemyDamaged(s, dying, 99, undefined);
    expect(readMark(near, 'gilding')).toBe(2);
    expect(readMark(far, 'gilding')).toBe(0);
    // ⚠️ 시체 표식은 **남는다** — 같은 틱의 전리품 등급 롤이 그것을 읽는다.
    expect(readMark(dying, 'gilding')).toBe(2);
    expect(ledgerOf(s, CARD_GILDING).earned).toBe(2);
  });

  it('옮겨 붙을 적이 없으면 도금이 사라진다(축소 작동 — 놓침으로 적힌다)', () => {
    const s = world([CARD_GILDING]);
    const dying = enemy(s, 0, 0);
    writeMark(dying, 'gilding', 1);
    dying.dead = true;
    refineOnEnemyDamaged(s, dying, 99, undefined);
    expect(ledgerOf(s, CARD_GILDING).missed).toBe(1);
  });

  it('⭐ RNG 미소비 — 전리품 등급 배율은 재롤이 아니라 곱셈이다', () => {
    const s = world([CARD_GILDING]);
    const e = enemy(s, 10, 10);
    writeMark(e, 'gilding', 2);
    e.dead = true;
    const before = s.dropRng.getState();
    refineOnLootRoll(s, 10, 10, true);
    expect(s.dropRng.getState()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// id 7 prospect — 시굴
// ---------------------------------------------------------------------------

describe('id 7 prospect', () => {
  it('음성 대조 — 안 실으면 웨이브 전진이 아무도 지목하지 않는다', () => {
    const s = world([OTHER_CARD]);
    const a = enemy(s, 0, 0);
    refineOnWaveAdvanced(s, 0, 1);
    expect(readMark(a, 'prospect')).toBe(0);
    expect(isCatalystProspectShielded(a)).toBe(false);
  });

  it('지목은 웨이브 인덱스의 결정론 파생이다 — RNG 를 한 칸도 안 쓴다', () => {
    const make = (): WorldState => {
      const s = world([CARD_PROSPECT]);
      for (let i = 0; i < 6; i++) enemy(s, i * 40, 0);
      return s;
    };
    const s1 = make();
    const s2 = make();
    const before = { drop: s1.dropRng.getState(), wave: s1.waveRng.getState() };
    refineOnWaveAdvanced(s1, 0, 3);
    refineOnWaveAdvanced(s2, 0, 3);
    expect(s1.dropRng.getState()).toBe(before.drop);
    expect(s1.waveRng.getState()).toBe(before.wave);

    const idx = (s: WorldState): number => s.entities.findIndex((e) => readMark(e, 'prospect') !== 0);
    expect(idx(s1)).toBeGreaterThanOrEqual(0);
    expect(idx(s1)).toBe(idx(s2));
    // 지목은 웨이브당 **하나**다.
    expect(s1.entities.filter((e) => readMark(e, 'prospect') !== 0).length).toBe(1);
  });

  it('⭐ 무적 구간 동안 조준에서 빠지고, 호위가 흩어지면 되돌아온다', () => {
    const s = world([CARD_PROSPECT]);
    const holder = enemy(s, 0, 0);
    const g1 = enemy(s, 20, 0);
    const g2 = enemy(s, 0, 20);
    writeMark(holder, 'prospect', 1);

    // 호위 둘이 붙어 있으면 무적 → 조준 술어가 거짓이다.
    refineOnTick(s, holder);
    expect(isCatalystProspectShielded(holder)).toBe(true);
    expect(ledgerOf(s, CARD_PROSPECT).missed).toBe(1);

    // 호위가 흩어지면 창이 열린다 → 다시 조준된다.
    g1.x = 9000;
    g2.y = 9000;
    refineOnTick(s, holder);
    expect(isCatalystProspectShielded(holder)).toBe(false);
    expect(ledgerOf(s, CARD_PROSPECT).earned).toBe(1);
  });

  it('통지는 상태가 뒤집히는 틱에만 난다(틱당 상한 보호)', () => {
    const s = world([CARD_PROSPECT]);
    const holder = enemy(s, 0, 0);
    enemy(s, 20, 0);
    enemy(s, 0, 20);
    writeMark(holder, 'prospect', 1);
    refineOnTick(s, holder);
    const fired = ledgerOf(s, CARD_PROSPECT).fired;
    for (let i = 0; i < 10; i++) refineOnTick(s, holder);
    expect(ledgerOf(s, CARD_PROSPECT).fired).toBe(fired);
  });

  it('이득 — 광맥 보유자의 전리품 등급 배율이 ×2.0 이다', () => {
    const s = world([CARD_PROSPECT]);
    const e = enemy(s, 77, 88);
    writeMark(e, 'prospect', 1);
    e.dead = true;
    expect(refineOnLootRoll(s, 77, 88, true).rarity).toBeCloseTo(2.0, 10);
  });
});

// ---------------------------------------------------------------------------
// id 8 alchemy — 연금술
// ---------------------------------------------------------------------------

describe('id 8 alchemy', () => {
  it('음성 대조 — 안 실으면 융합도 장판도 없다', () => {
    const s = world([OTHER_CARD]);
    const a = loot(s, 0, 0, 0);
    loot(s, 10, 0, 0);
    loot(s, 0, 10, 0);
    refineOnCatalystHazards(s);
    expect(a.enemyType).toBe(0);
    expect(hazardCount(s)).toBe(0);
  });

  it('이득(매직 하나)과 대가(둘 소멸 + 유독 장판)가 둘 다 관측된다', () => {
    const s = world([CARD_ALCHEMY]);
    const a = loot(s, 0, 0, 0);
    const b = loot(s, 10, 0, 0);
    const c = loot(s, 0, 10, 0);
    refineOnCatalystHazards(s);
    // 이득 — 씨앗 하나가 매직으로 올라간다.
    expect(a.enemyType).toBe(1);
    expect(a.dead).toBe(false);
    // 대가 ① — 나머지 둘은 사라진다.
    expect(b.dead).toBe(true);
    expect(c.dead).toBe(true);
    // 대가 ② — 그 자리가 유독 장판이 된다(시한부 · 지속형).
    expect(hazardCount(s)).toBe(1);
    const h = s.entities.find((e) => isCatalystHazard(e));
    expect(h?.life).toBeGreaterThan(0);
    expect(h?.phase).toBe(1);

    const led = ledgerOf(s, CARD_ALCHEMY);
    expect(led.earned).toBe(1);
    expect(led.missed).toBe(2);
  });

  it('멀리 떨어진 노말은 융합하지 않는다(축소 작동)', () => {
    const s = world([CARD_ALCHEMY]);
    const a = loot(s, 0, 0, 0);
    loot(s, 5000, 0, 0);
    loot(s, 0, 5000, 0);
    refineOnCatalystHazards(s);
    expect(a.enemyType).toBe(0);
    expect(hazardCount(s)).toBe(0);
  });

  it('노말이 아닌 등급은 재료가 아니다', () => {
    const s = world([CARD_ALCHEMY]);
    const a = loot(s, 0, 0, 1);
    loot(s, 10, 0, 1);
    loot(s, 0, 10, 1);
    refineOnCatalystHazards(s);
    expect(a.enemyType).toBe(1);
    expect(hazardCount(s)).toBe(0);
  });

  it('⭐ RNG 미소비 — 융합도 장판 스폰도 어느 스트림도 안 민다', () => {
    const s = world([CARD_ALCHEMY]);
    loot(s, 0, 0, 0);
    loot(s, 10, 0, 0);
    loot(s, 0, 10, 0);
    const before = {
      drop: s.dropRng.getState(),
      wave: s.waveRng.getState(),
      powerup: s.powerupRng.getState(),
    };
    refineOnCatalystHazards(s);
    expect(s.dropRng.getState()).toBe(before.drop);
    expect(s.waveRng.getState()).toBe(before.wave);
    expect(s.powerupRng.getState()).toBe(before.powerup);
  });
});

// ---------------------------------------------------------------------------
// ⭐ id 5 ↔ id 8 재료 우선순위 — **alchemy 먼저**(두 앵커의 시간 순서가 근거다)
// ---------------------------------------------------------------------------

describe('id 5 ↔ id 8 재료 우선순위', () => {
  /** 노말 셋을 바닥에 놓고 → 융합 단계 → 살아남은 것을 수거한다(실런과 같은 순서). */
  function runBoth(): { collectedRarity: number; low: number; suppressed: boolean } {
    const s = world([CARD_REFINEMENT, CARD_ALCHEMY]);
    const a = loot(s, 0, 0, 0);
    loot(s, 10, 0, 0);
    loot(s, 0, 10, 0);
    // ① 바닥 단계 — alchemy 가 먼저 손댄다.
    refineOnCatalystHazards(s);
    // ② 수거 단계 — 살아남은 하나만 정련로로 들어간다.
    const suppressed = refineOnLootCollected(s, a);
    return {
      collectedRarity: a.enemyType,
      low: readCatalystSlot(s.catalystSlots, RefinementSlot.StockLow),
      suppressed,
    };
  }

  it('노말 셋은 항상 alchemy 가 먼저 접고, 정련로에는 **매직**으로 들어간다', () => {
    const r = runBoth();
    // alchemy 가 매직으로 올린 뒤라 정련로의 노말 칸(하위 8비트)은 0 이다.
    expect(r.low & 0xff).toBe(0);
    // 매직 칸(상위 8비트)에 1 이 쌓였고, 아직 셋이 아니라 수거가 억제됐다.
    expect((r.low >>> 8) & 0xff).toBe(1);
    expect(r.suppressed).toBe(true);
    expect(r.collectedRarity).toBe(1);
  });

  it('같은 배치는 같은 결과를 낸다(결정론)', () => {
    expect(runBoth()).toEqual(runBoth());
  });
});
