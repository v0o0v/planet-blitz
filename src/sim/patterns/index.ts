/**
 * Pattern engine — executes enemy movement + attack components each tick.
 *
 * Kept deterministic by construction: every behaviour is a pure function of the
 * current state (player/enemy positions, timers). No RNG is drawn here, so two
 * runs with the same wave spawns evolve identically. Enemies only *emit* things
 * (bullets, hazards); the world loop owns integrating and resolving them.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import type { EnemyDef } from './types.js';
import { HAZARD_MORTAR, HAZARD_LAVA } from './types.js';
import { spawnEnemyBullet, spawnHazard } from '../entities.js';
import { cos, sin, atan2, length, TWO_PI, HALF_PI } from '../math.js';
import { DT } from '../constants.js';

/** Advance one enemy: steer, then fire if its cadence is ready. */
export function updateEnemy(state: WorldState, e: Entity, def: EnemyDef, player: Entity): void {
  applyMovement(state, e, def, player);

  if (e.cooldown > 0) {
    e.cooldown--;
  }
  // Fragments fire on wall impact (handled in movement), not on cadence.
  if (def.attack.kind !== 'fragments' && e.cooldown <= 0) {
    runAttack(state, e, def, player);
    e.cooldown = def.fireCooldown;
  }
}

function applyMovement(state: WorldState, e: Entity, def: EnemyDef, player: Entity): void {
  switch (def.movement) {
    case 'chargeStraight':
      moveCharge(state, e, def, player);
      break;
    case 'stationary':
      e.vx = 0;
      e.vy = 0;
      break;
    case 'standoff':
      moveStandoff(e, def, player);
      integrate(state, e);
      break;
    case 'seekWounded':
      moveSeekWounded(state, e, def, player);
      integrate(state, e);
      break;
  }
}

/** Straight rush; on wall impact reflect, re-aim at the player, spray fragments. */
function moveCharge(state: WorldState, e: Entity, def: EnemyDef, player: Entity): void {
  // Establish heading on the first tick after spawn (velocity still zero).
  if (e.vx === 0 && e.vy === 0) {
    aimAt(e, def.speed, player.x, player.y);
  }
  e.x += e.vx * DT;
  e.y += e.vy * DT;

  const cfg = state.config;
  let bounced = false;
  if (e.x < e.radius) {
    e.x = e.radius;
    bounced = true;
  } else if (e.x > cfg.arenaWidth - e.radius) {
    e.x = cfg.arenaWidth - e.radius;
    bounced = true;
  }
  if (e.y < e.radius) {
    e.y = e.radius;
    bounced = true;
  } else if (e.y > cfg.arenaHeight - e.radius) {
    e.y = cfg.arenaHeight - e.radius;
    bounced = true;
  }
  if (bounced) {
    if (def.attack.kind === 'fragments' && e.cooldown <= 0) {
      sprayFragments(state, e, def.attack);
      e.cooldown = def.fireCooldown;
    }
    aimAt(e, def.speed, player.x, player.y);
  }
  e.angle = atan2(e.vy, e.vx);
}

function moveStandoff(e: Entity, def: EnemyDef, player: Entity): void {
  const dx = player.x - e.x;
  const dy = player.y - e.y;
  const dist = length(dx, dy);
  const preferred = 380;
  const ang = atan2(dy, dx);
  if (dist > preferred + 40) {
    e.vx = cos(ang) * def.speed;
    e.vy = sin(ang) * def.speed;
  } else if (dist < preferred - 40) {
    e.vx = -cos(ang) * def.speed;
    e.vy = -sin(ang) * def.speed;
  } else {
    // Hold range with a slow perpendicular strafe.
    e.vx = cos(ang + HALF_PI) * def.speed * 0.5;
    e.vy = sin(ang + HALF_PI) * def.speed * 0.5;
  }
  e.angle = ang;
}

function moveSeekWounded(state: WorldState, e: Entity, def: EnemyDef, player: Entity): void {
  const ally = nearestWoundedAlly(state, e);
  const tx = ally?.x ?? player.x;
  const ty = ally?.y ?? player.y;
  const dx = tx - e.x;
  const dy = ty - e.y;
  const dist = length(dx, dy);
  const ang = atan2(dy, dx);
  // Approach the target but stop ~120u short so it hovers alongside to heal.
  if (dist > 120) {
    e.vx = cos(ang) * def.speed;
    e.vy = sin(ang) * def.speed;
  } else {
    e.vx = 0;
    e.vy = 0;
  }
  e.angle = ang;
}

function runAttack(state: WorldState, e: Entity, def: EnemyDef, player: Entity): void {
  switch (def.attack.kind) {
    case 'mortar': {
      // Telegraph a circular impact at the player's current position.
      spawnHazard(
        state,
        HAZARD_MORTAR,
        player.x,
        player.y,
        def.attack.radius,
        def.attack.windup,
        8, // short burst window
        def.attack.damage,
        false,
        e.id,
      );
      break;
    }
    case 'lava': {
      // Raise a horizontal line of pillars across the arena at the player's y.
      const a = def.attack;
      const step = state.config.arenaWidth / (a.pillars + 1);
      for (let i = 1; i <= a.pillars; i++) {
        spawnHazard(
          state,
          HAZARD_LAVA,
          step * i,
          player.y,
          a.radius,
          a.windup,
          a.activeTicks,
          a.damage,
          true,
          e.id,
        );
      }
      break;
    }
    case 'heal': {
      const ally = nearestWoundedAlly(state, e);
      if (ally !== undefined) {
        const dx = ally.x - e.x;
        const dy = ally.y - e.y;
        if (length(dx, dy) <= def.attack.range) {
          ally.hp = Math.min(ally.maxHp, ally.hp + def.attack.healPerTick);
          e.phase = 1; // render: beam active
          e.targetX = ally.x;
          e.targetY = ally.y;
          return;
        }
      }
      e.phase = 0;
      break;
    }
    case 'fragments':
      break; // handled on wall impact
  }
}

function sprayFragments(
  state: WorldState,
  e: Entity,
  atk: Extract<EnemyDef['attack'], { kind: 'fragments' }>,
): void {
  for (let i = 0; i < atk.count; i++) {
    // Respect the segment's simultaneous enemy-bullet cap (perf + fairness).
    if (state.enemyBulletCount >= state.bulletCap) break;
    const ang = (i * TWO_PI) / atk.count;
    spawnEnemyBullet(
      state,
      e.x,
      e.y,
      cos(ang) * atk.speed,
      sin(ang) * atk.speed,
      ang,
      atk.damage,
      atk.bulletRadius,
      atk.bulletLife,
    );
    state.enemyBulletCount++;
  }
}

/** Nearest same-faction enemy below full HP (excluding self). Deterministic order. */
function nearestWoundedAlly(state: WorldState, self: Entity): Entity | undefined {
  let best: Entity | undefined;
  let bestD = Infinity;
  for (const o of state.entities) {
    if (o.kind !== 'enemy' || o.id === self.id || o.hp >= o.maxHp) continue;
    const dx = o.x - self.x;
    const dy = o.y - self.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

function aimAt(e: Entity, speed: number, tx: number, ty: number): void {
  const ang = atan2(ty - e.y, tx - e.x);
  e.vx = cos(ang) * speed;
  e.vy = sin(ang) * speed;
}

function integrate(state: WorldState, e: Entity): void {
  e.x += e.vx * DT;
  e.y += e.vy * DT;
  const cfg = state.config;
  if (e.x < e.radius) e.x = e.radius;
  else if (e.x > cfg.arenaWidth - e.radius) e.x = cfg.arenaWidth - e.radius;
  if (e.y < e.radius) e.y = e.radius;
  else if (e.y > cfg.arenaHeight - e.radius) e.y = cfg.arenaHeight - e.radius;
}
