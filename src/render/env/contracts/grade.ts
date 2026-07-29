/**
 * 그레이딩 레이어 **테마 계약** — 이 파일은 그레이딩 레인이 소유한다.
 *
 * 여기 있어야 하는 것은 행성마다 달라지는 **데이터의 모양**과, 그 데이터가 지켜야 하는
 * **관계 불변식**이다. 메커니즘(합성 순서·텍스처 굽기·티어 배율)은 레이어 구현에 남긴다.
 *
 * ## 왜 프로파일 수학까지 여기 있는가
 * 검증기는 "이 알파 조합이 가독성 예산을 넘는가"를 판정해야 하는데, 그러려면 **형상 필드가
 * 화면 어디서 얼마나 먹는지**를 알아야 한다. 즉 프로파일은 테마 필드의 의미 그 자체라
 * 계약과 분리할 수 없다. 물리적으로도 여기 있어야 한다 — `theme.ts` → `contracts/grade.ts`
 * → `themes/…` → `grade.ts`(레이어) 가 이미 사슬이므로, 계약이 레이어를 되짚어 import 하면
 * 순환이 된다. 이 파일은 `pixi.js` 를 모르는 순수 모듈이다.
 *
 * ## 이 파일을 채울 때의 규율
 * - 파생값을 필드로 만들지 마라. 다른 필드에서 계산되는 값은 함수로 노출한다.
 * - 알파 상한은 **치환**되는 값이다. 전역 배율 필드를 만들지 마라(곱하면 카르곤 1차 실패가
 *   재현된다 — 보수적 판단이 곱해져 화면 기여가 0 이 된다).
 * - 값 사이의 관계는 주석이 아니라 {@link validateGradeTheme} 에 넣어라. 주석은 다음 레인이 안 읽는다.
 *
 * 렌더 전용(ADR-0005).
 */

import type { ThemeViolation } from '../theme.js';
import { violate } from '../theme.js';
import { relLuminanceOf } from '../color.js';

// ───────────────────── 가독성 계약 (행성이 바꿀 수 없다 — 메커니즘 상한) ─────────────────────

/**
 * **이 레이어의 어떤 요소도 이 알파를 넘지 못한다.** 티어·감소 토글 어떤 조합에서도.
 * 화면 전체를 덮는 레이어의 유일한 안전장치라 파생값이 아니라 상수로 둔다.
 */
export const LAYER_MAX_ALPHA = 0.3;

/**
 * 중앙 안전 반경(정규 좌표 [-1,1] 기준). 이 사각형 안은 플레이어와 근접 전투 영역이라
 * {@link CENTER_MIN_RETENTION} 이상의 밝기를 반드시 남긴다.
 */
export const CENTER_SAFE_RADIUS = 0.35;

/** 중앙 안전 영역에서 반드시 남겨야 하는 최소 밝기 비율(1 = 원본 그대로). */
export const CENTER_MIN_RETENTION = 0.94;

/**
 * **화면 어느 지점에서도** 이 레이어가 깎는 밝기 비율의 상한. 적은 화면 밖에서 들어오므로
 * 가장자리·모서리가 그대로 판정 대상이다.
 */
export const EDGE_MAX_DARKENING = 0.36;

// ───────────────────────── 테마 데이터 ─────────────────────────

/**
 * 그레이딩 요소 6종의 알파 상한.
 *
 * ⚠️ **독립 슬라이더가 아니라 공동 예산의 배분이다.** 비네트·cool·gain 셋이 같은 "밝기 손실"
 * 예산({@link EDGE_MAX_DARKENING}·{@link CENTER_MIN_RETENTION})에서 먹으므로 한쪽을 키우면
 * 다른 쪽을 줄여야 한다. 이 관계는 {@link validateGradeTheme} 이 실제로 계산해 검사한다 —
 * 임의의 조합을 넣어 보면 조합적으로 걸린다.
 */
export interface GradeAlphaBudget {
  /** 비네트(검정 알파 합성). */
  readonly vignette: number;
  /** 따뜻한 **가산**. */
  readonly warm: number;
  /** 차가운 **곱연산**(가장자리 형상). */
  readonly cool: number;
  /** 전역 **gain**(곱연산) — 하이라이트 색조 + 하이라이트 가중 감쇠. */
  readonly gain: number;
  /** 전역 **lift**(가산) — 암부 색조. */
  readonly shadow: number;
  /** 필름 그레인(가산). */
  readonly grain: number;
}

/** 비네트의 기하. 밝은 코어를 어디에 두고 어디서부터 어디까지 어둡힐 것인가. */
export interface VignetteShape {
  /**
   * 밝은 코어의 세로 오프셋(정규 좌표, +가 아래). 0 이면 완전 대칭이고, 벗어난 만큼
   * 반대쪽이 더 눌려 장면에 방향감이 생긴다(광원이 위/아래 어디 있는지의 시각적 반영).
   */
  readonly centerY: number;
  /** 비네트가 시작되는 정규 거리. 이 안쪽은 감쇠 0(= 중앙 무보정). */
  readonly inner: number;
  /** 비네트가 최대에 도달하는 정규 거리. 화면 최원거리 모서리는 약 1.49 다. */
  readonly outer: number;
}

/** 따뜻한 가산이 화면 어디에 몰리는가. */
export interface WarmShape {
  /** 가산이 시작되는 세로 위치(정규 좌표, +가 아래). 이 위쪽은 정확히 0 이다. */
  readonly startY: number;
  /** 좌우로 갈수록 약해지는 정도 [0,1). `1 − sideFalloff·nx²` 를 곱한다. */
  readonly sideFalloff: number;
}

/** 차가운 곱연산이 화면 어디에 몰리는가. 상단 램프와 좌우 램프 중 **강한 쪽**을 취한다. */
export interface CoolShape {
  /** 상단 램프 시작(정규 ny). `topEnd` 쪽으로 갈수록 1 에 가까워진다. */
  readonly topStart: number;
  /** 상단 램프 끝. `topStart` 보다 작으면(위쪽) 방향이 뒤집힌다. */
  readonly topEnd: number;
  /** 좌우 램프 시작(정규 |nx|). */
  readonly sideStart: number;
  /** 좌우 램프 끝. */
  readonly sideEnd: number;
}

/** 요소 5종의 색. 그레이딩의 성격은 사실상 이 다섯 값이 정한다. */
export interface GradeTints {
  /** 하단 열기(가산). */
  readonly warm: number;
  /** 상단·가장자리 그림자(곱연산). */
  readonly cool: number;
  /** 그레인(가산). 무채에 가깝게 두어야 색을 밀지 않는다. */
  readonly grain: number;
  /** 전역 gain(곱연산)의 tint = **하이라이트 색조**. */
  readonly gain: number;
  /** 전역 lift(가산)의 tint = **암부 색조**. */
  readonly shadow: number;
}

/**
 * 스플릿 톤의 **방향**.
 *
 * - `+1` — 하이라이트가 따뜻하고 암부가 차갑다(용암·사막·석양). warmth(R−B)가 명도에 대해
 *   증가한다.
 * - `-1` — 하이라이트가 차갑고 암부가 따뜻하다(설원·빙하·달빛). warmth 가 감소한다.
 *
 * 부호 없이 `+1` 을 코드에 박으면 눈 행성의 단조성 검사가 통째로 뒤집혀 "스플릿이 없다"로
 * 오판된다. 그래서 테마가 선언하고 검증·테스트가 이 부호를 따라간다.
 */
export type WarmthDirection = 1 | -1;

/** 그레이딩 레이어의 행성별 데이터. */
export interface GradeTheme {
  /** 소속 테마 슬러그. 텍스처 캐시 키 접두로 쓴다(테마마다 다른 텍스처를 구우므로 필수). */
  readonly themeId: string;
  readonly alpha: GradeAlphaBudget;
  readonly vignette: VignetteShape;
  readonly warm: WarmShape;
  readonly cool: CoolShape;
  readonly tint: GradeTints;
  readonly warmthDirection: WarmthDirection;
}

/** 알파 필드 이름 전부(검증·단조성 비교가 이 순서로 돈다). */
export const GRADE_ALPHA_KEYS: readonly (keyof GradeAlphaBudget)[] = [
  'vignette',
  'warm',
  'cool',
  'gain',
  'shadow',
  'grain',
];

// ───────────────────────── 강도 스냅샷 ─────────────────────────

/**
 * 레이어가 프레임마다 쓰는 강도 스냅샷. 테마 알파에 티어·접근성 배율이 곱해진 결과이며,
 * 실제 계산은 레이어(`grade.ts` 의 `gradeStrengths`)가 한다.
 */
export interface GradeStrengths {
  /** 비네트 스프라이트 알파. */
  vignette: number;
  /** 따뜻한 가산 스프라이트 알파. */
  warm: number;
  /** 차가운 곱연산 스프라이트 알파. */
  cool: number;
  /** 전역 gain(곱연산) 스프라이트 알파 — 하이라이트 색조 + 하이라이트 가중 감쇠. */
  gain: number;
  /** 전역 lift(가산) 스프라이트 알파 — 암부 색조. */
  shadow: number;
  /** 그레인 스프라이트 알파(0 이면 그레인 자체를 끈다). */
  grain: number;
  /** 그레인 위상 애니메이션 여부. `reducedMotion` 에서 정지한다. */
  grainAnimation: boolean;
}

/**
 * 배율이 하나도 안 걸린 **최댓값** 강도. 검증은 이 지점만 보면 된다 — 티어·접근성 배율은
 * 전부 [0,1] 이라 어떤 조합도 이보다 세지지 않고, 감쇠 항 셋이 알파에 선형이라 최악이 여기다.
 * (레이어의 `gradeStrengths('high', 기본설정)` 이 이것과 일치하는지는 테스트가 잠근다.)
 */
export function peakStrengths(t: GradeTheme): GradeStrengths {
  const a = t.alpha;
  return {
    vignette: a.vignette,
    warm: a.warm,
    cool: a.cool,
    gain: a.gain,
    shadow: a.shadow,
    grain: a.grain,
    grainAnimation: a.grain > 0,
  };
}

// ───────────────────── tint → 채널·휘도 파생 (손으로 적은 상수 금지) ─────────────────────

/** 0xRRGGBB → [r,g,b] (각 [0,1]). 순수. */
export function tintChannels(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

/**
 * 차가운 곱연산이 실제로 깎는 밝기 비율(알파 1 기준). 곱연산은 알파만큼 검게 만드는 것이 아니라
 * `tint` 의 휘도만큼만 남기므로, 알파를 그대로 감쇠로 세면 과대평가다.
 *
 * 상수를 손으로 적지 않고 tint 에서 파생한다 — 색을 바꿨는데 감쇠 상수가 따라오지 않아 가독성
 * 상한이 조용히 뚫리는 것을 구조적으로 막는다. 아래 둘도 같은 이유로 함수다.
 */
export function coolLumaLoss(t: GradeTheme): number {
  return 1 - relLuminanceOf(t.tint.cool);
}

/** 전역 gain 이 알파 1 기준으로 깎는 밝기 비율. */
export function gainLumaLoss(t: GradeTheme): number {
  return 1 - relLuminanceOf(t.tint.gain);
}

/** 전역 lift 가 알파 1 기준으로 더하는 밝기. */
export function shadowLumaGain(t: GradeTheme): number {
  return relLuminanceOf(t.tint.shadow);
}

// ───────────────────── 순수 프로파일 (테마 형상 → 위치별 세기) ─────────────────────

/** [a,b] 구간 smoothstep. a=b 방어 포함. b<a 면 방향이 뒤집힌다(위쪽 그라디언트에 쓴다). */
export function smooth01(a: number, b: number, x: number): number {
  if (a === b) return x >= b ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * 비네트 감쇠 프로파일 → [0,1]. 정규 화면 좌표(nx,ny ∈ [-1,1], ny=+1 이 화면 아래)를 받는다.
 * 실제 화면 감쇠는 이 값 × {@link GradeStrengths.vignette} 다.
 */
export function vignetteAt(nx: number, ny: number, v: VignetteShape): number {
  return vignetteAtRadius(Math.hypot(nx, ny - v.centerY), v);
}

/** 코어 중심으로부터의 정규 거리만으로 본 비네트 세기. 텍스처를 동심 링으로 구울 때 쓴다. */
export function vignetteAtRadius(r: number, v: VignetteShape): number {
  return smooth01(v.inner, v.outer, r);
}

/**
 * 따뜻한 가산 프로파일 → [0,1]. 화면 하단 중앙에 몰린다(좌우로 갈수록 약해진다).
 * {@link WarmShape.startY} 위쪽 전체가 정확히 0 이다.
 */
export function warmAt(nx: number, ny: number, w: WarmShape): number {
  return smooth01(w.startY, 1, ny) * (1 - w.sideFalloff * nx * nx);
}

/** 차가운 곱연산 프로파일 → [0,1]. 상단 램프와 좌우 램프 중 **강한 쪽**을 취한다. */
export function coolAt(nx: number, ny: number, c: CoolShape): number {
  return Math.max(
    smooth01(c.topStart, c.topEnd, ny),
    smooth01(c.sideStart, c.sideEnd, Math.abs(nx)),
  );
}

/** 텍스처 굽기용 프로파일 팩토리. `bakeGradient` 가 `(nx,ny)=>alpha` 를 인자로 받는다. */
export function makeVignetteProfile(v: VignetteShape): (nx: number, ny: number) => number {
  return (nx, ny) => vignetteAt(nx, ny, v);
}
/** {@link makeVignetteProfile} 의 웜 판. */
export function makeWarmProfile(w: WarmShape): (nx: number, ny: number) => number {
  return (nx, ny) => warmAt(nx, ny, w);
}
/** {@link makeVignetteProfile} 의 쿨 판. */
export function makeCoolProfile(c: CoolShape): (nx: number, ny: number) => number {
  return (nx, ny) => coolAt(nx, ny, c);
}

// ───────────────────────── 밝기 예산 ─────────────────────────

/**
 * 그 지점에서 이 레이어가 깎는 밝기의 **상계**. 비네트(검정 알파 합성)와 차가운 곱연산(휘도
 * 손실 {@link coolLumaLoss} 배)을 더한다. 가산(warm)·그레인은 밝히는 쪽이라 세지 않으므로
 * 이 값이 곧 최악의 어두워짐이다.
 *
 * 전역 gain 은 위치와 무관하게 항상 들어가므로 화면 어디서나 바닥값으로 깔린다 — 이 항 때문에
 * 중앙 잔존율 상한이 비로소 항진이 아닌 **실제 구속**이 된다.
 */
export function darkeningBound(nx: number, ny: number, s: GradeStrengths, t: GradeTheme): number {
  return (
    vignetteAt(nx, ny, t.vignette) * s.vignette +
    coolAt(nx, ny, t.cool) * s.cool * coolLumaLoss(t) +
    s.gain * gainLumaLoss(t)
  );
}

/**
 * 정규 좌표 사각형 `[-r,r]²` 위 {@link darkeningBound} 의 최댓값.
 *
 * 격자 표본이다. 프로파일이 smoothstep 합성이라 최댓값은 사실상 모서리에 있고, 129 격자와
 * 1025 격자가 카르곤에서 같은 값을 준다 — 그래서 이 해상도로 충분하다.
 */
export function maxDarkening(s: GradeStrengths, t: GradeTheme, radius = 1, steps = 64): number {
  let worst = 0;
  for (let i = -steps; i <= steps; i++) {
    for (let j = -steps; j <= steps; j++) {
      const d = darkeningBound((i / steps) * radius, (j / steps) * radius, s, t);
      if (d > worst) worst = d;
    }
  }
  return worst;
}

// ───────────────────────── 전역 톤(스플릿 톤) ─────────────────────────

/**
 * **톤 전달함수** — 중성 회색 입력 `g ∈ [0,1]` 이 전역 톤(gain + lift)을 통과한 뒤의 RGB.
 * 위치 의존 요소(비네트·cool·warm)는 제외한 **화면 어디서나 공통인 부분**만 담는다.
 *
 * ```
 *   out_ch = g · (1 − a_gain + a_gain · gainTint_ch) + a_shadow · shadowTint_ch
 * ```
 *
 * 클리핑하지 않는다 — 디스플레이가 [0,1] 로 자르는 것과 별개로, 이 함수는 **전달함수 자체**라
 * 단조성·교차점 같은 성질을 클리핑에 가려지지 않은 채로 검증할 수 있어야 한다. 실제로 g=1 에서
 * 오버플로가 없다는 것은 {@link validateGradeTheme} 이 채널별로 강제한다.
 */
export function toneMap(g: number, s: GradeStrengths, t: GradeTheme): [number, number, number] {
  const gain = tintChannels(t.tint.gain);
  const shadow = tintChannels(t.tint.shadow);
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    out[c] = g * (1 - s.gain + s.gain * gain[c]!) + s.shadow * shadow[c]!;
  }
  return out;
}

/**
 * 그 명도에서 톤이 얼마나 **따뜻한가** (= R − B). 음수면 차갑다, 양수면 따뜻하다.
 *
 * 아핀 사상이라 이 함수는 g 의 **일차식**이다: 기울기는 `s.gain · (gainR − gainB)`,
 * 절편은 `s.shadow · (shadowR − shadowB)`. 즉 두 항 중 **하나라도 죽으면 스플릿이 사라진다**.
 */
export function toneWarmth(g: number, s: GradeStrengths, t: GradeTheme): number {
  const v = toneMap(g, s, t);
  return v[0] - v[2];
}

/** warmth 기울기(= g 계수). 부호가 곧 {@link WarmthDirection} 이어야 한다. */
export function warmthSlope(s: GradeStrengths, t: GradeTheme): number {
  const gain = tintChannels(t.tint.gain);
  return s.gain * (gain[0] - gain[2]);
}

/**
 * warmth 의 부호가 바뀌는 명도. 일차식이라 이분법이 아니라 닫힌 해다.
 * 기울기가 0 이면 부호가 바뀌지 않으므로 `NaN` 을 돌려준다(호출부가 스플릿 부재로 판정한다).
 */
export function warmthCrossing(s: GradeStrengths, t: GradeTheme): number {
  const m = warmthSlope(s, t);
  if (m === 0) return NaN;
  return -toneWarmth(0, s, t) / m;
}

// ───────────────────────── 검증 ─────────────────────────

/**
 * 그레이딩 테마 검증. 빈 배열이면 통과.
 *
 * 값의 "좋음"이 아니라 **구조적으로 화면을 깨는 조합**만 잡는다. 여기서 걸리는 것들은 전부
 * 카르곤이 실제로 밟았거나, 밟았다면 조용히 지나갔을 것들이다.
 */
export function validateGradeTheme(t: GradeTheme): ThemeViolation[] {
  const out: ThemeViolation[] = [];
  violate(out, t.themeId.length > 0, 'themeId', '테마 슬러그가 비었다');

  // ① 개별 알파는 레이어 상한 안. 이걸 넘으면 티어를 낮춰도 화면이 안 보인다.
  for (const k of GRADE_ALPHA_KEYS) {
    const v = t.alpha[k];
    violate(
      out,
      Number.isFinite(v) && v >= 0 && v <= LAYER_MAX_ALPHA,
      `alpha.${k}`,
      `[0, ${LAYER_MAX_ALPHA}] 밖: ${v}`,
    );
  }

  // ② 형상이 성립하는가. 비네트 코어가 중앙 안전 영역 밖으로 나가면 플레이어가 코어 밖에 선다.
  const v = t.vignette;
  violate(out, v.inner >= 0 && v.inner < v.outer, 'vignette', `inner < outer 여야 한다: ${v.inner}, ${v.outer}`);
  violate(
    out,
    Math.abs(v.centerY) <= CENTER_SAFE_RADIUS,
    'vignette.centerY',
    `중앙 안전 반경(${CENTER_SAFE_RADIUS})을 벗어나면 플레이어가 밝은 코어 밖에 선다: ${v.centerY}`,
  );
  const w = t.warm;
  violate(out, w.startY > -1 && w.startY < 1, 'warm.startY', `(-1,1) 밖: ${w.startY}`);
  violate(
    out,
    w.sideFalloff >= 0 && w.sideFalloff < 1,
    'warm.sideFalloff',
    `[0,1) 밖이면 화면 좌우 끝에서 가산이 음수가 된다: ${w.sideFalloff}`,
  );
  const c = t.cool;
  violate(out, c.topStart !== c.topEnd, 'cool.top', '상단 램프의 시작과 끝이 같다(계단이 된다)');
  violate(out, c.sideStart !== c.sideEnd, 'cool.side', '좌우 램프의 시작과 끝이 같다(계단이 된다)');

  // ③ 화면 정중앙은 위치 의존 요소가 손대지 않는다. 전투가 벌어지는 곳이다.
  violate(out, vignetteAt(0, 0, v) === 0, 'vignette', '화면 정중앙에서 비네트가 0 이 아니다');
  violate(out, warmAt(0, 0, w) === 0, 'warm', '화면 정중앙에서 따뜻한 가산이 0 이 아니다');
  violate(out, coolAt(0, 0, c) === 0, 'cool', '화면 정중앙에서 차가운 곱연산이 0 이 아니다');

  // ④ **알파 예산.** 6개는 독립 슬라이더가 아니다 — 감쇠 항 셋의 합이 가독성 캡을 넘는지
  //    화면 격자 전체에서 실제로 계산한다. 여기가 이 검증기의 존재 이유다.
  const peak = peakStrengths(t);
  const edge = maxDarkening(peak, t);
  violate(
    out,
    edge <= EDGE_MAX_DARKENING,
    'alpha',
    `가장자리 최대 밝기 손실 ${edge.toFixed(4)} 가 상한 ${EDGE_MAX_DARKENING} 초과 — `
      + '비네트·cool·gain 은 같은 예산에서 먹는다(하나를 키웠으면 다른 하나를 줄여라)',
  );
  const center = maxDarkening(peak, t, CENTER_SAFE_RADIUS, 32);
  violate(
    out,
    1 - center >= CENTER_MIN_RETENTION,
    'alpha',
    `중앙 안전 영역 잔존율 ${(1 - center).toFixed(4)} 가 하한 ${CENTER_MIN_RETENTION} 미만`,
  );

  // ⑤ **블랙포인트가 뜨지 않는다.** lift 는 암부에 색을 주려고 넣은 것이지 밝히려고 넣은 게
  //    아니다. 밝기 변화는 방향을 불문하고 가독성 예산이라 중앙 예산과 같은 크기로 잡는다.
  const lift = peak.shadow * shadowLumaGain(t);
  violate(
    out,
    lift <= 1 - CENTER_MIN_RETENTION,
    'tint.shadow',
    `암부 절대 휘도 상승 ${lift.toFixed(4)} 가 예산 ${(1 - CENTER_MIN_RETENTION).toFixed(2)} 초과 `
      + '— 휘도가 싼 방향(파랑 지배)으로 밀어라',
  );

  // ⑥ **g=1 에서 채널 오버플로가 없다.** 오버플로가 나면 디스플레이 클리핑이 warmth 단조성을
  //    잘라 먹어 "스플릿이 있는데 안 보이는" 상태가 된다. 카르곤이 gain tint 의 R=255 로
  //    맞춘 것이 바로 이 조건이며(R 채널에서 등호로 붙는다), 일반 테마에서는 채널 3개 전부에
  //    대한 부등식이다.
  const gainCh = tintChannels(t.tint.gain);
  const shadowCh = tintChannels(t.tint.shadow);
  for (let i = 0; i < 3; i++) {
    const head = peak.gain * (1 - gainCh[i]!);
    const push = peak.shadow * shadowCh[i]!;
    violate(
      out,
      push <= head + 1e-12,
      'tint',
      `채널 ${i} 가 흰색에서 오버플로한다(lift ${push.toFixed(4)} > gain 여유 ${head.toFixed(4)})`,
    );
  }

  // ⑦ **스플릿 톤이 선언한 방향으로 실제 존재한다.** 기울기·절편 중 하나만 죽어도 전역 캐스트가
  //    되고, 부호를 코드에 박으면 눈 행성에서 통째로 뒤집힌다.
  const d = t.warmthDirection;
  violate(out, d === 1 || d === -1, 'warmthDirection', `+1 또는 -1 이어야 한다: ${String(d)}`);
  const slope = warmthSlope(peak, t);
  violate(
    out,
    d * slope > 0,
    'tint.gain',
    `하이라이트 색조가 선언 방향(${d})과 어긋난다 — warmth 기울기 ${slope.toFixed(4)}`,
  );
  const cross = warmthCrossing(peak, t);
  violate(
    out,
    Number.isFinite(cross) && cross > 0 && cross < 1,
    'tint.shadow',
    `warmth 부호가 [0,1] 안에서 바뀌지 않는다(교차점 ${String(cross)}) — 스플릿이 아니라 전역 캐스트다`,
  );

  return out;
}
