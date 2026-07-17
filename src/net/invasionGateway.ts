/**
 * 침공 게이트웨이의 실 Supabase 구현 (M4 Phase D — team-plan 계약).
 *
 * `invasion.ts` 의 {@link InvasionGateway} 를 `@supabase/supabase-js` 로 구현한다. 이
 * 파일만 SDK 를 정적 import 하며, `invasion.ts` 는 설정이 있을 때만 이 모듈을 동적
 * import 한다 → 미설정 번들/테스트에 SDK 가 실리지 않는다(gateway.ts 와 동일 패턴).
 *
 * 익명 Auth(ADR-0002): 세션이 없으면 `signInAnonymously()`. profiles 게이트웨이와 같은
 * 익명 유저를 공유한다(persistSession=true → localStorage 세션 공유).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from './config.js';
import type {
  InvasionGateway,
  InvasionTarget,
  LadderEntry,
  InvasionVerdict,
  InvasionSubmitInput,
  LootItem,
} from './invasion.js';

/** RPC/셀렉트가 돌려주는 raw 행에서 안전하게 값을 뽑는 헬퍼. */
function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}
function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** RPC `get_invasion_targets()` 한 행 → InvasionTarget(계약 정규화). */
function rowToTarget(raw: unknown): InvasionTarget {
  const r = asRecord(raw);
  const shipSummary = asRecord(r.ship_summary);
  const defenseIdRaw = r.defense_id;
  return {
    profileId: asString(r.profile_id),
    rank: asNumber(r.rank),
    displayName: asString(r.display_name, '무명 파일럿'),
    shipSummary,
    defenseId: typeof defenseIdRaw === 'string' ? defenseIdRaw : null,
    layout: r.layout ?? null, // raw jsonb — 소비 측에서 normalizeLayout
    maintenance: asNumber(r.maintenance, 100),
  };
}

/** `ladder` 한 행 → LadderEntry. */
function rowToLadder(raw: unknown): LadderEntry {
  const r = asRecord(raw);
  const entry: LadderEntry = {
    profileId: asString(r.profile_id),
    rank: asNumber(r.rank),
    wins: asNumber(r.wins),
    losses: asNumber(r.losses),
  };
  if (typeof r.display_name === 'string') entry.displayName = r.display_name;
  return entry;
}

/**
 * verify-invasion 응답(신뢰하되 방어적) → InvasionVerdict. 테스트를 위해 export.
 *
 * `attackerWon` 은 boolean 일 때만 그대로 쓰고, null/부재는 **null(판정 확정 중)** 로
 * 보존한다 — EF 의 already-finalized 재조회 응답이 실값 대신 null 을 줄 수 있는데,
 * 이를 false 로 강제하면 확정 "승리"가 패배로 오표시된다(리드 지적 정합).
 */
export function normalizeVerdict(raw: unknown): InvasionVerdict {
  const r = asRecord(raw);
  const status = r.status === 'verified' ? 'verified' : 'rejected';
  const ladderRaw = asRecord(r.ladder);
  const ladder =
    typeof ladderRaw.attackerRank === 'number' && typeof ladderRaw.defenderRank === 'number'
      ? { attackerRank: ladderRaw.attackerRank, defenderRank: ladderRaw.defenderRank }
      : null;
  const loot: LootItem[] = Array.isArray(r.loot) ? (r.loot as LootItem[]) : [];
  return {
    status,
    attackerWon: typeof r.attackerWon === 'boolean' ? r.attackerWon : null,
    ladder,
    loot,
  };
}

export class SupabaseInvasionGateway implements InvasionGateway {
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

  async getInvasionTargets(): Promise<InvasionTarget[]> {
    const { data, error } = await this.client.rpc('get_invasion_targets');
    if (error !== null) throw error;
    const rows = Array.isArray(data) ? data : [];
    return rows.map(rowToTarget);
  }

  async fetchLadder(limit: number): Promise<LadderEntry[]> {
    // 순위표는 서버 RPC `get_ladder_top(p_limit, p_offset)`(security definer)로 조회한다 —
    // 타인 display_name 을 노출하는 유일한 경로(직접 ladder select 는 profiles RLS 로
    // 이름 미노출). 반환: { profile_id, rank, display_name, wins, losses, placed }.
    const { data, error } = await this.client.rpc('get_ladder_top', {
      p_limit: limit,
      p_offset: 0,
    });
    if (error !== null) throw error;
    const rows = Array.isArray(data) ? data : [];
    return rows.map(rowToLadder);
  }

  async submitInvasion(input: InvasionSubmitInput): Promise<InvasionVerdict> {
    // 1) pending 증거 insert. RLS with_check(auth.uid()=attacker_id) + 트리거가
    //    verified_* 를 강제로 비운다(서버 권위). id 를 돌려받아 검증에 넘긴다.
    const { data, error } = await this.client
      .from('invasions')
      .insert({
        attacker_id: input.attackerId,
        defender_id: input.defenderId,
        defense_id: input.defenseId,
        replay: input.replay,
        client_result: input.clientResult,
      })
      .select('id')
      .single();
    if (error !== null) throw error;
    const invasionId = asString(asRecord(data).id);
    if (invasionId === '') throw new Error('invasions insert 후 id 를 얻지 못했습니다');

    // 2) Edge Function 전수 재실행 → 판정(최종 권위).
    const { data: verifyData, error: verifyError } = await this.client.functions.invoke(
      'verify-invasion',
      { body: { invasion_id: invasionId } },
    );
    if (verifyError !== null) throw verifyError;
    return normalizeVerdict(verifyData);
  }
}
