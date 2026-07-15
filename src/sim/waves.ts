/**
 * Wave director — segment progression + seeded card draws (spec R3).
 *
 * Runs on a dedicated RNG stream (`world.waveRng`, forked once at creation) so
 * enemy composition is a pure function of the seed and independent of how many
 * numbers other subsystems draw. Per tick it advances the segment clock, draws a
 * spawn card when due, and materialises its enemies at formation positions —
 * always respecting the segment's onscreen enemy cap. The 6th segment is the
 * boss slot: it stops normal spawns and raises `boss` for Phase 3 to hook.
 */

import type { WorldState } from './world.js';
import type { Entity } from './entities.js';
import { blankEntity, addEntity } from './entities.js';
import type { EnemyDef } from './patterns/types.js';
import { KARGON_ROSTER, ENEMY_BY_TYPE } from '../../data/enemies.js';
import { SEGMENTS, CARD_POOL } from '../../data/waves.js';
import type { WaveCard, Formation } from '../../data/waves.js';
import { cos, sin, PI, TWO_PI } from './math.js';

export interface WaveRuntime {
  segmentIndex: number;
  segmentTimer: number;
  cardTimer: number;
  /** Boss segment reached — Phase 3 spawns the fight; Phase 2 just flags it. */
  boss: boolean;
  /** Run fully complete (all segments elapsed). */
  done: boolean;
}

export function createWaveRuntime(): WaveRuntime {
  const first = SEGMENTS[0];
  return {
    segmentIndex: 0,
    segmentTimer: first ? first.durationTicks : 0,
    cardTimer: 0, // draw the opening card immediately
    boss: false,
    done: false,
  };
}

/** Count live enemies (excludes bullets/hazards/gems). */
export function countEnemies(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) if (e.kind === 'enemy') n++;
  return n;
}

/** Advance the wave director by one tick, spawning enemies as due. */
export function updateWaves(state: WorldState, player: Entity): void {
  const w = state.wave;
  if (w.done) return;

  const seg = SEGMENTS[w.segmentIndex];
  if (seg === undefined) {
    w.done = true;
    return;
  }
  state.bulletCap = seg.bulletCap;

  if (seg.boss) {
    w.boss = true; // Phase 3 hook: boss encounter begins here.
  } else {
    if (w.cardTimer > 0) w.cardTimer--;
    if (w.cardTimer <= 0 && countEnemies(state) < seg.maxEnemies) {
      const cardIndex = state.waveRng.int(0, CARD_POOL.length - 1);
      const card = CARD_POOL[cardIndex];
      if (card !== undefined) spawnCard(state, card, seg.maxEnemies, player);
      w.cardTimer = seg.cardInterval;
    }
  }

  if (w.segmentTimer > 0) w.segmentTimer--;
  if (w.segmentTimer <= 0 && w.segmentIndex < SEGMENTS.length - 1) {
    w.segmentIndex++;
    const next = SEGMENTS[w.segmentIndex];
    w.segmentTimer = next ? next.durationTicks : 0;
    w.cardTimer = 0;
  }
}

function spawnCard(state: WorldState, card: WaveCard, maxEnemies: number, player: Entity): void {
  // Flatten the card into an ordered list of defs, then place by formation.
  const defs: EnemyDef[] = [];
  for (const s of card.spawns) {
    const def = KARGON_ROSTER[s.role];
    for (let i = 0; i < s.count; i++) defs.push(def);
  }
  const positions = formationPositions(state, card.formation, defs.length, player);
  const room = maxEnemies - countEnemies(state);
  const spawnN = Math.min(defs.length, room);
  for (let i = 0; i < spawnN; i++) {
    const def = defs[i];
    const pos = positions[i];
    if (def === undefined || pos === undefined) continue;
    spawnEnemy(state, def, pos.x, pos.y);
  }
}

function spawnEnemy(state: WorldState, def: EnemyDef, x: number, y: number): Entity {
  const e = blankEntity('enemy');
  e.x = x;
  e.y = y;
  e.radius = def.radius;
  e.hp = def.hp;
  e.maxHp = def.hp;
  e.damage = def.contactDamage;
  e.enemyType = def.typeIndex;
  // Stagger first fire so a freshly spawned pack does not volley in lockstep.
  e.cooldown = def.fireCooldown + state.waveRng.int(0, 30);
  return addEntity(state, e);
}

/** Look up the behaviour definition backing a live enemy entity. */
export function enemyDefFor(e: Entity): EnemyDef | undefined {
  return ENEMY_BY_TYPE[e.enemyType];
}

// ---------------------------------------------------------------------------
// Formations — deterministic spawn placement (seeded, avoids the player).
// ---------------------------------------------------------------------------

function formationPositions(
  state: WorldState,
  formation: Formation,
  count: number,
  player: Entity,
): { x: number; y: number }[] {
  const cfg = state.config;
  const w = cfg.arenaWidth;
  const h = cfg.arenaHeight;
  const rng = state.waveRng;
  const out: { x: number; y: number }[] = [];

  switch (formation) {
    case 'ring': {
      const cx = w / 2;
      const cy = h / 2;
      const rad = Math.min(w, h) * 0.42;
      const start = rng.range(-PI, PI);
      for (let i = 0; i < count; i++) {
        const ang = start + (i * TWO_PI) / count;
        out.push({ x: cx + cos(ang) * rad, y: cy + sin(ang) * rad });
      }
      break;
    }
    case 'line': {
      // A column entering from a random horizontal edge.
      const fromLeft = rng.chance(0.5);
      const x = fromLeft ? 80 : w - 80;
      const y0 = rng.range(h * 0.2, h * 0.8);
      for (let i = 0; i < count; i++) {
        out.push({ x: x + (fromLeft ? -1 : 1) * i * 46, y: clampIn(y0 + i * 20, 60, h - 60) });
      }
      break;
    }
    case 'edges': {
      for (let i = 0; i < count; i++) {
        const side = rng.int(0, 3);
        let x = 0;
        let y = 0;
        if (side === 0) {
          x = rng.range(80, w - 80);
          y = 70;
        } else if (side === 1) {
          x = rng.range(80, w - 80);
          y = h - 70;
        } else if (side === 2) {
          x = 70;
          y = rng.range(80, h - 80);
        } else {
          x = w - 70;
          y = rng.range(80, h - 80);
        }
        out.push({ x, y });
      }
      break;
    }
    case 'cluster': {
      // A blob offset from the player so it is not on top of them.
      const cx = clampIn(player.x + rng.range(-1, 1) * 500 + 260, 200, w - 200);
      const cy = clampIn(player.y + rng.range(-1, 1) * 400 - 200, 200, h - 200);
      for (let i = 0; i < count; i++) {
        out.push({ x: cx + rng.range(-90, 90), y: cy + rng.range(-90, 90) });
      }
      break;
    }
  }
  return out;
}

function clampIn(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
