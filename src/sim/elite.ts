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
// --- M3 신규 4종(plan B3, 어픽스 8종 완성) ---
export const ELITE_REGEN = 4; // 재생하는 — 매 틱 HP 회복
export const ELITE_SHIELDED = 5; // 보호막의 — 받는 피해 절반
export const ELITE_VOLATILE = 6; // 폭발성의 — 사망 시 대형 방사 폭발
export const ELITE_FRENZIED = 7; // 광폭한 — 접촉 피해·이동 속도 ↑
export const ELITE_AFFIX_COUNT = 8;

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
/** 광폭한 contact-damage / speed multipliers. */
const FRENZIED_DAMAGE_MULT = 1.6;
const FRENZIED_SPEED_MULT = 1.35;
/** 보호막의 받는 피해 배율(< 1 = 절반). */
const SHIELDED_DAMAGE_TAKEN_MULT = 0.5;
/** 재생하는 틱당 HP 회복량. */
const REGEN_PER_TICK = 2;

/** Fragments a 분열하는 elite bursts on death. */
const SPLIT_FRAGMENTS = 8;
const SPLIT_FRAGMENT_SPEED = 520;
const SPLIT_FRAGMENT_DAMAGE = 8;
const SPLIT_FRAGMENT_RADIUS = 6;
const SPLIT_FRAGMENT_LIFE = 70;

/** 폭발성의 elite 사망 폭발(분열하는보다 크고 빠르며 넓다). */
const VOLATILE_FRAGMENTS = 16;
const VOLATILE_FRAGMENT_SPEED = 700;
const VOLATILE_FRAGMENT_DAMAGE = 11;
const VOLATILE_FRAGMENT_RADIUS = 8;
const VOLATILE_FRAGMENT_LIFE = 84;

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
  if (affixCode === ELITE_FRENZIED) e.damage *= FRENZIED_DAMAGE_MULT;
}

/** True when an enemy entity is an elite. */
export function isElite(e: Entity): boolean {
  return e.kind === 'enemy' && e.pierce > 0;
}

/** Elite affix code (0..3), or -1 for a normal enemy. */
export function eliteAffix(e: Entity): number {
  return e.kind === 'enemy' && e.pierce > 0 ? e.pierce - 1 : -1;
}

/** Movement-speed multiplier from the 가속하는/광폭한 affix (1 for everything else). */
export function eliteSpeedMult(e: Entity): number {
  if (!isElite(e)) return 1;
  const a = eliteAffix(e);
  if (a === ELITE_ACCEL) return ACCEL_SPEED_MULT;
  if (a === ELITE_FRENZIED) return FRENZIED_SPEED_MULT;
  return 1;
}

/** 보호막의 엘리트가 받는 피해 배율(그 외 1). resolveCollisions의 아군탄 명중에서 곱한다. */
export function eliteDamageTakenMult(e: Entity): number {
  return isElite(e) && eliteAffix(e) === ELITE_SHIELDED ? SHIELDED_DAMAGE_TAKEN_MULT : 1;
}

/**
 * 재생하는 엘리트의 틱당 HP 회복(그 외 no-op). stepEnemies에서 매 틱 호출한다.
 * maxHp를 넘지 않으며 정수 가산 — 결정론.
 */
export function applyEliteRegen(e: Entity): void {
  if (!isElite(e) || eliteAffix(e) !== ELITE_REGEN) return;
  if (e.hp < e.maxHp) {
    e.hp += REGEN_PER_TICK;
    if (e.hp > e.maxHp) e.hp = e.maxHp;
  }
}

/**
 * On-death effect for a 분열하는 elite: burst a radial fan of enemy fragments
 * (respecting the segment bullet cap). No-op for other affixes. Deterministic
 * (fixed angles, no RNG). Called from the compaction pass when an elite dies.
 */
export function spawnEliteDeathFx(state: WorldState, e: Entity): void {
  const affix = eliteAffix(e);
  let n: number;
  let speed: number;
  let damage: number;
  let radius: number;
  let life: number;
  if (affix === ELITE_SPLIT) {
    n = SPLIT_FRAGMENTS;
    speed = SPLIT_FRAGMENT_SPEED;
    damage = SPLIT_FRAGMENT_DAMAGE;
    radius = SPLIT_FRAGMENT_RADIUS;
    life = SPLIT_FRAGMENT_LIFE;
  } else if (affix === ELITE_VOLATILE) {
    n = VOLATILE_FRAGMENTS;
    speed = VOLATILE_FRAGMENT_SPEED;
    damage = VOLATILE_FRAGMENT_DAMAGE;
    radius = VOLATILE_FRAGMENT_RADIUS;
    life = VOLATILE_FRAGMENT_LIFE;
  } else {
    return;
  }
  for (let i = 0; i < n; i++) {
    if (state.enemyBulletCount >= state.bulletCap) break;
    const ang = (i * TWO_PI) / n;
    spawnEnemyBullet(state, e.x, e.y, cos(ang) * speed, sin(ang) * speed, ang, damage, radius, life);
    state.enemyBulletCount++;
  }
}
