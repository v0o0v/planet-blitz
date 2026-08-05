/**
 * 방어체 어픽스 → sim 보정 (M7b · 방어체 어픽스 sim 반영 레인).
 *
 * ## 이 파일이 존재하는 이유
 * 강화 3축 중 **어픽스 리롤**만 전투 영향이 0 이었다. `InvasionRef` 는 `affixSeed` 를 싣고
 * 다니는데 sim(formation/facility/coreRoom)은 `level/ascension/rarity` 만 읽고 시드를 한 번도
 * 펼치지 않았다 — 플레이어가 광물을 태워 리롤해도 아무 일도 일어나지 않았다는 뜻이다.
 * 이 모듈이 그 회수 지점이다: `defenseUnitFromRef` 로 롤을 복원하고, **정수 basis-point 로
 * 접은 보정 묶음**({@link DefenseAffixMods})을 세 레이어에 넘긴다.
 *
 * ## 결정론(ADR-0005)
 * - 월드 RNG 미소비. `defenseUnitFromRef` 는 `affixSeed` 로 **로컬** `SeededRng` 를 만들어
 *   쓰므로 `state.rng`/`waveRng` 커서가 움직이지 않는다(rollCard·rollDefenseUnit 선례).
 * - 모든 보정은 정수 basis-point(10000 = ×1.00)이고 곱은 `Math.round(base * bp / 10000)`
 *   단일 나눗셈 관용구로만 접는다. f64 누적 없음.
 * - 매 틱 재롤 금지. {@link defenseAffixSet} 은 **ref 객체 신원 기준 WeakMap 메모이즈**다.
 *   `ctx.layers` 는 `garrisonLayers` 가 WeakMap 으로 고정한 파생 사본이라 런 내내 같은 객체가
 *   오고, 따라서 롤 복원은 방어체 1기당 정확히 1회다. (출력은 입력의 순수 함수이므로 캐시
 *   적중 여부가 결과를 바꾸지 않는다 — GC 타이밍이 sim 에 새지 않는다.)
 *
 * ## 어픽스 미보유 = 비트 동일
 * 어픽스가 0개면 {@link DefenseAffixSet.neutral} 이 true 이고, 호출부는 전부 그 자리에서
 * 기존 코드 경로로 되돌아간다(배율 1 을 곱하지도 않는다). normal 등급 방어체·기본 수비대로만
 * 이루어진 침공 런은 이 레인 이전과 **바이트 동일**하다 — PvE 는 애초에 이 코드에 닿지 않는다.
 *
 * ## 접두(상시) vs 접미(조건부) — 적용 시점 규율
 * - **스폰 시**에는 접두(`always`)만 싣는다. 그래야 "배치만 하면 항상 실린다"는 접두의 의미가
 *   스폰 시점 정수로 굳고, 스폰 경로가 트리거 상태에 의존하지 않는다.
 * - **접미**는 스텝이 매 틱 얹는다. 피해·연사·스폰 상한·과열은 매 틱 재계산형이라 그대로
 *   덮어쓰면 되고, 내구도(HP·보호막)만 **단조 상향 동기화**한다(목표가 현재 maxHp 보다 클
 *   때만 올리고 증가분을 hp 에도 더한다). 내구도에 붙는 접미(`dt-lastwall`·`dt-bulwark`)의
 *   계기는 둘 다 `coreHpLow` — 코어 HP 는 회복되지 않으므로 트리거가 **단조**이고, 따라서
 *   래치 없이도 정확히 한 번만 발동한다. 비단조 계기(`playerClose`)는 내구도 계열에 붙지
 *   않으므로 "가까이 갔다 멀어지면 무한 회복" 같은 경로가 존재하지 않는다.
 *
 * ## 8종 stat 전부에 훅이 있다
 * | stat | 훅 |
 * |---|---|
 * | defHpPct / defShieldFlat | 편대·설비·기물·보스 내구도(보호막은 내구도 위 절대 가산) |
 * | defDamagePct | 접촉·발당·장판 피해, 보스 캐스트 powerBp |
 * | defFireRatePct | 발사/생산 간격 축소(최소 1틱) |
 * | defWeatherResistPct | 정비도 풍화 저항 — 실효 정비도를 완전 정비 쪽으로 되돌린다 |
 * | defSpawnCapFlat | 드론 스포너 동시 생존 상한 |
 * | defOverheatResistPct | 보스 과열 창 지속(최소 1틱 — 약점이 사라지지는 않는다) |
 * | defEntryHastePct | 편대 웨이브 슬롯 등장 틱 앞당김 |
 *
 * ## 유니크 고유 효과 (M7c)
 * 유니크 등급 방어체는 어픽스 위에 **고유 효과**를 하나 더 싣는다
 * (`data/defenseUnits.ts` {@link DefenseUniqueDef}). 이 모듈이 그것도 함께 편다:
 *   - **상수항**은 접두와 같은 누적기에 접혀 {@link DefenseAffixSet.always} 에 들어간다 →
 *     스폰 경로(편대·설비·기물·보스 전부 `.always` 를 읽는다)가 자동으로 반영한다.
 *   - **동적항**은 {@link uniqueDynamicMods} 가 그 틱의 {@link DefenseTriggerState} 로 펴고
 *     {@link resolveDefenseMods} 가 합친다 → 세 레이어 스텝이 이미 매 틱 부르는 함수라
 *     별도 배선이 필요 없다(호출부 파일을 한 줄도 고치지 않는다).
 * 유니크가 아니면 `set.unique === null` 이고 위 두 경로가 통째로 건너뛰어져 M7b 와 바이트 동일하다.
 */

import { TICK_RATE } from '../constants.js';
import { DEFENSE_UNIT_AFFIX_BY_ID, uniqueParam } from '../../../data/defenseUnits.js';
import type {
  DefenseUnitAffixRoll,
  DefenseUnitStatKey,
  DefenseUnitTrigger,
  DefenseUniqueDef,
} from '../../../data/defenseUnits.js';
import { defenseUnitFromRef, defenseUnitUnique } from '../../items/rollDefenseUnit.js';
import type { InvasionRef } from './types.js';

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/** 배율 1.00 의 basis-point 표현. */
export const AFFIX_BP_ONE = 10000;

/**
 * 감쇠형 어픽스(풍화 저항·과열 저항·진입 가속)의 합산 상한(bp). 여러 개가 겹쳐 100% 가 되면
 * 풍화·과열·진입 지연이 **통째로 사라져** 그 축의 게임 규칙이 없어진다. 📝 시작값(90%).
 */
export const AFFIX_MAX_REDUCTION_BP = 9000;

/** {@link DefenseTriggerState.coreHpPct} 의 "코어 없음" 표식. 어떤 임계도 넘지 않는 값. */
export const AFFIX_NO_CORE_HP_PCT = 101;

// ---------------------------------------------------------------------------
// 보정 묶음
// ---------------------------------------------------------------------------

/**
 * 방어체 1기에 실린 어픽스를 **정수로 접은** 결과. 배율축은 basis-point(10000 = ×1.00),
 * 절대축은 그대로 정수다.
 */
export interface DefenseAffixMods {
  /** 내구도 배율(bp). */
  readonly hpBp: number;
  /** 피해 배율(bp). */
  readonly damageBp: number;
  /** 연사 배율(bp) — 발사 간격은 이 값으로 **나눈다**(연사 ↑ = 간격 ↓). */
  readonly fireRateBp: number;
  /** 보호막(절대) — 내구도 위에 얹힌다. */
  readonly shieldFlat: number;
  /** 정비도 풍화 저항(bp, 0..{@link AFFIX_MAX_REDUCTION_BP}). */
  readonly weatherResistBp: number;
  /** 스포너 동시 생존 상한 가산(절대). */
  readonly spawnCapFlat: number;
  /** 과열 창 지속 감소(bp, 0..{@link AFFIX_MAX_REDUCTION_BP}). */
  readonly overheatResistBp: number;
  /** 편대 진입 지연 감소(bp, 0..{@link AFFIX_MAX_REDUCTION_BP}). */
  readonly entryHasteBp: number;
}

/** 무보정(어픽스 0개). 이 값이 실리면 모든 적용 함수가 입력을 그대로 돌려준다. */
export const NEUTRAL_AFFIX_MODS: DefenseAffixMods = {
  hpBp: AFFIX_BP_ONE,
  damageBp: AFFIX_BP_ONE,
  fireRateBp: AFFIX_BP_ONE,
  shieldFlat: 0,
  weatherResistBp: 0,
  spawnCapFlat: 0,
  overheatResistBp: 0,
  entryHasteBp: 0,
};

/** 거동을 한 톨도 바꾸지 않는 보정인가(호출부의 조건부 접기 판정). */
export function isNeutralAffixMods(m: DefenseAffixMods): boolean {
  return (
    m.hpBp === AFFIX_BP_ONE &&
    m.damageBp === AFFIX_BP_ONE &&
    m.fireRateBp === AFFIX_BP_ONE &&
    m.shieldFlat === 0 &&
    m.weatherResistBp === 0 &&
    m.spawnCapFlat === 0 &&
    m.overheatResistBp === 0 &&
    m.entryHasteBp === 0
  );
}

// ---------------------------------------------------------------------------
// 어픽스 집합(접두 접힘 + 접미 원본)
// ---------------------------------------------------------------------------

/** 접미(조건부) 어픽스 1건 — 계기·임계와 함께 보관한다(발동 판정이 매 틱 필요). */
export interface DefenseConditionalAffix {
  readonly trigger: DefenseUnitTrigger;
  /** 계기별 의미 상이(data/defenseUnits.ts DefenseUnitTrigger 주석 참조). */
  readonly threshold: number;
  readonly stat: DefenseUnitStatKey;
  readonly value: number;
}

/** 방어체 1기의 어픽스 해석 결과(런 내내 불변 — 캐시 대상). */
export interface DefenseAffixSet {
  /**
   * 접두(상시) + **유니크 고유 효과의 상수항**을 접은 보정. 스폰 시점에 싣는 값.
   * 유니크의 대가(내구도 −%·피해 −%)가 여기 들어와야 스폰 HP 가 처음부터 옳다.
   */
  readonly always: DefenseAffixMods;
  /** 접미(조건부) 원본 목록. 정의 순서 고정 = 결정론 입력. */
  readonly conditional: readonly DefenseConditionalAffix[];
  /**
   * 유니크 고유 효과 정의(비유니크면 null). 동적항은 매 틱 {@link resolveDefenseMods} 가 편다.
   * **선택 필드**로 둔 것은 append-only 규율이다 — M7b 시점에 손으로 조립한 집합 리터럴
   * (테스트 하네스 등)이 이 필드 없이도 그대로 유효해야 하고, 미지정은 "유니크 없음"이다.
   */
  readonly unique?: DefenseUniqueDef | null;
  /** 접두·접미·유니크가 모두 비어 sim 거동이 완전히 불변인가. */
  readonly neutral: boolean;
}

/** 어픽스 0개 집합(빈 슬롯·normal 등급·미지의 ref 공용). */
export const NEUTRAL_AFFIX_SET: DefenseAffixSet = {
  always: NEUTRAL_AFFIX_MODS,
  conditional: [],
  unique: null,
  neutral: true,
};

/** stat 별 정수 누적기(퍼센트·절대 혼재 — {@link foldSums} 가 bp 로 접는다). */
interface AffixSums {
  hpPct: number;
  damagePct: number;
  fireRatePct: number;
  shieldFlat: number;
  weatherPct: number;
  spawnCap: number;
  overheatPct: number;
  entryPct: number;
}

function emptySums(): AffixSums {
  return {
    hpPct: 0,
    damagePct: 0,
    fireRatePct: 0,
    shieldFlat: 0,
    weatherPct: 0,
    spawnCap: 0,
    overheatPct: 0,
    entryPct: 0,
  };
}

/** 롤 1건을 누적기에 더한다. */
function addSum(sums: AffixSums, stat: DefenseUnitStatKey, value: number): void {
  switch (stat) {
    case 'defHpPct':
      sums.hpPct += value;
      break;
    case 'defDamagePct':
      sums.damagePct += value;
      break;
    case 'defFireRatePct':
      sums.fireRatePct += value;
      break;
    case 'defShieldFlat':
      sums.shieldFlat += value;
      break;
    case 'defWeatherResistPct':
      sums.weatherPct += value;
      break;
    case 'defSpawnCapFlat':
      sums.spawnCap += value;
      break;
    case 'defOverheatResistPct':
      sums.overheatPct += value;
      break;
    case 'defEntryHastePct':
      sums.entryPct += value;
      break;
  }
}

/** 감쇠형 퍼센트 → bp(0..{@link AFFIX_MAX_REDUCTION_BP}). */
function reductionBp(pct: number): number {
  if (pct <= 0) return 0;
  const bp = pct * 100;
  return bp > AFFIX_MAX_REDUCTION_BP ? AFFIX_MAX_REDUCTION_BP : bp;
}

/** 누적기 → 보정 묶음. 증폭형은 하한 1bp(0 배율·음수 배율 금지). */
function foldSums(sums: AffixSums): DefenseAffixMods {
  const hpBp = AFFIX_BP_ONE + sums.hpPct * 100;
  const damageBp = AFFIX_BP_ONE + sums.damagePct * 100;
  const fireRateBp = AFFIX_BP_ONE + sums.fireRatePct * 100;
  return {
    hpBp: hpBp < 1 ? 1 : hpBp,
    damageBp: damageBp < 1 ? 1 : damageBp,
    fireRateBp: fireRateBp < 1 ? 1 : fireRateBp,
    shieldFlat: sums.shieldFlat < 0 ? 0 : sums.shieldFlat,
    weatherResistBp: reductionBp(sums.weatherPct),
    spawnCapFlat: sums.spawnCap < 0 ? 0 : sums.spawnCap,
    overheatResistBp: reductionBp(sums.overheatPct),
    entryHasteBp: reductionBp(sums.entryPct),
  };
}

// ---------------------------------------------------------------------------
// 해석 + 캐시
// ---------------------------------------------------------------------------

/** ref 객체 신원 → 해석 결과. 매 틱 재롤을 막는 유일한 장치(순수 메모이즈). */
const SET_CACHE = new WeakMap<InvasionRef, { kind: number; set: DefenseAffixSet }>();

/** 접미 롤 1건을 계기·임계와 함께 세운다. 정의를 못 찾으면 버린다(정의가 줄어도 크래시 없음). */
function toConditional(roll: DefenseUnitAffixRoll): DefenseConditionalAffix | null {
  const def = DEFENSE_UNIT_AFFIX_BY_ID.get(roll.id);
  if (def === undefined || def.trigger === undefined) return null;
  return { trigger: def.trigger, threshold: def.threshold ?? 0, stat: roll.stat, value: roll.value };
}

/**
 * 배치 참조 → 어픽스 해석 결과. `affixSeed` 로 롤을 복원하고 접두를 접는다.
 *
 * `kind` 는 {@link data/invasion/catalog.ts} 의 CATALOG_* 코드다 — 롤 풀이 종류로 갈리므로
 * 편대 슬롯의 ref 를 설비 종류로 펼치면 다른 어픽스가 나온다(호출부가 자기 레이어 코드를 준다).
 */
export function defenseAffixSet(
  kind: number,
  ref: InvasionRef | null | undefined,
): DefenseAffixSet {
  if (ref === null || ref === undefined) return NEUTRAL_AFFIX_SET;
  const hit = SET_CACHE.get(ref);
  if (hit !== undefined && hit.kind === kind) return hit.set;

  const unit = defenseUnitFromRef(kind, ref);
  const sums = emptySums();
  for (const roll of unit.prefixes) addSum(sums, roll.stat, roll.value);
  const conditional: DefenseConditionalAffix[] = [];
  for (const roll of unit.suffixes) {
    const c = toConditional(roll);
    if (c !== null) conditional.push(c);
  }
  // 유니크 고유 효과의 **상수항**은 접두와 같은 누적기에 접는다(접두·유니크가 같은 퍼센트
  // 공간에서 합산돼 표기와 실제가 갈리지 않는다). 동적항은 여기 들어오지 않는다.
  const unique = defenseUnitUnique(unit);
  if (unique !== null) addUniqueConstants(sums, unique);
  const always = foldSums(sums);
  const set: DefenseAffixSet = {
    always,
    conditional,
    unique,
    neutral: unique === null && conditional.length === 0 && isNeutralAffixMods(always),
  };
  SET_CACHE.set(ref, { kind, set });
  return set;
}

// ---------------------------------------------------------------------------
// 유니크 고유 효과 — 상수항 / 동적항
// ---------------------------------------------------------------------------

/**
 * 유니크의 **상수항**(런 상태에 의존하지 않는 부분)을 접두 누적기에 더한다.
 * 대가(내구도·피해 감소)가 여기 들어와야 스폰 시점 값이 처음부터 옳다.
 */
function addUniqueConstants(sums: AffixSums, u: DefenseUniqueDef): void {
  switch (u.effect) {
    case 'overclockCore':
      sums.hpPct -= uniqueParam(u, 'hpPenaltyPct', 0);
      break;
    case 'swarmNexus':
      sums.spawnCap += uniqueParam(u, 'spawnCapFlat', 0);
      sums.fireRatePct -= uniqueParam(u, 'fireRatePenaltyPct', 0);
      break;
    case 'aegisLattice':
      sums.shieldFlat += uniqueParam(u, 'shieldFlat', 0);
      sums.weatherPct += uniqueParam(u, 'weatherResistPct', 0);
      sums.damagePct -= uniqueParam(u, 'damagePenaltyPct', 0);
      break;
    case 'thermalVault':
      sums.overheatPct += uniqueParam(u, 'overheatResistPct', 0);
      sums.hpPct += uniqueParam(u, 'hpBonusPct', 0);
      break;
    case 'vanguardTide':
      sums.entryPct += uniqueParam(u, 'entryHastePct', 0);
      sums.damagePct += uniqueParam(u, 'damageBonusPct', 0);
      sums.hpPct -= uniqueParam(u, 'hpPenaltyPct', 0);
      break;
    // 아래 넷은 상수항이 없다(전부 런 상태의 함수).
    case 'vengeanceEngine':
    case 'deathgripBastion':
    case 'proximityReactor':
      break;
  }
}

/** 증폭형 basis-point 를 합산 상한으로 자른다(음수 배율 금지). */
function clampAddBp(add: number, cap: number): number {
  if (add <= 0) return 0;
  return add > cap ? cap : add;
}

/**
 * 유니크의 **동적항**을 이번 틱의 관측값으로 편다. ONE 기준 보정 묶음을 돌려주며,
 * 발동 조건에 닿지 않으면 {@link NEUTRAL_AFFIX_MODS} 를 그대로 돌려준다(무보정 경로 값싸게).
 *
 * 전부 정수 basis-point + `Math.floor(a * b / d)` 단일 나눗셈이다. 거리 항만은 좌표가 f64 라
 * **밴드 계단**으로 양자화해서 미세 좌표 차가 bp 를 흔들지 않게 한다(sim 전반의 좌표 f64 관행
 * 안에서 가장 둔감한 형태 — `isConditionalActive`(playerClose)의 제곱거리 비교와 같은 계열).
 */
export function uniqueDynamicMods(
  u: DefenseUniqueDef,
  st: DefenseTriggerState,
  selfX: number,
  selfY: number,
): DefenseAffixMods {
  switch (u.effect) {
    case 'overclockCore': {
      const perSec = uniqueParam(u, 'rateBpPerSec', 0);
      const cap = uniqueParam(u, 'rateCapBp', 0);
      const elapsed = st.elapsedTicks > 0 ? st.elapsedTicks : 0;
      const add = clampAddBp(Math.floor((elapsed * perSec) / TICK_RATE), cap);
      return add === 0 ? NEUTRAL_AFFIX_MODS : { ...NEUTRAL_AFFIX_MODS, fireRateBp: AFFIX_BP_ONE + add };
    }
    case 'vengeanceEngine': {
      const per = uniqueParam(u, 'damageBpPerAlly', 0);
      const cap = uniqueParam(u, 'damageCapBp', 0);
      const allies = st.alliesDestroyed > 0 ? st.alliesDestroyed : 0;
      const add = clampAddBp(allies * per, cap);
      return add === 0 ? NEUTRAL_AFFIX_MODS : { ...NEUTRAL_AFFIX_MODS, damageBp: AFFIX_BP_ONE + add };
    }
    case 'deathgripBastion': {
      const pivot = uniqueParam(u, 'pivotPct', 0);
      const atZero = uniqueParam(u, 'hpBpAtZero', 0);
      // 코어 없음(AFFIX_NO_CORE_HP_PCT=101)은 pivot 위라 자동으로 0 이 된다.
      if (pivot <= 0 || st.coreHpPct >= pivot) return NEUTRAL_AFFIX_MODS;
      const lack = pivot - (st.coreHpPct > 0 ? st.coreHpPct : 0);
      const add = clampAddBp(Math.floor((atZero * lack) / pivot), atZero);
      return add === 0 ? NEUTRAL_AFFIX_MODS : { ...NEUTRAL_AFFIX_MODS, hpBp: AFFIX_BP_ONE + add };
    }
    case 'proximityReactor': {
      const radius = uniqueParam(u, 'radius', 0);
      const near = uniqueParam(u, 'damageBpNear', 0);
      const bands = uniqueParam(u, 'bands', 1);
      if (radius <= 0 || bands <= 0) return NEUTRAL_AFFIX_MODS;
      const dx = st.playerX - selfX;
      const dy = st.playerY - selfY;
      const d2 = dx * dx + dy * dy;
      const r2 = radius * radius;
      if (!(d2 < r2)) return NEUTRAL_AFFIX_MODS;
      // 밴드 인덱스 0(최근접) .. bands-1. 정수 계단이라 좌표 미세 차이가 bp 를 흔들지 않는다.
      let band = Math.floor((bands * d2) / r2);
      if (band < 0) band = 0;
      if (band > bands - 1) band = bands - 1;
      const add = clampAddBp(Math.floor((near * (bands - band)) / bands), near);
      return add === 0 ? NEUTRAL_AFFIX_MODS : { ...NEUTRAL_AFFIX_MODS, damageBp: AFFIX_BP_ONE + add };
    }
    // 상수항만 있는 유니크는 동적항이 없다.
    case 'swarmNexus':
    case 'aegisLattice':
    case 'thermalVault':
    case 'vanguardTide':
      return NEUTRAL_AFFIX_MODS;
  }
}

// ---------------------------------------------------------------------------
// 접미 발동 판정
// ---------------------------------------------------------------------------

/**
 * 접미 계기 판정 입력. **레이어 스텝이 1틱에 한 번** 만들어 그 레이어의 모든 방어체가 공유한다
 * (방어체마다 다른 것은 자기 좌표뿐이라 {@link resolveDefenseMods} 인자로 따로 받는다).
 * 전부 그 틱의 순수 관측값이라 RNG·벽시계가 끼지 않는다.
 */
export interface DefenseTriggerState {
  /** 현재 레이어 진입 후 경과 틱(`state.tick - runtime.phaseEnterTick`). */
  readonly elapsedTicks: number;
  /** 코어 HP 백분율(0..100). 코어가 없는 레이어는 {@link AFFIX_NO_CORE_HP_PCT}. */
  readonly coreHpPct: number;
  /** 같은 레이어에서 파괴된 아군 방어체 수(배치 수 − 생존 수). */
  readonly alliesDestroyed: number;
  /** 공격자 좌표. */
  readonly playerX: number;
  readonly playerY: number;
}

/** 코어 HP 백분율(정수 내림). 코어가 없거나 maxHp 가 0 이면 "코어 없음". */
export function coreHpPctOf(hp: number, maxHp: number): number {
  if (maxHp <= 0) return AFFIX_NO_CORE_HP_PCT;
  const pct = Math.floor((hp * 100) / maxHp);
  return pct < 0 ? 0 : pct;
}

/** 접미 1건이 이번 틱에 발동하는가. */
export function isConditionalActive(
  c: DefenseConditionalAffix,
  st: DefenseTriggerState,
  selfX: number,
  selfY: number,
): boolean {
  switch (c.trigger) {
    case 'layerEnter':
      // 방어체는 자기 레이어에 공격자가 들어온 뒤에야 스텝을 받는다 → 스폰 시점부터 상시 발동.
      return true;
    case 'coreHpLow':
      return st.coreHpPct <= c.threshold;
    case 'allyDestroyed':
      return st.alliesDestroyed >= c.threshold;
    case 'timeElapsed':
      // 임계는 **초**다(data/defenseUnits.ts 계약) — 틱으로 환산해 비교한다.
      return st.elapsedTicks >= c.threshold * TICK_RATE;
    case 'playerClose': {
      const dx = st.playerX - selfX;
      const dy = st.playerY - selfY;
      return dx * dx + dy * dy <= c.threshold * c.threshold;
    }
  }
}

/**
 * 접두 + **이번 틱에 발동 중인** 접미를 합쳐 최종 보정을 낸다. 접미가 없거나 하나도 발동하지
 * 않으면 `set.always` 를 **그대로**(새 객체 없이) 돌려준다 — 무보정 경로가 항상 같은 상수 객체로
 * 떨어져 호출부의 조건부 접기가 값싸다.
 */
export function resolveDefenseMods(
  set: DefenseAffixSet,
  st: DefenseTriggerState,
  selfX: number,
  selfY: number,
): DefenseAffixMods {
  // 유니크 동적항(M7c). 비유니크·미발동이면 null 이라 아래 경로가 M7b 와 바이트 동일하다.
  let dyn: DefenseAffixMods | null = null;
  const unique = set.unique ?? null;
  if (unique !== null) {
    const d = uniqueDynamicMods(unique, st, selfX, selfY);
    if (!isNeutralAffixMods(d)) dyn = d;
  }
  if (set.conditional.length === 0) {
    return dyn === null ? set.always : combineMods(set.always, dyn);
  }
  const sums = emptySums();
  let any = false;
  for (const c of set.conditional) {
    if (!isConditionalActive(c, st, selfX, selfY)) continue;
    addSum(sums, c.stat, c.value);
    any = true;
  }
  if (!any) return dyn === null ? set.always : combineMods(set.always, dyn);
  // 접두를 퍼센트로 되풀어 합산하지 않고, 접힌 bp 끼리 **정수 가산**한다(bp 는 선형이라
  // (1+a)+(1+b)-1 = 1+a+b 로 접두·접미 합산이 데이터 정의(퍼센트 합)와 일치한다).
  const merged = combineMods(set.always, foldSums(sums));
  return dyn === null ? merged : combineMods(merged, dyn);
}

/**
 * 보정 묶음 2개를 **정수 가산**으로 합친다. 배율축은 bp 선형 가산((1+a)+(1+b)-1),
 * 절대축은 단순 합, 감쇠축은 합산 후 상한. 나눗셈이 없어 f64 가 끼지 않는다.
 */
function combineMods(a: DefenseAffixMods, b: DefenseAffixMods): DefenseAffixMods {
  return {
    hpBp: a.hpBp + b.hpBp - AFFIX_BP_ONE,
    damageBp: a.damageBp + b.damageBp - AFFIX_BP_ONE,
    fireRateBp: a.fireRateBp + b.fireRateBp - AFFIX_BP_ONE,
    shieldFlat: a.shieldFlat + b.shieldFlat,
    weatherResistBp: capReduction(a.weatherResistBp + b.weatherResistBp),
    spawnCapFlat: a.spawnCapFlat + b.spawnCapFlat,
    overheatResistBp: capReduction(a.overheatResistBp + b.overheatResistBp),
    entryHasteBp: capReduction(a.entryHasteBp + b.entryHasteBp),
  };
}

/** 감쇠형 합산 상한. */
function capReduction(bp: number): number {
  if (bp <= 0) return 0;
  return bp > AFFIX_MAX_REDUCTION_BP ? AFFIX_MAX_REDUCTION_BP : bp;
}

// ---------------------------------------------------------------------------
// 적용 함수 — 전부 `Math.round(base * bp / 10000)` 단일 나눗셈
// ---------------------------------------------------------------------------

/** 내구도(+보호막 절대 가산). 최소 1. 무보정이면 입력 그대로(비트 동일). */
export function affixHp(base: number, m: DefenseAffixMods): number {
  if (m.hpBp === AFFIX_BP_ONE && m.shieldFlat === 0) return base;
  const v = Math.round((base * m.hpBp) / AFFIX_BP_ONE) + m.shieldFlat;
  return v < 1 ? 1 : v;
}

/** 피해. 최소 0(피해 0 인 방어체 — 실드 발생기 — 은 그대로 0 이어야 한다). */
export function affixDamage(base: number, m: DefenseAffixMods): number {
  if (m.damageBp === AFFIX_BP_ONE) return base;
  const v = Math.round((base * m.damageBp) / AFFIX_BP_ONE);
  return v < 0 ? 0 : v;
}

/** 강화 3축 basis-point 에 어픽스 피해 배율을 접는다(보스 캐스트 — 정수 bp 를 유지). */
export function affixPowerBp(powerBp: number, m: DefenseAffixMods): number {
  if (m.damageBp === AFFIX_BP_ONE) return powerBp;
  return Math.round((powerBp * m.damageBp) / AFFIX_BP_ONE);
}

/** 발사·생산 간격(연사 배율로 나눈다). 최소 1틱(0 은 무한 발사). */
export function affixCooldown(cd: number, m: DefenseAffixMods): number {
  if (m.fireRateBp === AFFIX_BP_ONE) return cd;
  const v = Math.round((cd * AFFIX_BP_ONE) / m.fireRateBp);
  return v < 1 ? 1 : v;
}

/**
 * 정비도 풍화 저항. 실효 정비도를 완전 정비(10000) 쪽으로 저항률만큼 되돌린다:
 * `m + round((10000 - m) × resist / 10000)`. 저항 100% 면 풍화가 사라지지만 상한이
 * {@link AFFIX_MAX_REDUCTION_BP} 라 완전 무효화는 불가능하다.
 */
export function affixMaintenance(maintenance: number, m: DefenseAffixMods): number {
  if (m.weatherResistBp === 0) return maintenance;
  const gap = AFFIX_BP_ONE - maintenance;
  if (gap <= 0) return maintenance;
  return maintenance + Math.round((gap * m.weatherResistBp) / AFFIX_BP_ONE);
}

/** 스포너 동시 생존 상한. */
export function affixSpawnCap(base: number, m: DefenseAffixMods): number {
  return m.spawnCapFlat === 0 ? base : base + m.spawnCapFlat;
}

/** 보스 과열 창 지속(틱). 최소 1 — 약점 노출이 통째로 사라지지는 않는다. */
export function affixOverheatTicks(base: number, m: DefenseAffixMods): number {
  if (m.overheatResistBp === 0) return base;
  const v = Math.round((base * (AFFIX_BP_ONE - m.overheatResistBp)) / AFFIX_BP_ONE);
  return v < 1 ? 1 : v;
}

/** 편대 등장 틱(진입 가속). 최소 0. */
export function affixEntryTick(base: number, m: DefenseAffixMods): number {
  if (m.entryHasteBp === 0 || base <= 0) return base;
  const v = Math.round((base * (AFFIX_BP_ONE - m.entryHasteBp)) / AFFIX_BP_ONE);
  return v < 0 ? 0 : v;
}

/**
 * 내구도 **단조 상향 동기화**. 목표가 현재 maxHp 보다 클 때만 올리고 증가분을 hp 에도 더한다.
 * 접미 내구도 계기가 단조(coreHpLow)라 정확히 1회만 발동하며, 되돌아가지 않으므로 반복 회복이
 * 불가능하다. 반환값 = 실제로 올린 양(0 이면 아무것도 하지 않았다).
 */
export function raiseMaxHp(entity: { hp: number; maxHp: number }, target: number): number {
  if (target <= entity.maxHp) return 0;
  const delta = target - entity.maxHp;
  entity.maxHp = target;
  entity.hp += delta;
  return delta;
}
