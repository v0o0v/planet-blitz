/**
 * 데칼 레이어 **테마 계약** — 이 파일은 데칼 레인이 소유한다.
 *
 * 여기 있는 것은 셋이다:
 *  1. 행성마다 달라지는 **데이터의 모양**({@link DecalTheme}).
 *  2. 그 데이터가 만족해야 하는 **메커니즘 쪽 대역**(실루엣 슬롯 스키마 · 변형 표 · 상·하한).
 *  3. 둘 사이의 **관계 불변식**을 실제로 검사하는 {@link validateDecalTheme}.
 *
 * ## 왜 메커니즘 상수가 여기 있는가
 * "부조 발자국이 200~400px 대역 안이어야 한다" 같은 불변식은 테마 값(`r`·`elong`)과 메커니즘 값
 * (`RELIEF_WOBBLE`·변형 표의 sizeMul)의 **산술 관계**다. 한쪽만 있으면 검사할 수 없다. 그래서
 * 관계에 참여하는 메커니즘 상수는 계약이 들고, 레이어 구현이 계약에서 import 한다
 * (반대 방향으로 두면 `theme.ts → contracts → decals → themes → theme.ts` 순환이 생긴다).
 *
 * ## 이 파일의 규율
 * - 파생값을 필드로 만들지 마라. 다른 필드에서 계산되는 값은 함수로 노출한다.
 * - 알파 상한은 **치환**되는 값이다. 전역 배율 필드를 만들지 마라(곱하면 카르곤 1차 실패가
 *   재현된다 — 보수적 판단이 곱해져 화면 기여가 0 이 된다).
 * - 값 사이의 관계는 주석이 아니라 {@link validateDecalTheme} 에 넣어라. 주석은 다음 레인이 안 읽는다.
 *
 * 렌더 전용(ADR-0005).
 */

import { DISPLAY_TILE } from '../../autotile.js';
import type { ThemeViolation } from '../theme.js';
import { violate } from '../theme.js';

// ─────────────────────────────────────────────────────────────────────────────
// 실루엣 — 그리기 분기의 축이자 **색 슬롯 스키마의 정의처**
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **실루엣 축.** 각 값은 레이어 구현의 서로 다른 그리기 분기이며, 전부 순수 기하 프리미티브
 * 조합이라 **행성 무관**이다(카르곤 전용 기하는 0종이다). 화산 어휘의 kind 이름은 테마가 정하고,
 * 여기 있는 것은 "어떤 형태로 그리는가"뿐이다.
 *
 *  - `flow`     : 테이퍼 비드 체인 — 머리가 굵고 꼬리로 가늘어지는 방향성 자국.
 *  - `splatter` : 중심 덩어리 + 한쪽으로 튄 위성 방울.
 *  - `crack`    : 지그재그 이중선(겉선 + 1텍셀 코어). 서릿발·뿌리·전선 균열에 그대로 쓰인다.
 *  - `cluster`  : 산포 파편 무더기.
 *  - `ring`     : 동심 링(테두리 밴드가 있는 함몰).
 *  - `haze`     : 반경 감쇠 blob. **유일하게 배율 > 1 이 허용되는 실루엣.**
 *  - `boulder`  : 덩어리 + 위성 파편.
 *  - `ridge`    : 구슬 사슬(가운데가 두껍고 양끝으로 가늘어진다).
 *  - `mound`    : 적층(낮게 퍼진 층상 더미).
 */
export type Silhouette =
  | 'flow'
  | 'splatter'
  | 'crack'
  | 'cluster'
  | 'ring'
  | 'haze'
  | 'boulder'
  | 'ridge'
  | 'mound';

/**
 * 실루엣 하나의 메커니즘 사양. **`slots` 가 이 계약의 핵심**이다 — 그리기 분기가 색을 팔레트
 * 이름으로 직접 참조하면(`FILL.rockShade`) 그 분기는 영원히 그 행성 것이 된다. 대신 분기는
 * `slots[i]` 만 읽고, `slots` 의 **의미론적 역할**을 여기서 선언한다. 그러면 12개 kind 가
 * 테마 데이터 테이블의 행이 되고, 다른 행성은 색만 채우면 된다.
 */
export interface SilhouetteSpec {
  /** 슬롯의 의미론적 역할(순서 = 인덱스). 길이가 곧 이 실루엣이 요구하는 슬롯 수다. */
  readonly slots: readonly string[];
  /**
   * 칠해진 면적을 지배하는 슬롯. 세기 예측 모델이 대표 배수색으로 쓴다. **어느 슬롯이 면적을
   * 지배하는지는 그리기 분기의 성질**이지 행성의 선택이 아니다(예: 링은 안쪽 바닥이, 균열은
   * 코어 선이 지배한다) — 그래서 테마 필드가 아니라 여기 있다.
   */
  readonly inkSlot: number;
  /** 배율 > 1 을 허용하는가(경계가 없어 텍셀 크기 차이가 드러나지 않는 실루엣만). */
  readonly scalable: boolean;
  /** 부조(암부 랜드마크) 계열인가 — 하이라이트 텍스처·좁은 크기 대역·지형 게이트의 대상. */
  readonly relief: boolean;
}

/** 실루엣 → 슬롯 스키마. 새 실루엣을 더하면 여기와 그리기 분기를 함께 늘린다. */
export const SILHOUETTE_SPEC: Readonly<Record<Silhouette, SilhouetteSpec>> = {
  flow: { slots: ['본체', '심', '코어'], inkSlot: 0, scalable: false, relief: false },
  splatter: { slots: ['본체', '방울'], inkSlot: 0, scalable: false, relief: false },
  crack: { slots: ['겉선', '코어'], inkSlot: 1, scalable: false, relief: false },
  cluster: { slots: ['파편', '어두운 파편'], inkSlot: 0, scalable: false, relief: false },
  ring: { slots: ['림', '바닥', '심연'], inkSlot: 1, scalable: false, relief: false },
  haze: { slots: ['본체'], inkSlot: 0, scalable: true, relief: false },
  boulder: { slots: ['본체', '그늘'], inkSlot: 0, scalable: false, relief: true },
  ridge: { slots: ['본체', '그늘'], inkSlot: 0, scalable: false, relief: true },
  mound: { slots: ['본체', '그늘'], inkSlot: 0, scalable: false, relief: true },
};

/** 배율 > 1 을 허용하는 실루엣 집합(파생값 — 저장하지 마라). */
export const SCALABLE_SILHOUETTES: ReadonlySet<Silhouette> = new Set(
  (Object.keys(SILHOUETTE_SPEC) as Silhouette[]).filter((s) => SILHOUETTE_SPEC[s].scalable),
);

/** 부조 실루엣 집합(파생값 — 저장하지 마라). */
export const RELIEF_SILHOUETTES: ReadonlySet<Silhouette> = new Set(
  (Object.keys(SILHOUETTE_SPEC) as Silhouette[]).filter((s) => SILHOUETTE_SPEC[s].relief),
);

// ─────────────────────────────────────────────────────────────────────────────
// 변형 표 — 메커니즘(각도·크기 배수는 행성 무관)
// ─────────────────────────────────────────────────────────────────────────────

/** 한 변형이 텍스처에 굽는 크기 배수와 **회전각**. */
export interface VariantSpec {
  readonly sizeMul: number;
  /** 굽는 시점에 기하에 적용되는 각도(rad). 런타임 회전은 하지 않는다 — 픽셀 격자 보존. */
  readonly angle: number;
}

/**
 * 변형 표. 각도를 0~π 에 흩고 좌우반전과 곱해 **겉보기 방향 12종**을 만든다(π~2π 는 반전이
 * 덮는다). 크기 배수는 2배 이상 벌려 "전부 같은 크기"로 보이지 않게 한다.
 *
 * 각도를 균등 간격으로 두지 않은 이유: 균등하면 여러 데칼이 같은 각도 계열로 정렬돼 보인다.
 */
export const VARIANT_SPEC: readonly VariantSpec[] = [
  { sizeMul: 1.0, angle: 0 },
  { sizeMul: 0.72, angle: 0.61 },
  { sizeMul: 1.28, angle: 1.31 },
  { sizeMul: 0.88, angle: 2.05 },
  { sizeMul: 1.45, angle: 2.62 },
  { sizeMul: 0.66, angle: 3.02 },
];

/**
 * **부조 전용 변형 표.** 각도는 {@link VARIANT_SPEC} 과 **일부러 다르게** 잡았다 — 같은 각도 표를
 * 쓰면 큰 실루엣과 잔 데칼이 같은 방향 계열로 정렬돼 화면에 격자감이 되돌아온다.
 *
 * 크기 배수 대역이 좁은(0.86~1.34, 1.56배) 이유는 순수하게 산술이다. 부조 발자국은
 * {@link RELIEF_MIN_SPAN}~{@link RELIEF_MAX_SPAN} 안에 있어야 하고 각진 다각형의 흔들림
 * ±{@link RELIEF_WOBBLE} 이 양끝에서 대역을 더 먹으므로 허용 배수비는
 * `(400/200) × (1−wob)/(1+wob) ≈ 1.70` 이 상한이다. 일반 표의 2.2배를 쓰면 대역 밖으로 샌다.
 * **이 산술은 주석이 아니라 {@link validateDecalTheme} 이 실제로 검사한다.**
 */
export const RELIEF_VARIANT_SPEC: readonly VariantSpec[] = [
  { sizeMul: 1.12, angle: 0.18 },
  { sizeMul: 0.86, angle: 0.79 },
  { sizeMul: 1.34, angle: 1.44 },
  { sizeMul: 0.98, angle: 2.11 },
  { sizeMul: 1.24, angle: 2.55 },
  { sizeMul: 0.9, angle: 2.95 },
];

/** 종류별로 굽는 모양 변형 수. 두 표의 길이는 **같아야 한다**(변형 인덱스가 공용 축이다). */
export const VARIANTS = VARIANT_SPEC.length;

/** 겉보기 방향 종류 수(변형 각도 × 좌우반전). */
export const ORIENTATIONS = VARIANTS * 2;

// ─────────────────────────────────────────────────────────────────────────────
// 메커니즘 대역 — 테마 값이 넘으면 화면이 구조적으로 깨지는 선
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 배수 채널의 **하한**. 이 아래로 내려가면 데칼이 "지면의 얼룩"이 아니라 **검은 구멍**이 되어
 * 그 자리의 지형 정보가 통째로 사라진다(적·탄이 그 위에 있으면 대비가 무너진다).
 */
export const MIN_MULTIPLIER_CHANNEL = 0x28;

/**
 * 배수 채널의 **상한**. 이 위로 가면 곱해도 거의 변화가 없어 "안 보이는 데칼"이 된다.
 * 0xd2 ≈ 0.82 → 알파 1에서 최소 18% 는 어둡게 만든다.
 */
export const MAX_MULTIPLIER_CHANNEL = 0xd2;

/**
 * 배수 팔레트의 크로마 상한. 배수의 채널 편차가 크면 바닥의 색상이 통째로 밀려 "지형 얼룩"이
 * 아니라 **색 필터**로 읽힌다. 행성이 팔레트를 갈아도 이 성질은 유지돼야 한다.
 */
export const MAX_MULTIPLIER_CHROMA = 60;

/**
 * 알파 상한의 절대 상한. 이 위로 가면 데칼이 "지형의 얼룩"이 아니라 "화면 위의 물체"로 읽혀
 * 아이템·적과 경합한다.
 */
export const MAX_DECAL_ALPHA = 0.6;

/**
 * **가산 하이라이트 알파의 절대 상한.** 곱연산 상한({@link MAX_DECAL_ALPHA})의 1/3 이다.
 * 가산은 화면을 밝히므로 적·탄·아이템의 대비 예산을 직접 갉아먹는다.
 */
export const MAX_HIGHLIGHT_ALPHA = 0.2;

/**
 * 한 하이라이트 텍셀이 배경에 더할 수 있는 R+G+B 최대 증가분.
 * 암부(합 ≈ 90) 위에서 +40 은 국소 대비 45% 라 모서리가 확실히 읽힌다.
 */
export const MAX_ADDITIVE_LUMA_GAIN = 60;

/** 부조 발자국 지름의 목표 대역(design px). */
export const RELIEF_MIN_SPAN = 200;
export const RELIEF_MAX_SPAN = 400;

/** 부조 다각형의 반경 흔들림. 대역 산술의 입력이다. */
export const RELIEF_WOBBLE = 0.08;

/** 색의 R+G+B 합(0~765). */
export function lumaSum(color: number): number {
  return ((color >> 16) & 0xff) + ((color >> 8) & 0xff) + (color & 0xff);
}

/**
 * 곱연산 배수 색이 만드는 **상대 어둡기**(0 = 변화 없음, 1 = 완전 검정).
 * 알파 1에서의 값이며, 실제 감쇠는 여기에 스프라이트 alpha 가 곱해진다.
 */
export function darkening(fill: number): number {
  return 1 - lumaSum(fill) / 765;
}

// ─────────────────────────────────────────────────────────────────────────────
// 테마 데이터
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 존재 판정에 거는 **지형 조건**. 리터럴 `'lower'` 였을 때는 "하부 지형 = 어둡다"는 카르곤
 * 타일셋 전제가 게이트 이름 안에 숨어 있었다 — 밝은 눈밭이 하부인 행성에서는 의미가 뒤집힌다.
 * 그래서 테마는 타일 대역이 아니라 **원하는 성질**을 선언한다.
 *
 * 판정 자체는 `autotile` 의 `terrainFieldAt`/`UPPER_THRESHOLD` 를 **import** 해서 하고 값을
 * 복제하지 않는다(복제로 위상을 잃은 전례가 있다).
 */
export type SiteGate = 'darkTerrain' | 'brightTerrain';

/** 부조가 쓰는 가산 하이라이트 팔레트. **{@link DecalKindSpec.slots} 와 의미가 다르다** —
 * 곱할 배수가 아니라 **더할 빛**이라 배수 상·하한이 적용되지 않고 광량 상한이 적용된다. */
export interface DecalGlowPalette {
  /** 광원을 향한 모서리(2텍셀). 이 레이어에서 유일하게 또렷하게 밝은 것. */
  readonly rim: number;
  /** 광원을 향한 면의 아주 옅은 워시. 넓게 깔리므로 색 자체를 어둡게 잡는다. */
  readonly face: number;
}

/** `haze` 실루엣의 부드러움. 생략하면 메커니즘 기본값을 쓴다. */
export interface SoftBlobSpec {
  readonly rings: number;
  readonly ringAlpha: number;
  readonly wobble: number;
}

/**
 * 데칼 한 종류. **12개 kind 는 이 테이블의 행이다** — 실루엣(메커니즘 분기)과 색 슬롯(테마 값)의
 * 조합이며, kind 이름 자체가 행성 어휘다("flow/crater/ash/soot"는 화산, 다른 행성은 다른 이름).
 */
export interface DecalKindSpec {
  /** 이 테마 안에서 유일한 식별자. 격자의 후보 배열이 이 이름을 참조한다. */
  readonly id: string;
  /** 그리기 분기. 슬롯의 개수와 의미가 여기서 정해진다({@link SILHOUETTE_SPEC}). */
  readonly silhouette: Silhouette;
  /** 텍스처 기준 반경(design px, sizeMul 1 기준). */
  readonly r: number;
  /** 긴 축 늘림. */
  readonly elong: number;
  /** 발자국 타원 중 실제로 칠해지는 면적 비율(0~1). */
  readonly coverage: number;
  /** 칠해진 곳의 평균 불투명도(0~1). */
  readonly opacity: number;
  /**
   * **곱할 배수 색 슬롯.** 0xffffff = 변화 없음, 0x000000 = 완전 검정. 순서와 의미는
   * `SILHOUETTE_SPEC[silhouette].slots` 가 정하고, 길이가 다르면 검증이 잡는다.
   */
  readonly slots: readonly number[];
  /** `haze` 전용 부드러움. 다른 실루엣에서는 무시된다. */
  readonly soft?: SoftBlobSpec;
}

/**
 * 한 산포 격자의 사양. 셀 크기·후보 종류·밀도·배율/알파 대역·해시 소금을 묶는다.
 * `salt` 는 격자끼리 같은 셀 좌표에서 같은 난수를 뽑지 않게 하는 축 분리자다.
 */
export interface GridSpec {
  /**
   * 셀 한 변(월드 px). **타일 크기 및 다른 격자와 서로소여야 한다** — 공명하면 "반복되는 격자
   * 위에 반복되는 얼룩"이 하나 더 얹혀 오히려 나빠진다. 검증이 강제한다.
   */
  readonly cell: number;
  /**
   * 이 격자가 뽑는 데칼 종류 후보(테마 kind 의 `id`). **같은 값을 여러 번 넣으면 그만큼 자주
   * 뽑힌다**(가중치) — 밀도 상한을 건드리지 않고 비중을 조정하는 손잡이다.
   */
  readonly kinds: readonly string[];
  /** 셀당 데칼 존재 확률(티어 배율 적용 전). */
  readonly density: number;
  /** 배율 대역 — **정수만** 허용한다(텍셀 크기 = 지형 픽셀 × 배율). */
  readonly minScale: number;
  readonly maxScale: number;
  readonly minAlpha: number;
  readonly maxAlpha: number;
  /** 해시 축 분리자(격자마다 달라야 한다). */
  readonly salt: number;
  /** 존재 판정에 거는 지형 조건. 발자국 검사점을 전부 통과해야 남는다. */
  readonly siteGate?: SiteGate;
  /**
   * 가산 하이라이트 알파 대역. 있으면 배치마다 스프라이트가 **두 장**(곱연산 그림자 + 가산
   * 하이라이트) 나간다. 이 필드의 **유무 자체가 테마 결정**이다 — 곱연산은 암부에서 구조적으로
   * 아무 일도 못 하므로 명암 이원성이 극단적인 행성에만 필요하고, 밝은 설원이면 가산이
   * 화면을 뭉갠다.
   */
  readonly highlight?: { readonly minAlpha: number; readonly maxAlpha: number };
  /**
   * 좌우반전 금지. 하이라이트를 쓰는 격자는 **반드시 참**이어야 한다 — 반전은 광원의 x 성분을
   * 거울로 뒤집어 화면에 두 개의 광원을 만든다. 검증이 강제한다.
   */
  readonly noFlip?: boolean;
  /**
   * 티어 밀도 배율의 하한. 랜드마크는 저티어에서도 사라지면 안 된다 — 몇 개뿐이라 솎으면
   * 화면에서 아예 없어지고, 그러면 티어에 따라 **구도가 달라진다**.
   */
  readonly minDensityScale?: number;
}

/** 데칼 레이어의 행성별 데이터. */
export interface DecalTheme {
  /** 소속 테마 슬러그. 텍스처 캐시 키 접두로 쓴다(테마마다 다른 텍스처를 구우므로 필수). */
  readonly themeId: string;
  /**
   * Wang 타일 원본 한 변(px). 지형 픽셀 크기·베이크 해상도·스냅 격자가 전부 여기서 파생된다
   * (`DISPLAY_TILE / sourceTilePx`). 타일셋 원본 크기가 바뀌면 여기만 고친다.
   */
  readonly sourceTilePx: number;
  /**
   * 바닥 타일의 대표 밝기, R+G+B 합(0~765). 곱연산에서 데칼이 만드는 화면 차이는
   * `바닥 밝기 × α × (1 − 배수)` 에 비례하므로 세기 예측의 기준점이다.
   * **타일셋 교체 시 갱신 대상 1순위.**
   */
  readonly floorLumaSum: number;
  /**
   * **암부**의 대표 밝기. 부조는 정의상 암부에만 놓이므로 화면 평균으로 재면 부풀려진다.
   */
  readonly darkFloorLumaSum: number;
  /** 접지 음영 색(모든 또렷한 실루엣의 바깥 테두리·부조의 드롭 섀도). 팔레트에서 가장 진하다. */
  readonly ground: number;
  /** 틴트 팔레트. 곱연산 위에 한 번 더 곱해지므로 **더 어둡게만** 만든다. */
  readonly tints: readonly number[];
  /** 가산 하이라이트 팔레트. 하이라이트를 쓰는 격자가 하나라도 있으면 필수. */
  readonly glow?: DecalGlowPalette;
  /** 종류 테이블. `ALL_KINDS` 는 여기서 파생된다(수동 중복 금지). */
  readonly kinds: readonly DecalKindSpec[];
  /** 산포 격자(뒤 → 앞 순서 그대로 그려진다). */
  readonly grids: readonly GridSpec[];
}

/** 종류 이름 전부(파생값 — 저장하지 마라). */
export function allKinds(t: DecalTheme): readonly string[] {
  return t.kinds.map((k) => k.id);
}

/** 이름 → 종류 사양. 없으면 `undefined`. */
export function kindSpec(t: DecalTheme, id: string): DecalKindSpec | undefined {
  for (const k of t.kinds) if (k.id === id) return k;
  return undefined;
}

/**
 * 세기 예측 모델이 쓰는 대표 배수 색(파생값). 어느 슬롯이 면적을 지배하는지는 그리기 분기의
 * 성질이므로 {@link SILHOUETTE_SPEC} 이 정한다 — 테마가 따로 적으면 갈라진다.
 */
export function inkFill(k: DecalKindSpec): number {
  return k.slots[SILHOUETTE_SPEC[k.silhouette].inkSlot] ?? (k.slots[0] ?? 0xffffff);
}

// ─────────────────────────────────────────────────────────────────────────────
// 검증
// ─────────────────────────────────────────────────────────────────────────────

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function chromaOf(color: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/**
 * 데칼 테마 검증. **빈 배열이면 통과**다(던지지 않는다).
 *
 * 값의 "좋음"이 아니라 **구조적으로 화면을 깨는 조합**만 잡는다. 전부 카르곤이 실제로 밟았거나,
 * 다음 행성이 밟을 것이 산술적으로 예측되는 것이다.
 */
export function validateDecalTheme(t: DecalTheme): ThemeViolation[] {
  const out: ThemeViolation[] = [];
  violate(out, t.themeId.length > 0, 'themeId', '테마 슬러그가 비었다');

  // ── 픽셀 격자. 지형 픽셀이 정수가 아니면 스냅이 텍셀 경계와 어긋나 반투명 프린지가 생긴다.
  violate(out, t.sourceTilePx > 0, 'sourceTilePx', `양수가 아니다: ${t.sourceTilePx}`);
  violate(
    out,
    t.sourceTilePx > 0 && DISPLAY_TILE % t.sourceTilePx === 0,
    'sourceTilePx',
    `DISPLAY_TILE(${DISPLAY_TILE}) 의 약수가 아니라 지형 픽셀이 정수가 아니다: ${t.sourceTilePx}`,
  );

  // ── 바닥 밝기 기준점.
  violate(
    out,
    t.floorLumaSum > 0 && t.floorLumaSum < 765,
    'floorLumaSum',
    `(0,765) 밖: ${t.floorLumaSum}`,
  );
  violate(
    out,
    t.darkFloorLumaSum > 0 && t.darkFloorLumaSum < t.floorLumaSum,
    'darkFloorLumaSum',
    `암부가 화면 평균보다 어둡지 않다: ${t.darkFloorLumaSum} ≥ ${t.floorLumaSum}`,
  );

  // ── 배수 팔레트(접지색 + 전 슬롯). 검은 구멍 금지 · 안 보이는 데칼 금지 · 색 필터 금지.
  const swatches: [string, number][] = [['ground', t.ground]];
  for (const k of t.kinds) k.slots.forEach((c, i) => swatches.push([`kinds.${k.id}.slots[${i}]`, c]));
  for (const [where, color] of swatches) {
    const ch = [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
    violate(
      out,
      Math.min(...ch) >= MIN_MULTIPLIER_CHANNEL,
      where,
      `너무 진해 검은 구멍이 된다: #${color.toString(16).padStart(6, '0')}`,
    );
    violate(
      out,
      Math.max(...ch) <= MAX_MULTIPLIER_CHANNEL,
      where,
      `너무 옅어 보이지 않는다: #${color.toString(16).padStart(6, '0')}`,
    );
    violate(
      out,
      chromaOf(color) <= MAX_MULTIPLIER_CHROMA,
      where,
      `크로마 ${chromaOf(color)} — 명도 변조가 아니라 색 필터로 읽힌다`,
    );
  }

  // ── 틴트. 곱연산 위에 한 번 더 곱하므로 밝힐 수는 없지만, 대역이 열려 있어야 한다.
  violate(out, t.tints.length >= 2, 'tints', `틴트가 ${t.tints.length}종 — 변주가 없다`);

  // ── 종류 테이블.
  const seen = new Set<string>();
  for (const k of t.kinds) {
    const at = `kinds.${k.id}`;
    violate(out, k.id.length > 0, at, '종류 이름이 비었다');
    violate(out, !seen.has(k.id), at, '종류 이름이 중복이다');
    seen.add(k.id);
    const sil = SILHOUETTE_SPEC[k.silhouette];
    violate(
      out,
      k.slots.length === sil.slots.length,
      `${at}.slots`,
      `${k.silhouette} 는 슬롯 ${sil.slots.length}개(${sil.slots.join('·')})가 필요한데 ${k.slots.length}개다`,
    );
    violate(out, k.r > 0, `${at}.r`, `양수가 아니다: ${k.r}`);
    violate(out, k.elong > 0, `${at}.elong`, `양수가 아니다: ${k.elong}`);
    violate(out, k.coverage > 0 && k.coverage <= 1, `${at}.coverage`, `(0,1] 밖: ${k.coverage}`);
    violate(out, k.opacity > 0 && k.opacity <= 1, `${at}.opacity`, `(0,1] 밖: ${k.opacity}`);
    // 접지 테두리는 본체보다 진해야 "얹힌 판때기"가 아니라 "패인 자국"으로 읽힌다.
    // 안쪽 슬롯(그늘·코어)은 더 진해도 되므로 **바깥 윤곽 슬롯 0** 하고만 비교한다.
    violate(
      out,
      darkening(t.ground) > darkening(k.slots[0] ?? 0xffffff),
      `${at}.slots[0]`,
      '바깥 윤곽이 접지색보다 진하다 — 테두리가 안 보인다',
    );
    // 부조 발자국 대역: r × elong 이 변형 표·흔들림과 맞물려 [MIN, MAX] 안에 있어야 한다.
    // 이 셋 중 하나만 바꾸면 조용히 깨지는 자리라 주석이 아니라 여기서 검사한다.
    if (sil.relief) {
      const unit = k.r * k.elong;
      const mulLo = Math.min(...RELIEF_VARIANT_SPEC.map((v) => v.sizeMul));
      const mulHi = Math.max(...RELIEF_VARIANT_SPEC.map((v) => v.sizeMul));
      const lo = 2 * unit * mulLo * (1 - RELIEF_WOBBLE);
      const hi = 2 * unit * mulHi * (1 + RELIEF_WOBBLE);
      violate(
        out,
        lo >= RELIEF_MIN_SPAN,
        `${at}.r×elong`,
        `가장 작은 변형 지름 ${lo.toFixed(0)} < ${RELIEF_MIN_SPAN} — r×elong(${unit.toFixed(1)}) 을 키워라`,
      );
      violate(
        out,
        hi <= RELIEF_MAX_SPAN,
        `${at}.r×elong`,
        `가장 큰 변형 지름 ${hi.toFixed(0)} > ${RELIEF_MAX_SPAN} — r×elong(${unit.toFixed(1)}) 을 줄여라`,
      );
    }
    // haze 가 아닌데 soft 를 적으면 그 값은 영원히 안 읽힌다(사문화 방지).
    violate(
      out,
      k.soft === undefined || k.silhouette === 'haze',
      `${at}.soft`,
      `${k.silhouette} 는 soft 를 읽지 않는다`,
    );
  }

  // ── 격자.
  const usedKinds = new Set<string>();
  const salts = new Set<number>();
  t.grids.forEach((g, gi) => {
    const at = `grids[${gi}]`;
    violate(out, g.cell > 0, `${at}.cell`, `양수가 아니다: ${g.cell}`);
    violate(
      out,
      g.cell % DISPLAY_TILE !== 0 && gcd(g.cell, DISPLAY_TILE) === 1,
      `${at}.cell`,
      `${g.cell} 이 타일 크기 ${DISPLAY_TILE} 와 서로소가 아니다 — 격자가 공명한다`,
    );
    for (let j = 0; j < t.grids.length; j++) {
      const other = t.grids[j];
      if (j === gi || other === undefined) continue;
      violate(
        out,
        gcd(g.cell, other.cell) === 1,
        `${at}.cell`,
        `${g.cell} 과 ${other.cell} 이 서로소가 아니다 — 두 얼룩 층이 같이 반복된다`,
      );
    }
    violate(out, !salts.has(g.salt), `${at}.salt`, `소금 ${g.salt} 이 중복이다 — 같은 난수를 뽑는다`);
    salts.add(g.salt);
    violate(out, g.density > 0 && g.density <= 1, `${at}.density`, `(0,1] 밖: ${g.density}`);
    violate(
      out,
      Number.isInteger(g.minScale) && Number.isInteger(g.maxScale) && g.minScale >= 1 && g.maxScale >= g.minScale,
      `${at}.scale`,
      `정수 대역이 아니다: ${g.minScale}~${g.maxScale}`,
    );
    violate(
      out,
      g.minAlpha > 0 && g.minAlpha < g.maxAlpha && g.maxAlpha <= MAX_DECAL_ALPHA,
      `${at}.alpha`,
      `0 < min < max ≤ ${MAX_DECAL_ALPHA} 를 벗어난다: ${g.minAlpha}~${g.maxAlpha}`,
    );
    violate(out, g.kinds.length > 0, `${at}.kinds`, '후보가 비었다');
    for (const id of g.kinds) {
      usedKinds.add(id);
      const k = kindSpec(t, id);
      violate(out, k !== undefined, `${at}.kinds`, `선언되지 않은 종류: ${id}`);
      if (k === undefined) continue;
      // 경계가 또렷한 실루엣은 배율 1만 — 지형과 정확히 같은 블록 크기여야 한다.
      violate(
        out,
        SILHOUETTE_SPEC[k.silhouette].scalable || g.maxScale === 1,
        `${at}.maxScale`,
        `${id}(${k.silhouette}) 는 경계가 또렷해 배율 1만 쓸 수 있는데 ${g.maxScale} 이다`,
      );
    }
    if (g.highlight !== undefined) {
      violate(out, t.glow !== undefined, `${at}.highlight`, '하이라이트를 쓰는데 glow 팔레트가 없다');
      violate(
        out,
        g.highlight.minAlpha > 0 && g.highlight.minAlpha < g.highlight.maxAlpha,
        `${at}.highlight`,
        `대역이 열려 있지 않다: ${g.highlight.minAlpha}~${g.highlight.maxAlpha}`,
      );
      violate(
        out,
        g.highlight.maxAlpha <= MAX_HIGHLIGHT_ALPHA,
        `${at}.highlight.maxAlpha`,
        `가산 절대 상한 ${MAX_HIGHLIGHT_ALPHA} 초과: ${g.highlight.maxAlpha}`,
      );
      violate(
        out,
        g.highlight.maxAlpha <= g.maxAlpha / 2,
        `${at}.highlight.maxAlpha`,
        `곱연산 대역의 절반을 넘는다: ${g.highlight.maxAlpha} > ${g.maxAlpha / 2}`,
      );
      // 반전은 광원의 x 성분을 거울로 뒤집는다 → 화면에 태양이 둘.
      violate(out, g.noFlip === true, `${at}.noFlip`, '하이라이트를 쓰는 격자는 좌우반전을 못 쓴다');
    }
  });

  // ── 가산 광량: 팔레트 × 상한 알파가 텍셀당 증가분 상한을 넘으면 암부가 하얗게 뜬다.
  if (t.glow !== undefined) {
    const cap = Math.max(0, ...t.grids.map((g) => g.highlight?.maxAlpha ?? 0));
    for (const [name, color] of Object.entries(t.glow)) {
      violate(
        out,
        lumaSum(color) * cap <= MAX_ADDITIVE_LUMA_GAIN,
        `glow.${name}`,
        `텍셀당 최대 광량 ${(lumaSum(color) * cap).toFixed(0)} > ${MAX_ADDITIVE_LUMA_GAIN}`,
      );
    }
  }

  // ── 사문화 금지: 선언한 종류는 전부 어딘가에서 배치돼야 한다(안 그러면 텍스처만 굽는다).
  for (const k of t.kinds) {
    violate(out, usedKinds.has(k.id), `kinds.${k.id}`, '어느 격자도 이 종류를 뽑지 않는다');
  }

  return out;
}
