/**
 * Item data model (M2 Phase A1 — plan §4).
 *
 * ADR-0005 boundary (plan §2 ①A): the simulation never carries item structs.
 * A drop emits only a *drop seed* (u32); the item it stands for is confirmed
 * afterwards by the pure function `rollItem` (src/items/roll.ts) from that seed +
 * rarity + source. This module defines the resulting `Item` shape and the stat
 * vocabulary the loadout pipeline (src/items/loadout.ts) consumes. It is pure
 * data/types — no RNG, no sim imports at runtime — so both the client and the
 * Edge Function reproduce the same item from the same seed.
 */

/** Save-schema version stamped onto serialized profiles (plan A1 / C1). Bump on
 *  any breaking layout change so the migration path can key off it.
 *  v2 (M3): adds the `skillInvest` vector (60-node skill tree).
 *  v3 (M3 Phase E2): adds the `tutorialDone` flag (FTUE gate + base-building
 *  unlocks); existing saves migrate with it pre-set (they already played).
 *  v4 (M8 기체 챔피언화, ADR-0019): `skillInvest` 가 계정 단위에서 **기체 단위**로
 *  내려간다 — `Ship.typeId`(SHIP_TYPES 인덱스) + `Ship.skillInvest`(타입별 트리 벡터)
 *  신설. v3 의 계정 벡터는 마이그레이션이 각 기체로 승계한다(전원 스트라이커 = typeId 0).
 *  ⚠️ DB 변경 없음 — `profiles.save` 는 불투명 jsonb 이고 서버 SQL 은 그 안의
 *  `credits`/`minerals` 만 읽는다(실측: supabase/migrations/** 에 skillInvest 0건).
 *  `profiles.save_version` 은 제약 없는 integer 스탬프라 4 를 그대로 받는다.
 *
 *  v5 (ADR-0022 침략 단계): `planetProgress.bestTierCleared` → `bestStageCleared`.
 *  마이그레이션이 구 티어(t) → 단계(t+1)로 옮긴다(클리어 상태 보존). ItemSource.tier→stage.
 *
 *  v6 (스토리 시스템 Phase E, ADR-0023): `collectedShards`(수집 기록 파편 id) +
 *  `storyMetrics`(사연 챕터3 마일스톤 카운터) 신설. 마이그레이션은 스탬프만 올리고
 *  (`migrateV5toV6`) 두 필드는 `normalizeProfile` 이 기본값(빈 배열·빈 객체)으로 채운다.
 *  ⚠️ DB 변경 없음 — `profiles.save` 는 불투명 jsonb 이고 서버 SQL 은 `credits`/`minerals` 만
 *  읽는다(실측: supabase/migrations/** 에 collectedShards/storyMetrics 0건). save_version 은
 *  제약 없는 integer 스탬프라 6 을 그대로 받는다.
 *
 *  v7 (예비역 소집·장비 잠김, ADR-0024): `GuardianRecord.build`(퇴역 순간 고정 실물 빌드) 신설.
 *  additive-optional 이라 마이그레이션은 스탬프만 올리고(`migrateV6toV7`) 실제 파싱은
 *  `normalizeGuardianRecords`(build 부재 = 소집 비활성)가 맡는다. 구 수호기는 build 없이 정규화된다.
 *  ⚠️ DB 변경 없음 — `profiles.save` 는 불투명 jsonb. (별개로 원격 guardians 테이블에 build
 *  jsonb 컬럼을 더하는 마이그레이션 파일은 작성하되 원격 적용은 Wave 2 로 이월한다.)
 *
 *  v8 (액티브 스킬, ADR-0041): `Ship.activeSlots`(장착 2칸) 신설 + `GuardianBuild` 에도 같은
 *  2칸 추가. additive 라 마이그레이션은 스탬프만 올리고(`migrateV7toV8`), 실제 채움은
 *  `normalizeShip`(빈 슬롯 2칸)과 `normalizeGuardianRecords` 가 맡는다 — **기존 guardian
 *  레코드까지 정규화**해야 "열려 있는데 안 끼워져 있는" 상태가 안 생긴다(계획 PM-3).
 *  ⚠️ **V7 로의 다운그레이드 경로는 없다**(계획 B-9). 기능을 폐기해도 V8 은 유지하고
 *  레지스트리를 비운다 — 슬롯이 항상 빈 배열이면 `activeSlots` 가 스탬프되지 않아
 *  `runConfig`·`hashWorld` 가 전부 기존과 바이트 동일하다.
 *  ⚠️ DB 변경 없음 — `profiles.save` 는 불투명 jsonb.
 *
 *  v9 (스킬 사슬 선행 조건, ADR-0047): 스키마는 **한 칸도 안 바뀐다** — 이 버전은 순수
 *  **데이터 정합** 스탬프다. 선행 조건이 여태 없었으므로 기존 `Ship.skillInvest` 에는
 *  새 규칙을 위반한 배치가 얼마든지 있고, 그대로 두면 규칙이 불변식이 아니게 된다.
 *  더 나쁘게는 **리스펙 한 번이 되돌릴 수 없는 손실**이 된다(전액 초기화 뒤에는 규칙
 *  때문에 원래 배치로 못 돌아간다). 그래서 `migrateV8toV9` 가 전 기체의 벡터를 0 으로
 *  털고 투자분을 `skillPoints` 로 **전액 환급**한다(리스펙 비용 없음, 장비·진행도 불변).
 *  ⚠️ 퇴역 수호기의 `GuardianBuild.skillInvest` 는 **건드리지 않는다** — 그건 퇴역 순간
 *  고정된 스냅샷이고 투자 경로가 없다(ADR-0024). 털면 기존 수호 전력이 소급 약화된다.
 *  ⚠️ DB 변경 없음 — `profiles.save` 는 불투명 jsonb.
 *
 *  v10 (기본 장비 지급): 스키마는 **한 칸도 안 바뀐다** — v9 와 같은 순수 **데이터 정합**
 *  스탬프다. `defaultShip()` 과 세대 교체 기체가 여태 `equipped: {}` 로 나왔고, 그 상태의
 *  Lv1~5 는 단계1 클리어율이 실측 0.0% 였다(`requiredLevel.ts` §밴드 시작 기준 주석).
 *  `migrateV9toV10` 이 **모든 기체의 빈 장착 칸만** `starterKit` 으로 채운다 — 이미 입고
 *  있는 칸은 절대 덮지 않으므로 파밍 장비가 스타터로 바뀌지 않는다.
 *  ⚠️ 퇴역 수호기의 `GuardianBuild.equipped` 는 **건드리지 않는다** — 퇴역 순간 고정된
 *  봉인 빌드이고(ADR-0024), 채우면 기존 수호 전력이 소급 강화된다.
 *  ⚠️ DB 변경 없음 — `profiles.save` 는 불투명 jsonb. 장비는 `equipped` 에만 들어가므로
 *  `progressScore`(inventory/stash 길이 합산)도 흔들지 않는다.
 *
 *  v11 (ADR-0049 스킬 전면 재구축): `skillInvest` 의 **와이어 레이아웃 자체가 바뀐다** —
 *  구 `[base 0..59][캡스톤 60..62]`(스트라이커 63 · 해츨링 78)에서 신규
 *  `[축0 0..9][축1 10..19][축2 20..29]`(전 기체 30)로. 인덱스의 의미가 통째로 갈렸으므로
 *  `migrateV10toV11` 이 전 기체 벡터를 비우고 투자분을 `skillPoints` 로 **전액 환급**한다
 *  (리스펙 비용 없음, 장비·진행도 불변). 환급 누계는 **정규화 전에** 세야 한다 — 정규화가
 *  신규 길이 30칸만 옮겨 담아 뒤쪽 33/48칸이 조용히 잘리기 때문이다.
 *  ⚠️ **v9·v10 과 달리 퇴역 수호기를 그냥 두면 안 된다.** 그때는 길이가 안 바뀌어 제외가 곧
 *  무해였지만, 이번엔 구 벡터의 앞 30칸이 **신규 스킬로 재해석**된다(예비역 소집에서 안 찍은
 *  스킬이 공짜 해금). 게다가 수호 레코드는 서버에서 계속 흘러 들어와 마이그레이션 한 번으로는
 *  못 막는다 → 상시 관문 `normalizeGuardianSkillInvest`(`src/save/profile.ts`)가 **길이로
 *  판정해 0 처리**한다(사용자 결정 2026-08-06).
 *  ⚠️ DB 변경 없음 — `profiles.save` 는 불투명 jsonb. 단 `SHIP_HASH_VERSION` bump ·
 *  골든 3종 재생성 · `verify-*` EF 재배포가 **같은 원자**다. */
export const SAVE_VERSION = 11;

// ---------------------------------------------------------------------------
// Rarity
// ---------------------------------------------------------------------------

export type Rarity = 'normal' | 'magic' | 'rare' | 'unique';

/**
 * Stable numeric code per rarity. Stored on the `loot` drop entity (enemyType
 * field) and folded into the state hash, so NEVER renumber — a recorded run
 * must re-verify identically. New rarities would append.
 */
export const RARITY_CODE: Record<Rarity, number> = {
  normal: 0,
  magic: 1,
  rare: 2,
  unique: 3,
};

/** Inverse of {@link RARITY_CODE} (index = code). */
export const RARITY_BY_CODE: readonly Rarity[] = ['normal', 'magic', 'rare', 'unique'];

// ---------------------------------------------------------------------------
// Slots — 7 kinds across 8 equip positions (GDD §5; module has two).
// ---------------------------------------------------------------------------

export type SlotKind = 'main' | 'sub' | 'armor' | 'shield' | 'engine' | 'core' | 'module';

/** The seven slot kinds, in a stable order (index used by the seeded roller). */
export const SLOT_KINDS: readonly SlotKind[] = [
  'main',
  'sub',
  'armor',
  'shield',
  'engine',
  'core',
  'module',
];

/**
 * The eight equip positions. `module` occupies two (module0/module1); every
 * other kind occupies one. The loadout pipeline sums whatever items sit in these
 * eight positions — order is irrelevant to the sum, but the ids are stable for
 * the save schema and inventory UI (Lane 2).
 */
export const EQUIP_SLOTS = [
  'main',
  'sub',
  'armor',
  'shield',
  'engine',
  'core',
  'module0',
  'module1',
] as const;
export type EquipSlotId = (typeof EQUIP_SLOTS)[number];

// ---------------------------------------------------------------------------
// Affixes — the stat vocabulary the loadout pipeline understands.
// ---------------------------------------------------------------------------

/**
 * Every stat an affix can grant. The loadout pipeline (A4) maps each key onto a
 * derived weapon/config/world modifier. Percent keys are stored as integers
 * (e.g. `10` = +10%); flat keys are absolute additions.
 *
 * M2 shipped the 21-affix pool (9 prefix + 12 suffix). M3 adds the three elemental
 * prefixes (fire/cold/lightning) with the status-effect system (OQ-M3-5), completing
 * the 24-affix pool. Each elemental key feeds a status effect via the loadout →
 * LoadoutConfig elemental block (fireDmg / coldSlow / lightning).
 *
 * ADR-0049 스킬 어픽스(affixes.md ①-2)가 축 단위 3키를 더한다 — `skillLvOffense/Defense/
 * Utility`. 이 셋은 위 13종과 성질이 다르다: `applyStatSums`(loadout.ts)가 접는 배율/가산이
 * **아니라** `WorldConfig.skillAffixLv`(축별 정수 3칸, 이중 벡터)로 별도 파생된다
 * (`deriveSkillAffixLv`). **열거처가 셋이다** — 이 유니온 · `zeroStatSums()`(skills.ts) ·
 * `zeroSums()`(loadout.ts). 하나라도 빠지면 컴파일은 되는데 어픽스 합이 조용히 새거나
 * `undefined` 가 된다(affixes.md ⑥-1 항목 5).
 */
export type StatKey =
  // --- Prefix (offence) ---
  | 'damagePct'
  | 'fireRatePct'
  | 'bulletCount'
  | 'pierce'
  | 'bulletSpeedPct'
  | 'rangeFlat'
  // --- Prefix (M3 원소 — 상태이상) ---
  | 'fireDmg' // 화염: 명중 시 지속피해(틱당 피해)
  | 'coldSlow' // 냉기: 명중 시 적 감속
  | 'lightning' // 전격: 명중 시 인접 적 연쇄 피해
  // --- Suffix (utility / survival) ---
  | 'moveSpeedPct'
  | 'maxHpFlat'
  | 'maxHpPct'
  | 'dashCdPct'
  | 'magnetPct'
  | 'xpPct'
  | 'mineralFindPct'
  // --- Suffix (ADR-0049 스킬 어픽스 — 축 단위 +N 레벨, affixes.md ①-2) ---
  | 'skillLvOffense' // 공격 계열 스킬 전체 +N 레벨(투자 ≥1 인 스킬에만 가산, ①-4)
  | 'skillLvDefense' // 방어 계열
  | 'skillLvUtility'; // 유틸 계열

export type AffixKind = 'prefix' | 'suffix';

/** A designer-authored affix template (data/affixes.ts). Value rolls uniformly
 *  in the inclusive integer range [min, max] via the drop-seed RNG. */
export interface AffixDef {
  readonly id: string;
  /** Korean display name (nameplate/tooltip). */
  readonly name: string;
  readonly kind: AffixKind;
  readonly stat: StatKey;
  readonly min: number;
  readonly max: number;
}

/** A concrete rolled affix on an item instance. */
export interface AffixRoll {
  /** {@link AffixDef.id} this roll came from. */
  readonly id: string;
  readonly stat: StatKey;
  /** Rolled integer value within the def's [min, max]. */
  readonly value: number;
}

// ---------------------------------------------------------------------------
// Item instance
// ---------------------------------------------------------------------------

/** Where a drop came from — feeds drop tables and is stamped onto the item so
 *  the settlement/inventory can show provenance (planet index, 침략 단계). */
export interface ItemSource {
  /** Planet index (0 = 카르곤, 1 = 베르단, …). */
  readonly planet: number;
  /** 침략 단계(1..∞, ADR-0022). */
  readonly stage: number;
  /**
   * **드랍 당시 기체 레벨**(요구 레벨 상한, 사용자 지시 2026-08-05 — "행성에서 떨어지는 장비는
   * 현재 기체가 장착할 수 있는 장비가 떨어지게").
   *
   * ## 왜 단계 상한만으로는 부족했나
   * `stageLevelCap` 은 이미 "그 단계를 도는 동안 입게 된다"를 보장한다(ADR-0030 개정). 그런데
   * 그 기준은 **밴드의 시작 레벨**이라, 밴드 안에서도 앞쪽에 있는 조종사에게는 여전히 못 입는
   * 전리품이 나온다 — 예를 들어 단계 11(상한 51)을 Lv51 에 막 진입해 도는 사람은 괜찮지만,
   * 단계 3(상한 11)을 Lv11 로 도는 사람이 딴 레어는 요구 11 이라 아슬아슬하게 맞고, 밴드
   * 중간에서 상위 단계를 시도하면 어긋난다. 이 축은 그 틈을 **드랍처가 아니라 소유자 기준**으로
   * 닫는다: 주운 즉시 입는다.
   *
   * ## 왜 아이템에 박아 두는가(런타임에 기체 레벨을 읽지 않는가)
   * `requiredLevel` 은 **순수·서버 재도출 가능**이어야 한다(EF 검증, 이 필드가 없던 시절부터의
   * 계약). 계산할 때마다 현재 프로필을 읽으면 같은 아이템의 요구 레벨이 시점마다 달라져 그
   * 계약이 깨지고, 레벨이 오른 뒤 다시 계산하면 상한이 함께 올라 **요구 레벨이 사후에 오르는**
   * 기묘한 거동이 된다. 드랍 시점의 값을 한 번 박아 두면 아이템은 계속 순수 함수다.
   *
   * **선택 필드**다 — 부재는 "상한 없음"(구 거동)이다. 기존 세이브의 아이템, 시작 지급 장비,
   * 하네스·벤치가 손으로 만드는 아이템이 전부 그 경로를 탄다.
   */
  readonly levelCap?: number;
}

/**
 * A confirmed item. Fully determined by `rollItem(dropSeed, rarity, source)`, so
 * two runs that emit the same drop seed reconstruct byte-identical items.
 */
export interface Item {
  /** Instance id, derived from the drop seed (stable, reproducible). */
  readonly id: string;
  readonly slot: SlotKind;
  readonly rarity: Rarity;
  readonly affixes: readonly AffixRoll[];
  /**
   * Main-weapon type (0 = 발칸, 1 = 스프레드, 2 = 레일건) for `main` items, or
   * sub-weapon variant for `sub` items. `undefined` for non-weapon slots.
   */
  readonly weaponType?: number;
  /** Set only for `unique` items — keys the unique-effect registry (Lane 3). */
  readonly uniqueId?: string;
  readonly source: ItemSource;
}
