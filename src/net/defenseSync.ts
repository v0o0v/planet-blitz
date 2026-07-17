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
 *  - budget_spent 는 서버 가드가 layout 에서 재산출(`defense_layout_cost`)하고 예산 상한
 *    (20)을 강제한다 — 클라이언트가 낮춰 신고 불가. INSERT 시엔 정직하게 layout 비용 합계를
 *    함께 신고해(서버가 대조·게이트) 의미를 맞춘다. UPDATE 시엔 layout 만 보낸다.
 */

import {
  TURRET_SPECS,
  TURRET_VULCAN,
  OBSTACLE_COST,
  type DefenseLayout,
} from '../sim/defense.js';
import { readSupabaseConfig, type SupabaseConfig } from './config.js';

// ---------------------------------------------------------------------------
// 비용 산출 (순수 · 서버 defense_layout_cost 와 일치 · 테스트 대상)
// ---------------------------------------------------------------------------

/**
 * 방어 배치 layout 의 배치 포인트 비용 합계. 서버의 `public.defense_layout_cost`(SQL)와
 * **정확히 일치**해야 한다(재번호 금지 계약): 포탑은 `TURRET_SPECS[type].cost`, 범위 밖
 * 유형은 발칸(1)으로 폴백(spawnDefenseTurret·서버 게이트와 동일), 장애물은 개당
 * `OBSTACLE_COST`(1). 코어는 0(참고). INSERT 시 budget_spent 를 정직하게 신고하는 데 쓴다.
 */
export function defenseLayoutCost(layout: DefenseLayout): number {
  const vulcanCost = TURRET_SPECS[TURRET_VULCAN]!.cost;
  let sum = 0;
  for (const t of layout.turrets) {
    const spec = TURRET_SPECS[t.type];
    sum += spec !== undefined ? spec.cost : vulcanCost;
  }
  sum += layout.obstacles.length * OBSTACLE_COST;
  return sum;
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
  layout: DefenseLayout;
  /** 정직하게 신고하는 배치 비용(서버 가드가 재산출·게이트하되 대조용). */
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
  /** 기존 방어 행의 layout 을 update(정비도·예산은 서버 가드가 처리). 실패 시 throw. */
  updateDefense(defenseId: string, layout: DefenseLayout): Promise<void>;
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
  layout: DefenseLayout,
  deps: DefenseDeps = {},
): Promise<DefenseUploadResult> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return null;
  try {
    const uid = await gateway.getUserId();
    const existingId = await gateway.fetchActiveDefenseId(uid);
    const plan = planDefenseUpsert(existingId);
    if (plan.action === 'update') {
      await gateway.updateDefense(plan.defenseId!, layout);
      return 'updated';
    }
    try {
      await gateway.insertDefense(uid, { layout, budgetSpent: defenseLayoutCost(layout) });
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
