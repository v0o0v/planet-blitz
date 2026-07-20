/**
 * 연구소 개편(찍은 것만 표시 + 전체 스킬 스크롤 팝업)의 UI-독립 헬퍼 검증.
 *
 * 여기서 고정하는 것은 **계산**뿐이다: 어떤 노드가 본 패널에 뜨는가(`investedNodeIndices`),
 * 목록이 스크롤 없이 들어가는가(`listStackHeight` + `INVESTED_LIST`), 팝업 마스크가 반토막
 * 행을 만들지 않는가(`clampToRowHeight`), 스크롤이 범위를 벗어나지 않는가(`clampScroll`).
 * 실제 렌더(아이콘 여백·프레임 침범)는 브라우저 확대 크롭 확인 몫이다.
 */

import { describe, it, expect } from 'vitest';
import {
  investedNodeIndices,
  listStackHeight,
  clampToRowHeight,
  clampScroll,
  INVESTED_LIST,
  POPUP_LIST,
} from '../src/ui/pixi/researchLab.js';
import { rectGridPositions } from '../src/ui/pixi/slotGrid.js';
import { NODES_PER_TREE, SKILL_NODE_COUNT, treeRange } from '../data/skills.js';

/** 63칸(60 base + 캡스톤 3) 짜리 빈 투자 벡터. */
function emptyInvest(): number[] {
  return new Array<number>(SKILL_NODE_COUNT).fill(0);
}

describe('investedNodeIndices — 본 패널은 찍은 것만 보여 준다', () => {
  it('투자가 없으면 빈 목록', () => {
    const invest = emptyInvest();
    expect(investedNodeIndices(invest, 'firepower')).toEqual([]);
    expect(investedNodeIndices(invest, 'survival')).toEqual([]);
    expect(investedNodeIndices(invest, 'mobility')).toEqual([]);
  });

  it('해당 계열 범위 안에서 0보다 큰 칸만, SKILLS 순서(티어 오름차순)로 돌려준다', () => {
    const invest = emptyInvest();
    invest[3] = 1; // firepower 티어 0
    invest[11] = 4; // firepower 티어 2
    invest[20] = 2; // survival 첫 노드
    expect(investedNodeIndices(invest, 'firepower')).toEqual([3, 11]);
    expect(investedNodeIndices(invest, 'survival')).toEqual([20]);
    expect(investedNodeIndices(invest, 'mobility')).toEqual([]);
  });

  it('계열 캡스톤은 목록에 섞이지 않는다(별도 바가 맡는다)', () => {
    const invest = emptyInvest();
    invest[60] = 1; // firepower 캡스톤
    expect(investedNodeIndices(invest, 'firepower')).toEqual([]);
  });

  it('짧은/손상 벡터도 안전(누락 = 0)', () => {
    expect(investedNodeIndices([], 'mobility')).toEqual([]);
    expect(investedNodeIndices([1, 0, 2], 'firepower')).toEqual([0, 2]);
  });

  it('한 계열을 전부 찍으면 그 계열 20칸이 전부 나온다', () => {
    const invest = emptyInvest();
    const { start, end } = treeRange('mobility');
    for (let i = start; i < end; i++) invest[i] = 1;
    expect(investedNodeIndices(invest, 'mobility')).toHaveLength(NODES_PER_TREE);
  });
});

describe('본 패널 목록은 스크롤 없이 들어간다', () => {
  it('20노드를 전부 찍어도 목록 세로가 가용 세로를 넘지 않는다', () => {
    const h = listStackHeight(NODES_PER_TREE, INVESTED_LIST.cols, INVESTED_LIST.cellH, INVESTED_LIST.gapY);
    expect(h).toBeLessThanOrEqual(INVESTED_LIST.avail);
  });

  it('2열이 간격까지 포함해 콘텐츠 상자 폭 안에서 끝난다', () => {
    const w = INVESTED_LIST.cellW * INVESTED_LIST.cols + INVESTED_LIST.gapX * (INVESTED_LIST.cols - 1);
    expect(w).toBeLessThanOrEqual(INVESTED_LIST.boxW);
  });

  it('listStackHeight 는 마지막 행 뒤 간격을 빼고 센다', () => {
    expect(listStackHeight(0, 2, 43, 2)).toBe(0);
    expect(listStackHeight(1, 2, 43, 2)).toBe(43);
    expect(listStackHeight(2, 2, 43, 2)).toBe(43); // 한 행에 2칸
    expect(listStackHeight(3, 2, 43, 2)).toBe(88); // 두 행 = 43+2+43
  });

  it('rectGridPositions 가 2열 행-우선으로 좌표를 만든다', () => {
    const pos = rectGridPositions(5, INVESTED_LIST.cols, INVESTED_LIST.cellW, INVESTED_LIST.cellH, INVESTED_LIST.gapX, INVESTED_LIST.gapY);
    expect(pos[0]).toEqual({ x: 0, y: 0 });
    expect(pos[1]).toEqual({ x: INVESTED_LIST.cellW + INVESTED_LIST.gapX, y: 0 });
    expect(pos[2]).toEqual({ x: 0, y: INVESTED_LIST.cellH + INVESTED_LIST.gapY });
    expect(pos[4]).toEqual({ x: 0, y: (INVESTED_LIST.cellH + INVESTED_LIST.gapY) * 2 });
  });
});

describe('clampToRowHeight — 팝업 마스크에 반토막 행이 생기지 않는다', () => {
  it('가용 높이를 행 피치의 배수로 내린다', () => {
    expect(clampToRowHeight(690, 69)).toBe(690);
    expect(clampToRowHeight(700, 69)).toBe(690);
    expect(clampToRowHeight(68, 69)).toBe(68); // 한 행도 못 들어가면 가용 그대로
    expect(clampToRowHeight(138, 69)).toBe(138);
    expect(clampToRowHeight(137, 69)).toBe(69);
  });

  it('연구소 팝업 실제 값에서 마스크 높이가 행 경계로 떨어진다', () => {
    const avail = POPUP_LIST.bottom - POPUP_LIST.top;
    const viewH = clampToRowHeight(avail, POPUP_LIST.pitch);
    expect(viewH % POPUP_LIST.pitch).toBe(0);
    expect(viewH).toBeGreaterThan(0);
    expect(viewH).toBeLessThanOrEqual(avail);
  });

  it('20노드 전체는 팝업 한 화면보다 길다 — 그래서 스크롤이 필요하다', () => {
    const totalH = listStackHeight(NODES_PER_TREE, 1, POPUP_LIST.rowH, POPUP_LIST.gapY);
    const viewH = clampToRowHeight(POPUP_LIST.bottom - POPUP_LIST.top, POPUP_LIST.pitch);
    expect(totalH).toBeGreaterThan(viewH);
  });

  it('피치가 0 이하거나 가용이 음수여도 안전', () => {
    expect(clampToRowHeight(100, 0)).toBe(100);
    expect(clampToRowHeight(-10, 69)).toBe(0);
  });
});

describe('clampScroll', () => {
  it('[0, total - view] 로 가둔다', () => {
    expect(clampScroll(-50, 1376, 690)).toBe(0);
    expect(clampScroll(300, 1376, 690)).toBe(300);
    expect(clampScroll(9999, 1376, 690)).toBe(686);
  });

  it('내용이 화면보다 짧으면 항상 0', () => {
    expect(clampScroll(120, 300, 690)).toBe(0);
    expect(clampScroll(0, 0, 690)).toBe(0);
  });
});
