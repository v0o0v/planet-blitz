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
import { fillStarterEquipment } from '../items/starterKit.js';
import type { SkillNode } from '../../data/skills.js';
import { shipCapstoneUnlocked, chainPrereqMet } from '../items/skills.js';
import {
  shipTypeDef,
  flattenShipNodes,
  normalizeShipTypeId,
  zeroSkillInvest as registryZeroSkillInvest,
} from '../../data/ships/index.js';
import { activeById } from '../../data/ships/actives/index.js';
import { ACTIVE_SLOT_COUNT } from '../../data/ships/actives/types.js';
import type { InvasionLayers } from '../sim/invasion/types.js';
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

/**
 * Active-ship level at which the research lab (skill tree) unlocks (GDD §7).
 *
 * **1 = 처음부터 열려 있다.** 구값은 3 이었는데, 스킬 트리는 기체가 성장하는 유일한 화면이라
 * 그것을 첫 두 레벨 동안 잠가 두면 "무엇을 향해 크는지"를 보여주지 않은 채로 온보딩이 돈다.
 * 상수를 지우지 않고 값만 내린 이유: `ui/baseMap.ts`·`ui/pixi/baseMap.ts`·테스트가 이 상수를
 * import 해 잠금 문구를 만든다 — 상수를 없애면 그 4곳이 함께 흔들린다.
 */
export const RESEARCH_UNLOCK_LEVEL = 1;

/** Inventory capacity — 48 slots (6×8 grid, plan D1). */
export const INVENTORY_CAP = 48;
/** Base stash capacity before any expansion. */
export const STASH_BASE = 32;
/** Extra stash slots granted per credit-bought expansion. */
export const STASH_PER_EXPANSION = 32;
/**
 * Max stash expansions (4 → 32 + 128 = 160 total).
 *
 * 구 값은 2(=96칸)였다. `stashExpansionCost` 를 제곱 곡선(1000/4000/9000/16000)으로 세우면서
 * 회차를 4로 늘렸다 — 회차가 2뿐이면 "점점 비싸지는 곡선"이 사실상 두 점밖에 없어 곡선이
 * 무의미하고, 후반 크레딧 싱크로도 약하다. 상한은 세 곳에서 일관되게 강제된다:
 *   ① 정규화 — `stashCapacity`/`deserialize` 의 `clampInt(.., 0, MAX_STASH_EXPANSIONS, 0)`
 *   ② UI — 격납고/인벤토리 확장 버튼이 상한에서 `inv.act.expandMax` 로 비활성
 *   ③ 소비 경로 — `expandStash()` 가 상한 도달 시 서버 왕복 전에 즉시 거부
 */
export const MAX_STASH_EXPANSIONS = 4;

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
  /**
   * 기체 타입(M8, ADR-0019) — `SHIP_TYPES` 배열 인덱스. 0 = 스트라이커(기본·기존 유저 전원).
   * **재번호 금지**: 인덱스가 트리 정의·시그니처 비트·아이콘 축의 계약이다.
   * {@link normalizeShip} 이 `normalizeShipTypeId` 로 정규화한다 — 범위 밖·손상은 상한 clamp 가
   * 아니라 **0(스트라이커) 복귀**다(설계서 §6, 2026-07-21 확정). 상한으로 clamp 하면 손상 세이브가
   * 유저에게 조용히 *다른 기체* 를 쥐여 준다. 정규화를 건너뛰면 타입 조회가 `undefined` 가 되어
   * loadout 전체가 **조용히** 중립이 된다.
   */
  typeId: number;
  /** Current level (starts at 1). */
  level: number;
  /** XP banked toward the next level (resets each level-up, plan AC11). */
  xp: number;
  /** Items in the eight equip positions (absent = empty slot). */
  equipped: Partial<Record<EquipSlotId, Item>>;
  /**
   * 이 기체의 스킬 트리 투자 벡터(M8 v4 — **정본**). 길이 = `shipTypeNodes(typeId).length`
   * (스트라이커 = SKILL_NODE_COUNT = 63). `skillInvest[i]` = 노드 i 에 넣은 포인트.
   *
   * 퇴역은 세대 리셋이므로 이 벡터는 기체와 함께 사라진다(계정을 관통하는 성장은 계보가
   * 담당 — data/lineage.ts). 런 시작 시 `computeLoadoutStats(equipped, ship.skillInvest, ...)`
   * 로 접혀 `WorldConfig.skillInvest` 가 된다.
   */
  skillInvest: number[];
  /**
   * 장착한 액티브 스킬 2칸(ADR-0041 · SAVE_VERSION 8). **길이 2 고정**, 빈 슬롯은 `null`.
   * 사람이 읽는 문자열 id 를 저장한다(`data/ships/actives` 레지스트리의 `ActiveSkillDef.id`).
   *
   * 해금은 `skillInvest` 에서 **파생**하므로 여기 저장하지 않는다(AC-13) — 이 배열은 "열린 것
   * 중 무엇을 끼웠는가"라는 독립 선택만 담는다. 그래서 예비역 소집(ADR-0024)에서 동결된
   * `skillInvest` 만으로는 복원되지 않고 `GuardianBuild` 에 별도로 박제해야 한다(계획 PM-3).
   *
   * 정수 wire 값으로의 변환은 `buildRunConfig` **한 곳에서만** 일어난다(단일 정본).
   */
  activeSlots: (string | null)[];
}

/** Per-planet clear progress (drives 개방 상한 산정, ADR-0022). */
export interface PlanetProgress {
  /** 그 행성 최고 클리어 단계(0 = 미클리어, 1..∞). 개방 상한 = max(10, 이 값 + 5). */
  bestStageCleared: number;
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
   * Whether the forced first-run tutorial (FTUE, plan E1/E2) has been completed.
   * A fresh profile starts `false` (new pilots are dropped straight into the
   * tutorial run); once it finishes, the base map replaces the tutorial as the
   * hub and the run becomes skippable (OQ-M3-7). Migrated pre-v3 saves are
   * stamped `true` — they were already playing before the FTUE existed.
   */
  tutorialDone: boolean;
  /**
   * 세계관 인트로 슬라이드(스토리 시스템)를 본 적 있는가. 첫 실행 1회 노출용. 신규 프로필은
   * `false` 로 시작한다. **기존 세이브도 필드 부재 → false 로 정규화**되므로 다음 부팅에 인트로를
   * 1회 본다(스토리 리빌은 현 플레이어에게도 닿아야 한다 — 언제든 스킵 가능하고 기록 보관소에서
   * 다시 볼 수 있다). tutorialDone 과 별도 축이다(튜토리얼 스킵 유저도 인트로는 봐야 하므로).
   */
  introSeen: boolean;
  /**
   * 방어 사령부가 저장한 3레이어 방어 배치(M7a, ADR-0017). 침공(비동기 PvP)의 정적 스폰
   * 데이터가 된다. 미배치 = `undefined`. 서버 정본은 `defenses.layout` jsonb 이고 여기는
   * 오프라인 표시·즉시 반영용 로컬 미러다.
   *
   * ⚠️ 이 값은 {@link normalizeStoredLayout}의 얕은 검증(l1/l2/l3 존재 여부)만 거친다 —
   * 침공 배선(profile.defenseLayout → WorldConfig.invasion3) 시에는 반드시
   * `normalizeInvasionLayers()`(src/sim/invasion/normalize.ts)로 깊은 정규화를 거칠 것.
   * raw 를 sim 에 그대로 흘리면 손상 좌표가 해시 계산에 도달해 재현성이 붕괴한다(ADR-0005).
   */
  defenseLayout?: InvasionLayers;
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
  /**
   * 수집한 기록 파편 id 집합(스토리 시스템 Phase E, ADR-0023). 에코 신호 안정화로 정산 경로에서
   * append 되며(중복 없는 집합 의미지만 저장은 순서 있는 배열), 기록 보관소 도감이 읽어 오스카
   * 문명 로어를 조각조각 연다. 순수 메타/UI 데이터 — sim·해시 무관. 정본 파편 목록은
   * `data/lore` `RECORD_SHARDS`. {@link normalizeProfile} 이 문자열만·중복 제거로 정규화한다.
   */
  collectedShards: string[];
  /**
   * 사연 챕터3 마일스톤 카운터(metric id → 누적값, 스토리 시스템 Phase E). 정산 경로에서만
   * 누적하며(sim 관측 델타 + victory 시 runsWon), `storyUnlock` 이 읽어 챕터3 해금을 판정한다.
   * metric id 정본은 `data/lore` 챕터3 unlock.metric(runsWon·hitsTaken·overchargeKills·
   * cloakBreaks·broodLaunches·cushionHealed·filmPops). {@link normalizeProfile} 이 값을 유한
   * 정수(음수는 0 하한)로 정규화한다. 희소 맵 — 관측된 metric 만 키로 존재한다.
   */
  storyMetrics: Record<string, number>;
  /**
   * 지급 완료한 사연 챕터 보상 원장(claimId 집합, 스토리 시스템 Phase E). claimId =
   * `${slug}-ch${index+1}`. 챕터 해금 조건은 영구 참(누적 마일스톤·행성 클리어)이라 매 정산마다
   * 재판정되므로, **한 번 지급한 크레딧을 다시 주지 않도록** 정산 경로가 여기에 claimId 를
   * 기록하고 이미 있으면 지급을 건너뛴다(중복 없는 집합 의미지만 저장은 순서 있는 배열).
   * 코스메틱은 순수 파생이라 원장이 필요 없고, 크레딧만 1회성이라 이 원장이 필요하다.
   * {@link normalizeProfile} 이 문자열만·중복 제거로 정규화한다.
   */
  storyRewardsClaimed: string[];
}

/**
 * 예비역 소집·장비 잠김용 실물 빌드(ADR-0024). {@link GuardianRecord.snapshot}의 **형제** 필드로,
 * 퇴역 순간의 실제 기체 loadout(타입·장착 장비·스킬 투자)을 통째로 복사해 고정한다. 소집(예비역
 * 출격) 시 이 빌드로 런 loadout 을 파생하고, 소멸(dismiss) 시 `equipped` 의 장비를 stash 로 반환한다.
 *
 * ⚠️ snapshot(방어 배치·해시 경로의 정본) 안에 넣지 않고 **형제로만** 둔다 — snapshot 필드 열거는
 * 결정론 계약(tests/invasionHash·shipHashBaseline)이라 build 를 그 안에 섞으면 방어 배치 바이트가
 * 변한다. build 는 순수 additive 라 방어/해시 경로를 건드리지 않는다.
 */
export interface GuardianBuild {
  /** 런 loadout 파생용 기체 타입(퇴역 순간 활성 기체의 typeId 복사). */
  readonly typeId: number;
  /** 잠긴 장비(퇴역 순간 복사) — 소멸 시 stash 로 반환된다. */
  readonly equipped: Partial<Record<EquipSlotId, Item>>;
  /** 스킬 투자 벡터 복사(길이 = shipTypeNodes(typeId).length). */
  readonly skillInvest: number[];
  /**
   * 퇴역 순간의 액티브 스킬 장착 2칸 **박제**(ADR-0041 · 계획 PM-3). 길이 2, 빈 슬롯 `null`.
   *
   * ⚠️ 이 필드가 없으면 "열려 있는데 안 끼워져 있는" 상태가 된다 — 장착 슬롯은 `skillInvest`
   * 파생이 **아니라** `Ship` 의 독립 저장이라, 동결된 투자 벡터만으로는 복원되지 않는다.
   * 소집 런에서 z/x 가 죽은 키가 되는 결함이 정확히 이 형태였다(ADR-0041 "예비역 소집" 절).
   * 구 레코드(V7 이전)는 `normalizeGuardianRecords` 가 빈 슬롯 2칸으로 정규화한다.
   */
  readonly activeSlots: (string | null)[];
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
  /**
   * 예비역 소집·장비 잠김용 실물 빌드(ADR-0024, 신규 v7). snapshot 의 형제로 퇴역 순간 고정된다.
   * **부재 = 소집 비활성**(ADR-0024 이전에 퇴역한 구 수호기 — build 없이 정규화된다).
   */
  build?: GuardianBuild;
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

// ---------------------------------------------------------------------------
// 기체 타입 레지스트리 (M8-L1 `data/ships/` 와 만나는 유일한 자리)
// ---------------------------------------------------------------------------

/**
 * save 층이 레지스트리에서 필요로 하는 것은 **타입별 노드 정의**뿐이다(타입 id 정규화는
 * 레지스트리의 `normalizeShipTypeId` 를 그대로 쓴다 — 규칙을 두 벌 두지 않는다).
 * 아래 한 함수로 좁혀 둔다: 레지스트리 형태가 바뀌어도 갈아끼울 자리가 여기 하나다.
 *
 * ⚠️ 노드 순서는 **`flattenShipNodes` 로만** 얻는다. `trees.flatMap((t) => t.nodes)` 로
 * 단순 concat 하면 안 된다 — flat 벡터의 실제 배치는 `[base 블록 전부][캡스톤 3개]` 라서
 * concat 은 인덱스를 밀어 ① 리플레이 해시 폴드 ② 파생 스탯 ③ 파워업 RNG 슬라이스의
 * 삼중 계약을 조용히 깬다(`data/ships/types.ts` §flat 벡터 레이아웃 계약).
 */
function shipTypeNodes(typeId: number): readonly SkillNode[] {
  return flattenShipNodes(shipTypeDef(typeId));
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultShip(typeId = 0, id = 'ship-0', name = '초기 전투기'): Ship {
  return {
    id,
    name,
    typeId,
    level: 1,
    xp: 0,
    equipped: {},
    skillInvest: zeroSkillInvest(typeId),
    // 액티브 스킬 장착 2칸(ADR-0041) — 신규 기체는 투자 0이라 아무것도 열려 있지 않다.
    activeSlots: [null, null],
  };
}

/**
 * A zeroed skill-investment vector for `typeId` (스트라이커 = SKILL_NODE_COUNT = 63).
 *
 * ⚠️ 항상 **새 배열**을 준다. 공유 배열을 돌려주면 한 기체의 투자가 다른 기체로 샌다
 * (신규 기체 지급·퇴역이 이 함수를 쓴다).
 *
 * ⚠️ 구현을 두 벌 두지 않는다 — 레지스트리(`data/ships/index.ts`)의 동명 함수에 **위임**한다.
 * 두 벌이면 노드 수 계산이 갈려 벡터 길이가 어긋날 수 있고, 길이는 리플레이 해시 폴드의
 * 계약이다(설계서 §1). 이 export 는 기존 save 층 독자를 위한 재수출일 뿐이다.
 */
export function zeroSkillInvest(typeId = 0): number[] {
  return registryZeroSkillInvest(typeId);
}

/**
 * A fresh profile — one starter ship, empty everything.
 *
 * ⚠️ 이것은 **스키마 기본값**이지 "새 플레이어의 프로필"이 아니다. 실제 신규 조종사에게
 * 주는 것은 {@link newPlayerProfile} 이고, 그쪽만 기본 장비를 싣는다. 둘을 합치지 마라 —
 * 이 함수는 sim·밸런스 스위트 전반이 **맨몸 기준선 픽스처**로 쓰고 있어서(전진 속도·명중
 * 피해·시그니처 대조군 등 24개 테스트가 이 값에 눈금을 맞춘다), 여기에 장비를 실으면
 * 그 기준선이 통째로 밀려 "무엇을 재고 있었는지"가 사라진다.
 */
export function defaultProfile(): Profile {
  const p: Profile = {
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
    tutorialDone: false,
    introSeen: false,
    lineage: emptyLineage(),
    guardians: [],
    collectedShards: [],
    storyMetrics: {},
    storyRewardsClaimed: [],
  };
  return p;
}


/**
 * **신규 조종사의 프로필** — {@link defaultProfile} 에 기본 장비 8칸을 실은 것.
 *
 * 저장된 세이브가 없을 때 실제로 주어지는 프로필이다. 맨몸으로 시작하면 Lv1~5 구간의
 * 단계1 클리어율이 실측 0.0% 다(`src/items/starterKit.ts` §왜 필요한가) — 즉 게임을 처음
 * 켠 사람이 아무것도 못 이기는 구간을 지나야 했다.
 */
export function newPlayerProfile(): Profile {
  const p = defaultProfile();
  const first = p.ships[0];
  if (first !== undefined) fillStarterEquipment(first.equipped);
  return p;
}

/** The active ship (falls back to the first, then a fresh default). */
export function activeShip(profile: Profile): Ship {
  return profile.ships[profile.activeShipIndex] ?? profile.ships[0] ?? defaultShip();
}

// ---------------------------------------------------------------------------
// Base-map unlocks + planet-clear progress (M3 plan E2, GDD §7)
// ---------------------------------------------------------------------------

/** Derive which base buildings are unlocked from the profile's live state. The
 *  unlock order (격납고·연구소 → 행성 1클리어 정제소 → M4 방어 사령부·관제탑)
 *  is surfaced by the base map as lock overlays (GDD §7).
 *  연구소는 `RESEARCH_UNLOCK_LEVEL = 1` 이라 사실상 상시 개방이다 — 조건을 지우지 않고
 *  상수 비교를 남겨 둔다(잠금 문구·테스트가 상수를 참조한다). */
export function computeUnlocks(profile: Profile): BaseUnlocks {
  const level = activeShip(profile).level;
  let anyClear = false;
  for (const p of Object.values(profile.planetProgress)) {
    if (p.bestStageCleared >= 1) {
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

/** Record a planet clear, keeping the highest 침략 단계 ever cleared there. Drives the
 *  정제소 unlock and 단계 개방 상한(ADR-0022). No-op if `stage` is not higher than
 *  the recorded best. */
export function recordPlanetClear(profile: Profile, planet: number, stage: number): void {
  const cur = profile.planetProgress[planet];
  if (cur === undefined || stage > cur.bestStageCleared) {
    profile.planetProgress[planet] = { bestStageCleared: stage };
  }
}

// ---------------------------------------------------------------------------
// Skill investment + respec (M3 plan A3)
// ---------------------------------------------------------------------------

/** Total points currently invested across the active ship's skill nodes. */
export function totalInvested(profile: Profile): number {
  let n = 0;
  for (const v of activeShip(profile).skillInvest) n += v;
  return n;
}

/**
 * Spend one banked skill point into node `index` **of the active ship** (M8 v4 —
 * 투자는 계정이 아니라 기체에 쌓인다). No-ops (returns false) when the index is out of
 * range, the node is already maxed, or no points are banked.
 *
 * ⚠️ 노드 정의·캡스톤 게이트는 **활성 기체 타입의 것**을 쓴다(M8 통합 게이트에서 일반화).
 * 스트라이커 정본(`SKILLS`/`capstoneUnlocked`)을 쓰던 구현은 실측상 다음 3가지를 조용히
 * 깼다 — 예외도 타입 오류도 나지 않아 단위 테스트가 전부 그린이었다:
 *   ① 노드 수가 63 을 넘는 타입(hatchling=78)의 인덱스 63~77 이 **영구 투자 불가**
 *   ② `maxPoints` 가 타입별로 다른 노드에서 상한 오판정(과투자 또는 조기 차단)
 *   ③ 캡스톤 판정이 스트라이커 flat 레이아웃(60~62)·게이트 폭(20/40)으로 이뤄져,
 *      다른 레이아웃의 타입은 **base 노드가 캡스톤으로 오인**되고 진짜 캡스톤은 투자 불가
 * 그래서 노드는 `flattenShipNodes(shipTypeDef(ship.typeId))`, 게이트는
 * `shipCapstoneUnlocked(invest, def, treeIndex)` 로만 얻는다.
 */
export function investSkill(profile: Profile, index: number): boolean {
  if (profile.skillPoints <= 0) return false;
  const ship = activeShip(profile);
  const def = shipTypeDef(ship.typeId);
  const node = flattenShipNodes(def)[index];
  if (node === undefined) return false;
  const invest = ship.skillInvest;
  const cur = invest[index] ?? 0;
  if (cur >= node.maxPoints) return false;
  // 최상위 캡스톤(GDD §4)은 해당 계열 base 게이트(`def.capstoneGate`)를 통과해야 투자 가능.
  // flat 레이아웃이 `[base 블록 전부][캡스톤 trees.length 개]` 이므로 계열 인덱스는
  // 캡스톤 블록 시작점으로부터의 오프셋이다.
  if (node.capstone === true) {
    const treeIndex = index - def.nodesPerTree * def.trees.length;
    if (!shipCapstoneUnlocked(invest, def, treeIndex)) return false;
  }
  // 사슬 선행 조건(ADR-0047): 같은 계열·같은 스탯의 더 낮은 티어가 전부 max 여야 한다.
  // 캡스톤은 사슬 밖이라 `chainPrereqMet` 이 항상 true 를 낸다(위 게이트가 유일한 조건).
  // 여기가 **유일한 관문**이다 — 파생(`computeSkillStats`)·sim·서버는 이 규칙을 모른다.
  if (!chainPrereqMet(invest, def, index)) return false;
  invest[index] = cur + 1;
  profile.skillPoints -= 1;
  return true;
}

/** Credit cost to respec the tree, scaled by the active ship's level (plan A3). */
export function respecCost(profile: Profile): number {
  return respecCostCredits(activeShip(profile).level);
}

/**
 * 리스펙 환급 **본체**(재화 무관): 투자 포인트를 전부 뱅크로 되돌리고 트리를 0 으로 만든다.
 * 스킬 포인트는 보존된다(환급 == 투자) — 리스펙은 진행도를 만들거나 없애지 않는다. 반환은
 * 환급한 포인트 수(투자가 없으면 0, 아무 변화 없음).
 *
 * 재화 서버 권위(ADR-0027): 크레딧 차감과 분리했다 — 온라인 경로는 서버 `spend_currency` 로
 * 먼저 차감을 확정한 뒤 이 함수로 환급만 하고, 오프라인은 {@link respecSkills} 가 로컬 차감 +
 * 이 함수를 함께 태운다.
 */
export function applyRespecRefund(profile: Profile): number {
  const invested = totalInvested(profile);
  if (invested === 0) return 0;
  profile.skillPoints += invested;
  // 제자리 0 채움. 새 배열로 갈아끼워도 지금은 무해하지만(M8-L7 이 별칭 필드를 삭제했다),
  // 화면이 렌더 도중 배열 참조를 들고 있는 경우가 있어 인스턴스를 유지하는 편이 안전하다.
  activeShip(profile).skillInvest.fill(0);
  return invested;
}

/**
 * Refund every invested point back to the banked pool and zero the tree, charging
 * `respecCost` credits **locally**. No-ops (returns false) when nothing is invested or
 * the player cannot afford the cost. Skill points are conserved (refunded == spent),
 * so a respec never creates or destroys progression.
 *
 * 재화 서버 권위(ADR-0027): 이 함수는 **미설정(오프라인 단일플레이) 폴백**이다 — 로컬 미러에서
 * 직접 차감한다. 온라인 경로(researchLab UI)는 서버 `spend_currency` 로 차감을 확정한 뒤
 * {@link applyRespecRefund} 로 환급만 한다(미러는 서버 잔액으로 세팅).
 */
export function respecSkills(profile: Profile): boolean {
  const invested = totalInvested(profile);
  if (invested === 0) return false;
  const cost = respecCost(profile);
  if (profile.credits < cost) return false;
  profile.credits -= cost;
  applyRespecRefund(profile);
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

/**
 * Resolve the ambient `localStorage`, or null when unavailable/blocked.
 *
 * ⚠️ `defaultProfileStore` 로도 export 한다 — 프로필 **밖**에 사는 로컬 상태
 * (일일 보상 모달의 마지막 표시 seed 등)가 같은 스토어를 써야 하기 때문이다. 자기
 * `localStorage` 를 직접 잡으면 하네스 프로필 슬롯이 격리될 때 그 상태만 실계정 것을
 * 계속 읽어, 치트로 하루를 넘겨도 모달이 안 뜨는 형태의 결함이 된다.
 */
function defaultStore(): KeyValueStore | null {
  if (defaultStoreOverride !== undefined) return defaultStoreOverride;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Access can throw in sandboxed / privacy-mode contexts.
  }
  return null;
}

/** {@link defaultStore} 의 공개 이름 — 프로필 밖 로컬 상태가 같은 스토어를 공유한다. */
export function defaultProfileStore(): KeyValueStore | null {
  return defaultStore();
}

/**
 * Load + migrate the stored profile. Any failure (no store, missing key, invalid
 * JSON, shape corruption) recovers to a fresh **new-player** profile (AC5).
 *
 * ⚠️ 폴백은 {@link defaultProfile} 이 아니라 {@link newPlayerProfile} 이다 — 이 경로에
 * 도달한 사람은 "세이브가 없는 조종사"이고, 그가 받아야 하는 것은 기본 장비가 실린 프로필이다.
 * (스키마 기본값과 신규 플레이어 프로필의 구분은 `defaultProfile` 주석 참조.)
 */
export function loadProfile(store: KeyValueStore | null = defaultStore()): Profile {
  if (store === null) return newPlayerProfile();
  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return newPlayerProfile();
  }
  if (raw === null) return newPlayerProfile();
  try {
    return migrate(JSON.parse(raw) as unknown);
  } catch {
    return newPlayerProfile();
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
  // 읽을 것이 없다 = 세이브가 없는 조종사다 → 기본 장비가 실린 신규 프로필(위 loadProfile 참조).
  if (typeof raw !== 'object' || raw === null) return newPlayerProfile();
  let data = raw as Record<string, unknown>;
  const version = typeof data.saveVersion === 'number' ? data.saveVersion : 0;
  if (version < 1) data = migrateV0toV1(data);
  if (version < 2) data = migrateV1toV2(data);
  if (version < 3) data = migrateV2toV3(data);
  if (version < 4) data = migrateV3toV4(data);
  if (version < 5) data = migrateV4toV5(data);
  if (version < 6) data = migrateV5toV6(data);
  if (version < 7) data = migrateV6toV7(data);
  if (version < 8) data = migrateV7toV8(data);
  if (version < 9) data = migrateV8toV9(data);
  if (version < 10) data = migrateV9toV10(data);
  return normalizeProfile(data);
}

/**
 * v9 → v10 (기본 장비 지급): **전 기체의 빈 장착 칸을 스타터 킷으로 채운다.**
 *
 * 스키마는 안 바뀐다 — v9 와 같은 데이터 정합 마이그레이션이다. `defaultShip()` 과 세대 교체
 * 기체가 여태 맨몸이었고, 그 상태의 Lv1~5 는 단계1 클리어율이 실측 0.0% 였다
 * (`requiredLevel.ts` §밴드 시작 기준). 신규만 고치면 **이미 만들어진 프로필은 영영 맨몸**이라
 * 여기서 소급 지급한다.
 *
 * **빈 칸만** 채운다(`fillStarterEquipment`). 이미 입고 있는 칸을 덮으면 파밍 장비가 스타터로
 * 바뀌는 데이터 손실이 된다. 퇴역 수호기의 `GuardianBuild.equipped` 는 **의도적으로 제외** —
 * 퇴역 순간 고정된 봉인 빌드라(ADR-0024) 소급 강화 대상이 아니다.
 *
 * 손상 방어: `ships` 가 배열이 아니거나 원소·`equipped` 가 객체가 아니면 그 칸은 건너뛴다
 * (`normalizeProfile` 이 뒤에서 다시 거른다). 심는 아이템은 `rollItem` 산출물이라
 * `isValidItem` shape guard 를 통과한다.
 */
function migrateV9toV10(v9: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...v9, saveVersion: 10 };
  if (!Array.isArray(out.ships)) return out;
  out.ships = out.ships.map((raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) return raw;
    const ship = raw as Record<string, unknown>;
    const eq = ship.equipped;
    // 손상/부재는 빈 칸 8개로 취급한다 — 여기서 버리는 것은 이미 정규화가 버렸을 값뿐이다.
    const equipped: Partial<Record<EquipSlotId, Item>> =
      typeof eq === 'object' && eq !== null
        ? ({ ...(eq as Record<string, unknown>) } as Partial<Record<EquipSlotId, Item>>)
        : {};
    fillStarterEquipment(equipped);
    return { ...ship, equipped };
  });
  return out;
}

/**
 * v8 → v9 (스킬 사슬 선행 조건, ADR-0047): **전 기체 무료 전액 리스펙.**
 *
 * 스키마는 안 바뀐다 — 이건 데이터 정합 마이그레이션이다. 사슬 규칙(같은 계열·같은 스탯의
 * 더 낮은 티어를 전부 max 해야 위 노드 투자 가능)이 여태 없었으므로 기존 벡터에는 위반
 * 배치가 얼마든지 있다. 그대로 두면 ① 규칙이 불변식이 아니게 되고 ② **리스펙 한 번이
 * 되돌릴 수 없는 손실**이 된다(`applyRespecRefund` 는 전액 초기화라, 털고 나면 규칙 때문에
 * 원래 배치로 못 돌아간다). 그 함정을 남기느니 여기서 한 번 털고 간다.
 *
 * 포인트는 **전액 환급**이라 진행도가 보존된다(리스펙 비용 없음). 장비·레벨·수호 로스터는
 * 손대지 않는다. 퇴역 수호기의 `GuardianBuild.skillInvest` 도 **의도적으로 제외** — 퇴역
 * 순간 고정된 스냅샷이고 투자 경로가 없어서(ADR-0024) 규칙의 적용 대상이 아니며, 털면
 * 기존 수호 전력만 소급 약화된다.
 *
 * 손상 방어: `ships` 가 배열이 아니거나 원소가 객체가 아니면 그 칸은 건너뛴다
 * (`normalizeProfile` 이 뒤에서 다시 거른다). 환급 누계는 유한 양수만 더한다.
 */
function migrateV8toV9(v8: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...v8, saveVersion: 9 };
  if (!Array.isArray(out.ships)) return out;
  let refund = 0;
  out.ships = out.ships.map((raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) return raw;
    const ship = raw as Record<string, unknown>;
    const invest = ship.skillInvest;
    if (!Array.isArray(invest)) return ship;
    for (const v of invest) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) refund += Math.trunc(v);
    }
    return { ...ship, skillInvest: invest.map(() => 0) };
  });
  if (refund > 0) {
    const banked = typeof out.skillPoints === 'number' && Number.isFinite(out.skillPoints)
      ? Math.trunc(out.skillPoints)
      : 0;
    out.skillPoints = banked + refund;
  }
  return out;
}

/**
 * v7 → v8 (액티브 스킬, ADR-0041): `Ship.activeSlots` 와 `GuardianBuild.activeSlots` 신설.
 * 둘 다 additive 라 마이그레이션은 **스탬프만 올린다**(`migrateV6toV7`·`migrateV1toV2` 선례).
 * 실제 채움은 `normalizeShip` → `normalizeActiveSlots`(빈 슬롯 2칸)와
 * `normalizeGuardianRecords` 가 맡으며, **기존 guardian 레코드도 그 경로를 반드시 통과**하므로
 * 구 수호기는 빈 슬롯 2칸으로 정규화된다(계획 PM-3 — "열려 있는데 안 끼워져 있는" 상태 방지).
 */
function migrateV7toV8(v7: Record<string, unknown>): Record<string, unknown> {
  return { ...v7, saveVersion: 8 };
}

/**
 * v6 → v7 (예비역 소집·장비 잠김, ADR-0024): `GuardianRecord.build`(퇴역 순간 고정 실물 빌드)
 * 신설. build 는 snapshot 의 형제 additive-optional 필드라 구 수호기는 그냥 build 가 없다(=소집
 * 비활성). 실제 파싱은 `normalizeGuardianRecords`(build 부재 → undefined)가 맡으므로 마이그레이션은
 * 스탬프만 올린다(migrateV1toV2·migrateV5toV6 선례). 기존 진행 상태(수호 로스터 포함)는 그대로 통과.
 */
function migrateV6toV7(v6: Record<string, unknown>): Record<string, unknown> {
  return { ...v6, saveVersion: 7 };
}

/**
 * v5 → v6 (스토리 시스템 Phase E, ADR-0023): `collectedShards` + `storyMetrics` 신설.
 * 두 필드는 신규 프로필에서 빈 값(수집·누적 전)이므로 마이그레이션은 스탬프만 올리고
 * (migrateV1toV2 선례), 실제 필드 채움은 `normalizeProfile`(빈 배열·빈 객체)이 맡는다.
 * 기존 유저는 파편 0개·마일스톤 0에서 시작한다(과거 런은 관측되지 않았으므로 정직한 초기값).
 */
function migrateV5toV6(v5: Record<string, unknown>): Record<string, unknown> {
  return { ...v5, saveVersion: 6 };
}

/**
 * v4 → v5 (ADR-0022 침략 단계): `planetProgress.bestTierCleared` → `bestStageCleared`.
 *
 * 구 티어(t) → 단계(t+1) 매핑으로 클리어 상태를 보존한다(미클리어 -1 → 0). 미출시라 정확
 * 매핑 저부담이다. ⚠️ 반드시 여기서 키를 먼저 옮겨야 한다 — `normalizeProgress` 가 이제
 * `bestStageCleared` 를 읽으므로, 이 마이그레이션 없이 v4 blob 이 normalize 를 통과하면
 * 구 `bestTierCleared` 값이 그대로 유실된다(하한 0 으로 리셋).
 */
function migrateV4toV5(v4: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...v4, saveVersion: 5 };
  const prog = v4.planetProgress;
  if (typeof prog === 'object' && prog !== null) {
    const next: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(prog as Record<string, unknown>)) {
      if (typeof val === 'object' && val !== null && 'bestTierCleared' in val) {
        const t = Number((val as Record<string, unknown>).bestTierCleared);
        next[k] = { bestStageCleared: Number.isFinite(t) && t >= 0 ? t + 1 : 0 };
      } else {
        next[k] = val;
      }
    }
    out.planetProgress = next;
  }
  return out;
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
 * v3 → v4 (M8 기체 챔피언화, ADR-0019): 계정 단위 `skillInvest` 를 **기체 단위**로 내린다.
 *
 * 기존 유저는 전원 스트라이커이므로 각 기체에 `typeId: 0` 을 찍고, 계정 벡터를 그대로
 * 승계시킨다 — **투자가 사라지지 않는 것이 이 마이그레이션의 유일한 존재 이유다.**
 * 승계 후 계정 키는 blob 에서 제거한다(정본은 기체 벡터 하나뿐이라는 것을 저장 형식 차원에서
 * 못박는다). M8-L7 이 계정 단위 필드를 삭제했으므로 투자 벡터를 읽는 자리는
 * `activeShip(profile).skillInvest` 하나뿐이다 — 두 독자가 갈라질 자리가 없다.
 *
 * 여러 기체가 있어도 전원이 같은 계정 벡터를 물려받는다 — v3 에는 기체별 투자라는 개념 자체가
 * 없었으므로 "그 유저가 실제로 굴리던 빌드"가 각 기체에 대한 유일하게 정직한 복원값이다.
 * (실제로 v3 세이브의 `ships` 는 항상 길이 1 이다 — 기체 추가 경로가 없었다.)
 *
 * DB 변경 없음: `profiles.save` 는 불투명 jsonb 이고 서버 SQL 은 `credits`/`minerals` 만 읽는다.
 */
function migrateV3toV4(v3: Record<string, unknown>): Record<string, unknown> {
  const account = v3.skillInvest;
  const out: Record<string, unknown> = { ...v3, saveVersion: 4 };
  if (Array.isArray(v3.ships)) {
    out.ships = v3.ships.map((s) => {
      if (typeof s !== 'object' || s === null) return s;
      const ship = s as Record<string, unknown>;
      // ⚠️ 벡터 정규화는 **그 기체의 타입**으로 해야 한다. 여기서 0 을 하드코딩하면, 노드 수가
      // 63 이 아닌 타입이 생기는 순간(M8-L6) 부분 v4 blob 의 벡터가 63 으로 잘린 뒤
      // normalizeShip 이 실제 길이로 0 패딩해 **꼬리 투자가 조용히 소실**된다.
      const typeId = normalizeShipTypeId(ship.typeId);
      return {
        ...ship,
        typeId,
        // 이미 기체 벡터가 있으면(부분 v4 blob) 그것을 우선하고, 없으면 계정 벡터를 승계.
        skillInvest: normalizeSkillInvest(ship.skillInvest ?? account, typeId),
      };
    });
  }
  delete out.skillInvest;
  return out;
}

/**
 * Normalize a stored skill vector for `typeId` to exactly that type's node count,
 * each an integer clamped to its node's [0, maxPoints]. Missing/extra/corrupt entries
 * recover to 0 so a partial save never over-invests. 60-length pre-capstone saves are
 * grown to 63 (new indices 60~62 = 0) — 하위 호환.
 */
export function normalizeSkillInvest(v: unknown, typeId = 0): number[] {
  const nodes = shipTypeNodes(typeId);
  const out = zeroSkillInvest(typeId);
  if (!Array.isArray(v)) return out;
  for (let i = 0; i < nodes.length; i++) {
    out[i] = clampInt(v[i], 0, nodes[i]?.maxPoints ?? 0, 0);
  }
  return out;
}

function normalizeProfile(d: Record<string, unknown>): Profile {
  const base = defaultProfile();
  const ships = Array.isArray(d.ships)
    ? d.ships.map(normalizeShip).filter((s): s is Ship => s !== null)
    : [];
  const finalShips = ships.length > 0 ? ships : base.ships;
  const out: Profile = {
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
    tutorialDone: d.tutorialDone === true,
    introSeen: d.introSeen === true,
    lineage: normalizeLineage(d.lineage),
    guardians: normalizeGuardianRecords(d.guardians),
    collectedShards: normalizeStringSet(d.collectedShards),
    storyMetrics: normalizeStoryMetrics(d.storyMetrics),
    storyRewardsClaimed: normalizeStringSet(d.storyRewardsClaimed),
    ...normalizeStoredLayout(d.defenseLayout),
  };
  return out;
}

/**
 * 문자열 id 집합(저장은 순서 있는 배열)을 정규화한다(Phase E). 수집 파편(`collectedShards`)과
 * 챕터 보상 원장(`storyRewardsClaimed`)이 공유한다 — 둘 다 "중복 없는 문자열 집합"이라
 * 비-문자열·빈 문자열을 걸러내고 중복을 제거한다(입력 순서 보존). 손상/부분 세이브는 빈 배열.
 * ⚠️ 여기서 id 가 정본(`RECORD_SHARDS`·챕터 claimId)에 실재하는지는 검사하지 않는다 — 표시·판정은
 * 정본을 순회하며 이 집합과 대조하므로, 정본에 없는 유령 id 는 자연히 어디에도 영향을 주지 않는다.
 */
function normalizeStringSet(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === 'string' && x.length > 0 && !seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/**
 * 사연 마일스톤 카운터 맵을 정규화한다(Phase E). 값은 유한 정수(음수는 0 하한, lineage 정규화
 * 선례)로 강제하고, 숫자가 아니거나 비유한인 손상 항목은 키째 버린다. 손상/부분 세이브는 빈 객체.
 * 위조 방어의 1차선은 아니지만(정산 격리가 담당), 손상 세이브가 유효 프로필이 되게 한다.
 */
function normalizeStoryMetrics(v: unknown): Record<string, number> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'number' && Number.isFinite(val)) {
      out[k] = clampInt(val, 0, Number.MAX_SAFE_INTEGER, 0);
    }
  }
  return out;
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

/**
 * 저장된 수호 기체 실물 빌드(ADR-0024, v7)를 정규화한다. build 블롭이 객체가 아니면(부재·손상)
 * undefined 를 돌려주고, 이때 레코드 자체는 유지된다(소집 비활성 = 구 수호기와 동일 상태).
 * typeId·equipped·skillInvest 는 **기존 정본 헬퍼로만** 정규화한다(규칙 중복 금지 — equipped 루프는
 * {@link normalizeShip} 과 동일 필터, typeId 는 normalizeShipTypeId, 벡터는 normalizeSkillInvest).
 */
function normalizeGuardianBuild(v: unknown): GuardianBuild | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const d = v as Record<string, unknown>;
  const typeId = normalizeShipTypeId(d.typeId);
  const equipped: Partial<Record<EquipSlotId, Item>> = {};
  if (typeof d.equipped === 'object' && d.equipped !== null) {
    for (const [slot, item] of Object.entries(d.equipped as Record<string, unknown>)) {
      if (isValidItem(item)) equipped[slot as EquipSlotId] = item;
    }
  }
  return {
    typeId,
    equipped,
    skillInvest: normalizeSkillInvest(d.skillInvest, typeId),
    // 액티브 장착 박제(v8, 계획 PM-3). 구 레코드는 필드가 없으므로 빈 슬롯 2칸으로 정규화된다 —
    // **기존 guardian 레코드까지 정규화**가 AC-15 의 요구다.
    activeSlots: normalizeActiveSlots(d.activeSlots, typeId),
  };
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
    // build 는 snapshot 의 형제(additive) — 부재/손상이어도 레코드는 유지(소집 비활성).
    const build = normalizeGuardianBuild(d.build);
    out.push({
      id,
      snapshot,
      performanceCP: normalizePerformance(numOr(d.performanceCP, PERFORMANCE_FULL)),
      combatScore: clampInt(d.combatScore, 0, Number.MAX_SAFE_INTEGER, 0),
      preset: normalizeGuardianPreset(numOr(d.preset, snapshot.preset)),
      retired: d.retired === true,
      ...(build !== undefined ? { build } : {}),
    });
  }
  return out;
}

/**
 * 저장된 3레이어 방어 배치를 얕게 보존한다: `l1`/`l2`/`l3` 꼴을 갖춘 객체면 그대로 통과시키고
 * (왕복 무손실), 아니면 필드를 생략한다 — 구 형식(core/turrets/obstacles)은 여기서 걸러진다.
 * 깊은 유효성은 `normalizeInvasionLayers`(sim 정본)가 사용 시점에 재검증하므로 여기서 sim
 * 상수를 끌어오지 않는다(레이어 최소 결합).
 */
function normalizeStoredLayout(v: unknown): { defenseLayout?: InvasionLayers } {
  if (typeof v !== 'object' || v === null) return {};
  const d = v as Record<string, unknown>;
  for (const k of ['l1', 'l2', 'l3']) {
    if (typeof d[k] !== 'object' || d[k] === null) return {};
  }
  return { defenseLayout: v as unknown as InvasionLayers };
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
  // ⚠️ typeId 는 반드시 유효 범위로 정규화한다. 범위 밖 값이 통과하면 `SHIP_TYPES[typeId]` 가
  // undefined 가 되어 트리·시그니처·baseBp 가 전부 빠진 채 **예외 없이 조용히** 중립 loadout
  // 으로 흘러간다(설계서 §6).
  //
  // 규칙은 `data/ships/index.ts` 의 `normalizeShipTypeId` **하나로 통일한다**: 범위 밖·손상은
  // 전부 0(스트라이커). 저장층에서 상한으로 clamp 하면(999 → 4) 손상 세이브가 유저에게
  // **조용히 다른 기체를 쥐여 준다** — 트리도 시그니처도 다른 기체다. 0 복귀는 최소한
  // "기본 기체로 돌아갔다" 는 설명 가능한 상태이고, 조회층(shipTypeDef)과 규칙이 같아져
  // 저장·조회가 어긋날 여지도 사라진다.
  const typeId = normalizeShipTypeId(s.typeId);
  return {
    id: typeof s.id === 'string' ? s.id : 'ship-0',
    name: typeof s.name === 'string' ? s.name : '초기 전투기',
    typeId,
    level: Math.max(1, numOr(s.level, 1)),
    xp: Math.max(0, numOr(s.xp, 0)),
    equipped,
    skillInvest: normalizeSkillInvest(s.skillInvest, typeId),
    activeSlots: normalizeActiveSlots(s.activeSlots, typeId),
  };
}

/**
 * 액티브 스킬 장착 2칸을 정규화한다(ADR-0041 · SAVE_VERSION 8).
 *
 * **길이 2 고정 · 빈 슬롯 `null` · 중복 제거 · 그 기체 타입의 스킬이 아니면 탈락**.
 * `typeId` 검사가 중요한 이유: 하네스 치트나 손상 세이브가 타입을 바꿔도 옛 타입의 스킬이
 * 슬롯에 남으면 런에서 조용히 무발동이 된다(sim 이 `shipTypeId` 불일치를 걸러낸다).
 * 여기서 미리 떨어뜨려 UI 와 sim 이 같은 것을 본다.
 */
function normalizeActiveSlots(v: unknown, typeId: number): (string | null)[] {
  const out: (string | null)[] = [null, null];
  if (!Array.isArray(v)) return out;
  const seen = new Set<string>();
  for (let i = 0; i < ACTIVE_SLOT_COUNT; i++) {
    const raw = v[i];
    if (typeof raw !== 'string') continue;
    if (seen.has(raw)) continue;
    const def = activeById(raw);
    if (def === undefined || def.shipTypeId !== typeId) continue;
    seen.add(raw);
    out[i] = raw;
  }
  return out;
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
      // 하한 0(미클리어), 상한 넉넉히(무한 단계 축). v4→v5 마이그레이션이 이미 키를 옮겼다.
      out[id] = { bestStageCleared: clampInt(p.bestStageCleared, 0, 99999, 0) };
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
