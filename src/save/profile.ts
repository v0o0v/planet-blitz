/**
 * Local profile store (M2 Phase C1 — plan §4, AC5).
 *
 * A `Profile` is the player's persistent meta state: their ships (level/xp/
 * equipped gear), inventory + stash of items, per-planet progress, and the three
 * meta currencies (credits / minerals / skill points). It lives entirely OUTSIDE
 * the simulation — `saveVersion` stamps the schema so a future migration can key
 * off it (the M4 Supabase move, ADR-0002).
 *
 * Determinism note: this layer is render/meta only, so it is free to touch the
 * clock or storage. It still avoids any RNG — item ids come from `rollItem`
 * (drop-seed derived), never from `Math.random`.
 *
 * Storage is pluggable (`KeyValueStore`): production uses `localStorage`; tests
 * pass an in-memory mock so they can run under the `node` vitest environment
 * without a DOM. Corrupt or partial storage always recovers to a default profile
 * rather than throwing.
 */

import { SAVE_VERSION, SLOT_KINDS, RARITY_BY_CODE } from '../items/types.js';
import type { Item, EquipSlotId } from '../items/types.js';
import { SKILLS, SKILL_NODE_COUNT } from '../../data/skills.js';
import type { DefenseLayout } from '../sim/defense.js';
import { emptyLineage } from '../../data/lineage.js';
import type { LineageState } from '../../data/lineage.js';
import { normalizeGuardianPreset, normalizePerformance, PERFORMANCE_FULL } from '../../data/guardian.js';
import type { GuardianSnapshot } from '../../data/guardian.js';
import { respecCostCredits, RESPEC_CREDITS_PER_LEVEL } from '../../data/economy.js';

/**
 * Credit cost of one skill respec, per active-ship level (plan A3).
 * 실제 공식은 data/economy.ts respecCostCredits 로 이관됨(재수출로 호환 유지).
 */
export const RESPEC_COST_PER_LEVEL = RESPEC_CREDITS_PER_LEVEL;

/** Active-ship level at which the research lab (skill tree) unlocks (GDD §7). */
export const RESEARCH_UNLOCK_LEVEL = 3;

/** Inventory capacity — 48 slots (6×8 grid, plan D1). */
export const INVENTORY_CAP = 48;
/** Base stash capacity before any expansion. */
export const STASH_BASE = 32;
/** Extra stash slots granted per credit-bought expansion. */
export const STASH_PER_EXPANSION = 32;
/** Max stash expansions (2 → 32 + 64 = 96 total, plan D1 / AC6). */
export const MAX_STASH_EXPANSIONS = 2;

/** localStorage key the profile is serialized under. */
const STORAGE_KEY = 'planet-blitz:profile';

/** Current stash capacity for a given expansion count (clamped 0..MAX). */
export function stashCapacity(expansions: number): number {
  const e = clampInt(expansions, 0, MAX_STASH_EXPANSIONS, 0);
  return STASH_BASE + STASH_PER_EXPANSION * e;
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/** One playable ship: its level/xp progression and the eight equip positions. */
export interface Ship {
  readonly id: string;
  name: string;
  /** Current level (starts at 1). */
  level: number;
  /** XP banked toward the next level (resets each level-up, plan AC11). */
  xp: number;
  /** Items in the eight equip positions (absent = empty slot). */
  equipped: Partial<Record<EquipSlotId, Item>>;
}

/** Per-planet clear progress (drives star-map gating, plan D3). */
export interface PlanetProgress {
  /** Highest tier cleared (-1 none, 0 정찰, 1 교전). */
  bestTierCleared: number;
}

/** The player's whole persistent meta state. */
export interface Profile {
  saveVersion: number;
  ships: Ship[];
  /** Index into `ships` of the active loadout. */
  activeShipIndex: number;
  inventory: Item[];
  stash: Item[];
  /** Purchased stash expansions (0..MAX_STASH_EXPANSIONS). */
  stashExpansions: number;
  /** planet id → progress. */
  planetProgress: Record<number, PlanetProgress>;
  credits: number;
  minerals: number;
  /** Banked skill points (M3 spends them; M2 only accrues, OQ-M2-7). */
  skillPoints: number;
  /**
   * Per-node skill investment (M3 plan A3). Length === SKILL_NODE_COUNT (60);
   * `skillInvest[i]` is the points put into `SKILLS[i]` (0..node.maxPoints).
   * Account-wide (research lab is a base building, not per-ship). Fed to
   * `computeLoadoutStats(equipped, skillInvest)` at run start.
   */
  skillInvest: number[];
  /**
   * Whether the forced first-run tutorial (FTUE, plan E1/E2) has been completed.
   * A fresh profile starts `false` (new pilots are dropped straight into the
   * tutorial run); once it finishes, the base map replaces the tutorial as the
   * hub and the run becomes skippable (OQ-M3-7). Migrated pre-v3 saves are
   * stamped `true` — they were already playing before the FTUE existed.
   */
  tutorialDone: boolean;
  /**
   * 방어 배치 에디터(M4 Phase C3)가 저장한 방어 배치. 침공(비동기 PvP)의 정적 스폰
   * 데이터가 된다. 미배치 = `undefined`. 지금은 로컬 세이브에만 두고, Supabase `defenses`
   * 테이블 연동은 M4 Phase B 후속(append-only 필드 — 깊은 검증은 UI의 normalizeLayout이
   * 로드 시 수행하므로 여기선 얕은 형태만 보존한다).
   *
   * ⚠️ 이 값은 {@link normalizeStoredLayout}의 얕은 검증(core/turrets/obstacles 존재 여부)만
   * 거친다 — 침공 배선(profile.defenseLayout → WorldConfig.invasion) 시에는 반드시
   * `src/ui/defenseCommand.ts`의 `normalizeLayout()`으로 깊은 정규화(포탑 유형 범위·좌표
   * 유한성·장애물 반폭/반높이 양수 등)를 거쳐 InvasionConfig를 구성할 것. 여기서 직접
   * WorldConfig.invasion.layout에 흘려 넣지 말 것 — NaN/손상 좌표가 그대로 sim에 들어가면
   * hashFloat 등 결정론 해시 계산에 도달해 재현성이 붕괴한다(ADR-0005).
   */
  defenseLayout?: DefenseLayout;
  /**
   * 계보 상태(M5 Phase A5, ADR-0007) — 기체 가지·수호 가지 누적 레벨 + 미사용/누적 포인트.
   * 서버 정본은 profiles.lineage_* 컬럼(RPC 만 갱신). 로컬은 오프라인 표시·즉시 반영용 미러다.
   * 리스펙 없음(순환 재화). 미존재 세이브는 normalizeProfile 이 빈 계보로 채운다.
   */
  lineage: LineageState;
  /**
   * 수호 기체 레코드(M5 Phase A1/A2, ADR-0007) — 서버 guardians 테이블의 로컬 미러. 퇴역으로
   * 생성, 풍화로 감쇠, 소멸(retired)로 계보 포인트化. 방어 배치 수호 슬롯은 이 중 미소멸분에서
   * 고른다. 서버 정본은 guardians 테이블(performance·retired 는 서버 권위).
   */
  guardians: GuardianRecord[];
}

/** 로컬 세이브의 수호 기체 레코드(서버 guardians 미러, ADR-0007). */
export interface GuardianRecord {
  /** 식별자(서버 guardians.id 또는 로컬 생성 id). */
  id: string;
  /** 퇴역 복사 스냅샷(기본 전투 스탯). */
  snapshot: GuardianSnapshot;
  /** 남은 성능%(centi-percent, 풍화 반영 — 서버 권위). */
  performanceCP: number;
  /** 전투력 점수(회수가치·강도 기준). */
  combatScore: number;
  /** 프리셋(0 타이탄/1 인터셉터). */
  preset: number;
  /** 소멸됨(계보 포인트로 회수 완료). true 면 방어 참전·재소멸 불가. */
  retired: boolean;
}

/** Which base-map buildings are currently unlocked (derived, GDD §7 / plan E2). */
export interface BaseUnlocks {
  /** 격납고 — always available once the base is revealed. */
  hangar: boolean;
  /** 연구소(스킬트리) — unlocks at active-ship Lv3. */
  research: boolean;
  /** 정제소(리롤) — unlocks after clearing any planet at least once. */
  refinery: boolean;
  /** 방어 사령부 — M4 content ("준비 중"). */
  defenseCommand: boolean;
  /** 관제탑 — M4 content ("준비 중"). */
  controlTower: boolean;
}

/** A minimal synchronous key/value store (localStorage-compatible subset). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultShip(): Ship {
  return { id: 'ship-0', name: '초기 전투기', level: 1, xp: 0, equipped: {} };
}

/** A zeroed skill-investment vector (length === SKILL_NODE_COUNT). */
export function zeroSkillInvest(): number[] {
  return new Array<number>(SKILL_NODE_COUNT).fill(0);
}

/** A fresh profile — one starter ship, empty everything. */
export function defaultProfile(): Profile {
  return {
    saveVersion: SAVE_VERSION,
    ships: [defaultShip()],
    activeShipIndex: 0,
    inventory: [],
    stash: [],
    stashExpansions: 0,
    planetProgress: {},
    credits: 0,
    minerals: 0,
    skillPoints: 0,
    skillInvest: zeroSkillInvest(),
    tutorialDone: false,
    lineage: emptyLineage(),
    guardians: [],
  };
}

/** The active ship (falls back to the first, then a fresh default). */
export function activeShip(profile: Profile): Ship {
  return profile.ships[profile.activeShipIndex] ?? profile.ships[0] ?? defaultShip();
}

// ---------------------------------------------------------------------------
// Base-map unlocks + planet-clear progress (M3 plan E2, GDD §7)
// ---------------------------------------------------------------------------

/** Derive which base buildings are unlocked from the profile's live state. The
 *  unlock order (격납고 → Lv3 연구소 → 행성 1클리어 정제소 → M4 방어 사령부·관제탑)
 *  is surfaced by the base map as lock overlays (GDD §7). */
export function computeUnlocks(profile: Profile): BaseUnlocks {
  const level = activeShip(profile).level;
  let anyClear = false;
  for (const p of Object.values(profile.planetProgress)) {
    if (p.bestTierCleared >= 0) {
      anyClear = true;
      break;
    }
  }
  return {
    hangar: true,
    research: level >= RESEARCH_UNLOCK_LEVEL,
    refinery: anyClear,
    // 방어 사령부(M4 Phase C3): 행성 1회 클리어로 해금 — 지킬 기지를 갖춘 뒤 배치를 짠다
    // (정제소와 동일 게이트). 관제탑(래더·침공 제출)은 아직 준비 중(관련 워커/후속 Phase).
    defenseCommand: anyClear,
    controlTower: false, // M4 (관제탑 — 후속)
  };
}

/** Record a planet clear, keeping the highest tier ever cleared there. Drives the
 *  정제소 unlock and star-map tier gating (plan E2). No-op if `tier` is lower than
 *  the recorded best. */
export function recordPlanetClear(profile: Profile, planet: number, tier: number): void {
  const cur = profile.planetProgress[planet];
  if (cur === undefined || tier > cur.bestTierCleared) {
    profile.planetProgress[planet] = { bestTierCleared: tier };
  }
}

// ---------------------------------------------------------------------------
// Skill investment + respec (M3 plan A3)
// ---------------------------------------------------------------------------

/** Total points currently invested across all skill nodes. */
export function totalInvested(profile: Profile): number {
  let n = 0;
  for (const v of profile.skillInvest) n += v;
  return n;
}

/**
 * Spend one banked skill point into node `index`. No-ops (returns false) when the
 * index is out of range, the node is already maxed, or no points are banked.
 */
export function investSkill(profile: Profile, index: number): boolean {
  const node = SKILLS[index];
  if (node === undefined) return false;
  if (profile.skillPoints <= 0) return false;
  const cur = profile.skillInvest[index] ?? 0;
  if (cur >= node.maxPoints) return false;
  profile.skillInvest[index] = cur + 1;
  profile.skillPoints -= 1;
  return true;
}

/** Credit cost to respec the tree, scaled by the active ship's level (plan A3). */
export function respecCost(profile: Profile): number {
  return respecCostCredits(activeShip(profile).level);
}

/**
 * Refund every invested point back to the banked pool and zero the tree, charging
 * `respecCost` credits. No-ops (returns false) when nothing is invested or the
 * player cannot afford the cost. Skill points are conserved (refunded == spent),
 * so a respec never creates or destroys progression.
 */
export function respecSkills(profile: Profile): boolean {
  const invested = totalInvested(profile);
  if (invested === 0) return false;
  const cost = respecCost(profile);
  if (profile.credits < cost) return false;
  profile.credits -= cost;
  profile.skillPoints += invested;
  profile.skillInvest = zeroSkillInvest();
  return true;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * DEV 하네스 전용 기본 스토어 오버라이드(ADR-0008). When set, every default-store
 * `loadProfile`/`saveProfile` (including the ones the building overlays call
 * internally) is redirected here — so activating the 하네스 프로필 slot isolates
 * ALL profile I/O to a separate localStorage key, never touching the real save.
 * `undefined` = no override (production behaviour). Never set outside DEV.
 */
let defaultStoreOverride: KeyValueStore | null | undefined;

/** DEV 하네스 전용: redirect all default-store profile I/O (see above). Pass
 *  `undefined` to clear the override and restore the real localStorage default. */
export function setProfileStoreOverride(store: KeyValueStore | null | undefined): void {
  defaultStoreOverride = store;
}

/** Resolve the ambient `localStorage`, or null when unavailable/blocked. */
function defaultStore(): KeyValueStore | null {
  if (defaultStoreOverride !== undefined) return defaultStoreOverride;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Access can throw in sandboxed / privacy-mode contexts.
  }
  return null;
}

/**
 * Load + migrate the stored profile. Any failure (no store, missing key, invalid
 * JSON, shape corruption) recovers to a fresh default profile (AC5).
 */
export function loadProfile(store: KeyValueStore | null = defaultStore()): Profile {
  if (store === null) return defaultProfile();
  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return defaultProfile();
  }
  if (raw === null) return defaultProfile();
  try {
    return migrate(JSON.parse(raw) as unknown);
  } catch {
    return defaultProfile();
  }
}

/** Persist the profile. Storage errors (quota, denied) are swallowed. */
export function saveProfile(profile: Profile, store: KeyValueStore | null = defaultStore()): void {
  if (store === null) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Quota exceeded or access denied — meta state is best-effort.
  }
}

// ---------------------------------------------------------------------------
// Migration + normalization
// ---------------------------------------------------------------------------

/**
 * Bring any stored blob up to the current schema. Reads `saveVersion` (absent =
 * legacy v0), runs the stepwise migrations, then normalizes every field so a
 * partially-corrupt profile still yields a valid one.
 */
export function migrate(raw: unknown): Profile {
  if (typeof raw !== 'object' || raw === null) return defaultProfile();
  let data = raw as Record<string, unknown>;
  const version = typeof data.saveVersion === 'number' ? data.saveVersion : 0;
  if (version < 1) data = migrateV0toV1(data);
  if (version < 2) data = migrateV1toV2(data);
  if (version < 3) data = migrateV2toV3(data);
  return normalizeProfile(data);
}

/**
 * v0 → v1: the pre-M2 shape had a single `ship` object and `gold` currency;
 * v1 uses a `ships` array and `credits`. Fields are renamed here; anything else
 * is left for {@link normalizeProfile} to fill/validate.
 */
function migrateV0toV1(v0: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...v0, saveVersion: 1 };
  if (out.ships === undefined && v0.ship !== undefined) {
    out.ships = [v0.ship];
    delete out.ship;
  }
  if (out.credits === undefined && typeof v0.gold === 'number') {
    out.credits = v0.gold;
    delete out.gold;
  }
  return out;
}

/**
 * v1 → v2: the M3 schema adds the account-wide `skillInvest` vector. A v1 blob
 * simply lacks it; {@link normalizeProfile} fills a zeroed vector, so this step
 * only bumps the stamp. Banked `skillPoints` from v1 carry over untouched.
 */
function migrateV1toV2(v1: Record<string, unknown>): Record<string, unknown> {
  return { ...v1, saveVersion: 2 };
}

/**
 * v2 → v3: the FTUE (plan E2) adds `tutorialDone`. Any existing v2 save belongs to
 * a pilot who was already playing before the tutorial gate existed, so it is
 * stamped `true` (they are not force-marched back through the tutorial). A brand-
 * new profile comes from {@link defaultProfile} with `false`.
 */
function migrateV2toV3(v2: Record<string, unknown>): Record<string, unknown> {
  return { ...v2, saveVersion: 3, tutorialDone: true };
}

/**
 * Normalize a stored skill vector to exactly SKILL_NODE_COUNT entries, each an
 * integer clamped to its node's [0, maxPoints]. Missing/extra/corrupt entries
 * recover to 0 so a partial save never over-invests.
 */
function normalizeSkillInvest(v: unknown): number[] {
  const out = zeroSkillInvest();
  if (!Array.isArray(v)) return out;
  for (let i = 0; i < SKILL_NODE_COUNT; i++) {
    const node = SKILLS[i];
    const max = node?.maxPoints ?? 0;
    out[i] = clampInt(v[i], 0, max, 0);
  }
  return out;
}

function normalizeProfile(d: Record<string, unknown>): Profile {
  const base = defaultProfile();
  const ships = Array.isArray(d.ships)
    ? d.ships.map(normalizeShip).filter((s): s is Ship => s !== null)
    : [];
  const finalShips = ships.length > 0 ? ships : base.ships;
  return {
    saveVersion: SAVE_VERSION,
    ships: finalShips,
    activeShipIndex: clampInt(d.activeShipIndex, 0, finalShips.length - 1, 0),
    inventory: normalizeItems(d.inventory),
    stash: normalizeItems(d.stash),
    stashExpansions: clampInt(d.stashExpansions, 0, MAX_STASH_EXPANSIONS, 0),
    planetProgress: normalizeProgress(d.planetProgress),
    credits: numOr(d.credits, 0),
    minerals: numOr(d.minerals, 0),
    skillPoints: numOr(d.skillPoints, 0),
    skillInvest: normalizeSkillInvest(d.skillInvest),
    tutorialDone: d.tutorialDone === true,
    lineage: normalizeLineage(d.lineage),
    guardians: normalizeGuardianRecords(d.guardians),
    ...normalizeStoredLayout(d.defenseLayout),
  };
}

/** 저장된 계보 상태를 안전 정규화(손상·부분 세이브는 빈 계보로 복구, 음수는 0). */
function normalizeLineage(v: unknown): LineageState {
  if (typeof v !== 'object' || v === null) return emptyLineage();
  const d = v as Record<string, unknown>;
  return {
    shipLevel: clampInt(d.shipLevel, 0, Number.MAX_SAFE_INTEGER, 0),
    guardianLevel: clampInt(d.guardianLevel, 0, Number.MAX_SAFE_INTEGER, 0),
    available: clampInt(d.available, 0, Number.MAX_SAFE_INTEGER, 0),
    spent: clampInt(d.spent, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

/** 저장된 수호 기체 스냅샷 1개를 정규화(모든 전투 스탯 숫자 필수, 손상이면 null). */
function normalizeGuardianSnapshot(v: unknown): GuardianSnapshot | null {
  if (typeof v !== 'object' || v === null) return null;
  const d = v as Record<string, unknown>;
  const num = (k: string): number | null => (typeof d[k] === 'number' && Number.isFinite(d[k]) ? (d[k] as number) : null);
  const fields = [
    'radius', 'hp', 'contactDamage', 'fireCooldown', 'bulletDamage',
    'bulletSpeed', 'bulletRadius', 'bulletLife', 'range', 'moveSpeed', 'standoff',
  ] as const;
  const out: Record<string, number> = { preset: normalizeGuardianPreset(numOr(d.preset, 0)) };
  for (const f of fields) {
    const n = num(f);
    if (n === null) return null;
    out[f] = n;
  }
  return out as unknown as GuardianSnapshot;
}

/** 저장된 수호 기체 레코드 배열을 정규화(손상 항목은 스킵). */
function normalizeGuardianRecords(v: unknown): GuardianRecord[] {
  if (!Array.isArray(v)) return [];
  const out: GuardianRecord[] = [];
  for (const raw of v) {
    if (typeof raw !== 'object' || raw === null) continue;
    const d = raw as Record<string, unknown>;
    const snapshot = normalizeGuardianSnapshot(d.snapshot);
    if (snapshot === null) continue;
    const id = typeof d.id === 'string' && d.id.length > 0 ? d.id : `g-${out.length}`;
    out.push({
      id,
      snapshot,
      performanceCP: normalizePerformance(numOr(d.performanceCP, PERFORMANCE_FULL)),
      combatScore: clampInt(d.combatScore, 0, Number.MAX_SAFE_INTEGER, 0),
      preset: normalizeGuardianPreset(numOr(d.preset, snapshot.preset)),
      retired: d.retired === true,
    });
  }
  return out;
}

/**
 * 저장된 방어 배치를 얕게 보존한다: `core`/`turrets`/`obstacles` 꼴을 갖춘 객체면 그대로
 * 통과시키고(왕복 무손실), 아니면 필드를 생략한다. 깊은 유효성(포탑 유형 범위 등)은 에디터의
 * `normalizeLayout`이 로드 시 재검증하므로 여기서 sim 상수를 끌어오지 않는다(레이어 최소 결합).
 */
function normalizeStoredLayout(v: unknown): { defenseLayout?: DefenseLayout } {
  if (typeof v !== 'object' || v === null) return {};
  const d = v as Record<string, unknown>;
  if (typeof d.core !== 'object' || d.core === null) return {};
  if (!Array.isArray(d.turrets) || !Array.isArray(d.obstacles)) return {};
  return { defenseLayout: v as DefenseLayout };
}

function normalizeShip(v: unknown): Ship | null {
  if (typeof v !== 'object' || v === null) return null;
  const s = v as Record<string, unknown>;
  const equipped: Partial<Record<EquipSlotId, Item>> = {};
  if (typeof s.equipped === 'object' && s.equipped !== null) {
    for (const [slot, item] of Object.entries(s.equipped as Record<string, unknown>)) {
      if (isValidItem(item)) equipped[slot as EquipSlotId] = item;
    }
  }
  return {
    id: typeof s.id === 'string' ? s.id : 'ship-0',
    name: typeof s.name === 'string' ? s.name : '초기 전투기',
    level: Math.max(1, numOr(s.level, 1)),
    xp: Math.max(0, numOr(s.xp, 0)),
    equipped,
  };
}

function normalizeItems(v: unknown): Item[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isValidItem);
}

function normalizeProgress(v: unknown): Record<number, PlanetProgress> {
  const out: Record<number, PlanetProgress> = {};
  if (typeof v !== 'object' || v === null) return out;
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
    const id = Number(key);
    if (!Number.isFinite(id)) continue;
    if (typeof val === 'object' && val !== null) {
      const p = val as Record<string, unknown>;
      out[id] = { bestTierCleared: clampInt(p.bestTierCleared, -1, 99, -1) };
    }
  }
  return out;
}

/**
 * Shape guard for a serialized item. Valid items pass through untouched, so a
 * save→load round-trip is lossless; anything malformed is dropped.
 */
export function isValidItem(v: unknown): v is Item {
  if (typeof v !== 'object' || v === null) return false;
  const it = v as Record<string, unknown>;
  return (
    typeof it.id === 'string' &&
    typeof it.slot === 'string' &&
    (SLOT_KINDS as readonly string[]).includes(it.slot) &&
    typeof it.rarity === 'string' &&
    (RARITY_BY_CODE as readonly string[]).includes(it.rarity) &&
    Array.isArray(it.affixes) &&
    typeof it.source === 'object' &&
    it.source !== null
  );
}

// ---------------------------------------------------------------------------
// Small coercion helpers
// ---------------------------------------------------------------------------

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
  if (max < min) return min;
  return n < min ? min : n > max ? max : n;
}
