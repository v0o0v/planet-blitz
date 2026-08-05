/**
 * 일일 보상 **개봉 연출** 타임라인 — 순수 (ADR-0048 · 계획 §C10).
 *
 * ## 왜 순수 함수로 뽑았나
 *
 * vitest 는 node 환경이라 `Ticker` 도 캔버스도 없다. 연출을 렌더 코드 안에 두면 *"열자마자
 * 다 보인다"* 나 *"연출이 끝났는데 값이 정착값과 다르다"* 를 **눈으로만** 잡게 되고, 이 리포는
 * 그 자리를 반복해서 밟았다(`layoutDailyRewardModal` 이 같은 이유로 뽑혀 있다). 여기서는
 * 시간 → 프레임 값이 전부 순수 함수라 테스트가 타임라인을 직접 잠근다.
 *
 * ## 이 연출이 지켜야 하는 것 하나
 *
 * **끝난 프레임은 정적 레이아웃과 정확히 같아야 한다.** 다르면 개봉을 본 사람과 칩으로 다시
 * 연 사람이 서로 다른 화면을 보게 되고, 그 차이는 "연출 버그"가 아니라 "레이아웃 버그"로
 * 보고된다. {@link REVEAL_SETTLED} 가 그 정착값이고 {@link revealFrame} 은 `elapsed` 가
 * {@link REVEAL_TOTAL_MS} 이상이면 **그 상수를 그대로** 돌려준다 — 근사값을 계산하지 않는다.
 *
 * ## 화면에 무엇이 일어나는가
 *
 *   0 ─ 180ms   판이 0.88 에서 1.0 으로 열린다(살짝 넘겼다 돌아오는 back-out).
 *  120 ─ 420ms  **봉인**이 부풀며 사라진다 — "오늘 받은 것" 줄을 덮고 있던 금빛 판이다.
 *  300 ─ 620ms  지급물 줄이 14px 올라오며 나타난다.
 *  300 ─ 1100ms 연속 접속 게이지가 0 에서 오늘 값까지 찬다.
 *  380 ─ 760ms  금빛 쓸림이 판을 가로지른다.
 *
 * 겹치는 구간이 있는 것이 의도다. 순차로 두면 1.1초가 네 개의 짧은 정지로 쪼개져 길게 느껴진다.
 *
 * ## 규율
 *  - `Date.now`·`Math.random` 을 쓰지 않는다. 경과 시간은 **호출자가 준다**(`Ticker` 가 소유).
 *  - `subjectRise` 는 **정수**다. 반픽셀 부유가 글자 테두리 번쩍임을 만든다(리포 실측).
 *  - 모든 값이 유한하고 정의역 안이다 — 손상된 `elapsed`(NaN·음수·Infinity)도 접는다.
 */

/** 연출 전체 길이(ms). 이 값을 넘긴 `elapsed` 는 전부 {@link REVEAL_SETTLED} 다. */
export const REVEAL_TOTAL_MS = 1100;

/** 지급물 줄이 올라오는 거리(px). 정수여야 한다 — 아래 `Math.round` 가 그것을 강제한다. */
export const SUBJECT_RISE_PX = 14;

/** 판이 열리기 시작하는 배율. 1 에 너무 가까우면 열린다는 느낌이 안 나고, 낮으면 튄다. */
export const PANEL_OPEN_SCALE = 0.88;

/** 한 프레임의 연출 값 전부. 렌더는 이 객체를 Pixi 노드에 옮기기만 한다. */
export interface RevealFrame {
  /** 팝업 전체 배율. 정착 1. */
  readonly panelScale: number;
  /** 팝업 전체 불투명도. 정착 1. */
  readonly panelAlpha: number;
  /** 봉인 판의 불투명도. 정착 **0**(사라진다). */
  readonly sealAlpha: number;
  /** 봉인 판의 배율(부풀며 사라진다). 정착 값은 의미가 없다(투명하므로). */
  readonly sealScale: number;
  /** 지급물 줄의 불투명도. 정착 1. */
  readonly subjectAlpha: number;
  /** 지급물 줄이 아직 내려가 있는 거리(px, **정수**). 정착 0. */
  readonly subjectRise: number;
  /** 게이지 채움 진행 0..1. 호출자가 목표 채움률에 곱한다. 정착 1. */
  readonly barProgress: number;
  /** 쓸림의 가로 위치 −1..1(팝업 폭 기준 정규화). */
  readonly sweepT: number;
  /** 쓸림의 불투명도. 정착 **0**. */
  readonly sweepAlpha: number;
  /** 연출이 끝났는가(호출자가 `Ticker` 구독을 끊는 신호). */
  readonly done: boolean;
}

/**
 * 연출이 끝난 뒤의 값 — **정적 레이아웃과 같은 화면**이다.
 *
 * 이 상수가 계약이다. 렌더가 연출 없이 그릴 때도 이 값을 쓰므로, 여기가 1 이 아닌 값을 갖는
 * 순간 칩으로 다시 연 화면이 개봉 직후 화면과 달라진다.
 */
export const REVEAL_SETTLED: RevealFrame = {
  panelScale: 1,
  panelAlpha: 1,
  sealAlpha: 0,
  sealScale: 1,
  subjectAlpha: 1,
  subjectRise: 0,
  barProgress: 1,
  sweepT: 1,
  sweepAlpha: 0,
  done: true,
};

/** [0,1] 로 접는다. NaN·Infinity 는 0 으로 — 손상값이 화면을 뒤집지 않게. */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

/** `[from, to]` 구간에서의 진행도 0..1. `to <= from` 이면 즉시 1(0 나눗셈 방지). */
function span(elapsed: number, from: number, to: number): number {
  if (to <= from) return elapsed >= from ? 1 : 0;
  return clamp01((elapsed - from) / (to - from));
}

/** 감속(3제곱). 시작이 빠르고 끝이 부드럽다 — UI 연출의 기본 곡선. */
function easeOut(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

/**
 * 살짝 넘겼다 돌아오는 감속. 판이 "열린다"는 느낌은 이 넘침에서 온다.
 * 계수 1.6 은 넘침이 약 6% 가 되게 하는 값이다 — 더 키우면 팝업이 튀어 보인다.
 */
function easeOutBack(t: number): number {
  const u = clamp01(t) - 1;
  const c = 1.6;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

/**
 * 경과 시간 → 프레임 값. **순수**.
 *
 * @param elapsedMs 연출 시작 이후 경과(ms). 음수·NaN 은 0 으로 접고, {@link REVEAL_TOTAL_MS}
 *                  이상이면 {@link REVEAL_SETTLED} 를 **그대로** 돌려준다(근사하지 않는다).
 */
export function revealFrame(elapsedMs: number): RevealFrame {
  // ⚠️ **손상값(NaN·±Infinity)은 "끝난 것"으로 접는다.** 0 으로 접으면 `deltaMS` 가 한 번
  //    NaN 이 되는 순간 누적값이 영영 NaN 이라 연출이 **끝나지 않는다** — 구독이 안 끊겨 매
  //    프레임 다시 그리고, 그동안 지급물은 계속 감춰져 있다. 통지가 사라지는 것이 이 기능에서
  //    가장 나쁜 결말이므로 방향은 "다 보여 주고 끝난다" 쪽이어야 한다.
  if (!Number.isFinite(elapsedMs)) return REVEAL_SETTLED;
  // 음수는 "아직 시작 전" 이라는 정상 상태다(시작 프레임으로 접는다).
  const t = elapsedMs > 0 ? elapsedMs : 0;
  if (t >= REVEAL_TOTAL_MS) return REVEAL_SETTLED;

  const open = span(t, 0, 180);
  const seal = span(t, 120, 420);
  const subject = span(t, 300, 620);
  const bar = span(t, 300, REVEAL_TOTAL_MS);
  const sweep = span(t, 380, 760);

  return {
    panelScale: PANEL_OPEN_SCALE + (1 - PANEL_OPEN_SCALE) * easeOutBack(open),
    panelAlpha: easeOut(span(t, 0, 140)),
    // 봉인은 **깨지는 것**이지 서서히 옅어지는 것이 아니다 — 뒤로 갈수록 빨리 사라지도록
    // 제곱을 걸어 초반에 오래 남긴다.
    sealAlpha: 1 - seal * seal,
    sealScale: 1 + 0.6 * easeOut(seal),
    subjectAlpha: easeOut(subject),
    subjectRise: Math.round(SUBJECT_RISE_PX * (1 - easeOut(subject))),
    barProgress: easeOut(bar),
    sweepT: -1 + 2 * sweep,
    // 쓸림은 가운데서 가장 밝다. 양 끝에서 0 이라 들어오고 나가는 것이 안 보인다.
    sweepAlpha: 0.55 * Math.sin(Math.PI * sweep),
    done: false,
  };
}
