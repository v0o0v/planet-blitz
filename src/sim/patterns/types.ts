/**
 * Data-driven enemy pattern definitions (M1 Phase 2).
 *
 * The "pattern component engine" (spec: 발사체 × 궤적 × 발사 타이밍) is expressed
 * as two composable axes of data:
 *
 *   - a MovementKind  — how the enemy steers each tick, and
 *   - an AttackDef     — a discriminated union describing what it emits on its
 *                        fire cadence.
 *
 * A concrete enemy (EnemyDef) is just a row of data pairing one movement with
 * one attack plus tuning numbers. M1 ships 4 enemies (the Kargon role slots);
 * M2/M3 scale to 20 by adding rows here and, rarely, a new component function —
 * never by editing the world loop.
 */

/** The four Kargon role slots (spec R6). Index is stable for hashing/render. */
export type EnemyRole = 'charger' | 'gunner' | 'special' | 'support';

/** Steering behaviour applied every tick. */
export type MovementKind =
  | 'chargeStraight' // rush in a straight line toward the player; bounce off walls
  | 'stationary' // rooted turret (lava spring)
  | 'standoff' // approach to a preferred range, then hold (mortar)
  | 'seekWounded'; // drift toward the most-wounded ally to heal it (support)

/** Hazard subtype codes (also used as render/hash tags on hazard entities). */
export const HAZARD_MORTAR = 0;
export const HAZARD_LAVA = 1;

export type AttackDef =
  /** Charger: no periodic fire; emits fragments on wall impact (see movement). */
  | { readonly kind: 'fragments'; readonly count: number; readonly speed: number; readonly damage: number; readonly bulletRadius: number; readonly bulletLife: number }
  /** Gunner: telegraphs a circular impact zone at the player, then bursts. */
  | { readonly kind: 'mortar'; readonly windup: number; readonly radius: number; readonly damage: number }
  /** Special: telegraphs a line of lava pillars across the arena. */
  | { readonly kind: 'lava'; readonly windup: number; readonly activeTicks: number; readonly pillars: number; readonly radius: number; readonly damage: number }
  /** Support: heals the nearest wounded ally within range each active tick. */
  | { readonly kind: 'heal'; readonly range: number; readonly healPerTick: number };

export interface EnemyDef {
  /** Data id (for logs/tooling). */
  readonly id: string;
  readonly role: EnemyRole;
  /** Stable numeric code stored on the entity (render colour, hash). */
  readonly typeIndex: number;
  readonly radius: number;
  readonly hp: number;
  /** Contact damage dealt to the player on touch. */
  readonly contactDamage: number;
  /** Movement speed (units/second). */
  readonly speed: number;
  readonly movement: MovementKind;
  readonly attack: AttackDef;
  /** Ticks between attack activations. */
  readonly fireCooldown: number;
  /** Experience granted by the gem this enemy drops when slain. */
  readonly xpValue: number;
}
