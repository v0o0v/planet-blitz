/**
 * 일일 보상 개봉 연출 타임라인 (ADR-0048 · 계획 §C10).
 *
 * 이 연출이 실패하는 방식은 셋이고 전부 **눈으로만** 잡히는 자리라 여기서 잠근다:
 *   ① 열자마자 다 보인다 — 시작 프레임이 정착값과 같으면 연출이 아무것도 안 한 것이다.
 *   ② 끝났는데 화면이 정적 레이아웃과 다르다 — 그러면 개봉을 본 사람과 칩으로 다시 연
 *      사람이 서로 다른 화면을 보고, 그 차이는 "레이아웃 버그"로 보고된다.
 *   ③ 값이 뒤로 간다 — 게이지가 찼다 줄거나 글자가 나타났다 사라지면 고장으로 읽힌다.
 *
 * 절대값(구간 경계 ms·곡선 계수)은 단언하지 않는다 — 연출 튜닝이 이 파일을 빨갛게 만들면
 * 그 테스트가 잘못 쓰인 것이다. 단언하는 것은 **단조성·정의역·정착 일치**뿐이다.
 */

import { describe, expect, it } from 'vitest';

import {
  revealFrame,
  REVEAL_SETTLED,
  REVEAL_TOTAL_MS,
  SUBJECT_RISE_PX,
  PANEL_OPEN_SCALE,
} from '../src/ui/pixi/dailyRewardReveal.js';

describe('개봉 연출 — 시작과 끝', () => {
  it('시작 프레임은 지급물을 감춘다 — 봉인이 덮여 있고 게이지가 비어 있다', () => {
    const f = revealFrame(0);
    expect(f.subjectAlpha).toBe(0);
    expect(f.sealAlpha).toBe(1);
    expect(f.barProgress).toBe(0);
    expect(f.panelScale).toBeCloseTo(PANEL_OPEN_SCALE, 5);
    expect(f.subjectRise).toBe(SUBJECT_RISE_PX);
    expect(f.done).toBe(false);
  });

  it('끝난 프레임이 정착 상수와 **동일 객체**다 — 근사값을 계산하지 않는다', () => {
    // `toBe` 다: 같은 모양을 다시 만들면 부동소수 오차가 정적 화면과 1px 어긋난 상태를
    // 만들 수 있다. 상수를 그대로 돌려주는 것이 계약이다.
    expect(revealFrame(REVEAL_TOTAL_MS)).toBe(REVEAL_SETTLED);
    expect(revealFrame(REVEAL_TOTAL_MS + 5_000)).toBe(REVEAL_SETTLED);
  });

  it('정착값이 정적 화면이다 — 봉인과 쓸림은 사라지고 나머지는 100% 다', () => {
    expect(REVEAL_SETTLED.panelScale).toBe(1);
    expect(REVEAL_SETTLED.panelAlpha).toBe(1);
    expect(REVEAL_SETTLED.subjectAlpha).toBe(1);
    expect(REVEAL_SETTLED.subjectRise).toBe(0);
    expect(REVEAL_SETTLED.barProgress).toBe(1);
    // 이 둘이 0 이 아니면 팝업 위에 금빛 판이 영구히 남는다.
    expect(REVEAL_SETTLED.sealAlpha).toBe(0);
    expect(REVEAL_SETTLED.sweepAlpha).toBe(0);
    expect(REVEAL_SETTLED.done).toBe(true);
  });

  it('연출이 실제로 무언가를 한다 — 시작과 끝이 다르다', () => {
    // ①의 짝. 이 단언이 없으면 타임라인 전체를 정착값으로 바꿔도 위 테스트들이 통과한다.
    const start = revealFrame(0);
    expect(start.subjectAlpha).not.toBe(REVEAL_SETTLED.subjectAlpha);
    expect(start.panelScale).not.toBe(REVEAL_SETTLED.panelScale);
    expect(start.sealAlpha).not.toBe(REVEAL_SETTLED.sealAlpha);
  });
});

describe('개봉 연출 — 단조성과 정의역', () => {
  const SAMPLES = 120;
  const at = (i: number): number => (REVEAL_TOTAL_MS * i) / SAMPLES;

  it('지급물·게이지는 뒤로 가지 않는다', () => {
    let prevSubject = -1;
    let prevBar = -1;
    for (let i = 0; i <= SAMPLES; i++) {
      const f = revealFrame(at(i));
      expect(f.subjectAlpha).toBeGreaterThanOrEqual(prevSubject);
      expect(f.barProgress).toBeGreaterThanOrEqual(prevBar);
      prevSubject = f.subjectAlpha;
      prevBar = f.barProgress;
    }
  });

  it('봉인은 뒤로 가지 않고 사라진다(불투명도 단조 감소)', () => {
    let prev = 2;
    for (let i = 0; i <= SAMPLES; i++) {
      const f = revealFrame(at(i));
      expect(f.sealAlpha).toBeLessThanOrEqual(prev + 1e-9);
      prev = f.sealAlpha;
    }
    expect(revealFrame(REVEAL_TOTAL_MS).sealAlpha).toBe(0);
  });

  it('지급물이 내려간 거리는 줄기만 하고 **정수**다 — 반픽셀 부유가 테두리를 번쩍이게 한다', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= SAMPLES; i++) {
      const f = revealFrame(at(i));
      expect(Number.isInteger(f.subjectRise)).toBe(true);
      expect(f.subjectRise).toBeLessThanOrEqual(prev);
      prev = f.subjectRise;
    }
  });

  it('모든 값이 유한하고 정의역 안이다', () => {
    for (let i = -5; i <= SAMPLES + 5; i++) {
      const f = revealFrame(at(i));
      for (const v of [f.panelScale, f.panelAlpha, f.sealAlpha, f.sealScale, f.subjectAlpha, f.barProgress, f.sweepT, f.sweepAlpha, f.subjectRise]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      for (const a of [f.panelAlpha, f.sealAlpha, f.subjectAlpha, f.barProgress, f.sweepAlpha]) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
      expect(f.sweepT).toBeGreaterThanOrEqual(-1);
      expect(f.sweepT).toBeLessThanOrEqual(1);
      // 판이 축소되며 열리다 살짝 넘긴다. 넘침이 크면 팝업이 튄 것으로 보인다.
      expect(f.panelScale).toBeGreaterThanOrEqual(PANEL_OPEN_SCALE - 1e-9);
      expect(f.panelScale).toBeLessThan(1.12);
    }
  });

  it('음수 경과는 "아직 시작 전" 이라 시작 프레임이다', () => {
    for (const before of [-1, -1e9]) {
      expect(revealFrame(before)).toEqual(revealFrame(0));
    }
  });

  it('손상값(NaN·±Infinity)은 **정착**으로 접힌다 — 0 으로 접으면 연출이 영영 안 끝난다', () => {
    // `deltaMS` 가 한 번 NaN 이면 누적값이 영영 NaN 이다. 시작 프레임으로 접으면 구독이
    // 안 끊겨 매 프레임 다시 그리고 지급물은 계속 감춰진다 — 통지가 사라지는 것이 이
    // 기능에서 가능한 최악이라, 방향은 "다 보여 주고 끝난다" 여야 한다.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(revealFrame(bad)).toBe(REVEAL_SETTLED);
      expect(revealFrame(bad).done).toBe(true);
    }
  });

  it('쓸림은 들어오고 나갈 때 안 보인다 — 양 끝 불투명도가 0 이다', () => {
    // 0 이 아니면 빛 막대가 판 가장자리에서 갑자기 나타났다 사라진다.
    expect(revealFrame(0).sweepAlpha).toBe(0);
    expect(revealFrame(REVEAL_TOTAL_MS).sweepAlpha).toBe(0);
    // 양성 짝 — 중간에는 실제로 보인다(안 보이면 이 연출은 없는 것과 같다).
    let peak = 0;
    for (let i = 0; i <= SAMPLES; i++) peak = Math.max(peak, revealFrame(at(i)).sweepAlpha);
    expect(peak).toBeGreaterThan(0.2);
  });
});
