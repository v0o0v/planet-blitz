/**
 * 지형광 레이어의 **불변식** 잠금.
 *
 * 이 레이어는 화면에 색을 얹는 일이라 "그럴싸해 보이는가"는 눈으로만 판정된다. 그래서 테스트는
 * 눈으로 못 잡는 것, 그리고 **눈으로 놓쳐서 초기 구현이 기각된 것**만 잠근다:
 *
 *  ① 맥동이 `tick` 의 순수 함수인가 — 벽시계를 쓰면 탭 복귀·프레임 스킵에서 밝기가 튀고,
 *     그건 재현이 안 돼서 사람이 못 잡는다.
 *  ② 그런데 tick 이 변하면 실제로 값이 변하는가 — ①만 있으면 "상수를 반환"해도 통과한다(항진).
 *  ③ 밝기가 상한을 절대 넘지 않는가 — 넘으면 발광이 적·탄·젬을 씻어 게임플레이가 깨진다.
 *  ④ 같은 (seed, 월드 위치) 가 같은 등고선·세기 필드를 내는가 — 카메라가 돌아왔을 때 같은
 *     자리가 같은 밝기라는 보장이며, 리플레이 재현의 근거다.
 *  ⑤ **띠가 실제로 이어지는가** — 초기 구현은 방사형 블롭이라 "주황 얼룩"이었다. 마칭 스퀘어즈
 *     세그먼트가 끝점을 공유하는지(사슬인지)를 구조로 확인한다.
 *  ⑥ **밝기가 실제로 살아 있는가** — 기각 사유는 실효 알파 0.05 붕괴였다. 상한만 검사하면
 *     "전부 0"도 통과한다(항진). 그래서 **하한도** 잠근다.
 *  ⑩ **그려졌는가가 아니라 덮이지 않았는가.** AO·림이 `visible=true`·`alpha>0` 이고 이 파일이
 *     전부 그린인데 화면에는 없던 적이 있다. 단언이 전부 *레코드 속성*이거나 *스프라이트
 *     알파*였고 **"이 자취가 다른 겹에 덮이는가"를 아무도 안 쟀기 때문**이다.
 *  ⑪ **임의 테마가 만족해야 하는 계약**(테마화 이후 신설). 위 ①~⑩ 중 값 사이의 관계로만
 *     존재하는 것들은 카르곤 상수를 검사해 봐야 다음 행성을 못 막는다. 그래서 `ENV_THEMES`
 *     전체를 도는 계약으로 승격하고, **검증기가 실제로 무언가를 잡는다는 것**까지 잠근다
 *     (아무것도 안 잡는 검증기는 항진이며, 그게 이 리포가 반복해 밟은 함정이다).
 */

import { describe, it, expect } from 'vitest';
import {
  MAX_SEG_PER_CELL,
  PULSE_MAX,
  PULSE_MIN,
  REDUCED_GLOW_CORE_SCALE,
  REDUCED_GLOW_PULSE,
  HALO_OFF_CORE_SCALE,
  SEG_STRIDE,
  DISPLAY_TILE,
  UPPER_THRESHOLD,
  TerrainLightLayer,
  bandProfile,
  createSegment,
  emitterAlpha,
  emitterPulse,
  evaluateSegment,
  glowGateScales,
  marchCell,
  marchCorners,
  segmentLit,
  terrainFieldAt,
  terrainGradient,
  verticalLightDir,
} from '../src/render/env/terrainLight.js';
import {
  MIN_EFFECTIVE_ALPHA,
  TERRAIN_LIGHT_HUE_GAP,
  TERRAIN_LIGHT_LAYERS,
  TERRAIN_LIGHT_STAGES,
  terrainLightOrder,
  terrainLightPalette,
  terrainLightSafeHueWindows,
  validateTerrainLightTheme,
  type TerrainLightTheme,
} from '../src/render/env/contracts/terrainLight.js';
import { ENV_THEMES } from '../src/render/env/themes/index.js';
import { KARGON_THEME } from '../src/render/env/themes/kargon/index.js';
import { hueDistance, hueInAnyWindow, hueOf, saturationOf } from '../src/render/env/color.js';
import { FOREGROUND_SIGNAL_COLORS } from '../src/render/textures.js';
import { graphicsSettings } from '../src/render/graphicsSettings.js';
import { graphicsTierController } from '../src/render/graphicsRuntime.js';

/** 카르곤 고유 실측 단언은 이 테마를 직접 읽는다. */
const K = KARGON_THEME.terrainLight;
const KARGON_PLANET = KARGON_THEME.planets[0] ?? 0;

/** 셀 하나의 마칭 결과를 담는 스크래치. */
const cellOut = (): number[] => new Array<number>(SEG_STRIDE * MAX_SEG_PER_CELL).fill(0);

describe('맥동(emitterPulse)', () => {
  it('① 같은 tick·phase 면 항상 같은 값(순수 함수)', () => {
    for (const tick of [0, 1.5, 137.25, 9999.75]) {
      for (const phase of [0, 0.31, 0.87]) {
        expect(emitterPulse(tick, phase)).toBe(emitterPulse(tick, phase));
      }
    }
  });

  it('② tick 이 변하면 값이 변한다(상수 반환 항진 방지)', () => {
    const base = emitterPulse(0, 0.4);
    expect(Math.abs(emitterPulse(87, 0.4) - base)).toBeGreaterThan(0.05);
    const seen = new Set<number>();
    for (let t = 0; t < 600; t += 7) seen.add(Math.round(emitterPulse(t, 0.4) * 1000));
    expect(seen.size).toBeGreaterThan(20);
  });

  it('② 위상이 다르면 전체가 한꺼번에 숨쉬지 않는다', () => {
    expect(emitterPulse(120, 0)).not.toBe(emitterPulse(120, 0.5));
  });

  it('③ 어떤 tick·phase 에서도 [PULSE_MIN, PULSE_MAX] 를 벗어나지 않는다', () => {
    for (let t = 0; t < 20000; t += 3.7) {
      for (const phase of [0, 0.17, 0.5, 0.93]) {
        const v = emitterPulse(t, phase);
        expect(v).toBeGreaterThanOrEqual(PULSE_MIN);
        expect(v).toBeLessThanOrEqual(PULSE_MAX);
      }
    }
  });

  it('③ 음수·비정상 tick 에서도 범위를 지킨다(방어)', () => {
    for (const t of [-1, -12345.5, 1e6]) {
      const v = emitterPulse(t, 0.25);
      expect(v).toBeGreaterThanOrEqual(PULSE_MIN);
      expect(v).toBeLessThanOrEqual(PULSE_MAX);
    }
  });

  it('⑥ 맥동이 밝기를 깎는 장치가 되지 않는다(평균이 충분히 높다)', () => {
    // 초기 실패 원인 중 하나: 파형 중심 0.6 이 실효 알파를 40% 깎았다. 맥동은 "숨"이지
    // "감쇠"가 아니다. 평균이 0.7 아래로 내려가면 그 회귀다.
    let sum = 0;
    let n = 0;
    for (let t = 0; t < 4000; t += 3) {
      for (const phase of [0, 0.23, 0.61, 0.88]) {
        sum += emitterPulse(t, phase);
        n++;
      }
    }
    expect(sum / n).toBeGreaterThan(0.7);
  });
});

describe('알파 상한(emitterAlpha)', () => {
  const caps = [
    K.glow.alphaCap,
    K.core.alphaCap,
    K.rim.alphaCap,
    K.plume?.alphaCap ?? 0.18,
    K.ao.alphaCap,
    K.shadow.alphaCap,
  ];

  it('③ 세기·맥동·티어 조합이 무엇이든 상한을 넘지 않는다', () => {
    for (const cap of caps) {
      for (const strength of [0, 0.13, 0.5, 1]) {
        for (let t = 0; t < 900; t += 11) {
          for (const tier of [0.62, 0.88, 1]) {
            const a = emitterAlpha(cap, strength, emitterPulse(t, 0.6), tier);
            expect(a).toBeGreaterThanOrEqual(0);
            expect(a).toBeLessThanOrEqual(cap);
          }
        }
      }
    }
  });

  it('⑥ 상한이 붕괴 수준(실효 0.05)으로 되돌아가지 않는다', () => {
    // 전형적 조건(세기 0.7·맥동 중앙값·high 티어)에서 눈에 보이는 밝기가 나와야 한다.
    const p = emitterPulse(0, 0.4);
    expect(emitterAlpha(K.core.alphaCap, 0.7, p, 1)).toBeGreaterThan(0.24);
    expect(emitterAlpha(K.glow.alphaCap, 0.7, p, 1)).toBeGreaterThan(0.16);
    // 최저 티어에서도 "존재하지 않는 것"이 되면 안 된다.
    expect(emitterAlpha(K.core.alphaCap, 0.55, PULSE_MIN, 0.62)).toBeGreaterThan(0.03);
  });

  it('세기 0 이면 알파 0(꺼진 구간은 완전히 사라진다)', () => {
    expect(emitterAlpha(K.glow.alphaCap, 0, 1, 1)).toBe(0);
  });
});

describe('지형 상관 필드', () => {
  it('④ 같은 (seed, 위치) 는 항상 같은 필드값', () => {
    for (const [vx, vy] of [
      [0, 0],
      [12.5, -8.25],
      [1000.75, 640.5],
    ] as const) {
      expect(terrainFieldAt(7, vx, vy)).toBe(terrainFieldAt(7, vx, vy));
    }
  });

  it('④ 시드가 다르면 지형이 다르다', () => {
    let diff = 0;
    for (let i = 0; i < 40; i++) {
      if (terrainFieldAt(1, i * 3.5, i * 1.5) !== terrainFieldAt(2, i * 3.5, i * 1.5)) diff++;
    }
    expect(diff).toBeGreaterThan(30);
  });

  it('필드는 [0,1) 안에 있다(임계 판정이 의미를 갖는 전제)', () => {
    for (let i = 0; i < 500; i++) {
      const v = terrainFieldAt(99, i * 0.77, i * 1.31);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('경계 법선(terrainGradient)', () => {
  it('단위 벡터를 낸다', () => {
    const n = [0, 0];
    for (let i = 0; i < 200; i++) {
      terrainGradient(31337, i * 1.7, i * 0.9, n);
      const m = Math.hypot(n[0] ?? 0, n[1] ?? 0);
      expect(m).toBeGreaterThan(0.999);
      expect(m).toBeLessThan(1.001);
    }
  });

  it('법선은 필드가 커지는 쪽(솟은 upper 쪽)을 가리킨다', () => {
    const n = [0, 0];
    let ok = 0;
    let total = 0;
    for (let i = 0; i < 300; i++) {
      const vx = i * 0.73;
      const vy = i * 1.19;
      terrainGradient(4242, vx, vy, n);
      const step = 0.5;
      const here = terrainFieldAt(4242, vx, vy);
      const ahead = terrainFieldAt(4242, vx + (n[0] ?? 0) * step, vy + (n[1] ?? 0) * step);
      total++;
      if (ahead > here) ok++;
    }
    // 유한차분이라 곡률이 큰 자리에서 몇 건은 어긋난다 — 압도적 다수면 방향 계약은 성립.
    expect(ok / total).toBeGreaterThan(0.9);
  });

  it('④ 결정적이다', () => {
    const a = [0, 0];
    const b = [0, 0];
    terrainGradient(5, 3.25, -7.5, a);
    terrainGradient(5, 3.25, -7.5, b);
    expect(b).toEqual(a);
  });
});

describe('⑤ 등고선 채널(marchCorners) — 띠가 이어진다', () => {
  it('필드가 임계를 안 넘거나 다 넘으면 세그먼트가 없다', () => {
    const out = cellOut();
    expect(marchCorners(0, 0, 0.1, 0.2, 0.3, 0.4, out)).toBe(0);
    expect(marchCorners(0, 0, 0.9, 0.8, 0.7, 0.6, out)).toBe(0);
  });

  it('안장점은 두 세그먼트를 낸다(케이스 5·10)', () => {
    const out = cellOut();
    expect(marchCorners(0, 0, 0.9, 0.1, 0.9, 0.1, out)).toBe(2);
    expect(marchCorners(0, 0, 0.1, 0.9, 0.1, 0.9, out)).toBe(2);
  });

  it('세그먼트 끝점이 자기 셀의 변 위에 있다', () => {
    const out = cellOut();
    for (let j = -8; j <= 8; j++) {
      for (let i = -8; i <= 8; i++) {
        const m = marchCell(909, i, j, out);
        for (let s = 0; s < m; s++) {
          const o = s * SEG_STRIDE;
          for (const [px, py] of [
            [out[o] ?? 0, out[o + 1] ?? 0],
            [out[o + 2] ?? 0, out[o + 3] ?? 0],
          ] as const) {
            const u = px / DISPLAY_TILE - i;
            const v = py / DISPLAY_TILE - j;
            expect(u).toBeGreaterThanOrEqual(-1e-9);
            expect(u).toBeLessThanOrEqual(1 + 1e-9);
            expect(v).toBeGreaterThanOrEqual(-1e-9);
            expect(v).toBeLessThanOrEqual(1 + 1e-9);
            // 끝점은 반드시 변 위(u 또는 v 가 0 또는 1)에 있다.
            const onEdge =
              Math.abs(u) < 1e-9 ||
              Math.abs(u - 1) < 1e-9 ||
              Math.abs(v) < 1e-9 ||
              Math.abs(v - 1) < 1e-9;
            expect(onEdge).toBe(true);
          }
        }
      }
    }
  });

  it('⑤ 내부 끝점은 이웃 셀의 끝점과 **정확히** 맞물린다(강처럼 이어진다)', () => {
    // 초기 기각 사유의 핵심 — 띠가 "얼룩"이 아니라 "흐름"이어야 한다. 마칭 스퀘어즈는
    // 공유 변에서 같은 두 꼭짓점 값으로 같은 보간을 하므로 끝점이 비트까지 같아야 한다.
    // 여기서 부동소수 오차를 허용하지 않는 이유가 그것이다(≈ 가 아니라 = 다).
    for (const seed of [1, 777, 20260729]) {
      const out = cellOut();
      const counts = new Map<string, number>();
      const I0 = -14;
      const I1 = 14;
      const J0 = -14;
      const J1 = 14;
      let segs = 0;
      for (let j = J0; j <= J1; j++) {
        for (let i = I0; i <= I1; i++) {
          const m = marchCell(seed, i, j, out);
          segs += m;
          for (let s = 0; s < m; s++) {
            const o = s * SEG_STRIDE;
            for (const key of [`${out[o]},${out[o + 1]}`, `${out[o + 2]},${out[o + 3]}`]) {
              counts.set(key, (counts.get(key) ?? 0) + 1);
            }
          }
        }
      }
      expect(segs).toBeGreaterThan(40); // 표본이 비면 아래 단언이 공회전한다.

      // 스캔 영역의 **내부**(테두리 셀을 제외한 사각형) 안에 있는 끝점만 본다 —
      // 테두리 끝점은 스캔 밖 이웃이 잘려서 짝이 없는 게 정상이다.
      let interior = 0;
      let linked = 0;
      for (const [key, n] of counts) {
        const [sx, sy] = key.split(',');
        const px = Number(sx) / DISPLAY_TILE;
        const py = Number(sy) / DISPLAY_TILE;
        if (px <= I0 + 1 || px >= I1 || py <= J0 + 1 || py >= J1) continue;
        interior++;
        if (n >= 2) linked++;
      }
      expect(interior).toBeGreaterThan(30);
      expect(linked).toBe(interior);
    }
  });

  it('⑤ 세그먼트 길이가 타일 대각선 안이다(격자 밖으로 새지 않는다)', () => {
    const out = cellOut();
    const maxLen = DISPLAY_TILE * Math.SQRT2 + 1e-6;
    for (let j = -10; j <= 10; j++) {
      for (let i = -10; i <= 10; i++) {
        const m = marchCell(2026, i, j, out);
        for (let s = 0; s < m; s++) {
          const o = s * SEG_STRIDE;
          const len = Math.hypot(
            (out[o + 2] ?? 0) - (out[o] ?? 0),
            (out[o + 3] ?? 0) - (out[o + 1] ?? 0),
          );
          expect(len).toBeLessThanOrEqual(maxLen);
        }
      }
    }
  });

  it('④ 같은 (seed, 셀) 은 항상 같은 세그먼트', () => {
    const a = cellOut();
    const b = cellOut();
    for (let j = -6; j <= 6; j++) {
      for (let i = -6; i <= 6; i++) {
        expect(marchCell(1234, i, j, b)).toBe(marchCell(1234, i, j, a));
        expect(b).toEqual(a);
      }
    }
  });
});

describe('세그먼트 평가(evaluateSegment)', () => {
  /** 스캔 영역의 모든 세그먼트를 평가해 넘긴다. */
  const scan = (seed: number, r: number, fn: (s: ReturnType<typeof createSegment>) => void) => {
    const out = cellOut();
    const seg = createSegment();
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        const m = marchCell(seed, i, j, out);
        for (let s = 0; s < m; s++) {
          const o = s * SEG_STRIDE;
          evaluateSegment(
            KARGON_THEME,
            seed,
            out[o] ?? 0,
            out[o + 1] ?? 0,
            out[o + 2] ?? 0,
            out[o + 3] ?? 0,
            seg,
          );
          fn(seg);
        }
      }
    }
  };

  it('세기·위상이 정의된 범위 안이다', () => {
    let checked = 0;
    scan(4242, 16, (s) => {
      checked++;
      expect(s.strength).toBeGreaterThanOrEqual(0);
      expect(s.strength).toBeLessThanOrEqual(1);
      expect(s.rim).toBeGreaterThanOrEqual(0);
      expect(s.rim).toBeLessThanOrEqual(1);
      expect(s.ao).toBeGreaterThan(0);
      expect(s.ao).toBeLessThanOrEqual(1);
      expect(s.phase).toBeGreaterThanOrEqual(0);
      expect(s.phase).toBeLessThan(1);
      expect(s.len).toBeGreaterThan(0);
    });
    expect(checked).toBeGreaterThan(50);
  });

  it('띠는 지형 균열(upper/lower 경계) 위에만 생긴다', () => {
    let checked = 0;
    scan(555, 14, (s) => {
      checked++;
      // 중점은 등고선의 현(chord) 위라 임계에서 조금 벗어날 수 있지만, 균열 대역을 못 벗어난다.
      //
      // 임계는 **반드시 `UPPER_THRESHOLD` 를 참조**한다. 여기에 0.5 를 리터럴로 적어 뒀더니,
      // 타일셋 레인이 임계를 0.57 로 올렸을 때 이 테스트만 옛 값을 기준으로 계속 그린이었다.
      // 상수를 두 곳에 적으면 테스트가 결함을 잡는 게 아니라 **결함을 고정한다**.
      const field = terrainFieldAt(555, s.midX / DISPLAY_TILE, s.midY / DISPLAY_TILE);
      expect(Math.abs(field - UPPER_THRESHOLD)).toBeLessThan(0.06);
    });
    expect(checked).toBeGreaterThan(50);
  });

  it('⑦ **완전히 꺼진 경계가 없다** — 모든 세그먼트가 세기 하한 이상', () => {
    // 한때 `region ≤ THRESHOLD` 인 경계의 세기를 정확히 0 으로 만들어, 화면의 큰 경계 구간이
    // 통째로 검었다. 재질 규칙은 전역적으로 일관해야 하고, 관객은 "어떤 가장자리는 살아 있고
    // 어떤 건 아니다"를 미학적 선택이 아니라 **누락**으로 읽는다.
    for (const seed of [3, 4096, 20260729, 909, 1]) {
      let n = 0;
      scan(seed, 16, (s) => {
        n++;
        expect(s.strength).toBeGreaterThanOrEqual(K.intensity.emberMin);
        expect(s.strength).toBeLessThanOrEqual(1);
      });
      expect(n).toBeGreaterThan(50);
    }
  });

  it('⑦ 하한이 상수가 아니다 — 저주파 변조로 강약이 섞인다', () => {
    // "모든 경계에 최소 세기"를 `strength = emberMin` 상수로 구현하면 위 테스트는 통과하지만
    // 화면은 균일하게 다 켜져 오히려 촌스러워진다. 그래서 **하한 구간 안에서의 분산**을
    // 따로 잠근다.
    const { emberMin, emberMax } = K.intensity;
    for (const seed of [7, 31337, 2026]) {
      const cool: number[] = [];
      scan(seed, 20, (s) => {
        if (s.strength <= emberMax + 1e-9) cool.push(s.strength);
      });
      expect(cool.length).toBeGreaterThan(20);
      const lo = Math.min(...cool);
      const hi = Math.max(...cool);
      // 변조 폭의 최소 6할은 실제로 쓰여야 한다(상수 구현이면 0 이 된다).
      expect(hi - lo).toBeGreaterThan((emberMax - emberMin) * 0.6);
      const mean = cool.reduce((a, b) => a + b, 0) / cool.length;
      expect(mean).toBeGreaterThan(emberMin);
      expect(mean).toBeLessThan(emberMax);
    }
  });

  it('강한 채널이 등고선의 일부 구간만 차지한다(전부도 없음도 아니다)', () => {
    // 하한이 깔린 뒤에도 **강약의 구조**는 남아야 한다. 전부 강하면 평평해 보이고, 하나도
    // 없으면 하한만 남아 행성의 성격을 말하는 요소가 사라진다.
    for (const seed of [1, 909, 31337, 2026]) {
      let total = 0;
      let hot = 0;
      scan(seed, 22, (s) => {
        total++;
        if (s.strength >= 0.7) hot++;
      });
      const ratio = hot / total;
      expect(ratio).toBeGreaterThan(0.08);
      expect(ratio).toBeLessThan(0.7);
    }
  });

  it('④ 림은 **광원을 마주본** 절벽면에만 걸린다', () => {
    // 카르곤 광원 = 저지의 용암 → 표면→광원 벡터 (0,+1). 절벽 바깥 법선은 −n 이므로
    // lit = max(0,−ny). `ny < 0`(고지가 북쪽 = 절벽면이 남쪽 = 광원을 마주봄)이 밝은 쪽이다.
    expect(verticalLightDir(KARGON_THEME.light)).toBe(1);
    let up = 0;
    let down = 0;
    scan(777, 14, (s) => {
      if (s.ny < -0.5) {
        up++;
        expect(s.rim).toBeGreaterThan(0.3);
      } else if (s.ny > 0.5) {
        down++;
        expect(s.rim).toBe(0);
      }
    });
    expect(up).toBeGreaterThan(10);
    expect(down).toBeGreaterThan(10);
  });

  it('④ 조명 모델(segmentLit) 자체가 방향에 반응한다(상수 반환 항진 방지)', () => {
    // 이 함수가 상수가 되면 "전방위 균일" 로 되돌아간다.
    expect(segmentLit(0, -1, 1)).toBeCloseTo(1, 6); // 광원을 정면으로 마주본 면
    expect(segmentLit(0, 1, 1)).toBe(0); // 광원을 등진 면
    expect(segmentLit(1, 0, 1)).toBe(0); // 옆면
    expect(segmentLit(0, -0.5, 1)).toBeCloseTo(0.5, 6); // 중간값이 실제로 존재한다
    // 광원이 위인 행성에서는 밝은 면이 뒤집힌다 — 모델이 `toLightY` 를 실제로 쓴다는 증명.
    expect(segmentLit(0, -1, -1)).toBe(0);
    expect(segmentLit(0, 1, -1)).toBeCloseTo(1, 6);
  });

  it('④ AO·캐스트 섀도는 림의 **여집합**에 실린다(빛과 그림자가 같은 쪽에 몰리지 않는다)', () => {
    // 실제 결함: `ao` 와 `rim` 이 **둘 다** `fade(-ny)` 에 비례해, 가장 밝은 면이 동시에
    // 가장 짙게 그늘졌다. 두 신호가 상쇄돼 화면의 방향 정보가 0비트가 됐다.
    let litAo = 0;
    let litN = 0;
    let shadeAo = 0;
    let shadeN = 0;
    let litShadowMax = 0;
    let shadeShadowMax = 0;
    scan(888, 16, (s) => {
      expect(s.ao).toBeGreaterThanOrEqual(K.ao.floor); // 모든 경계에 AO 가 있다.
      expect(s.ao).toBeLessThanOrEqual(1);
      if (s.ny < -0.5) {
        litAo += s.ao;
        litN++;
        if (s.shadow > litShadowMax) litShadowMax = s.shadow;
      } else if (s.ny > 0.5) {
        shadeAo += s.ao;
        shadeN++;
        if (s.shadow > shadeShadowMax) shadeShadowMax = s.shadow;
      }
    });
    expect(litN).toBeGreaterThan(10);
    expect(shadeN).toBeGreaterThan(10);
    // **그늘진 면이 더 어둡다** — 한때 부호가 반대였고, 그 상태로도 테스트는 통과했다.
    expect(shadeAo / shadeN).toBeGreaterThan(litAo / litN + 0.15);
    // 캐스트 섀도는 빛을 등진 면에서만 생긴다.
    expect(litShadowMax).toBe(0);
    expect(shadeShadowMax).toBeGreaterThan(0.5);
  });

  it('④ 캐스트 섀도 방향은 저지 쪽이고, 빛 반대 편향이 실려 있다', () => {
    let checked = 0;
    scan(2468, 16, (s) => {
      if (s.shadow <= 0) return;
      checked++;
      // 단위 벡터다(오프셋 길이를 상수로 유지하는 전제).
      expect(Math.hypot(s.shadowX, s.shadowY)).toBeCloseTo(1, 6);
      // 저지 쪽 성분이 있다: (shadowX, shadowY)·n < 0.
      expect(s.shadowX * s.nx + s.shadowY * s.ny).toBeLessThan(0);
      // 빛 반대 방향(카르곤에서는 화면 위) 편향이 실려 순수 −n 보다 기운다.
      expect(s.shadowY).toBeLessThan(-s.ny);
    });
    expect(checked).toBeGreaterThan(20);
  });

  it('세그먼트 색이 **테마 팔레트 안에서만** 나온다(폴백이 창을 새지 않는다)', () => {
    // 한때 채널 색을 두 배열로 나눠 같은 인덱스로 뽑고 `?? 0xffa445` 폴백을 뒀다. 그 폴백은
    // 앰버 적탄에서 **2.1°** 떨어진 색이라, 도달하는 순간 배경이 적탄으로 읽힌다. 팔레트
    // 색상각 테스트는 팔레트만 훑으므로 이 구멍을 원리적으로 못 봤다.
    const allowed = new Set(terrainLightPalette(K));
    let checked = 0;
    scan(31337, 14, (s) => {
      checked++;
      expect(allowed.has(s.color)).toBe(true);
      expect(allowed.has(s.coreColor)).toBe(true);
    });
    expect(checked).toBeGreaterThan(50);
  });

  it('④ 같은 입력이면 같은 결과(월드 고정)', () => {
    const a = createSegment();
    const b = createSegment();
    evaluateSegment(KARGON_THEME, 31, 100, 200, 140, 260, a);
    evaluateSegment(KARGON_THEME, 31, 100, 200, 140, 260, b);
    expect(b).toEqual(a);
  });
});

describe('⑧ 색상 분리 — 배경 발광 ↔ 전경 위험물 (가독성 최우선)', () => {
  const palette = terrainLightPalette(K);

  it('전경 적탄 실측: 앰버 28.5° · hot-red 355.4° 가 배경 색상 창을 양쪽에서 좁힌다', () => {
    // 한때 심지가 `0xff8a30`(26.1°)이라 가속 적탄 `0xff8a20`(28.5°)과 **2.4° 차이**였다 —
    // 색상각으로는 같은 색이다. 그 사실 자체를 기록으로 잠근다.
    expect(hueOf(0xff8a20)).toBeCloseTo(28.5, 1);
    expect(hueOf(0xff8a30)).toBeCloseTo(26.1, 1);
    expect(hueDistance(0xff8a20, 0xff8a30)).toBeLessThan(TERRAIN_LIGHT_HUE_GAP / 3);
    expect(hueOf(0xff2233)).toBeCloseTo(355.4, 1);
  });

  it('카르곤이 손으로 얻은 [10°, 18.4°] 가 계산된 안전 골짜기 안에 들어간다', () => {
    // 이 두 숫자는 **입력이 아니라 파생값**이다. 테마 필드로 남기지 않은 이유가 그것이고,
    // 계산된 창이 그것을 품는다는 사실이 파생 관계의 증명이다.
    const windows = terrainLightSafeHueWindows();
    expect(hueInAnyWindow(10, windows)).toBe(true);
    expect(hueInAnyWindow(18.4, windows)).toBe(true);
  });

  it('배경 팔레트 전체가 계산된 안전 골짜기 안에 있다', () => {
    expect(palette.length).toBeGreaterThan(6);
    const windows = terrainLightSafeHueWindows();
    for (const c of palette) {
      expect(hueInAnyWindow(hueOf(c), windows)).toBe(true);
    }
  });

  it('배경 발광과 전경 신호색의 색상각 거리가 하한 이상이다', () => {
    for (const c of palette) {
      for (const fg of FOREGROUND_SIGNAL_COLORS) {
        expect(hueDistance(c, fg)).toBeGreaterThanOrEqual(TERRAIN_LIGHT_HUE_GAP);
      }
    }
  });

  it('가장 가까운 위협색(앰버 적탄)과의 최소 거리를 수치로 못박는다', () => {
    // 팔레트를 손대다 창 가장자리로 몰리는 것을 막는 별도 하한. 실측 최솟값 ≈10.4°.
    let worst = Infinity;
    for (const c of palette) worst = Math.min(worst, hueDistance(c, 0xff8a20));
    expect(worst).toBeGreaterThanOrEqual(10);
    expect(worst).toBeLessThan(20); // 창 자체가 좁다는 사실도 함께 기록(과도 이동 방지).
  });

  it('배경 발광은 채도가 높게 유지된다(저채도 = 흰색 쪽 = 가산에서 포화)', () => {
    // 비평은 "채도를 낮추거나 붉은 쪽으로 밀어라"였는데, 가산 합성에서 저채도는 흰색 포화로
    // 직결된다(흰 코어 탄과 오히려 더 닮는다). 그래서 분리는 **전부 색상각으로** 만들고
    // 채도는 오히려 높게 잠근다.
    for (const c of palette) expect(saturationOf(c)).toBeGreaterThan(0.7);
  });

  it('카르곤 팔레트는 주황~호박 대역이다(흰색 포화 금지: R>G>B, B 는 낮게)', () => {
    for (const c of palette) {
      const r = (c >> 16) & 0xff;
      const g = (c >> 8) & 0xff;
      const b = c & 0xff;
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(b);
      expect(b).toBeLessThan(0x70);
      // 이음매에서 코어 두 장이 겹쳐도 G 가 포화해 흰색이 되지 않게 묶는다.
      expect(g).toBeLessThanOrEqual(0x80);
    }
  });
});

describe('⑨ `gates.halo` 완화 — 끄기가 아니라 줄이기', () => {
  it('어떤 게이트 상태에서도 코어 배율이 0 이 아니다(발광이 사라지지 않는다)', () => {
    for (const halo of [true, false]) {
      for (const reduced of [true, false]) {
        const gs = glowGateScales(halo, reduced);
        expect(gs.core).toBeGreaterThan(0);
        expect(gs.glow).toBeGreaterThan(0);
        expect(gs.rim).toBeGreaterThan(0);
        // 배율은 상한 불변식을 깨면 안 된다.
        for (const v of [gs.core, gs.glow, gs.rim]) expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('완화 순서가 의도대로다: 정상 > 저티어(halo off) > 광과민(reducedGlow)', () => {
    const on = glowGateScales(true, false);
    const off = glowGateScales(false, false);
    const red = glowGateScales(true, true);
    expect(on.core).toBeGreaterThan(off.core);
    expect(off.core).toBeGreaterThan(red.core);
    // 넓은 겹(헤일로)을 좁은 겹(코어)보다 더 깎는다 — 밝은 **면적**을 줄이는 것이 목적.
    expect(off.glow).toBeLessThan(off.core);
    expect(red.glow).toBeLessThan(red.core);
    // 가장 넓은 겹은 완화 상태에서 완전히 끈다.
    expect(off.plume).toBe(false);
    expect(red.plume).toBe(false);
    expect(on.plume).toBe(true);
    // `reducedGlow` 는 게이트가 켜져 있어도 우선한다(티어와 직교).
    expect(glowGateScales(false, true)).toEqual(red);
  });

  it('완화 상태에서도 **눈에 보이는** 실효 알파가 남는다', () => {
    // 실제 결함이 이것이다: 저티어·reducedGlow 에서 가시 발광 0.
    const p = emitterPulse(0, 0.4);
    const lowTier = 0.62;
    const haloOff = emitterAlpha(K.core.alphaCap, 0.8, p, lowTier * HALO_OFF_CORE_SCALE);
    expect(haloOff).toBeGreaterThan(0.15);
    const reduced = emitterAlpha(K.core.alphaCap, 0.8, REDUCED_GLOW_PULSE, REDUCED_GLOW_CORE_SCALE);
    expect(reduced).toBeGreaterThan(0.12);
    // 그래도 정상 상태보다는 확실히 어둡다(완화의 취지).
    expect(reduced).toBeLessThan(emitterAlpha(K.core.alphaCap, 0.8, p, 1) * 0.6);
  });

  it('`reducedGlow` 는 맥동을 정지시킨다(광과민의 실제 위험은 주기적 변조다)', () => {
    expect(REDUCED_GLOW_PULSE).toBeGreaterThan(PULSE_MIN);
    expect(REDUCED_GLOW_PULSE).toBeLessThanOrEqual(PULSE_MAX);
  });
});

describe('레이어 계약', () => {
  const frame = (camX: number, camY: number, tick: number) => ({
    camX,
    camY,
    viewMinX: 0,
    viewMinY: 0,
    viewMaxX: 1920,
    viewMaxY: 1080,
    tick,
    dt: 1 / 60,
  });

  /** 담당 테마가 없는 행성 인덱스(레지스트리에 등록되지 않은 값). */
  const UNTHEMED = 999;

  it('담당 테마가 없는 행성에서는 스스로 꺼진다', () => {
    const layer = new TerrainLightLayer();
    expect(layer.configure({ planet: UNTHEMED, seed: 5 })).toBe(false);
    expect(layer.slot).toBe('floor');
    layer.destroy();
  });

  it('렌더러가 없어도(캔버스 없는 테스트) 던지지 않는다', () => {
    const layer = new TerrainLightLayer();
    expect(layer.configure({ planet: KARGON_PLANET, seed: 5 })).toBe(true);
    expect(() => layer.update(frame(0, 0, 12.5))).not.toThrow();
    expect(layer.segmentCount).toBeGreaterThan(0);
    layer.destroy();
  });

  it('화면 하나에 채널이 충분히 깔린다(얼룩 몇 개가 아니다)', () => {
    const layer = new TerrainLightLayer();
    layer.configure({ planet: KARGON_PLANET, seed: 20260729 });
    layer.update(frame(0, 0, 0));
    // 1920×1080 ≈ 30×17 타일. 등고선이 화면을 가로지르면 수십 개가 나온다.
    expect(layer.segmentCount).toBeGreaterThan(30);
    layer.destroy();
  });

  it('④ 카메라가 떠났다 돌아오면 같은 세그먼트 집합이 복원된다(월드 고정)', () => {
    const layer = new TerrainLightLayer();
    layer.configure({ planet: KARGON_PLANET, seed: 909 });
    layer.update(frame(0, 0, 0));
    const home = layer.segmentCount;
    layer.update(frame(9000, 4000, 300));
    layer.update(frame(0, 0, 600));
    expect(layer.segmentCount).toBe(home);
    layer.destroy();
  });

  it('비활성 상태에서 update 는 무비용·무해하다', () => {
    const layer = new TerrainLightLayer();
    layer.configure({ planet: UNTHEMED, seed: 1 });
    layer.update(frame(0, 0, 1));
    expect(layer.segmentCount).toBe(0);
    layer.destroy();
  });

  it('⑦ 정상 티어에서 **모든** 세그먼트가 발광한다(꺼진 경계 0)', () => {
    const layer = new TerrainLightLayer();
    layer.configure({ planet: KARGON_PLANET, seed: 20260729 });
    layer.update(frame(0, 0, 0));
    expect(layer.segmentCount).toBeGreaterThan(30);
    expect(layer.minSegmentStrength).toBeGreaterThanOrEqual(K.intensity.emberMin);
    // 헤일로+코어가 세그먼트마다 하나씩 보인다 → 최소 2×count.
    expect(layer.visibleGlowCount).toBeGreaterThanOrEqual(layer.segmentCount * 2);
    expect(layer.peakCoreAlpha).toBeGreaterThan(0.3);
    layer.destroy();
  });

  it('⑦ 띠 두께가 세기에 따라 변한다(약한 경계=가는 선, 강한 채널=넓은 강)', () => {
    graphicsTierController.tick(120, 1, 'high');
    const layer = new TerrainLightLayer();
    layer.configure({ planet: KARGON_PLANET, seed: 20260729 });
    layer.update(frame(0, 0, 0));
    // wScale = widthBase + widthGain·strength 이므로 strength∈[emberMin,1] 에서 비가 1 을 넘는다.
    expect(layer.glowWidthSpread).toBeGreaterThan(1.3);
    layer.destroy();
  });

  it('⑦ 세 번째 넓은 겹은 약한 경계에 붙지 않는다(균일한 안개 방지)', () => {
    graphicsTierController.tick(120, 1, 'high');
    const layer = new TerrainLightLayer();
    layer.configure({ planet: KARGON_PLANET, seed: 20260729 });
    layer.update(frame(0, 0, 0));
    const plumes = layer.visiblePlumeCount;
    // 진짜 강한 채널에는 붙는다.
    expect(plumes).toBeGreaterThan(0);
    // 그러나 모든 경계에는 붙지 않는다 — 가장 넓은 겹이라 전면 적용이 화면을 안개로 만든다.
    expect(plumes).toBeLessThan(layer.segmentCount * 0.7);
    layer.destroy();
  });

  it('⑨ 저티어에서도 가시 발광이 남는다(종단 회귀 테스트)', () => {
    // 한때 여기서 가시 발광 4종 157개 중 **0개**였다.
    graphicsTierController.tick(20, 1, 'low');
    try {
      const layer = new TerrainLightLayer();
      layer.configure({ planet: KARGON_PLANET, seed: 20260729 });
      layer.update(frame(0, 0, 0));
      expect(layer.segmentCount).toBeGreaterThan(10);
      expect(layer.visibleGlowCount).toBeGreaterThan(0);
      expect(layer.peakCoreAlpha).toBeGreaterThan(0.1);
      layer.destroy();
    } finally {
      graphicsTierController.tick(120, 1, 'high');
    }
  });

  it('⑨ `reducedGlow` 에서도 가시 발광이 남고, 밝기는 확실히 줄어든다', () => {
    const layer = new TerrainLightLayer();
    layer.configure({ planet: KARGON_PLANET, seed: 20260729 });
    layer.update(frame(0, 0, 0));
    const normal = layer.peakCoreAlpha;
    expect(normal).toBeGreaterThan(0.3);

    graphicsSettings.setReducedGlow(true);
    try {
      layer.update(frame(0, 0, 1));
      const reduced = layer.peakCoreAlpha;
      expect(reduced).toBeGreaterThan(0); // 사라지지 않는다.
      expect(reduced).toBeGreaterThan(0.1); // 그리고 실제로 보인다.
      expect(reduced).toBeLessThan(normal * 0.6); // 그러나 확실히 어둡다.

      // 광과민 대응: 틱이 흘러도 밝기가 변하지 않는다(깜빡임 0).
      layer.update(frame(0, 0, 137));
      expect(layer.peakCoreAlpha).toBe(reduced);
      layer.update(frame(0, 0, 401));
      expect(layer.peakCoreAlpha).toBe(reduced);
    } finally {
      graphicsSettings.setReducedGlow(false);
      layer.destroy();
    }
  });

  // -------------------------------------------------------------------------
  // ⑩ "그려졌는가"가 아니라 **"덮이지 않았는가"**
  // -------------------------------------------------------------------------

  it('⑩ [합성 순서] 곱연산 두 겹(AO·캐스트 섀도)이 가산 헤일로보다 **나중에** 칠해진다', () => {
    // 결함이 정확히 이 순서였다: `ao` → `glow`. AO 의 자취는 헤일로의 부분집합이라 나중에
    // 칠해진 가산 헤일로가 곱연산 어둠을 통째로 되돌렸다 — 알파를 올려도 안 보인다.
    // 이 단언은 스프라이트 속성으로는 원리적으로 표현 불가능하다. 순서 자체를 잠근다.
    const layer = new TerrainLightLayer();
    layer.configure({ planet: KARGON_PLANET, seed: 20260729 });
    const order = layer.layerOrder;
    const at = (n: string) => order.indexOf(n);
    expect(at('dusk')).toBe(0);
    expect(at('glow')).toBeGreaterThan(at('dusk'));
    expect(at('shadow')).toBeGreaterThan(at('glow'));
    expect(at('ao')).toBeGreaterThan(at('glow'));
    // 코어·림은 AO 보다 위 — 좁은 겹이 홈에 먹히면 심지가 사라진다.
    expect(at('core')).toBeGreaterThan(at('ao'));
    expect(at('rim')).toBeGreaterThan(at('core'));
    layer.destroy();
  });

  it('⑩ [AO 띠] 모든 세그먼트에 붙고, 폭이 목표 범위이며, 실제로 어둡게 한다', () => {
    graphicsTierController.tick(120, 1, 'high');
    const layer = new TerrainLightLayer();
    layer.configure({ planet: KARGON_PLANET, seed: 20260729 });
    layer.update(frame(0, 0, 0));
    expect(layer.segmentCount).toBeGreaterThan(30);
    // ① 모든 경계에 있다("지형 경계에 릴리프가 0" 비평의 처방).
    expect(layer.visibleAoCount).toBe(layer.segmentCount);
    // ② **띠**의 폭 — 흐린 방사 블롭으로 되돌리면 깨진다.
    const w = layer.aoBandWidthWorld;
    expect(w).toBeGreaterThanOrEqual(K.ao.width * 0.95);
    expect(w).toBeLessThanOrEqual(K.ao.width * 1.05);
    expect(w).toBeLessThan(30); // 화면 4~8px 문법에 대응하는 상한(월드 기준).
    // ③ 틴트까지 포함한 **실효 곱연산 배율** — 알파만 재면 틴트를 흰색으로 바꿔도 통과한다.
    expect(layer.aoDarkestFactor).toBeLessThan(0.7);
    layer.destroy();
  });

  it('⑩ [띠의 가장자리] AO 프로파일에 **평정부**가 있다 — 흐린 블롭이 아니다', () => {
    // AO 가 안 보인 이유의 절반은 폭이 아니라 **가장자리 부재**였다. `plateau` 를 0 으로
    // 되돌리면 폭·알파·오프셋이 전부 그대로여도 화면에서 다시 띠로 안 읽히므로 여기서 잡는다.
    expect(K.ao.plateau).toBeGreaterThan(0.3);
    // 평정부 안은 정확히 1(납작한 머리).
    for (const t of [0, 0.2, K.ao.plateau]) {
      expect(bandProfile(t, K.ao.falloffExp, K.ao.plateau)).toBe(1);
    }
    // 평정부 밖은 빠르게 떨어진다(또렷한 가장자리).
    const edge = bandProfile((1 + K.ao.plateau) / 2, K.ao.falloffExp, K.ao.plateau);
    expect(edge).toBeLessThan(0.25);
    expect(bandProfile(1, K.ao.falloffExp, K.ao.plateau)).toBe(0);
    // 대조군: 헤일로용 소프트 프로파일(plateau=0)은 평정부가 없다 — 두 모양이 실제로 다르다.
    expect(bandProfile(0.2, K.glow.profileExp, 0)).toBeLessThan(1);
    // 단조 감소(프로파일이 뒤집히면 링 누적이 음수 알파를 낸다).
    let prev = 1;
    for (let t = 0; t <= 1; t += 0.05) {
      const v = bandProfile(t, K.ao.falloffExp, K.ao.plateau);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });

  it('⑩ [자취] AO 는 고지(+n) 쪽, 캐스트 섀도·림은 저지(−n) 쪽에 놓인다', () => {
    graphicsTierController.tick(120, 1, 'high');
    const layer = new TerrainLightLayer();
    layer.configure({ planet: KARGON_PLANET, seed: 909 });
    layer.update(frame(0, 0, 0));
    expect(layer.sideViolations).toEqual({ ao: 0, shadow: 0, rim: 0 });
    layer.destroy();
  });

  it('⑩ [캐스트 섀도] 저지 쪽에만 생기고, 세그먼트의 일부에만 붙는다', () => {
    graphicsTierController.tick(120, 1, 'high');
    const layer = new TerrainLightLayer();
    layer.configure({ planet: KARGON_PLANET, seed: 20260729 });
    layer.update(frame(0, 0, 0));
    const n = layer.visibleShadowCount;
    // 실제로 존재한다(0 이면 "구현했다"가 거짓이다).
    expect(n).toBeGreaterThan(layer.segmentCount * 0.15);
    // 그러나 전 구간은 아니다 — 전방위 균일이면 다시 층이 안 읽힌다.
    expect(n).toBeLessThan(layer.segmentCount * 0.85);
    layer.destroy();
  });

  it('⑩ [방향성 림] 세기와 폭이 **둘 다** 법선 방향에 따라 갈린다', () => {
    // 비평: "림 발광이 모든 방위에서 세기·폭이 동일하다". 알파만 변조하는 구현으로 되돌리면
    // `litSpread` 가 1 이 되어 이 단언이 깨진다.
    graphicsTierController.tick(120, 1, 'high');
    const layer = new TerrainLightLayer();
    layer.configure({ planet: KARGON_PLANET, seed: 20260729 });
    layer.update(frame(0, 0, 0));
    const r = layer.rimByFacing;
    expect(r.litAlpha).toBeGreaterThan(0.2); // 빛 받는 면은 확실히 보인다.
    expect(r.shadeAlpha).toBe(0); // 등진 면은 아예 없다.
    expect(r.litSpread).toBeGreaterThan(1.2); // 폭도 균일하지 않다.
    layer.destroy();
  });

  it('⑩ [명도 셋째 봉우리] AO·섀도·황혼이 만드는 중간톤이 상·하부 명도 **사이**에 있다', () => {
    // 비평: "명도가 2단계뿐". 아핀 그레이딩으로 못 만든 중간톤을 **기하**로 만든다는 것이
    // 전제이므로, 세 겹의 곱연산 배율이 실제로 그 사이에 앉는지를 계산으로 잠근다.
    const tintR = (c: number) => ((c >> 16) & 0xff) / 255;
    const duskF = 1 - K.dusk.alpha * (1 - tintR(K.dusk.tint)); // 지각 전반
    const aoF = duskF * (1 - K.ao.alphaCap * (1 - tintR(K.ao.tint))); // 황혼 + AO 홈
    const shadowF = duskF * (1 - K.shadow.alphaCap * (1 - tintR(K.shadow.tint))); // 황혼 + 캐스트 섀도
    // 봉우리 셋: 암괴(≈0) < 그림자 대역 < 지각.
    expect(aoF).toBeLessThan(shadowF);
    expect(shadowF).toBeLessThan(duskF);
    // 그림자 대역이 지각과 **눈에 띄게** 갈라진다(0.9 배쯤이면 같은 봉우리로 뭉친다).
    expect(shadowF).toBeLessThan(duskF * 0.85);
    expect(aoF).toBeLessThan(duskF * 0.65);
    // 그러나 완전히 검게 죽지도 않는다 — 죽으면 봉우리가 다시 둘이 된다(암괴에 흡수).
    expect(aoF).toBeGreaterThan(0.2);
  });

  it('⑩ [가독성] 황혼이 지각을 실제로 누른다(주황 적 위장 대책)', () => {
    // 전투 프레임 신고: 주황 적 탱크가 주황 지각 위에서 위장. `floor` 슬롯 곱연산은 지형만
    // 누르고 엔티티는 안 건드리는 유일한 장치라 이 값이 전경-배경 분리의 근거다.
    expect(K.dusk.alpha).toBeGreaterThan(0.32);
    const duskF = 1 - K.dusk.alpha * (1 - ((K.dusk.tint >> 16) & 0xff) / 255);
    expect(duskF).toBeLessThan(0.78);
    const layer = new TerrainLightLayer();
    layer.configure({ planet: KARGON_PLANET, seed: 42 });
    layer.update(frame(0, 0, 0));
    expect(layer.layerOrder[0]).toBe('dusk');
    layer.destroy();
  });

  it('반복 update 가 세그먼트 수를 흔들지 않는다(재구성 캐시가 안정적)', () => {
    const layer = new TerrainLightLayer();
    layer.configure({ planet: KARGON_PLANET, seed: 42 });
    layer.update(frame(0, 0, 0));
    const n = layer.segmentCount;
    for (let t = 1; t < 30; t++) layer.update(frame(0, 0, t));
    expect(layer.segmentCount).toBe(n);
    layer.destroy();
  });
});

// ---------------------------------------------------------------------------
// ⑪ 임의 테마가 만족해야 하는 계약
//
// 위 단언들은 대부분 카르곤 상수를 검사한다. 그건 카르곤을 지키지만 **니플헤임이 서릿발 폭을
// 넓혔을 때 조용히 같은 함정을 밟는 것**은 못 막는다. 값 사이의 관계로만 존재하는 불변식은
// 전 테마를 도는 계약으로 승격돼야 한다.
// ---------------------------------------------------------------------------

describe('⑪ 겹 등록·합성 순서는 규칙이지 목록이 아니다', () => {
  it('모든 겹이 정확히 한 단에 배정돼 있다', () => {
    const ids = new Set(TERRAIN_LIGHT_LAYERS.map((l) => l.id));
    expect(ids.size).toBe(TERRAIN_LIGHT_LAYERS.length);
    for (const l of TERRAIN_LIGHT_LAYERS) {
      expect(TERRAIN_LIGHT_STAGES).toContain(l.stage);
    }
  });

  it('곱연산 접지 겹은 **항상** 넓은 가산 겹보다 뒤에 온다(테마가 못 뒤집는다)', () => {
    const order = terrainLightOrder(() => true);
    const at = (id: string) => order.indexOf(id as never);
    expect(at('glow')).toBeLessThan(at('shadow'));
    expect(at('glow')).toBeLessThan(at('ao'));
    expect(at('ao')).toBeLessThan(at('core'));
    expect(at('dusk')).toBe(0);
  });

  it('겹을 빼도 나머지 상대 순서가 보존된다(행성마다 겹 집합이 다르다)', () => {
    const full = terrainLightOrder(() => true);
    const noPlume = terrainLightOrder((id) => id !== 'plume');
    expect(noPlume).toEqual(full.filter((id) => id !== 'plume'));
    expect(noPlume).not.toContain('plume');
    // 카르곤은 세 번째 넓은 겹을 켠다.
    expect(K.plume).toBeDefined();
  });
});

describe('⑪ 등록된 모든 테마가 계약을 만족한다', () => {
  it('레지스트리가 비어 있지 않다(공회전 방지)', () => {
    expect(ENV_THEMES.length).toBeGreaterThan(0);
  });

  for (const theme of ENV_THEMES) {
    describe(`테마 ${theme.id}`, () => {
      const t = theme.terrainLight;

      it('검증기가 위반을 보고하지 않는다', () => {
        expect(validateTerrainLightTheme(t)).toEqual([]);
      });

      it('자취가 겹쳐 서로를 먹지 않는다(오프셋 ± 폭/2 관계)', () => {
        const coreHalf = t.core.width / 2;
        // AO 띠가 심지를 먹으면 코어가 사라진다.
        expect(t.ao.offset).toBeGreaterThan(coreHalf);
        // 림이 심지 안에 갇히면 기여가 묻힌다 — 폭 반쪽까지 빼야 실제로 밖이다.
        expect(t.rim.offset).toBeLessThan(-coreHalf);
        expect(Math.abs(t.rim.offset) - t.rim.width / 2).toBeGreaterThan(coreHalf);
        // 캐스트 섀도와 접지 AO 가 같은 층으로 뭉치면 안 된다.
        expect(t.shadow.offset).toBeGreaterThan(t.ao.offset * 2);
        // AO 가 넓은 겹의 진부분집합에 가까우면 "띠"가 아니라 "얼룩"이다.
        expect(t.ao.width).toBeLessThan(t.glow.width * 0.5);
        expect(t.ao.width).toBeLessThan(t.shadow.width * 0.5);
      });

      it('세기 하한이 화면에서 실제로 보인다(실효 알파 붕괴 금지)', () => {
        expect(t.intensity.emberMin).toBeGreaterThan(0);
        for (const cap of [t.glow.alphaCap, t.core.alphaCap]) {
          expect(t.intensity.emberMin * cap).toBeGreaterThanOrEqual(MIN_EFFECTIVE_ALPHA);
        }
      });

      it('폭 변조가 살아 있다(약한 경계가 화면을 도배하지 않는다)', () => {
        expect(t.intensity.widthGain).toBeGreaterThan(0);
        expect(t.intensity.widthBase + t.intensity.widthGain).toBeLessThanOrEqual(1);
        expect(t.rim.widthFloor).toBeLessThan(1);
      });

      it('팔레트가 전경 신호색과 색상각으로 분리된다', () => {
        const palette = terrainLightPalette(t);
        expect(palette.length).toBeGreaterThan(0);
        const windows = terrainLightSafeHueWindows();
        for (const c of palette) {
          expect(hueInAnyWindow(hueOf(c), windows)).toBe(true);
          for (const fg of FOREGROUND_SIGNAL_COLORS) {
            expect(hueDistance(c, fg)).toBeGreaterThanOrEqual(TERRAIN_LIGHT_HUE_GAP);
          }
        }
      });

      it('2단 구조가 성립한다(심지가 헤일로보다 확실히 밝고 날카롭다)', () => {
        expect(t.core.alphaCap).toBeGreaterThanOrEqual(t.glow.alphaCap * 1.8);
        expect(t.core.profileExp).toBeGreaterThan(t.glow.profileExp);
        expect(t.dusk.alpha).toBeLessThan(t.glow.alphaCap);
      });

      it('세 번째 넓은 겹이 있다면 약한 경계에는 안 붙는다', () => {
        if (t.plume === undefined) return;
        expect(t.plume.minStrength).toBeGreaterThan(t.intensity.emberMax);
      });
    });
  }
});

describe('⑪ 검증기가 실제로 무언가를 잡는다(항진 방지)', () => {
  // 아무것도 못 잡는 검증기는 검증기가 아니다. 아래는 전부 카르곤이 실제로 밟았거나
  // 다음 행성이 밟을 것이 확실한 변형이며, **하나라도 통과하면 그 불변식은 사문화된 것**이다.
  const broken = (patch: Partial<TerrainLightTheme>): TerrainLightTheme => ({ ...K, ...patch });

  /**
   * `where` 만 보면 안 된다 — 한 필드에 불변식이 둘 이상 걸린 경우(예: `ao.width` 는 헤일로
   * 대비와 캐스트 섀도 대비 둘 다 검사한다) 한쪽을 지워도 **다른 쪽이 대신 발화해 테스트가
   * 그대로 통과한다.** 실제로 검증기 뮤테이션에서 그 일이 일어났다. 그래서 메시지까지 짚어
   * 불변식을 개별로 관측한다.
   */
  const caught = (
    v: ReturnType<typeof validateTerrainLightTheme>,
    where: string,
    msgPart: string,
  ): boolean => v.some((x) => x.where === where && x.message.includes(msgPart));

  it('AO 띠를 헤일로만큼 넓히면 잡는다(넓은 가산 겹 대비 진부분집합 금지)', () => {
    const v = validateTerrainLightTheme(broken({ ao: { ...K.ao, width: K.glow.width } }));
    expect(caught(v, 'ao.width', '헤일로에 대해 띠로 읽히기엔 넓다')).toBe(true);
  });

  it('AO 띠를 캐스트 섀도만큼 넓히면 잡는다(두 곱연산 겹이 안 갈린다)', () => {
    // 위 단언과 **별개의 불변식**이다. 헤일로 대비만 검사하면 이 변형이 살아남는다.
    const v = validateTerrainLightTheme(broken({ ao: { ...K.ao, width: K.shadow.width * 0.8 } }));
    expect(caught(v, 'ao.width', '접지 AO 와 캐스트 섀도의 폭이 안 갈린다')).toBe(true);
  });

  it('AO 오프셋을 심지 반폭 안으로 넣으면 잡는다', () => {
    const v = validateTerrainLightTheme(broken({ ao: { ...K.ao, offset: 1 } }));
    expect(caught(v, 'ao.offset', 'AO 띠가 심지를 먹는다')).toBe(true);
  });

  it('림을 고지 쪽으로 되돌리면 잡는다(코어 안에 갇힌 상태)', () => {
    const v = validateTerrainLightTheme(broken({ rim: { ...K.rim, offset: 5 } }));
    expect(caught(v, 'rim.offset', '림이 심지 안에 갇힌다')).toBe(true);
  });

  it('림 오프셋은 코어 밖인데 **띠 반폭이 아직 코어 안**이면 잡는다', () => {
    // 오프셋 부호만 보는 검사로는 못 잡는다 — 림은 폭을 가진 띠라 반폭까지 빼야 실제로 밖이다.
    const rimOffset = -(K.core.width / 2) - 1; // 부호 조건은 통과한다.
    const v = validateTerrainLightTheme(
      broken({ rim: { ...K.rim, offset: rimOffset, width: 20 } }),
    );
    expect(caught(v, 'rim.offset', '림이 심지 안에 갇힌다')).toBe(false); // 부호 검사는 통과
    expect(caught(v, 'rim.width', '안쪽 가장자리가 아직 심지 안이다')).toBe(true);
  });

  it('캐스트 섀도를 AO 와 같은 층으로 끌어오면 잡는다', () => {
    const v = validateTerrainLightTheme(broken({ shadow: { ...K.shadow, offset: K.ao.offset } }));
    expect(caught(v, 'shadow.offset', '같은 층으로 뭉친다')).toBe(true);
  });

  it('평정부를 0 으로 되돌리면 잡는다(띠가 블롭이 된다)', () => {
    const v = validateTerrainLightTheme(broken({ ao: { ...K.ao, plateau: 0 } }));
    expect(caught(v, 'ao.plateau', '또렷한 띠가 아니라 흐린 블롭')).toBe(true);
  });

  it('세기 하한을 0 으로 만들면 잡는다(꺼진 경계가 돌아온다)', () => {
    const v = validateTerrainLightTheme(broken({ intensity: { ...K.intensity, emberMin: 0 } }));
    expect(caught(v, 'intensity.emberMin', '완전히 꺼진 경계가 생긴다')).toBe(true);
  });

  it('세기 하한이 0 은 아니지만 실효 알파가 붕괴 수준이면 잡는다', () => {
    // "0 이 아니다"만 검사하면 0.01 도 통과한다 — 그건 화면에서 꺼진 것과 구별되지 않는다.
    // 이게 **별개의 불변식**이라는 증명: 위 "0 이 아니다" 검사는 여기서 발화하지 않는다.
    const v = validateTerrainLightTheme(broken({ intensity: { ...K.intensity, emberMin: 0.01 } }));
    expect(caught(v, 'intensity.emberMin', '완전히 꺼진 경계가 생긴다')).toBe(false);
    expect(caught(v, 'intensity.emberMin', '실효 알파가 붕괴 수준이다')).toBe(true);
  });

  it('팔레트 색 하나를 적탄 옆으로 옮기면 잡는다', () => {
    const v = validateTerrainLightTheme(
      // 앰버 적탄(0xff8a20, 28.5°) 바로 옆 색.
      broken({ channel: [{ glow: 0xff8c22, core: K.channel[0].core }] }),
    );
    expect(caught(v, 'channel', '안전 골짜기 밖이다')).toBe(true);
    expect(caught(v, 'channel', '밖에 안 떨어졌다')).toBe(true);
  });

  it('폭 변조를 없애면 잡는다', () => {
    const v = validateTerrainLightTheme(
      broken({ intensity: { ...K.intensity, widthBase: 1, widthGain: 0 } }),
    );
    expect(caught(v, 'intensity.widthGain', '폭 변조가 0 이면')).toBe(true);
  });

  it('잔열 변조 스케일을 지역 필드에 붙이면 잡는다(변조가 복사본이 된다)', () => {
    const v = validateTerrainLightTheme(
      broken({ intensity: { ...K.intensity, emberModTiles: K.intensity.regionTiles } }),
    );
    expect(caught(v, 'intensity.emberModTiles', '스케일이 너무 가깝다')).toBe(true);
  });

  it('세 번째 넓은 겹을 전 구간에 붙이면 잡는다(균일한 안개)', () => {
    if (K.plume === undefined) return;
    const v = validateTerrainLightTheme(
      broken({ plume: { ...K.plume, minStrength: K.intensity.emberMin } }),
    );
    expect(caught(v, 'plume.minStrength', '균일한 안개')).toBe(true);
  });

  it('심지를 헤일로만큼만 밝게 하면 잡는다(2단 구조 붕괴)', () => {
    const v = validateTerrainLightTheme(broken({ core: { ...K.core, alphaCap: K.glow.alphaCap } }));
    expect(caught(v, 'core.alphaCap', '광원으로 안 읽힌다')).toBe(true);
  });

  it('심지 falloff 를 헤일로만큼 완만하게 하면 잡는다', () => {
    const v = validateTerrainLightTheme(
      broken({ core: { ...K.core, profileExp: K.glow.profileExp } }),
    );
    expect(caught(v, 'core.profileExp', '2단 구조가 무너진다')).toBe(true);
  });

  it('황혼을 국소 발광보다 세게 하면 잡는다', () => {
    const v = validateTerrainLightTheme(
      broken({ dusk: { ...K.dusk, alpha: K.glow.alphaCap + 0.01 } }),
    );
    expect(caught(v, 'dusk.alpha', '국소 발광보다 강하다')).toBe(true);
  });

  it('림 폭 변조를 균일하게 만들면 잡는다', () => {
    const v = validateTerrainLightTheme(broken({ rim: { ...K.rim, widthFloor: 1 } }));
    expect(caught(v, 'rim.widthFloor', '폭 변조가 사문화됐다')).toBe(true);
  });

  it('넓은 겹의 상한을 올리면 잡는다', () => {
    const v = validateTerrainLightTheme(broken({ shadow: { ...K.shadow, alphaCap: 0.7 } }));
    expect(caught(v, 'shadow.alphaCap', '넓은 겹의 상한이 과하다')).toBe(true);
  });
});
