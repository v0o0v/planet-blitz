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
 * ## ⚠️ 강화 폭 상한 (2026-08-01 밸런스 지시)
 *
 * **피해 배율은 어떤 파워업이든 최대 +10% 다.** 그 외 배율·정수 가산도 기준값의 대략
 * 5~15% 안에 둔다(기준: 최대 HP 100 · 이동 속도 720 · 대시 재충전 42틱 · 발사 간격 6틱).
 * 예전에는 +35%(고폭탄)·+45%(과충전 코일)까지 있었는데, 런당 레벨업이 5~7회라 한 런에서
 * 피해가 몇 배로 뛰어 **레벨업을 몇 번 뽑았는가가 무대 난이도를 압도**했다.
 *
 * 새 파워업을 추가하거나 기존 값을 올릴 때 **이 상한을 먼저 확인해라.**
 * `tests/powerupMagnitude.test.ts` 가 `POWERUPS` 를 전수 순회하며 기계적으로 못 박는다.
 *
 * ⚠️ **발사 간격은 정수 틱이라 배율이 그대로 반영되지 않는다.** 기본 발칸은 6틱이라 한 단계가
 * 1틱(−16.7%)이고, 배율 0.92 든 0.9 든 반올림하면 같은 5틱이 된다. 무기별 기본 간격이 클수록
 * 배율 차이가 드러난다 — "퍼센트를 낮췄는데 실측이 안 변한다"면 이 반올림을 먼저 의심해라.
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
import type { PlanetMode } from './planetMode.js';
import { activeByWireId } from '../../data/ships/actives/index.js';
import { ACTIVE_WIRE_EMPTY } from '../../data/ships/actives/types.js';
import { commissionBansPowerupLine } from './commissionOrders.js';

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
  /** 행성 모드 문맥 태그(Lane2 훅, ADR-0021). 지정 시 그 모드 런에서만 후보. 미지정 = 전 모드. */
  readonly mode?: PlanetMode;
  /**
   * 액티브 스킬 슬롯 태그(ADR-0041 · 계획 0a-9). 지정 시 **그 슬롯에 무언가 장착돼 있을 때만**
   * 후보에 오른다 — `weaponType`/`mode` 필터와 **같은 축의 `continue` 필터**다.
   *
   * ⚠️ 이 형태가 아니면 AC-G1 이 깨진다. `pool`/`weights` 는 매 호출 재구성되므로, 미장착 시
   * pool 진입 자체를 막으면 길이·가중 총합이 **바이트 동일**하다. 반대로 항목만 append 하고
   * 필터를 안 넣으면 가중 총합이 바뀌어 **같은 시드에서도 뽑히는 파워업이 통째로 달라진다**
   * (계획 PM-2 — AC-25 가 보증하지 않는 스펙의 사각).
   */
  readonly activeSlot?: 0 | 1;
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
    desc: '발칸 발사 간격 -10%',
    weaponType: 0,
    apply: (s) => {
      s.weapon.fireCooldown = Math.max(2, Math.round(s.weapon.fireCooldown * 0.9));
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
    desc: '탄환 데미지 +8%',
    universal: true,
    apply: (s) => {
      s.weapon.damage = Math.round(s.weapon.damage * 1.08 * 100) / 100;
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
    desc: '이동 속도 +6%',
    affinity: 'utility',
    apply: (s) => {
      s.config.playerSpeed = Math.round(s.config.playerSpeed * 1.06);
    },
  },
  {
    id: 'dash-coils',
    name: '대시 코일',
    desc: '대시 재충전 -8%',
    affinity: 'utility',
    apply: (s) => {
      s.config.dashCooldownTicks = Math.max(12, Math.round(s.config.dashCooldownTicks * 0.92));
    },
  },
  {
    id: 'reinforced-hull',
    name: '강화 장갑',
    desc: '최대 HP +10, 즉시 회복',
    affinity: 'defense',
    apply: (s) => {
      const p = player(s);
      if (p !== undefined) {
        p.maxHp += 10;
        p.hp = Math.min(p.maxHp, p.hp + 10);
      }
      s.config.playerHp += 10;
    },
  },
  {
    id: 'gem-magnet',
    name: '자기장 코일',
    desc: '젬 흡수 반경 +15%',
    affinity: 'utility',
    apply: (s) => {
      s.magnetRadius = Math.round(s.magnetRadius * 1.15);
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
    desc: '탄환 데미지 +10% (스프레드)',
    weaponType: 1,
    apply: (s) => {
      s.weapon.damage = Math.round(s.weapon.damage * 1.1 * 100) / 100;
    },
  },
  {
    id: 'rail-penetrator',
    name: '관통 강화 코어',
    desc: '관통 +1 (레일건)',
    weaponType: 2,
    apply: (s) => {
      s.weapon.pierce += 1;
    },
  },
  {
    id: 'rail-overcharge',
    name: '과충전 코일',
    desc: '탄환 데미지 +10%, 탄속 +8% (레일건)',
    weaponType: 2,
    apply: (s) => {
      s.weapon.damage = Math.round(s.weapon.damage * 1.1 * 100) / 100;
      s.weapon.bulletSpeed = Math.round(s.weapon.bulletSpeed * 1.08 * 100) / 100;
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
    desc: '탄환 데미지 +10% (미사일)',
    weaponType: 3,
    apply: (s) => {
      s.weapon.damage = Math.round(s.weapon.damage * 1.1 * 100) / 100;
    },
  },
  {
    id: 'beam-intensifier',
    name: '빔 증폭기',
    desc: '탄환 데미지 +10% (빔)',
    weaponType: 4,
    apply: (s) => {
      s.weapon.damage = Math.round(s.weapon.damage * 1.1 * 100) / 100;
    },
  },
  {
    id: 'beam-focuser',
    name: '집속 렌즈',
    desc: '사거리 +120 (빔 세그먼트 연장)',
    weaponType: 4,
    apply: (s) => {
      s.weapon.range += 120;
    },
  },
  // --- 16..21: skill-tree derived (2 per tree) ---
  {
    id: 'fp-focus',
    name: '화력 집중',
    desc: '탄환 데미지 +8%',
    affinity: 'offense',
    apply: (s) => {
      s.weapon.damage = Math.round(s.weapon.damage * 1.08 * 100) / 100;
    },
  },
  {
    id: 'fp-cadence',
    name: '속사 조율',
    desc: '발사 간격 -8%',
    affinity: 'offense',
    apply: (s) => {
      s.weapon.fireCooldown = Math.max(2, Math.round(s.weapon.fireCooldown * 0.92));
    },
  },
  {
    id: 'sv-plating',
    name: '보강 도금',
    desc: '최대 HP +12, 즉시 회복',
    affinity: 'defense',
    apply: (s) => {
      const p = player(s);
      if (p !== undefined) {
        p.maxHp += 12;
        p.hp = Math.min(p.maxHp, p.hp + 12);
      }
      s.config.playerHp += 12;
    },
  },
  {
    id: 'sv-evasion',
    name: '회피 부스터',
    desc: '대시 재충전 -8%',
    affinity: 'defense',
    apply: (s) => {
      s.config.dashCooldownTicks = Math.max(12, Math.round(s.config.dashCooldownTicks * 0.92));
    },
  },
  {
    id: 'mb-overdrive',
    name: '기동 오버드라이브',
    desc: '이동 속도 +5%',
    affinity: 'utility',
    apply: (s) => {
      s.config.playerSpeed = Math.round(s.config.playerSpeed * 1.05);
    },
  },
  {
    id: 'mb-collector',
    name: '수집 증폭',
    desc: '젬 흡수 반경 +12%',
    affinity: 'utility',
    apply: (s) => {
      s.magnetRadius = Math.round(s.magnetRadius * 1.12);
    },
  },
  // --- 22..23: universal ---
  {
    id: 'muzzle-velocity',
    name: '고속 사출',
    desc: '탄속 +8%',
    universal: true,
    apply: (s) => {
      s.weapon.bulletSpeed = Math.round(s.weapon.bulletSpeed * 1.08 * 100) / 100;
    },
  },
  {
    id: 'field-medkit',
    name: '야전 응급팩',
    desc: '최대 HP +8, 즉시 회복',
    universal: true,
    apply: (s) => {
      const p = player(s);
      if (p !== undefined) {
        p.maxHp += 8;
        p.hp = Math.min(p.maxHp, p.hp + 8);
      }
      s.config.playerHp += 8;
    },
  },
  // --- 24..25: 액티브 스킬 강화(ADR-0041 · APPEND-ONLY) ---------------------------------------
  // 장착한 슬롯에만 후보로 오른다(`activeSlot` 태그 + `drawPowerupChoices` 의 `continue` 필터).
  // 미장착 런은 **pool 진입 자체가 없어** 길이·가중 총합이 바이트 동일하다(계획 PM-2).
  //
  // ## 왜 "계열 투자 +N" 인가 — 신규 상태 0
  // 액티브의 위력·쿨다운은 이미 `investedInTree(config.skillInvest, def)` 에서만 파생한다
  // (AC-13 "값은 `skillInvest` 에서만 파생한다"). 그래서 그 계열 투자를 올리는 것이
  // **신규 필드·신규 해시 폴드 없이** 강화를 표현하는 형태다 — `skillInvest` 는 이미 매 틱
  // 폴드되고(`replay.ts:383-390`), `config.skillInvest` 는 `buildRunConfig` 가 만든
  // **복사본**이라 런 중 변형이 프로필로 새지 않는다.
  // 부수로 파워업 가중(`investedInAffinity`)도 같이 오르는데, 그것도 결정론적 파생이라
  // 리플레이·EF 재실행이 그대로 재현한다.
  {
    id: 'active-tune-1',
    name: '슬롯 1 조율',
    desc: '슬롯 1 액티브의 계열 투자 +2 (위력↑ · 쿨다운↓)',
    activeSlot: 0,
    apply: (s) => {
      bumpActiveTree(s, 0);
    },
  },
  {
    id: 'active-tune-2',
    name: '슬롯 2 조율',
    desc: '슬롯 2 액티브의 계열 투자 +2 (위력↑ · 쿨다운↓)',
    activeSlot: 1,
    apply: (s) => {
      bumpActiveTree(s, 1);
    },
  },
];

/** 액티브 강화 파워업 1회당 올려 주는 계열 base 누적 포인트. */
const ACTIVE_TUNE_POINTS = 2;

/**
 * 슬롯에 장착된 액티브가 속한 계열의 base 누적 투자를 올린다. 미장착·미지 wire 면 무연산.
 * 누적 지점은 그 계열 base 구간의 **첫 인덱스**로 고정한다 — 합만 읽히므로 어느 칸이든
 * 결과가 같지만, 고정해야 결정론과 감사 가능성이 유지된다.
 */
function bumpActiveTree(state: WorldState, slot: number): void {
  const wire = state.config.activeSlots?.[slot] ?? -1;
  const def = activeByWireId(wire);
  if (def === undefined) return;
  const invest = state.config.skillInvest;
  if (invest === undefined) return;
  const { start } = shipTreeRange(shipTypeDef(def.shipTypeId), def.treeIndex);
  invest[start] = (invest[start] ?? 0) + ACTIVE_TUNE_POINTS;
}

// --- Soft-weighting tuning (integer weights → deterministic weighted draw) -----
const WEIGHT_UNIVERSAL = 10;
const WEIGHT_WEAPON_MATCH = 28;
const WEIGHT_TREE_BASE = 4;
/** 행성 모드 매치 가중(Lane2 훅). 필터가 불일치를 이미 걷어내므로 도달분은 항상 일치다. */
const WEIGHT_MODE_MATCH = 22;
/** 액티브 슬롯 장착 매치 가중(ADR-0041). 모드 매치와 같은 결 — 필터가 미장착을 이미 걷어낸다. */
const WEIGHT_ACTIVE_SLOT = 22;
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

/**
 * 이 강화가 **지금 무기에서 의미가 있는가**. 무기 전용 강화는 다른 무기에 붙으면 효과가
 * 없거나(피해 배율은 그 무기 분기에서만 읽힌다) 엉뚱한 스탯만 건드린다. 예전에는 낮은
 * 가중값(2)으로 남겨 뒀는데, 낮을 뿐 0 이 아니라 **실제로 뽑혔다** — 벌컨 빌드 24시드 중
 * 1시드가 빔 전용 '집속 렌즈'(사거리 +320)를 먹는 것이 7기체 전부에서 관측됐고, 당시
 * `0 = 무제한` 사거리 의미론과 맞물려 그 한 시드는 사격이 통째로 멎었다. 의미론은
 * 고쳐졌지만 "쓸모없는 선택지를 제시한다"는 문제는 남으므로 아예 후보에서 뺀다.
 */
function offBuildWeaponPowerup(def: PowerupDef, state: WorldState): boolean {
  return def.weaponType !== undefined && def.weaponType !== state.weapon.weaponType;
}

/**
 * 이 강화가 **지금 장착 상태**에서 의미가 있는가(액티브 슬롯 전용 강화의 대칭 필터, ADR-0041).
 *
 * ⚠️ `config.activeSlots` 는 **미장착 시 필드 자체가 없다**(조건부 스탬프, `runConfig.ts`) —
 * `?? []` 정규화가 필수다(`catalysts` 폴드와 같은 형태). 런 시작 config 만 읽으므로 결정론적
 * 이고, 미장착 런에서는 인덱스 24·25 가 **pool 에 들어가지 않아** 가중 총합이 바이트 동일하다.
 */
function offSlotActivePowerup(def: PowerupDef, state: WorldState): boolean {
  if (def.activeSlot === undefined) return false;
  const slots = state.config.activeSlots ?? [];
  return (slots[def.activeSlot] ?? ACTIVE_WIRE_EMPTY) === ACTIVE_WIRE_EMPTY;
}

/**
 * 이 강화가 **지금 행성 모드**에서 의미가 있는가(모드 전용 강화의 대칭 필터).
 * 런 시작 config 의 `planetMode`(런 내내 고정)만 읽으므로 결정론적이다 — 런 중 상태
 * (레벨·킬 등)를 절대 보지 않는다.
 */
function offModePowerup(def: PowerupDef, state: WorldState): boolean {
  return def.mode !== undefined && def.mode !== ((state.config.planetMode ?? 0) >>> 0);
}

/** Soft weight of a powerup given the run's build (always ≥ 1). */
function powerupWeight(def: PowerupDef, state: WorldState): number {
  if (def.universal) return WEIGHT_UNIVERSAL;
  // 오프모드도 `drawPowerupChoices` 가 애초에 풀에 넣지 않으므로 여기 오면 항상 일치다.
  if (def.mode !== undefined) return WEIGHT_MODE_MATCH;
  // 액티브 슬롯 전용도 마찬가지 — 여기 왔다는 것은 그 슬롯에 장착돼 있다는 뜻이다(AC-24).
  if (def.activeSlot !== undefined) return WEIGHT_ACTIVE_SLOT;
  // 오프빌드는 `drawPowerupChoices` 가 애초에 풀에 넣지 않으므로 여기 오면 항상 일치다.
  if (def.weaponType !== undefined) return WEIGHT_WEAPON_MATCH;
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
    if (offBuildWeaponPowerup(def, state)) continue;
    if (offModePowerup(def, state)) continue;
    if (offSlotActivePowerup(def, state)) continue;
    // 제약 계약(성장축) — 봉인된 계열은 **pool 진입 자체를 막는다**(위 세 필터와 같은 축).
    // pool 에 넣고 뒤에서 거르면 `weights` 총합이 바뀌어 **같은 시드에서도 뽑히는 파워업이
    // 통째로 달라진다**(이 파일 44~50행 계약). 무의뢰 런·제약 미지정 런은 항상 거짓이라
    // pool 구성이 바이트 동일하다.
    //
    // ⚠️ **위반 처리기를 만들지 마라.** 제약 계약은 위반이 원천 불가능한 축만 쓴다 —
    // 금지 계열은 여기서 3택 풀에서 빠지고, 장비는 `runConfig` 의 출격 조립에서 빠진다.
    // sim 이 제약을 감시할 필요도 위반을 처벌할 장치도 없다(CONTEXT `제약 계약`).
    if (commissionBansPowerupLine(state, i)) continue;
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
