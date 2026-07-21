/**
 * Level-up powerup pool (M3 Phase C2 — plan §4, AC9).
 *
 * 24 powerups: the original M1 eight (indices 0..7, NEVER reordered — the index
 * is the wire value packed into the pick input frame) plus 16 M3 additions
 * (8..23) covering every main-weapon archetype and each skill tree. Each entry
 * carries a build TAG (weaponType / affinity / universal); `drawPowerupChoices`
 * soft-weights the offer by the run's loadout + skill investment (OQ-M3-1
 * default): universal powerups are always viable candidates, build-matched ones
 * are weighted up, and off-build ones stay possible but rare — so the offer feels
 * derived from the player's build without ever hard-excluding a choice.
 *
 * Each `apply` is a pure state mutation (weapon/config/player/magnet only) — no
 * RNG, no wall-clock — so a recorded [seed + input log] reproduces the same build
 * deterministically. The weighting reads only run-start config (loadout weapon
 * type + skill vector), which is fixed for the whole run, so the draw stream stays
 * deterministic too.
 */

import type { WorldState } from './world.js';
import type { Entity } from './entities.js';
import { shipTypeDef, shipTreeRange } from '../../data/ships/index.js';
import type { TreeAffinity } from '../../data/ships/index.js';

export interface PowerupDef {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  /**
   * Build tag (drives the soft weighting). Exactly one of the three is set.
   * `affinity` 는 트리 **이름**이 아니라 **역할 축**이다(M8) — 신규 기체 타입은 트리 이름이
   * 달라도 같은 역할이면 같은 가중을 받는다. 스트라이커에 대해서는 레거시와 바이트 동일.
   */
  readonly weaponType?: number;
  readonly affinity?: TreeAffinity;
  readonly universal?: boolean;
  /** Applies the effect to the world (deterministic, no RNG). */
  readonly apply: (state: WorldState) => void;
}

function player(state: WorldState): Entity | undefined {
  return state.entities[0];
}

/**
 * The pool. Index is stable and used as the wire value for the pick input, so
 * never reorder existing entries — new powerups are APPENDED (indices 8+).
 */
export const POWERUPS: readonly PowerupDef[] = [
  // --- 0..7: original M1 eight (indices frozen — replay wire values) ---
  {
    id: 'rapid-fire',
    name: '고속 연사',
    desc: '발칸 발사 간격 -18%',
    weaponType: 0,
    apply: (s) => {
      s.weapon.fireCooldown = Math.max(2, Math.round(s.weapon.fireCooldown * 0.82));
    },
  },
  {
    id: 'twin-shot',
    name: '증설 포신',
    desc: '탄환 +1 (부채꼴 확산)',
    universal: true,
    apply: (s) => {
      s.weapon.bulletCount += 1;
      s.weapon.spread = Math.min(1.2, s.weapon.spread + 0.06);
    },
  },
  {
    id: 'heavy-rounds',
    name: '고폭탄',
    desc: '탄환 데미지 +35%',
    universal: true,
    apply: (s) => {
      s.weapon.damage = Math.round(s.weapon.damage * 1.35 * 100) / 100;
    },
  },
  {
    id: 'piercing-rounds',
    name: '관통탄',
    desc: '관통 +1 (적을 뚫고 지나감)',
    universal: true,
    apply: (s) => {
      s.weapon.pierce += 1;
    },
  },
  {
    id: 'thrusters',
    name: '추진기 증강',
    desc: '이동 속도 +12%',
    affinity: 'utility',
    apply: (s) => {
      s.config.playerSpeed = Math.round(s.config.playerSpeed * 1.12);
    },
  },
  {
    id: 'dash-coils',
    name: '대시 코일',
    desc: '대시 재충전 -20%',
    affinity: 'utility',
    apply: (s) => {
      s.config.dashCooldownTicks = Math.max(12, Math.round(s.config.dashCooldownTicks * 0.8));
    },
  },
  {
    id: 'reinforced-hull',
    name: '강화 장갑',
    desc: '최대 HP +25, 즉시 회복',
    affinity: 'defense',
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
    affinity: 'utility',
    apply: (s) => {
      s.magnetRadius = Math.round(s.magnetRadius * 1.4);
    },
  },
  // --- 8..15: main-weapon archetype derivatives (2 per non-vulcan type) ---
  {
    id: 'spread-pellets',
    name: '산탄 증설',
    desc: '탄환 +1, 확산 폭 증가 (스프레드)',
    weaponType: 1,
    apply: (s) => {
      s.weapon.bulletCount += 1;
      s.weapon.spread = Math.min(1.4, s.weapon.spread + 0.08);
    },
  },
  {
    id: 'spread-choke',
    name: '초크 개조',
    desc: '탄환 데미지 +22% (스프레드)',
    weaponType: 1,
    apply: (s) => {
      s.weapon.damage = Math.round(s.weapon.damage * 1.22 * 100) / 100;
    },
  },
  {
    id: 'rail-penetrator',
    name: '관통 강화 코어',
    desc: '관통 +2 (레일건)',
    weaponType: 2,
    apply: (s) => {
      s.weapon.pierce += 2;
    },
  },
  {
    id: 'rail-overcharge',
    name: '과충전 코일',
    desc: '탄환 데미지 +45%, 탄속 +15% (레일건)',
    weaponType: 2,
    apply: (s) => {
      s.weapon.damage = Math.round(s.weapon.damage * 1.45 * 100) / 100;
      s.weapon.bulletSpeed = Math.round(s.weapon.bulletSpeed * 1.15 * 100) / 100;
    },
  },
  {
    id: 'missile-salvo',
    name: '연장 발사관',
    desc: '미사일 +1 (유도)',
    weaponType: 3,
    apply: (s) => {
      s.weapon.bulletCount += 1;
    },
  },
  {
    id: 'missile-warhead',
    name: '고폭 탄두',
    desc: '탄환 데미지 +30% (미사일)',
    weaponType: 3,
    apply: (s) => {
      s.weapon.damage = Math.round(s.weapon.damage * 1.3 * 100) / 100;
    },
  },
  {
    id: 'beam-intensifier',
    name: '빔 증폭기',
    desc: '탄환 데미지 +28% (빔)',
    weaponType: 4,
    apply: (s) => {
      s.weapon.damage = Math.round(s.weapon.damage * 1.28 * 100) / 100;
    },
  },
  {
    id: 'beam-focuser',
    name: '집속 렌즈',
    desc: '사거리 +320 (빔 세그먼트 연장)',
    weaponType: 4,
    apply: (s) => {
      s.weapon.range += 320;
    },
  },
  // --- 16..21: skill-tree derived (2 per tree) ---
  {
    id: 'fp-focus',
    name: '화력 집중',
    desc: '탄환 데미지 +20%',
    affinity: 'offense',
    apply: (s) => {
      s.weapon.damage = Math.round(s.weapon.damage * 1.2 * 100) / 100;
    },
  },
  {
    id: 'fp-cadence',
    name: '속사 조율',
    desc: '발사 간격 -15%',
    affinity: 'offense',
    apply: (s) => {
      s.weapon.fireCooldown = Math.max(2, Math.round(s.weapon.fireCooldown * 0.85));
    },
  },
  {
    id: 'sv-plating',
    name: '보강 도금',
    desc: '최대 HP +30, 즉시 회복',
    affinity: 'defense',
    apply: (s) => {
      const p = player(s);
      if (p !== undefined) {
        p.maxHp += 30;
        p.hp = Math.min(p.maxHp, p.hp + 30);
      }
      s.config.playerHp += 30;
    },
  },
  {
    id: 'sv-evasion',
    name: '회피 부스터',
    desc: '대시 재충전 -15%',
    affinity: 'defense',
    apply: (s) => {
      s.config.dashCooldownTicks = Math.max(12, Math.round(s.config.dashCooldownTicks * 0.85));
    },
  },
  {
    id: 'mb-overdrive',
    name: '기동 오버드라이브',
    desc: '이동 속도 +10%',
    affinity: 'utility',
    apply: (s) => {
      s.config.playerSpeed = Math.round(s.config.playerSpeed * 1.1);
    },
  },
  {
    id: 'mb-collector',
    name: '수집 증폭',
    desc: '젬 흡수 반경 +30%',
    affinity: 'utility',
    apply: (s) => {
      s.magnetRadius = Math.round(s.magnetRadius * 1.3);
    },
  },
  // --- 22..23: universal ---
  {
    id: 'muzzle-velocity',
    name: '고속 사출',
    desc: '탄속 +20%',
    universal: true,
    apply: (s) => {
      s.weapon.bulletSpeed = Math.round(s.weapon.bulletSpeed * 1.2 * 100) / 100;
    },
  },
  {
    id: 'field-medkit',
    name: '야전 응급팩',
    desc: '최대 HP +15, 즉시 회복',
    universal: true,
    apply: (s) => {
      const p = player(s);
      if (p !== undefined) {
        p.maxHp += 15;
        p.hp = Math.min(p.maxHp, p.hp + 15);
      }
      s.config.playerHp += 15;
    },
  },
];

// --- Soft-weighting tuning (integer weights → deterministic weighted draw) -----
const WEIGHT_UNIVERSAL = 10;
const WEIGHT_WEAPON_MATCH = 28;
const WEIGHT_WEAPON_OFFBUILD = 2;
const WEIGHT_TREE_BASE = 4;
/** Points invested in a tree per +1 weight (fully-fed tree ≈ +20 weight). */
const TREE_POINTS_PER_WEIGHT = 4;

/**
 * 이 런의 기체 타입에서 `affinity` 역할을 맡은 트리에 투자된 총 포인트.
 *
 * ⚠️ **레거시 등가 증명(M8, 설계서 §2).** 예전 구현은 `SKILL_TREES.indexOf(tree) * NODES_PER_TREE`
 * 로 슬라이스를 잡았다. 스트라이커(`shipType` 미지정 = 0)의 `trees` 는 `SKILL_TREES` 순서를 그대로
 * 가지고(`data/ships/striker.ts`), affinity 매핑(firepower→offense·survival→defense·mobility→utility)이
 * 1:1 이며 `nodesPerTree === NODES_PER_TREE` 다. 따라서 `findIndex(affinity)` 는 `indexOf(tree)` 와
 * **같은 인덱스**를, `shipTreeRange` 는 **같은 구간**을 준다 → 가중값이 바이트 동일하고
 * `powerupRng` 소비 순서도 갈리지 않는다(tests/weapons.test.ts 가 못 박는다).
 *
 * 신규 타입은 트리 이름이 달라도 affinity 로 매칭되므로 빌드 친화 가중을 자동으로 얻는다.
 */
function investedInAffinity(state: WorldState, affinity: TreeAffinity): number {
  const invest = state.config.skillInvest;
  if (invest === undefined) return 0;
  const def = shipTypeDef(state.config.shipType ?? 0);
  const t = def.trees.findIndex((tr) => tr.affinity === affinity);
  if (t < 0) return 0;
  const { start, end } = shipTreeRange(def, t);
  let sum = 0;
  for (let i = start; i < end; i++) sum += invest[i] ?? 0;
  return sum;
}

/** Soft weight of a powerup given the run's build (always ≥ 1). */
function powerupWeight(def: PowerupDef, state: WorldState): number {
  if (def.universal) return WEIGHT_UNIVERSAL;
  if (def.weaponType !== undefined) {
    return def.weaponType === state.weapon.weaponType
      ? WEIGHT_WEAPON_MATCH
      : WEIGHT_WEAPON_OFFBUILD;
  }
  if (def.affinity !== undefined) {
    const invested = investedInAffinity(state, def.affinity);
    return WEIGHT_TREE_BASE + Math.floor(invested / TREE_POINTS_PER_WEIGHT);
  }
  return 1;
}

/**
 * Draw `count` distinct powerup indices, soft-weighted by the run's build. The
 * powerup RNG stream drives a weighted pick without replacement — deterministic:
 * same seed, level history and (fixed) build yield the same offer. Weights are
 * integers so the draw uses only `int` (no float threshold), keeping the stream
 * bit-identical across platforms.
 */
export function drawPowerupChoices(state: WorldState, count: number): number[] {
  const pool: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < POWERUPS.length; i++) {
    const def = POWERUPS[i];
    if (def === undefined) continue;
    pool.push(i);
    weights.push(powerupWeight(def, state));
  }
  const chosen: number[] = [];
  const n = Math.min(count, pool.length);
  for (let k = 0; k < n; k++) {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) break;
    let r = state.powerupRng.int(0, total - 1);
    let pick = 0;
    for (let j = 0; j < pool.length; j++) {
      r -= weights[j] as number;
      if (r < 0) {
        pick = j;
        break;
      }
    }
    const idx = pool[pick];
    if (idx !== undefined) chosen.push(idx);
    pool.splice(pick, 1);
    weights.splice(pick, 1);
  }
  return chosen;
}

/** Apply a powerup by its pool index (no-op if out of range). */
export function applyPowerup(state: WorldState, index: number): void {
  const def = POWERUPS[index];
  if (def !== undefined) def.apply(state);
}
