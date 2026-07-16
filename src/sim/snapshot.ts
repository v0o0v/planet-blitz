/**
 * Serializable render snapshots of the simulation.
 *
 * The render layer must not reach into live sim internals (mutable entities,
 * RNG). Instead the sim produces a flat, immutable snapshot each tick; the
 * renderer keeps the previous and current snapshot and interpolates between
 * them to decouple the fixed 60 Hz sim from the variable display refresh rate.
 */

import type { WorldState } from './world.js';
import type { EntityKind } from './entities.js';
import { eliteAffix } from './elite.js';

export interface EntitySnapshot {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  angle: number;
  radius: number;
  /** Wall half-height (targetX); 0 for non-walls. `radius` is the wall half-width. */
  aabbH: number;
  /** Enemy role / hazard subtype code (drives render colour); -1 if unused. */
  enemyType: number;
  hp: number;
  maxHp: number;
  /**
   * Hazard: in its damaging window (vs. telegraphing). Boss: overheated (taking
   * double damage). False otherwise.
   */
  active: boolean;
  /** Boss phase-transition animation in progress (screen-clear flash). */
  flash: boolean;
  /**
   * Elite affix code (0..3) for an elite enemy, else -1. Drives the nameplate /
   * outline (render only — never part of the hash). For `loot` entities the
   * rarity code lives in `enemyType`.
   */
  elite: number;
}

/** A support heal beam, for render only. */
export interface Beam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface WorldSnapshot {
  tick: number;
  arenaWidth: number;
  arenaHeight: number;
  /**
   * Camera focus in world coordinates (= the player position). The sim holds no
   * camera state (sim/render separation, ADR-0005); it is derived here from the
   * player so the renderer can pan the world without reaching into sim internals.
   */
  cameraX: number;
  cameraY: number;
  /**
   * Active planet index (config.planet). Render-only — drives per-planet boss /
   * backdrop art selection. NEVER part of the state hash (hashing reads
   * WorldState, not this snapshot), so it is safe to expose here.
   */
  planet: number;
  entities: EntitySnapshot[];
  beams: Beam[];
}

const SUPPORT_TYPE = 3;

/** Capture an immutable snapshot of the current world for rendering. */
export function snapshotWorld(state: WorldState): WorldSnapshot {
  const entities: EntitySnapshot[] = [];
  const beams: Beam[] = [];
  // Camera tracks the player (entity at index 0); origin if it is somehow absent.
  const player = state.entities[0];
  const cameraX = player?.x ?? 0;
  const cameraY = player?.y ?? 0;
  for (const e of state.entities) {
    entities.push({
      id: e.id,
      kind: e.kind,
      x: e.x,
      y: e.y,
      angle: e.angle,
      radius: e.radius,
      aabbH: e.kind === 'wall' ? e.targetX : 0,
      enemyType: e.enemyType,
      hp: e.hp,
      maxHp: e.maxHp,
      active:
        e.kind === 'hazard'
          ? e.timer <= 0 && e.life !== 0 // life<0 permanent terrain hazard is active
          : e.kind === 'boss'
            ? e.iframes > 0
            : false,
      flash: e.kind === 'boss' && e.timer > 0,
      elite: eliteAffix(e),
    });
    if (e.kind === 'enemy' && e.enemyType === SUPPORT_TYPE && e.phase === 1) {
      beams.push({ x1: e.x, y1: e.y, x2: e.targetX, y2: e.targetY });
    }
  }
  return {
    tick: state.tick,
    arenaWidth: state.config.arenaWidth,
    arenaHeight: state.config.arenaHeight,
    cameraX,
    cameraY,
    planet: state.config.planet ?? 0,
    entities,
    beams,
  };
}
