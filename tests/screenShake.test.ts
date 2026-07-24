/**
 * 화면 흔들림 트라우마 모델 검증 (src/render/screenShake — AC-2.2).
 *
 * shakeOffset(순수함수): 0/음수 trauma → {0,0} · trauma>1 클램프 · 결정론 · 진폭 단조 · 상한.
 * TraumaController: addTrauma 상한 1 · tick 감쇠 단조 · reset · enabled=false → {0,0}(감쇠는 계속) ·
 * 감쇠로 결국 {0,0} 수렴.
 */

import { describe, it, expect } from 'vitest';
import {
  shakeOffset,
  TraumaController,
  MAX_OFFSET,
  TRAUMA_DECAY,
  TRAUMA_PLAYER_HIT,
  TRAUMA_BOSS_KILL,
  TRAUMA_ELITE_KILL,
  TRAUMA_BIG_EXPLOSION,
} from '../src/render/screenShake.js';

/** 오프셋 벡터 크기(진폭 단조·수렴 판정용). */
function magnitude(o: { dx: number; dy: number }): number {
  return Math.hypot(o.dx, o.dy);
}

describe('shakeOffset — 0/음수/NaN trauma', () => {
  it('trauma 0 이면 {0,0}', () => {
    expect(shakeOffset(0, 0)).toEqual({ dx: 0, dy: 0 });
    expect(shakeOffset(0, 123)).toEqual({ dx: 0, dy: 0 });
  });

  it('음수 trauma 면 {0,0}', () => {
    expect(shakeOffset(-1, 7)).toEqual({ dx: 0, dy: 0 });
    expect(shakeOffset(-0.5, 42)).toEqual({ dx: 0, dy: 0 });
  });

  it('NaN trauma 면 {0,0}(방어)', () => {
    expect(shakeOffset(Number.NaN, 3)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('shakeOffset — trauma>1 상한 클램프', () => {
  it('trauma>1 은 trauma=1 과 동일 출력', () => {
    for (const tick of [0, 1, 5, 100, 9999]) {
      expect(shakeOffset(2, tick)).toEqual(shakeOffset(1, tick));
      expect(shakeOffset(1000, tick)).toEqual(shakeOffset(1, tick));
    }
  });

  it('trauma=∞ 도 trauma=1 로 클램프', () => {
    expect(shakeOffset(Number.POSITIVE_INFINITY, 12)).toEqual(shakeOffset(1, 12));
  });
});

describe('shakeOffset — 결정론', () => {
  it('같은 (trauma, tick) 은 항상 같은 출력', () => {
    for (const [trauma, tick] of [
      [0.3, 10],
      [0.5, 0],
      [1, 7],
      [0.75, 12345],
    ] as const) {
      expect(shakeOffset(trauma, tick)).toEqual(shakeOffset(trauma, tick));
    }
  });

  it('tick 정수 절단: 같은 정수부는 같은 noise 위상', () => {
    expect(shakeOffset(0.6, 5)).toEqual(shakeOffset(0.6, 5.9));
  });

  it('서로 다른 tick 은 (일반적으로) 다른 오프셋을 준다', () => {
    // noise 가 tick 에 의존함을 보인다(위상 변화).
    const a = shakeOffset(0.8, 1);
    const b = shakeOffset(0.8, 2);
    expect(a).not.toEqual(b);
  });

  it('dx/dy 두 축은 독립(서로 다른 seed)', () => {
    const o = shakeOffset(1, 3);
    expect(o.dx).not.toBe(o.dy);
  });
});

describe('shakeOffset — 진폭 단조(trauma 증가 시)', () => {
  it('고정 tick 에서 trauma 증가 → 오프셋 크기 비감소', () => {
    // 여러 tick 에서 trauma 0.1→1.0 스윕이 단조 비감소인지 확인.
    for (const tick of [1, 4, 17, 250]) {
      let prev = -1;
      for (let t = 0.1; t <= 1.0 + 1e-9; t += 0.1) {
        const m = magnitude(shakeOffset(t, tick));
        expect(m).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = m;
      }
    }
  });

  it('trauma² 곡률: 0.5 의 진폭은 1.0 의 1/4 수준(같은 tick)', () => {
    const tick = 9;
    const full = magnitude(shakeOffset(1, tick));
    const half = magnitude(shakeOffset(0.5, tick));
    // shake=trauma^2 이므로 0.5^2/1^2 = 0.25 비율.
    expect(half).toBeCloseTo(full * 0.25, 6);
  });
});

describe('shakeOffset — 진폭 상한', () => {
  it('|dx|,|dy| 는 MAX_OFFSET 를 넘지 않는다', () => {
    for (const trauma of [0.1, 0.5, 1, 2]) {
      for (let tick = 0; tick < 500; tick++) {
        const o = shakeOffset(trauma, tick);
        expect(Math.abs(o.dx)).toBeLessThanOrEqual(MAX_OFFSET);
        expect(Math.abs(o.dy)).toBeLessThanOrEqual(MAX_OFFSET);
      }
    }
  });
});

describe('TraumaController — addTrauma 누적/상한', () => {
  it('누적되고 상한 1 로 클램프', () => {
    const c = new TraumaController();
    expect(c.getTrauma()).toBe(0);
    c.addTrauma(0.3);
    expect(c.getTrauma()).toBeCloseTo(0.3, 6);
    c.addTrauma(0.3);
    expect(c.getTrauma()).toBeCloseTo(0.6, 6);
    c.addTrauma(0.8); // 0.6+0.8=1.4 → 1 클램프.
    expect(c.getTrauma()).toBe(1);
  });

  it('음수/NaN amount 는 무시(감쇠는 tick 몫)', () => {
    const c = new TraumaController();
    c.addTrauma(0.5);
    c.addTrauma(-0.3);
    expect(c.getTrauma()).toBeCloseTo(0.5, 6);
    c.addTrauma(Number.NaN);
    expect(c.getTrauma()).toBeCloseTo(0.5, 6);
  });

  it('트리거 세기 상수 서열: 강(보스/엘리트) > 중(피격/폭발) > 0', () => {
    expect(TRAUMA_BOSS_KILL).toBeGreaterThan(TRAUMA_PLAYER_HIT);
    expect(TRAUMA_ELITE_KILL).toBeGreaterThan(TRAUMA_BIG_EXPLOSION);
    expect(TRAUMA_PLAYER_HIT).toBeGreaterThan(0);
    expect(TRAUMA_BIG_EXPLOSION).toBeGreaterThan(0);
    for (const s of [TRAUMA_PLAYER_HIT, TRAUMA_BOSS_KILL, TRAUMA_ELITE_KILL, TRAUMA_BIG_EXPLOSION]) {
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

describe('TraumaController — tick 감쇠', () => {
  it('트라우마가 매 tick 단조 감소(하한 0)', () => {
    const c = new TraumaController();
    c.addTrauma(1);
    let prev = c.getTrauma();
    for (let i = 0; i < 20; i++) {
      c.tick(0.05);
      const now = c.getTrauma();
      expect(now).toBeLessThanOrEqual(prev + 1e-9);
      expect(now).toBeGreaterThanOrEqual(0);
      prev = now;
    }
  });

  it('감쇠량은 TRAUMA_DECAY·dt(하한 0)', () => {
    const c = new TraumaController();
    c.addTrauma(1);
    c.tick(0.1); // 1 - 1.6*0.1 = 0.84.
    expect(c.getTrauma()).toBeCloseTo(1 - TRAUMA_DECAY * 0.1, 6);
  });

  it('dt=0/음수/NaN 은 감쇠 없음(방어)', () => {
    const c = new TraumaController();
    c.addTrauma(0.7);
    c.tick(0);
    c.tick(-1);
    c.tick(Number.NaN);
    expect(c.getTrauma()).toBeCloseTo(0.7, 6);
  });

  it('충분히 tick 하면 trauma 0 · 오프셋 {0,0} 수렴', () => {
    const c = new TraumaController();
    c.addTrauma(1);
    let last = { dx: 0, dy: 0 };
    for (let i = 0; i < 200; i++) last = c.tick(0.1);
    expect(c.getTrauma()).toBe(0);
    expect(last).toEqual({ dx: 0, dy: 0 });
  });

  it('트라우마가 살아있는 동안엔 오프셋이 실제로 흔들린다(비영)', () => {
    const c = new TraumaController();
    c.addTrauma(1);
    const o = c.tick(0.0); // 감쇠 0 → trauma=1 로 최대 흔들림.
    expect(magnitude(o)).toBeGreaterThan(0);
  });
});

describe('TraumaController — enabled=false(모션 감소)', () => {
  it('오프셋은 {0,0} 이지만 trauma 는 계속 감쇠한다', () => {
    const c = new TraumaController();
    c.addTrauma(1);
    const before = c.getTrauma();
    const o = c.tick(0.1, false);
    expect(o).toEqual({ dx: 0, dy: 0 });
    // 감쇠는 그대로 진행 → 잔류 방지.
    expect(c.getTrauma()).toBeCloseTo(before - TRAUMA_DECAY * 0.1, 6);
    expect(c.getTrauma()).toBeLessThan(before);
  });

  it('enabled=false 로만 계속 돌려도 결국 trauma 0 수렴(복귀 시 잔류 없음)', () => {
    const c = new TraumaController();
    c.addTrauma(1);
    for (let i = 0; i < 200; i++) c.tick(0.1, false);
    expect(c.getTrauma()).toBe(0);
    // 이제 enabled=true 로 돌려도 잔류 스트레스가 없어 흔들리지 않는다.
    expect(c.tick(0.1, true)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('TraumaController — reset', () => {
  it('trauma·tick 카운터가 초기화되어 이후 오프셋 {0,0}', () => {
    const c = new TraumaController();
    c.addTrauma(1);
    c.tick(0.01);
    c.reset();
    expect(c.getTrauma()).toBe(0);
    expect(c.tick(0.0)).toEqual({ dx: 0, dy: 0 });
  });

  it('reset 후 tick 위상이 재현된다(결정론)', () => {
    // 같은 시퀀스를 두 컨트롤러가 reset 기준으로 동일하게 재생.
    const a = new TraumaController();
    const b = new TraumaController();
    a.addTrauma(1);
    b.addTrauma(1);
    const seqA = [a.tick(0.0), a.tick(0.0), a.tick(0.0)];
    const seqB = [b.tick(0.0), b.tick(0.0), b.tick(0.0)];
    expect(seqA).toEqual(seqB);
  });
});
