/**
 * 침공 게이트웨이의 실 Supabase 구현 (M4 Phase D — team-plan 계약).
 *
 * `invasion.ts` 의 {@link InvasionGateway} 를 `@supabase/supabase-js` 로 구현한다. SDK 는
 * `supabaseClient.ts` 가 유일하게 정적 import 하고 이 파일은 그것을 경유한다. `invasion.ts` 는
 * 설정이 있을 때만 이 모듈을 동적 import 하므로 미설정 번들/테스트에 SDK 가 실리지 않는다.
 *
 * Auth: 세션이 **이미 있어야** 한다(`requireUserId`) — 익명 폴백은 로그인 필수 정책으로
 * 걷어냈다. 다른 게이트웨이와 같은 클라이언트·세션을 공유한다(`supabaseClient.ts`).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, requireUserId } from './supabaseClient.js';
import type { SupabaseConfig } from './config.js';
import type { Replay } from '../sim/replay.js';
import { normalizeInvasionLayers } from '../sim/invasion/normalize.js';
import { parseModulesAuthority } from './modules.js';
import type {
  InvasionModulesAuthority,
  InvasionGateway,
  InvasionTarget,
  LadderEntry,
  InvasionVerdict,
  InvasionSubmitInput,
  LootItem,
  PlacementStatus,
  PlacementResult,
  RevengeTarget,
  IncomingInvasion,
  InvasionHistoryEntry,
  InvasionSnapshot,
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
/** timestamptz(ISO 문자열) 또는 epoch ms(number) → epoch ms. 파싱 실패 시 fallback. */
function asEpochMs(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return fallback;
}
/**
 * `begin_invasion` 의 `modules` jsonb → {@link InvasionModulesAuthority}(테스트를 위해 export).
 *
 * 파싱 본체는 `src/net/modules.ts` 의 {@link parseModulesAuthority} 하나뿐이다 — EF 와 클라가
 * **같은 형상**을 읽어야 재실행이 비트 일치하므로 파서를 두 벌 두지 않는다. 서버가 modules
 * 키를 안 주는 구버전 응답이면 `null` 을 돌려 호출부가 "모듈 없음"으로 본다.
 */
export function normalizeModulesAuthority(raw: unknown): InvasionModulesAuthority | null {
  return parseModulesAuthority(raw);
}

/** 스티커 인덱스 정규화: 정수 0..11 만 통과, 그 외(null/손상/범위밖)는 null. */
function asStickerIndex(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 11 ? v : null;
}

/**
 * base64 문자열 → 바이트 배열(브라우저·Node 공통 전역 atob).
 *
 * 반환 타입을 `Uint8Array<ArrayBuffer>` 로 고정한다 — TS 5.7+ 의 제네릭 Uint8Array 에서
 * 넓은 `Uint8Array<ArrayBufferLike>` 는 `Response`(BodyInit)의 BufferSource 로 못 넘어간다.
 */
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * base64 로 인코딩된 gzip 압축 리플레이를 풀어 파싱한다(ADR-0026 — 관전 로드 경로, 테스트용 export).
 *
 * EF(verify-invasion)가 검증 확정 후 원본 replay(jsonb)를 gzip → base64 로 접어 replay_gz(bytea)
 * 에 넣고 replay 를 null 화한다(index.ts gzipToBase64 → store_invasion_replay_gz RPC). 관전은
 * get_invasion_replay_gz RPC 가 돌려준 base64 를 이 함수로 풀어 Replay 로 되살린다. 브라우저·
 * Deno·Node 공통 표준 `DecompressionStream('gzip')` 만 쓴다(외부 의존성 0). 손상/실패는 호출부
 * (getInvasionReplay)가 잡아 관전 불가로 안내한다(isPlayableReplay 가드와 정합).
 */
export async function decompressReplayGz(base64: string): Promise<unknown> {
  const bytes = base64ToBytes(base64);
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  const text = new TextDecoder().decode(buf);
  return JSON.parse(text);
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
  if (typeof r.placed === 'boolean') entry.placed = r.placed;
  return entry;
}

/** `invasions` 한 행 + 내 uid → 내 시점의 전투 기록 1건. */
function rowToHistory(raw: unknown, myId: string): InvasionHistoryEntry {
  const r = asRecord(raw);
  const attackerId = asString(r.attacker_id);
  const defenderId = asString(r.defender_id);
  const attacking = attackerId === myId;
  const statusRaw = asString(r.verified_status, 'pending');
  const status: InvasionHistoryEntry['status'] =
    statusRaw === 'verified' || statusRaw === 'rejected' ? statusRaw : 'pending';
  return {
    invasionId: asString(r.id),
    attacking,
    opponentId: attacking ? defenderId : attackerId,
    attackerWon: typeof r.attacker_won === 'boolean' ? r.attacker_won : null,
    status,
    // 확정 시각이 있으면 그것이 기록의 시각이다(미확정 행은 제출 시각).
    atMs: asEpochMs(r.verified_at ?? r.created_at),
  };
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
    // EF additive(계약 §F1) — 복수 판정·보너스 광물. 미제공이면 기본값(비복수·0).
    revenge: r.revenge === true,
    bonusMinerals: asNumber(r.bonusMinerals),
  };
}

export class SupabaseInvasionGateway implements InvasionGateway {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseConfig) {
    this.client = getSupabaseClient(config);
  }

  async getUserId(): Promise<string> {
    return requireUserId(this.client);
  }

  async getInvasionTargets(): Promise<InvasionTarget[]> {
    const { data, error } = await this.client.rpc('get_invasion_targets');
    if (error !== null) throw error;
    const rows = Array.isArray(data) ? data : [];
    return rows.map(rowToTarget);
  }

  async getPlacementTargets(): Promise<InvasionTarget[]> {
    // 배치전 대상(NPC 시드 기지) — get_invasion_targets 와 동일 행 shape(계약 §2 재사용).
    // 쿨다운 무시·NPC 전용은 서버 RPC 가 강제한다(클라이언트는 목록만 표시).
    const { data, error } = await this.client.rpc('get_placement_targets');
    if (error !== null) throw error;
    const rows = Array.isArray(data) ? data : [];
    return rows.map(rowToTarget);
  }

  async getPlacementStatus(): Promise<PlacementStatus> {
    // 배치전 진행 상태. 서버 반환: { matches_played, matches_won, required(=5), placed }.
    const { data, error } = await this.client.rpc('get_placement_status');
    if (error !== null) throw error;
    const r = asRecord(Array.isArray(data) ? data[0] : data);
    return {
      completed: asNumber(r.matches_played),
      won: asNumber(r.matches_won),
      total: asNumber(r.required, 5),
      placed: r.placed === true,
    };
  }

  async applyPlacementResult(): Promise<PlacementResult> {
    // 배치전 5회 완료 후 성적으로 초기 rank 삽입. 서버 반환 jsonb:
    //   { placed, rank, matches_won, note }.
    const { data, error } = await this.client.rpc('apply_placement_result');
    if (error !== null) throw error;
    const r = asRecord(data);
    return {
      placed: r.placed === true,
      rank: asNumber(r.rank),
      matchesWon: asNumber(r.matches_won),
      note: asString(r.note),
    };
  }

  async getRevengeTargets(): Promise<RevengeTarget[]> {
    // 복수 대상(24h 창) — get_invasion_targets 와 동일 행 shape + 복수 메타(계약 §F1).
    // 24h·쿨다운 무시·격차 예외는 서버 RPC 가 강제(클라이언트는 표시만).
    const { data, error } = await this.client.rpc('get_revenge_targets');
    if (error !== null) throw error;
    const rows = Array.isArray(data) ? data : [];
    return rows.map((raw) => {
      const base = rowToTarget(raw);
      const r = asRecord(raw);
      return {
        ...base,
        revengeInvasionId: asString(r.revenge_invasion_id),
        expiresAtMs: asEpochMs(r.expires_at),
      };
    });
  }

  async getIncomingInvasions(sinceMs: number, limit: number): Promise<IncomingInvasion[]> {
    // 내가 당한 최근 침공(알림용) — 폴링 전용(계약 §5). p_since 는 ISO timestamptz.
    const since = new Date(Number.isFinite(sinceMs) && sinceMs > 0 ? sinceMs : 0).toISOString();
    const { data, error } = await this.client.rpc('get_incoming_invasions', {
      p_since: since,
      p_limit: limit,
    });
    if (error !== null) throw error;
    const rows = Array.isArray(data) ? data : [];
    return rows.map((raw) => {
      const r = asRecord(raw);
      // 나에게 온 도발 = 공격자 스티커. 서버가 단일 sticker 로 줄 수도 있어 둘 다 흡수.
      const stickerRaw = r.attacker_sticker !== undefined ? r.attacker_sticker : r.sticker;
      // "마지막 확인 시각" 커서와 정합하도록 verified_at 우선(서버가 verified_at 로 필터).
      return {
        invasionId: asString(r.invasion_id),
        attackerName: asString(r.attacker_name, '무명 파일럿'),
        attackerWon: r.attacker_won === true,
        createdAtMs: asEpochMs(r.verified_at ?? r.created_at),
        sticker: asStickerIndex(stickerRaw),
        defenderSticker: asStickerIndex(r.defender_sticker),
        isRevenge: r.is_revenge === true,
      };
    });
  }

  async setInvasionSticker(invasionId: string, index: number): Promise<boolean> {
    // 도발 스티커 설정(계약 §F2) — 역할(공/수) 판정·1회 불변은 서버. 반환 성공 여부.
    const { data, error } = await this.client.rpc('set_invasion_sticker', {
      p_invasion_id: invasionId,
      p_sticker: index,
    });
    if (error !== null) throw error;
    // RPC 가 boolean 또는 { ok } 를 돌려줄 수 있어 방어적으로 판정.
    if (typeof data === 'boolean') return data;
    const r = asRecord(data);
    return r.ok === true || r.success === true;
  }

  async getInvasionReplay(invasionId: string): Promise<Replay | null> {
    // 관전용 리플레이 로드(계약 §F3) — 방어자/공격자만 RLS select 로 읽는다. 검증된 침공의
    // 리플레이라 신뢰하되, 소비 측(main)이 재실행 전 shape 를 재확인한다(렌더 전용·tainted).
    //
    // ADR-0026: 검증 확정 후 EF 가 원본 replay(jsonb)를 null 화하고 gzip 압축본을 replay_gz
    // (bytea)에 접는다. 따라서 로드는 2단이다.
    //   (1) replay(jsonb)가 살아 있으면(미확정·미압축 건) 그대로 쓴다.
    //   (2) null 이면 get_invasion_replay_gz RPC 로 압축본 base64 를 받아 푼다. RPC 는 참여자만
    //       통과시키고, 없으면(48h 경과·행 부재) null → 관전 불가(만료)로 수렴한다.
    const { data, error } = await this.client
      .from('invasions')
      .select('replay')
      .eq('id', invasionId)
      .single();
    if (error !== null) throw error;
    const replay = asRecord(data).replay;
    if (typeof replay === 'object' && replay !== null) {
      return replay as Replay;
    }
    // (2) 압축본 폴백.
    const { data: gzData, error: gzErr } = await this.client.rpc('get_invasion_replay_gz', {
      p_id: invasionId,
    });
    if (gzErr !== null) throw gzErr;
    if (typeof gzData !== 'string' || gzData.length === 0) return null; // 만료·부재
    try {
      const parsed = await decompressReplayGz(gzData);
      return typeof parsed === 'object' && parsed !== null ? (parsed as Replay) : null;
    } catch {
      return null; // 압축 손상 → 관전 불가 안내(isPlayableReplay 가드와 정합)
    }
  }

  async fetchLadder(limit: number, offset = 0): Promise<LadderEntry[]> {
    // 순위표는 서버 RPC `get_ladder_top(p_limit, p_offset)`(security definer)로 조회한다 —
    // 타인 display_name 을 노출하는 유일한 경로(직접 ladder select 는 profiles RLS 로
    // 이름 미노출). 반환: { profile_id, rank, display_name, wins, losses, placed }.
    const { data, error } = await this.client.rpc('get_ladder_top', {
      p_limit: limit,
      p_offset: offset,
    });
    if (error !== null) throw error;
    const rows = Array.isArray(data) ? data : [];
    return rows.map(rowToLadder);
  }

  async getMyLadderRank(): Promise<LadderEntry | null> {
    // `ladder` 는 authenticated 공개 읽기(ladder_select_all) — 내 행은 직접 select 로 얻는다.
    // display_name 은 여기서 안 온다(profiles RLS). "내 순위" 표시는 이름이 필요 없다.
    const uid = await this.getUserId();
    const { data, error } = await this.client
      .from('ladder')
      .select('profile_id, rank, wins, losses, placed')
      .eq('profile_id', uid)
      .maybeSingle();
    if (error !== null) throw error;
    if (data === null || data === undefined) return null;
    return rowToLadder(data);
  }

  async getInvasionHistory(limit: number): Promise<InvasionHistoryEntry[]> {
    // RLS(invasions_select_participant)가 "내가 공격했거나 방어당한" 행만 열어 주므로 필터
    // 없이 최신순으로 받아도 남의 기록이 섞이지 않는다. replay/client_result 는 무거워서 뺀다.
    const uid = await this.getUserId();
    const { data, error } = await this.client
      .from('invasions')
      .select('id, attacker_id, defender_id, verified_status, attacker_won, created_at, verified_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error !== null) throw error;
    const rows = Array.isArray(data) ? data : [];
    return rows.map((raw) => rowToHistory(raw, uid));
  }

  async beginInvasion(defenseId: string): Promise<InvasionSnapshot> {
    // 침공 개시 권위 스냅샷 고정(계약 M5/M6/M7a) — begin_invasion 은 자격 미달 시 raise 하며,
    // 그 에러는 공개 beginInvasion 이 흡수해 라이브 경로 폴백으로 전환한다. 반환 jsonb:
    //   { snapshot_id, defender_id, defense_id, layers(수호 권위 주입 완료 3레이어),
    //     maintenance, modules({instances,matchup} 또는 null — M7b) }.
    // 구버전 서버는 `layers` 대신 `layout` 을 준다 → 폴백해서 같은 정규화를 태운다(정규화는
    // total function 이라 구 스키마도 빈 3레이어로 수렴하고, 그 상태로는 EF 대조가 어차피
    // 거부되므로 조용한 오작동이 아니라 명시적 실패로 드러난다).
    const { data, error } = await this.client.rpc('begin_invasion', { p_defense_id: defenseId });
    if (error !== null) throw error;
    const r = asRecord(data);
    const snapshotId = asString(r.snapshot_id);
    if (snapshotId === '') throw new Error('begin_invasion 후 snapshot_id 를 얻지 못했습니다');
    const rawLayers = r.layers ?? r.layout ?? null;
    return {
      snapshotId,
      layers: normalizeInvasionLayers(rawLayers),
      layout: rawLayers, // @deprecated — 구 호출부(main.ts)가 이관될 때까지만 유지
      maintenance: asNumber(r.maintenance, 100),
      // 서버 authored 코어 모듈 권위(미장착이면 null). 소비 측(main.ts)이 침공
      // config.invasion3.modules 로 실어 런하고, 제출 시 snapshotId 와 함께 EF 가 스냅샷
      // 권위 modules 로 재실행 대조한다.
      modules: normalizeModulesAuthority(r.modules),
    };
  }

  async submitInvasion(input: InvasionSubmitInput): Promise<InvasionVerdict> {
    // 1) pending 증거 insert. RLS with_check(auth.uid()=attacker_id) + 트리거가
    //    verified_* 를 강제로 비운다(서버 권위). id 를 돌려받아 검증에 넘긴다.
    //    snapshot_id(있으면)를 동봉하면 EF 가 T0 고정 권위로 대조(라이브 재조회 생략).
    const { data, error } = await this.client
      .from('invasions')
      .insert({
        attacker_id: input.attackerId,
        defender_id: input.defenderId,
        defense_id: input.defenseId,
        replay: input.replay,
        client_result: input.clientResult,
        ...(input.snapshotId != null ? { snapshot_id: input.snapshotId } : {}),
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
    // 도발 스티커 설정에 필요한 invasionId 를 판정에 실어 준다(EF 가 안 돌려줘도 클라가 앎).
    return { ...normalizeVerdict(verifyData), invasionId };
  }
}
