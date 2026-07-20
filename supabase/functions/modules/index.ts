/**
 * modules Edge Function 진입점 (M7b 코어 모듈 경제 · Deno.serve 래퍼).
 *
 * 구 `cards` EF 계승(구 경로는 이 레인의 마이그레이션에서 DB 객체와 함께 폐기된다 — 테이블
 * rename 이 아니라 **신규 테이블 + 구 경로 폐기**다. EF 는 이름에 결속돼 있어 rename 이 불가능).
 *
 * 순수 계획 로직은 `modulesCore.ts`(플랫폼 전역 무참조 — 상점 재현·가격·합성 검증)에 있고, 이
 * 파일은 HTTP·Auth·DB I/O·원자 적용 RPC 호출만 맡는다. 공유 TS 롤러를 그대로 실행하므로 모듈
 * 생성이 클라·서버 바이트 동일하다(ADR-0005).
 *
 * 계약:
 *   요청:  POST { action: 'buy', slotIndex: number }
 *          POST { action: 'fuse', moduleIds: [string,string,string] }
 *   응답:  buy  → { ok, moduleId?, rarity?, credits?, price?, code? }
 *          fuse → { ok, moduleId?, rarity?, promoted?, code? }
 *
 * 서버 권위(원칙2):
 *   - dateSeed 는 클라 입력을 신뢰하지 않고 서버 UTC 날짜(shopDateSeedFromMs)로 계산한다.
 *   - 크레딧 차감·보관함 상한·소유/잔존 검증·중복 구매 차단은 전부 service_role 원자 RPC
 *     (apply_module_purchase·apply_module_fusion)의 단일 SQL 트랜잭션이 강제한다.
 *
 * **방어 성공 드랍 경로는 없다** — 코어 모듈 드랍이 폐지되고 크레딧 정액만 남았으며, 그 지급은
 * apply_invasion_result(SQL)가 직접 한다(ADR-0018, 기획 §4).
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { planModuleShopPurchase, validateModuleFusion, planModuleFusion } from './modulesCore.ts';
import { shopDateSeedFromMs, shopUserSeed } from '../../../data/coreModules.ts';
import type { Rarity } from '../../../src/items/types.ts';

/**
 * CORS 헤더 — modules 는 브라우저 클라(방어 사령부 코어 모듈 UI)가 직접 호출하는 EF 라 반드시
 * 필요하다. 없으면 브라우저가 프리플라이트(OPTIONS)를 차단해 supabase-js 가 "Failed to fetch"
 * 로 즉시 실패한다. Authorization 을 헤더로 싣고 credentials 를 include 하지 않으므로 '*' 로 충분.
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

/** 암호학적 난수 u32(합성 롤 시드용 — 합성은 결정론 불요, 결과 모듈이 자기 시드로 재현되면 족함). */
function cryptoU32(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] >>> 0;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS 프리플라이트.
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

  let payload: { action?: unknown; slotIndex?: unknown; moduleIds?: unknown };
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

  // (1) 호출자 식별: 요청 JWT → 본인 uid.
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
    const planned = planModuleShopPurchase(dateSeed, userSeed, slotIndex);
    if (!planned.ok) return json({ ok: false, code: planned.code }, 400);
    const { module: mod, rarity, price } = planned.plan;

    const { data: applied, error: applyErr } = await service.rpc('apply_module_purchase', {
      p_profile_id: callerId,
      p_date_seed: dateSeed,
      p_slot_index: slotIndex,
      p_module: mod,
      p_rarity: rarity,
      p_charges_left: mod.chargesLeft,
      p_price: price,
    });
    if (applyErr !== null) {
      return json({ ok: false, code: 'apply-failed', detail: applyErr.message }, 500);
    }
    const res = (applied ?? {}) as {
      ok?: boolean;
      code?: string;
      module_id?: string;
      credits?: number;
    };
    if (res.ok !== true) {
      // storage-full·insufficient-credits·already-bought → 409(비즈니스 거부).
      return json({ ok: false, code: res.code ?? 'purchase-rejected', credits: res.credits }, 409);
    }
    return json({ ok: true, moduleId: res.module_id, rarity, credits: res.credits, price }, 200);
  }

  // ---- fuse: 동급 3개 합성 -------------------------------------------------
  if (action === 'fuse') {
    const moduleIds = payload.moduleIds;
    if (!Array.isArray(moduleIds) || moduleIds.some((v) => typeof v !== 'string')) {
      return json({ ok: false, code: 'need-three' }, 400);
    }
    // 소유·등급을 로드해 롤러 입력(공통 등급) 확정. 원자성은 RPC 가 행 잠금으로 재검증(TOCTOU
    // 안전 — 그 사이 모듈이 사라지면 RPC 가 not-owned 로 거부, 아무것도 소모/생성하지 않는다).
    const { data: rows, error: loadErr } = await service
      .from('core_modules')
      .select('id, rarity')
      .in('id', moduleIds as string[])
      .eq('profile_id', callerId);
    if (loadErr !== null) {
      return json({ ok: false, code: 'load-failed', detail: loadErr.message }, 500);
    }
    const owned = (Array.isArray(rows) ? rows : []).map((r) => {
      const rr = r as { id?: unknown; rarity?: unknown };
      return { id: String(rr.id), rarity: rr.rarity as Rarity };
    });
    if (owned.length !== (moduleIds as string[]).length) {
      return json({ ok: false, code: 'not-owned' }, 409);
    }
    const validation = validateModuleFusion(owned);
    if (!validation.ok) return json({ ok: false, code: validation.code }, 400);

    const plan = planModuleFusion(validation.rarity, cryptoU32());

    const { data: applied, error: applyErr } = await service.rpc('apply_module_fusion', {
      p_profile_id: callerId,
      p_module_ids: moduleIds as string[],
      p_result_module: plan.module,
      p_result_rarity: plan.rarity,
      p_result_charges: plan.module.chargesLeft,
    });
    if (applyErr !== null) {
      return json({ ok: false, code: 'apply-failed', detail: applyErr.message }, 500);
    }
    const res = (applied ?? {}) as { ok?: boolean; code?: string; module_id?: string };
    if (res.ok !== true) {
      return json({ ok: false, code: res.code ?? 'fusion-rejected' }, 409);
    }
    return json({ ok: true, moduleId: res.module_id, rarity: plan.rarity, promoted: plan.promoted }, 200);
  }

  return json({ ok: false, code: 'unknown-action' }, 400);
});
