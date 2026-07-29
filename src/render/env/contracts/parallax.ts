/**
 * 시차 레이어 **테마 계약** — 이 파일은 시차 레인이 소유한다.
 *
 * 여기 있는 것은 행성마다 달라지는 **데이터의 모양**과, 그 데이터가 지켜야 하는
 * **관계 불변식**이다. 기하·합성 순서·텍스처 굽기·Pixi 배선 같은 메커니즘은
 * {@link file://../parallax.ts} 에 남는다.
 *
 * ## 왜 명도 분석 함수들이 계약 쪽에 있나
 * 불변식의 절대다수가 "색과 알파와 면적을 곱했을 때 화면이 어떻게 되는가"에 대한 것이라,
 * 검증은 그 계산 없이는 쓸 수 없다. 계산을 레이어 쪽에 두고 계약이 그걸 import 하면
 * `parallax.ts → themes/ → contracts/parallax.ts → parallax.ts` 순환이 생긴다. 반대로 여기
 * 두면 의존이 한 방향(레이어 → 계약)으로만 흐른다. 게다가 이 함수들은 전부 `BandSpec` 과
 * 바닥 휘도만 받는 순수 함수라 Pixi 와 아무 관계가 없다.
 *
 * ## 이 파일을 고칠 때의 규율
 * - 파생값을 필드로 만들지 마라. 다른 필드에서 계산되는 값은 함수로 노출한다.
 * - 알파 상한은 **치환**되는 값이다. 전역 배율 필드를 만들지 마라(곱하면 카르곤 1차 실패가
 *   재현된다 — 보수적 판단이 곱해져 화면 기여가 0 이 된다).
 * - 값 사이의 관계는 주석이 아니라 {@link validateParallaxTheme} 에 넣어라. 주석은 다음 레인이 안 읽는다.
 *
 * 렌더 전용(ADR-0005).
 */

import type { QualityTier } from '../../qualityTier.js';
import { violate, type ThemeViolation } from '../theme.js';

/** 방사 그라디언트 감쇠 프로파일: `[offset, alpha]` 색 정지점(offset 오름차순). */
export type Falloff = readonly (readonly [number, number])[];

/** 넓고 부드럽게 퍼지는 감쇠(면적을 넓게). */
export const FALLOFF_WIDE: Falloff = [
  [0, 1],
  [0.45, 0.62],
  [0.8, 0.2],
  [1, 0],
];
/** 중간 감쇠. */
export const FALLOFF_SOFT: Falloff = [
  [0, 1],
  [0.5, 0.5],
  [1, 0],
];
/** 코어에 몰린 감쇠(밝은 면적을 좁게). */
export const FALLOFF_TIGHT: Falloff = [
  [0, 1],
  [0.25, 0.45],
  [0.6, 0.08],
  [1, 0],
];

/**
 * 대역이 **어느 밝기의 바닥에서 일하도록 설계됐는가**.
 *
 * - `lit`    — 밝은 지형 위에서 보인다. `normal` 어둡힘(델타가 `a*(L-base)` 라 바닥이 밝을수록
 *              커진다) 또는 면적이 좁은 가산.
 * - `shadow` — 어두운 바닥 위에서 보인다. **가산만 가능하다** — `normal` 은 검정 위에서 뺄 빛이
 *              없어 델타가 0 으로 수렴하기 때문이다. 명도보다 **색조**로 읽히게 설계한다.
 *
 * 이 축이 자료로 박혀 있어야 "대역이 전부 밝은 쪽에 몰려 암부가 평면으로 남아 있다"는 상태가
 * 눈이 아니라 {@link validateParallaxTheme} 에서 잡힌다.
 */
export type BandDomain = 'lit' | 'shadow';

/** 한 시차 대역의 정적 사양. 전부 상수라 런타임 할당이 없다. */
export interface BandSpec {
  /** 진단용 이름. 텍스처 캐시 키(`themeId:key`)와 스프라이트 `label` 에 실린다 — `:` 금지. */
  readonly key: string;
  /** 이 대역이 일하도록 설계된 바닥 밝기. {@link BandDomain} 참조. */
  readonly domain: BandDomain;
  /** 카메라 대비 이동 배율. 작을수록 멀다. */
  readonly parallax: number;
  /** 화면상 반복 주기(design px). 화면보다 크게 잡아 "훨씬 큰 스케일"을 만든다. */
  readonly tile: number;
  /** 기본 알파(티어·감소 토글로 더 낮아질 수 있다). */
  readonly alpha: number;
  /** 합성 모드. `add`=밝힘, `normal`=어둡힘. */
  readonly blend: 'add' | 'normal';
  /** 구울 색(CSS `#rrggbb`). tint 곱연산 대신 텍스처에 직접 굽는다. */
  readonly color: string;
  /** 블롭 개수. */
  readonly blobs: number;
  /** 블롭 반지름 범위(텍스처 한 변에 대한 비율). */
  readonly rMin: number;
  readonly rMax: number;
  /** 블롭 1개의 최대 알파(누적 클리핑 방지). */
  readonly peak: number;
  /** 감쇠 프로파일. */
  readonly falloff: Falloff;
  /** 카메라와 무관한 자체 드리프트(design px / sim tick). */
  readonly driftX: number;
  readonly driftY: number;
  /** 맥동 진폭(0..1, 알파에 곱해진다). */
  readonly pulse: number;
  /** 맥동 주기(sim tick). */
  readonly period: number;
  /** 이 대역이 살아나는 최소 티어. */
  readonly minTier: QualityTier;
  /** 발광 대역인가(감소 토글·저티어에서 더 눌린다). */
  readonly glow: boolean;
}

/**
 * 시차 레이어의 행성별 데이터.
 *
 * 세 휘도는 **그 행성 타일셋의 실측값**이다. 레이어가 "밝은 곳을 누르고 어두운 곳에 결을
 * 넣는다"를 판정하려면 그 행성의 바닥이 실제로 얼마나 밝은지를 알아야 하는데, 그건 행성마다
 * 다르고 계산으로 나오지 않는다. 타일셋을 교체하면 여기부터 재측정한다.
 */
export interface ParallaxTheme {
  /** 소속 테마 슬러그. 텍스처 캐시 키 접두로 쓴다(테마마다 다른 텍스처를 구우므로 필수). */
  readonly themeId: string;
  /** 이 행성 지형 바닥의 **기준** 상대 휘도(0..1). 명도 스윙 계산의 기준선. */
  readonly baseLuma: number;
  /** 이 행성 **암부** 바닥의 실측 휘도(0..1). 레이어가 어둠에서 일하는지 재는 기준. */
  readonly darkLuma: number;
  /** 이 행성 **밝은 지형** 바닥의 실측 휘도(0..1). 레이어가 밝은 쪽을 누르는지 재는 기준. */
  readonly brightLuma: number;
  /** 대역 표(뒤 → 앞). 시차 오름차순·주기 내림차순. */
  readonly bands: readonly BandSpec[];
}

/* ────────────────────────── 명도·면적 분석(순수) ────────────────────────── */

/**
 * 상대(Weber) 대비 계산의 순응 바닥. `0` 근처에서 분모가 폭주하는 것을 막고, 실제 디스플레이·
 * 눈이 완전한 검정을 구분하지 못하는 성질도 근사한다. 크기 자체에 의미는 없고 **대역 간 비교의
 * 일관성**만 있으면 된다.
 */
const LUMA_ADAPT_FLOOR = 0.03;

/** 화면 폭(design px). 대역 주기가 이보다 작으면 "저주파"가 아니라 눈에 보이는 반복 무늬다. */
const DESIGN_SCREEN_WIDTH = 1920;

/**
 * `#rrggbb` 의 상대 휘도(0..1, Rec.709 가중). 파싱 실패는 0.
 *
 * 감마 보정을 하지 않는 선형 근사다 — 여기서 필요한 건 절대 측광값이 아니라 **대역끼리
 * 비교 가능한 일관된 척도**이고, Pixi 의 `normal`/`add` 합성도 sRGB 값에 그대로 적용된다.
 */
export function relLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (m === null) return 0;
  const v = Number.parseInt(m[1] as string, 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * 대역이 **블롭 코어에서** 바닥 휘도를 얼마나 밀어 올리거나 내리는지(부호 있는 델타).
 *
 * - `normal`: `base*(1-a) + L*a` 이므로 델타는 `a*(L - base)`. 색이 바닥보다 어두우면 음수이고,
 *   **바닥이 어두울수록 0 으로 수렴한다**(검정 위에서는 뺄 빛이 없다).
 * - `add`: 가산이므로 델타는 항상 `+a*L` 이고 **바닥과 무관하다**.
 *
 * `a` 는 알파와 굽기 피크의 곱이다 — 텍스처의 최댓값이 `peak` 이라 실제 화면 알파는
 * `alpha * peak` 을 넘지 않는다(블롭 사이 틈은 이보다 훨씬 작다).
 */
export function bandPeakLuminanceDelta(spec: BandSpec, base: number): number {
  const a = spec.alpha * spec.peak;
  const l = relLuminance(spec.color);
  return spec.blend === 'add' ? a * l : a * (l - base);
}

/**
 * 감쇠 프로파일이 **알파 0.5 로 떨어지는 반경 비율**(0..1). 블롭의 "실효 반경"이다.
 *
 * 전체 반경으로 면적을 재면 꼬리까지 세어 커버리지가 과대평가된다 — "알파는 낮은데 화면이
 * 다 뿌옇다"가 정확히 그 오차에서 나온다(넓은 감쇠 × 큰 반경 × 많은 블롭).
 */
export function falloffHalfRadius(spec: BandSpec): number {
  let prevOff = 0;
  let prevA = 1;
  for (const [off, a] of spec.falloff) {
    if (a < 0.5) {
      const span = prevA - a;
      const t = span > 0 ? (prevA - 0.5) / span : 0;
      return prevOff + (off - prevOff) * t;
    }
    prevOff = off;
    prevA = a;
  }
  return 1;
}

/**
 * 대역이 텍스처 면적의 몇 배를 **실효 반경으로** 덮는지(겹침 미보정이라 1 을 넘을 수 있다).
 *
 * 이 값이 1 근처면 그 대역은 무늬가 아니라 **막**이다. 막은 "여기는 이런 지대 / 저기는 저런
 * 지대"를 만들지 못하고 화면을 통째로 한 톤 옮길 뿐이라, 그건 그레이딩 레이어의 일이다.
 */
export function bandCoverage(spec: BandSpec): number {
  const rMid = ((spec.rMin + spec.rMax) / 2) * falloffHalfRadius(spec);
  return spec.blobs * Math.PI * rMid * rMid;
}

/**
 * 레이어 전체의 명도 스윙 = "가장 어두운 지대"와 "가장 밝은 지대"의 휘도 차.
 *
 * 대역이 서로 다른 시차로 흐르므로 실제 화면에서는 겹침 조합이 계속 바뀐다. 여기서는
 * **최악(=최대 진폭) 조합**, 즉 어두운 대역만 겹친 지점과 밝은 대역만 겹친 지점을 잡는다.
 * 이 값이 작으면 화면은 좁은 중간톤 대역에 갇혀 단조로워진다.
 *
 * `dark` 는 0 이하, `bright` 는 0 이상, `swing = bright - dark`.
 */
export function parallaxLuminanceSwing(
  bands: readonly BandSpec[],
  base: number,
): { dark: number; bright: number; swing: number } {
  let dark = 0;
  let bright = 0;
  for (const b of bands) {
    const d = bandPeakLuminanceDelta(b, base);
    if (d < 0) dark += d;
    else bright += d;
  }
  return { dark, bright, swing: bright - dark };
}

/**
 * 대역 하나가 화면에 만드는 **면적 가중 명도 변조량**(항상 ≥ 0).
 *
 * 진폭만 보면 안 된다 — peak 델타가 표에서 가장 큰 대역이라도 실효 커버리지가 몇 %면 화면에
 * 닿는 면적이 사실상 없다. "얼마나 세게"와 "얼마나 넓게"를 곱해야 비로소 "화면이 얼마나
 * 달라 보이는가"에 대응한다.
 *
 * 커버리지는 1 로 자른다(겹침 미보정이라 1 을 넘을 수 있는데, 화면보다 넓게 덮을 수는 없다).
 */
export function bandModulationEnergy(spec: BandSpec, base: number): number {
  return Math.abs(bandPeakLuminanceDelta(spec, base)) * Math.min(bandCoverage(spec), 1);
}

/** 바닥 휘도 `base` 에서 레이어 전체가 만드는 면적 가중 명도 변조량. */
export function parallaxModulationEnergy(base: number, bands: readonly BandSpec[]): number {
  let e = 0;
  for (const b of bands) e += bandModulationEnergy(b, base);
  return e;
}

/**
 * 같은 변조량을 **상대(Weber) 대비**로 환산한 값 = `energy / (base + 순응바닥)`.
 *
 * 절대 휘도 델타로만 재면 암부는 영원히 진다 — 검정 위에서 큰 절대 변조를 내려면 화면을
 * 밝혀야 하고, 그건 가독성 규율에 정면으로 반한다. 하지만 눈은 절대량이 아니라 **바닥 대비
 * 비율**로 대비를 읽으므로, 어두운 곳에서는 작은 절대 증분도 충분히 보인다.
 * "어둠을 유지한 채 결을 넣는다"를 재는 척도는 이쪽이다.
 */
export function parallaxRelativeModulation(base: number, bands: readonly BandSpec[]): number {
  return parallaxModulationEnergy(base, bands) / (Math.max(base, 0) + LUMA_ADAPT_FLOOR);
}

/** 특정 {@link BandDomain} 대역들만의 변조량(역할 분담이 실제로 성립하는지 재는 데 쓴다). */
export function domainModulationEnergy(
  domain: BandDomain,
  base: number,
  bands: readonly BandSpec[],
): number {
  let e = 0;
  for (const b of bands) if (b.domain === domain) e += bandModulationEnergy(b, base);
  return e;
}

/**
 * 모든 대역의 코어가 한 자리에 겹쳤을 때의 **부호 있는 순 델타**(최악의 경우).
 *
 * 밝은 바닥에서는 음수(= 지형을 누른다), 어두운 바닥에서는 작은 양수(= 결을 넣되 어둠을
 * 유지한다)여야 한다. 이 부호가 뒤집히면 레이어가 배경을 띄워 함선·탄의 가독성을 깎는다.
 */
export function parallaxNetPeakDelta(base: number, bands: readonly BandSpec[]): number {
  const { dark, bright } = parallaxLuminanceSwing(bands, base);
  return dark + bright;
}

/* ────────────────────────── 검증 ────────────────────────── */

/** 감쇠 프로파일 하나의 구조 검증(캔버스 `addColorStop` 이 던지는 조건이 여기 다 들어 있다). */
function checkFalloff(out: ThemeViolation[], where: string, f: Falloff): void {
  violate(out, f.length >= 2, where, '정지점이 2개 미만이면 그라디언트가 아니다');
  if (f.length < 2) return;
  const first = f[0] as readonly [number, number];
  const last = f[f.length - 1] as readonly [number, number];
  violate(out, first[0] === 0, where, `첫 정지점 offset 이 0 이 아니다: ${first[0]}`);
  violate(out, first[1] > 0, where, '코어(offset 0) 알파가 0 이면 대역이 통째로 투명하다');
  violate(out, last[0] === 1, where, `마지막 정지점 offset 이 1 이 아니다: ${last[0]}`);
  // 가장자리 알파가 0 이 아니면 블롭 경계에 눈에 보이는 원형 컷이 생긴다.
  violate(out, last[1] === 0, where, `가장자리 알파가 0 이 아니다(원형 컷): ${last[1]}`);
  for (let i = 1; i < f.length; i++) {
    const p = f[i - 1] as readonly [number, number];
    const c = f[i] as readonly [number, number];
    // offset 이 오름차순이 아니면 캔버스가 던져 텍스처가 null 이 되고 대역이 조용히 사라진다.
    violate(out, c[0] > p[0], where, `offset 이 오름차순이 아니다: ${p[0]} → ${c[0]}`);
    // 단조 비증가가 아니면 falloffHalfRadius 의 선형 역보간이 엉뚱한 반경을 낸다.
    violate(out, c[1] <= p[1], where, `알파가 바깥으로 갈수록 커진다: ${p[1]} → ${c[1]}`);
  }
}

/** 대역 하나의 스칼라 범위 검증. */
function checkBandScalars(out: ThemeViolation[], where: string, b: BandSpec): void {
  violate(out, b.alpha > 0 && b.alpha <= 1, `${where}.alpha`, `(0,1] 밖: ${b.alpha}`);
  violate(out, b.peak > 0 && b.peak <= 1, `${where}.peak`, `(0,1] 밖: ${b.peak}`);
  violate(out, Number.isInteger(b.blobs) && b.blobs >= 1, `${where}.blobs`, `1 이상 정수가 아니다: ${b.blobs}`);
  violate(out, b.rMin > 0 && b.rMin <= b.rMax, `${where}.rMin`, `0 < rMin ≤ rMax 위반: ${b.rMin}/${b.rMax}`);
  violate(out, b.rMax <= 1, `${where}.rMax`, `블롭 반경이 텍스처보다 크다: ${b.rMax}`);
  violate(out, b.pulse >= 0 && b.pulse <= 1, `${where}.pulse`, `[0,1] 밖: ${b.pulse}`);
  // period ≤ 0 이면 bandPulse 가 방어값 1 을 돌려줘 맥동이 조용히 꺼진다.
  violate(out, b.period > 0, `${where}.period`, `맥동 주기가 양수가 아니다(맥동이 조용히 꺼진다): ${b.period}`);
  violate(
    out,
    Number.isFinite(b.driftX) && Number.isFinite(b.driftY),
    `${where}.drift`,
    '드리프트가 유한값이 아니다',
  );
  violate(out, /^#[0-9a-fA-F]{6}$/.test(b.color), `${where}.color`, `#rrggbb 가 아니다: ${b.color}`);
}

/**
 * 시차 테마 검증. **빈 배열이면 통과**.
 *
 * 값의 "좋음"이 아니라 **구조적으로 화면을 깨는 조합**만 잡는다. 여기 들어 있는 것은 전부
 * 카르곤이 4라운드에 걸쳐 실제로 밟았거나, 밟으면 조용히(예외 없이) 화면이 죽는 것들이다.
 */
export function validateParallaxTheme(t: ParallaxTheme): ThemeViolation[] {
  const out: ThemeViolation[] = [];

  violate(out, /^[a-z0-9_]+$/.test(t.themeId), 'themeId', `슬러그가 아니다: ${t.themeId}`);

  for (const [k, v] of [
    ['baseLuma', t.baseLuma],
    ['darkLuma', t.darkLuma],
    ['brightLuma', t.brightLuma],
  ] as const) {
    violate(out, v > 0 && v < 1, k, `상대 휘도가 (0,1) 밖: ${v}`);
  }
  // 세 휘도가 갈라져 있지 않으면 `domain` 축(밝은 곳/어두운 곳 역할 분담)이 의미를 잃는다 —
  // 아래의 에너지 균형 검사가 통째로 항진이 된다.
  violate(out, t.darkLuma < t.baseLuma, 'darkLuma', `암부가 기준보다 어둡지 않다: ${t.darkLuma} ≥ ${t.baseLuma}`);
  violate(
    out,
    t.brightLuma > t.baseLuma,
    'brightLuma',
    `밝은 지형이 기준보다 밝지 않다: ${t.brightLuma} ≤ ${t.baseLuma}`,
  );

  violate(out, t.bands.length > 0, 'bands', '대역이 없으면 레이어가 켜진 채 아무것도 그리지 않는다');
  if (t.bands.length === 0) return out;

  const seen = new Set<string>();
  for (let i = 0; i < t.bands.length; i++) {
    const b = t.bands[i] as BandSpec;
    const where = `bands[${i}](${b.key})`;
    violate(out, b.key.length > 0, `${where}.key`, '대역 이름이 비었다');
    // 캐시 키가 `themeId:key` 라 `:` 가 들어가면 두 대역이 같은 키로 접힐 수 있다.
    violate(out, !b.key.includes(':'), `${where}.key`, `대역 이름에 ':' 금지(캐시 키 구분자): ${b.key}`);
    // 같은 테마 안의 중복 key = 두 대역이 **같은 텍스처를 공유**한다(색이 조용히 틀린다).
    violate(out, !seen.has(b.key), `${where}.key`, `대역 이름 중복(텍스처가 공유된다): ${b.key}`);
    seen.add(b.key);

    // 시차 1 이상이면 지형과 같거나 더 빨리 흘러 "원경"으로 읽히지 않는다.
    violate(out, b.parallax > 0 && b.parallax < 1, `${where}.parallax`, `(0,1) 밖: ${b.parallax}`);
    // 주기가 화면보다 작으면 저주파 변조가 아니라 눈에 보이는 반복 타일 무늬가 된다.
    violate(
      out,
      b.tile > DESIGN_SCREEN_WIDTH,
      `${where}.tile`,
      `주기가 화면(${DESIGN_SCREEN_WIDTH})보다 작다(반복이 보인다): ${b.tile}`,
    );
    checkBandScalars(out, where, b);
    checkFalloff(out, `${where}.falloff`, b.falloff);

    // `normal` 합성의 델타는 `a*(L-base)` 다. 검정 위에서 0 으로 수렴하므로 암부 담당이 될 수 없다.
    violate(
      out,
      b.domain !== 'shadow' || b.blend === 'add',
      `${where}.blend`,
      "domain='shadow' 인데 blend='normal' — 암부에서 델타가 0 으로 수렴한다",
    );
    // `normal` 대역이 암부 바닥보다 밝으면 밝은 곳은 누르고 어두운 곳은 띄우는 부호 뒤집힘이
    // 생겨, 어느 바닥에서도 일하지 않는 죽은 대역이 된다.
    violate(
      out,
      b.blend !== 'normal' || relLuminance(b.color) < t.darkLuma,
      `${where}.color`,
      `normal 대역 색이 암부 바닥보다 밝다(부호가 뒤집힌다): ${relLuminance(b.color).toFixed(3)} ≥ ${t.darkLuma}`,
    );
  }

  // 뒤 → 앞 순서. 시차가 커질수록 가깝고, 가까울수록 주기가 작아야 대기 원근으로 읽힌다.
  // (엄격 증가라 "모든 시차가 서로 다르다" = 상대 운동이 존재한다도 함께 따라온다.)
  for (let i = 1; i < t.bands.length; i++) {
    const p = t.bands[i - 1] as BandSpec;
    const c = t.bands[i] as BandSpec;
    violate(out, c.parallax > p.parallax, `bands[${i}].parallax`, `시차가 오름차순이 아니다: ${p.parallax} → ${c.parallax}`);
    violate(out, c.tile < p.tile, `bands[${i}].tile`, `주기가 내림차순이 아니다: ${p.tile} → ${c.tile}`);
  }

  // 저티어 대역이 하나도 없으면 저사양 사용자에게 레이어가 통째로 사라진다.
  violate(
    out,
    t.bands.some((b) => b.minTier === 'low'),
    'bands.minTier',
    "minTier='low' 대역이 없으면 저티어에서 레이어가 통째로 사라진다",
  );

  /* ── 도메인 에너지 균형: `domain` 이 자료가 아니라 사실이 되게 강제한다 ──
   * 라벨만 붙이고 값이 따라오지 않으면 "네 대역이 전부 밝은 쪽에서만 일하는데 그 사실이
   * 코드 어디에도 드러나지 않는다"는 상태가 그대로 재현된다. */
  const hasShadow = t.bands.some((b) => b.domain === 'shadow');
  const lit = t.bands.filter((b) => b.domain === 'lit');
  if (hasShadow) {
    const shadowAtDark = domainModulationEnergy('shadow', t.darkLuma, t.bands);
    for (const b of lit) {
      violate(
        out,
        shadowAtDark > bandModulationEnergy(b, t.darkLuma),
        'bands.domain',
        `암부에서 lit 대역 '${b.key}' 이 shadow 대역 전체보다 크게 일한다(역할 분담 붕괴)`,
      );
    }
  }
  if (lit.length > 0) {
    violate(
      out,
      domainModulationEnergy('lit', t.brightLuma, t.bands) >
        domainModulationEnergy('shadow', t.brightLuma, t.bands),
      'bands.domain',
      '밝은 바닥에서 shadow 대역이 lit 대역보다 크게 일한다(축이 뒤집혔다)',
    );
  }

  /* ── 가독성: 배경은 전경(함선·탄)보다 밝아지면 안 된다 ── */
  violate(
    out,
    parallaxNetPeakDelta(t.brightLuma, t.bands) < 0,
    'bands',
    '밝은 지형에서 순 델타가 음수가 아니다 — 이 레이어는 밝기를 더하는 레이어가 아니다',
  );
  violate(
    out,
    t.darkLuma + parallaxNetPeakDelta(t.darkLuma, t.bands) < t.brightLuma,
    'bands',
    '모든 대역이 겹친 최악의 경우 암부가 밝은 지형만큼 떠오른다(명도 구조가 무너진다)',
  );

  return out;
}
