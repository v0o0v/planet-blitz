/**
 * 컬러 그레이딩·비네트 레이어 가드.
 *
 * 이 레이어는 화면 **전체**를 덮는 유일한 환경 레이어라 잘못되면 전투 자체가 안 보인다.
 * 그래서 "예쁘게 나오는가"(눈으로 볼 것)가 아니라 **망가질 수 있는 경로**를 잠근다.
 *
 * 파일이 두 층으로 나뉜다:
 *
 *  1. **테마 계약** — `ENV_THEMES` 전체를 돌며 임의의 행성이 지켜야 하는 것을 검사한다.
 *     알파 예산·가독성 캡·스플릿 톤의 존재·오버플로 부재. 새 행성이 들어오면 자동으로 대상이
 *     되므로, 카르곤이 4라운드에 걸쳐 밟은 함정을 다음 레인이 다시 밟지 않는다.
 *     **검증기가 실제로 무는지**(항진이 아닌지)는 일부러 깨뜨린 테마로 확인한다.
 *  2. **카르곤 실측** — 그 행성 고유의 수치 회귀. 여기 있는 숫자는 화면에서 얻은 것이라
 *     리팩터로 움직이면 안 된다.
 */

import { describe, it, expect } from 'vitest';
import { BufferImageSource, Texture, type Renderer, type TilingSprite } from 'pixi.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { GradeLayer, gradeStrengths as gradeStrengthsOf } from '../src/render/env/grade.js';
import {
  LAYER_MAX_ALPHA,
  CENTER_SAFE_RADIUS,
  CENTER_MIN_RETENTION,
  EDGE_MAX_DARKENING,
  GRADE_ALPHA_KEYS,
  coolAt,
  darkeningBound,
  gainLumaLoss,
  maxDarkening,
  peakStrengths,
  shadowLumaGain,
  tintChannels,
  toneMap,
  toneWarmth,
  validateGradeTheme,
  vignetteAt,
  warmAt,
  warmthCrossing,
  type GradeStrengths,
  type GradeTheme,
} from '../src/render/env/contracts/grade.js';
import { relLuminanceOf } from '../src/render/env/color.js';
import { ENV_THEMES } from '../src/render/env/themes/index.js';
import { KARGON_GRADE } from '../src/render/env/themes/kargon/grade.js';
import type { QualityTier } from '../src/render/qualityTier.js';
import { DEFAULT_GRAPHICS_SETTINGS, type GraphicsSettings } from '../src/render/graphicsSettings.js';
import type { EnvFrame } from '../src/render/env/types.js';

const TIERS: readonly QualityTier[] = ['low', 'med', 'high'];

/** 계약 테스트가 도는 그레이딩 테마 전부(행성 배정과 무관하게 등록된 모든 것). */
const GRADES: readonly GradeTheme[] = ENV_THEMES.map((t) => t.grade);

function settings(patch: Partial<GraphicsSettings> = {}): GraphicsSettings {
  return { ...DEFAULT_GRAPHICS_SETTINGS, ...patch };
}

/** 카르곤 고유 단언용 축약. 테마 무관 계약은 위쪽 describe 가 `ENV_THEMES` 전체를 돈다. */
function gradeStrengths(tier: QualityTier, s: GraphicsSettings): GradeStrengths {
  return gradeStrengthsOf(tier, s, KARGON_GRADE);
}

const K = KARGON_GRADE;
const vignetteProfile = (nx: number, ny: number): number => vignetteAt(nx, ny, K.vignette);
const warmProfile = (nx: number, ny: number): number => warmAt(nx, ny, K.warm);
const coolProfile = (nx: number, ny: number): number => coolAt(nx, ny, K.cool);
const kDarkening = (nx: number, ny: number, s: GradeStrengths): number =>
  darkeningBound(nx, ny, s, K);
const kToneMap = (g: number, s: GradeStrengths): [number, number, number] => toneMap(g, s, K);
const kToneWarmth = (g: number, s: GradeStrengths): number => toneWarmth(g, s, K);

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

// ───────────────────────── 1. 테마 계약 (전 테마) ─────────────────────────

describe('그레이딩 테마 계약 — 등록된 모든 테마', () => {
  it('테마가 하나 이상 등록돼 있다(빈 배열이면 아래 전부가 항진이 된다)', () => {
    expect(GRADES.length).toBeGreaterThan(0);
  });

  it.each(GRADES.map((g) => [g.themeId, g] as const))('%s 가 계약을 통과한다', (_id, g) => {
    expect(validateGradeTheme(g)).toEqual([]);
  });

  it.each(GRADES.map((g) => [g.themeId, g] as const))(
    '%s: 레이어가 계산하는 최대 강도가 검증기가 가정한 최대값과 같다',
    (_id, g) => {
      // 검증기는 "배율이 하나도 안 걸린 값"만 보고 예산을 판정한다. 그 가정이 레이어와 어긋나면
      // 검증이 통과해도 화면은 캡을 넘을 수 있다 — 두 경로를 여기서 묶는다.
      const peak = peakStrengths(g);
      const hi = gradeStrengthsOf('high', settings(), g);
      for (const f of SCALAR_FIELDS) expect(hi[f]).toBe(peak[f]);
    },
  );

  it.each(GRADES.map((g) => [g.themeId, g] as const))(
    '%s: 어떤 티어·설정에서도 강도가 레이어 상한을 넘지 않는다',
    (_id, g) => {
      for (const tier of TIERS) {
        for (const motion of [false, true]) {
          for (const glow of [false, true]) {
            const s = gradeStrengthsOf(tier, settings({ reducedMotion: motion, reducedGlow: glow }), g);
            for (const v of scalars(s)) {
              expect(v).toBeGreaterThanOrEqual(0);
              expect(v).toBeLessThanOrEqual(LAYER_MAX_ALPHA);
            }
          }
        }
      }
    },
  );

  it.each(GRADES.map((g) => [g.themeId, g] as const))(
    '%s: 가독성 예산 — 중앙 잔존율 하한과 가장자리 감쇠 상한을 모든 티어에서 지킨다',
    (_id, g) => {
      for (const tier of TIERS) {
        const s = gradeStrengthsOf(tier, settings(), g);
        expect(1 - maxDarkening(s, g, CENTER_SAFE_RADIUS, 32)).toBeGreaterThanOrEqual(
          CENTER_MIN_RETENTION,
        );
        expect(maxDarkening(s, g)).toBeLessThanOrEqual(EDGE_MAX_DARKENING);
      }
    },
  );

  it.each(GRADES.map((g) => [g.themeId, g] as const))(
    '%s: 화면 정중앙은 위치 의존 요소가 손대지 않는다',
    (_id, g) => {
      expect(vignetteAt(0, 0, g.vignette)).toBe(0);
      expect(warmAt(0, 0, g.warm)).toBe(0);
      expect(coolAt(0, 0, g.cool)).toBe(0);
    },
  );

  it.each(GRADES.map((g) => [g.themeId, g] as const))(
    '%s: 스플릿 톤이 선언한 방향으로 엄밀 단조이고 중간에서 부호가 바뀐다',
    (_id, g) => {
      const s = peakStrengths(g);
      const d = g.warmthDirection;
      let prev = -Infinity;
      for (let i = 0; i <= 100; i++) {
        const w = d * toneWarmth(i / 100, s, g);
        expect(w).toBeGreaterThan(prev);
        prev = w;
      }
      // 부호가 실제로 바뀐다 = 전역 캐스트가 아니라 스플릿이다.
      expect(d * toneWarmth(0, s, g)).toBeLessThan(0);
      expect(d * toneWarmth(1, s, g)).toBeGreaterThan(0);
      const cross = warmthCrossing(s, g);
      expect(cross).toBeGreaterThan(0);
      expect(cross).toBeLessThan(1);
    },
  );

  it.each(GRADES.map((g) => [g.themeId, g] as const))(
    '%s: 흰색이 어느 채널도 오버플로하지 않는다(클리핑이 단조성을 잘라 먹지 않는다)',
    (_id, g) => {
      const out = toneMap(1, peakStrengths(g), g);
      for (const c of out) expect(c).toBeLessThanOrEqual(1 + 1e-9);
    },
  );

  it.each(GRADES.map((g) => [g.themeId, g] as const))(
    '%s: lift 가 블랙포인트를 예산 이상으로 띄우지 않는다',
    (_id, g) => {
      expect(peakStrengths(g).shadow * shadowLumaGain(g)).toBeLessThanOrEqual(
        1 - CENTER_MIN_RETENTION,
      );
    },
  );

  it.each(GRADES.map((g) => [g.themeId, g] as const))(
    '%s: 티어 단조성과 접근성 토글 비증가',
    (_id, g) => {
      for (const motion of [false, true]) {
        for (const glow of [false, true]) {
          const s = settings({ reducedMotion: motion, reducedGlow: glow });
          const lo = scalars(gradeStrengthsOf('low', s, g));
          const me = scalars(gradeStrengthsOf('med', s, g));
          const hi = scalars(gradeStrengthsOf('high', s, g));
          for (let i = 0; i < lo.length; i++) {
            expect(lo[i]!).toBeLessThanOrEqual(me[i]!);
            expect(me[i]!).toBeLessThanOrEqual(hi[i]!);
          }
        }
      }
      for (const tier of TIERS) {
        const base = scalars(gradeStrengthsOf(tier, settings(), g));
        for (const patch of [{ reducedGlow: true }, { reducedMotion: true }]) {
          const cut = scalars(gradeStrengthsOf(tier, settings(patch), g));
          for (let i = 0; i < base.length; i++) expect(cut[i]!).toBeLessThanOrEqual(base[i]!);
        }
        expect(gradeStrengthsOf(tier, settings({ reducedMotion: true }), g).grainAnimation).toBe(false);
      }
    },
  );
});

// ─────────────── 2. 검증기가 실제로 무는가 (일부러 깨뜨린 테마) ───────────────

describe('그레이딩 테마 계약 — 검증기가 항진이 아니다', () => {
  /** 위반 목록에 그 자리를 가리키는 항목이 있는가. */
  function violatesAt(t: GradeTheme, where: string): boolean {
    return validateGradeTheme(t).some((v) => v.where === where);
  }

  it('알파 예산을 초과하면 잡는다 — cool 을 예전 값(0.12)으로 되돌리면 가장자리 캡이 뚫린다', () => {
    // gain 이 새로 먹는 3.6% 를 상쇄하려고 0.12 → 0.06 으로 줄인 그 값이다. 되돌리면
    // 모서리 감쇠가 상한을 넘는다 — 알파 6개가 독립 슬라이더가 아니라는 것의 실물 증거.
    const broken: GradeTheme = { ...K, alpha: { ...K.alpha, cool: 0.12 } };
    expect(violatesAt(broken, 'alpha')).toBe(true);
  });

  it('중앙을 어둡히면 잡는다 — 비네트 시작을 0 으로 당기면 전투 영역이 눌린다', () => {
    const broken: GradeTheme = { ...K, vignette: { ...K.vignette, inner: 0 } };
    expect(validateGradeTheme(broken).length).toBeGreaterThan(0);
  });

  it('비네트 코어가 중앙 안전 영역 밖으로 나가면 잡는다', () => {
    const broken: GradeTheme = { ...K, vignette: { ...K.vignette, centerY: 0.5 } };
    expect(violatesAt(broken, 'vignette.centerY')).toBe(true);
  });

  it('선언한 스플릿 방향과 색이 어긋나면 잡는다(눈 행성이 부호만 뒤집는 실수)', () => {
    const broken: GradeTheme = { ...K, warmthDirection: -1 };
    expect(violatesAt(broken, 'tint.gain')).toBe(true);
  });

  it('lift 를 죽이면 스플릿이 사라지고 잡힌다', () => {
    const broken: GradeTheme = { ...K, alpha: { ...K.alpha, shadow: 0 } };
    expect(violatesAt(broken, 'tint.shadow')).toBe(true);
  });

  it('gain 을 죽이면 기울기가 0 이라 잡힌다', () => {
    const broken: GradeTheme = { ...K, alpha: { ...K.alpha, gain: 0 } };
    expect(violatesAt(broken, 'tint.gain')).toBe(true);
  });

  it('암부 색조를 휘도가 비싼 방향으로 바꾸면 블랙포인트가 떠서 잡힌다', () => {
    // 같은 알파라도 흰색 lift 는 휘도를 7배 더 올린다.
    const broken: GradeTheme = { ...K, tint: { ...K.tint, shadow: 0xffffff } };
    expect(violatesAt(broken, 'tint.shadow')).toBe(true);
  });

  it('gain tint 의 여유보다 lift 가 크면 흰색 오버플로로 잡힌다', () => {
    const broken: GradeTheme = { ...K, tint: { ...K.tint, gain: 0xffffff } };
    expect(violatesAt(broken, 'tint')).toBe(true);
  });
});

// ───────────────────────── 3. 카르곤 실측 ─────────────────────────

describe('카르곤 그레이딩 — 알파 상한', () => {
  it('개별 상한 상수가 전부 레이어 상한 이하다', () => {
    for (const k of GRADE_ALPHA_KEYS) expect(K.alpha[k]).toBeLessThanOrEqual(LAYER_MAX_ALPHA);
  });

  it('실제 스프라이트 알파도 상한 이하다(렌더러 유무 무관)', () => {
    const layer = new GradeLayer();
    expect(layer.configure({ planet: 0, seed: 7 })).toBe(true);
    layer.update(frame(0, 0, 1920, 1080));
    for (const s of layer.overlays) expect(s.alpha).toBeLessThanOrEqual(LAYER_MAX_ALPHA);
    layer.destroy();
  });
});

describe('카르곤 그레이딩 — 화면 정합(레터박스 안전)', () => {
  const layer = new GradeLayer();
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
  it('중앙 잔존율 상한이 항진이 아니다 — 전역 gain 이 실제로 예산을 먹는다', () => {
    // 이전 판에서는 중앙 감쇠가 정확히 0 이라 이 상한이 아무것도 막지 못했다. 전역 gain 이
    // 들어온 지금은 중앙에서도 0 이 아니어야 하고, 그래도 하한 위에 남아야 한다.
    const s = gradeStrengths('high', settings());
    const center = kDarkening(0, 0, s);
    expect(center).toBeGreaterThan(0);
    expect(center).toBeCloseTo(s.gain * gainLumaLoss(K), 12);
    expect(1 - center).toBeGreaterThan(CENTER_MIN_RETENTION);
  });

  it('가장자리 감쇠 예산이 이전 판(0.3493)보다 늘지 않았다', () => {
    // 전역 gain 이 새로 먹는 3.6% 만큼 cool 을 줄여 상쇄했다는 주장의 물증. 값이 위로 새면
    // "톤을 추가하면서 화면을 더 어둡게 만들었다"가 되므로 회귀로 잡는다.
    // 상한만 두면 "요소를 지워서 통과"가 가능하다. 하한을 붙여 **예산을 실제로 다 쓰는지**도
    // 잠근다 — 전역 gain 항이나 cool 이 빠지면 여기서 걸린다.
    const worst = maxDarkening(gradeStrengths('high', settings()), K);
    expect(worst).toBeLessThanOrEqual(0.3493);
    expect(worst).toBeGreaterThan(0.34);
  });

  it('적이 주로 들어오는 좌우 변 중앙은 특히 밝게 남긴다(손실 20% 미만)', () => {
    const s = gradeStrengths('high', settings());
    for (const nx of [-1, 1]) {
      expect(kDarkening(nx, 0, s)).toBeLessThan(0.2);
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
        const v = vignetteProfile(Math.cos(dir) * d, K.vignette.centerY + Math.sin(dir) * d);
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
    const shadow = kToneMap(0.05, HI);
    const highlight = kToneMap(1, HI);
    // 암부: 파랑이 빨강보다 확실히 위 = 청보라.
    expect(shadow[2]).toBeGreaterThan(shadow[0] + 0.03);
    // 하이라이트: R ≥ G ≥ B = 황백(따뜻한 흰색). 등호 없이 실제로 기울어야 한다.
    expect(highlight[0]).toBeGreaterThan(highlight[1]);
    expect(highlight[1]).toBeGreaterThan(highlight[2] - 1e-9);
    expect(highlight[0]).toBeGreaterThan(highlight[2] + 0.02);
  });

  it('교차점이 중간 대역에 있다(한쪽 끝에 붙으면 사실상 단색 캐스트다)', () => {
    const cross = warmthCrossing(HI, K);
    expect(cross).toBeGreaterThan(0.2);
    expect(cross).toBeLessThan(0.8);
  });

  it('교차점이 품질 티어에 무관하다(티어를 낮췄더니 화면 성격이 바뀌면 안 된다)', () => {
    const base = warmthCrossing(HI, K);
    for (const tier of TIERS) {
      expect(warmthCrossing(gradeStrengths(tier, settings()), K)).toBeCloseTo(base, 6);
    }
  });

  it('lift 나 gain 중 하나만 죽여도 스플릿이 사라진다(두 항 모두가 필수다)', () => {
    const noLift: GradeStrengths = { ...HI, shadow: 0 };
    const noGain: GradeStrengths = { ...HI, gain: 0 };
    // lift 가 없으면 암부가 그냥 검정 — 부호가 안 바뀐다(전 구간 따뜻함 ≥ 0).
    expect(kToneWarmth(0, noLift)).toBeCloseTo(0, 9);
    expect(kToneWarmth(0.05, noLift)).toBeGreaterThan(0);
    // gain 이 없으면 기울기가 0 — 명도가 올라가도 톤이 안 따뜻해진다(전역 파란 캐스트).
    expect(kToneWarmth(1, noGain)).toBeCloseTo(kToneWarmth(0, noGain), 9);
    expect(kToneWarmth(1, noGain)).toBeLessThan(0);
  });
});

describe('카르곤 그레이딩 — 하이라이트 가중 감쇠(롤오프의 아핀 근사)', () => {
  const HI = gradeStrengths('high', settings());

  /** gain 을 통과한 중성 회색 g 의 절대 휘도 손실. */
  const gainLoss = (g: number): number => g * HI.gain * gainLumaLoss(K);

  it('절대 밝기 손실이 입력 밝기에 정비례한다 — 암부는 사실상 안 깎인다', () => {
    expect(gainLoss(0)).toBe(0);
    // 최상단은 암부(0.1)의 정확히 10배를 잃는다.
    expect(gainLoss(1)).toBeCloseTo(gainLoss(0.1) * 10, 9);
    // 8비트 환산: 흰색 ≥ 8/255 손실, 어두운 바닥 ≤ 1.5/255 손실.
    expect(gainLoss(1) * 255).toBeGreaterThan(8);
    expect(gainLoss(0.105) * 255).toBeLessThan(1.5);
  });

  it('gain tint 는 R=255 여서 흰색이 오버플로도 손실도 없이 착지한다(단조성의 근거)', () => {
    expect(tintChannels(K.tint.gain)[0]).toBe(1);
    expect(kToneMap(1, HI)[0]).toBeLessThanOrEqual(1 + 1e-9);
    expect(kToneMap(1, HI)[0]).toBeGreaterThan(0.99);
  });

  it('lift 는 휘도가 싼 방향으로만 밝힌다(블랙포인트가 뜨지 않는다)', () => {
    // 순청 계열이라 알파 대비 휘도 기여가 작다 — 같은 알파의 흰색 lift 대비 1/7 이하.
    expect(shadowLumaGain(K)).toBeLessThan(1 / 7);
    // 암부(중성 휘도 0.105)가 **전역 톤 전체**를 통과한 뒤의 순 휘도 상승이 5% 미만이다.
    // gain 의 하이라이트 가중 감쇠가 lift 의 대부분을 되받아친다 — 이게 "블랙포인트가 뜨지
    // 않는다"의 실제 근거이며, lift 단독 기여(7.3%)만 보면 과대평가다.
    const g0 = 0.105;
    const t = kToneMap(g0, HI);
    const net = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
    expect(net / g0 - 1).toBeGreaterThan(0); // 미세하게 뜨긴 뜬다(색을 얻은 대가).
    expect(net / g0 - 1).toBeLessThan(0.05);
    // 반대로 하이라이트는 순 감소여야 한다(암부↑ 하이라이트↓ = 실효 대비 압축이 아니라 톤 분리).
    const th = kToneMap(1, HI);
    expect(0.2126 * th[0] + 0.7152 * th[1] + 0.0722 * th[2]).toBeLessThan(1);
  });
});

describe('카르곤 그레이딩 — 시차 레인과의 웜 중복 해소', () => {
  it('따뜻한 가산이 화면 하단 밖에서는 정확히 0 이다', () => {
    // 표본 ny 를 startY 에서 파생하면 값을 되돌려도 표본이 같이 움직여 항진이 된다.
    // 그래서 **고정 좌표**로 잠근다 — 이 좌표들에서 0 이 아니면 시차 레인과 다시 겹친 것이다.
    expect(K.warm.startY).toBeGreaterThanOrEqual(0.4);
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
    expect(s.warm * relLuminanceOf(0xff8a3c)).toBeLessThan(0.03);
    // 그리고 화면 대부분(하단 밖)에서는 가산 성분이 청색 lift 뿐이다 = 따뜻하지 않다.
    expect(kToneWarmth(0.2, s)).toBeLessThan(0);
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

describe('카르곤 그레이딩 — 품질 티어 대응', () => {
  it('reducedGlow 가 따뜻한 가산을 실제로 줄인다', () => {
    for (const tier of TIERS) {
      expect(gradeStrengths(tier, settings({ reducedGlow: true })).warm).toBeLessThan(
        gradeStrengths(tier, settings({ reducedGlow: false })).warm,
      );
    }
  });

  it('low 티어는 그레인을 완전히 끈다', () => {
    expect(gradeStrengths('low', settings()).grain).toBe(0);
    expect(gradeStrengths('low', settings()).grainAnimation).toBe(false);
    expect(gradeStrengths('med', settings()).grain).toBeGreaterThan(0);
  });
});

// ───────────────────────── 4. 레이어 계약 ─────────────────────────

describe('그레이딩 레이어 계약', () => {
  it('담당 테마가 없는 행성에서는 스스로 꺼진다', () => {
    // 행성 인덱스를 리터럴로 적으면 그 행성에 테마가 생기는 순간 이 단언이 "레이어가 꺼진다"가
    // 아니라 "아직 아무도 안 만들었다"를 재게 된다(Phase 2 에서 실제로 그렇게 깨졌다).
    // 등록된 담당 행성에서 **파생**해 영원히 비어 있는 인덱스를 쓴다.
    const claimed = new Set(ENV_THEMES.flatMap((t) => t.planets));
    let unclaimed = 0;
    while (claimed.has(unclaimed)) unclaimed += 1;
    const layer = new GradeLayer();
    expect(layer.configure({ planet: unclaimed, seed: 1 })).toBe(false);
    expect(layer.configure({ planet: 0, seed: 1 })).toBe(true);
    layer.destroy();
  });

  it('renderer 없이도 던지지 않고, 굽지 못한 텍스처를 화면에 흘리지 않는다', () => {
    const layer = new GradeLayer();
    layer.configure({ planet: 0, seed: 9 });
    layer.update(frame(0, 0, 1920, 1080, 120));
    // GL 없는 환경에서는 1×1 흰 텍스처로 대체되므로 알파 0 이어야 흰 사각형이 깔리지 않는다.
    for (const s of layer.overlays) expect(s.alpha).toBe(0);
    layer.destroy();
  });

  it('같은 테마로 configure 를 반복해도 스프라이트를 다시 만들지 않는다(텍스처 누수 방지)', () => {
    const layer = new GradeLayer();
    layer.configure({ planet: 0, seed: 1 });
    const first = layer.overlays.slice();
    layer.configure({ planet: 0, seed: 2 });
    const second = layer.overlays.slice();
    expect(second.length).toBe(first.length);
    for (let i = 0; i < first.length; i++) expect(second[i]).toBe(first[i]);
    layer.destroy();
  });

  it('텍스처는 테마당 1회만 굽고, 매 프레임에는 굽지 않는다', () => {
    const r = stubRenderer();
    const layer = new GradeLayer();
    layer.configure({ planet: 0, seed: 11, renderer: r });
    const afterFirst = bakeCallCount(r);
    expect(afterFirst).toBe(4); // 비네트 + 따뜻함 + 차가움 + 그레인.
    for (let t = 0; t < 120; t++) layer.update(frame(0, 0, 1920, 1080, t));
    layer.configure({ planet: 0, seed: 12, renderer: r });
    expect(bakeCallCount(r)).toBe(afterFirst); // 매 프레임 0, 같은 테마 재-configure 도 0(캐시).
    layer.destroy();
  });

  it('렌더러가 있으면 강도가 실제 스프라이트 알파에 반영된다', () => {
    const layer = new GradeLayer();
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
    const layer = new GradeLayer();
    layer.configure({ planet: 0, seed: 1 });
    layer.destroy();
    expect(() => layer.destroy()).not.toThrow();
  });
});

// ───────────────────────── 5. 결정론(ADR-0005) ─────────────────────────

describe('그레이딩 — 결정론(ADR-0005)', () => {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  /** 이 레인이 소유한 소스 전부. 파일을 쪼갤 때 가드가 조용히 빠지지 않도록 함께 나열한다. */
  const OWNED: readonly [string, string][] = [
    ['grade.ts', join(ROOT, 'src', 'render', 'env', 'grade.ts')],
    ['contracts/grade.ts', join(ROOT, 'src', 'render', 'env', 'contracts', 'grade.ts')],
    ['themes/kargon/grade.ts', join(ROOT, 'src', 'render', 'env', 'themes', 'kargon', 'grade.ts')],
  ];
  const SOURCES = OWNED.map(([label, path]) => [label, readFileSync(path, 'utf8')] as const);

  it.each(SOURCES)('%s 가 Math.random·Date·performance 를 쓰지 않는다', (_label, src) => {
    // 호출부만 본다 — 이 파일들의 JSDoc 은 "Math.random 금지" 라고 적고 있어 문자열 포함
    // 검사로는 자기 자신에 걸린다(테스트가 문서를 금지하는 항진).
    expect(src).not.toMatch(/Math\.random\s*\(/);
    expect(src).not.toMatch(/performance\.now\s*\(/);
    expect(src).not.toMatch(/Date\.now\s*\(/);
    expect(src).not.toMatch(/new Date\s*\(/);
  });

  it.each(SOURCES)('%s 가 src/sim 을 import 하지 않는다', (_label, src) => {
    expect(src).not.toMatch(/from\s+'[^']*\/sim\//);
  });

  it('그레인 위상이 시드·틱만으로 정해진다(같은 입력 → 같은 위상, 다른 틱 → 다른 위상)', () => {
    const a = new GradeLayer();
    const b = new GradeLayer();
    a.configure({ planet: 0, seed: 4242, renderer: stubRenderer() });
    b.configure({ planet: 0, seed: 4242, renderer: stubRenderer() });
    const phase = (l: GradeLayer, tick: number): string => {
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
