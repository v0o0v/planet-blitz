/**
 * 연구소(찍은 것만 표시 + 전체 스킬 스크롤 팝업)의 UI-독립 헬퍼 검증.
 *
 * 여기서 고정하는 것은 **계산**뿐이다: 어떤 노드가 본 패널에 뜨는가(`investedNodeIndices`),
 * 목록·팝업 마스크가 반토막 행을 만들지 않는가(`clampToRowHeight`), 스크롤이 범위를 벗어나지
 * 않는가(`clampScroll`). 실제 렌더(아이콘 여백·프레임 침범)는 브라우저 확대 크롭 확인 몫이다.
 *
 * ## ADR-0049 — flat 구조로 재편
 * 구조가 **티어 5단 × 계열 3 + 계열별 캡스톤**(기체별로 20~25노드씩 다른 트리)에서
 * **flat 3축 × 축당 10스킬**(전 기체 30노드 동일, `SKILLS_PER_AXIS`)로 바뀌었다. 캡스톤·티어·
 * 사슬 선행 조건이 전부 폐기됐으므로 그 구조를 검사하던 단언(캡스톤 인덱스가 base 구간과
 * 안 겹친다, 기체별 노드 수가 다르다 등)은 지우고 flat 불변식(축 3개·축당 10칸·상한 20·
 * 축 슬라이스끼리 안 겹친다)으로 대체한다.
 *
 * 계열을 가리키던 문자열(`'firepower'|'survival'|'mobility'`)이 **(타입 정의, 트리 인덱스)** 로
 * 일반화된 것은 M8 그대로다 — 이름 축을 남기면 신규 기체의 계열은 함수에 들어올 수조차 없다.
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
import {
  SHIP_TYPES,
  STRIKER,
  shipTypeDef,
  shipTreeRange,
  shipNodeCount,
  zeroSkillInvest,
  TREE_AFFINITIES,
  SKILLS_PER_AXIS,
  SKILL_MAX_LEVEL,
  TREES_PER_SHIP,
} from '../data/ships/index.js';

/** 스트라이커(전 기체 공통) 빈 투자 벡터 — 30칸 = 3축 × 10. */
function emptyInvest(): number[] {
  return new Array<number>(shipNodeCount(STRIKER)).fill(0);
}

describe('investedNodeIndices — 본 패널은 찍은 것만 보여 준다', () => {
  it('투자가 없으면 빈 목록', () => {
    const invest = emptyInvest();
    for (let tree = 0; tree < STRIKER.trees.length; tree++) {
      expect(investedNodeIndices(invest, STRIKER, tree)).toEqual([]);
    }
  });

  it('해당 계열 범위 안에서 0보다 큰 칸만, flat 순서로 돌려준다', () => {
    const invest = emptyInvest();
    invest[3] = 1; // 축 0
    invest[7] = 4; // 축 0
    invest[12] = 2; // 축 1 첫 노드
    expect(investedNodeIndices(invest, STRIKER, 0)).toEqual([3, 7]);
    expect(investedNodeIndices(invest, STRIKER, 1)).toEqual([12]);
    expect(investedNodeIndices(invest, STRIKER, 2)).toEqual([]);
  });

  it('짧은/손상 벡터도 안전(누락 = 0)', () => {
    expect(investedNodeIndices([], STRIKER, 2)).toEqual([]);
    expect(investedNodeIndices([1, 0, 2], STRIKER, 0)).toEqual([0, 2]);
  });

  it('한 축을 전부 찍으면 그 축 전량(10칸)이 나온다 — **전 SHIP_TYPES**', () => {
    // 축당 스킬 수는 ADR-0049 에서 전 기체 동일(SKILLS_PER_AXIS)이지만, 슬라이스 폭을
    // 상수로 박지 않고 매번 shipTreeRange 로 다시 구해 회귀를 방어한다.
    for (const def of SHIP_TYPES) {
      const invest = zeroSkillInvest(def.id);
      for (let tree = 0; tree < def.trees.length; tree++) {
        const { start, end } = shipTreeRange(def, tree);
        for (let i = start; i < end; i++) invest[i] = 1;
        expect(investedNodeIndices(invest, def, tree), `${def.slug}/${tree}`).toHaveLength(
          SKILLS_PER_AXIS,
        );
        for (let i = start; i < end; i++) invest[i] = 0;
      }
    }
  });

  it('축 슬라이스는 어느 타입에서도 서로 겹치지 않는다', () => {
    for (const def of SHIP_TYPES) {
      const ranges = def.trees.map((_, i) => shipTreeRange(def, i));
      for (let a = 0; a < ranges.length; a++) {
        for (let b = a + 1; b < ranges.length; b++) {
          const ra = ranges[a]!;
          const rb = ranges[b]!;
          const overlap = ra.start < rb.end && rb.start < ra.end;
          expect(overlap, `${def.slug} 축${a}·축${b}`).toBe(false);
        }
      }
    }
  });
});

describe('flat 구조 불변식(ADR-0049)', () => {
  it('전 기체가 3축 × 축당 10칸 = 30칸 고정이다', () => {
    for (const def of SHIP_TYPES) {
      expect(def.trees.length, def.slug).toBe(TREES_PER_SHIP);
      expect(shipNodeCount(def), def.slug).toBe(TREES_PER_SHIP * SKILLS_PER_AXIS);
    }
  });

  it('모든 스킬의 투자 상한은 SKILL_MAX_LEVEL(20)이다', () => {
    for (const def of SHIP_TYPES) {
      for (const tree of def.trees) {
        for (const node of tree.nodes) {
          expect(node.maxPoints, `${def.slug}/${node.id}`).toBe(SKILL_MAX_LEVEL);
        }
      }
    }
  });

  it('노드의 axis 필드가 소속 트리의 affinity 와 일치한다(저작 실수 검출)', () => {
    for (const def of SHIP_TYPES) {
      for (const tree of def.trees) {
        for (const node of tree.nodes) {
          expect(node.axis, `${def.slug}/${node.id}`).toBe(tree.affinity);
        }
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
  it('축당 10노드는 스크롤 없이 들어간다(전 기체 동일 — ADR-0049)', () => {
    const h = listStackHeight(SKILLS_PER_AXIS, INVESTED_LIST.cols, INVESTED_LIST.cellH, INVESTED_LIST.gapY);
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

  it('어느 기체 타입이든 축 전체(10개)가 팝업 한 화면에 들어간다 — ADR-0049 는 스크롤이 필요 없어졌다', () => {
    // 구조가 "전부 20~25노드라 항상 넘친다"에서 "전부 정확히 10노드"로 바뀌면서, 팝업도
    // 그 수에 맞춰 정확히 재단됐다(POP_VISIBLE_ROWS = SKILLS_PER_AXIS, 빈 자리 금지 원칙).
    // 이 케이스가 실패하면 팝업 행 수 상수가 축당 스킬 수보다 작아졌다는 뜻이다.
    const viewH = clampToRowHeight(POPUP_LIST.bottom - POPUP_LIST.top, POPUP_LIST.pitch);
    for (const def of SHIP_TYPES) {
      const totalH = listStackHeight(SKILLS_PER_AXIS, 1, POPUP_LIST.rowH, POPUP_LIST.gapY);
      expect(totalH, def.slug).toBeLessThanOrEqual(viewH);
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
