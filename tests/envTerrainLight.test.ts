/**
 * 카르곤 용암 발광 레이어의 **불변식** 잠금.
 *
 * 이 레이어는 화면에 색을 얹는 일이라 "그럴싸해 보이는가"는 눈으로만 판정된다. 그래서 테스트는
 * 눈으로 못 잡는 것, 그리고 **눈으로 놓쳐서 1차가 기각된 것**만 잠근다:
 *
 *  ① 맥동이 `tick` 의 순수 함수인가 — 벽시계를 쓰면 탭 복귀·프레임 스킵에서 밝기가 튀고,
 *     그건 재현이 안 돼서 사람이 못 잡는다.
 *  ② 그런데 tick 이 변하면 실제로 값이 변하는가 — ①만 있으면 "상수를 반환"해도 통과한다(항진).
 *  ③ 밝기가 상한을 절대 넘지 않는가 — 넘으면 발광이 적·탄·젬을 씻어 게임플레이가 깨진다.
 *  ④ 같은 (seed, 월드 위치) 가 같은 등고선·열 필드를 내는가 — 카메라가 돌아왔을 때 같은 자리가
 *     뜨겁다는 보장이며, 리플레이 재현의 근거다.
 *  ⑤ **용암이 실제로 이어지는가** — 1차는 방사형 블롭이라 "주황 얼룩"이었다. 마칭 스퀘어즈
 *     세그먼트가 끝점을 공유하는지(사슬인지)를 구조로 확인한다.
 *  ⑥ **밝기가 실제로 살아 있는가** — 1차의 기각 사유는 실효 알파 0.05 붕괴였다. 상한만
 *     검사하면 "전부 0"도 통과한다(항진). 그래서 **하한도** 잠근다. 밝기 항을 죽이면
 *     이 블록이 실패해야 한다(뮤테이션 검증의 대상).
 *  ⑩ **그려졌는가가 아니라 덮이지 않았는가** (4차 신설, `describe('⑩ ...')`).
 *     3차의 AO·림은 `visible=true`·`alpha>0` 이었고 이 파일은 전부 그린이었는데 화면에는
 *     없었다. 3차 단언이 전부 *레코드 속성*(`seg.ao > 0`)이나 *스프라이트 알파*였고,
 *     **"이 자취가 다른 겹에 덮이는가"를 아무도 안 쟀기 때문**이다. 그래서 4차는
 *     ⓐ 합성 순서(`layerOrder`) ⓑ 자취의 폭·오프셋 부호 ⓒ 틴트까지 넣은 실효 곱연산 배율
 *     ⓓ 법선 방향에 따른 림 편향 — 넷을 직접 잠근다. 눈으로 못 잡은 것이 아니라
 *     **테스트가 볼 수 있는 축을 안 만들었던** 실패다.
 */

import { describe, it, expect } from 'vitest';
import {
  AO_ALPHA,
  AO_BAND_EXP,
  AO_BAND_OFFSET,
  AO_BAND_PLATEAU,
  AO_BAND_WIDTH,
  AO_FLOOR,
  CORE_ALPHA,
  DISPLAY_TILE,
  UPPER_THRESHOLD,
  DUSK_ALPHA,
  EMBER_MAX,
  EMBER_MIN,
  FOREGROUND_SIGNAL_COLORS,
  GLOW_ALPHA,
  HALO_OFF_CORE_SCALE,
  HEAT_ALPHA,
  HOSTILE_HUE_GAP,
  TerrainLightLayer,
  LAVA_HUE_MAX,
  LAVA_HUE_MIN,
  LAVA_PALETTE,
  MAX_SEG_PER_CELL,
  PULSE_MAX,
  PULSE_MIN,
  REDUCED_GLOW_CORE_SCALE,
  REDUCED_GLOW_PULSE,
  RIM_ALPHA,
  RIM_OFFSET,
  SEG_STRIDE,
  SHADOW_ALPHA,
  SHADOW_OFFSET,
  SHADOW_WIDTH,
  TO_LIGHT_Y,
  bandProfile,
  createSegment,
  emitterAlpha,
  evaluateSegment,
  glowGateScales,
  heatPulse,
  hueDistance,
  hueOf,
  marchCell,
  marchCorners,
  saturationOf,
  segmentLit,
  terrainFieldAt,
  terrainGradient,
} from '../src/render/env/terrainLight.js';
import { graphicsSettings } from '../src/render/graphicsSettings.js';
import { graphicsTierController } from '../src/render/graphicsRuntime.js';

/** 셀 하나의 마칭 결과를 담는 스크래치. */
const cellOut = (): number[] => new Array<number>(SEG_STRIDE * MAX_SEG_PER_CELL).fill(0);

describe('용암 맥동(heatPulse)', () => {
  it('① 같은 tick·phase 면 항상 같은 값(순수 함수)', () => {
    for (const tick of [0, 1.5, 137.25, 9999.75]) {
      for (const phase of [0, 0.31, 0.87]) {
        expect(heatPulse(tick, phase)).toBe(heatPulse(tick, phase));
      }
    }
  });

  it('② tick 이 변하면 값이 변한다(상수 반환 항진 방지)', () => {
    const base = heatPulse(0, 0.4);
    expect(Math.abs(heatPulse(87, 0.4) - base)).toBeGreaterThan(0.05);
    const seen = new Set<number>();
    for (let t = 0; t < 600; t += 7) seen.add(Math.round(heatPulse(t, 0.4) * 1000));
    expect(seen.size).toBeGreaterThan(20);
  });

  it('② 위상이 다르면 용암이 한꺼번에 숨쉬지 않는다', () => {
    expect(heatPulse(120, 0)).not.toBe(heatPulse(120, 0.5));
  });

  it('③ 어떤 tick·phase 에서도 [PULSE_MIN, PULSE_MAX] 를 벗어나지 않는다', () => {
    for (let t = 0; t < 20000; t += 3.7) {
      for (const phase of [0, 0.17, 0.5, 0.93]) {
        const v = heatPulse(t, phase);
        expect(v).toBeGreaterThanOrEqual(PULSE_MIN);
        expect(v).toBeLessThanOrEqual(PULSE_MAX);
      }
    }
  });

  it('③ 음수·비정상 tick 에서도 범위를 지킨다(방어)', () => {
    for (const t of [-1, -12345.5, 1e6]) {
      const v = heatPulse(t, 0.25);
      expect(v).toBeGreaterThanOrEqual(PULSE_MIN);
      expect(v).toBeLessThanOrEqual(PULSE_MAX);
    }
  });

  it('⑥ 맥동이 밝기를 깎는 장치가 되지 않는다(평균이 충분히 높다)', () => {
    // 1차 실패 원인 중 하나: 파형 중심 0.6 이 실효 알파를 40% 깎았다. 맥동은 "숨"이지
    // "감쇠"가 아니다. 평균이 0.7 아래로 내려가면 그 회귀다.
    let sum = 0;
    let n = 0;
    for (let t = 0; t < 4000; t += 3) {
      for (const phase of [0, 0.23, 0.61, 0.88]) {
        sum += heatPulse(t, phase);
        n++;
      }
    }
    expect(sum / n).toBeGreaterThan(0.7);
  });
});

describe('알파 상한(emitterAlpha)', () => {
  const caps = [GLOW_ALPHA, CORE_ALPHA, RIM_ALPHA, HEAT_ALPHA, AO_ALPHA, SHADOW_ALPHA];

  it('③ 세기·맥동·티어 조합이 무엇이든 상한을 넘지 않는다', () => {
    for (const cap of caps) {
      for (const strength of [0, 0.13, 0.5, 1]) {
        for (let t = 0; t < 900; t += 11) {
          for (const tier of [0.62, 0.88, 1]) {
            const a = emitterAlpha(cap, strength, heatPulse(t, 0.6), tier);
            expect(a).toBeGreaterThanOrEqual(0);
            expect(a).toBeLessThanOrEqual(cap);
          }
        }
      }
    }
  });

  it('③ 상한이 면적에 반비례한다(넓은 겹은 낮게, 좁은 겹만 밝게)', () => {
    // "좁고 확실히 밝게, 넓고 은은하게" 를 수치로 잠근다. 넓은 겹의 상한을 올리는 것이
    // 화면을 탁하게 만드는 전형적 실패라, 넓은 쪽만 보수적으로 묶는다.
    //
    // 4차에서 **AO 가 넓은 쪽에서 좁은 쪽으로 이사했다** — 폭 58 의 흐린 블롭에서 폭 16 의
    // 또렷한 띠가 됐으므로 같은 규칙 아래 상한이 올라간다. 규칙 자체는 그대로다: 이 단언은
    // 알파가 아니라 **폭과 짝지어야** 의미가 있으므로 아래에서 폭도 함께 잠근다.
    for (const wide of [GLOW_ALPHA, HEAT_ALPHA, SHADOW_ALPHA, DUSK_ALPHA]) {
      expect(wide).toBeLessThanOrEqual(0.55);
    }
    for (const narrow of [CORE_ALPHA, RIM_ALPHA, AO_ALPHA]) {
      expect(narrow).toBeLessThanOrEqual(0.8);
    }
    // "좁은 겹"이라는 주장의 근거를 폭으로 못박는다(폭을 되돌리면 이 단언이 깨진다).
    expect(AO_BAND_WIDTH).toBeLessThan(SHADOW_WIDTH * 0.5);
    // 어떤 겹도 단독으로 화면을 덮어쓰지 않는다.
    for (const cap of [...caps, DUSK_ALPHA]) expect(cap).toBeLessThan(1);
    // 코어는 헤일로보다 확실히 밝아야 2단 구조가 성립한다. 3차 비평 "블룸만 있고 광원이
    // 없다"의 처방이 이 비율이다 — 1.5배(2차)는 같은 밝기의 두 겹처럼 읽혔다.
    expect(CORE_ALPHA).toBeGreaterThanOrEqual(GLOW_ALPHA * 1.8);
    // 황혼은 국소 발광보다 약해야 한다. 화면 전체 어둡기는 그레이딩·시차 레인의 자리이고
    // 이 레이어의 본령은 **국소 발광**이다(3차에서 dusk 0.42 → 0.26).
    expect(DUSK_ALPHA).toBeLessThan(GLOW_ALPHA);
  });

  it('⑥ 상한이 1차 붕괴 수준(실효 0.05)으로 되돌아가지 않는다', () => {
    // 전형적 조건(세기 0.7·맥동 중앙값·high 티어)에서 눈에 보이는 밝기가 나와야 한다.
    const p = heatPulse(0, 0.4);
    expect(emitterAlpha(CORE_ALPHA, 0.7, p, 1)).toBeGreaterThan(0.24);
    expect(emitterAlpha(GLOW_ALPHA, 0.7, p, 1)).toBeGreaterThan(0.16);
    // 최저 티어에서도 "존재하지 않는 것"이 되면 안 된다.
    expect(emitterAlpha(CORE_ALPHA, 0.55, PULSE_MIN, 0.62)).toBeGreaterThan(0.03);
  });

  it('세기 0 이면 알파 0(꺼진 구간은 완전히 사라진다)', () => {
    expect(emitterAlpha(GLOW_ALPHA, 0, 1, 1)).toBe(0);
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

  it('필드는 [0,1) 안에 있다(임계 0.5 판정이 의미를 갖는 전제)', () => {
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

describe('⑤ 등고선 채널(marchCorners) — 용암이 이어진다', () => {
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
    const TILE = 64;
    for (let j = -8; j <= 8; j++) {
      for (let i = -8; i <= 8; i++) {
        const m = marchCell(909, i, j, out);
        for (let s = 0; s < m; s++) {
          const o = s * SEG_STRIDE;
          for (const [px, py] of [
            [out[o] ?? 0, out[o + 1] ?? 0],
            [out[o + 2] ?? 0, out[o + 3] ?? 0],
          ] as const) {
            const u = px / TILE - i;
            const v = py / TILE - j;
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
    // 1차 기각 사유의 핵심 — 용암이 "얼룩"이 아니라 "흐름"이어야 한다. 마칭 스퀘어즈는
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
            for (const key of [
              `${out[o]},${out[o + 1]}`,
              `${out[o + 2]},${out[o + 3]}`,
            ]) {
              counts.set(key, (counts.get(key) ?? 0) + 1);
            }
          }
        }
      }
      expect(segs).toBeGreaterThan(40); // 표본이 비면 아래 단언이 공회전한다.

      // 스캔 영역의 **내부**(테두리 셀을 제외한 사각형) 안에 있는 끝점만 본다 —
      // 테두리 끝점은 스캔 밖 이웃이 잘려서 짝이 없는 게 정상이다.
      const TILE = 64;
      let interior = 0;
      let linked = 0;
      for (const [key, n] of counts) {
        const [sx, sy] = key.split(',');
        const px = Number(sx) / TILE;
        const py = Number(sy) / TILE;
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
    const maxLen = 64 * Math.SQRT2 + 1e-6;
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
          evaluateSegment(seed, out[o] ?? 0, out[o + 1] ?? 0, out[o + 2] ?? 0, out[o + 3] ?? 0, seg);
          fn(seg);
        }
      }
    }
  };

  it('세기·위상이 정의된 범위 안이다', () => {
    let checked = 0;
    scan(4242, 16, (s) => {
      checked++;
      expect(s.heat).toBeGreaterThanOrEqual(0);
      expect(s.heat).toBeLessThanOrEqual(1);
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

  it('용암은 지형 균열(upper/lower 경계) 위에만 생긴다', () => {
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

  it('⑦ **완전히 꺼진 경계가 없다** — 모든 세그먼트가 잔열 하한 이상 (3차 핵심)', () => {
    // 2차는 `region ≤ THRESHOLD` 인 경계의 heat 를 정확히 0 으로 만들어, 화면의 큰 경계
    // 구간이 통째로 검었다. 재질 규칙은 전역적으로 일관해야 하고, 관객은 "어떤 가장자리는
    // 뜨겁고 어떤 건 아니다"를 미학적 선택이 아니라 **누락**으로 읽는다.
    //
    // 이 단언이 3차의 계약이다: **모든 orange↔dark 모서리에 최소한의 잔열이 있다.**
    for (const seed of [3, 4096, 20260729, 909, 1]) {
      let n = 0;
      scan(seed, 16, (s) => {
        n++;
        expect(s.heat).toBeGreaterThanOrEqual(EMBER_MIN);
        expect(s.heat).toBeLessThanOrEqual(1);
      });
      expect(n).toBeGreaterThan(50);
    }
  });

  it('⑦ 잔열이 상수가 아니다 — 저주파 변조로 강약이 섞인다', () => {
    // "모든 경계에 최소 잔열"을 `heat = EMBER_MIN` 상수로 구현하면 이 위 테스트는 통과하지만
    // 화면은 균일하게 다 켜져 오히려 촌스러워진다(비평가가 명시적으로 경고한 실패 모드).
    // 그래서 **잔열 구간 안에서의 분산**을 따로 잠근다.
    for (const seed of [7, 31337, 2026]) {
      const cool: number[] = [];
      scan(seed, 20, (s) => {
        // 뜨거운 지역이 아닌 구간(= 잔열만 있는 구간)만 본다.
        if (s.heat <= EMBER_MAX + 1e-9) cool.push(s.heat);
      });
      expect(cool.length).toBeGreaterThan(20);
      const lo = Math.min(...cool);
      const hi = Math.max(...cool);
      // 변조 폭의 최소 6할은 실제로 쓰여야 한다(상수 구현이면 0 이 된다).
      expect(hi - lo).toBeGreaterThan((EMBER_MAX - EMBER_MIN) * 0.6);
      const mean = cool.reduce((a, b) => a + b, 0) / cool.length;
      expect(mean).toBeGreaterThan(EMBER_MIN);
      expect(mean).toBeLessThan(EMBER_MAX);
    }
  });

  it('뜨거운 채널이 등고선의 일부 구간만 차지한다(전부도 없음도 아니다)', () => {
    // 잔열이 깔린 뒤에도 **강약의 구조**는 남아야 한다. 전부 뜨거우면 평평해 보이고,
    // 하나도 없으면 잔열만 남아 "화산"이라고 말하는 요소가 사라진다.
    for (const seed of [1, 909, 31337, 2026]) {
      let total = 0;
      let hot = 0;
      scan(seed, 22, (s) => {
        total++;
        // 잔열 상한을 확실히 넘긴 것만 "뜨거운 채널"로 센다.
        if (s.heat >= 0.7) hot++;
      });
      const ratio = hot / total;
      expect(ratio).toBeGreaterThan(0.08);
      expect(ratio).toBeLessThan(0.7);
    }
  });

  it('④ 림은 **용암(화면 아래)을 마주본** 절벽면에만 걸린다', () => {
    // 광원 = 저지의 용암 → 표면→광원 벡터 (0,+1). 절벽 바깥 법선은 −n 이므로
    // lit = max(0,−ny). `ny < 0`(고지가 북쪽 = 절벽면이 남쪽 = 용암을 마주봄)이 밝은 쪽이다.
    expect(TO_LIGHT_Y).toBe(1);
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
    // 이 함수가 상수가 되면 "전방위 균일" 로 되돌아간다 — 비평 ④ 의 회귀 지점.
    expect(segmentLit(0, -1)).toBeCloseTo(1, 6); // 용암을 정면으로 마주본 면
    expect(segmentLit(0, 1)).toBe(0); // 용암을 등진 면
    expect(segmentLit(1, 0)).toBe(0); // 옆면
    expect(segmentLit(0, -0.5)).toBeCloseTo(0.5, 6); // 중간값이 실제로 존재한다
  });

  it('④ AO·드롭 섀도는 림의 **여집합**에 실린다(빛과 그림자가 같은 쪽에 몰리지 않는다)', () => {
    // 3차의 실제 결함: `ao` 와 `rim` 이 **둘 다** `fade(-ny)` 에 비례해, 가장 밝은 면이
    // 동시에 가장 짙게 그늘졌다. 두 신호가 상쇄돼 화면의 방향 정보가 0비트가 됐다.
    let litAo = 0;
    let litN = 0;
    let shadeAo = 0;
    let shadeN = 0;
    let litShadowMax = 0;
    let shadeShadowMax = 0;
    scan(888, 16, (s) => {
      expect(s.ao).toBeGreaterThanOrEqual(AO_FLOOR); // 모든 경계에 AO 가 있다.
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
    // **그늘진 면이 더 어둡다** — 3차는 부호가 반대였고, 그 상태로도 3차 테스트는 통과했다.
    expect(shadeAo / shadeN).toBeGreaterThan(litAo / litN + 0.15);
    // 캐스트 섀도는 빛을 등진 면에서만 생긴다.
    expect(litShadowMax).toBe(0);
    expect(shadeShadowMax).toBeGreaterThan(0.5);
  });

  it('④ 드롭 섀도 방향은 저지 쪽이고, 빛 반대(위) 편향이 실려 있다', () => {
    let checked = 0;
    scan(2468, 16, (s) => {
      if (s.shadow <= 0) return;
      checked++;
      // 단위 벡터다(오프셋 길이를 상수로 유지하는 전제).
      expect(Math.hypot(s.shadowX, s.shadowY)).toBeCloseTo(1, 6);
      // 저지 쪽 성분이 있다: (shadowX, shadowY)·n < 0.
      expect(s.shadowX * s.nx + s.shadowY * s.ny).toBeLessThan(0);
      // 빛 반대 방향(화면 위, y 음수) 편향이 실려 순수 −n 보다 위로 기운다.
      expect(s.shadowY).toBeLessThan(-s.ny);
    });
    expect(checked).toBeGreaterThan(20);
  });

  it('발광색이 주황~호박 대역이다(흰색 포화 금지: R>G>B, B 는 낮게)', () => {
    let checked = 0;
    scan(2026, 12, (s) => {
      checked++;
      for (const c of [s.color, s.coreColor]) {
        const r = (c >> 16) & 0xff;
        const g = (c >> 8) & 0xff;
        const b = c & 0xff;
        expect(r).toBeGreaterThan(g);
        expect(g).toBeGreaterThan(b);
        expect(b).toBeLessThan(0x70);
        // 이음매에서 코어 두 장이 겹쳐도 G 가 포화해 흰색이 되지 않게 묶는다.
        expect(g).toBeLessThanOrEqual(0xb4);
      }
    });
    expect(checked).toBeGreaterThan(0);
  });

  it('④ 같은 입력이면 같은 결과(월드 고정)', () => {
    const a = createSegment();
    const b = createSegment();
    evaluateSegment(31, 100, 200, 140, 260, a);
    evaluateSegment(31, 100, 200, 140, 260, b);
    expect(b).toEqual(a);
  });
});

describe('⑧ 색상 분리 — 배경 발광 ↔ 전경 위험물 (가독성 최우선)', () => {
  it('색상각·채도 계산이 실측값과 맞는다(측정 도구 자체의 검증)', () => {
    // 아래 모든 단언이 이 두 함수를 통과하므로, 함수가 틀리면 분리 테스트가 통째로 항진한다.
    expect(hueOf(0xff0000)).toBeCloseTo(0, 6);
    expect(hueOf(0x00ff00)).toBeCloseTo(120, 6);
    expect(hueOf(0x0000ff)).toBeCloseTo(240, 6);
    expect(saturationOf(0xff0000)).toBeCloseTo(1, 6);
    expect(saturationOf(0x808080)).toBeCloseTo(0, 6);
    // 원형 거리(0°와 350°는 10° 차이지 350° 차이가 아니다).
    expect(hueDistance(0xff0000, 0xff2233)).toBeLessThan(10);
  });

  it('전경 적탄 실측: 앰버 28.5° · hot-red 355.4° 가 배경 색상 창을 양쪽에서 좁힌다', () => {
    // 2차 코어 `0xff8a30`(26.1°)이 가속 적탄 `0xff8a20`(28.5°)과 **2.4° 차이**였다 —
    // 색상각으로는 같은 색이다. 그 사실 자체를 기록으로 잠근다.
    expect(hueOf(0xff8a20)).toBeCloseTo(28.5, 1);
    expect(hueOf(0xff8a30)).toBeCloseTo(26.1, 1);
    expect(hueDistance(0xff8a20, 0xff8a30)).toBeLessThan(HOSTILE_HUE_GAP / 3);
    expect(hueOf(0xff2233)).toBeCloseTo(355.4, 1);
    // 창의 **양 끝 자체**가 두 위협색에서 하한만큼 떨어져 있다 — 창 안이면 무조건 안전하다는
    // 뜻이고, 그래서 팔레트 개별 검사와 창 검사가 서로를 대체하지 않는다.
    expect(hueOf(0xff8a20) - LAVA_HUE_MAX).toBeGreaterThanOrEqual(HOSTILE_HUE_GAP);
    expect(LAVA_HUE_MIN - (hueOf(0xff2233) - 360)).toBeGreaterThanOrEqual(HOSTILE_HUE_GAP);
  });

  it('배경 용암 팔레트 전체가 색상 창 [10°,19°] 안에 있다', () => {
    expect(LAVA_PALETTE.length).toBeGreaterThan(6);
    for (const c of LAVA_PALETTE) {
      const h = hueOf(c);
      expect(h).toBeGreaterThanOrEqual(LAVA_HUE_MIN);
      expect(h).toBeLessThanOrEqual(LAVA_HUE_MAX);
    }
  });

  it('배경 용암과 전경 신호색의 색상각 거리가 하한 이상이다', () => {
    for (const lava of LAVA_PALETTE) {
      for (const fg of FOREGROUND_SIGNAL_COLORS) {
        const d = hueDistance(lava, fg);
        expect(d).toBeGreaterThanOrEqual(HOSTILE_HUE_GAP);
      }
    }
  });

  it('가장 가까운 위협색(앰버 적탄)과의 최소 거리를 수치로 못박는다', () => {
    // 팔레트를 손대다 창 가장자리로 몰리는 것을 막는 별도 하한. 실측 최솟값 ≈10.4°.
    let worst = Infinity;
    for (const lava of LAVA_PALETTE) worst = Math.min(worst, hueDistance(lava, 0xff8a20));
    expect(worst).toBeGreaterThanOrEqual(10);
    expect(worst).toBeLessThan(20); // 창 자체가 좁다는 사실도 함께 기록(과도 이동 방지).
  });

  it('배경 용암은 채도가 높게 유지된다(저채도 = 흰색 쪽 = 가산에서 포화)', () => {
    // 비평은 "채도를 낮추거나 붉은 쪽으로 밀어라"였는데, 가산 합성에서 저채도는 흰색 포화로
    // 직결된다(흰 코어 탄과 오히려 더 닮는다). 그래서 분리는 **전부 색상각으로** 만들고
    // 채도는 오히려 높게 잠근다. 두 처방 중 안전한 쪽을 고른 근거를 여기 남긴다.
    for (const c of LAVA_PALETTE) {
      expect(saturationOf(c)).toBeGreaterThan(0.7);
    }
  });

  it('붉은 쪽 이동의 부수 효과: G 채널 여유가 커진다(흰색 포화 방지)', () => {
    for (const c of LAVA_PALETTE) {
      expect((c >> 8) & 0xff).toBeLessThanOrEqual(0x80);
    }
  });
});

describe('⑨ `gates.halo` 완화 — 끄기가 아니라 줄이기', () => {
  it('어떤 게이트 상태에서도 코어 배율이 0 이 아니다(용암이 사라지지 않는다)', () => {
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
    // 열기 기둥(가장 넓다)은 완화 상태에서 완전히 끈다.
    expect(off.plume).toBe(false);
    expect(red.plume).toBe(false);
    expect(on.plume).toBe(true);
    // `reducedGlow` 는 게이트가 켜져 있어도 우선한다(티어와 직교).
    expect(glowGateScales(false, true)).toEqual(red);
  });

  it('완화 상태에서도 **눈에 보이는** 실효 알파가 남는다', () => {
    // 2차의 실제 결함이 이것이다: 저티어·reducedGlow 에서 가시 발광 0.
    // 하한을 수치로 잠근다(0 이 아니다 정도가 아니라 "보인다" 수준).
    const p = heatPulse(0, 0.4);
    const lowTier = 0.62;
    const haloOff = emitterAlpha(CORE_ALPHA, 0.8, p, lowTier * HALO_OFF_CORE_SCALE);
    expect(haloOff).toBeGreaterThan(0.15);
    const reduced = emitterAlpha(CORE_ALPHA, 0.8, REDUCED_GLOW_PULSE, REDUCED_GLOW_CORE_SCALE);
    expect(reduced).toBeGreaterThan(0.12);
    // 그래도 정상 상태보다는 확실히 어둡다(완화의 취지).
    expect(reduced).toBeLessThan(emitterAlpha(CORE_ALPHA, 0.8, p, 1) * 0.6);
  });

  it('`reducedGlow` 는 맥동을 정지시킨다(광과민의 실제 위험은 주기적 변조다)', () => {
    // 고정값이므로 tick 과 무관하다 — 이 상수가 함수 호출로 바뀌면 깜빡임이 되돌아온다.
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

  it('카르곤이 아니면 스스로 꺼진다', () => {
    const layer = new TerrainLightLayer();
    expect(layer.configure({ planet: 1, seed: 5 })).toBe(false);
    expect(layer.slot).toBe('floor');
    layer.destroy();
  });

  it('렌더러가 없어도(캔버스 없는 테스트) 던지지 않는다', () => {
    const layer = new TerrainLightLayer();
    expect(layer.configure({ planet: 0, seed: 5 })).toBe(true);
    expect(() => layer.update(frame(0, 0, 12.5))).not.toThrow();
    expect(layer.segmentCount).toBeGreaterThan(0);
    layer.destroy();
  });

  it('화면 하나에 채널이 충분히 깔린다(얼룩 몇 개가 아니다)', () => {
    const layer = new TerrainLightLayer();
    layer.configure({ planet: 0, seed: 20260729 });
    layer.update(frame(0, 0, 0));
    // 1920×1080 ≈ 30×17 타일. 등고선이 화면을 가로지르면 수십 개가 나온다.
    expect(layer.segmentCount).toBeGreaterThan(30);
    layer.destroy();
  });

  it('④ 카메라가 떠났다 돌아오면 같은 세그먼트 집합이 복원된다(월드 고정)', () => {
    const layer = new TerrainLightLayer();
    layer.configure({ planet: 0, seed: 909 });
    layer.update(frame(0, 0, 0));
    const home = layer.segmentCount;
    layer.update(frame(9000, 4000, 300));
    layer.update(frame(0, 0, 600));
    expect(layer.segmentCount).toBe(home);
    layer.destroy();
  });

  it('비활성 상태에서 update 는 무비용·무해하다', () => {
    const layer = new TerrainLightLayer();
    layer.configure({ planet: 3, seed: 1 });
    layer.update(frame(0, 0, 1));
    expect(layer.segmentCount).toBe(0);
    layer.destroy();
  });

  it('⑦ 정상 티어에서 **모든** 세그먼트가 발광한다(꺼진 경계 0)', () => {
    const layer = new TerrainLightLayer();
    layer.configure({ planet: 0, seed: 20260729 });
    layer.update(frame(0, 0, 0));
    expect(layer.segmentCount).toBeGreaterThan(30);
    expect(layer.minSegmentHeat).toBeGreaterThanOrEqual(EMBER_MIN);
    // 헤일로+코어가 세그먼트마다 하나씩 보인다 → 최소 2×count.
    expect(layer.visibleGlowCount).toBeGreaterThanOrEqual(layer.segmentCount * 2);
    expect(layer.peakCoreAlpha).toBeGreaterThan(0.3);
    layer.destroy();
  });

  it('⑦ 띠 두께가 세기에 따라 변한다(식은 균열=가는 선, 뜨거운 채널=넓은 강)', () => {
    graphicsTierController.tick(120, 1, 'high');
    const layer = new TerrainLightLayer();
    layer.configure({ planet: 0, seed: 20260729 });
    layer.update(frame(0, 0, 0));
    // wScale = 0.55 + 0.45·heat 이므로 heat∈[0.28,1] 에서 비는 최소 ≈1.4 배.
    expect(layer.glowWidthSpread).toBeGreaterThan(1.3);
    layer.destroy();
  });

  it('⑦ 열기 기둥은 잔열에 붙지 않는다(균일한 주황 안개 방지)', () => {
    graphicsTierController.tick(120, 1, 'high');
    const layer = new TerrainLightLayer();
    layer.configure({ planet: 0, seed: 20260729 });
    layer.update(frame(0, 0, 0));
    const plumes = layer.visiblePlumeCount;
    // 진짜 뜨거운 채널에는 붙는다.
    expect(plumes).toBeGreaterThan(0);
    // 그러나 모든 경계에는 붙지 않는다 — 가장 넓은 겹이라 전면 적용이 화면을 안개로 만든다.
    expect(plumes).toBeLessThan(layer.segmentCount * 0.7);
    layer.destroy();
  });

  it('⑨ 저티어에서도 가시 발광이 남는다(2차 결함의 종단 회귀 테스트)', () => {
    // 2차는 여기서 가시 발광 4종 157개 중 **0개**였다.
    graphicsTierController.tick(20, 1, 'low');
    try {
      const layer = new TerrainLightLayer();
      layer.configure({ planet: 0, seed: 20260729 });
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
    layer.configure({ planet: 0, seed: 20260729 });
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
  // ⑩ 4차 — "그려졌는가"가 아니라 **"덮이지 않았는가"**
  // -------------------------------------------------------------------------

  it('⑩ [합성 순서] 곱연산 두 겹(AO·드롭 섀도)이 가산 헤일로보다 **나중에** 칠해진다', () => {
    // 3차의 결함이 정확히 이 순서였다: `ao` → `glow`. AO 의 자취는 헤일로의 진부분집합이라
    // 나중에 칠해진 가산 헤일로가 곱연산 어둠을 통째로 되돌렸다 — 알파를 올려도 안 보인다.
    // 이 단언은 스프라이트 속성으로는 원리적으로 표현 불가능하다. 순서 자체를 잠근다.
    const layer = new TerrainLightLayer();
    layer.configure({ planet: 0, seed: 20260729 });
    const order = layer.layerOrder;
    const at = (n: string) => order.indexOf(n);
    expect(at('dusk')).toBe(0);
    expect(at('glow')).toBeGreaterThan(at('dusk'));
    expect(at('shadow')).toBeGreaterThan(at('glow'));
    expect(at('ao')).toBeGreaterThan(at('glow'));
    // 코어·림은 AO 보다 위 — 좁은 겹이 홈에 먹히면 용암 심지가 사라진다.
    expect(at('core')).toBeGreaterThan(at('ao'));
    expect(at('rim')).toBeGreaterThan(at('core'));
    layer.destroy();
  });

  it('⑩ [AO 띠] 모든 세그먼트에 붙고, 폭이 목표 범위이며, 실제로 어둡게 한다', () => {
    graphicsTierController.tick(120, 1, 'high');
    const layer = new TerrainLightLayer();
    layer.configure({ planet: 0, seed: 20260729 });
    layer.update(frame(0, 0, 0));
    expect(layer.segmentCount).toBeGreaterThan(30);
    // ① 모든 경계에 있다(비평 ①: "지형 경계에 릴리프가 0").
    expect(layer.visibleAoCount).toBe(layer.segmentCount);
    // ② **띠**의 폭 — 흐린 방사 블롭(3차 58px)으로 되돌리면 깨진다.
    const w = layer.aoBandWidthWorld;
    expect(w).toBeGreaterThanOrEqual(AO_BAND_WIDTH * 0.95);
    expect(w).toBeLessThanOrEqual(AO_BAND_WIDTH * 1.05);
    expect(w).toBeLessThan(30); // 화면 4~8px 문법에 대응하는 상한(월드 기준).
    // ③ 틴트까지 포함한 **실효 곱연산 배율** — 알파만 재면 틴트를 흰색으로 바꿔도 통과한다.
    expect(layer.aoDarkestFactor).toBeLessThan(0.7);
    layer.destroy();
  });

  it('⑩ [띠의 가장자리] AO 프로파일에 **평정부**가 있다 — 흐린 블롭이 아니다', () => {
    // 3차 AO 가 안 보인 이유의 절반은 폭이 아니라 **가장자리 부재**였다. 부드러운 falloff 는
    // 중심만 진한 그라디언트라 "칠해진 영역"으로 읽힌다. `plateau` 를 0 으로 되돌리면
    // 폭·알파·오프셋이 전부 그대로여도 화면에서 다시 띠로 안 읽히므로 여기서 잡는다.
    expect(AO_BAND_PLATEAU).toBeGreaterThan(0.3);
    // 평정부 안은 정확히 1(납작한 머리).
    for (const t of [0, 0.2, AO_BAND_PLATEAU]) {
      expect(bandProfile(t, AO_BAND_EXP, AO_BAND_PLATEAU)).toBe(1);
    }
    // 평정부 밖은 빠르게 떨어진다(또렷한 가장자리).
    const edge = bandProfile((1 + AO_BAND_PLATEAU) / 2, AO_BAND_EXP, AO_BAND_PLATEAU);
    expect(edge).toBeLessThan(0.25);
    expect(bandProfile(1, AO_BAND_EXP, AO_BAND_PLATEAU)).toBe(0);
    // 대조군: 헤일로용 소프트 프로파일(plateau=0)은 평정부가 없다 — 두 모양이 실제로 다르다.
    expect(bandProfile(0.2, 2.1, 0)).toBeLessThan(1);
    // 단조 감소(프로파일이 뒤집히면 링 누적이 음수 알파를 낸다).
    let prev = 1;
    for (let t = 0; t <= 1; t += 0.05) {
      const v = bandProfile(t, AO_BAND_EXP, AO_BAND_PLATEAU);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });

  it('⑩ [자취] AO 는 고지(+n) 쪽, 드롭 섀도·림은 저지(−n) 쪽에 놓인다', () => {
    graphicsTierController.tick(120, 1, 'high');
    const layer = new TerrainLightLayer();
    layer.configure({ planet: 0, seed: 909 });
    layer.update(frame(0, 0, 0));
    expect(layer.sideViolations).toEqual({ ao: 0, shadow: 0, rim: 0 });
    // 부호 계약을 상수 수준에서도 못박는다(배치 코드를 고쳐도 여기서 먼저 걸린다).
    expect(AO_BAND_OFFSET).toBeGreaterThan(0);
    expect(RIM_OFFSET).toBeLessThan(0);
    expect(SHADOW_OFFSET).toBeGreaterThan(AO_BAND_OFFSET * 2);
    layer.destroy();
  });

  it('⑩ [림이 코어 밖에 있다] 3차는 림 자취가 코어 자취의 부분집합이라 묻혔다', () => {
    // |RIM_OFFSET| − 림반폭 > 코어반폭 이어야 림이 코어 바깥으로 나온다.
    // (CORE_WIDTH=17 은 비공개 상수라 값으로 적는다 — 이 부등식이 깨지면 여기서 잡힌다.)
    const CORE_HALF = 17 / 2;
    const rimHalf = 11 / 2;
    expect(Math.abs(RIM_OFFSET) - rimHalf).toBeGreaterThan(CORE_HALF);
  });

  it('⑩ [드롭 섀도] 저지 쪽에만 생기고, 세그먼트의 일부에만 붙는다', () => {
    graphicsTierController.tick(120, 1, 'high');
    const layer = new TerrainLightLayer();
    layer.configure({ planet: 0, seed: 20260729 });
    layer.update(frame(0, 0, 0));
    const n = layer.visibleShadowCount;
    // 실제로 존재한다(0 이면 "구현했다"가 거짓이다).
    expect(n).toBeGreaterThan(layer.segmentCount * 0.15);
    // 그러나 전 구간은 아니다 — 전방위 균일이면 다시 층이 안 읽힌다.
    expect(n).toBeLessThan(layer.segmentCount * 0.85);
    layer.destroy();
  });

  it('⑩ [방향성 림] 세기와 폭이 **둘 다** 법선 방향에 따라 갈린다', () => {
    // 비평 ④: "림 발광이 모든 방위에서 세기·폭이 동일하다". 알파만 변조하는 구현으로
    // 되돌리면 `litSpread` 가 1 이 되어 이 단언이 깨진다.
    graphicsTierController.tick(120, 1, 'high');
    const layer = new TerrainLightLayer();
    layer.configure({ planet: 0, seed: 20260729 });
    layer.update(frame(0, 0, 0));
    const r = layer.rimByFacing;
    expect(r.litAlpha).toBeGreaterThan(0.2); // 빛 받는 면은 확실히 보인다.
    expect(r.shadeAlpha).toBe(0); // 등진 면은 아예 없다.
    expect(r.litSpread).toBeGreaterThan(1.2); // 폭도 균일하지 않다.
    layer.destroy();
  });

  it('⑩ [명도 셋째 봉우리] AO·섀도·황혼이 만드는 중간톤이 상·하부 명도 **사이**에 있다', () => {
    // 비평: "명도가 2단계뿐". 아핀 그레이딩으로 못 만든 중간톤을 **기하**로 만든다는 것이
    // 4차의 전제이므로, 세 겹의 곱연산 배율이 실제로 그 사이에 앉는지를 계산으로 잠근다.
    const duskF = 1 - DUSK_ALPHA * (1 - 0x4a / 255); // 지각 전반
    const aoF = duskF * (1 - AO_ALPHA * (1 - 0x54 / 255)); // 황혼 + AO 홈
    const shadowF = duskF * (1 - SHADOW_ALPHA * (1 - 0x58 / 255)); // 황혼 + 캐스트 섀도
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
    // 전투 프레임 신고: 주황 적 탱크가 주황 지각 위에서 위장. `floor` 슬롯 곱연산은
    // 지형만 누르고 엔티티는 안 건드리는 유일한 장치라 이 값이 전경-배경 분리의 근거다.
    expect(DUSK_ALPHA).toBeGreaterThan(0.32);
    const duskF = 1 - DUSK_ALPHA * (1 - 0x4a / 255);
    expect(duskF).toBeLessThan(0.78);
    const layer = new TerrainLightLayer();
    layer.configure({ planet: 0, seed: 42 });
    layer.update(frame(0, 0, 0));
    expect(layer.layerOrder[0]).toBe('dusk');
    layer.destroy();
  });

  it('반복 update 가 세그먼트 수를 흔들지 않는다(재구성 캐시가 안정적)', () => {
    const layer = new TerrainLightLayer();
    layer.configure({ planet: 0, seed: 42 });
    layer.update(frame(0, 0, 0));
    const n = layer.segmentCount;
    for (let t = 1; t < 30; t++) layer.update(frame(0, 0, t));
    expect(layer.segmentCount).toBe(n);
    layer.destroy();
  });
});

