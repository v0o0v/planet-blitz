/**
 * 환경 색 유틸 — 특히 **안전 색상 구간이 계산으로 성립하는가**.
 *
 * 이 테스트의 핵심 주장은 하나다: 카르곤이 4라운드에 걸쳐 손으로 얻은 허용 구간
 * `[10°, 18.4°]` 가 `FOREGROUND_SIGNAL_COLORS` 로부터 **계산으로 재현된다**. 재현되지
 * 않으면 그 두 숫자는 파생값이 아니라 독립 입력이라는 뜻이고, 행성이 6개로 늘 때
 * 사람이 손으로 다시 적다가 갈라진다(이 리포가 `UPPER_THRESHOLD` 로 이미 겪은 실패).
 */

import { describe, it, expect } from 'vitest';
import {
  hueOf,
  saturationOf,
  hueAngleDistance,
  hueInWindow,
  hueInAnyWindow,
  computeSafeHueWindows,
  paletteHueViolations,
} from '../src/render/env/color.js';
import { FOREGROUND_SIGNAL_COLORS } from '../src/render/textures.js';
import { LAVA_PALETTE, LAVA_HUE_MIN, LAVA_HUE_MAX, HOSTILE_HUE_GAP } from '../src/render/env/kargonLavaLight.js';

describe('색상각 기본', () => {
  it('무채색은 0, 원색은 알려진 각도', () => {
    expect(hueOf(0x808080)).toBe(0);
    expect(hueOf(0xff0000)).toBeCloseTo(0, 6);
    expect(hueOf(0x00ff00)).toBeCloseTo(120, 6);
    expect(hueOf(0x0000ff)).toBeCloseTo(240, 6);
  });

  it('원형 거리는 감싸기를 처리한다', () => {
    expect(hueAngleDistance(355, 5)).toBeCloseTo(10, 6);
    expect(hueAngleDistance(5, 355)).toBeCloseTo(10, 6);
    expect(hueAngleDistance(0, 180)).toBeCloseTo(180, 6);
  });

  it('채도는 검정에서 0(0 나눗셈 없음)', () => {
    expect(saturationOf(0x000000)).toBe(0);
    expect(saturationOf(0xff0000)).toBeCloseTo(1, 6);
  });
});

describe('안전 색상 구간 계산', () => {
  const gap = HOSTILE_HUE_GAP;

  it('위험색이 없으면 원 전체가 안전하다', () => {
    expect(computeSafeHueWindows([], gap)).toEqual([{ start: 0, span: 360 }]);
  });

  it('무채색 위험색은 색상각 축에서 제외된다(각도가 정의되지 않는다)', () => {
    // 흰 코어 탄처럼 채도 없는 것은 색상각으로 분리할 수 없다 — 크기·속도로 분리할 몫이다.
    expect(computeSafeHueWindows([0xffffff, 0x000000], gap)).toEqual([{ start: 0, span: 360 }]);
  });

  it('위험색이 원을 촘촘히 덮으면 안전 구간이 없다(조용히 통과시키면 안 된다)', () => {
    const many = Array.from({ length: 36 }, (_, i) => {
      const h = i * 10;
      // 각도 h 의 순수 색을 만든다(채도 최대).
      const k = h / 60;
      const seg = Math.floor(k) % 6;
      const f = k - Math.floor(k);
      const q = Math.round((1 - f) * 255);
      const t = Math.round(f * 255);
      const table = [[255, t, 0], [q, 255, 0], [0, 255, t], [0, q, 255], [t, 0, 255], [255, 0, q]];
      const row = table[seg] ?? [0, 0, 0];
      return ((row[0] ?? 0) << 16) | ((row[1] ?? 0) << 8) | (row[2] ?? 0);
    });
    expect(computeSafeHueWindows(many, gap)).toEqual([]);
  });

  it('구간 판정은 원 감싸기를 처리한다', () => {
    const w = { start: 345, span: 30 };
    expect(hueInWindow(350, w)).toBe(true);
    expect(hueInWindow(10, w)).toBe(true);
    expect(hueInWindow(20, w)).toBe(false);
    expect(hueInAnyWindow(20, [w, { start: 15, span: 10 }])).toBe(true);
  });
});

describe('카르곤 허용 구간이 계산으로 재현된다', () => {
  const gap = HOSTILE_HUE_GAP;
  const windows = computeSafeHueWindows(FOREGROUND_SIGNAL_COLORS, gap);

  it('카르곤이 손으로 얻은 [10, 18.4] 를 품는 안전 구간이 존재한다', () => {
    const containing = windows.filter(
      (w) => hueInWindow(LAVA_HUE_MIN, w) && hueInWindow(LAVA_HUE_MAX, w),
    );
    expect(containing.length).toBe(1);
    // 그 구간은 hot-red(355.4°)와 앰버(28.5°) 사이의 골짜기여야 한다.
    const w = containing[0]!;
    expect(w.start).toBeGreaterThan(0);
    expect(w.start).toBeLessThanOrEqual(LAVA_HUE_MIN);
    expect(w.start + w.span).toBeGreaterThanOrEqual(LAVA_HUE_MAX);
  });

  it('구간 경계가 실제로 위험색에서 정확히 gap 만큼 떨어져 있다', () => {
    const hostileHues = FOREGROUND_SIGNAL_COLORS.filter((c) => saturationOf(c) >= 0.15).map(hueOf);
    for (const w of windows) {
      const nearStart = Math.min(...hostileHues.map((h) => hueAngleDistance(h, w.start)));
      const nearEnd = Math.min(...hostileHues.map((h) => hueAngleDistance(h, (w.start + w.span) % 360)));
      expect(nearStart).toBeCloseTo(gap, 6);
      expect(nearEnd).toBeCloseTo(gap, 6);
    }
  });

  it('카르곤 용암 팔레트 전체가 어떤 안전 구간 안에 있다', () => {
    const outside = LAVA_PALETTE.filter((c) => !hueInAnyWindow(hueOf(c), windows));
    expect(outside.map((c) => c.toString(16))).toEqual([]);
  });

  it('팔레트 위반 검사가 위반 없음을 보고한다', () => {
    expect(paletteHueViolations(LAVA_PALETTE, FOREGROUND_SIGNAL_COLORS, gap)).toEqual([]);
  });

  it('일부러 적탄 색에 붙인 색은 위반으로 잡힌다(항진 방지)', () => {
    // 앰버 적탄(0xff8a20, 28.5°) 바로 옆 색을 넣으면 반드시 걸려야 한다. 이 단언이 없으면
    // 위 통과들이 "검사가 아무것도 안 한다"로도 설명된다.
    const v = paletteHueViolations([0xff8c22], FOREGROUND_SIGNAL_COLORS, gap);
    expect(v.length).toBe(1);
    expect(v[0]!.distance).toBeLessThan(gap);
    expect(v[0]!.nearestHostile).toBe(0xff8a20);
  });
});
