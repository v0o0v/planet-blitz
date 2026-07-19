/**
 * 격납고 슬롯 그리드 레이아웃 헬퍼 검증 (격납고 카툰 UI 파일럿).
 *
 * `gridPositions` 는 UI-독립 순수 함수라(Pixi 미의존) 단위 테스트로 좌표를 고정한다.
 * 슬롯 셀·툴팁 등 렌더는 브라우저 수동 확인 몫(handoff: 신규 테스트는 레이아웃 계산에만).
 */

import { describe, it, expect } from 'vitest';
import { gridPositions, itemGlyph } from '../src/ui/pixi/slotGrid.js';

describe('gridPositions', () => {
  it('lays out row-major with cell+gap spacing', () => {
    const pos = gridPositions(5, 4, 66, 8);
    expect(pos).toHaveLength(5);
    expect(pos[0]).toEqual({ x: 0, y: 0 });
    expect(pos[1]).toEqual({ x: 74, y: 0 }); // 66 + 8
    expect(pos[3]).toEqual({ x: 222, y: 0 }); // col 3
    expect(pos[4]).toEqual({ x: 0, y: 74 }); // wraps to row 1
  });

  it('handles n=0 and single column', () => {
    expect(gridPositions(0, 8, 66, 8)).toEqual([]);
    const one = gridPositions(3, 1, 10, 2);
    expect(one.map((p) => p.y)).toEqual([0, 12, 24]);
  });
});

describe('itemGlyph', () => {
  it('maps weapon slots to distinct glyphs', () => {
    expect(itemGlyph('main')).toBe('✷');
    expect(itemGlyph('sub')).toBe('❋');
    expect(itemGlyph('armor')).toBe('◈');
  });
});
