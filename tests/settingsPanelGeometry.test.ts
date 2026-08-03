/**
 * 설정 팝업 높이 계약.
 *
 * ## 무엇이 깨져 있었나
 * 팝업은 톱니 아래에 붙고 **내용만큼 자라기만** 했다. 행이 하나씩 늘면서(그래픽 티어 → 모션
 * 감소 → 발광 감소 → 데미지 숫자 → 계정) 결국 화면 아래로 넘쳤고, 넘친 부분은 **잘려서 그냥
 * 안 보였다** — 닫기 버튼과 계정 행이 그렇게 사라졌다. 스크롤이 없어 닿을 방법도 없었다.
 *
 * 계정 행은 임계를 넘긴 방아쇠였을 뿐 그 전에도 이미 넘치고 있었다. 그래서 "행을 줄인다"가
 * 아니라 **높이를 화면에 가두고 넘치면 스크롤**로 고쳤고, 그 계약을 여기서 잠근다 — 다음에
 * 행이 또 늘어도 같은 결함이 재발하지 않게.
 *
 * Pixi 표시 객체는 만들지 않는다(node 환경에서 캔버스 텍스트 측정 불가). 이 리포의 UI 테스트
 * 관용구대로 **기하를 순수 함수로 빼서** 그것을 직접 검증한다.
 */

import { describe, it, expect } from 'vitest';
import {
  settingsPanelGeometry,
  PANEL_Y,
  PANEL_BOTTOM_MARGIN,
} from '../src/ui/pixi/settingsPanel.js';
import { DESIGN_HEIGHT } from '../src/render/app.js';

/** 화면에 들어갈 수 있는 최대 패널 높이. */
const MAX_H = DESIGN_HEIGHT - PANEL_Y - PANEL_BOTTOM_MARGIN;

describe('settingsPanelGeometry', () => {
  it('내용이 짧으면 예전 그대로 자란다(스크롤 없음)', () => {
    const geo = settingsPanelGeometry(200);
    expect(geo.scrolls).toBe(false);
    // 위아래 여백이 대칭이라는 기존 성질이 유지된다.
    expect(geo.panelH - geo.viewH).toBe(geo.panelH - 200);
  });

  it('아무리 내용이 길어도 패널 바닥이 화면 안에 있다', () => {
    for (const contentH of [900, 1000, 1200, 4000]) {
      const geo = settingsPanelGeometry(contentH);
      expect(PANEL_Y + geo.panelH, `contentH=${contentH}`).toBeLessThanOrEqual(DESIGN_HEIGHT);
    }
  });

  it('넘치면 스크롤로 전환된다', () => {
    expect(settingsPanelGeometry(MAX_H * 2).scrolls).toBe(true);
  });

  it('창 높이가 음수가 되지 않는다(마스크 크기로 쓰이므로)', () => {
    // 내용이 0 이면 창도 0 이 맞다 — 막으려는 것은 음수다.
    for (const contentH of [0, 1, MAX_H * 3]) {
      expect(settingsPanelGeometry(contentH).viewH, `contentH=${contentH}`).toBeGreaterThanOrEqual(
        0,
      );
    }
  });

  it('스크롤할 때는 창 높이가 실제로 뭔가 보일 만큼 있다', () => {
    const geo = settingsPanelGeometry(MAX_H * 3);
    expect(geo.viewH).toBeGreaterThan(400);
  });

  /**
   * 경계에서 한 픽셀 차이로 성질이 뒤집히는지 본다. `scrolls` 가 켜지는 순간부터 높이가
   * 고정돼야 하고, 그 직전까지는 내용을 따라가야 한다.
   */
  it('경계 전후가 연속이다', () => {
    const inset = settingsPanelGeometry(100).panelH - 100; // 위아래 inset 합
    const justFits = settingsPanelGeometry(MAX_H - inset);
    const justOver = settingsPanelGeometry(MAX_H - inset + 1);

    expect(justFits.scrolls).toBe(false);
    expect(justFits.panelH).toBe(MAX_H);
    expect(justOver.scrolls).toBe(true);
    expect(justOver.panelH).toBe(MAX_H);
  });
});
