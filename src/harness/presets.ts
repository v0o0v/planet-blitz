/**
 * 하네스 프로필 프리셋 (개발 도구, DEV 전용).
 *
 * A preset is a ready-made {@link Profile} the harness can inject into the
 * isolated 하네스 프로필 slot so a tester can jump straight into a given account
 * state. Presets are built with the SAME deterministic item generator the real
 * game uses (`rollItem`), so the gear they equip is valid, reproducible and
 * indistinguishable from farmed loot — no hand-forged `Item` structs.
 *
 * Pure: `buildPreset` takes no ambient state and returns a fresh profile every
 * call, so it is unit-testable under the `node` vitest environment.
 *
 * M7a(L8) 확장: 프리셋에는 두 종류가 있다.
 *  - **프로필 프리셋**(`fresh`/`maxed`) — 계정 상태. `buildPreset` 가 만든다.
 *  - **3레이어 배치 프리셋**(`def3-*`) — 침공 방어 배치({@link InvasionLayers}).
 *    {@link buildInvasionPreset} 가 만들고, 하네스 침공 런의 방어 측 입력이 된다.
 * 둘 다 **결정론**이다 — Math.random/Date.now 를 쓰지 않으므로 같은 프리셋은 항상 같은
 * 바이트를 낸다(해시 스트림 재현 가능 — ADR-0005 와 정합).
 */

import { rollItem } from '../items/roll.js';
import type { Item, Rarity, SlotKind } from '../items/types.js';
import { EQUIP_SLOTS } from '../items/types.js';
import type { EquipSlotId } from '../items/types.js';
import { defaultProfile } from '../save/profile.js';
import type { Profile } from '../save/profile.js';
import {
  INVASION_ASCENSION_MAX,
  INVASION_CORE_HP,
  INVASION_LEVEL_MAX,
  INVASION_RARITY_COUNT,
  INVASION_SOCKET_COUNTS,
  MAP_TEMPLATE_CURVED,
  MAP_TEMPLATE_STRAIGHT,
  normalizeInvasionLayers,
} from '../sim/invasion/index.js';
import type {
  InvasionGuardianPlacement,
  InvasionLayers,
  InvasionRef,
} from '../sim/invasion/index.js';
import {
  GUARDIAN_INTERCEPTOR,
  GUARDIAN_TITAN,
  PERFORMANCE_FULL,
  makeGuardianSnapshot,
} from '../../data/guardian.js';
import { FORMATION_COUNT } from '../../data/invasion/formations.js';
import { FACILITY_CATALOG_COUNT } from '../../data/invasion/facilities.js';
import { L3_PROP_COUNT } from '../../data/invasion/props.js';
import { DEFENSE_BOSS_COUNT } from '../../data/invasion/defenseBosses.js';

/**
 * 프로필 프리셋 종류.
 *  - `fresh`       brand-new pilot(기본 프로필).
 *  - `maxed`       endgame(만렙 기체·풀 장비).
 *  - `gearLocked`  저레벨(Lv10) 기체 + 인벤토리에 **요구 레벨 미달** 고급 장비 다수(ADR-0030).
 *    격납고 인벤토리 셀 회색화·req 빨강·클릭 무동작을 실측하기 위한 프리셋(Verification Step 3·AC4).
 */
export type ProfilePresetKind = 'fresh' | 'maxed' | 'gearLocked';

/** 프로필 프리셋 목록(치트 패널 셀렉트·테스트 파생용 — {@link INVASION_PRESET_KINDS} 와 대칭). */
export const PROFILE_PRESET_KINDS: readonly ProfilePresetKind[] = [
  'fresh',
  'maxed',
  'gearLocked',
];

/**
 * 3레이어 배치 프리셋 종류(M7a L8).
 *  - `def3-empty`  전 슬롯 비움 → 스폰 단계에서 **기본 수비대**가 전부 충원(하한 난이도).
 *  - `def3-mid`    절반 배치 + 중간 레벨(표준 난이도).
 *  - `def3-maxed`  전 슬롯 만렙·최대 승급·유니크(상한 난이도).
 */
export type InvasionPresetKind = 'def3-empty' | 'def3-mid' | 'def3-maxed';

/** 하네스가 다루는 프리셋 전체(프로필 + 3레이어 배치). */
export type PresetKind = ProfilePresetKind | InvasionPresetKind;

/** 3레이어 배치 프리셋 목록(치트 패널 셀렉트 · 테스트 파생용). */
export const INVASION_PRESET_KINDS: readonly InvasionPresetKind[] = [
  'def3-empty',
  'def3-mid',
  'def3-maxed',
];

/** `kind` 가 3레이어 배치 프리셋인가(프로필 프리셋과의 분기 판별). */
export function isInvasionPreset(kind: PresetKind): kind is InvasionPresetKind {
  return (INVASION_PRESET_KINDS as readonly string[]).includes(kind);
}

/** The equip position → slot kind the item at that position must be. */
const SLOT_KIND_FOR: Record<EquipSlotId, SlotKind> = {
  main: 'main',
  sub: 'sub',
  armor: 'armor',
  shield: 'shield',
  engine: 'engine',
  core: 'core',
  module0: 'module',
  module1: 'module',
};

/**
 * Roll an item of a specific slot kind + rarity by scanning drop seeds until the
 * generator yields the wanted slot. `rollItem` picks the slot from the seed, so
 * we brute-force forward from `startSeed` (bounded) — deterministic in
 * (startSeed, slotKind, rarity, wantAffixes). Falls back to the last roll if no
 * match is found within the cap (never happens for the seven slot kinds in
 * practice).
 *
 * `wantAffixes` (선택): 어픽스 개수까지 고정하고 싶을 때 지정한다(예: rare 6개 → reqLevel 50).
 * 지정하면 슬롯 + 어픽스 개수가 모두 맞는 첫 시드를 쓴다. 24종 어픽스 풀이면 6-어픽스 rare
 * 는 스캔 창 안에서 항상 나온다(rare 어픽스 수는 3~6 균등).
 */
function rollItemForSlot(
  startSeed: number,
  slotKind: SlotKind,
  rarity: Rarity,
  wantAffixes?: number,
): Item {
  const source = { planet: 0, stage: 11 };
  let last = rollItem(startSeed >>> 0, rarity, source);
  for (let i = 0; i < 4096; i++) {
    const item = rollItem((startSeed + i) >>> 0, rarity, source);
    if (
      item.slot === slotKind &&
      (wantAffixes === undefined || item.affixes.length === wantAffixes)
    ) {
      return item;
    }
    last = item;
  }
  return last;
}

/** Equip a decent item into every one of the eight positions (deterministic). */
function buildMaxedEquip(): Partial<Record<EquipSlotId, Item>> {
  const equipped: Partial<Record<EquipSlotId, Item>> = {};
  let seed = 0x5eed_0001;
  for (const pos of EQUIP_SLOTS) {
    // Main slot rolls a unique (showcases the unique-effect path); the rest roll
    // rare (three-to-six affixes — "decent" endgame gear).
    const rarity: Rarity = pos === 'main' ? 'unique' : 'rare';
    equipped[pos] = rollItemForSlot(seed, SLOT_KIND_FOR[pos], rarity);
    // Advance the seed well past the scanned window so positions don't collide.
    seed = (seed + 0x1_0000) >>> 0;
  }
  return equipped;
}

/**
 * 격납고 '장비 잠김' 인벤토리를 만든다(ADR-0030). Lv10 기체로는 착용 불가한 고 reqLevel
 * 장비와, 대조용으로 착용 가능한 저 reqLevel 장비를 섞는다. 모두 실제 게임과 같은 결정론
 * 생성기(`rollItem`)로 만들어 손으로 빚은 `Item` 구조체가 아니다(어픽스 개수로 req 가 파생됨).
 *
 * reqLevel 산식(src/items/requiredLevel.ts): normal=1, rare=32+어픽스×3, unique=저작값.
 * 유니크 id 는 `rollItem`(rarity=unique)이 슬롯별 레지스트리(data/uniques.ts)에서 뽑으므로
 * 항상 실재 등록 id 라 `requiredLevel` 이 throw 하지 않는다.
 */
function buildGearLockedInventory(): Item[] {
  const items: Item[] = [];
  let seed = 0x10c_0001; // "loc(ked)"
  /** 슬롯·등급(선택적 어픽스 수)으로 1점 굴려 담고 시드를 스캔 창 밖으로 전진시킨다. */
  const push = (slotKind: SlotKind, rarity: Rarity, wantAffixes?: number): void => {
    items.push(rollItemForSlot(seed, slotKind, rarity, wantAffixes));
    seed = (seed + 0x1_0000) >>> 0;
  };

  // 착용 가능 대조군: normal 은 항상 reqLevel = 1 이라 Lv10 기체로 착용 가능(경계 확인용).
  push('main', 'normal');
  push('engine', 'normal');

  // 미달(locked) rare 다수: reqLevel = 32 + 어픽스×3. 6어픽스 → 50, 3어픽스여도 41 > 10.
  push('armor', 'rare', 6); // reqLevel 50
  push('shield', 'rare', 5); // reqLevel 47
  push('core', 'rare', 4); // reqLevel 44

  // 미달(locked) unique: 슬롯별 저작 reqLevel. sub={drone-bay 22 · singularity 75},
  // armor={phase-armor 18 · reactive-armor 65}. 어느 쪽이 뽑혀도 전부 10 초과라 잠긴다.
  push('sub', 'unique');
  push('armor', 'unique');

  return items;
}

/**
 * Build a fresh profile for `kind`. `fresh` is the game's default profile (new
 * pilot, tutorial pending). `maxed` is an endgame account: a level-100 ship in
 * full rare/unique gear, a big currency + skill-point float, and the tutorial
 * already cleared so the base map is the hub. `gearLocked` is a low-level (Lv10)
 * pilot whose inventory holds high-reqLevel gear it cannot yet equip — the
 * 격납고 잠금 셀(회색화·req 빨강·클릭 무동작)을 실측하기 위한 프리셋(ADR-0030).
 */
export function buildPreset(kind: ProfilePresetKind): Profile {
  const profile = defaultProfile();
  if (kind === 'fresh') return profile;

  if (kind === 'gearLocked') {
    const lowShip = profile.ships[0];
    if (lowShip !== undefined) {
      lowShip.level = 10;
      lowShip.xp = 0;
    }
    // 격납고(항상 해금)에서 인벤토리를 바로 보도록 튜토리얼은 완료 처리.
    profile.tutorialDone = true;
    profile.inventory = buildGearLockedInventory();
    return profile;
  }

  // maxed
  const ship = profile.ships[0];
  if (ship !== undefined) {
    ship.level = 100;
    ship.xp = 0;
    ship.equipped = buildMaxedEquip();
  }
  profile.credits = 999_999;
  profile.minerals = 999_999;
  profile.skillPoints = 100;
  profile.tutorialDone = true;
  // Record a clear on the two starter planets so 정제소 unlocks + 높은 단계까지 개방된다.
  profile.planetProgress = {
    0: { bestStageCleared: 20 },
    1: { bestStageCleared: 20 },
  };
  return profile;
}

// ---------------------------------------------------------------------------
// 3레이어 배치 프리셋 (M7a L8)
// ---------------------------------------------------------------------------

/** 어픽스 시드 파생 상수(황금비 해시 — RNG 없이 슬롯마다 다른 시드를 준다). */
const AFFIX_SEED_STEP = 0x9e37_79b1;

/**
 * 슬롯 1칸의 방어체 참조를 결정론으로 만든다. `catalogId` 는 카탈로그 개수로 감싸(modulo)
 * 임시 카탈로그(M7a 11종)가 M7c 에서 늘어나도 항상 유효 인덱스가 되게 한다.
 */
function slotRef(
  catalogCount: number,
  index: number,
  level: number,
  ascension: number,
  rarity: number,
): InvasionRef {
  const count = catalogCount > 0 ? catalogCount : 1;
  return {
    catalogId: index % count,
    level,
    ascension,
    affixSeed: ((index + 1) * AFFIX_SEED_STEP) >>> 0,
    rarity,
  };
}

/** 프리셋 수호 배치 1기(퇴역 스냅샷 복사 — 실제 퇴역 경로와 동일한 생성기를 쓴다). */
function guardianSlot(
  preset: number,
  combatScore: number,
  x: number,
  y: number,
  lineageBonusBp: number,
  milestones: number,
): InvasionGuardianPlacement {
  return {
    x,
    y,
    snapshot: makeGuardianSnapshot(preset, combatScore),
    performanceCP: PERFORMANCE_FULL,
    lineageBonusBp,
    milestones,
  };
}

/** 등급 코드 상한(0=normal … 3=unique). */
const RARITY_UNIQUE = INVASION_RARITY_COUNT - 1;

/**
 * 3레이어 배치 프리셋을 만든다. 반환값은 항상 {@link normalizeInvasionLayers} 정규형이라
 * 그대로 `WorldConfig.invasion3.layers` 로 넣을 수 있고, 해시·위조 대조와도 정합한다.
 *
 * 빈 슬롯을 남기는 것은 결함이 아니라 설계다 — `def3-empty` 는 **기본 수비대 자동 충원**
 * (L9)이 런을 끝까지 돌리는지 검증하는 하한 케이스다.
 */
export function buildInvasionPreset(kind: InvasionPresetKind): InvasionLayers {
  if (kind === 'def3-empty') return normalizeInvasionLayers(undefined);

  const maxed = kind === 'def3-maxed';
  const level = maxed ? INVASION_LEVEL_MAX : 10;
  const ascension = maxed ? INVASION_ASCENSION_MAX : 1;
  const rarity = maxed ? RARITY_UNIQUE : 1;
  // 굴곡형(10소켓) = 중간, 직선형(12소켓) = 최대 물량.
  const templateId = maxed ? MAP_TEMPLATE_STRAIGHT : MAP_TEMPLATE_CURVED;
  const socketCount = INVASION_SOCKET_COUNTS[templateId] ?? 0;
  /** mid 는 짝수 슬롯만 채운다(절반 배치). maxed 는 전부. */
  const filled = (i: number): boolean => maxed || i % 2 === 0;

  const waveSlots = Array.from({ length: 6 }, (_, i) =>
    filled(i) ? slotRef(FORMATION_COUNT, i, level, ascension, rarity) : null,
  );
  const sockets = Array.from({ length: socketCount }, (_, i) =>
    filled(i) ? slotRef(FACILITY_CATALOG_COUNT, i, level, ascension, rarity) : null,
  );
  const props = Array.from({ length: 6 }, (_, i) =>
    filled(i) ? slotRef(L3_PROP_COUNT, i, level, ascension, rarity) : null,
  );
  const modules = Array.from({ length: 2 }, (_, i) =>
    filled(i) ? slotRef(1, i, level, ascension, rarity) : null,
  );

  const guardians: (InvasionGuardianPlacement | null)[] = [
    guardianSlot(GUARDIAN_TITAN, maxed ? 900 : 300, -260, -180, maxed ? 5000 : 1000, maxed ? 7 : 0),
    maxed ? guardianSlot(GUARDIAN_INTERCEPTOR, 900, 260, -180, 5000, 7) : null,
  ];

  return normalizeInvasionLayers({
    l1: { waveSlots },
    l2: { templateId, sockets },
    l3: {
      boss: slotRef(DEFENSE_BOSS_COUNT, 0, level, ascension, rarity),
      guardians,
      props,
      core: { hp: INVASION_CORE_HP, x: 0, y: 0 },
      modules,
    },
  });
}
