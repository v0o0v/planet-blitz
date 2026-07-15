/**
 * Event-object effects (plan Phase F4). Three proximity-triggered gimmicks:
 *   - magnetEmitter: temporarily multiplies the gem-magnet radius,
 *   - bombDevice:    damages nearby enemies and wipes nearby enemy bullets,
 *   - turretPickup:  converts into a short-lived auto-firing friendly turret.
 *
 * All triggers are position functions (contact/proximity), never input frames,
 * so they stay deterministic (OQ4 default). Leaf-ish: depends only on entities
 * and world fields, draws no RNG, reads no wall-clock time.
 */

import type { WorldState } from './world.js';
import type { Entity } from './entities.js';

// --- Magnet emitter -------------------------------------------------------
/** Duration of the magnet-radius buff (ticks): 10 seconds. */
export const MAGNET_BUFF_TICKS = 600;
/**
 * Magnet-radius multiplier while the emitter buff is active.
 *
 * COMPOSITION RULE with the `gem-magnet` powerup (powerups.ts): the powerup
 * permanently GROWS `state.magnetRadius` (x1.4 per pick). This buff MULTIPLIES
 * that current radius transiently — effective radius = magnetRadius * MULT while
 * `magnetBuffTicks > 0`. The two therefore stack multiplicatively and the buff
 * always scales whatever permanent radius the player has accrued.
 */
export const MAGNET_BUFF_MULT = 3;

// --- Bomb device ----------------------------------------------------------
/** Radius of the bomb's area effect (world units). */
export const BOMB_RADIUS = 520;
/** Damage dealt to each enemy/boss within the blast. */
export const BOMB_DAMAGE = 60;

// --- Turret pickup --------------------------------------------------------
/** Active turret lifetime once picked up (ticks): 10 seconds. */
export const TURRET_LIFE_TICKS = 600;
/** Turret fire cadence (ticks between shots). */
export const TURRET_FIRE_COOLDOWN = 10;
/** Turret targeting range (world units); enemies beyond are ignored. */
export const TURRET_RANGE = 900;
/** Turret bullet stats. */
export const TURRET_BULLET_SPEED = 1600;
export const TURRET_BULLET_DAMAGE = 10;
export const TURRET_BULLET_RADIUS = 5;
export const TURRET_BULLET_LIFE = 60;

/** Fire the magnet emitter: (re)arm the buff timer. */
export function triggerMagnetEmitter(state: WorldState): void {
  state.magnetBuffTicks = MAGNET_BUFF_TICKS;
}

/**
 * Fire the bomb device at (bx, by): damage every enemy/boss inside BOMB_RADIUS
 * and remove every enemy bullet inside it (reusing the boss screen-clear idea,
 * bounded to a radius). Deterministic entity-array sweep.
 */
export function triggerBombDevice(state: WorldState, bx: number, by: number): void {
  const r2 = BOMB_RADIUS * BOMB_RADIUS;
  for (const e of state.entities) {
    if (e.dead) continue;
    const dx = e.x - bx;
    const dy = e.y - by;
    if (dx * dx + dy * dy > r2) continue;
    if (e.kind === 'enemy' || e.kind === 'boss') {
      e.hp -= BOMB_DAMAGE;
      if (e.hp <= 0) e.dead = true;
    } else if (e.kind === 'enemyBullet') {
      e.dead = true;
    }
  }
}

/** Activate a turret pickup in place: mark it active and start its lifetime. */
export function activateTurret(pickup: Entity): void {
  pickup.phase = 1; // 1 = active turret (0 = dormant pickup)
  pickup.life = TURRET_LIFE_TICKS;
  pickup.cooldown = 0;
}

/** True when a turret-pickup entity is an active, firing turret. */
export function isActiveTurret(e: Entity): boolean {
  return e.kind === 'turretPickup' && e.phase === 1;
}
