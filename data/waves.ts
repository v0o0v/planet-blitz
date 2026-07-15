/**
 * Wave content — 6-segment budget table + an 8-card spawn pool (spec R3, §수치).
 *
 * A run is 6 segments. Each segment periodically draws a spawn *card* from the
 * pool via the seeded wave RNG, so the enemy composition varies per seed while
 * the per-segment budget (onscreen enemy cap + simultaneous enemy-bullet cap)
 * bounds difficulty and performance. The 6th segment is the boss slot — M1
 * Phase 2 marks the transition; the boss fight itself is Phase 3 (plan task 15).
 *
 * Budget values (enemy cap 12→20→28→36→44, bullet cap 300→600→900→1,200→1,600
 * →2,000) are taken directly from the spec's 구간 예산표.
 */

import type { EnemyRole } from '../src/sim/patterns/types.js';

export type Formation = 'ring' | 'line' | 'edges' | 'cluster';

/**
 * One spawn group in a wave card. Either a ROLE spawn (resolved against the
 * planet's role roster) or an ELITE spawn (resolved against the planet's elite
 * list by index). The elite variant is optional/additive so existing role-only
 * cards (카르곤) are unchanged; 베르단 cards use it to seed its 엘리트 2종.
 */
export type WaveSpawn =
  | { readonly role: EnemyRole; readonly count: number }
  | { readonly elite: number; readonly count: number };

export interface WaveCard {
  readonly id: string;
  readonly formation: Formation;
  readonly spawns: readonly WaveSpawn[];
}

export interface WaveSegment {
  readonly index: number;
  readonly durationTicks: number;
  /** Max enemies allowed onscreen (spawns pause when reached). */
  readonly maxEnemies: number;
  /** Simultaneous enemy-bullet cap (perf + fairness bound). */
  readonly bulletCap: number;
  /** Ticks between card draws within the segment. */
  readonly cardInterval: number;
  readonly boss: boolean;
}

/** 6 segments; last is the boss slot (Phase 3 fills the fight). */
export const SEGMENTS: readonly WaveSegment[] = [
  { index: 0, durationTicks: 2700, maxEnemies: 12, bulletCap: 300, cardInterval: 220, boss: false },
  { index: 1, durationTicks: 2700, maxEnemies: 20, bulletCap: 600, cardInterval: 200, boss: false },
  { index: 2, durationTicks: 2700, maxEnemies: 28, bulletCap: 900, cardInterval: 180, boss: false },
  { index: 3, durationTicks: 2700, maxEnemies: 36, bulletCap: 1200, cardInterval: 160, boss: false },
  { index: 4, durationTicks: 2700, maxEnemies: 44, bulletCap: 1600, cardInterval: 150, boss: false },
  { index: 5, durationTicks: 3600, maxEnemies: 8, bulletCap: 2000, cardInterval: 9999, boss: true },
];

/** 8-card spawn pool drawn from throughout a run (spec 웨이브 카드 풀 초안). */
export const CARD_POOL: readonly WaveCard[] = [
  { id: 'charger-rush', formation: 'line', spawns: [{ role: 'charger', count: 4 }] },
  { id: 'gunner-line', formation: 'edges', spawns: [{ role: 'gunner', count: 3 }] },
  {
    id: 'mixed-assault',
    formation: 'ring',
    spawns: [
      { role: 'charger', count: 2 },
      { role: 'gunner', count: 2 },
    ],
  },
  { id: 'special-field', formation: 'cluster', spawns: [{ role: 'special', count: 2 }] },
  {
    id: 'support-escort',
    formation: 'ring',
    spawns: [
      { role: 'support', count: 1 },
      { role: 'charger', count: 3 },
    ],
  },
  { id: 'encircle', formation: 'ring', spawns: [{ role: 'charger', count: 6 }] },
  { id: 'bombard', formation: 'edges', spawns: [{ role: 'gunner', count: 4 }] },
  {
    id: 'heavy-column',
    formation: 'edges',
    spawns: [
      { role: 'special', count: 1 },
      { role: 'gunner', count: 2 },
      { role: 'support', count: 1 },
    ],
  },
];
