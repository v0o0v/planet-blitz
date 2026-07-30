/**
 * 해저드 재질의 **공유 텍스처** 계약.
 *
 * ## 왜 이 파일이 있는가
 * 이 텍스처들은 화면에서 "부드러운 얼룩"으로만 보이므로, 잘못 구워도 육안으로는 "좀 이상한데"
 * 이상의 판정이 안 나온다. 그런데 굽는 계산은 **순수 함수**라 픽셀값을 직접 잴 수 있다 —
 * 그것이 canvas 가 아니라 `BufferImageSource` 를 고른 이유이기도 하다(node 와 브라우저가 같은
 * 코드를 탄다).
 *
 * 잡는 것 셋:
 * 1. **가장자리가 완전한 원이 아니다** — 원이면 §2-5 UI 어휘고, 로브 14개가 전부 같은 동전이 된다.
 * 2. **falloff 가 실제로 죽는다** — 가장자리에서 0 이 아니면 사각 타일 경계가 드러난다.
 * 3. **알파 채널을 쓰지 않는다** — 가산 전용이라 휘도로 굽는다는 결정이 코드에 남아 있는지.
 */

import { describe, it, expect } from 'vitest';

import {
  BLOB_TEX_SIZE,
  MOTE_TEX_SIZE,
  bakeLuminanceTexture,
  bakeVectorTexture,
  blobLuminance,
  bubbleLuminance,
  contactLuminance,
  crackLuminance,
  crackShadeLuminance,
  discMask,
  glowLuminance,
  lensDisplacement,
  lensLuminance,
  meanDiscLuminance,
  moteLuminance,
  plateShadeLuminance,
  resetHazardTextures,
  rimLuminance,
  sporeShadeLuminance,
} from '../src/render/entity/hazardTexture.js';
import { hash3 } from '../src/render/env/noise.js';

/** 원판을 격자로 훑어 [0,1] 값을 모은다. 면적 재질의 통계를 재는 공용 도구. */
function sampleDisc(f: (nx: number, ny: number) => number, n = 40): number[] {
  const out: number[] = [];
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const nx = ((ix + 0.5) / n) * 2 - 1;
      const ny = ((iy + 0.5) / n) * 2 - 1;
      if (Math.hypot(nx, ny) >= 0.98) continue;
      out.push(f(nx, ny));
    }
  }
  return out;
}

const mean = (a: readonly number[]): number => a.reduce((s, v) => s + v, 0) / a.length;

describe('블롭 텍스처 — 로브의 실루엣', () => {
  it('중심이 가장 밝고 가장자리에서 정확히 0 이다', () => {
    expect(blobLuminance(0, 0)).toBeGreaterThan(0.9);
    for (const a of [0, 1, 2, 3, 4, 5]) {
      const ang = (a / 6) * Math.PI * 2;
      // 정확히 반경 1 지점과 그 바깥은 0 — 사각 타일 경계가 드러나면 안 된다.
      expect(blobLuminance(Math.cos(ang), Math.sin(ang)), `a=${a}`).toBe(0);
      expect(blobLuminance(Math.cos(ang) * 1.2, Math.sin(ang) * 1.2), `a=${a}`).toBe(0);
    }
  });

  it('가장자리가 완전한 원이 아니다(§2-5 — 로브 14개가 같은 동전이면 안 된다)', () => {
    // 각도마다 휘도가 0 이 되는 반경을 이분법으로 찾아 편차를 본다.
    const edgeAt = (ang: number): number => {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (blobLuminance(Math.cos(ang) * mid, Math.sin(ang) * mid) > 0) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    const edges = Array.from({ length: 12 }, (_, i) => edgeAt((i / 12) * Math.PI * 2));
    const spread = Math.max(...edges) - Math.min(...edges);
    expect(spread).toBeGreaterThan(0.05);
  });

  it('휘도가 중심에서 바깥으로 단조 감소한다(고리 무늬가 생기지 않는다)', () => {
    let prev = Infinity;
    for (let d = 0; d <= 1; d += 0.02) {
      const v = blobLuminance(d, 0);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });

  it('순수 함수다(같은 좌표면 항상 같은 값)', () => {
    expect(blobLuminance(0.3, -0.4)).toBe(blobLuminance(0.3, -0.4));
  });
});

describe('입자 텍스처', () => {
  it('중심이 밝고 가장자리에서 0 이며 블롭보다 급하게 죽는다', () => {
    expect(moteLuminance(0, 0)).toBe(1);
    expect(moteLuminance(1, 0)).toBe(0);
    // 같은 거리에서 입자가 더 어둡다 = falloff 가 더 급하다("작고 밝은 알갱이").
    expect(moteLuminance(0.5, 0)).toBeLessThan(blobLuminance(0.5, 0));
  });
});

describe('굽기 — 알파가 아니라 휘도로 굽는다', () => {
  it('모든 픽셀의 알파가 255 이고 RGB 가 서로 같다', () => {
    // 가산 합성 전용이라 알파를 쓰지 않는다 — 프리멀티플라이 규약을 아예 회피하는 결정이고,
    // 그 결정이 코드에 남아 있는지 여기서 잠근다.
    resetHazardTextures();
    const size = 8;
    const seen: number[] = [];
    const tex = bakeLuminanceTexture(size, (nx, ny) => {
      const v = Math.max(0, 1 - Math.hypot(nx, ny));
      seen.push(v);
      return v;
    });
    expect(tex).not.toBeNull();
    const px = tex?.source.resource as Uint8Array;
    expect(px.length).toBe(size * size * 4);
    for (let i = 0; i < px.length; i += 4) {
      expect(px[i]).toBe(px[i + 1]);
      expect(px[i + 1]).toBe(px[i + 2]);
      expect(px[i + 3]).toBe(255);
    }
    expect(seen.length).toBe(size * size);
  });

  it('샘플 좌표가 [-1,1] 을 덮는다(가장자리 픽셀이 실제로 가장자리다)', () => {
    const xs: number[] = [];
    bakeLuminanceTexture(16, (nx) => {
      xs.push(nx);
      return 0;
    });
    expect(Math.min(...xs)).toBeLessThan(-0.9);
    expect(Math.max(...xs)).toBeGreaterThan(0.9);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1);
  });

  it('텍스처 크기가 실제로 반영된다', () => {
    resetHazardTextures();
    const tex = bakeLuminanceTexture(BLOB_TEX_SIZE, blobLuminance);
    expect(tex?.source.width).toBe(BLOB_TEX_SIZE);
    const mote = bakeLuminanceTexture(MOTE_TEX_SIZE, moteLuminance);
    expect(mote?.source.width).toBe(MOTE_TEX_SIZE);
  });
});

// ---------------------------------------------------------------------------
// 접지 — 3차는 톡사르에서 실측이 **정확히 바닥**이었다 (3차 반려 MAJOR-3)
// ---------------------------------------------------------------------------

describe('접지 텍스처 — 원인은 알파가 아니라 면적이었다', () => {
  /**
   * ## 계약이 바뀌었다 (6차 반려 MAJOR-2 — 전 둘레 내벽)
   * 5차는 광원 쪽 절반을 **전혀** 건드리지 않았다. 그래서 그 절반이 바닥과 같은 높이로 읽히고
   * 장판이 "파인 웅덩이"가 아니라 "한쪽에 그늘이 드리운 평면 원"이 됐다(높이감 미달의 근인).
   * 지금은 원주 **전체**에 내벽이 있고, 방향 정보는 "어느 쪽이 **더** 어두운가"로 남는다.
   */
  it('내벽이 전 둘레를 두르고, 방향 정보는 깊이 차이로 남는다', () => {
    // 텍스처는 광원이 +x 라고 가정해 굽는다(방향은 스프라이트 rotation 이 실는다).
    const away = contactLuminance(-0.87, 0);
    const toward = contactLuminance(0.87, 0);
    expect(away).toBeLessThan(0.5); // 반대쪽 가장자리 = 가장 어둡다
    expect(toward).toBeLessThan(0.75); // 광원 쪽도 내벽이 있다(5차는 정확히 1 이었다)
    expect(toward).toBeGreaterThan(away * 1.4); // 그래도 방향은 읽힌다
    expect(contactLuminance(0, 0)).toBeCloseTo(1, 6); // 중앙 = 그대로(내벽은 가장자리 띠다)
    expect(contactLuminance(1.5, 0)).toBe(1); // 원 밖 = 그대로
  });

  it('내벽이 텍스처 경계에서 0 으로 죽는다 — 하드 라인이 정원 윤곽을 만들면 안 된다(§2-5)', () => {
    // 단조 증가 램프를 쓰면 d=1 에서 밝기가 0.48 → 1 로 튀어 원 하나가 더 생긴다.
    for (let a = 0; a < 12; a++) {
      const t = (a / 12) * Math.PI * 2;
      const at = (d: number): number => contactLuminance(Math.cos(t) * d, Math.sin(t) * d);
      expect(at(0.999), `a=${a}`).toBeGreaterThan(0.9);
    }
  });

  it('그늘이 원판의 다섯 분의 일 이상을 덮는다(3차의 호는 원주의 33% 폭 16% 였다)', () => {
    // 곱연산이므로 "1 미만"인 표본 비율이 곧 덮는 면적이다.
    const s = sampleDisc(contactLuminance);
    expect(s.filter((v) => v < 0.97).length / s.length).toBeGreaterThan(0.2);
  });

  it('림이 광원 쪽 안쪽 가장자리에만 있다', () => {
    expect(rimLuminance(0.94, 0)).toBeGreaterThan(0.4);
    expect(rimLuminance(-0.94, 0)).toBe(0); // 반대쪽 없음
    expect(rimLuminance(0.3, 0)).toBe(0); // 중앙 없음
    expect(rimLuminance(1.4, 0)).toBe(0); // 원 밖 없음
  });

  /**
   * 5차의 단언은 "두 겹이 같은 자리에서 겹치지 않는다"였다. 내벽이 전 둘레로 퍼지면서 그 단언은
   * 성립할 수 없고, **성립하지 않아야 한다** — AAA 대조(Hades 용암 웅덩이)의 가장자리는 정확히
   * "어두운 내벽 위에 얹힌 밝은 립"이다. 두 겹은 블렌드가 달라(곱연산 아래 · 가산 위) 서로를
   * 지우지 않고, 감산된 바탕 위의 가산 하이라이트는 **대비가 오히려 커진다**.
   *
   * 그래서 잠글 것은 겹치지 않음이 아니라 **방향의 일관성**이다: 가장 밝은 림과 가장 깊은
   * 내벽이 서로 반대쪽에 있어야 화면에 태양이 둘이 되지 않는다.
   */
  it('가장 밝은 림과 가장 깊은 내벽이 서로 반대쪽에 있다(태양은 하나다)', () => {
    let bestRim = -1;
    let rimAngle = 0;
    let worstShade = -1;
    let shadeAngle = 0;
    for (let a = 0; a < 24; a++) {
      const t = (a / 24) * Math.PI * 2;
      const px = Math.cos(t) * 0.93;
      const py = Math.sin(t) * 0.93;
      const shade = 1 - contactLuminance(px, py);
      const rim = rimLuminance(px, py);
      if (rim > bestRim) {
        bestRim = rim;
        rimAngle = t;
      }
      if (shade > worstShade) {
        worstShade = shade;
        shadeAngle = t;
      }
    }
    expect(bestRim).toBeGreaterThan(0.4);
    expect(worstShade).toBeGreaterThan(0.4);
    // 두 극점의 각도 차가 π 에 가깝다(같은 방향이면 화면에 태양이 둘이다).
    const d = rimAngle - shadeAngle;
    const diff = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
    expect(diff).toBeGreaterThan(Math.PI - 0.3);
  });
});

// ---------------------------------------------------------------------------
// 오염의 감산 겹 — 6차 반려 CRITICAL-1 (판정 장면에서 재질이 가시성 하한 밑이었다)
// ---------------------------------------------------------------------------

/**
 * ## 무엇이 결함이었나
 * 판정 장면(톡사르 41셀)에서 **이 레인의 겹을 통째로 꺼도 화면이 거의 같았다**: 셀 내부 on/off
 * 채널 델타가 mean maxCh **6.32 · ≥16레벨 9.4%**(카르곤 molten full 셀은 15.20 · 26.0%). 겹의
 * **형태는 옳았고 진폭이 없었다.**
 *
 * 근인은 알파 하나가 아니라 구조다: 오염에는 **감산 축이 아예 없었고**(`CRUST_SPEC.spore.shade
 * === null`), 남은 채널은 전부 가산인데 채움이 깔린 밝은 원판 위에서 알파 0.15 대의 가산은
 * 대비를 만들지 못한다. 감산은 대비를 올리면서 밝기 총량(§2-4)을 **내린다** — 5차의 성과를
 * 되돌리지 않고 6차의 요구를 만족시키는 유일한 축이다.
 */
describe('오염 감산 겹 — 대비는 감산에서 나온다 (6차 CRITICAL-1)', () => {
  it('곱연산 규약을 지킨다(전부 ≤1, 원 밖은 정확히 1)', () => {
    for (const v of sampleDisc(sporeShadeLuminance)) {
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(sporeShadeLuminance(1.4, 0)).toBe(1);
    expect(sporeShadeLuminance(0.99, 0.99)).toBe(1); // 마스크 밖
  });

  it('진폭이 실제로 있다 — 원판의 3분의 1 이상이 20% 넘게 어두워진다', () => {
    // `sampleDisc` 는 d<0.98 을 훑으므로 `discMask` 가 0 으로 죽는 바깥 테(d>0.9, 표본의 16%)
    // 까지 분모에 들어간다. 실효 원판(d<0.9) 기준으로는 47% 다.
    const s = sampleDisc(sporeShadeLuminance);
    const deep = s.filter((v) => v < 0.8).length / s.length;
    expect(deep).toBeGreaterThan(1 / 3);
    // 가장 깊은 웅덩이는 절반 이상 어둡다(여기가 ≥16레벨을 만드는 자리다).
    expect(Math.min(...s)).toBeLessThan(0.4);
  });

  it('거품(가산)과 웅덩이(감산)가 같은 자리에 겹치지 않는다 — 시드를 갈라야 서로를 안 지운다', () => {
    // `plateShade` ↔ `crackAdd` 가 시드를 가른 것과 같은 규율이다. 같은 시드면 밝은 거품과
    // 어두운 웅덩이가 정확히 포개져 둘 다 사라진다.
    let both = 0;
    let brightOnly = 0;
    for (let iy = 0; iy < 64; iy++) {
      for (let ix = 0; ix < 64; ix++) {
        const nx = ((ix + 0.5) / 64) * 2 - 1;
        const ny = ((iy + 0.5) / 64) * 2 - 1;
        if (nx * nx + ny * ny >= 0.81) continue;
        const bright = bubbleLuminance(nx, ny) > 0.35;
        const dark = sporeShadeLuminance(nx, ny) < 0.6;
        if (bright && dark) both++;
        else if (bright) brightOnly++;
      }
    }
    expect(brightOnly).toBeGreaterThan(both);
  });

  it('감산 진폭이 가산 진폭을 압도한다(§2-4 를 지키면서 대비를 얻는 축)', () => {
    // 화면에 실리는 실효 진폭 = 알파 × 텍스처 평균 편차. 감산은 밝기 총량에 순감이므로
    // 이 부등식이 "밝히지 않고 보이게 한다"의 수치적 표현이다.
    const sub = 0.92 * (1 - meanDiscLuminance(sporeShadeLuminance));
    const add = 0.22 * 0.72 * meanDiscLuminance(bubbleLuminance) * 1.7;
    expect(sub).toBeGreaterThan(add * 3);
  });
});

// ---------------------------------------------------------------------------
// 면적 재질 — "종류가 달라도 색만 다르다"의 처방 (3차 반려 MAJOR-5)
// ---------------------------------------------------------------------------

describe('면적 재질 텍스처 — 무늬가 실제로 다르다', () => {
  it('마스크가 가장자리에서 0 이라 판정 반경 밖으로 새지 않는다', () => {
    expect(discMask(0)).toBeCloseTo(1, 6);
    expect(discMask(0.6)).toBeCloseTo(1, 6);
    expect(discMask(1)).toBe(0);
    expect(discMask(1.5)).toBe(0);
    // 부드럽게 죽는다(하드 엣지가 없다 — §3-C-2 "각진 폴리곤이 아니라 소프트 페이드").
    expect(discMask(0.85)).toBeGreaterThan(0);
    expect(discMask(0.85)).toBeLessThan(1);
  });

  it('균열이 얇은 선이다 — 넓은 얼룩이면 다시 "평면 채움"이다', () => {
    const s = sampleDisc(crackLuminance, 64);
    // 밝은 픽셀(≥0.5)이 소수여야 "선"이다. 절반을 넘으면 원판이 통째로 밝은 것이다.
    const bright = s.filter((v) => v >= 0.5).length / s.length;
    expect(bright).toBeGreaterThan(0.005); // 존재한다
    expect(bright).toBeLessThan(0.2); // 그러나 선이다
    // 최댓값이 실제로 높이 올라간다(균열이 발광 코어로 읽힌다).
    expect(Math.max(...s)).toBeGreaterThan(0.8);
  });

  it('그을음 균열은 반대 부호다 — 밝히지 않고 어둡게 한다(곱연산)', () => {
    const s = sampleDisc(crackShadeLuminance, 48);
    expect(Math.max(...s)).toBeLessThanOrEqual(1);
    expect(Math.min(...s)).toBeLessThan(0.5); // 실제로 검은 금이 있다
    expect(mean(s)).toBeGreaterThan(0.6); // 그러나 판 전체가 검지는 않다
    // 원 밖은 그대로(1) — 곱연산 겹이 사각 타일을 드러내면 안 된다.
    expect(crackShadeLuminance(1.4, 0)).toBe(1);
  });

  it('식은 껍질과 발광 균열이 같은 자리에 있지 않다(판과 금이 겹치면 무늬가 죽는다)', () => {
    // 다른 노이즈 시드를 쓰므로 상관이 낮아야 한다. "균열이 밝은 곳에서 껍질도 가장 어둡다"면
    // 두 겹이 서로를 지운다.
    let both = 0;
    let crackBright = 0;
    for (let iy = 0; iy < 48; iy++) {
      for (let ix = 0; ix < 48; ix++) {
        const nx = ((ix + 0.5) / 48) * 2 - 1;
        const ny = ((iy + 0.5) / 48) * 2 - 1;
        if (Math.hypot(nx, ny) >= 0.9) continue;
        const c = crackLuminance(nx, ny) >= 0.5;
        if (!c) continue;
        crackBright++;
        if (plateShadeLuminance(nx, ny) < 0.75) both++;
      }
    }
    expect(crackBright).toBeGreaterThan(10);
    expect(both / crackBright).toBeLessThan(0.6);
  });

  it('거품이 채워진 얼룩이다 — 링 윤곽이 없다 (5차 §2-5)', () => {
    // 4차는 `dd≈0.82` 에 좁은 봉우리를 둬 "테두리가 밝은 원"을 만들었다. 의도는 "채워진 원은
    // 다시 도형이다" 였지만, 테두리가 밝은 작은 원은 **정확히 링**이고 41셀이 겹치면 §2-5 의
    // 동심 윤곽이 된다.
    //
    // 링이 없음을 재는 법: 거품 하나를 골라 중심에서 밖으로 훑는다. 링이면 중간 반경에서
    // 봉우리가 서고(중심 < 봉우리) 얼룩이면 **중심이 최대**이고 단조 감소한다.
    // 22개 거품이 서로 겹쳐 있어 하나만 골라 재면 이웃 기울기가 섞인다. **전 거품 × 8방향의
    // 평균 반경 프로파일**을 쓰면 이웃 기여가 평탄해져 커널의 성질만 남는다.
    const STEPS = 10;
    const prof = new Array<number>(STEPS).fill(0);
    for (let k = 0; k < 22; k++) {
      const cx = (hash3(0x5b8f2d11, k, 0, 1) * 2 - 1) * 0.74;
      const cy = (hash3(0x5b8f2d11, k, 0, 2) * 2 - 1) * 0.74;
      const rr = 0.09 + 0.13 * hash3(0x5b8f2d11, k, 0, 3);
      for (let s = 0; s < STEPS; s++) {
        const t = (s / STEPS) * rr;
        for (let a = 0; a < 8; a++) {
          const ang = (a / 8) * Math.PI * 2;
          prof[s]! += bubbleLuminance(cx + Math.cos(ang) * t, cy + Math.sin(ang) * t) / (22 * 8);
        }
      }
    }
    expect(prof[0]).toBe(Math.max(...prof)); // 중심이 최대 = 링이 아니다
    for (let i = 1; i < prof.length; i++) {
      expect(prof[i]!, `i=${i}`).toBeLessThan(prof[i - 1]!);
    }
    const s = sampleDisc(bubbleLuminance, 64);
    expect(Math.max(...s)).toBeGreaterThan(0.5); // 그래도 보인다(3차 반려로 안 돌아간다)
    expect(mean(s)).toBeLessThan(0.45); // 원판이 통째로 차 있지 않다
    expect(bubbleLuminance(1.3, 0)).toBe(0);
  });

  it('렌즈는 집광 무늬와 유리 테두리를 갖고, 무늬가 원형 격자가 아니다', () => {
    // 유리 테두리: 안쪽 가장자리(0.93)가 밝다.
    expect(lensLuminance(0.93, 0)).toBeGreaterThan(0.5);
    // 같은 반경의 서로 다른 각도에서 값이 달라야 "원형 격자"가 아니다.
    const ring: number[] = [];
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      ring.push(lensLuminance(Math.cos(t) * 0.55, Math.sin(t) * 0.55));
    }
    expect(Math.max(...ring) - Math.min(...ring)).toBeGreaterThan(0.15);
    expect(lensLuminance(1.2, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 굴절 변위맵 — 실제 왜곡의 입력
// ---------------------------------------------------------------------------

describe('굴절 변위맵', () => {
  it('가장자리에서 변위가 0 으로 죽는다(장판 경계에 잘린 자국이 안 남는다)', () => {
    const e = lensDisplacement(0.999, 0);
    expect(Math.hypot(e.x, e.y)).toBeLessThan(0.01);
    expect(lensDisplacement(1.5, 0)).toEqual({ x: 0, y: 0 });
  });

  it('내부에서는 실제로 밀어낸다(0 이면 필터가 있으나 왜곡이 없다)', () => {
    const m = lensDisplacement(0.45, 0.2);
    expect(Math.hypot(m.x, m.y)).toBeGreaterThan(0.05);
  });

  it('0 변위가 128 로 인코딩된다(규약을 틀리면 화면이 통째로 밀린다)', () => {
    const tex = bakeVectorTexture(8, () => ({ x: 0, y: 0 }));
    expect(tex).not.toBeNull();
    const px = (tex?.source as unknown as { resource: Uint8Array }).resource;
    for (let i = 0; i < px.length; i += 4) {
      expect(px[i]).toBe(128);
      expect(px[i + 1]).toBe(128);
      expect(px[i + 3]).toBe(255);
    }
  });
});

// ---------------------------------------------------------------------------
// 예산 회계 입력 — §2-4 를 실측 파생으로 잠그는 평균 휘도
// ---------------------------------------------------------------------------

describe('평균 휘도 — 가산 부하 회계의 입력', () => {
  it('원판 평균이 상수 함수에서 정확하다(적분기가 원 밖을 세지 않는다)', () => {
    expect(meanDiscLuminance(() => 1, 64)).toBeCloseTo(1, 6);
    expect(meanDiscLuminance(() => 0, 64)).toBe(0);
  });

  it('환경 기여의 순수 쌍둥이가 canvas 정지점과 같은 값을 낸다', () => {
    // 화면 경로는 canvas 라 node 에서 못 굽는다. 회계가 쓰는 쌍둥이가 같은 곡선인지 정지점에서 본다.
    expect(glowLuminance(0, 0)).toBeCloseTo(0.95, 6);
    expect(glowLuminance(0.35, 0)).toBeCloseTo(0.42, 6);
    expect(glowLuminance(0.7, 0)).toBeCloseTo(0.12, 6);
    expect(glowLuminance(1, 0)).toBe(0);
    expect(glowLuminance(1.4, 0)).toBe(0);
    // 정지점 사이는 단조 감소여야 "번짐"이다.
    let prev = Infinity;
    for (let i = 0; i <= 20; i++) {
      const v = glowLuminance(i / 20, 0);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it('가산 겹의 평균 휘도 순위가 뒤집히지 않는다(회계 가중치의 근거)', () => {
    // 림은 광원 쪽 좁은 띠뿐이라 **원판 평균이 가장 낮다** — 4차가 알파만 보고 0.6 까지 올렸다가
    // §2-5 위반을 만든 자리다. 이 순위가 "알파 × 면적 × 휘도"를 곱해야 하는 이유의 물증이다.
    const rim = meanDiscLuminance(rimLuminance);
    const blob = meanDiscLuminance(blobLuminance);
    expect(rim).toBeLessThan(blob * 0.3);
    expect(rim).toBeGreaterThan(0); // 0 이면 겹이 화면에 없다는 뜻이다
    // 거품 얼룩이 4차 막보다 어둡다(§2-4 순감). 막 경로는 봉우리가 좁고 높아 평균이 오히려 높았다.
    expect(meanDiscLuminance(bubbleLuminance)).toBeLessThan(0.12);
  });
});
