/**
 * Boss fight logic (M1 boss — plan task 15, spec R2).
 *
 * Deterministic by construction: like the enemy pattern engine it draws no RNG
 * and reads no wall-clock time. Boss state is carried on the entity's generic
 * fields:
 *   - `phase`   : current phase index 0/1/2 (folded into the hash)
 *   - `timer`   : phase-transition animation countdown; > 0 = frozen & clearing
 *   - `cooldown`: ticks until the next pattern cast
 *   - `iframes` : OVERHEAT window remaining — the boss takes DOUBLE damage while
 *                 this is > 0 (spec: 5s after casting a pattern)
 *   - `pierce`  : round-robin index into the current phase's attack list
 *
 * On crossing an HP threshold (70% / 35%) the boss enters a 2s transition that
 * freezes it and CLEARS every enemy bullet on screen (spec). The transition is
 * itself deterministic — no visual-only randomness leaks into the sim.
 */

import type { WorldState } from './world.js';
import type { Entity } from './entities.js';
import { spawnEnemyBullet, spawnHazard } from './entities.js';
import { HAZARD_LAVA } from './patterns/types.js';
import { cos, sin, atan2, TWO_PI, clamp } from './math.js';
import { DT } from './constants.js';
import { LAVA_FORTRESS } from '../../data/boss.js';
import type { BossAttack } from '../../data/boss.js';

/** Phase-transition animation length: 2 seconds (spec). */
export const BOSS_PHASE_TRANSITION_TICKS = 120;
/** Overheat window after casting a pattern: 5 seconds, double damage taken (spec). */
export const BOSS_OVERHEAT_TICKS = 300;

/** Advance the boss by one tick: transitions, movement, overheat, patterns. */
export function updateBoss(state: WorldState, boss: Entity, player: Entity): void {
  // Phase-transition animation: frozen, no fire, no overheat decay.
  if (boss.timer > 0) {
    boss.timer--;
    boss.vx = 0;
    boss.vy = 0;
    return;
  }

  // Threshold crossing → advance phase, freeze, clear the screen of enemy fire.
  const frac = boss.maxHp > 0 ? boss.hp / boss.maxHp : 0;
  const targetPhase = frac > 0.7 ? 0 : frac > 0.35 ? 1 : 2;
  if (targetPhase > boss.phase) {
    boss.phase = targetPhase;
    boss.timer = BOSS_PHASE_TRANSITION_TICKS;
    boss.iframes = 0;
    boss.cooldown = 0;
    clearEnemyBullets(state);
    return;
  }

  moveBoss(state, boss, player);

  if (boss.iframes > 0) boss.iframes--;

  if (boss.cooldown > 0) {
    boss.cooldown--;
    return;
  }
  const phase = LAVA_FORTRESS.phases[boss.phase];
  if (phase === undefined) return;
  const attack = phase.attacks[boss.pierce % phase.attacks.length];
  if (attack !== undefined) executeAttack(state, boss, player, attack);
  boss.pierce++;
  boss.cooldown = phase.patternCooldown;
  // Casting exposes the boss: the overheat window opens (spec).
  boss.iframes = BOSS_OVERHEAT_TICKS;
}

/** Slow hover in the upper arena, tracking the player horizontally. */
function moveBoss(state: WorldState, boss: Entity, player: Entity): void {
  const targetY = state.config.arenaHeight * 0.24;
  const sp = LAVA_FORTRESS.moveSpeed;
  const stepMax = sp * DT;
  const dy = targetY - boss.y;
  boss.y += clamp(dy, -stepMax, stepMax);
  const dx = player.x - boss.x;
  boss.x += clamp(dx, -stepMax, stepMax);
  boss.x = clamp(boss.x, boss.radius, state.config.arenaWidth - boss.radius);
  boss.angle = atan2(player.y - boss.y, player.x - boss.x);
}

function executeAttack(state: WorldState, boss: Entity, player: Entity, atk: BossAttack): void {
  switch (atk.kind) {
    case 'ring': {
      for (let i = 0; i < atk.count; i++) {
        if (state.enemyBulletCount >= state.bulletCap) break;
        const ang = (i * TWO_PI) / atk.count;
        spawnEnemyBullet(
          state,
          boss.x,
          boss.y,
          cos(ang) * atk.speed,
          sin(ang) * atk.speed,
          ang,
          atk.damage,
          atk.bulletRadius,
          atk.bulletLife,
        );
        state.enemyBulletCount++;
      }
      break;
    }
    case 'spiral': {
      // Base angle advances each cast (stored on targetX) to trace a spiral.
      const base = boss.targetX;
      for (let i = 0; i < atk.count; i++) {
        if (state.enemyBulletCount >= state.bulletCap) break;
        const ang = base + (i * TWO_PI) / atk.count;
        spawnEnemyBullet(
          state,
          boss.x,
          boss.y,
          cos(ang) * atk.speed,
          sin(ang) * atk.speed,
          ang,
          atk.damage,
          atk.bulletRadius,
          atk.bulletLife,
        );
        state.enemyBulletCount++;
      }
      boss.targetX = base + atk.turn;
      break;
    }
    case 'lavaLine': {
      const step = state.config.arenaWidth / (atk.pillars + 1);
      for (let i = 1; i <= atk.pillars; i++) {
        spawnHazard(
          state,
          HAZARD_LAVA,
          step * i,
          player.y,
          atk.radius,
          atk.windup,
          atk.activeTicks,
          atk.damage,
          true,
          boss.id,
        );
      }
      break;
    }
  }
}

/** Wipe every live enemy bullet — the phase-transition screen clear (spec). */
function clearEnemyBullets(state: WorldState): void {
  for (const e of state.entities) {
    if (e.kind === 'enemyBullet') e.dead = true;
  }
}
