/**
 * 코어 모듈 카탈로그 — 구 '방어 카드' 계승 (M7b · ADR-0018).
 *
 * ADR-0018 결정: 방어 카드 시스템은 **별도 시스템으로는 폐지**하고, L3 코어의 강화 슬롯에
 * 장착하는 **소모성 코어 모듈**로 흡수한다. 정적 카운터(접두)·동적 트리거(접미)·사용 횟수·
 * 스냅샷 고정(ADR-0012)·상점/합성/보관함 경제는 그대로 존속하되, 어휘가 단일 아레나(포탑·코어)
 * 에서 **3레이어(편대·설비·기물·보스·코어)** 로 재정의된다.
 *
 * ## 개명 경계 — 표시 문자열 vs wire 필드명 (ADR-0005)
 * 이 레인의 최대 위험은 개명이 직렬화 계약에 새는 것이다. 원칙:
 *   - **개명 대상**: TypeScript 심볼(`CardInstance`→`ModuleInstance`), 표시 문자열, i18n 키,
 *     테이블/RPC/EF 이름, 어픽스 id(신규 테이블이라 구 데이터가 없다 — `mc-*`/`mt-*`).
 *   - **개명 금지(wire 고정)**: {@link ModuleInstance} 의 jsonb 키
 *     (`id`·`rarity`·`prefixes`·`suffixes`·`uniqueId`·`chargesMax`·`chargesLeft`·`seed`)와
 *     {@link ModuleAffixRoll} 의 키(`id`·`stat`·`value`), {@link AttackerMatchup} 의 키
 *     (`fire`·`cold`·`lightning`·`beam`·`attackerCp`·`defenderCp`·`revenge`·`reinvasion`·
 *     `subweaponHeavy`). 이 키들은 SQL `build_attacker_matchup` 과 스냅샷 authority jsonb 가
 *     그대로 쓰므로 한 글자만 바뀌어도 서버 재실행이 갈린다.
 *   - **stat 값 문자열**은 신규 테이블(`core_modules`)에만 실리므로 3레이어 어휘로 재정의했다.
 *     구 `defense_cards` 행은 마이그레이션에서 폐기되므로 호환 부담이 없다.
 *
 * ## 결정론 (ADR-0005)
 * 순수 데이터 + 순수 결정론 함수다. Math.random·Date.now·pixi 미참조. 유일한 무작위원은 시드
 * 기반 {@link SeededRng} 이라 상점 로테이션·합성 판정이 클라(Node)·EF(Deno) 에서 바이트 동일하다.
 *
 * ## 방어 성공 보조 보상 (기획 §4)
 * 코어 모듈 **드랍은 폐지**됐다(부익부 방지 — ADR-0018 Consequences). 방어 성공 보상은
 * {@link DEFENSE_SUCCESS_CREDITS} 크레딧 정액뿐이며, 구 `defenseSuccessDropChance`·
 * `DEFENSE_DROP_BASE_CHANCE`·`rollDropRarity` 는 이 모듈에 존재하지 않는다.
 *
 * 📝 모든 수치(롤 범위·기저 효과·합성 확률·상점 재고·보관 상한·유니크 파라미터)는 밸런스 조정 대상.
 */

import { SeededRng } from '../src/sim/rng.js';
import type { Rarity } from '../src/items/types.js';
import { RARITY_CODE } from '../src/items/types.js';

// ---------------------------------------------------------------------------
// 효과 stat 어휘 — 3레이어 재정의 (src/sim/moduleEffects.ts 가 소비)
// ---------------------------------------------------------------------------

/**
 * 코어 모듈 효과가 침공 방어에 거는 보정의 종류.
 *
 * 구 `CardStatKey` 8종은 단일 아레나 전제였다(`turretDamagePct`·`coreShieldFlat` 등 — 포탑과
 * 코어밖에 없던 시절의 어휘). 3레이어에서는 **어느 레이어의 무엇을 강화하는가**가 선택의 축이
 * 되므로 레이어별로 갈라 재정의한다:
 *   L1 편대 / L2 설비 / L3 기물·보스 / 코어 / 공격자 디버프.
 *
 * 백분율 stat 은 정수 퍼센트(10 = +10%), flat stat(`coreShieldFlat`·`volleyDamage`)은 절대량이다.
 * 이 문자열은 `core_modules.module` jsonb 의 `prefixes[].stat`/`suffixes[].stat` 에 실리는
 * **신규 wire 값**이다 — 확정 이후 개명·재정의 금지(구 defense_cards 는 폐기돼 호환 부담 없음).
 */
export type ModuleStatKey =
  // --- L1 대기권(편대) ---
  | 'formationDamagePct' // 편대 화력 +%
  // --- L2 회랑(설비) ---
  | 'facilityDamagePct' // 설비(방어포·해저드) 피해 +%
  | 'facilityFireRatePct' // 설비 연사 +%(발사 간격 단축)
  // --- L3 코어방(기물·보스·코어) ---
  | 'propDurabilityPct' // 기물 내구 +%(스폰 시 1회 적용)
  | 'bossDamagePct' // 방어 보스 화력 +%
  | 'coreShieldFlat' // 코어 보호막(절대) — 트리거 발동 시 부여
  // --- 전 레이어 공통 ---
  | 'incomingDmgReductionPct' // 배치된 방어체가 받는 피해 -%
  | 'volleyDamage' // 일제사격 1회 피해량(절대)
  // --- 공격자 디버프 ---
  | 'attackerSubCdPct' // 공격자 보조무기 쿨다운 +%(증가 = 불리)
  | 'attackerSlowPct' // 공격자 이동속도 -%
  | 'reflectDamagePct'; // 코어 피격 피해의 일부를 공격자에게 반사 +%

/** {@link ModuleStatKey} 전량(테스트·검증 파생용). 값 자체가 wire 라 목록도 계약이다. */
export const MODULE_STAT_KEYS: readonly ModuleStatKey[] = [
  'formationDamagePct',
  'facilityDamagePct',
  'facilityFireRatePct',
  'propDurabilityPct',
  'bossDamagePct',
  'coreShieldFlat',
  'incomingDmgReductionPct',
  'volleyDamage',
  'attackerSubCdPct',
  'attackerSlowPct',
  'reflectDamagePct',
];

// ---------------------------------------------------------------------------
// 정적 카운터(접두) 조건 · 동적 트리거(접미) 이벤트
// ---------------------------------------------------------------------------

/**
 * **모듈 어픽스** 정적 카운터 조건 — 침공 시작 시점(T0 스냅샷) 공격자 스펙과의 매치업.
 * sim 이 스폰 시점 1회 조건 일치를 판정해 효과 수치를 정적으로 고정한다(결정론).
 *
 * 용어(CONTEXT.md): 어픽스 주체가 넷이다 — 장비 어픽스 / 엘리트 어픽스 / 방어체 어픽스 /
 * **모듈 어픽스**. 단독 표기('어픽스') 금지, 항상 "모듈 어픽스" 전체 표기.
 *
 * 값 문자열은 어픽스 정의에만 등장하고 jsonb 에는 실리지 않는다(롤은 stat·value 만 저장).
 */
export type ModuleCounterCondition =
  | 'fireAttacker' // 공격자 로드아웃에 화염(fireDmg) 어픽스 존재
  | 'coldAttacker' // 냉기(coldSlow) 존재
  | 'lightningAttacker' // 전격(lightning) 존재
  | 'beamAttacker' // 주무기가 빔/레일건 계열(장거리 화력형)
  | 'powerSuperiority' // 공격자 전투력점수가 방어자보다 우위(임계 초과)
  | 'revenge' // 복수전 대상 공격자
  | 'reinvasion' // 동일 공격자의 재침공
  | 'subweaponHeavy'; // 공격자가 강한 보조무기를 장착

/**
 * **모듈 어픽스** 동적 트리거 이벤트 — 런 중 공격자 행동에 반응해 발동.
 * `threshold` 의 의미는 이벤트별로 다르다(아래 주석).
 *
 * 구 `turretsDestroyed`(포탑 파괴 수)는 포탑이 사라졌으므로 `facilitiesDestroyed`(L2 설비
 * 파괴 수)로 계승하고, 3레이어 고유 축으로 `coreRoomEntered`(공격자가 L3 진입)를 신설했다.
 */
export type ModuleTriggerEvent =
  | 'coreProximity' // 공격자가 코어 반경 진입
  | 'facilitiesDestroyed' // L2 설비 threshold 기 파괴(구 turretsDestroyed 계승)
  | 'timeElapsed' // threshold 초 경과
  | 'guardianDowned' // 수호 기체 격추당함
  | 'coreHpLow' // 코어 HP 가 threshold % 이하
  | 'earlyPhase' // 침공 시작 후 threshold 초 이내(초반 구간)
  | 'coreHit' // 코어가 피격당함
  | 'coreRoomEntered'; // 공격자가 L3 코어방에 진입(페이즈 2 도달)

export type ModuleAffixKind = 'prefix' | 'suffix';

/**
 * 모듈 어픽스 정의(designer-authored). value 는 [min,max] 정수 균등 롤. 접두는 `condition`
 * (정적 카운터), 접미는 `trigger`(+`threshold`)를 갖는다.
 * `id` 는 롤 jsonb 에 실리는 **wire 값**이므로 확정 후 재번호 금지.
 *
 * **표기명은 이 정의에 없다.** 한글 리터럴 `name` 필드를 두면 EN 로케일에서도 한글이 새고
 * i18n 검증 밖에 남는다 — 표시명·설명은 {@link moduleAffixNameKey}/{@link moduleAffixDescKey}
 * (`def3.affix.<id>.name` / `.desc`) 로 카탈로그(src/i18n/catalog.ts)에 두고, 존재 여부는
 * tests/i18n.test.ts 가 **이 배열에서 파생**해 전수 강제한다(방어체 어픽스와 동일 규약).
 */
export interface ModuleAffixDef {
  readonly id: string;
  readonly kind: ModuleAffixKind;
  readonly stat: ModuleStatKey;
  readonly min: number;
  readonly max: number;
  /** 접두(정적 카운터) 전용: 발동 매치업 조건. */
  readonly condition?: ModuleCounterCondition;
  /** 접미(동적 트리거) 전용: 발동 이벤트. */
  readonly trigger?: ModuleTriggerEvent;
  /** 접미 전용: 발동 임계(이벤트별 의미 상이 — {@link ModuleTriggerEvent} 주석 참조). */
  readonly threshold?: number;
}

/**
 * 접두 8종 — 정적 카운터(T0 공격자 스펙 매치업). 조건 일치 시에만 효과가 실린다.
 * id 접두 `mc-` = **m**odule **c**ounter.
 */
export const MODULE_PREFIXES: readonly ModuleAffixDef[] = [
  { id: 'mc-quench', kind: 'prefix', stat: 'incomingDmgReductionPct', min: 8, max: 18, condition: 'fireAttacker' },
  { id: 'mc-frostward', kind: 'prefix', stat: 'incomingDmgReductionPct', min: 8, max: 18, condition: 'coldAttacker' },
  { id: 'mc-insulate', kind: 'prefix', stat: 'attackerSubCdPct', min: 15, max: 35, condition: 'lightningAttacker' },
  { id: 'mc-refract', kind: 'prefix', stat: 'incomingDmgReductionPct', min: 6, max: 14, condition: 'beamAttacker' },
  { id: 'mc-armorbreak', kind: 'prefix', stat: 'facilityDamagePct', min: 12, max: 28, condition: 'powerSuperiority' },
  { id: 'mc-avenger', kind: 'prefix', stat: 'bossDamagePct', min: 40, max: 80, condition: 'revenge' },
  { id: 'mc-blockade', kind: 'prefix', stat: 'propDurabilityPct', min: 10, max: 22, condition: 'reinvasion' },
  { id: 'mc-disruptor', kind: 'prefix', stat: 'attackerSubCdPct', min: 12, max: 30, condition: 'subweaponHeavy' },
];

/**
 * 접미 8종 — 동적 트리거(런 중 공격자 행동 반응). `threshold` 로 발동 임계를 지정.
 * id 접두 `mt-` = **m**odule **t**rigger.
 */
export const MODULE_SUFFIXES: readonly ModuleAffixDef[] = [
  { id: 'mt-forcefield', kind: 'suffix', stat: 'coreShieldFlat', min: 120, max: 320, trigger: 'coreProximity' },
  { id: 'mt-fury', kind: 'suffix', stat: 'facilityFireRatePct', min: 15, max: 35, trigger: 'facilitiesDestroyed', threshold: 3 },
  { id: 'mt-attrition', kind: 'suffix', stat: 'attackerSlowPct', min: 10, max: 25, trigger: 'timeElapsed', threshold: 90 },
  { id: 'mt-retribution', kind: 'suffix', stat: 'volleyDamage', min: 200, max: 500, trigger: 'guardianDowned' },
  { id: 'mt-laststand', kind: 'suffix', stat: 'bossDamagePct', min: 25, max: 55, trigger: 'coreHpLow', threshold: 30 },
  { id: 'mt-vanguard', kind: 'suffix', stat: 'formationDamagePct', min: 12, max: 28, trigger: 'earlyPhase', threshold: 20 },
  { id: 'mt-reflection', kind: 'suffix', stat: 'reflectDamagePct', min: 8, max: 20, trigger: 'coreHit' },
  { id: 'mt-bulwark', kind: 'suffix', stat: 'incomingDmgReductionPct', min: 8, max: 16, trigger: 'coreRoomEntered' },
];

/** 전체 모듈 어픽스 풀(접두 후 접미). {@link rollModule} 이 균등 추첨한다. */
export const MODULE_AFFIXES: readonly ModuleAffixDef[] = [...MODULE_PREFIXES, ...MODULE_SUFFIXES];

/** id → 모듈 어픽스 정의(미지정 시 undefined). */
export const MODULE_AFFIX_BY_ID: ReadonlyMap<string, ModuleAffixDef> = new Map(
  MODULE_AFFIXES.map((a) => [a.id, a]),
);

// ---------------------------------------------------------------------------
// 기저 효과 — 등급별 무조건 적용
// ---------------------------------------------------------------------------

/**
 * 모듈이 항상 거는 기본 방어 수치(정수 %). 구 카드는 포탑 화력·코어 HP 였는데, 3레이어에서는
 * 특정 레이어에 치우치지 않도록 **전 레이어 방어체 화력**과 코어 HP 로 잡는다.
 */
export interface ModuleBaseEffect {
  /** 편대·설비·기물·보스 공통 화력 +%. */
  readonly allDamagePct: number;
  /** 코어 HP +%. */
  readonly coreHpPct: number;
}

/** 등급별 기저 효과. 상위 등급일수록 기본치가 크다. 📝 튜닝 대상. */
export const MODULE_BASE_EFFECT: Record<Rarity, ModuleBaseEffect> = {
  normal: { allDamagePct: 3, coreHpPct: 3 },
  magic: { allDamagePct: 6, coreHpPct: 6 },
  rare: { allDamagePct: 10, coreHpPct: 10 },
  unique: { allDamagePct: 15, coreHpPct: 15 },
};

// ---------------------------------------------------------------------------
// 유니크 모듈 — 룰 변경형 고유 효과(파라미터만 데이터, 효력은 moduleEffects.ts)
// ---------------------------------------------------------------------------

/**
 * 유니크 코어 모듈 정의. `params` 는 sim 이 읽는 효과 파라미터(틱·비율 등)다.
 * (TICK_RATE=60 기준: 30초 = 1800틱.)
 */
export interface CoreModuleUniqueDef {
  readonly id: string;
  readonly name: string;
  readonly params: Readonly<Record<string, number>>;
}

/**
 * 유니크 4종(고정 룰 변경형). {@link rollModule} 이 rarity=unique 일 때 이 목록에서 하나를 뽑아
 * `uniqueId` 로 싣는다. id 는 jsonb wire 값이다.
 */
export const CORE_MODULE_UNIQUES: readonly CoreModuleUniqueDef[] = [
  // 신기루 코어: 가짜 코어를 함께 스폰(공격자 오인 유도). 가짜는 실효 HP 의 일부만 갖는다.
  { id: 'uq-mirage-core', name: '신기루 코어', params: { decoyCount: 1, decoyHpPct: 50 } },
  // 블랙아웃: 첫 30초(1800틱) 공격자 레이더 무력화.
  { id: 'uq-blackout', name: '블랙아웃', params: { radarDisableTicks: 1800 } },
  // 최후의 재기동: 코어 파괴 직전 침공당 1회 부활(부활 HP = 최대의 20%).
  { id: 'uq-last-reboot', name: '최후의 재기동', params: { reviveHpPct: 20, reviveCount: 1 } },
  // 거울 관문: 코어가 받는 피해의 25% 를 공격자에게 반사.
  { id: 'uq-mirror-gate', name: '거울 관문', params: { reflectPct: 25 } },
];

/** id → 유니크 정의(미지정 시 undefined). */
export const CORE_MODULE_UNIQUE_BY_ID: ReadonlyMap<string, CoreModuleUniqueDef> = new Map(
  CORE_MODULE_UNIQUES.map((u) => [u.id, u]),
);

// ---------------------------------------------------------------------------
// 사용 횟수 범위 · 합성 확률 · 보관 상한 · 슬롯 수
// ---------------------------------------------------------------------------

/**
 * 등급별 사용 횟수 롤 범위 [min,max] 정수 균등(강할수록 적은 횟수). 생성 시 시드로 확정.
 * 소모성 유지는 ADR-0018 의 명시 선택이다("방어당할 때마다 닳는" 긴장감·재화 싱크). 📝 시작값.
 */
export const MODULE_CHARGE_RANGE: Record<Rarity, readonly [number, number]> = {
  normal: [6, 10],
  magic: [5, 8],
  rare: [3, 6],
  unique: [2, 4],
};

/** 유니크 모듈의 고정 모듈 어픽스 수. 접두/접미로 분할된다. */
export const MODULE_UNIQUE_AFFIX_COUNT = 4;

/** 코어 모듈 전용 보관함 상한(만석 시 획득 차단). 📝 시작값 20. */
export const MODULE_STORAGE_CAP = 20;

/**
 * 코어 모듈 장착 슬롯 수. `src/sim/invasion/constants.ts` 의 `INVASION_CORE_MODULE_SLOTS` 와
 * 같은 값이어야 한다(2). 데이터 계층이 sim 을 import 하지 않는 규율(data/** 는 sim·render·ui
 * 미참조) 때문에 상수를 여기 별도로 두고, tests/coreModules.test.ts 가 두 값의 일치를 강제한다.
 */
export const MODULE_EQUIP_SLOTS = 2;

/** 합성에 소모하는 동급 모듈 수(3개 → 1개). */
export const MODULE_FUSION_INPUT_COUNT = 3;

/**
 * 등급별 합성 승급 확률(해당 등급 3개 → 상위 등급 1개). unique 는 상위가 없어 키 없음.
 * 실패해도 동급 새 모듈 1개 반환(순소실 없음 — {@link attemptModuleFusion}). 📝 시작값.
 */
export const MODULE_FUSION_CHANCE: Partial<Record<Rarity, number>> = {
  normal: 0.5, // → magic
  magic: 0.2, // → rare
  rare: 0.03, // → unique
};

// ---------------------------------------------------------------------------
// 방어 성공 보조 보상 — 크레딧 정액 (기획 §4, ADR-0018)
// ---------------------------------------------------------------------------

/**
 * 방어 성공(침공 격퇴) 시 방어자가 받는 **크레딧 정액**. 코어 모듈 드랍은 폐지됐다 —
 * 방어 실적이 방어체 획득 경로가 되면 상위권이 계속 강해지는 부익부가 발생하기 때문이다
 * (ADR-0018 Consequences: "방어 실적은 방어체 획득 경로가 아니다").
 *
 * 전투력 우위 보정(구 `defenseSuccessDropChance`)도 없다 — 정액이라 서버가 무작위 없이
 * 확정 지급하고(멱등), 클라가 재현 검증할 필요도 없다. 📝 시작값.
 */
export const DEFENSE_SUCCESS_CREDITS = 40;

// ---------------------------------------------------------------------------
// 모듈 인스턴스 직렬화 계약 — DB jsonb·스냅샷에 실린다
// ---------------------------------------------------------------------------

/**
 * 모듈에 확정된 하나의 모듈 어픽스 롤.
 * **wire 고정**: 키 `id`·`stat`·`value` 는 구 `CardAffixRoll` 과 동일하다(개명 금지).
 */
export interface ModuleAffixRoll {
  /** {@link ModuleAffixDef.id} 출처. */
  readonly id: string;
  readonly stat: ModuleStatKey;
  /** 정의의 [min,max] 내 롤 정수. */
  readonly value: number;
}

/**
 * 확정된 코어 모듈 인스턴스. `rollModule(seed, rarity)` 로 완전히 결정되어, 같은 시드는 클라·EF
 * 에서 바이트 동일 모듈을 재구성한다.
 *
 * **wire 고정**: 키 `id`·`rarity`·`prefixes`·`suffixes`·`uniqueId`·`chargesMax`·`chargesLeft`·
 * `seed` 는 구 `CardInstance` 와 동일하다 — 개명은 TypeScript 심볼과 표시 문자열에만 적용된다
 * (ADR-0005: 직렬화 키가 바뀌면 서버 재실행 바이트 일치가 깨진다). 필드 추가는 append-only.
 */
export interface ModuleInstance {
  /** 인스턴스 id(시드 파생, 안정·재현). */
  readonly id: string;
  readonly rarity: Rarity;
  /** 정적 카운터(접두) 롤. */
  readonly prefixes: readonly ModuleAffixRoll[];
  /** 동적 트리거(접미) 롤. */
  readonly suffixes: readonly ModuleAffixRoll[];
  /** rarity=unique 일 때만 설정 — {@link CORE_MODULE_UNIQUES} 키. */
  readonly uniqueId?: string;
  /** 생성 시 롤된 최대 사용 횟수. */
  readonly chargesMax: number;
  /** 남은 사용 횟수(생성 시 = chargesMax, 확정 침공마다 서버가 1 차감). */
  readonly chargesLeft: number;
  /** 롤 시드(재현·감사). */
  readonly seed: number;
}

// ---------------------------------------------------------------------------
// 결정론 롤러 — 모듈 확정 · 합성 · 상점 로테이션
// ---------------------------------------------------------------------------

/**
 * 등급별 모듈 어픽스 수. magic/rare 는 rng 에서 뽑고, normal 은 0(무추첨), unique 는 고정 상수.
 * 드로우 순서가 곧 스트림 계약이므로 순서를 바꾸지 말 것.
 */
function moduleAffixCountFor(rarity: Rarity, rng: SeededRng): number {
  switch (rarity) {
    case 'normal':
      return 0;
    case 'magic':
      return rng.int(1, 2);
    case 'rare':
      return rng.int(3, 6);
    case 'unique':
      return MODULE_UNIQUE_AFFIX_COUNT;
  }
}

/**
 * 접두+접미 합집합 풀에서 `count` 개를 중복 없이 뽑아 값을 롤하고, kind 로 접두/접미에 분류한다.
 * 무교체 추첨(작업 복사본에서 splice)이라 같은 시드는 항상 같은 어픽스 집합·순서를 낸다.
 */
function rollModuleAffixes(
  rng: SeededRng,
  count: number,
): { prefixes: ModuleAffixRoll[]; suffixes: ModuleAffixRoll[] } {
  const pool: ModuleAffixDef[] = [...MODULE_PREFIXES, ...MODULE_SUFFIXES];
  const prefixes: ModuleAffixRoll[] = [];
  const suffixes: ModuleAffixRoll[] = [];
  const n = count < pool.length ? count : pool.length;
  for (let k = 0; k < n; k++) {
    const j = rng.int(0, pool.length - 1);
    const def = pool[j];
    pool.splice(j, 1);
    if (def === undefined) continue;
    const value = rng.int(def.min, def.max);
    const roll: ModuleAffixRoll = { id: def.id, stat: def.stat, value };
    if (def.kind === 'prefix') prefixes.push(roll);
    else suffixes.push(roll);
  }
  return { prefixes, suffixes };
}

/**
 * 코어 모듈 하나를 확정한다. (`seed`, `rarity`) 에 결정론적.
 * 드로우 순서(정본): 어픽스 수 → 어픽스 → 사용 횟수 → (unique 면) 유니크 id. 순서 변경 금지.
 */
export function rollModule(seed: number, rarity: Rarity): ModuleInstance {
  const s = seed >>> 0;
  const rng = new SeededRng(s);

  const { prefixes, suffixes } = rollModuleAffixes(rng, moduleAffixCountFor(rarity, rng));

  const [lo, hi] = MODULE_CHARGE_RANGE[rarity];
  const chargesMax = rng.int(lo, hi);

  let uniqueId: string | undefined;
  if (rarity === 'unique') {
    const idx = rng.int(0, Math.max(0, CORE_MODULE_UNIQUES.length - 1));
    uniqueId = CORE_MODULE_UNIQUES[idx]?.id;
  }

  // exactOptionalPropertyTypes: undefined 를 optional 필드에 대입하지 않도록 조건부 스프레드.
  return {
    id: `module-${s}`,
    rarity,
    prefixes,
    suffixes,
    chargesMax,
    chargesLeft: chargesMax,
    seed: s,
    ...(uniqueId !== undefined ? { uniqueId } : {}),
  };
}

/** 합성 판정 결과: 승급 여부 + 결과 모듈(성공=상위 등급, 실패=동급 새 모듈). */
export interface ModuleFusionResult {
  readonly promoted: boolean;
  readonly module: ModuleInstance;
}

/** 등급 승급 사다리(normal→magic→rare→unique). 최상위(unique)는 undefined. */
export function nextRarityUp(rarity: Rarity): Rarity | undefined {
  switch (rarity) {
    case 'normal':
      return 'magic';
    case 'magic':
      return 'rare';
    case 'rare':
      return 'unique';
    case 'unique':
      return undefined;
  }
}

/**
 * 합성 판정: 같은 등급 3개 소모 → 상위 등급 승급 확률 판정. 실패해도 동급 새 모듈 1개 반환
 * (순소실 없음 — 새 옵션·새 횟수 롤이 사실상 리롤). unique 는 상위가 없어 항상 동급 재롤.
 * 드로우 순서: 승급 판정(nextFloat) → 결과 모듈 시드(nextU32).
 */
export function attemptModuleFusion(seed: number, rarity: Rarity): ModuleFusionResult {
  const rng = new SeededRng(seed >>> 0);
  const up = nextRarityUp(rarity);
  const chance = up !== undefined ? (MODULE_FUSION_CHANCE[rarity] ?? 0) : 0;
  const promoted = rng.nextFloat() < chance;
  const resultRarity = promoted && up !== undefined ? up : rarity;
  const moduleSeed = rng.nextU32();
  return { promoted, module: rollModule(moduleSeed, resultRarity) };
}

// ---------------------------------------------------------------------------
// 상점 로테이션 — (UTC 날짜, 유저) 결정론
// ---------------------------------------------------------------------------

/** 상점 로테이션 한 칸(어느 등급 모듈을, 어느 시드로). {@link rollModule} 로 실제 모듈이 된다. */
export interface ModuleShopSlot {
  readonly rarity: Rarity;
  readonly seed: number;
}

/** 상점 재고 범위: normal 3~4 + magic 1~2. 레어 이상은 상점에 없음. 📝 시작값. */
export const MODULE_SHOP_NORMAL_RANGE: readonly [number, number] = [3, 4];
export const MODULE_SHOP_MAGIC_RANGE: readonly [number, number] = [1, 2];

/**
 * 상점 로테이션 날짜 시드(UTC 일 단위). epoch ms → UTC 기준 날 인덱스. 같은 UTC 날짜면 클라·
 * 서버가 동일 시드를 얻어 재고를 일치시킨다(순수 — 호출 측이 시계값 nowMs 공급).
 */
export function shopDateSeedFromMs(nowMs: number): number {
  return Math.floor(nowMs / 86_400_000) >>> 0;
}

/**
 * 유저 고유 상점 시드(프로필 기반 안정값). uid 문자열을 FNV-1a 로 u32 로 접는다
 * (SeededRng.fork 의 hashString 과 동일 규약).
 */
export function shopUserSeed(uid: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 방어 사령부 일일 로테이션 계획(등급+시드). 같은 날 같은 유저는 항상 동일 재고를 받고,
 * normal·magic 만 등장한다. {@link rollModuleShopRotation} 이 이를 인스턴스로 확정한다.
 */
export function dailyModuleShopRotation(dateSeed: number, userSeed: number): ModuleShopSlot[] {
  // 날짜 시드에서 유저별 독립 스트림을 파생(같은 날이라도 유저마다 다른 재고, 유저·날 고정 시 동일).
  const rng = new SeededRng(dateSeed >>> 0).fork(userSeed >>> 0);
  const normalCount = rng.int(MODULE_SHOP_NORMAL_RANGE[0], MODULE_SHOP_NORMAL_RANGE[1]);
  const magicCount = rng.int(MODULE_SHOP_MAGIC_RANGE[0], MODULE_SHOP_MAGIC_RANGE[1]);
  const slots: ModuleShopSlot[] = [];
  for (let i = 0; i < normalCount; i++) slots.push({ rarity: 'normal', seed: rng.nextU32() });
  for (let i = 0; i < magicCount; i++) slots.push({ rarity: 'magic', seed: rng.nextU32() });
  return slots;
}

/** 일일 상점 로테이션을 실제 모듈로 롤한다. 같은 (dateSeed,userSeed) → 동일 재고. */
export function rollModuleShopRotation(dateSeed: number, userSeed: number): ModuleInstance[] {
  return dailyModuleShopRotation(dateSeed, userSeed).map((slot) => rollModule(slot.seed, slot.rarity));
}

// ---------------------------------------------------------------------------
// 가격 · 분해 환급 (순수 정수)
// ---------------------------------------------------------------------------

/** 모듈 구매 기본 비용(크레딧). 앵커: normal(랭크0) = BASE. 📝 시작값. */
export const MODULE_BUY_BASE = 40;
/** 등급 1단계당 추가 구매 비용(크레딧). 📝 시작값. */
export const MODULE_BUY_PER_RARITY = 60;

/**
 * 상점 모듈 구매 비용(크레딧). BASE + PER_RARITY×등급랭크(RARITY_CODE).
 * normal 40 / magic 100 / rare 160 / unique 220. 결정론 정수 — 서버(차감)·클라(표기) 동일.
 */
export function moduleBuyPrice(rarity: Rarity): number {
  return MODULE_BUY_BASE + MODULE_BUY_PER_RARITY * RARITY_CODE[rarity];
}

/** 등급별 분해 기본 환급(크레딧). 📝 시작값. */
export const MODULE_SALVAGE_BASE: Record<Rarity, number> = {
  normal: 5,
  magic: 15,
  rare: 40,
  unique: 100,
};

/** 모듈 어픽스 1개당 추가 환급(크레딧). */
export const MODULE_SALVAGE_PER_AFFIX = 4;

/**
 * 모듈 분해 환급치(크레딧). 등급 기본 + 모듈 어픽스 수 가산. 남은 횟수와 무관(소모품 잔량이
 * 아니라 롤 가치를 되판다). 결정론 정수.
 */
export function moduleSalvageValue(mod: ModuleInstance): number {
  const affixCount = mod.prefixes.length + mod.suffixes.length;
  return MODULE_SALVAGE_BASE[mod.rarity] + affixCount * MODULE_SALVAGE_PER_AFFIX;
}

/** 등급 랭크(RARITY_CODE 재사용) — 정렬·표기용 재노출. */
export function moduleRarityRank(rarity: Rarity): number {
  return RARITY_CODE[rarity];
}

// ---------------------------------------------------------------------------
// i18n 키 규약 (def3.* — L9 카탈로그 규약 정합)
// ---------------------------------------------------------------------------

/**
 * 코어 모듈 i18n 종류 접두. 최종 키는 `def3.module.<슬러그>.name` / `.desc` 꼴이다.
 * (`data/invasion/catalog.ts` 의 CATALOG_KIND_PREFIX 와 같은 결 — 다만 모듈은 배치 카탈로그가
 * 아니라 인스턴스 경제라 INVASION_CATALOG 레지스트리에 편입하지 않는다.)
 */
export const MODULE_I18N_PREFIX = 'module';

/**
 * 모듈 어픽스 i18n 종류 접두 — **방어체 어픽스와 같은 `def3.affix.*` 네임스페이스**를 쓴다
 * (`data/defenseUnits.ts` 의 `defenseUnitAffixNameKey` 와 동일 규약). id 접두가 서로 달라
 * (`mc-`/`mt-` vs `du-`/`dt-`) 충돌하지 않고, 어픽스를 어느 축에서 추가하든 같은 자리에서
 * 문구를 찾게 된다.
 */
export const MODULE_AFFIX_I18N_PREFIX = 'affix';

/** 모듈 어픽스 표기명 i18n 키. 컬러 이모지 금지(Pixi 두부). */
export function moduleAffixNameKey(affixId: string): string {
  return `def3.${MODULE_AFFIX_I18N_PREFIX}.${affixId}.name`;
}

/** 모듈 어픽스 설명 i18n 키. */
export function moduleAffixDescKey(affixId: string): string {
  return `def3.${MODULE_AFFIX_I18N_PREFIX}.${affixId}.desc`;
}

/** 유니크 모듈 표시명 i18n 키. 컬러 이모지 금지(Pixi 두부). */
export function moduleUniqueNameKey(uniqueId: string): string {
  return `def3.${MODULE_I18N_PREFIX}.${uniqueId}.name`;
}

/** 유니크 모듈 설명 i18n 키. */
export function moduleUniqueDescKey(uniqueId: string): string {
  return `def3.${MODULE_I18N_PREFIX}.${uniqueId}.desc`;
}
