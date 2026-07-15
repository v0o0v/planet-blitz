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

/**
 * Player-relative spawn geometry for the infinite map (world units).
 *
 * Enemies, the boss, and supply raiders no longer spawn at absolute arena edges;
 * they materialise just outside the player's on-screen viewport. These offsets
 * are half the viewport plus a margin, so anything placed at them is off-screen
 * regardless of where the player currently is. `SPAWN_RING_RADIUS` is half the
 * viewport diagonal plus a margin (a full off-screen ring in every direction).
 *
 * All are evaluated once at load with only correctly-rounded ops (`Math.sqrt`),
 * so they are bit-identical on every platform and safe for the deterministic sim.
 * Each stays well below `PROJECTILE_CULL_RADIUS` (~3304, world.ts) so a bullet
 * fired by a freshly spawned entity is never culled before it can enter view.
 */
export const SPAWN_MARGIN = 140;
export const OFFSCREEN_X = VIEW_WIDTH / 2 + SPAWN_MARGIN; // 1100
export const OFFSCREEN_Y = VIEW_HEIGHT / 2 + SPAWN_MARGIN; // 680
export const SPAWN_RING_RADIUS =
  Math.sqrt(VIEW_WIDTH * VIEW_WIDTH + VIEW_HEIGHT * VIEW_HEIGHT) / 2 + 220; // ~1322

/**
 * Fixed horizontal span (world units) of a lava-pillar line, centred on the
 * player. Absolute arena spans no longer make sense on the infinite map, so a
 * pillar line covers one viewport width around the player.
 */
export const HAZARD_LINE_SPAN = VIEW_WIDTH;
