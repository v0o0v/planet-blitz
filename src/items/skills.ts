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
import {
  SKILLS,
  SKILL_TREES,
  NODES_PER_TREE,
  TREE_DEPTH,
  SKILL_NODE_COUNT,
} from '../../data/skills.js';

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
  };
}

function clampPoints(v: number | undefined, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const n = Math.trunc(v);
  return n < 0 ? 0 : n > max ? max : n;
}

/**
 * Fold the investment vector into derived stat sums. `invest[i]` is the points
 * put into `SKILLS[i]` (clamped to that node's max). Integer-typed stats
 * (bulletCount, pierce) are floored after synergy so the weapon never fans a
 * fractional volley. Skills never grant mineralFind (meta), so that key stays 0.
 */
export function computeSkillStats(invest: readonly number[]): Record<StatKey, number> {
  const sums = zeroStatSums();

  // Per-tree, per-tier invested points (for the lower-tier synergy lookup).
  const treeCount = SKILL_TREES.length;
  const tierPoints: number[][] = [];
  for (let t = 0; t < treeCount; t++) tierPoints.push(new Array<number>(TREE_DEPTH).fill(0));
  for (let i = 0; i < SKILL_NODE_COUNT; i++) {
    const node = SKILLS[i];
    if (node === undefined) continue;
    const pts = clampPoints(invest[i], node.maxPoints);
    if (pts === 0) continue;
    const treeIdx = Math.floor(i / NODES_PER_TREE);
    const row = tierPoints[treeIdx];
    if (row !== undefined) row[node.tier] = (row[node.tier] ?? 0) + pts;
  }

  for (let i = 0; i < SKILL_NODE_COUNT; i++) {
    const node = SKILLS[i];
    if (node === undefined) continue;
    const pts = clampPoints(invest[i], node.maxPoints);
    if (pts === 0) continue;
    const treeIdx = Math.floor(i / NODES_PER_TREE);
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

/** True if any node has a non-zero investment (cheap "has skills" guard). */
export function hasAnyInvestment(invest: readonly number[] | undefined): boolean {
  if (invest === undefined) return false;
  for (let i = 0; i < invest.length; i++) {
    if ((invest[i] ?? 0) > 0) return true;
  }
  return false;
}
