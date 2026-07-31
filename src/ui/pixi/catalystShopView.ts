/**
 * 촉매 상점 행의 **순수 표시 판정**(ADR-0042 · catalyst-shop-residue lane).
 *
 * 이 모듈은 Pixi 를 전혀 import 하지 않는다 — 캔버스 없는 vitest 에서 `Text.width` 가 던지는
 * 함정을 피하려면 "버튼을 켤 것인가·무엇을 사유로 띄울 것인가·얼마인가"가 렌더 밖에 있어야
 * 한다(`tests/catalystShopView.test.ts`). 화면(`catalystArchive.ts`)은 여기서 나온 판정을
 * 그대로 그리기만 한다.
 *
 * 가격 정본은 `src/data/catalysts.ts` 이고 서버는 시드된 `catalyst_defs.buy_price` 를 조회한다 —
 * 클라는 가격을 **보내지 않는다**(위조 표면). 여기 수치는 표시·선제 비활성 판정용이다.
 */

import { t, type MessageKey } from '../../i18n/index.js';
import { catalystBuyPrice, catalystSalvageValue, catalystIsPurchasable } from '../../data/catalysts.js';

/** 수량 스테퍼 하한(항상 1 이상 — 0개 분해/구매는 서버가 `nothing-to-buy` 로 거부한다). */
export const QTY_MIN = 1;
/** 수량 스테퍼 상한. 잔재 잔고가 실질 상한이므로 UI 편의상의 값이다(서버 캡 아님). */
export const QTY_MAX = 99;

/** 한 행의 상점 상태 — 렌더가 아는 전부. */
export interface CatalystRowShopState {
  /** 촉매 id(가격·판매 가능성 파생 키). */
  id: number;
  /** 보유 수량(0 이면 분해 불가). */
  owned: number;
  /** 스테퍼가 지정한 수량(분해·구매 공용). */
  qty: number;
  /** 촉매 잔재 잔고. 아직 못 읽었으면 null(= `noProfile` 안내 대상). */
  residue: number | null;
  /** 서버 왕복이 가능한 세션인가(미설정/오프라인이면 false). */
  online: boolean;
}

// --- 행 예산(계획 §5 확정 수치 — 임의 변경 금지) -----------------------------

/** 행 높이. 우측 컨트롤이 세로 2단이 되면서 108 → 136 으로 확정됐다. */
export const ROW_H = 136;
/** 우측 컨트롤 영역 폭의 단일 정본(버튼 폭·설명 wordWrap 이 전부 여기서 파생). */
export const ROW_CTRL_W = 220;
/** 하단 문구가 침범해선 안 되는 상한 = 설명(info) 2줄이 끝나는 y. */
export const NOTE_MIN_Y = 94;
/** 하단 문구와 행 바닥 사이 여백. */
export const NOTE_PAD_BOTTOM = 2;

/**
 * 하단 문구의 배치(상단 y·축소 배율). **고정 y 를 쓰면 문구가 2줄이 되는 순간 행 밖으로
 * 넘친다** — 미보유 사유·잔재 부족 사유가 붙으면 실제로 그렇게 되고, 스테퍼가 `Text.text` 만
 * 갈아끼우므로 런타임에 발생한다. 그래서 **실측 높이를 받아 하단 정렬**하고, 예산(=
 * `ROW_H - NOTE_MIN_Y - NOTE_PAD_BOTTOM`)을 넘으면 그만큼 축소한다.
 *
 * 순수 산술이라 캔버스 없이 검증된다 — 호출부는 `Text.height` 만 넘긴다.
 */
export function noteLayout(noteHeight: number): { y: number; scale: number } {
  const budget = ROW_H - NOTE_MIN_Y - NOTE_PAD_BOTTOM;
  const h = Number.isFinite(noteHeight) && noteHeight > 0 ? noteHeight : 0;
  const scale = h > budget ? budget / h : 1;
  const drawn = h * scale;
  return { y: ROW_H - NOTE_PAD_BOTTOM - drawn, scale };
}

/** 스테퍼 값 정규화 — 정수·[QTY_MIN, QTY_MAX] 클램프. */
export function clampQty(qty: number): number {
  if (!Number.isFinite(qty)) return QTY_MIN;
  return Math.min(QTY_MAX, Math.max(QTY_MIN, Math.floor(qty)));
}

/** 이 행에서 실제로 분해될 수량 — 보유를 넘지 않는다(초과 지정은 서버가 거부하므로 미리 깎는다). */
export function salvageQty(s: CatalystRowShopState): number {
  return Math.min(clampQty(s.qty), Math.max(0, Math.floor(s.owned)));
}

/**
 * [분해] 라벨에 실을 수량 — **이번 클릭으로 실제 분해될 개수**다. 보유가 있으면 보유 상한으로
 * 깎은 값, 없으면(버튼은 비활성) 스테퍼 값. 라벨과 행동이 갈리면 되돌릴 수 없는 오조작이 난다.
 */
export function salvageLabelQty(s: CatalystRowShopState): number {
  const n = salvageQty(s);
  return n > 0 ? n : clampQty(s.qty);
}

/** [분해] 버튼 라벨. 수량을 반영한다(고정 "1개 분해" 금지). */
export function salvageLabel(s: CatalystRowShopState): string {
  return t('catalyst.manage.salvage', { n: salvageLabelQty(s) });
}

/** 분해로 얻을 촉매 잔재. **결합 순서가 계약이다** — `단가 × n` 이지 `floor(가격×비율×n/100)` 이 아니다. */
export function salvageGain(s: CatalystRowShopState): number {
  return catalystSalvageValue(s.id) * salvageQty(s);
}

/** 이 행을 지정 수량만큼 사는 데 드는 촉매 잔재. */
export function buyCost(s: CatalystRowShopState): number {
  return catalystBuyPrice(s.id) * clampQty(s.qty);
}

/** [분해] 활성 여부 — 온라인이고 1개 이상 보유해야 한다. */
export function salvageEnabled(s: CatalystRowShopState): boolean {
  return s.online && Math.floor(s.owned) > 0;
}

/**
 * [구매] 활성 여부 — 온라인 · 공용(특산 미판매) · 가격 설정됨 · 잔재 충분.
 * 잔재를 아직 못 읽었으면(null) 비활성이다 — 서버가 `no-profile` 로 거부할 상태이기 때문.
 */
export function buyEnabled(s: CatalystRowShopState): boolean {
  if (!s.online) return false;
  if (!catalystIsPurchasable(s.id)) return false;
  if (catalystBuyPrice(s.id) <= 0) return false;
  if (s.residue === null) return false;
  return s.residue >= buyCost(s);
}

/** [구매]가 꺼진 이유(활성이면 null). 우선순위: 오프라인 → 특산 → 가격 미설정 → 프로필 미로드 → 잔재 부족. */
export function buyBlockedKey(s: CatalystRowShopState): MessageKey | null {
  if (!s.online) return 'catalyst.shop.offline';
  if (!catalystIsPurchasable(s.id)) return 'catalyst.shop.signatureNotSold';
  if (catalystBuyPrice(s.id) <= 0) return 'catalyst.shop.priceUnset';
  if (s.residue === null) return 'catalyst.shop.noProfile';
  if (s.residue < buyCost(s)) return 'catalyst.shop.insufficientResidue';
  return null;
}

/** [분해]가 꺼진 이유(활성이면 null). 미보유는 "보유 없음" 문구로 사유를 드러낸다. */
export function salvageBlockedKey(s: CatalystRowShopState): MessageKey | null {
  if (!s.online) return 'catalyst.shop.offline';
  if (Math.floor(s.owned) <= 0) return 'catalyst.manage.empty';
  return null;
}

/**
 * 행 하단 한 줄에 실을 문구 조각들(순서 고정). 오프라인이면 오프라인 안내 하나로 접는다 —
 * 나머지 사유가 전부 오프라인의 파생이라 나열하면 소음이 된다.
 */
export function rowNoteParts(s: CatalystRowShopState): string[] {
  if (!s.online) return [t('catalyst.shop.offline')];
  const parts: string[] = [];
  if (salvageEnabled(s)) parts.push(t('catalyst.salvage.gained', { n: salvageGain(s) }));
  else parts.push(t('catalyst.manage.empty'));
  if (catalystIsPurchasable(s.id) && catalystBuyPrice(s.id) > 0) {
    parts.push(t('catalyst.shop.price', { n: buyCost(s) }));
  }
  const blocked = buyBlockedKey(s);
  if (blocked !== null) parts.push(t(blocked));
  return parts;
}

/** 행 하단 한 줄 최종 문구. */
export function rowNoteText(s: CatalystRowShopState): string {
  return rowNoteParts(s).join('  ·  ');
}

/**
 * 서버 거부 `note` → 안내 문구 키. 미지 사유는 일반 실패로 접는다(원인 불명 무반응 금지 —
 * 특히 `no-profile` 은 신규 가입 직후 창에서 실재한다).
 */
export function buyRejectKey(note: string | undefined): MessageKey {
  switch (note) {
    case 'no-profile':
      return 'catalyst.shop.noProfile';
    case 'signature-not-sold':
      return 'catalyst.shop.signatureNotSold';
    case 'price-unset':
      return 'catalyst.shop.priceUnset';
    case 'insufficient-residue':
      return 'catalyst.shop.insufficientResidue';
    default:
      return 'catalyst.manage.salvageFail';
  }
}

/** 분해 거부 `note` → 안내 문구 키. `no-profile` 만 별도 안내, 나머지는 분해 실패. */
export function salvageRejectKey(note: string | undefined): MessageKey {
  return note === 'no-profile' ? 'catalyst.shop.noProfile' : 'catalyst.manage.salvageFail';
}
