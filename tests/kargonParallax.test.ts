/**
 * 카르곤 저주파 환경 변조(시차) 레이어의 **순수 함수 계약** 잠금.
 *
 * 여기서 검증하는 건 화면 그림이 아니라 결정론과 시차의 뼈대다:
 *  1. 같은 (seed, tick) → 같은 값 (리플레이 재현).
 *  2. tick·카메라가 달라지면 값이 **실제로 변한다** (항진 테스트 방지 — "같다"만 검사하면
 *     상수를 반환해도 통과한다).
 *  3. 대역마다 시차 계수가 다르다(= 상대 운동이 존재한다). 전부 같으면 아무리 여러 장을
 *     겹쳐도 "반투명 막 한 장"이지 깊이가 아니다.
 *  4. 캔버스 없는 node 환경에서 던지지 않고, 비카르곤에서는 스스로 꺼진다.
 */

import { describe, it, expect } from 'vitest';
import {
  KARGON_BASE_LUMA,
  KARGON_BRIGHT_LUMA,
  KARGON_DARK_LUMA,
  KARGON_PARALLAX_BANDS,
  KargonParallaxLayer,
  bandCoverage,
  bandModulationEnergy,
  bandPeakLuminanceDelta,
  bandPulse,
  bandSeedOffset,
  bandTileOffset,
  domainModulationEnergy,
  falloffHalfRadius,
  parallaxLuminanceSwing,
  parallaxModulationEnergy,
  parallaxNetPeakDelta,
  parallaxRelativeModulation,
  relLuminance,
  wrapOffset,
  type BandSpec,
} from '../src/render/env/kargonParallax.js';

/** 이름으로 대역 하나를 집는다(표 순서가 바뀌어도 테스트가 따라 깨지지 않게). */
function band(key: string) {
  const b = KARGON_PARALLAX_BANDS.find((x) => x.key === key);
  if (b === undefined) throw new Error(`대역 없음: ${key}`);
  return b;
}

/** 색이 한색(청)인가 — `#rrggbb` 의 B 가 R 보다 큰가. */
function isCool(hex: string): boolean {
  const v = Number.parseInt(hex.slice(1), 16);
  return (v & 0xff) > ((v >> 16) & 0xff);
}

/**
 * **2차 대조군**: 3차 직전 대역 표를 그대로 얼려 둔 리터럴.
 *
 * 3차의 주장("암부가 이제 반응한다")은 절대 수치로는 증명되지 않는다 — 상한을 정할 근거가
 * 없기 때문이다. 그래서 같은 함수로 2차 표를 재고 **개선 배수**를 잠근다. 이 대조군이
 * 현재 표에서 spread 로 파생되면 3차 상수 변경이 대조군까지 같이 움직여 항진이 되므로,
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
    const a = bandSeedOffset(1, 0, 0, 2800);
    const b = bandSeedOffset(2, 0, 0, 2800);
    expect(a).not.toBe(b);
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
      expect(v).toBeGreaterThanOrEqual(0.22 * -1 + 1 - 1e-9);
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

describe('대역 표', () => {
  it('시차 계수가 서로 다르다(= 상대 운동이 존재한다)', () => {
    const ps = KARGON_PARALLAX_BANDS.map((b) => b.parallax);
    expect(new Set(ps).size).toBe(ps.length);
  });

  it('시차가 0.15~0.35 대역 안이거나 그보다 더 먼 연무다(원경으로 읽히는 범위)', () => {
    for (const b of KARGON_PARALLAX_BANDS) {
      expect(b.parallax).toBeGreaterThan(0);
      expect(b.parallax).toBeLessThanOrEqual(0.35);
    }
  });

  it('뒤에서 앞으로 갈수록 시차가 커지고 주기가 작아진다(대기 원근)', () => {
    for (let i = 1; i < KARGON_PARALLAX_BANDS.length; i++) {
      const prev = KARGON_PARALLAX_BANDS[i - 1];
      const cur = KARGON_PARALLAX_BANDS[i];
      if (prev === undefined || cur === undefined) continue;
      expect(cur.parallax).toBeGreaterThan(prev.parallax);
      expect(cur.tile).toBeLessThan(prev.tile);
    }
  });

  it('주기가 전부 화면(1920)보다 크다(저주파 대역만 담당)', () => {
    for (const b of KARGON_PARALLAX_BANDS) expect(b.tile).toBeGreaterThan(1920);
  });

  it('따뜻한 가산 대역의 밝힘 예산이 보수적이다(알파가 아니라 휘도로 잰다)', () => {
    // 2차는 이 상한을 **알파 합**으로 걸었는데, 그건 색을 무시한 잘못된 대리 지표다.
    // 저휘도 한색(`shadow-bounce`)은 알파가 커도 화면을 거의 안 띄우고, 밝은 호박색은
    // 알파가 작아도 크게 띄운다. 화면을 띄우는 실체는 **가산 휘도 기여**다.
    const warmLift = KARGON_PARALLAX_BANDS.filter((b) => b.blend === 'add' && !isCool(b.color))
      .map((b) => bandPeakLuminanceDelta(b))
      .reduce((a, b) => a + b, 0);
    expect(warmLift).toBeGreaterThan(0);
    expect(warmLift).toBeLessThan(0.05);
  });

  it('암부 대역의 진폭이 따뜻한 가산 대역 **각각의** 2배 이상이다', () => {
    // 비평가의 처방: "어두운 타일에 적용하고 진폭을 주황보다 2~3배 크게".
    const cool = KARGON_PARALLAX_BANDS.filter((b) => b.domain === 'shadow');
    expect(cool.length).toBeGreaterThan(0);
    const coolPeak = Math.max(...cool.map((b) => Math.abs(bandPeakLuminanceDelta(b))));
    for (const w of KARGON_PARALLAX_BANDS.filter((b) => b.blend === 'add' && !isCool(b.color))) {
      expect(coolPeak).toBeGreaterThanOrEqual(Math.abs(bandPeakLuminanceDelta(w)) * 2);
    }
  });

  it('`shadow` 대역은 저휘도 한색 가산이다(합성 산식이 암부에서 살아 있는 유일한 형태)', () => {
    for (const b of KARGON_PARALLAX_BANDS.filter((x) => x.domain === 'shadow')) {
      // `normal` 은 델타가 `a*(L-base)` 라 검정 위에서 0 으로 수렴한다 — 암부 대역이 될 수 없다.
      expect(b.blend).toBe('add');
      expect(isCool(b.color)).toBe(true);
      // 휘도가 높으면 암부를 "물들이는" 게 아니라 "띄운다".
      expect(relLuminance(b.color)).toBeLessThan(0.2);
    }
  });

  it('`lit` 대역 중 normal 합성은 바닥보다 어두운 색만 쓴다(밝히지 않는다)', () => {
    for (const b of KARGON_PARALLAX_BANDS.filter((x) => x.domain === 'lit' && x.blend === 'normal')) {
      expect(relLuminance(b.color)).toBeLessThan(KARGON_DARK_LUMA);
    }
  });

  it('암부 대역이 저티어에서도 살아 있고, 저티어 장수는 2장 그대로다(fill-rate 중립)', () => {
    // 3차의 가장 큰 단일 레버라 저티어에서 빠지면 안 된다. 대신 `far-glow` 를 med 로 올려
    // 저티어 활성 장수를 늘리지 않았다.
    expect(band('shadow-bounce').minTier).toBe('low');
    expect(KARGON_PARALLAX_BANDS.filter((b) => b.minTier === 'low').length).toBe(2);
  });

  it('암부 대역은 발광 억제 대상이 아니다(reducedGlow 로 암부가 평면으로 돌아가면 안 된다)', () => {
    expect(band('shadow-bounce').glow).toBe(false);
  });

  it('명도 골격 대역은 저티어에서도 살아 있다(골격이 빠지면 화면이 통째로 평평해진다)', () => {
    expect(band('cool-shadow').minTier).toBe('low');
  });

  it('저티어에서도 최소 두 대역이 살아 상대 운동이 유지된다', () => {
    const low = KARGON_PARALLAX_BANDS.filter((b) => b.minTier === 'low');
    expect(low.length).toBeGreaterThanOrEqual(2);
    expect(new Set(low.map((b) => b.parallax)).size).toBe(low.length);
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

describe('falloffHalfRadius / bandCoverage', () => {
  it('코어에 몰린 감쇠가 넓은 감쇠보다 실효 반경이 작다', () => {
    expect(falloffHalfRadius(band('near-ember'))).toBeLessThan(
      falloffHalfRadius(band('cool-shadow')),
    );
  });

  it('실효 반경은 항상 (0, 1]', () => {
    for (const b of KARGON_PARALLAX_BANDS) {
      const h = falloffHalfRadius(b);
      expect(h).toBeGreaterThan(0);
      expect(h).toBeLessThanOrEqual(1);
    }
  });

  it('암부 대역이 화면을 덮는 막이 아니다(그레이딩 레인의 전역 톤과 역할이 겹치면 안 된다)', () => {
    // 1차 `ash-haze`(9개 × 0.30~0.62 × 넓은 감쇠)의 커버리지는 2.5 를 넘어 사실상 전면이었다.
    // `shadow-bounce` 는 암부 전체를 고르게 물들이는 대역이 아니라 **덩어리를 나누는** 대역이다.
    // 암부 전체를 한 톤 차갑게 하는 일은 3차 그레이딩 레인(스플릿 톤)이 담당한다.
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
    expect(bandCoverage(band('near-ember'))).toBeLessThan(
      bandCoverage(band('cool-shadow')) * 0.25,
    );
  });
});

describe('명도 구조', () => {
  it('normal 대역은 바닥보다 어두우면 음수, add 대역은 항상 양수 델타', () => {
    expect(bandPeakLuminanceDelta(band('cool-shadow'))).toBeLessThan(0);
    expect(bandPeakLuminanceDelta(band('far-glow'))).toBeGreaterThan(0);
    expect(bandPeakLuminanceDelta(band('near-ember'))).toBeGreaterThan(0);
  });

  it('명도 스윙이 목표 대역 안이다(단조한 중간톤도, 눈뜬 화면도 아니게)', () => {
    // 1차 구현은 0.098 이었고 화면이 좁은 중간-어두운 갈색 대역에 갇혀 단조로웠다.
    // 상한은 가산 대역이 용암 채널 레이어와 경쟁해 화면이 뜨는 것을 막는다.
    const { swing } = parallaxLuminanceSwing();
    expect(swing).toBeGreaterThan(0.12);
    expect(swing).toBeLessThan(0.2);
  });

  it('밝은 바닥에서는 순 델타가 음수다(= 주황 지형을 누른다)', () => {
    // 3차 가독성 규율: 이 레이어는 밝기를 더하는 레이어가 아니다. 플레이어 함선이 화면에서
    // 가장 밝아야 하는데 주황 지형이 그보다 밝은 상태라, 배경 쪽은 눌리는 방향이어야 한다.
    expect(parallaxNetPeakDelta(KARGON_BRIGHT_LUMA)).toBeLessThan(-0.05);
  });

  it('어두운 바닥에서는 순 델타가 작은 양수다(결은 넣되 어둠은 유지한다)', () => {
    const net = parallaxNetPeakDelta(KARGON_DARK_LUMA);
    expect(net).toBeGreaterThan(0.02); // 2차처럼 "거의 0" 이면 암부는 평면 그대로다.
    // 모든 밝힘 대역의 코어가 한 자리에 겹친 최악의 경우조차 암부가 중간톤으로 뜨면 안 된다.
    expect(KARGON_DARK_LUMA + net).toBeLessThan(0.25);
  });

  it('기준 휘도는 카르곤 바닥 실측 근처다(타일셋 교체 시 여기부터 재조정)', () => {
    expect(KARGON_BASE_LUMA).toBeGreaterThan(0.1);
    expect(KARGON_BASE_LUMA).toBeLessThan(0.3);
    // 암부·주황이 실측대로 갈라져 있어야 domain 축이 의미를 갖는다.
    expect(KARGON_DARK_LUMA).toBeLessThan(KARGON_BASE_LUMA);
    expect(KARGON_BRIGHT_LUMA).toBeGreaterThan(KARGON_BASE_LUMA * 2);
  });
});

/* ────────────────────── 3차 핵심: 암부가 실제로 반응하는가 ────────────────────── */

describe('암부 반응(3차)', () => {
  it('진폭만이 아니라 면적까지 곱해야 화면 변화가 잡힌다(2차 near-ember 반례)', () => {
    // 2차 표에서 peak 델타가 가장 컸던 대역은 `near-ember` 였지만, 실효 커버리지가 2% 라
    // 화면에 닿는 면적이 사실상 없었다. 에너지 척도는 그 대역을 꼴찌로 되돌린다.
    const ember = SECOND_PASS_BANDS.find((b) => b.key === 'r2:near-ember') as BandSpec;
    const farGlow = SECOND_PASS_BANDS.find((b) => b.key === 'r2:far-glow') as BandSpec;
    expect(bandPeakLuminanceDelta(ember, KARGON_DARK_LUMA)).toBeGreaterThan(
      bandPeakLuminanceDelta(farGlow, KARGON_DARK_LUMA),
    );
    expect(bandModulationEnergy(ember, KARGON_DARK_LUMA)).toBeLessThan(
      bandModulationEnergy(farGlow, KARGON_DARK_LUMA),
    );
  });

  it('상대 대비 변조가 밝은 바닥보다 어두운 바닥에서 크다(비평가 처방의 직접 잠금)', () => {
    const dark = parallaxRelativeModulation(KARGON_DARK_LUMA);
    const bright = parallaxRelativeModulation(KARGON_BRIGHT_LUMA);
    expect(dark).toBeGreaterThan(bright * 1.3);
  });

  it('2차 대조군보다 암부 변조가 1.5배 이상이다(항진 아님을 대조로 증명)', () => {
    const before = parallaxModulationEnergy(KARGON_DARK_LUMA, SECOND_PASS_BANDS);
    const after = parallaxModulationEnergy(KARGON_DARK_LUMA);
    expect(before).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(before * 1.5);
  });

  it('2차 대조군은 암부 변조가 `lit` 대역에 100% 몰려 있었다(진단의 재현)', () => {
    // 2차 표에는 `shadow` 대역이 아예 없었다 — 그게 "암부가 반응하지 않는" 구조적 원인이다.
    expect(domainModulationEnergy('shadow', KARGON_DARK_LUMA, SECOND_PASS_BANDS)).toBe(0);
    expect(domainModulationEnergy('lit', KARGON_DARK_LUMA, SECOND_PASS_BANDS)).toBeGreaterThan(0);
  });

  it('3차 암부의 **단일 최대 기여자**가 `shadow` 대역이다(역할 분담이 실제로 성립한다)', () => {
    // "과반"이 아니라 "최대"인 이유: `cool-shadow` 는 암부에서도 여전히 조금 문다
    // (base 0.10 → 색 휘도 0.026 이라 뺄 빛이 남아 있다). 그건 결함이 아니라 정상이다.
    // 잠글 것은 **어느 대역도 암부에서 shadow 대역보다 크게 일하지 않는다**는 사실이다.
    const shadow = domainModulationEnergy('shadow', KARGON_DARK_LUMA);
    expect(shadow).toBeGreaterThan(0);
    for (const b of KARGON_PARALLAX_BANDS.filter((x) => x.domain === 'lit')) {
      expect(shadow).toBeGreaterThan(bandModulationEnergy(b, KARGON_DARK_LUMA));
    }
  });

  it('밝은 바닥의 변조는 반대로 `lit` 대역이 압도한다(축이 뒤집히지 않았다)', () => {
    const shadow = domainModulationEnergy('shadow', KARGON_BRIGHT_LUMA);
    const lit = domainModulationEnergy('lit', KARGON_BRIGHT_LUMA);
    expect(lit).toBeGreaterThan(shadow * 3);
  });

  it('2차 대조군은 이 불변식들을 전부 깬다(테스트가 항진이 아님을 반증으로 확인)', () => {
    // 뮤테이션 검증의 코드화: 같은 함수로 2차 표를 재면 아래가 성립하지 않는다.
    const darkR2 = parallaxRelativeModulation(KARGON_DARK_LUMA, SECOND_PASS_BANDS);
    const brightR2 = parallaxRelativeModulation(KARGON_BRIGHT_LUMA, SECOND_PASS_BANDS);
    // ① 암부 상대 변조 우위 — 2차는 반대(밝은 쪽이 더 크다)였다.
    expect(darkR2).toBeLessThan(brightR2 * 1.3);
    // ② 따뜻한 밝힘 예산 — 2차는 0.063 으로 3차 상한(0.05)을 넘겼다. 이게 "주황 상단이
    //    노란색 포화 직전까지 간다"는 비평의 수치적 실체다.
    const warmR2 = SECOND_PASS_BANDS.filter((b) => b.blend === 'add' && !isCool(b.color))
      .map((b) => bandPeakLuminanceDelta(b))
      .reduce((a, b) => a + b, 0);
    expect(warmR2).toBeGreaterThan(0.05);
  });
});

describe('KargonParallaxLayer', () => {
  it('비카르곤 행성에서는 스스로 꺼진다', () => {
    const l = new KargonParallaxLayer();
    expect(l.configure({ planet: 1, seed: 7 })).toBe(false);
    l.destroy();
  });

  it('캔버스가 없는 환경에서 configure/update/resize/destroy 가 던지지 않는다', () => {
    const l = new KargonParallaxLayer();
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
    const l = new KargonParallaxLayer();
    expect(l.slot).toBe('floor');
    l.destroy();
  });
});
