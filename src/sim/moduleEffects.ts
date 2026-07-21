/**
 * 코어 모듈 효력의 sim 통합 (M7b · ADR-0018 — 구 `src/sim/cardEffects.ts` 계승).
 *
 * 이 모듈은 코어 모듈(정적 카운터=접두·동적 트리거=접미·유니크 룰 변경형)을 **결정론 시뮬**에
 * 접합한다. 구 카드 런타임과 다른 점은 어휘가 단일 아레나(포탑·코어)에서 **3레이어**로 갈렸다는
 * 것이다 — 편대(L1)·설비(L2)·기물/보스/코어(L3) 각각에 배율이 따로 걸린다.
 *
 * ## 설계 원칙
 *   - **조건부 접기(하위 호환)**: `WorldState.moduleRuntime` 가 없으면(=모듈 미장착) 이 모듈의
 *     코드는 한 줄도 실행되지 않는다. 모듈 미장착 침공·PvE 리플레이는 거동·해시가 바이트 단위로
 *     불변이다.
 *   - **서버 권위·스냅샷 소비**: sim 은 카탈로그·프로필을 읽지 않고, T0 스냅샷이 고정한
 *     {@link ModuleInstance} 롤(id·stat·value)과 공격자 매치업({@link AttackerMatchup})만
 *     소비한다. 정적 카운터 판정은 스폰 시점 1회(결정론 고정), 동적 트리거는 런 중 틱 상태로.
 *   - **결정론(ADR-0005)**: Math.random·Date.now·pixi 미참조. 신규 Entity 필드 없음
 *     (hashEntity 레이아웃 불변) — 유니크 신기루 코어만 기존 `decoyCore` kind 를 재사용한다.
 *   - **wire 불변**: 여기서 읽는 jsonb 키(ModuleInstance·AttackerMatchup)는 개명하지 않았다.
 *     개명은 TypeScript 심볼·표시 문자열·테이블/EF 이름에만 적용된다.
 *
 * ## stat → sim 보정 매핑
 *   정적(접두, 조건 일치 시): `formationDamagePct`/`facilityDamagePct`/`bossDamagePct` = 해당
 *   레이어 방어체 화력↑, `facilityFireRatePct` = 설비 연사↑, `propDurabilityPct` = 기물 내구↑
 *   (스폰 시 1회), `incomingDmgReductionPct` = 방어체 피격 감소, `attackerSubCdPct` = 공격자
 *   보조무기 쿨↑. 동적(접미, 트리거 발동 시): `coreShieldFlat` = 코어 보호막(근접),
 *   `facilityFireRatePct` = 설비 연사↑(설비 3기 파괴), `attackerSlowPct` = 공격자 감속(90초),
 *   `volleyDamage` = 일제사격(수호 격추), `bossDamagePct` = 보스 화력↑(코어 저HP),
 *   `formationDamagePct` = 편대 화력↑(초반), `reflectDamagePct` = 반사(코어 피격),
 *   `incomingDmgReductionPct` = 피해 감소(L3 진입).
 *   유니크: 신기루 코어·블랙아웃·최후의 재기동·거울 관문.
 */

import type { Entity, EntitySink } from './entities.js';
import { blankEntity, addEntity } from './entities.js';
import { TICK_RATE } from './constants.js';
import {
  MODULE_AFFIX_BY_ID,
  MODULE_BASE_EFFECT,
  CORE_MODULE_UNIQUE_BY_ID,
  MODULE_EQUIP_SLOTS,
  MODULE_STAT_KEYS,
} from '../../data/coreModules.js';
import type {
  ModuleInstance,
  ModuleAffixRoll,
  ModuleCounterCondition,
} from '../../data/coreModules.js';
import { RARITY_BY_CODE } from '../items/types.js';
// M7c: 배치된 L3 기물 판정. 기만 홀로그램(prop 역할 4)만 kind 가 `decoyCore` 라 kind 비교
// 하나로는 못 센다. 이 술어는 역할 코드(`enemyType >= 0`)로 **아래 ③ 이 스폰하는 모듈 신기루
// 코어(enemyType === -1)** 를 배제하므로, 내구 +% 가 모듈 신기루에 새지 않는다.
// (런타임 순환 없음 — coreRoom 은 step/types 를 type-only 로만 참조한다.)
import { isPlacedProp } from './invasion/coreRoom.js';

// ---------------------------------------------------------------------------
// 튜닝 상수 (📝 밸런스 조정 대상)
// ---------------------------------------------------------------------------

/**
 * `powerSuperiority` 정적 카운터 발동 임계(전투력 점수 차). 공격자CP − 방어자CP 가 이 값 이상일
 * 때만 mc-armorbreak 가 발동한다. 📝 시작값.
 */
export const MODULE_POWER_SUPERIORITY_MARGIN = 500;

/**
 * 코어 근접 트리거(mt-forcefield) 판정 반경 여유. 공격자(플레이어)가 코어 중심에서
 * `core.radius + 이 값` 이내로 진입하면 발동한다. 📝 시작값.
 */
export const MODULE_CORE_PROXIMITY_MARGIN = 260;

/** 방어체 피해 감소 상한(%). 정적+동적 감소 합산이 이 값을 넘지 않게 클램프(무적 방어 방지). */
export const MODULE_MAX_DMG_REDUCTION_PCT = 90;

/** 신기루 코어(가짜 코어) 스폰 위치 오프셋(실제 코어로부터 +x). 결정론 고정 좌표. 📝 시작값. */
export const MODULE_DECOY_OFFSET_X = 240;

/** 가짜 코어 반지름(실제 코어와 동일 히트박스 — 렌더/조준 상 실제와 구분 불가하게). */
export const MODULE_DECOY_RADIUS = 90;

/** L3(코어방) 페이즈 코드. `src/sim/invasion/constants.ts` PHASE_L3 와 같은 값(2). */
const PHASE_CORE_ROOM = 2;

// ---------------------------------------------------------------------------
// 설정 계약 (begin_invasion 스냅샷 authority.modules — 서버 권위)
// ---------------------------------------------------------------------------

/**
 * 정적 카운터(접두) 조건 판정 입력 — T0 공격자 스냅샷 매치업.
 *
 * **wire 고정**: 이 인터페이스의 키는 SQL `build_attacker_matchup` 이 만드는 jsonb 키와 1:1
 * 이다(개명 금지). 서버 재실행은 권위 매치업으로 재판정하므로, 공격자가 이 값을 위조해 정적
 * 카운터를 끄려 하면 hashStream 이 갈려 거부된다.
 */
export interface AttackerMatchup {
  /** 공격자 로드아웃에 화염 어픽스(loadout.fireDmg>0) 존재 → fireAttacker. */
  readonly fire: boolean;
  /** 냉기(loadout.coldSlow>0) → coldAttacker. */
  readonly cold: boolean;
  /** 전격(loadout.lightning>0) → lightningAttacker. */
  readonly lightning: boolean;
  /** 주무기가 빔/레일건 계열(weaponType 4 빔 · 2 레일건) → beamAttacker. */
  readonly beam: boolean;
  /** 공격자 전투력 점수(combatPower). powerSuperiority 판정 입력. */
  readonly attackerCp: number;
  /** 방어자 전투력 점수. powerSuperiority 판정 입력. */
  readonly defenderCp: number;
  /** 복수전 대상 공격자 → revenge. */
  readonly revenge: boolean;
  /** 동일 공격자의 재침공 → reinvasion. */
  readonly reinvasion: boolean;
  /** 공격자가 강한 보조무기를 장착 → subweaponHeavy. */
  readonly subweaponHeavy: boolean;
}

/**
 * 코어 모듈 효력 설정(`WorldConfig.invasion3.modules` 로 배선될 예정 — 배선은 world.ts 소유
 * 레인 몫이다). 장착 모듈은 최대 {@link MODULE_EQUIP_SLOTS}(2)개이며 **효과는 합산**된다.
 * 이 필드가 없으면 모듈 미장착 = 기존 침공/PvE 경로와 완전 동일.
 */
export interface CoreModuleConfig {
  /** 방어자 장착 모듈(스냅샷 고정, ADR-0012). 빈 슬롯은 배열에 넣지 않는다(길이 0..2). */
  readonly modules: readonly ModuleInstance[];
  /** 공격자 매치업 데이터(정적 카운터 조건 판정 입력). */
  readonly matchup: AttackerMatchup;
}

// ---------------------------------------------------------------------------
// 런타임 상태 (WorldState.moduleRuntime — 모듈 장착 침공에만 존재)
// ---------------------------------------------------------------------------

/**
 * 코어 모듈 효력의 결정론 런타임. {@link initModuleRuntime} 가 스냅샷 모듈+매치업에서 정적으로
 * 해석한 상수 필드와, 런 중 갱신되는 상태(부활 횟수·블랙아웃 잔여·근접 보호막 래치)를 담는다.
 * 마지막 배율(`*Mult`)들은 매 틱 {@link stepModuleRuntime} 이 재계산하는 **스크래치**(해시
 * 비접힘 — 순수하게 접힌 상수·틱·엔티티 상태의 파생이므로).
 */
export interface ModuleRuntime {
  // --- 정적 해석 상수(런 내 불변) ---
  /** 기저 + 조건 일치 접두의 L1 편대 화력 +%. */
  readonly staticFormationDamagePct: number;
  /** 기저 + 조건 일치 접두의 L2 설비 화력 +%. */
  readonly staticFacilityDamagePct: number;
  /** 조건 일치 접두의 L2 설비 연사 +%. */
  readonly staticFacilityFireRatePct: number;
  /** 기저 + 조건 일치 접두의 L3 보스 화력 +%. */
  readonly staticBossDamagePct: number;
  /** 조건 일치 접두의 L3 기물 내구 +%(스폰 시 1회 적용, 재현·감사용 보존). */
  readonly propDurabilityPct: number;
  /** 조건 일치 접두의 방어체 피해 감소 합 %. */
  readonly staticIncomingReductionPct: number;
  /** 조건 일치 접두의 공격자 보조무기 쿨다운 증가 합 %. */
  readonly attackerSubCdPct: number;
  /** 코어 피격 반사 %(mt-reflection + 유니크 거울 관문 합). */
  readonly reflectPct: number;
  /** 기저 코어 HP +%(스폰 시 1회 적용, 재현·감사용 보존). */
  readonly coreHpPct: number;
  // --- 동적 트리거 파라미터(미보유 = 0) ---
  /** mt-fury: 설비 threshold 기 파괴 시 설비 연사 +%. */
  readonly furyFireRatePct: number;
  readonly furyThreshold: number;
  /** mt-vanguard: 초반 구간 편대 화력 +%. */
  readonly vanguardFormationDamagePct: number;
  readonly vanguardTicks: number;
  /** mt-laststand: 코어 저HP 시 보스 화력 +%. */
  readonly laststandBossDamagePct: number;
  readonly laststandPct: number;
  /** mt-attrition: 경과 시 공격자 감속 %. */
  readonly attritionSlowPct: number;
  readonly attritionTicks: number;
  /** mt-bulwark: L3 진입 후 방어체 피해 감소 %. */
  readonly bulwarkReductionPct: number;
  /** mt-forcefield: 코어 근접 시 부여 보호막(절대). */
  readonly forcefieldShield: number;
  /** mt-retribution: 수호 격추 시 공격자 피해. */
  readonly volleyDamage: number;
  // --- 유니크 파라미터 ---
  /** 최후의 재기동 잔여 부활 횟수(런 중 소진). */
  reviveCount: number;
  readonly reviveHpPct: number;
  readonly decoyHpPct: number;
  readonly decoyCount: number;
  /** 블랙아웃 잔여 틱(런 중 감소; 렌더가 읽음). */
  blackoutTicksLeft: number;
  // --- 런 중 래치 상태 ---
  /** 코어 근접 보호막 1회 부여 완료. */
  coreProximityFired: boolean;
  /**
   * L2 진입 시 깔린 설비 수(파괴 수 계산 기준). **T0 에는 0 이다** — 3레이어 침공은 설비가
   * L2 진입 훅에서 스폰되므로 {@link applyModuleSpawnEffects} 가 그때 채운다.
   */
  initialFacilityCount: number;
  /** 코어 HP 증폭을 이미 적용했는가(레이어 진입 훅 재호출 멱등 래치). */
  coreScaled: boolean;
  /** 기물 내구 증폭을 이미 적용했는가(동일 래치). */
  propsScaled: boolean;
  /** 신기루 코어를 이미 스폰했는가(동일 래치). */
  decoySpawned: boolean;
  // --- 매 틱 재계산 스크래치(해시 비접힘) ---
  formationDamageMult: number;
  facilityDamageMult: number;
  facilityFireRateMult: number;
  bossDamageMult: number;
  defenseDmgMult: number;
  attackerSlowMult: number;
}

// ---------------------------------------------------------------------------
// T0 권위 스냅샷 파싱 (begin_invasion 의 authority.modules)
// ---------------------------------------------------------------------------

/**
 * `begin_invasion` 이 실어 주는 `modules` jsonb → sim 이 그대로 소비하는
 * {@link CoreModuleConfig}. 계약은 `{ instances: ModuleInstance[], matchup: AttackerMatchup }`
 * 이며 EF(verify-invasion)가 **같은 jsonb 를 같은 형상으로** 읽는다.
 *
 * 모듈은 카탈로그 참조가 아니라 **시드 롤이 굳은 소모성 인스턴스**라 `InvasionRef` 5필드로
 * 표현되지 않는다(그래서 layers 가 아니라 authority 로 온다). 여기서는 손상·구버전 응답을
 * `null`(모듈 없음)로 접는다 — total function 이라 "파싱 실패" 상태가 없다.
 *
 * 장착 상한을 넘는 인스턴스는 잘라낸다({@link MODULE_EQUIP_SLOTS}). 이 배열은 슬롯 배열이
 * **아니다** — 효과가 합산되므로 빈 슬롯을 null 로 채워 둘 이유가 없고, 서버는 실제 장착분만
 * 보낸다(`equipped_module_ids` 의 non-null 만 풀림).
 */
export function parseModulesAuthority(raw: unknown): CoreModuleConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const rawInstances = Array.isArray(r.instances) ? r.instances : [];
  const instances: ModuleInstance[] = [];
  for (const item of rawInstances) {
    if (instances.length >= MODULE_EQUIP_SLOTS) break;
    const parsed = parseModuleInstance(item);
    if (parsed !== null) instances.push(parsed);
  }
  // wire 키는 `instances`, TS 필드명은 `modules`(CoreModuleConfig 계약) — 개명 축이 다르다.
  return { modules: instances, matchup: parseAttackerMatchup(r.matchup) };
}

/** ModuleInstance jsonb 1건 파싱. 필수 키가 없거나 형이 어긋나면 `null`(그 모듈은 무시). */
function parseModuleInstance(raw: unknown): ModuleInstance | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : '';
  if (id === '') return null;
  const rarity = RARITY_BY_CODE.find((x) => x === r.rarity);
  if (rarity === undefined) return null;
  const chargesMax = asInt(r.chargesMax, 0);
  const base: ModuleInstance = {
    id,
    rarity,
    prefixes: parseRolls(r.prefixes),
    suffixes: parseRolls(r.suffixes),
    chargesMax,
    chargesLeft: asInt(r.chargesLeft, chargesMax),
    seed: asInt(r.seed, 0),
  };
  // exactOptionalPropertyTypes: 유니크가 아니면 키 자체를 두지 않는다(롤 결과와 같은 형상).
  return typeof r.uniqueId === 'string' && r.uniqueId !== ''
    ? { ...base, uniqueId: r.uniqueId }
    : base;
}

/** 어픽스 롤 배열 파싱. 미지의 stat 키·비정수 값은 버린다(서버 권위지만 방어적으로). */
function parseRolls(raw: unknown): ModuleAffixRoll[] {
  if (!Array.isArray(raw)) return [];
  const out: ModuleAffixRoll[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : '';
    const stat = MODULE_STAT_KEYS.find((k) => k === r.stat);
    if (id === '' || stat === undefined) continue;
    out.push({ id, stat, value: asInt(r.value, 0) });
  }
  return out;
}

/**
 * 공격자 매치업 파싱. 누락 키는 안전한 기본값(false·0)으로 채운다 — 정적 카운터가 조용히
 * 켜지지 않는 방향이다(누락 = 미발동).
 */
function parseAttackerMatchup(raw: unknown): AttackerMatchup {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    fire: r.fire === true,
    cold: r.cold === true,
    lightning: r.lightning === true,
    beam: r.beam === true,
    attackerCp: asInt(r.attackerCp, 0),
    defenderCp: asInt(r.defenderCp, 0),
    revenge: r.revenge === true,
    reinvasion: r.reinvasion === true,
    subweaponHeavy: r.subweaponHeavy === true,
  };
}

/** 정수 강제(비정수·비유한·비수치는 fallback). 모듈 권위는 전 필드 정수 계약이다. */
function asInt(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
}

// ---------------------------------------------------------------------------
// 정적 카운터 조건 판정
// ---------------------------------------------------------------------------

/** 정적 카운터 조건이 공격자 매치업과 일치하는가(T0 1회 판정, 결정론 고정). */
function matchCondition(cond: ModuleCounterCondition, m: AttackerMatchup): boolean {
  switch (cond) {
    case 'fireAttacker':
      return m.fire;
    case 'coldAttacker':
      return m.cold;
    case 'lightningAttacker':
      return m.lightning;
    case 'beamAttacker':
      return m.beam;
    case 'powerSuperiority':
      return m.attackerCp - m.defenderCp >= MODULE_POWER_SUPERIORITY_MARGIN;
    case 'revenge':
      return m.revenge;
    case 'reinvasion':
      return m.reinvasion;
    case 'subweaponHeavy':
      return m.subweaponHeavy;
  }
}

// ---------------------------------------------------------------------------
// 런타임 해석 + 스폰 효과 (createWorld 가 호출할 진입점)
// ---------------------------------------------------------------------------

/**
 * 스냅샷 모듈(최대 2개)+매치업을 결정론 런타임으로 해석한다. 두 모듈의 효과는 stat 별로
 * **합산**된다(기저 효과도 모듈 수만큼 합산 — 슬롯 2를 채우는 선택에 값이 있어야 한다).
 *
 * 부수효과로 스폰 시점 효과를 적용한다:
 *   ① 기저 코어 HP +%, ② 기물 내구 +%(propDurabilityPct), ③ 유니크 신기루 코어(가짜 코어) 스폰.
 * sink 로 코어·설비·기물을 조회하고 가짜 코어에 id 를 할당한다(호출부가 nextEntityId 를 회수).
 */
export function initModuleRuntime(cfg: CoreModuleConfig, sink: EntitySink): ModuleRuntime {
  const { modules, matchup } = cfg;

  let staticFormationDamagePct = 0;
  let staticFacilityDamagePct = 0;
  let staticFacilityFireRatePct = 0;
  let staticBossDamagePct = 0;
  let propDurabilityPct = 0;
  let staticIncomingReductionPct = 0;
  let attackerSubCdPct = 0;
  let coreHpPct = 0;

  let reflectPct = 0;
  let furyFireRatePct = 0;
  let furyThreshold = 0;
  let vanguardFormationDamagePct = 0;
  let vanguardTicks = 0;
  let laststandBossDamagePct = 0;
  let laststandPct = 0;
  let attritionSlowPct = 0;
  let attritionTicks = 0;
  let bulwarkReductionPct = 0;
  let forcefieldShield = 0;
  let volleyDamage = 0;

  let reviveCount = 0;
  let reviveHpPct = 0;
  let decoyHpPct = 0;
  let decoyCount = 0;
  let blackoutTicksLeft = 0;

  for (const mod of modules) {
    // 기저 효과: 등급별 무조건 적용(전 레이어 화력 + 코어 HP).
    const base = MODULE_BASE_EFFECT[mod.rarity];
    staticFormationDamagePct += base.allDamagePct;
    staticFacilityDamagePct += base.allDamagePct;
    staticBossDamagePct += base.allDamagePct;
    coreHpPct += base.coreHpPct;

    // 정적 카운터(접두): 조건 일치 롤만 stat 별 누적.
    for (const roll of mod.prefixes) {
      const def = MODULE_AFFIX_BY_ID.get(roll.id);
      if (def === undefined || def.condition === undefined) continue;
      if (!matchCondition(def.condition, matchup)) continue;
      switch (roll.stat) {
        case 'formationDamagePct':
          staticFormationDamagePct += roll.value;
          break;
        case 'facilityDamagePct':
          staticFacilityDamagePct += roll.value;
          break;
        case 'facilityFireRatePct':
          staticFacilityFireRatePct += roll.value;
          break;
        case 'bossDamagePct':
          staticBossDamagePct += roll.value;
          break;
        case 'propDurabilityPct':
          propDurabilityPct += roll.value;
          break;
        case 'incomingDmgReductionPct':
          staticIncomingReductionPct += roll.value;
          break;
        case 'attackerSubCdPct':
          attackerSubCdPct += roll.value;
          break;
        default:
          break;
      }
    }

    // 동적 트리거(접미): 발동 파라미터를 트리거별로 저장(미보유 = 0).
    for (const roll of mod.suffixes) {
      const def = MODULE_AFFIX_BY_ID.get(roll.id);
      if (def === undefined || def.trigger === undefined) continue;
      const thr = def.threshold ?? 0;
      switch (def.trigger) {
        case 'coreProximity':
          forcefieldShield += roll.value;
          break;
        case 'facilitiesDestroyed':
          furyFireRatePct += roll.value;
          furyThreshold = thr;
          break;
        case 'earlyPhase':
          vanguardFormationDamagePct += roll.value;
          vanguardTicks = thr * TICK_RATE;
          break;
        case 'coreHpLow':
          laststandBossDamagePct += roll.value;
          laststandPct = thr;
          break;
        case 'guardianDowned':
          volleyDamage += roll.value;
          break;
        case 'coreHit':
          reflectPct += roll.value;
          break;
        case 'coreRoomEntered':
          bulwarkReductionPct += roll.value;
          break;
        case 'timeElapsed':
          attritionSlowPct += roll.value;
          attritionTicks = thr * TICK_RATE;
          break;
      }
    }

    // 유니크 룰 변경형 파라미터.
    if (mod.uniqueId !== undefined) {
      const uq = CORE_MODULE_UNIQUE_BY_ID.get(mod.uniqueId);
      if (uq !== undefined) {
        const p = uq.params;
        switch (mod.uniqueId) {
          case 'uq-mirage-core':
            decoyCount += p.decoyCount ?? 0;
            decoyHpPct = p.decoyHpPct ?? 0;
            break;
          case 'uq-blackout':
            blackoutTicksLeft += p.radarDisableTicks ?? 0;
            break;
          case 'uq-last-reboot':
            reviveCount += p.reviveCount ?? 0;
            reviveHpPct = p.reviveHpPct ?? 0;
            break;
          case 'uq-mirror-gate':
            reflectPct += p.reflectPct ?? 0;
            break;
        }
      }
    }
  }

  const mr: ModuleRuntime = {
    staticFormationDamagePct,
    staticFacilityDamagePct,
    staticFacilityFireRatePct,
    staticBossDamagePct,
    propDurabilityPct,
    staticIncomingReductionPct,
    attackerSubCdPct,
    reflectPct,
    coreHpPct,
    furyFireRatePct,
    furyThreshold,
    vanguardFormationDamagePct,
    vanguardTicks,
    laststandBossDamagePct,
    laststandPct,
    attritionSlowPct,
    attritionTicks,
    bulwarkReductionPct,
    forcefieldShield,
    volleyDamage,
    reviveCount,
    reviveHpPct,
    decoyHpPct,
    decoyCount,
    blackoutTicksLeft,
    coreProximityFired: false,
    initialFacilityCount: 0,
    coreScaled: false,
    propsScaled: false,
    decoySpawned: false,
    formationDamageMult: 1,
    facilityDamageMult: 1,
    facilityFireRateMult: 1,
    bossDamageMult: 1,
    defenseDmgMult: 1,
    attackerSlowMult: 1,
  };

  // T0 에 이미 깔린 방어체가 있으면(구 단일 아레나 형태·테스트 하네스) 그 자리에서 적용한다.
  // 3레이어 침공은 설비·코어·기물이 레이어 진입 훅에서 스폰되므로 world.ts 가 진입마다 다시
  // 부른다 — 아래 함수는 래치로 멱등이라 두 경로가 겹쳐도 이중 적용되지 않는다.
  applyModuleSpawnEffects(mr, sink);
  return mr;
}

/**
 * 스폰 시점 효과를 **멱등하게** 적용한다: ① 기저 코어 HP +%, ② 기물 내구 +%,
 * ③ 유니크 신기루 코어 스폰, ④ L2 설비 초기 수 기록(파괴 수 트리거 기준).
 *
 * 3레이어 침공에서 방어체는 T0 가 아니라 **레이어 진입 훅**에서 스폰된다(L2=설비, L3=코어·
 * 기물·보스). 그래서 world.ts 가 레이어 진입마다 이 함수를 부르고, 각 효과는 자기 래치로
 * 1회만 적용된다. 대상이 아직 없으면 아무 것도 하지 않는다(다음 진입에서 다시 시도).
 */
export function applyModuleSpawnEffects(mr: ModuleRuntime, sink: EntitySink): void {
  // 코어·설비·기물 조회(1패스).
  let core: Entity | undefined;
  let facilityCount = 0;
  const props: Entity[] = [];
  for (const e of sink.entities) {
    if (e.dead) continue;
    if (e.kind === 'core') core = e;
    else if (e.kind === 'facilityGun' || e.kind === 'facilityHazard' || e.kind === 'facilitySpawner') {
      facilityCount++;
    } else if (isPlacedProp(e)) props.push(e);
  }

  // ④ L2 진입분 설비 수(첫 관측 1회만 — 이후 감소는 '파괴'로 해석해야 한다).
  if (mr.initialFacilityCount === 0 && facilityCount > 0) mr.initialFacilityCount = facilityCount;

  // ① 기저 코어 HP +%(실제 코어에만; 가짜 코어는 아래에서 별도 HP).
  if (!mr.coreScaled && core !== undefined) {
    mr.coreScaled = true;
    if (mr.coreHpPct !== 0) {
      const scaled = Math.round(core.maxHp * (1 + mr.coreHpPct / 100));
      core.hp = scaled;
      core.maxHp = scaled;
    }
  }

  // ② 기물 내구 +%(mc-blockade 등). 정수 반올림 — 이후 피해 산술은 정수 유지.
  if (!mr.propsScaled && props.length > 0) {
    mr.propsScaled = true;
    if (mr.propDurabilityPct !== 0) {
      for (const p of props) {
        const scaled = Math.round(p.maxHp * (1 + mr.propDurabilityPct / 100));
        p.hp = scaled;
        p.maxHp = scaled;
      }
    }
  }

  // ③ 유니크 신기루 코어(가짜 코어) 스폰. 실제 코어 HP(기저 버프 반영)의 일부만 갖는
  // decoyCore 를 실제 코어 곁에 배치한다. 파괴돼도 침공 승리로 이어지지 않는다.
  if (!mr.decoySpawned && core !== undefined && mr.decoyCount > 0 && mr.decoyHpPct > 0) {
    mr.decoySpawned = true;
    const decoyHp = Math.max(1, Math.round(core.maxHp * (mr.decoyHpPct / 100)));
    for (let i = 0; i < mr.decoyCount; i++) {
      const d = blankEntity('decoyCore');
      d.x = core.x + MODULE_DECOY_OFFSET_X * (i + 1);
      d.y = core.y;
      d.radius = MODULE_DECOY_RADIUS;
      d.hp = decoyHp;
      d.maxHp = decoyHp;
      addEntity(sink, d);
    }
  }
}

// ---------------------------------------------------------------------------
// 매 틱 런타임 갱신
// ---------------------------------------------------------------------------

/**
 * 코어 모듈 런타임이 매 틱 읽는 최소 상태. `WorldState` 를 직접 참조하지 않고 구조적 타입으로
 * 받아 sim 코어와의 결합을 낮춘다(구 cardEffects 와 동일 규율). `invasion3.phase` 는 L3 진입
 * 트리거(mt-bulwark) 판정에만 쓰이며, 없으면 미진입으로 본다.
 */
export interface ModuleStepState {
  tick: number;
  entities: Entity[];
  moduleRuntime?: ModuleRuntime;
  invasion3?: { phase: number };
}

/**
 * 코어 모듈 런타임을 1틱 갱신한다:
 *   ① 블랙아웃 잔여 감소,
 *   ② 코어 근접 보호막 1회 부여(래치),
 *   ③ 동적 트리거 상태로 이번 틱 유효 배율(편대·설비·보스 화력, 설비 연사, 방어체 피해 감소,
 *      공격자 감속) 재계산.
 * 배율은 스크래치라 해시에 직접 접히지 않고, world.ts 접점이 읽어 거동에 반영한다(그 결과는
 * 엔티티 상태로 해시에 반영). 결정론: 틱·코어 HP·현재 설비 수·페이즈의 순수 함수.
 */
export function stepModuleRuntime(state: ModuleStepState, player: Entity): void {
  const mr = state.moduleRuntime;
  if (mr === undefined) return;

  if (mr.blackoutTicksLeft > 0) mr.blackoutTicksLeft--;

  // 코어(있으면) 조회 + 현재 설비 수 집계(파괴 수 = 초기 − 현재).
  let core: Entity | undefined;
  let liveFacilities = 0;
  for (const e of state.entities) {
    if (e.dead) continue;
    if (e.kind === 'core') core = e;
    else if (e.kind === 'facilityGun' || e.kind === 'facilityHazard' || e.kind === 'facilitySpawner') {
      liveFacilities++;
    }
  }
  const facilitiesDestroyed = mr.initialFacilityCount - liveFacilities;
  const coreHpFrac = core !== undefined && core.maxHp > 0 ? core.hp / core.maxHp : 1;

  // 코어 근접 보호막(mt-forcefield): 미발동 + 코어 존재 + 공격자가 근접 반경 진입 시 1회 부여.
  if (!mr.coreProximityFired && mr.forcefieldShield > 0 && core !== undefined) {
    const dx = player.x - core.x;
    const dy = player.y - core.y;
    const reach = core.radius + MODULE_CORE_PROXIMITY_MARGIN;
    if (dx * dx + dy * dy <= reach * reach) {
      core.targetY += mr.forcefieldShield; // 보호막은 targetY(피해 선흡수, 실드 공유와 동일 필드)
      mr.coreProximityFired = true;
    }
  }

  // 이번 틱 유효 배율 재계산(트리거 상태 반영).
  const vanguardOn = mr.vanguardTicks > 0 && state.tick < mr.vanguardTicks;
  mr.formationDamageMult =
    1 + (mr.staticFormationDamagePct + (vanguardOn ? mr.vanguardFormationDamagePct : 0)) / 100;

  const coreLow = mr.laststandPct > 0 && coreHpFrac * 100 <= mr.laststandPct;
  mr.bossDamageMult =
    1 + (mr.staticBossDamagePct + (coreLow ? mr.laststandBossDamagePct : 0)) / 100;

  mr.facilityDamageMult = 1 + mr.staticFacilityDamagePct / 100;

  const furyOn = mr.furyThreshold > 0 && facilitiesDestroyed >= mr.furyThreshold;
  const fireRatePct = mr.staticFacilityFireRatePct + (furyOn ? mr.furyFireRatePct : 0);
  mr.facilityFireRateMult = 1 + fireRatePct / 100;

  const inCoreRoom = state.invasion3 !== undefined && state.invasion3.phase >= PHASE_CORE_ROOM;
  let reductionPct = mr.staticIncomingReductionPct + (inCoreRoom ? mr.bulwarkReductionPct : 0);
  if (reductionPct > MODULE_MAX_DMG_REDUCTION_PCT) reductionPct = MODULE_MAX_DMG_REDUCTION_PCT;
  mr.defenseDmgMult = 1 - reductionPct / 100;

  const attritionOn = mr.attritionTicks > 0 && state.tick >= mr.attritionTicks;
  mr.attackerSlowMult = 1 - (attritionOn ? mr.attritionSlowPct : 0) / 100;
}
