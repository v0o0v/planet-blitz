/**
 * 이번 런에 **발령된 의뢰서** 가려내기 — 재고 전후 차집합 (사용자 요청 2026-08-09).
 *
 * ## 왜 차집합밖에 없는가
 * 의뢰서 발령은 `settle_pve_run` 이 만든 `pve_runs` 행의 AFTER 트리거
 * (`issue_commission_for_run`)가 한다. 그 결과가 클라에 닿는 길이 둘 다 막혀 있다:
 *  - 정산 RPC 응답(`SettlePveResult`)은 **잔액 + settled** 뿐이라 발령 여부가 안 실린다.
 *  - 발령 원장 `commission_issues` 는 **RLS 정책이 0개**라 authenticated 가 아무것도 못 읽는다
 *    (의도된 설계 — `skip_reason` 노출은 "언제 상한에 걸리는가"를 알려주는 재료다).
 * 읽을 수 있는 것은 `commission_inventory`(본인 select 정책 있음)뿐이다. 그래서 런 시작
 * 스냅샷과 정산 뒤 재고의 차집합이 **유일한 관측면**이다.
 *
 * ## 이 모듈이 존재하는 이유 — 판정이 `main.ts` 안에 갇히면 안 된다
 * 여기서 틀리는 방향은 하나뿐이고 그 대가가 크다: **기준선이 없는데 차집합을 계산하면 재고
 * 전체가 "이번 런 발령분"이 되어** 화면이 "특급 지시 12건 발령!"이라고 말한다. `main()` 은
 * 통짜 클로저라 그 분기를 단위 테스트가 짚을 수 없으므로 판정만 떼어 낸다.
 */

/** 재고 1행의 필요한 부분만(테스트가 서버 타입 전체를 흉내 내지 않게 한다). */
export interface CommissionInventoryRowLike {
  readonly commissionId: string;
}

/**
 * 기준선에 없던 재고 행 = 이번 런 발령분.
 *
 * `before === null`(기준선 없음: 오프라인·조회 실패·아직 미도착) 또는 `rows === null`
 * (조회 실패)이면 **빈 배열**이다 — "모르는 것"을 "전부 새 것"으로 적지 않는다. 두 경우를
 * 같은 값으로 접는 것은 호출부가 둘 다 "표시하지 않는다"로 처리하기 때문이고, 그 침묵이
 * 맞다: 발령은 승리+보스처치 런의 30%(base)라 0건이 정상이다.
 *
 * 순수 함수 — 인자를 변형하지 않고 입력 순서를 보존한다.
 */
export function newlyIssuedCommissions<T extends CommissionInventoryRowLike>(
  before: ReadonlySet<string> | null,
  rows: readonly T[] | null,
): readonly T[] {
  if (before === null || rows === null) return [];
  return rows.filter((r) => !before.has(r.commissionId));
}
