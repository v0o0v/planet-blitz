/**
 * 방어체 인벤토리·강화 네트워크 계층 (M7b · M7b-inventory).
 *
 * 방어 사령부 UI(M7b-command-ui)가 호출하는 공개 진입점. 규율은 기존 net 계층
 * (`cards.ts`·`invasion.ts`·`config.ts`)과 **완전히 동일**하다:
 *  - Supabase 미설정(env 부재) 시 **완전 no-op** → 공개 함수는 `null`(또는 false)을 돌려주고
 *    SDK 를 로드하지 않는다(테스트·오프라인 유지).
 *  - 공개 함수는 **절대 throw 하지 않는다**(오프라인·오류는 삼키고 null).
 *  - 서버가 권위다. 레벨업·승급·리롤은 전부 서버 RPC 가 재화를 차감하고 결과를 확정한다
 *    (`defense_units` 테이블은 클라 select 만 허용 — 쓰기 정책 부재).
 *
 * ## 게이트웨이 주입 방식이 modules.ts 와 다른 이유
 * `modules.ts` 는 `./modulesGateway.js` 를 스스로 동적 import 한다. 이 모듈은 레인 경계 때문에
 * SDK 게이트웨이 구현 파일을 소유하지 않은 채 먼저 만들어졌고, 그래서 대신
 * {@link setDefenseUnitsGatewayFactory} 로 팩토리를 등록받는 형태를 쓴다 —
 *   · 팩토리 미등록 + 설정 있음 → `null`(no-op, throw 없음)
 *   · 팩토리 등록 → 설정으로 게이트웨이 생성 후 캐시
 * 실 구현 `defenseUnitsGateway.ts` 는 이제 존재하며, 부트스트랩(`main.ts`)이 설정이 있을 때만
 * 동적 import 해 팩토리를 등록한다(미설정 번들·테스트에 SDK 가 실리지 않는다).
 *
 * ## 비용은 클라가 계산하지 않는다
 * 표시용 비용은 `data/defenseUnits.ts` 순수 함수로 재현하되(서버와 같은 산식), **차감은 서버**가
 * 한다. 클라가 보낸 금액을 서버가 믿는 경로는 존재하지 않는다.
 */

import { readSupabaseConfig, type SupabaseConfig } from './config.js';
import type { DefenseUnitInstance } from '../../data/defenseUnits.js';

// ---------------------------------------------------------------------------
// 결과 계약 타입 (UI 표시용)
// ---------------------------------------------------------------------------

/**
 * 보관함 소유 방어체 1건(`defense_units` 행).
 * `id` 는 **행 uuid**(강화·배치에 넘기는 참조)로, `DefenseUnitInstance.id`(시드 파생 표시 id)와 다르다.
 */
export interface DefenseUnitOwned {
  /** defense_units.id — 강화·배치 참조용 행 uuid. */
  id: string;
  /** 카탈로그 종류 코드(CATALOG_*). */
  kind: number;
  /** 종류별 카탈로그 인덱스. */
  catalogId: number;
  /** 직렬화된 DefenseUnitInstance(어픽스 표시용). */
  unit: DefenseUnitInstance;
}

/** 보유 설계도 1건(중복 설계도 = 승급·등급 승급 재료). */
export interface BlueprintOwned {
  kind: number;
  catalogId: number;
  /** 보유 장수. */
  count: number;
}

/**
 * 강화 RPC 공통 결과. ok=false 면 `code` 로 사유
 * (not-owned·max-level·max-ascension·insufficient-credits·insufficient-minerals·
 *  insufficient-blueprints·max-rarity 등).
 */
export interface DefenseUnitUpgradeResult {
  ok: boolean;
  /** 갱신된 방어체(성공 시). */
  unit?: DefenseUnitInstance;
  /** 차감 후 서버 잔여 크레딧(성공 시). */
  credits?: number;
  /** 차감 후 서버 잔여 희귀 광물(성공 시). */
  minerals?: number;
  code?: string;
}

/** 게이트웨이 인터페이스(테스트에서 fake 주입). 실 구현은 통합 레인의 defenseUnitsGateway.ts. */
export interface DefenseUnitsGateway {
  getUserId(): Promise<string>;
  /** 보관함 조회(defense_units, RLS 본인). 실패 시 throw. */
  listUnits(): Promise<DefenseUnitOwned[]>;
  /** 설계도 보유 조회(defense_blueprints, RLS 본인). 실패 시 throw. */
  listBlueprints(): Promise<BlueprintOwned[]>;
  /** 레벨업 1단계(크레딧+희귀 광물 차감). */
  levelUp(unitId: string): Promise<DefenseUnitUpgradeResult>;
  /** 승급 1단계(중복 설계도+크레딧 차감). */
  ascend(unitId: string): Promise<DefenseUnitUpgradeResult>;
  /** 방어체 어픽스 리롤(희귀 광물 차감, 서버가 새 시드 부여). */
  rerollAffixes(unitId: string): Promise<DefenseUnitUpgradeResult>;
  /** 설계도로 등급 승급(중복 설계도 차감, 서버가 새 시드로 재롤). */
  promoteRarity(unitId: string): Promise<DefenseUnitUpgradeResult>;
  /** 설계도 1장 → 방어체 제작(신규 인스턴스 생성). */
  craftFromBlueprint(kind: number, catalogId: number): Promise<DefenseUnitUpgradeResult>;
}

/** 주입 가능한 의존성(테스트에서 gateway/config 대체). */
export interface DefenseUnitsDeps {
  gateway?: DefenseUnitsGateway;
  config?: SupabaseConfig | null;
}

/** 설정으로 게이트웨이를 만드는 팩토리(통합 레인이 등록). */
export type DefenseUnitsGatewayFactory = (config: SupabaseConfig) => DefenseUnitsGateway;

// ---------------------------------------------------------------------------
// 게이트웨이 해석 (cards.ts resolveGateway 와 동일 규율 + 팩토리 등록)
// ---------------------------------------------------------------------------

let gatewayFactory: DefenseUnitsGatewayFactory | null = null;
let cachedGateway: DefenseUnitsGateway | null = null;
let cachedConfigKey: string | null = null;

/**
 * Supabase 게이트웨이 팩토리 등록(통합 레인 부트스트랩). 등록 전에는 설정이 있어도 모든 공개
 * 함수가 no-op 이다 — 이 레인이 SDK 구현 파일을 소유하지 않기 때문이며, 의도된 안전 기본값이다.
 */
export function setDefenseUnitsGatewayFactory(factory: DefenseUnitsGatewayFactory | null): void {
  gatewayFactory = factory;
  cachedGateway = null;
  cachedConfigKey = null;
}

/** 테스트 격리용 캐시 초기화(등록된 팩토리는 유지하지 않는다). */
export function resetDefenseUnitsGateway(): void {
  gatewayFactory = null;
  cachedGateway = null;
  cachedConfigKey = null;
}

function resolveGateway(deps: DefenseUnitsDeps): DefenseUnitsGateway | null {
  if (deps.gateway !== undefined) return deps.gateway;
  const config = deps.config !== undefined ? deps.config : readSupabaseConfig();
  if (config === null) return null;
  if (gatewayFactory === null) return null;
  const key = config.url;
  if (cachedGateway !== null && cachedConfigKey === key) return cachedGateway;
  cachedGateway = gatewayFactory(config);
  cachedConfigKey = key;
  return cachedGateway;
}

/** 게이트웨이 호출 공통 래퍼 — 미설정·오류는 전부 `null`(throw 금지 규율의 단일 지점). */
async function call<T>(
  deps: DefenseUnitsDeps,
  fn: (g: DefenseUnitsGateway) => Promise<T>,
): Promise<T | null> {
  const gateway = resolveGateway(deps);
  if (gateway === null) return null;
  try {
    return await fn(gateway);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 공개 API (no-op 가드 · 절대 throw 안 함)
// ---------------------------------------------------------------------------

/** 로그인 uid. 미설정·오프라인·오류면 `null`. */
export async function getDefenseUnitsUserId(deps: DefenseUnitsDeps = {}): Promise<string | null> {
  return call(deps, (g) => g.getUserId());
}

/** 방어체 보관함 조회. 미설정·오프라인·오류면 `null`(UI 는 오프라인 안내). */
export async function listDefenseUnits(
  deps: DefenseUnitsDeps = {},
): Promise<DefenseUnitOwned[] | null> {
  return call(deps, (g) => g.listUnits());
}

/** 설계도 보유 조회. 미설정·오프라인·오류면 `null`. */
export async function listBlueprints(
  deps: DefenseUnitsDeps = {},
): Promise<BlueprintOwned[] | null> {
  return call(deps, (g) => g.listBlueprints());
}

/**
 * 레벨업 1단계. 성공 시 서버가 크레딧·희귀 광물을 차감하고 갱신된 방어체를 돌려준다.
 * 성공 후 `save.credits`·`save.minerals` 는 서버가 진실이므로 호출부가 profileSync 로 pull 한다.
 */
export async function levelUpDefenseUnit(
  unitId: string,
  deps: DefenseUnitsDeps = {},
): Promise<DefenseUnitUpgradeResult | null> {
  return call(deps, (g) => g.levelUp(unitId));
}

/** 승급 1단계(중복 설계도 소모 — 외형 티어가 바뀔 수 있다). 미설정·오류면 `null`. */
export async function ascendDefenseUnit(
  unitId: string,
  deps: DefenseUnitsDeps = {},
): Promise<DefenseUnitUpgradeResult | null> {
  return call(deps, (g) => g.ascend(unitId));
}

/**
 * 방어체 어픽스 리롤(희귀 광물 소모). 서버가 새 `affixSeed` 를 부여하므로 결과 어픽스는
 * 클라가 예측할 수 없다(예측 가능하면 광물 없이 결과만 골라 담을 수 있다).
 */
export async function rerollDefenseUnitAffixes(
  unitId: string,
  deps: DefenseUnitsDeps = {},
): Promise<DefenseUnitUpgradeResult | null> {
  return call(deps, (g) => g.rerollAffixes(unitId));
}

/** 설계도로 등급 승급(unique 는 서버가 `max-rarity` 로 거부). 미설정·오류면 `null`. */
export async function promoteDefenseUnitRarity(
  unitId: string,
  deps: DefenseUnitsDeps = {},
): Promise<DefenseUnitUpgradeResult | null> {
  return call(deps, (g) => g.promoteRarity(unitId));
}

/** 설계도 1장으로 방어체 제작(신규 인스턴스). 미설정·오류면 `null`. */
export async function craftDefenseUnit(
  kind: number,
  catalogId: number,
  deps: DefenseUnitsDeps = {},
): Promise<DefenseUnitUpgradeResult | null> {
  return call(deps, (g) => g.craftFromBlueprint(kind, catalogId));
}
