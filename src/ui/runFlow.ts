/**
 * 런 종료 → 정산(결과 오버레이) 진입 판정 (순수 함수, 렌더 루프 게이트).
 *
 * 런이 끝나면 endRun을 **정확히 1회** 호출해야 한다. 게이트를 `settled`(정산 완료
 * 플래그)로 두는 것이 핵심 — 오버레이 가시성(`!resultOverlay.visible`)으로 게이트하면,
 * 정산 화면의 '장비 정비'가 오버레이를 숨긴 순간 다음 프레임에 재진입해(월드는 여전히
 * 승리/패배 상태) 결과 오버레이가 인벤토리 위로 다시 떠버린다(재표시 레이스). `settled`는
 * startRun에서 false로 리셋되므로 다음 런에서 다시 1회 진입한다.
 */
export function shouldEnterSettlement(runOver: boolean, settled: boolean): boolean {
  return runOver && !settled;
}
