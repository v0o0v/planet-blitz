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
 *  jsonb 컬럼을 더하는 마이그레이션 파일은 작성하되 원격 적용은 Wave 2 로 이월한다.) */
export const SAVE_VERSION = 7;

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
  | 'mineralFindPct';

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
