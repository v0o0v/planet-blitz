/**
 * 정산 진입 게이트 테스트 (src/ui/runFlow.ts).
 *
 * '장비 정비'로 결과 오버레이를 숨긴 뒤 결과 화면이 인벤토리 위로 다시 뜨던 재표시
 * 레이스의 회귀 가드 — 게이트가 오버레이 가시성이 아니라 settled 기준임을 못박는다.
 */

import { describe, it, expect } from 'vitest';
import { shouldEnterSettlement } from '../src/ui/runFlow.js';

describe('shouldEnterSettlement', () => {
  it('런 종료 + 미정산 → 진입(정산 화면 최초 표시)', () => {
    expect(shouldEnterSettlement(true, false)).toBe(true);
  });

  it('런 종료 + 이미 정산됨 → 재진입 안 함(장비 정비로 오버레이를 숨겨도)', () => {
    // 이 케이스가 핵심: settled=true면 오버레이가 보이든 숨겨졌든 endRun을 다시 부르지
    // 않는다. 옛 로직(!resultOverlay.visible)은 여기서 true를 반환해 재표시 레이스를 냈다.
    expect(shouldEnterSettlement(true, true)).toBe(false);
  });

  it('런 진행 중 → 진입 안 함', () => {
    expect(shouldEnterSettlement(false, false)).toBe(false);
    expect(shouldEnterSettlement(false, true)).toBe(false);
  });
});
