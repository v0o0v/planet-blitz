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
import { computeSkillStats, shipCapstoneActive } from './skills.js';
import { normalizeLineageBonus } from '../../data/guardian.js';
import { DEFAULT_SHIP_TYPE, shipTypeDef } from '../../data/ships/index.js';
import type { ShipBaseBp, TreeAffinity } from '../../data/ships/index.js';
import { CAP_FIREPOWER_LASER, CAP_SURVIVAL_CRIT, CAP_MOBILITY_DASH } from '../sim/capstones.js';
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

/** Sub-weapon types (GDD §5 "보조무기 5종"; shared numeric codes with the sim's
 *  independent subWeapon fire cycle in src/sim/world.ts). */
export const SUB_SIDEKICK = 0; // 빠른 연사 단발
export const SUB_SCATTER = 1; // 3발 광각 산탄
export const SUB_MINE = 2; // 설치형 지속 피해 장판
export const SUB_SENTRY = 3; // 임시 자동 포탑 배치
export const SUB_FLARE = 4; // 유도 미사일
/** Number of sub-weapon variants (0..N-1) — mirrors roll.ts SUB_WEAPON_VARIANTS. */
export const SUB_WEAPON_VARIANTS = 5;

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
 * 계보 기체 가지 보너스(basis-point, [0,5000])를 로드아웃에 적용한다(ADR-0007 "내 현역
 * 기체 소폭 강화"). 수호 가지의 resolveGuardianStats 와 대칭인 3축 — 데미지 ×(1+b),
 * 발사 간격 ÷(1+b)(=연사↑), 최대 HP +기준 100 대비 b%(maxHpPct 어픽스와 같은 방식의
 * flat 가산). 나머지 축(이속·탄속·자석 등)은 건드리지 않는다(소폭 강화 원칙 + 판정
 * 기하 불변 철학, data/guardian.ts 참조). 보너스는 config 의 loadout 블록으로 리플레이
 * 헤더에 스냅샷되므로 장비 어픽스와 동일하게 결정론·서버 재실행 검증과 호환된다.
 */
function applyShipLineageBonus(lo: LoadoutConfig, bonusBp: number): void {
  const b = normalizeLineageBonus(bonusBp);
  if (b === 0) return;
  lo.damageMult *= (10000 + b) / 10000;
  lo.fireRateMult *= 10000 / (10000 + b);
  lo.maxHpAdd += Math.round((BASE_HP_REF * b) / 10000);
}

/**
 * 기체 타입 기본 보정(baseBp)의 안전 범위. 하한은 `10000 + bp` 가 0 이하가 되어 발사 간격
 * 배율이 0 나눗셈/부호 반전이 되는 것을 막는다(손상 데이터 방어 — 정상 로스터는 ±2500 이내).
 */
const SHIP_BASE_BP_MIN = -9000;
const SHIP_BASE_BP_MAX = 20000;

function normalizeShipBaseBp(v: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const n = Math.trunc(v);
  if (n < SHIP_BASE_BP_MIN) return SHIP_BASE_BP_MIN;
  if (n > SHIP_BASE_BP_MAX) return SHIP_BASE_BP_MAX;
  return n;
}

/**
 * 기체 타입(ADR-0019)의 기본 스탯 보정을 로드아웃에 적용한다(M8 설계 §4).
 *
 * 문법은 {@link applyShipLineageBonus} 와 **완전히 같다** — 이미 검증된 결정론 경로이기
 * 때문이다: 정수 basis-point 를 **단일 나눗셈**으로 한 번만 적용하고, 축마다 `0` 이면
 * 아무 연산도 하지 않는다. 스트라이커는 4축 전부 0 이라 이 함수 전체가 자동 무연산이 되고,
 * 그 결과 기존 런의 `LoadoutConfig` 가 **바이트 불변**이다(설계 §5 다섯 겹 방어 ②).
 *
 * 축 의미: damage 는 배율 ↑, fireRate 는 **양수 = 연사 ↑ = 발사 간격 ↓**(계보와 동일한
 * `10000/(10000+b)`), maxHp 는 기준 HP 100 대비 flat 가산, moveSpeed 는 배율 ↑.
 */
function applyShipTypeBase(lo: LoadoutConfig, baseBp: ShipBaseBp): void {
  const d = normalizeShipBaseBp(baseBp.damageBp);
  if (d !== 0) lo.damageMult *= (10000 + d) / 10000;
  const f = normalizeShipBaseBp(baseBp.fireRateBp);
  if (f !== 0) lo.fireRateMult *= 10000 / (10000 + f);
  const h = normalizeShipBaseBp(baseBp.maxHpBp);
  if (h !== 0) lo.maxHpAdd += Math.round((BASE_HP_REF * h) / 10000);
  const m = normalizeShipBaseBp(baseBp.moveSpeedBp);
  if (m !== 0) lo.moveSpeedMult *= (10000 + m) / 10000;
}

/**
 * 계열 affinity → 그 계열 캡스톤이 켜는 `uniqueMask` 비트. 캡스톤 효과는 sim 이 비트로
 * 게이트하므로(`src/sim/capstones.ts`), 신규 타입도 **역할이 같은** 계열이 같은 효과를
 * 얻는다. 스트라이커 매핑(firepower→offense·survival→defense·mobility→utility)이 1:1 이라
 * 타입 0 의 마스크는 비트값·OR 순서까지 기존과 동일하다.
 */
const CAPSTONE_BIT_BY_AFFINITY: Readonly<Record<TreeAffinity, number>> = {
  offense: CAP_FIREPOWER_LASER,
  defense: CAP_SURVIVAL_CRIT,
  utility: CAP_MOBILITY_DASH,
};

/**
 * Fold the equipped items (and optional skill investment) into a derived stat
 * block + meta mods. Order of the items does not matter (all contributions are
 * summed). When `invest` is supplied, the skill-derived stats stack on top of
 * the gear pass (multiplicatively across the two sources — standard ARPG stack),
 * so a deep build strengthens the run through the same block gear does. Absent /
 * empty `invest` reproduces the M2 gear-only result exactly (backward compat).
 * `shipBonusBp`(계보 기체 가지, data/lineage.ts shipBonusBp)가 주어지면 마지막에
 * {@link applyShipLineageBonus} 로 겹친다 — 미지정/0 은 기존 결과와 완전 동일.
 *
 * `typeId`(ADR-0019 기체 타입, M8)는 **optional 이며 미지정 = 0(스트라이커)** 이다. 타입 0 은
 * 시그니처 비트가 없고(-1) baseBp 가 전 축 0 이며 트리 슬라이스가 기존과 동일하므로,
 * `computeLoadoutStats(eq, inv, bp)` 와 `computeLoadoutStats(eq, inv, bp, 0)` 는 물론
 * M8 이전 구현과도 결과가 **완전히 동일**하다(설계 §5 — 스트라이커 불변의 핵심 관문,
 * tests/skills.test.ts 가 명시적으로 못 박는다). 범위 밖 typeId 는 손상 세이브로 보고
 * 스트라이커로 되돌린다(`shipTypeDef` 가 정규화).
 */
export function computeLoadoutStats(
  equipped: readonly Item[],
  invest?: readonly number[],
  shipBonusBp?: number,
  typeId: number = DEFAULT_SHIP_TYPE,
): ComputedLoadout {
  const lo = neutralLoadout();
  const shipType = shipTypeDef(typeId);

  // Weapon / sub-weapon type from the equipped main/sub items.
  const main = equipped.find((it) => it.slot === 'main');
  const sub = equipped.find((it) => it.slot === 'sub');
  lo.weaponType = main?.weaponType ?? WEAPON_VULCAN;
  lo.subWeaponType = sub?.weaponType ?? SUB_WEAPON_NONE;
  applyWeaponTypeBase(lo, lo.weaponType);
  // 기체 타입 섀시 보정(M8): 무기 타입 baseline 과 같은 결의 "출발점" 이므로 여기서 겹친다.
  // 스트라이커(전 축 0)는 무연산 → 기존 결과 바이트 불변.
  applyShipTypeBase(lo, shipType.baseBp);

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
  if (invest !== undefined) applyStatSums(lo, computeSkillStats(invest, shipType.id));
  // 스킬트리 최상위 질적 캡스톤(GDD §4): 게이트(계열 base 40pt) + 캡스톤 1pt 가 찍힌 계열의
  // 효과 비트를 uniqueMask 상위 비트(15~17)에 OR 한다. 신규 필드/해시 폴드 없이 sim이
  // hasCapstone 으로 게이트한다(캡스톤 미보유 런은 uniqueMask 불변 → 기존 해시 완전 불변).
  // M8: 계열은 타입별이므로 트리 인덱스로 순회하고, 비트는 affinity 로 고른다. 스트라이커는
  // 트리 순서·affinity 매핑이 1:1 이라 OR 되는 비트도 순서도 M7 이전과 동일하다.
  if (invest !== undefined) {
    for (let ti = 0; ti < shipType.trees.length; ti++) {
      const tree = shipType.trees[ti];
      if (tree === undefined) continue;
      if (shipCapstoneActive(invest, shipType, ti)) {
        uniqueMask |= 1 << CAPSTONE_BIT_BY_AFFINITY[tree.affinity];
      }
    }
  }
  // 기체 시그니처 패시브(M8 설계 §4): 타입이 가진 미사용 상위 비트(18~21)를 OR 한다.
  // **스트라이커는 signatureBit = -1 이라 무연산** → 기존 런의 uniqueMask 가 바이트 불변.
  const sig = shipType.signatureBit;
  if (sig >= 0) uniqueMask |= 1 << sig;
  lo.uniqueMask = uniqueMask;
  // M3 원소 어픽스(상태이상): 정수 강도 합산을 그대로 실어 sim이 명중 시 소비한다.
  lo.fireDmg += sums.fireDmg;
  lo.coldSlow += sums.coldSlow;
  lo.lightning += sums.lightning;
  // 계보 기체 가지(M5, ADR-0007): 장비·스킬 위에 마지막으로 겹치는 계정 단위 배율.
  if (shipBonusBp !== undefined) applyShipLineageBonus(lo, shipBonusBp);

  const worldMods: WorldMods = {
    mineralFindMult: 1 + sums.mineralFindPct / 100,
  };
  return { loadout: lo, worldMods };
}
