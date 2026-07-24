/**
 * 품질 티어 런타임 구동부 (Phase 0 — plan §AC-0.4; ADR-0031).
 *
 * 순수함수 {@link selectTier}(qualityTier.ts)를 **런타임 상태·벽시계 타이밍**으로 감싼다.
 * selectTier 는 "현재 티어 + FPS 평균 + 오버라이드 → 다음 티어"의 이력현상·단조 규칙만 알고,
 * "FPS 를 얼마 동안 평균 내는가 / 얼마 간격으로 판정하는가"는 모른다. 그 타이밍이 이 클래스의 책임.
 *
 * ── 왜 감싸는가 ── FpsMeter 는 0.5초 창의 순간 평활 FPS 만 준다. 그걸 매 프레임 그대로 selectTier
 * 에 넣으면 짧은 스톨 한 번에도 티어가 출렁인다. 그래서 ①최근 ~2초 시간가중 평균으로 한 번 더
 * 눌러 잡고 ②~0.5초 간격으로만 판정해 강등/승격을 재촉하지 않는다. 진동 방지의 나머지 절반(임계
 * 사이 이력 대역)은 selectTier 가 이미 담당한다.
 *
 * ── 결정론(ADR-0005) ── render 전용. 입력(fpsSmoothed·deltaSeconds·override)만으로 상태 전이가
 * 정해지며 Date/random 미사용 — 같은 입력 시퀀스는 같은 티어 시퀀스를 낸다(테스트 재현 가능).
 * sim·hashWorld/hashEntity 무접촉이고 `src/sim/` 를 절대 import 하지 않는다. 활성 티어의 실제
 * 이펙트 소비는 후속 Phase 몫 — Phase 0 은 감시·선택 배선까지다.
 *
 * ── 밸런스 유예(defer-balance-tuning) ── 창 길이·판정 간격·초기 티어는 전부 placeholder 다.
 * FPS 임계(qualityTier.ts TIER_*_FPS)와 함께 출시 직전 하네스 벤치(AC-6.4)에서 일괄 튜닝한다.
 */

import { selectTier, type QualityTier } from './qualityTier.js';
import type { Quality } from './graphicsSettings.js';

/**
 * FPS 평균 창 길이(초). 이 시간만큼의 최근 표본을 시간가중 평균한다. placeholder, defer-balance-tuning.
 * 순간 스파이크·짧은 스톨을 흡수할 만큼 길고, 실제 성능 저하에 반응할 만큼 짧은 잠정값.
 */
export const TIER_FPS_WINDOW_SECONDS = 2;

/**
 * 티어 판정 간격(초). auto 모드에서 이 간격마다 한 번씩만 selectTier 를 돌려 활성 티어를 갱신한다
 * (매 프레임 판정하면 단조 1단계 규칙이 프레임 속도로 소진돼 급강등). placeholder, defer-balance-tuning.
 */
export const TIER_EVAL_INTERVAL_SECONDS = 0.5;

/**
 * 초기 활성 티어. 낙관적 상한('high')에서 출발해 성능이 못 받쳐주면 자동 강등이 끌어내린다.
 * 수동 오버라이드가 설정돼 있으면 첫 tick 즉시 그 값으로 잠긴다. placeholder, defer-balance-tuning.
 */
export const INITIAL_TIER: QualityTier = 'high';

/** 시간가중 평균용 FPS 표본 1개(그 프레임의 평활 FPS 와 프레임 델타). */
interface FpsSample {
  fps: number;
  dt: number;
}

/**
 * 품질 티어 런타임 컨트롤러. selectTier(순수)를 롤링 FPS 창 + 판정 타이머로 감싼다.
 *
 * 순수 판정 로직은 여기서 절대 재구현하지 않는다 — selectTier 를 호출만 한다. 이 클래스가 더하는
 * 것은 오직 (1) ~2초 시간가중 FPS 평균, (2) ~0.5초 판정 페이싱, (3) 활성 티어 상태 보유뿐이다.
 */
export class GraphicsTierController {
  /** 현재 활성 실 티어(선택 결과 상태). */
  private activeTier: QualityTier;
  /** ~2초 롤링 창 표본 큐(가장 오래된 것이 앞). */
  private samples: FpsSample[] = [];
  /** 창 내 표본들의 dt 합(가중 평균 분모). 매 push/evict 로 갱신. */
  private sumDt = 0;
  /** 창 내 표본들의 fps·dt 곱 합(가중 평균 분자). */
  private sumWeighted = 0;
  /** 마지막 판정 이후 누적된 시간(초). 판정 간격 게이트. */
  private evalAccumulator = 0;

  constructor(initialTier: QualityTier = INITIAL_TIER) {
    this.activeTier = initialTier;
  }

  /**
   * 한 프레임 진행. FPS 표본을 롤링 창에 넣고, 판정 시점이면 selectTier 로 활성 티어를 갱신한다.
   *
   * - `manualOverride` 가 구체 티어면 **간격을 기다리지 않고 즉시** 판정해 그 값으로 잠근다(사용자의
   *   명시적 선택은 discrete 이벤트 — 지연시킬 이유가 없다). selectTier 가 오버라이드 잠금을 보장.
   * - 'auto' 면 {@link TIER_EVAL_INTERVAL_SECONDS} 간격마다 한 번씩만 판정(강등/승격 재촉 방지).
   *
   * @param fpsSmoothed 이 프레임의 평활 FPS(FpsMeter.tick 결과, 0.5초 창).
   * @param deltaSeconds 프레임 델타(초). 창 시간가중·판정 타이머의 시간축.
   * @param manualOverride 그래픽 설정의 quality('auto' 면 자동, 구체 티어면 수동 잠금).
   * @returns 갱신된 활성 티어.
   */
  tick(fpsSmoothed: number, deltaSeconds: number, manualOverride: Quality): QualityTier {
    this.pushSample(fpsSmoothed, deltaSeconds);
    this.evalAccumulator += deltaSeconds;

    const manual = manualOverride !== 'auto';
    if (manual || this.evalAccumulator >= TIER_EVAL_INTERVAL_SECONDS) {
      this.evalAccumulator = 0;
      // 순수 판정 위임 — 이력현상·단조 1단계·오버라이드 잠금·NaN 방어는 전부 selectTier 소관.
      this.activeTier = selectTier(this.activeTier, this.windowFps(), manualOverride);
    }
    return this.activeTier;
  }

  /** 현재 활성 티어(판정 없이 상태 조회). 후속 Phase 의 이펙트 게이트 소비자가 읽는다. */
  getActiveTier(): QualityTier {
    return this.activeTier;
  }

  /** 현재 롤링 창 시간가중 FPS 평균(관측·테스트용). 표본이 없으면 0. */
  getWindowFps(): number {
    return this.windowFps();
  }

  /** 표본을 창에 추가하고, 창 길이를 넘긴 오래된 표본을 앞에서 밀어낸다(최신 1개는 항상 보존). */
  private pushSample(fps: number, dt: number): void {
    // 비유한/음수 dt 는 시간축을 오염시키므로 무시(방어). fps 비유한값은 selectTier 가 방어하지만
    // 창 평균이 NaN 이 되지 않도록 여기서도 걸러 유한 표본만 누적한다.
    if (!Number.isFinite(fps) || !Number.isFinite(dt) || dt <= 0) return;
    this.samples.push({ fps, dt });
    this.sumDt += dt;
    this.sumWeighted += fps * dt;
    // 창 길이 초과분 방출 — 단, 최신 표본 1개는 항상 남긴다(빈 창 방지).
    while (this.sumDt > TIER_FPS_WINDOW_SECONDS && this.samples.length > 1) {
      const old = this.samples.shift();
      if (old === undefined) break;
      this.sumDt -= old.dt;
      this.sumWeighted -= old.fps * old.dt;
    }
  }

  /** 창 시간가중 평균(분모 0 방어). */
  private windowFps(): number {
    return this.sumDt > 0 ? this.sumWeighted / this.sumDt : 0;
  }
}

/**
 * 공유 티어 컨트롤러 싱글턴. main 의 메인 루프가 매 프레임 tick 하고, 후속 Phase 게이트 소비자가
 * getActiveTier 로 읽는다(graphicsSettings 싱글턴과 동형의 공유 패턴).
 */
export const graphicsTierController = new GraphicsTierController();
