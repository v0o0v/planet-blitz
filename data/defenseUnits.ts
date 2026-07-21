/**
 * 방어체 인벤토리 · 방어체 어픽스 엔진 · 강화 3축 경제 (M7b · M7b-inventory).
 *
 * ## 무엇인가
 * `InvasionRef = {catalogId, level, ascension, affixSeed, rarity}`(src/sim/invasion/types.ts)는
 * **이미 sim 에 배선돼 있다**. 이 모듈은 그 5필드를 **만들고·기르고·저장하는 메타 경제**다.
 *   ① 방어체 레벨(크레딧 + 희귀 광물, 1~99)
 *   ② 승급(중복 설계도, 0~5 — 외형 변화 신호)
 *   ③ 방어체 어픽스 리롤(희귀 광물)
 *
 * ## 왜 복제인가 (data/defenseCards.ts / src/items/types.ts)
 * - **방어체 어픽스**는 장비 어픽스(`StatKey` — 플레이어 파생 스탯 어휘)와 **다른 어휘**다.
 *   카드가 `CardStatKey` 를 따로 만든 전례를 그대로 따라 `DefenseUnitStatKey` 를 신설한다.
 *   용어는 CONTEXT.md 규약대로 항상 **"방어체 어픽스"** 전체 표기로 쓴다(장비 어픽스·카드
 *   어픽스·엘리트 어픽스와 4중 구분).
 * - 반대로 `Rarity`/`RARITY_CODE` 4등급 사다리와 `nextRarityUp` 은 **무수정 재활용**한다.
 *   등급 사다리는 어휘가 아니라 공통 축이다.
 *
 * ## 결정론(ADR-0005)
 * 순수 데이터 + 순수 정수 함수다. `Math.random`·`Date.now`·pixi 를 쓰지 않는다(data/** 는
 * eslint simCoreRestrictions 대상). 유일한 무작위원은 시드 기반 `SeededRng` 이며 롤 자체는
 * `src/items/rollDefenseUnit.ts` 가 담당한다(데이터/롤러 계층 분리 — defenseCards ↔ rollCard 선례).
 *
 * ## sim 산식과의 정합 (이 모듈의 존재 이유 절반)
 * 강화 3축 → 실효 스탯 배율은 **sim 이 이미 쓰는 산식과 바이트 동일**해야 한다. 메타 화면이
 * 보여주는 수치와 실제 전투가 갈리면 그 자체로 결함이다. 그래서 {@link defenseUnitScaleStat} 은
 * 종류별로 sim 의 정본 산식을 그대로 재현한다:
 *   - 편대  → `data/invasion/formations.ts` `formationPowerCp` (centi-percent 1단 반올림)
 *   - 설비  → `src/sim/invasion/facility.ts` `resolveFacilityStats` (레벨→등급→승급 **3단 순차 반올림**)
 *   - 기물  → `data/invasion/props.ts` `propPowerBp` + `scaleByBp`
 *   - 보스  → `data/invasion/defenseBosses.ts` `defenseBossPowerBp` + `scaleByBp`
 * 편대·기물·보스는 sim 이 export 하는 함수를 **직접 호출**해 드리프트가 구조적으로 불가능하다.
 * 설비만은 배율 상수가 `src/sim/invasion/facility.ts` 모듈 private 이라 여기서 재선언하는데,
 * 그 대신 `tests/defenseUnits.test.ts` 가 `resolveFacilityStats` 실제 출력과 **전 구간 대조**한다
 * (상수가 갈리는 순간 테스트가 그 자리에서 깨진다).
 *
 * ## 정수 산술 규율
 * 모든 배율은 정수 basis-point(10000 = ×1.00) 또는 centi-percent(100 = ×1.00)이고, 곱은
 * `Math.round(base * bp / 10000)` 단일 나눗셈 관용구로만 접는다. f64 누적 금지.
 *
 * 📝 모든 수치(레벨 곡선·승급 설계도 수·리롤 비용·어픽스 롤 범위·보관 상한)는 밸런스 조정 대상.
 */

import type { Rarity } from '../src/items/types.js';
import { RARITY_CODE, RARITY_BY_CODE } from '../src/items/types.js';
// 등급 승급 사다리는 코어 모듈 쪽 정본을 그대로 쓴다(구 data/defenseCards.ts 는 M7b 에서
// 삭제됐고, 같은 4등급 사다리를 두 벌 두면 한쪽만 늘었을 때 조용히 갈린다).
import { nextRarityUp } from './coreModules.js';
import {
  CATALOG_FORMATION,
  CATALOG_FACILITY,
  CATALOG_PROP,
  CATALOG_BOSS,
} from './invasion/catalog.js';
import { formationPowerCp } from './invasion/formations.js';
import { propPowerBp } from './invasion/props.js';
import { defenseBossPowerBp, scaleByBp } from './invasion/defenseBosses.js';
import {
  INVASION_LEVEL_MIN,
  INVASION_LEVEL_MAX,
  INVASION_ASCENSION_MIN,
  INVASION_ASCENSION_MAX,
} from '../src/sim/invasion/constants.js';

// 등급 사다리는 재활용이므로 그대로 재수출한다(호출부가 두 모듈을 import 하지 않게).
export { nextRarityUp };
export type { Rarity };

// ---------------------------------------------------------------------------
// 방어체 어픽스 — 효과 stat 어휘
// ---------------------------------------------------------------------------

/**
 * **방어체 어픽스**가 거는 보정의 종류. 백분율 stat 은 정수 퍼센트(10 = +10%), flat stat 은
 * 절대량이다.
 *
 * 어휘를 고를 때의 규율(sim 이 이미 지키는 것과 같다): **기하(반지름·사거리·탄속)와 각도는
 * 어픽스 대상이 아니다.** 그것들을 흔들면 충돌 판정 f64 산술에 강화 축이 섞여 들어가 클라·서버
 * 재실행이 갈릴 위험이 생긴다. 내구도·피해·간격(틱)·보호막처럼 **정수로 접히는 축만** 둔다.
 */
export type DefenseUnitStatKey =
  /** 내구도 +%. */
  | 'defHpPct'
  /** 피해 +%(접촉·투사체·해저드 공통). */
  | 'defDamagePct'
  /** 발사·생산 간격 -%(연사 상승). */
  | 'defFireRatePct'
  /** 보호막(절대) — 파괴 전까지 내구도 위에 얹힌다. */
  | 'defShieldFlat'
  /** 정비도 풍화 저항 -%(방치 시 간격 증가폭을 줄인다). */
  | 'defWeatherResistPct'
  /** 스포너 동시 생존 상한 +(절대). */
  | 'defSpawnCapFlat'
  /** 과열 창 지속 -%(보스 전용 — 약점 노출을 줄인다). */
  | 'defOverheatResistPct'
  /** 편대 진입 지연 -%(더 빨리 밀려 들어온다). */
  | 'defEntryHastePct';

/** 어픽스 종류 — 접두(상시)/접미(조건부). */
export type DefenseUnitAffixKind = 'prefix' | 'suffix';

/**
 * 접미(조건부) 발동 계기. `threshold` 의 의미는 계기별로 다르다
 * (coreHpLow=코어 HP %, allyDestroyed=아군 방어체 파괴 수, timeElapsed=경과 초,
 *  playerClose=플레이어 접근 반경 유닛, layerEnter=무의미(0)).
 */
export type DefenseUnitTrigger =
  /** 이 방어체가 속한 레이어에 공격자가 진입한 순간. */
  | 'layerEnter'
  /** 코어 HP 가 threshold % 이하. */
  | 'coreHpLow'
  /** 같은 레이어의 아군 방어체가 threshold 기 파괴됨. */
  | 'allyDestroyed'
  /** 레이어 진입 후 threshold 초 경과. */
  | 'timeElapsed'
  /** 공격자가 반경 threshold 유닛 안으로 진입. */
  | 'playerClose';

/**
 * 어픽스가 붙을 수 있는 방어체 종류(카탈로그 종류 코드 = `data/invasion/catalog.ts` CATALOG_*).
 * 맵 템플릿(CATALOG_MAP)은 소유·강화 대상이 아니라 여기 등장하지 않는다.
 */
export const DEFENSE_UNIT_KINDS: readonly number[] = [
  CATALOG_FORMATION,
  CATALOG_FACILITY,
  CATALOG_PROP,
  CATALOG_BOSS,
];

/**
 * 방어체 어픽스 정의(designer-authored). value 는 [min,max] 정수 균등 롤.
 *
 * `id` 는 직렬화 계약이다 — **절대 재번호·개명 금지**(저장된 인스턴스가 다른 어픽스를 가리킨다).
 * 표시 문자열은 여기 두지 않는다: 이름은 {@link defenseUnitAffixNameKey} 가 파생하는 i18n 키
 * (`def3.affix.<id>.name`)로만 노출한다(컬러 이모지 금지 — Pixi 두부).
 */
export interface DefenseUnitAffixDef {
  readonly id: string;
  readonly kind: DefenseUnitAffixKind;
  readonly stat: DefenseUnitStatKey;
  readonly min: number;
  readonly max: number;
  /** 붙을 수 있는 방어체 종류(CATALOG_* 코드). 비면 전 종류 허용이 아니라 **정의 오류**다. */
  readonly kinds: readonly number[];
  /** 접미 전용: 발동 계기. */
  readonly trigger?: DefenseUnitTrigger;
  /** 접미 전용: 발동 임계(계기별 의미 상이 — {@link DefenseUnitTrigger} 주석 참조). */
  readonly threshold?: number;
}

/** 전 종류에 붙는 어픽스의 kinds 값(가독성용 별칭). */
const ALL_KINDS: readonly number[] = DEFENSE_UNIT_KINDS;

/**
 * 접두 8종 — **상시** 보정(조건 없음). 방어자가 배치만 하면 항상 실린다.
 */
export const DEFENSE_UNIT_PREFIXES: readonly DefenseUnitAffixDef[] = [
  { id: 'du-reinforced', kind: 'prefix', stat: 'defHpPct', min: 8, max: 20, kinds: ALL_KINDS },
  { id: 'du-honed', kind: 'prefix', stat: 'defDamagePct', min: 6, max: 16, kinds: ALL_KINDS },
  { id: 'du-cycled', kind: 'prefix', stat: 'defFireRatePct', min: 5, max: 14, kinds: [CATALOG_FACILITY, CATALOG_PROP, CATALOG_BOSS] },
  { id: 'du-plated', kind: 'prefix', stat: 'defShieldFlat', min: 120, max: 420, kinds: [CATALOG_PROP, CATALOG_BOSS] },
  { id: 'du-sealed', kind: 'prefix', stat: 'defWeatherResistPct', min: 10, max: 30, kinds: ALL_KINDS },
  { id: 'du-teeming', kind: 'prefix', stat: 'defSpawnCapFlat', min: 1, max: 3, kinds: [CATALOG_FACILITY] },
  { id: 'du-insulated', kind: 'prefix', stat: 'defOverheatResistPct', min: 8, max: 22, kinds: [CATALOG_BOSS] },
  { id: 'du-vanward', kind: 'prefix', stat: 'defEntryHastePct', min: 10, max: 28, kinds: [CATALOG_FORMATION] },
];

/**
 * 접미 8종 — **조건부** 보정(런 중 계기 충족 시 발동). 접두보다 롤 폭이 크다(조건 리스크의 대가).
 */
export const DEFENSE_UNIT_SUFFIXES: readonly DefenseUnitAffixDef[] = [
  { id: 'dt-ambush', kind: 'suffix', stat: 'defDamagePct', min: 15, max: 40, kinds: ALL_KINDS, trigger: 'layerEnter', threshold: 0 },
  { id: 'dt-lastwall', kind: 'suffix', stat: 'defHpPct', min: 20, max: 55, kinds: ALL_KINDS, trigger: 'coreHpLow', threshold: 30 },
  { id: 'dt-vengeance', kind: 'suffix', stat: 'defDamagePct', min: 12, max: 34, kinds: ALL_KINDS, trigger: 'allyDestroyed', threshold: 2 },
  { id: 'dt-siege', kind: 'suffix', stat: 'defFireRatePct', min: 10, max: 26, kinds: [CATALOG_FACILITY, CATALOG_PROP, CATALOG_BOSS], trigger: 'timeElapsed', threshold: 60 },
  { id: 'dt-bulwark', kind: 'suffix', stat: 'defShieldFlat', min: 200, max: 640, kinds: [CATALOG_PROP, CATALOG_BOSS], trigger: 'coreHpLow', threshold: 50 },
  { id: 'dt-recoil', kind: 'suffix', stat: 'defDamagePct', min: 18, max: 46, kinds: ALL_KINDS, trigger: 'playerClose', threshold: 320 },
  { id: 'dt-swarmcall', kind: 'suffix', stat: 'defSpawnCapFlat', min: 1, max: 4, kinds: [CATALOG_FACILITY], trigger: 'allyDestroyed', threshold: 1 },
  { id: 'dt-secondwind', kind: 'suffix', stat: 'defWeatherResistPct', min: 15, max: 40, kinds: ALL_KINDS, trigger: 'timeElapsed', threshold: 120 },
];

/** 전체 방어체 어픽스 풀(접두 후 접미). 롤러가 종류로 거른 뒤 균등 추첨한다. */
export const DEFENSE_UNIT_AFFIXES: readonly DefenseUnitAffixDef[] = [
  ...DEFENSE_UNIT_PREFIXES,
  ...DEFENSE_UNIT_SUFFIXES,
];

/** id → 방어체 어픽스 정의(미지정 시 undefined). */
export const DEFENSE_UNIT_AFFIX_BY_ID: ReadonlyMap<string, DefenseUnitAffixDef> = new Map(
  DEFENSE_UNIT_AFFIXES.map((a) => [a.id, a]),
);

/** 특정 종류에 붙을 수 있는 어픽스만 추린다(롤 풀 — 순서는 정의 순서 고정 = 결정론 입력). */
export function defenseUnitAffixPool(kind: number): readonly DefenseUnitAffixDef[] {
  return DEFENSE_UNIT_AFFIXES.filter((a) => a.kinds.includes(kind));
}

/** 방어체 어픽스 표시명 i18n 키(`def3.affix.<id>.name`). 본문은 src/i18n/catalog.ts 소관. */
export function defenseUnitAffixNameKey(affixId: string): string {
  return `def3.affix.${affixId}.name`;
}

/** 방어체 어픽스 설명 i18n 키(`def3.affix.<id>.desc`). */
export function defenseUnitAffixDescKey(affixId: string): string {
  return `def3.affix.${affixId}.desc`;
}

// ---------------------------------------------------------------------------
// 유니크 방어체 고유 효과 (M7c)
// ---------------------------------------------------------------------------

/**
 * 유니크 방어체 고유 효과의 **판별자**. `params` 의 키 집합이 판별자마다 다르므로
 * (`data/coreModules.ts` `CoreModuleUniqueDef` 문법 복제 + 판별자 추가) sim 은 이 값으로
 * switch 하고 숫자는 전부 `params` 에서 읽는다.
 *
 * ## 왜 "고유"인가 — 일반 어픽스와 무엇이 다른가
 * 일반 방어체 어픽스는 **상수**(접두) 또는 **불리언 게이트가 걸린 상수**(접미)다. 유니크
 * 고유 효과는 그 위에 **런 상태의 연속 함수**를 얹는다 — 경과 시간·파괴된 아군 수·코어 HP·
 * 공격자 거리에 따라 매 틱 값이 달라진다. 어픽스 문법으로는 표현할 수 없는 형태이고,
 * 그래서 유니크가 "숫자가 큰 레어"가 아니라 다른 물건이 된다.
 *
 * ## 정수 규율
 * 동적 항은 전부 basis-point 정수이고 `Math.floor(a * bp / d)` **단일 나눗셈**으로만 접는다
 * (`src/sim/invasion/affix.ts` `uniqueDynamicMods`). f64 누적 없음.
 */
export type DefenseUniqueEffect =
  /** 과부하 노심 — 레이어 경과 시간에 비례해 연사가 오른다. 대신 상시 내구도 감소. */
  | 'overclockCore'
  /** 복수 기관 — 같은 레이어의 아군이 파괴될수록 피해가 오른다. */
  | 'vengeanceEngine'
  /** 최후의 요새 — 코어 HP 가 낮을수록 내구도가 오른다(코어가 있는 레이어 전용). */
  | 'deathgripBastion'
  /** 근접 반응로 — 공격자가 가까울수록 피해가 오른다(거리 밴드 계단). */
  | 'proximityReactor'
  /** 군체 중추 — 동시 생존 상한 대폭 증가, 대신 생산 간격 증가. */
  | 'swarmNexus'
  /** 수호 격자 — 보호막·풍화 저항을 얻고 피해를 잃는다. */
  | 'aegisLattice'
  /** 열 금고 — 과열 창이 짧아지고 내구도가 오른다(보스 전용). */
  | 'thermalVault'
  /** 선봉 조류 — 훨씬 빨리 밀려 들어오고 피해가 높다. 대신 무르다(편대 전용). */
  | 'vanguardTide';

/**
 * 유니크 방어체 고유 효과 정의(designer-authored).
 *
 * `id` 는 **wire 계약**이다(`defense_units.unit` jsonb `uniqueId`) — 재번호·개명 금지.
 * `kinds` 는 붙을 수 있는 방어체 종류(CATALOG_*)이고 **특정 catalogId 를 절대 지목하지 않는다**:
 * 카탈로그는 M7c 에서 계속 늘어나므로 고유 효과를 개별 항목에 묶으면 append 마다 표를 고쳐야 하고,
 * 그러다 한 번이라도 인덱스를 틀면 배치 jsonb·해시 스트림이 함께 깨진다.
 */
export interface DefenseUniqueDef {
  readonly id: string;
  readonly effect: DefenseUniqueEffect;
  /** 붙을 수 있는 방어체 종류(CATALOG_* 코드). 비면 정의 오류. */
  readonly kinds: readonly number[];
  /** sim 이 읽는 효과 파라미터. **전부 정수**(퍼센트·basis-point·틱·유닛). */
  readonly params: Readonly<Record<string, number>>;
}

/**
 * 유니크 고유 효과 8종. 배열 순서는 **롤 결정론 입력**이므로 append-only
 * (중간 삽입·재정렬 = 같은 시드가 다른 유니크를 내는 것 = 저장된 방어체가 바뀌는 것).
 *
 * 배분: 편대 1 전용 · 설비 1 전용 · 보스 1 전용 · 코어 레이어(기물·보스) 1 · 전 종류 2 ·
 * 사격체 계열(설비·기물·보스) 2. 종류마다 최소 3종이 걸리게 해 유니크 롤이 한 가지로
 * 수렴하지 않는다. 📝 모든 수치는 밸런스 조정 대상.
 */
export const DEFENSE_UNIQUES: readonly DefenseUniqueDef[] = [
  {
    id: 'duq-overclock-core',
    effect: 'overclockCore',
    kinds: [CATALOG_FACILITY, CATALOG_PROP, CATALOG_BOSS],
    // 1초당 연사 +0.60%(60bp), 상한 +60%(6000bp). 대가로 상시 내구도 −25%.
    params: { hpPenaltyPct: 25, rateBpPerSec: 60, rateCapBp: 6000 },
  },
  {
    id: 'duq-vengeance-engine',
    effect: 'vengeanceEngine',
    kinds: ALL_KINDS,
    // 같은 레이어 아군 1기 파괴당 피해 +12%(1200bp), 상한 +60%.
    params: { damageBpPerAlly: 1200, damageCapBp: 6000 },
  },
  {
    id: 'duq-deathgrip-bastion',
    effect: 'deathgripBastion',
    kinds: [CATALOG_PROP, CATALOG_BOSS],
    // 코어 HP 60% 아래부터 선형 상승, 코어 HP 0 에서 내구도 +80%(8000bp).
    params: { pivotPct: 60, hpBpAtZero: 8000 },
  },
  {
    id: 'duq-proximity-reactor',
    effect: 'proximityReactor',
    kinds: ALL_KINDS,
    // 반경 480u 안에서 거리 4밴드 계단, 최근접 밴드에서 피해 +50%(5000bp).
    params: { radius: 480, damageBpNear: 5000, bands: 4 },
  },
  {
    id: 'duq-swarm-nexus',
    effect: 'swarmNexus',
    kinds: [CATALOG_FACILITY],
    // 동시 생존 +3, 대가로 생산·발사 간격 +25%(연사 −20%).
    params: { spawnCapFlat: 3, fireRatePenaltyPct: 20 },
  },
  {
    id: 'duq-aegis-lattice',
    effect: 'aegisLattice',
    kinds: [CATALOG_FACILITY, CATALOG_PROP, CATALOG_BOSS],
    params: { shieldFlat: 900, weatherResistPct: 50, damagePenaltyPct: 30 },
  },
  {
    id: 'duq-thermal-vault',
    effect: 'thermalVault',
    kinds: [CATALOG_BOSS],
    params: { overheatResistPct: 55, hpBonusPct: 15 },
  },
  {
    id: 'duq-vanguard-tide',
    effect: 'vanguardTide',
    kinds: [CATALOG_FORMATION],
    params: { entryHastePct: 45, damageBonusPct: 20, hpPenaltyPct: 15 },
  },
];

/** id → 유니크 정의(미지정 시 undefined). */
export const DEFENSE_UNIQUE_BY_ID: ReadonlyMap<string, DefenseUniqueDef> = new Map(
  DEFENSE_UNIQUES.map((u) => [u.id, u]),
);

/**
 * 특정 종류에 붙을 수 있는 유니크만 추린다(롤 풀 — 순서는 정의 순서 고정 = 결정론 입력).
 * 어픽스 풀({@link defenseUnitAffixPool})과 같은 규율이다.
 */
export function defenseUniquePool(kind: number): readonly DefenseUniqueDef[] {
  return DEFENSE_UNIQUES.filter((u) => u.kinds.includes(kind));
}

/** 유니크 방어체 표시명 i18n 키(`def3.duq.<id>.name`). 본문은 src/i18n/catalog.ts 소관. */
export function defenseUniqueNameKey(uniqueId: string): string {
  return `def3.duq.${uniqueId}.name`;
}

/** 유니크 방어체 설명 i18n 키(`def3.duq.<id>.desc`). */
export function defenseUniqueDescKey(uniqueId: string): string {
  return `def3.duq.${uniqueId}.desc`;
}

/**
 * 유니크 8종에서 **파생한** i18n 키 목록(name·desc 각 1건). 하드코딩 표가 아니라 파생이므로
 * 유니크를 추가하면 문구를 채우기 전까지 i18n 전수 테스트가 빨간불로 남는다
 * (`data/invasion/catalog.ts` `DEF3_MESSAGE_KEYS` 선례).
 */
export const DEFENSE_UNIQUE_MESSAGE_KEYS: readonly string[] = DEFENSE_UNIQUES.flatMap((u) => [
  defenseUniqueNameKey(u.id),
  defenseUniqueDescKey(u.id),
]);

/** 파라미터 읽기(미정의 키는 fallback). 정의가 줄어도 sim 이 NaN 을 만들지 않는다. */
export function uniqueParam(def: DefenseUniqueDef, key: string, fallback: number): number {
  const v = def.params[key];
  return v === undefined || !Number.isFinite(v) ? fallback : Math.trunc(v);
}

// ---------------------------------------------------------------------------
// 인스턴스 직렬화 계약 — DB jsonb 에 실린다
// ---------------------------------------------------------------------------

/** 확정된 방어체 어픽스 롤 1건(카드 CardAffixRoll 과 형태 동일, stat 만 다른 어휘). */
export interface DefenseUnitAffixRoll {
  /** {@link DefenseUnitAffixDef.id} 출처. */
  readonly id: string;
  readonly stat: DefenseUnitStatKey;
  /** 정의의 [min,max] 내 롤 정수. */
  readonly value: number;
}

/**
 * 보유 방어체 1기. `defense_units.unit` jsonb 계약이며, 필드 추가는 **append-only**.
 *
 * 배치에 실리는 것은 이 객체 전체가 아니라 {@link toInvasionRef} 가 뽑는 정수 5필드다 —
 * 어픽스는 `affixSeed` 에서 결정론 재구성되므로 배치 jsonb 에 스탯을 직렬화할 필요가 없다
 * (위조 표면 축소: 방어자가 고칠 수 있는 값이 애초에 존재하지 않는다).
 */
export interface DefenseUnitInstance {
  /** 인스턴스 표시 id(시드·좌표 파생, 안정·재현). DB 행 uuid 와 다르다. */
  readonly id: string;
  /** 카탈로그 종류 코드(CATALOG_*). */
  readonly kind: number;
  /** 종류별 카탈로그 배열 인덱스(append-only 계약). */
  readonly catalogId: number;
  readonly rarity: Rarity;
  /** 레벨 [1, 99]. */
  readonly level: number;
  /** 승급 [0, 5]. */
  readonly ascension: number;
  /** 어픽스 롤 시드(uint32). 리롤은 이 값만 바꾼다. */
  readonly affixSeed: number;
  /** 접두(상시) 롤. */
  readonly prefixes: readonly DefenseUnitAffixRoll[];
  /** 접미(조건부) 롤. */
  readonly suffixes: readonly DefenseUnitAffixRoll[];
  /**
   * rarity='unique' 일 때만 설정 — {@link DEFENSE_UNIQUES} 의 `id`(append-only wire 키).
   * 어픽스와 마찬가지로 `affixSeed` 에서 결정론 재구성되므로 **배치 jsonb 에 실리지 않는다**
   * (`toInvasionRef` 는 여전히 정수 5필드만 낸다 — 방어자가 고를 수 있는 값이 아니다).
   */
  readonly uniqueId?: string;
}

// ---------------------------------------------------------------------------
// 등급별 어픽스 수 · 보관 상한
// ---------------------------------------------------------------------------

/**
 * 등급별 방어체 어픽스 수 롤 범위 [min,max]. normal 은 0(기저만), unique 는 고정
 * ({@link DEFENSE_UNIT_UNIQUE_AFFIX_COUNT}). rollItem·rollCard 의 affixCountFor 준용. 📝 시작값.
 */
export const DEFENSE_UNIT_AFFIX_RANGE: Record<Rarity, readonly [number, number]> = {
  normal: [0, 0],
  magic: [1, 2],
  rare: [3, 4],
  unique: [5, 5],
};

/** 유니크 방어체의 고정 어픽스 수. */
export const DEFENSE_UNIT_UNIQUE_AFFIX_COUNT = 5;

/** 방어체 보관함 상한(만석 시 획득 차단 — 카드 CARD_STORAGE_CAP 선례). 📝 시작값. */
export const DEFENSE_UNIT_STORAGE_CAP = 60;

// ---------------------------------------------------------------------------
// 강화 3축 → 실효 스탯 배율 (sim 정본 산식 재현)
// ---------------------------------------------------------------------------

/**
 * 설비 배율 상수 — `src/sim/invasion/facility.ts` 의 module-private 상수 미러.
 * **이 값이 갈리면 메타 표기와 실제 전투가 갈린다.** `tests/defenseUnits.test.ts` 의
 * 설비 정합 테스트가 `resolveFacilityStats` 실제 출력과 전 구간 대조해 드리프트를 잡는다.
 */
export const FACILITY_RARITY_CP: readonly number[] = [100, 110, 125, 150];
/** 설비 레벨 1당 배율 가산(centi-percent). */
export const FACILITY_LEVEL_STEP_CP = 8;
/** 설비 승급 1단계당 배율 가산(centi-percent). */
export const FACILITY_ASCENSION_STEP_CP = 10;

/** 정수 배율 1단(centi-percent). sim facility.ts `scaleCp` 와 동일 산술. */
function scaleCp(base: number, cp: number): number {
  if (cp === 100) return base;
  return Math.round((base * cp) / 100);
}

/**
 * 강화 3축 → 실효 스탯(정수). **종류별로 sim 정본 산식을 그대로 재현**한다.
 *
 * - 편대: `formationPowerCp` 1단 반올림 (`Math.round(base*cp/100)`)
 * - 설비: 레벨 → 등급 → 승급 **3단 순차 반올림**(순서가 계약 — 바꾸면 값이 달라진다)
 * - 기물/보스: `propPowerBp`/`defenseBossPowerBp` + `scaleByBp`(최소 1 보장)
 *
 * 알 수 없는 종류 코드는 무보정(base)으로 돌려준다 — 메타 화면이 임의 배율을 지어내지 않게.
 */
export function defenseUnitScaleStat(
  kind: number,
  base: number,
  level: number,
  ascension: number,
  rarity: number,
): number {
  const lv = level < INVASION_LEVEL_MIN ? INVASION_LEVEL_MIN : Math.trunc(level);
  const asc = ascension < INVASION_ASCENSION_MIN ? INVASION_ASCENSION_MIN : Math.trunc(ascension);
  const rar = rarity < 0 ? 0 : Math.trunc(rarity);
  switch (kind) {
    case CATALOG_FORMATION:
      return Math.round((base * formationPowerCp(lv, asc, rar)) / 100);
    case CATALOG_FACILITY: {
      const levelCp = 100 + (lv - 1) * FACILITY_LEVEL_STEP_CP;
      const rarityCp = FACILITY_RARITY_CP[rar] ?? 100;
      const ascCp = 100 + asc * FACILITY_ASCENSION_STEP_CP;
      return scaleCp(scaleCp(scaleCp(base, levelCp), rarityCp), ascCp);
    }
    case CATALOG_PROP:
      return scaleByBp(base, propPowerBp(lv, asc, rar));
    case CATALOG_BOSS:
      return scaleByBp(base, defenseBossPowerBp(lv, asc, rar));
    default:
      return base;
  }
}

/**
 * 강화 3축의 **표시용 전투력 배율**(basis-point, 10000 = ×1.00).
 * 정의상 `defenseUnitScaleStat(kind, 10000, ...)` 이라 표기와 실제 스탯이 같은 함수에서 나온다
 * (별도 산식을 두면 그 순간부터 둘이 갈린다).
 */
export function defenseUnitPowerBp(
  kind: number,
  level: number,
  ascension: number,
  rarity: number,
): number {
  return defenseUnitScaleStat(kind, 10000, level, ascension, rarity);
}

// ---------------------------------------------------------------------------
// 축 ① 방어체 레벨 — 크레딧 + 희귀 광물
// ---------------------------------------------------------------------------

/** 레벨업 1회 기본 크레딧(레벨 1 → 2). 📝 시작값. */
export const LEVEL_CREDIT_BASE = 60;
/** 레벨 1단계당 추가 크레딧(선형 — 99레벨 누적이 곡선을 만든다). 📝 시작값. */
export const LEVEL_CREDIT_STEP = 24;
/** 등급 1단계당 레벨업 비용 가산(basis-point). unique(3) = +90%. 📝 시작값. */
export const LEVEL_RARITY_COST_BP = 3000;

/** 희귀 광물이 요구되기 시작하는 레벨(이 미만은 크레딧만). 📝 시작값. */
export const LEVEL_MINERAL_FROM = 20;
/** 희귀 광물 요구 구간 크기 — 이 레벨마다 광물 1 씩 늘어난다. 📝 시작값. */
export const LEVEL_MINERAL_PER_TIER = 10;

/** 강화 1회에 드는 재화(정수). */
export interface DefenseUnitCost {
  /** 크레딧. */
  readonly credits: number;
  /** 희귀 광물. */
  readonly minerals: number;
  /** 중복 설계도(승급 전용 — 그 외 0). */
  readonly blueprints: number;
}

/** 0 비용 상수(내부 조립용). */
const ZERO_COST: DefenseUnitCost = { credits: 0, minerals: 0, blueprints: 0 };

/**
 * `fromLevel → fromLevel+1` 1회 레벨업 비용. 상한(99) 도달 시 `null`.
 *
 * 크레딧 = round((BASE + STEP×(from-1)) × (10000 + RARITY_BP×등급랭크) / 10000) — 정수 1회 나눗셈.
 * 광물   = from ≥ 20 부터 10레벨마다 1씩(20~29 → 1, 30~39 → 2 …). 전부 정수 산술.
 */
export function defenseUnitLevelUpCost(rarity: Rarity, fromLevel: number): DefenseUnitCost | null {
  const from = Math.trunc(fromLevel);
  if (from < INVASION_LEVEL_MIN || from >= INVASION_LEVEL_MAX) return null;
  const flat = LEVEL_CREDIT_BASE + LEVEL_CREDIT_STEP * (from - INVASION_LEVEL_MIN);
  const bp = 10000 + LEVEL_RARITY_COST_BP * RARITY_CODE[rarity];
  const credits = Math.round((flat * bp) / 10000);
  const minerals =
    from < LEVEL_MINERAL_FROM
      ? 0
      : Math.trunc((from - LEVEL_MINERAL_FROM) / LEVEL_MINERAL_PER_TIER) + 1;
  return { credits, minerals, blueprints: 0 };
}

/**
 * `fromLevel → toLevel` 누적 레벨업 비용. 역방향·범위 밖은 0 비용을 돌려준다(호출부 분기 축소).
 * 단계별 비용을 정수로 더하므로 f64 누적이 없다.
 */
export function defenseUnitLevelUpTotalCost(
  rarity: Rarity,
  fromLevel: number,
  toLevel: number,
): DefenseUnitCost {
  let credits = 0;
  let minerals = 0;
  const from = Math.trunc(fromLevel);
  const to = Math.trunc(toLevel);
  for (let lv = from; lv < to; lv++) {
    const step = defenseUnitLevelUpCost(rarity, lv);
    if (step === null) break;
    credits += step.credits;
    minerals += step.minerals;
  }
  return { credits, minerals, blueprints: 0 };
}

// ---------------------------------------------------------------------------
// 축 ② 승급 — 중복 설계도 (외형 변화 신호)
// ---------------------------------------------------------------------------

/**
 * 승급 단계별 요구 설계도 수. 인덱스 = **목표 단계 - 1**(0→1 이 인덱스 0).
 * 배열 길이 = {@link INVASION_ASCENSION_MAX}. 📝 시작값.
 */
export const ASCEND_BLUEPRINT_COST: readonly number[] = [1, 2, 3, 5, 8];

/** 승급 1단계당 크레딧 비용(단계 비례). 📝 시작값. */
export const ASCEND_CREDIT_PER_STEP = 400;

/**
 * `fromAscension → fromAscension+1` 승급 비용. 상한(5) 도달 시 `null`.
 * 설계도는 **같은 방어체의 중복 설계도**이며 종류·catalogId 가 일치해야 한다(소비 검증은 서버).
 */
export function defenseUnitAscendCost(fromAscension: number): DefenseUnitCost | null {
  const from = Math.trunc(fromAscension);
  if (from < INVASION_ASCENSION_MIN || from >= INVASION_ASCENSION_MAX) return null;
  const blueprints = ASCEND_BLUEPRINT_COST[from];
  if (blueprints === undefined) return null;
  return { credits: ASCEND_CREDIT_PER_STEP * (from + 1), minerals: 0, blueprints };
}

/** 승급 가능 여부(상한 미만). */
export function canAscend(ascension: number): boolean {
  return Math.trunc(ascension) < INVASION_ASCENSION_MAX;
}

/**
 * 승급 **외형 티어**(0..3). 승급은 수치뿐 아니라 "외형이 변한다"는 신호가 핵심이라
 * 렌더·UI 가 이 티어로 프레임/이펙트를 고른다(0=기본, 3=만개).
 * 0 → 0, 1~2 → 1, 3~4 → 2, 5 → 3.
 */
export function ascensionVisualTier(ascension: number): number {
  const a = Math.trunc(ascension);
  if (a <= 0) return 0;
  if (a >= INVASION_ASCENSION_MAX) return 3;
  return a <= 2 ? 1 : 2;
}

/** 승급 외형 티어 개수(0..3). */
export const ASCENSION_VISUAL_TIERS = 4;

// ---------------------------------------------------------------------------
// 축 ③ 방어체 어픽스 리롤 — 희귀 광물
// ---------------------------------------------------------------------------

/** 리롤 기본 광물. 📝 시작값(장비 정제소 REROLL_BASE=6 대비 상향 — 방어체가 더 오래 쓰인다). */
export const UNIT_REROLL_BASE = 10;
/** 등급 1단계당 추가 광물. 📝 시작값. */
export const UNIT_REROLL_PER_RARITY = 8;
/** 어픽스 슬롯 1개당 추가 광물(등급 상한 기준 — 아래 주석 참조). 📝 시작값. */
export const UNIT_REROLL_PER_AFFIX = 3;

/**
 * 방어체 어픽스 리롤 비용(희귀 광물). BASE + PER_RARITY×등급랭크 + PER_AFFIX×**등급 어픽스 상한**.
 *
 * ## 왜 실제 롤 개수가 아니라 등급 상한인가
 * DB(`defense_units`)는 어픽스를 **저장하지 않는다** — `affix_seed` 정수 하나만 갖고 어픽스는
 * 클라·EF 가 롤러로 재구성한다(위조 표면 0). 따라서 SQL RPC 는 실제 롤 개수를 알 수 없다.
 * 비용을 등급만의 함수로 두면 **서버 차감액과 클라 표기액이 구조적으로 같아진다** — 개수 기반이면
 * SQL 이 롤러를 재구현해야 하고, 그 순간 결정론 미러링 부채가 생긴다(카드 EF 가 존재하는 이유).
 */
export function defenseUnitRerollCost(rarity: Rarity): DefenseUnitCost {
  const cap = DEFENSE_UNIT_AFFIX_RANGE[rarity][1];
  return {
    credits: 0,
    minerals:
      UNIT_REROLL_BASE + UNIT_REROLL_PER_RARITY * RARITY_CODE[rarity] + UNIT_REROLL_PER_AFFIX * cap,
    blueprints: 0,
  };
}

// ---------------------------------------------------------------------------
// 설계도 → 등급 승급 (Rarity 사다리 재활용)
// ---------------------------------------------------------------------------

/**
 * 등급 1단계 승급에 드는 **동일 방어체 중복 설계도** 수. 인덱스 = 현재 등급 랭크(RARITY_CODE).
 * unique 는 상위가 없어 사용되지 않는다(그래서 3칸). 📝 시작값.
 */
export const RARITY_UP_BLUEPRINT_COST: readonly number[] = [4, 8, 16];

/**
 * 등급 승급 비용. 최상위(unique)는 `null`(상위 없음 — {@link nextRarityUp} 사다리 그대로).
 * 등급이 오르면 어픽스 수 범위가 넓어지므로 리롤 없이도 롤이 다시 필요하다(서버가 새 시드 부여).
 */
export function defenseUnitRarityUpCost(rarity: Rarity): DefenseUnitCost | null {
  if (nextRarityUp(rarity) === undefined) return null;
  const blueprints = RARITY_UP_BLUEPRINT_COST[RARITY_CODE[rarity]];
  if (blueprints === undefined) return null;
  return { ...ZERO_COST, blueprints };
}

// ---------------------------------------------------------------------------
// 보조 — 등급 코드 ↔ Rarity, 비용 합산
// ---------------------------------------------------------------------------

/** 등급 랭크(RARITY_CODE 재사용) — 정렬·표기용 재노출. */
export function defenseUnitRarityRank(rarity: Rarity): number {
  return RARITY_CODE[rarity];
}

/**
 * 등급 코드(InvasionRef.rarity) → Rarity 문자열. 범위 밖은 'normal' 로 접는다
 * (정규화를 통과한 값은 항상 범위 안이지만, 카탈로그 축소 같은 상황에서 undefined 가 새지 않게).
 */
export function rarityFromCode(code: number): Rarity {
  return RARITY_BY_CODE[Math.trunc(code)] ?? 'normal';
}

/** 비용 합산(정수). UI 가 여러 단계를 한 번에 결제할 때 쓴다. */
export function addCost(a: DefenseUnitCost, b: DefenseUnitCost): DefenseUnitCost {
  return {
    credits: a.credits + b.credits,
    minerals: a.minerals + b.minerals,
    blueprints: a.blueprints + b.blueprints,
  };
}
