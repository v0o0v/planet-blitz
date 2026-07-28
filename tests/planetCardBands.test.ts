/**
 * 성계 지도 행성 카드의 **세로 띠 기하** 검증(캔버스 없이 순수 좌표만 본다).
 *
 * 카드는 "겹치면 안 되는 세로 띠"로 설계돼 있다(오브 → 이름 → 부제 2줄 → 보상 배율). 이 규율이
 * 깨지면 결함은 두 형태로만 나온다: ① 글자가 나무 프레임 위에 걸쳐 그려진다 ② 두 줄이 겹쳐
 * 읽을 수 없다. 둘 다 렌더를 눈으로 봐야만 보이고, 실제로 ①이 났다(보상 배율 줄이 콘텐츠 상자
 * 바닥 304 보다 아래인 318 에서 시작 — 사용자 신고 2026-07-28). 격납고 헤더에서 두 번 재발한
 * 것과 같은 결함 유형이라 코드로 잠근다.
 */

import { describe, it, expect } from 'vitest';
import { planetCardBands, LOW_H } from '../src/ui/pixi/planetSelect.js';

describe('행성 카드 세로 띠', () => {
  const b = planetCardBands();

  it('보상 배율 줄이 콘텐츠 상자 안에 들어간다(프레임 침범 금지)', () => {
    // 바닥맞춤이라 바닥은 정확히 상자 바닥이고, 상단은 그보다 위여야 한다.
    expect(b.multTop).toBeLessThan(b.contentBottom);
    expect(b.multTop).toBeGreaterThan(0);
  });

  it('보상 배율 줄이 부제 2줄과 겹치지 않는다', () => {
    expect(b.multTop).toBeGreaterThan(b.subMaxBottom);
  });

  it('카드 행이 하단 패널 행을 침범하지 않는다', () => {
    expect(b.rowBottom).toBeLessThan(b.lowPanelTop);
  });

  it('카드 높이를 예전 값(364)으로 되돌리면 배율 줄이 상자 밖으로 나간다(회귀 증인)', () => {
    // 이 단언이 깨지면 = 364 로도 안전해졌다는 뜻이니, 그때는 이 테스트를 지우고 CARD_H 를 줄여라.
    const old = planetCardBands(364);
    expect(old.multTop).toBeLessThan(old.subMaxBottom);
  });

  it('하단 패널 높이 상수는 그대로다(카드 높이 변경이 아래 행을 밀지 않았다)', () => {
    expect(LOW_H).toBe(280);
  });
});
