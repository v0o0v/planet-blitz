/**
 * 침공(비동기 PvP) 네트워크 계층 (M4 Phase D — 계획 §4 D3, team-plan 계약).
 *
 * 세 가지 서버 상호작용을 클라이언트에서 담당한다:
 *  1. {@link fetchInvasionTargets} — RPC `get_invasion_targets()` 로 매치메이킹 대상
 *     (내 위 랭커 3명 + 30위 랜덤 1명)을 받는다.
 *  2. {@link submitInvasion} — `invasions` 행을 pending 증거로 insert 한 뒤 Edge Function
 *     `verify-invasion` 을 invoke 해 서버 판정을 받는다(서버 권위 — 원칙2).
 *  3. {@link fetchLadder} — `ladder` select 로 관제탑 순위표를 표시한다.
 *
 * 규율(기존 net 계층과 동일 — config.ts/index.ts):
 *  - Supabase 미설정(env 부재) 시 **완전 no-op** → 공개 함수는 `null` 을 돌려주고
 *    실제 SDK 를 로드하지 않는다(테스트/오프라인 유지).
 *  - 공개 함수는 절대 throw 하지 않는다(오프라인/오류는 삼키고 `null`).
 *  - profileSync 의 fire-and-forget 과 달리 침공 제출·조회는 **await 흐름**이다(사용자가
 *    결과를 기다리는 대화형 액션). 그래도 실패는 `null` 로 흡수해 UI 가 안내한다.
 *
 * 실제 Supabase SDK 는 설정이 있을 때만 `invasionGateway.js` 를 동적 import 한다 →
 * 미설정 번들/테스트 경로에 `@supabase/supabase-js` 가 실리지 않는다.
 */

import type { Replay } from '../sim/replay.js';
import { runReplay } from '../sim/replay.js';
import type { KeyValueStore } from '../save/profile.js';
import type { DefenseCardConfig } from '../sim/cardEffects.js';
import { readSupabaseConfig, type SupabaseConfig } from './config.js';

// ---------------------------------------------------------------------------
// 계약 타입 (team-plan §D 서버↔클라)
// ---------------------------------------------------------------------------

/** 기체 요약(정찰 표시용 — RPC 가 jsonb 로 반환). 서버 shape 미고정이라 느슨하게 둔다. */
export interface ShipSummary {
  name?: string;
  level?: number;
  [k: string]: unknown;
}

/**
 * 매치메이킹 제안 대상 1건(RPC `get_invasion_targets()` 한 행).
 *
 * `layout` 은 raw jsonb(신뢰 불가)라 **`unknown`** 으로 둔다 — 정찰 미리보기·침공 런
 * 구성 시 반드시 `src/ui/defenseCommand.ts` 의 `normalizeLayout()` 으로 깊은 정규화를
 * 거쳐 손상/NaN 좌표를 걸러야 한다(ADR-0005 결정론 보호, PR#24 carry-forward).
 */
export interface InvasionTarget {
  profileId: string;
  rank: number;
  displayName: string;
  shipSummary: ShipSummary;
  defenseId: string | null;
  /** raw DefenseLayout jsonb — 소비 전 normalizeLayout 필수. */
  layout: unknown;
  /** 정비도 %(0~100). 풍화로 하락(ADR-0006). */
  maintenance: number;
}

/**
 * 배치전(AC4·GDD §8) 진행 상태. PvP 해금 후 첫 {@link PLACEMENT_TOTAL}회는 NPC 시드 기지를
 * 상대로 치르고, 완료 시 서버가 성적으로 초기 순위를 삽입한다(`apply_placement_result`).
 * `placed`는 이미 순위에 든 상태(배치전 종료). 서버 권위 — 클라이언트는 표시만 한다.
 */
export interface PlacementStatus {
  /** 완료한(=verified) 배치전 횟수(0~total). 서버 matches_played. */
  completed: number;
  /** 그 중 승리 횟수(연출·성적 표시). 서버 matches_won. */
  won: number;
  /** 총 배치전 횟수(기본 {@link PLACEMENT_TOTAL}=5). 서버 required. */
  total: number;
  /** 배치전을 마치고 순위에 삽입됐는지(true면 일반 침공 단계). */
  placed: boolean;
}

/** 배치전 총 횟수(GDD §8: PvP 해금 첫 5회). */
export const PLACEMENT_TOTAL = 5;

/**
 * 배치전 완료 삽입 결과(RPC `apply_placement_result()` — 성적으로 초기 rank 삽입).
 * 기존 유저 상대 순서 불변(삽입점 이하 rank+1 shift 허용, 계약 §2). 서버 권위.
 */
export interface PlacementResult {
  /** 순위에 삽입됐는지(true면 순위 진입 연출). */
  placed: boolean;
  /** 삽입된 초기 rank. */
  rank: number;
  /** 배치전 승리 횟수(성적). */
  matchesWon: number;
  /** 서버 메모(디버그·안내). */
  note: string;
}

/** 관제탑 순위표 한 행(`ladder` select). */
export interface LadderEntry {
  profileId: string;
  rank: number;
  wins: number;
  losses: number;
  /** 타인 display_name 은 현행 RLS 로 미노출일 수 있어 optional(서버 뷰 확장 시 채워짐). */
  displayName?: string;
}

/** 복제 약탈 전리품 1건(ADR-0003 — 방어자 원본 무손실). 서버 shape 미고정이라 느슨. */
export interface LootItem {
  itemId?: string;
  rarity?: number;
  name?: string;
  [k: string]: unknown;
}

/**
 * 복수 대상 1건(RPC `get_revenge_targets()` — 계약 §F1/AC6, f-server 합의).
 *
 * 나를 이겨 순위를 뺏은 직전 공격자에 대한 24h 복수권. `get_invasion_targets` 와 동일한
 * {@link InvasionTarget} shape 에 복수 메타를 얹는다. 격차 가드·재도전 쿨다운 무시는 서버가
 * `apply_invasion_result` 에서 강제하며(원칙2), 클라이언트는 배지·잔여시간을 **표시만** 한다.
 */
export interface RevengeTarget extends InvasionTarget {
  /** 복수 근거가 된 원래 침공(내가 당한 verified invasion) id. */
  revengeInvasionId: string;
  /** 복수권 만료 시각(epoch ms) — 원 침공 확정 +24h. 지나면 서버가 복수 대상에서 제외. */
  expiresAtMs: number;
}

/**
 * 알림 배너용 "내가 당한 최근 침공" 1건(RPC `get_incoming_invasions()` — 계약 §5).
 * 폴링 전용(realtime 금지). 관제탑 진입 시 마지막 확인 시각 이후 결과를 배너로 요약한다.
 */
export interface IncomingInvasion {
  /** invasions 행 id. */
  invasionId: string;
  /** 공격자 표시명(RPC security definer 로 노출). 미상이면 '무명 파일럿'. */
  attackerName: string;
  /** 공격자 승리(내 기지 함락) 여부 — 서버 확정값. */
  attackerWon: boolean;
  /** 침공 확정 시각(epoch ms, 서버 verified_at) — 미확인 카운트·정렬 기준. */
  createdAtMs: number;
  /** 공격자가 남긴 도발 스티커 인덱스(0..11) — 나에게 온 도발. 미설정/손상이면 null. */
  sticker: number | null;
  /** 내(방어자)가 이 침공에 남긴 도발 스티커 인덱스(0..11). 미설정이면 null(→ 도발 버튼 노출). */
  defenderSticker: number | null;
  /** 이 침공이 복수전이었는지(서버 is_revenge). 배너 문구 강조용. */
  isRevenge: boolean;
}

/**
 * Edge Function `verify-invasion` 응답(서버 전수 재실행 판정 — 최종 권위).
 * 클라이언트의 잠정 결과와 다를 수 있으며, 이 값이 최종이다.
 *
 * `attackerWon` 은 확정 판정이면 boolean, 서버가 실값을 주지 않은 경우(예: 이미 확정된
 * 침공 재조회의 과도기 응답)는 `null` — UI 는 null 을 "판정 확정 중"으로 표시하고 절대
 * false(패배)로 강제 해석하지 않는다(확정 승리 오표시 방지).
 */
export interface InvasionVerdict {
  status: 'verified' | 'rejected';
  attackerWon: boolean | null;
  ladder: { attackerRank: number; defenderRank: number } | null;
  loot: LootItem[];
  /** 이 침공이 복수전으로 판정됐는지(EF additive, 계약 §F1). 미제공이면 false. */
  revenge?: boolean;
  /** 복수 성공 시 지급된 보너스 광물(EF additive). 미제공/비복수면 0. */
  bonusMinerals?: number;
  /** 제출된 침공 행 id(게이트웨이가 채운다 — 도발 스티커 설정에 필요). 미설정이면 undefined. */
  invasionId?: string;
}

/**
 * 클라이언트가 제출하는 잠정 결과(증거). 서버가 리플레이를 재실행해 이 값과 대조한다.
 * `hashStream` 은 틱별 `hashWorld` 값(uint32) — 조작 시 서버 재실행과 불일치해 거부된다.
 */
export interface ClientResult {
  /** 클라이언트가 주장하는 공격자 승리(코어 파괴) 여부. */
  attackerWon: boolean;
  /** 코어 파괴로 이겼는지(승리 == 코어 파괴, 패배 == 시간초과/격추). */
  coreDestroyed: boolean;
  /** 리플레이 총 틱 수(= inputs 길이). */
  finalTick: number;
  /** 최종 상태 해시(uint32). */
  finalHash: number;
  /** 틱별 상태 해시 스트림(uint32 배열, 길이 === finalTick). */
  hashStream: number[];
}

/**
 * 침공 권위 스냅샷(RPC `begin_invasion(defense_id)` 반환 — M5 레이스 B 폐쇄).
 *
 * T0(공격 개시) 시점에 서버가 방어 배치에 라이브 수호 권위를 접어 넣은 불변 스냅샷이다.
 * 클라이언트는 이 `layout`(수호 권위 주입 완료)으로 침공 런을 돌리고, 제출 시 `snapshotId` 를
 * 동봉한다 → EF 가 라이브 재조회 없이 이 고정본으로 대조(T0↔T1 사이 dismiss/retire/풍화 무영향).
 * `layout` 은 raw jsonb(신뢰 불가)라 소비 전 `normalizeLayout()` 필수(현행 매치메이킹 serve
 * layout 과 동일 규칙 — 수호 권위 정합). 실패(자격 미달·구버전 서버)면 게이트웨이가 null.
 */
export interface InvasionSnapshot {
  /** invasion_snapshots 행 id — 제출 시 invasions.snapshot_id 로 동봉. */
  snapshotId: string;
  /** T0 고정 방어 배치(수호 권위 주입 완료 raw jsonb) — 소비 전 normalizeLayout 필수. */
  layout: unknown;
  /** T0 고정 정비도 %(0~100). 런·검증에 이 값을 쓴다(라이브 재조회 대신 고정본). */
  maintenance: number;
  /**
   * T0 고정 방어 카드 효력(M6 · ADR-0012) — 방어자 장착 카드(서버 권위 CardInstance)+공격자
   * 매치업. 존재하면 침공 런 config 의 `invasion.card` 로 실어 정적 카운터·동적 트리거·유니크가
   * 방어전에 반영된다(공격자 클라이언트도 이 고정본으로 재현해야 hashStream 이 EF 재실행과 일치).
   * 방어자 카드 미장착이면 `null`/미설정 → 카드 없는 기존 침공과 거동·해시 완전 불변(조건부 접기).
   * 서버가 authored 한 값이라 begin_invasion 응답 그대로 소비한다(위조 시 EF 가 스냅샷 권위로
   * 오버라이드해 재실행 발산으로 거부).
   */
  card?: DefenseCardConfig | null;
}

/** 침공 제출 게이트웨이 입력(공격자 uid 포함 — RLS with_check 강제). */
export interface InvasionSubmitInput {
  attackerId: string;
  defenderId: string;
  defenseId: string | null;
  replay: Replay;
  clientResult: ClientResult;
  /** 침공 권위 스냅샷 id(begin_invasion 성공 시). 미설정이면 EF 라이브 경로(하위호환). */
  snapshotId?: string | null;
}

/** 실제 서버 IO 추상화(테스트에서 fake 로 주입). */
export interface InvasionGateway {
  /** 익명 세션 보장 + uid 반환. 실패 시 throw. */
  getUserId(): Promise<string>;
  /** RPC `get_invasion_targets()` — 매치메이킹 대상 목록. 실패 시 throw. */
  getInvasionTargets(): Promise<InvasionTarget[]>;
  /** `ladder` 상위 `limit` 행. 실패 시 throw. */
  fetchLadder(limit: number): Promise<LadderEntry[]>;
  /** invasions insert(pending) → verify-invasion invoke → 판정 반환. 실패 시 throw. */
  submitInvasion(input: InvasionSubmitInput): Promise<InvasionVerdict>;
  /**
   * 침공 개시 권위 스냅샷 고정 — RPC `begin_invasion(defense_id)`(계약 M5). 성공 시
   * {@link InvasionSnapshot}, 자격 미달·오류 시 throw. 구현이 없으면(구버전) `undefined` →
   * 공개 함수가 no-op(null)로 처리하고 호출부가 라이브 경로로 폴백한다.
   */
  beginInvasion?(defenseId: string): Promise<InvasionSnapshot>;
  /**
   * 배치전 대상(NPC 시드 기지) 목록 — RPC `get_placement_targets()`. 쿨다운 무시(계약 §2).
   * 구현이 없는 게이트웨이(구버전)면 `undefined` — 공개 함수가 no-op(null)로 처리한다.
   */
  getPlacementTargets?(): Promise<InvasionTarget[]>;
  /**
   * 배치전 진행 상태 — RPC `get_placement_status()`(또는 ladder 파생). 실패 시 throw.
   * 구현이 없으면 `undefined`(no-op).
   */
  getPlacementStatus?(): Promise<PlacementStatus>;
  /**
   * 배치전 5회 완료 후 성적으로 초기 rank 삽입 — RPC `apply_placement_result()`. 실패 시
   * throw. 구현이 없으면 `undefined`(no-op). 미완료 상태에서 호출하면 서버가 placed=false.
   */
  applyPlacementResult?(): Promise<PlacementResult>;
  /**
   * 복수 대상 목록 — RPC `get_revenge_targets()`(계약 §F1). 실패 시 throw. 구현이 없으면
   * `undefined`(no-op → 복수전 UI 숨김). 24h·쿨다운 무시·격차 예외는 서버가 강제한다.
   */
  getRevengeTargets?(): Promise<RevengeTarget[]>;
  /**
   * 내가 당한 최근 침공(알림용) — RPC `get_incoming_invasions(sinceMs, limit)`(계약 §5).
   * 실패 시 throw. 구현이 없으면 `undefined`(no-op → 알림 배너 없음). 폴링 전용.
   */
  getIncomingInvasions?(sinceMs: number, limit: number): Promise<IncomingInvasion[]>;
  /**
   * 도발 스티커 설정 — RPC `set_invasion_sticker(invasionId, index)`(계약 §F2). 성공 여부
   * 반환. 실패 시 throw. 구현이 없으면 `undefined`(no-op). 역할(공/수) 판정·1회 불변은 서버.
   */
  setInvasionSticker?(invasionId: string, index: number): Promise<boolean>;
  /**
   * 관전용 리플레이 로드 — `invasions.replay` select(계약 §F3). 방어자/공격자만 RLS 로 읽는다.
   * 실패/부재 시 `null`(→ 관전 진입 불가 안내). 구현이 없으면 `undefined`(no-op).
   */
  getInvasionReplay?(invasionId: string): Promise<Replay | null>;
}

/** 주입 가능한 의존성(테스트에서 gateway/config/store 대체). */
export interface InvasionDeps {
  gateway?: InvasionGateway;
  config?: SupabaseConfig | null;
  store?: KeyValueStore | null;
}

// ---------------------------------------------------------------------------
// 게이트웨이 해석 (index.ts resolveGateway 와 동일 규율)
// ---------------------------------------------------------------------------

let cachedGateway: InvasionGateway | null = null;
let cachedConfigKey: string | null = null;

/** ambient localStorage 를 KeyValueStore 로(없으면 null). */
function defaultNetStore(): KeyValueStore | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // 사생활 모드 등에서 접근이 throw 할 수 있음.
  }
  return null;
}

/**
 * 이 호출에 쓸 게이트웨이를 해석한다. 주입 gateway 우선, 없으면 설정이 있을 때만
 * SupabaseInvasionGateway 를 동적 생성한다. 미설정이면 null(→ no-op).
 */
async function resolveGateway(deps: InvasionDeps): Promise<InvasionGateway | null> {
  if (deps.gateway !== undefined) return deps.gateway;
  const config = deps.config !== undefined ? deps.config : readSupabaseConfig();
  if (config === null) return null;
  const key = config.url;
  if (cachedGateway !== null && cachedConfigKey === key) return cachedGateway;
  const { SupabaseInvasionGateway } = await import('./invasionGateway.js');
  cachedGateway = new SupabaseInvasionGateway(config);
  cachedConfigKey = key;
  return cachedGateway;
}

function resolveStore(deps: InvasionDeps): KeyValueStore | null {
  return deps.store !== undefined ? deps.store : defaultNetStore();
}

// ---------------------------------------------------------------------------
// 공개 API (no-op 가드 · 절대 throw 안 함)
// ---------------------------------------------------------------------------

/**
 * 매치메이킹 대상 목록을 받는다. 미설정/오프라인/오류면 `null`(UI 가 "서버 미설정 또는
 * 오프라인" 안내). 빈 배열은 "제안 대상 없음"(정상)과 구분된다.
 */
export async function fetchInvasionTargets(deps: InvasionDeps = {}): Promise<InvasionTarget[] | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return null;
  try {
    return await gateway.getInvasionTargets();
  } catch {
    return null;
  }
}

/**
 * 배치전 대상(NPC 시드 기지) 목록을 받는다. 미설정/오프라인/오류/게이트웨이 미구현이면
 * `null`. 배치전 단계에서만 관제탑이 이 목록을 제안한다(쿨다운 무시 — 서버 §2).
 */
export async function fetchPlacementTargets(deps: InvasionDeps = {}): Promise<InvasionTarget[] | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null || gateway.getPlacementTargets === undefined) return null;
  try {
    return await gateway.getPlacementTargets();
  } catch {
    return null;
  }
}

/**
 * 배치전 진행 상태를 받는다. 미설정/오프라인/오류/게이트웨이 미구현이면 `null`(→ 관제탑은
 * 배치전 UI 를 숨기고 일반 침공만 표시). 서버 권위 — 클라이언트는 이 값을 표시만 한다.
 */
export async function fetchPlacementStatus(deps: InvasionDeps = {}): Promise<PlacementStatus | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null || gateway.getPlacementStatus === undefined) return null;
  try {
    return normalizePlacementStatus(await gateway.getPlacementStatus());
  } catch {
    return null;
  }
}

/**
 * 배치전 5회 완료 후 초기 rank 삽입을 서버에 요청하고 결과를 받는다(서버 권위 — 기존 유저
 * 순서 불변). 미설정/오프라인/오류/게이트웨이 미구현이면 `null`. 관제탑은 placed=true 응답에
 * 순위 진입 연출을 띄운다.
 */
export async function applyPlacementResult(deps: InvasionDeps = {}): Promise<PlacementResult | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null || gateway.applyPlacementResult === undefined) return null;
  try {
    return await gateway.applyPlacementResult();
  } catch {
    return null;
  }
}

/**
 * 복수 대상(24h 창) 목록을 받는다(계약 §F1). 미설정/오프라인/오류/게이트웨이 미구현이면
 * `null`(→ 관제탑 복수전 카드 숨김). 서버 권위 — 24h·쿨다운 무시·격차 예외는 서버 강제.
 */
export async function fetchRevengeTargets(deps: InvasionDeps = {}): Promise<RevengeTarget[] | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null || gateway.getRevengeTargets === undefined) return null;
  try {
    return await gateway.getRevengeTargets();
  } catch {
    return null;
  }
}

/**
 * 내가 당한 최근 침공(알림용)을 받는다(계약 §5). `sinceMs` 이후만 서버가 필터하며, 클라이언트는
 * 로컬 "마지막 확인 시각"({@link readInvasionsSeenAt})을 넘긴다. 미설정/오프라인/오류/미구현이면
 * `null`(→ 알림 배너 없음). 폴링 전용.
 */
export async function fetchIncomingInvasions(
  sinceMs: number,
  limit = 20,
  deps: InvasionDeps = {},
): Promise<IncomingInvasion[] | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null || gateway.getIncomingInvasions === undefined) return null;
  try {
    return await gateway.getIncomingInvasions(sinceMs, limit);
  } catch {
    return null;
  }
}

/**
 * 도발 스티커를 서버에 설정한다(계약 §F2). 성공하면 true, 미설정/오프라인/오류/미구현/거부면
 * false(호출부는 조용히 넘어감 — 스티커는 재미 요소라 실패해도 게임 진행 무영향). 인덱스가
 * 사전 세트(0..11) 밖이면 서버를 만지지 않고 false. 역할 판정·1회 불변은 서버 권위.
 */
export async function setInvasionSticker(
  invasionId: string,
  index: number,
  deps: InvasionDeps = {},
): Promise<boolean> {
  if (!Number.isInteger(index) || index < 0 || index > 11 || invasionId.length === 0) return false;
  const gateway = await resolveGateway(deps);
  if (gateway === null || gateway.setInvasionSticker === undefined) return false;
  try {
    return await gateway.setInvasionSticker(invasionId, index);
  } catch {
    return false;
  }
}

/**
 * 관전용 리플레이(`invasions.replay`)를 로드한다(계약 §F3). 미설정/오프라인/오류/부재/미구현이면
 * `null`(→ 관전 진입 불가 안내). 반환된 리플레이는 소비 전 shape 재확인 후 render-only·tainted
 * 로만 재생한다(정산·제출 오염 없음).
 */
export async function fetchInvasionReplay(
  invasionId: string,
  deps: InvasionDeps = {},
): Promise<Replay | null> {
  if (invasionId.length === 0) return null;
  const gateway = await resolveGateway(deps);
  if (gateway === null || gateway.getInvasionReplay === undefined) return null;
  try {
    return await gateway.getInvasionReplay(invasionId);
  } catch {
    return null;
  }
}

/**
 * 침공 개시 권위 스냅샷을 서버에 고정하고 받는다(RPC `begin_invasion` — M5 레이스 B 폐쇄).
 *
 * 대상(defenseId)을 확정한 순간 호출한다. 반환 {@link InvasionSnapshot} 의 `layout`(수호 권위
 * 주입 완료)으로 침공 런을 돌리고, 제출 시 `snapshotId` 를 동봉하면 EF 가 라이브 재조회 없이
 * 이 고정본으로 대조한다. 미설정/오프라인/오류/게이트웨이 미구현/자격 미달이면 `null` →
 * 호출부는 현행 라이브 경로(매치메이킹 serve layout)로 폴백한다(하위호환 — 회귀 0).
 */
export async function beginInvasion(defenseId: string, deps: InvasionDeps = {}): Promise<InvasionSnapshot | null> {
  if (typeof defenseId !== 'string' || defenseId.length === 0) return null;
  const gateway = await resolveGateway(deps);
  if (gateway === null || gateway.beginInvasion === undefined) return null;
  try {
    return await gateway.beginInvasion(defenseId);
  } catch {
    return null;
  }
}

/**
 * 관제탑 순위표 상위 `limit` 행을 받는다. 미설정/오프라인/오류면 `null`.
 */
export async function fetchLadder(limit = 50, deps: InvasionDeps = {}): Promise<LadderEntry[] | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return null;
  try {
    return await gateway.fetchLadder(limit);
  } catch {
    return null;
  }
}

/**
 * 침공 리플레이+잠정 결과를 제출하고 서버 판정을 반환한다(서버 권위 — 최종 결과).
 *
 * 플로우: getUserId(공격자 uid) → invasions insert(pending, RLS 강제) →
 * verify-invasion invoke → 판정. 성공(판정 반환) 시 로컬 쿨다운 미러에 시각을 기록한다
 * (서버 강제 1시간 쿨다운의 UI 미러).
 *
 * 미설정/오프라인/오류면 `null` — 이때 호출부는 클라이언트 잠정 결과만 표시하고
 * "미제출"로 안내한다(런 자체는 로컬에서 이미 끝났다).
 */
export async function submitInvasion(
  params: { target: InvasionTarget; replay: Replay; clientResult: ClientResult; snapshotId?: string | null },
  deps: InvasionDeps = {},
): Promise<InvasionVerdict | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return null;
  try {
    const attackerId = await gateway.getUserId();
    const verdict = await gateway.submitInvasion({
      attackerId,
      defenderId: params.target.profileId,
      defenseId: params.target.defenseId,
      replay: params.replay,
      clientResult: params.clientResult,
      snapshotId: params.snapshotId ?? null,
    });
    // 서버가 실제 판정을 내렸으므로(제출 성립) 로컬 쿨다운 미러를 갱신한다.
    const store = resolveStore(deps);
    if (store !== null) recordInvasionAttempt(store, params.target.profileId, Date.now());
    return verdict;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 클라이언트 결과 빌더 (순수 · 결정론 · 테스트 대상)
// ---------------------------------------------------------------------------

/**
 * 리플레이를 재실행해 제출용 {@link ClientResult}(해시 스트림 포함)를 만든다. 결정론이라
 * 같은 리플레이면 항상 같은 값이 나오고, 서버 재실행이 이 값을 그대로 대조한다(ADR-0005).
 */
export function buildClientResult(replay: Replay): ClientResult {
  const res = runReplay(replay);
  const won = res.finalState.victory;
  return {
    attackerWon: won,
    coreDestroyed: won, // 침공 승리 == 코어 파괴(패배 = 시간초과/격추)
    finalTick: replay.inputs.length,
    finalHash: res.finalHash,
    hashStream: res.hashes,
  };
}

// ---------------------------------------------------------------------------
// 정비도 → 침공 config 변환 (순수 · 테스트 대상 — ADR-0006 sim 소비 배선)
// ---------------------------------------------------------------------------

/**
 * DB `defenses.maintenance`(numeric(5,2), 0~100) → sim `InvasionConfig.maintenance`
 * (정수 centi-percent, 0..10000). **공식은 `Math.round(dbMaintenance * 100)` 고정** —
 * 서버 EF(verify-invasion)가 동일 공식으로 재실행 config 를 구성하므로, 여기가 어긋나면
 * 정직한 런이 hashStream 발산으로 오거부된다(리드 계약 2026-07-17).
 *
 * 미지정/비유한(NaN/Infinity)은 `undefined` 를 돌려 config 필드를 아예 싣지 않는다 —
 * sim `normalizeMaintenance` 가 undefined 를 완전 정비(10000)로 정규화하므로 기존 침공
 * 런과 거동·해시가 동일하다(append-only 안전).
 */
export function maintenanceToCenti(dbMaintenance: number | undefined): number | undefined {
  if (dbMaintenance === undefined || !Number.isFinite(dbMaintenance)) return undefined;
  return Math.round(dbMaintenance * 100);
}

// ---------------------------------------------------------------------------
// 배치전 상태 파생 (순수 · 테스트 대상)
// ---------------------------------------------------------------------------

/** 배치전 단계 구분. */
export type PlacementPhase =
  /** 배치전 진행 중(완료 < 총, 미배치). */
  | 'placement'
  /** 배치전 5회 다 치렀으나 아직 순위 삽입 전(연출 대상). */
  | 'completing'
  /** 순위에 삽입 완료(일반 침공 단계). */
  | 'ranked';

/** 서버 응답을 방어적으로 정규화(음수·초과·비정수 클램프). */
export function normalizePlacementStatus(raw: PlacementStatus): PlacementStatus {
  const total = Number.isFinite(raw.total) && raw.total > 0 ? Math.trunc(raw.total) : PLACEMENT_TOTAL;
  const rawDone = Number.isFinite(raw.completed) ? Math.trunc(raw.completed) : 0;
  const completed = Math.max(0, Math.min(total, rawDone));
  const rawWon = Number.isFinite(raw.won) ? Math.trunc(raw.won) : 0;
  const won = Math.max(0, Math.min(completed, rawWon));
  return { completed, won, total, placed: raw.placed === true };
}

/** 현재 배치전 단계(순수). placed면 ranked, 5회 다 채웠으면 completing, 그 외 placement. */
export function placementPhase(status: PlacementStatus): PlacementPhase {
  if (status.placed) return 'ranked';
  if (status.completed >= status.total) return 'completing';
  return 'placement';
}

/** 남은 배치전 횟수(0 이하로 내려가지 않음). */
export function placementRemaining(status: PlacementStatus): number {
  const r = status.total - status.completed;
  return r > 0 ? r : 0;
}

/** 배치전 진행 라벨("배치전 3 / 5"). */
export function placementProgressLabel(status: PlacementStatus): string {
  const s = normalizePlacementStatus(status);
  return `배치전 ${s.completed} / ${s.total}`;
}

// ---------------------------------------------------------------------------
// 재도전 쿨다운 로컬 미러 (순수 · 테스트 대상)
// ---------------------------------------------------------------------------
// 서버가 invasions 최근 행 검사로 1시간 쿨다운을 강제한다(team-plan §2). 클라이언트는
// 그 강제를 "미러"만 한다 — 버튼 비활성·남은 시간 표시. 미러가 없어도 서버가 거부하므로
// 무결성 근거는 서버지 이 저장소가 아니다(치터가 이 값을 지워도 서버가 막는다).

/** 재도전 쿨다운(밀리초) — GDD §8: 1시간. */
export const INVASION_COOLDOWN_MS = 60 * 60 * 1000;

/** 로컬 쿨다운 저장 키(defenderId → 마지막 침공 epoch ms). */
const COOLDOWN_KEY = 'planet-blitz:net:invasionCooldowns';

/** 저장된 쿨다운 맵을 읽는다(손상/부재 시 빈 맵). */
export function readInvasionCooldowns(store: KeyValueStore): Record<string, number> {
  let raw: string | null;
  try {
    raw = store.getItem(COOLDOWN_KEY);
  } catch {
    return {};
  }
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** 특정 방어자에 대한 침공 시각을 기록(기존 맵에 병합, last-write-wins). */
export function recordInvasionAttempt(store: KeyValueStore, defenderId: string, atMs: number): void {
  const map = readInvasionCooldowns(store);
  map[defenderId] = atMs;
  try {
    store.setItem(COOLDOWN_KEY, JSON.stringify(map));
  } catch {
    // 저장 실패는 무해(미러일 뿐 — 서버가 실제 강제).
  }
}

/**
 * 특정 방어자 재도전까지 남은 시간(ms). 쿨다운 지났으면 0(음수 안 나옴). 기록 없으면 0.
 */
export function cooldownRemainingMs(
  cooldowns: Record<string, number>,
  defenderId: string,
  nowMs: number,
  cooldownMs: number = INVASION_COOLDOWN_MS,
): number {
  const last = cooldowns[defenderId];
  if (last === undefined) return 0;
  const remaining = last + cooldownMs - nowMs;
  return remaining > 0 ? remaining : 0;
}

/** 지금 이 방어자를 침공할 수 있는지(쿨다운 미러 기준). */
export function canInvadeTarget(
  cooldowns: Record<string, number>,
  defenderId: string,
  nowMs: number,
  cooldownMs: number = INVASION_COOLDOWN_MS,
): boolean {
  return cooldownRemainingMs(cooldowns, defenderId, nowMs, cooldownMs) === 0;
}

// ---------------------------------------------------------------------------
// 복수전 잔여시간 (순수 · 테스트 대상) — 계약 §F1/AC6
// ---------------------------------------------------------------------------

/** 복수권 창(24h) — GDD §8. 서버 expires_at 의 근거값(표시·검증 정합용 상수). */
export const REVENGE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 복수권 만료까지 남은 시간(ms). 만료됐으면 0(음수 안 나옴). */
export function revengeRemainingMs(expiresAtMs: number, nowMs: number): number {
  if (!Number.isFinite(expiresAtMs)) return 0;
  const remaining = expiresAtMs - nowMs;
  return remaining > 0 ? remaining : 0;
}

/**
 * 복수권 남은시간(ms) → 사람이 읽는 라벨("복수 가능 N시간"/"N분"). 만료면 빈 문자열.
 * 1시간 이상은 시간 단위, 그 미만은 올림한 분 단위로 절박함을 표시한다.
 */
export function formatRevengeRemaining(remainingMs: number): string {
  if (remainingMs <= 0) return '';
  const totalMin = Math.ceil(remainingMs / 60000);
  if (totalMin >= 60) {
    const h = Math.floor(totalMin / 60);
    return `복수 가능 ${h}시간 남음`;
  }
  return `복수 가능 ${totalMin}분 남음`;
}

// ---------------------------------------------------------------------------
// 알림 "마지막 확인 시각" 로컬 저장 + 미확인 카운트 (순수 · 테스트 대상) — 계약 §5
// ---------------------------------------------------------------------------
// 서버는 상태를 안 갖고, 클라이언트가 관제탑에서 침공 결과를 마지막으로 본 시각을
// 로컬에 저장한다. 다음 진입 때 그 시각 이후의 결과 수를 "새 침공 결과 n건"으로 센다.

/** 마지막 확인 시각 저장 키(epoch ms 문자열). */
const SEEN_AT_KEY = 'planet-blitz:net:invasionsSeenAt';

/** 저장된 마지막 확인 시각(epoch ms)을 읽는다. 부재/손상이면 0(=전부 새 결과로 간주). */
export function readInvasionsSeenAt(store: KeyValueStore): number {
  let raw: string | null;
  try {
    raw = store.getItem(SEEN_AT_KEY);
  } catch {
    return 0;
  }
  if (raw === null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** 마지막 확인 시각을 기록한다(관제탑에서 알림을 소비한 직후 호출). */
export function writeInvasionsSeenAt(store: KeyValueStore, atMs: number): void {
  try {
    store.setItem(SEEN_AT_KEY, String(Math.floor(atMs)));
  } catch {
    // 저장 실패는 무해(다음에 같은 결과가 다시 새 것으로 셀 뿐).
  }
}

/** `sinceMs` 이후 생성된(미확인) 침공 결과 수(순수). 서버가 이미 필터해도 이중 방어. */
export function countUnseenInvasions(incoming: readonly IncomingInvasion[], sinceMs: number): number {
  let n = 0;
  for (const inv of incoming) if (inv.createdAtMs > sinceMs) n++;
  return n;
}
