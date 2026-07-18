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
} from './cards.js';

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
    if (error !== null) throw error;
    const r = asRecord(data);
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
    if (error !== null) throw error;
    const r = asRecord(data);
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
}
