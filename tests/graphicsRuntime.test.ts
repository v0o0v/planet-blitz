/**
 * 품질 티어 런타임 구동부 검증 (src/render/graphicsRuntime — Phase 0 · AC-0.4).
 *
 * GraphicsTierController 는 순수 selectTier 를 롤링 FPS 창 + 판정 페이싱으로 감싼다. 여기서는 그
 * **런타임 거동**을 검증한다: 저 FPS 지속 → 단조 강등, 고 FPS → 회복 승격, 이력 대역 진동 없음,
 * 수동 오버라이드 즉시 잠금, 판정 간격 페이싱, ~2초 창의 순간 스톨 흡수(강등 지연), 비유한 표본 방어.
 *
 * 결정론: 공급 FPS/dt 시퀀스만으로 티어 시퀀스가 정해진다(Date/random 미사용). 임계는 qualityTier
 * 의 TIER_*_FPS 를 참조해 밸런스 튜닝(수치 변경)에도 테스트가 깨지지 않게 한다.
 */

import { describe, it, expect } from 'vitest';
import {
  GraphicsTierController,
  graphicsTierController,
  TIER_EVAL_INTERVAL_SECONDS,
  TIER_FPS_WINDOW_SECONDS,
  INITIAL_TIER,
} from '../src/render/graphicsRuntime.js';
import { TIER_DOWNGRADE_FPS, TIER_UPGRADE_FPS } from '../src/render/qualityTier.js';
import type { Quality } from '../src/render/graphicsSettings.js';

/** 강등을 확실히 유발하는 저 FPS. */
const LOW_FPS = TIER_DOWNGRADE_FPS - 10;
/** 승격을 확실히 유발하는 고 FPS. */
const HIGH_FPS = TIER_UPGRADE_FPS + 10;
/** 이력 대역 한가운데(무변화). */
const MID_FPS = (TIER_DOWNGRADE_FPS + TIER_UPGRADE_FPS) / 2;
/** 판정이 확실히 일어나도록 간격 이상으로 잡은 프레임 델타. */
const STEP_DT = TIER_EVAL_INTERVAL_SECONDS;

/** 컨트롤러를 같은 (fps,dt,override)로 count 프레임 구동하고 마지막 티어를 반환한다. */
function drive(
  ctrl: GraphicsTierController,
  fps: number,
  dt: number,
  count: number,
  override: Quality = 'auto',
): void {
  for (let i = 0; i < count; i++) ctrl.tick(fps, dt, override);
}

describe('GraphicsTierController — 초기 상태', () => {
  it('tick 전 활성 티어는 INITIAL_TIER', () => {
    expect(new GraphicsTierController().getActiveTier()).toBe(INITIAL_TIER);
    expect(INITIAL_TIER).toBe('high');
  });

  it('생성자 인자로 초기 티어를 지정할 수 있다', () => {
    expect(new GraphicsTierController('low').getActiveTier()).toBe('low');
  });

  it('표본 없으면 창 평균은 0', () => {
    expect(new GraphicsTierController().getWindowFps()).toBe(0);
  });
});

describe('GraphicsTierController — 자동 강등(저 FPS 지속)', () => {
  it('저 FPS 를 계속 먹이면 high → med → low 로 단조 강등', () => {
    const ctrl = new GraphicsTierController('high');
    // 1회 판정 = 1단계. 창 평균이 이미 저 FPS 이므로 매 간격 강등.
    expect(ctrl.tick(LOW_FPS, STEP_DT, 'auto')).toBe('med');
    expect(ctrl.tick(LOW_FPS, STEP_DT, 'auto')).toBe('low');
  });

  it('low 이하로는 더 내려가지 않는다', () => {
    const ctrl = new GraphicsTierController('high');
    drive(ctrl, LOW_FPS, STEP_DT, 10);
    expect(ctrl.getActiveTier()).toBe('low');
  });

  it('아무리 낮아도 한 판정에 1단계씩(high 에서 한 번에 low 로 건너뛰지 않음)', () => {
    const ctrl = new GraphicsTierController('high');
    // 극저 FPS(유효 표본 1 — 0 은 워밍업으로 배제되므로 1 을 쓴다)라도 한 판정엔 1단계만.
    expect(ctrl.tick(1, STEP_DT, 'auto')).toBe('med'); // low 아님
  });
});

describe('GraphicsTierController — 자동 승격(고 FPS 회복)', () => {
  it('고 FPS 를 계속 먹이면 low → med → high 로 단조 승격', () => {
    const ctrl = new GraphicsTierController('low');
    expect(ctrl.tick(HIGH_FPS, STEP_DT, 'auto')).toBe('med');
    expect(ctrl.tick(HIGH_FPS, STEP_DT, 'auto')).toBe('high');
  });

  it('강등 후 고 FPS 회복이 티어를 되돌린다(왕복 사이클)', () => {
    const ctrl = new GraphicsTierController('high');
    drive(ctrl, LOW_FPS, STEP_DT, 5); // → low 로 가라앉음
    expect(ctrl.getActiveTier()).toBe('low');
    drive(ctrl, HIGH_FPS, STEP_DT, 5); // → high 로 복귀
    expect(ctrl.getActiveTier()).toBe('high');
  });
});

describe('GraphicsTierController — 이력현상(진동 방지)', () => {
  it('이력 대역 FPS 를 계속 먹여도 티어가 진동하지 않는다', () => {
    const ctrl = new GraphicsTierController('med');
    // 창이 여러 번 회전할 만큼 길게 구동해도 med 유지(위로도 아래로도 안 움직임).
    for (let i = 0; i < 20; i++) {
      expect(ctrl.tick(MID_FPS, STEP_DT, 'auto')).toBe('med');
    }
  });

  it('이력 대역으로만 회복하면(승격 임계 미달) 하위 티어에서 위로 안 올라간다', () => {
    // low 에서 창을 순수 MID(대역 안)로 채운다 → 승격 임계 초과가 아니므로 low 유지.
    const ctrl = new GraphicsTierController('low');
    drive(ctrl, MID_FPS, STEP_DT, 20);
    expect(ctrl.getActiveTier()).toBe('low');
  });

  it('이력 대역 FPS 는(강등 임계 초과) 상위 티어를 끌어내리지 않는다', () => {
    // high 에서 창을 순수 MID 로 채운다 → 강등 임계 미만이 아니므로 high 유지.
    const ctrl = new GraphicsTierController('high');
    drive(ctrl, MID_FPS, STEP_DT, 20);
    expect(ctrl.getActiveTier()).toBe('high');
  });
});

describe('GraphicsTierController — 수동 오버라이드 잠금', () => {
  it('구체 티어 오버라이드는 첫 tick 즉시(간격 대기 없이) 잠긴다', () => {
    const ctrl = new GraphicsTierController('high');
    // dt 가 판정 간격보다 훨씬 작아도 수동 선택은 즉시 반영.
    expect(ctrl.tick(HIGH_FPS, 0.001, 'low')).toBe('low');
  });

  it('오버라이드 중에는 FPS 를 무시하고 그 값 유지', () => {
    const ctrl = new GraphicsTierController('high');
    drive(ctrl, LOW_FPS, STEP_DT, 10, 'high'); // 저 FPS 인데도
    expect(ctrl.getActiveTier()).toBe('high'); // high 로 잠김
  });

  it('오버라이드 해제(auto 복귀) 후 다시 FPS 자동 적응', () => {
    const ctrl = new GraphicsTierController('high');
    drive(ctrl, LOW_FPS, STEP_DT, 3, 'high'); // high 잠금 유지
    expect(ctrl.getActiveTier()).toBe('high');
    drive(ctrl, LOW_FPS, STEP_DT, 3, 'auto'); // auto 로 풀리면 강등 시작
    expect(ctrl.getActiveTier()).toBe('low');
  });
});

describe('GraphicsTierController — 판정 간격 페이싱', () => {
  it('간격 미만으로 누적된 시간에서는 auto 판정을 하지 않는다', () => {
    const ctrl = new GraphicsTierController('high');
    const smallDt = TIER_EVAL_INTERVAL_SECONDS / 5; // 판정 간격의 1/5
    // 4프레임(간격의 4/5)까지는 판정 없음 → high 유지.
    for (let i = 0; i < 4; i++) {
      expect(ctrl.tick(LOW_FPS, smallDt, 'auto')).toBe('high');
    }
    // 5프레임째(간격 도달) 판정 발생 → 강등.
    expect(ctrl.tick(LOW_FPS, smallDt, 'auto')).toBe('med');
  });
});

describe('GraphicsTierController — 롤링 창 스톨 흡수', () => {
  it('창을 고 FPS 로 채운 뒤 저 FPS 급락 시 첫 프레임엔 강등하지 않는다(창이 눌러 잡음)', () => {
    const ctrl = new GraphicsTierController('high');
    // ~2초 창을 고 FPS 로 채운다(창 길이 이상 구동).
    const primeFrames = Math.ceil(TIER_FPS_WINDOW_SECONDS / STEP_DT) + 2;
    drive(ctrl, HIGH_FPS, STEP_DT, primeFrames);
    expect(ctrl.getActiveTier()).toBe('high');

    // 저 FPS 로 급락한 첫 프레임: 창 평균은 아직 대부분 고 FPS → 강등 안 함.
    expect(ctrl.tick(LOW_FPS, STEP_DT, 'auto')).toBe('high');

    // 계속 저 FPS 면 창이 교체되며 결국 강등하고, 지속되면 바닥(low)까지 안착한다.
    const settleFrames = Math.ceil(TIER_FPS_WINDOW_SECONDS / STEP_DT) + 4;
    drive(ctrl, LOW_FPS, STEP_DT, settleFrames);
    expect(ctrl.getActiveTier()).toBe('low');
  });
});

describe('GraphicsTierController — 비유한 표본 방어', () => {
  it('NaN/∞ FPS 표본은 창 평균을 오염시키지 않는다', () => {
    const ctrl = new GraphicsTierController('high');
    drive(ctrl, HIGH_FPS, STEP_DT, 3); // 유한 표본으로 창 채움
    ctrl.tick(Number.NaN, STEP_DT, 'auto');
    ctrl.tick(Number.POSITIVE_INFINITY, STEP_DT, 'auto');
    const avg = ctrl.getWindowFps();
    expect(Number.isFinite(avg)).toBe(true);
    expect(avg).toBeCloseTo(HIGH_FPS, 5);
  });

  it('dt<=0/비유한 표본은 무시된다(창 시간축 보호)', () => {
    const ctrl = new GraphicsTierController('high');
    ctrl.tick(HIGH_FPS, 0, 'auto'); // dt=0 무시
    ctrl.tick(HIGH_FPS, -1, 'auto'); // 음수 dt 무시
    expect(ctrl.getWindowFps()).toBe(0); // 유효 표본 0
  });
});

describe('GraphicsTierController — FpsMeter 워밍업 0 FPS 방어', () => {
  it('워밍업 0 FPS 표본만으로는 판정하지 않아 기동 티어가 강등되지 않는다', () => {
    const ctrl = new GraphicsTierController('high');
    // FpsMeter 는 첫 ~0.5초간 0 을 반환한다. 그 0 이 창을 채워 근거 없는 강등을 유발하면 안 된다.
    for (let i = 0; i < 10; i++) {
      expect(ctrl.tick(0, STEP_DT, 'auto')).toBe('high');
    }
    expect(ctrl.getWindowFps()).toBe(0); // 창은 비어 있음(fps<=0 표본 배제)
  });

  it('워밍업(0) 이후 첫 유효 FPS 표본이 들어오면 그때 판정한다', () => {
    const ctrl = new GraphicsTierController('high');
    drive(ctrl, 0, STEP_DT, 4); // 워밍업 — 판정 보류로 high 유지
    expect(ctrl.getActiveTier()).toBe('high');
    // 첫 유효 저 FPS 표본: evalAccumulator 가 워밍업 동안 쌓여 즉시 판정 → 1단계 강등.
    expect(ctrl.tick(LOW_FPS, STEP_DT, 'auto')).toBe('med');
  });

  it('워밍업 중이라도 수동 오버라이드는 fps 무관하게 즉시 잠긴다', () => {
    const ctrl = new GraphicsTierController('high');
    expect(ctrl.tick(0, 0.001, 'low')).toBe('low'); // 창 비어도 오버라이드 즉시
  });
});

describe('graphicsTierController — 공유 싱글턴', () => {
  it('모듈 싱글턴이 존재하고 초기 티어를 노출한다', () => {
    expect(graphicsTierController).toBeInstanceOf(GraphicsTierController);
    expect(graphicsTierController.getActiveTier()).toBe(INITIAL_TIER);
  });
});
