/**
 * 셰이더 진행도 순수함수 검증 (src/render/shaders/progress — AC-3.5).
 *
 * 세 함수의 경계(0·끝·초과)·단조(비감소)·퇴화 입력(duration≤0·음수 elapsed·NaN·∞) 방어·결정론을
 * node-env 순수 유닛으로 검증한다. 이 함수들은 render-only(sim·해시 무접촉, ADR-0005)라 GL/PixiJS
 * 없이 그대로 돈다.
 */

import { describe, it, expect } from 'vitest';
import {
  shockwaveProgress,
  dissolveProgress,
  shimmerPhase,
  DEFAULT_DISSOLVE_HOLD_S,
  DEFAULT_DISSOLVE_SPAN_S,
  SHIMMER_ANGULAR_RATE,
} from '../src/render/shaders/progress.js';

// ──────────────────────────────────────────────────────────────────────────
// shockwaveProgress
// ──────────────────────────────────────────────────────────────────────────

describe('shockwaveProgress — 경계', () => {
  it('elapsed<=0(음수·0) → 0', () => {
    expect(shockwaveProgress(0, 1)).toBe(0);
    expect(shockwaveProgress(-5, 1)).toBe(0);
    expect(shockwaveProgress(-0.001, 10)).toBe(0);
  });

  it('elapsed=duration → 1(상한 포함)', () => {
    expect(shockwaveProgress(1, 1)).toBe(1);
    expect(shockwaveProgress(0.55, 0.55)).toBe(1);
  });

  it('elapsed>duration → 1(초과 클램프)', () => {
    expect(shockwaveProgress(2, 1)).toBe(1);
    expect(shockwaveProgress(1000, 0.5)).toBe(1);
  });

  it('중간값은 선형 비율', () => {
    expect(shockwaveProgress(0.5, 1)).toBeCloseTo(0.5, 12);
    expect(shockwaveProgress(0.25, 1)).toBeCloseTo(0.25, 12);
    expect(shockwaveProgress(0.3, 0.6)).toBeCloseTo(0.5, 12);
  });
});

describe('shockwaveProgress — 퇴화 입력 방어', () => {
  it('duration<=0(음수·0) → 1(0 나눗셈 방지)', () => {
    expect(shockwaveProgress(0.5, 0)).toBe(1);
    expect(shockwaveProgress(0.5, -3)).toBe(1);
  });

  it('duration=NaN → 1', () => {
    expect(shockwaveProgress(0.5, Number.NaN)).toBe(1);
  });

  it('elapsed=NaN → 0(elapsed 게이트 우선)', () => {
    expect(shockwaveProgress(Number.NaN, 1)).toBe(0);
    expect(shockwaveProgress(Number.NaN, Number.NaN)).toBe(0);
  });

  it('elapsed=∞ → 1, duration=∞ → 0(둘 다 유계)', () => {
    expect(shockwaveProgress(Number.POSITIVE_INFINITY, 1)).toBe(1);
    expect(shockwaveProgress(0.5, Number.POSITIVE_INFINITY)).toBe(0);
    expect(shockwaveProgress(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('elapsed≤0 이 duration 퇴화보다 우선(둘 다 퇴화 시 0)', () => {
    expect(shockwaveProgress(-1, 0)).toBe(0);
    expect(shockwaveProgress(0, Number.NaN)).toBe(0);
  });
});

describe('shockwaveProgress — 단조 비감소·유계', () => {
  it('elapsed 스윕이 단조 비감소, 출력은 [0,1]', () => {
    const duration = 0.8;
    let prev = -1;
    for (let e = -0.2; e <= 1.2 + 1e-9; e += 0.02) {
      const p = shockwaveProgress(e, duration);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      expect(p).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = p;
    }
  });

  it('결정론: 같은 입력은 항상 같은 출력', () => {
    for (const [e, d] of [
      [0.3, 1],
      [0.55, 0.8],
      [1.2, 1],
    ] as const) {
      expect(shockwaveProgress(e, d)).toBe(shockwaveProgress(e, d));
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// dissolveProgress
// ──────────────────────────────────────────────────────────────────────────

describe('dissolveProgress — HOLD/DISSOLVE 구간 경계', () => {
  // 정확히 표현 가능한 값(합·차가 FP 반올림 없이 재구성) — 경계 .toBe(1) 을 위해.
  const hold = 0.5;
  const span = 1.0;

  it('elapsed<=hold → 0(HOLD 온전 유지)', () => {
    expect(dissolveProgress(0, hold, span)).toBe(0);
    expect(dissolveProgress(0.2, hold, span)).toBe(0);
    expect(dissolveProgress(hold, hold, span)).toBe(0); // 경계는 hold 소속
  });

  it('DISSOLVE 구간은 0→1 선형', () => {
    expect(dissolveProgress(hold + 0.5 * span, hold, span)).toBeCloseTo(0.5, 12);
    expect(dissolveProgress(hold + 0.25 * span, hold, span)).toBeCloseTo(0.25, 12);
  });

  it('elapsed>=hold+span → 1, 이후 계속 1(원샷 유지)', () => {
    expect(dissolveProgress(hold + span, hold, span)).toBe(1);
    expect(dissolveProgress(hold + span + 5, hold, span)).toBe(1);
    expect(dissolveProgress(9999, hold, span)).toBe(1);
  });
});

describe('dissolveProgress — 기본 placeholder 상수', () => {
  it('hold/dissolve 생략 시 DEFAULT 상수를 쓴다', () => {
    const h = DEFAULT_DISSOLVE_HOLD_S;
    const d = DEFAULT_DISSOLVE_SPAN_S;
    expect(dissolveProgress(h * 0.5)).toBe(0); // HOLD 안
    expect(dissolveProgress(h + 0.5 * d)).toBeCloseTo(0.5, 12);
    expect(dissolveProgress(h + d)).toBe(1);
    // 명시 인자와 기본 인자가 일치.
    expect(dissolveProgress(h + 0.3 * d)).toBeCloseTo(dissolveProgress(h + 0.3 * d, h, d), 12);
  });

  it('상수는 양수·유한', () => {
    expect(DEFAULT_DISSOLVE_HOLD_S).toBeGreaterThan(0);
    expect(DEFAULT_DISSOLVE_SPAN_S).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_DISSOLVE_HOLD_S)).toBe(true);
    expect(Number.isFinite(DEFAULT_DISSOLVE_SPAN_S)).toBe(true);
  });
});

describe('dissolveProgress — 퇴화 입력 방어', () => {
  it('elapsed<=0(음수·0) → 0', () => {
    expect(dissolveProgress(0, 0.4, 1)).toBe(0);
    expect(dissolveProgress(-2, 0.4, 1)).toBe(0);
  });

  it('elapsed=NaN → 0', () => {
    expect(dissolveProgress(Number.NaN, 0.4, 1)).toBe(0);
  });

  it('hold 음수·NaN → 0 취급(즉시 디졸브 시작)', () => {
    expect(dissolveProgress(0.5, -1, 1)).toBeCloseTo(0.5, 12); // hold=0 → t=0.5/1
    expect(dissolveProgress(0.5, Number.NaN, 1)).toBeCloseTo(0.5, 12);
  });

  it('dissolve<=0·NaN → hold 넘겼으면 1, 안 넘겼으면 0(0 나눗셈 방지)', () => {
    expect(dissolveProgress(0.5, 0.4, 0)).toBe(1); // hold 초과 → 즉시 완료
    expect(dissolveProgress(0.5, 0.4, -3)).toBe(1);
    expect(dissolveProgress(0.5, 0.4, Number.NaN)).toBe(1);
    expect(dissolveProgress(0.2, 0.4, 0)).toBe(0); // HOLD 안 → 0
  });

  it('∞ 입력도 [0,1] 유계(NaN 출력 없음)', () => {
    expect(dissolveProgress(Number.POSITIVE_INFINITY, 0.4, 1)).toBe(1);
    expect(dissolveProgress(Number.POSITIVE_INFINITY, 0.4, Number.POSITIVE_INFINITY)).toBe(1);
    // 유한 elapsed / ∞ dissolve → 진행도 ≈0, NaN 아님.
    const p = dissolveProgress(5, 0.4, Number.POSITIVE_INFINITY);
    expect(Number.isNaN(p)).toBe(false);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});

describe('dissolveProgress — 단조 비감소·유계', () => {
  it('elapsed 스윕이 단조 비감소, 출력은 [0,1]', () => {
    const hold = 0.4;
    const span = 1.1;
    let prev = -1;
    for (let e = -0.3; e <= hold + span + 0.5 + 1e-9; e += 0.02) {
      const p = dissolveProgress(e, hold, span);
      expect(Number.isNaN(p)).toBe(false);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      expect(p).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = p;
    }
  });

  it('결정론: 같은 입력은 항상 같은 출력', () => {
    for (const e of [0.3, 0.9, 1.5, 3]) {
      expect(dissolveProgress(e, 0.4, 1.1)).toBe(dissolveProgress(e, 0.4, 1.1));
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// shimmerPhase
// ──────────────────────────────────────────────────────────────────────────

describe('shimmerPhase — 경계·방어', () => {
  it('elapsed<=0(음수·0) → 0', () => {
    expect(shimmerPhase(0)).toBe(0);
    expect(shimmerPhase(-1)).toBe(0);
    expect(shimmerPhase(-0.001)).toBe(0);
  });

  it('NaN·∞ → 0(유니폼 오염 차단)', () => {
    expect(shimmerPhase(Number.NaN)).toBe(0);
    expect(shimmerPhase(Number.POSITIVE_INFINITY)).toBe(0);
    expect(shimmerPhase(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('양수 elapsed → elapsed·rate(라디안)', () => {
    expect(shimmerPhase(1)).toBeCloseTo(SHIMMER_ANGULAR_RATE, 12);
    expect(shimmerPhase(0.5)).toBeCloseTo(SHIMMER_ANGULAR_RATE * 0.5, 12);
    expect(shimmerPhase(2)).toBeCloseTo(SHIMMER_ANGULAR_RATE * 2, 12);
  });
});

describe('shimmerPhase — 단조 증가·유한·결정론', () => {
  it('elapsed 스윕이 단조 (비)증가, 출력 유한', () => {
    let prev = -1;
    for (let e = -0.5; e <= 10 + 1e-9; e += 0.05) {
      const p = shimmerPhase(e);
      expect(Number.isFinite(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = p;
    }
  });

  it('유한 양수 구간에서 강 증가(같지 않음)', () => {
    expect(shimmerPhase(2)).toBeGreaterThan(shimmerPhase(1));
    expect(shimmerPhase(1.0001)).toBeGreaterThan(shimmerPhase(1));
  });

  it('rate 상수는 양수·유한', () => {
    expect(SHIMMER_ANGULAR_RATE).toBeGreaterThan(0);
    expect(Number.isFinite(SHIMMER_ANGULAR_RATE)).toBe(true);
  });

  it('결정론: 같은 입력은 항상 같은 출력', () => {
    for (const e of [0.1, 1, 3.7, 42]) {
      expect(shimmerPhase(e)).toBe(shimmerPhase(e));
    }
  });
});
