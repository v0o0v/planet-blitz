/**
 * 촉각 피드백 검증 (그래픽 이펙트 Phase 5 — AC-5.3).
 *
 * 두 층을 검증한다.
 *  1) 스프링 순수함수({@link file://../src/ui/pixi/tactile.ts}) — 경계·정착·overshoot.
 *  2) {@link PixiButton} 통합 — **기존 거동 무회귀**(tap→onClick+playUi·disabled·setLabel)에 더해
 *     눌림 스쿼시(inner scale↓ 후 스프링 복귀)·reducedMotion 즉시 적용·집기 lift 옵션·파괴 시
 *     Ticker 구독 해제(누수 0).
 *
 * PixiJS 는 렌더러 없이 import 만 하므로 node 환경에서 돈다(combatFeedbackWiring.test.ts 선례).
 * 다만 `Ticker.shared` 는 autoStart 라 첫 add 에서 requestAnimationFrame 을 부른다 — node 엔 없어
 * 크래시하므로 no-op 로 셰임한다(콜백은 안 돌고, 프레임은 아래 onFrame 을 직접 호출해 구동한다).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from 'pixi.js';

import { PixiButton } from '../src/ui/pixi/button.js';
import { setUiAudio } from '../src/render/uiSound.js';
import type { GameAudio } from '../src/render/audio.js';
import { graphicsSettings } from '../src/render/graphicsSettings.js';
import {
  stepSpring,
  isSpringSettled,
  TACTILE_SPRING,
  SQUASH_SCALE,
  LIFT_SCALE,
  type SpringState,
} from '../src/ui/pixi/tactile.js';

// ── requestAnimationFrame 셰임(node) — Ticker.shared.add 가 크래시하지 않게 no-op 등록만. ──
if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = (_cb: FrameRequestCallback): number => 0;
  globalThis.cancelAnimationFrame = (_id: number): void => {
    /* no-op */
  };
}

/** 한 프레임 ≈ 1/60초(deltaMS 16.67) — onFrame 직접 구동용. */
const FRAME = { deltaMS: 1000 / 60 };

/** PixiButton 의 촉각 내부(테스트에서만 캐스트로 접근 — 공개 API 는 오염하지 않는다). */
interface TactileInternals {
  onFrame: (t: { deltaMS: number }) => void;
  ticking: boolean;
  gloss: { alpha: number };
}
function tactile(b: PixiButton): TactileInternals {
  return b as unknown as TactileInternals;
}
/** inner 컨테이너(container 의 유일한 직속 자식). scale 이 스쿼시/lift 배율. */
function innerOf(b: PixiButton): Container {
  return b.container.children[0] as Container;
}
/**
 * 포인터 이벤트를 직접 발사(hangarScroll.test.ts 관용구). Pixi 의 타입드 emit 은 이벤트 객체를
 * 요구하지만 핸들러는 인자를 안 쓰므로 loose 캐스트로 타입만 우회한다.
 */
function fire(b: PixiButton, type: string): void {
  (b.container as unknown as { emit(type: string): void }).emit(type);
}

beforeEach(() => {
  graphicsSettings.set({ reducedMotion: false });
});

// ---------------------------------------------------------------------------
// 1) 스프링 순수함수
// ---------------------------------------------------------------------------
describe('tactile 스프링 순수함수', () => {
  it('정착 경계: 목표에 붙고 느리면 정착, 아니면 미정착', () => {
    expect(isSpringSettled({ value: 1, velocity: 0 }, 1)).toBe(true);
    // 값은 붙었지만 속도가 빠르면 아직 미정착.
    expect(isSpringSettled({ value: 1, velocity: 0.5 }, 1)).toBe(false);
    // 속도는 0 이지만 값이 멀면 미정착.
    expect(isSpringSettled({ value: 0.9, velocity: 0 }, 1)).toBe(false);
  });

  it('정착 수렴: 1→0.92 로 반복 스텝하면 목표 근방에 정착', () => {
    let s: SpringState = { value: 1, velocity: 0 };
    for (let i = 0; i < 400; i++) {
      s = stepSpring(s, SQUASH_SCALE, TACTILE_SPRING, 1 / 60);
      if (isSpringSettled(s, SQUASH_SCALE)) break;
    }
    expect(isSpringSettled(s, SQUASH_SCALE)).toBe(true);
    expect(Math.abs(s.value - SQUASH_SCALE)).toBeLessThanOrEqual(0.0015);
  });

  it('overshoot: 0.92→1.0 복귀 시 목표(1.0)를 지나쳤다 정착(카툰 바운스)', () => {
    let s: SpringState = { value: SQUASH_SCALE, velocity: 0 };
    let max = -Infinity;
    for (let i = 0; i < 400; i++) {
      s = stepSpring(s, 1, TACTILE_SPRING, 1 / 60);
      max = Math.max(max, s.value);
    }
    expect(max).toBeGreaterThan(1.003); // 명확한 overshoot(관측 ≈ 1.011).
    expect(isSpringSettled(s, 1)).toBe(true); // 그러고도 최종엔 정착.
  });

  it('dt 클램프: 큰 dt 를 넣어도 발산하지 않는다', () => {
    // 백그라운드 복귀로 dt 가 몇 초로 튀어도 값이 폭주(NaN/무한)하지 않아야 한다.
    const s = stepSpring({ value: 1, velocity: 0 }, SQUASH_SCALE, TACTILE_SPRING, 10);
    expect(Number.isFinite(s.value)).toBe(true);
    expect(Number.isFinite(s.velocity)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2) 기존 거동 무회귀
// ---------------------------------------------------------------------------
describe('PixiButton 기존 거동 보존', () => {
  it('pointertap → onClick + playUi(주입 사운드로 라우팅)', () => {
    const play = vi.fn();
    setUiAudio({ play } as unknown as GameAudio);
    const onClick = vi.fn();
    const btn = new PixiButton({
      width: 120,
      height: 44,
      label: '출격',
      onClick,
      fallbackColor: 0x334455,
      sound: 'uiConfirm',
    });
    fire(btn, 'pointertap');
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenLastCalledWith('uiConfirm');
  });

  it('setEnabled(false): tap 무시 · alpha 0.4 · eventMode none', () => {
    const onClick = vi.fn();
    const btn = new PixiButton({ width: 120, height: 44, label: 'x', onClick, fallbackColor: 0x334455 });
    btn.setEnabled(false);
    expect(btn.container.alpha).toBe(0.4);
    expect(btn.container.eventMode).toBe('none');
    fire(btn, 'pointertap'); // emit 은 hit-test 를 우회하므로 핸들러 가드로만 막힌다.
    expect(onClick).not.toHaveBeenCalled();
  });

  it('setLabel 이 라벨 텍스트에 반영된다', () => {
    const btn = new PixiButton({ width: 120, height: 44, label: '이전', onClick: () => {}, fallbackColor: 0x334455 });
    btn.setLabel('다음');
    const labelText = (btn as unknown as { labelText: { text: string } }).labelText;
    expect(labelText.text).toBe('다음');
  });

  it('pointerover/out 이 기존 alpha 호버(0.85↔1)를 유지한다', () => {
    const btn = new PixiButton({ width: 120, height: 44, label: 'x', onClick: () => {}, fallbackColor: 0x334455 });
    fire(btn, 'pointerover');
    expect(btn.container.alpha).toBe(0.85);
    fire(btn, 'pointerout');
    expect(btn.container.alpha).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3) 촉각 피드백
// ---------------------------------------------------------------------------
describe('PixiButton 촉각 피드백(AC-5.3)', () => {
  it('pointerdown → inner scale 다운, 뗀 뒤 스프링으로 ~1 복귀·구독 해제', () => {
    const btn = new PixiButton({ width: 120, height: 44, label: 'x', onClick: () => {}, fallbackColor: 0x334455 });
    const inner = innerOf(btn);

    fire(btn, 'pointerdown');
    expect(tactile(btn).ticking).toBe(true); // 애니 중 구독.
    tactile(btn).onFrame(FRAME);
    expect(inner.scale.x).toBeLessThan(1); // 눌려 내려감.
    expect(inner.scale.x).toBeGreaterThan(SQUASH_SCALE - 0.01);

    fire(btn, 'pointerup');
    for (let i = 0; i < 400; i++) {
      tactile(btn).onFrame(FRAME);
      if (!tactile(btn).ticking) break;
    }
    expect(inner.scale.x).toBeCloseTo(1, 3); // 복귀 정착.
    expect(tactile(btn).ticking).toBe(false); // 정착 후 구독 해제(idle 0).
  });

  it('reducedMotion=true: 스쿼시 모션 스킵, 목표 상태만 즉시 적용(구독 없음)', () => {
    graphicsSettings.set({ reducedMotion: true });
    const btn = new PixiButton({ width: 120, height: 44, label: 'x', onClick: () => {}, fallbackColor: 0x334455 });
    const inner = innerOf(btn);

    fire(btn, 'pointerdown');
    expect(inner.scale.x).toBe(SQUASH_SCALE); // 프레임 없이 즉시.
    expect(tactile(btn).ticking).toBe(false); // Ticker 구독 안 함.

    fire(btn, 'pointerup');
    expect(inner.scale.x).toBe(1); // 즉시 중립.
  });

  it('lift 옵션 off(기본): 호버해도 scale 불변', () => {
    graphicsSettings.set({ reducedMotion: true }); // 즉시 적용으로 scale 을 결정적으로 읽는다.
    const btn = new PixiButton({ width: 120, height: 44, label: 'x', onClick: () => {}, fallbackColor: 0x334455 });
    const inner = innerOf(btn);
    fire(btn, 'pointerover');
    expect(inner.scale.x).toBe(1); // lift off → 중립 유지.
  });

  it('lift 옵션 on: 호버 시 떠오르고(LIFT_SCALE), 벗어나면 복귀', () => {
    graphicsSettings.set({ reducedMotion: true });
    const btn = new PixiButton({
      width: 120,
      height: 44,
      label: 'x',
      onClick: () => {},
      fallbackColor: 0x334455,
      lift: true,
    });
    const inner = innerOf(btn);
    fire(btn, 'pointerover');
    expect(inner.scale.x).toBe(LIFT_SCALE);
    fire(btn, 'pointerout');
    expect(inner.scale.x).toBe(1);
  });

  it('호버 광택 오버레이 알파가 호버에서 켜지고 벗어나면 꺼진다', () => {
    const btn = new PixiButton({ width: 120, height: 44, label: 'x', onClick: () => {}, fallbackColor: 0x334455 });
    expect(tactile(btn).gloss.alpha).toBe(0);
    fire(btn, 'pointerover');
    expect(tactile(btn).gloss.alpha).toBeGreaterThan(0);
    fire(btn, 'pointerout');
    expect(tactile(btn).gloss.alpha).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4) 파괴 시 Ticker 구독 해제(누수 0)
// ---------------------------------------------------------------------------
describe('PixiButton 파괴', () => {
  it('destroy(): 애니 중 파괴해도 구독 해제 · 재-tick 무해', () => {
    const btn = new PixiButton({ width: 120, height: 44, label: 'x', onClick: () => {}, fallbackColor: 0x334455 });
    fire(btn, 'pointerdown');
    expect(tactile(btn).ticking).toBe(true);
    btn.destroy();
    expect(tactile(btn).ticking).toBe(false); // 'destroyed' 훅이 구독을 끊는다.
    expect(() => tactile(btn).onFrame(FRAME)).not.toThrow(); // 파괴된 inner 를 건드리지 않는다.
  });

  it('기존 파괴 경로 container.destroy() 도 구독을 끊는다', () => {
    const btn = new PixiButton({ width: 120, height: 44, label: 'x', onClick: () => {}, fallbackColor: 0x334455 });
    fire(btn, 'pointerdown');
    expect(tactile(btn).ticking).toBe(true);
    btn.container.destroy(); // 호출자가 직접 부르는 레거시 경로.
    expect(tactile(btn).ticking).toBe(false);
  });
});
