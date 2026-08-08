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
import { SKILL_AFFIX_LV_MAX as SKILL_AFFIX_LV_MAX_CANON } from './types.js';
import type { LoadoutConfig } from '../sim/world.js';
import { UNIQUE_REGISTRY } from './uniques.js';
import { normalizeLineageBonus } from '../../data/guardian.js';
import { DEFAULT_SHIP_TYPE, shipTypeDef, TREE_AFFINITIES } from '../../data/ships/index.js';
import type { ShipBaseBp, TreeAffinity } from '../../data/ships/index.js';
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

/**
 * Reference base HP the maxHpPct affix scales against (matches DEFAULT_CONFIG).
 *
 * ⚠️ 100 → 120 → 126 → 151 (2026-08-08 기체 기본 스탯 상향 — `world.ts` `DEFAULT_WEAPON` 위 주석이 정본).
 * `DEFAULT_CONFIG.playerHp` 와 **같아야 한다**는 것이 이 상수의 계약이고, 어긋나면 maxHpPct
 * 어픽스가 낡은 기준으로 계산되며 그 어긋남은 화면에 아무 흔적을 남기지 않는다.
 */
const BASE_HP_REF = 151;

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

/**
 * 빔 아키타입의 기준 사거리 보정(음수). 빔의 `range` 는 조준 상한이자 **타격선 길이**라
 * 다른 아키타입과 성질이 다르다 — 세그먼트를 `BEAM_MAX_SEGMENTS`(16) × 간격(90) = 1440
 * 까지만 깔 수 있어 그 위의 사거리는 빔에게 아무 의미가 없다. 그래서 공용 기준값
 * (`BASE_WEAPON_RANGE` 1650)에서 출발시키면 **처음부터 상한에 붙어** 사거리 투자와
 * 집속 렌즈가 전부 무효가 된다. 1650 - 850 = 800 에서 출발시켜 상한까지 640 의 투자
 * 여지를 남긴다(세그먼트 8개 → 최대 16개).
 *
 * ⚠️ 이 파일은 sim 런타임을 값으로 import 하지 않는 규율이라(파일 머리말) 1400 을 직접
 * 참조하지 않는다. 두 상수가 조용히 갈라지지 않도록 `tests/weaponRange.test.ts` 가
 * "빔 기준 사거리 === 800" 을 못 박는다.
 */
const BEAM_RANGE_DELTA = -850;

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
    // 사거리 라인을 촘촘히 덮는다.
    lo.damageMult *= 0.42;
    lo.fireRateMult *= 0.6;
    lo.rangeAdd += BEAM_RANGE_DELTA;
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
  // `skillLvOffense`/`Defense`/`Utility`(ADR-0049 스킬 어픽스)는 **여기서 접지 않는다** —
  // 이 함수는 `LoadoutConfig` 배율/가산 전용이고, 그 3키는 `WorldConfig.skillAffixLv`
  // (이중 벡터)로 따로 소비된다(`deriveSkillAffixLv`, `skillLv()` 경로 — affixes.md ①-4/①-5).
  // 이 함수는 switch 가 아니라 직선 나열이라 fallthrough 위험은 없지만, 이 주석이 없으면
  // "이 3키를 왜 여기서 안 접지"가 다음 결함 후보가 된다(⑥-1 항목 6).
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
    // ADR-0049 스킬 어픽스 3종. 이 누산기(`addStat` 의 실제 대상)에도 반드시 있어야 한다 —
    // 1판에서 빠졌던 자리(affixes.md ⑥-1 항목 5) — 없으면 `deriveSkillAffixLv` 가 읽는
    // `sums[stat]` 이 `undefined` 로 흘러 파생값이 `NaN` 이 된다. 값 자체는 `applyStatSums`
    // 로 접지 않고(`LoadoutConfig` 무관) `deriveSkillAffixLv` 가 별도로 읽는다.
    skillLvOffense: 0,
    skillLvDefense: 0,
    skillLvUtility: 0,
  };
}

/** `skillAffixLv` 축당 상한 — 슬롯 배치가 만드는 구조적 상한(offense/defense/utility 각
 *  2슬롯 × 슬롯당 최대 +2, affixes.md ①-3). 이 상한을 넘는 손상 세이브도 잘린다. */
// 정본은 `types.ts`(leaf) — 소비 쪽(`skills.ts`)도 같은 값을 봐야 하는데 그쪽이 이 파일을
// import 하면 sim 이 로드아웃 모듈을 통째로 당긴다(순환·TDZ). 그래서 상수만 leaf 에 둔다.
const SKILL_AFFIX_LV_MAX = SKILL_AFFIX_LV_MAX_CANON;

function clampSkillAffixLv(v: number): number {
  const n = Math.trunc(v);
  if (n < 0) return 0;
  if (n > SKILL_AFFIX_LV_MAX) return SKILL_AFFIX_LV_MAX;
  return n;
}

/** 축(`TreeAffinity`) → 스킬 어픽스 `StatKey`. `Record` 전량이라 `TreeAffinity` 에 축이
 *  느는 순간 이 매핑도 `tsc` 가 강제로 갱신시킨다(축 수 하드코딩 회피, ⑥-1 항목 5 보완). */
const AXIS_SKILL_AFFIX_STAT: Readonly<Record<TreeAffinity, StatKey>> = {
  offense: 'skillLvOffense',
  defense: 'skillLvDefense',
  utility: 'skillLvUtility',
};

/**
 * 장착 장비의 축 어픽스(`skillLvOffense`/`Defense`/`Utility`)를 축별 정수로 접는다
 * (ADR-0049, affixes.md ①-5). **`skillInvest` 와 완전히 분리된 이중 벡터**의 파생 함수다 —
 * 이 결과를 투자 벡터에 더하지 마라, 그러면 "포인트 0인데 해금"(E7) 결함이 어픽스 경로로
 * 되살아난다. `computeLoadoutStats` 와 나란히 두되 `LoadoutConfig` 는 건드리지 않는다(별도
 * 파생 — `applyStatSums` 주석 참조).
 *
 * **`zeroSums`/`addStat` 를 그대로 재사용한다** — 어픽스 합산의 실제 누산기가 그 둘이고
 * (⑥-1 항목 5), 여기서 독립적으로 다시 세면 두 합산 경로가 갈릴 여지가 생긴다. 그 대신
 * `zeroSums()` 가 신규 3키를 빠뜨리면 `sums[stat]` 이 `undefined` 로 흘러 `clampSkillAffixLv`
 * 가 `NaN` 을 내므로(트렁케이트·비교 전부 실패), 이 함수는 그 누락을 조용히 삼키지 않는다.
 *
 * ⚠️ **호출부는 `computeLoadoutStats` 에 넘긴 바로 그(제약 필터를 통과한) 배열을 넘겨야
 * 한다** — 원본 `ship.equipped` 에서 따로 파생하면 의뢰 장비축 금지가 우회된다(affixes.md
 * ⑤-2c). `buildRunConfig`(`src/run/runConfig.ts`) 가 그 배열을 그대로 재사용한다.
 *
 * 길이는 `TREE_AFFINITIES.length`(현재 3) — 축 수 3 을 하드코딩하지 않는다. 각 축은
 * `[0, {@link SKILL_AFFIX_LV_MAX}]` 로 클램프한다(구조적 상한 보완 방어).
 */
export function deriveSkillAffixLv(equipped: readonly Item[]): number[] {
  const sums = zeroSums();
  for (const it of equipped) {
    for (const a of it.affixes) addStat(sums, a.stat, a.value);
  }
  return TREE_AFFINITIES.map((affinity) => clampSkillAffixLv(sums[AXIS_SKILL_AFFIX_STAT[affinity]]));
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
 * **조종사 레벨 성장 배율의 단계당… 이 아니라 레벨당 공비.** §R51 「장비 축 포화」의 해답.
 *
 * ## 무엇이 신고됐나 — 레벨을 올려도 세지지 않는다
 * 조사(2026-08-08) 실측: **Lv5 → Lv100 실효 전투력이 ×1.00** 이었다. 같은 기간 잡몹 HP 배율은
 * **×1 → ×80.8**(`data/waves.ts` `stageHpMult`, 앵커 1/16/88). 그래서 「Lv100 조종사가 Lv50
 * 조종사보다 약할 확률」이 **52.8%** — 사실상 동전 던지기였다.
 *
 * 원인은 셋이고 **전부 장비 축이 레벨을 안 본다는 한 가지 형태**다:
 *  · `roll.ts` — 어픽스 롤 값이 아이템 레벨·단계와 무관(ADR-0037 **불가침**이라 안 건드린다)
 *  · `world.ts` — `playerHp = 151 + maxHpAdd` 에 레벨 항이 없다
 *  · 스킬 99점의 화력 기여가 +1.4%
 *
 * ## ⚠️ 왜 기체별 `baseBp` 성장이 아니라 **전 기체 공통 배율**인가
 * 문자 그대로의 "`baseBp` 를 레벨로 키운다"는 **작동하지 않는다** — 스트라이커는 `baseBp` 4축이
 * 전부 0 이고(`data/ships/striker.ts`) `tests/skills.test.ts` 가 그것을 계약으로 못박고 있다.
 * 0 에 무엇을 곱해도 0 이다. 그리고 축마다 다른 성장을 주면 **로스터 밴드가 움직인다** —
 * 명목표 SPREAD 는 1.323 이고 상한이 1.35 라 여유가 2% 뿐이다. 전 기체 공통 배율이면
 * `powerSpread`(최대/최소 비)와 `relativeToStriker` 가 **정확히 불변**이다.
 *
 * ## 공비를 어떻게 골랐나 (`bench/gearLevelCurve.ts`, 시드 24 · 표준 빌드)
 * 후보를 떠서 골랐다. 합격선은 「Lv100 < Lv50」 확률의 **한 자릿수 %**.
 *
 * | q(레벨당) | 단계당 | Lv5→100 배수 | 「Lv100<Lv50」 power | 〃 dps | 단계20 보스 TTK |
 * |---|---|---|---|---|---|
 * | 1.0000(현행) | 1.0000 | ×1.00 | **57.8%** | 54.3% | 65.4초 |
 * | 1.0082 | 1.0417 | ×2.17 | 18.9% | 34.4% | 29.1초 |
 * | **1.0164** | **1.0847** | **×4.69** | **2.8%** | 16.0% | **13.1초** |
 * | 1.0248 | 1.1303 | ×10.25 | 0.2% | 6.9% | 5.8초 |
 *
 * **1.0164 를 골랐다.** 합격선을 여유 있게 넘는 가장 작은 후보이고, 값에 읽을 수 있는 근거가
 * 있다: **단계당 1.0847 = √1.1761** — 즉 보스 HP 곡선(`src/sim/enemyScale.ts`
 * `BOSS_HP_GROWTH_PER_STAGE`, PR#390)의 **로그 기준 절반 기울기**다. 깊은 단계일수록 보스전이
 * 여전히 길어지되, 그 증가폭이 절반으로 줄어든다.
 *
 * ## ⚠️ 남은 것 두 가지 — 이 상수가 **혼자 해결하지 못한 축**
 *  ① **dps 단독 축은 아직 16.0%** 다(power 는 2.8%). 화력만 보면 Lv100 이 Lv50 에게 지는 일이
 *     여섯 판에 한 번 남는다. 남은 원인은 **어픽스 롤이 레벨과 무관**(위 ①-b)이고 그것은
 *     ADR-0037 불가침이라 이 레인 밖이다.
 *  ② **보스전이 짧아진다.** 위 표 마지막 열이 그 대가다 — 단계 20 보스가 65.4 → **13.1초**.
 *     PR#390 의 보스 곡선은 *"플레이어 화력이 레벨과 무관하다"* 는 (당시 참이었던) 전제 위에
 *     세워졌고, 이 상수가 그 전제를 깬다. **되돌릴 자리는 이 공비가 아니라
 *     `BOSS_HP_GROWTH_PER_STAGE` 다** — 그 값은 사용자가 직접 정한 것이라 이 레인이 안 건드렸다.
 *
 * ## ⚠️ 침공에는 **안 걸린다** — 의도적 제외다
 * `buildRunConfig` 가 침공 런(`invasion3`)·예비역 소집에는 레벨 1 을 넘긴다. 사유는
 * 그 함수의 해당 주석이 정본이다(한 줄 요약: 방어측 수호에 대응 축이 없어 **비대칭 주입**이 된다).
 *
 * ## ⚠️ 리터럴이어야 한다 — 결정론
 * `Math.pow`/`**` 는 IEEE-754 가 **정확 반올림을 요구하지 않는** 연산이라 플랫폼마다 마지막
 * 비트가 갈릴 수 있고, 이 배수는 `LoadoutConfig` 를 타고 `hashWorld` 에 접힌다. 그래서
 * `1.1761 ** (1/10)` 로 계산하지 말고 **리터럴을 정수 번 곱한다**(`enemyScale.ts`
 * `bossStageHpMult` 와 같은 규율). 곱셈은 정확 반올림이 보장돼 어디서 돌려도 비트 동일이다.
 */
const PILOT_LEVEL_GROWTH_PER_LEVEL = 1.0164;

/**
 * 반복 곱의 상한 지수. **밸런스 값이 아니라 루프 가드**다 — 손상 세이브의 `level` 이 임의로
 * 클 수 있다. 만렙은 100(`data/waves.ts` `LEVEL_CAP`)이라 200 은 도달 불가한 깊이다.
 * ⚠️ 만렙 상수를 여기서 import 하지 않는다 — 이 파일은 leaf 규율이고, 이 값은 상한이지
 * 만렙의 사본이 아니다(둘이 갈려도 거동이 안 바뀌는 것이 의도다).
 */
const PILOT_LEVEL_MAX_EXPONENT = 200;

/**
 * 조종사 레벨 → 성장 배율. **레벨 1 이 정확히 1** 이다(early-return — 곱을 한 번도 안 돌아야
 * 기존 골든의 값이 **정확히** 불변이다. `bossStageHpMult`·`stageHpMult` 와 같은 규율).
 *
 * 정수 in / 실수 out. 손상 세이브 방어: 비유한·1 미만은 1 로 떨어진다.
 */
export function pilotLevelMult(level: number): number {
  if (!Number.isFinite(level) || level <= 1) return 1;
  const n0 = Math.trunc(level) - 1;
  const n = n0 < PILOT_LEVEL_MAX_EXPONENT ? n0 : PILOT_LEVEL_MAX_EXPONENT;
  let m = 1;
  // ⚠️ 반복 곱이다(`Math.pow` 금지 — 위 §결정론).
  for (let i = 0; i < n; i++) m *= PILOT_LEVEL_GROWTH_PER_LEVEL;
  return m;
}

/**
 * 조종사 레벨 성장을 로드아웃에 얹는다 — **피해와 HP 두 축**(사용자 결정 2026-08-08).
 *
 * ## ⚠️ 왜 **맨 끝**인가 (`applyShipTypeBase` 옆이 아니라)
 * 이 함수는 `applyShipTypeBase` 의 형제로 설계됐지만 **호출 순서는 맨 끝**이다. 섀시 보정
 * 자리에서 부르면 그 시점의 `maxHpAdd` 가 0 이라 **장비·계보가 준 HP 에는 배율이 안 걸린다** —
 * 즉 HP 축만 반쪽이 된다. 맨 끝이면 `damageMult`·`maxHpAdd` 둘 다 «그 조종사의 최종 실효값»에
 * 걸려 두 축의 성장률이 정확히 같다.
 *
 * 곱셈은 교환법칙이 성립하므로 `damageMult` 는 순서와 무관하지만 `maxHpAdd` 는 가산이라
 * 순서가 값을 바꾼다. 그래서 이 주석이 필요하다.
 *
 * ## HP 를 «가산 축»에 어떻게 태우는가
 * `maxHpAdd` 는 `world.ts` 에서 `playerHp(=BASE_HP_REF) + maxHpAdd` 로 소비되는 **가산**이다.
 * 그래서 배율을 걸려면 기준 HP 까지 포함한 실효 HP 를 스케일한 뒤 그 증가분을 가산분에
 * 되돌린다: `maxHpAdd += round((BASE_HP_REF + maxHpAdd) × (m - 1))`. 반올림은 **한 번**이다.
 *
 * ⚠️ 부수 효과: 격납고·인벤토리의 «체력 +N» 표시가 이제 레벨 성장분을 포함한다(장비만의 몫이
 * 아니다). 두 화면 모두 «런과 같은 입력을 넘긴다»가 계약이라(hangar `computeStats` 주석)
 * 이쪽을 택했다 — 표시를 장비 몫으로 되돌리려면 화면이 배율을 따로 빼야 하고, 그러면 화면과
 * 런이 다시 갈린다.
 *
 * `m === 1`(레벨 1)이면 **무연산**이다 — 기존 런의 `LoadoutConfig` 가 바이트 불변이다.
 */
function applyPilotLevelScaling(lo: LoadoutConfig, level: number): void {
  const m = pilotLevelMult(level);
  if (m === 1) return;
  lo.damageMult *= m;
  lo.maxHpAdd += Math.round((BASE_HP_REF + lo.maxHpAdd) * (m - 1));
}

/**
 * 장착 장비를 파생 스탯 블록 + 메타 모드로 접는다. 아이템 순서는 무관하다(전부 합산).
 * `shipBonusBp`(계보 기체 가지, `data/lineage.ts` `shipBonusBp`)가 주어지면 마지막에
 * {@link applyShipLineageBonus} 로 겹친다 — 미지정/0 은 기존 결과와 완전 동일.
 *
 * `typeId`(ADR-0019 기체 타입)는 **optional 이며 미지정 = 0(스트라이커)** 이다. 범위 밖
 * `typeId` 는 손상 세이브로 보고 스트라이커로 되돌린다(`shipTypeDef` 가 정규화).
 *
 * ## `invest` 인자가 사라진 이유 (ADR-0049)
 * 구 버전은 `skillInvest` 를 받아 ①`computeSkillStats` 로 파생 스탯을 겹치고 ②계열 캡스톤
 * 비트를 `uniqueMask` 에 OR 했다. ADR-0049 가 **스킬을 스탯에서 메커닉으로 옮기고 캡스톤을
 * 폐기**하면서 두 소비처가 동시에 사라졌다 — 스킬 효과는 이제 사전 계산된 스탯 블록이 아니라
 * sim 안의 규칙이고, `WorldConfig.skillInvest` 를 sim 이 직접 읽는다.
 *
 * 인자를 "받되 안 쓰는" 형태로 남기지 않는다. 그러면 호출부가 계속 벡터를 넘기면서 효과가
 * 반영된다고 **오해**하게 되고, 이 리포의 반복 결함 8건이 전부 그 형태였다(단위 테스트는
 * 그린인데 배선이 통째로 없음). 인자를 지우면 갱신 안 된 호출부를 `tsc` 가 잡는다.
 *
 * 방어측 수호 기체의 대표 스탯 계승(`prerequisites.md` §0-B 결정 C)은 여기가 아니라
 * `mapLoadoutToGuardianSnapshot`(`data/guardian.ts`) **한 곳**에서 파생한다 — 같은 술어를
 * 두 곳에 적으면 화면과 규칙이 갈린다.
 */
export function computeLoadoutStats(
  equipped: readonly Item[],
  shipBonusBp?: number,
  typeId: number = DEFAULT_SHIP_TYPE,
  /**
   * 조종사 레벨(§R51). **기본값 1 = 무연산**이라 이 인자를 안 넘기는 호출부는 기존과 바이트
   * 동일하다 — 퇴역 수호 스냅샷(`retirementPayload`)이 그 경로이고, 그 불변이 침공 밴드를
   * 지킨다({@link applyPilotLevelScaling} 위 §침공).
   */
  level: number = 1,
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
  // ⚠️ 유니크는 **비트 OR** 이므로 같은 `uniqueId` 를 두 칸에 꽂으면 두 번째 사본의 효과가 통째로
  // 무효다(어픽스만 합산된다). 이 함수는 그 사실을 그대로 두고, 중복 자체를 **장착 시점에서**
  // 막는다 — `src/items/uniqueEquip.ts`(격납고 equip 게이트). 여기서 중첩 규칙을 만들면 sim 의
  // 비트 분기를 유니크 15종마다 갈라야 해서 골든 재생성·EF 재배포가 따라붙는다.
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
  // (삭제됨 — ADR-0049) 스킬 파생 스탯 겹침 · 계열 캡스톤 비트 OR. 위 함수 주석 참조.
  // 기체 시그니처 패시브(M8 설계 §4): 타입이 가진 미사용 상위 비트(18~21)를 OR 한다.
  // ⚠️ **구 주석의 "스트라이커는 -1 이라 무연산" 은 ADR-0049 로 끝났다** — 정조준 사이클(비트 24)이
  // 부여돼 7기체 전부 여기서 비트를 켠다. 산술은 그대로이고 무연산 케이스만 사라졌다.
  const sig = shipType.signatureBit;
  if (sig >= 0) uniqueMask |= 1 << sig;
  lo.uniqueMask = uniqueMask;
  // M3 원소 어픽스(상태이상): 정수 강도 합산을 그대로 실어 sim이 명중 시 소비한다.
  lo.fireDmg += sums.fireDmg;
  lo.coldSlow += sums.coldSlow;
  lo.lightning += sums.lightning;
  // 계보 기체 가지(M5, ADR-0007): 장비·스킬 위에 마지막으로 겹치는 계정 단위 배율.
  if (shipBonusBp !== undefined) applyShipLineageBonus(lo, shipBonusBp);
  // 조종사 레벨 성장(§R51) — **반드시 맨 끝**이다(가산 축 `maxHpAdd` 의 순서 의존, 위 주석).
  applyPilotLevelScaling(lo, level);

  const worldMods: WorldMods = {
    mineralFindMult: 1 + sums.mineralFindPct / 100,
  };
  return { loadout: lo, worldMods };
}
