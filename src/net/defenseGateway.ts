/**
 * 방어 업로드 게이트웨이의 실 Supabase 구현 (M4 Phase D — team-plan 계약).
 *
 * `defenseSync.ts` 의 {@link DefenseGateway} 를 `@supabase/supabase-js` 로 구현한다. 이
 * 파일만 SDK 를 정적 import 하며, `defenseSync.ts` 는 설정이 있을 때만 이 모듈을 동적
 * import 한다 → 미설정 번들/테스트에 SDK 가 실리지 않는다(gateway.ts·invasionGateway.ts
 * 와 동일 패턴).
 *
 * 익명 Auth(ADR-0002): 세션이 없으면 `signInAnonymously()`. profiles·invasion 게이트웨이와
 * 같은 익명 유저를 공유한다(persistSession=true → localStorage 세션 공유).
 *
 * RLS(마이그레이션 `20260717000000` / `..010000`):
 *  - `defenses_rw_own`(auth.uid()=profile_id) 로 본인 방어의 select/insert/update 가능.
 *  - 서버 가드 `guard_defenses_client_write` 가 INSERT/UPDATE 에서 budget_spent 재산출·예산
 *    상한(20) 강제, maintenance 를 (INSERT)100 / (UPDATE)이전 값으로 고정. 따라서 클라이언트
 *    는 layout 만 신뢰 대상으로 보낸다.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from './config.js';
import type { InvasionLayers } from '../sim/invasion/types.js';
import type {
  DefenseGateway,
  DefenseInsertPayload,
  DefenseStatus,
  RepairResult,
} from './defenseSync.js';

/** raw 값에서 안전하게 값 추출(정비 RPC 방어적 파싱). */
function asRec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
/** 서버 정비 비용식 미러(계약: ceil((100-maintenance)*5)) — 서버가 cost 미제공 시 폴백. */
function repairCostFor(maintenance: number): number {
  return Math.ceil(Math.max(0, 100 - maintenance) * 5);
}

export class SupabaseDefenseGateway implements DefenseGateway {
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

  async fetchActiveDefenseId(uid: string): Promise<string | null> {
    // 활성 방어는 프로필당 최대 1개(defenses_one_active_idx). maybeSingle 로 0/1 행 허용.
    const { data, error } = await this.client
      .from('defenses')
      .select('id')
      .eq('profile_id', uid)
      .eq('active', true)
      .maybeSingle();
    if (error !== null) throw error;
    if (data === null) return null;
    const id = (data as { id: unknown }).id;
    return typeof id === 'string' ? id : null;
  }

  async insertDefense(uid: string, payload: DefenseInsertPayload): Promise<void> {
    // active=true 로 신규 삽입(기존 활성 행이 없을 때만 호출됨 — 유니크 제약 충돌 회피).
    // budget_spent 는 정직 신고하되 서버 가드가 layout 에서 재산출·게이트한다.
    const { error } = await this.client.from('defenses').insert({
      profile_id: uid,
      layout: payload.layout,
      budget_spent: payload.budgetSpent,
      active: true,
    });
    if (error !== null) throw error;
  }

  async updateDefense(defenseId: string, layout: InvasionLayers): Promise<void> {
    // layout 만 갱신 — budget_spent 재산출·maintenance 보존은 서버 가드가 처리(정비도
    // 리셋 우회 금지). 정비도를 delete→insert 로 리셋하지 않기 위한 핵심 경로.
    const { error } = await this.client.from('defenses').update({ layout }).eq('id', defenseId);
    if (error !== null) throw error;
  }

  async fetchDefenseStatus(uid: string): Promise<DefenseStatus> {
    // 내 활성 방어의 정비도 + 크레딧. RLS(defenses_rw_own)로 본인 행 직접 select 가능.
    // 크레딧은 profiles.save.credits(jsonb) — 서버 정비 RPC 가 차감하는 원천을 그대로 읽는다.
    const [defRes, profRes] = await Promise.all([
      this.client
        .from('defenses')
        .select('maintenance')
        .eq('profile_id', uid)
        .eq('active', true)
        .maybeSingle(),
      this.client.from('profiles').select('save').eq('id', uid).maybeSingle(),
    ]);
    if (defRes.error !== null) throw defRes.error;
    if (profRes.error !== null) throw profRes.error;
    const maintenance =
      defRes.data === null ? null : num(asRec(defRes.data).maintenance, 100);
    const save = asRec(asRec(profRes.data).save);
    const credits = num(save.credits, 0);
    return {
      maintenance,
      credits,
      repairCost: maintenance === null ? 0 : repairCostFor(maintenance),
    };
  }

  async repairDefense(_uid: string): Promise<RepairResult> {
    // security definer RPC: 크레딧 차감 + maintenance=100 원자. 서버 반환 jsonb:
    //   { repaired, cost, credits, maintenance, note }. p_defense_id 생략 → 내 활성 방어.
    const { data, error } = await this.client.rpc('repair_defense');
    if (error !== null) throw error;
    const r = asRec(data);
    if (r.repaired !== true) {
      // 서버 거부(크레딧 부족·이미 만점 등) — 공개 함수가 null 로 흡수하도록 throw.
      throw new Error(`repair_defense 거부: ${String(r.note ?? 'unknown')}`);
    }
    return { credits: num(r.credits), maintenance: num(r.maintenance, 100) };
  }
}
