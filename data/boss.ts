/**
 * Boss content — Kargon "용암 요새 전차" (lava fortress tank), M1 boss (plan
 * task 15, spec R2).
 *
 * Data only: the boss is three phases, each cycling a small list of attacks
 * expressed with the same primitives the enemy pattern engine already emits
 * (radial bullets, spirals, lava-pillar hazards). Phase thresholds are HP
 * fractions (100→70% P1, 70→35% P2, 35→0% P3). The boss logic (src/sim/boss.ts)
 * executes these; adding bosses later means adding rows here.
 *
 * Balance note: HP / cadence / bullet counts are M1 prototype tuning (spec fixes
 * the *structure* — 3 phases, 5s overheat, phase-transition bullet clear — but
 * not these numbers). Expected to move during the fun-gate loop.
 */

export type BossAttack =
  /** Even radial burst of `count` bullets. */
  | {
      readonly kind: 'ring';
      readonly count: number;
      readonly speed: number;
      readonly damage: number;
      readonly bulletRadius: number;
      readonly bulletLife: number;
    }
  /** Radial burst whose base angle advances each cast, tracing a spiral. */
  | {
      readonly kind: 'spiral';
      readonly count: number;
      readonly speed: number;
      readonly damage: number;
      readonly bulletRadius: number;
      readonly bulletLife: number;
      /** Base-angle advance per cast (radians). */
      readonly turn: number;
    }
  /** Line of telegraphed lava pillars across the arena at the player's y. */
  | {
      readonly kind: 'lavaLine';
      readonly pillars: number;
      readonly windup: number;
      readonly activeTicks: number;
      readonly radius: number;
      readonly damage: number;
    };

export interface BossPhaseDef {
  /** Ticks between pattern casts within the phase. */
  readonly patternCooldown: number;
  /** Attacks cast in round-robin order. */
  readonly attacks: readonly BossAttack[];
}

export interface BossDef {
  readonly id: string;
  readonly hp: number;
  readonly radius: number;
  readonly contactDamage: number;
  readonly moveSpeed: number;
  /** Exactly three phases (P1 signature, P2 variation, P3 desperation). */
  readonly phases: readonly [BossPhaseDef, BossPhaseDef, BossPhaseDef];
}

export const LAVA_FORTRESS: BossDef = {
  id: 'kargon-lava-fortress',
  hp: 2200,
  radius: 64,
  contactDamage: 20,
  moveSpeed: 70,
  phases: [
    // P1 — signature: slow, readable radial bursts.
    {
      patternCooldown: 96,
      attacks: [
        { kind: 'ring', count: 14, speed: 300, damage: 8, bulletRadius: 7, bulletLife: 140 },
        { kind: 'ring', count: 18, speed: 340, damage: 8, bulletRadius: 7, bulletLife: 140 },
      ],
    },
    // P2 — variation + terrain: rings interleaved with lava pillar lines.
    {
      patternCooldown: 84,
      attacks: [
        { kind: 'ring', count: 20, speed: 360, damage: 9, bulletRadius: 7, bulletLife: 150 },
        { kind: 'lavaLine', pillars: 7, windup: 48, activeTicks: 100, radius: 52, damage: 10 },
        { kind: 'spiral', count: 10, speed: 380, damage: 9, bulletRadius: 6, bulletLife: 150, turn: 0.5 },
      ],
    },
    // P3 — desperation: dense spirals, faster cadence.
    {
      patternCooldown: 60,
      attacks: [
        { kind: 'spiral', count: 14, speed: 400, damage: 10, bulletRadius: 6, bulletLife: 160, turn: 0.62 },
        { kind: 'ring', count: 24, speed: 420, damage: 10, bulletRadius: 7, bulletLife: 160 },
        { kind: 'spiral', count: 14, speed: 400, damage: 10, bulletRadius: 6, bulletLife: 160, turn: -0.62 },
      ],
    },
  ],
};
