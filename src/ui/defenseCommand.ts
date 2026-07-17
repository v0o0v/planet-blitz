/**
 * 방어 사령부 — 방어 배치 에디터 오버레이 (M4 Phase C3, plan §4/AC9, GDD §8).
 *
 * 방어자가 침공(비동기 PvP) 대비 배치를 짜는 화면이다. 격자 맵 위에 포탑 6종(발칸·저격·
 * 산탄·감속·미사일·전격)·장애물(벽)·코어(침공 목표, 정확히 1개)를 놓고, **배치 포인트
 * 예산제**로 총량을 제한한다. 결과는 {@link DefenseLayout} JSON으로 직렬화되어 프로필에
 * 저장된다(당장은 로컬 세이브 — Supabase `defenses` 테이블 연동은 Phase B 후속, 아래 TODO).
 *
 * 계약(`.omc/handoffs/lane-c1-contract.md` / `src/sim/defense.ts`):
 *   - 배치 JSON = DefenseLayout(core/turrets/obstacles). 장애물은 별도 kind가 아니라 기존
 *     `wall` 재사용이므로 AABB 반폭(halfW)·반높이(halfH)로 직렬화한다.
 *   - 배치 비용은 `TURRET_SPECS[type].cost`·`OBSTACLE_COST`·`CORE_COST`. 예산 검증은
 *     **에디터 책임**(sim은 강제하지 않음 — 비용 데이터만 제공).
 *
 * 결정론 무관: 이 모듈은 렌더/메타 전용이다. 에디터가 만든 정적 배치 데이터만 침공 런
 * config로 흘러가고, 그 시뮬은 sim이 결정론으로 재현한다(에디터는 sim을 수정하지 않는다).
 *
 * 레이스 주의(과거 레벨업 오버레이 결함 계열): 이 오버레이는 refinery/baseMap과 동일하게
 * `show()`에서 1회 렌더하고 사용자 상호작용에만 다시 그린다 — 매 프레임 트리거가 없다.
 */

import {
  TURRET_SPECS,
  TURRET_TYPE_COUNT,
  OBSTACLE_COST,
  CORE_COST,
  DEFAULT_TIME_LIMIT_TICKS,
  type DefenseLayout,
  type CorePlacement,
  type TurretPlacement,
  type ObstaclePlacement,
  type InvasionConfig,
} from '../sim/defense.js';
import {
  createWorld,
  stepWorld,
  emptyInput,
  DEFAULT_CONFIG,
  type WorldConfig,
} from '../sim/world.js';
import { saveProfile, type KeyValueStore, type Profile } from '../save/profile.js';

// ---------------------------------------------------------------------------
// 격자 기하 (순수 · 테스트 대상)
// ---------------------------------------------------------------------------
/** 배치 격자 가로 칸 수(홀수 → 정중앙 칸이 존재 = 공격자 스폰). */
export const GRID_COLS = 15;
/** 배치 격자 세로 칸 수(홀수 → 정중앙 칸). */
export const GRID_ROWS = 9;
/** 칸 하나의 월드 가로 폭(유닛). */
export const CELL_W = 128;
/** 칸 하나의 월드 세로 폭(유닛). */
export const CELL_H = 120;
/** 장애물(벽) AABB 반폭 — 칸 안에 들어오도록 여백을 둔다. */
export const OBSTACLE_HALF_W = 56;
/** 장애물(벽) AABB 반높이. */
export const OBSTACLE_HALF_H = 52;

/**
 * 배치 포인트 예산(초기값). 계획 §5: "전원 동일 + 시설 업그레이드 소폭 증가".
 *
 * 근거: 포탑 비용은 발칸1·산탄2·감속2·전격2·저격3·미사일3(계약). 예산 20은 대략
 *   - 발칸 20기(저비용 도배), 또는
 *   - 저격/미사일 6기(고비용 소수), 또는
 *   - 혼합 8기 + 장애물 2개
 * 규모를 허용한다 — 필드를 포화시키기엔 모자라 방어자가 전략을 **선택**하게 만드는 값.
 * 시설 업그레이드 증가분·최종 밸런스는 M5 밸런싱 패스(튜닝 대상, 계획 §5). 코어(0)·
 * 장애물(1) 비용도 여기서 차감된다.
 */
export const DEFENSE_BUDGET_BASE = 20;

/** 격자 칸(col,row) → 월드 좌표(원점 중앙, 공격자 스폰 = 정중앙 칸 = 월드 (0,0)). */
export function cellToWorld(col: number, row: number): { x: number; y: number } {
  return {
    x: (col - (GRID_COLS - 1) / 2) * CELL_W,
    y: (row - (GRID_ROWS - 1) / 2) * CELL_H,
  };
}

/** 월드 좌표 → 가장 가까운 격자 칸. cellToWorld의 역함수(칸 중앙 배치라 왕복 무손실). */
export function worldToCell(x: number, y: number): { col: number; row: number } {
  return {
    col: Math.round(x / CELL_W + (GRID_COLS - 1) / 2),
    row: Math.round(y / CELL_H + (GRID_ROWS - 1) / 2),
  };
}

/** 공격자 스폰 칸(정중앙) — 여기엔 코어·포탑을 놓지 못하게 막는다(즉사 배치 방지). */
export const SPAWN_COL = (GRID_COLS - 1) / 2;
export const SPAWN_ROW = (GRID_ROWS - 1) / 2;

// ---------------------------------------------------------------------------
// 에디터 상태 모델 + 순수 연산 (테스트 대상)
// ---------------------------------------------------------------------------
/** 배치 도구. `erase`는 칸 비우기, 나머지는 해당 엔티티 놓기. */
export type ToolKind = 'turret' | 'obstacle' | 'core' | 'erase';

/** 현재 선택된 도구(포탑이면 유형 코드 동반). */
export interface Tool {
  kind: ToolKind;
  /** kind==='turret'일 때만 유효한 포탑 유형 코드(TURRET_*). */
  turretType?: number;
}

/**
 * 에디터 작업 상태. 계약의 {@link DefenseLayout}과 달리 `core`가 **null 가능**하다 —
 * 편집 중에는 코어 미배치 상태가 있고, 유효(코어 1개)할 때만 레이아웃으로 직렬화한다.
 */
export interface DefenseEditorState {
  core: CorePlacement | null;
  turrets: TurretPlacement[];
  obstacles: ObstaclePlacement[];
}

/** 빈 에디터 상태(코어 미배치). */
export function emptyEditorState(): DefenseEditorState {
  return { core: null, turrets: [], obstacles: [] };
}

/** 배치 1건의 비용을 계약 데이터로 조회. */
export function placementCost(kind: ToolKind, turretType?: number): number {
  switch (kind) {
    case 'turret': {
      const spec = TURRET_SPECS[turretType ?? -1];
      return spec?.cost ?? 0;
    }
    case 'obstacle':
      return OBSTACLE_COST;
    case 'core':
      return CORE_COST;
    case 'erase':
      return 0;
    default:
      return 0;
  }
}

/** 현재 상태가 소비한 총 배치 포인트. */
export function editorCost(state: DefenseEditorState): number {
  let sum = state.core !== null ? CORE_COST : 0;
  for (const t of state.turrets) sum += placementCost('turret', t.type);
  sum += state.obstacles.length * OBSTACLE_COST;
  return sum;
}

/** 남은 배치 포인트(예산 − 소비). 음수일 수 있으므로 배치 게이트에서 확인한다. */
export function remainingBudget(state: DefenseEditorState, budget: number): number {
  return budget - editorCost(state);
}

/** 도구 1건을 예산 내에서 놓을 수 있는지(비용 ≤ 잔여). erase/core는 항상 가능(비용 0). */
export function canAfford(
  state: DefenseEditorState,
  budget: number,
  kind: ToolKind,
  turretType?: number,
): boolean {
  return placementCost(kind, turretType) <= remainingBudget(state, budget);
}

/** 칸 점유 정보(있으면 종류+배열 인덱스). */
export type Occupant =
  | { kind: 'core' }
  | { kind: 'turret'; index: number }
  | { kind: 'obstacle'; index: number }
  | null;

/** 특정 격자 칸의 점유물을 찾는다(월드 좌표를 칸으로 환산해 비교). */
export function findAt(state: DefenseEditorState, col: number, row: number): Occupant {
  if (state.core !== null) {
    const c = worldToCell(state.core.x, state.core.y);
    if (c.col === col && c.row === row) return { kind: 'core' };
  }
  for (let i = 0; i < state.turrets.length; i++) {
    const t = state.turrets[i]!;
    const c = worldToCell(t.x, t.y);
    if (c.col === col && c.row === row) return { kind: 'turret', index: i };
  }
  for (let i = 0; i < state.obstacles.length; i++) {
    const o = state.obstacles[i]!;
    const c = worldToCell(o.x, o.y);
    if (c.col === col && c.row === row) return { kind: 'obstacle', index: i };
  }
  return null;
}

/** {@link tryPlace} 결과 코드. */
export type PlaceResult = 'placed' | 'moved' | 'removed' | 'occupied' | 'insufficient' | 'spawn' | 'noop';

/**
 * 도구를 격자 칸에 적용(상태를 제자리 변경). 예산·점유·스폰 칸·단일 코어 규칙을 강제한다.
 * 순수 로직(DOM 무관)이라 vitest로 직접 검증한다.
 */
export function tryPlace(
  state: DefenseEditorState,
  budget: number,
  tool: Tool,
  col: number,
  row: number,
): PlaceResult {
  const occ = findAt(state, col, row);

  if (tool.kind === 'erase') {
    if (occ === null) return 'noop';
    removeOccupant(state, occ);
    return 'removed';
  }

  // 코어·포탑은 공격자 스폰 칸에 놓지 못한다(장애물은 허용 — 스폰 봉쇄 여지).
  if ((tool.kind === 'core' || tool.kind === 'turret') && col === SPAWN_COL && row === SPAWN_ROW) {
    return 'spawn';
  }

  const { x, y } = cellToWorld(col, row);

  if (tool.kind === 'core') {
    // 코어는 이미 있던 칸을 옮기는 것도 허용(비용 0). 다른 엔티티가 점유 중이면 거부.
    if (occ !== null && occ.kind !== 'core') return 'occupied';
    const moved = state.core !== null;
    state.core = { x, y };
    return moved ? 'moved' : 'placed';
  }

  // turret / obstacle: 점유 칸이면 거부, 예산 부족이면 거부.
  if (occ !== null) return 'occupied';
  if (!canAfford(state, budget, tool.kind, tool.turretType)) return 'insufficient';

  if (tool.kind === 'turret') {
    state.turrets.push({ type: tool.turretType ?? 0, x, y });
  } else {
    state.obstacles.push({ x, y, halfW: OBSTACLE_HALF_W, halfH: OBSTACLE_HALF_H });
  }
  return 'placed';
}

function removeOccupant(state: DefenseEditorState, occ: NonNullable<Occupant>): void {
  switch (occ.kind) {
    case 'core':
      state.core = null;
      break;
    case 'turret':
      state.turrets.splice(occ.index, 1);
      break;
    case 'obstacle':
      state.obstacles.splice(occ.index, 1);
      break;
  }
}

/** 배치 유효성 검사: 코어 정확히 1개 + 예산 초과 없음. */
export function validateEditor(
  state: DefenseEditorState,
  budget: number,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (state.core === null) errors.push('코어를 1개 배치해야 합니다.');
  const cost = editorCost(state);
  if (cost > budget) errors.push(`예산 초과: ${cost}/${budget} 포인트.`);
  return { ok: errors.length === 0, errors };
}

/** 유효한 에디터 상태를 {@link DefenseLayout}으로 직렬화(코어 없으면 null). */
export function editorStateToLayout(state: DefenseEditorState): DefenseLayout | null {
  if (state.core === null) return null;
  return {
    core: { x: state.core.x, y: state.core.y },
    turrets: state.turrets.map((t) => ({ type: t.type, x: t.x, y: t.y })),
    obstacles: state.obstacles.map((o) => ({ x: o.x, y: o.y, halfW: o.halfW, halfH: o.halfH })),
  };
}

/** {@link DefenseLayout} → 에디터 상태(저장분 불러오기). */
export function editorStateFromLayout(layout: DefenseLayout): DefenseEditorState {
  return {
    core: { x: layout.core.x, y: layout.core.y },
    turrets: layout.turrets.map((t) => ({ type: t.type, x: t.x, y: t.y })),
    obstacles: layout.obstacles.map((o) => ({ x: o.x, y: o.y, halfW: o.halfW, halfH: o.halfH })),
  };
}

// ---------------------------------------------------------------------------
// 직렬화 왕복 가드 (저장/로드 · 테스트 대상)
// ---------------------------------------------------------------------------
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 저장 blob → 유효 {@link DefenseLayout}(깊은 형태 검사). 손상/부분 데이터는 null.
 * save→load 왕복이 무손실임을 보장하는 가드(vitest 왕복 테스트 대상).
 */
export function normalizeLayout(raw: unknown): DefenseLayout | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Record<string, unknown>;
  const core = d.core;
  if (typeof core !== 'object' || core === null) return null;
  const cx = (core as Record<string, unknown>).x;
  const cy = (core as Record<string, unknown>).y;
  if (!isNum(cx) || !isNum(cy)) return null;

  const turrets: TurretPlacement[] = [];
  if (Array.isArray(d.turrets)) {
    for (const t of d.turrets) {
      if (typeof t !== 'object' || t === null) continue;
      const tt = t as Record<string, unknown>;
      if (!isNum(tt.type) || !isNum(tt.x) || !isNum(tt.y)) continue;
      const type = Math.trunc(tt.type);
      if (type < 0 || type >= TURRET_TYPE_COUNT) continue;
      turrets.push({ type, x: tt.x, y: tt.y });
    }
  }

  const obstacles: ObstaclePlacement[] = [];
  if (Array.isArray(d.obstacles)) {
    for (const o of d.obstacles) {
      if (typeof o !== 'object' || o === null) continue;
      const oo = o as Record<string, unknown>;
      if (!isNum(oo.x) || !isNum(oo.y) || !isNum(oo.halfW) || !isNum(oo.halfH)) continue;
      if (oo.halfW <= 0 || oo.halfH <= 0) continue;
      obstacles.push({ x: oo.x, y: oo.y, halfW: oo.halfW, halfH: oo.halfH });
    }
  }

  return { core: { x: cx, y: cy }, turrets, obstacles };
}

// ---------------------------------------------------------------------------
// 배치 테스트(선택) — 침공 config로 넣어 스폰·스텝 스모크 (sim 읽기 전용)
// ---------------------------------------------------------------------------
/** {@link tryTestLayout} 결과 요약(사람이 읽는 배치 검증 리포트). */
export interface TestReport {
  ok: boolean;
  cores: number;
  turrets: number;
  walls: number;
  steppedTicks: number;
  message: string;
}

/**
 * 배치를 침공 config로 만들어 로컬 시뮬을 짧게 돌린다(스폰 정합 + 스텝 무예외 스모크).
 *
 * 전체 플레이테스트(공격자 AI로 코어 파괴까지)는 공격 입력 모델이 필요해 이번 마일스톤
 * 범위 밖이다 — TODO(M4 후속: 관전/리플레이 재생과 함께 실제 침공 미리보기). 여기서는
 * 배치가 결정론 시뮬에 정상 주입·스폰되고 몇 틱 굴러가는지만 확인한다.
 */
export function tryTestLayout(layout: DefenseLayout, ticks = 60): TestReport {
  const invasion: InvasionConfig = { layout, timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS };
  const config: WorldConfig = { ...DEFAULT_CONFIG, invasion };
  const world = createWorld(0x5eed, config);
  const idle = emptyInput();
  let stepped = 0;
  for (let i = 0; i < ticks; i++) {
    if (world.gameOver || world.victory) break;
    stepWorld(world, idle);
    stepped++;
  }
  let cores = 0;
  let turrets = 0;
  let walls = 0;
  for (const e of world.entities) {
    if (e.kind === 'core') cores++;
    else if (e.kind === 'defenseTurret') turrets++;
    else if (e.kind === 'wall') walls++;
  }
  const expTurrets = layout.turrets.length;
  const expWalls = layout.obstacles.length;
  const ok = cores === 1 && turrets === expTurrets && walls === expWalls;
  return {
    ok,
    cores,
    turrets,
    walls,
    steppedTicks: stepped,
    message: ok
      ? `배치 검증 통과: 코어 ${cores} · 포탑 ${turrets} · 장애물 ${walls} (${stepped}틱 시뮬 무예외).`
      : `배치 검증 불일치: 코어 ${cores}(기대 1) · 포탑 ${turrets}/${expTurrets} · 장애물 ${walls}/${expWalls}.`,
  };
}

// ---------------------------------------------------------------------------
// 팔레트 표시 데이터
// ---------------------------------------------------------------------------
interface PaletteEntry {
  tool: Tool;
  label: string;
  glyph: string;
  accent: string;
  hint: string;
}

/** 포탑 유형별 표시(글리프·색·요약). 인덱스 = TURRET_* 코드. */
const TURRET_DISPLAY: readonly { label: string; glyph: string; accent: string; hint: string }[] = [
  { label: '발칸', glyph: '🔫', accent: '#4cd7ff', hint: '기본 연사 · 중피해' },
  { label: '저격', glyph: '🎯', accent: '#ff5a7a', hint: '장거리 · 고피해 · 저속' },
  { label: '산탄', glyph: '💥', accent: '#ffd24c', hint: '근거리 부채꼴 다발' },
  { label: '감속', glyph: '❄️', accent: '#7ad0ff', hint: '냉기 장판 · 감속' },
  { label: '미사일', glyph: '🚀', accent: '#ff9a4c', hint: '유도 · 중피해' },
  { label: '전격', glyph: '⚡', accent: '#c86aff', hint: '고속 약탄 연쇄' },
];

/** 팔레트 항목(포탑 6종 + 장애물 + 코어 + 지우개). */
function buildPalette(): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  for (let type = 0; type < TURRET_TYPE_COUNT; type++) {
    const d = TURRET_DISPLAY[type];
    const spec = TURRET_SPECS[type];
    if (d === undefined || spec === undefined) continue;
    out.push({
      tool: { kind: 'turret', turretType: type },
      label: d.label,
      glyph: d.glyph,
      accent: d.accent,
      hint: `${d.hint} · 비용 ${spec.cost}`,
    });
  }
  out.push({
    tool: { kind: 'obstacle' },
    label: '장애물',
    glyph: '🧱',
    accent: '#8896b8',
    hint: `벽 · 이동·탄·시야 차단 · 비용 ${OBSTACLE_COST}`,
  });
  out.push({
    tool: { kind: 'core' },
    label: '코어',
    glyph: '💠',
    accent: '#8fd94c',
    hint: `침공 목표 · 필수 1개 · 비용 ${CORE_COST}`,
  });
  out.push({
    tool: { kind: 'erase' },
    label: '지우개',
    glyph: '🧹',
    accent: '#68789c',
    hint: '칸의 배치 제거',
  });
  return out;
}

/** 도구가 같은지 비교(팔레트 선택 강조용). */
function sameTool(a: Tool, b: Tool): boolean {
  return a.kind === b.kind && (a.turretType ?? -1) === (b.turretType ?? -1);
}

// ---------------------------------------------------------------------------
// DOM 오버레이
// ---------------------------------------------------------------------------
const STYLE = `
#pb-def { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; gap:12px; padding:20px 16px; box-sizing:border-box; background:radial-gradient(circle at 50% 18%,#0a1424,#03050c 76%); backdrop-filter:blur(3px); font-family:'Segoe UI',system-ui,sans-serif; z-index:29; overflow:auto; }
#pb-def h1 { margin:0; color:#8fd94c; font-size:24px; font-weight:900; letter-spacing:2px; }
#pb-def .pb-sub { color:#8896b8; font-size:12px; margin-top:-6px; }
#pb-def .pb-bar { display:flex; gap:18px; align-items:center; color:#e8ecff; font-size:14px; font-weight:700; }
#pb-def .pb-bar .pt { color:#8fd94c; }
#pb-def .pb-bar .pt.over { color:#ff6a6a; }
#pb-def .pb-cols { display:flex; gap:18px; align-items:flex-start; flex-wrap:wrap; justify-content:center; }
#pb-def .pb-panel { background:rgba(12,16,30,.7); border:1px solid #2a3552; border-radius:14px; padding:14px; }
#pb-def .pb-panel h2 { margin:0 0 10px; color:#aab6d6; font-size:13px; font-weight:700; letter-spacing:1px; }
#pb-def .pb-pal { display:grid; grid-template-columns:repeat(3,92px); gap:8px; }
#pb-def .pb-tool { position:relative; width:92px; padding:8px 6px; box-sizing:border-box; background:rgba(20,26,44,.85); border:2px solid #2a3552; border-radius:10px; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:3px; text-align:center; transition:transform .08s ease,border-color .08s ease; }
#pb-def .pb-tool:hover { transform:translateY(-2px); }
#pb-def .pb-tool.sel { outline:2px solid #7affea; outline-offset:1px; }
#pb-def .pb-tool .g { font-size:22px; line-height:1; }
#pb-def .pb-tool .l { color:#fff; font-size:12px; font-weight:800; }
#pb-def .pb-tool .c { color:#8fd94c; font-size:11px; font-weight:700; }
#pb-def .pb-tool .c.free { color:#68789c; }
#pb-def .pb-tip { min-height:14px; color:#aab6d6; font-size:11px; max-width:300px; text-align:center; }
#pb-def .pb-gridwrap { position:relative; }
#pb-def .pb-grid { display:grid; gap:2px; background:#0a1020; border:1px solid #2a3552; border-radius:10px; padding:4px; }
#pb-def .pb-cell { width:34px; height:34px; border-radius:5px; background:rgba(30,40,64,.55); display:flex; align-items:center; justify-content:center; font-size:18px; line-height:1; cursor:pointer; user-select:none; box-sizing:border-box; }
#pb-def .pb-cell:hover { background:rgba(60,80,120,.55); }
#pb-def .pb-cell.spawn { background:rgba(80,60,30,.55); }
#pb-def .pb-cell.spawn::after { content:'▲'; color:#ffb14c; font-size:12px; }
#pb-def .pb-guard { display:flex; gap:8px; margin-top:6px; }
#pb-def .pb-slot { width:52px; height:52px; border-radius:9px; border:2px dashed #3a4568; background:rgba(20,26,44,.5); display:flex; flex-direction:column; align-items:center; justify-content:center; color:#5a6788; font-size:10px; gap:2px; }
#pb-def .pb-slot .lk { font-size:16px; }
#pb-def .pb-hint { color:#ff9a7a; font-size:12px; min-height:14px; text-align:center; max-width:420px; }
#pb-def .pb-ok { color:#8fd94c; }
#pb-def .pb-actions { display:flex; gap:10px; flex-wrap:wrap; justify-content:center; }
#pb-def button.pb-act { pointer-events:auto; cursor:pointer; padding:10px 18px; font-size:14px; font-weight:700; color:#04121a; background:linear-gradient(90deg,#7affea,#8fd94c); border:none; border-radius:10px; }
#pb-def button.pb-act:disabled { opacity:.4; cursor:default; filter:grayscale(.5); }
#pb-def button.pb-ghost { pointer-events:auto; cursor:pointer; padding:10px 18px; font-size:14px; font-weight:700; color:#aab6d6; background:rgba(20,26,44,.9); border:1px solid #2a3552; border-radius:10px; }
`;

export class DefenseCommand {
  private readonly root: HTMLElement;
  private profile: Profile;
  private store: KeyValueStore | null;
  private onClose: (() => void) | null = null;
  private state: DefenseEditorState = emptyEditorState();
  private readonly budget = DEFENSE_BUDGET_BASE;
  private readonly palette = buildPalette();
  private tool: Tool = { kind: 'turret', turretType: 0 };
  private tip = '';
  private hint = '';

  constructor(profile: Profile, store: KeyValueStore | null = null) {
    this.profile = profile;
    this.store = store;
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'pb-def';
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  show(profile: Profile, onClose: () => void): void {
    this.profile = profile;
    this.onClose = onClose;
    // 저장된 배치가 있으면 불러오고, 없으면 코어를 기본 칸에 미리 놓아 시작을 돕는다.
    const saved = normalizeLayout(profile.defenseLayout);
    this.state = saved !== null ? editorStateFromLayout(saved) : emptyEditorState();
    if (this.state.core === null) {
      const c = cellToWorld(SPAWN_COL, GRID_ROWS - 1); // 스폰 반대쪽 하단 중앙
      this.state.core = { x: c.x, y: c.y };
    }
    this.tool = { kind: 'turret', turretType: 0 };
    this.tip = '';
    this.hint = '';
    this.render();
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
    this.onClose = null;
  }

  private persist(): void {
    saveProfile(this.profile, this.store);
  }

  private onCellClick(col: number, row: number): void {
    const res = tryPlace(this.state, this.budget, this.tool, col, row);
    switch (res) {
      case 'occupied':
        this.hint = '이미 배치된 칸입니다. 지우개로 비우고 놓으세요.';
        break;
      case 'insufficient':
        this.hint = '배치 포인트가 부족합니다.';
        break;
      case 'spawn':
        this.hint = '공격자 진입 지점에는 코어·포탑을 놓을 수 없습니다.';
        break;
      default:
        this.hint = '';
        break;
    }
    this.render();
  }

  private save(): void {
    const check = validateEditor(this.state, this.budget);
    if (!check.ok) {
      this.hint = check.errors.join(' ');
      this.render();
      return;
    }
    const layout = editorStateToLayout(this.state);
    if (layout === null) {
      this.hint = '코어를 1개 배치해야 합니다.';
      this.render();
      return;
    }
    // TODO(M4 Phase B 후속): Supabase `defenses` 테이블에 배치 JSON + 정비도 업서트.
    // 지금은 프로필(로컬 세이브)에만 저장한다(계약: defenses.layout = DefenseLayout).
    this.profile.defenseLayout = layout;
    this.persist();
    this.hint = '';
    this.tip = '배치를 저장했습니다.';
    this.render();
  }

  private test(): void {
    const layout = editorStateToLayout(this.state);
    if (layout === null) {
      this.hint = '코어를 1개 배치해야 배치 테스트가 가능합니다.';
      this.render();
      return;
    }
    const report = tryTestLayout(layout);
    this.hint = '';
    this.tip = report.message;
    this.render();
  }

  // --- Render --------------------------------------------------------------

  private render(): void {
    this.root.innerHTML = '';

    const h1 = document.createElement('h1');
    h1.textContent = '방어 사령부 — 배치 에디터';
    this.root.appendChild(h1);
    const sub = document.createElement('div');
    sub.className = 'pb-sub';
    sub.textContent = '포탑·장애물·코어를 배치해 침공에 대비하라. ▲ = 공격자 진입 지점.';
    this.root.appendChild(sub);

    this.root.appendChild(this.budgetBar());

    const cols = document.createElement('div');
    cols.className = 'pb-cols';
    cols.appendChild(this.palettePanel());
    cols.appendChild(this.gridPanel());
    this.root.appendChild(cols);

    const hintEl = document.createElement('div');
    hintEl.className = this.hint === '' ? 'pb-hint pb-ok' : 'pb-hint';
    hintEl.textContent = this.hint !== '' ? this.hint : this.tip;
    this.root.appendChild(hintEl);

    this.root.appendChild(this.actionRow());
  }

  private budgetBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'pb-bar';
    const spent = editorCost(this.state);
    const over = spent > this.budget;
    bar.innerHTML =
      `<span class="pt${over ? ' over' : ''}">배치 포인트 <b>${spent} / ${this.budget}</b></span>` +
      `<span>잔여 <b>${this.budget - spent}</b></span>` +
      `<span>포탑 <b>${this.state.turrets.length}</b> · 장애물 <b>${this.state.obstacles.length}</b> · 코어 <b>${this.state.core !== null ? 1 : 0}</b></span>`;
    return bar;
  }

  private palettePanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'pb-panel';
    const h2 = document.createElement('h2');
    h2.textContent = '팔레트';
    panel.appendChild(h2);

    const pal = document.createElement('div');
    pal.className = 'pb-pal';
    for (const entry of this.palette) {
      const el = document.createElement('div');
      const selected = sameTool(entry.tool, this.tool);
      el.className = `pb-tool${selected ? ' sel' : ''}`;
      el.style.borderColor = selected ? entry.accent : '#2a3552';
      const g = document.createElement('div');
      g.className = 'g';
      g.textContent = entry.glyph;
      const l = document.createElement('div');
      l.className = 'l';
      l.textContent = entry.label;
      el.appendChild(g);
      el.appendChild(l);
      const cost = placementCost(entry.tool.kind, entry.tool.turretType);
      if (entry.tool.kind !== 'erase') {
        const c = document.createElement('div');
        c.className = `c${cost === 0 ? ' free' : ''}`;
        c.textContent = cost === 0 ? '무료' : `${cost}P`;
        el.appendChild(c);
      }
      el.addEventListener('mouseenter', () => {
        this.tip = entry.hint;
        this.renderTip();
      });
      el.addEventListener('click', () => {
        this.tool = entry.tool;
        this.hint = '';
        this.render();
      });
      pal.appendChild(el);
    }
    panel.appendChild(pal);

    const tip = document.createElement('div');
    tip.className = 'pb-tip';
    tip.id = 'pb-def-tip';
    tip.textContent = this.tip;
    panel.appendChild(tip);

    // 수호 기체 슬롯(M5 훅 자리 — 비활성, 계약 안정용).
    const gh2 = document.createElement('h2');
    gh2.textContent = '수호 기체';
    gh2.style.marginTop = '12px';
    panel.appendChild(gh2);
    const guard = document.createElement('div');
    guard.className = 'pb-guard';
    for (let i = 0; i < 2; i++) {
      const slot = document.createElement('div');
      slot.className = 'pb-slot';
      slot.title = 'M5에서 해금';
      slot.innerHTML = `<div class="lk">🔒</div><div>M5 해금</div>`;
      guard.appendChild(slot);
    }
    panel.appendChild(guard);
    return panel;
  }

  private renderTip(): void {
    const tip = this.root.querySelector<HTMLElement>('#pb-def-tip');
    if (tip !== null) tip.textContent = this.tip;
  }

  private gridPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'pb-panel';
    const h2 = document.createElement('h2');
    h2.textContent = '배치 격자';
    panel.appendChild(h2);

    const grid = document.createElement('div');
    grid.className = 'pb-grid';
    grid.style.gridTemplateColumns = `repeat(${GRID_COLS}, 34px)`;
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const cell = document.createElement('div');
        const isSpawn = col === SPAWN_COL && row === SPAWN_ROW;
        cell.className = `pb-cell${isSpawn ? ' spawn' : ''}`;
        const occ = findAt(this.state, col, row);
        if (occ !== null) {
          const glyph = this.occupantGlyph(occ);
          cell.textContent = glyph.g;
          cell.style.color = glyph.accent;
          cell.title = glyph.label;
        }
        cell.addEventListener('click', () => this.onCellClick(col, row));
        grid.appendChild(cell);
      }
    }
    panel.appendChild(grid);
    return panel;
  }

  private occupantGlyph(occ: NonNullable<Occupant>): { g: string; accent: string; label: string } {
    if (occ.kind === 'core') return { g: '💠', accent: '#8fd94c', label: '코어' };
    if (occ.kind === 'obstacle') return { g: '🧱', accent: '#8896b8', label: '장애물' };
    const t = this.state.turrets[occ.index];
    const d = t !== undefined ? TURRET_DISPLAY[t.type] : undefined;
    return { g: d?.glyph ?? '❔', accent: d?.accent ?? '#fff', label: d?.label ?? '포탑' };
  }

  private actionRow(): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'pb-actions';

    const back = document.createElement('button');
    back.className = 'pb-ghost';
    back.textContent = '◀ 기지로';
    back.addEventListener('click', () => {
      const cb = this.onClose;
      this.hide();
      cb?.();
    });
    actions.appendChild(back);

    const clear = document.createElement('button');
    clear.className = 'pb-ghost';
    clear.textContent = '전체 지우기';
    clear.addEventListener('click', () => {
      this.state = emptyEditorState();
      this.hint = '';
      this.tip = '';
      this.render();
    });
    actions.appendChild(clear);

    const test = document.createElement('button');
    test.className = 'pb-ghost';
    test.textContent = '🧪 배치 테스트';
    test.addEventListener('click', () => this.test());
    actions.appendChild(test);

    const save = document.createElement('button');
    save.className = 'pb-act';
    save.textContent = '💾 저장';
    save.disabled = !validateEditor(this.state, this.budget).ok;
    save.addEventListener('click', () => this.save());
    actions.appendChild(save);

    return actions;
  }
}
