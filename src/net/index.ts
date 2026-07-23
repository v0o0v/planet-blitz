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
import { readSupabaseConfig, type SupabaseConfig } from './config.js';
import type { ServerGateway, PveSettleSummary } from './gateway.js';
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
  readPendingSettlements,
  writePendingSettlements,
  stashPendingSettlement,
  type PendingSettlement,
  readPendingGrants,
  writePendingGrants,
  stashPendingGrant,
  type PendingGrant,
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
 * 서버(Supabase)가 설정됐는지 **동기** 판정한다. 주입 gateway 가 있으면 설정된 것으로,
 * 아니면 `readSupabaseConfig()` 로 판정. 재화 정산 분기(온라인=서버 RPC / 미설정=로컬 가산)를
 * 게임루프 밖 정산 시점에서 즉시 가르는 데 쓴다(오프라인 단일플레이 보존).
 */
export function isNetConfigured(deps: NetDeps = {}): boolean {
  if (deps.gateway !== undefined) return true;
  const config = deps.config !== undefined ? deps.config : readSupabaseConfig();
  return config !== null;
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
 * PvE 정산의 **재화 지급**을 서버 권위로 반영한다(ADR-0026/0027 E). 오케스트레이션 규율:
 *  - 이 함수는 **설정(온라인) 경로 전용**이다. 미설정(오프라인 단일플레이)은 호출부(main.ts)가
 *    로컬 미러 가산으로 처리한다 — settleRun 순수 함수는 재화를 만지지 않는다(위조 불가 계약).
 *  - 자원(→credits)·광물(→minerals)은 `settle_pve_run` 으로, 사연 챕터 보상 크레딧은
 *    `grant_currency(source='story')` 로 지급하고, 각 응답의 `credits_left`/`minerals_left` 로
 *    표시 미러(`profile.credits`/`minerals`)를 갱신한다(서버값이 정본).
 *  - 전송 실패 시 요약을 **대기 정산 큐**에 넣어 {@link flushPendingSync} 가 재시도한다(정직한
 *    오프라인 수익 유실 방지). 절대 throw 하지 않음.
 */
export async function settlePveRunCurrency(
  profile: Profile,
  input: { summary: PveSettleSummary; storyRewardCredits: number },
  deps: NetDeps = {},
): Promise<void> {
  const gateway = await resolveGateway(deps);
  const store = deps.store !== undefined ? deps.store : defaultNetStore();
  if (gateway === null || gateway.settlePveRun === undefined) {
    // 설정됐다고 판정했는데 게이트웨이 미해석/구버전이면 손실 방지를 위해 큐잉(다음 기회에 재시도).
    if (store !== null) {
      stashPendingSettlement(store, { summary: input.summary, storyRewardCredits: input.storyRewardCredits });
    }
    return;
  }
  try {
    const res = await gateway.settlePveRun(input.summary);
    profile.credits = res.credits_left;
    profile.minerals = res.minerals_left;
  } catch {
    // settle 전송 실패 — 요약 전체를 큐에 남긴다(story 는 아직 시도조차 안 했으므로 함께).
    if (store !== null) {
      stashPendingSettlement(store, { summary: input.summary, storyRewardCredits: input.storyRewardCredits });
    }
    return;
  }
  // settle 성공 후 사연 보상만 별도 grant. 실패 시 story-only 재시도 항목을 큐에 남긴다
  // (settle 은 이미 성공했으므로 summary=null 로 재settle 을 막는다 — 자원 이중지급 방지).
  if (input.storyRewardCredits > 0 && gateway.grantCurrency !== undefined) {
    try {
      const g = await gateway.grantCurrency(input.storyRewardCredits, 0, 'story');
      profile.credits = g.credits_left;
      profile.minerals = g.minerals_left;
    } catch {
      if (store !== null) {
        stashPendingSettlement(store, { summary: null, storyRewardCredits: input.storyRewardCredits });
      }
    }
  }
}

/** {@link grantCurrencyToServer} 결과. unconfigured=미설정(호출부 로컬 폴백), applied=서버 반영. */
export type GrantOutcome =
  | { status: 'unconfigured' }
  | { status: 'applied'; creditsLeft: number; mineralsLeft: number }
  | { status: 'failed' };

/**
 * 재화 가산(살베지 등)을 서버 `grant_currency` 로 반영한다. 반환 status 로 호출부가 미러를
 * 갱신하거나(applied) 로컬 폴백(unconfigured)을 태운다. 절대 throw 하지 않음.
 */
export async function grantCurrencyToServer(
  credits: number,
  minerals: number,
  source: string,
  deps: NetDeps = {},
): Promise<GrantOutcome> {
  const gateway = await resolveGateway(deps);
  if (gateway === null || gateway.grantCurrency === undefined) return { status: 'unconfigured' };
  try {
    const g = await gateway.grantCurrency(credits, minerals, source);
    return { status: 'applied', creditsLeft: g.credits_left, mineralsLeft: g.minerals_left };
  } catch {
    // 온라인인데 전송 실패 — 재화가 서버 원장에 안 실려 유실되지 않도록 대기 큐에 남긴다(MED-1).
    // 호출부는 'failed' 를 받아 낙관적 로컬 미러 가산을 하되, 정본은 다음 flush 재지급 후
    // fetchProfile 이 맞춘다(살베지 아이템 제거는 이미 반영됐으므로 재화만 회복하면 정합).
    const store = deps.store !== undefined ? deps.store : defaultNetStore();
    if (store !== null && (credits > 0 || minerals > 0)) {
      stashPendingGrant(store, { credits, minerals, source });
    }
    return { status: 'failed' };
  }
}

/** {@link spendCurrencyOnServer} 결과. unconfigured=미설정(로컬 폴백), ok=차감 확정, rejected=잔액부족/오프라인(미적용). */
export type SpendOutcome =
  | { status: 'unconfigured' }
  | { status: 'ok'; creditsLeft: number; mineralsLeft: number }
  | { status: 'rejected' };

/**
 * 재화 차감(리스펙·스태시 확장·어픽스 리롤)을 서버 `spend_currency` 로 확정한다. 서버 권위:
 *  - 미설정(오프라인) → `unconfigured` → 호출부가 기존 로컬 차감으로 폴백(단일플레이 보존).
 *  - 온라인 성공(ok) → `ok` + 갱신 잔액 → 호출부가 효과 적용 + 미러를 서버값으로 세팅.
 *  - 잔액 부족·오프라인/오류 → `rejected` → 호출부는 효과를 적용하지 않는다(위조 차단).
 * 절대 throw 하지 않음.
 */
export async function spendCurrencyOnServer(
  credits: number,
  minerals: number,
  reason: string,
  deps: NetDeps = {},
): Promise<SpendOutcome> {
  const gateway = await resolveGateway(deps);
  if (gateway === null || gateway.spendCurrency === undefined) return { status: 'unconfigured' };
  try {
    const res = await gateway.spendCurrency(credits, minerals, reason);
    if (res.ok) return { status: 'ok', creditsLeft: res.credits_left, mineralsLeft: res.minerals_left };
    return { status: 'rejected' };
  } catch {
    return { status: 'rejected' };
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

  // (1) 대기 정산 큐 + 대기 가산 큐 재지급(재화 서버 권위, ADR-0026 E · MED-1) — 프로필 스냅샷
  //     flush 와 독립적으로 먼저 처리한다. 재화 컬럼이 정본이므로 미러는 다음 fetchProfile 이 맞춘다.
  await flushPendingSettlements(gateway, store);
  await flushPendingGrants(gateway, store);

  // (2) 대기 프로필 스냅샷 flush(다기기 회귀 방지 포함).
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

/**
 * 대기 정산 큐를 서버에 재지급한다. 성공한 항목만 큐에서 빼고, 실패 항목은 남겨 다음
 * 기회에 재시도한다(오프라인 우선). summary=null 항목은 story 보상만 재시도한다(재settle 방지).
 */
async function flushPendingSettlements(gateway: ServerGateway, store: KeyValueStore): Promise<void> {
  const list = readPendingSettlements(store);
  if (list.length === 0) return;
  const remaining: PendingSettlement[] = [];
  for (const entry of list) {
    // settle 확정 후 summary 를 지역적으로 null 로 낮춘다 — 이어지는 story grant 가 실패해
    // 이 항목이 재큐잉돼도 settle 이 두 번 실행돼 자원이 이중 지급되는 것을 막는다(온라인
    // 경로 settlePveRunCurrency 와 동일 규율). settle 자체가 실패하면 summary 는 유지된다.
    let summary = entry.summary;
    try {
      if (summary !== null && gateway.settlePveRun !== undefined) {
        await gateway.settlePveRun(summary);
        summary = null;
      }
      if (entry.storyRewardCredits > 0 && gateway.grantCurrency !== undefined) {
        await gateway.grantCurrency(entry.storyRewardCredits, 0, 'story');
      }
    } catch {
      remaining.push({ summary, storyRewardCredits: entry.storyRewardCredits }); // 재시도 유지(재settle 방지)
    }
  }
  writePendingSettlements(store, remaining);
}

/**
 * 대기 재화 가산 큐를 서버에 재지급한다(MED-1). 성공분만 큐에서 빼고 실패분은 남겨 재시도한다.
 * 각 항목은 독립 grant 라 순서·중복 걱정이 없다(성공 즉시 큐에서 제거되므로 이중 지급 없음).
 */
async function flushPendingGrants(gateway: ServerGateway, store: KeyValueStore): Promise<void> {
  if (gateway.grantCurrency === undefined) return;
  const list = readPendingGrants(store);
  if (list.length === 0) return;
  const remaining: PendingGrant[] = [];
  for (const entry of list) {
    try {
      await gateway.grantCurrency(entry.credits, entry.minerals, entry.source);
    } catch {
      remaining.push(entry); // 재시도 유지
    }
  }
  writePendingGrants(store, remaining);
}
