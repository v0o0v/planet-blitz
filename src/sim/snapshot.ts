/**
 * Serializable render snapshots of the simulation.
 *
 * The render layer must not reach into live sim internals (mutable entities,
 * RNG). Instead the sim produces a flat, immutable snapshot each tick; the
 * renderer keeps the previous and current snapshot and interpolates between
 * them to decouple the fixed 60 Hz sim from the variable display refresh rate.
 */

import type { WorldState, EntityKind } from './world.js';

export interface EntitySnapshot {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  angle: number;
  radius: number;
  hp: number;
}

export interface WorldSnapshot {
  tick: number;
  arenaWidth: number;
  arenaHeight: number;
  entities: EntitySnapshot[];
}

/** Capture an immutable snapshot of the current world for rendering. */
export function snapshotWorld(state: WorldState): WorldSnapshot {
  const entities: EntitySnapshot[] = state.entities.map((e) => ({
    id: e.id,
    kind: e.kind,
    x: e.x,
    y: e.y,
    angle: e.angle,
    radius: e.radius,
    hp: e.hp,
  }));
  return {
    tick: state.tick,
    arenaWidth: state.config.arenaWidth,
    arenaHeight: state.config.arenaHeight,
    entities,
  };
}
