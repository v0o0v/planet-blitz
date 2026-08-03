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
import { normalizeCatalystArray } from '../data/catalysts.js';
import type { CatalystDrop } from '../data/catalystDrops.js';
import { isGrantCurrencyClientSource } from '../run/commissionServerConstants.js';
import type {
  CommissionGateway,
  CommissionInventoryRow,
  CommissionRunRow,
  CommissionGrantRow,
} from './commissionGateway.js';
import type { CommissionPayload } from '../run/commission.js';
import { runReplay } from '../sim/replay.js';
import type { Replay } from '../sim/replay.js';
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
  readPendingCommissionSubmissions,
  writePendingCommissionSubmissions,
  stashPendingCommissionSubmission,
  removePendingCommissionSubmission,
  type PendingCommissionSubmission,
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
 * 배율 폴링 전용 게이트웨이 해석(ADR-0038). `resolveGateway` 는 모듈 private 이라, 순환 import
 * 없이 `planetMultipliers.ts` 가 같은 캐시된 게이트웨이를 쓰도록 얇게 노출한다. 미설정이면 null.
 */
export async function resolvePlanetMultiplierGateway(
  deps: NetDeps = {},
): Promise<ServerGateway | null> {
  return resolveGateway(deps);
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

/**
 * 거부 사유(ADR-0027 유지 + 사유 구분).
 *  - `insufficient`: 서버 원장이 **잔액 부족**으로 거부(`ok=false`). 서버가 낸 잔액을 함께 싣는다 —
 *    로컬 미러(치트·오프라인 가산으로 부풀 수 있다)와 어긋난 경우를 호출부가 그대로 보여줄 수 있다.
 *  - `unavailable`: 애초에 **판정을 받지 못했다**(오프라인·네트워크 오류·RPC 예외). 잔액과 무관.
 */
export type SpendRejectReason = 'insufficient' | 'unavailable';

/**
 * {@link spendCurrencyOnServer} 결과. unconfigured=미설정(로컬 폴백), ok=차감 확정,
 * rejected=미적용(사유는 {@link SpendRejectReason}).
 *
 * ⚠️ `rejected` 를 한 덩어리로 두면 호출부가 전부 "재화 부족"으로 뭉갠다 — 실제로 오프라인이거나
 * 서버 원장이 로컬 미러와 어긋난 것뿐인데 유저에게는 거짓말이 나간다(하네스 창고 확장 오탐).
 */
export type SpendOutcome =
  | { status: 'unconfigured' }
  | { status: 'ok'; creditsLeft: number; mineralsLeft: number }
  | { status: 'rejected'; reason: 'insufficient'; creditsLeft: number; mineralsLeft: number }
  | { status: 'rejected'; reason: 'unavailable' };

/**
 * 재화 차감(리스펙·스태시 확장·어픽스 리롤)을 서버 `spend_currency` 로 확정한다. 서버 권위:
 *  - 미설정(오프라인) → `unconfigured` → 호출부가 기존 로컬 차감으로 폴백(단일플레이 보존).
 *  - 온라인 성공(ok) → `ok` + 갱신 잔액 → 호출부가 효과 적용 + 미러를 서버값으로 세팅.
 *  - 잔액 부족(`ok=false`) → `rejected/insufficient` + 서버 잔액.
 *  - 오프라인/전송 오류/예외 → `rejected/unavailable`.
 * 두 `rejected` 모두 호출부는 효과를 적용하지 않는다(위조 차단 — 서버 권위 불변).
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
    // 서버가 판정해서 거부했다 = 원장 잔액 부족. 서버 잔액을 실어 호출부가 정확히 말하게 한다.
    return {
      status: 'rejected',
      reason: 'insufficient',
      creditsLeft: res.credits_left,
      mineralsLeft: res.minerals_left,
    };
  } catch {
    // 판정 자체를 못 받았다(오프라인·네트워크·RPC 예외) — 잔액 부족이라고 단정하면 안 된다.
    return { status: 'rejected', reason: 'unavailable' };
  }
}

// ---------------------------------------------------------------------------
// 촉매 시스템(ADR-0029) — 소모(consume)·분해(salvage)·드랍 적립·보유 조회 오케스트레이션
// ---------------------------------------------------------------------------

/**
 * 하네스 전용 촉매 게이트웨이 오버라이드(DEV, ADR-0008·ADR-0029). 설정되면 아래 촉매 4함수
 * (consume/salvage/grant/fetch)가 **실 서버가 없을 때만** 이 게이트웨이로 폴백한다. 존재 이유:
 * 촉매 보유·소모의 정본은 서버 원장이라, 실 Supabase 없이 도는 하네스에서는 4함수가 전부
 * `unconfigured` 로 떨어져 "보유 시드→주입→출격→정산" 정규경로 데모가 아예 성립하지 않는다.
 * 하네스가 인메모리 원장 모의를 주입하면 정규경로 그대로(무촉매 폴백이 아니라 실제 주입 출격)를
 * 관측할 수 있다. `setProfileStoreOverride`(save 계층)와 같은 DEV 오버라이드 문법이다.
 *
 * 프로덕션 안전: 프로덕션 번들은 이 setter 를 절대 호출하지 않으므로(하네스 배선은 DEV 전용
 * 동적 import 라 트리셰이킹) 값이 항상 null → 폴백이 없어 동작 100% 불변. 재화·프로필 경로는
 * 이 폴백을 쓰지 않아(그쪽은 `resolveGateway` 그대로) 로컬 폴백 성질을 유지한다(catalyst 전용).
 */
let harnessCatalystGateway: ServerGateway | null = null;

/** 하네스 촉매 게이트웨이 모의를 설치/해제한다(DEV). null 이면 폴백 없음(기본). */
export function setHarnessCatalystGateway(gateway: ServerGateway | null): void {
  harnessCatalystGateway = gateway;
}

/**
 * 촉매 함수 전용 게이트웨이 해석. 실 서버(주입 gateway 또는 설정된 Supabase)가 있으면 **그것이
 * 언제나 이기고**, 없을 때만 하네스 모의로 폴백한다. 테스트가 `{ gateway }`/`{ config: null }` 을
 * 넘기면 real 이 그 값으로 확정되므로(모의는 기본 null) 기존 계약이 그대로 유지된다.
 */
async function resolveCatalystGateway(deps: NetDeps): Promise<ServerGateway | null> {
  const real = await resolveGateway(deps);
  if (real !== null) return real;
  return harnessCatalystGateway;
}

/** 촉매 보유 원장 스냅샷(catalyst_id → qty). 픽커·관리 UI 표시용. */
export type CatalystInventory = ReadonlyMap<number, number>;

/**
 * `consumeCatalystsOnServer` 결과.
 *  - `unconfigured`: 서버 미설정/구버전 게이트웨이(오프라인) — 호출부가 무촉매 폴백을 태운다.
 *  - `ok`: 소모 확정 — 발급된 `runId`(정산 관통용)·서버 확정 `resourceMult` 를 실어 런을 시작한다.
 *  - `failed`: 온라인인데 소모 거부(슬롯 상한·보유 부족·특산 정합·오프라인/오류). 서버 트랜잭션이
 *    롤백돼 **아이템은 미차감**이므로 호출부는 [재시도]/[촉매 빼고 출격] 을 물으면 된다.
 */
export type ConsumeCatalystOutcome =
  | { status: 'unconfigured' }
  | { status: 'ok'; runId: string; resourceMult: number }
  | { status: 'failed' };

/**
 * 출격 직전 촉매 소모(ADR-0029) — 서버 `consume_catalysts` 로 보유 원장을 차감하고 pending 런 +
 * 영수증을 받는다. 서버 권위 계약(가드레일):
 *  - 미설정/구버전 → `unconfigured`(호출부가 무촉매로 폴백; 촉매는 온라인 전용 = 보유 원장이 서버).
 *  - 성공 → `ok` + runId·resourceMult. runId 를 `buildRunConfig` → `settle_pve_run` 까지 관통시켜
 *    정직한 고배율 런이 개연성 캡에서 절삭되지 않게 한다.
 *  - 실패(예외) → `failed`. **서버 트랜잭션 롤백이라 아이템 미차감** — 클라는 상태를 만지지 않고
 *    보유 재조회만 하면 정합이다(낙관적 로컬 차감을 하지 않는다). 절대 throw 하지 않음.
 * 침공 런은 촉매가 없어 이 경로를 애초에 부르지 않는다.
 */
export async function consumeCatalystsOnServer(
  catalystIds: readonly number[],
  planet: number,
  deps: NetDeps = {},
): Promise<ConsumeCatalystOutcome> {
  const gateway = await resolveCatalystGateway(deps);
  if (gateway === null || gateway.consumeCatalysts === undefined) return { status: 'unconfigured' };
  // 정규화(오름차순·중복 보존·미지 id 제거)는 서버 검증과 동일 정본(catalysts.ts)을 쓴다 — 빈
  // 배열이면 소모할 게 없으므로 폴백으로 되돌린다(무촉매 경로 = consume 미호출 계약).
  const ids = normalizeCatalystArray([...catalystIds]);
  if (ids.length === 0) return { status: 'unconfigured' };
  try {
    // 익명 세션 보장(auth.uid() 필요) — 이미 있으면 즉시 반환된다.
    await gateway.getUserId();
    const res = await gateway.consumeCatalysts(ids, planet);
    return { status: 'ok', runId: res.run_id, resourceMult: res.resource_mult };
  } catch {
    // 소모 거부/오프라인/오류 — 서버 롤백으로 아이템 미차감. 재시도/촉매 제외는 호출부가 결정.
    return { status: 'failed' };
  }
}

/**
 * `salvageCatalystOnServer` 결과. unconfigured=미설정(오프라인·촉매 원장 없음), ok=분해 확정+갱신
 * 잔액, rejected=보유/잔액 부족·오프라인/오류(미차감).
 */
export type SalvageCatalystOutcome =
  | { status: 'unconfigured' }
  | { status: 'ok'; salvaged: number; residue: number; gained: number }
  | { status: 'rejected'; note?: string };

/**
 * 촉매 분해(ADR-0029 · ADR-0042) — 서버 `salvage_catalyst` 로 보유를 차감하고 **촉매 잔재**를
 * 지급받는다. 잔재는 촉매 경제 안에 닫혀 있어 `grant_currency` 캡 파이프를 타지 않는다 —
 * 크레딧·광물은 이 경로에서 더 이상 변하지 않는다.
 * 미설정이면 `unconfigured`(촉매 보유는 서버 원장이라 오프라인 분해는 성립하지 않음). 절대 throw 안 함.
 */
export async function salvageCatalystOnServer(
  catalystId: number,
  qty: number,
  deps: NetDeps = {},
): Promise<SalvageCatalystOutcome> {
  const gateway = await resolveCatalystGateway(deps);
  if (gateway === null || gateway.salvageCatalyst === undefined) return { status: 'unconfigured' };
  try {
    const res = await gateway.salvageCatalyst(catalystId, qty);
    if (!res.ok) return { status: 'rejected', ...(res.note !== undefined ? { note: res.note } : {}) };
    return {
      status: 'ok',
      salvaged: res.salvaged,
      residue: res.residue,
      gained: res.gained,
    };
  } catch {
    return { status: 'rejected' };
  }
}

/**
 * `buyCatalystOnServer` 결과. unconfigured=미설정/구버전(오프라인 — 촉매 상점은 온라인 전용),
 * ok=구매 확정+갱신 잔재, rejected=거부(미차감, `note` 에 서버 사유).
 */
export type BuyCatalystOutcome =
  | { status: 'unconfigured' }
  | { status: 'ok'; bought: number; spent: number; residue: number }
  | { status: 'rejected'; note?: string };

/**
 * 촉매 구매(ADR-0042) — 서버 `buy_catalyst` 로 촉매 잔재를 지불하고 보유 원장에 촉매를 얹는다.
 * 가격 정본은 TS(`catalystBuyPrice`)이고 서버는 시드된 `catalyst_defs.buy_price` 를 조회한다 —
 * **클라가 가격을 보내지 않는다**(위조 표면). 거부는 서버 `note` 를 그대로 실어 화면이 사유를
 * 고를 수 있게 한다. `salvageCatalystOnServer` 와 같은 규율으로 절대 throw 하지 않는다.
 */
export async function buyCatalystOnServer(
  catalystId: number,
  qty: number,
  deps: NetDeps = {},
): Promise<BuyCatalystOutcome> {
  const gateway = await resolveCatalystGateway(deps);
  if (gateway === null || gateway.buyCatalyst === undefined) return { status: 'unconfigured' };
  try {
    const res = await gateway.buyCatalyst(catalystId, qty);
    if (!res.ok) return { status: 'rejected', ...(res.note !== undefined ? { note: res.note } : {}) };
    return { status: 'ok', bought: res.bought, spent: res.spent, residue: res.residue };
  } catch {
    return { status: 'rejected' };
  }
}

/**
 * 촉매 잔재 잔액 조회(ADR-0042) — **프로필 pull 경로**(`fetchProfile` 의 `catalyst_residue`
 * 컬럼)를 그대로 쓴다. 전용 RPC 를 만들지 않는 이유는 `profiles_select_own` 정책이 이미 본인
 * 행 읽기를 허용하기 때문. 미설정/구버전/오류/프로필 부재면 `null` — 호출부가 "아직 모름"으로
 * 구분해 `catalyst.shop.noProfile` 안내를 낼 수 있다. 절대 throw 하지 않는다.
 */
export async function fetchCatalystResidueOnline(deps: NetDeps = {}): Promise<number | null> {
  const gateway = await resolveCatalystGateway(deps);
  if (gateway === null) return null;
  try {
    const uid = await gateway.getUserId();
    const row = await gateway.fetchProfile(uid);
    if (row === null || row.catalystResidue === undefined) return null;
    return row.catalystResidue;
  } catch {
    return null;
  }
}

/**
 * 촉매 드랍 적립(ADR-0029) — 정산이 파생한 촉매 드랍 목록을 서버 `grant_catalyst` 로 본인 원장에
 * 얹는다(적립 총 건수 반환). 규율은 `grantBlueprintDrops` 와 동일한 **fire-and-forget**:
 *  - 미설정/구버전/오프라인/오류 → 0(재시도 큐 없음 — 드랍은 다음 런에서 다시 나온다).
 *  - 절대 throw 하지 않는다(정산은 오프라인에서도 끝나야 한다).
 */
export async function grantCatalystDrops(
  drops: readonly CatalystDrop[],
  deps: NetDeps = {},
): Promise<number> {
  if (drops.length === 0) return 0;
  const gateway = await resolveCatalystGateway(deps);
  if (gateway === null || gateway.grantCatalyst === undefined) return 0;
  let granted = 0;
  for (const d of drops) {
    if (d.qty <= 0) continue;
    try {
      // 서버가 per-call·누적 캡으로 절삭할 수 있으므로(ADR-0042 Follow-up ⓐ) 요청량이 아니라
      // 서버가 돌려준 실적립량을 센다. 구버전 서버는 granted 를 안 주므로 요청량으로 폴백한다.
      const res = await gateway.grantCatalyst(d.id, d.qty);
      granted += res.granted !== undefined ? res.granted : d.qty;
    } catch {
      // 개별 실패는 삼킨다(부분 적립 허용 — 다음 런에서 다시 나온다). 다음 드랍 계속.
    }
  }
  return granted;
}

/**
 * 촉매 보유 원장 조회(ADR-0029). 온라인이면 `catalyst_inventory` 를 읽어 catalyst_id→qty 맵을
 * 낸다. 미설정/구버전/오프라인/오류면 `null`(→ 호출부가 빈 보유로 취급 = 주입 불가). throw 안 함.
 */
export async function fetchCatalystInventoryOnline(
  deps: NetDeps = {},
): Promise<CatalystInventory | null> {
  const gateway = await resolveCatalystGateway(deps);
  if (gateway === null || gateway.fetchCatalystInventory === undefined) return null;
  try {
    await gateway.getUserId();
    const rows = await gateway.fetchCatalystInventory();
    const map = new Map<number, number>();
    for (const row of rows) {
      if (row.qty > 0) map.set(row.catalyst_id, row.qty);
    }
    return map;
  } catch {
    return null;
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
 *
 * ⚠️ **allowlist 필터(의뢰서 서버 계약 §5-1 회귀 절 · AC-C10)** — `grant_currency` 가
 * `('pve_run','salvage','story')` 외의 `source` 를 전부 예외로 거부하도록 바뀐다(마이그레이션,
 * default-deny). `PendingGrant.source` 는 localStorage 에서 온 `string` 이라(profileSync.ts) 조작·
 * 구버전 항목이 섞여 있으면 그 항목은 이제 매번 예외를 맞아 아래 catch 로 떨어져 **재큐잉되고
 * 무한 재시도로 고인다**(이전에는 서버가 미등록 source 를 `CAP_DEFAULT_*` 로 조용히 캡해 문제가
 * 안 보였다). 그래서 **보내기 전에 같은 allowlist 로 걸러**, 벗어난 항목은 재큐잉하지 않고
 * 폐기한다 — 정상 데이터(`'salvage'`·`'story'`)는 전부 허용 집합 안이라 무영향이다.
 */
async function flushPendingGrants(gateway: ServerGateway, store: KeyValueStore): Promise<void> {
  if (gateway.grantCurrency === undefined) return;
  const list = readPendingGrants(store);
  if (list.length === 0) return;
  const remaining: PendingGrant[] = [];
  for (const entry of list) {
    if (!isGrantCurrencyClientSource(entry.source)) continue; // allowlist 밖 — 폐기(재큐잉 안 함)
    try {
      await gateway.grantCurrency(entry.credits, entry.minerals, entry.source);
    } catch {
      remaining.push(entry); // 재시도 유지
    }
  }
  writePendingGrants(store, remaining);
}

// ---------------------------------------------------------------------------
// 의뢰서(Commission) — 지시 수신소 오케스트레이션 (계획 §Phase E · 서버 계약 §5)
// ---------------------------------------------------------------------------

/** 주입 가능한 의존성(테스트에서 CommissionGateway 를 대체). `resolveGateway` 계열과 별개 캐시다 —
 * `CommissionGateway` 는 `ServerGateway` 와 다른 인터페이스라 같은 캐시를 못 쓴다. */
export interface CommissionNetDeps {
  gateway?: CommissionGateway;
  config?: SupabaseConfig | null;
}

let cachedCommissionGateway: CommissionGateway | null = null;
let cachedCommissionConfigKey: string | null = null;

/** 이 호출에 쓸 의뢰서 게이트웨이를 해석한다. 미설정이면 null(→ 호출부가 오프라인 취급). */
async function resolveCommissionGateway(deps: CommissionNetDeps): Promise<CommissionGateway | null> {
  if (deps.gateway !== undefined) return deps.gateway;
  const config = deps.config !== undefined ? deps.config : readSupabaseConfig();
  if (config === null) return null;
  const key = config.url;
  if (cachedCommissionGateway !== null && cachedCommissionConfigKey === key) return cachedCommissionGateway;
  const { SupabaseCommissionGateway } = await import('./commissionGateway.js');
  cachedCommissionGateway = new SupabaseCommissionGateway(config);
  cachedCommissionConfigKey = key;
  return cachedCommissionGateway;
}

/**
 * RPC 예외 메시지를 사람이 읽을 문자열로 뽑는다. 의뢰서 RPC 는 거부 사유를 구조화된 `note` 가
 * 아니라 **예외 메시지 그대로**로 낸다(서버 계약 §5-2·§5-3 — `consume_commission: 출격 빈도
 * 상한 초과` 등, 전부 이미 한글이다). 그래서 여기서는 매핑표를 두지 않고 서버 문구를 그대로
 * 화면에 옮긴다 — 고정 사유 집합을 만들면 서버가 새 거부 문구를 추가할 때마다 클라도 함께
 * 갱신해야 하는 이중 정본이 생긴다.
 */
function commissionErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message !== '') return err.message;
  return String(err);
}

/** 지시 수신소의 미소비 의뢰서 목록 조회. 미설정/오프라인/오류면 `null`(오프라인 취급). */
export async function fetchCommissionInventoryOnline(
  deps: CommissionNetDeps = {},
): Promise<CommissionInventoryRow[] | null> {
  const gateway = await resolveCommissionGateway(deps);
  if (gateway === null) return null;
  try {
    await gateway.getUserId();
    return await gateway.fetchCommissionInventory();
  } catch {
    return null;
  }
}

/** 본인 의뢰 런 이력 조회(뷰 경유). 미설정/오프라인/오류면 `null`. */
export async function fetchCommissionRunsOnline(
  limit: number,
  deps: CommissionNetDeps = {},
): Promise<CommissionRunRow[] | null> {
  const gateway = await resolveCommissionGateway(deps);
  if (gateway === null) return null;
  try {
    await gateway.getUserId();
    return await gateway.fetchCommissionRuns(limit);
  } catch {
    return null;
  }
}

/** 본인 의뢰 확정 지급물 이력 조회(ADR-0045). 미설정/오프라인/오류면 `null`. */
export async function fetchCommissionGrantsOnline(
  deps: CommissionNetDeps = {},
): Promise<CommissionGrantRow[] | null> {
  const gateway = await resolveCommissionGateway(deps);
  if (gateway === null) return null;
  try {
    await gateway.getUserId();
    return await gateway.fetchCommissionGrants();
  } catch {
    return null;
  }
}

/**
 * `consumeCommissionOnServer` 결과.
 *  - `unconfigured`: 서버 미설정(오프라인) — 의뢰서는 온라인 전용이라 출격 자체가 불가하다.
 *  - `ok`: 소모 확정 — `runId`·서버 원장 `payload`(발령 시점에 굳은 종이).
 *  - `rejected`: 거부(서버 예외 메시지 그대로 — 빈도 상한·의뢰서 없음 등). 미차감.
 */
export type ConsumeCommissionOutcome =
  | { status: 'unconfigured' }
  | { status: 'ok'; runId: string; payload: CommissionPayload }
  | { status: 'rejected'; reason: string };

/**
 * 출격(서버 계약 §5-2) — 의뢰서를 소모하고 `commission_runs` 행을 만든다. `loadout` 은
 * {@link commissionSealedLoadout}(runConfig.ts)로 뽑은 값을 그대로 넘겨야 한다 — 여기서
 * 다시 계산하지 않는다(단일 정본은 호출부의 책임). 절대 throw 하지 않는다.
 */
export async function consumeCommissionOnServer(
  commissionId: string,
  loadout: unknown,
  deps: CommissionNetDeps = {},
): Promise<ConsumeCommissionOutcome> {
  const gateway = await resolveCommissionGateway(deps);
  if (gateway === null) return { status: 'unconfigured' };
  try {
    await gateway.getUserId();
    const res = await gateway.consumeCommission(commissionId, loadout);
    return { status: 'ok', runId: res.runId, payload: res.payload };
  } catch (err) {
    return { status: 'rejected', reason: commissionErrorMessage(err) };
  }
}

/**
 * `discardCommissionOnServer` 결과.
 *  - `unconfigured`: 서버 미설정(오프라인) — 의뢰서는 온라인 전용이라 폐기도 불가하다.
 *  - `ok`: 원장에서 지워졌다. `held` 는 **서버가 센** 폐기 후 보유 수.
 *  - `rejected`: 거부(서버 예외 메시지 그대로 — 빈도 상한·의뢰서 없음 등). **미삭제**다.
 */
export type DiscardCommissionOutcome =
  | { status: 'unconfigured' }
  | { status: 'ok'; held: number }
  | { status: 'rejected'; reason: string };

/**
 * 폐기(2026-08-03) — 미소비 의뢰서 1장을 서버 원장에서 지운다. 절대 throw 하지 않는다.
 *
 * ⚠️ **되돌릴 수 없다.** 호출부는 반드시 확인을 받은 뒤에만 부른다(지시 수신소의 폐기 팝업).
 * 성공해도 클라가 목록을 손으로 깎지 않는다 — 원장을 **다시 읽는다**(감산하면 서버 상태와
 * 갈리는 두 번째 진실이 생기고, 갈리는 날 어느 쪽이 정본인지 화면이 말할 수 없다).
 */
export async function discardCommissionOnServer(
  commissionId: string,
  deps: CommissionNetDeps = {},
): Promise<DiscardCommissionOutcome> {
  const gateway = await resolveCommissionGateway(deps);
  if (gateway === null) return { status: 'unconfigured' };
  try {
    await gateway.getUserId();
    const res = await gateway.discardCommission(commissionId);
    return { status: 'ok', held: res.held };
  } catch (err) {
    return { status: 'rejected', reason: commissionErrorMessage(err) };
  }
}

/**
 * `markCommissionActiveOnServer` 결과. `rejected` 는 **클라가 복구를 지시하지 않는다** —
 * 신호를 못 보낸 채로 두는 것이 곧 회수 조건이고, 회수는 cron 만 한다(계획 pre-mortem ④,
 * D8). 그래서 실패 시 호출부는 안내만 하고 별도 재시도·복구 RPC 를 부르지 않는다.
 */
export type MarkCommissionActiveOutcome =
  | { status: 'unconfigured' }
  | { status: 'ok'; startedAtMs: number }
  | { status: 'rejected'; reason: string };

/** 런 시작 신호(서버 계약 §5-3). 절대 throw 하지 않는다. */
export async function markCommissionActiveOnServer(
  runId: string,
  deps: CommissionNetDeps = {},
): Promise<MarkCommissionActiveOutcome> {
  const gateway = await resolveCommissionGateway(deps);
  if (gateway === null) return { status: 'unconfigured' };
  try {
    const res = await gateway.markCommissionActive(runId);
    return { status: 'ok', startedAtMs: res.startedAtMs };
  } catch (err) {
    return { status: 'rejected', reason: commissionErrorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// 의뢰 런 제출(verify-commission, 서버 계약 §7) — "저장은 되는데 런에 안 닿는다" 폐쇄
// ---------------------------------------------------------------------------

/**
 * 리플레이 → 제출용 `claim`(`RunClaim` 형, `verify-run/verifyCore.ts` 계약). **원본 config 로
 * 만든 `Replay` 를 그대로 재실행한다** — `world.config`(파생 사본)를 실으면 재실행이 실제
 * 플레이와 달라지는 결함을 이 저장소가 이미 겪었다(PR#191, `main.ts:1308-1325` 주석 정본).
 * 호출부(`main.ts`)가 `recorder.toReplay()`(= 원본 config)를 그대로 넘기는 한 이 함수는
 * 안전하다. 순수·결정론이라 같은 리플레이는 항상 같은 claim 을 낸다(ADR-0005).
 */
export function buildCommissionClaim(
  replay: Replay,
): { finalHash: number; hashStream: readonly number[]; outcome: { victory: boolean; gameOver: boolean } } {
  const res = runReplay(replay);
  return {
    finalHash: res.finalHash,
    hashStream: res.hashes,
    outcome: { victory: res.finalState.victory, gameOver: res.finalState.gameOver },
  };
}

/**
 * `submitCommissionRun` 결과.
 *  - `unconfigured`: 서버 미설정(오프라인) — 의뢰서는 온라인 전용이라 제출 자체가 불가하다.
 *  - `verified`: 서버가 승인·지급을 확정했다. `creditsLeft`/`mineralsLeft` 가 정본(그대로
 *    미러에 세팅한다). `grants` 는 확정 지급물(유니크·설계도) 원시 배열(계약 §7-4).
 *  - `rejected`: 서버가 최종 거부했다(패배 런·위조 등). **재시도하지 않는다** — 확정 판정이다.
 *  - `queued`: 판정 자체를 못 받았다(오프라인·EF 5xx·타임아웃). 대기 큐에 남아 다음 기회에
 *    같은 `run_id` 로 재시도된다(계약 §5-4 재시도 주체 = 클라이언트).
 */
export type SubmitCommissionOutcome =
  | { status: 'unconfigured' }
  | {
      status: 'verified';
      grantedCredits: number;
      grantedMinerals: number;
      creditsLeft: number;
      mineralsLeft: number;
      grants: readonly unknown[];
    }
  | { status: 'rejected'; reason?: string }
  | { status: 'queued' }
  /**
   * 판정을 못 받았고 **대기 큐 저장까지 실패**했다(localStorage 쿼터 초과 등). `queued` 와 달리
   * 재시도 기회가 없다 — 화면은 이 둘을 다르게 말해야 한다(전자는 "나중에 다시 시도됨",
   * 후자는 "제출하지 못했다").
   */
  | { status: 'lost' };

/**
 * 의뢰 런 리플레이 제출(계약 §7). **먼저 대기 큐를 흘려보낸 뒤**(이전 세션에서 판정을 못 받은
 * 제출이 있으면 같이 재시도) 이번 런을 제출한다 — 두 시도를 순서 없이 병렬로 쏘면 같은
 * `run_id` 가 동시에 두 번 카운트돼 `CAP_VERIFY_ATTEMPTS`(5)를 불필요하게 태운다.
 *
 * ⚠️ **런 시작 실패(`markCommissionActiveOnServer`) 규율과 혼동하지 마라** — 그쪽은 신호를
 * 안 보내는 것 자체가 회수 조건이라 클라가 아무것도 하지 않는다. 이쪽(제출)은 **정반대**다 —
 * 판정을 못 받으면 클라가 반드시 재시도해야 확정 지급물이 증발하지 않는다.
 */
export async function submitCommissionRun(
  runId: string,
  replay: Replay,
  deps: CommissionNetDeps & { store?: KeyValueStore | null } = {},
): Promise<SubmitCommissionOutcome> {
  const gateway = await resolveCommissionGateway(deps);
  if (gateway === null) return { status: 'unconfigured' };
  const store = deps.store !== undefined ? deps.store : defaultNetStore();
  // ⚠️ `.catch` 가 필요하다 — 공유 promise 라 한 번의 reject 가 **모든 대기자**에게 번진다.
  //    여기서 throw 하면 `submitCommissionReplay` 에 catch 가 없고 `commissionRunId` 는 이미
  //    소비된 뒤라, 이번 런이 큐에도 안 남고 오버레이가 '확인 중…' 에 영구 고착한다.
  if (store !== null) await flushCommissionQueueOnce(gateway, store).catch(() => undefined);
  const config = replay.config;
  if (config === undefined) {
    // 의뢰 런은 항상 명시적 config 로 조립된다(startCommissionRun) — 여기 도달하면 호출부
    // 버그이지 전송 실패가 아니므로 큐잉하지 않는다(재시도해도 같은 결함이 반복된다).
    return { status: 'rejected', reason: 'client-malformed-replay' };
  }
  const claim = buildCommissionClaim(replay);
  const submission = { seed: replay.seed, config, inputs: replay.inputs, claim };
  try {
    const res = await gateway.verifyCommission(runId, submission);
    if (store !== null) removePendingCommissionSubmission(store, runId);
    if (res.accepted) {
      return {
        status: 'verified',
        grantedCredits: res.grantedCredits ?? 0,
        grantedMinerals: res.grantedMinerals ?? 0,
        creditsLeft: res.creditsLeft ?? 0,
        mineralsLeft: res.mineralsLeft ?? 0,
        grants: res.grants ?? [],
      };
    }
    return { status: 'rejected', ...(res.reason !== undefined ? { reason: res.reason } : {}) };
  } catch {
    // 전송 실패 — 판정을 못 받았다. 대기 큐에 남긴다(재시도 주체 = 클라이언트, 계약 §5-4).
    if (store !== null) {
      // ⚠️ `hashStream` 은 **저장하지 않는다** — 45,000틱이면 그 배열만 ~0.5MB 라 쿼터를
      //    잡아먹는데, `verifyRun` 은 이 필드를 optional 로 받는다(없으면 조기 발산 인덱스만
      //    못 받고 finalHash·outcome 대조는 그대로 성립한다). 재해싱 비용보다 쿼터가 비싸다.
      const stash = stashPendingCommissionSubmission(store, {
        runId,
        seed: replay.seed,
        config,
        inputs: replay.inputs,
        claim: { finalHash: claim.finalHash, outcome: claim.outcome },
      });
      // ⚠️ 저장이 실패했으면(쿼터 초과 등) **재시도 기회가 없다** — 화면에 'queued'(나중에 다시
      //    시도됨)를 보여주면 거짓말이 된다. 이 함수의 존재 이유가 확정 지급물 증발 방지이므로
      //    구분해서 알린다.
      if (!stash.stored) return { status: 'lost' };
      // ⚠️ 밀려난 대기 항목은 **재시도 기회를 잃었다** — 그 런들은 24h 뒤 cron 이 `abandoned`
      //    로 종결하고 의뢰서는 회수되지 않는다. 조용히 넘기면 플레이어에게 남는 신호가 0 이다.
      if (stash.dropped > 0) {
        console.warn(
          `[commission] 대기 큐가 가득 차 이전 제출 ${stash.dropped}건이 폐기됐다 — 그 런들의 보상은 지급되지 않는다`,
        );
      }
    }
    return { status: 'queued' };
  }
}

/**
 * 대기 의뢰 제출 큐를 흘려보낸다(부팅 시 + 매 제출 직전). 각 항목은 이미 계산해 둔 `claim`
 * 을 그대로 재전송한다 — 재계산하지 않는다(결정론이라 같은 값이지만, 다구간 긴 리플레이의
 * 재해싱 비용을 아낀다). 응답을 받으면(accept·reject 무관) 최종 판정이므로 큐에서 뺀다.
 * 전송 자체가 다시 실패하면 큐에 남겨 다음 기회로 미룬다.
 */
/**
 * 진행 중인 flush. **중복 실행을 막는 유일한 장치다.**
 *
 * ⚠️ 부팅 flush(`flushPendingCommissionSubmissions`)가 아직 도는 중에 의뢰 런이 끝나면
 * `submitCommissionRun` 이 같은 큐를 다시 흘린다. 두 flush 는 각자 마지막에
 * `writePendingCommissionSubmissions(store, remaining)` 로 **큐 전체를 덮어쓰므로**
 * ① 같은 항목이 두 번 전송돼 `CAP_VERIFY_ATTEMPTS`(5) 중 2를 헛되이 태우고
 * ② 늦게 끝난 쪽이 이미 제거된 항목을 **되살린다**(그 항목은 다음 부팅에 또 전송된다).
 * 결정론적이지 않아 재현이 어렵고 증상은 "가끔 보상이 두 번 확인된다" 정도라 진단이 힘들다.
 */
let commissionFlushInFlight: Promise<void> | null = null;
/** {@link commissionFlushInFlight} 가 어느 저장소를 흘리고 있는가(공유 판정 키). */
let commissionFlushStore: KeyValueStore | null = null;

/**
 * {@link flushPendingCommissionQueue} 를 중복 없이 돌린다(이미 돌고 있으면 그것을 기다린다).
 *
 * ⚠️ **같은 `store` 에 대해서만 공유한다.** 초판은 인자를 안 보고 무조건 진행 중 promise 를
 * 돌려줬는데, 그러면 다른 store 로 부른 호출자가 남의 flush 를 기다린 뒤 **자기 큐는 안 흘리고**
 * 넘어간다. 프로덕션은 둘 다 `defaultNetStore()` 라 지금은 안 터지지만 그건 계약이 아니라
 * 우연이고, 테스트는 매번 다른 in-memory store 를 쓴다.
 */
function flushCommissionQueueOnce(gateway: CommissionGateway, store: KeyValueStore): Promise<void> {
  if (commissionFlushInFlight !== null && commissionFlushStore === store) {
    return commissionFlushInFlight;
  }
  commissionFlushStore = store;
  const p = flushPendingCommissionQueue(gateway, store).finally(() => {
    commissionFlushInFlight = null;
    commissionFlushStore = null;
  });
  commissionFlushInFlight = p;
  return p;
}

async function flushPendingCommissionQueue(
  gateway: CommissionGateway,
  store: KeyValueStore,
): Promise<void> {
  const list = readPendingCommissionSubmissions(store);
  if (list.length === 0) return;
  const remaining: PendingCommissionSubmission[] = [];
  for (const entry of list) {
    try {
      await gateway.verifyCommission(entry.runId, {
        seed: entry.seed,
        config: entry.config,
        inputs: entry.inputs,
        claim: entry.claim,
      });
      // 응답을 받았다 — 성공/거부 무관 최종 판정. 이 큐는 "제출"만 보증한다. 그 판정이 실은
      // 재화·지급 반영은 이 함수의 책임이 아니다(호출부가 이미 화면을 떠났을 수 있다) — 다음
      // 서버 응답(다음 런 정산 등)이 `credits_left` 로 미러를 다시 맞춘다.
    } catch {
      remaining.push(entry); // 재시도 유지
      continue;
    }
  }
  writePendingCommissionSubmissions(store, remaining);
}

/**
 * 앱 부팅 시 대기 의뢰 제출 큐를 흘려보내는 진입점. 지난 세션에서 판정을 못 받은 채(탭 종료·
 * 크래시) 남은 제출이 있으면 여기서 회수를 시도한다 — `submitCommissionRun` 자체도 매 제출
 * 직전 같은 큐를 흘리지만, 그 사이 다음 의뢰 런을 아예 안 도는 세션에서는 이 진입점이 유일한
 * 재시도 기회다. 미설정/오프라인이면 조용히 no-op(다음 부팅에 재시도). 절대 throw 하지 않는다.
 */
export async function flushPendingCommissionSubmissions(
  deps: CommissionNetDeps & { store?: KeyValueStore | null } = {},
): Promise<void> {
  const gateway = await resolveCommissionGateway(deps);
  if (gateway === null) return;
  const store = deps.store !== undefined ? deps.store : defaultNetStore();
  if (store === null) return;
  await flushCommissionQueueOnce(gateway, store);
}
