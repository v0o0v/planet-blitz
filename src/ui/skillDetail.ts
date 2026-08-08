/**
 * 연구소 스킬 **상세 표** — 수치를 sim 정본에서 계산한다 (사용자 요청 2026-08-09).
 *
 * ## 왜 이 파일이 필요했나
 * 연구소는 스킬당 `node.desc` **한 줄**만 보여 줬다. 그 한 줄은 정성 문장이라("적을 처치할
 * 때마다 정조준 사이클 카운터가 즉시 충전된다") 플레이어가 *"몇 포인트를 넣을 가치가 있나"*
 * 를 판단할 근거가 화면에 없었다. 수치는 전부 sim 안에만 있었다.
 *
 * ## 수치의 출처는 **sim 이다** — 문안이 아니다
 * 기체별 표가 `src/sim/skills/*Scaling.ts` 의 순수 함수를 그대로 부른다. 대안 둘을 기각한
 * 근거는 `strikerScaling.ts` 머리에 있다. 요약하면:
 *  - **설계서를 베끼면 안 된다.** 구현과 이미 갈려 있다 — 스트라이커 F6 은 설계서 공식에
 *    기준량이 없어 구현이 다른 식으로 배선했고, M5 는 설계서가 약속한 "거리"가 구현에 없다.
 *  - **화면이 자기 공식을 적으면 안 된다.** 밸런스 한 줄이 바뀌는 날 조용히 갈린다.
 *
 * 그래서 표가 담는 것은 **수치가 아니라 문장 틀**이다: 어떤 함수를 어떤 라벨로 부를지.
 * 밸런스가 바뀌면 표는 한 줄도 안 고쳐도 화면이 새 값을 말한다.
 *
 * ## 왜 UI 레이어인가
 * sim 은 UI 를 모른다(ADR-0005 · ADR-0014). 역방향(UI → sim 순수 리더)은 허용이고, 이 표는
 * 표시 문안을 소유하므로 UI 쪽이 맞다. `data/` 에 두면 데이터 레이어가 sim 을 import 하게 돼
 * 층이 뒤집힌다.
 *
 * ## ⚠️ 아직 등록되지 않은 기체
 * 표가 있는 기체만 등록한다. 없는 기체는 {@link skillDetailOf} 가 `null` 을 내고 화면이
 * 종전 한 줄을 그대로 쓴다 — 빈 패널을 세우거나 "준비 중"을 적지 않는다. 표를 새로 채우면
 * {@link SKILL_DETAIL_BY_SHIP} 에 한 줄 추가하는 것으로 끝난다.
 *
 * ## 커버리지 계약
 * 등록된 기체는 **30스킬 전부**를 담는다(`tests/skillDetail.test.ts` 가 못 박는다). 빠진
 * 스킬은 화면에서 조용히 예전 한 줄로 내려앉으므로 누락을 눈으로 잡을 수 없다.
 */

import type { SkillDetail } from './skillDetail/format.js';
import { STRIKER_SKILL_DETAIL } from './skillDetail/striker.js';
import { ARCCASTER_SKILL_DETAIL } from './skillDetail/arccaster.js';
import { BRUISER_SKILL_DETAIL } from './skillDetail/bruiser.js';

export type { SkillDetail };

/**
 * 기체 slug → 그 기체의 상세 표.
 *
 * ⚠️ **표의 키는 `ShipSkillDef.id` 에서 기체 접두사를 뗀 부분**이다. `id` 는
 * `` `${shipSlug}-${idSlug}` `` 로 조립되므로(`data/ships/types.ts` `buildShipAxis`) 표마다
 * 접두사를 30번 반복하지 않고 뒷부분만 키로 쓴다. `code`(F1·S3…)는 축 안에서만 유일해
 * 기체 간 충돌하므로 키로 쓰지 않는다.
 */
export const SKILL_DETAIL_BY_SHIP: Readonly<
  Record<string, Readonly<Record<string, SkillDetail>>>
> = {
  striker: STRIKER_SKILL_DETAIL,
  arccaster: ARCCASTER_SKILL_DETAIL,
  bruiser: BRUISER_SKILL_DETAIL,
};

/**
 * 기체 slug + 스킬 id → 상세. 없으면 `null`(화면이 종전 한 줄로 내려앉는다).
 *
 * ⚠️ **기체 slug 로 먼저 가르고, 접두사가 붙어 있는지도 확인한다.** 스킬 id 는 전역
 * 유니크하도록 저작돼 있지만, 그 규율이 깨지는 날 조용히 남의 기체 문안을 보여 주는 것보다
 * 안 보여 주는 편이 낫다.
 */
export function skillDetailOf(shipSlug: string, skillId: string): SkillDetail | null {
  const table = SKILL_DETAIL_BY_SHIP[shipSlug];
  if (table === undefined) return null;
  const prefix = `${shipSlug}-`;
  if (!skillId.startsWith(prefix)) return null;
  return table[skillId.slice(prefix.length)] ?? null;
}
