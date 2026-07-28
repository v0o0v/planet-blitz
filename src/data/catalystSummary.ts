/**
 * 주입 촉매의 **전체 효과 집계** — 순수 (ADR-0029, 사용자 요청 2026-07-28).
 *
 * 픽커 하단 요약 스트립과 런 중 정보판(HUD)이 공유하는 단일 정본이다. 예전에는 픽커가
 * hover 한 촉매 **한 장**의 설명만 보여 줬다("탐욕 / 페널티: … 보상: …") — 8장을 주입해도
 * 그 조합이 실제로 만들어 내는 배율은 화면 어디에도 없었다. 여기서는 주입 배열 전체를
 * 축별로 접어 **실제 sim 에 곱해지는 배율과 1:1** 인 줄만 만든다.
 *
 * ## 왜 배율을 여기서 다시 계산하지 않는가
 * `catalysts.ts` 의 `catalystPenaltyMult`/`catalystRewardMult`/`catalystPowerMult` 를 그대로
 * 부른다. 표시용 별도 산식을 두면 "화면 +40% 인데 sim 은 +30%" 같은 괴리가 생긴다 — 표시가
 * 곧 계약이 되도록 계산 지점을 하나로 묶는다.
 *
 * ## 축 순서는 고정이다
 * 주입 순서·id 순서와 무관하게 항상 아래 `PENALTY_ORDER`/`REWARD_ORDER` 순으로 나온다.
 * 한 장 넣고 뺄 때마다 줄이 뒤섞이면 읽을 수 없고, 테스트도 순서를 못 건다.
 *
 * 데이터/파생 전용 모듈 — sim·render·ui 를 import 하지 않는다(`catalysts.ts` 만 참조).
 */

import {
  catalystById,
  catalystPenaltyMult,
  catalystPowerMult,
  catalystRewardMult,
  type PenaltyAxis,
  type PowerStat,
  type RewardAxis,
} from './catalysts.js';

/** 페널티 줄 표시 순서(고정). */
const PENALTY_ORDER: readonly PenaltyAxis[] = [
  'enemyHp',
  'enemyDamage',
  'enemyCount',
  'enemySpeed',
  'enemyBulletSpeed',
  'playerHpDown',
];

/** 보상 줄 표시 순서(고정). `power` 는 스탯별로 한 단계 더 갈라진다. */
const REWARD_ORDER: readonly Exclude<RewardAxis, 'power'>[] = [
  'drop',
  'rarity',
  'xp',
  'resource',
  'catalystDrop',
];

/** 파워 보상 세부 스탯 표시 순서(고정). */
const POWER_ORDER: readonly PowerStat[] = ['damage', 'fireRate', 'moveSpeed', 'maxHp', 'skillAll'];

/** 페널티 한 줄 — 축 + 그 축의 최종 배율(>1). */
export interface CatalystPenaltyLine {
  readonly axis: PenaltyAxis;
  /** sim 노브에 곱해지는 배율. 1.4 = +40% 난이도. */
  readonly mult: number;
}

/** 보상 한 줄 — 축(+파워면 세부 스탯) + 그 축의 최종 배율(>1). */
export interface CatalystRewardLine {
  readonly axis: RewardAxis;
  /** `axis === 'power'` 일 때만 있다. */
  readonly powerStat?: PowerStat;
  readonly mult: number;
}

/** 주입 배열 전체의 효과 집계. 배율이 정확히 1인 축(=해당 촉매 없음)은 줄에서 빠진다. */
export interface CatalystSummary {
  /** 총 주입 장수(미지 id 제외). */
  readonly count: number;
  /** 서로 다른 촉매 종류 수(스택은 1로 센다). */
  readonly kinds: number;
  readonly penalties: readonly CatalystPenaltyLine[];
  readonly rewards: readonly CatalystRewardLine[];
}

/** 부동소수 오차로 "+0%" 줄이 생기는 것을 막는 문턱(0.5% 미만은 무효과로 본다). */
const EPS = 0.005;

/**
 * 주입 배열을 축별 배율로 접는다(순수). 미지 id 는 `catalystById` 가 걸러 count 에도 안 든다.
 *
 * 빈 배열이면 `count: 0` + 빈 줄 목록 — 호출부는 그때 "주입 없음" 문구로 갈라 쓴다.
 */
export function catalystSummary(ids: readonly number[]): CatalystSummary {
  const known = ids.filter((id) => catalystById(id) !== undefined);

  const penalties: CatalystPenaltyLine[] = [];
  for (const axis of PENALTY_ORDER) {
    const mult = catalystPenaltyMult(known, axis);
    if (mult > 1 + EPS) penalties.push({ axis, mult });
  }

  const rewards: CatalystRewardLine[] = [];
  for (const axis of REWARD_ORDER) {
    const mult = catalystRewardMult(known, axis);
    if (mult > 1 + EPS) rewards.push({ axis, mult });
  }
  for (const powerStat of POWER_ORDER) {
    const mult = catalystPowerMult(known, powerStat);
    if (mult > 1 + EPS) rewards.push({ axis: 'power', powerStat, mult });
  }

  return { count: known.length, kinds: new Set(known).size, penalties, rewards };
}

/**
 * 배율 → 표시 문자열(`1.45` → `+45%`). 반올림은 정수 퍼센트로 한다 — 0.15 씩 쌓이는 계수라
 * 소수점을 남기면 `+44.99%` 같은 부동소수 찌꺼기가 그대로 보인다.
 *
 * 1 이하(무효과·역방향)는 `+0%` 로 접는다 — 이 함수는 표시 전용이고, 줄 자체를 지울지는
 * {@link catalystSummary} 가 이미 정했다.
 */
export function formatCatalystMult(mult: number): string {
  return `+${Math.max(0, Math.round((mult - 1) * 100))}%`;
}
