/**
 * 보스 등장까지 남은 진행도 파생(사용자 요청 2026-07-26 — "보스가 나오기까지 얼마나 남았는지
 * 상세 게이지바").
 *
 * ## 왜 별도 모듈인가
 * 세그먼트 전진 규칙은 `updateWaves`(waves.ts) 안에 모드별 분기로 흩어져 있고, 그 분기는
 * **불리언(cleared)만** 낸다 — "얼마나 남았는가"는 어디에도 없다. HUD 가 그걸 알려면 같은
 * 규칙을 연속량(0..1)으로 다시 읽어야 하는데, 그 재해석을 HUD 에 두면 규칙이 두 벌로 갈린다.
 * 그래서 파생을 여기 한곳에 모으고 HUD 는 숫자만 받는다.
 *
 * ## 결정론
 * **읽기 전용 파생**이다 — 상태를 쓰지 않고, RNG 를 소비하지 않으며, `hashWorld` 가 접는 필드를
 * 만들지 않는다. sim 스텝에서 호출되지도 않는다(렌더 루프가 프레임당 1회 호출). 따라서 PvE·침공
 * 해시에 한 바이트도 닿지 않는다(ADR-0005 경계 유지 — UI 타입도 import 하지 않는다).
 *
 * ## 침공 런
 * 침공(`config.invasion3`)은 `updateWaves` 자체가 돌지 않아 세그먼트 축이 존재하지 않는다
 * (`stepWorld` 의 `!designedRun` 게이트). 그래서 `undefined` 를 반환해 HUD 가 게이지를 아예
 * 감춘다 — 0% 로 굳은 가짜 게이지를 보여주지 않는다.
 */

import type { WorldState } from './world.js';
import { SEGMENTS } from '../../data/waves.js';
import { PLANET_MODE } from './planetMode.js';
import { blockBreakProgress, BLOCKBREAK_SECTION_LENGTH } from './modes/blockBreak.js';
import { racingProgress, RACING_SECTION_LENGTH } from './modes/racing.js';
import { contaminationPurifyRate, CONTAMINATION_PURIFY_THRESHOLD } from './modes/contamination.js';
import { chaseShelterReached } from './modes/chase.js';
import { shrinkRingCleared } from './modes/shrink.js';
import { midClashCleared } from './modes/midClash.js';
import { midClashGateActive } from './waves.js';

/**
 * 현재 구간을 넘기는 조건의 종류. HUD 가 어떤 문구로 상세를 적을지 고르는 데만 쓴다
 * (`waves.ts` 의 분기와 1:1 대응).
 */
export type BossGate =
  /** 처치 할당(기본, ADR-0011). */
  | 'kills'
  /** 중반 격전 리더 처치(ADR-0032). */
  | 'clash'
  /** 강제 스크롤 주파 거리(블록격파·레이싱). */
  | 'distance'
  /** 오염 정화율. */
  | 'purify'
  /** 추격 대피소 도달. */
  | 'shelter'
  /** 수축 안전권 소탕. */
  | 'ring';

export interface BossProgress {
  /** 현재 구간 번호(1-based, 보스 전 일반 구간 기준). 보스 진입 후에는 `totalSegments`. */
  segment: number;
  /** 보스 전 일반 구간 총 수(튜토리얼 단축판 `maxSegments` 반영). */
  totalSegments: number;
  /** 현재 구간 안에서의 진행도(0..1). 불리언 게이트는 0(미달) 뿐이다. */
  segmentFrac: number;
  /** 보스 등장까지의 전체 진행도(0..1). 보스 진입 시 1. */
  frac: number;
  /** 현재 구간 게이트 종류. */
  gate: BossGate;
  /** 처치 게이트일 때 현재 처치 수(그 외 게이트는 0). */
  current: number;
  /** 처치 게이트일 때 목표 처치 수(그 외 게이트는 0). */
  goal: number;
  /** 보스 세그먼트에 진입했는가(= 보스전 시작). */
  bossActive: boolean;
}

/** 0..1 로 자른다(NaN·음수·초과 방어 — 표시용이라 조용히 클램프한다). */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 보스까지 남은 진행도. 침공 런(설계된 런)이면 `undefined`.
 *
 * 전체 진행도 = `(구간 인덱스 + 구간 내 진행도) / 일반 구간 수`. 즉 게이지는 구간을 넘을 때마다
 * 한 칸씩 확정 전진하고, 구간 안에서는 게이트 종류에 맞는 연속량으로 채워진다.
 */
export function bossProgress(state: WorldState): BossProgress | undefined {
  if (state.config.invasion3 !== undefined) return undefined;

  const w = state.wave;
  // 일반 구간 수 = 보스 슬롯을 뺀 나머지. 튜토리얼 단축판은 그만큼만 소화하고 보스로 점프하므로
  // (waves.ts `maxSegments`) 분모도 같이 줄여야 게이지가 100% 에서 보스를 만난다.
  const full = Math.max(1, SEGMENTS.length - 1);
  const cap = state.config.maxSegments;
  const totalSegments = cap !== undefined && cap > 0 ? Math.min(cap, full) : full;

  const seg = SEGMENTS[w.segmentIndex];
  if (w.boss || w.done || seg === undefined || seg.boss) {
    return {
      segment: totalSegments,
      totalSegments,
      segmentFrac: 1,
      frac: 1,
      gate: 'kills',
      current: 0,
      goal: 0,
      bossActive: true,
    };
  }

  // 아래 분기 순서는 `updateWaves` 의 전진 게이트 순서와 **동일해야 한다** — 격전이 모드 게이트보다
  // 먼저 오고, 격전은 강제 스크롤 모드에서 제외된다(그쪽 주석 참조).
  const sw = state.scrollRuntime;
  const mode = state.config.planetMode;
  let gate: BossGate = 'kills';
  let segmentFrac = 0;
  let current = 0;
  let goal = 0;

  // 술어 정본은 `midClashGateActive` 하나다(그 주석 참조). 여기 조건을 다시 적으면
  // 의뢰 런에서 HUD 만 "지휘관을 격파하세요"를 띄우고 sim 은 모드 게이트로 도는 상태가 된다 —
  // 실제로 그렇게 갈라져 있었다.
  if (midClashGateActive(state)) {
    gate = 'clash';
    segmentFrac = midClashCleared(state, w) ? 1 : 0;
  } else if (sw !== undefined && mode === PLANET_MODE.blockBreak) {
    gate = 'distance';
    segmentFrac = clamp01(
      blockBreakProgress(sw) / BLOCKBREAK_SECTION_LENGTH - w.segmentIndex,
    );
  } else if (sw !== undefined && mode === PLANET_MODE.racing) {
    gate = 'distance';
    segmentFrac = clamp01(racingProgress(sw) / RACING_SECTION_LENGTH - w.segmentIndex);
  } else if (mode === PLANET_MODE.contamination) {
    gate = 'purify';
    // 구간 i 통과 = 정화율 ≥ 임계 × (i+1)/일반구간수. 구간 내 진행도는 이전 마일스톤 대비 비율이다.
    const normalSegments = Math.max(1, SEGMENTS.length - 1);
    const step = CONTAMINATION_PURIFY_THRESHOLD / normalSegments;
    segmentFrac = clamp01(contaminationPurifyRate(state) / step - w.segmentIndex);
  } else if (mode === PLANET_MODE.chase) {
    gate = 'shelter';
    segmentFrac = chaseShelterReached(state, w.segmentIndex) ? 1 : 0;
  } else if (mode === PLANET_MODE.shrink) {
    gate = 'ring';
    segmentFrac = shrinkRingCleared(state) ? 1 : 0;
  } else {
    gate = 'kills';
    goal = w.segmentKillGoal;
    current = Math.min(Math.max(0, state.kills - w.segmentBaseKills), goal);
    segmentFrac = goal > 0 ? clamp01(current / goal) : 0;
  }

  const frac = clamp01((w.segmentIndex + segmentFrac) / totalSegments);
  return {
    segment: Math.min(w.segmentIndex + 1, totalSegments),
    totalSegments,
    segmentFrac,
    frac,
    gate,
    current,
    goal,
    bossActive: false,
  };
}
