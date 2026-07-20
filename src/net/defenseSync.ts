/**
 * 방어 배치 서버 업로드 계층 (M4 Phase D — 계획 §4, team-plan 계약, AC6 상호 침공 전제).
 *
 * 방어 사령부 에디터(`src/ui/defenseCommand.ts`)가 배치를 저장할 때, 그 배치를 서버
 * `defenses` 테이블에 올려 **타인이 나를 침공 대상으로 매치메이킹**할 수 있게 한다
 * (`get_invasion_targets()` 는 `defenses d ... and d.active` 조인으로 활성 방어가 있는
 * 대상만 제안한다 — 마이그레이션 `20260717010000_m4_phase_d.sql`). 이 배선이 없으면
 * 내 방어가 서버에 존재하지 않아 상호 침공 e2e 가 성립하지 않는다.
 *
 * 규율(기존 net 계층 — config.ts / index.ts / invasion.ts 와 동일):
 *  - Supabase 미설정(env 부재) 시 **완전 no-op** → 공개 함수는 `null` 을 돌려주고 실제
 *    SDK 를 로드하지 않는다(로컬 플레이 100% 유지, 테스트/오프라인 경로 불변).
 *  - 공개 함수는 절대 throw 하지 않는다(오프라인/오류는 삼키고 `null`).
 *  - 실제 SDK 는 설정이 있을 때만 `defenseGateway.js` 를 동적 import 한다 → 미설정
 *    번들/테스트에 `@supabase/supabase-js` 가 실리지 않는다.
 *
 * 업서트 전략(활성 1개 유니크 제약 `defenses_one_active_idx` 대응):
 *  - 기존 활성 방어 행이 있으면 그 행을 **UPDATE**(layout 만). 없으면 **INSERT**(active=true).
 *  - delete→insert 로 갈아끼우지 않는다 — 그러면 풍화된 정비도(maintenance)가 100 으로
 *    리셋되어 ADR-0006(정비도 자가회복 금지)을 우회한다(README Phase D 착수 조건 ②).
 *    UPDATE 는 서버 가드(`guard_defenses_client_write`)가 클라이언트 경로에서 maintenance
 *    를 이전 값으로 고정하므로 정비도가 보존된다.
 *
 * ## M7a — 배치 포인트 예산제 폐지(결정 #14 "슬롯이 곧 예산")
 * 구조는 3레이어({@link InvasionLayers})로 바뀌었고, 서버 게이트도 `defense_layout_cost`
 * 합계 상한(20)에서 **슬롯 수·형식 검증**(`invasion_layers_valid`)으로 교체됐다
 * (마이그레이션 20260721000000). 그래서 이 모듈에 있던 비용 산출 클라 미러도 함께 삭제했다 —
 * 미러가 남아 있으면 폐지된 규칙을 UI 가 계속 강제해 정상 배치가 막힌다
 * (회귀 가드: tests/netDefense.test.ts 가 이 파일에서 그 이름들이 사라졌는지 검사한다).
 * 업로드 직전 {@link normalizeInvasionLayers} 를 한 번 태워 **슬롯 초과분이 서버에 닿기 전에
 * 잘려 나가게** 한다(서버 게이트는 방어선일 뿐, 정상 클라는 애초에 규격을 넘기지 않는다).
 * `budget_spent` 컬럼은 서버에 남아 있으나 의미가 없어 항상 0 을 신고한다.
 */

import { normalizeInvasionLayers } from '../sim/invasion/normalize.js';
import type { InvasionLayers } from '../sim/invasion/types.js';
import { readSupabaseConfig, type SupabaseConfig } from './config.js';

/**
 * 폐지된 예산 컬럼에 싣는 값. 서버 가드가 어차피 0 으로 덮어쓰므로(클라 신고 무시) 이 값은
 * 순전히 컬럼 NOT NULL 을 만족시키기 위한 자리다.
 */
export const DEFENSE_BUDGET_UNUSED = 0;

// ---------------------------------------------------------------------------
// 풍화·정비 파생 (순수 · 테스트 대상 — ADR-0006/0007, 계획 §4 E3)
// ---------------------------------------------------------------------------

/** 주간 풍화 하락폭(ADR-0006 시작값: 정비도 주 -5%p). 서버 pg_cron 과 동일 값. */
export const WEATHERING_DECAY_PER_WEEK = 5;

/** 정비도 경고 수준(낮을수록 강조). */
export type MaintenanceLevel = 'ok' | 'warn' | 'critical';

/**
 * 정비도(0~100) → 경고 수준(순수). 낮을수록 강한 강조:
 *   - >= 70: 'ok'(정상)
 *   - 40 ~ 69: 'warn'(주의 — 정비 권장)
 *   - < 40: 'critical'(위험 — 방어력 크게 저하, 0%면 포탑 50%)
 */
export function maintenanceWarningLevel(maintenance: number): MaintenanceLevel {
  const m = Number.isFinite(maintenance) ? maintenance : 0;
  if (m >= 70) return 'ok';
  if (m >= 40) return 'warn';
  return 'critical';
}

/** 다음 풍화 후 예상 정비도(0 밑으로 안 내려감, 순수). */
export function forecastMaintenance(maintenance: number, decay = WEATHERING_DECAY_PER_WEEK): number {
  const m = Number.isFinite(maintenance) ? Math.max(0, Math.min(100, maintenance)) : 0;
  return Math.max(0, m - decay);
}

/**
 * 하락 예고 알림 문구(순수 · 관제탑/사령부 진입 시 표시). 다음 주간 풍화로 떨어질 정비도를
 * 예고하고, 바닥(0%)에서는 포탑 성능 50% 저하를 경고한다(ADR-0006).
 */
export function weatheringForecastText(maintenance: number): string {
  const m = Number.isFinite(maintenance) ? Math.max(0, Math.min(100, Math.round(maintenance))) : 0;
  const next = forecastMaintenance(m);
  if (m <= 0) {
    return '정비도 0% — 포탑 성능이 50%까지 저하된 상태입니다. 정비로 회복하세요.';
  }
  if (next <= 0) {
    return `다음 풍화 시 정비도 0% 도달 — 포탑 성능 50% 저하 임박. 정비를 권장합니다.`;
  }
  return `다음 풍화 시 정비도 ${next}% 예상(주 -${WEATHERING_DECAY_PER_WEEK}%p). 정비로 100% 회복 가능.`;
}

/** 정비 버튼 상태(순수): 정비 가능 여부 + 비활성 사유. */
export interface RepairButtonState {
  canRepair: boolean;
  /** 비활성 사유(canRepair=true 면 빈 문자열). */
  reason: string;
}

/**
 * 정비 버튼 상태를 계산한다(순수). 우선순위:
 *   1) 이미 100%면 정비 불필요.
 *   2) 크레딧이 비용보다 적으면 부족 안내.
 *   3) 그 외 정비 가능.
 */
export function repairButtonState(maintenance: number, credits: number, cost: number): RepairButtonState {
  const m = Number.isFinite(maintenance) ? maintenance : 0;
  if (m >= 100) return { canRepair: false, reason: '정비도 100% — 정비 불필요' };
  if (!Number.isFinite(credits) || credits < cost) {
    return { canRepair: false, reason: `크레딧 부족(${cost} 필요)` };
  }
  return { canRepair: true, reason: '' };
}

// ---------------------------------------------------------------------------
// 정비 상태 조회·정비 게이트웨이 (계약 §4 — repair_defense RPC)
// ---------------------------------------------------------------------------

/** 내 방어의 정비 상태(정비 UI 표시용). maintenance=null 이면 활성 방어 없음. */
export interface DefenseStatus {
  /** 정비도(0~100). 활성 방어가 없으면 null. */
  maintenance: number | null;
  /** 현재 크레딧 잔액(정비 비용 차감 원천 — profiles.save.credits). */
  credits: number;
  /** 정비 1회 비용(서버 산출 — 시설 규모 반영 가능). */
  repairCost: number;
}

/** 정비 RPC 결과(정비 후 갱신값). */
export interface RepairResult {
  /** 정비 후 크레딧 잔액. */
  credits: number;
  /** 정비 후 정비도(성공 시 100). */
  maintenance: number;
}

// ---------------------------------------------------------------------------
// 업서트 분기 (순수 · 테스트 대상)
// ---------------------------------------------------------------------------

/** 업로드 결과 코드(토스트 표시용). null 은 no-op(미설정) 또는 실패. */
export type DefenseUploadResult = 'inserted' | 'updated' | null;

/** 업서트 계획: 활성 방어 유무로 insert/update 결정. */
export interface DefenseUpsertPlan {
  action: 'insert' | 'update';
  /** update 대상 방어 id(insert 면 null). */
  defenseId: string | null;
}

/**
 * 활성 방어 행 id(없으면 null)로 업서트 분기를 결정한다. 활성 행이 있으면 그 행을
 * UPDATE(정비도 보존), 없으면 INSERT. delete→insert 를 쓰지 않는 이유는 모듈 주석 참조.
 */
export function planDefenseUpsert(existingActiveId: string | null): DefenseUpsertPlan {
  return existingActiveId !== null
    ? { action: 'update', defenseId: existingActiveId }
    : { action: 'insert', defenseId: null };
}

// ---------------------------------------------------------------------------
// 게이트웨이 계약 (테스트에서 fake 주입)
// ---------------------------------------------------------------------------

/** INSERT 페이로드(active 는 게이트웨이가 true 로 고정). */
export interface DefenseInsertPayload {
  /** 정규화된 3레이어 배치(`defenses.layout` jsonb 계약). */
  layout: InvasionLayers;
  /** 폐지된 예산 컬럼({@link DEFENSE_BUDGET_UNUSED} 고정) — 서버가 0 으로 덮어쓴다. */
  budgetSpent: number;
}

/** 방어 업로드 게이트웨이의 실 서버 IO 추상화. */
export interface DefenseGateway {
  /** 익명 세션 보장 + uid 반환. 실패 시 throw. */
  getUserId(): Promise<string>;
  /** uid 의 활성 방어 행 id 를 읽는다(없으면 null). 실패 시 throw. */
  fetchActiveDefenseId(uid: string): Promise<string | null>;
  /** 신규 활성 방어 행 insert(active=true). 실패 시 throw. */
  insertDefense(uid: string, payload: DefenseInsertPayload): Promise<void>;
  /**
   * 기존 방어 행의 layout 을 update(정비도는 서버 가드가 보존). 실패 시 throw.
   * 파라미터를 `unknown` 으로 둔 이유: 실 게이트웨이(defenseGateway.ts)는 이 값을 그대로
   * jsonb 로 흘려보낼 뿐이라 구체 타입을 요구하지 않고, 그래야 3레이어 전환기에 구·신
   * 구현이 동시에 컴파일된다. 실제로 넘어가는 값은 항상 정규화된 {@link InvasionLayers} 다.
   */
  updateDefense(defenseId: string, layout: unknown): Promise<void>;
  /**
   * 내 방어 정비 상태(정비도·크레딧·정비 비용) 조회 — RPC `get_defense_status()`.
   * 구현이 없으면 `undefined`(공개 함수가 no-op null 처리). 실패 시 throw.
   */
  fetchDefenseStatus?(uid: string): Promise<DefenseStatus>;
  /**
   * 정비 실행 — RPC `repair_defense()`(security definer): 크레딧 차감 + maintenance=100 원자.
   * 반환은 정비 후 크레딧·정비도. 구현이 없으면 `undefined`. 실패(크레딧 부족 등) 시 throw.
   */
  repairDefense?(uid: string): Promise<RepairResult>;
}

/** 주입 가능한 의존성(테스트에서 gateway/config 대체). */
export interface DefenseDeps {
  gateway?: DefenseGateway;
  config?: SupabaseConfig | null;
}

// ---------------------------------------------------------------------------
// 게이트웨이 해석 (invasion.ts resolveGateway 와 동일 규율)
// ---------------------------------------------------------------------------

let cachedGateway: DefenseGateway | null = null;
let cachedConfigKey: string | null = null;

/**
 * 이 호출에 쓸 게이트웨이를 해석한다. 주입 gateway 우선, 없으면 설정이 있을 때만
 * SupabaseDefenseGateway 를 동적 생성한다. 미설정이면 null(→ no-op).
 */
async function resolveGateway(deps: DefenseDeps): Promise<DefenseGateway | null> {
  if (deps.gateway !== undefined) return deps.gateway;
  const config = deps.config !== undefined ? deps.config : readSupabaseConfig();
  if (config === null) return null;
  const key = config.url;
  if (cachedGateway !== null && cachedConfigKey === key) return cachedGateway;
  const { SupabaseDefenseGateway } = await import('./defenseGateway.js');
  cachedGateway = new SupabaseDefenseGateway(config);
  cachedConfigKey = key;
  return cachedGateway;
}

// ---------------------------------------------------------------------------
// 공개 API (no-op 가드 · 절대 throw 안 함)
// ---------------------------------------------------------------------------

/**
 * 방어 배치를 서버 `defenses` 에 업로드한다. 활성 방어가 있으면 UPDATE, 없으면 INSERT.
 *
 * 반환:
 *  - `'inserted'` / `'updated'` — 서버 반영 성공(토스트용).
 *  - `null` — 미설정(no-op) 또는 오프라인/오류(로컬 저장은 이미 끝났으므로 침묵 처리).
 *
 * 호출부(defenseCommand.save)는 로컬 저장 후 fire-and-forget 로 부르고, 결과가 오면
 * 토스트만 승격한다. 게임루프·결정론과 무관(메타 동기화).
 */
export async function uploadDefenseLayout(
  rawLayers: unknown,
  deps: DefenseDeps = {},
): Promise<DefenseUploadResult> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return null;
  // 업로드 전 정규화(공유 정본): 슬롯 초과분 절단·손상 슬롯 비움·정수화가 여기서 끝난다.
  // 서버 `invasion_layers_valid` 가 거부할 형태가 애초에 만들어지지 않는다.
  const layout = normalizeInvasionLayers(rawLayers);
  try {
    const uid = await gateway.getUserId();
    const existingId = await gateway.fetchActiveDefenseId(uid);
    const plan = planDefenseUpsert(existingId);
    if (plan.action === 'update') {
      await gateway.updateDefense(plan.defenseId!, layout);
      return 'updated';
    }
    try {
      await gateway.insertDefense(uid, { layout, budgetSpent: DEFENSE_BUDGET_UNUSED });
      return 'inserted';
    } catch (insertErr) {
      // 동시 업로드 레이스(코드리뷰 LOW): 두 세션이 모두 "활성 행 없음"으로 판단해 각자
      // INSERT 하면 늦은 쪽이 `defenses_one_active_idx` 유니크 위반으로 실패한다. 이때
      // 활성 행을 재조회해 존재하면 그 행 UPDATE 로 1회 재시도해 업로드 유실을 막는다.
      // 에러 코드를 파싱하지 않고 재조회로 판별하는 이유: 유니크 위반이 아닌 실패(예산
      // 게이트 거부·네트워크 등)면 재조회도 활성 행이 없어 원래 실패로 수렴하고, 위반
      // 이면 반드시 방금 생긴 활성 행이 보이므로 오분류가 없다(게이트웨이 중립적).
      const racedId = await gateway.fetchActiveDefenseId(uid);
      if (racedId === null) throw insertErr; // 레이스 아님 — 원래 실패를 그대로 전파(→ null)
      await gateway.updateDefense(racedId, layout);
      return 'updated';
    }
  } catch {
    return null;
  }
}

/**
 * 내 방어 정비 상태를 조회한다(정비 UI 표시용). 미설정/오프라인/오류/게이트웨이 미구현이면
 * `null`(→ 정비 UI 는 서버 미설정 안내). 서버 권위 — 클라이언트는 표시만 한다.
 */
export async function fetchDefenseStatus(deps: DefenseDeps = {}): Promise<DefenseStatus | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null || gateway.fetchDefenseStatus === undefined) return null;
  try {
    const uid = await gateway.getUserId();
    return await gateway.fetchDefenseStatus(uid);
  } catch {
    return null;
  }
}

/**
 * 방어 정비를 실행한다(RPC `repair_defense()` — 크레딧 차감 + maintenance=100 원자 처리).
 *
 * 반환:
 *  - {@link RepairResult} — 정비 성공(정비 후 크레딧·정비도). 정비 UI 가 잔액·정비도 갱신.
 *  - `null` — 미설정(no-op)·오프라인·오류(크레딧 부족 등 서버 거부 포함). 정비 UI 는 상태를
 *    다시 조회해 사용자에게 안내한다(서버가 실제 원자성·크레딧 검증을 강제).
 */
export async function repairDefense(deps: DefenseDeps = {}): Promise<RepairResult | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null || gateway.repairDefense === undefined) return null;
  try {
    const uid = await gateway.getUserId();
    return await gateway.repairDefense(uid);
  } catch {
    return null;
  }
}
