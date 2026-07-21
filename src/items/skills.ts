/**
 * Skill investment → derived-stats pipeline (M3 Phase A2 — plan §4, AC1/AC2).
 *
 * `computeSkillStats(invest)` folds a 60-length investment vector into a
 * per-`StatKey` sum, applying the tier-synergy rule (OQ-M3-2 default): a node's
 * output is amplified by the points invested in LOWER tiers of the same tree
 * (Diablo2-style — deep investment makes capstones hit harder). The result is
 * summed into the SAME derived block the loadout pipeline produces
 * (src/items/loadout.ts), so gear and skills stack through one code path and one
 * hash fold (plan §2 ①A).
 *
 * PURE — no RNG, no wall-clock, only basic arithmetic — so the client and the
 * verification Edge Function derive byte-identical stats from the same vector.
 */

import type { StatKey } from './types.js';
import type { SkillNode } from '../../data/skills.js';
import {
  DEFAULT_SHIP_TYPE,
  shipTypeDef,
  shipTreeRange,
  shipCapstoneIndex,
  flattenShipNodes,
} from '../../data/ships/index.js';
import type { ShipTypeDef } from '../../data/ships/index.js';

/** Synergy amplifier per point invested in a lower tier of the same tree. A
 *  fully-fed lower tree (16 nodes ×4 = 64 pts) amplifies a capstone by ~+25.6%. */
const SYNERGY_PER_LOWER_POINT = 0.004;
/** Hard cap on the synergy amplifier (guards a corrupt/over-invested vector). */
const SYNERGY_MAX = 0.5;

/** All-zero stat sums (same shape the loadout pipeline consumes). */
export function zeroStatSums(): Record<StatKey, number> {
  return {
    damagePct: 0,
    fireRatePct: 0,
    bulletCount: 0,
    pierce: 0,
    bulletSpeedPct: 0,
    rangeFlat: 0,
    moveSpeedPct: 0,
    maxHpFlat: 0,
    maxHpPct: 0,
    dashCdPct: 0,
    magnetPct: 0,
    xpPct: 0,
    mineralFindPct: 0,
    // M3 통합: 원소 상태이상 스탯은 스킬 트리에서 나오지 않음(장비 어픽스 전용) → 항상 0.
    fireDmg: 0,
    coldSlow: 0,
    lightning: 0,
  };
}

function clampPoints(v: number | undefined, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const n = Math.trunc(v);
  return n < 0 ? 0 : n > max ? max : n;
}

/**
 * 타입별 flat 노드 배열 캐시. `flattenShipNodes` 는 매 호출마다 새 배열을 만드는데
 * `computeSkillStats` 는 런 시작·UI 미리보기에서 반복 호출된다. 레지스트리는 모듈 상수라
 * 캐시가 stale 해질 수 없고, 반환값은 readonly 라 공유해도 안전하다(변이 없음 = 결정론 유지).
 */
const FLAT_NODE_CACHE = new Map<number, readonly SkillNode[]>();

function shipFlatNodes(def: ShipTypeDef): readonly SkillNode[] {
  const cached = FLAT_NODE_CACHE.get(def.id);
  if (cached !== undefined) return cached;
  const flat = flattenShipNodes(def);
  FLAT_NODE_CACHE.set(def.id, flat);
  return flat;
}

/**
 * Fold the investment vector into derived stat sums. `invest[i]` is the points
 * put into the flat node `i` **of `typeId`'s tree** (clamped to that node's max).
 * Integer-typed stats (bulletCount, pierce) are floored after synergy so the
 * weapon never fans a fractional volley. Skills never grant mineralFind (meta),
 * so that key stays 0.
 *
 * `typeId` 미지정 = 스트라이커(타입 0). 스트라이커에 대해 이 함수는 M3~M7 구현과
 * **바이트 동일**하다 — `flattenShipNodes(STRIKER)` 가 `data/skills.ts` 의 `SKILLS` 와
 * 원소 동일(참조까지)이고, 트리 슬라이스도 `NODES_PER_TREE` 와 같은 폭이기 때문이다.
 * 티어 누적 배열 길이만 `TREE_DEPTH`(5) 에서 `nodesPerTree + 1` 로 늘었는데, 이 배열은
 * `row[t]` 합산에만 쓰이고 여분 칸은 항상 0 이라 결과가 달라지지 않는다.
 */
export function computeSkillStats(
  invest: readonly number[],
  typeId: number = DEFAULT_SHIP_TYPE,
): Record<StatKey, number> {
  const sums = zeroStatSums();
  const def = shipTypeDef(typeId);
  const nodes = shipFlatNodes(def);
  const nodeCount = nodes.length;
  const perTree = def.nodesPerTree;

  // Per-tree, per-tier invested points (for the lower-tier synergy lookup).
  const treeCount = def.trees.length;
  const tierPoints: number[][] = [];
  for (let t = 0; t < treeCount; t++) tierPoints.push(new Array<number>(perTree + 1).fill(0));
  for (let i = 0; i < nodeCount; i++) {
    const node = nodes[i];
    if (node === undefined) continue;
    // 질적 캡스톤(flat 벡터 최후미)은 수치를 기여하지 않는다 — sim이 uniqueMask 비트로 게이트.
    if (node.capstone === true) continue;
    const pts = clampPoints(invest[i], node.maxPoints);
    if (pts === 0) continue;
    const treeIdx = Math.floor(i / perTree);
    const row = tierPoints[treeIdx];
    if (row !== undefined) row[node.tier] = (row[node.tier] ?? 0) + pts;
  }

  for (let i = 0; i < nodeCount; i++) {
    const node = nodes[i];
    if (node === undefined) continue;
    if (node.capstone === true) continue; // 캡스톤은 파생 스탯에 기여하지 않음(위와 동일).
    const pts = clampPoints(invest[i], node.maxPoints);
    if (pts === 0) continue;
    const treeIdx = Math.floor(i / perTree);
    const row = tierPoints[treeIdx];
    let lower = 0;
    if (row !== undefined) {
      for (let t = 0; t < node.tier; t++) lower += row[t] ?? 0;
    }
    let amp = SYNERGY_PER_LOWER_POINT * lower;
    if (amp > SYNERGY_MAX) amp = SYNERGY_MAX;
    sums[node.stat] += pts * node.perPoint * (1 + amp);
  }

  // Integer-typed adds must stay whole (fractional pierce/bulletCount is invalid).
  sums.bulletCount = Math.floor(sums.bulletCount);
  sums.pierce = Math.floor(sums.pierce);
  return sums;
}

// ---------------------------------------------------------------------------
// 타입별 캡스톤 게이트 (M8-L4)
//
// `data/skills.ts` 의 `treeBaseInvested`/`capstoneUnlocked`/`capstoneActive` 는 스트라이커
// 전용이다(트리를 `'firepower'|'survival'|'mobility'` 문자열로 받고 인덱스를 `SKILL_TREES`
// 순서로 계산). 아래 3함수는 같은 규칙을 **`ShipTypeDef` + 트리 인덱스** 로 일반화한 것이며,
// 스트라이커(타입 0)에 대해서는 인덱스·게이트·판정이 전부 동일하다:
//   shipTreeRange(STRIKER,0)     === treeRange('firepower')      = [0,20)
//   shipCapstoneIndex(STRIKER,0) === capstoneIndex('firepower')  = 60
//   STRIKER.capstoneGate         === CAPSTONE_GATE               = 40
// tests/capstones.test.ts 가 세 함수와 레거시 함수의 동치를 전 계열·전 경계에서 못 박는다.
// ---------------------------------------------------------------------------

/** 한 계열의 base 노드 누적 투자(캡스톤 자체는 제외). 손상/짧은 벡터도 안전(누락 = 0). */
export function shipTreeBaseInvested(
  invest: readonly number[],
  def: ShipTypeDef,
  treeIndex: number,
): number {
  const { start, end } = shipTreeRange(def, treeIndex);
  let sum = 0;
  for (let i = start; i < end; i++) sum += invest[i] ?? 0;
  return sum;
}

/** 계열 캡스톤이 게이트를 통과했는지(base 투자 ≥ `def.capstoneGate`). */
export function shipCapstoneUnlocked(
  invest: readonly number[],
  def: ShipTypeDef,
  treeIndex: number,
): boolean {
  return shipTreeBaseInvested(invest, def, treeIndex) >= def.capstoneGate;
}

/**
 * 계열 캡스톤 효과가 실제 활성인지 = 게이트 통과 AND 캡스톤 노드에 1포인트 투자.
 * 게이트 미달인데 캡스톤만 찍힌 손상 벡터는 비활성(robust) — 레거시와 같은 규칙.
 */
export function shipCapstoneActive(
  invest: readonly number[],
  def: ShipTypeDef,
  treeIndex: number,
): boolean {
  if (!shipCapstoneUnlocked(invest, def, treeIndex)) return false;
  return (invest[shipCapstoneIndex(def, treeIndex)] ?? 0) > 0;
}

/** True if any node has a non-zero investment (cheap "has skills" guard). */
export function hasAnyInvestment(invest: readonly number[] | undefined): boolean {
  if (invest === undefined) return false;
  for (let i = 0; i < invest.length; i++) {
    if ((invest[i] ?? 0) > 0) return true;
  }
  return false;
}
