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
 *  120 ─ 460ms  **아이콘이 튀어나온다** — 0.6 배에서 살짝 넘겨 1.0 으로.
 *  300 ─ 620ms  지급물 줄이 14px 올라오며 나타난다.
 *  300 ─ 1100ms 연속 접속 게이지가 0 에서 오늘 값까지 찬다.
 *
 * 겹치는 구간이 있는 것이 의도다. 순차로 두면 1.1초가 세 개의 짧은 정지로 쪼개져 길게 느껴진다.
 *
 * ## ⚠️ 금빛 연출(봉인·쓸림)은 걷어냈다 (사용자 지시 2026-08-05)
 *
 * 초판은 "오늘 받은 것" 줄을 금빛 판으로 덮었다가 부수고, 판을 가로지르는 금빛 쓸림을 얹었다.
 * 사용자가 둘 다 걷어내라고 했고 그 자리를 **아이콘**이 대신한다 — 무엇을 받았는지가 글자보다
 * 먼저 읽히는 편이 통지의 목적에 맞는다.
 *
 * 그래서 `sealAlpha`·`sealScale`·`sweepT`·`sweepAlpha` 네 필드를 **지웠다.** 남겨 두고 0 을
 * 넣는 안은 기각했다 — 아무도 안 읽는 필드가 타임라인에 남으면 다음 사람이 그것을 되살릴
 * 자리로 오해하고, "순수 타임라인"이라는 이 파일의 값어치가 거기서부터 썩는다.
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

/**
 * 아이콘이 튀어나오기 시작하는 배율.
 *
 * ⚠️ **이것은 연출 배율이지 표시 배율이 아니다.** 아이콘 원본은 64×64 이고 화면 표시 크기는
 * `dailyRewardModal.ts` 의 `ICON_SIZE`(원본보다 작다)가 정한다. 여기 값은 그 표시 크기에
 * 곱해지는 0..1 계수이므로, 정착(1.0)에서도 원본 해상도를 넘겨 확대하는 일이 없다 —
 * 과확대가 "구려 보인다"의 절반이었던 전례를 이 분리로 막는다.
 */
export const ICON_POP_SCALE = 0.6;

/** 한 프레임의 연출 값 전부. 렌더는 이 객체를 Pixi 노드에 옮기기만 한다. */
export interface RevealFrame {
  /** 팝업 전체 배율. 정착 1. */
  readonly panelScale: number;
  /** 팝업 전체 불투명도. 정착 1. */
  readonly panelAlpha: number;
  /**
   * 아이콘 배율 **계수**(표시 크기에 곱한다). 정착 **1** — 즉 원본을 넘겨 확대하지 않는다.
   * 중간에 1 을 살짝 넘겨 튀어나오는 느낌을 만들지만 그 최대가 원본 해상도 안에 있도록
   * 표시 크기를 잡는 것은 호출부의 몫이다({@link ICON_POP_SCALE} 주석).
   */
  readonly iconScale: number;
  /** 아이콘 불투명도. 정착 1. */
  readonly iconAlpha: number;
  /** 지급물 줄의 불투명도. 정착 1. */
  readonly subjectAlpha: number;
  /** 지급물 줄이 아직 내려가 있는 거리(px, **정수**). 정착 0. */
  readonly subjectRise: number;
  /** 게이지 채움 진행 0..1. 호출자가 목표 채움률에 곱한다. 정착 1. */
  readonly barProgress: number;
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
  iconScale: 1,
  iconAlpha: 1,
  subjectAlpha: 1,
  subjectRise: 0,
  barProgress: 1,
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
  const icon = span(t, 120, 460);
  const subject = span(t, 300, 620);
  const bar = span(t, 300, REVEAL_TOTAL_MS);

  return {
    panelScale: PANEL_OPEN_SCALE + (1 - PANEL_OPEN_SCALE) * easeOutBack(open),
    panelAlpha: easeOut(span(t, 0, 140)),
    // 아이콘은 **튀어나온다** — 살짝 넘겼다 1.0 으로 돌아온다. 판이 열리는 곡선과 같은
    // easeOutBack 을 쓰는 것이 의도다: 두 움직임이 같은 성질이어야 한 동작으로 읽힌다.
    iconScale: ICON_POP_SCALE + (1 - ICON_POP_SCALE) * easeOutBack(icon),
    iconAlpha: easeOut(span(t, 120, 300)),
    subjectAlpha: easeOut(subject),
    subjectRise: Math.round(SUBJECT_RISE_PX * (1 - easeOut(subject))),
    barProgress: easeOut(bar),
    done: false,
  };
}
