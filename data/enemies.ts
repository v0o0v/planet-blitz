/**
 * Kargon enemy roster — M1's four role slots (spec §몹 매트릭스, R6).
 *
 * Data only: each entry pairs a movement component with an attack component and
 * tuning numbers. The pattern engine (src/sim/patterns) executes these; adding
 * planets/enemies later means adding rows here, not editing the world loop.
 *
 * Balance note: tier multipliers and the wave budget table come from the spec
 * (§수치 초안). The per-enemy HP / contact-damage / cadence values below are M1
 * prototype tuning (not spec-mandated) — first pass, expected to move during the
 * fun-gate tuning loop (plan Phase 4, task 20).
 */

import type { EnemyDef } from '../src/sim/patterns/types.js';
import { HAZARD_LAVA } from '../src/sim/patterns/types.js';
import { BERDAN_DEFS } from './planets/berdan.js';
import { NIFLHEIM_DEFS } from './planets/niflheim.js';
import { ARKE_DEFS } from './planets/arke.js';

/** 파쇄차 — 돌격형: slow straight rush, sprays 4 fragments on wall impact. */
export const CHARGER: EnemyDef = {
  id: 'kargon-charger',
  role: 'charger',
  typeIndex: 0,
  radius: 36,
  hp: 34,
  contactDamage: 12,
  speed: 300,
  movement: 'chargeStraight',
  attack: { kind: 'fragments', count: 4, speed: 520, damage: 6, bulletRadius: 6, bulletLife: 70 },
  fireCooldown: 40,
  xpValue: 3,
};

/** 박격포 — 사수형: keeps range, telegraphs an impact zone then bursts. */
export const GUNNER: EnemyDef = {
  id: 'kargon-gunner',
  role: 'gunner',
  typeIndex: 1,
  radius: 32,
  hp: 26,
  contactDamage: 8,
  speed: 180,
  movement: 'standoff',
  attack: { kind: 'mortar', windup: 48, radius: 140, damage: 16 },
  fireCooldown: 130,
  xpValue: 4,
};

/** 용암샘 — 특수형: rooted, periodically raises a line of lava pillars. */
export const LAVA_SPRING: EnemyDef = {
  id: 'kargon-lava-spring',
  role: 'special',
  typeIndex: 2,
  radius: 44,
  hp: 60,
  contactDamage: 10,
  speed: 0,
  movement: 'stationary',
  attack: { kind: 'lava', windup: 54, activeTicks: 90, pillars: 6, radius: 92, damage: 8 },
  fireCooldown: 200,
  xpValue: 8,
};

/** 수리드론 — 지원형: drifts to wounded allies and heals them (priority kill). */
export const REPAIR_DRONE: EnemyDef = {
  id: 'kargon-repair-drone',
  role: 'support',
  typeIndex: 3,
  radius: 30,
  hp: 30,
  contactDamage: 6,
  speed: 260,
  movement: 'seekWounded',
  attack: { kind: 'heal', range: 220, healPerTick: 3 },
  fireCooldown: 12,
  xpValue: 5,
};

/** Hazard subtype re-export so the world hazard resolver can tag lava damage. */
export { HAZARD_LAVA };

/** All M1 enemies, indexed by role for wave spawning. */
export const KARGON_ROSTER = {
  charger: CHARGER,
  gunner: GUNNER,
  special: LAVA_SPRING,
  support: REPAIR_DRONE,
} as const;

/**
 * Lookup by stable typeIndex (used when reconstructing behaviour from state).
 * 카르곤 0~3 → 베르단 4~9 → 니플헤임 10~15 → 아르케 16~21 순으로 append — typeIndex는
 * 전역 고유하며 entity.enemyType이 이 배열의 인덱스이므로 절대 재정렬/재번호 금지
 * (해시 불변).
 */
export const ENEMY_BY_TYPE: readonly EnemyDef[] = [
  CHARGER,
  GUNNER,
  LAVA_SPRING,
  REPAIR_DRONE,
  ...BERDAN_DEFS,
  ...NIFLHEIM_DEFS,
  ...ARKE_DEFS,
];
