/**
 * 네트워크 계층 공개 API(M4 Phase B3 — 계획 §4, AC8).
 *
 * 앱 계층(main.ts)이 호출하는 fire-and-forget 진입점. 규율:
 *  - Supabase 미설정(env 부재) 시 **완전 no-op** — 기존 로컬 플레이 100% 유지.
 *  - 절대 throw 하지 않는다(오프라인/전송 실패는 삼키고 다음 기회에 재시도).
 *  - sim/게임루프와 무관하게 정산 시점에서만 비동기로 호출된다(결정론·오프라인
 *    우선 — 게임플레이 비차단).
 *
 * 실제 Supabase SDK 는 설정이 있을 때만 동적 import 된다 → 미설정 번들/테스트
 * 경로에 SDK 가 실리지 않는다.
 */

import type { Profile, KeyValueStore } from '../save/profile.js';
import type { Replay } from '../sim/replay.js';
import { readSupabaseConfig, type SupabaseConfig } from './config.js';
import type { ServerGateway } from './gateway.js';
import { buildPveRunResult } from './pveRun.js';
import {
  serializeProfile,
  deserializeProfile,
  planServerMigration,
  isMigrated,
  markMigrated,
  stashPendingProfile,
  readPendingProfile,
  clearPendingProfile,
  shouldPushPending,
} from './profileSync.js';

/** 주입 가능한 의존성(테스트에서 gateway/store/config 를 대체). */
export interface NetDeps {
  gateway?: ServerGateway;
  store?: KeyValueStore | null;
  config?: SupabaseConfig | null;
}

/** 설정이 있을 때 한 번 만들어 재사용하는 실 게이트웨이. */
let cachedGateway: ServerGateway | null = null;
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
 * 이 호출에 쓸 게이트웨이를 해석한다. 주입된 gateway 가 있으면 그걸, 아니면 설정이
 * 있을 때만 SupabaseGateway 를 동적 생성한다. 미설정이면 null(→ no-op).
 */
async function resolveGateway(deps: NetDeps): Promise<ServerGateway | null> {
  if (deps.gateway !== undefined) return deps.gateway;
  const config = deps.config !== undefined ? deps.config : readSupabaseConfig();
  if (config === null) return null;
  const key = config.url;
  if (cachedGateway !== null && cachedConfigKey === key) return cachedGateway;
  const { SupabaseGateway } = await import('./gateway.js');
  cachedGateway = new SupabaseGateway(config);
  cachedConfigKey = key;
  return cachedGateway;
}

/**
 * 로컬 Profile 을 서버로 1회 이관(멱등, 무손실). 이미 이관됐으면 스킵, 서버에만
 * 프로필이 있으면 진행도 높은 쪽을 병합해 업로드한다(planServerMigration). 앱 시작
 * 시 fire-and-forget 로 호출.
 */
export async function migrateLocalProfileToServer(
  profile: Profile,
  deps: NetDeps = {},
): Promise<void> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return;
  const store = deps.store !== undefined ? deps.store : defaultNetStore();
  if (store === null) return;
  try {
    const uid = await gateway.getUserId();
    const migrated = isMigrated(store, uid);
    const serverRow = await gateway.fetchProfile(uid);
    const serverProfile = serverRow === null ? null : deserializeProfile(serverRow);
    const plan = planServerMigration(profile, serverProfile, migrated);
    if (plan.action === 'upload') {
      await gateway.upsertProfile(uid, serializeProfile(plan.profile));
    }
    markMigrated(store, uid);
  } catch {
    // 오프라인/일시 오류 — 마커를 남기지 않아 다음 세션에 다시 시도된다.
  }
}

/**
 * 현재 Profile 을 서버로 **무조건 즉시** 업서트한다(진행도 비교 없이 그대로 덮어씀).
 * DEV 하네스 치트가 부여한 재화(크레딧·광물·장비·기체·계보 등 — serializeProfile 이 전부 담는다)를
 * 서버 권위 경로(카드 구매·정비 등이 읽는 profiles.save)에 반영시키는 용도다. 프로덕션 정상 흐름은
 * 진행도 가드가 있는 {@link flushPendingSync}/{@link migrateLocalProfileToServer} 를 쓴다 — 이
 * 함수는 하네스에서만 호출된다(치트로 만든 상태를 서버에 그대로 밀어야 하므로 가드를 두지 않는다).
 * 미설정/오프라인/오류면 완전 no-op(절대 throw 안 함).
 */
export async function pushProfileToServer(profile: Profile, deps: NetDeps = {}): Promise<void> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return;
  try {
    const uid = await gateway.getUserId();
    await gateway.upsertProfile(uid, serializeProfile(profile));
  } catch {
    // 오프라인/일시 오류 — best-effort(다음 치트/저장 때 다시 밀린다).
  }
}

/**
 * PvE 런 정산 결과를 서버에 기록(계획 B3). 정산된 최신 Profile 을 대기 슬롯에 넣고
 * 전송을 시도한다. 실패하면 대기 슬롯에 남아 다음 기회(flushPendingSync)에 재전송
 * 된다(오프라인 우선). 절대 throw 하지 않음.
 */
export async function recordPveRunResult(profile: Profile, deps: NetDeps = {}): Promise<void> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return;
  const store = deps.store !== undefined ? deps.store : defaultNetStore();
  if (store === null) return;
  stashPendingProfile(store, profile);
  await flushPendingSync({ ...deps, gateway, store });
}

/**
 * PvE 런 리플레이(시드·입력 스트림·해시)를 서버 `pve_runs` 에 기록한다(계획 §4 F4 착수
 * 조건 이행 — 리플레이 재실행 샘플링 대상 확보). 집계 세이브 동기화({@link recordPveRunResult})와
 * 별개로, 개별 런 단위 증거를 남겨 서버가 표본을 전수 재실행 검증할 수 있게 한다.
 *
 * 규율: 미설정(env 부재)/게이트웨이 미구현/오프라인/오류면 완전 no-op(절대 throw 안 함).
 * 비차단 fire-and-forget — 정산 직후 호출하되 게임 진행을 막지 않는다. 리플레이 재실행으로
 * 해시 스트림을 만드는 비용은 결정론이라 정확하며(서버 대조와 동일), 오염 런(ADR-0008)은
 * 호출부(main.endRun)가 애초에 이 함수를 부르지 않는다.
 */
export async function recordPveRun(replay: Replay, deps: NetDeps = {}): Promise<void> {
  const gateway = await resolveGateway(deps);
  if (gateway === null || gateway.insertPveRun === undefined) return;
  try {
    const uid = await gateway.getUserId();
    const clientResult = buildPveRunResult(replay);
    await gateway.insertPveRun(uid, { replay, clientResult });
  } catch {
    // 오프라인/일시 오류 — PvE 런 기록은 best-effort(집계 세이브가 별도로 진행도를 보존).
  }
}

/**
 * 대기 중인 프로필 스냅샷을 서버로 밀어넣는다(재시도). 성공 시 대기 슬롯을 비우고,
 * 실패하면 남겨 다음 기회에 재시도한다.
 *
 * 다기기 보강(코드리뷰 MED-6): 무조건 upsert 하지 않고, 먼저 서버 프로필을 재조회해
 * `shouldPushPending` 으로 진행도를 비교한다. 그 사이 다른 기기가 더 진행된 상태를
 * 이미 서버에 올렸다면(예: 오프라인 대기 중 다른 탭/기기에서 플레이) 낡은 로컬
 * 스냅샷으로 덮어쓰지 않고 스킵 — 이때 대기 슬롯도 비운다(서버가 이미 동등 이상이므로
 * 더 이상 밀어야 할 것이 없는 "해소된" 상태).
 */
export async function flushPendingSync(deps: NetDeps = {}): Promise<void> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return;
  const store = deps.store !== undefined ? deps.store : defaultNetStore();
  if (store === null) return;
  const pending = readPendingProfile(store);
  if (pending === null) return;
  try {
    const uid = await gateway.getUserId();
    const serverRow = await gateway.fetchProfile(uid);
    const serverProfile = serverRow === null ? null : deserializeProfile(serverRow);
    if (!shouldPushPending(pending, serverProfile)) {
      clearPendingProfile(store);
      return;
    }
    await gateway.upsertProfile(uid, serializeProfile(pending));
    clearPendingProfile(store);
  } catch {
    // 전송 실패 — 대기 슬롯 유지(재시도).
  }
}
