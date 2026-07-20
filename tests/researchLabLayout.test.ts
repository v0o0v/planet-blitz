/**
 * 연구소 노드 그리드 레이아웃 헬퍼 검증 (아이콘 도입에 따른 4열×5행 재배치).
 *
 * `rectGridPositions` 는 UI-독립 순수 함수라(Pixi 미의존) 단위 테스트로 좌표를 고정한다.
 * 셀 내부 렌더(아이콘·이름·배지)는 브라우저 수동 확인 몫(handoff: 신규 테스트는 계산에만).
 */

import { describe, it, expect } from 'vitest';
import { rectGridPositions } from '../src/ui/pixi/slotGrid.js';

/** 연구소 실제 값: 콘텐츠 상자 500폭에 119×95 셀 4열(간격 8), 행 간격 5. */
const NODE_W = 119;
const NODE_H = 95;
const COLS = 4;
const GAP_X = 8;
const GAP_Y = 5;

describe('rectGridPositions', () => {
  it('lays out non-square cells row-major with separate x/y gaps', () => {
    const pos = rectGridPositions(20, COLS, NODE_W, NODE_H, GAP_X, GAP_Y);
    expect(pos).toHaveLength(20);
    expect(pos[0]).toEqual({ x: 0, y: 0 });
    expect(pos[1]).toEqual({ x: 127, y: 0 }); // 119 + 8
    expect(pos[3]).toEqual({ x: 381, y: 0 }); // 마지막 열
    expect(pos[4]).toEqual({ x: 0, y: 100 }); // 95 + 5 → 다음 행
    expect(pos[19]).toEqual({ x: 381, y: 400 }); // 5행 4열 = 마지막 노드
  });

  it('fits 4 columns exactly inside the 500px panel content box', () => {
    expect(NODE_W * COLS + GAP_X * (COLS - 1)).toBe(500);
  });

  it('keeps 20 nodes in 5 rows', () => {
    const pos = rectGridPositions(20, COLS, NODE_W, NODE_H, GAP_X, GAP_Y);
    const rows = new Set(pos.map((p) => p.y));
    expect(rows.size).toBe(5);
  });

  it('handles n=0 and a single column', () => {
    expect(rectGridPositions(0, COLS, NODE_W, NODE_H, GAP_X, GAP_Y)).toEqual([]);
    const one = rectGridPositions(3, 1, 10, 20, 2, 4);
    expect(one.map((p) => p.y)).toEqual([0, 24, 48]);
    expect(one.map((p) => p.x)).toEqual([0, 0, 0]);
  });
});
