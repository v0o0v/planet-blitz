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

/** 침공 제출 게이트웨이 입력(공격자 uid 포함 — RLS with_check 강제). */
export interface InvasionSubmitInput {
  attackerId: string;
  defenderId: string;
  defenseId: string | null;
  replay: Replay;
  clientResult: ClientResult;
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
  params: { target: InvasionTarget; replay: Replay; clientResult: ClientResult },
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
