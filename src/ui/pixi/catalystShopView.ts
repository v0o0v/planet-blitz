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

/** 스테퍼 값 정규화 — 정수·[QTY_MIN, QTY_MAX] 클램프. */
export function clampQty(qty: number): number {
  if (!Number.isFinite(qty)) return QTY_MIN;
  return Math.min(QTY_MAX, Math.max(QTY_MIN, Math.floor(qty)));
}

/** 이 행에서 실제로 분해될 수량 — 보유를 넘지 않는다(초과 지정은 서버가 거부하므로 미리 깎는다). */
export function salvageQty(s: CatalystRowShopState): number {
  return Math.min(clampQty(s.qty), Math.max(0, Math.floor(s.owned)));
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
