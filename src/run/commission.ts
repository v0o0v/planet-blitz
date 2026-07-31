/**
 * 의뢰서(Commission) 스키마 — **타입 단일 정본** (계획 §Phase B0 · PA 레인 계약 §2).
 *
 * 여기에는 **두 가지 서로 다른 형태**가 산다. 헷갈리면 배선이 조용히 어긋나므로 못 박는다:
 *
 * 1. {@link CommissionPayload} — **서버 원장에 저장되는 형태**(`commission_inventory.payload jsonb`).
 *    발령 시점에 굳는 "종이에 적힌 의뢰서"다. 확정 보상까지 포함하며 `version` 으로 범프한다.
 *    EF 가 제출된 리플레이 config 를 덮어쓸 때의 **권위 원본**이기도 하다.
 * 2. {@link CommissionRunConfig} — **`WorldConfig` 에 실리는 형태**. sim 이 읽어야 하는 것만
 *    좁게 담는다(보상은 sim 이 모른다). 런이 도는 동안 `segmentIndex` 만 구간 전환에서 바뀐다.
 *
 * ## 왜 payload 를 그대로 config 에 싣지 않는가
 * 보상 블록은 sim 입력이 아니다. 리플레이 config 는 per-tick 해시의 입력이자 서버 재실행의
 * 스냅샷이라, 시뮬레이션이 읽지 않는 값을 실으면 **위조 표면만 넓어지고 결정론엔 기여가 0**이다.
 * 서버는 자기 원장의 payload 를 정본으로 보고 제출된 config 를 그것으로 덮어쓴다.
 *
 * ## 레인 경계 (PA 레인 계약 §13)
 * 이 파일이 **PA 레인과 서버 레인(`cm-lane-srv`)의 유일한 공유 편집 지점**이다. PA 가 먼저
 * 커밋하고 서버 레인이 이 타입을 읽어 `payload jsonb` 계약으로 쓴다. **export 경로를 바꾸지 마라.**
 *
 * ## 미완인 채로 두는 것 (의도)
 * `constraints.equipRules` 는 **형태만** 정한다 — 개별 제약 카탈로그 항목은 Phase D 소관이다.
 * 착수를 막는 것은 "어떤 제약이 있는가"가 아니라 "제약을 실을 자리가 있는가"이며, 이 파일은
 * 후자만 진다(계획 rev6 의 순환 해소).
 */

import type { EquipSlotId } from '../items/types.js';

/** 의뢰 계급 4단 — 1 정기 · 2 우선 · 3 특급 · 4 최종. */
export type CommissionGrade = 1 | 2 | 3 | 4;

/** 주문 4종. `bounty` 만 표적 도주라는 **실패 경로**를 갖는다(계약 §5 분기 ③). */
export type CommissionOrder = 'chain' | 'constraint' | 'bounty' | 'elite';

/**
 * 주문의 **wire 순서** — `hashWorld` 의뢰 꼬리 폴드가 접는 정수 인코딩의 정본.
 *
 * ⚠️ **APPEND-ONLY. 순서를 바꾸지 마라.** 이 배열의 인덱스가 곧 해시에 접히는 값이라, 재배치는
 * 이미 제출된 모든 의뢰 리플레이를 조용히 무효화한다(클라·서버가 같은 소스를 쓰므로 **양쪽이
 * 동시에 틀려** 어떤 게이트도 울리지 않는다).
 */
export const COMMISSION_ORDERS = ['chain', 'constraint', 'bounty', 'elite'] as const satisfies
  readonly CommissionOrder[];

/**
 * 주문 → wire 정수. 미지의 값은 `-1`(정규화 실패도 결정론적이어야 한다 — `activeSlots` 의
 * `ACTIVE_WIRE_EMPTY` 와 같은 규율).
 */
export function commissionOrderWire(order: CommissionOrder): number {
  return COMMISSION_ORDERS.indexOf(order);
}

/**
 * 한 구간의 무대 지정.
 *
 * ⚠️ **`mode` 필드를 두지 않는다.** 행성 모드의 단일 정본은 `planetContent(planet).mode`
 * 파생이다(`src/run/runConfig.ts` 의 `planetMode` 스탬프). 여기에 `mode` 를 두면 정본이 둘이
 * 되어 "행성은 카르곤인데 모드는 수축" 같은 조합 불가능한 상태가 타입상 표현 가능해진다 —
 * 행성-모드 자유 조합은 **명시적 비목표**다(ADR-0046 의 "구간마다 모드를 갈아탄다"는 실질적으로
 * "구간마다 행성을 갈아탄다"와 등가).
 */
export interface SegmentSpec {
  /** 행성 인덱스(`data/planets` 레지스트리). */
  planet: number;
  /** 침략 단계(1..∞, ADR-0022). */
  stage: number;
}

/**
 * 장비축 제약 — **열린 레코드**. 개별 항목 열거는 Phase D 가 채운다.
 *
 * 필드를 나중에 더해도 스키마가 안 깨지도록 전부 optional 이다. 소비자는 미지정을
 * "그 축에 제약 없음"으로 읽는다.
 */
export interface CommissionEquipRules {
  /** 봉인된 장비 슬롯. */
  bannedSlots?: EquipSlotId[];
  /** 사용 금지 유니크 id. */
  bannedUniqueIds?: number[];
  /** 허용 최고 희귀도(0 일반 .. 3 유니크). */
  maxRarity?: number;
}

/**
 * 의뢰 제약.
 *
 * ⚠️ **성장축 제약(`bannedPowerupLines`)은 반드시 config 에 실려야 한다.** 서버가 리플레이
 * `config` 대조로 준수를 증명해야 하는데(ADR-0044), 파워업 풀 필터가 런타임에만 살면
 * **서버가 그것을 볼 방법이 없다.** 장비축은 `loadout` 에 이미 반영돼 있어 별도 필드가 불필요하지만,
 * "무엇이 금지였는가"는 서버가 판정해야 하므로 `equipRules` 도 여기에 남는다.
 */
export interface CommissionConstraints {
  /** 금지된 파워업 계열 인덱스. */
  bannedPowerupLines?: number[];
  /** 장비축 제약(형태만 — Phase D 가 항목을 채운다). */
  equipRules?: CommissionEquipRules;
}

/**
 * 현상금 주문의 표적 규정. **플레이스홀더** — 실제 필드는 Phase D 가 확정한다.
 * 도주 임계 수치 자체는 `commissionConstants.ts` 가 정본으로 들고 있다(하드코딩 금지).
 */
export interface CommissionBounty {
  /** 표적 종류 식별자(Phase F 의 의뢰 보스 카탈로그 인덱스). */
  targetKind: number;
  /**
   * 도주 규칙 식별자. `'hpThreshold'` = HP 가 임계 아래로 떨어지면 도주,
   * `'surviveTicks'` = 일정 틱을 버티면 도주. 임계값은 상수 모듈이 준다.
   */
  escapeRule: 'hpThreshold' | 'surviveTicks';
}

/** 확정 보상 아이템 한 줄(발령 시점에 굳는다). */
export interface CommissionRewardItem {
  /** 희귀도 코드(0 일반 .. 3 유니크). */
  rarity: number;
  /** 요구 레벨 상한(ADR-0030). */
  reqLevelCap: number;
}

/**
 * 종이에 적힌 확정 보상.
 *
 * ⚠️ `uniqueId` 는 `grant_commission` 이 **발령 시점에 굴려 여기 고정**한다. 보유 유니크를
 * 제외하지 않는다 — 중복 지급을 허용한다(서버가 갖지 않은 원장을 전제하지 않기 위함).
 */
export interface CommissionRewards {
  credits: number;
  minerals: number;
  items: CommissionRewardItem[];
  blueprints?: number[];
  catalysts?: number[];
  uniqueId?: number;
}

/**
 * **서버 원장 형태** — `commission_inventory.payload jsonb` 에 그대로 들어간다.
 *
 * ⚠️ `loadoutSealed`(출격 시점 로드아웃 봉인)는 **여기에 없다.** 발령 시점에는 아직 로드아웃이
 * 정해지지 않았기 때문이다 — 그것은 `commission_runs` 행에 산다(계획 pre-mortem ⑦).
 */
export interface CommissionPayload {
  /** 스키마 범프용. 신설 = 1. */
  version: number;
  /** 의뢰 id(uuid 문자열). */
  commissionId: string;
  grade: CommissionGrade;
  order: CommissionOrder;
  segments: SegmentSpec[];
  constraints?: CommissionConstraints;
  /** 현상금 주문일 때만. */
  bounty?: CommissionBounty;
  rewards: CommissionRewards;
  /** 이 의뢰 전체의 리플레이 틱 예산(구간 합). 상수 모듈이 계급에서 파생한다. */
  replayBudgetTicks: number;
}

/**
 * **`WorldConfig` 에 실리는 형태**(`WorldConfig.commission`).
 *
 * `buildRunConfig` 가 **조건부로** 스탬프한다 — 미지정이면 필드 자체를 싣지 않아 무의뢰 런의
 * config 직렬화(리플레이 스냅샷)가 기존과 **바이트 동일**하다(`planetMultCenti`·`activeSlots` 선례).
 *
 * ## `segmentIndex` 가 여기 있는 이유
 * 구간 전환은 새 월드를 만들면서 `config` 를 계승하고 이 필드만 갱신한다. `state.tick` 이
 * 구간마다 0 으로 돌아가므로, **같은 행성·같은 단계가 반복되는 조합에서는 `segmentIndex` 가
 * per-tick 해시 스트림의 유일한 구간 판별자**다(계약 §8). 장식이 아니라 하중 부재다.
 *
 * ## ⚠️ 전 필드가 `readonly` 인 이유 — in-place 갱신 금지
 * `buildRunConfig` 는 이 객체를 **복사 없이** 스탬프하므로 호출부 객체와 라이브 월드 config 가
 * 같은 참조다. 구간 전환이 `segmentIndex` 를 **제자리에서** 올리면 **1구간 월드의
 * `config.commission.segmentIndex` 까지 함께 바뀐다.** config 는 리플레이 스냅샷에 그대로
 * 실리므로 "실제 플레이한 런과 정산·재검증되는 런이 갈리는" 결함(PR#191 계열)이 되는데,
 * 클라·서버가 **둘 다 같은 config 로 재실행**하므로 **해시는 절대 안 갈리고 어떤 게이트도
 * 안 울린다.**
 *
 * 그래서 전환은 반드시 **새 객체**를 만들어야 한다:
 * `{ ...prev.config.commission, segmentIndex: i + 1 }`. `readonly` 가 그것을 강제한다 —
 * 규율이 아니라 타입이 지게 두는 것이 이 저장소의 반복 결함(“한 경로만 고쳐서 새는”)에 대한
 * 유일하게 신뢰할 만한 방어다.
 */
export interface CommissionRunConfig {
  readonly commissionId: string;
  readonly order: CommissionOrder;
  readonly grade: CommissionGrade;
  readonly segments: readonly SegmentSpec[];
  /** 이 의뢰 전체의 리플레이 틱 예산. */
  readonly replayBudgetTicks: number;
  readonly constraints?: CommissionConstraints;
  /**
   * 현상금 표적의 도주 규정(그 주문일 때만). **sim 이 읽는다** — `stepBountyEscape` 가 매 틱
   * `escapeRule` 로 점화 조건을 고른다. 그래서 보상 블록과 달리 이 축은 `WorldConfig` 에
   * 실려야 한다(sim 입력이 아닌 것만 payload 에 남긴다는 이 파일의 분리 원칙 그대로).
   *
   * 임계 **수치**는 여기 없다 — `commissionConstants.ts` 가 정본이다(하드코딩 금지). 여기 있는
   * 것은 "어느 조건으로 점화하는가" 뿐이고, 길이는 규칙과 무관하게 항상 같다.
   */
  readonly bounty?: CommissionBounty;
  /** 현재 구간 인덱스(0-based). 구간 전환이 **새 객체를 만들어** 이 값만 갱신한다. */
  readonly segmentIndex: number;
}
