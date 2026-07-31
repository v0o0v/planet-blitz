/**
 * 촉매 상점 행의 순수 표시 판정 — `src/ui/pixi/catalystShopView.ts` (ADR-0042).
 *
 * 화면(`catalystArchive.ts`)은 캔버스가 없는 vitest 에서 `Text.width` 가 던지므로 통째로는 못
 * 싣는다. 그래서 **버튼 활성 판정·거부 사유 선택·가격 포맷**을 Pixi 밖으로 뽑아 여기서 잠근다.
 *
 * 계획 §5 의 상태표(공용/특산 × 보유/미보유)를 그대로 표로 검증하는 것이 이 파일의 본체다.
 */

import { describe, it, expect } from 'vitest';
import { CATALOG } from '../src/i18n/catalog.js';
import {
  clampQty,
  salvageQty,
  salvageGain,
  buyCost,
  salvageEnabled,
  buyEnabled,
  buyBlockedKey,
  salvageBlockedKey,
  rowNoteText,
  buyRejectKey,
  salvageRejectKey,
  salvageLabel,
  salvageLabelQty,
  noteLayout,
  ROW_H,
  NOTE_MIN_Y,
  NOTE_PAD_BOTTOM,
  NOTE_BUDGET,
  NOTE_EXPECTED_H,
  NOTE_GAP,
  INFO_Y,
  INFO_LINE_H,
  INFO_MAX_LINES,
  INFO_BOTTOM,
  NOTE_LINE_H,
  NOTE_MAX_LINES,
  TEXT_MEASURE_SLACK,
  QTY_MIN,
  QTY_MAX,
  type CatalystRowShopState,
} from '../src/ui/pixi/catalystShopView.js';
import {
  CATALYSTS,
  catalystBuyPrice,
  catalystSalvageValue,
  catalystIsPurchasable,
} from '../src/data/catalysts.js';

/** 공용·특산 대표 id(하드코딩이 아니라 카탈로그에서 뽑는다 — 재정렬돼도 유효). */
const COMMON_ID = CATALYSTS.find((c) => c.kind === 'common')?.id ?? 0;
const SIGNATURE_ID = CATALYSTS.find((c) => c.kind === 'signature')?.id ?? 30;

function state(over: Partial<CatalystRowShopState> = {}): CatalystRowShopState {
  return { id: COMMON_ID, owned: 0, qty: 1, residue: 0, online: true, ...over };
}

describe('clampQty — 스테퍼 값 정규화', () => {
  it('정수·[QTY_MIN, QTY_MAX] 로 클램프한다', () => {
    expect(clampQty(0)).toBe(QTY_MIN);
    expect(clampQty(-5)).toBe(QTY_MIN);
    expect(clampQty(3.9)).toBe(3);
    expect(clampQty(QTY_MAX + 100)).toBe(QTY_MAX);
    expect(clampQty(Number.NaN)).toBe(QTY_MIN);
  });
});

describe('수량 파생 — 보유 상한과 결합 순서', () => {
  it('분해 수량은 보유를 넘지 않는다', () => {
    expect(salvageQty(state({ owned: 2, qty: 5 }))).toBe(2);
    expect(salvageQty(state({ owned: 9, qty: 3 }))).toBe(3);
    expect(salvageQty(state({ owned: 0, qty: 3 }))).toBe(0);
  });

  it('분해 획득은 `단가 × n` 이다 — floor 안에 n 을 넣는 결합 순서와 다르다', () => {
    // 특산 보스(w=4)는 buyPrice 25 · 단가 12 라 3장이면 36 이고, floor(25*50*3/100)=37 과 갈린다.
    const boss = CATALYSTS.find((c) => catalystBuyPrice(c.id) === 25);
    expect(boss).toBeDefined();
    const id = boss?.id ?? SIGNATURE_ID;
    expect(catalystSalvageValue(id)).toBe(12);
    expect(salvageGain(state({ id, owned: 3, qty: 3 }))).toBe(36);
    expect(salvageGain(state({ id, owned: 3, qty: 3 }))).not.toBe(37);
  });

  it('구매 비용은 `구매가 × 지정 수량` 이며 보유와 무관하다', () => {
    expect(buyCost(state({ owned: 0, qty: 4 }))).toBe(catalystBuyPrice(COMMON_ID) * 4);
  });
});

describe('상태표 — 공용/특산 × 보유/미보유 (계획 §5)', () => {
  const price = () => catalystBuyPrice(COMMON_ID);

  it('공용 · 보유>0 — 분해 활성, 잔재 충분하면 구매 활성', () => {
    const s = state({ owned: 3, residue: price() });
    expect(salvageEnabled(s)).toBe(true);
    expect(buyEnabled(s)).toBe(true);
    expect(buyBlockedKey(s)).toBeNull();
    expect(salvageBlockedKey(s)).toBeNull();
  });

  it('공용 · 보유 0 — 분해 비활성(사유 표시), 구매는 잔재만 보면 된다', () => {
    const s = state({ owned: 0, residue: price() });
    expect(salvageEnabled(s)).toBe(false);
    expect(salvageBlockedKey(s)).toBe('catalyst.manage.empty');
    expect(buyEnabled(s)).toBe(true);
  });

  it('특산 · 보유>0 — 분해 활성, 구매는 signatureNotSold 로 비활성', () => {
    const s = state({ id: SIGNATURE_ID, owned: 2, residue: 100000 });
    expect(catalystIsPurchasable(SIGNATURE_ID)).toBe(false);
    expect(salvageEnabled(s)).toBe(true);
    expect(buyEnabled(s)).toBe(false);
    expect(buyBlockedKey(s)).toBe('catalyst.shop.signatureNotSold');
  });

  it('특산 · 보유 0 — 둘 다 비활성', () => {
    const s = state({ id: SIGNATURE_ID, owned: 0, residue: 100000 });
    expect(salvageEnabled(s)).toBe(false);
    expect(buyEnabled(s)).toBe(false);
  });
});

describe('구매 거부 사유 — 우선순위', () => {
  it('오프라인이면 모든 사유를 접고 오프라인 안내 하나만 낸다', () => {
    const s = state({ owned: 5, residue: 999999, online: false });
    expect(salvageEnabled(s)).toBe(false);
    expect(buyEnabled(s)).toBe(false);
    expect(buyBlockedKey(s)).toBe('catalyst.shop.offline');
    expect(salvageBlockedKey(s)).toBe('catalyst.shop.offline');
  });

  it('잔재를 아직 못 읽었으면(null) noProfile 이고 구매가 잠긴다 — 0 과 구분한다', () => {
    const s = state({ residue: null });
    expect(buyEnabled(s)).toBe(false);
    expect(buyBlockedKey(s)).toBe('catalyst.shop.noProfile');
    expect(buyBlockedKey(state({ residue: 0 }))).toBe('catalyst.shop.insufficientResidue');
  });

  it('잔재가 비용보다 1 모자라면 잠기고, 정확히 같으면 열린다', () => {
    const cost = catalystBuyPrice(COMMON_ID) * 2;
    expect(buyEnabled(state({ qty: 2, residue: cost - 1 }))).toBe(false);
    expect(buyBlockedKey(state({ qty: 2, residue: cost - 1 }))).toBe(
      'catalyst.shop.insufficientResidue',
    );
    expect(buyEnabled(state({ qty: 2, residue: cost }))).toBe(true);
  });
});

describe('행 문구 — 수량에 따라 갈린다', () => {
  it('수량을 올리면 구매가 문구가 함께 오른다(스테퍼 로컬 갱신의 근거)', () => {
    const one = rowNoteText(state({ owned: 5, qty: 1, residue: 999999 }));
    const three = rowNoteText(state({ owned: 5, qty: 3, residue: 999999 }));
    expect(one).not.toBe(three);
    expect(three).toContain(String(catalystBuyPrice(COMMON_ID) * 3));
  });

  it('오프라인 행은 오프라인 안내 하나로 접힌다', () => {
    const s = state({ owned: 5, online: false, residue: null });
    expect(rowNoteText(s).includes('·')).toBe(false);
  });
});

describe('서버 note → 안내 문구 키', () => {
  it('구매 거부 사유를 각각 제 키로 옮긴다', () => {
    expect(buyRejectKey('no-profile')).toBe('catalyst.shop.noProfile');
    expect(buyRejectKey('signature-not-sold')).toBe('catalyst.shop.signatureNotSold');
    expect(buyRejectKey('price-unset')).toBe('catalyst.shop.priceUnset');
    expect(buyRejectKey('insufficient-residue')).toBe('catalyst.shop.insufficientResidue');
  });

  it('미지 사유·부재는 **구매** 일반 실패로 접는다(무반응 금지)', () => {
    expect(buyRejectKey(undefined)).toBe('catalyst.shop.buyFail');
    expect(buyRejectKey('who-knows')).toBe('catalyst.shop.buyFail');
    // 서버가 실제로 내는 사유들이다(supabase/migrations/20260731000000_catalyst_shop.sql
    // buy_catalyst §거부 사유). 앞으로 늘어날 사유도 전부 이 분기로 떨어진다.
    expect(buyRejectKey('unknown-catalyst')).toBe('catalyst.shop.buyFail');
    expect(buyRejectKey('nothing-to-buy')).toBe('catalyst.shop.buyFail');
  });

  it('구매 거부 문구가 분해 문구로 새지 않는다 — 실제 문자열까지 대조', () => {
    // 실재한 결함: 기본 분기가 `catalyst.manage.salvageFail` 이라, 구매를 누른 플레이어에게
    // "분해 실패"가 떴다. 키 비교만으로는 다시 새기 쉬우므로 **렌더될 문자열**을 대조한다.
    // 하네스 인메모리 모의 게이트웨이는 이 note 들을 내지 않아 화면 검증이 이걸 통과시켰다.
    const salvageWording = new Set([CATALOG.ko['catalyst.manage.salvageFail'], CATALOG.en['catalyst.manage.salvageFail']]);
    for (const note of [undefined, 'who-knows', 'unknown-catalyst', 'nothing-to-buy',
      'no-profile', 'signature-not-sold', 'price-unset', 'insufficient-residue']) {
      for (const loc of ['ko', 'en'] as const) {
        const text = CATALOG[loc][buyRejectKey(note)];
        expect(text, `note=${String(note)} loc=${loc} 의 구매 안내가 비어 있다`).toBeTruthy();
        expect(salvageWording.has(text), `note=${String(note)} loc=${loc}: 구매 거부에 분해 문구가 떴다`).toBe(false);
      }
    }
  });

  it('분해도 no-profile 만 별도 안내다', () => {
    expect(salvageRejectKey('no-profile')).toBe('catalyst.shop.noProfile');
    expect(salvageRejectKey('not-owned')).toBe('catalyst.manage.salvageFail');
    expect(salvageRejectKey(undefined)).toBe('catalyst.manage.salvageFail');
  });
});

// ---------------------------------------------------------------------------
// 하네스 육안 회귀 2건(2026-07-31)
// ---------------------------------------------------------------------------

describe('회귀 — [분해] 라벨이 실제 분해 수량을 반영한다', () => {
  it('스테퍼가 3이면 라벨 수량도 3이다 — 고정 "1" 이 아니다', () => {
    const s = state({ owned: 5, qty: 3 });
    expect(salvageLabelQty(s)).toBe(3);
    expect(salvageQty(s)).toBe(3);
    // 라벨과 행동이 갈리면(되돌릴 수 없는 조작) 오조작이 난다 — 같은 수를 쓴다.
    expect(salvageLabel(s)).toContain('3');
    expect(salvageLabel(s)).not.toBe(salvageLabel(state({ owned: 5, qty: 1 })));
  });

  it('보유보다 많이 지정하면 라벨도 실제 분해될 수(보유)로 깎인다', () => {
    const s = state({ owned: 2, qty: 7 });
    expect(salvageLabelQty(s)).toBe(2);
    expect(salvageLabelQty(s)).toBe(salvageQty(s));
    expect(salvageLabel(s)).toContain('2');
  });

  it('문구가 수량 파라미터를 실제로 치환한다 — 미치환이면 `{n}` 이 그대로 남는다', () => {
    expect(salvageLabel(state({ owned: 1, qty: 1 }))).not.toContain('{n}');
  });
});

describe('회귀 — 설명(2줄)과 하단 문구(2줄)가 겹치지 않는다', () => {
  it('상한이 설명 실측 바닥에서 파생된다 — 두 상수가 서로를 모르면 안 된다', () => {
    // 옛 코드는 NOTE_MIN_Y 를 94 로 **직접 박아** 뒀는데 설명 2줄 실측 바닥은 96 이라 2px 겹쳤다.
    expect(INFO_BOTTOM).toBe(INFO_Y + INFO_LINE_H * INFO_MAX_LINES + TEXT_MEASURE_SLACK);
    expect(NOTE_MIN_Y).toBe(INFO_BOTTOM + NOTE_GAP);
    expect(NOTE_MIN_Y).toBeGreaterThanOrEqual(INFO_BOTTOM);
    expect(94).toBeLessThan(INFO_BOTTOM); // 옛 값이 실제로 침범했다는 증인.
  });

  it('설명 2줄 + 문구 2줄이 동시에 최대여도 겹치지 않는다', () => {
    const box = noteLayout(NOTE_EXPECTED_H);
    expect(box.y).toBeGreaterThanOrEqual(INFO_BOTTOM);
    expect(box.y - INFO_BOTTOM).toBeGreaterThanOrEqual(NOTE_GAP);
    expect(box.y + NOTE_EXPECTED_H * box.scale).toBeLessThanOrEqual(ROW_H);
  });

  it('문구 2줄이 예산 안에 들어가 축소가 걸리지 않는다', () => {
    expect(NOTE_EXPECTED_H).toBe(NOTE_LINE_H * NOTE_MAX_LINES + TEXT_MEASURE_SLACK);
    expect(NOTE_EXPECTED_H).toBeLessThanOrEqual(NOTE_BUDGET);
    expect(noteLayout(NOTE_EXPECTED_H).scale).toBe(1);
  });
});

describe('회귀 — 하단 문구가 행 밖으로 넘치지 않는다', () => {
  const budget = NOTE_BUDGET;

  it('1줄이면 하단 정렬되고 설명 영역을 침범하지 않는다', () => {
    const box = noteLayout(19);
    expect(box.scale).toBe(1);
    expect(box.y + 19).toBeLessThanOrEqual(ROW_H);
    expect(box.y).toBeGreaterThanOrEqual(NOTE_MIN_Y);
  });

  it('2줄이어도 바닥을 넘지 않는다 — 고정 y=104 였다면 bottom 이 ROW_H 를 넘었다', () => {
    const h = NOTE_EXPECTED_H;
    const box = noteLayout(h);
    expect(box.scale).toBe(1);
    expect(box.y).toBe(ROW_H - NOTE_PAD_BOTTOM - h);
    expect(box.y + h).toBeLessThanOrEqual(ROW_H);
    expect(104 + 40).toBeGreaterThan(ROW_H); // 옛 고정 배치가 실제로 넘쳤다는 증인.
  });

  it('예산을 넘는 3줄 이상은 축소해 담는다(잘림 대신 축소)', () => {
    const h = 60;
    const box = noteLayout(h);
    expect(box.scale).toBeLessThan(1);
    expect(h * box.scale).toBeCloseTo(budget, 6);
    expect(box.y + h * box.scale).toBeLessThanOrEqual(ROW_H);
    expect(box.y).toBeGreaterThanOrEqual(NOTE_MIN_Y);
  });

  it('높이를 못 잰 경우(0·NaN)에도 산술이 던지지 않는다', () => {
    expect(() => noteLayout(0)).not.toThrow();
    expect(noteLayout(Number.NaN).scale).toBe(1);
  });

  it('어떤 높이든 bottom ≤ ROW_H · top ≥ NOTE_MIN_Y 불변식을 지킨다', () => {
    for (let h = 1; h <= 120; h += 1) {
      const box = noteLayout(h);
      expect(box.y + h * box.scale).toBeLessThanOrEqual(ROW_H + 1e-9);
      expect(box.y).toBeGreaterThanOrEqual(NOTE_MIN_Y - 1e-9);
    }
  });
});

describe('전수 — 48종 어느 행도 판정이 던지지 않는다', () => {
  it('공용은 전부 구매 가능 술어를 만족하고 특산은 전부 불가다', () => {
    for (const c of CATALYSTS) {
      const s = state({ id: c.id, owned: 1, qty: 2, residue: 1_000_000 });
      expect(buyEnabled(s)).toBe(c.kind === 'common');
      expect(salvageEnabled(s)).toBe(true);
      expect(buyCost(s)).toBe(catalystBuyPrice(c.id) * 2);
    }
  });
});
