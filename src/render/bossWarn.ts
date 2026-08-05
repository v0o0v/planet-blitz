/**
 * 보스 **예고 루프** — 등장 전부터 반복되다가 등장하면 사라지는 접근 경보
 * (사용자 지시 2026-08-05: "보스 등장 전부터 반복적으로 울리다가 보스가 나오면 사라지는 것으로").
 *
 * ## 왜 등장음이 아니라 루프인가
 * 등장음은 **이미 벌어진 일**을 알린다 — 보스가 화면에 뜬 뒤에 울리므로 대비할 시간을 주지
 * 않는다. 반복 루프는 반대다: 남은 시간이 줄어드는 것을 **간격이 좁아지는 것으로** 말하고,
 * 그러다 **끊기는 것 자체가** 등장 신호가 된다(정적은 어떤 소리보다 눈에 띈다).
 *
 * ## 결정론(ADR-0005)
 * 순수 render 레이어다. sim 은 이 모듈을 모르며 상태·해시·리플레이에 닿지 않는다. 진행도는
 * `bossProgress`(읽기 전용 파생)에서 받고, 시각은 `AudioContext.currentTime` 이 아니라 호출부가
 * 넘기는 **프레임 델타 누적**을 쓴다 — 탭이 백그라운드로 가면 rAF 가 1Hz 로 떨어지므로
 * (이 저장소가 두 번 겪은 함정) wall-clock 으로 간격을 재면 복귀 순간 밀린 만큼 몰아서 울린다.
 *
 * ## 침공 런
 * `bossProgress` 가 `undefined` 를 돌려주므로(세그먼트 축 없음) 이 루프는 아예 돌지 않는다.
 */

import type { GameAudio } from './audio.js';

/**
 * 이 진행도부터 예고가 시작된다(0..1, `BossProgress.frac`).
 *
 * 너무 이르면 런의 절반이 경보 속이라 긴장이 무뎌지고, 너무 늦으면 대비할 시간이 없다.
 * 0.75 = 마지막 구간에 들어설 무렵이다. TODO(밸런스): 실플레이 후 조정.
 */
export const BOSS_WARN_START_FRAC = 0.75;
/** 예고 시작 시점의 반복 간격(초). 느리게 시작해 존재만 알린다. TODO(밸런스). */
export const BOSS_WARN_SLOW_SEC = 2.2;
/** 보스 직전(진행도 1)의 반복 간격(초). 이보다 좁히면 소리가 뭉쳐 개별 타격이 안 들린다. TODO(밸런스). */
export const BOSS_WARN_FAST_SEC = 0.45;
/** 예고 시작 시점의 게인 배율(매니페스트 기준 게인에 곱한다). 멀수록 작게. TODO(밸런스). */
export const BOSS_WARN_MIN_GAIN = 0.55;
/** 보스 직전의 게인 배율. TODO(밸런스). */
export const BOSS_WARN_MAX_GAIN = 1;

/** 0..1 로 자른다(NaN·범위 밖 방어). */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 이 진행도에서의 **예고 강도**(0 = 아직 예고 없음, 1 = 보스 직전). 순수 함수라 오디오 없이
 * 검증한다. `BOSS_WARN_START_FRAC` 미만은 정확히 0 이다.
 */
export function bossWarnIntensity(frac: number): number {
  const f = clamp01(frac);
  if (f <= BOSS_WARN_START_FRAC) return 0;
  return clamp01((f - BOSS_WARN_START_FRAC) / (1 - BOSS_WARN_START_FRAC));
}

/**
 * 선형 보간하되 **양 끝은 상수를 그대로** 돌려준다.
 *
 * `a + (b-a)*1` 은 IEEE754 에서 `b` 와 정확히 같지 않다(실측: 2.2 + (0.45-2.2)*1 =
 * 0.44999999999999996). 연출값이라 청각적으로는 무관하지만, 끝점이 상수와 같다는 계약을
 * 테스트가 못 박을 수 있어야 한다 — 그래야 상수를 바꿨을 때 곡선이 따라오는지가 검증된다.
 */
function lerpEnds(a: number, b: number, t: number): number {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return a + (b - a) * t;
}

/** 이 강도에서의 반복 간격(초). 강도 0 은 시작 간격, 1 은 최속 간격. 순수. */
export function bossWarnIntervalSec(intensity: number): number {
  return lerpEnds(BOSS_WARN_SLOW_SEC, BOSS_WARN_FAST_SEC, clamp01(intensity));
}

/** 이 강도에서의 게인 배율. 순수. */
export function bossWarnGain(intensity: number): number {
  return lerpEnds(BOSS_WARN_MIN_GAIN, BOSS_WARN_MAX_GAIN, clamp01(intensity));
}

/**
 * 예고 루프를 침묵시켜야 하는가 — **호출 조건 자체를 순수 함수로 뽑은 것**이다.
 *
 * ⚠️ 이걸 왜 함수로 뽑았나(사용자 신고 2026-08-05 "행성런이 끝나고 보스 사운드가 계속 난다"):
 * 호출부(`main.ts`)의 사운드 관측 블록은 `if (w !== null)` 하나만 두르고 있고, `world` 는
 * teardown 에서야 null 이 된다. 그래서 **런이 끝나고 결과 화면에 있는 동안에도 이 블록이 계속
 * 돈다**. 보스를 잡으면 `bossProgress` 가 `frac: 1`(`w.done`)을 계속 돌려주는데 보스 엔티티는
 * 사라져 `bossEngaged` 가 거짓이 되므로, 루프가 **최고 속도(0.45초)로 영원히** 울었다.
 *
 * 조건을 호출부에 인라인으로 두면 렌더 프레임에서만 만들어지는 상태라 테스트가 못 잡는다
 * (이 리포가 반복해서 밟은 자리다 — `tests/bossWarn.test.ts` 헤더 참조). 순수 함수로 두고
 * 진리표를 고정한다.
 */
export function bossWarnSuppressed(o: {
  /** 런이 끝났는가(`gameOver || victory`). 정산·결과 화면이 이 상태로 머문다. */
  readonly runOver: boolean;
  /** 지금 런 화면인가. 기지·성계 지도 등으로 나갔으면 거짓. */
  readonly onRunScreen: boolean;
  /** 리플레이 관전 중인가(SFX 통째 억제). */
  readonly spectating: boolean;
}): boolean {
  return o.runOver || !o.onRunScreen || o.spectating;
}

/**
 * 예고 루프 구동기. 매 렌더 프레임 {@link tick} 을 부른다.
 *
 * `bossEngaged` 가 참이 되는 순간 루프는 **즉시 멈춘다** — 그 정적이 곧 등장 신호이고, 등장음
 * (`play('boss')`)은 `RunSoundObserver` 가 같은 프레임에 따로 울린다. 두 신호가 겹치지 않게
 * 여기서는 등장음을 내지 않는다(책임 분리 — 이 모듈은 **예고만** 한다).
 */
export class BossWarnLoop {
  /** 다음 발음까지 남은 시간(초). 음수면 이번 프레임에 운다. */
  private countdown = 0;
  /** 직전 프레임에 예고가 돌고 있었는가(재진입 시 카운트다운 리셋 판정용). */
  private active = false;

  constructor(private readonly audio: GameAudio) {}

  /** 새 런 시작·화면 전환 시 호출 — 다음 런 첫 프레임에 몰아 울지 않게 기준선을 버린다. */
  reset(): void {
    this.countdown = 0;
    this.active = false;
  }

  /**
   * 한 프레임.
   *
   * @param frac      보스까지의 진행도(0..1). `bossProgress` 가 없으면(침공) 호출부가 이 함수를
   *                  부르지 않거나 `undefined` 를 넘긴다 — 어느 쪽이든 루프는 쉰다.
   * @param bossEngaged 보스전이 열렸는가. 참이면 즉시 침묵한다.
   * @param dt        프레임 델타(초). wall-clock 이 아니라 이 값을 누적한다(모듈 주석 §결정론).
   * @param suppress  관전 등으로 SFX 를 통째로 억제해야 하는가.
   */
  tick(frac: number | undefined, bossEngaged: boolean, dt: number, suppress = false): void {
    if (frac === undefined || bossEngaged || suppress) {
      this.active = false;
      this.countdown = 0;
      return;
    }
    const intensity = bossWarnIntensity(frac);
    if (intensity <= 0) {
      this.active = false;
      this.countdown = 0;
      return;
    }
    // 실음원이 없으면(파일 미배치·ogg 미지원) 아예 돌지 않는다. 예고는 **반복**이라, 합성음으로
    // 대체하면 같은 소리가 초당 두 번씩 울리는 가장 거슬리는 형태가 된다 — 없느니만 못하다.
    if (!this.audio.hasSample('bossWarn')) return;

    // 진입 프레임은 바로 한 번 울린다(첫 경보가 늦으면 "언제부터인지" 가 안 잡힌다).
    if (!this.active) {
      this.active = true;
      this.countdown = 0;
    }
    this.countdown -= Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (this.countdown > 0) return;
    this.audio.playSample('bossWarn', { gainScale: bossWarnGain(intensity) });
    this.countdown = bossWarnIntervalSec(intensity);
  }
}
