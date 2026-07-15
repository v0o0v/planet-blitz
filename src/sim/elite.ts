/**
 * Elite enemies + elite affixes (M2 plan B4, GDD §6).
 *
 * An elite is a buffed rank-and-file enemy carrying ONE random affix (drawn from
 * a dedicated `rng.fork('elite')` stream, OQ-M2-4). M2 implements 4 of the spec's
 * 8 affixes: 분열하는 / 가속하는 / 자기장 / 완강한. The affix is stored on the
 * entity's otherwise-unused `pierce` field (0 = not an elite, else affixCode+1),
 * which is already folded into the state hash — no new entity field or hash
 * layout change. Effects are stat/death hooks (plan B4 examples), all
 * deterministic (no RNG at effect time).
 */

import type { WorldState } from './world.js';
import type { Entity } from './entities.js';
import { spawnEnemyBullet } from './entities.js';
import { cos, sin, TWO_PI } from './math.js';

export const ELITE_SPLIT = 0; // 분열하는 — 사망 시 파편 방출
export const ELITE_ACCEL = 1; // 가속하는 — 이동 속도 ↑
export const ELITE_MAGNETIC = 2; // 자기장 — 접촉 피해·크기 ↑ (위협형 변종)
export const ELITE_STALWART = 3; // 완강한 — HP 대폭 ↑
export const ELITE_AFFIX_COUNT = 4;

/** Base HP multiplier applied to every elite (on top of affix-specific bonuses). */
const ELITE_HP_MULT = 3;
/** Elite hitbox growth (visual + collision heft). */
const ELITE_RADIUS_MULT = 1.3;
/** 완강한 extra HP multiplier (stacks on ELITE_HP_MULT). */
const STALWART_EXTRA_HP_MULT = 2;
/** 가속하는 movement speed multiplier. */
const ACCEL_SPEED_MULT = 1.6;
/** 자기장 contact-damage / radius multipliers. */
const MAGNETIC_DAMAGE_MULT = 2;
const MAGNETIC_RADIUS_MULT = 1.25;

/** Fragments a 분열하는 elite bursts on death. */
const SPLIT_FRAGMENTS = 8;
const SPLIT_FRAGMENT_SPEED = 520;
const SPLIT_FRAGMENT_DAMAGE = 8;
const SPLIT_FRAGMENT_RADIUS = 6;
const SPLIT_FRAGMENT_LIFE = 70;

/** Promote a freshly-spawned enemy into an elite carrying `affixCode`. Applies
 *  the base elite buff plus the affix's spawn-time stat changes. */
export function makeElite(e: Entity, affixCode: number): void {
  e.pierce = affixCode + 1; // marker (single source of truth for elite state)
  let hp = e.hp * ELITE_HP_MULT;
  if (affixCode === ELITE_STALWART) hp *= STALWART_EXTRA_HP_MULT;
  e.hp = hp;
  e.maxHp = hp;
  e.radius *= ELITE_RADIUS_MULT;
  if (affixCode === ELITE_MAGNETIC) {
    e.damage *= MAGNETIC_DAMAGE_MULT;
    e.radius *= MAGNETIC_RADIUS_MULT;
  }
}

/** True when an enemy entity is an elite. */
export function isElite(e: Entity): boolean {
  return e.kind === 'enemy' && e.pierce > 0;
}

/** Elite affix code (0..3), or -1 for a normal enemy. */
export function eliteAffix(e: Entity): number {
  return e.kind === 'enemy' && e.pierce > 0 ? e.pierce - 1 : -1;
}

/** Movement-speed multiplier from the 가속하는 affix (1 for everything else). */
export function eliteSpeedMult(e: Entity): number {
  return isElite(e) && eliteAffix(e) === ELITE_ACCEL ? ACCEL_SPEED_MULT : 1;
}

/**
 * On-death effect for a 분열하는 elite: burst a radial fan of enemy fragments
 * (respecting the segment bullet cap). No-op for other affixes. Deterministic
 * (fixed angles, no RNG). Called from the compaction pass when an elite dies.
 */
export function spawnEliteDeathFx(state: WorldState, e: Entity): void {
  if (eliteAffix(e) !== ELITE_SPLIT) return;
  for (let i = 0; i < SPLIT_FRAGMENTS; i++) {
    if (state.enemyBulletCount >= state.bulletCap) break;
    const ang = (i * TWO_PI) / SPLIT_FRAGMENTS;
    spawnEnemyBullet(
      state,
      e.x,
      e.y,
      cos(ang) * SPLIT_FRAGMENT_SPEED,
      sin(ang) * SPLIT_FRAGMENT_SPEED,
      ang,
      SPLIT_FRAGMENT_DAMAGE,
      SPLIT_FRAGMENT_RADIUS,
      SPLIT_FRAGMENT_LIFE,
    );
    state.enemyBulletCount++;
  }
}
