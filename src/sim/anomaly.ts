/**
 * Anomaly alerts (M2 재미 요소 — plan B5, GDD §3, AC10).
 *
 * At run creation a dedicated stream (`rng.fork('anomaly')`) decides — purely
 * from the seed — whether an anomaly is OFFERED (~25%) and which of three kinds.
 * Whether it is ACTIVE additionally requires the player's acceptance, carried as
 * a config flag (OQ-M2-3 default: chosen on the pre-run screen, not mid-run), so
 * the sim stays a function of [seed + inputs + config]. The RNG draws are
 * independent of acceptance, so the offer is stable per seed; acceptance only
 * gates whether the effects switch on.
 *
 * Effects (OQ-M2-5): 중력 폭풍 = enemy bullets slower + drop rate up; 군체 대발생
 * = twice the enemy cap but weaker enemies; 암흑 성운 = higher unique odds only
 * (the "reduced sightline" is render-only, so it never touches the sim).
 *
 * Deterministic by construction: seeded RNG only, no wall-clock, no Math.random.
 */

import type { SeededRng } from './rng.js';

export const ANOMALY_NONE = -1;
export const ANOMALY_GRAVITY = 0; // 중력 폭풍
export const ANOMALY_SWARM = 1; // 군체 대발생
export const ANOMALY_NEBULA = 2; // 암흑 성운

/** Probability an anomaly is offered at run start (spec ~25%). */
export const ANOMALY_OFFER_CHANCE = 0.25;

/** Resolved anomaly for a run. `active` folds in the player's acceptance. */
export interface AnomalyState {
  /** Offered kind (ANOMALY_* ; ANOMALY_NONE when none offered). */
  kind: number;
  /** Offered AND accepted — effects apply only when true. */
  active: boolean;
}

/**
 * Roll the run's anomaly. Draws are seed-only (the `chance` then, if offered, the
 * kind), so the offer is identical regardless of `accepted`; `accepted` only
 * decides whether the offered anomaly is active.
 */
export function rollAnomaly(anomalyRng: SeededRng, accepted: boolean): AnomalyState {
  const offered = anomalyRng.chance(ANOMALY_OFFER_CHANCE);
  const kind = offered ? anomalyRng.int(0, 2) : ANOMALY_NONE;
  return { kind, active: offered && accepted && kind !== ANOMALY_NONE };
}

/** 중력 폭풍: enemy-bullet travel multiplier (< 1 = slower). */
export function enemyBulletSpeedMult(a: AnomalyState): number {
  return a.active && a.kind === ANOMALY_GRAVITY ? 0.7 : 1;
}

/** 군체 대발생: onscreen enemy-cap multiplier. */
export function maxEnemiesMult(a: AnomalyState): number {
  return a.active && a.kind === ANOMALY_SWARM ? 2 : 1;
}

/** 군체 대발생: enemy HP multiplier (weaker swarm). */
export function enemyHpMult(a: AnomalyState): number {
  return a.active && a.kind === ANOMALY_SWARM ? 0.6 : 1;
}

/** 중력 폭풍: overall drop-rate multiplier (drop odds up). */
export function dropRateMult(a: AnomalyState): number {
  return a.active && a.kind === ANOMALY_GRAVITY ? 1.5 : 1;
}

/** 암흑 성운: unique drop-chance multiplier. */
export function uniqueChanceMult(a: AnomalyState): number {
  return a.active && a.kind === ANOMALY_NEBULA ? 2 : 1;
}
