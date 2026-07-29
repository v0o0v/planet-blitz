/**
 * 저주파 환경 변조(시차) 레이어 — **테마 계약**과 순수 함수 잠금.
 *
 * 세 층으로 나뉜다:
 *  1. 메커니즘(순수 함수) — 결정론과 시차의 뼈대. 행성과 무관하다.
 *  2. **임의 테마가 만족해야 하는 계약** — `ENV_THEMES` 전체를 돌며 `validateParallaxTheme` 를
 *     강제하고, **일부러 깨뜨린 테마가 실제로 걸리는지**까지 확인한다. 이게 없으면 새 행성
 *     테마가 아무 검증 없이 들어온다(검증 함수가 항진이어도 아무도 모른다).
 *  3. 카르곤 고유 실측 — 그 행성 타일셋에서 잰 값들. 다른 행성에 그대로 적용되지 않는다.
 *
 * 마지막으로 **테마 전환 회귀** 2건: 텍스처 캐시가 테마별로 갈리는가, 행성이 바뀌면 이전
 * 스프라이트가 걷히는가. 둘 다 예외 없이 조용히 틀린 화면을 내는 결함이라 테스트로만 잡힌다.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  FALLOFF_SOFT,
  FALLOFF_TIGHT,
  FALLOFF_WIDE,
  bandCoverage,
  bandModulationEnergy,
  bandPeakLuminanceDelta,
  domainModulationEnergy,
  falloffHalfRadius,
  parallaxLuminanceSwing,
  parallaxModulationEnergy,
  parallaxNetPeakDelta,
  parallaxRelativeModulation,
  relLuminance,
  validateParallaxTheme,
  type BandSpec,
  type ParallaxTheme,
} from '../src/render/env/contracts/parallax.js';
import { KARGON_PARALLAX } from '../src/render/env/themes/kargon/parallax.js';

/**
 * 레이어가 쓰는 레지스트리에 **테스트 전용 테마 2개**를 얹는다(실제 행성 인덱스와 겹치지 않는
 * 99·98). 테마 전환 회귀는 "테마 A → 테마 B" 를 실제로 밟아야만 재현되는데, 프로덕션
 * 레지스트리에는 아직 카르곤 하나뿐이라 이 seam 이 없으면 두 결함을 영원히 관측할 수 없다.
 *
 * `ENV_THEMES` 는 **건드리지 않는다** — 전 테마 계약 테스트는 진짜 등록된 테마만 봐야 한다.
 */
const hoisted = vi.hoisted(() => ({
  extra: [] as { planets: readonly number[]; parallax: unknown }[],
}));
vi.mock('../src/render/env/themes/index.js', async (orig) => {
  const actual = await orig<typeof import('../src/render/env/themes/index.js')>();
  return {
    ...actual,
    themeFor: (planet: number) =>
      hoisted.extra.find((t) => t.planets.includes(planet)) ?? actual.themeFor(planet),
  };
});

const { ENV_THEMES, themeFor } = await import('../src/render/env/themes/index.js');
const { ParallaxLayer, bandPulse, bandSeedOffset, bandTileOffset, wrapOffset } = await import(
  '../src/render/env/parallax.js'
);

/* ────────────────────────── 테스트 전용 테마 2종 ────────────────────────── */

/**
 * 카르곤과 **대역 이름이 같고 색만 다른** 두 테마. 텍스처 캐시 키가 대역 이름뿐이면 두 테마가
 * 같은 텍스처를 공유하게 되는데, 이름이 다르면 그 결함이 재현되지 않는다. 그래서 일부러 같다.
 */
function testTheme(themeId: string, skeletonColor: string, bounceColor: string): ParallaxTheme {
  return {
    themeId,
    baseLuma: 0.2,
    darkLuma: 0.1,
    brightLuma: 0.48,
    bands: [
      {
        key: 'skeleton',
        domain: 'lit',
        parallax: 0.12,
        tile: 4800,
        alpha: 0.5,
        blend: 'normal',
        color: skeletonColor,
        blobs: 4,
        rMin: 0.22,
        rMax: 0.4,
        peak: 0.9,
        falloff: FALLOFF_WIDE,
        driftX: -0.02,
        driftY: 0.028,
        pulse: 0.08,
        period: 900,
        minTier: 'low',
        glow: false,
      },
      {
        key: 'bounce',
        domain: 'shadow',
        parallax: 0.2,
        tile: 3200,
        alpha: 0.55,
        blend: 'add',
        color: bounceColor,
        blobs: 7,
        rMin: 0.18,
        rMax: 0.34,
        peak: 0.66,
        falloff: FALLOFF_SOFT,
        driftX: 0.04,
        driftY: -0.02,
        pulse: 0.12,
        period: 820,
        minTier: 'low',
        glow: false,
      },
    ],
  };
}

/** 한색 계열 테마. */
const THEME_B = testTheme('test_b', '#050508', '#141480');
/** 난색 계열 테마 — B 와 대역 이름은 같고 색만 다르다. */
const THEME_C = testTheme('test_c', '#080508', '#801414');

hoisted.extra.push({ planets: [99], parallax: THEME_B });
hoisted.extra.push({ planets: [98], parallax: THEME_C });

/** 카르곤 테마 데이터(이 파일의 3층 = 카르곤 실측 단언이 참조한다). */
const KARGON = KARGON_PARALLAX;

/** 이름으로 카르곤 대역 하나를 집는다(표 순서가 바뀌어도 테스트가 따라 깨지지 않게). */
function band(key: string): BandSpec {
  const b = KARGON.bands.find((x) => x.key === key);
  if (b === undefined) throw new Error(`대역 없음: ${key}`);
  return b;
}

/** 색이 한색(청)인가 — `#rrggbb` 의 B 가 R 보다 큰가. */
function isCool(hex: string): boolean {
  const v = Number.parseInt(hex.slice(1), 16);
  return (v & 0xff) > ((v >> 16) & 0xff);
}

/** 위반 목록에 `where` 를 포함하는 항목이 있는가. */
function violatesAt(t: ParallaxTheme, where: string): boolean {
  return validateParallaxTheme(t).some((v) => v.where.includes(where));
}

/** 대역 하나만 갈아 끼운 테마(계약 위반 주입용). */
function withBand(base: ParallaxTheme, index: number, over: Partial<BandSpec>): ParallaxTheme {
  const bands = base.bands.map((b, i) => (i === index ? { ...b, ...over } : b));
  return { ...base, bands };
}

/**
 * **2차 대조군**: 카르곤 3차 직전 대역 표를 그대로 얼려 둔 리터럴.
 *
 * 3차의 주장("암부가 이제 반응한다")은 절대 수치로는 증명되지 않는다 — 상한을 정할 근거가
 * 없기 때문이다. 그래서 같은 함수로 2차 표를 재고 **개선 배수**를 잠근다. 이 대조군이
 * 현재 표에서 spread 로 파생되면 상수 변경이 대조군까지 같이 움직여 항진이 되므로,
 * 값을 전부 리터럴로 박는다.
 */
const SECOND_PASS_BANDS: readonly BandSpec[] = [
  {
    key: 'r2:cool-shadow',
    domain: 'lit',
    parallax: 0.1,
    tile: 5200,
    alpha: 0.5,
    blend: 'normal',
    color: '#080512',
    blobs: 4,
    rMin: 0.22,
    rMax: 0.4,
    peak: 0.9,
    falloff: [
      [0, 1],
      [0.45, 0.62],
      [0.8, 0.2],
      [1, 0],
    ],
    driftX: -0.02,
    driftY: 0.028,
    pulse: 0.08,
    period: 900,
    minTier: 'low',
    glow: false,
  },
  {
    key: 'r2:ash-pocket',
    domain: 'lit',
    parallax: 0.16,
    tile: 3600,
    alpha: 0.06,
    blend: 'normal',
    color: '#4a4250',
    blobs: 5,
    rMin: 0.09,
    rMax: 0.18,
    peak: 0.5,
    falloff: [
      [0, 1],
      [0.5, 0.5],
      [1, 0],
    ],
    driftX: 0.04,
    driftY: -0.02,
    pulse: 0.1,
    period: 780,
    minTier: 'med',
    glow: false,
  },
  {
    key: 'r2:far-glow',
    domain: 'lit',
    parallax: 0.24,
    tile: 2800,
    alpha: 0.1,
    blend: 'add',
    color: '#e8501c',
    blobs: 4,
    rMin: 0.28,
    rMax: 0.46,
    peak: 0.45,
    falloff: [
      [0, 1],
      [0.45, 0.62],
      [0.8, 0.2],
      [1, 0],
    ],
    driftX: 0.03,
    driftY: 0.015,
    pulse: 0.22,
    period: 640,
    minTier: 'low',
    glow: true,
  },
  {
    key: 'r2:near-ember',
    domain: 'lit',
    parallax: 0.33,
    tile: 2200,
    alpha: 0.13,
    blend: 'add',
    color: '#ff9440',
    blobs: 10,
    rMin: 0.07,
    rMax: 0.15,
    peak: 0.52,
    falloff: [
      [0, 1],
      [0.25, 0.45],
      [0.6, 0.08],
      [1, 0],
    ],
    driftX: 0.05,
    driftY: -0.04,
    pulse: 0.3,
    period: 430,
    minTier: 'high',
    glow: true,
  },
];

/* ══════════════════════════ 1층: 메커니즘(행성 무관) ══════════════════════════ */

describe('wrapOffset', () => {
  it('항상 [0, period) 로 접는다(음수 포함)', () => {
    expect(wrapOffset(10, 4)).toBeCloseTo(2, 10);
    expect(wrapOffset(-1, 4)).toBeCloseTo(3, 10);
    expect(wrapOffset(-9, 4)).toBeCloseTo(3, 10);
    expect(wrapOffset(0, 4)).toBe(0);
  });

  it('손상 입력에서 던지지 않고 0 을 준다', () => {
    expect(wrapOffset(1, 0)).toBe(0);
    expect(wrapOffset(Number.NaN, 4)).toBe(0);
    expect(wrapOffset(1, Number.NaN)).toBe(0);
  });

  it('아주 큰 월드 좌표도 작은 값으로 줄인다(f32 UV swim 방지의 핵심)', () => {
    const v = wrapOffset(1_234_567.75, 2800);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(2800);
  });
});

describe('bandSeedOffset', () => {
  it('같은 시드·대역·축이면 항상 같다', () => {
    expect(bandSeedOffset(1234, 2, 0, 2800)).toBe(bandSeedOffset(1234, 2, 0, 2800));
  });

  it('시드가 다르면 오프셋이 달라진다(런별 변화의 유일한 근원)', () => {
    expect(bandSeedOffset(1, 0, 0, 2800)).not.toBe(bandSeedOffset(2, 0, 0, 2800));
  });

  it('x 축과 y 축이 독립이다', () => {
    expect(bandSeedOffset(77, 1, 0, 2800)).not.toBe(bandSeedOffset(77, 1, 1, 2800));
  });

  it('항상 [0, period) 안이다', () => {
    for (let s = 0; s < 40; s++) {
      for (let b = 0; b < 4; b++) {
        const v = bandSeedOffset(s, b, 0, 1900);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1900);
      }
    }
  });
});

describe('bandTileOffset', () => {
  it('같은 입력 → 같은 값(순수)', () => {
    const a = bandTileOffset(500, 0.24, 100, 0.03, 900, -40, 2800);
    const b = bandTileOffset(500, 0.24, 100, 0.03, 900, -40, 2800);
    expect(a).toBe(b);
  });

  it('카메라가 움직이면 값이 변한다', () => {
    const a = bandTileOffset(0, 0.24, 0, 0, 0, 0, 2800);
    const b = bandTileOffset(400, 0.24, 0, 0, 0, 0, 2800);
    expect(a).not.toBeCloseTo(b, 6);
  });

  it('틱이 지나면 드리프트로 값이 변한다(정지 화면도 살아 있다)', () => {
    const a = bandTileOffset(0, 0.24, 0, 0.05, 0, 0, 2800);
    const b = bandTileOffset(0, 0.24, 0, 0.05, 600, 0, 2800);
    expect(a).not.toBeCloseTo(b, 6);
  });

  it('시차 계수가 작을수록 같은 카메라 이동에 덜 움직인다(= 더 멀다)', () => {
    // 주기 접힘에 걸리지 않도록 이동량을 작게 잡고 무접힘 구간에서 비교한다.
    const dCam = 200;
    const near = Math.abs(
      bandTileOffset(dCam, 0.33, 1000, 0, 0, 0, 1900) - bandTileOffset(0, 0.33, 1000, 0, 0, 0, 1900),
    );
    const far = Math.abs(
      bandTileOffset(dCam, 0.1, 1000, 0, 0, 0, 5200) - bandTileOffset(0, 0.1, 1000, 0, 0, 0, 5200),
    );
    expect(far).toBeLessThan(near);
  });

  it('결과는 항상 [0, period)', () => {
    for (let c = -5000; c <= 5000; c += 137) {
      const v = bandTileOffset(c, 0.16, 123, 0.03, c, -60, 3600);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(3600);
    }
  });
});

describe('bandPulse', () => {
  it('같은 틱 → 같은 값', () => {
    expect(bandPulse(123.5, 640, 0.22, 0.37)).toBe(bandPulse(123.5, 640, 0.22, 0.37));
  });

  it('틱이 달라지면 값이 변한다(항진 방지)', () => {
    expect(bandPulse(0, 640, 0.22, 0)).not.toBeCloseTo(bandPulse(160, 640, 0.22, 0), 6);
  });

  it('[1-amplitude, 1] 안에 머문다', () => {
    for (let t = 0; t < 1400; t += 7) {
      const v = bandPulse(t, 640, 0.22, 0.37);
      expect(v).toBeGreaterThanOrEqual(1 - 0.22 - 1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('진폭 0 이면 상수 1(맥동 끄기)', () => {
    expect(bandPulse(37, 640, 0, 0)).toBeCloseTo(1, 10);
    expect(bandPulse(999, 640, 0, 0)).toBeCloseTo(1, 10);
  });

  it('주기가 유효하지 않으면 1(방어)', () => {
    expect(bandPulse(10, 0, 0.3, 0)).toBe(1);
  });
});

describe('relLuminance', () => {
  it('흑·백·회색을 맞게 잰다', () => {
    expect(relLuminance('#000000')).toBeCloseTo(0, 10);
    expect(relLuminance('#ffffff')).toBeCloseTo(1, 10);
    expect(relLuminance('#808080')).toBeCloseTo(128 / 255, 6);
  });

  it('녹색이 청색보다 훨씬 밝게 잡힌다(Rec.709 가중)', () => {
    expect(relLuminance('#00ff00')).toBeGreaterThan(relLuminance('#0000ff'));
  });

  it('손상 입력은 0(던지지 않는다)', () => {
    expect(relLuminance('nope')).toBe(0);
    expect(relLuminance('#fff')).toBe(0);
  });
});

/* ══════════════════════════ 2층: 임의 테마가 만족해야 하는 계약 ══════════════════════════ */

describe('전 테마 계약', () => {
  it('등록된 모든 테마가 시차 계약을 통과한다', () => {
    expect(ENV_THEMES.length).toBeGreaterThan(0);
    for (const t of ENV_THEMES) {
      expect(validateParallaxTheme(t.parallax), `${t.id}: ${JSON.stringify(validateParallaxTheme(t.parallax))}`).toEqual([]);
    }
  });

  it('테마 슬러그와 시차 슬러그가 일치하고 서로 유일하다(캐시 키 접두의 근거)', () => {
    // 두 테마가 같은 `parallax.themeId` 를 쓰면 캐시 키에 테마를 넣어도 여전히 충돌한다.
    const ids = ENV_THEMES.map((t) => t.parallax.themeId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of ENV_THEMES) expect(t.parallax.themeId).toBe(t.id);
  });

  it('카르곤 테마가 실제로 레지스트리에 물려 있다(모듈만 만들고 안 쓰는 결함 방지)', () => {
    expect(themeFor(0)?.parallax).toBe(KARGON_PARALLAX);
    expect(ENV_THEMES.some((t) => t.parallax === KARGON_PARALLAX)).toBe(true);
  });

  it('테스트용 합성 테마도 계약을 통과한다(검증이 카르곤 전용이 아니다)', () => {
    expect(validateParallaxTheme(THEME_B)).toEqual([]);
    expect(validateParallaxTheme(THEME_C)).toEqual([]);
  });
});

/**
 * 검증 함수가 **항진이 아님**을 반증으로 확인한다. 여기 있는 위반은 전부 예외를 던지지 않고
 * 조용히 잘못된 화면을 내는 것들이라, 이 테스트가 없으면 `validateParallaxTheme` 이 언제
 * 무력화됐는지 아무도 모른다.
 */
describe('계약 위반 탐지', () => {
  it('슬러그가 아닌 themeId 를 잡는다', () => {
    expect(violatesAt({ ...THEME_B, themeId: 'Test B' }, 'themeId')).toBe(true);
  });

  it('휘도 순서가 뒤집히면 잡는다(domain 축이 의미를 잃는다)', () => {
    expect(violatesAt({ ...THEME_B, darkLuma: 0.3 }, 'darkLuma')).toBe(true);
    expect(violatesAt({ ...THEME_B, brightLuma: 0.1 }, 'brightLuma')).toBe(true);
  });

  it('대역이 없으면 잡는다', () => {
    expect(violatesAt({ ...THEME_B, bands: [] }, 'bands')).toBe(true);
  });

  it('대역 이름 중복·구분자 혼입을 잡는다(텍스처가 조용히 공유된다)', () => {
    expect(violatesAt(withBand(THEME_B, 1, { key: 'skeleton' }), 'key')).toBe(true);
    expect(violatesAt(withBand(THEME_B, 0, { key: 'a:b' }), 'key')).toBe(true);
  });

  it('시차·주기 순서가 뒤집히면 잡는다(대기 원근이 무너진다)', () => {
    expect(violatesAt(withBand(THEME_B, 1, { parallax: 0.05 }), 'parallax')).toBe(true);
    expect(violatesAt(withBand(THEME_B, 1, { tile: 9000 }), 'tile')).toBe(true);
  });

  it('시차가 1 이상이면 잡는다(지형보다 빨라 원경으로 안 읽힌다)', () => {
    expect(violatesAt(withBand(THEME_B, 0, { parallax: 1.2 }), 'parallax')).toBe(true);
  });

  it('주기가 화면보다 작으면 잡는다(반복 무늬가 보인다)', () => {
    expect(violatesAt(withBand(THEME_B, 1, { tile: 800 }), 'tile')).toBe(true);
  });

  it("domain='shadow' 인데 blend='normal' 이면 잡는다(암부에서 델타가 0 으로 수렴)", () => {
    expect(violatesAt(withBand(THEME_B, 1, { blend: 'normal' }), 'blend')).toBe(true);
  });

  it('normal 대역 색이 암부 바닥보다 밝으면 잡는다(부호가 뒤집혀 죽은 대역이 된다)', () => {
    expect(violatesAt(withBand(THEME_B, 0, { color: '#8899aa' }), 'color')).toBe(true);
  });

  it('감쇠 프로파일 구조 위반을 잡는다(캔버스가 던져 대역이 조용히 사라지는 자리)', () => {
    // 가장자리 알파가 0 이 아니다 → 블롭 경계에 원형 컷.
    expect(
      violatesAt(
        withBand(THEME_B, 0, {
          falloff: [
            [0, 1],
            [1, 0.3],
          ],
        }),
        'falloff',
      ),
    ).toBe(true);
    // offset 이 오름차순이 아니다 → addColorStop 이 던진다.
    expect(
      violatesAt(
        withBand(THEME_B, 0, {
          falloff: [
            [0, 1],
            [0.8, 0.5],
            [0.4, 0],
          ],
        }),
        'falloff',
      ),
    ).toBe(true);
    // 바깥으로 갈수록 알파가 커진다 → 실효 반경 역보간이 엉뚱한 값을 낸다.
    expect(
      violatesAt(
        withBand(THEME_B, 0, {
          falloff: [
            [0, 0.2],
            [0.5, 0.9],
            [1, 0],
          ],
        }),
        'falloff',
      ),
    ).toBe(true);
  });

  it('스칼라 범위 위반을 잡는다', () => {
    expect(violatesAt(withBand(THEME_B, 0, { alpha: 0 }), 'alpha')).toBe(true);
    expect(violatesAt(withBand(THEME_B, 0, { peak: 1.5 }), 'peak')).toBe(true);
    expect(violatesAt(withBand(THEME_B, 0, { blobs: 0 }), 'blobs')).toBe(true);
    expect(violatesAt(withBand(THEME_B, 0, { rMin: 0.9, rMax: 0.3 }), 'rMin')).toBe(true);
    expect(violatesAt(withBand(THEME_B, 0, { period: 0 }), 'period')).toBe(true);
    expect(violatesAt(withBand(THEME_B, 0, { color: 'red' }), 'color')).toBe(true);
  });

  it("minTier='low' 대역이 없으면 잡는다(저티어에서 레이어가 통째로 사라진다)", () => {
    const allHigh = { ...THEME_B, bands: THEME_B.bands.map((b) => ({ ...b, minTier: 'high' as const })) };
    expect(violatesAt(allHigh, 'minTier')).toBe(true);
  });

  it('암부에서 lit 대역이 shadow 대역보다 크게 일하면 잡는다(domain 이 라벨뿐이 된다)', () => {
    // shadow 대역의 세기를 반으로 죽이면 lit 골격이 암부를 지배한다.
    expect(violatesAt(withBand(THEME_B, 1, { alpha: 0.05 }), 'domain')).toBe(true);
  });

  it('밝은 바닥에서 배경이 밝아지면 잡는다(함선이 화면에서 가장 밝아야 한다)', () => {
    // 어둡히는 골격을 가산으로 뒤집으면 순 델타가 양수가 된다.
    const lifted = withBand(THEME_B, 0, { blend: 'add' as const, color: '#c0c0c0' });
    expect(validateParallaxTheme(lifted).length).toBeGreaterThan(0);
    expect(parallaxNetPeakDelta(lifted.brightLuma, lifted.bands)).toBeGreaterThan(0);
  });
});

/* ══════════════════════════ 3층: 카르곤 고유 실측 ══════════════════════════ */

describe('카르곤 대역 표', () => {
  it('시차가 원경으로 읽히는 범위 안이다(0, 0.35]', () => {
    for (const b of KARGON.bands) {
      expect(b.parallax).toBeGreaterThan(0);
      expect(b.parallax).toBeLessThanOrEqual(0.35);
    }
  });

  it('따뜻한 가산 대역의 밝힘 예산이 보수적이다(알파가 아니라 휘도로 잰다)', () => {
    // 2차는 이 상한을 **알파 합**으로 걸었는데, 그건 색을 무시한 잘못된 대리 지표다.
    // 저휘도 한색(`shadow-bounce`)은 알파가 커도 화면을 거의 안 띄우고, 밝은 호박색은
    // 알파가 작아도 크게 띄운다. 화면을 띄우는 실체는 **가산 휘도 기여**다.
    const warmLift = KARGON.bands
      .filter((b) => b.blend === 'add' && !isCool(b.color))
      .map((b) => bandPeakLuminanceDelta(b, KARGON.baseLuma))
      .reduce((a, b) => a + b, 0);
    expect(warmLift).toBeGreaterThan(0);
    expect(warmLift).toBeLessThan(0.05);
  });

  it('암부 대역의 진폭이 따뜻한 가산 대역 **각각의** 2배 이상이다', () => {
    // 비평가의 처방: "어두운 타일에 적용하고 진폭을 주황보다 2~3배 크게".
    const cool = KARGON.bands.filter((b) => b.domain === 'shadow');
    expect(cool.length).toBeGreaterThan(0);
    const coolPeak = Math.max(
      ...cool.map((b) => Math.abs(bandPeakLuminanceDelta(b, KARGON.baseLuma))),
    );
    for (const w of KARGON.bands.filter((b) => b.blend === 'add' && !isCool(b.color))) {
      expect(coolPeak).toBeGreaterThanOrEqual(
        Math.abs(bandPeakLuminanceDelta(w, KARGON.baseLuma)) * 2,
      );
    }
  });

  it('카르곤 `shadow` 대역은 한색이다(주황 지형의 보색으로 색조를 나눈다)', () => {
    // 이건 계약이 아니라 카르곤 팔레트 결정이다 — 눈 행성이라면 뒤집힐 수 있다.
    for (const b of KARGON.bands.filter((x) => x.domain === 'shadow')) {
      expect(isCool(b.color)).toBe(true);
      expect(relLuminance(b.color)).toBeLessThan(0.2);
    }
  });

  it('저티어 장수가 2장이다(fill-rate 중립)', () => {
    // `shadow-bounce` 를 저티어에 넣는 대신 `far-glow` 를 med 로 올려 장수를 늘리지 않았다.
    expect(band('shadow-bounce').minTier).toBe('low');
    expect(band('cool-shadow').minTier).toBe('low');
    expect(KARGON.bands.filter((b) => b.minTier === 'low').length).toBe(2);
  });

  it('암부 대역은 발광 억제 대상이 아니다(reducedGlow 로 암부가 평면으로 돌아가면 안 된다)', () => {
    expect(band('shadow-bounce').glow).toBe(false);
  });

  it('저티어에서도 최소 두 대역이 살아 상대 운동이 유지된다', () => {
    const low = KARGON.bands.filter((b) => b.minTier === 'low');
    expect(low.length).toBeGreaterThanOrEqual(2);
    expect(new Set(low.map((b) => b.parallax)).size).toBe(low.length);
  });
});

describe('falloffHalfRadius / bandCoverage', () => {
  it('코어에 몰린 감쇠가 넓은 감쇠보다 실효 반경이 작다', () => {
    expect(falloffHalfRadius(band('near-ember'))).toBeLessThan(
      falloffHalfRadius(band('cool-shadow')),
    );
  });

  it('실효 반경은 항상 (0, 1]', () => {
    for (const b of KARGON.bands) {
      const h = falloffHalfRadius(b);
      expect(h).toBeGreaterThan(0);
      expect(h).toBeLessThanOrEqual(1);
    }
  });

  it('공유 감쇠 프리셋의 실효 반경 순서가 이름과 일치한다', () => {
    const at = (f: typeof FALLOFF_WIDE): number =>
      falloffHalfRadius({ ...band('cool-shadow'), falloff: f });
    expect(at(FALLOFF_TIGHT)).toBeLessThan(at(FALLOFF_SOFT));
    expect(at(FALLOFF_SOFT)).toBeLessThan(at(FALLOFF_WIDE));
  });

  it('암부 대역이 화면을 덮는 막이 아니다(그레이딩 레인의 전역 톤과 역할이 겹치면 안 된다)', () => {
    // 1차 `ash-haze`(9개 × 0.30~0.62 × 넓은 감쇠)의 커버리지는 2.5 를 넘어 사실상 전면이었다.
    // `shadow-bounce` 는 암부 전체를 물들이는 대역이 아니라 **덩어리를 나누는** 대역이다.
    const c = bandCoverage(band('shadow-bounce'));
    expect(c).toBeGreaterThan(0.2); // 무늬가 읽힐 만큼은 넓어야 한다(2차 ash-pocket 은 0.07 이었다).
    expect(c).toBeLessThan(0.4); // 막이 되면 그레이딩이 이미 하는 일의 중복이다.
  });

  it('명도 골격 대역은 넓되 덮지 않는다(어두운 지대 ↔ 그렇지 않은 지대가 번갈아야 한다)', () => {
    const c = bandCoverage(band('cool-shadow'));
    expect(c).toBeGreaterThan(0.2);
    expect(c).toBeLessThan(0.6);
  });

  it('밝은 쪽은 좁다 — 열점 커버리지가 골격 대역보다 훨씬 작다', () => {
    expect(bandCoverage(band('near-ember'))).toBeLessThan(bandCoverage(band('cool-shadow')) * 0.25);
  });
});

describe('카르곤 명도 구조', () => {
  it('normal 대역은 바닥보다 어두우면 음수, add 대역은 항상 양수 델타', () => {
    expect(bandPeakLuminanceDelta(band('cool-shadow'), KARGON.baseLuma)).toBeLessThan(0);
    expect(bandPeakLuminanceDelta(band('far-glow'), KARGON.baseLuma)).toBeGreaterThan(0);
    expect(bandPeakLuminanceDelta(band('near-ember'), KARGON.baseLuma)).toBeGreaterThan(0);
  });

  it('명도 스윙이 목표 대역 안이다(단조한 중간톤도, 눈뜬 화면도 아니게)', () => {
    // 1차 구현은 0.098 이었고 화면이 좁은 중간-어두운 갈색 대역에 갇혀 단조로웠다.
    // 상한은 가산 대역이 용암 채널 레이어와 경쟁해 화면이 뜨는 것을 막는다.
    const { swing } = parallaxLuminanceSwing(KARGON.bands, KARGON.baseLuma);
    expect(swing).toBeGreaterThan(0.12);
    expect(swing).toBeLessThan(0.2);
  });

  it('밝은 바닥에서는 순 델타가 충분히 음수다(= 주황 지형을 누른다)', () => {
    // 계약은 "음수"만 요구한다. 카르곤은 주황 지형이 함선보다 밝은 상태였으므로 더 강하게 잠근다.
    expect(parallaxNetPeakDelta(KARGON.brightLuma, KARGON.bands)).toBeLessThan(-0.05);
  });

  it('어두운 바닥에서는 순 델타가 작은 양수다(결은 넣되 어둠은 유지한다)', () => {
    const net = parallaxNetPeakDelta(KARGON.darkLuma, KARGON.bands);
    expect(net).toBeGreaterThan(0.02); // 2차처럼 "거의 0" 이면 암부는 평면 그대로다.
    // 모든 밝힘 대역의 코어가 한 자리에 겹친 최악의 경우조차 암부가 중간톤으로 뜨면 안 된다.
    expect(KARGON.darkLuma + net).toBeLessThan(0.25);
  });

  it('기준 휘도가 카르곤 바닥 실측 근처다(타일셋 교체 시 여기부터 재조정)', () => {
    expect(KARGON.baseLuma).toBeGreaterThan(0.1);
    expect(KARGON.baseLuma).toBeLessThan(0.3);
    expect(KARGON.brightLuma).toBeGreaterThan(KARGON.baseLuma * 2);
  });
});

describe('카르곤 암부 반응(3차)', () => {
  it('진폭만이 아니라 면적까지 곱해야 화면 변화가 잡힌다(2차 near-ember 반례)', () => {
    // 2차 표에서 peak 델타가 가장 컸던 대역은 `near-ember` 였지만, 실효 커버리지가 2% 라
    // 화면에 닿는 면적이 사실상 없었다. 에너지 척도는 그 대역을 꼴찌로 되돌린다.
    const ember = SECOND_PASS_BANDS.find((b) => b.key === 'r2:near-ember') as BandSpec;
    const farGlow = SECOND_PASS_BANDS.find((b) => b.key === 'r2:far-glow') as BandSpec;
    expect(bandPeakLuminanceDelta(ember, KARGON.darkLuma)).toBeGreaterThan(
      bandPeakLuminanceDelta(farGlow, KARGON.darkLuma),
    );
    expect(bandModulationEnergy(ember, KARGON.darkLuma)).toBeLessThan(
      bandModulationEnergy(farGlow, KARGON.darkLuma),
    );
  });

  it('상대 대비 변조가 밝은 바닥보다 어두운 바닥에서 크다(비평가 처방의 직접 잠금)', () => {
    const dark = parallaxRelativeModulation(KARGON.darkLuma, KARGON.bands);
    const bright = parallaxRelativeModulation(KARGON.brightLuma, KARGON.bands);
    expect(dark).toBeGreaterThan(bright * 1.3);
  });

  it('2차 대조군보다 암부 변조가 1.5배 이상이다(항진 아님을 대조로 증명)', () => {
    const before = parallaxModulationEnergy(KARGON.darkLuma, SECOND_PASS_BANDS);
    const after = parallaxModulationEnergy(KARGON.darkLuma, KARGON.bands);
    expect(before).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(before * 1.5);
  });

  it('2차 대조군은 암부 변조가 `lit` 대역에 100% 몰려 있었다(진단의 재현)', () => {
    // 2차 표에는 `shadow` 대역이 아예 없었다 — 그게 "암부가 반응하지 않는" 구조적 원인이다.
    expect(domainModulationEnergy('shadow', KARGON.darkLuma, SECOND_PASS_BANDS)).toBe(0);
    expect(domainModulationEnergy('lit', KARGON.darkLuma, SECOND_PASS_BANDS)).toBeGreaterThan(0);
  });

  it('밝은 바닥의 변조는 `lit` 대역이 3배 이상 압도한다', () => {
    // 계약은 "lit > shadow" 만 요구한다. 카르곤은 그보다 훨씬 크게 갈라져 있어야 한다.
    const shadow = domainModulationEnergy('shadow', KARGON.brightLuma, KARGON.bands);
    const lit = domainModulationEnergy('lit', KARGON.brightLuma, KARGON.bands);
    expect(lit).toBeGreaterThan(shadow * 3);
  });

  it('2차 대조군은 계약과 실측을 전부 깬다(테스트가 항진이 아님을 반증으로 확인)', () => {
    const r2: ParallaxTheme = { ...KARGON, themeId: 'r2', bands: SECOND_PASS_BANDS };
    // 2차 표에는 shadow 대역이 없고 대역 이름에 `:` 가 들어 있어 계약부터 통과하지 못한다.
    expect(validateParallaxTheme(r2).length).toBeGreaterThan(0);
    // ① 암부 상대 변조 우위 — 2차는 반대(밝은 쪽이 더 크다)였다.
    expect(parallaxRelativeModulation(KARGON.darkLuma, SECOND_PASS_BANDS)).toBeLessThan(
      parallaxRelativeModulation(KARGON.brightLuma, SECOND_PASS_BANDS) * 1.3,
    );
    // ② 따뜻한 밝힘 예산 — 2차는 0.063 으로 3차 상한(0.05)을 넘겼다. 이게 "주황 상단이
    //    노란색 포화 직전까지 간다"는 비평의 수치적 실체다.
    const warmR2 = SECOND_PASS_BANDS.filter((b) => b.blend === 'add' && !isCool(b.color))
      .map((b) => bandPeakLuminanceDelta(b, KARGON.baseLuma))
      .reduce((a, b) => a + b, 0);
    expect(warmR2).toBeGreaterThan(0.05);
  });
});

/* ══════════════════════════ 레이어 ══════════════════════════ */

describe('ParallaxLayer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('담당 테마가 없는 행성에서는 스스로 꺼진다', () => {
    const l = new ParallaxLayer();
    expect(l.configure({ planet: 1, seed: 7 })).toBe(false);
    expect(l.themeId).toBeNull();
    l.destroy();
  });

  it('캔버스가 없는 환경에서 configure/update/resize/destroy 가 던지지 않는다', () => {
    const l = new ParallaxLayer();
    expect(() => {
      l.configure({ planet: 0, seed: 7 });
      l.resize(1920, 1080);
      l.update({
        camX: 1234.5,
        camY: -987.25,
        viewMinX: -60,
        viewMinY: -30,
        viewMaxX: 1980,
        viewMaxY: 1110,
        tick: 512.25,
        dt: 1 / 60,
      });
      l.destroy();
    }).not.toThrow();
  });

  it('슬롯은 floor 다(지형 autotile 이 far 를 완전히 덮으므로)', () => {
    const l = new ParallaxLayer();
    expect(l.slot).toBe('floor');
    l.destroy();
  });
});

/**
 * 테마 전환 회귀. 둘 다 **예외 없이** 조용히 틀린 화면을 내는 결함이라, 캔버스를 흉내 내
 * 텍스처가 실제로 구워지는 상태에서만 관측된다.
 */
describe('테마 전환 회귀', () => {
  /** Pixi 가 `resource instanceof HTMLCanvasElement` 로 소스 종류를 판별하므로 클래스여야 한다. */
  function stubCanvas(): void {
    const ctx = {
      globalCompositeOperation: '',
      fillStyle: '',
      clearRect: () => {},
      fillRect: () => {},
      createRadialGradient: () => ({ addColorStop: () => {} }),
    };
    class FakeCanvas {
      width = 1;
      height = 1;
      getContext(): unknown {
        return ctx;
      }
    }
    vi.stubGlobal('HTMLCanvasElement', FakeCanvas);
    vi.stubGlobal('document', { createElement: () => new FakeCanvas() });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** 스프라이트에 실제로 바인딩된 텍스처 라벨들. */
  function boundTextureLabels(view: { children: readonly unknown[] }): string[] {
    return view.children.map(
      (c) => ((c as { texture: { source: { label: string } } }).texture.source.label),
    );
  }

  it('테마가 바뀌면 대역 이름이 같아도 다른 텍스처가 바인딩된다(캐시 키에 테마가 들어간다)', () => {
    stubCanvas();
    const l = new ParallaxLayer();
    expect(l.configure({ planet: 99, seed: 3 })).toBe(true);
    const b = boundTextureLabels(l.view);
    expect(b).toEqual(['parallax:test_b:skeleton', 'parallax:test_b:bounce']);

    expect(l.configure({ planet: 98, seed: 3 })).toBe(true);
    const c = boundTextureLabels(l.view);
    // 대역 이름(`skeleton`/`bounce`)이 같으므로 캐시 키가 이름뿐이면 여기서 B 라벨이 나온다.
    expect(c).toEqual(['parallax:test_c:skeleton', 'parallax:test_c:bounce']);
    l.destroy();
  });

  it('행성이 바뀌면 이전 테마의 스프라이트가 걷힌다(누적되지 않는다)', () => {
    stubCanvas();
    const l = new ParallaxLayer();
    l.configure({ planet: 99, seed: 3 });
    expect(l.view.children.length).toBe(THEME_B.bands.length);
    expect(l.themeId).toBe('test_b');

    l.configure({ planet: 98, seed: 3 });
    // `built` 가 영구 boolean 이면 여기서 B 의 스프라이트가 그대로 남고 `bandKeys` 는
    // B 것을 가리킨다. push-only 였다면 children 이 4장으로 누적된다.
    expect(l.view.children.length).toBe(THEME_C.bands.length);
    expect(l.themeId).toBe('test_c');
    expect(l.bandKeys).toEqual(['skeleton', 'bounce']);
    l.destroy();
  });

  it('같은 테마로 다시 configure 하면 다시 짓지 않는다(스프라이트 동일성 유지)', () => {
    stubCanvas();
    const l = new ParallaxLayer();
    l.configure({ planet: 99, seed: 3 });
    const first = l.view.children[0];
    l.configure({ planet: 99, seed: 11 });
    expect(l.view.children[0]).toBe(first);
    expect(l.view.children.length).toBe(THEME_B.bands.length);
    l.destroy();
  });
});
