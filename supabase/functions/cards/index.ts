/**
 * cards Edge Function 진입점 (M6 방어 카드 경제 · Deno.serve 래퍼).
 *
 * 방어 카드 구매·합성의 서버측 배선이다. 순수 계획 로직은 `cardsCore.ts`(플랫폼 전역 무참조 —
 * 상점 재현·가격·합성 검증·드랍 판정)에 있고, 이 파일은 HTTP·Auth·DB I/O·원자 적용 RPC 호출만
 * 맡는다. 방어 성공 드랍은 verify-invasion EF 가 확정 직후 수행한다(카드 미장착 방어도 보상 —
 * 이 EF 밖). 공유 TS 롤러를 그대로 실행하므로 카드 생성이 클라·서버 바이트 동일하다(ADR-0005).
 *
 * 계약(핸드오프 lane-c2-cards-ef.md §Lane D):
 *   요청:  POST { action: 'buy', slotIndex: number }              (verify_jwt — 유저 본인)
 *          POST { action: 'fuse', cardIds: [string,string,string] }
 *   응답:  buy  → { ok, cardId?, rarity?, credits?, code? }
 *          fuse → { ok, cardId?, rarity?, promoted?, code? }
 *
 * 서버 권위(원칙2):
 *   - dateSeed 는 클라 입력을 신뢰하지 않고 서버 UTC 날짜(shopDateSeedFromMs)로 계산한다.
 *   - 크레딧 차감·보관함 20장 상한·소유/잔존 검증·중복 구매 차단은 전부 service_role 원자 RPC
 *     (apply_card_purchase·apply_card_fusion)의 단일 SQL 트랜잭션이 강제한다. 이 EF 는 롤 결과를
 *     확정해 넘길 뿐, 검증·차감을 클라 신뢰로 대신하지 않는다.
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { planShopPurchase, validateFusion, planFusion } from './cardsCore.ts';
import { shopDateSeedFromMs, shopUserSeed } from '../../../data/defenseCards.ts';
import type { Rarity } from '../../../src/items/types.ts';

/**
 * CORS 헤더 — cards 는 브라우저 클라(방어 사령부 카드 UI)가 직접 호출하는 유일한 EF 라 반드시
 * 필요하다(다른 EF: verify-invasion/-pve-sample 은 서버·cron 호출이라 불요). 없으면 브라우저가
 * 프리플라이트(OPTIONS)를 차단해 supabase-js 가 "Failed to fetch" 로 즉시 실패한다. Authorization
 * 을 쿠키가 아닌 헤더로 싣고 credentials 를 include 하지 않으므로 Allow-Origin '*' 로 충분하다.
 */
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

/** 암호학적 난수 u32(합성·롤 시드용 — 드랍/합성은 결정론 불요, 결과 카드가 자기 시드로 재현되면 족함). */
function cryptoU32(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] >>> 0;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS 프리플라이트: 브라우저가 실제 POST 전에 보내는 OPTIONS 에 허용 헤더로 응답한다.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, code: 'method-not-allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (authHeader === null) {
    return json({ ok: false, code: 'missing-authorization' }, 401);
  }

  let payload: { action?: unknown; slotIndex?: unknown; cardIds?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, code: 'invalid-json' }, 400);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (url === undefined || anonKey === undefined || serviceKey === undefined) {
    return json({ ok: false, code: 'server-misconfigured' }, 500);
  }

  // (1) 호출자 식별: 요청 JWT → 본인 uid(유저 호출 EF, verify-invasion 과 동일 패턴).
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr !== null || userData.user === null) {
    return json({ ok: false, code: 'unauthenticated' }, 401);
  }
  const callerId = userData.user.id;

  // (2) service_role 클라이언트로 원자 RPC 호출(RLS 우회, SQL 트랜잭션이 검증·차감 강제).
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });

  const action = payload.action;

  // ---- buy: 상점 슬롯 구매 -------------------------------------------------
  if (action === 'buy') {
    const slotIndex = payload.slotIndex;
    if (typeof slotIndex !== 'number' || !Number.isInteger(slotIndex)) {
      return json({ ok: false, code: 'bad-slot' }, 400);
    }
    // dateSeed 는 서버 UTC 날짜로(클라 신뢰 금지), userSeed 는 프로필 기반 안정값.
    const dateSeed = shopDateSeedFromMs(Date.now());
    const userSeed = shopUserSeed(callerId);
    const planned = planShopPurchase(dateSeed, userSeed, slotIndex);
    if (!planned.ok) return json({ ok: false, code: planned.code }, 400);
    const { card, rarity, price } = planned.plan;

    const { data: applied, error: applyErr } = await service.rpc('apply_card_purchase', {
      p_profile_id: callerId,
      p_date_seed: dateSeed,
      p_slot_index: slotIndex,
      p_card: card,
      p_rarity: rarity,
      p_charges_left: card.chargesLeft,
      p_price: price,
    });
    if (applyErr !== null) {
      return json({ ok: false, code: 'apply-failed', detail: applyErr.message }, 500);
    }
    const res = (applied ?? {}) as {
      ok?: boolean;
      code?: string;
      card_id?: string;
      credits?: number;
    };
    if (res.ok !== true) {
      // storage-full·insufficient-credits·already-bought → 409(비즈니스 거부).
      return json({ ok: false, code: res.code ?? 'purchase-rejected', credits: res.credits }, 409);
    }
    return json({ ok: true, cardId: res.card_id, rarity, credits: res.credits, price }, 200);
  }

  // ---- fuse: 동급 3장 합성 -------------------------------------------------
  if (action === 'fuse') {
    const cardIds = payload.cardIds;
    if (!Array.isArray(cardIds) || cardIds.some((v) => typeof v !== 'string')) {
      return json({ ok: false, code: 'need-three' }, 400);
    }
    // 소유·등급을 로드해 롤러 입력(공통 등급) 확정. 원자성은 RPC 가 행 잠금으로 재검증(TOCTOU 안전 —
    // 그 사이 카드가 사라지면 RPC 가 not-owned 로 거부, 아무것도 소모/생성하지 않는다).
    const { data: rows, error: loadErr } = await service
      .from('defense_cards')
      .select('id, rarity')
      .in('id', cardIds as string[])
      .eq('profile_id', callerId);
    if (loadErr !== null) {
      return json({ ok: false, code: 'load-failed', detail: loadErr.message }, 500);
    }
    const owned = (Array.isArray(rows) ? rows : []).map((r) => {
      const rr = r as { id?: unknown; rarity?: unknown };
      return { id: String(rr.id), rarity: rr.rarity as Rarity };
    });
    // 입력 id 순서·개수 그대로 검증(중복·미소유는 validateFusion·RPC 가 잡는다).
    if (owned.length !== (cardIds as string[]).length) {
      return json({ ok: false, code: 'not-owned' }, 409);
    }
    const validation = validateFusion(owned);
    if (!validation.ok) return json({ ok: false, code: validation.code }, 400);

    const plan = planFusion(validation.rarity, cryptoU32());

    const { data: applied, error: applyErr } = await service.rpc('apply_card_fusion', {
      p_profile_id: callerId,
      p_card_ids: cardIds as string[],
      p_result_card: plan.card,
      p_result_rarity: plan.rarity,
      p_result_charges: plan.card.chargesLeft,
    });
    if (applyErr !== null) {
      return json({ ok: false, code: 'apply-failed', detail: applyErr.message }, 500);
    }
    const res = (applied ?? {}) as { ok?: boolean; code?: string; card_id?: string };
    if (res.ok !== true) {
      return json({ ok: false, code: res.code ?? 'fusion-rejected' }, 409);
    }
    return json({ ok: true, cardId: res.card_id, rarity: plan.rarity, promoted: plan.promoted }, 200);
  }

  return json({ ok: false, code: 'unknown-action' }, 400);
});
