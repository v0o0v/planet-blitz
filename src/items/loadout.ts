/**
 * Loadout → derived-stats pipeline (M2 Phase A4 — plan §4, AC4).
 *
 * `computeLoadoutStats(equipped)` folds the affixes of the (up to eight) equipped
 * items into a `LoadoutConfig` — a flat block of deterministic multipliers/adds
 * the sim applies once at run start (createWorld) and folds into the state hash
 * (plan §2 ②A). Purely-meta modifiers that never touch the sim (mineral find
 * rate) come back separately in `worldMods` for the settlement layer (Lane 2).
 *
 * Pure function, no RNG, no sim runtime import (types only) — so building the
 * run config is reproducible and the sim stays free of item structs.
 */

import type { Item, StatKey } from './types.js';
import type { LoadoutConfig } from '../sim/world.js';
import { UNIQUE_REGISTRY } from './uniques.js';
import { computeSkillStats } from './skills.js';
// side-effect: M2 유니크 5점을 레지스트리에 등록(장착 유니크의 bit → uniqueMask).
import '../../data/uniques.js';

/** Main-weapon types (shared numeric codes with the sim's autoAttack branch). */
export const WEAPON_VULCAN = 0;
export const WEAPON_SPREAD = 1;
export const WEAPON_RAILGUN = 2;
export const WEAPON_MISSILE = 3;
export const WEAPON_BEAM = 4;

/** No sub-weapon equipped. */
export const SUB_WEAPON_NONE = -1;

/** Reference base HP the maxHpPct affix scales against (matches DEFAULT_CONFIG). */
const BASE_HP_REF = 100;

/** Meta-only modifiers — consumed at settlement (Lane 2), never by the sim. */
export interface WorldMods {
  /** Multiplier on rare+ salvage mineral yield / find rate. */
  mineralFindMult: number;
}

export interface ComputedLoadout {
  /** Sim-facing derived block (goes into WorldConfig.loadout). */
  loadout: LoadoutConfig;
  worldMods: WorldMods;
}

/** Neutral loadout — no items equipped (identity multipliers). */
export function neutralLoadout(): LoadoutConfig {
  return {
    weaponType: WEAPON_VULCAN,
    subWeaponType: SUB_WEAPON_NONE,
    damageMult: 1,
    fireRateMult: 1,
    bulletCountAdd: 0,
    pierceAdd: 0,
    bulletSpeedMult: 1,
    spreadAdd: 0,
    rangeAdd: 0,
    moveSpeedMult: 1,
    maxHpAdd: 0,
    dashCdMult: 1,
    magnetMult: 1,
    xpMult: 1,
    uniqueMask: 0,
    fireDmg: 0,
    coldSlow: 0,
    lightning: 0,
  };
}

/** Per-weapon-type baseline, applied before affixes so each type feels distinct
 *  (plan B2). Vulcan is the neutral reference; spread trades damage for a wide
 *  pellet count; railgun trades cadence for a fast, hard, deeply-piercing shot. */
function applyWeaponTypeBase(lo: LoadoutConfig, weaponType: number): void {
  if (weaponType === WEAPON_SPREAD) {
    lo.bulletCountAdd += 2;
    lo.spreadAdd += 0.5;
    lo.damageMult *= 0.7;
    lo.fireRateMult *= 1.15;
    lo.bulletSpeedMult *= 0.9;
  } else if (weaponType === WEAPON_RAILGUN) {
    lo.pierceAdd += 3;
    lo.bulletSpeedMult *= 1.6;
    lo.fireRateMult *= 2.0;
    lo.damageMult *= 2.4;
  } else if (weaponType === WEAPON_MISSILE) {
    // 미사일: 느린 연사 · 강한 단발 · 유도(제한 선회, autoAttack에서 처리). 탄속은
    // 낮춰 선회가 눈에 보이게 한다(OQ-M3-4 제한 선회).
    lo.damageMult *= 2.2;
    lo.fireRateMult *= 2.6;
    lo.bulletSpeedMult *= 0.7;
  } else if (weaponType === WEAPON_BEAM) {
    // 빔: 빠른 연사 · 짧은 수명 세그먼트 판정(OQ-M3-3). 세그먼트 하나당 피해는 작고
    // 사거리 라인을 촘촘히 덮는다. 넓은 사거리 기본 부여.
    lo.damageMult *= 0.42;
    lo.fireRateMult *= 0.6;
    lo.rangeAdd += 300;
  }
}

/**
 * Fold a per-`StatKey` integer/float sum into a loadout block (shared by the
 * gear-affix pass and the skill-derived pass). Percent stats become
 * multipliers, flat stats become adds. `mineralFindPct` is deliberately ignored
 * here — it is meta-only and handled by the caller for `worldMods`.
 */
function applyStatSums(lo: LoadoutConfig, sums: Record<StatKey, number>): void {
  lo.damageMult *= 1 + sums.damagePct / 100;
  lo.fireRateMult *= 1 - sums.fireRatePct / 100; // higher % = shorter cooldown
  lo.bulletCountAdd += sums.bulletCount;
  lo.pierceAdd += sums.pierce;
  lo.bulletSpeedMult *= 1 + sums.bulletSpeedPct / 100;
  lo.rangeAdd += sums.rangeFlat;
  lo.moveSpeedMult *= 1 + sums.moveSpeedPct / 100;
  lo.maxHpAdd += sums.maxHpFlat + Math.round((BASE_HP_REF * sums.maxHpPct) / 100);
  lo.dashCdMult *= 1 - sums.dashCdPct / 100;
  lo.magnetMult *= 1 + sums.magnetPct / 100;
  lo.xpMult *= 1 + sums.xpPct / 100;
}

/** Accumulate one affix's contribution into per-stat integer sums. */
function addStat(sums: Record<StatKey, number>, stat: StatKey, value: number): void {
  sums[stat] += value;
}

function zeroSums(): Record<StatKey, number> {
  return {
    damagePct: 0,
    fireRatePct: 0,
    bulletCount: 0,
    pierce: 0,
    bulletSpeedPct: 0,
    rangeFlat: 0,
    moveSpeedPct: 0,
    maxHpFlat: 0,
    maxHpPct: 0,
    dashCdPct: 0,
    magnetPct: 0,
    xpPct: 0,
    mineralFindPct: 0,
    fireDmg: 0,
    coldSlow: 0,
    lightning: 0,
  };
}

/**
 * Fold the equipped items (and optional skill investment) into a derived stat
 * block + meta mods. Order of the items does not matter (all contributions are
 * summed). When `invest` is supplied, the skill-derived stats stack on top of
 * the gear pass (multiplicatively across the two sources — standard ARPG stack),
 * so a deep build strengthens the run through the same block gear does. Absent /
 * empty `invest` reproduces the M2 gear-only result exactly (backward compat).
 */
export function computeLoadoutStats(
  equipped: readonly Item[],
  invest?: readonly number[],
): ComputedLoadout {
  const lo = neutralLoadout();

  // Weapon / sub-weapon type from the equipped main/sub items.
  const main = equipped.find((it) => it.slot === 'main');
  const sub = equipped.find((it) => it.slot === 'sub');
  lo.weaponType = main?.weaponType ?? WEAPON_VULCAN;
  lo.subWeaponType = sub?.weaponType ?? SUB_WEAPON_NONE;
  applyWeaponTypeBase(lo, lo.weaponType);

  // Sum every equipped item's affixes, then OR in unique bits.
  const sums = zeroSums();
  let uniqueMask = 0;
  for (const it of equipped) {
    for (const a of it.affixes) addStat(sums, a.stat, a.value);
    if (it.uniqueId !== undefined) {
      const def = UNIQUE_REGISTRY.get(it.uniqueId);
      if (def !== undefined) uniqueMask |= 1 << def.bit;
    }
  }

  // Gear pass: convert integer percent/flat affix sums into multipliers/adds.
  applyStatSums(lo, sums);
  // Skill pass: fold skill-derived stats on top (synergy applied in skills.ts).
  if (invest !== undefined) applyStatSums(lo, computeSkillStats(invest));
  lo.uniqueMask = uniqueMask;
  // M3 원소 어픽스(상태이상): 정수 강도 합산을 그대로 실어 sim이 명중 시 소비한다.
  lo.fireDmg += sums.fireDmg;
  lo.coldSlow += sums.coldSlow;
  lo.lightning += sums.lightning;

  const worldMods: WorldMods = {
    mineralFindMult: 1 + sums.mineralFindPct / 100,
  };
  return { loadout: lo, worldMods };
}
