/**
 * 대기 레이어 **테마 계약** — 이 파일은 대기 레인이 소유한다.
 *
 * 여기 있어야 하는 것은 행성마다 달라지는 **데이터의 모양**과, 그 데이터가 지켜야 하는
 * **관계 불변식**이다. 메커니즘(기하·합성 순서·해시)은 레이어 구현에 남긴다.
 *
 * ## 이 파일을 채울 때의 규율
 * - 파생값을 필드로 만들지 마라. 다른 필드에서 계산되는 값은 함수로 노출한다.
 * - 알파 상한은 **치환**되는 값이다. 전역 배율 필드를 만들지 마라(곱하면 카르곤 1차 실패가
 *   재현된다 — 보수적 판단이 곱해져 화면 기여가 0 이 된다).
 * - 값 사이의 관계는 주석이 아니라 {@link validateAtmosphereTheme} 에 넣어라. 주석은 다음 레인이 안 읽는다.
 *
 * ## 이 계약이 지키는 것 — 가독성은 자유 데이터가 아니다
 * 대기 입자는 **적탄과 혼동되면 즉시 실패**다. 카르곤은 그 분리를 크기·알파·색·속도 네 축의
 * 배분으로 얻었는데, 그 배분은 값 하나가 아니라 값들의 **비율**로만 존재한다. 테마 필드로
 * 열어두고 주석으로만 적으면 다음 행성이 자유롭게 밀어버린다. 그래서 필드마다 {@link FieldRole}
 * 을 선언하게 하고, 역할별 상한을 {@link validateAtmosphereTheme} 이 강제한다.
 *
 * 렌더 전용(ADR-0005).
 */

import type { ThemeViolation } from '../theme.js';

// ---------------------------------------------------------------------------
// 전경 신호 기준값 — 상한들의 비교 기준. 행성이 바뀌어도 탄은 그대로다.
// ---------------------------------------------------------------------------

/**
 * 탄의 화면 표시 반경(px, design). entityRenderer 는 탄을 `radius * 2 * ART_SCALE`(=1.5) 크기로
 * 그리고 sim 탄 반경은 5~6 이라 표시 반경이 대략 이 값이다. **입자 크기 상한 전부가 이 값의
 * 배수로 표현된다** — 숫자를 직접 적으면 행성마다 갈라진다.
 */
export const BULLET_DISPLAY_RADIUS = 9;

/** sim 틱 레이트(초당). 주기(틱) ↔ 속도(px/s) 환산에만 쓴다. */
export const TICKS_PER_SECOND = 60;

// ---------------------------------------------------------------------------
// 데이터 모양
// ---------------------------------------------------------------------------

/** 8비트 RGB 삼원색. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * 입자 텍스처의 알파 프로파일. `alphaAt(t)` 의 `t` 는 정규화 반경(0=중심, 1=가장자리)이다.
 *
 * **열거형이 아니라 함수인 이유**: 이전 구현은 `'dot' | 'puff'` 로 닫혀 있었고, 종류를 하나
 * 늘리려면 열거형·스위치·텍스처 슬롯 레코드 세 자리를 동시에 고쳐야 했다. 눈송이·포자처럼
 * 행성 고유의 알갱이 모양이 들어오면 그 세 자리가 전부 공용 파일이라 레인이 충돌한다.
 * 프로파일을 테마가 직접 들고 오면 새 모양은 **테마 파일 안에서 끝난다**.
 *
 * `id` 는 구운 텍스처 캐시 키다. 같은 `id` 는 같은 함수여야 한다(검증이 강제한다) — 다르면
 * 먼저 구운 텍스처가 조용히 재사용되어 모양이 하나로 합쳐진다.
 */
export interface TextureProfile {
  readonly id: string;
  alphaAt(t: number): number;
}

/** 0~1 클램프. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 프로파일의 **원판 평균 채움률**(∫₀¹ p(t)·2t dt). 스프라이트의 공칭 면적 `πr²` 중 실제로
 * 칠해지는 비율이며, 화면 기여도 모델의 핵심 계수다. 수치적분이라 프로파일을 바꾸면 자동으로
 * 따라온다 — 상수로 박아두면 프로파일 변경 시 조용히 거짓말이 된다.
 */
export function profileAverageFill(p: TextureProfile, steps = 512): number {
  let s = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    s += p.alphaAt(t) * 2 * t;
  }
  return s / steps;
}

/**
 * **알갱이** 프로파일. `(1−t)²` — 중심이 또렷하고 가장자리가 빠르게 사라진다.
 * 원판 평균 채움률 = ∫₀¹(1−t)²·2t dt = 1/6.
 *
 * 행성 고유의 알갱이(눈송이·포자)가 필요하면 이걸 쓰지 말고 테마 파일 안에서 자기
 * {@link TextureProfile} 을 정의하면 된다 — 공용 파일을 고칠 필요가 없다.
 */
export const DOT_PROFILE: TextureProfile = {
  id: 'dot',
  alphaAt(t: number): number {
    const s = 1 - clamp01(t);
    return s * s;
  },
};

/**
 * **덩어리** 프로파일. `(1−t²)^1.5` — 중심 근처가 넓게 평평하고 가장자리가 부드럽게 죽는다.
 * 원판 평균 채움률 = 0.4.
 *
 * 이 넓은 평탄부가 화면 기여도의 실제 원천이다. 같은 반경·같은 알파라도 알갱이 프로파일 대비
 * 2.4배의 면적을 실제로 칠한다.
 */
export const PUFF_PROFILE: TextureProfile = {
  id: 'puff',
  alphaAt(t: number): number {
    const c = clamp01(t);
    const s = 1 - c * c;
    return s * Math.sqrt(s);
  },
};

/**
 * 필드의 **가독성 역할**. 상한이 여기서 갈린다.
 *
 * - `spark` : 스스로 빛나는(가산) 작은 알갱이. 탄과 가장 혼동되기 쉬워 상한이 가장 좁다.
 * - `mote`  : 배경과 분리되지만 스스로 빛나지 않는(비가산) 작은 알갱이.
 * - `veil`  : 크고 부드러운 덩어리. 탄과 크기가 한 자릿수 이상 달라 형태 혼동이 물리적으로
 *             불가능한 대신, 화면 전체를 덮으므로 **진폭**이 규제 대상이다.
 */
export type FieldRole = 'spark' | 'mote' | 'veil';

/** 티어(=`gates.particles` 3단)별 입자 수. 단조여야 한다(off ≤ min ≤ normal). */
export interface FieldCounts {
  readonly off: number;
  readonly min: number;
  readonly normal: number;
}

/** 입자 필드 1종의 정적 사양. 전부 테마 데이터이며 런타임에 바뀌지 않는다. */
export interface AtmosphereField {
  /** 진단·테스트용 이름. 테마 안에서 유일해야 한다. */
  readonly name: string;
  /**
   * 해시 도메인 분리 키. **테마 안에서 유일해야 한다** — 겹치면 두 필드가 예외 없이, 조용히,
   * 정확히 같은 배치로 겹쳐 그려진다.
   */
  readonly key: number;
  /** 가독성 역할. 역할별 상한은 {@link validateAtmosphereTheme} 참조. */
  readonly role: FieldRole;
  /** 티어별 입자 수. */
  readonly counts: FieldCounts;
  /** true=아래에서 위로, false=위에서 아래로. */
  readonly riseUp: boolean;
  /** 한 수명 주기의 길이(틱). 클수록 느리다. {@link periodTicksForScreenSpeed} 로 뽑을 수 있다. */
  readonly periodTicks: number;
  /** 주기 지터 비율(0~1). 입자마다 주기를 흩어 동기화(줄지어 뜨는 티)를 없앤다. */
  readonly periodJitter: number;
  /** 반경 하한·상한(px, design). */
  readonly minRadius: number;
  readonly maxRadius: number;
  /** 세로/가로 비(1=원, >1=세로로 긴 기둥, <1=납작한 뭉치). */
  readonly aspect: number;
  /** 알파 상한. 실제 알파는 수명 포락선·깜빡임·개체 지터로 항상 이보다 작다. */
  readonly maxAlpha: number;
  /**
   * 세로 이동 대역(필드 높이 비율). 입자는 `[bandStart, bandStart+bandSpan]` **안에서만** 오간다.
   * 전체 화면은 `0, 1`.
   */
  readonly bandStart: number;
  readonly bandSpan: number;
  /** 좌우 흔들림 진폭(px). */
  readonly swayPx: number;
  /** 한 수명 동안의 흔들림 왕복 횟수. */
  readonly swayCycles: number;
  /** 한 수명 동안 가로로 흐르는 화면 폭 배수. 0=흐르지 않음. */
  readonly driftTurns: number;
  /** 카메라 시차 계수(0=화면 완전 고정, 1=월드 고정). 클수록 앞에 있는 느낌. */
  readonly parallax: number;
  /** 색(단색 틴트). */
  readonly tint: number;
  /** 가산 합성 여부. Pixi 의 `tint` 는 곱연산이라 **밝히려면 반드시 가산**이다. */
  readonly additive: boolean;
  /** 깜빡임 세기(0~1). 0 이면 깜빡이지 않는다. */
  readonly flicker: number;
  /** 발광 감소(reducedGlow)에 반응하는 필드인가. 가산 필드는 반드시 true 여야 한다. */
  readonly glowSensitive: boolean;
  /** 이 필드의 알갱이 모양. */
  readonly profile: TextureProfile;
}

/** 대기 레이어의 행성별 데이터. */
export interface AtmosphereTheme {
  /** 소속 테마 슬러그. 텍스처 캐시 키 접두로 쓴다(테마마다 다른 텍스처를 구우므로 필수). */
  readonly themeId: string;
  /**
   * 이 행성 배경의 **대표색**. 기여도 모델(입자가 배경과 얼마나 다른가)의 기준이며, 가산
   * 필드의 화이트아웃 여유도 여기서 잰다.
   *
   * ⚠️ **테마와 함께 반드시 옮겨야 하는 값이다.** 카르곤 1차 화산재 결함은 틴트가 배경과
   * 채널차 6 이라 "보이지 않는 입자를 22개 그리는" 상태였다. 기준을 카르곤 암반색에 고정한
   * 채 흰 눈 행성을 만들면 그 결함이 **색만 뒤집혀 그대로 재현**된다(흰 입자의 차이는 크게
   * 나오는데 실제 흰 배경 위에서는 0 이다).
   */
  readonly referenceBackdrop: Rgb;
  /** 이 행성의 입자 필드들. 배열 순서가 곧 렌더 순서(뒤 → 앞)다. */
  readonly fields: readonly AtmosphereField[];
}

// ---------------------------------------------------------------------------
// 저작 헬퍼 — 테마 파일이 값을 한 곳에만 적게 해 준다.
// ---------------------------------------------------------------------------

/**
 * 필드 하나의 세기 파라미터. 테마 파일이 **세기만 모아둔 표**를 만들고 거기서 필드를 파생시키면,
 * 나중에 타일셋·발광이 바뀌어 재조정할 때 고칠 자리가 한 곳으로 모인다.
 */
export interface FieldTuning {
  /** `gates.particles === 'normal'` 에서의 입자 수. */
  readonly count: number;
  /** min 티어 입자 수(off 는 항상 0). */
  readonly countMin: number;
  /** 반경 하한·상한(px, design). */
  readonly minRadius: number;
  readonly maxRadius: number;
  /** 알파 상한. */
  readonly alpha: number;
}

/** 세기 표 → {@link FieldCounts}. `off` 는 문자 그대로 하나도 안 그린다. */
export function countsFromTuning(t: FieldTuning): FieldCounts {
  return { off: 0, min: t.countMin, normal: t.count };
}

/**
 * "화면 세로 `spanPx` 를 초당 `pxPerSecond` 로 지나는 데 걸리는 틱".
 *
 * 속도는 사람이 판단하는 축(느릴수록 공기처럼 읽힌다)이고 주기는 그 파생값이다. 주기를 직접
 * 적으면 속도가 주석에만 남아 검증할 수 없게 된다.
 */
export function periodTicksForScreenSpeed(pxPerSecond: number, spanPx: number): number {
  return Math.round((spanPx / pxPerSecond) * TICKS_PER_SECOND);
}

// ---------------------------------------------------------------------------
// 파생 지표 — 검증과 기여도 모델이 함께 쓴다.
// ---------------------------------------------------------------------------

/**
 * 필드가 픽셀 하나를 **알파 1 로** 덮었을 때의 RGB 합산 절대차(최대 765 척도).
 *
 * - 가산: 배경에 틴트를 그대로 더하므로 차이 = 틴트 채널합.
 * - 일반: 배경 ↔ 틴트 사이를 보간하므로 차이 = |틴트 − 배경| 채널합.
 *
 * **이 함수가 "보이지 않는 입자" 결함을 잡는 자리다.**
 */
export function fieldDeltaRgbSum(f: AtmosphereField, backdrop: Rgb): number {
  const r = (f.tint >> 16) & 0xff;
  const g = (f.tint >> 8) & 0xff;
  const b = f.tint & 0xff;
  if (f.additive) return r + g + b;
  return Math.abs(r - backdrop.r) + Math.abs(g - backdrop.g) + Math.abs(b - backdrop.b);
}

/** 가산 필드가 배경 채널에 더할 수 있는 **최대 상승량**(0~255). 비가산이면 0. */
export function additiveLift(f: AtmosphereField): number {
  if (!f.additive) return 0;
  const r = (f.tint >> 16) & 0xff;
  const g = (f.tint >> 8) & 0xff;
  const b = f.tint & 0xff;
  return f.maxAlpha * Math.max(r, g, b);
}

/**
 * 가산 필드를 배경 위에 얹었을 때 255 까지 남는 **여유**. 음수면 화이트아웃이다.
 *
 * 이 한 줄이 "밝은 배경에서 흰 입자를 가산으로 그리면 안 된다"를 계산으로 만든다 — 어두운
 * 배경에서 성립하던 조합이 밝은 배경으로 옮겨가는 순간 저절로 위반이 된다.
 */
export function whiteoutHeadroom(f: AtmosphereField, backdrop: Rgb): number {
  const base = Math.max(backdrop.r, backdrop.g, backdrop.b);
  return 255 - (base + additiveLift(f));
}

/** HSV 채도에 해당하는 **채널 스팬**(max − min, 0~255). 무채색이면 0. */
function chromaSpan(color: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** 한 수명 주기가 걸리는 시간(초). */
export function periodSeconds(f: AtmosphereField): number {
  return f.periodTicks / TICKS_PER_SECOND;
}

// ---------------------------------------------------------------------------
// 상한표 — 카르곤이 4라운드에 걸쳐 얻은 배분을 계약으로 고정한다.
// ---------------------------------------------------------------------------

/**
 * 역할별 상한. **새 행성이 자유롭게 밀 수 없어야 하는 값들**이다.
 *
 * 근거는 `.omc/research/kargon-aaa-backdrop-2026-07-29.md`. 요지만 옮기면:
 * 탄은 "좁은 면적 × 최대 진폭 × 최대 속도"라서, 대기가 안전한 유일한 자리는 그 정확한 반대인
 * "넓은 면적 × 낮은 진폭 × 최저 속도"다. 알갱이를 쓰려면 탄보다 **면적으로 한 자릿수** 작고
 * **속도로 두 자릿수 배** 느려야 한다.
 */
export const ATMOSPHERE_LIMITS = {
  /** `spark`·`mote` 가 화면을 가로지르는 데 걸려야 하는 최소 시간(초). 탄은 1초 미만이다. */
  grainMinPeriodSeconds: 20,
  /** `spark`·`mote` 알파 상한. 이보다 낮아야 뒤가 비쳐 "공기 중의 티끌"로 읽힌다. */
  grainMaxAlpha: 0.5,
  /** `spark` 최대 반경 ÷ 탄 표시 반경의 **면적비** 상한. */
  sparkMaxAreaRatio: 0.25,
  /** `spark` 개수 상한. 개수는 탄막과 직접 경쟁하는 유일한 축이라 별도로 묶는다. */
  sparkMaxCount: 30,
  /** `spark` 틴트의 최소 채널 스팬. 무채색 밝은 알갱이는 탄의 흰 코어 신호가 된다. */
  sparkMinChroma: 60,
  /** `mote` 최대 반경 ÷ 탄 표시 반경 상한. */
  moteMaxRadiusRatio: 1 / 1.7,
  /** `veil` 최소 반경 ÷ 탄 표시 반경 하한(형태 혼동 불가 스케일). */
  veilMinRadiusRatio: 5,
  /** **비가산** `veil` 의 최소 반경 비. 탄이 걸치는 구간에서 농도가 상수여야 국소 대비가 산다. */
  opaqueVeilMinRadiusRatio: 10,
  /** 비가산 `veil` 알파 상한. 넘으면 균일한 베일이 되어 가독성을 죽인다. */
  opaqueVeilMaxAlpha: 0.3,
  /** 가산 `veil` 알파 상한. 면적이 넓어 같은 알파라도 화면 전체를 들어올린다. */
  additiveVeilMaxAlpha: 0.2,
  /** 가산 `veil` 이 남겨야 하는 화이트아웃 여유. */
  additiveVeilMinHeadroom: 100,
  /** 어느 필드든 배경과 이만큼은 달라야 한다(RGB 합산 절대차, 최대 765 척도). */
  minDeltaRgbSum: 100,
  /** 전 필드 normal 입자 수의 총합 상한(탄막 혼동·비용). */
  maxTotalCount: 80,
} as const;

// ---------------------------------------------------------------------------
// 검증
// ---------------------------------------------------------------------------

function push(out: ThemeViolation[], cond: boolean, where: string, message: string): void {
  if (!cond) out.push({ where, message });
}

/** 프로파일이 "중심 불투명 → 가장자리 소멸, 단조 감소"인지. */
function validateProfile(out: ThemeViolation[], where: string, p: TextureProfile): void {
  push(out, p.id.length > 0, `${where}.id`, '프로파일 id 가 비었다(텍스처 캐시 키다)');
  const at0 = p.alphaAt(0);
  const at1 = p.alphaAt(1);
  push(
    out,
    Math.abs(at0 - 1) < 1e-6,
    `${where}.alphaAt(0)`,
    `중심이 불투명하지 않다(${at0}). 스프라이트 alpha 가 곧 화면 최대 불투명도여야 한다 — ` +
      '링 합성 결과가 1 에 못 미치면 주석의 알파와 화면의 알파가 어긋난다',
  );
  push(out, Math.abs(at1) < 1e-6, `${where}.alphaAt(1)`, `가장자리가 0 이 아니다(${at1}) — 하드 엣지`);
  let prev = Infinity;
  let monotone = true;
  for (let i = 0; i <= 32; i++) {
    const v = p.alphaAt(i / 32);
    if (!Number.isFinite(v) || v < 0 || v > 1 || v > prev + 1e-9) monotone = false;
    prev = v;
  }
  push(out, monotone, `${where}.alphaAt`, '중심 → 가장자리로 단조 감소하는 [0,1] 값이 아니다(링이 보인다)');
}

/**
 * 대기 테마 검증. **빈 배열이면 통과**다(던지지 않는다).
 *
 * 값의 "좋음"이 아니라 **구조적으로 화면을 깨는 조합**만 잡는다. 여기 있는 것은 전부 카르곤이
 * 실제로 밟았거나(보이지 않는 입자·중심 알파 0.61·해시 키 충돌) 다음 행성이 반드시 밟을
 * 것(밝은 배경 위 가산 흰 입자)이다.
 */
export function validateAtmosphereTheme(t: AtmosphereTheme): ThemeViolation[] {
  const out: ThemeViolation[] = [];
  push(out, t.themeId.length > 0, 'themeId', '테마 슬러그가 비었다');

  const bd = t.referenceBackdrop;
  for (const [ch, v] of [
    ['r', bd.r],
    ['g', bd.g],
    ['b', bd.b],
  ] as const) {
    push(
      out,
      Number.isFinite(v) && v >= 0 && v <= 255,
      `referenceBackdrop.${ch}`,
      `8비트 채널 범위 밖: ${v}`,
    );
  }

  push(out, t.fields.length > 0, 'fields', '필드가 하나도 없는 대기는 레이어가 있으나 마나다');

  const seenKeys = new Map<number, string>();
  const seenNames = new Set<string>();
  const profileById = new Map<string, TextureProfile>();
  let totalCount = 0;

  for (const f of t.fields) {
    const w = `fields.${f.name}`;

    // ── 유일성 ──────────────────────────────────────────────────────────────
    const dup = seenKeys.get(f.key);
    push(
      out,
      dup === undefined,
      `${w}.key`,
      `해시 도메인 키 0x${f.key.toString(16)} 가 '${dup}' 와 겹친다 — 두 필드가 예외 없이 ` +
        '정확히 같은 배치로 겹쳐 그려진다',
    );
    seenKeys.set(f.key, f.name);
    push(out, !seenNames.has(f.name), `${w}.name`, `필드 이름이 중복이다: ${f.name}`);
    seenNames.add(f.name);

    // ── 구조 ────────────────────────────────────────────────────────────────
    push(out, f.counts.off === 0, `${w}.counts.off`, "'off' 는 문자 그대로 하나도 안 그려야 한다");
    push(
      out,
      f.counts.off <= f.counts.min && f.counts.min <= f.counts.normal,
      `${w}.counts`,
      `티어 입자 수가 단조가 아니다: ${f.counts.off}/${f.counts.min}/${f.counts.normal}`,
    );
    push(
      out,
      f.counts.min > 0 && f.counts.normal > 0,
      `${w}.counts`,
      '저티어에서 0 이 되는 필드는 저사양에서 화면 기여가 통째로 사라진다',
    );
    totalCount += f.counts.normal;

    push(
      out,
      f.minRadius > 0 && f.minRadius <= f.maxRadius,
      `${w}.minRadius`,
      `반경 하한/상한이 뒤집혔거나 0 이하: ${f.minRadius}/${f.maxRadius}`,
    );
    push(out, f.aspect > 0, `${w}.aspect`, `세로/가로 비가 0 이하: ${f.aspect}`);
    push(out, f.maxAlpha > 0 && f.maxAlpha <= 1, `${w}.maxAlpha`, `(0,1] 밖: ${f.maxAlpha}`);
    push(out, f.periodTicks >= 1, `${w}.periodTicks`, `주기가 1틱 미만: ${f.periodTicks}`);
    push(
      out,
      f.periodJitter >= 0 && f.periodJitter < 1,
      `${w}.periodJitter`,
      `[0,1) 밖: ${f.periodJitter} — 1 이면 주기가 0 이 되는 입자가 생긴다`,
    );
    push(out, f.parallax >= 0 && f.parallax <= 1, `${w}.parallax`, `[0,1] 밖: ${f.parallax}`);
    push(out, f.flicker >= 0 && f.flicker <= 1, `${w}.flicker`, `[0,1] 밖: ${f.flicker}`);
    push(out, f.driftTurns >= 0, `${w}.driftTurns`, `음수 흐름: ${f.driftTurns}`);
    push(
      out,
      f.bandStart >= 0 && f.bandSpan > 0 && f.bandStart + f.bandSpan <= 1 + 1e-9,
      `${w}.bandSpan`,
      `세로 대역이 [0,1] 을 벗어난다: ${f.bandStart}+${f.bandSpan}`,
    );

    // ── 합성 ────────────────────────────────────────────────────────────────
    // Pixi tint 는 곱연산이라 밝히려면 가산이 필수인데, 가산은 밝기 감소 설정을 반드시
    // 따라야 한다. 한쪽만 켜면 reducedGlow 사용자가 눈부신 화면을 계속 본다.
    push(
      out,
      !f.additive || f.glowSensitive,
      `${w}.glowSensitive`,
      '가산 필드는 발광 감소(reducedGlow)에 반드시 반응해야 한다',
    );
    push(
      out,
      whiteoutHeadroom(f, bd) >= 0,
      `${w}.tint`,
      `가산 합성이 배경을 화이트아웃시킨다(여유 ${whiteoutHeadroom(f, bd).toFixed(1)}). ` +
        '밝은 배경 위의 밝은 입자는 가산이 아니라 일반 합성이어야 한다',
    );

    // ── 가시성 ──────────────────────────────────────────────────────────────
    const delta = fieldDeltaRgbSum(f, bd);
    push(
      out,
      delta > ATMOSPHERE_LIMITS.minDeltaRgbSum,
      `${w}.tint`,
      `배경과 구분되지 않는다(RGB 합산 절대차 ${delta.toFixed(0)}) — 보이지 않는 입자를 ` +
        `${f.counts.normal}개 그리게 된다`,
    );

    validateProfile(out, `${w}.profile`, f.profile);
    const prior = profileById.get(f.profile.id);
    if (prior !== undefined && prior !== f.profile) {
      let same = true;
      for (let i = 0; i <= 16; i++) {
        const x = i / 16;
        if (Math.abs(prior.alphaAt(x) - f.profile.alphaAt(x)) > 1e-9) same = false;
      }
      push(
        out,
        same,
        `${w}.profile.id`,
        `같은 id('${f.profile.id}')로 다른 모양을 쓴다 — 먼저 구운 텍스처가 조용히 재사용된다`,
      );
    }
    profileById.set(f.profile.id, f.profile);

    // ── 가독성(역할별 상한) ────────────────────────────────────────────────
    const L = ATMOSPHERE_LIMITS;
    if (f.role === 'spark' || f.role === 'mote') {
      push(
        out,
        periodSeconds(f) > L.grainMinPeriodSeconds,
        `${w}.periodTicks`,
        `알갱이가 화면을 ${periodSeconds(f).toFixed(1)}초에 지난다 — 탄(1초 미만)과의 속도차가 ` +
          `대기의 가장 강한 분리축이라 ${L.grainMinPeriodSeconds}초를 넘겨야 한다`,
      );
      push(
        out,
        f.maxAlpha <= L.grainMaxAlpha,
        `${w}.maxAlpha`,
        `알갱이 알파 상한 ${L.grainMaxAlpha} 초과(${f.maxAlpha}) — 뒤가 비쳐야 "표면의 ` +
          '오브젝트"가 아니라 "공기 중의 티끌"로 읽힌다',
      );
    }
    if (f.role === 'spark') {
      const areaRatio = (f.maxRadius / BULLET_DISPLAY_RADIUS) ** 2;
      push(
        out,
        f.additive,
        `${w}.additive`,
        "spark 은 스스로 빛나는 알갱이다. 가산이 아니면 'mote' 다",
      );
      push(
        out,
        areaRatio < L.sparkMaxAreaRatio,
        `${w}.maxRadius`,
        `탄 대비 면적비 ${areaRatio.toFixed(3)} — ${L.sparkMaxAreaRatio} 미만이어야 "점 vs 탄" 이 ` +
          '한눈에 갈린다',
      );
      push(
        out,
        f.counts.normal <= L.sparkMaxCount,
        `${w}.counts.normal`,
        `개수 ${f.counts.normal} — 개수는 탄막과 직접 경쟁하는 유일한 축이라 ${L.sparkMaxCount} 이하로 묶는다`,
      );
      push(
        out,
        chromaSpan(f.tint) >= L.sparkMinChroma,
        `${w}.tint`,
        `채널 스팬 ${chromaSpan(f.tint)} — 무채색에 가까운 밝은 알갱이는 탄의 흰 코어 신호가 된다`,
      );
    }
    if (f.role === 'mote') {
      push(
        out,
        !f.additive,
        `${w}.additive`,
        "mote 는 스스로 빛나지 않는 알갱이다. 가산이면 'spark' 로 선언하고 그 상한을 받아라",
      );
      push(
        out,
        f.maxRadius < BULLET_DISPLAY_RADIUS * L.moteMaxRadiusRatio,
        `${w}.maxRadius`,
        `${f.maxRadius}px — 탄 표시 반경(${BULLET_DISPLAY_RADIUS})의 ${L.moteMaxRadiusRatio.toFixed(2)}배 미만이어야 한다`,
      );
    }
    if (f.role === 'veil') {
      push(
        out,
        f.minRadius >= BULLET_DISPLAY_RADIUS * L.veilMinRadiusRatio,
        `${w}.minRadius`,
        `${f.minRadius}px — 덩어리는 탄 표시 반경의 ${L.veilMinRadiusRatio}배 이상이어야 형태 혼동이 ` +
          '물리적으로 불가능하다',
      );
      if (f.additive) {
        push(
          out,
          f.maxAlpha <= L.additiveVeilMaxAlpha,
          `${w}.maxAlpha`,
          `가산 덩어리 알파 ${f.maxAlpha} — 면적이 넓어 ${L.additiveVeilMaxAlpha} 를 넘으면 ` +
            '"화면이 밝아진다"로 읽힌다',
        );
        push(
          out,
          whiteoutHeadroom(f, bd) >= L.additiveVeilMinHeadroom,
          `${w}.tint`,
          `가산 덩어리의 화이트아웃 여유가 ${whiteoutHeadroom(f, bd).toFixed(0)} 뿐이다 ` +
            `(${L.additiveVeilMinHeadroom} 필요) — 넓은 면적이 화면 전체를 들어올린다`,
        );
      } else {
        push(
          out,
          f.minRadius > BULLET_DISPLAY_RADIUS * L.opaqueVeilMinRadiusRatio,
          `${w}.minRadius`,
          `${f.minRadius}px — 비가산 베일은 탄이 걸치는 구간에서 농도가 사실상 상수여야 국소 ` +
            `대비가 보존된다(탄 반경의 ${L.opaqueVeilMinRadiusRatio}배 초과)`,
        );
        push(
          out,
          f.maxAlpha <= L.opaqueVeilMaxAlpha,
          `${w}.maxAlpha`,
          `비가산 베일 알파 ${f.maxAlpha} — ${L.opaqueVeilMaxAlpha} 를 넘으면 균일한 안개가 된다`,
        );
      }
    }
  }

  push(
    out,
    totalCount <= ATMOSPHERE_LIMITS.maxTotalCount,
    'fields',
    `normal 입자 총합 ${totalCount} — ${ATMOSPHERE_LIMITS.maxTotalCount} 이하여야 전경을 덮지 않는다`,
  );
  return out;
}
