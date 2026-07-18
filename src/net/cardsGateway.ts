/**
 * 방어 카드 경제 게이트웨이의 실 Supabase 구현 (M6 — cards EF · salvage_card RPC).
 *
 * `cards.ts` 의 {@link CardsGateway} 를 `@supabase/supabase-js` 로 구현한다. 이 파일만 SDK 를
 * 정적 import 하며, `cards.ts` 는 설정이 있을 때만 이 모듈을 동적 import 한다 → 미설정 번들/테스트에
 * SDK 가 실리지 않는다(invasionGateway.ts 와 동일 패턴). 익명 Auth 세션(ADR-0002)을 공유한다.
 *
 * 구매·합성은 cards Edge Function(service_role 원자 트랜잭션)이 권위다 — 크레딧 차감·20장 상한·
 * 소유/중복 검증은 서버가 강제하고, 클라는 결과만 표시한다. 분해(salvage_card)는 롤러 무관이라
 * 기존 SQL RPC 를 직접 호출한다(20260718160000).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from './config.js';
import type {
  CardsGateway,
  CardBuyResult,
  CardFuseResult,
  CardSalvageResult,
  CardOwned,
  CardEquipState,
} from './cards.js';
import type { CardInstance } from '../../data/defenseCards.js';

/** RPC/EF 응답 raw → Record 안전 변환. */
function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}
function asStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function asNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
/** 값이 정의된 경우만 { key: value } 를, 아니면 빈 객체를(exactOptionalPropertyTypes 대응 스프레드). */
function defined<K extends string, V>(key: K, value: V | undefined): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/**
 * cards EF 는 비즈니스 거부(크레딧 부족·만석·중복 등)를 **4xx + `{ok:false, code}` body** 로
 * 돌려준다. 그런데 supabase-js `functions.invoke` 는 non-2xx 를 error(FunctionsHttpError)로 취급해
 * data=null 을 준다 → 그대로 throw 하면 `code` 가 유실되고 UI 가 일반 실패 메시지만 띄운다. 이
 * 헬퍼는 FunctionsHttpError 가 실어 주는 Response(`.context`)의 JSON body 를 회수해 결과로 매핑할
 * 수 있게 한다. body 를 못 읽으면(진짜 네트워크/릴레이 오류) null → 호출부가 throw.
 */
async function invokeErrorBody(error: unknown): Promise<Record<string, unknown> | null> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx instanceof Response) {
    try {
      return asRecord(await ctx.clone().json());
    } catch {
      return null;
    }
  }
  return null;
}

export class SupabaseCardsGateway implements CardsGateway {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseConfig) {
    this.client = createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }

  async getUserId(): Promise<string> {
    const { data: sessionData } = await this.client.auth.getSession();
    const existing = sessionData.session?.user?.id;
    if (existing !== undefined) return existing;
    const { data, error } = await this.client.auth.signInAnonymously();
    if (error !== null) throw error;
    const uid = data.user?.id;
    if (uid === undefined) throw new Error('익명 로그인 후에도 uid 를 얻지 못했습니다');
    return uid;
  }

  async buyShopCard(slotIndex: number): Promise<CardBuyResult> {
    // cards EF: dateSeed 는 서버가 UTC 로 계산(클라 신뢰 금지), slotIndex 만 넘긴다.
    const { data, error } = await this.client.functions.invoke('cards', {
      body: { action: 'buy', slotIndex },
    });
    // 4xx 비즈니스 거부는 body 의 code 를 살려 결과로 매핑(throw 하면 UI 가 사유를 못 보여준다).
    let r: Record<string, unknown>;
    if (error !== null) {
      const body = await invokeErrorBody(error);
      if (body === null) throw error;
      r = body;
    } else {
      r = asRecord(data);
    }
    // exactOptionalPropertyTypes: undefined 필드는 대입 대신 조건부 스프레드로 생략한다.
    return {
      ok: r.ok === true,
      ...defined('cardId', asStr(r.cardId)),
      ...defined('rarity', asStr(r.rarity)),
      ...defined('credits', asNum(r.credits)),
      ...defined('price', asNum(r.price)),
      ...defined('code', asStr(r.code)),
    };
  }

  async fuseCards(cardIds: readonly [string, string, string]): Promise<CardFuseResult> {
    const { data, error } = await this.client.functions.invoke('cards', {
      body: { action: 'fuse', cardIds },
    });
    // 구매와 동일 — 4xx 합성 거부(미소유·등급 불일치 등)는 body 의 code 를 살려 결과로 매핑.
    let r: Record<string, unknown>;
    if (error !== null) {
      const body = await invokeErrorBody(error);
      if (body === null) throw error;
      r = body;
    } else {
      r = asRecord(data);
    }
    return {
      ok: r.ok === true,
      promoted: r.promoted === true,
      ...defined('cardId', asStr(r.cardId)),
      ...defined('rarity', asStr(r.rarity)),
      ...defined('code', asStr(r.code)),
    };
  }

  async salvageCard(cardId: string): Promise<CardSalvageResult> {
    // 분해는 롤러 무관 → 기존 SQL RPC 직접 호출. 반환 { ok, salvaged, credits, rarity } 또는
    // { ok:false, note:'not-owned' }. 환급 후 서버 save.credits 가 진실(호출부가 profileSync pull).
    const { data, error } = await this.client.rpc('salvage_card', { p_card_id: cardId });
    if (error !== null) throw error;
    const r = asRecord(data);
    return {
      ok: r.ok === true,
      ...defined('salvaged', asNum(r.salvaged)),
      ...defined('credits', asNum(r.credits)),
      ...defined('rarity', asStr(r.rarity)),
      ...defined('note', asStr(r.note)),
    };
  }

  async listInventory(): Promise<CardOwned[]> {
    // 보관함 직접 조회(RLS defense_cards_select_own 이 본인 행만 반환). 최신순 정렬.
    const { data, error } = await this.client
      .from('defense_cards')
      .select('id, rarity, charges_left, card')
      .order('created_at', { ascending: false });
    if (error !== null) throw error;
    const rows = Array.isArray(data) ? data : [];
    const out: CardOwned[] = [];
    for (const raw of rows) {
      const r = asRecord(raw);
      const id = asStr(r.id);
      const rarity = asStr(r.rarity);
      const chargesLeft = asNum(r.charges_left);
      if (id === undefined || rarity === undefined || chargesLeft === undefined) continue;
      out.push({ id, rarity, chargesLeft, card: r.card as CardInstance });
    }
    return out;
  }

  async fetchEquip(): Promise<CardEquipState> {
    // 내 활성 방어 행(RLS defenses_rw_own). 없으면 defenseId=null(방어 미배치).
    const { data, error } = await this.client
      .from('defenses')
      .select('id, equipped_card_id')
      .eq('active', true)
      .maybeSingle();
    if (error !== null) throw error;
    const r = asRecord(data);
    return {
      defenseId: asStr(r.id) ?? null,
      equippedCardId: asStr(r.equipped_card_id) ?? null,
    };
  }

  async setEquippedCard(defenseId: string, cardId: string | null): Promise<void> {
    // 장착 변경(클라 직접 컬럼 update). guard_defenses_equipped_card 트리거가 자기 소유 카드만
    // 통과시킨다(아니면 raise → 여기서 throw 로 흡수). maintenance/budget 봉인은 무영향.
    const { error } = await this.client
      .from('defenses')
      .update({ equipped_card_id: cardId })
      .eq('id', defenseId);
    if (error !== null) throw error;
  }

  async listShopPurchases(dateSeed: number): Promise<number[]> {
    // 오늘 이미 구매한 슬롯(RLS card_shop_purchases select-own). 표시 슬롯 비활성용.
    const { data, error } = await this.client
      .from('card_shop_purchases')
      .select('slot_index')
      .eq('date_seed', dateSeed);
    if (error !== null) throw error;
    const rows = Array.isArray(data) ? data : [];
    const out: number[] = [];
    for (const raw of rows) {
      const n = asNum(asRecord(raw).slot_index);
      if (n !== undefined) out.push(n);
    }
    return out;
  }
}
