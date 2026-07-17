/**
 * 방어 사령부 배치 에디터 순수 로직 테스트 (src/ui/defenseCommand.ts — M4 Phase C3, AC9).
 *
 * DOM 오버레이가 아니라 에디터를 떠받치는 순수 로직을 검증한다:
 *  1) 격자 ↔ 월드 좌표 왕복(칸 중앙 배치 무손실).
 *  2) 배치 포인트 예산제 — 비용 조회·소비 합·잔여·예산 초과 배치 거부(에디터 책임).
 *  3) 코어 정확히 1개 강제(이동은 허용, 스폰 칸 금지)·점유 칸 거부·지우개.
 *  4) 유효성 검사(코어 필수 + 예산 초과 없음)와 직렬화 왕복(save→load 동일).
 *  5) 배치 테스트(침공 config 스폰 스모크)가 계약대로 스폰 수를 맞춘다.
 */

import { describe, it, expect } from 'vitest';
import {
  GRID_COLS,
  GRID_ROWS,
  SPAWN_COL,
  SPAWN_ROW,
  DEFENSE_BUDGET_BASE,
  cellToWorld,
  worldToCell,
  emptyEditorState,
  placementCost,
  editorCost,
  remainingBudget,
  canAfford,
  findAt,
  tryPlace,
  validateEditor,
  editorStateToLayout,
  editorStateFromLayout,
  normalizeLayout,
  tryTestLayout,
  type DefenseEditorState,
} from '../src/ui/defenseCommand.js';
import {
  TURRET_VULCAN,
  TURRET_SNIPER,
  TURRET_MISSILE,
  OBSTACLE_COST,
  CORE_COST,
  TURRET_SPECS,
  type DefenseLayout,
} from '../src/sim/defense.js';

describe('격자 ↔ 월드 좌표 왕복', () => {
  it('cellToWorld → worldToCell이 모든 칸에서 무손실', () => {
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const w = cellToWorld(col, row);
        const c = worldToCell(w.x, w.y);
        expect(c).toEqual({ col, row });
      }
    }
  });

  it('정중앙 칸(스폰)이 월드 원점 (0,0)', () => {
    expect(cellToWorld(SPAWN_COL, SPAWN_ROW)).toEqual({ x: 0, y: 0 });
  });
});

describe('배치 비용 — 계약 데이터 조회', () => {
  it('포탑 비용은 TURRET_SPECS[type].cost', () => {
    expect(placementCost('turret', TURRET_VULCAN)).toBe(TURRET_SPECS[TURRET_VULCAN]!.cost);
    expect(placementCost('turret', TURRET_SNIPER)).toBe(TURRET_SPECS[TURRET_SNIPER]!.cost);
  });

  it('장애물·코어·지우개 비용', () => {
    expect(placementCost('obstacle')).toBe(OBSTACLE_COST);
    expect(placementCost('core')).toBe(CORE_COST);
    expect(placementCost('erase')).toBe(0);
  });

  it('알 수 없는 포탑 유형은 비용 0(방어적)', () => {
    expect(placementCost('turret', 999)).toBe(0);
  });
});

/** 코어를 하단 중앙 칸에 둔 상태(스폰 칸 회피). */
function stateWithCore(): DefenseEditorState {
  const s = emptyEditorState();
  const c = cellToWorld(SPAWN_COL, GRID_ROWS - 1);
  s.core = { x: c.x, y: c.y };
  return s;
}

describe('예산제 — 소비·잔여·초과 거부(에디터 책임)', () => {
  it('editorCost는 코어(0)+포탑+장애물 비용의 합', () => {
    const s = stateWithCore();
    tryPlace(s, DEFENSE_BUDGET_BASE, { kind: 'turret', turretType: TURRET_VULCAN }, 0, 0); // 1
    tryPlace(s, DEFENSE_BUDGET_BASE, { kind: 'turret', turretType: TURRET_SNIPER }, 1, 0); // 3
    tryPlace(s, DEFENSE_BUDGET_BASE, { kind: 'obstacle' }, 2, 0); // 1
    const expected =
      CORE_COST + TURRET_SPECS[TURRET_VULCAN]!.cost + TURRET_SPECS[TURRET_SNIPER]!.cost + OBSTACLE_COST;
    expect(editorCost(s)).toBe(expected);
    expect(remainingBudget(s, DEFENSE_BUDGET_BASE)).toBe(DEFENSE_BUDGET_BASE - expected);
  });

  it('예산을 초과하는 배치는 insufficient로 거부되고 상태가 변하지 않는다', () => {
    const s = emptyEditorState();
    // 예산 5로 좁혀 미사일(3)+미사일(3)=6 두 번째를 거부시킨다.
    const budget = 5;
    expect(tryPlace(s, budget, { kind: 'turret', turretType: TURRET_MISSILE }, 0, 0)).toBe('placed');
    const before = s.turrets.length;
    expect(tryPlace(s, budget, { kind: 'turret', turretType: TURRET_MISSILE }, 1, 0)).toBe('insufficient');
    expect(s.turrets.length).toBe(before); // 거부 → 무변경
    expect(editorCost(s)).toBeLessThanOrEqual(budget);
  });

  it('canAfford는 잔여 대비 비용을 정확히 판정', () => {
    const s = emptyEditorState();
    const budget = 3;
    expect(canAfford(s, budget, 'turret', TURRET_MISSILE)).toBe(true); // 3<=3
    tryPlace(s, budget, { kind: 'turret', turretType: TURRET_MISSILE }, 0, 0);
    expect(canAfford(s, budget, 'obstacle')).toBe(false); // 잔여 0
    expect(canAfford(s, budget, 'core')).toBe(true); // 비용 0은 항상 가능
  });
});

describe('코어 단일 강제 · 점유 · 스폰 칸 · 지우개', () => {
  it('스폰 칸에는 코어·포탑을 놓을 수 없다(장애물은 허용)', () => {
    const s = emptyEditorState();
    expect(tryPlace(s, DEFENSE_BUDGET_BASE, { kind: 'core' }, SPAWN_COL, SPAWN_ROW)).toBe('spawn');
    expect(tryPlace(s, DEFENSE_BUDGET_BASE, { kind: 'turret', turretType: 0 }, SPAWN_COL, SPAWN_ROW)).toBe('spawn');
    expect(s.core).toBeNull();
    expect(tryPlace(s, DEFENSE_BUDGET_BASE, { kind: 'obstacle' }, SPAWN_COL, SPAWN_ROW)).toBe('placed');
  });

  it('코어를 다시 놓으면 이동(단일 유지) — 두 번째 코어가 생기지 않는다', () => {
    const s = emptyEditorState();
    expect(tryPlace(s, DEFENSE_BUDGET_BASE, { kind: 'core' }, 0, 0)).toBe('placed');
    expect(tryPlace(s, DEFENSE_BUDGET_BASE, { kind: 'core' }, 3, 3)).toBe('moved');
    expect(s.core).toEqual(cellToWorld(3, 3));
  });

  it('점유된 칸에 다른 엔티티는 거부(occupied)', () => {
    const s = emptyEditorState();
    tryPlace(s, DEFENSE_BUDGET_BASE, { kind: 'turret', turretType: 0 }, 0, 0);
    expect(tryPlace(s, DEFENSE_BUDGET_BASE, { kind: 'obstacle' }, 0, 0)).toBe('occupied');
    expect(tryPlace(s, DEFENSE_BUDGET_BASE, { kind: 'core' }, 0, 0)).toBe('occupied');
  });

  it('지우개는 칸을 비우고, 빈 칸이면 noop', () => {
    const s = emptyEditorState();
    tryPlace(s, DEFENSE_BUDGET_BASE, { kind: 'turret', turretType: 0 }, 0, 0);
    expect(findAt(s, 0, 0)).not.toBeNull();
    expect(tryPlace(s, DEFENSE_BUDGET_BASE, { kind: 'erase' }, 0, 0)).toBe('removed');
    expect(findAt(s, 0, 0)).toBeNull();
    expect(tryPlace(s, DEFENSE_BUDGET_BASE, { kind: 'erase' }, 0, 0)).toBe('noop');
  });
});

describe('유효성 검사 — 코어 필수 + 예산 초과 없음', () => {
  it('코어가 없으면 무효', () => {
    const s = emptyEditorState();
    const v = validateEditor(s, DEFENSE_BUDGET_BASE);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes('코어'))).toBe(true);
  });

  it('코어 1개 + 예산 내면 유효', () => {
    const s = stateWithCore();
    tryPlace(s, DEFENSE_BUDGET_BASE, { kind: 'turret', turretType: TURRET_VULCAN }, 0, 0);
    expect(validateEditor(s, DEFENSE_BUDGET_BASE).ok).toBe(true);
  });

  it('예산 초과 상태는 무효(작은 예산으로 강제 초과 검사)', () => {
    // tryPlace는 초과를 막지만, 저장된 배치를 작은 예산으로 재검증하는 경로를 모사한다.
    const s = stateWithCore();
    s.turrets.push({ type: TURRET_MISSILE, x: 100, y: 100 });
    s.turrets.push({ type: TURRET_MISSILE, x: 200, y: 200 });
    const v = validateEditor(s, 2); // 비용 6 > 예산 2
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes('예산 초과'))).toBe(true);
  });
});

describe('직렬화 왕복 — save→load 동일 (계약: defenses.layout = DefenseLayout)', () => {
  it('코어 없으면 editorStateToLayout은 null', () => {
    expect(editorStateToLayout(emptyEditorState())).toBeNull();
  });

  it('editorStateToLayout → JSON 왕복 → normalizeLayout이 동일 배치를 복원', () => {
    const s = stateWithCore();
    tryPlace(s, DEFENSE_BUDGET_BASE, { kind: 'turret', turretType: TURRET_VULCAN }, 0, 0);
    tryPlace(s, DEFENSE_BUDGET_BASE, { kind: 'turret', turretType: TURRET_SNIPER }, 1, 0);
    tryPlace(s, DEFENSE_BUDGET_BASE, { kind: 'obstacle' }, 2, 2);
    const layout = editorStateToLayout(s);
    expect(layout).not.toBeNull();

    const roundTripped = normalizeLayout(JSON.parse(JSON.stringify(layout)));
    expect(roundTripped).toEqual(layout);

    // 에디터 상태로도 무손실 복원.
    const reloaded = editorStateFromLayout(roundTripped!);
    expect(reloaded).toEqual(s);
  });

  it('normalizeLayout은 손상 데이터를 걸러낸다', () => {
    expect(normalizeLayout(null)).toBeNull();
    expect(normalizeLayout({ turrets: [], obstacles: [] })).toBeNull(); // 코어 없음
    expect(normalizeLayout({ core: { x: 1, y: 'x' } })).toBeNull(); // 코어 좌표 무효

    // 유효 코어 + 범위 밖 포탑 유형·잘못된 장애물은 필터되고 나머지는 보존.
    const cleaned = normalizeLayout({
      core: { x: 0, y: 0 },
      turrets: [
        { type: 0, x: 1, y: 2 },
        { type: 99, x: 3, y: 4 }, // 범위 밖 → 제거
        { type: 1 }, // 좌표 없음 → 제거
      ],
      obstacles: [
        { x: 5, y: 6, halfW: 10, halfH: 10 },
        { x: 7, y: 8, halfW: -1, halfH: 10 }, // 음수 반폭 → 제거
      ],
    });
    expect(cleaned).not.toBeNull();
    expect(cleaned!.turrets).toEqual([{ type: 0, x: 1, y: 2 }]);
    expect(cleaned!.obstacles).toEqual([{ x: 5, y: 6, halfW: 10, halfH: 10 }]);
  });
});

describe('배치 테스트 — 침공 config 스폰 스모크(sim 읽기 전용)', () => {
  it('배치가 계약대로 코어 1·포탑 N·장애물 M을 스폰하고 무예외로 굴러간다', () => {
    const layout: DefenseLayout = {
      core: { x: 400, y: 0 },
      turrets: [
        { type: TURRET_VULCAN, x: 200, y: 0 },
        { type: TURRET_SNIPER, x: 200, y: 200 },
      ],
      obstacles: [{ x: 100, y: 0, halfW: 56, halfH: 52 }],
    };
    const report = tryTestLayout(layout, 30);
    expect(report.ok).toBe(true);
    expect(report.cores).toBe(1);
    expect(report.turrets).toBe(2);
    expect(report.walls).toBe(1);
    expect(report.steppedTicks).toBeGreaterThan(0);
  });
});
