/**
 * 카르곤 컬러 그레이딩·비네트 레이어 가드.
 *
 * 이 레이어는 화면 **전체**를 덮는 유일한 환경 레이어라 잘못되면 전투 자체가 안 보인다.
 * 그래서 "예쁘게 나오는가"(눈으로 볼 것)가 아니라 **망가질 수 있는 경로**를 잠근다:
 *
 *  1. 어떤 티어·설정 조합에서도 어떤 요소도 {@link LAYER_MAX_ALPHA} 를 넘지 않는다.
 *  2. 오버레이 사각형이 view 사각형과 **정확히** 일치한다(레터박스 띠를 칠하지 않고, 모자라지도 않는다).
 *  3. 화면 중앙 안전 영역의 밝기 잔존율이 {@link CENTER_MIN_RETENTION} 이상이다.
 *  4. `reducedGlow`/`reducedMotion`/low 티어에서 강도가 단조 감소한다.
 *  5. 결정론 — 같은 시드·틱이면 같은 그레인 위상(무작위·벽시계 금지).
 *  6. **스플릿 톤이 실제로 존재한다** — 톤 전달함수의 warmth(R−B)가 명도에 대해 엄밀 단조
 *     증가하고 중간 명도에서 부호가 바뀐다. lift·gain 중 한 항만 죽어도 이게 깨진다.
 *  7. **하이라이트 가중 감쇠** — gain 의 절대 밝기 손실이 입력 밝기에 정비례한다(암부 보호).
 *  8. **웜 중복 해소** — 따뜻한 가산이 화면 하단 밖(ny ≤ {@link WARM_START_Y})에서 정확히 0.
 */

import { describe, it, expect } from 'vitest';
import { BufferImageSource, Texture, type Renderer, type TilingSprite } from 'pixi.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import {
  KargonGradeLayer,
  LAYER_MAX_ALPHA,
  CENTER_SAFE_RADIUS,
  CENTER_MIN_RETENTION,
  EDGE_MAX_DARKENING,
  VIGNETTE_MAX_ALPHA,
  COOL_MAX_ALPHA,
  WARM_MAX_ALPHA,
  GRAIN_MAX_ALPHA,
  TONE_GAIN_MAX_ALPHA,
  SHADOW_MAX_ALPHA,
  TONE_GAIN_LUMA_LOSS,
  SHADOW_LUMA_GAIN,
  VIGNETTE_CENTER_Y,
  WARM_START_Y,
  gradeStrengths,
  vignetteProfile,
  warmProfile,
  coolProfile,
  darkeningBound,
  toneMap,
  toneWarmth,
  tintLuma,
  tintChannels,
  type GradeStrengths,
} from '../src/render/env/kargonGrade.js';
import type { QualityTier } from '../src/render/qualityTier.js';
import { DEFAULT_GRAPHICS_SETTINGS, type GraphicsSettings } from '../src/render/graphicsSettings.js';
import type { EnvFrame } from '../src/render/env/types.js';

const TIERS: readonly QualityTier[] = ['low', 'med', 'high'];

function settings(patch: Partial<GraphicsSettings> = {}): GraphicsSettings {
  return { ...DEFAULT_GRAPHICS_SETTINGS, ...patch };
}

/** 스칼라 강도 필드만(불리언 grainAnimation 제외) — 단조성 비교 대상. */
const SCALAR_FIELDS: readonly (keyof GradeStrengths)[] = [
  'vignette',
  'warm',
  'cool',
  'grain',
  'gain',
  'shadow',
];

function scalars(s: GradeStrengths): number[] {
  return SCALAR_FIELDS.map((f) => s[f] as number);
}

/**
 * GL 없는 가짜 렌더러. `generateTexture` 호출을 세고 1×1 자체 소스 텍스처를 돌려준다.
 *
 * 이게 있어야 **텍스처 굽기 코드가 실제로 실행된다** — 링 스트로크 루프·격자 채우기가 NaN 알파나
 * 잘못된 형상으로 던지는지, 그리고 "굽기는 configure 1회, 매 프레임 0" 계약이 지켜지는지는
 * 렌더러가 undefined 인 경로에서는 영영 검증되지 않는다(굽는 코드가 통째로 스킵되니까).
 * 공유 `Texture.WHITE` 를 돌려주면 layer.destroy(true) 가 그 공용 소스를 파괴해 다른 테스트를
 * 오염시키므로, 호출마다 독립 소스를 만든다.
 */
function stubRenderer(): Renderer {
  const calls: unknown[] = [];
  const r = {
    generateTexture(options: unknown): Texture {
      calls.push(options);
      return new Texture({
        source: new BufferImageSource({ resource: new Uint8Array(4), width: 1, height: 1 }),
      });
    },
    bakeCalls: calls,
  };
  return r as unknown as Renderer;
}

function bakeCallCount(r: Renderer): number {
  return (r as unknown as { bakeCalls: unknown[] }).bakeCalls.length;
}

function frame(minX: number, minY: number, maxX: number, maxY: number, tick = 0): EnvFrame {
  return {
    camX: 0,
    camY: 0,
    viewMinX: minX,
    viewMinY: minY,
    viewMaxX: maxX,
    viewMaxY: maxY,
    tick,
    dt: 1 / 60,
  };
}

describe('카르곤 그레이딩 — 알파 상한', () => {
  it('개별 상한 상수가 전부 레이어 상한 이하다', () => {
    for (const v of [
      VIGNETTE_MAX_ALPHA,
      COOL_MAX_ALPHA,
      WARM_MAX_ALPHA,
      GRAIN_MAX_ALPHA,
      TONE_GAIN_MAX_ALPHA,
      SHADOW_MAX_ALPHA,
    ]) {
      expect(v).toBeLessThanOrEqual(LAYER_MAX_ALPHA);
    }
  });

  it('모든 티어 × 설정 조합에서 어떤 강도도 상한을 넘지 않는다', () => {
    for (const tier of TIERS) {
      for (const motion of [false, true]) {
        for (const glow of [false, true]) {
          const s = gradeStrengths(tier, settings({ reducedMotion: motion, reducedGlow: glow }));
          for (const v of scalars(s)) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(LAYER_MAX_ALPHA);
          }
        }
      }
    }
  });

  it('실제 스프라이트 알파도 상한 이하다(렌더러 유무 무관)', () => {
    const layer = new KargonGradeLayer();
    expect(layer.configure({ planet: 0, seed: 7 })).toBe(true);
    layer.update(frame(0, 0, 1920, 1080));
    for (const s of layer.overlays) expect(s.alpha).toBeLessThanOrEqual(LAYER_MAX_ALPHA);
    layer.destroy();
  });
});

describe('카르곤 그레이딩 — 화면 정합(레터박스 안전)', () => {
  const layer = new KargonGradeLayer();
  layer.configure({ planet: 0, seed: 3 });

  const cases: readonly [number, number, number, number][] = [
    [0, 0, 1920, 1080],
    // 레터박스: 세로가 잘린 화면(위아래 띠가 생기는 비율).
    [0, 105, 1920, 975],
    // 필러박스: 좌우가 잘린 화면.
    [240, 0, 1680, 1080],
    // 오버스캔: design 사각형보다 넓은 가시 영역.
    [-160, -90, 2080, 1170],
  ];

  it.each(cases)('view (%i,%i)-(%i,%i) 에 오버레이가 정확히 일치한다', (x0, y0, x1, y1) => {
    // resize 를 먼저 불러도(그리고 view 와 다른 값을 줘도) 기하는 view 사각형이 정본이다.
    layer.resize(1920, 1080);
    layer.update(frame(x0, y0, x1, y1));
    expect(layer.overlays.length).toBeGreaterThan(0);
    for (const s of layer.overlays) {
      const b = s.getBounds();
      expect(b.x).toBeCloseTo(x0, 4);
      expect(b.y).toBeCloseTo(y0, 4);
      expect(b.x + b.width).toBeCloseTo(x1, 4);
      expect(b.y + b.height).toBeCloseTo(y1, 4);
    }
  });

  it('폭·높이가 0 인 프레임에서도 던지지 않는다', () => {
    expect(() => layer.update(frame(0, 0, 0, 0))).not.toThrow();
  });
});

describe('카르곤 그레이딩 — 중앙 가독성', () => {
  it('중앙 안전 영역의 밝기 잔존율이 하한 이상이다(모든 티어·설정)', () => {
    for (const tier of TIERS) {
      const s = gradeStrengths(tier, settings());
      for (let i = -8; i <= 8; i++) {
        for (let j = -8; j <= 8; j++) {
          const nx = (i / 8) * CENTER_SAFE_RADIUS;
          const ny = (j / 8) * CENTER_SAFE_RADIUS;
          const retention = 1 - darkeningBound(nx, ny, s);
          expect(retention).toBeGreaterThanOrEqual(CENTER_MIN_RETENTION);
        }
      }
    }
  });

  it('정확한 화면 중앙은 비네트·색온도가 전혀 건드리지 않는다', () => {
    expect(vignetteProfile(0, 0)).toBe(0);
    expect(warmProfile(0, 0)).toBe(0);
    expect(coolProfile(0, 0)).toBe(0);
  });

  it('중앙 잔존율 상한이 항진이 아니다 — 전역 gain 이 실제로 예산을 먹는다', () => {
    // 이전 판에서는 중앙 감쇠가 정확히 0 이라 이 상한이 아무것도 막지 못했다. 전역 gain 이
    // 들어온 지금은 중앙에서도 0 이 아니어야 하고, 그래도 하한 위에 남아야 한다.
    const s = gradeStrengths('high', settings());
    const center = darkeningBound(0, 0, s);
    expect(center).toBeGreaterThan(0);
    expect(center).toBeCloseTo(s.gain * TONE_GAIN_LUMA_LOSS, 12);
    expect(1 - center).toBeGreaterThan(CENTER_MIN_RETENTION);
  });

  it('가장자리 감쇠 예산이 이전 판(0.3493)보다 늘지 않았다', () => {
    // 전역 gain 이 새로 먹는 3.6% 만큼 cool 을 줄여 상쇄했다는 주장의 물증. 값이 위로 새면
    // "톤을 추가하면서 화면을 더 어둡게 만들었다"가 되므로 회귀로 잡는다.
    const s = gradeStrengths('high', settings());
    let worst = 0;
    for (let i = -64; i <= 64; i++) {
      for (let j = -64; j <= 64; j++) worst = Math.max(worst, darkeningBound(i / 64, j / 64, s));
    }
    // 상한만 두면 "요소를 지워서 통과"가 가능하다. 하한을 붙여 **예산을 실제로 다 쓰는지**도
    // 잠근다 — 전역 gain 항이나 cool 이 빠지면 여기서 걸린다.
    expect(worst).toBeLessThanOrEqual(0.3493);
    expect(worst).toBeGreaterThan(0.34);
  });

  it('화면 어느 지점에서도 밝기 손실이 상한을 넘지 않는다(적은 화면 밖에서 들어온다)', () => {
    for (const tier of TIERS) {
      const s = gradeStrengths(tier, settings());
      for (let i = -32; i <= 32; i++) {
        for (let j = -32; j <= 32; j++) {
          const d = darkeningBound(i / 32, j / 32, s);
          expect(d).toBeGreaterThanOrEqual(0);
          expect(d).toBeLessThanOrEqual(EDGE_MAX_DARKENING);
        }
      }
    }
  });

  it('적이 주로 들어오는 좌우 변 중앙은 특히 밝게 남긴다(손실 20% 미만)', () => {
    const s = gradeStrengths('high', settings());
    for (const nx of [-1, 1]) {
      expect(darkeningBound(nx, 0, s)).toBeLessThan(0.2);
    }
  });
});

describe('카르곤 그레이딩 — 비네트 형상', () => {
  it('[0,1] 을 벗어나지 않고, 코어에서 멀어질수록 단조 증가한다', () => {
    // 코어 중심에서 바깥으로 뻗는 반직선(여러 방향)을 따라가며 단조성을 본다.
    for (const dir of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI]) {
      let prev = -1;
      for (let i = 0; i <= 60; i++) {
        const d = (i / 60) * 1.6;
        const v = vignetteProfile(Math.cos(dir) * d, VIGNETTE_CENTER_Y + Math.sin(dir) * d);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
      expect(prev).toBeGreaterThan(0.9); // 최원거리에서 사실상 최대에 닿는다.
    }
  });

  it('코어가 아래로 치우쳐 상단이 하단보다 더 어둡다(용암은 아래에 있다)', () => {
    expect(vignetteProfile(0, -1)).toBeGreaterThan(vignetteProfile(0, 1));
    expect(vignetteProfile(-1, -1)).toBeGreaterThan(vignetteProfile(-1, 1));
  });

  it('따뜻함은 하단 중앙에, 차가움은 상단·좌우 가장자리에 몰린다', () => {
    expect(warmProfile(0, 1)).toBeGreaterThan(warmProfile(0, -1));
    expect(warmProfile(0, 1)).toBeGreaterThan(warmProfile(1, 1));
    expect(coolProfile(0, -1)).toBeGreaterThan(coolProfile(0, 1));
    expect(coolProfile(1, 0)).toBeGreaterThan(coolProfile(0, 0));
  });
});

describe('카르곤 그레이딩 — 스플릿 톤 (lift/gain 이중성)', () => {
  const HI = gradeStrengths('high', settings());

  it('암부는 청보라, 하이라이트는 황백이다', () => {
    const shadow = toneMap(0.05, HI);
    const highlight = toneMap(1, HI);
    // 암부: 파랑이 빨강보다 확실히 위 = 청보라.
    expect(shadow[2]).toBeGreaterThan(shadow[0] + 0.03);
    // 하이라이트: R ≥ G ≥ B = 황백(따뜻한 흰색). 등호 없이 실제로 기울어야 한다.
    expect(highlight[0]).toBeGreaterThan(highlight[1]);
    expect(highlight[1]).toBeGreaterThan(highlight[2] - 1e-9);
    expect(highlight[0]).toBeGreaterThan(highlight[2] + 0.02);
  });

  it('warmth(R−B)가 명도에 대해 엄밀 단조 증가한다', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const w = toneWarmth(i / 100, HI);
      expect(w).toBeGreaterThan(prev);
      prev = w;
    }
  });

  it('중간 명도에서 부호가 바뀐다(전역 캐스트가 아니라 스플릿이다)', () => {
    expect(toneWarmth(0, HI)).toBeLessThan(0);
    expect(toneWarmth(1, HI)).toBeGreaterThan(0);
    // 이분법으로 교차점을 찾아 중간 대역에 있는지 본다. 한쪽 끝에 붙어 있으면 사실상 단색 캐스트다.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (toneWarmth(mid, HI) < 0) lo = mid;
      else hi = mid;
    }
    expect(lo).toBeGreaterThan(0.2);
    expect(lo).toBeLessThan(0.8);
  });

  it('교차점이 품질 티어에 무관하다(티어를 낮췄더니 화면 성격이 바뀌면 안 된다)', () => {
    const crossing = (s: GradeStrengths): number => {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (toneWarmth(mid, s) < 0) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    const base = crossing(HI);
    for (const tier of TIERS) {
      expect(crossing(gradeStrengths(tier, settings()))).toBeCloseTo(base, 6);
    }
  });

  it('lift 나 gain 중 하나만 죽여도 스플릿이 사라진다(두 항 모두가 필수다)', () => {
    const noLift: GradeStrengths = { ...HI, shadow: 0 };
    const noGain: GradeStrengths = { ...HI, gain: 0 };
    // lift 가 없으면 암부가 그냥 검정 — 부호가 안 바뀐다(전 구간 따뜻함 ≥ 0).
    expect(toneWarmth(0, noLift)).toBeCloseTo(0, 9);
    expect(toneWarmth(0.05, noLift)).toBeGreaterThan(0);
    // gain 이 없으면 기울기가 0 — 명도가 올라가도 톤이 안 따뜻해진다(전역 파란 캐스트).
    expect(toneWarmth(1, noGain)).toBeCloseTo(toneWarmth(0, noGain), 9);
    expect(toneWarmth(1, noGain)).toBeLessThan(0);
  });
});

describe('카르곤 그레이딩 — 하이라이트 가중 감쇠(롤오프의 아핀 근사)', () => {
  const HI = gradeStrengths('high', settings());

  /** gain 을 통과한 중성 회색 g 의 절대 휘도 손실. */
  const gainLoss = (g: number): number => g * HI.gain * TONE_GAIN_LUMA_LOSS;

  it('절대 밝기 손실이 입력 밝기에 정비례한다 — 암부는 사실상 안 깎인다', () => {
    expect(gainLoss(0)).toBe(0);
    // 최상단은 암부(0.1)의 정확히 10배를 잃는다.
    expect(gainLoss(1)).toBeCloseTo(gainLoss(0.1) * 10, 9);
    // 8비트 환산: 흰색 ≥ 8/255 손실, 어두운 바닥 ≤ 1.5/255 손실.
    expect(gainLoss(1) * 255).toBeGreaterThan(8);
    expect(gainLoss(0.105) * 255).toBeLessThan(1.5);
  });

  it('gain tint 는 R=255 여서 흰색이 오버플로도 손실도 없이 착지한다(단조성의 근거)', () => {
    expect(tintChannels(0xffdcae)[0]).toBe(1);
    expect(toneMap(1, HI)[0]).toBeLessThanOrEqual(1 + 1e-9);
    expect(toneMap(1, HI)[0]).toBeGreaterThan(0.99);
  });

  it('lift 는 휘도가 싼 방향으로만 밝힌다(블랙포인트가 뜨지 않는다)', () => {
    // 순청 계열이라 알파 대비 휘도 기여가 작다 — 같은 알파의 흰색 lift 대비 1/7 이하.
    expect(SHADOW_LUMA_GAIN).toBeLessThan(1 / 7);
    // 암부(중성 휘도 0.105)가 **전역 톤 전체**를 통과한 뒤의 순 휘도 상승이 5% 미만이다.
    // gain 의 하이라이트 가중 감쇠가 lift 의 대부분을 되받아친다 — 이게 "블랙포인트가 뜨지
    // 않는다"의 실제 근거이며, lift 단독 기여(7.3%)만 보면 과대평가다.
    const g0 = 0.105;
    const t = toneMap(g0, HI);
    const net = 0.2126 * t[0]! + 0.7152 * t[1]! + 0.0722 * t[2]!;
    expect(net / g0 - 1).toBeGreaterThan(0); // 미세하게 뜨긴 뜬다(색을 얻은 대가).
    expect(net / g0 - 1).toBeLessThan(0.05);
    // 반대로 하이라이트는 순 감소여야 한다(암부↑ 하이라이트↓ = 실효 대비 압축이 아니라 톤 분리).
    const th = toneMap(1, HI);
    expect(0.2126 * th[0]! + 0.7152 * th[1]! + 0.0722 * th[2]!).toBeLessThan(1);
  });
});

describe('카르곤 그레이딩 — 시차 레인과의 웜 중복 해소', () => {
  it('따뜻한 가산이 화면 하단 밖에서는 정확히 0 이다', () => {
    // 표본 ny 를 WARM_START_Y 에서 파생하면 상수를 되돌려도 표본이 같이 움직여 항진이 된다.
    // 그래서 **고정 좌표**로 잠근다 — 이 좌표들에서 0 이 아니면 시차 레인과 다시 겹친 것이다.
    expect(WARM_START_Y).toBeGreaterThanOrEqual(0.4);
    const OUTSIDE: readonly number[] = [-1, -0.8, -0.5, -0.2, 0, 0.15, 0.25, 0.35, 0.4];
    for (const nx of [-1, -0.5, 0, 0.5, 1]) {
      for (const ny of OUTSIDE) expect(warmProfile(nx, ny)).toBe(0);
    }
    // 하단에서는 실제로 켜져야 한다(웜을 통째로 죽인 것과 구분).
    expect(warmProfile(0, 1)).toBeGreaterThan(0.5);
  });

  it('전역 따뜻함은 가산이 아니라 곱연산이 맡는다(포화를 밀어올리지 않는다)', () => {
    const s = gradeStrengths('high', settings());
    // 웜 가산이 화면 최하단에서 더하는 휘도조차 3% 미만.
    const warmLift = s.warm * tintLuma(0xff8a3c);
    expect(warmLift).toBeLessThan(0.03);
    // 그리고 화면 대부분(하단 밖)에서는 가산 성분이 청색 lift 뿐이다 = 따뜻하지 않다.
    expect(toneWarmth(0.2, s)).toBeLessThan(0);
  });

  it('lift 의 파랑이 주황 배경의 채도를 실제로 떨어뜨린다(노랑 클리핑에서 멀어진다)', () => {
    const s = gradeStrengths('high', settings());
    const gain = tintChannels(0xffdcae);
    const shadow = tintChannels(0x0018ff);
    const src = [205 / 255, 120 / 255, 55 / 255];
    const out = src.map((v, c) => v * (1 - s.gain + s.gain * gain[c]!) + s.shadow * shadow[c]!);
    const sat = (v: number[]): number => (Math.max(...v) - Math.min(...v)) / Math.max(...v);
    expect(sat(out)).toBeLessThan(sat(src));
  });
});

describe('카르곤 그레이딩 — 품질 티어 단조성', () => {
  it('low ≤ med ≤ high (모든 스칼라 필드)', () => {
    for (const motion of [false, true]) {
      for (const glow of [false, true]) {
        const s = settings({ reducedMotion: motion, reducedGlow: glow });
        const lo = scalars(gradeStrengths('low', s));
        const me = scalars(gradeStrengths('med', s));
        const hi = scalars(gradeStrengths('high', s));
        for (let i = 0; i < lo.length; i++) {
          expect(lo[i]!).toBeLessThanOrEqual(me[i]!);
          expect(me[i]!).toBeLessThanOrEqual(hi[i]!);
        }
      }
    }
  });

  it('reducedGlow 는 어떤 필드도 키우지 않고 따뜻한 가산을 실제로 줄인다', () => {
    for (const tier of TIERS) {
      const off = gradeStrengths(tier, settings({ reducedGlow: false }));
      const on = gradeStrengths(tier, settings({ reducedGlow: true }));
      const a = scalars(off);
      const b = scalars(on);
      for (let i = 0; i < a.length; i++) expect(b[i]!).toBeLessThanOrEqual(a[i]!);
      expect(on.warm).toBeLessThan(off.warm);
    }
  });

  it('reducedMotion 은 어떤 필드도 키우지 않고 그레인 애니메이션을 끈다', () => {
    for (const tier of TIERS) {
      const off = gradeStrengths(tier, settings({ reducedMotion: false }));
      const on = gradeStrengths(tier, settings({ reducedMotion: true }));
      const a = scalars(off);
      const b = scalars(on);
      for (let i = 0; i < a.length; i++) expect(b[i]!).toBeLessThanOrEqual(a[i]!);
      expect(on.grainAnimation).toBe(false);
    }
  });

  it('low 티어는 그레인을 완전히 끈다', () => {
    expect(gradeStrengths('low', settings()).grain).toBe(0);
    expect(gradeStrengths('low', settings()).grainAnimation).toBe(false);
    expect(gradeStrengths('med', settings()).grain).toBeGreaterThan(0);
  });
});

describe('카르곤 그레이딩 — 레이어 계약', () => {
  it('카르곤이 아닌 행성에서는 스스로 꺼진다', () => {
    const layer = new KargonGradeLayer();
    expect(layer.configure({ planet: 1, seed: 1 })).toBe(false);
    expect(layer.configure({ planet: 5, seed: 1 })).toBe(false);
    expect(layer.configure({ planet: 0, seed: 1 })).toBe(true);
    layer.destroy();
  });

  it('renderer 없이도 던지지 않고, 굽지 못한 텍스처를 화면에 흘리지 않는다', () => {
    const layer = new KargonGradeLayer();
    layer.configure({ planet: 0, seed: 9 });
    layer.update(frame(0, 0, 1920, 1080, 120));
    // GL 없는 환경에서는 1×1 흰 텍스처로 대체되므로 알파 0 이어야 흰 사각형이 깔리지 않는다.
    for (const s of layer.overlays) expect(s.alpha).toBe(0);
    layer.destroy();
  });

  it('configure 를 반복해도 스프라이트를 다시 만들지 않는다(텍스처 누수 방지)', () => {
    const layer = new KargonGradeLayer();
    layer.configure({ planet: 0, seed: 1 });
    const first = layer.overlays.slice();
    layer.configure({ planet: 0, seed: 2 });
    const second = layer.overlays.slice();
    expect(second.length).toBe(first.length);
    for (let i = 0; i < first.length; i++) expect(second[i]).toBe(first[i]);
    layer.destroy();
  });

  it('텍스처는 configure 1회에만 굽고, 매 프레임에는 굽지 않는다', () => {
    const r = stubRenderer();
    const layer = new KargonGradeLayer();
    layer.configure({ planet: 0, seed: 11, renderer: r });
    const afterFirst = bakeCallCount(r);
    expect(afterFirst).toBe(4); // 비네트 + 따뜻함 + 차가움 + 그레인.
    for (let t = 0; t < 120; t++) layer.update(frame(0, 0, 1920, 1080, t));
    layer.configure({ planet: 0, seed: 12, renderer: r });
    expect(bakeCallCount(r)).toBe(afterFirst); // 매 프레임 0, 재-configure 도 0(캐시).
    layer.destroy();
  });

  it('렌더러가 있으면 강도가 실제 스프라이트 알파에 반영된다', () => {
    const layer = new KargonGradeLayer();
    layer.configure({ planet: 0, seed: 13, renderer: stubRenderer() });
    layer.update(frame(0, 0, 1920, 1080));
    const s = layer.activeStrengths;
    const alphas = layer.overlays.map((o) => o.alpha);
    expect(Math.max(...alphas)).toBeGreaterThan(0);
    expect(Math.max(...alphas)).toBeLessThanOrEqual(LAYER_MAX_ALPHA);
    expect(alphas).toContain(s.vignette);
    layer.destroy();
  });

  it('destroy 를 두 번 불러도 던지지 않는다', () => {
    const layer = new KargonGradeLayer();
    layer.configure({ planet: 0, seed: 1 });
    layer.destroy();
    expect(() => layer.destroy()).not.toThrow();
  });
});

describe('카르곤 그레이딩 — 결정론(ADR-0005)', () => {
  const SRC = readFileSync(
    join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'src', 'render', 'env', 'kargonGrade.ts'),
    'utf8',
  );

  it('Math.random·Date·performance 를 쓰지 않는다', () => {
    // 호출부만 본다 — 이 파일의 JSDoc 은 "Math.random 금지" 라고 적고 있어 문자열 포함 검사로는
    // 자기 자신에 걸린다(테스트가 문서를 금지하는 항진).
    expect(SRC).not.toMatch(/Math\.random\s*\(/);
    expect(SRC).not.toMatch(/performance\.now\s*\(/);
    expect(SRC).not.toMatch(/Date\.now\s*\(/);
    expect(SRC).not.toMatch(/new Date\s*\(/);
  });

  it('src/sim 을 import 하지 않는다', () => {
    expect(SRC).not.toMatch(/from\s+'[^']*\/sim\//);
  });

  it('그레인 위상이 시드·틱만으로 정해진다(같은 입력 → 같은 위상, 다른 틱 → 다른 위상)', () => {
    const a = new KargonGradeLayer();
    const b = new KargonGradeLayer();
    a.configure({ planet: 0, seed: 4242, renderer: stubRenderer() });
    b.configure({ planet: 0, seed: 4242, renderer: stubRenderer() });
    const phase = (l: KargonGradeLayer, tick: number): string => {
      l.update(frame(0, 0, 1920, 1080, tick));
      const g = l.overlays[l.overlays.length - 1] as TilingSprite;
      return `${g.tilePosition.x},${g.tilePosition.y}`;
    };
    // 같은 시드·틱이면 서로 다른 인스턴스라도 같은 위상(리플레이 재현성).
    expect(phase(a, 600)).toBe(phase(b, 600));
    // 틱이 흐르면 위상이 실제로 움직인다(정지한 그레인이 아니다).
    const seen = new Set<string>();
    for (let t = 0; t < 400; t += 8) seen.add(phase(a, t));
    expect(seen.size).toBeGreaterThan(20);
    a.destroy();
    b.destroy();
  });

  it('프로파일 함수가 순수하다(같은 입력 → 같은 출력)', () => {
    for (let i = 0; i < 20; i++) {
      const nx = (i / 19) * 2 - 1;
      const ny = ((i * 7) % 19) / 19 - 0.5;
      expect(vignetteProfile(nx, ny)).toBe(vignetteProfile(nx, ny));
      expect(warmProfile(nx, ny)).toBe(warmProfile(nx, ny));
      expect(coolProfile(nx, ny)).toBe(coolProfile(nx, ny));
    }
  });
});
