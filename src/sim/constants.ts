/**
 * Core simulation constants (leaf module — no sim dependencies).
 *
 * Kept separate from world.ts so the pattern engine can read the timestep
 * without creating a world ↔ patterns import cycle.
 */

/** Fixed simulation timestep: 60 ticks per second. */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** Default arena bounds (world units, matches the 1920x1080 design space). */
export const ARENA_WIDTH = 1920;
export const ARENA_HEIGHT = 1080;
