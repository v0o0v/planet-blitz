/**
 * 일일 보상 — 진행 견인 후보 생산기 · 가치 환산표 · 낙찰 (AC-10 ~ AC-17).
 *
 * ## 이 파일이 정본인 것
 *
 * **무엇을 제안할지 고르는 산식**이다. 얼마나 좋은 것까지 줄 수 있는지(공통 가치 예산)는
 * `data/dailyReward.ts` 가, 상한 천장의 최종 권위는 SQL 이 가진다. 여기는 예산을 **소비만**
 * 한다 — 예산을 다시 계산하거나 천장을 재해석하지 않는다.
 *
 * ## 진행 견인 — 결핍이 아니라 거리다
 *
 * ADR-0048 §왜 결핍 보완이 아니라 진행 견인인가가 기각한 것은 *"없는 것을 채워 준다"* 다.
 * 결핍을 기준으로 삼으면 **결핍을 유지할 인센티브**가 생긴다 — 좋은 주무기를 창고에 묻어
 * 두는 편이 이득인 설계는 그 자체로 기운 설계다. 그래서 여기서 재는 것은 보유량이 아니라
 * **목표까지의 거리**이며, 거리가 줄어드는 방향은 플레이어가 이미 원하는 방향이라 역인센티브가
 * 없다.
 *
 * 그 결과가 이 파일의 두 가지 비대칭이다:
 *  - **이미 살 수 있는 목표는 후보가 아니다.** 부족분이 0 이면 견인할 것이 없다(그 목표는
 *    보상이 아니라 플레이어의 결심을 기다린다). 그래서 거리는 항상 0 초과다.
 *  - **후보의 가치 = 그 목표의 부족분 전액**이다. 오늘 보상이 목표를 *정확히 열어 준다*.
 *    이 등식 덕분에 예산 필터(`value <= budget`)가 곧 *"오늘 예산으로 끝낼 수 있는 걸음만
 *    오늘의 걸음이다"* 가 된다 — 절반만 주고 내일 또 주는 흐지부지가 구조적으로 안 생긴다.
 *
 * ## 슬라이스 1 은 재화 축만 관통한다
 *
 * 축 식별자와 **가치 환산표는 6축 전부** 있다(AC-16 이 6축 상호 환산을 요구한다). 그러나
 * **후보 생산기는 `currency` 하나만 등록**돼 있다 — 나머지 5축은 슬라이스 2 소관이다.
 * 레지스트리({@link DAILY_REWARD_PRODUCERS})가 그 빈자리를 명시적으로 들고 있어서, 축을
 * 붙이는 일이 이 파일의 구조를 바꾸지 않는다. 6축 생산기를 지금 다 짜는 안은 기각됐다 —
 * 슬라이스 1 이 실화면까지 닿기 전에 다섯 축의 목표 정의를 추측으로 굳히게 된다.
 *
 * ## 규율
 *
 * 이 파일은 **순수**하다 — `Math.random`·`Date.now`·벽시계를 쓰지 않는다(`src/items/roll.ts`
 * 헤더 규율 승계). Edge Function 이 그대로 import 하므로 `src/sim/**` 도 끌어오지 않는다.
 * 유일한 예외가 `src/sim/rng.js` 의 {@link SeededRng} 이며, 이는 `data/coreModules.ts` 가
 * 이미 같은 이유로 쓰고 있는 선례다(tie-break 규약을 모듈 경제 로테이션과 공유한다).
 *
 * ## 상수는 전부 placeholder 다
 *
 * `// BALANCE` 가 붙은 값은 **출시 직전 일괄 튜닝** 대상이다(defer-balance-tuning). 지금
 * 의미가 있는 것은 비율·부호·단조성뿐이고, 절대값은 산식의 모양을 시험할 수 있는 잠정값이다.
 */

import { SeededRng } from '../src/sim/rng.js';
import type { Rarity } from '../src/items/types.js';
import { RARITY_CODE } from '../src/items/types.js';
import type { CommissionGrade } from '../src/run/commission.js';

import { catalystBuyPrice } from '../src/data/catalysts.js';
import { moduleBuyPrice } from './coreModules.js';
import { PLANET_BLUEPRINT_SPECIALTIES } from './planets/blueprints.js';
import {
  rollCost,
  respecCostCredits,
  stashExpansionCost,
  type Heat,
} from './economy.js';
import {
  ASCEND_BLUEPRINT_COST,
  defenseUnitAscendCost,
  defenseUnitLevelUpCost,
} from './defenseUnits.js';

// ---------------------------------------------------------------------------
// 축 식별자
// ---------------------------------------------------------------------------

/**
 * 지급 6축 (CONTEXT.md §공통 가치 예산). **새 재화를 만들지 않는다** — 전부 이미 다른 획득
 * 경로가 있는 것들이라, 일일 보상이 경제에 새 문을 내지 않는다는 것이 이 목록의 존재 이유다.
 * 항목을 늘리는 것은 곧 그 규율을 깨는 것이므로 확장 전에 ADR-0048 을 다시 열어야 한다.
 */
export type DailyRewardAxis =
  | 'currency'
  | 'catalyst'
  | 'blueprint'
  | 'coreModule'
  | 'gear'
  | 'commission';

/** 축 열거 — 테스트·UI 순회용. 표시 순서가 아니라 **선언 순서**이며 의미를 갖지 않는다. */
export const DAILY_REWARD_AXES: readonly DailyRewardAxis[] = [
  'currency',
  'catalyst',
  'blueprint',
  'coreModule',
  'gear',
  'commission',
];

// ---------------------------------------------------------------------------
// 가치 환산표 — 6축을 크레딧 하나로 접는다 (AC-16)
// ---------------------------------------------------------------------------

/**
 * 광물 1 의 크레딧 환산. // BALANCE — 출시 전 일괄 튜닝.
 *
 * 기준축을 크레딧으로 잡은 이유는 **6축 중 넷이 이미 크레딧 단위 가격 함수를 갖고 있기**
 * 때문이다(`catalystBuyPrice`·`moduleBuyPrice`·`stashExpansionCost`·`respecCostCredits`).
 * 별도의 추상 "가치 점수" 단위를 새로 만드는 안은 기각됐다 — 그러면 네 개의 실측 가격을
 * 전부 한 번 더 환산해야 하고, 그 환산 계수가 조용히 기존 경제와 갈린다.
 */
export const MINERAL_TO_CREDIT = 8;

/**
 * 미등록 촉매 id 의 가치 하한. // BALANCE.
 *
 * `catalystBuyPrice` 는 미지 id 에 **0** 을 돌려준다(서버 `buy_catalyst` 의 price-unset
 * 게이트와 같은 방향). 그 0 이 그대로 새면 가치 0 짜리 후보가 예산 필터를 무조건 통과해
 * 항상 낙찰되는 최악이 된다 — AC-16 이 "전 축 양수"를 요구하는 실질적 이유가 이것이다.
 */
export const CATALYST_VALUE_FLOOR = 10;

/**
 * 설계도 가치의 기준 가중치·기준가. // BALANCE.
 *
 * 설계도에는 등급이 없고 희소성이 `BlueprintSpecialty.weight` 로만 표현된다. 그래서 촉매의
 * `dropWeight` 환산과 **같은 모양**을 쓴다(`기준가 × 기준가중치 / 가중치`) — 두 무등급 축이
 * 서로 다른 산식을 쓰면 "어느 쪽이 비싼가"가 계수 두 벌의 곱으로 결정돼 튜닝이 불가능해진다.
 */
export const BLUEPRINT_VALUE_BASE = 600;
export const BLUEPRINT_REF_WEIGHT = 4;
/** 카탈로그에 없는 (kind, catalogId) 의 대체 가중치 — 기준값이라 가치가 기준가와 같아진다. */
export const BLUEPRINT_DEFAULT_WEIGHT = BLUEPRINT_REF_WEIGHT;

/** 장비 가치: 등급 기본 + 등급 단계당 가산. // BALANCE. */
export const GEAR_VALUE_BASE = 300;
export const GEAR_VALUE_PER_RARITY = 700;
/**
 * 요구 레벨 1 당 가치 가산율. // BALANCE.
 *
 * 등급만으로는 **같은 레어라도 1단계 드랍과 11단계 드랍의 값이 같아진다** —
 * `requiredLevel` 이 드랍처 상한으로 눌리는 축이라(`src/items/requiredLevel.ts`) 후반 장비의
 * 실질 가치를 담는 것은 등급이 아니라 이쪽이다. 곱연산으로 얹어 등급 서열을 뒤집지 않는다.
 */
export const GEAR_VALUE_PER_REQ_LEVEL = 0.02;

/** 의뢰서 가치: 계급 기본 + 계급 단계당 가산. // BALANCE. */
export const COMMISSION_VALUE_BASE = 800;
export const COMMISSION_VALUE_PER_GRADE = 1_200;

/**
 * 지급물 1건 — **무엇을 주는가**. 축별 판별 유니온이며, 각 변형의 필드는 그 축의 가치를
 * 정하는 데 **실제로 필요한 것만** 담는다.
 *
 * ⚠️ 장비 변형이 `Item` 이 아니라 `(rarity, requiredLevel)` 숫자쌍인 것이 의도다.
 * `requiredLevel(item)` 은 유니크 미저작 시 **throw** 하고 `UNIQUE_REGISTRY` 를 끌어온다 —
 * 순수 데이터 모듈이 아이템 레지스트리를 EF 번들로 끌고 들어가는 순간 이 파일의 규율이
 * 깨진다. 요구 레벨은 **호출 측이 계산해 넘긴다**.
 */
export type DailyRewardSubject =
  | { readonly axis: 'currency'; readonly credits: number; readonly minerals: number }
  | { readonly axis: 'catalyst'; readonly catalystId: number; readonly count: number }
  | {
      readonly axis: 'blueprint';
      readonly kind: number;
      readonly catalogId: number;
      readonly count: number;
    }
  | { readonly axis: 'coreModule'; readonly rarity: Rarity }
  | { readonly axis: 'gear'; readonly rarity: Rarity; readonly requiredLevel: number }
  | { readonly axis: 'commission'; readonly grade: CommissionGrade };

/** 유한 음이 아닌 값으로 접는다(손상 입력이 가치를 NaN·무한대로 만들지 않게). */
function safeNonNeg(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 재화 가치 — 크레딧은 그대로, 광물은 {@link MINERAL_TO_CREDIT} 배. 두 축 모두 단조 증가. */
export function currencyValue(credits: number, minerals: number): number {
  return safeNonNeg(credits) + safeNonNeg(minerals) * MINERAL_TO_CREDIT;
}

/**
 * 촉매 가치 — `catalystBuyPrice` 를 **그대로** 쓴다.
 *
 * 새 희소성 축을 저작하지 않는 것이 핵심이다. 촉매는 무등급이고 희소성이 `dropWeight` 로만
 * 표현되는데, 그 가중치에서 크레딧 가격을 뽑는 함수가 이미 상점 계약으로 존재한다
 * (`src/data/catalysts.ts` — SQL 미러까지 걸려 있다). 여기서 별도 계수를 세우면 **같은
 * 촉매가 상점에서와 일일 보상에서 다른 값**이 되어 플레이어가 곧바로 재정거래를 발견한다.
 */
export function catalystValue(catalystId: number, count: number): number {
  const unit = Math.max(CATALYST_VALUE_FLOOR, catalystBuyPrice(catalystId));
  return unit * Math.max(1, Math.floor(safeNonNeg(count)));
}

/** (kind, catalogId) → 특산 가중치. 전 행성 목록을 훑는다(항목이 수십 개라 색인이 과하다). */
export function blueprintWeight(kind: number, catalogId: number): number {
  for (const planet of PLANET_BLUEPRINT_SPECIALTIES) {
    for (const spec of planet) {
      if (spec.kind === kind && spec.catalogId === catalogId) return spec.weight;
    }
  }
  return BLUEPRINT_DEFAULT_WEIGHT;
}

/** 설계도 가치 — 가중치가 낮을수록(희귀할수록) 비싸다. 장수에 단조 증가. */
export function blueprintValue(kind: number, catalogId: number, count: number): number {
  const w = Math.max(1, blueprintWeight(kind, catalogId));
  const unit = Math.max(1, Math.floor((BLUEPRINT_VALUE_BASE * BLUEPRINT_REF_WEIGHT) / w));
  return unit * Math.max(1, Math.floor(safeNonNeg(count)));
}

/**
 * 코어 모듈 가치 — `moduleBuyPrice` 그대로(촉매와 같은 이유: 상점가와 갈리면 재정거래).
 * `RARITY_CODE` 가 단조라 등급이 오르면 값이 오른다.
 */
export function coreModuleValue(rarity: Rarity): number {
  return Math.max(1, moduleBuyPrice(rarity));
}

/** 장비 가치 — 등급(가산) × 요구 레벨(곱연산). 두 축 모두 단조 증가. */
export function gearValue(rarity: Rarity, reqLevel: number): number {
  const base = GEAR_VALUE_BASE + GEAR_VALUE_PER_RARITY * RARITY_CODE[rarity];
  const lv = Math.max(1, Math.floor(safeNonNeg(reqLevel)) || 1);
  return Math.max(1, Math.round(base * (1 + GEAR_VALUE_PER_REQ_LEVEL * (lv - 1))));
}

/** 의뢰서 가치 — 지시 계급 1..4 에 단조 증가. */
export function commissionValue(grade: CommissionGrade): number {
  const g = Math.min(4, Math.max(1, Math.floor(grade)));
  return COMMISSION_VALUE_BASE + COMMISSION_VALUE_PER_GRADE * (g - 1);
}

/**
 * 지급물 → 크레딧 환산 가치 (AC-16). **항상 유한·양수**다.
 *
 * 이 함수 하나가 *"크레딧 5000 과 레어 장비 1개를 견줄 수 있게 만든다"* 는 공통 가치 예산의
 * 존재 이유를 실행한다. 등급 확률표로 램프를 미는 안은 기각됐다 — 크레딧·광물·촉매·설계도는
 * 등급이 없어 표현되지 않고, 그러면 손잡이가 축마다 하나씩 여섯 개로 늘어난다.
 */
export function subjectValue(subject: DailyRewardSubject): number {
  switch (subject.axis) {
    case 'currency':
      return Math.max(1, currencyValue(subject.credits, subject.minerals));
    case 'catalyst':
      return catalystValue(subject.catalystId, subject.count);
    case 'blueprint':
      return blueprintValue(subject.kind, subject.catalogId, subject.count);
    case 'coreModule':
      return coreModuleValue(subject.rarity);
    case 'gear':
      return gearValue(subject.rarity, subject.requiredLevel);
    case 'commission':
      return commissionValue(subject.grade);
  }
}

// ---------------------------------------------------------------------------
// 목표 후보 (AC-10 · AC-14)
// ---------------------------------------------------------------------------

/**
 * 반복 걸음 순번 — *"3장 중 2장째"* (AC-14).
 *
 * 같은 목표가 여러 날 연속 낙찰되는 것을 **막지 않는다**. 막으면 "다음 한 걸음"을 끝내기
 * 전에 다른 축으로 옮겨 어느 목표도 완성되지 않고, 그것은 결핍 보완을 기각한 것과 같은 질의
 * 패착이다. 대신 이 순번을 화면이 표시해 **반복을 지루함이 아니라 카운트다운으로** 바꾼다 —
 * 표시가 없으면 같은 것이 세 번 오는 것이 산식 고장으로 읽혀, 개인화가 작동하는데도 안 하는
 * 것으로 보이는 최악이 된다.
 */
export interface DailyRewardStep {
  /** 1-based 현재 걸음. 항상 `1 <= index <= total`. */
  readonly index: number;
  /** 그 목표를 끝내는 데 필요한 총 걸음 수. */
  readonly total: number;
}

/** 후보의 부가 정보 — 무엇을 주고, 어느 목표를 겨누는가. */
export interface DailyRewardCandidateDetail {
  /**
   * 목표 식별자. **화면이 "같은 목표가 이어지는가"를 이 키로만 판정한다**(AC-14) — 축이나
   * 지급 내용으로 판정하면 창고 확장 2회차와 3회차가 같은 목표로 보인다. 안정 문자열이며
   * 같은 목표는 날이 바뀌어도 같은 값을 낸다.
   */
  readonly goalId: string;
  /** 실제 지급 내용. */
  readonly subject: DailyRewardSubject;
}

/** 목표 후보 1건 (AC-10). */
export interface DailyRewardCandidate {
  /**
   * 축. `detail.subject.axis` 와 **항상 같다** — 중복이지만, 축별 집계·필터가 지급물 유니온을
   * 풀지 않고 끝나도록 표면에 올려 둔다. 불변식은 {@link makeCandidate} 가 유지하고 테스트가
   * 잠근다.
   */
  readonly axis: DailyRewardAxis;
  /** 크레딧 환산 가치. 예산 필터가 이 값을 본다. */
  readonly value: number;
  /**
   * 목표까지의 거리 — **작을수록 가깝다.** [0,1] 로 정규화한다.
   *
   * 정규화가 필수인 이유는 축이 다르면 절대 부족량의 스케일이 다르기 때문이다(창고 확장
   * 16000 크레딧과 정련 12 광물은 절대값으로 견줄 수 없다). 비율로 접어야 *"거의 다 왔다"*
   * 라는 한 가지 뜻이 전 축에서 같은 숫자가 된다.
   */
  readonly distance: number;
  /** 반복 걸음 순번. 단발 후보에는 없다. */
  readonly step?: DailyRewardStep;
  readonly detail: DailyRewardCandidateDetail;
}

/** `step` 을 불변식(`1 <= index <= total`) 안으로 접는다. 손상 입력이 화면에 "5 중 7째"를 띄우지 않게. */
function normalizeStep(index: number, total: number): DailyRewardStep {
  const t = Math.max(1, Math.floor(safeNonNeg(total)) || 1);
  const i = Math.min(t, Math.max(1, Math.floor(safeNonNeg(index)) || 1));
  return { index: i, total: t };
}

/**
 * 후보를 만든다 — `axis` 중복과 `value` 파생을 한 자리에 가둔다.
 *
 * `step` 은 `exactOptionalPropertyTypes` 때문에 **스프레드 조건부**로 붙인다(`undefined` 를
 * 대입하면 타입 오류다).
 */
export function makeCandidate(
  goalId: string,
  subject: DailyRewardSubject,
  distance: number,
  step?: DailyRewardStep,
): DailyRewardCandidate {
  const d = Number.isFinite(distance) ? Math.min(1, Math.max(0, distance)) : 1;
  return {
    axis: subject.axis,
    value: subjectValue(subject),
    distance: d,
    ...(step !== undefined ? { step: normalizeStep(step.index, step.total) } : {}),
    detail: { goalId, subject },
  };
}

// ---------------------------------------------------------------------------
// 재화 축 후보 생산기 (슬라이스 1)
// ---------------------------------------------------------------------------

/** 강화 대상 방어체 1기의 진행 상태. */
export interface DefenseUnitProgress {
  /** 목표 식별자에 쓰는 안정 키(방어체 인스턴스 id). */
  readonly key: string;
  readonly rarity: Rarity;
  /** 현재 레벨. */
  readonly level: number;
  /** 현재 승급 단계(0..5). */
  readonly ascension: number;
  /**
   * 보유한 **같은 방어체 중복 설계도** 수. 승급 후보의 게이트다 — 설계도가 모자라면 그 목표를
   * 막고 있는 것은 크레딧이 아니라 설계도이므로 **재화 축의 목표가 아니다**(설계도 축이
   * 슬라이스 2 에서 같은 목표를 자기 축으로 세운다).
   */
  readonly dupBlueprints: number;
}

/** 정련 공정 진행 상태(정제소에 장비를 올려 둔 상태에서만 존재). */
export interface RefiningProgress {
  readonly rarity: Rarity;
  readonly affixCount: number;
  readonly heat: Heat;
}

/**
 * 재화 축이 거리를 재는 데 필요한 상태.
 *
 * ⚠️ **`Profile` 전체를 받지 않는다.** 순수성 때문만이 아니라 **EF 공유** 때문이다 —
 * `src/save/profile.ts` 를 끌어오면 세이브 계층 전체가 Edge Function 번들에 들어간다. 같은
 * 이유로 `stashMaxExpansions` 도 상수를 import 하지 않고 **입력으로 받는다**
 * (`MAX_STASH_EXPANSIONS` 가 사는 곳이 바로 그 세이브 모듈이다).
 */
export interface CurrencyProgress {
  readonly credits: number;
  readonly minerals: number;
  /** 이미 구매한 창고 확장 수. */
  readonly stashExpansions: number;
  /** 창고 확장 상한(호출 측이 `MAX_STASH_EXPANSIONS` 를 넘긴다 — 위 주석의 이유). */
  readonly stashMaxExpansions: number;
  /** 기체 레벨(리스펙 비용의 축). */
  readonly shipLevel: number;
  /**
   * 리스펙을 목표로 세울지. 스킬 포인트를 실제로 쓴 상태에서만 참이어야 한다 — 아무것도
   * 찍지 않은 조종사에게 "리스펙 비용까지 3000 크레딧" 을 들이미는 것은 견인이 아니라 소음이다.
   */
  readonly wantsRespec: boolean;
  /** 정련 중인 장비. 정제소에 올려 둔 것이 없으면 생략한다. */
  readonly refining?: RefiningProgress;
  /** 강화 대기 중인 방어체들. */
  readonly defenseUnits: readonly DefenseUnitProgress[];
  /** 오늘 방어 사령부 재고의 등급들(사려는 모듈). */
  readonly moduleOffers: readonly Rarity[];
}

/**
 * 전 축 생산기가 공유하는 입력. 슬라이스 2 는 여기에 **형제 필드를 더할 뿐** 생산기 시그니처를
 * 바꾸지 않는다 — 그것이 레지스트리 구조로 얻으려는 것이다.
 */
export interface DailyRewardProgressInput {
  readonly currency: CurrencyProgress;
}

/**
 * 재화 목표 1건의 내부 표현 — 비용 함수의 결과를 거리·부족분으로 접기 전 단계.
 * 크레딧·광물 두 축을 함께 들고 다니는 이유는 방어체 강화 비용이 실제로 둘을 함께 요구하기
 * 때문이다(`DefenseUnitCost`).
 */
interface CurrencyGoal {
  readonly goalId: string;
  readonly needCredits: number;
  readonly needMinerals: number;
  readonly step?: DailyRewardStep;
}

/**
 * 재화 목표 → 후보. 부족분이 없으면 `undefined`(= 후보 아님).
 *
 * 거리 = `부족분 가치 / 필요액 가치`. 분모를 필요액으로 두는 것이 축간 비교의 전부다 —
 * 창고 확장 16000 중 800 이 모자란 상태(0.05)와 정련 12 광물 중 1 이 모자란 상태(0.083)가
 * 같은 자로 재진다.
 */
function goalToCandidate(goal: CurrencyGoal, haveCredits: number, haveMinerals: number):
  | DailyRewardCandidate
  | undefined {
  const needValue = currencyValue(goal.needCredits, goal.needMinerals);
  if (needValue <= 0) return undefined;

  const shortCredits = Math.max(0, Math.ceil(goal.needCredits - haveCredits));
  const shortMinerals = Math.max(0, Math.ceil(goal.needMinerals - haveMinerals));
  const shortValue = currencyValue(shortCredits, shortMinerals);
  // 이미 살 수 있다 — 견인할 것이 없다. 보상이 아니라 플레이어의 결심을 기다리는 목표다.
  if (shortValue <= 0) return undefined;

  const subject: DailyRewardSubject = {
    axis: 'currency',
    credits: shortCredits,
    minerals: shortMinerals,
  };
  return makeCandidate(goal.goalId, subject, shortValue / needValue, goal.step);
}

/**
 * 재화 축 후보 생산기 (AC-10).
 *
 * ## 어떤 싱크를 목표로 삼았고, 무엇을 왜 뺐는가
 *
 * 넣은 것: 창고 확장 · 리스펙 · 정련 굴림 · 방어체 레벨업 · 방어체 승급(크레딧분) ·
 * 모듈 구매. 전부 **크레딧 또는 광물로 값이 매겨지는** 싱크다.
 *
 * 뺀 것과 이유:
 *  - **계보 투자**(`nextLevelCost`) — 비용 단위가 **계보 포인트**다. 포인트는 6축 지급 풀에
 *    없고 크레딧으로 살 수도 없으므로, 재화 보상이 그 거리를 **1 도 줄이지 못한다.** 후보로
 *    세우면 "가장 가까운 목표"로 낙찰돼 놓고 정작 지급물이 그 목표와 무관한, 견인의 정의를
 *    정면으로 어기는 후보가 된다. (계획서에 싱크로 적혀 있었지만 단위가 맞지 않는다.)
 *  - **방어체 등급 승급**(`defenseUnitRarityUpCost`) — 비용이 **중복 설계도뿐**이고 크레딧이
 *    0 이다. 위와 같은 이유로 재화 축의 목표가 아니며, 슬라이스 2 의 설계도 축 소관이다.
 *  - **방어체 승급의 설계도 요건** — 크레딧분은 재화 축이 맡지만, 설계도가 모자라면 후보를
 *    아예 만들지 않는다. 그 목표를 막고 있는 것이 재화가 아니기 때문이다.
 */
export function currencyCandidates(input: DailyRewardProgressInput): DailyRewardCandidate[] {
  const p = input.currency;
  const haveCredits = safeNonNeg(p.credits);
  const haveMinerals = safeNonNeg(p.minerals);
  const goals: CurrencyGoal[] = [];

  // ── 창고 확장 ── 상한이 있는 유한 싱크라 걸음 순번이 자연스럽게 나온다(n회차 / 상한).
  const stashDone = Math.floor(safeNonNeg(p.stashExpansions));
  const stashMax = Math.floor(safeNonNeg(p.stashMaxExpansions));
  if (stashDone < stashMax) {
    goals.push({
      goalId: `stash:${stashDone + 1}`,
      needCredits: stashExpansionCost(stashDone),
      needMinerals: 0,
      step: normalizeStep(stashDone + 1, stashMax),
    });
  }

  // ── 리스펙 ── 단발이다(반복 걸음이 없다). 레벨 0 이면 비용이 0 이라 후보에서 스스로 빠진다.
  if (p.wantsRespec) {
    goals.push({
      goalId: 'respec',
      needCredits: respecCostCredits(p.shipLevel),
      needMinerals: 0,
    });
  }

  // ── 정련 굴림 1회 ── 광물 싱크. 공정은 "언제든 멈출 수 있는" 세션이라 총 걸음 수가 없다 →
  // 단발로 둔다. 여기에 임의의 total 을 세우면 화면이 존재하지 않는 카운트다운을 표시한다.
  const refining = p.refining;
  if (refining !== undefined) {
    goals.push({
      goalId: 'refine:roll',
      needCredits: 0,
      needMinerals: rollCost(refining.rarity, refining.affixCount, refining.heat),
    });
  }

  // ── 방어체 ── 기당 최대 두 목표(레벨업 · 승급). 둘 다 만들어 두고 거리가 가려내게 한다 —
  // 여기서 미리 하나로 줄이면 그 선택 규칙이 거리 산식과 별개의 두 번째 손잡이가 된다.
  for (const unit of p.defenseUnits) {
    const levelUp = defenseUnitLevelUpCost(unit.rarity, unit.level);
    if (levelUp !== null) {
      goals.push({
        goalId: `defense:${unit.key}:level:${Math.trunc(unit.level)}`,
        needCredits: levelUp.credits,
        needMinerals: levelUp.minerals,
      });
    }
    const ascend = defenseUnitAscendCost(unit.ascension);
    // 설계도가 모자라면 막고 있는 것이 재화가 아니다 — 위 헤더의 기각 사유 ③.
    if (ascend !== null && safeNonNeg(unit.dupBlueprints) >= ascend.blueprints) {
      goals.push({
        goalId: `defense:${unit.key}:ascend:${Math.trunc(unit.ascension)}`,
        needCredits: ascend.credits,
        needMinerals: ascend.minerals,
        step: normalizeStep(Math.trunc(unit.ascension) + 1, ASCEND_BLUEPRINT_COST.length),
      });
    }
  }

  // ── 상점 모듈 ── 같은 등급이 재고에 둘 이상 있어도 목표는 하나다(어느 쪽을 사든 같은 걸음).
  const seenRarity = new Set<Rarity>();
  for (const rarity of p.moduleOffers) {
    if (seenRarity.has(rarity)) continue;
    seenRarity.add(rarity);
    goals.push({
      goalId: `module:${rarity}`,
      needCredits: moduleBuyPrice(rarity),
      needMinerals: 0,
    });
  }

  const out: DailyRewardCandidate[] = [];
  for (const goal of goals) {
    const c = goalToCandidate(goal, haveCredits, haveMinerals);
    if (c !== undefined) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 생산기 레지스트리 — 축을 추가할 자리
// ---------------------------------------------------------------------------

/** 축 하나의 후보 생산기. 순수 함수이며 같은 입력에 같은 배열을 낸다. */
export type DailyRewardCandidateProducer = (
  input: DailyRewardProgressInput,
) => DailyRewardCandidate[];

/**
 * 축 → 생산기. **슬라이스 1 은 `currency` 하나만 등록한다.**
 *
 * `Partial` 인 것이 계약이다 — 미등록 축이 타입 수준에서 정상 상태이므로, 슬라이스 2 가 축을
 * 붙일 때 이 파일에서 고칠 곳은 이 객체 리터럴 한 줄뿐이다. 6축을 전부 필수로 두고 빈 배열
 * 반환 스텁을 채워 넣는 안은 기각됐다 — 스텁은 "구현했는데 후보가 0개"와 "아직 안 만들었다"를
 * 구분할 수 없게 만들어, 폴백이 왜 났는지 영영 못 읽게 된다(AC-12 의 관측성이 죽는다).
 */
export const DAILY_REWARD_PRODUCERS: Readonly<
  Partial<Record<DailyRewardAxis, DailyRewardCandidateProducer>>
> = {
  currency: currencyCandidates,
};

/** 등록된 전 축의 후보를 모은다. 축 순서에 의존하지 않는다(낙찰이 내용 파생 키로 가른다). */
export function produceDailyRewardCandidates(
  input: DailyRewardProgressInput,
): DailyRewardCandidate[] {
  const out: DailyRewardCandidate[] = [];
  for (const axis of DAILY_REWARD_AXES) {
    const producer = DAILY_REWARD_PRODUCERS[axis];
    if (producer !== undefined) out.push(...producer(input));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 낙찰 (AC-11 · AC-12 · AC-13)
// ---------------------------------------------------------------------------

/** 후보가 하나도 없을 때 쓰는 폴백 목표 식별자 (AC-12). */
export const DAILY_FALLBACK_GOAL_ID = 'fallback:credits';

/**
 * 후보의 **내용에서** tie-break 키를 뽑는다.
 *
 * ⚠️ 이 함수가 AC-13 의 핵심이다. `Array.prototype.sort` 는 안정 정렬이지만 그 안정성은
 * **입력 순서를 보존한다**는 뜻이라, 키를 인덱스에서 뽑으면 후보 배열의 순서가 낙찰을
 * 바꾼다 — 생산기를 하나 더 등록하는 것만으로 어제 낙찰이 뒤집힌다. 키를 내용에서 뽑으면
 * 배열을 뒤집어도, 축을 추가해도 같은 후보 집합은 같은 낙찰을 낸다.
 *
 * 부동소수 `value`·`distance` 를 문자열에 넣는 것은 안전하다 — 같은 산식·같은 입력이면
 * 비트까지 같은 값이 나오고, 이 파일에 부동소수 비결정성의 원천이 없다.
 */
function candidateTieKey(c: DailyRewardCandidate): string {
  const s = c.detail.subject;
  const subjectKey =
    s.axis === 'currency'
      ? `c:${s.credits}:${s.minerals}`
      : s.axis === 'catalyst'
        ? `k:${s.catalystId}:${s.count}`
        : s.axis === 'blueprint'
          ? `b:${s.kind}:${s.catalogId}:${s.count}`
          : s.axis === 'coreModule'
            ? `m:${s.rarity}`
            : s.axis === 'gear'
              ? `g:${s.rarity}:${s.requiredLevel}`
              : `q:${s.grade}`;
  const step = c.step === undefined ? '-' : `${c.step.index}/${c.step.total}`;
  return `${c.axis}|${c.detail.goalId}|${subjectKey}|${c.value}|${c.distance}|${step}`;
}

/** 낙찰 결과. */
export interface DailyRewardPick {
  readonly candidate: DailyRewardCandidate;
  /**
   * 재화 폴백으로 낙찰됐는가 (AC-12). 관측 지표다 — 폴백률이 높다는 것은 생산기가 목표를
   * 못 세우고 있다는 뜻이고, 그 신호가 없으면 *"개인화가 도는데 아무도 눈치 못 채는"*
   * 상태를 영영 발견하지 못한다.
   */
  readonly fallback: boolean;
}

/** 예산 전액을 크레딧으로 — 후보가 없을 때의 폴백 (AC-12). */
function fallbackCandidate(budget: number): DailyRewardCandidate {
  const credits = Math.max(0, Math.floor(safeNonNeg(budget)));
  return {
    axis: 'currency',
    // `subjectValue` 를 거치지 않는 유일한 자리다. 폴백은 목표가 없으므로 "부족분 = 가치"
    // 등식이 성립하지 않고, 예산 전액이 곧 지급액이다.
    value: credits,
    // 목표가 없으니 거리도 없다. 최대값을 넣어 **어떤 실제 후보보다도 멀게** 둔다 — 정렬에
    // 섞여 들어가도 실제 후보를 이기지 않는다.
    distance: 1,
    detail: {
      goalId: DAILY_FALLBACK_GOAL_ID,
      subject: { axis: 'currency', credits, minerals: 0 },
    },
  };
}

/**
 * 낙찰 — **공통 가치 예산 안에서 거리 최소값** (AC-11).
 *
 * 세 축이 직교한다: 거리가 *어느 것*을 고르고, 예산이 *얼마나 좋은 것까지*를 정하고,
 * 시드가 *동점을 가른다*. 그래서 셋을 따로 조정할 수 있다(CONTEXT.md §공통 가치 예산).
 *
 * - 예산 초과 후보(`value > budget`)는 **아예 후보 목록에서 빠진다.** 거리가 아무리 가까워도
 *   오늘 끝낼 수 없는 걸음이기 때문이다.
 * - 남은 것이 0 개면 재화 폴백 (AC-12).
 * - 동점은 `(dateSeed, userSeed)` 로 결정론적으로 가른다 (AC-13). `Math.random` 은 물론이고
 *   입력 배열 순서도 쓰지 않는다 — {@link candidateTieKey} 주석 참조.
 *
 * @param candidates 축별 생산기가 낸 후보 전부.
 * @param budget     그날의 공통 가치 예산(`resolveDailyBudget(...).budget`).
 * @param dateSeed   오늘의 `date_seed`.
 * @param userSeed   `shopUserSeed(uid)`.
 */
export function pickDailyReward(
  candidates: readonly DailyRewardCandidate[],
  budget: number,
  dateSeed: number,
  userSeed: number,
): DailyRewardPick {
  const cap = safeNonNeg(budget);
  const eligible = candidates.filter(
    (c) => Number.isFinite(c.value) && c.value > 0 && c.value <= cap,
  );
  if (eligible.length === 0) return { candidate: fallbackCandidate(cap), fallback: true };

  // 모듈 경제 로테이션과 같은 tie-break 규약: 날짜 스트림에서 유저 스트림을 파생하고, 거기서
  // 다시 **후보 내용**으로 스트림을 판다. `fork` 는 `this.state` 를 건드리지 않으므로 같은
  // base 에서 몇 번을 갈라도 결과가 같다.
  const base = new SeededRng(dateSeed >>> 0).fork(userSeed >>> 0);
  const ranked = eligible.map((c) => {
    const key = candidateTieKey(c);
    return { c, key, tie: base.fork(key).nextU32() };
  });

  ranked.sort((a, b) => {
    if (a.c.distance !== b.c.distance) return a.c.distance - b.c.distance;
    if (a.tie !== b.tie) return a.tie - b.tie;
    // 해시까지 같으면 키 자체로 가른다 — 32비트 충돌이 낙찰을 배열 순서에 넘기지 않게.
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  const winner = ranked[0];
  // 위에서 길이를 확인했으므로 도달하지 않는다. `noUncheckedIndexedAccess` 를 위한 가드다.
  if (winner === undefined) return { candidate: fallbackCandidate(cap), fallback: true };
  return { candidate: winner.c, fallback: false };
}
