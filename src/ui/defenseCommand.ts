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
  type GuardianPlacement,
  type InvasionConfig,
} from '../sim/defense.js';
import {
  MAX_GUARDIAN_SLOTS,
  normalizeGuardianPreset,
  type GuardianSnapshot,
} from '../../data/guardian.js';
import { normalizeMilestones } from '../../data/lineage.js';
import { buildGuardianPlacements } from '../save/guardianLifecycle.js';
import {
  createWorld,
  stepWorld,
  emptyInput,
  DEFAULT_CONFIG,
  type WorldConfig,
} from '../sim/world.js';
import { saveProfile, type KeyValueStore, type Profile } from '../save/profile.js';
import { refreshPendingProfile } from '../net/profileSync.js';
import {
  uploadDefenseLayout,
  fetchDefenseStatus,
  repairDefense,
  maintenanceWarningLevel,
  weatheringForecastText,
  repairButtonState,
  type DefenseStatus,
} from '../net/defenseSync.js';
import { t, type MessageKey } from '../i18n/index.js';
import {
  getCardsUserId,
  listCardInventory,
  fetchCardEquip,
  equipCard,
  salvageCard as netSalvageCard,
  buyShopCard as netBuyShopCard,
  fuseCards as netFuseCards,
  listCardShopPurchases,
  type CardOwned,
  type CardEquipState,
} from '../net/cards.js';
import { rollCurrentShop, computeShopSeeds } from '../net/cards.js';
import type { CardInstance } from '../../data/defenseCards.js';
import {
  cardRarityColor,
  cardRarityLabel,
  cardAffixSummary,
  isLowCharge,
  storageGauge,
  checkFusionSelection,
  fusionCheckText,
  buyErrorText,
  shopSlotPrice,
} from './cardsView.js';

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
/** 배치 도구. `erase`는 칸 비우기, `guardian`은 수호 슬롯 재배치, 나머지는 해당 엔티티 놓기. */
export type ToolKind = 'turret' | 'obstacle' | 'core' | 'guardian' | 'erase';

/** 현재 선택된 도구(포탑이면 유형 코드, 수호면 슬롯 인덱스 동반). */
export interface Tool {
  kind: ToolKind;
  /** kind==='turret'일 때만 유효한 포탑 유형 코드(TURRET_*). */
  turretType?: number;
  /**
   * kind==='guardian'일 때만 유효한 수호 슬롯 인덱스(0..MAX_GUARDIAN_SLOTS-1). 활성 수호
   * 기체 i번을 격자에 재배치한다. 슬롯 순서는 activeGuardians·서버 정렬과 동일(슬롯 i ↔ 수호 i).
   */
  guardianSlot?: number;
}

/**
 * 에디터 작업 상태. 계약의 {@link DefenseLayout}과 달리 `core`가 **null 가능**하다 —
 * 편집 중에는 코어 미배치 상태가 있고, 유효(코어 1개)할 때만 레이아웃으로 직렬화한다.
 */
export interface DefenseEditorState {
  core: CorePlacement | null;
  turrets: TurretPlacement[];
  obstacles: ObstaclePlacement[];
  /**
   * 방어 배치 수호 기체(M5). 활성 수호 로스터(최대 {@link MAX_GUARDIAN_SLOTS}기)를 현재
   * 성능·스냅샷·계보 보너스와 함께 담는다 — DefenseCommand 가 profile 로부터 채우고, 에디터는
   * 좌표(x/y)만 재배치한다. 서버는 serve 시 권위 스냅샷·성능·보너스로 덮어쓰므로(갈림길①A),
   * 여기 담긴 authority 필드는 로컬 미리보기·해시 재현 입력용이다. 비어 있으면 직렬화에서
   * `guardians` 키 자체를 생략해 수호 미포함 배치의 해시 바이트 불변을 지킨다(append-only).
   */
  guardians: GuardianPlacement[];
}

/** 빈 에디터 상태(코어 미배치). */
export function emptyEditorState(): DefenseEditorState {
  return { core: null, turrets: [], obstacles: [], guardians: [] };
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
  | { kind: 'guardian'; index: number }
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
  for (let i = 0; i < state.guardians.length; i++) {
    const g = state.guardians[i]!;
    const c = worldToCell(g.x, g.y);
    if (c.col === col && c.row === row) return { kind: 'guardian', index: i };
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
    // 수호 기체는 로스터에 묶여 있어 지우개로 제거하지 않는다(슬롯 인덱스↔수호 매핑 보존).
    // 재배치만 가능하며, 배치 해제는 로스터에서 소멸시켜야 한다(별도 UI).
    if (occ.kind === 'guardian') return 'noop';
    removeOccupant(state, occ);
    return 'removed';
  }

  // 코어·포탑·수호는 공격자 스폰 칸에 놓지 못한다(장애물은 허용 — 스폰 봉쇄 여지).
  if (
    (tool.kind === 'core' || tool.kind === 'turret' || tool.kind === 'guardian') &&
    col === SPAWN_COL &&
    row === SPAWN_ROW
  ) {
    return 'spawn';
  }

  // 수호 기체: 활성 로스터에서 채워진 기존 슬롯을 재배치한다(신규 생성 아님 — 로스터가 정본).
  if (tool.kind === 'guardian') {
    const slot = tool.guardianSlot ?? -1;
    const g = state.guardians[slot];
    if (g === undefined) return 'noop'; // 해당 슬롯에 활성 수호 없음
    // 자기 자신 칸이면 무변경, 다른 엔티티가 점유 중이면 거부.
    if (occ !== null && !(occ.kind === 'guardian' && occ.index === slot)) return 'occupied';
    const w = cellToWorld(col, row);
    g.x = w.x;
    g.y = w.y;
    return 'moved';
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
  if (state.core === null) errors.push(t('def.err.needCore'));
  const cost = editorCost(state);
  if (cost > budget) errors.push(t('def.err.overBudget', { cost, budget }));
  return { ok: errors.length === 0, errors };
}

/** 수호 배치 1건을 깊은 복사한다(스냅샷 포함 — 원본 참조 공유 방지). */
function cloneGuardian(g: GuardianPlacement): GuardianPlacement {
  const out: GuardianPlacement = {
    x: g.x,
    y: g.y,
    snapshot: { ...g.snapshot },
    performanceCP: g.performanceCP,
    lineageBonusBp: g.lineageBonusBp,
  };
  // 마일스톤 마스크는 0(미해금)일 때 키를 생략해 수호 미마일스톤 배치의 해시 바이트 불변을
  // 유지한다(append-only 조건부 접기와 정합 — replay.ts 는 마스크 0 을 접지 않는다).
  const ms = normalizeMilestones(g.milestones);
  if (ms !== 0) out.milestones = ms;
  return out;
}

/**
 * 유효한 에디터 상태를 {@link DefenseLayout}으로 직렬화(코어 없으면 null). 수호가 있을 때만
 * `guardians` 키를 포함한다 — 빈 배열이면 키를 생략해 수호 미포함 배치의 해시 바이트 불변을
 * 지킨다(append-only, hashWorld 조건부 접기와 정합).
 */
export function editorStateToLayout(state: DefenseEditorState): DefenseLayout | null {
  if (state.core === null) return null;
  const layout: DefenseLayout = {
    core: { x: state.core.x, y: state.core.y },
    turrets: state.turrets.map((t) => ({ type: t.type, x: t.x, y: t.y })),
    obstacles: state.obstacles.map((o) => ({ x: o.x, y: o.y, halfW: o.halfW, halfH: o.halfH })),
  };
  if (state.guardians.length > 0) {
    layout.guardians = state.guardians.map(cloneGuardian);
  }
  return layout;
}

/** {@link DefenseLayout} → 에디터 상태(저장분 불러오기). */
export function editorStateFromLayout(layout: DefenseLayout): DefenseEditorState {
  return {
    core: { x: layout.core.x, y: layout.core.y },
    turrets: layout.turrets.map((t) => ({ type: t.type, x: t.x, y: t.y })),
    obstacles: layout.obstacles.map((o) => ({ x: o.x, y: o.y, halfW: o.halfW, halfH: o.halfH })),
    guardians: (layout.guardians ?? []).map(cloneGuardian),
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

  // 수호 기체(M5): 서버가 serve 시 주입한 배치를 침공 런에 그대로 흘리려면 깊은 검증 후 보존해야
  // 한다(ADR-0005 — NaN/손상 좌표·스냅샷이 hashFloat 에 닿으면 재현이 깨진다). 스냅샷 전 필드가
  // 유한수여야 하고, 하나라도 손상이면 해당 수호를 통째로 드롭한다. 유효 수호가 0기면 `guardians`
  // 키를 붙이지 않아 수호 미포함 배치의 바이트 불변을 유지한다(append-only 조건부 접기).
  const guardians: GuardianPlacement[] = [];
  if (Array.isArray(d.guardians)) {
    for (const g of d.guardians) {
      const norm = normalizeGuardian(g);
      if (norm !== null) guardians.push(norm);
      if (guardians.length >= MAX_GUARDIAN_SLOTS) break; // 상한 초과분은 sim 스폰도 자른다
    }
  }

  const layout: DefenseLayout = { core: { x: cx, y: cy }, turrets, obstacles };
  if (guardians.length > 0) layout.guardians = guardians;
  return layout;
}

/** {@link GuardianSnapshot}의 수치 필드 목록(전부 유한수여야 결정론 해시 재현 성립). */
const GUARDIAN_SNAPSHOT_FIELDS: readonly (keyof GuardianSnapshot)[] = [
  'preset',
  'radius',
  'hp',
  'contactDamage',
  'fireCooldown',
  'bulletDamage',
  'bulletSpeed',
  'bulletRadius',
  'bulletLife',
  'range',
  'moveSpeed',
  'standoff',
];

/**
 * 수호 배치 1건을 깊은 검증한다(손상/부분 데이터는 null). 좌표·성능·보너스·스냅샷 전 필드가
 * 유한수여야 한다. preset 은 정규화(범위 밖은 타이탄 폴백)한다. 서버 주입본과 저장 왕복 양쪽에서
 * 동일하게 쓰인다.
 */
function normalizeGuardian(raw: unknown): GuardianPlacement | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const g = raw as Record<string, unknown>;
  if (!isNum(g.x) || !isNum(g.y) || !isNum(g.performanceCP) || !isNum(g.lineageBonusBp)) return null;
  const snap = g.snapshot;
  if (typeof snap !== 'object' || snap === null) return null;
  const s = snap as Record<string, unknown>;
  for (const field of GUARDIAN_SNAPSHOT_FIELDS) {
    if (!isNum(s[field])) return null;
  }
  const snapshot: GuardianSnapshot = {
    preset: normalizeGuardianPreset(s.preset as number),
    radius: s.radius as number,
    hp: s.hp as number,
    contactDamage: s.contactDamage as number,
    fireCooldown: s.fireCooldown as number,
    bulletDamage: s.bulletDamage as number,
    bulletSpeed: s.bulletSpeed as number,
    bulletRadius: s.bulletRadius as number,
    bulletLife: s.bulletLife as number,
    range: s.range as number,
    moveSpeed: s.moveSpeed as number,
    standoff: s.standoff as number,
  };
  const out: GuardianPlacement = {
    x: g.x,
    y: g.y,
    snapshot,
    performanceCP: g.performanceCP,
    lineageBonusBp: g.lineageBonusBp,
  };
  // 마일스톤 마스크(있으면) 보존 — 서버가 serve 시 권위 계보 레벨로 덮어쓰지만(injectGuardianAuthority),
  // 로컬 미리보기·해시 재현 입력으로 실린다. 0/미지정/손상은 정규화가 0 으로 접고 키를 생략한다.
  const ms = normalizeMilestones(isNum(g.milestones) ? (g.milestones as number) : 0);
  if (ms !== 0) out.milestones = ms;
  return out;
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
      ? t('def.test.pass', { c: cores, t: turrets, w: walls, s: stepped })
      : t('def.test.fail', { c: cores, t: turrets, et: expTurrets, w: walls, ew: expWalls }),
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

/** 포탑 유형별 표시(글리프·색·이름/요약 키). 인덱스 = TURRET_* 코드. */
const TURRET_DISPLAY: readonly { labelKey: MessageKey; glyph: string; accent: string; hintKey: MessageKey }[] = [
  { labelKey: 'def.turret.name.0', glyph: '🔫', accent: '#4cd7ff', hintKey: 'def.turret.hint.0' },
  { labelKey: 'def.turret.name.1', glyph: '🎯', accent: '#ff5a7a', hintKey: 'def.turret.hint.1' },
  { labelKey: 'def.turret.name.2', glyph: '💥', accent: '#ffd24c', hintKey: 'def.turret.hint.2' },
  { labelKey: 'def.turret.name.3', glyph: '❄️', accent: '#7ad0ff', hintKey: 'def.turret.hint.3' },
  { labelKey: 'def.turret.name.4', glyph: '🚀', accent: '#ff9a4c', hintKey: 'def.turret.hint.4' },
  { labelKey: 'def.turret.name.5', glyph: '⚡', accent: '#c86aff', hintKey: 'def.turret.hint.5' },
];

/** 팔레트 항목(포탑 6종 + 장애물 + 코어 + 지우개). 로케일 반영을 위해 렌더마다 새로 구성한다. */
function buildPalette(): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  for (let type = 0; type < TURRET_TYPE_COUNT; type++) {
    const d = TURRET_DISPLAY[type];
    const spec = TURRET_SPECS[type];
    if (d === undefined || spec === undefined) continue;
    out.push({
      tool: { kind: 'turret', turretType: type },
      label: t(d.labelKey),
      glyph: d.glyph,
      accent: d.accent,
      hint: `${t(d.hintKey)}${t('def.costSuffix', { c: spec.cost })}`,
    });
  }
  out.push({
    tool: { kind: 'obstacle' },
    label: t('def.pal.obstacle'),
    glyph: '🧱',
    accent: '#8896b8',
    hint: `${t('def.hint.obstacle')}${t('def.costSuffix', { c: OBSTACLE_COST })}`,
  });
  out.push({
    tool: { kind: 'core' },
    label: t('def.pal.core'),
    glyph: '💠',
    accent: '#8fd94c',
    hint: `${t('def.hint.core')}${t('def.costSuffix', { c: CORE_COST })}`,
  });
  out.push({
    tool: { kind: 'erase' },
    label: t('def.pal.erase'),
    glyph: '🧹',
    accent: '#68789c',
    hint: t('def.hint.erase'),
  });
  return out;
}

/** 도구가 같은지 비교(팔레트 선택 강조용). */
function sameTool(a: Tool, b: Tool): boolean {
  return (
    a.kind === b.kind &&
    (a.turretType ?? -1) === (b.turretType ?? -1) &&
    (a.guardianSlot ?? -1) === (b.guardianSlot ?? -1)
  );
}

/** 수호 프리셋별 표시(글리프·색·이름 키). 인덱스 = GUARDIAN_* 프리셋 코드. */
const GUARDIAN_DISPLAY: readonly { labelKey: MessageKey; glyph: string; accent: string }[] = [
  { labelKey: 'def.guardian.titan', glyph: '🛡️', accent: '#ffd24c' }, // GUARDIAN_TITAN
  { labelKey: 'def.guardian.interceptor', glyph: '🚀', accent: '#4cd7ff' }, // GUARDIAN_INTERCEPTOR
];

/** 프리셋 코드 → 표시(범위 밖은 타이탄 폴백). label 은 현재 로케일로 해석한다. */
function guardianDisplay(preset: number): { label: string; glyph: string; accent: string } {
  const d = GUARDIAN_DISPLAY[normalizeGuardianPreset(preset)] ?? GUARDIAN_DISPLAY[0]!;
  return { label: t(d.labelKey), glyph: d.glyph, accent: d.accent };
}

/** 수호 슬롯 기본 배치 칸(코어 양옆 하단, 스폰 반대편). 최대 슬롯 수만큼 반환. */
function defaultGuardianPositions(): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const offsets = [-2, 2, -3, 3];
  for (let i = 0; i < MAX_GUARDIAN_SLOTS; i++) {
    const col = clampCol(SPAWN_COL + (offsets[i] ?? 0));
    out.push(cellToWorld(col, GRID_ROWS - 1));
  }
  return out;
}

/** 열 인덱스를 격자 범위로 클램프. */
function clampCol(col: number): number {
  if (col < 0) return 0;
  if (col >= GRID_COLS) return GRID_COLS - 1;
  return col;
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
#pb-def .pb-slot.active { border-style:solid; color:#cdd7ef; cursor:pointer; transition:transform .08s ease,border-color .08s ease; }
#pb-def .pb-slot.active:hover { transform:translateY(-2px); }
#pb-def .pb-slot.active.sel { outline:2px solid #7affea; outline-offset:1px; }
#pb-def .pb-slot .gm { font-size:20px; line-height:1; }
#pb-def .pb-hint { color:#ff9a7a; font-size:12px; min-height:14px; text-align:center; max-width:420px; }
#pb-def .pb-ok { color:#8fd94c; }
#pb-def .pb-actions { display:flex; gap:10px; flex-wrap:wrap; justify-content:center; }
#pb-def button.pb-act { pointer-events:auto; cursor:pointer; padding:10px 18px; font-size:14px; font-weight:700; color:#04121a; background:linear-gradient(90deg,#7affea,#8fd94c); border:none; border-radius:10px; }
#pb-def button.pb-act:disabled { opacity:.4; cursor:default; filter:grayscale(.5); }
#pb-def button.pb-ghost { pointer-events:auto; cursor:pointer; padding:10px 18px; font-size:14px; font-weight:700; color:#aab6d6; background:rgba(20,26,44,.9); border:1px solid #2a3552; border-radius:10px; }
#pb-def .pb-maint { display:flex; gap:12px; align-items:center; flex-wrap:wrap; justify-content:center; max-width:820px; padding:8px 14px; border-radius:10px; background:rgba(12,16,30,.7); border:1px solid #2a3552; }
#pb-def .pb-maint .pb-mlabel { font-size:13px; font-weight:800; color:#8fd94c; }
#pb-def .pb-maint .pb-mlabel.lv-warn { color:#ffd24c; }
#pb-def .pb-maint .pb-mlabel.lv-critical { color:#ff6a6a; }
#pb-def .pb-maint .pb-mmeter { width:120px; height:10px; border-radius:6px; background:rgba(80,90,130,.35); border:1px solid #2a3552; overflow:hidden; }
#pb-def .pb-maint .pb-mfill { height:100%; background:#8fd94c; }
#pb-def .pb-maint .pb-mfill.lv-warn { background:#ffd24c; }
#pb-def .pb-maint .pb-mfill.lv-critical { background:#ff6a6a; }
#pb-def .pb-maint .pb-mforecast { font-size:11px; color:#aab6d6; }
#pb-def .pb-maint .pb-mforecast.lv-critical { color:#ff9a9a; }
#pb-def .pb-maint .pb-mcredits { font-size:11px; color:#8896b8; }
#pb-def .pb-maint button.pb-mrepair { pointer-events:auto; cursor:pointer; padding:7px 14px; font-size:12px; font-weight:800; color:#04121a; background:linear-gradient(90deg,#7affea,#8fd94c); border:none; border-radius:8px; }
#pb-def .pb-maint button.pb-mrepair:disabled { opacity:.4; cursor:default; filter:grayscale(.5); color:#c3cdea; background:rgba(30,36,60,.9); }
#pb-def .pb-tabs { display:flex; gap:8px; }
#pb-def button.pb-tab { pointer-events:auto; cursor:pointer; padding:8px 20px; font-size:14px; font-weight:800; color:#aab6d6; background:rgba(20,26,44,.9); border:1px solid #2a3552; border-radius:10px 10px 0 0; }
#pb-def button.pb-tab.on { color:#04121a; background:linear-gradient(90deg,#7affea,#8fd94c); border-color:#7affea; }
#pb-def .pb-cards { display:flex; gap:18px; align-items:flex-start; flex-wrap:wrap; justify-content:center; width:100%; max-width:960px; }
#pb-def .pb-cards .pb-panel { flex:1 1 280px; min-width:260px; max-width:440px; }
#pb-def .pb-cardslot { display:flex; flex-direction:column; gap:8px; padding:12px; border:2px solid #2a3552; border-radius:12px; background:rgba(20,26,44,.6); }
#pb-def .pb-cardslot.filled { border-style:solid; }
#pb-def .pb-cardslot .cs-grade { font-size:13px; font-weight:900; letter-spacing:1px; }
#pb-def .pb-cardslot .cs-charges { font-size:12px; color:#aab6d6; font-weight:700; }
#pb-def .pb-cardslot .cs-warn { font-size:12px; color:#ffb14c; font-weight:700; }
#pb-def .pb-cardslot .cs-affix { font-size:11px; color:#9fb0d8; line-height:1.5; }
#pb-def .pb-cardslot .cs-empty { font-size:13px; color:#68789c; font-weight:700; }
#pb-def .pb-storage { display:flex; align-items:center; gap:8px; margin-bottom:8px; font-size:12px; color:#aab6d6; font-weight:700; }
#pb-def .pb-storage .sg-meter { flex:1; height:9px; border-radius:6px; background:rgba(80,90,130,.35); border:1px solid #2a3552; overflow:hidden; }
#pb-def .pb-storage .sg-fill { height:100%; background:#8fd94c; }
#pb-def .pb-storage .sg-fill.full { background:#ff6a6a; }
#pb-def .pb-cardrow { display:flex; align-items:center; gap:8px; padding:8px 10px; border:1px solid #262f4c; border-radius:10px; margin-bottom:6px; background:rgba(16,20,36,.6); }
#pb-def .pb-cardrow.equipped { border-color:#8fd94c; box-shadow:0 0 0 1px #8fd94c inset; }
#pb-def .pb-cardrow.picked { border-color:#7affea; box-shadow:0 0 0 1px #7affea inset; }
#pb-def .pb-cardrow .cr-info { flex:1; min-width:0; }
#pb-def .pb-cardrow .cr-grade { font-size:12px; font-weight:900; }
#pb-def .pb-cardrow .cr-ch { font-size:11px; color:#8896b8; font-weight:700; }
#pb-def .pb-cardrow .cr-ch.low { color:#ffb14c; }
#pb-def .pb-cardrow .cr-affix { font-size:10px; color:#8090b4; line-height:1.4; margin-top:2px; }
#pb-def .pb-cardrow button { pointer-events:auto; cursor:pointer; padding:5px 10px; font-size:11px; font-weight:800; border:none; border-radius:7px; white-space:nowrap; }
#pb-def .pb-cardrow button.cr-eq { color:#04121a; background:linear-gradient(90deg,#7affea,#8fd94c); }
#pb-def .pb-cardrow button.cr-sv { color:#c3cdea; background:rgba(30,36,60,.9); border:1px solid #2a3552; }
#pb-def .pb-cardrow button:disabled { opacity:.4; cursor:default; filter:grayscale(.4); }
#pb-def .pb-fusebar { display:flex; gap:8px; align-items:center; margin-bottom:8px; flex-wrap:wrap; }
#pb-def button.pb-fuse { pointer-events:auto; cursor:pointer; padding:6px 14px; font-size:12px; font-weight:800; color:#150a24; background:linear-gradient(90deg,#c86aff,#7affea); border:none; border-radius:8px; }
#pb-def button.pb-fuse:disabled { opacity:.4; cursor:default; filter:grayscale(.4); }
#pb-def .pb-cardmsg { font-size:12px; color:#8896b8; padding:6px 2px; }
`;

export class DefenseCommand {
  private readonly root: HTMLElement;
  private profile: Profile;
  private store: KeyValueStore | null;
  private onClose: (() => void) | null = null;
  private state: DefenseEditorState = emptyEditorState();
  private readonly budget = DEFENSE_BUDGET_BASE;
  private tool: Tool = { kind: 'turret', turretType: 0 };
  private tip = '';
  private hint = '';
  // 정비(E3) 상태 — 서버 권위. null = 미로딩/미설정(정비 UI 비활성 안내).
  private defenseStatus: DefenseStatus | null = null;
  private statusLoading = false;
  private repairing = false;
  private statusToken = 0;

  // 카드 탭(M6) 상태 — 서버 권위. null = 미로딩/미설정.
  private activeTab: 'layout' | 'cards' = 'layout';
  private cardUid: string | null = null;
  /** 서버 연결 여부(uid 확보 성공). false = 오프라인/미설정(카드 UI 비활성 안내). */
  private cardsOnline = false;
  private cardsLoading = false;
  private cardsToken = 0;
  private cardInventory: CardOwned[] = [];
  private cardEquip: CardEquipState | null = null;
  private cardShop: CardInstance[] = [];
  private shopPurchases: number[] = [];
  /** 합성 선택 모드 여부 + 선택된 보관함 행 id 집합. */
  private fuseMode = false;
  private fusePicks = new Set<string>();
  /** 카드 탭 하단 안내(성공/오류 토스트). */
  private cardMsg = '';
  /** 카드 관련 네트워크 요청 진행 중(중복 클릭 방지). */
  private cardBusy = false;

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
    // 수호 기체(M5): 활성 로스터가 정본이므로 매 진입 시 재구성한다 — 저장된 좌표는 유지하고,
    // 스냅샷·성능%·계보 보너스는 profile 의 현재 값으로 갱신한다(풍화·계보 투자 반영). 로스터가
    // 비면 buildGuardianPlacements 가 빈 배열을 돌려주어 배치에 수호 키가 붙지 않는다.
    this.state.guardians = this.buildGuardianDeployment(this.state.guardians);
    this.tool = { kind: 'turret', turretType: 0 };
    this.tip = '';
    this.hint = '';
    this.defenseStatus = null;
    this.repairing = false;
    // 카드 탭 상태 초기화(매 진입 시 배치 탭으로 시작 — 저장 워크플로 존중).
    this.activeTab = 'layout';
    this.cardUid = null;
    this.cardsOnline = false;
    this.cardsLoading = false;
    this.cardInventory = [];
    this.cardEquip = null;
    this.cardShop = [];
    this.shopPurchases = [];
    this.fuseMode = false;
    this.fusePicks.clear();
    this.cardMsg = '';
    this.cardBusy = false;
    this.render();
    this.root.style.display = 'flex';
    void this.loadStatus();
  }

  hide(): void {
    this.root.style.display = 'none';
    this.onClose = null;
  }

  /** 정비 상태(정비도·크레딧·비용)를 서버에서 비동기 로드하고 정비 패널만 재렌더. */
  private async loadStatus(): Promise<void> {
    const token = ++this.statusToken;
    this.statusLoading = true;
    const status = await fetchDefenseStatus();
    if (token !== this.statusToken || !this.visible) return; // 낡은 로드 무시
    this.statusLoading = false;
    this.defenseStatus = status;
    this.render();
  }

  /** 정비 실행: repair_defense RPC 호출 후 상태를 다시 로드한다(서버 권위). */
  private async repair(): Promise<void> {
    if (this.repairing) return;
    const status = this.defenseStatus;
    if (status === null || status.maintenance === null) return;
    const rb = repairButtonState(status.maintenance, status.credits, status.repairCost);
    if (!rb.canRepair) return;
    this.repairing = true;
    this.render();
    const result = await repairDefense();
    if (!this.visible) return;
    this.repairing = false;
    if (result !== null) {
      // 서버가 크레딧을 차감했으므로 로컬 프로필 크레딧도 맞춘다(정비 직후 표시 정합).
      this.profile.credits = result.credits;
      // 즉시 영속(Phase E 리뷰 MED): persist 없이는 재로드 시 localStorage 의 정비 전
      // stale-high 크레딧이 살아나고, 다음 PvE 정산 push(progressScore 가 credits 포함)가
      // 그 값을 서버로 되밀어 차감을 복구시킨다.
      this.persist();
      // 대기 슬롯에 정비 전 스냅샷이 남아 있으면(PvE 정산 미전송 잔존) 다음 flush 가
      // 정비 전 크레딧을 되밀므로, 정비 후 상태로 교체한다(최소 방어 — 슬롯 last-write-wins).
      const pendingStore = this.pendingStore();
      if (pendingStore !== null) refreshPendingProfile(pendingStore, this.profile);
      this.tip = t('def.repairDone', { m: Math.round(result.maintenance), c: result.credits });
      this.hint = '';
    } else {
      this.hint = t('def.repairFail');
    }
    void this.loadStatus();
  }

  /**
   * 활성 수호 로스터를 방어 배치(GuardianPlacement[])로 구성한다. 이전 배치의 좌표를 슬롯 순서로
   * 유지하고, 없으면 기본 칸(코어 양옆)에 놓는다. 스냅샷·성능%·계보 보너스는 buildGuardianPlacements
   * 가 profile 현재 값으로 채운다(서버 권위 미러). 로스터가 비면 빈 배열.
   */
  private buildGuardianDeployment(prev: readonly GuardianPlacement[]): GuardianPlacement[] {
    const defaults = defaultGuardianPositions();
    const positions: { x: number; y: number }[] = [];
    for (let i = 0; i < MAX_GUARDIAN_SLOTS; i++) {
      const saved = prev[i];
      if (saved !== undefined) positions.push({ x: saved.x, y: saved.y });
      else positions.push(defaults[i] ?? defaults[defaults.length - 1] ?? { x: 0, y: 0 });
    }
    return buildGuardianPlacements(this.profile, positions);
  }

  private persist(): void {
    // 주입 store 가 없으면(=main 의 프로덕션 경로) ambient 기본 스토어로 폴백한다 —
    // `saveProfile(p, null)` 은 명시적 null 로 early-return 하므로 null 을 그대로 넘기면
    // 영속이 조용히 무시된다(Phase E 리뷰 MED 의 근본 원인). `undefined` 를 넘겨 기본
    // 파라미터(defaultStore() — 하네스 프로필 오버라이드 존중)를 타게 한다.
    saveProfile(this.profile, this.store ?? undefined);
  }

  /**
   * net 대기 슬롯이 사는 스토어. 주입 store 가 있으면 그걸(테스트), 없으면 ambient
   * localStorage(net 계층 defaultNetStore 와 동일 위치 — 같은 슬롯을 봐야 교체가 성립).
   */
  private pendingStore(): KeyValueStore | null {
    if (this.store !== null) return this.store;
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch {
      // 사생활 모드 등 — 접근 자체가 throw 할 수 있음.
    }
    return null;
  }

  private onCellClick(col: number, row: number): void {
    const res = tryPlace(this.state, this.budget, this.tool, col, row);
    switch (res) {
      case 'occupied':
        this.hint = t('def.cell.occupied');
        break;
      case 'insufficient':
        this.hint = t('def.cell.insufficient');
        break;
      case 'spawn':
        this.hint = t('def.cell.spawnBlocked');
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
      this.hint = t('def.err.needCore');
      this.render();
      return;
    }
    // 로컬 세이브(계약: defenses.layout = DefenseLayout)는 항상 즉시 저장 — 이것이 최종.
    this.profile.defenseLayout = layout;
    this.persist();
    this.hint = '';
    this.tip = t('def.saved');
    this.render();
    // 서버 업로드(M4 Phase D): Supabase `defenses` 에 활성 방어로 업서트해 타인이 나를
    // 침공 대상으로 매치메이킹할 수 있게 한다(AC6). env 미설정 시 완전 no-op(로컬 저장만).
    // fire-and-forget — 게임루프 비차단, 실패해도 로컬 저장은 유효.
    this.uploadToServer(layout);
  }

  /**
   * 저장된 배치를 서버에 fire-and-forget 로 업로드하고, 성공하면 토스트만 승격한다.
   * no-op(미설정)·오프라인·오류면 `null` 이 돌아와 조용히 로컬 저장 상태를 유지한다.
   * 사용자가 그 사이 다른 안내(hint)를 띄웠으면 덮어쓰지 않는다.
   */
  private uploadToServer(layout: DefenseLayout): void {
    void uploadDefenseLayout(layout).then((result) => {
      if (result === null || !this.visible || this.hint !== '') return;
      this.tip = result === 'inserted' ? t('def.savedInserted') : t('def.savedUpdated');
      this.render();
    });
  }

  private test(): void {
    const layout = editorStateToLayout(this.state);
    if (layout === null) {
      this.hint = t('def.test.needCore');
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
    h1.textContent = t('def.title');
    this.root.appendChild(h1);
    const sub = document.createElement('div');
    sub.className = 'pb-sub';
    sub.textContent = t('def.sub');
    this.root.appendChild(sub);

    this.root.appendChild(this.tabBar());

    if (this.activeTab === 'cards') {
      this.renderCardsBody();
      return;
    }

    this.root.appendChild(this.budgetBar());
    this.root.appendChild(this.maintenanceBar());

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

  /** 배치/카드 탭 전환 바. 카드 탭 최초 진입 시 서버 데이터를 로드한다. */
  private tabBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'pb-tabs';
    const mk = (tab: 'layout' | 'cards', label: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = `pb-tab${this.activeTab === tab ? ' on' : ''}`;
      b.textContent = label;
      b.addEventListener('click', () => {
        if (this.activeTab === tab) return;
        this.activeTab = tab;
        this.hint = '';
        this.render();
        if (tab === 'cards') void this.loadCards();
      });
      return b;
    };
    bar.appendChild(mk('layout', t('card.tab.layout')));
    bar.appendChild(mk('cards', t('card.tab.cards')));
    return bar;
  }

  private budgetBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'pb-bar';
    const spent = editorCost(this.state);
    const over = spent > this.budget;
    bar.innerHTML =
      `<span class="pt${over ? ' over' : ''}">${t('def.budget.points')} <b>${spent} / ${this.budget}</b></span>` +
      `<span>${t('def.budget.remaining')} <b>${this.budget - spent}</b></span>` +
      `<span>${t('def.budget.turret')} <b>${this.state.turrets.length}</b> · ${t('def.budget.obstacle')} <b>${this.state.obstacles.length}</b> · ${t('def.budget.core')} <b>${this.state.core !== null ? 1 : 0}</b></span>`;
    return bar;
  }

  /**
   * 정비 바(E3): 정비도(풍화 경고 — 낮을수록 강조) + 하락 예고 + 정비 버튼(크레딧 잔액).
   * 서버 미설정/오프라인이면 비활성 안내(로컬 배치 편집은 정상). 정비도가 낮을수록 색으로
   * 강조하고, 다음 풍화 예고를 함께 표시한다(관제탑/사령부 진입 시 알림 — 계약 §3).
   */
  private maintenanceBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'pb-maint';

    if (this.statusLoading && this.defenseStatus === null) {
      bar.innerHTML = `<span class="pb-mlabel">${t('def.maint.loading')}</span>`;
      return bar;
    }
    const status = this.defenseStatus;
    if (status === null) {
      bar.innerHTML = `<span class="pb-mlabel">${t('def.maint.offline')}</span>`;
      return bar;
    }
    if (status.maintenance === null) {
      bar.innerHTML = `<span class="pb-mlabel">${t('def.maint.noActive')}</span>`;
      return bar;
    }

    const m = Math.max(0, Math.min(100, Math.round(status.maintenance)));
    const level = maintenanceWarningLevel(m);

    const label = document.createElement('span');
    label.className = `pb-mlabel lv-${level}`;
    label.textContent =
      t('def.maint.label', { m }) +
      (level === 'critical' ? t('def.maint.critical') : level === 'warn' ? t('def.maint.warn') : '');
    bar.appendChild(label);

    const meter = document.createElement('div');
    meter.className = 'pb-mmeter';
    const fill = document.createElement('div');
    fill.className = `pb-mfill lv-${level}`;
    fill.style.width = `${m}%`;
    meter.appendChild(fill);
    bar.appendChild(meter);

    const forecast = document.createElement('span');
    forecast.className = `pb-mforecast lv-${level}`;
    forecast.textContent = weatheringForecastText(m);
    bar.appendChild(forecast);

    const credits = document.createElement('span');
    credits.className = 'pb-mcredits';
    credits.textContent = t('def.maint.credits', { c: status.credits, r: status.repairCost });
    bar.appendChild(credits);

    const rb = repairButtonState(m, status.credits, status.repairCost);
    const btn = document.createElement('button');
    btn.className = 'pb-mrepair';
    btn.textContent = this.repairing ? t('def.maint.repairing') : t('def.maint.repair');
    btn.disabled = this.repairing || !rb.canRepair;
    btn.title = rb.canRepair ? t('def.maint.repairTitle') : rb.reason;
    btn.addEventListener('click', () => void this.repair());
    bar.appendChild(btn);

    return bar;
  }

  private palettePanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'pb-panel';
    const h2 = document.createElement('h2');
    h2.textContent = t('def.paletteHead');
    panel.appendChild(h2);

    const pal = document.createElement('div');
    pal.className = 'pb-pal';
    for (const entry of buildPalette()) {
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
        c.textContent = cost === 0 ? t('def.free') : `${cost}P`;
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

    // 수호 기체 슬롯(M5) — 활성 로스터를 배치 도구로 노출한다. 슬롯 선택 후 격자를 클릭해
    // 재배치한다. 로스터가 비면 안내만 표시한다(퇴역으로 수호를 만들어야 함).
    const gh2 = document.createElement('h2');
    gh2.textContent = t('def.guardianHead');
    gh2.style.marginTop = '12px';
    panel.appendChild(gh2);
    const guard = document.createElement('div');
    guard.className = 'pb-guard';
    const deployed = this.state.guardians;
    if (deployed.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'pb-slot';
      empty.title = t('def.guardian.emptyTitle');
      empty.innerHTML = `<div class="lk">➖</div><div>${t('def.guardian.none')}</div>`;
      guard.appendChild(empty);
    } else {
      for (let i = 0; i < deployed.length; i++) {
        const g = deployed[i]!;
        const d = guardianDisplay(g.snapshot.preset);
        const perf = Math.round(g.performanceCP / 100);
        const tool: Tool = { kind: 'guardian', guardianSlot: i };
        const selected = sameTool(tool, this.tool);
        const slot = document.createElement('div');
        slot.className = `pb-slot active${selected ? ' sel' : ''}`;
        slot.style.borderColor = selected ? d.accent : '#3a4568';
        slot.title = t('def.guardian.slotTitle', { label: d.label, perf });
        slot.innerHTML = `<div class="gm" style="color:${d.accent}">${d.glyph}</div><div>${perf}%</div>`;
        slot.addEventListener('mouseenter', () => {
          this.tip = t('def.guardian.tip', { n: i + 1, label: d.label, perf });
          this.renderTip();
        });
        slot.addEventListener('click', () => {
          this.tool = tool;
          this.hint = '';
          this.render();
        });
        guard.appendChild(slot);
      }
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
    h2.textContent = t('def.gridHead');
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
    if (occ.kind === 'core') return { g: '💠', accent: '#8fd94c', label: t('def.cell.core') };
    if (occ.kind === 'obstacle') return { g: '🧱', accent: '#8896b8', label: t('def.cell.obstacle') };
    if (occ.kind === 'guardian') {
      const gp = this.state.guardians[occ.index];
      const d = guardianDisplay(gp?.snapshot.preset ?? 0);
      return { g: d.glyph, accent: d.accent, label: t('def.cell.guardian', { n: occ.index + 1, label: d.label }) };
    }
    const turret = this.state.turrets[occ.index];
    const d = turret !== undefined ? TURRET_DISPLAY[turret.type] : undefined;
    return { g: d?.glyph ?? '❔', accent: d?.accent ?? '#fff', label: d !== undefined ? t(d.labelKey) : t('def.cell.turret') };
  }

  private actionRow(): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'pb-actions';

    const back = document.createElement('button');
    back.className = 'pb-ghost';
    back.textContent = t('common.backToBase');
    back.addEventListener('click', () => {
      const cb = this.onClose;
      this.hide();
      cb?.();
    });
    actions.appendChild(back);

    const clear = document.createElement('button');
    clear.className = 'pb-ghost';
    clear.textContent = t('def.clear');
    clear.addEventListener('click', () => {
      this.state = emptyEditorState();
      this.hint = '';
      this.tip = '';
      this.render();
    });
    actions.appendChild(clear);

    const test = document.createElement('button');
    test.className = 'pb-ghost';
    test.textContent = t('def.testBtn');
    test.addEventListener('click', () => this.test());
    actions.appendChild(test);

    const save = document.createElement('button');
    save.className = 'pb-act';
    save.textContent = t('def.saveBtn');
    save.disabled = !validateEditor(this.state, this.budget).ok;
    save.addEventListener('click', () => this.save());
    actions.appendChild(save);

    return actions;
  }

  // --- 카드 탭(M6) -----------------------------------------------------------

  /**
   * 카드 탭 서버 데이터를 로드한다(uid → 보관함·장착 상태·상점 재고·구매 이력). 미설정/오프라인이면
   * cardsOnline=false 로 안내만 띄운다. race 방지 토큰 사용(정비 로드 패턴 동일).
   */
  private async loadCards(): Promise<void> {
    const token = ++this.cardsToken;
    this.cardsLoading = true;
    this.render();
    const uid = await getCardsUserId();
    if (token !== this.cardsToken || !this.visible) return;
    if (uid === null) {
      this.cardsOnline = false;
      this.cardsLoading = false;
      this.render();
      return;
    }
    this.cardUid = uid;
    this.cardsOnline = true;
    const dateSeed = computeShopSeeds(uid).dateSeed;
    const [inv, equip, purchases] = await Promise.all([
      listCardInventory(),
      fetchCardEquip(),
      listCardShopPurchases(dateSeed),
    ]);
    if (token !== this.cardsToken || !this.visible) return;
    this.cardInventory = inv ?? [];
    this.cardEquip = equip;
    this.shopPurchases = purchases ?? [];
    // 상점 재고는 (dateSeed,userSeed) 순수 함수로 클라가 재현(서버 호출 없음 — 표시=구매 대상 일치).
    this.cardShop = rollCurrentShop(uid);
    this.cardsLoading = false;
    this.render();
  }

  private renderCardsBody(): void {
    if (!this.cardsOnline || this.cardsLoading) {
      const msg = document.createElement('div');
      msg.className = 'pb-cardmsg';
      msg.textContent = this.cardsLoading ? t('card.slot.loading') : t('card.slot.offline');
      msg.style.marginTop = '16px';
      this.root.appendChild(msg);
      this.root.appendChild(this.cardsActionRow());
      return;
    }

    const cols = document.createElement('div');
    cols.className = 'pb-cards';
    cols.appendChild(this.cardSlotPanel());
    cols.appendChild(this.cardInventoryPanel());
    cols.appendChild(this.cardShopPanel());
    this.root.appendChild(cols);

    if (this.cardMsg !== '') {
      const msg = document.createElement('div');
      msg.className = 'pb-cardmsg';
      msg.textContent = this.cardMsg;
      this.root.appendChild(msg);
    }

    this.root.appendChild(this.cardsActionRow());
  }

  /** 카드 탭 하단 액션(뒤로만 — 배치 저장과 분리). */
  private cardsActionRow(): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'pb-actions';
    const back = document.createElement('button');
    back.className = 'pb-ghost';
    back.textContent = t('common.backToBase');
    back.addEventListener('click', () => {
      const cb = this.onClose;
      this.hide();
      cb?.();
    });
    actions.appendChild(back);
    return actions;
  }

  /** 보관함에서 defense_cards.id → 소유 카드 조회. */
  private ownedById(id: string): CardOwned | undefined {
    return this.cardInventory.find((c) => c.id === id);
  }

  /** 카드 슬롯 패널: 장착 카드 표시(등급·어픽스·잔여·경고) 또는 빈 슬롯 안내. */
  private cardSlotPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'pb-panel';
    const h2 = document.createElement('h2');
    h2.textContent = t('card.slot.head');
    panel.appendChild(h2);

    const equip = this.cardEquip;
    if (equip === null || equip.defenseId === null) {
      const m = document.createElement('div');
      m.className = 'pb-cardslot';
      m.innerHTML = `<div class="cs-empty">${t('card.slot.noBase')}</div>`;
      panel.appendChild(m);
      return panel;
    }

    const slot = document.createElement('div');
    const owned = equip.equippedCardId !== null ? this.ownedById(equip.equippedCardId) : undefined;
    if (owned === undefined) {
      slot.className = 'pb-cardslot';
      slot.innerHTML =
        `<div class="cs-empty">${t('card.slot.empty')}</div>` +
        `<div class="cs-affix">${t('card.slot.emptyHint')}</div>`;
      panel.appendChild(slot);
      return panel;
    }

    slot.className = 'pb-cardslot filled';
    slot.style.borderColor = cardRarityColor(owned.rarity);
    const grade = document.createElement('div');
    grade.className = 'cs-grade';
    grade.style.color = cardRarityColor(owned.rarity);
    grade.textContent = `${t('card.slot.equipped')} · ${cardRarityLabel(owned.rarity)}`;
    slot.appendChild(grade);

    const charges = document.createElement('div');
    charges.className = 'cs-charges';
    charges.textContent = t('card.slot.charges', { n: owned.chargesLeft, m: owned.card.chargesMax });
    slot.appendChild(charges);

    if (isLowCharge(owned.chargesLeft)) {
      const warn = document.createElement('div');
      warn.className = 'cs-warn';
      warn.textContent = t('card.slot.lastCharge');
      slot.appendChild(warn);
    }

    const affix = this.affixLinesEl(owned.card, 'cs-affix');
    if (affix !== null) slot.appendChild(affix);

    const unequip = document.createElement('button');
    unequip.className = 'pb-ghost';
    unequip.style.marginTop = '6px';
    unequip.textContent = t('card.slot.unequip');
    unequip.disabled = this.cardBusy;
    unequip.addEventListener('click', () => void this.doEquip(equip.defenseId!, null));
    slot.appendChild(unequip);

    panel.appendChild(slot);
    return panel;
  }

  /** 카드 어픽스 요약 요소(접두·접미·유니크). 어픽스 없으면 null(기저만). */
  private affixLinesEl(card: CardInstance, cls: string): HTMLElement | null {
    const s = cardAffixSummary(card);
    const lines = [...(s.unique !== null ? [s.unique] : []), ...s.prefixes, ...s.suffixes];
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = lines.length > 0 ? lines.join(' · ') : t('card.baseOnly');
    return el;
  }

  /** 보관함 패널: 상한 게이지 + 합성 바 + 카드 목록(장착/분해/합성 선택). */
  private cardInventoryPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'pb-panel';
    const h2 = document.createElement('h2');
    h2.textContent = t('card.inv.head');
    panel.appendChild(h2);

    // 보관 게이지(만석 강조).
    const gauge = storageGauge(this.cardInventory.length);
    const st = document.createElement('div');
    st.className = 'pb-storage';
    st.innerHTML =
      `<span>${t('card.inv.storage', { count: gauge.count, cap: gauge.cap })}</span>` +
      `<span class="sg-meter"><span class="sg-fill${gauge.full ? ' full' : ''}" style="width:${gauge.pct}%"></span></span>`;
    panel.appendChild(st);
    if (gauge.full) {
      const full = document.createElement('div');
      full.className = 'cs-warn';
      full.style.fontSize = '11px';
      full.textContent = t('card.inv.full');
      panel.appendChild(full);
    }

    // 합성 바(선택 모드 토글 + 확정).
    panel.appendChild(this.fuseBar());

    if (this.cardInventory.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'pb-cardmsg';
      empty.textContent = t('card.inv.empty');
      panel.appendChild(empty);
      return panel;
    }

    const equippedId = this.cardEquip?.equippedCardId ?? null;
    for (const owned of this.cardInventory) {
      panel.appendChild(this.cardRow(owned, equippedId));
    }
    return panel;
  }

  private fuseBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'pb-fusebar';
    if (!this.fuseMode) {
      const start = document.createElement('button');
      start.className = 'pb-fuse';
      start.textContent = t('card.inv.fuseStart');
      start.disabled = this.cardBusy || this.cardInventory.length < 3;
      start.addEventListener('click', () => {
        this.fuseMode = true;
        this.fusePicks.clear();
        this.cardMsg = t('card.inv.fuseMode');
        this.render();
      });
      bar.appendChild(start);
      return bar;
    }
    const picks = this.pickedOwned();
    const check = checkFusionSelection(picks);
    const confirm = document.createElement('button');
    confirm.className = 'pb-fuse';
    confirm.textContent = t('card.inv.fuseConfirm', { n: this.fusePicks.size });
    confirm.disabled = this.cardBusy || !check.ok;
    confirm.addEventListener('click', () => void this.doFuse());
    const cancel = document.createElement('button');
    cancel.className = 'pb-ghost';
    cancel.textContent = t('card.inv.fuseCancel');
    cancel.addEventListener('click', () => {
      this.fuseMode = false;
      this.fusePicks.clear();
      this.cardMsg = '';
      this.render();
    });
    bar.append(confirm, cancel);
    if (!check.ok && this.fusePicks.size > 0) {
      const hint = document.createElement('span');
      hint.className = 'pb-cardmsg';
      hint.textContent = fusionCheckText(check.code);
      bar.appendChild(hint);
    }
    return bar;
  }

  /** 현재 합성 선택된 소유 카드 목록(존재하는 것만). */
  private pickedOwned(): CardOwned[] {
    const out: CardOwned[] = [];
    for (const id of this.fusePicks) {
      const owned = this.ownedById(id);
      if (owned !== undefined) out.push(owned);
    }
    return out;
  }

  private cardRow(owned: CardOwned, equippedId: string | null): HTMLElement {
    const row = document.createElement('div');
    const isEquipped = owned.id === equippedId;
    const isPicked = this.fusePicks.has(owned.id);
    row.className = `pb-cardrow${isEquipped ? ' equipped' : ''}${isPicked ? ' picked' : ''}`;

    const info = document.createElement('div');
    info.className = 'cr-info';
    const grade = document.createElement('div');
    grade.className = 'cr-grade';
    grade.style.color = cardRarityColor(owned.rarity);
    grade.textContent = cardRarityLabel(owned.rarity);
    const ch = document.createElement('span');
    ch.className = `cr-ch${isLowCharge(owned.chargesLeft) ? ' low' : ''}`;
    ch.textContent = ` ${t('card.inv.charges', { n: owned.chargesLeft })}`;
    grade.appendChild(ch);
    info.appendChild(grade);
    const affix = this.affixLinesEl(owned.card, 'cr-affix');
    if (affix !== null) info.appendChild(affix);
    row.appendChild(info);

    if (this.fuseMode) {
      // 합성 선택 모드: 각 행이 선택/해제 토글.
      const pick = document.createElement('button');
      pick.className = isPicked ? 'cr-eq' : 'cr-sv';
      pick.textContent = isPicked ? t('card.inv.picked') : t('card.inv.pick');
      pick.disabled = this.cardBusy || (!isPicked && this.fusePicks.size >= 3);
      pick.addEventListener('click', () => {
        if (isPicked) this.fusePicks.delete(owned.id);
        else if (this.fusePicks.size < 3) this.fusePicks.add(owned.id);
        this.render();
      });
      row.appendChild(pick);
      return row;
    }

    // 일반 모드: 장착/해제 + 분해.
    const eqBtn = document.createElement('button');
    eqBtn.className = 'cr-eq';
    eqBtn.textContent = isEquipped ? t('card.inv.equipped') : t('card.inv.equip');
    eqBtn.disabled = this.cardBusy || this.cardEquip?.defenseId == null || isEquipped;
    eqBtn.addEventListener('click', () => {
      const defId = this.cardEquip?.defenseId;
      if (defId != null) void this.doEquip(defId, owned.id);
    });
    row.appendChild(eqBtn);

    const svBtn = document.createElement('button');
    svBtn.className = 'cr-sv';
    svBtn.textContent = t('card.inv.salvage');
    svBtn.disabled = this.cardBusy;
    svBtn.addEventListener('click', () => void this.doSalvage(owned.id));
    row.appendChild(svBtn);

    return row;
  }

  /** 상점 패널: 오늘 재고(미리 공개된 옵션·가격), 이미 산 슬롯 비활성. */
  private cardShopPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'pb-panel';
    const h2 = document.createElement('h2');
    h2.textContent = t('card.shop.head');
    panel.appendChild(h2);

    const note = document.createElement('div');
    note.className = 'pb-cardmsg';
    note.textContent = t('card.shop.note');
    panel.appendChild(note);

    if (this.cardShop.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'pb-cardmsg';
      empty.textContent = t('card.shop.empty');
      panel.appendChild(empty);
      return panel;
    }

    const gauge = storageGauge(this.cardInventory.length);
    for (let i = 0; i < this.cardShop.length; i++) {
      const card = this.cardShop[i]!;
      panel.appendChild(this.shopRow(card, i, gauge.full));
    }
    return panel;
  }

  private shopRow(card: CardInstance, slotIndex: number, storageFull: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = 'pb-cardrow';
    const bought = this.shopPurchases.includes(slotIndex);

    const info = document.createElement('div');
    info.className = 'cr-info';
    const grade = document.createElement('div');
    grade.className = 'cr-grade';
    grade.style.color = cardRarityColor(card.rarity);
    grade.textContent = `${cardRarityLabel(card.rarity)} · ${t('card.shop.price', { c: shopSlotPrice(card.rarity) })}`;
    info.appendChild(grade);
    const affix = this.affixLinesEl(card, 'cr-affix');
    if (affix !== null) info.appendChild(affix);
    row.appendChild(info);

    const buy = document.createElement('button');
    buy.className = 'cr-eq';
    buy.textContent = bought ? t('card.shop.bought') : t('card.shop.buy');
    // 만석이면 구매 결과가 차단되므로 미리 비활성(스펙 §정보 공개 — 만석 시 버튼 비활성).
    buy.disabled = this.cardBusy || bought || storageFull;
    buy.addEventListener('click', () => void this.doBuy(slotIndex));
    row.appendChild(buy);
    return row;
  }

  // --- 카드 네트워크 액션(서버 권위 — 성공 후 재로드/크레딧 pull) -------------

  /** 서버가 반환한 크레딧을 로컬 프로필에 반영·영속(정비 크레딧 pull 패턴과 동일). */
  private pullServerCredits(credits: number): void {
    this.profile.credits = credits;
    this.persist();
    const pendingStore = this.pendingStore();
    if (pendingStore !== null) refreshPendingProfile(pendingStore, this.profile);
  }

  private async doEquip(defenseId: string, cardId: string | null): Promise<void> {
    if (this.cardBusy) return;
    this.cardBusy = true;
    this.render();
    const ok = await equipCard(defenseId, cardId);
    if (!this.visible) return;
    this.cardBusy = false;
    if (ok) {
      this.cardMsg = cardId === null ? t('card.equip.unequipped') : t('card.equip.done');
      // 장착 상태만 서버 재조회(보관함 불변).
      const equip = await fetchCardEquip();
      if (!this.visible) return;
      if (equip !== null) this.cardEquip = equip;
    } else {
      this.cardMsg = t('card.equip.failed');
    }
    this.render();
  }

  private async doSalvage(cardId: string): Promise<void> {
    if (this.cardBusy) return;
    this.cardBusy = true;
    this.render();
    const result = await netSalvageCard(cardId);
    if (!this.visible) return;
    this.cardBusy = false;
    if (result === null) {
      this.cardMsg = t('card.salvage.failed');
    } else if (!result.ok) {
      this.cardMsg = t('card.salvage.notOwned');
    } else {
      if (result.credits !== undefined) this.pullServerCredits(result.credits);
      this.cardMsg = t('card.salvage.done', { c: result.salvaged ?? 0 });
    }
    await this.reloadCardData();
  }

  private async doBuy(slotIndex: number): Promise<void> {
    if (this.cardBusy) return;
    this.cardBusy = true;
    this.render();
    const result = await netBuyShopCard(slotIndex);
    if (!this.visible) return;
    this.cardBusy = false;
    if (result === null) {
      this.cardMsg = t('card.buy.failed');
    } else if (!result.ok) {
      this.cardMsg = buyErrorText(result.code);
      // 이미 구매/만석 등은 이력 갱신이 표시 정합에 도움.
    } else {
      if (result.credits !== undefined) this.pullServerCredits(result.credits);
      this.cardMsg = t('card.buy.done', { rarity: cardRarityLabel(result.rarity ?? 'normal') });
    }
    await this.reloadCardData();
  }

  private async doFuse(): Promise<void> {
    if (this.cardBusy) return;
    const picks = this.pickedOwned();
    const check = checkFusionSelection(picks);
    if (!check.ok) {
      this.cardMsg = fusionCheckText(check.code);
      this.render();
      return;
    }
    this.cardBusy = true;
    this.render();
    const ids = picks.map((c) => c.id) as unknown as readonly [string, string, string];
    const result = await netFuseCards(ids);
    if (!this.visible) return;
    this.cardBusy = false;
    this.fuseMode = false;
    this.fusePicks.clear();
    if (result === null) {
      this.cardMsg = t('card.fuse.failed');
    } else if (!result.ok) {
      this.cardMsg = result.code === 'not-owned' ? t('card.fuse.notOwned') : t('card.fuse.failed');
    } else {
      const rarityLabel = cardRarityLabel(result.rarity ?? 'normal');
      this.cardMsg = result.promoted === true
        ? t('card.fuse.promoted', { rarity: rarityLabel })
        : t('card.fuse.done', { rarity: rarityLabel });
    }
    await this.reloadCardData();
  }

  /** 보관함·장착·구매이력을 서버에서 재조회(상점 재고는 순수 재현이라 불변). */
  private async reloadCardData(): Promise<void> {
    const token = ++this.cardsToken;
    const uid = this.cardUid;
    if (uid === null) {
      this.render();
      return;
    }
    const dateSeed = computeShopSeeds(uid).dateSeed;
    const [inv, equip, purchases] = await Promise.all([
      listCardInventory(),
      fetchCardEquip(),
      listCardShopPurchases(dateSeed),
    ]);
    if (token !== this.cardsToken || !this.visible) return;
    if (inv !== null) this.cardInventory = inv;
    if (equip !== null) this.cardEquip = equip;
    if (purchases !== null) this.shopPurchases = purchases;
    this.render();
  }
}
