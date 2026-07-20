/**
 * 설계도 지급 네트워크 계층 (M7b 통합 게이트 — `grant_blueprints` RPC).
 *
 * 행성 런 정산이 파생한 설계도 목록(`blueprintDropsFromLoot`)을 서버 보유량에 얹는다.
 * 규율은 기존 net 계층과 동일하다:
 *  - Supabase 미설정(env 부재) 시 **완전 no-op** → 0 을 돌려주고 SDK 를 로드하지 않는다.
 *  - **절대 throw 하지 않는다** — 정산은 오프라인에서도 끝나야 한다. 실패는 삼키고 0.
 *
 * ## 트러스트 모델
 * 클라 호출(authenticated)이다. 현행 장비 드랍이 `items` 클라 직접 쓰기 + `pve_runs` 사후
 * 샘플링 재실행 검증이라는 같은 모델 위에 있으므로, 설계도만 더 강한 보증을 요구할 근거가
 * 없다(레인 문서 참조). 더 강한 보증이 필요해지면 장비 드랍과 **함께** 서버 권위로 올린다.
 * 서버는 호출 1회당 행 8·장수 4 상한을 강제한다.
 */

import { readSupabaseConfig, type SupabaseConfig } from './config.js';

/** 지급 1건(= `data/planets/blueprints.ts` 의 `BlueprintGrant` 구조적 부분집합). */
export interface BlueprintGrantLike {
  readonly kind: number;
  readonly catalogId: number;
  readonly count: number;
}

/** 주입 가능한 의존성(테스트에서 RPC/설정 대체). */
export interface BlueprintsDeps {
  config?: SupabaseConfig | null;
  /** RPC 대체(테스트용). 미지정이면 defenseUnitsGateway 의 실 구현을 동적 import 한다. */
  grant?: (
    config: SupabaseConfig,
    grants: readonly BlueprintGrantLike[],
  ) => Promise<number>;
}

/**
 * 설계도 지급. 지급된 총 장수를 돌려준다(미설정·오프라인·오류·빈 목록이면 0).
 *
 * 정산 경로에서 **fire-and-forget** 으로 부른다 — 실패해도 런 정산 자체는 이미 로컬
 * 프로필에 반영됐고, 설계도는 다음 런에서 다시 나온다(재시도 큐를 두지 않는 이유).
 */
export async function grantBlueprintDrops(
  grants: readonly BlueprintGrantLike[],
  deps: BlueprintsDeps = {},
): Promise<number> {
  if (grants.length === 0) return 0;
  const config = deps.config !== undefined ? deps.config : readSupabaseConfig();
  if (config === null) return 0;
  try {
    const grant =
      deps.grant ??
      (await import('./defenseUnitsGateway.js')).grantBlueprintsViaRpc;
    return await grant(config, grants);
  } catch {
    return 0;
  }
}
