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
  ICON_POP_SCALE,
} from '../src/ui/pixi/dailyRewardReveal.js';
import { ICON_SIZE } from '../src/ui/pixi/dailyRewardModal.js';

describe('개봉 연출 — 시작과 끝', () => {
  it('시작 프레임은 지급물을 감춘다 — 아이콘도 글자도 안 보이고 게이지가 비어 있다', () => {
    const f = revealFrame(0);
    expect(f.subjectAlpha).toBe(0);
    expect(f.iconAlpha).toBe(0);
    expect(f.iconScale).toBeCloseTo(ICON_POP_SCALE, 5);
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

  it('정착값이 정적 화면이다 — 전부 100% 이고 아이콘 배율이 정확히 1 이다', () => {
    expect(REVEAL_SETTLED.panelScale).toBe(1);
    expect(REVEAL_SETTLED.panelAlpha).toBe(1);
    expect(REVEAL_SETTLED.subjectAlpha).toBe(1);
    expect(REVEAL_SETTLED.subjectRise).toBe(0);
    expect(REVEAL_SETTLED.barProgress).toBe(1);
    expect(REVEAL_SETTLED.iconAlpha).toBe(1);
    // ⚠️ **정확히 1 이어야 한다.** 1 을 넘기면 아이콘이 정착 상태에서 원본(64px)보다 크게
    //    확대돼 남는다 — 이 리포에서 "구려 보인다"의 절반이 그 과확대였다.
    expect(REVEAL_SETTLED.iconScale).toBe(1);
    expect(REVEAL_SETTLED.done).toBe(true);
  });

  it('금빛 연출(봉인·쓸림) 필드가 남아 있지 않다 (사용자 지시 2026-08-05)', () => {
    // 필드를 남기고 0 을 넣는 안은 기각했다 — 아무도 안 읽는 필드가 타임라인에 남으면
    // 다음 사람이 그것을 되살릴 자리로 오해한다.
    for (const dead of ['sealAlpha', 'sealScale', 'sweepT', 'sweepAlpha']) {
      expect(Object.keys(REVEAL_SETTLED), `${dead} 가 되살아났다`).not.toContain(dead);
    }
  });

  it('연출이 실제로 무언가를 한다 — 시작과 끝이 다르다', () => {
    // ①의 짝. 이 단언이 없으면 타임라인 전체를 정착값으로 바꿔도 위 테스트들이 통과한다.
    const start = revealFrame(0);
    expect(start.subjectAlpha).not.toBe(REVEAL_SETTLED.subjectAlpha);
    expect(start.panelScale).not.toBe(REVEAL_SETTLED.panelScale);
    expect(start.iconScale).not.toBe(REVEAL_SETTLED.iconScale);
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

  it('아이콘은 뒤로 가지 않는다(불투명도 단조 증가)', () => {
    let prev = -1;
    for (let i = 0; i <= SAMPLES; i++) {
      const f = revealFrame(at(i));
      expect(f.iconAlpha).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = f.iconAlpha;
    }
    expect(revealFrame(REVEAL_TOTAL_MS).iconAlpha).toBe(1);
  });

  it('아이콘 배율이 원본 해상도를 넘지 않는다 — 표시 크기 × 최대 배율 <= 64', () => {
    // ⚠️ 이것이 이 연출에서 **자산 품질에 직결되는 유일한 수치 계약**이다. 튀어나오는
    //    느낌을 키우려고 오버슛을 올리면 어느 순간 원본을 넘겨 확대되고, 그 흐릿함은
    //    "연출이 과하다"가 아니라 "아이콘이 구리다"로 보고된다.
    let peak = 0;
    for (let i = 0; i <= SAMPLES; i++) peak = Math.max(peak, revealFrame(at(i)).iconScale);
    expect(peak).toBeGreaterThan(1); // 양성 짝 — 실제로 살짝 넘겨야 튀어나온다.
    expect(ICON_SIZE * peak).toBeLessThanOrEqual(64);
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
      for (const v of [f.panelScale, f.panelAlpha, f.iconScale, f.iconAlpha, f.subjectAlpha, f.barProgress, f.subjectRise]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      for (const a of [f.panelAlpha, f.iconAlpha, f.subjectAlpha, f.barProgress]) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
      expect(f.iconScale).toBeGreaterThanOrEqual(ICON_POP_SCALE - 1e-9);
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

  it('아이콘이 글자보다 먼저 나타난다 — 무엇을 받았는지가 먼저 읽혀야 한다', () => {
    // 순서가 뒤집히면 글자를 읽고 나서 아이콘이 뒤늦게 튀어나와 두 번 보게 된다.
    const mid = revealFrame(300);
    expect(mid.iconAlpha).toBeGreaterThan(mid.subjectAlpha);
  });
});
