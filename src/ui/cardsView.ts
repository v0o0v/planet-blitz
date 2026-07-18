/**
 * 방어 카드 표시 헬퍼 (M6 Lane D) — 순수 함수 · DOM 무관 · vitest 대상.
 *
 * 방어 사령부 카드 탭(슬롯·보관함·상점·합성)이 쓰는 표시 로직을 순수 함수로 분리한다
 * (controlTower 의 순수 표시 로직 패턴과 동일). 등급 색·어픽스 요약·잔여 경고·보관 게이지·
 * 합성 선택 사전 검증을 담고, 실제 DOM 조립은 `defenseCommand.ts` 가 한다.
 *
 * ── 콘텐츠명 정책(i18n 캐리포워드) ── 카드 어픽스명·유니크명은 데이터 카탈로그
 * (`data/defenseCards.ts`)의 `name` 필드를 그대로 쓴다. 보스명·행성명 등 sim/data 소유
 * 콘텐츠명과 동일하게 로케일 확장 대상 밖이라, EN·KO 양쪽에서 카탈로그 표기(한글)로 노출된다.
 * 등급 라벨·UI 크롬만 i18n(`t`) 경유다.
 *
 * ── 서버 권위 ── 이 모듈은 표시만 한다. 구매·합성·분해·장착의 실제 검증·차감은 서버(cards EF·
 * salvage_card RPC·guard 트리거)가 강제하고, 여기 합성 사전 검증은 UX 보조(서버가 최종 판정).
 */

import {
  CARD_AFFIX_BY_ID,
  DEFENSE_CARD_UNIQUE_BY_ID,
  CARD_STORAGE_CAP,
  FUSION_INPUT_COUNT,
  cardBuyPrice,
  type CardInstance,
} from '../../data/defenseCards.js';
import type { Rarity } from '../items/types.js';
import type { CardOwned } from '../net/cards.js';
import { t, type MessageKey } from '../i18n/index.js';

/** 등급 → 표시 색(resultOverlay/inventory 팔레트와 동일). 미지 등급은 normal 색. */
export const CARD_RARITY_COLOR: Record<string, string> = {
  normal: '#b8c2d8',
  magic: '#6aa0ff',
  rare: '#ffd24c',
  unique: '#ff8a3c',
};

/** 등급 문자열 → 표시 색(미지 등급 방어). */
export function cardRarityColor(rarity: string): string {
  return CARD_RARITY_COLOR[rarity] ?? CARD_RARITY_COLOR.normal!;
}

/** 등급 문자열 → i18n 라벨 키(item.rarity.* 재사용). 미지 등급은 normal. */
function rarityKey(rarity: string): MessageKey {
  switch (rarity) {
    case 'magic':
      return 'item.rarity.magic';
    case 'rare':
      return 'item.rarity.rare';
    case 'unique':
      return 'item.rarity.unique';
    default:
      return 'item.rarity.normal';
  }
}

/** 등급 라벨(현재 로케일). */
export function cardRarityLabel(rarity: string): string {
  return t(rarityKey(rarity));
}

/** 카드 어픽스 1건 표시(카탈로그 name + 롤 값). 미지 id 는 id 자체 폴백. */
function affixLine(id: string, value: number): string {
  const def = CARD_AFFIX_BY_ID.get(id);
  const name = def !== undefined ? def.name : id;
  return t('card.affixLine', { name, value });
}

/**
 * 카드의 어픽스 요약(접두·접미 별도 목록 + 유니크명). 보관함·슬롯 표시에 쓴다. normal 카드는
 * 어픽스가 없어 두 목록 모두 비고 unique 도 null 이다(기저 효과만).
 */
export function cardAffixSummary(card: CardInstance): {
  prefixes: string[];
  suffixes: string[];
  unique: string | null;
} {
  const prefixes = card.prefixes.map((a) => affixLine(a.id, a.value));
  const suffixes = card.suffixes.map((a) => affixLine(a.id, a.value));
  const unique =
    card.uniqueId !== undefined ? (DEFENSE_CARD_UNIQUE_BY_ID.get(card.uniqueId)?.name ?? card.uniqueId) : null;
  return { prefixes, suffixes, unique };
}

/** 어픽스 요약을 한 줄로(툴팁·좁은 표시). 유니크 먼저, 접두·접미 순. 비면 기저 안내. */
export function cardAffixOneLine(card: CardInstance): string {
  const s = cardAffixSummary(card);
  const parts: string[] = [];
  if (s.unique !== null) parts.push(s.unique);
  parts.push(...s.prefixes, ...s.suffixes);
  return parts.length > 0 ? parts.join(' · ') : t('card.baseOnly');
}

/** 잔여 1회 경고 대상 여부(스펙 AC: 잔여 1회 카드에 경고). */
export function isLowCharge(chargesLeft: number): boolean {
  return chargesLeft === 1;
}

/** 사용 소진(0회) 여부 — 슬롯에서 빈 슬롯 안내 대상. */
export function isDepleted(chargesLeft: number): boolean {
  return chargesLeft <= 0;
}

/** 보관 게이지 상태(현재/상한/백분율/만석). count/cap 방어적 클램프. */
export interface StorageGauge {
  count: number;
  cap: number;
  /** 0~100 정수 백분율. */
  pct: number;
  /** 상한 도달(신규 획득·합성 결과 차단). */
  full: boolean;
}

/** 보관 게이지 계산(순수). cap 기본은 CARD_STORAGE_CAP(20). */
export function storageGauge(count: number, cap: number = CARD_STORAGE_CAP): StorageGauge {
  const c = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  const capN = Number.isFinite(cap) && cap > 0 ? Math.trunc(cap) : CARD_STORAGE_CAP;
  const pct = Math.max(0, Math.min(100, Math.round((c / capN) * 100)));
  return { count: c, cap: capN, pct, full: c >= capN };
}

/** 합성 선택 사전 검증 코드(서버 cards EF 코드와 정합 — need-three/dup-ids/rarity-mismatch). */
export type FusionCheckCode = 'ok' | 'need-three' | 'dup-ids' | 'rarity-mismatch';

/** 합성 선택 상태(순수). 서버 fuseCards 호출 전 UX 사전 검증. */
export interface FusionCheck {
  ok: boolean;
  code: FusionCheckCode;
}

/**
 * 합성 선택을 사전 검증한다(순수). 서버가 최종 강제하지만, 버튼 활성/안내를 즉시 주기 위해
 * 클라가 미리 본다. 규칙(EF 계약 정합): 정확히 3장 · 중복 행 id 없음 · 전부 동급.
 */
export function checkFusionSelection(selected: readonly CardOwned[]): FusionCheck {
  if (selected.length !== FUSION_INPUT_COUNT) return { ok: false, code: 'need-three' };
  const ids = new Set(selected.map((c) => c.id));
  if (ids.size !== selected.length) return { ok: false, code: 'dup-ids' };
  const first = selected[0]!.rarity;
  if (!selected.every((c) => c.rarity === first)) return { ok: false, code: 'rarity-mismatch' };
  return { ok: true, code: 'ok' };
}

/** 합성 검증 코드 → 안내 문구(현재 로케일). ok 는 빈 문자열. */
export function fusionCheckText(code: FusionCheckCode): string {
  switch (code) {
    case 'need-three':
      return t('card.fuse.needThree');
    case 'dup-ids':
      return t('card.fuse.dupIds');
    case 'rarity-mismatch':
      return t('card.fuse.rarityMismatch');
    case 'ok':
      return '';
  }
}

/** 구매 실패 코드 → 안내 문구(현재 로케일). 미지 코드는 일반 오류. */
export function buyErrorText(code: string | undefined): string {
  switch (code) {
    case 'storage-full':
      return t('card.buy.storageFull');
    case 'insufficient-credits':
      return t('card.buy.insufficient');
    case 'already-bought':
      return t('card.buy.alreadyBought');
    case 'bad-slot':
      return t('card.buy.badSlot');
    case 'no-profile':
      return t('card.buy.noProfile');
    default:
      return t('card.buy.failed');
  }
}

/** 상점 슬롯 표시 가격(등급 기반, 서버 cardBuyPrice 와 동일). */
export function shopSlotPrice(rarity: Rarity): number {
  return cardBuyPrice(rarity);
}
