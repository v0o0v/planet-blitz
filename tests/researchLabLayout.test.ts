/**
 * 연구소(찍은 것만 표시 + 전체 스킬 스크롤 팝업)의 UI-독립 헬퍼 검증.
 *
 * 여기서 고정하는 것은 **계산**뿐이다: 어떤 노드가 본 패널에 뜨는가(`investedNodeIndices`),
 * 목록·팝업 마스크가 반토막 행을 만들지 않는가(`clampToRowHeight`), 스크롤이 범위를 벗어나지
 * 않는가(`clampScroll`). 실제 렌더(아이콘 여백·프레임 침범)는 브라우저 확대 크롭 확인 몫이다.
 *
 * ## M8 에서 축이 바뀌었다
 * 계열을 가리키던 문자열(`'firepower'|'survival'|'mobility'`)이 **(타입 정의, 트리 인덱스)** 로
 * 일반화됐다. 이름 축을 남기면 신규 기체의 계열은 함수에 들어올 수조차 없고, 슬라이스 폭도
 * 스트라이커의 20 으로 고정돼 비온(25)에서 다섯 칸이 **조용히** 잘린다 — 예외도 타입 오류도
 * 나지 않는 종류의 결함이라 아래 "전 SHIP_TYPES 순회" 케이스가 유일한 방어선이다.
 */

import { describe, it, expect } from 'vitest';
import {
  investedNodeIndices,
  listStackHeight,
  clampToRowHeight,
  clampScroll,
  AFFINITY_ACCENT,
  INVESTED_LIST,
  POPUP_LIST,
} from '../src/ui/pixi/researchLab.js';
import { rectGridPositions } from '../src/ui/pixi/slotGrid.js';
import { NODES_PER_TREE, SKILL_NODE_COUNT } from '../data/skills.js';
import {
  SHIP_TYPES,
  STRIKER,
  BION,
  shipTypeDef,
  shipTreeRange,
  shipCapstoneIndex,
  shipSkillNodeCount,
  zeroSkillInvest,
  TREE_AFFINITIES,
} from '../data/ships/index.js';

/** 스트라이커(63칸 = 60 base + 캡스톤 3) 빈 투자 벡터. */
function emptyInvest(): number[] {
  return new Array<number>(SKILL_NODE_COUNT).fill(0);
}

describe('investedNodeIndices — 본 패널은 찍은 것만 보여 준다', () => {
  it('투자가 없으면 빈 목록', () => {
    const invest = emptyInvest();
    for (let tree = 0; tree < STRIKER.trees.length; tree++) {
      expect(investedNodeIndices(invest, STRIKER, tree)).toEqual([]);
    }
  });

  it('해당 계열 범위 안에서 0보다 큰 칸만, flat 순서(티어 오름차순)로 돌려준다', () => {
    const invest = emptyInvest();
    invest[3] = 1; // 트리 0 티어 0
    invest[11] = 4; // 트리 0 티어 2
    invest[20] = 2; // 트리 1 첫 노드
    expect(investedNodeIndices(invest, STRIKER, 0)).toEqual([3, 11]);
    expect(investedNodeIndices(invest, STRIKER, 1)).toEqual([20]);
    expect(investedNodeIndices(invest, STRIKER, 2)).toEqual([]);
  });

  it('계열 캡스톤은 목록에 섞이지 않는다(별도 바가 맡는다)', () => {
    const invest = emptyInvest();
    invest[shipCapstoneIndex(STRIKER, 0)] = 1;
    expect(investedNodeIndices(invest, STRIKER, 0)).toEqual([]);
  });

  it('짧은/손상 벡터도 안전(누락 = 0)', () => {
    expect(investedNodeIndices([], STRIKER, 2)).toEqual([]);
    expect(investedNodeIndices([1, 0, 2], STRIKER, 0)).toEqual([0, 2]);
  });

  it('한 계열을 전부 찍으면 그 계열 전량이 나온다 — **전 SHIP_TYPES**', () => {
    // 스트라이커만 보면 20 이라 통과하지만, 비온(25)에서 슬라이스 폭이 고정돼 있으면 여기서 깨진다.
    for (const def of SHIP_TYPES) {
      const invest = zeroSkillInvest(def.id);
      for (let tree = 0; tree < def.trees.length; tree++) {
        const { start, end } = shipTreeRange(def, tree);
        for (let i = start; i < end; i++) invest[i] = 1;
        expect(investedNodeIndices(invest, def, tree), `${def.slug}/${tree}`).toHaveLength(
          def.nodesPerTree,
        );
        for (let i = start; i < end; i++) invest[i] = 0;
      }
    }
  });

  it('캡스톤 인덱스는 어느 타입에서도 base 구간과 겹치지 않는다', () => {
    for (const def of SHIP_TYPES) {
      for (let tree = 0; tree < def.trees.length; tree++) {
        const cap = shipCapstoneIndex(def, tree);
        expect(cap).toBeGreaterThanOrEqual(def.trees.length * def.nodesPerTree);
        expect(cap).toBeLessThan(shipSkillNodeCount(def.id));
      }
    }
  });
});

describe('AFFINITY_ACCENT — 계열 색의 축은 affinity 다', () => {
  it('affinity 3종 전부에 색이 있다(신규 타입이 색을 잃지 않는다)', () => {
    for (const a of TREE_AFFINITIES) expect(typeof AFFINITY_ACCENT[a]).toBe('number');
  });

  it('스트라이커 3계열의 기존 색이 그대로 보존된다', () => {
    // firepower→offense 주황 · survival→defense 청록 · mobility→utility 연두.
    expect(AFFINITY_ACCENT[STRIKER.trees[0]!.affinity]).toBe(0xff7a4c);
    expect(AFFINITY_ACCENT[STRIKER.trees[1]!.affinity]).toBe(0x4cd7ff);
    expect(AFFINITY_ACCENT[STRIKER.trees[2]!.affinity]).toBe(0x8fd94c);
  });

  it('한 타입 안에서 세 계열이 서로 다른 색을 갖는다(역할이 겹치지 않는다)', () => {
    for (const def of SHIP_TYPES) {
      const colors = new Set(def.trees.map((t) => AFFINITY_ACCENT[t.affinity]));
      expect(colors.size, def.slug).toBe(def.trees.length);
    }
  });
});

describe('본 패널 목록', () => {
  it('스트라이커 20노드는 스크롤 없이 들어간다(기존 배치 전제 유지)', () => {
    const h = listStackHeight(NODES_PER_TREE, INVESTED_LIST.cols, INVESTED_LIST.cellH, INVESTED_LIST.gapY);
    expect(h).toBeLessThanOrEqual(INVESTED_LIST.avail);
  });

  it('비온(25노드)은 가용 세로를 넘는다 — 그래서 목록이 스크롤 영역 안에 있어야 한다', () => {
    // 이 케이스가 실패하면 "스크롤이 필요 없어졌다" 는 뜻이므로 구현을 되돌려도 좋다는 신호다.
    // 반대로 이 케이스가 있는 한, 목록을 스크롤 영역 밖으로 빼면 비온에서 행이 잘린다.
    const h = listStackHeight(BION.nodesPerTree, INVESTED_LIST.cols, INVESTED_LIST.cellH, INVESTED_LIST.gapY);
    expect(h).toBeGreaterThan(INVESTED_LIST.avail);
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

  it('어느 기체 타입이든 계열 전체는 팝업 한 화면보다 길다 — 그래서 스크롤이 필요하다', () => {
    const viewH = clampToRowHeight(POPUP_LIST.bottom - POPUP_LIST.top, POPUP_LIST.pitch);
    for (const def of SHIP_TYPES) {
      const totalH = listStackHeight(def.nodesPerTree, 1, POPUP_LIST.rowH, POPUP_LIST.gapY);
      expect(totalH, def.slug).toBeGreaterThan(viewH);
    }
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

describe('타입 조회는 손상 입력에서도 화면을 죽이지 않는다', () => {
  it('범위 밖 typeId 는 스트라이커로 되돌아온다(빈 트리 화면 방지)', () => {
    expect(shipTypeDef(999).id).toBe(0);
    expect(shipTypeDef(-1).id).toBe(0);
    expect(shipTypeDef(Number.NaN).id).toBe(0);
  });
});
