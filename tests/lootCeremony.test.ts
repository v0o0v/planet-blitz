/**
 * 보상 세리머니(전리품 등급 공개) 단위 테스트 (Phase 5 — plan §AC-5.2; ADR-0031).
 *
 * `LootCeremony`([src/render/effects/lootCeremony.ts])는 정산 화면에서 **이번 런의 실제 드랍 등급
 * 목록**을 카드 플립 + 광택 + (유니크) 헤일로로 순차 공개하는 재사용 세리머니다. 리드(정산 배선
 * 레인)가 `SettlementSummary.drops` 의 등급을 넘겨 `show` 하고, 매 프레임 `update` 한다. 여기서는
 * 그 소비 계약을 헤드리스로 못박는다:
 *
 *  1. **동기 배선**: `show` 즉시 `container.children.length > 0`(절차적 Graphics/Text 라 GL 없이 성립).
 *  2. **등급색 반영**: 공개된 등급 색이 `RARITY_COLOR_NUM` 을 따른다.
 *  3. **유니크 헤일로**: 목록에 유니크가 있으면 그 카드 공개 동안 헤일로가 켜진다. 없으면 안 켜진다.
 *  4. **빈 목록 graceful**: `show([])` 는 throw 없이 안전(공개 없음).
 *  5. **플립·광택 진행**: `update` 로 카드 가로 스케일이 접혔다 펴지고, 광택 알파가 오르내린다.
 *  6. **정리**: `reset`/`hide` 후 숨김·리셋. 재-show 로 처음부터 다시.
 *  7. **순수 위상 함수 경계**: flipScaleX · triEnvelope · haloPulse.
 *
 * node 환경 vitest(vite.config.ts `environment: 'node'`)라 GL 이 없다 — PixiJS 는 렌더러 없이 import
 * 만 하므로 node 에서 그대로 돈다(tests/pickupPop.test.ts·ceremonyVariants 배선 스모크 선례). 표시
 * 객체 추가·상태 전이만 검증하고 실제 픽셀 래스터화는 다루지 않는다.
 */

import { describe, it, expect } from 'vitest';
import { LootCeremony, flipScaleX, triEnvelope, haloPulse } from '../src/render/effects/lootCeremony.js';
import { RARITY_COLOR_NUM } from '../src/ui/pixi/theme.js';
import type { Rarity } from '../src/items/types.js';

const CTX = { width: 600, height: 400 } as const;

/** 특정 등급이 카드에 완전히 공개될 때까지(또는 상한) update 를 돌린다. */
function advanceUntil(c: LootCeremony, pred: () => boolean, maxFrames = 400): boolean {
  for (let i = 0; i < maxFrames; i++) {
    c.update(0.05);
    if (pred()) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 1. 동기 배선 — show 즉시 실 표시 객체를 붙인다.
// ---------------------------------------------------------------------------

describe('LootCeremony 동기 배선', () => {
  it('생성 즉시 container 에 카드·헤일로를 붙인다(children>0)', () => {
    const c = new LootCeremony(CTX);
    expect(c.container.children.length).toBeGreaterThan(0);
    c.destroy();
  });

  it('생성 직후엔 숨김·비공개 상태(뒷면)', () => {
    const c = new LootCeremony(CTX);
    expect(c.container.visible).toBe(false);
    expect(c.revealing).toBe(false);
    expect(c.currentTier).toBeNull();
    c.destroy();
  });

  it('show 하면 화면이 열리고 공개가 시작된다(children>0 · revealing)', () => {
    const c = new LootCeremony(CTX);
    c.show(['normal', 'rare']);
    expect(c.container.visible).toBe(true);
    expect(c.container.children.length).toBeGreaterThan(0);
    expect(c.revealing).toBe(true);
    c.destroy();
  });
});

// ---------------------------------------------------------------------------
// 2. 등급색 반영 — 공개된 등급 색이 RARITY_COLOR_NUM 을 따른다.
// ---------------------------------------------------------------------------

describe('LootCeremony 등급색 반영', () => {
  const tiers: Rarity[] = ['normal', 'magic', 'rare', 'unique'];
  for (const tier of tiers) {
    it(`단일 [${tier}] 공개 시 앞면 색이 RARITY_COLOR_NUM.${tier}`, () => {
      const c = new LootCeremony(CTX);
      c.show([tier]);
      const revealed = advanceUntil(c, () => c.currentTier === tier);
      expect(revealed, `${tier} 카드가 공개돼야 한다`).toBe(true);
      expect(c.currentTier).toBe(tier);
      expect(c.currentTierColor).toBe(RARITY_COLOR_NUM[tier]);
      c.destroy();
    });
  }

  it('공개 전(뒷면)엔 등급색이 없다(null)', () => {
    const c = new LootCeremony(CTX);
    c.show(['rare']);
    // 첫 프레임 직후엔 아직 봉인된 뒷면(모서리 통과 전).
    c.update(0.01);
    expect(c.currentTier).toBeNull();
    expect(c.currentTierColor).toBeNull();
    c.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3. 유니크 헤일로 — 유니크 공개 동안 켜지고, 유니크가 없으면 안 켜진다.
// ---------------------------------------------------------------------------

describe('LootCeremony 유니크 헤일로', () => {
  it('목록에 유니크가 있으면 그 카드 공개 동안 헤일로가 켜진다', () => {
    const c = new LootCeremony(CTX);
    c.show(['magic', 'unique']);
    const lit = advanceUntil(c, () => c.uniqueHighlighted);
    expect(lit, '유니크 카드 공개 중 헤일로가 켜져야 한다').toBe(true);
    // 헤일로 알파는 맥동 범위(0.6~1.0) 안.
    expect(c.uniqueHighlighted).toBe(true);
    c.destroy();
  });

  it('유니크 없는 목록은 끝까지 헤일로가 켜지지 않는다', () => {
    const c = new LootCeremony(CTX);
    c.show(['normal', 'magic', 'rare']);
    let everLit = false;
    for (let i = 0; i < 200; i++) {
      c.update(0.05);
      if (c.uniqueHighlighted) everLit = true;
    }
    expect(everLit, '유니크가 없으면 헤일로가 한 번도 안 켜져야 한다').toBe(false);
    expect(c.revealing, '충분히 진행하면 공개가 끝난다').toBe(false);
    c.destroy();
  });

  it('마지막 카드가 유니크면 공개 종료 후에도 헤일로가 유지된다', () => {
    const c = new LootCeremony(CTX);
    c.show(['rare', 'unique']);
    // 목록 소진까지 충분히 진행.
    for (let i = 0; i < 200; i++) c.update(0.05);
    expect(c.revealing).toBe(false);
    expect(c.currentTier).toBe('unique');
    expect(c.uniqueHighlighted, '마지막 유니크 카드는 계속 강조된다').toBe(true);
    c.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. 빈 목록 graceful — throw 없이 안전.
// ---------------------------------------------------------------------------

describe('LootCeremony 빈 목록 graceful', () => {
  it('show([]) 는 throw 없이 안전하고 공개하지 않는다', () => {
    const c = new LootCeremony(CTX);
    expect(() => {
      c.show([]);
      for (let i = 0; i < 5; i++) c.update(0.05);
    }).not.toThrow();
    expect(c.revealing).toBe(false);
    expect(c.currentTier).toBeNull();
    // 뒷면 카드는 여전히 그려져 있다(children>0).
    expect(c.container.children.length).toBeGreaterThan(0);
    c.destroy();
  });

  it('빈 목록 후 실제 목록으로 재-show 하면 정상 공개된다', () => {
    const c = new LootCeremony(CTX);
    c.show([]);
    c.update(0.05);
    c.show(['unique']);
    expect(c.revealing).toBe(true);
    const revealed = advanceUntil(c, () => c.currentTier === 'unique');
    expect(revealed).toBe(true);
    c.destroy();
  });
});

// ---------------------------------------------------------------------------
// 5. 플립·광택 진행 — 카드가 접혔다 펴지고, 광택 알파가 오르내린다.
// ---------------------------------------------------------------------------

describe('LootCeremony 플립·광택 진행', () => {
  it('첫 장 공개 중 카드 가로 스케일이 접혔다(<1) 다시 펴진다(~1)', () => {
    const c = new LootCeremony(CTX);
    c.show(['rare']);
    let minScale = 1;
    let maxAfter = 0;
    // 한 스텝(1.2s) 분량을 촘촘히 관측.
    for (let i = 0; i < 30; i++) {
      c.update(0.02);
      minScale = Math.min(minScale, c.cardScaleX);
      if (i > 20) maxAfter = Math.max(maxAfter, c.cardScaleX); // 플립 후반부.
    }
    expect(minScale, '플립 중 카드가 모서리로 접혀야 한다(스케일<1)').toBeLessThan(0.5);
    expect(maxAfter, '플립이 끝나면 다시 펴져야 한다(스케일~1)').toBeGreaterThan(0.9);
    c.destroy();
  });

  it('공개 직후 광택 스윕이 한 번 지나간다(알파가 0→양수→0)', () => {
    const c = new LootCeremony(CTX);
    c.show(['magic']);
    let peak = 0;
    for (let i = 0; i < 40; i++) {
      c.update(0.02);
      peak = Math.max(peak, c.glossAlpha);
    }
    expect(peak, '광택 스윕 중 알파가 양수로 오른다').toBeGreaterThan(0);
    // 유지 구간(스텝 후반)에서는 광택이 꺼져 있다.
    for (let i = 0; i < 40; i++) c.update(0.05);
    expect(c.glossAlpha, '공개가 끝나면 광택은 꺼져 있다').toBe(0);
    c.destroy();
  });

  it('큰 dt(탭 복귀 등)에도 throw 없이 진행된다', () => {
    const c = new LootCeremony(CTX);
    c.show(['normal', 'unique']);
    expect(() => {
      c.update(2);
      c.update(0.016);
    }).not.toThrow();
    c.destroy();
  });
});

// ---------------------------------------------------------------------------
// 6. 정리 — reset/hide 후 숨김·리셋, 재-show 로 재시작.
// ---------------------------------------------------------------------------

describe('LootCeremony 정리·재사용', () => {
  it('hide 후 숨겨지고 update 는 no-op 이 된다', () => {
    const c = new LootCeremony(CTX);
    c.show(['rare', 'unique']);
    c.update(0.05);
    c.hide();
    expect(c.container.visible).toBe(false);
    expect(c.uniqueHighlighted).toBe(false);
    // 숨김 상태에서 update 는 아무 것도 하지 않는다(throw 없음).
    expect(() => c.update(0.05)).not.toThrow();
    c.destroy();
  });

  it('reset 후 초기 상태(숨김·뒷면·비공개)로 돌아간다', () => {
    const c = new LootCeremony(CTX);
    c.show(['unique']);
    advanceUntil(c, () => c.currentTier === 'unique');
    c.reset();
    expect(c.container.visible).toBe(false);
    expect(c.revealing).toBe(false);
    expect(c.currentTier).toBeNull();
    expect(c.currentTierColor).toBeNull();
    expect(c.uniqueHighlighted).toBe(false);
    c.destroy();
  });

  it('reset 후 재-show 하면 처음부터 다시 공개한다', () => {
    const c = new LootCeremony(CTX);
    c.show(['normal']);
    for (let i = 0; i < 50; i++) c.update(0.05); // 소진
    expect(c.revealing).toBe(false);
    c.reset();
    c.show(['magic', 'rare']);
    expect(c.revealing).toBe(true);
    expect(advanceUntil(c, () => c.currentTier === 'magic')).toBe(true);
    c.destroy();
  });

  it('중간/공개완료 어느 지점에서 destroy() 해도 throw 없이 정리하고 이중 destroy 무해', () => {
    const c = new LootCeremony(CTX);
    c.show(['rare', 'unique']);
    c.update(0.05);
    expect(() => c.destroy()).not.toThrow();
    // destroy 이후 API 는 무해한 no-op.
    expect(() => c.update(0.05)).not.toThrow();
    expect(() => c.show(['normal'])).not.toThrow();
    expect(() => c.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 7. 순수 위상 함수 경계.
// ---------------------------------------------------------------------------

describe('LootCeremony 순수 위상 함수', () => {
  it('flipScaleX: 1(펼침) → 0(모서리) → 1(펼침)', () => {
    const FLIP = 0.42;
    expect(flipScaleX(0, FLIP)).toBeCloseTo(1, 5);
    expect(flipScaleX(FLIP * 0.5, FLIP)).toBeCloseTo(0, 5);
    expect(flipScaleX(FLIP, FLIP)).toBeCloseTo(1, 5);
    // 플립길이를 넘겨도 클램프돼 1(펼침) 유지.
    expect(flipScaleX(FLIP * 2, FLIP)).toBeCloseTo(1, 5);
  });

  it('triEnvelope: 0 → 1 → 0, 경계 밖은 0', () => {
    expect(triEnvelope(0)).toBe(0);
    expect(triEnvelope(0.5)).toBe(1);
    expect(triEnvelope(1)).toBe(0);
    expect(triEnvelope(-0.3)).toBe(0);
    expect(triEnvelope(1.3)).toBe(0);
  });

  it('haloPulse: 항상 [0.6, 1.0] 안에서 맥동', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < 20; t += 0.05) {
      const v = haloPulse(t);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeGreaterThanOrEqual(0.6 - 1e-9);
    expect(hi).toBeLessThanOrEqual(1.0 + 1e-9);
    // 실제로 최소·최대 근처까지 흔들린다.
    expect(lo).toBeLessThan(0.62);
    expect(hi).toBeGreaterThan(0.98);
  });
});
