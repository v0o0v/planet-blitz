/**
 * 방어 카드 경제 네트워크 계층 (M6 — 구매·합성·분해 + 상점 로테이션 표시).
 *
 * Lane D UI 가 호출하는 공개 진입점. 규율(기존 net 계층 invasion.ts/config.ts 와 동일):
 *  - Supabase 미설정(env 부재) 시 **완전 no-op** → 공개 함수는 `null` 을 돌려주고 SDK 를 로드하지
 *    않는다(테스트/오프라인 유지).
 *  - 공개 함수는 절대 throw 하지 않는다(오프라인/오류는 삼키고 `null`).
 *  - 실제 SDK 는 설정이 있을 때만 `cardsGateway.js` 를 동적 import 한다.
 *
 * 서버 권위: 구매·합성은 cards Edge Function(service_role 원자 트랜잭션)이 크레딧·20장 상한·소유/
 * 중복을 강제한다. 클라는 결과 코드만 표시한다. 분해는 salvage_card RPC(서버 환급). 구매/분해 후
 * save.credits 는 서버가 진실이므로 호출부가 profileSync 로 pull 해야 한다(repair_defense 와 동일).
 *
 * 상점 표시: 로테이션은 (dateSeed=UTC 날짜, userSeed=uid 파생 안정값)의 순수 함수라 서버 호출 없이
 * 클라가 rollShopRotation 으로 재현한다({@link rollCurrentShop}). slotIndex 는 이 재고 배열 인덱스로,
 * buyShopCard 에 그대로 넘긴다(EF 가 동일 시드로 재현·검증).
 */

import { readSupabaseConfig, type SupabaseConfig } from './config.js';
import { shopDateSeedFromMs, shopUserSeed } from '../../data/defenseCards.js';
import { rollShopRotation } from '../items/rollCard.js';
import type { CardInstance } from '../../data/defenseCards.js';

// ---------------------------------------------------------------------------
// 결과 계약 타입 (Lane D 표시용)
// ---------------------------------------------------------------------------

/** 구매 결과. ok=false 면 code 로 사유(bad-slot·storage-full·insufficient-credits·already-bought 등). */
export interface CardBuyResult {
  ok: boolean;
  cardId?: string;
  rarity?: string;
  /** 차감 후 서버 잔여 크레딧(성공 시). */
  credits?: number;
  /** 지불 가격(성공 시). */
  price?: number;
  code?: string;
}

/** 합성 결과. promoted=상위 등급 승급 여부. ok=false 면 code(need-three·not-owned·rarity-mismatch 등). */
export interface CardFuseResult {
  ok: boolean;
  cardId?: string;
  rarity?: string;
  promoted?: boolean;
  code?: string;
}

/** 분해 결과. ok=false 면 note='not-owned'. 성공 시 salvaged(환급액)·credits(환급 후 잔여). */
export interface CardSalvageResult {
  ok: boolean;
  salvaged?: number;
  credits?: number;
  rarity?: string;
  note?: string;
}

/**
 * 보관함 소유 카드 1건(defense_cards 행). `id` 는 **행 uuid**(장착·분해·합성에 넘기는 참조)로,
 * CardInstance.id(시드 파생 표시 id)와 다르다. 서버가 rarity·chargesLeft 를 정규 컬럼으로 두므로
 * 그 값을 신뢰하고(card jsonb 와 일치), card 는 어픽스 요약·표시에 쓴다.
 */
export interface CardOwned {
  /** defense_cards.id — 장착/분해/합성 참조용 행 uuid. */
  id: string;
  rarity: string;
  chargesLeft: number;
  /** 직렬화된 CardInstance(어픽스·유니크 표시용). */
  card: CardInstance;
}

/** 내 방어의 장착 상태(카드 슬롯 표시·장착 변경에 필요). */
export interface CardEquipState {
  /** 활성 방어 행 id(없으면 null — 방어 미배치). 장착 변경 update 대상. */
  defenseId: string | null;
  /** 현재 장착 카드의 defense_cards.id(미장착이면 null). */
  equippedCardId: string | null;
}

/** 게이트웨이 인터페이스(테스트에서 fake 주입). 실 구현은 cardsGateway.ts. */
export interface CardsGateway {
  getUserId(): Promise<string>;
  buyShopCard(slotIndex: number): Promise<CardBuyResult>;
  fuseCards(cardIds: readonly [string, string, string]): Promise<CardFuseResult>;
  salvageCard(cardId: string): Promise<CardSalvageResult>;
  /** 보관함 조회(defense_cards, RLS 본인). 실패 시 throw. */
  listInventory(): Promise<CardOwned[]>;
  /** 내 활성 방어의 장착 상태(defenses, RLS 본인). 실패 시 throw. */
  fetchEquip(): Promise<CardEquipState>;
  /** 장착 변경(defenses.equipped_card_id update — 소유권 트리거 검증). 실패 시 throw. */
  setEquippedCard(defenseId: string, cardId: string | null): Promise<void>;
  /** 오늘(dateSeed) 이미 구매한 상점 슬롯 인덱스 목록(card_shop_purchases, RLS 본인). 실패 시 throw. */
  listShopPurchases(dateSeed: number): Promise<number[]>;
}

/** 주입 가능한 의존성(테스트에서 gateway/config 대체). */
export interface CardsDeps {
  gateway?: CardsGateway;
  config?: SupabaseConfig | null;
}

// ---------------------------------------------------------------------------
// 게이트웨이 해석 (invasion.ts resolveGateway 와 동일 규율)
// ---------------------------------------------------------------------------

let cachedGateway: CardsGateway | null = null;
let cachedConfigKey: string | null = null;

async function resolveGateway(deps: CardsDeps): Promise<CardsGateway | null> {
  if (deps.gateway !== undefined) return deps.gateway;
  const config = deps.config !== undefined ? deps.config : readSupabaseConfig();
  if (config === null) return null;
  const key = config.url;
  if (cachedGateway !== null && cachedConfigKey === key) return cachedGateway;
  const { SupabaseCardsGateway } = await import('./cardsGateway.js');
  cachedGateway = new SupabaseCardsGateway(config);
  cachedConfigKey = key;
  return cachedGateway;
}

// ---------------------------------------------------------------------------
// 상점 로테이션 표시(순수 — 서버 호출 불요, EF 와 동일 시드로 재현)
// ---------------------------------------------------------------------------

/** (dateSeed, userSeed) 계산. nowMs 미지정 시 현재 시각(UTC 날짜 시드). */
export function computeShopSeeds(uid: string, nowMs: number = Date.now()): { dateSeed: number; userSeed: number } {
  return { dateSeed: shopDateSeedFromMs(nowMs), userSeed: shopUserSeed(uid) };
}

/**
 * 오늘의 상점 재고를 클라에서 재현한다(서버 호출 없음). 반환 배열 인덱스가 buyShopCard 의 slotIndex.
 * EF 가 동일 (dateSeed,userSeed,slotIndex)로 카드를 재현·검증하므로 표시=구매 대상이 일치한다.
 */
export function rollCurrentShop(uid: string, nowMs: number = Date.now()): CardInstance[] {
  const { dateSeed, userSeed } = computeShopSeeds(uid, nowMs);
  return rollShopRotation(dateSeed, userSeed);
}

// ---------------------------------------------------------------------------
// 공개 API (no-op 가드 · 절대 throw 안 함)
// ---------------------------------------------------------------------------

/**
 * 로그인 uid 를 받는다(상점 로테이션 재현·보관함 조회에 필요). 미설정/오프라인/오류면 `null`.
 */
export async function getCardsUserId(deps: CardsDeps = {}): Promise<string | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return null;
  try {
    return await gateway.getUserId();
  } catch {
    return null;
  }
}

/**
 * 상점 슬롯 구매. 미설정/오프라인/오류면 `null`(UI 안내). ok=false 는 서버 비즈니스 거부(잔액 부족·
 * 만석·중복 구매 등 — code 로 구분). 성공 후 save.credits 는 서버가 진실이라 호출부가 profileSync pull.
 */
export async function buyShopCard(slotIndex: number, deps: CardsDeps = {}): Promise<CardBuyResult | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return null;
  try {
    return await gateway.buyShopCard(slotIndex);
  } catch {
    return null;
  }
}

/**
 * 동급 3장 합성. 미설정/오프라인/오류면 `null`. ok=false 는 서버 거부(미소유·등급 불일치 등). 성공 시
 * 3장 소모·결과 1장 생성이 서버 원자 반영되므로 호출부가 보관함을 재조회한다.
 */
export async function fuseCards(
  cardIds: readonly [string, string, string],
  deps: CardsDeps = {},
): Promise<CardFuseResult | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return null;
  try {
    return await gateway.fuseCards(cardIds);
  } catch {
    return null;
  }
}

/**
 * 카드 분해 환급. 미설정/오프라인/오류면 `null`. ok=false(note='not-owned')는 서버 거부. 성공 후
 * save.credits 는 서버가 진실이라 호출부가 profileSync pull(repair_defense 와 동일).
 */
export async function salvageCard(cardId: string, deps: CardsDeps = {}): Promise<CardSalvageResult | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return null;
  try {
    return await gateway.salvageCard(cardId);
  } catch {
    return null;
  }
}

/**
 * 보관함(defense_cards) 조회. 미설정/오프라인/오류면 `null`(UI 는 오프라인 안내). 서버 RLS 로
 * 본인 카드만 반환된다. 반환 순서는 서버 정렬(최신순) — UI 는 그대로 표시한다.
 */
export async function listCardInventory(deps: CardsDeps = {}): Promise<CardOwned[] | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return null;
  try {
    return await gateway.listInventory();
  } catch {
    return null;
  }
}

/**
 * 내 활성 방어의 장착 상태 조회(카드 슬롯 표시·장착 변경 대상 defenseId 확보). 미설정/오프라인/
 * 오류면 `null`.
 */
export async function fetchCardEquip(deps: CardsDeps = {}): Promise<CardEquipState | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return null;
  try {
    return await gateway.fetchEquip();
  } catch {
    return null;
  }
}

/**
 * 카드 장착/해제(defenses.equipped_card_id update). cardId=null 은 해제. 자기 소유 카드만 서버
 * 트리거가 허용한다. 성공하면 true, 미설정/오프라인/거부/오류면 false(UI 안내). 서버 권위 —
 * 성공 후 호출부가 장착 상태를 재조회한다.
 */
export async function equipCard(
  defenseId: string,
  cardId: string | null,
  deps: CardsDeps = {},
): Promise<boolean> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return false;
  try {
    await gateway.setEquippedCard(defenseId, cardId);
    return true;
  } catch {
    return false;
  }
}

/**
 * 오늘(dateSeed) 이미 구매한 상점 슬롯 인덱스 목록. 미설정/오프라인/오류면 `null`. 표시 상점의
 * 해당 슬롯 버튼을 비활성(이미 구매)하는 데 쓴다. dateSeed 미지정 시 현재 UTC 날짜 시드.
 */
export async function listCardShopPurchases(
  dateSeed: number = shopDateSeedFromMs(Date.now()),
  deps: CardsDeps = {},
): Promise<number[] | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return null;
  try {
    return await gateway.listShopPurchases(dateSeed);
  } catch {
    return null;
  }
}
