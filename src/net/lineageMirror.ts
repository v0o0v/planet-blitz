/**
 * 서버 정본 → 로컬 미러 반영 (ADR-0007 서버 권위 배선, 2026-08-03).
 *
 * **순수 모듈이다** — 네트워크·SDK·Pixi 를 전혀 import 하지 않는다(`profileSync.ts` 와 같은
 * 규율). 실제 IO 는 `lineage.ts` 파사드가, 화면 배선은 UI 가 하고, 여기서는 "서버가 준 값으로
 * Profile 을 어떻게 맞추는가"만 결정한다. 그래서 vitest 가 캔버스·서버 없이 전부 잠근다.
 *
 * ## 왜 수호 목록을 **교체**하는가(병합이 아니라)
 * `guardians` 테이블이 정본이고 `profile.save.guardians` 는 미러다(사용자 결정 2026-08-03).
 * 병합을 하면 서버에 없는 로컬 레코드가 영원히 살아남아 **소멸시킬 수 없는 유령**이 된다 —
 * 소멸 RPC 는 서버 uuid 를 요구하는데 그 레코드에는 대응 행이 없기 때문이다. 교체는 그 상태를
 * 구조적으로 만들지 않는다.
 *
 * ⚠️ 교체는 **서버 조회가 성공했을 때만** 불러야 한다. 실패했는데 빈 배열로 부르면 로컬
 * 수호기를 전부 지운다. 파사드가 실패를 `null` 로 내는 이유이고, 호출부는 `null` 이면 이 함수를
 * 부르지 않는다.
 */

import { derivedSpent } from '../../data/lineage.js';
import type { LineageState } from '../../data/lineage.js';
import type { GuardianRecord, Profile } from '../save/profile.js';
import type { ServerGuardian, ServerLineage } from './guardianGateway.js';

/**
 * 서버 계보 상태 → `LineageState`. `spent` 는 서버에 컬럼이 없어 두 가지 레벨에서 파생한다
 * (`derivedSpent` 헤더). 음수·비유한 값은 0 으로 잘라 Profile 불변식을 지킨다.
 */
export function serverLineageToState(row: ServerLineage): LineageState {
  const shipLevel = safeCount(row.shipLevel);
  const guardianLevel = safeCount(row.guardianLevel);
  return {
    shipLevel,
    guardianLevel,
    available: safeCount(row.available),
    spent: derivedSpent(shipLevel, guardianLevel),
  };
}

function safeCount(v: number): number {
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.trunc(v);
}

/**
 * 서버 수호 1행 → 로컬 `GuardianRecord`.
 *
 * `id` 는 **서버 uuid 를 그대로** 쓴다 — 소멸 RPC 가 가리키는 유일한 참조이기 때문이다.
 * `build` 는 서버 jsonb 셰이프를 그대로 신뢰한다(게이트웨이와 같은 규율); 없으면 구 수호기라
 * 필드를 아예 넣지 않는다(`exactOptionalPropertyTypes` 계약).
 */
export function serverGuardianToRecord(row: ServerGuardian): GuardianRecord {
  return {
    id: row.id,
    snapshot: row.snapshot,
    performanceCP: safeCount(row.performanceCP),
    combatScore: safeCount(row.combatScore),
    preset: safeCount(row.preset),
    retired: row.retired,
    ...(row.build !== undefined ? { build: row.build } : {}),
  };
}

/**
 * 서버 정본 한 벌을 Profile 에 반영한다(제자리 변형). 계보 상태는 통째로 교체하고, 수호 목록도
 * 통째로 교체한다(파일 헤더 — 병합하지 않는다).
 *
 * ⚠️ 조회 **성공** 시에만 부를 것. 실패를 빈 배열로 넘기면 로컬 수호기를 전부 지운다.
 */
export function applyServerLineageState(
  profile: Profile,
  state: { lineage: ServerLineage; guardians: readonly ServerGuardian[] },
): void {
  profile.lineage = serverLineageToState(state.lineage);
  profile.guardians = state.guardians.map(serverGuardianToRecord);
}

/**
 * 투자 RPC 결과로 미러를 맞춘다. 서버가 준 `{level, points}` 는 **차감 후 정본**이라 클라가
 * 자기 산식으로 다시 빼면 안 된다(같은 비용 곡선을 두 번 적용하는 결함이 된다).
 * `spent` 는 갱신된 레벨에서 다시 파생한다.
 */
export function applyServerInvest(
  profile: Profile,
  branch: 'ship' | 'guardian',
  result: { level: number; points: number },
): void {
  const level = safeCount(result.level);
  const shipLevel = branch === 'ship' ? level : profile.lineage.shipLevel;
  const guardianLevel = branch === 'guardian' ? level : profile.lineage.guardianLevel;
  profile.lineage = {
    shipLevel,
    guardianLevel,
    available: safeCount(result.points),
    spent: derivedSpent(shipLevel, guardianLevel),
  };
}
