/**
 * 방어 카드 카탈로그 — 정적 카운터(접두)·동적 트리거(접미)·기저 효과·유니크 정의·롤 범위·
 * 합성 확률·상점 로테이션·획득/분해 순수 함수 (grill-defense-card 스펙 §카드 해부, team-plan OQ).
 *
 * 이 모듈은 **순수 데이터 + 순수 결정론 함수**이다. data/lineage.ts·data/economy.ts 와 같은 결로,
 * Math.random·Date.now·pixi 를 쓰지 않는다(ADR-0005). 유일한 무작위원은 시드 기반 SeededRng
 * 이며(플랫폼 전역 무참조 — Deno EF 에서도 동일 재현), 상점 로테이션·획득 확률·합성 판정이 서버·
 * 클라이언트에서 바이트 동일하게 재현된다.
 *
 * 용어(CONTEXT.md): 카드 어픽스는 장비 어픽스·엘리트 어픽스와 3중 구분되는 별개 개념이다.
 *   - **정적 카운터**(접두사) = 스냅샷 시점에 공격자 기체/장비 스펙(원소·무기 유형·전투력·침공
 *     이력)을 보고 매치업 보너스를 발동. 조건 일치 시에만 효과가 실린다.
 *   - **동적 트리거**(접미사) = 런 중 공격자 행동(코어 직공·포탑 파괴·장기 대치·수호 격추 등)에
 *     반응해 발동. `threshold` 로 발동 임계(파괴 수·경과 초·코어 HP%)를 지정한다.
 *
 * 효과 stat 은 Lane B(sim) 가 소비하는 어휘다(각 stat 이 방어전 어떤 필드를 어떻게 보정하는지는
 * lane-a-cards-data.md 계약 표 참조). 이 모듈은 stat·값·조건만 데이터로 확정하고, sim 반영은
 * Lane B 몫이다.
 *
 * 📝 모든 수치(롤 범위·기저 효과·합성 확률·상점 재고·보관 상한·유니크 파라미터)는 밸런스 조정
 * 대상이다(스펙 §Constraints).
 */

import { SeededRng } from '../src/sim/rng.js';
import type { Rarity } from '../src/items/types.js';
import { RARITY_CODE } from '../src/items/types.js';

// ---------------------------------------------------------------------------
// 효과 stat 어휘 — Lane B(sim) 가 소비한다.
// ---------------------------------------------------------------------------

/**
 * 카드 효과가 방어전에 거는 보정의 종류. 백분율 stat 은 정수 퍼센트(10 = +10%)로 저장하고,
 * flat stat(coreShieldFlat·volleyDamage)은 절대량으로 저장한다. 각 stat 의 sim 해석은
 * lane-a-cards-data.md 계약 표에 정의된다(재번호·의미 변경 금지 — 스냅샷/직렬화 계약).
 */
export type CardStatKey =
  // 방어 시설 버프
  | 'turretDamagePct' // 포탑 화력 +%
  | 'turretFireRatePct' // 포탑 연사 +%(발사 간격 단축)
  | 'coreShieldFlat' // 코어 실드량(절대) — 트리거 발동 시 부여
  | 'incomingDmgReductionPct' // 방어 시설이 받는 피해 -%
  // 공격자 디버프
  | 'attackerSubCdPct' // 공격자 보조무기 쿨다운 +%(증가 = 불리)
  | 'attackerSlowPct' // 공격자 이동속도 -%
  | 'reflectDamagePct' // 코어 피격 피해의 일부를 공격자에게 반사 +%
  | 'volleyDamage'; // 일제사격 1회 피해량(절대)

// ---------------------------------------------------------------------------
// 정적 카운터(접두) 조건 · 동적 트리거(접미) 이벤트
// ---------------------------------------------------------------------------

/**
 * 정적 카운터 조건 — 스냅샷 시점 공격자 스펙과의 매치업. Lane B 가 스폰 시 공격자 스냅샷을 보고
 * 조건 일치 여부를 판정해 효과 수치를 정적 보정한다(결정론, 스냅샷 고정).
 */
export type CounterCondition =
  | 'fireAttacker' // 공격자 로드아웃에 화염(fireDmg) 어픽스 존재
  | 'coldAttacker' // 냉기(coldSlow) 존재
  | 'lightningAttacker' // 전격(lightning) 존재
  | 'beamAttacker' // 주무기가 빔/레일건 계열(장거리 화력형)
  | 'powerSuperiority' // 공격자 전투력점수가 방어자보다 우위(임계 초과)
  | 'revenge' // 복수전 대상 공격자
  | 'reinvasion' // 동일 공격자의 재침공
  | 'subweaponHeavy'; // 공격자가 강한 보조무기를 장착

/**
 * 동적 트리거 이벤트 — 런 중 조건 충족 시 발동. `threshold` 의 의미는 이벤트별로 다르다
 * (turretsDestroyed=파괴 포탑 수, timeElapsed=경과 초, coreHpLow=코어 HP %, earlyPhase=초반 초).
 */
export type TriggerEvent =
  | 'coreProximity' // 공격자가 코어 반경 진입
  | 'turretsDestroyed' // 포탑 threshold 기 파괴
  | 'timeElapsed' // threshold 초 경과
  | 'guardianDowned' // 수호 기체 격추당함
  | 'coreHpLow' // 코어 HP 가 threshold % 이하
  | 'earlyPhase' // 침공 시작 후 threshold 초 이내(초반 구간)
  | 'coreHit'; // 코어가 피격당함

export type CardAffixKind = 'prefix' | 'suffix';

/**
 * 카드 어픽스 정의(designer-authored). value 는 [min,max] 정수 균등 롤. 접두사는 `condition`
 * (정적 카운터), 접미사는 `trigger`(+`threshold`)를 갖는다. id 는 스냅샷/직렬화 계약이므로
 * **절대 재번호 금지**.
 */
export interface CardAffixDef {
  readonly id: string;
  /** 한글 표기명(툴팁/보관함). 카드 어픽스 전체 표기 원칙(CONTEXT.md)에 따라 접두/접미를 붙여 쓴다. */
  readonly name: string;
  readonly kind: CardAffixKind;
  readonly stat: CardStatKey;
  readonly min: number;
  readonly max: number;
  /** 접두(정적 카운터) 전용: 발동 매치업 조건. */
  readonly condition?: CounterCondition;
  /** 접미(동적 트리거) 전용: 발동 이벤트. */
  readonly trigger?: TriggerEvent;
  /** 접미 전용: 발동 임계(이벤트별 의미 상이 — 위 TriggerEvent 주석 참조). */
  readonly threshold?: number;
}

/**
 * 접두사 8종 — 정적 카운터(스폰 시점 공격자 스펙 매치업). 조건 일치 시에만 효과가 실린다.
 */
export const CARD_PREFIXES: readonly CardAffixDef[] = [
  { id: 'cc-quench', name: '소화의', kind: 'prefix', stat: 'incomingDmgReductionPct', min: 8, max: 18, condition: 'fireAttacker' },
  { id: 'cc-frostward', name: '방한의', kind: 'prefix', stat: 'incomingDmgReductionPct', min: 8, max: 18, condition: 'coldAttacker' },
  { id: 'cc-insulate', name: '절연의', kind: 'prefix', stat: 'attackerSubCdPct', min: 15, max: 35, condition: 'lightningAttacker' },
  { id: 'cc-refract', name: '분광의', kind: 'prefix', stat: 'incomingDmgReductionPct', min: 6, max: 14, condition: 'beamAttacker' },
  { id: 'cc-armorbreak', name: '중장갑 파쇄의', kind: 'prefix', stat: 'turretDamagePct', min: 12, max: 28, condition: 'powerSuperiority' },
  { id: 'cc-avenger', name: '복수자의', kind: 'prefix', stat: 'turretDamagePct', min: 40, max: 80, condition: 'revenge' },
  { id: 'cc-blockade', name: '연전 차단의', kind: 'prefix', stat: 'incomingDmgReductionPct', min: 10, max: 22, condition: 'reinvasion' },
  { id: 'cc-disruptor', name: '교란의', kind: 'prefix', stat: 'attackerSubCdPct', min: 12, max: 30, condition: 'subweaponHeavy' },
];

/**
 * 접미사 8종 — 동적 트리거(런 중 공격자 행동 반응). `threshold` 로 발동 임계를 지정.
 */
export const CARD_SUFFIXES: readonly CardAffixDef[] = [
  { id: 'ct-forcefield', name: '의 역장', kind: 'suffix', stat: 'coreShieldFlat', min: 120, max: 320, trigger: 'coreProximity' },
  { id: 'ct-fury', name: '의 격노', kind: 'suffix', stat: 'turretFireRatePct', min: 15, max: 35, trigger: 'turretsDestroyed', threshold: 3 },
  { id: 'ct-attrition', name: '의 지연전', kind: 'suffix', stat: 'attackerSlowPct', min: 10, max: 25, trigger: 'timeElapsed', threshold: 90 },
  { id: 'ct-retribution', name: '의 응징', kind: 'suffix', stat: 'volleyDamage', min: 200, max: 500, trigger: 'guardianDowned' },
  { id: 'ct-laststand', name: '의 배수진', kind: 'suffix', stat: 'turretDamagePct', min: 25, max: 55, trigger: 'coreHpLow', threshold: 30 },
  { id: 'ct-vanguard', name: '의 선제', kind: 'suffix', stat: 'turretFireRatePct', min: 12, max: 28, trigger: 'earlyPhase', threshold: 20 },
  { id: 'ct-reflection', name: '의 반사', kind: 'suffix', stat: 'reflectDamagePct', min: 8, max: 20, trigger: 'coreHit' },
  { id: 'ct-entrenchment', name: '의 지구전', kind: 'suffix', stat: 'incomingDmgReductionPct', min: 8, max: 16, trigger: 'timeElapsed', threshold: 120 },
];

/** 전체 카드 어픽스 풀(접두 후 접미). rollCard 가 균등 추첨한다. */
export const CARD_AFFIXES: readonly CardAffixDef[] = [...CARD_PREFIXES, ...CARD_SUFFIXES];

/** id → 카드 어픽스 정의(미지정 시 undefined). */
export const CARD_AFFIX_BY_ID: ReadonlyMap<string, CardAffixDef> = new Map(
  CARD_AFFIXES.map((a) => [a.id, a]),
);

// ---------------------------------------------------------------------------
// 기저 효과 — 등급별 무조건 적용(normal 도 기저는 있음, 스펙 §카드 해부).
// ---------------------------------------------------------------------------

/** 카드가 항상 거는 기본 방어 수치(정수 %). */
export interface CardBaseEffect {
  /** 포탑 화력 +%. */
  readonly turretDamagePct: number;
  /** 코어 HP +%. */
  readonly coreHpPct: number;
}

/** 등급별 기저 효과. 상위 등급일수록 기본치가 크다. 📝 튜닝 대상. */
export const CARD_BASE_EFFECT: Record<Rarity, CardBaseEffect> = {
  normal: { turretDamagePct: 3, coreHpPct: 3 },
  magic: { turretDamagePct: 6, coreHpPct: 6 },
  rare: { turretDamagePct: 10, coreHpPct: 10 },
  unique: { turretDamagePct: 15, coreHpPct: 15 },
};

// ---------------------------------------------------------------------------
// 유니크 카드 — 룰 변경형 고유 효과(파라미터만 데이터, sim 반영은 Lane B).
// ---------------------------------------------------------------------------

/**
 * 유니크 카드 정의. `params` 는 sim 이 읽는 효과 파라미터(틱·비율 등)다. 키·의미는 계약이므로
 * Lane B 와 lane-a-cards-data.md 표로 합의한다. (TICK_RATE=60 기준: 30초 = 1800틱.)
 */
export interface DefenseCardUniqueDef {
  readonly id: string;
  readonly name: string;
  readonly params: Readonly<Record<string, number>>;
}

/**
 * 유니크 4종(고정 룰 변경형). rollCard 가 rarity=unique 일 때 이 목록에서 하나를 뽑아 uniqueId 로
 * 실는다. 효과 자체(가짜 코어 스폰·레이더 무력화·코어 부활·피해 반사)의 sim 통합은 Lane B 몫.
 */
export const DEFENSE_CARD_UNIQUES: readonly DefenseCardUniqueDef[] = [
  // 신기루 코어: 가짜 코어를 함께 스폰(공격자 오인 유도). 가짜는 실효 HP 의 일부만 갖는다.
  { id: 'uq-mirage-core', name: '신기루 코어', params: { decoyCount: 1, decoyHpPct: 50 } },
  // 블랙아웃: 첫 30초(1800틱) 공격자 레이더 무력화.
  { id: 'uq-blackout', name: '블랙아웃', params: { radarDisableTicks: 1800 } },
  // 최후의 재기동: 코어 파괴 직전 방어전당 1회 부활(부활 HP = 최대의 20%).
  { id: 'uq-last-reboot', name: '최후의 재기동', params: { reviveHpPct: 20, reviveCount: 1 } },
  // 거울 관문: 코어가 받는 피해의 25% 를 공격자에게 반사.
  { id: 'uq-mirror-gate', name: '거울 관문', params: { reflectPct: 25 } },
];

/** id → 유니크 정의(미지정 시 undefined). */
export const DEFENSE_CARD_UNIQUE_BY_ID: ReadonlyMap<string, DefenseCardUniqueDef> = new Map(
  DEFENSE_CARD_UNIQUES.map((u) => [u.id, u]),
);

// ---------------------------------------------------------------------------
// 사용 횟수 범위 · 합성 확률 · 보관 상한 · 유니크 어픽스 수(고정).
// ---------------------------------------------------------------------------

/**
 * 등급별 사용 횟수 롤 범위 [min,max] 정수 균등(스펙 R5: 강할수록 적은 횟수). 생성 시 시드로 확정.
 * 📝 시작값.
 */
export const CARD_CHARGE_RANGE: Record<Rarity, readonly [number, number]> = {
  normal: [6, 10],
  magic: [5, 8],
  rare: [3, 6],
  unique: [2, 4],
};

/** 유니크 카드의 고정 어픽스 수(스펙 §카드 해부 "unique 고정"). 접두/접미로 분할된다. */
export const CARD_UNIQUE_AFFIX_COUNT = 4;

/** 카드 전용 보관함 상한(OQ#1: 만석 시 획득 차단). 확장 없음(스펙 Non-Goals). 📝 시작값 20. */
export const CARD_STORAGE_CAP = 20;

/** 합성에 소모하는 동급 카드 수(스펙 R8: 3장 → 1장). */
export const FUSION_INPUT_COUNT = 3;

/**
 * 등급별 합성 승급 확률(해당 등급 3장 → 상위 등급 1장). unique 는 상위가 없어 키 없음(승급 불가).
 * 실패해도 동급 새 카드 1장 반환(순소실 없음 — attemptFusion). 📝 시작값.
 */
export const FUSION_CHANCE: Partial<Record<Rarity, number>> = {
  normal: 0.5, // → magic
  magic: 0.2, // → rare
  rare: 0.03, // → unique
};

// ---------------------------------------------------------------------------
// 카드 인스턴스 직렬화 계약 — DB jsonb·스냅샷에 실린다(Lane B·C 가 그대로 소비).
// ---------------------------------------------------------------------------

/** 카드에 확정된 하나의 어픽스 롤(장비 AffixRoll 과 형태 동일, stat 은 CardStatKey). */
export interface CardAffixRoll {
  /** {@link CardAffixDef.id} 출처. */
  readonly id: string;
  readonly stat: CardStatKey;
  /** 정의의 [min,max] 내 롤 정수. */
  readonly value: number;
}

/**
 * 확정된 방어 카드 인스턴스. `rollCard(seed, rarity)` 로 완전히 결정되어, 같은 시드는 클라·EF 에서
 * 바이트 동일 카드를 재구성한다. 안정된 plain 객체(jsonb·스냅샷 직렬화용) — 필드 추가는 append-only.
 */
export interface CardInstance {
  /** 인스턴스 id(시드 파생, 안정·재현). */
  readonly id: string;
  readonly rarity: Rarity;
  /** 정적 카운터(접두) 롤. 등급별 어픽스 수에서 접두로 분류된 것들. */
  readonly prefixes: readonly CardAffixRoll[];
  /** 동적 트리거(접미) 롤. 접미로 분류된 것들. */
  readonly suffixes: readonly CardAffixRoll[];
  /** rarity=unique 일 때만 설정 — {@link DEFENSE_CARD_UNIQUES} 키. */
  readonly uniqueId?: string;
  /** 생성 시 롤된 최대 사용 횟수. */
  readonly chargesMax: number;
  /** 남은 사용 횟수(생성 시 = chargesMax, 확정 침공마다 서버가 1 차감). */
  readonly chargesLeft: number;
  /** 롤 시드(재현·감사). */
  readonly seed: number;
}

// ---------------------------------------------------------------------------
// 순수 결정론 함수 — 획득 확률·상점 로테이션·등급 승급·분해 환급.
// ---------------------------------------------------------------------------

/** 정수 clamp [lo,hi]. */
function clampInt(v: number, lo: number, hi: number): number {
  const i = Math.trunc(v);
  if (i < lo) return lo;
  if (i > hi) return hi;
  return i;
}

/** 전투력 점수 차 상한(OQ#2): 이 차이에서 확률 배수가 2배(1+1)에 도달한다. */
export const DROP_CP_DIFF_CAP = 5000;

/**
 * 방어 성공 보상 카드 획득 확률(OQ#2). base × (1 + clamp(공격자CP − 방어자CP, 0, CAP)/CAP).
 * 강한 공격자를 막을수록(전투력 우위가 클수록) 상승, 최대 base 의 2배. 공격자가 약하면(차 ≤ 0)
 * base 그대로. 결정론 실수 연산(호출 측이 시드 롤과 비교해 획득 판정).
 */
export function defenseSuccessDropChance(
  base: number,
  attackerCp: number,
  defenderCp: number,
): number {
  const diff = clampInt(attackerCp - defenderCp, 0, DROP_CP_DIFF_CAP);
  return base * (1 + diff / DROP_CP_DIFF_CAP);
}

// ---------------------------------------------------------------------------
// 방어 성공 보상 드랍 — 등급 분포(rare 중심 + unique 극저확률, 스펙 §희소 획득).
// ---------------------------------------------------------------------------

/**
 * 방어 성공 시 카드가 드랍될 기본 확률(defenseSuccessDropChance 의 base 인자). 전투력 우위가 클수록
 * defenseSuccessDropChance 가 최대 2배까지 올린다. 📝 시작값.
 */
export const DEFENSE_DROP_BASE_CHANCE = 0.15;

/** 드랍 카드 유니크 등급 확률(극저). 📝 시작값. */
export const DROP_RARITY_UNIQUE_CHANCE = 0.04;
/** 드랍 카드 매직 등급 확률. 나머지(1 − unique − magic)는 rare(중심). 📝 시작값. */
export const DROP_RARITY_MAGIC_CHANCE = 0.31;

/**
 * 방어 성공 드랍 카드의 등급을 [0,1) 균등 roll 로 결정한다(rare 중심 + unique 극저). 드랍은 보상이라
 * normal 은 나오지 않는다(magic 이상). 순수 함수 — 호출 측(EF)이 무작위 roll 을 공급한다.
 *   roll < UNIQUE                    → unique
 *   roll < UNIQUE + MAGIC            → magic
 *   그 외(대부분)                     → rare
 */
export function rollDropRarity(roll: number): Rarity {
  if (roll < DROP_RARITY_UNIQUE_CHANCE) return 'unique';
  if (roll < DROP_RARITY_UNIQUE_CHANCE + DROP_RARITY_MAGIC_CHANCE) return 'magic';
  return 'rare';
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

/** 상점 로테이션 한 칸(어느 등급 카드를, 어느 시드로). rollCard 로 실제 카드가 된다. */
export interface ShopSlot {
  readonly rarity: Rarity;
  readonly seed: number;
}

/** 상점 재고 범위(스펙 R6): normal 3~4장 + magic 1~2장. 레어 이상은 상점에 없음. 📝 시작값. */
export const SHOP_NORMAL_RANGE: readonly [number, number] = [3, 4];
export const SHOP_MAGIC_RANGE: readonly [number, number] = [1, 2];

/**
 * 방어 사령부 일일 로테이션 순수 함수. (dateSeed, userSeed) → 결정론 재고 계획. 같은 날 같은 유저는
 * 항상 동일 재고를 받고(시드 검증), normal·magic 만 등장한다. 반환은 로테이션 계획(등급+시드)이며,
 * src/items/rollCard.ts 의 rollShopRotation 이 이를 CardInstance 로 롤한다(계층 분리: 데이터는
 * 상점 정체성을, items 는 카드 확정을 담당 — 순환 import 회피).
 */
/**
 * 상점 로테이션 날짜 시드(UTC 일 단위). epoch ms → UTC 기준 날 인덱스(epoch 이래 경과 일수). 같은
 * UTC 날짜면 클라·서버가 동일 시드를 얻어 재고를 일치시킨다(순수 — 호출 측이 시계값 nowMs 공급).
 */
export function shopDateSeedFromMs(nowMs: number): number {
  return Math.floor(nowMs / 86_400_000) >>> 0;
}

/**
 * 유저 고유 상점 시드(프로필 기반 안정값). uid 문자열을 FNV-1a 로 u32 로 접는다. 같은 uid → 항상 같은
 * 시드라 클라(표시)와 서버(구매 재현)가 동일 재고를 계산한다(SeededRng.fork 의 hashString 과 동일 규약).
 */
export function shopUserSeed(uid: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// 카드 구매 가격 — 상점 카드 구매 크레딧 비용(등급 기반, data/economy.ts 곡선과 정합).
// ---------------------------------------------------------------------------

/** 카드 구매 기본 비용(크레딧). 앵커: normal(랭크0) = BASE. 📝 시작값. */
export const CARD_BUY_BASE = 40;
/** 등급 1단계당 추가 구매 비용(크레딧) — 상위 등급일수록 비싸다. 📝 시작값. */
export const CARD_BUY_PER_RARITY = 60;

/**
 * 상점 카드 구매 비용(크레딧). BASE + PER_RARITY×등급랭크(RARITY_CODE). 등급에 단조 증가.
 * normal 40 / magic 100 / rare 160 / unique 220(상점은 normal·magic 만 취급하나 안전상 전 등급 정의).
 * 결정론 정수 — 서버(차감)·클라(표기)가 동일 값을 재현. 📝 튜닝 대상.
 */
export function cardBuyPrice(rarity: Rarity): number {
  return CARD_BUY_BASE + CARD_BUY_PER_RARITY * RARITY_CODE[rarity];
}

export function dailyShopRotation(dateSeed: number, userSeed: number): ShopSlot[] {
  // 날짜 시드에서 유저별 독립 스트림을 파생(같은 날이라도 유저마다 다른 재고, 유저·날 고정 시 동일).
  const rng = new SeededRng(dateSeed >>> 0).fork(userSeed >>> 0);
  const normalCount = rng.int(SHOP_NORMAL_RANGE[0], SHOP_NORMAL_RANGE[1]);
  const magicCount = rng.int(SHOP_MAGIC_RANGE[0], SHOP_MAGIC_RANGE[1]);
  const slots: ShopSlot[] = [];
  for (let i = 0; i < normalCount; i++) slots.push({ rarity: 'normal', seed: rng.nextU32() });
  for (let i = 0; i < magicCount; i++) slots.push({ rarity: 'magic', seed: rng.nextU32() });
  return slots;
}

// ---------------------------------------------------------------------------
// 분해 환급 — 카드 전용 보관함 정리 시 크레딧 회수(스펙 R10). 순수 정수.
// ---------------------------------------------------------------------------

/** 등급별 분해 기본 환급(크레딧). 상위 등급일수록 회수액↑. 📝 시작값. */
export const SALVAGE_BASE: Record<Rarity, number> = {
  normal: 5,
  magic: 15,
  rare: 40,
  unique: 100,
};

/** 카드 어픽스 1개당 추가 환급(크레딧) — 옵션이 많을수록 회수액↑. */
export const SALVAGE_PER_AFFIX = 4;

/**
 * 카드 분해 환급치(크레딧). 등급 기본 + 어픽스 수 가산. 남은 횟수와 무관(카드 자체 가치 회수 —
 * 소모품 잔량이 아니라 롤 가치를 되판다). 결정론 정수.
 */
export function cardSalvageValue(card: CardInstance): number {
  const affixCount = card.prefixes.length + card.suffixes.length;
  return SALVAGE_BASE[card.rarity] + affixCount * SALVAGE_PER_AFFIX;
}

/** 등급 랭크(RARITY_CODE 재사용) — 정렬·표기용 재노출. */
export function cardRarityRank(rarity: Rarity): number {
  return RARITY_CODE[rarity];
}
