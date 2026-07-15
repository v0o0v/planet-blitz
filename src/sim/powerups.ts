/**
 * Level-up powerup pool (M1 reduced set — plan task 13).
 *
 * Eight powerups: 4 vulcan derivatives, 2 movement/dash, 2 utility. Each is a
 * pure state mutation applied at the exact tick the player's pick input arrives,
 * so a recorded [seed + input log] — where the pick index is packed into the
 * input frame's `special` bits — reproduces the same build deterministically.
 *
 * `apply` mutates only sim state (weapon stats, config, player entity, world
 * fields). It draws no RNG and reads no wall-clock time, so it is safe under the
 * sim-core lint rules. The display metadata (name/desc) lives here too so the UI
 * layer can render the 3-choice cards without duplicating the table.
 */

import type { WorldState } from './world.js';
import type { Entity } from './entities.js';

export interface PowerupDef {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  /** Applies the effect to the world (deterministic, no RNG). */
  readonly apply: (state: WorldState) => void;
}

function player(state: WorldState): Entity | undefined {
  return state.entities[0];
}

/**
 * The pool. Index is stable and used as the wire value for the pick input, so
 * never reorder existing entries without bumping a replay format version.
 */
export const POWERUPS: readonly PowerupDef[] = [
  // --- Vulcan derivatives (4) ---
  {
    id: 'rapid-fire',
    name: '고속 연사',
    desc: '발칸 발사 간격 -18%',
    apply: (s) => {
      s.weapon.fireCooldown = Math.max(2, Math.round(s.weapon.fireCooldown * 0.82));
    },
  },
  {
    id: 'twin-shot',
    name: '증설 포신',
    desc: '탄환 +1 (부채꼴 확산)',
    apply: (s) => {
      s.weapon.bulletCount += 1;
      s.weapon.spread = Math.min(1.2, s.weapon.spread + 0.06);
    },
  },
  {
    id: 'heavy-rounds',
    name: '고폭탄',
    desc: '탄환 데미지 +35%',
    apply: (s) => {
      s.weapon.damage = Math.round(s.weapon.damage * 1.35 * 100) / 100;
    },
  },
  {
    id: 'piercing-rounds',
    name: '관통탄',
    desc: '관통 +1 (적을 뚫고 지나감)',
    apply: (s) => {
      s.weapon.pierce += 1;
    },
  },
  // --- Movement / dash (2) ---
  {
    id: 'thrusters',
    name: '추진기 증강',
    desc: '이동 속도 +12%',
    apply: (s) => {
      s.config.playerSpeed = Math.round(s.config.playerSpeed * 1.12);
    },
  },
  {
    id: 'dash-coils',
    name: '대시 코일',
    desc: '대시 재충전 -20%',
    apply: (s) => {
      s.config.dashCooldownTicks = Math.max(12, Math.round(s.config.dashCooldownTicks * 0.8));
    },
  },
  // --- Utility (2) ---
  {
    id: 'reinforced-hull',
    name: '강화 장갑',
    desc: '최대 HP +25, 즉시 회복',
    apply: (s) => {
      const p = player(s);
      if (p !== undefined) {
        p.maxHp += 25;
        p.hp = Math.min(p.maxHp, p.hp + 25);
      }
      s.config.playerHp += 25;
    },
  },
  {
    id: 'gem-magnet',
    name: '자기장 코일',
    desc: '젬 흡수 반경 +40%',
    apply: (s) => {
      s.magnetRadius = Math.round(s.magnetRadius * 1.4);
    },
  },
];

/**
 * Draw `count` distinct powerup indices from the pool using the powerup RNG
 * stream (deterministic — same seed & level history yields the same offer).
 */
export function drawPowerupChoices(state: WorldState, count: number): number[] {
  const pool: number[] = [];
  for (let i = 0; i < POWERUPS.length; i++) pool.push(i);
  const chosen: number[] = [];
  const n = Math.min(count, pool.length);
  for (let k = 0; k < n; k++) {
    const j = state.powerupRng.int(0, pool.length - 1);
    const picked = pool[j];
    if (picked !== undefined) chosen.push(picked);
    pool.splice(j, 1);
  }
  return chosen;
}

/** Apply a powerup by its pool index (no-op if out of range). */
export function applyPowerup(state: WorldState, index: number): void {
  const def = POWERUPS[index];
  if (def !== undefined) def.apply(state);
}
