/**
 * 계보·수호 기체 네트워크 계층 — 서버 권위 배선 (ADR-0007 · 2026-08-03).
 *
 * 규율은 기존 net 파사드(`defenseUnits.ts` · `modules.ts` · `config.ts`)와 **완전히 동일**하다:
 *  - Supabase 미설정(env 부재)·팩토리 미등록 시 **완전 no-op** → 공개 함수는 `null` 을 돌려주고
 *    SDK 를 로드하지 않는다(테스트·오프라인 번들 유지).
 *  - 공개 함수는 **절대 throw 하지 않는다**(오프라인·오류는 삼키고 `null`).
 *  - 서버가 권위다. 계보 포인트/레벨과 수호 기체 행은 전부 서버 RPC 만 쓴다
 *    (`profiles.lineage_*` 는 트리거가 클라 직접 쓰기를 막고, `guardians` 는 select/update 만
 *    허용된다).
 *
 * ## 왜 파사드가 따로 필요한가 — 게이트웨이는 이미 있었는데 아무도 안 썼다
 * `SupabaseGuardianGateway`(`guardianGateway.ts`)는 2026-07 부터 있었지만 **import 하는
 * 프로덕션 코드가 0건**이었다. 화면이 SDK 게이트웨이를 직접 잡으면 미설정 번들에 SDK 가 실리고
 * 오프라인 분기가 화면마다 흩어진다. 이 파사드가 그 둘을 한 자리에 모은다.
 *
 * ## 오프라인은 폴백이 아니라 **잠금**이다
 * 재화(`grant_currency`)는 대기 큐로 오프라인 조작을 나중에 반영하지만, 계보는 그 길을 쓰지
 * 않는다(사용자 결정 2026-08-03). 이유: 계보 소비는 **되돌릴 수 없고**(리스펙 없음) 수호 소멸은
 * 서버 행을 지운다 — 오프라인에서 낙관적으로 진행한 뒤 서버가 거부하면 되돌릴 수단이 없다.
 * 그래서 화면이 {@link isLineageOnline} 로 먼저 묻고, 오프라인이면 버튼을 잠근 채 이유를 적는다.
 */

import { readSupabaseConfig, type SupabaseConfig } from './config.js';
import type { GuardianSnapshot } from '../../data/guardian.js';
import type { GuardianBuild } from '../save/profile.js';
import type { LineageBranch } from '../../data/lineage.js';
import type { ServerGuardian, ServerLineage } from './guardianGateway.js';

export type { ServerGuardian, ServerLineage };

/**
 * 게이트웨이 인터페이스(테스트에서 fake 주입). 실 구현은 `guardianGateway.ts` 의
 * `SupabaseGuardianGateway` 이며 이 셰이프를 이미 만족한다.
 */
export interface LineageGateway {
  getUserId(): Promise<string>;
  /** 본인 수호 기체 전량(guardians, RLS 본인). 실패 시 throw. */
  fetchGuardians(uid: string): Promise<ServerGuardian[]>;
  /** 본인 계보 상태(profiles 컬럼). 실패 시 throw. */
  fetchLineage(uid: string): Promise<ServerLineage>;
  /** 퇴역 → 수호 행 생성 + 계보 기본 지급. 반환: {guardianId, granted}. */
  retireShip(
    preset: number,
    combatScore: number,
    snapshot: GuardianSnapshot,
    build?: GuardianBuild,
  ): Promise<{ guardianId: string; granted: number }>;
  /** 소멸 → 계보 포인트 회수. 반환: 회수 포인트. */
  dismissGuardian(guardianId: string): Promise<number>;
  /** 계보 1레벨 투자. 반환: {level, points}. */
  investLineage(branch: LineageBranch): Promise<{ level: number; points: number }>;
}

/** 주입 가능한 의존성(테스트에서 gateway/config 대체). */
export interface LineageDeps {
  gateway?: LineageGateway;
  config?: SupabaseConfig | null;
}

/** 설정으로 게이트웨이를 만드는 팩토리(부트스트랩이 등록). */
export type LineageGatewayFactory = (config: SupabaseConfig) => LineageGateway;

// ---------------------------------------------------------------------------
// 게이트웨이 해석 (defenseUnits.ts resolveGateway 와 동일 규율)
// ---------------------------------------------------------------------------

let gatewayFactory: LineageGatewayFactory | null = null;
let gatewayOverride: LineageGateway | null = null;
let cachedGateway: LineageGateway | null = null;
let cachedConfigKey: string | null = null;

/**
 * Supabase 게이트웨이 팩토리 등록(부트스트랩 `main.ts`). 등록 전에는 설정이 있어도 모든 공개
 * 함수가 no-op 이다 — 미설정 번들·테스트에 SDK 가 실리지 않게 하는 의도된 안전 기본값이다.
 */
export function setLineageGatewayFactory(factory: LineageGatewayFactory | null): void {
  gatewayFactory = factory;
  cachedGateway = null;
  cachedConfigKey = null;
}

/**
 * 게이트웨이 **전역 대체**(DEV 하네스 전용 — `setDefenseUnitsGatewayOverride` 와 같은 규율).
 *
 * 왜 필요한가: 오프라인이면 계보 조작이 **잠기므로**, 설정 없는 개발 환경에서는 퇴역·소멸·투자를
 * 한 번도 밟아볼 수 없다. 방어 사령부가 정확히 이 이유로 override 를 만들었다. 설정 유무보다
 * **먼저** 검사되며 `null` 을 넣으면 즉시 원래 경로로 돌아온다. 프로덕션 호출부는 없다.
 */
export function setLineageGatewayOverride(gateway: LineageGateway | null): void {
  gatewayOverride = gateway;
}

/**
 * 지금 대체가 걸려 있는가(= 실서버가 가려져 있는가). 치트 패널 상태 배지가 읽는다.
 *
 * 왜 패널의 지역 변수로는 안 되는가: 치트 패널은 매 렌더마다 탭을 새로 만들어 토글을 추적하던
 * 클로저가 초기화된다. 그래서 "켠 적 있는가"를 패널이 스스로 알 수 없다 — 정본은 여기다.
 */
export function hasLineageGatewayOverride(): boolean {
  return gatewayOverride !== null;
}

/** 테스트 격리용 초기화(등록된 팩토리·대체를 모두 지운다). */
export function resetLineageGateway(): void {
  gatewayFactory = null;
  gatewayOverride = null;
  cachedGateway = null;
  cachedConfigKey = null;
}

function resolveGateway(deps: LineageDeps): LineageGateway | null {
  if (deps.gateway !== undefined) return deps.gateway;
  if (gatewayOverride !== null) return gatewayOverride;
  const config = deps.config !== undefined ? deps.config : readSupabaseConfig();
  if (config === null) return null;
  if (gatewayFactory === null) return null;
  const key = config.url;
  if (cachedGateway !== null && cachedConfigKey === key) return cachedGateway;
  cachedGateway = gatewayFactory(config);
  cachedConfigKey = key;
  return cachedGateway;
}

/**
 * 계보 조작이 가능한 상태인가(동기 판정 — 화면이 버튼을 잠글 때 쓴다).
 *
 * ⚠️ 이것은 **게이트웨이가 해석되는가**만 본다. 실제 로그인 성공·네트워크 도달까지는 보지
 * 않는다(그건 비동기이고, 매 프레임 물을 수 없다). 그래서 여기서 `true` 여도 개별 호출은
 * 여전히 `null` 을 낼 수 있고, 화면은 그 경우도 실패로 다뤄야 한다.
 */
export function isLineageOnline(deps: LineageDeps = {}): boolean {
  return resolveGateway(deps) !== null;
}

/** 게이트웨이 호출 공통 래퍼 — 미설정·오류는 전부 `null`(throw 금지 규율의 단일 지점). */
async function call<T>(deps: LineageDeps, fn: (g: LineageGateway) => Promise<T>): Promise<T | null> {
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
export async function getLineageUserId(deps: LineageDeps = {}): Promise<string | null> {
  return call(deps, (g) => g.getUserId());
}

/**
 * 서버 정본 한 벌(계보 상태 + 수호 기체 전량)을 한 번에 당긴다.
 *
 * 둘을 **따로** 부르지 않는 이유: 화면이 각각 부르면 그 사이에 다른 기기의 소멸이 끼어들어
 * "포인트는 늘었는데 목록은 그대로"인 상태를 그린다. uid 해석도 한 번이면 족하다.
 * 어느 한쪽이라도 실패하면 통째로 `null` — 반쪽 미러를 만들지 않는다.
 */
export async function pullLineageState(
  deps: LineageDeps = {},
): Promise<{ lineage: ServerLineage; guardians: ServerGuardian[] } | null> {
  return call(deps, async (g) => {
    const uid = await g.getUserId();
    const [lineage, guardians] = await Promise.all([g.fetchLineage(uid), g.fetchGuardians(uid)]);
    return { lineage, guardians };
  });
}

/**
 * 퇴역 → 서버가 수호 행을 만들고 계보 기본 지급. 반환 `guardianId` 는 **서버 uuid** 이고,
 * 이후 소멸 RPC 가 가리키는 유일한 참조다 — 로컬 미러의 레코드 id 로 그대로 채택해야 한다
 * (로컬 생성 id 로는 서버 행을 가리킬 수 없다). 미설정·오류면 `null`.
 */
export async function retireShipOnServer(
  preset: number,
  combatScore: number,
  snapshot: GuardianSnapshot,
  build?: GuardianBuild,
  deps: LineageDeps = {},
): Promise<{ guardianId: string; granted: number } | null> {
  return call(deps, (g) => g.retireShip(preset, combatScore, snapshot, build));
}

/** 소멸 → 서버가 계보 포인트를 회수. 반환: 회수 포인트. 미설정·오류·거부면 `null`. */
export async function dismissGuardianOnServer(
  guardianId: string,
  deps: LineageDeps = {},
): Promise<number | null> {
  return call(deps, (g) => g.dismissGuardian(guardianId));
}

/**
 * 계보 1레벨 투자 → 서버가 포인트를 차감하고 레벨을 올린다. 반환 `{level, points}` 는 **차감
 * 후 서버 정본**이라 호출부는 이 값으로 미러를 맞춘다(클라가 자기 산식으로 다시 빼면 안 된다).
 * 포인트 부족·미설정·오류면 `null`.
 */
export async function investLineageOnServer(
  branch: LineageBranch,
  deps: LineageDeps = {},
): Promise<{ level: number; points: number } | null> {
  return call(deps, (g) => g.investLineage(branch));
}
