/**
 * Core simulation constants (leaf module — no sim dependencies).
 *
 * Kept separate from world.ts so the pattern engine can read the timestep
 * without creating a world ↔ patterns import cycle.
 */

/** Fixed simulation timestep: 60 ticks per second. */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/**
 * Viewport reference dimensions (world units, matches the 1920x1080 design
 * space). The world itself is now unbounded (infinite scroll map) — these no
 * longer fence the player. They define the on-screen viewport used for spawn
 * rings, projectile culling and camera framing. The `WorldConfig.arenaWidth/
 * Height` fields still carry these values so the replay hash layout is
 * unchanged (replay.ts:104-107).
 */
export const VIEW_WIDTH = 1920;
export const VIEW_HEIGHT = 1080;
