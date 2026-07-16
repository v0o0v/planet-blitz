/**
 * Wave content — 6-segment budget table + an 8-card spawn pool (spec R3, §수치).
 *
 * A run is 6 segments. Each segment periodically draws a spawn *card* from the
 * pool via the seeded wave RNG, so the enemy composition varies per seed while
 * the per-segment budget (onscreen enemy cap + simultaneous enemy-bullet cap)
 * bounds difficulty and performance. The 6th segment is the boss slot — M1
 * Phase 2 marks the transition; the boss fight itself is Phase 3 (plan task 15).
 *
 * Budget values (enemy cap 12→20→28→36→44, bullet cap 300→600→900→1,200→1,600
 * →2,000) are taken directly from the spec's 구간 예산표.
 */

import type { EnemyRole } from '../src/sim/patterns/types.js';

export type Formation = 'ring' | 'line' | 'edges' | 'cluster';

// ---------------------------------------------------------------------------
// 난도 티어 (plan B3, 갈림길 ③A: 티어 파라미터 데이터 주입, AC5)
// ---------------------------------------------------------------------------

/** 정찰(0): 기본. */
export const TIER_RECON = 0;
/** 교전(1): 카드당 정예 1 승격 + HP ×2.2(plan 밸런스 표 — 패턴은 M2와 동일). */
export const TIER_ENGAGE = 1;
/** 섬멸(2): 패턴 변형(서브탄)+밀도↑+정예 2 + HP 완만 상향(×4.5). */
export const TIER_ANNIHILATION = 2;

/** 레벨 캡(plan §3). */
export const LEVEL_CAP = 100;
/** 섬멸 티어 진입 게이트 레벨(plan B3, 게이트 ④). */
export const ANNIHILATION_UNLOCK_LEVEL = 60;

/**
 * 티어 파라미터 — 패턴 엔진·웨이브 디렉터에 데이터로 주입(갈림길 ③A). "수치만 다른
 * 티어" 금지(원칙4): 섬멸은 서브탄(패턴 변형)+밀도↑가 본질이고 HP는 완만하게만 오른다.
 *
 * 정찰(0)은 M2 거동을 그대로 보존한다(hpMult 1·subBullets 0·densityMult 1 →
 * 기존 스폰/패턴/해시 불변). 교전(1)은 plan 밸런스 표의 HP ×2.2를 싣는다(패턴·밀도·
 * 정예 승격은 M2와 동일). 섬멸(2)만 패턴 변형까지 포함한 신규 수치를 싣는다.
 */
export interface TierParams {
  /** 적 스폰 HP 배율(완만). */
  readonly hpMult: number;
  /** 온스크린 적 상한 배율(밀도↑). */
  readonly densityMult: number;
  /** 카드당 정예 승격 수. */
  readonly eliteCount: number;
  /** 패턴 변형: 적 공격당 추가 서브탄 수(fragments 밀도↑ / mortar 방사 추가). */
  readonly subBullets: number;
}

/** 티어별 파라미터(index = 티어). 새 티어는 append. */
export const TIER_PARAMS: readonly TierParams[] = [
  { hpMult: 1, densityMult: 1, eliteCount: 0, subBullets: 0 }, // 정찰
  { hpMult: 2.2, densityMult: 1, eliteCount: 1, subBullets: 0 }, // 교전(plan 밸런스 표 ×2.2)
  { hpMult: 4.5, densityMult: 1.5, eliteCount: 2, subBullets: 3 }, // 섬멸
];

/** 티어 파라미터 조회(범위 밖은 정찰로 폴백). */
export function tierParams(tier: number | undefined): TierParams {
  return TIER_PARAMS[tier ?? 0] ?? (TIER_PARAMS[0] as TierParams);
}

/** 티어 진입 게이트: 섬멸은 레벨 60+ 요구, 그 외는 항상 허용(plan B3). */
export function canEnterTier(tier: number, level: number): boolean {
  if (tier >= TIER_ANNIHILATION) return level >= ANNIHILATION_UNLOCK_LEVEL;
  return true;
}

/**
 * One spawn group in a wave card. Either a ROLE spawn (resolved against the
 * planet's role roster) or an ELITE spawn (resolved against the planet's elite
 * list by index). The elite variant is optional/additive so existing role-only
 * cards (카르곤) are unchanged; 베르단 cards use it to seed its 엘리트 2종.
 */
export type WaveSpawn =
  | { readonly role: EnemyRole; readonly count: number }
  | { readonly elite: number; readonly count: number };

export interface WaveCard {
  readonly id: string;
  readonly formation: Formation;
  readonly spawns: readonly WaveSpawn[];
}

export interface WaveSegment {
  readonly index: number;
  readonly durationTicks: number;
  /** Max enemies allowed onscreen (spawns pause when reached). */
  readonly maxEnemies: number;
  /** Simultaneous enemy-bullet cap (perf + fairness bound). */
  readonly bulletCap: number;
  /** Ticks between card draws within the segment. */
  readonly cardInterval: number;
  readonly boss: boolean;
}

/** 6 segments; last is the boss slot (Phase 3 fills the fight). */
export const SEGMENTS: readonly WaveSegment[] = [
  { index: 0, durationTicks: 2700, maxEnemies: 12, bulletCap: 300, cardInterval: 220, boss: false },
  { index: 1, durationTicks: 2700, maxEnemies: 20, bulletCap: 600, cardInterval: 200, boss: false },
  { index: 2, durationTicks: 2700, maxEnemies: 28, bulletCap: 900, cardInterval: 180, boss: false },
  { index: 3, durationTicks: 2700, maxEnemies: 36, bulletCap: 1200, cardInterval: 160, boss: false },
  { index: 4, durationTicks: 2700, maxEnemies: 44, bulletCap: 1600, cardInterval: 150, boss: false },
  { index: 5, durationTicks: 3600, maxEnemies: 8, bulletCap: 2000, cardInterval: 9999, boss: true },
];

/** 8-card spawn pool drawn from throughout a run (spec 웨이브 카드 풀 초안). */
export const CARD_POOL: readonly WaveCard[] = [
  { id: 'charger-rush', formation: 'line', spawns: [{ role: 'charger', count: 4 }] },
  { id: 'gunner-line', formation: 'edges', spawns: [{ role: 'gunner', count: 3 }] },
  {
    id: 'mixed-assault',
    formation: 'ring',
    spawns: [
      { role: 'charger', count: 2 },
      { role: 'gunner', count: 2 },
    ],
  },
  { id: 'special-field', formation: 'cluster', spawns: [{ role: 'special', count: 2 }] },
  {
    id: 'support-escort',
    formation: 'ring',
    spawns: [
      { role: 'support', count: 1 },
      { role: 'charger', count: 3 },
    ],
  },
  { id: 'encircle', formation: 'ring', spawns: [{ role: 'charger', count: 6 }] },
  { id: 'bombard', formation: 'edges', spawns: [{ role: 'gunner', count: 4 }] },
  {
    id: 'heavy-column',
    formation: 'edges',
    spawns: [
      { role: 'special', count: 1 },
      { role: 'gunner', count: 2 },
      { role: 'support', count: 1 },
    ],
  },
];
