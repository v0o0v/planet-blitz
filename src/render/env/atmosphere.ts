/**
 * 카르곤 전경 대기 레이어 (슬롯 `over` — 엔티티 위).
 *
 * 담당: 떠오르는 **잔불**·낙하하는 **화산재**·흘러가는 **연기 결**·바닥에서 솟는 **열기 기둥**.
 * 지형과 엔티티 사이에 아무것도 떠 있지 않으면 화면이 진공처럼 죽는다 — 이 레이어의 존재
 * 이유는 오직 하나, **화면에 공기를 넣는 것**이다.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ## 2차 개정 — "안 보이면 없는 것과 같다"
 *
 * 1차 구현은 위 설계를 전부 지켰는데도 **화면 기여도가 0.45**(RGB 합산 절대차 평균, 최대 765)로
 * 측정됐다. 애니메이션 노이즈 바닥이 0.12 였으니 노이즈의 3.7배 — 사실상 존재하지 않았다.
 * 원인은 단일 실수가 아니라 **네 개의 보수적 결정이 곱해진 것**이었다:
 *
 *  - 잔불을 적탄과 분리하려고 크기·알파·개수를 동시에 최소로 밀었다(2.6px × 0.42 × 30개).
 *  - 연기를 안개로 만들지 않으려고 알파를 0.09 로 눌렀다.
 *  - **화산재 틴트가 배경과 거의 같은 색이었다**(0x2a2220 vs 지형 ~0x2a2422 → 채널차 6).
 *    문자 그대로 보이지 않는 입자를 22개 그리고 있었다. 이건 보수성이 아니라 결함이다.
 *  - **구운 텍스처의 중심 알파가 0.61 뿐이었다.** 8겹 링을 각 0.04~0.18 로 겹쳐 그렸는데
 *    `1-∏(1-aᵢ)` 가 0.61 에서 멈춘다. 즉 "잔불 알파 0.42" 라고 적힌 주석은 거짓이고 실제
 *    화면 최대치는 0.26 이었다. 모든 필드가 이 배율을 함께 먹고 있었다.
 *
 * ## 2차의 원칙 — 축을 최소화하지 말고 **재배분**한다
 *
 * 적탄 혼동은 여전히 실패 조건이다. 다만 네 축을 전부 바닥으로 미는 대신, **가장 강한 축을
 * 더 벌리고 약한 축에서 여유를 얻는다**:
 *
 *  - 잔불은 **속도축을 더 벌리고**(74 → {@link EMBER_SPEED_PX_PER_SEC}px/s) 그 대가로
 *    크기·알파를 올린다. 속도차가 네 축 중 가장 강한 분리라는 1차의 판단은 옳았다.
 *  - **개수는 늘리지 않는다**(잔불 {@link ATMOSPHERE_TUNING}.ember.count 개 유지). 개수는
 *    탄막과 직접 경쟁하는 유일한 축이다. 대신 개체를 키운다.
 *  - 화면 기여의 **주력은 연기와 열기**로 옮긴다. 큰 반투명 뭉치는 적탄과 형태가 전혀 달라
 *    혼동 위험이 거의 없으면서 면적이 커서 기여도가 크다.
 *  - 화산재는 배경과 분리되는 밝기로 올린다(위 결함 수정).
 *
 * ### 왜 "면적"이 기여도의 지배항인가
 * 측정 지표는 **화면 전 픽셀의 평균 차이**다. 반경 4px 입자 30개의 총 면적은 화면의 0.04%라
 * 알파를 1.0 으로 올려도 평균 차이는 0.1 을 못 넘는다 — 작은 입자는 이 지표를 구조적으로
 * 움직일 수 없다. 반대로 반경 200px 뭉치 11개는 화면의 절반을 덮으므로 알파 0.26 만으로도
 * 3 이상을 낸다. 그래서 "잘 보이게" 와 "가독성을 해치지 않게" 는 사실 **충돌하지 않는다**:
 * 답은 언제나 **넓은 면적 × 낮은 진폭**이고, 그건 탄(좁은 면적 × 최대 진폭)의 정확한 반대다.
 * {@link estimateAtmosphereContribution} 가 이 모델을 코드로 고정한다.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ## 왜 "상태 없는 입자"인가 (1차의 설계, 그대로 유지)
 *
 * 입자 시스템의 상식적 구현은 "생성 시 `Math.random` 으로 속성을 뽑고 → 매 프레임 상태를 갱신"
 * 이다. 이 리포에서 그 구현은 **세 가지가 동시에 깨진다**:
 *  1. `Math.random` 이라 같은 시드의 리플레이가 다른 배경을 그린다(noise.ts 서두의 규율 위반).
 *  2. 상태 적분이라 프레임 스킵·탭 복귀(큰 dt)에서 입자가 순간이동하거나 뭉친다.
 *  3. 매 프레임 배열을 돌며 상태를 쓰고, 수명이 끝난 입자를 재생성하며 할당이 생긴다.
 *
 * 그래서 여기서는 입자를 **순수 함수** 로 만든다:
 *
 *     (seed, 입자 인덱스 i, tick) → { x, y, alpha, radius }
 *
 * 수명 주기는 상태가 아니라 **`tick` 을 입자별 위상만큼 밀고 주기로 나눈 나머지**(`u ∈ [0,1)`)다.
 * 상태 갱신이 없으니 프레임을 건너뛰어도 튀지 않고(어느 tick 이든 곧바로 정답 위치를 계산한다),
 * 같은 시드·같은 tick 이면 항상 같은 화면이 나오며, 갱신 루프가 곧 그리기 루프라 할당이 0 이다.
 * 되감김(무한 상승 금지)도 `u` 의 나머지 연산이 구조적으로 보장한다 — 잊어서 새는 코드가 없다.
 *
 * ## 좌표계 — 화면 기준 + 시차
 * 입자는 **화면(design) 좌표**에 산다. 월드 고정으로 두면 카메라가 멈춘 순간 공기도 같이 멈춰
 * 죽어 보인다. 대신 카메라 이동량에 필드별 계수(`parallax`)를 곱해 빼고 화면 밖으로 나간 만큼
 * 되감아(`wrap`), "화면 앞에 떠 있는 공기"로 읽히게 한다. 계수가 클수록 앞(빠르게 흐름).
 *
 * ## 결정론·비용
 * render-only(ADR-0005). `src/sim/` 미import, `Math.random`·`performance.now` 미사용,
 * 애니메이션 위상은 오직 {@link EnvFrame.tick}. 스프라이트 풀은 고정 크기이고 매 프레임 할당·
 * `generateTexture` 가 0 이다(텍스처는 첫 `configure` 에서 두 장만 굽고 캐시).
 */

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { EnvContext, EnvFrame, EnvLayer } from './types.js';
import { hash3 } from './noise.js';
import { graphicsTierController } from '../graphicsRuntime.js';
import { effectGates } from '../qualityTier.js';
import { graphicsSettings } from '../graphicsSettings.js';

/**
 * 카르곤 행성 인덱스. `planetEnvironment.ts` 의 `KARGON` 과 같은 값이지만 **거기서 import 하지
 * 않는다** — 그 모듈이 이 파일을 import 하므로 순환이 된다. 값은 append-only 인 행성 인덱스라
 * 바뀌지 않는다.
 */
const KARGON = 0;

// ═══════════════════════════════════════════════════════════════════════════
// 튜닝 블록 — 개수·크기·알파를 **여기 한 곳에만** 둔다.
//
// 타일셋 그림과 용암 발광이 같은 시점에 병렬로 바뀌고 있다(바닥이 더 어둡고 대비가 강해지며,
// 용암 채널이 밝아진다). 밝아진 용암 위에서는 가산 필드(잔불·열기)가 튈 수 있어 통합 후
// 재조정이 필요하다. 그때 **이 블록만 고치면 되도록** 수치를 필드 정의에서 분리했다.
// 필드의 성격(방향·시차·색·합성·흔들림)은 아래 FieldSpec 에, 세기는 전부 여기에.
// ═══════════════════════════════════════════════════════════════════════════

/** 필드 하나의 세기 파라미터(통합 후 재조정 시 건드리는 유일한 자리). */
export interface FieldTuning {
  /** `gates.particles === 'normal'` 에서의 입자 수. */
  readonly count: number;
  /** min 티어 입자 수(off 는 항상 0). */
  readonly countMin: number;
  /** 반경 하한·상한(px, design). */
  readonly minRadius: number;
  readonly maxRadius: number;
  /** 알파 상한. 실제 알파는 수명 포락선·깜빡임·개체 지터로 항상 이보다 작다. */
  readonly alpha: number;
}

/**
 * 네 필드의 세기. 아래 값의 근거는 각 FieldSpec 주석과 파일 서두 "2차의 원칙" 절에 있다.
 *
 * | 필드 | 1차 (기여도 합 0.45) | 2차 | 이유 |
 * |---|---|---|---|
 * | ember | 30개·2.6px·a0.42 | 30개·4.0px·a0.50 | 개수 고정, 개체만 확대(탄막과 경쟁 금지) |
 * | ash   | 22개·2.8px·a0.34 | 24개·5.0px·a0.40 | + 틴트를 배경과 분리(1차엔 사실상 투명) |
 * | smoke | 6개·210px·a0.09  | 11개·300px·a0.26 | 주력 — 큰 면적·낮은 진폭이 가장 안전하다 |
 * | heat  | 4개·96px·a0.055  | 9개·130px·a0.14  | 주력 — 하단 열기, 가산이라 단위 알파당 기여가 크다 |
 *
 * 여기에 텍스처 중심 알파 0.61 → 1.0 수정(아래 {@link bakeProfileTexture})이 전 필드에 곱해진다.
 */
export const ATMOSPHERE_TUNING = {
  ember: { count: 30, countMin: 12, minRadius: 1.6, maxRadius: 4.0, alpha: 0.5 },
  ash: { count: 24, countMin: 9, minRadius: 2.4, maxRadius: 5.0, alpha: 0.4 },
  smoke: { count: 11, countMin: 4, minRadius: 130, maxRadius: 300, alpha: 0.26 },
  heat: { count: 9, countMin: 3, minRadius: 55, maxRadius: 130, alpha: 0.14 },
} as const satisfies Record<string, FieldTuning>;

// ---------------------------------------------------------------------------
// 가독성 기준값 — "잔불을 적탄으로 착각하지 않는다"의 수치 근거.
// ---------------------------------------------------------------------------

/**
 * 탄의 화면 표시 반경(px, design). entityRenderer 는 탄을 `radius * 2 * ART_SCALE`(=1.5) 크기로
 * 그리고 sim 탄 반경은 5~6 이라 표시 반경이 대략 이 값이다. 잔불 크기 상한의 비교 기준.
 */
export const BULLET_DISPLAY_RADIUS = 9;

/**
 * ① 크기 — 잔불 최대 반경(px). 1차의 2.6px 는 탄의 30% 였는데, 그 크기로는 화면에서 보이지
 * 않았다. 2차는 44%(면적 1/5)로 올린다. **면적비 1/5 는 여전히 "점 vs 탄" 이 한눈에 갈리는
 * 차이**이고, 아래 ②③④ 축이 그대로 살아 있어 단독으로 혼동을 만들지 않는다.
 * (탄 표시 반경의 절반 미만이라는 상한은 테스트가 코드로 강제한다.)
 */
export const EMBER_MAX_RADIUS = ATMOSPHERE_TUNING.ember.maxRadius;

/**
 * ② 알파 — 잔불 최대 알파. 탄은 사실상 불투명(1.0)이다. **이 축은 1차 값을 지켰다**(0.42→0.50,
 * 여전히 ≤0.5). 실제 화면 밝기는 텍스처 중심 알파 수정만으로 이미 0.26 → 0.50 으로 두 배가
 * 됐으므로, 상한을 더 올릴 이유가 없었다. 0.5 이하면 잔불 뒤의 지형이 항상 비쳐 보여서
 * "표면에 그려진 오브젝트"가 아니라 "공기 중의 티끌"로 읽힌다.
 */
export const EMBER_ALPHA = ATMOSPHERE_TUNING.ember.alpha;

/**
 * ③ 색 — 잔불 색(진한 주황). 아군탄은 흰 코어+청록 링, 적탄은 흰 코어+적색 링이라 **흰색이
 * 핵심 신호**다. 잔불은 흰 코어를 아예 넣지 않고 채도 높은 주황 단색이라 색만으로도 갈린다.
 * (적탄 링 0xff2233 과도 색상각이 충분히 떨어진 호박색 대역.)
 */
export const EMBER_TINT = 0xff7a1e;

/**
 * ④ 속도 — 잔불의 화면상 상승 속도(px/s, 근사).
 *
 * **2차에서 더 벌린 축이다**(74 → 62px/s). 크기·알파를 올린 만큼 여기서 되갚는다. 탄은 초당
 * 수천 px 로 지나가므로 속도비가 30배를 넘는다 — 눈은 속도차가 두 자릿수 배면 두 대상을 다른
 * 범주로 분류하고, 이게 네 축 중 **가장 강한 분리**다. 느려진 만큼 "떠 있는 공기" 인상도 는다.
 */
export const EMBER_SPEED_PX_PER_SEC = 62;

/** sim 틱 레이트(초당). 주기(틱) ↔ 속도(px/s) 환산에만 쓴다. */
const TICKS_PER_SECOND = 60;

/** 모션 감소 시 시간 진행·흔들림 배율. 완전 정지는 오히려 부자연스러워 크게 줄이기만 한다. */
const REDUCED_MOTION_SCALE = 0.3;

/** 발광 감소 시 잔불·열기 알파 배율(가산 발광의 눈부심 완화). */
const REDUCED_GLOW_ALPHA = 0.5;

/**
 * 구운 원형 텍스처의 반경(px). 스프라이트는 `radius / 이 값` 으로 스케일한다.
 * 연기는 반경 300px 까지 커지므로 텍스처가 작으면 확대 시 계단이 보인다 — 64px(=128² 텍스처)면
 * 4.7배 확대라 소프트 그라디언트가 뭉개지지 않는다. 잔불(4px)은 축소라 품질 문제가 없다.
 */
const TEXTURE_RADIUS = 64;

// ---------------------------------------------------------------------------
// 텍스처 프로파일 — 1차의 "중심 알파 0.61" 결함을 구조적으로 못 내게 만든다.
// ---------------------------------------------------------------------------

/** 0~1 클램프. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 점 텍스처의 알파 프로파일. `t` 는 정규화 반경(0=중심, 1=가장자리).
 * `(1-t)²` — 중심이 또렷하고 가장자리가 빠르게 사라진다(잔불·재처럼 "알갱이"로 읽혀야 하는 것).
 * 원판 평균 채움률 = ∫₀¹(1-t)²·2t dt = 1/6.
 */
export function dotProfile(t: number): number {
  const s = 1 - clamp01(t);
  return s * s;
}

/**
 * 뭉치 텍스처의 알파 프로파일. `(1-t²)^1.5` — 중심 근처가 넓게 평평하고 가장자리가 부드럽게
 * 죽는다(연기·열기처럼 "덩어리"로 읽혀야 하는 것). 원판 평균 채움률 = 0.4.
 *
 * 이 넓은 평탄부가 **화면 기여도의 실제 원천**이다. 같은 반경·같은 알파라도 점 프로파일 대비
 * 2.4배의 면적을 실제로 칠한다.
 */
export function puffProfile(t: number): number {
  const c = clamp01(t);
  const s = 1 - c * c;
  return s * Math.sqrt(s);
}

/**
 * 프로파일의 **원판 평균 채움률**(∫₀¹ p(t)·2t dt). 스프라이트의 공칭 면적 `πr²` 중 실제로
 * 칠해지는 비율이며, 화면 기여도 모델의 핵심 계수다. 수치적분이라 프로파일을 바꾸면 자동으로
 * 따라온다 — 상수로 박아두면 프로파일 변경 시 조용히 거짓말이 된다.
 */
export function profileAverageFill(p: (t: number) => number, steps = 512): number {
  let s = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    s += p(t) * 2 * t;
  }
  return s / steps;
}

/** 텍스처 종류. 필드마다 하나를 고른다. */
export type TextureKind = 'dot' | 'puff';

/** 종류 → 프로파일. */
export function textureProfile(kind: TextureKind): (t: number) => number {
  return kind === 'puff' ? puffProfile : dotProfile;
}

// ---------------------------------------------------------------------------
// 필드 정의 — 입자 종류 하나가 곧 FieldSpec 하나다.
// ---------------------------------------------------------------------------

/** 티어(=`gates.particles` 3단)별 입자 수. 단조여야 한다(off ≤ min ≤ normal). */
export interface FieldCounts {
  off: number;
  min: number;
  normal: number;
}

/** 입자 필드 1종의 정적 사양. 전부 상수이며 런타임에 바뀌지 않는다. */
export interface FieldSpec {
  /** 진단·테스트용 이름. */
  readonly name: string;
  /** 해시 도메인 분리 키. 필드마다 달라야 서로 다른 배치가 나온다. */
  readonly key: number;
  /** 티어별 입자 수. */
  readonly counts: FieldCounts;
  /** true=아래에서 위로(잔불·연기·열기), false=위에서 아래로(재). */
  readonly riseUp: boolean;
  /** 한 수명 주기의 길이(틱). 클수록 느리다. */
  readonly periodTicks: number;
  /** 주기 지터 비율(0~1). 입자마다 주기를 흩어 동기화(줄지어 뜨는 티)를 없앤다. */
  readonly periodJitter: number;
  /** 반경 하한·상한(px, design). */
  readonly minRadius: number;
  readonly maxRadius: number;
  /** 세로/가로 비(1=원, >1=세로로 긴 기둥, <1=납작한 뭉치). */
  readonly aspect: number;
  /** 알파 상한. 실제 알파는 수명 포락선·깜빡임·개체 지터로 이보다 작다. */
  readonly maxAlpha: number;
  /**
   * 세로 이동 대역(필드 높이 비율). 입자는 `[bandStart, bandStart+bandSpan]` **안에서만** 오간다.
   * 기본은 `0, 1`(화면 전체). 열기 기둥이 화면 아래쪽에서만 솟게 하는 장치다.
   */
  readonly bandStart: number;
  readonly bandSpan: number;
  /** 좌우 흔들림 진폭(px). */
  readonly swayPx: number;
  /** 한 수명 동안의 흔들림 왕복 횟수. */
  readonly swayCycles: number;
  /** 한 수명 동안 가로로 흐르는 화면 폭 배수(연기 결의 흐름축). 0=흐르지 않음. */
  readonly driftTurns: number;
  /** 카메라 시차 계수(0=화면 완전 고정, 1=월드 고정). 클수록 앞에 있는 느낌. */
  readonly parallax: number;
  /** 색(단색 틴트). */
  readonly tint: number;
  /** 가산 합성 여부. Pixi 의 `tint` 는 곱연산이라 **밝히려면 반드시 'add'** 다. */
  readonly additive: boolean;
  /** 깜빡임 세기(0~1). 잔불의 명멸. 0 이면 깜빡이지 않는다. */
  readonly flicker: number;
  /** 발광 감소(reducedGlow)에 반응하는 필드인가(잔불·열기만). */
  readonly glowSensitive: boolean;
  /** 어느 텍스처를 쓰는가. 알갱이는 'dot', 덩어리는 'puff'. */
  readonly texture: TextureKind;
}

/** 튜닝 블록 → FieldCounts(수치가 한 곳에만 있게 하는 어댑터). */
function counts(t: FieldTuning): FieldCounts {
  return { off: 0, min: t.countMin, normal: t.count };
}

/**
 * 잔불 — 아래에서 위로 아주 느리게 상승하며 좌우로 흔들리고, 밝기가 명멸하다 사라진다.
 *
 * **개수를 늘리지 않는 것 자체가 가독성 대책이다.** 개수는 네 축 중 유일하게 탄막과 직접
 * 경쟁하는 축이다 — 화면에 수백 개가 뜨면 아무리 작고 어두워도 탄막과 시각적으로 경쟁한다.
 * 2차에서 크기·알파를 올리면서도 **개수는 1차의 30개 그대로 두었다**. 눈이 "몇 점 떠 있다"로
 * 읽는 밀도를 지킨다.
 */
const EMBER: FieldSpec = {
  name: 'ember',
  key: 0x1a,
  counts: counts(ATMOSPHERE_TUNING.ember),
  riseUp: true,
  // 화면 세로(패딩 포함 ~1350px)를 EMBER_SPEED_PX_PER_SEC 로 지나는 데 걸리는 틱.
  periodTicks: Math.round((1350 / EMBER_SPEED_PX_PER_SEC) * TICKS_PER_SECOND),
  periodJitter: 0.35,
  minRadius: ATMOSPHERE_TUNING.ember.minRadius,
  maxRadius: ATMOSPHERE_TUNING.ember.maxRadius,
  aspect: 1,
  maxAlpha: ATMOSPHERE_TUNING.ember.alpha,
  bandStart: 0,
  bandSpan: 1,
  swayPx: 26,
  swayCycles: 2.5,
  driftTurns: 0,
  // 시차를 가장 크게 — 잔불이 화면 제일 앞에 떠 있는 층이다.
  parallax: 0.34,
  tint: EMBER_TINT,
  additive: true,
  flicker: 0.55,
  glowSensitive: true,
  texture: 'dot',
};

/**
 * 화산재 — 작은 입자가 천천히 **떨어진다**. 잔불과 방향이 반대라 그것만으로 대비가 생기고,
 * "위로 가는 밝은 것 / 아래로 가는 흐린 것"이 화면에 두 축의 흐름을 만든다.
 *
 * **1차의 결함 수정**: 틴트가 0x2a2220 이었는데 카르곤 지형 평균이 대략 0x2a2422 다. 채널차가
 * 6 이라 알파를 아무리 올려도 배경과 구분되지 않았다 — "어두워서 안전한" 게 아니라 **아예 없는**
 * 입자를 22개 그리고 있었다. 2차는 배경보다 밝은 회갈색으로 올려 실제로 보이게 한다.
 *
 * 밝아진 만큼 적탄 분리축을 다시 확인한다: 비가산(밝기가 배경에 종속)·**하강**(탄은 사출 방향으로
 * 직진)·무채색 회갈색(탄의 흰 코어+청록/적색 링과 색상 신호가 다름)·주기 1600틱(26.7초)으로
 * 극도로 느림. 최대 반경 5px 는 탄의 56% 지만, 위 네 축이 전부 반대라 형태만으로 구분된다.
 */
const ASH: FieldSpec = {
  name: 'ash',
  key: 0x2b,
  counts: counts(ATMOSPHERE_TUNING.ash),
  riseUp: false,
  periodTicks: 1600,
  periodJitter: 0.4,
  minRadius: ATMOSPHERE_TUNING.ash.minRadius,
  maxRadius: ATMOSPHERE_TUNING.ash.maxRadius,
  aspect: 1,
  maxAlpha: ATMOSPHERE_TUNING.ash.alpha,
  bandStart: 0,
  bandSpan: 1,
  swayPx: 34,
  swayCycles: 1.5,
  driftTurns: 0,
  parallax: 0.22,
  // 배경(≈0x2a2422)보다 확실히 밝은 회갈색. 채널차 합 266 — 이제 실제로 보인다.
  tint: 0x8a7d73,
  additive: false,
  flicker: 0,
  glowSensitive: false,
  texture: 'dot',
};

/**
 * 연기·연무 결 — 크고 옅은 반투명 뭉치가 화면을 아주 느리게 가로지른다. **화면 기여의 주력 1**.
 *
 * 시차 계수를 작게 둬 잔불보다 뒤에 있는 층으로 읽히고, 입자마다 깊이 지터(주기·크기)를 줘
 * 한 필드 안에서 여러 겹처럼 보이게 한다.
 *
 * **왜 여기를 올리는 게 가장 안전한가**: 반경 130~300px 뭉치는 적탄(9px)과 크기가 15~33배
 * 차이라 형태를 혼동할 여지가 물리적으로 없다. 그리고 큰 만큼 **적은 알파로도 면적 기여가
 * 크다** — 1차의 α0.09 는 지나친 보수였다.
 *
 * **그럼에도 안개가 되면 안 된다**: 가독성을 죽이는 것은 알파 자체가 아니라 *균일한* 베일이다.
 * 여기서 지키는 것은 두 가지 — ①`minRadius` 를 크게 유지해 농도 변화가 항상 **수백 px 스케일의
 * 완만한 그라디언트**로만 나타나게 한다(9px 짜리 탄이 걸치는 구간에서 농도는 사실상 상수라
 * 국소 대비가 보존된다). ②알파 상한 0.26 은 **한 뭉치 정중앙에서만** 닿는 값이고, 수명 포락선
 * (평균 0.64)·개체 지터(평균 0.8)·프로파일 감쇠가 곱해져 화면 평균 베일은 2% 수준이다.
 */
const SMOKE: FieldSpec = {
  name: 'smoke',
  key: 0x3c,
  counts: counts(ATMOSPHERE_TUNING.smoke),
  riseUp: true,
  periodTicks: 3000,
  periodJitter: 0.45,
  minRadius: ATMOSPHERE_TUNING.smoke.minRadius,
  maxRadius: ATMOSPHERE_TUNING.smoke.maxRadius,
  aspect: 0.62,
  maxAlpha: ATMOSPHERE_TUNING.smoke.alpha,
  bandStart: 0,
  bandSpan: 1,
  swayPx: 40,
  swayCycles: 0.7,
  // 한 수명 동안 화면 폭을 한 번 가로지른다(가로 흐름축).
  driftTurns: 1,
  parallax: 0.12,
  tint: 0x6b5348,
  additive: false,
  flicker: 0,
  glowSensitive: false,
  texture: 'puff',
};

/**
 * 열기 기둥 — 화면 **아래쪽에서만** 솟는 세로로 긴 가산 열기. **화면 기여의 주력 2**.
 *
 * 카르곤은 화산이고 열은 아래에서 온다. 2차에서 {@link FieldSpec.bandStart}·`bandSpan` 을
 * 도입해 이 필드를 화면 하단 절반에 **가둔다** — 1차는 이름만 "아래에서 솟는"이었고 실제로는
 * 화면 전체를 훑고 있었다.
 *
 * **왜 셰이더 굴절이 아닌가**: 진짜 아지랑이는 *아래 레이어를 왜곡*해야 하는데, Pixi 필터는
 * 자기 컨테이너의 자식만 왜곡한다. 이 레이어(`over`)에 굴절 필터를 걸면 왜곡되는 건 내 입자뿐이라
 * 아무 의미가 없다. 지형을 왜곡하려면 `floor`/backdrop 쪽 컨테이너에 필터를 걸어야 하고 그건
 * 이 파일의 소유가 아니다. 그래서 굴절 대신 **가산 열기 기둥**으로 같은 인상을 만든다.
 *
 * **왜 고티어(`gates.eventShaders`) 게이트를 뗐는가**: 1차는 이 필드를 셰이더 게이트에 물렸는데
 * 이 필드는 셰이더를 쓰지 않는다 — 스프라이트 9장이 전부다. 그 게이트를 유지하면 med/low 티어
 * 에서 화면 기여의 절반이 통째로 사라지고, 게이트 이름과 실제 비용이 어긋나 다음 사람이 오해한다.
 * 다른 필드와 같이 `gates.particles` 3단에 물린다(low 티어에서 3개로 줄어든다).
 *
 * **적탄 혼동 위험**: 반경 55~130px 에 세로 2.6배로 늘어난 기둥은 탄과 형태가 전혀 다르고,
 * 알파 상한 0.14 는 중심에서 채널당 최대 +25/+17/+10 을 더하는 수준이라 "화면이 밝아진다"가
 * 아니라 "아래쪽이 뜨겁다"로 읽힌다.
 */
const HEAT: FieldSpec = {
  name: 'heat',
  key: 0x4d,
  counts: counts(ATMOSPHERE_TUNING.heat),
  riseUp: true,
  periodTicks: 1200,
  periodJitter: 0.3,
  minRadius: ATMOSPHERE_TUNING.heat.minRadius,
  maxRadius: ATMOSPHERE_TUNING.heat.maxRadius,
  aspect: 2.6,
  maxAlpha: ATMOSPHERE_TUNING.heat.alpha,
  // 화면 아래 절반에 가둔다(0.5 → 1.0). 열은 아래에서 온다.
  bandStart: 0.5,
  bandSpan: 0.5,
  swayPx: 18,
  swayCycles: 3,
  driftTurns: 0,
  parallax: 0.18,
  tint: 0xffb066,
  additive: true,
  flicker: 0.35,
  glowSensitive: true,
  texture: 'puff',
};

/** 전체 필드(뒤 → 앞 순서로 그린다: 연기 → 재 → 열기 → 잔불). */
export const ATMOSPHERE_FIELDS: readonly FieldSpec[] = [SMOKE, ASH, HEAT, EMBER];

// ---------------------------------------------------------------------------
// 순수 샘플러 — 이 레이어의 전부. 상태가 없다.
// ---------------------------------------------------------------------------

/** 화면(design) 가시 사각형. */
export interface ViewRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 입자 하나의 이번 프레임 표시 상태. */
export interface ParticleSample {
  x: number;
  y: number;
  alpha: number;
  radius: number;
}

/** `gates.particles` 3단 → 이 필드의 입자 수(순수). */
export function fieldCount(f: FieldSpec, particles: 'off' | 'min' | 'normal'): number {
  return particles === 'off' ? f.counts.off : particles === 'min' ? f.counts.min : f.counts.normal;
}

/** 필드 전체의 최대 입자 수(풀 크기 산정용). */
export function maxFieldCount(f: FieldSpec): number {
  return Math.max(f.counts.off, f.counts.min, f.counts.normal);
}

/** 값을 `[lo, lo+span)` 안으로 되감는다(음수 안전). span ≤ 0 이면 lo. */
function wrap(v: number, lo: number, span: number): number {
  if (!(span > 0)) return lo;
  return lo + (((v - lo) % span) + span) % span;
}

/** 소수부 [0,1) (음수 안전). */
function frac(v: number): number {
  return v - Math.floor(v);
}

/** 화면 밖 여유 비율 — 입자가 경계에서 갑자기 나타나거나 사라지지 않게 한다. */
const PAD_X_RATIO = 0.12;
const PAD_Y_RATIO = 0.15;

/**
 * 입자 하나의 표시 상태를 **`out` 에 써 넣는다**(할당 0). 순수 계산이며 `out` 외의 부작용이 없다.
 *
 * 같은 `(seed, index, tick, view, cam, motion)` 이면 항상 같은 결과다 — 상태를 전혀 읽지 않는다.
 *
 * @param out    결과를 받을 재사용 객체.
 * @param f      필드 사양.
 * @param seed   런 시드(위치 의존 난수의 유일한 근원).
 * @param index  입자 인덱스.
 * @param tick   보간된 sim 틱(애니메이션 위상의 유일한 시간축).
 * @param view   화면 가시 사각형(design).
 * @param camX   카메라 중심 X(시차용).
 * @param camY   카메라 중심 Y(시차용).
 * @param motion 시간·흔들림 배율(모션 감소 시 < 1).
 */
export function sampleParticleInto(
  out: ParticleSample,
  f: FieldSpec,
  seed: number,
  index: number,
  tick: number,
  view: ViewRect,
  camX = 0,
  camY = 0,
  motion = 1,
): ParticleSample {
  // 비유한 입력 방어 — 한 프레임의 NaN 이 스프라이트를 영구히 화면 밖으로 날리는 걸 막는다.
  const t = Number.isFinite(tick) ? tick : 0;
  const cx = Number.isFinite(camX) ? camX : 0;
  const cy = Number.isFinite(camY) ? camY : 0;

  // 입자별 고정 속성(전부 순수 해시 — Math.random 금지).
  const r0 = hash3(seed, index, f.key, 0); // 가로 레인
  const r1 = hash3(seed, index, f.key, 1); // 주기 지터
  const r2 = hash3(seed, index, f.key, 2); // 수명 위상
  const r3 = hash3(seed, index, f.key, 3); // 흔들림 위상
  const r4 = hash3(seed, index, f.key, 4); // 깜빡임 위상
  const r5 = hash3(seed, index, f.key, 5); // 알파 지터
  const r6 = hash3(seed, index, f.key, 6); // 크기 지터
  const r7 = hash3(seed, index, f.key, 7); // 깊이(주기·크기 동시 스케일 → 층 분리)

  const spanX = Math.max(1, view.maxX - view.minX);
  const spanY = Math.max(1, view.maxY - view.minY);
  const padX = spanX * PAD_X_RATIO;
  const padY = spanY * PAD_Y_RATIO;
  const fieldW = spanX + padX * 2;
  const fieldH = spanY + padY * 2;
  const originX = view.minX - padX;
  const originY = view.minY - padY;

  // 깊이: 0.7~1.4. 먼 개체일수록 느리고 크다(연기 층 분리의 근원).
  const depth = 0.7 + r7 * 0.7;
  const period = Math.max(1, f.periodTicks * (1 - f.periodJitter + 2 * f.periodJitter * r1) * depth);

  // 수명 주기 — **상태가 아니라 tick 의 나머지**. 되감김(무한 상승 금지)이 여기서 구조적으로 보장된다.
  const u = frac((t * motion) / period + r2);

  // 세로: 대역(band) 안에서 진행 방향에 따라 한쪽 끝에서 들어와 반대편으로 빠진다.
  // 대역이 전체(0..1)가 아니면 그 구간 안에서만 오가고 되감긴다 — 열기 기둥이 하단에 머무는 장치.
  const bandH = fieldH * f.bandSpan;
  const bandY = originY + fieldH * f.bandStart;
  const travel = f.riseUp ? 1 - u : u; // 0 → 1 이 항상 "들어온 쪽 → 나가는 쪽"
  out.y = wrap(bandY + travel * bandH - cy * f.parallax, bandY, bandH);

  // 가로: 레인 + (연기의) 흐름 + 흔들림 + 시차. 역시 되감는다.
  const sway = f.swayPx * motion * Math.sin(Math.PI * 2 * (f.swayCycles * u + r3));
  const rawX = originX + frac(r0 + u * f.driftTurns) * fieldW + sway - cx * f.parallax;
  out.x = wrap(rawX, originX, fieldW);

  // 알파: 수명 포락선(양끝 0 → 중간 최대) × 깜빡임 × 개체 지터. 상한은 필드의 maxAlpha.
  const envelope = Math.sin(Math.PI * u); // u=0,1 에서 0 → 페이드 인/아웃이 공짜로 나온다.
  const flick =
    f.flicker > 0
      ? 1 - f.flicker + f.flicker * (0.5 + 0.5 * Math.sin(Math.PI * 2 * (t * motion * 0.05 + r4)))
      : 1;
  const jitter = 0.6 + 0.4 * r5;
  out.alpha = Math.max(0, Math.min(f.maxAlpha, f.maxAlpha * envelope * flick * jitter));

  // 크기: 하한~상한 사이 + 깊이. 상한을 절대 넘지 않게 클램프(가독성 대책 ①의 코드 강제).
  const base = f.minRadius + (f.maxRadius - f.minRadius) * r6;
  out.radius = Math.max(f.minRadius, Math.min(f.maxRadius, base * (0.85 + depth * 0.15)));
  return out;
}

/** {@link sampleParticleInto} 의 할당형 래퍼(테스트·진단용). 렌더 루프에서는 쓰지 않는다. */
export function sampleParticle(
  f: FieldSpec,
  seed: number,
  index: number,
  tick: number,
  view: ViewRect,
  camX = 0,
  camY = 0,
  motion = 1,
): ParticleSample {
  return sampleParticleInto(
    { x: 0, y: 0, alpha: 0, radius: 0 },
    f,
    seed,
    index,
    tick,
    view,
    camX,
    camY,
    motion,
  );
}

// ---------------------------------------------------------------------------
// 화면 기여도 모델 — "보이는가"를 코드로 잠근다.
// ---------------------------------------------------------------------------

/**
 * 기여도 계산의 기준 배경색(카르곤 지형의 대표 어두운 암반). 실측 스크린샷에서 지형이 화면의
 * 대부분을 차지하므로 이 한 색으로 근사한다.
 */
export const REFERENCE_BACKDROP = { r: 0x2a, g: 0x24, b: 0x22 } as const;

/**
 * 필드가 픽셀 하나를 **알파 1 로** 덮었을 때의 RGB 합산 절대차(최대 765 척도).
 *
 * - 가산: 배경에 틴트를 그대로 더하므로 차이 = 틴트 채널합.
 * - 일반: 배경 ↔ 틴트 사이를 보간하므로 차이 = |틴트−배경| 채널합.
 *
 * **이 함수가 1차 화산재 결함을 잡는 자리다** — 틴트가 배경과 같으면 여기서 0 이 나온다.
 */
export function fieldDeltaRgbSum(f: FieldSpec): number {
  const r = (f.tint >> 16) & 0xff;
  const g = (f.tint >> 8) & 0xff;
  const b = f.tint & 0xff;
  if (f.additive) return r + g + b;
  return (
    Math.abs(r - REFERENCE_BACKDROP.r) +
    Math.abs(g - REFERENCE_BACKDROP.g) +
    Math.abs(b - REFERENCE_BACKDROP.b)
  );
}

/**
 * 입자 면적 중 실제로 화면 안에 들어오는 기대 비율. 입자는 패딩 포함 사각형에 균일 분포하고
 * 화면은 그 안쪽 일부다 — `(1/(1+2·padX비)) × (1/(1+2·padY비))`.
 */
export const ON_SCREEN_AREA_FRACTION = (1 / (1 + 2 * PAD_X_RATIO)) * (1 / (1 + 2 * PAD_Y_RATIO));

/**
 * 필드 하나의 **화면 기여도 추정치**(RGB 합산 절대차의 전 픽셀 평균, 최대 765 척도).
 *
 *     Σᵢ (π·r·r·aspect) × alpha × 프로파일평균채움률 × Δrgb × 화면내비율 / (W·H)
 *
 * 오케스트레이터가 픽셀로 측정하는 값과 같은 척도의 **모델**이다(정확한 재현이 아니라 상한
 * 근사 — 겹침을 선형 합으로 세므로 실측보다 다소 크게 나온다). 이걸 코드에 두는 이유는 하나:
 * 1차의 실패가 "각 결정은 합리적인데 곱해진 결과가 0" 이었기 때문이다. 사람이 곱셈을 눈으로
 * 추적할 수 없으므로 **테스트가 곱셈의 결과를 직접 감시**해야 한다.
 */
export function estimateFieldContribution(
  f: FieldSpec,
  seed: number,
  view: ViewRect,
  ticks: readonly number[],
): number {
  const w = Math.max(1, view.maxX - view.minX);
  const h = Math.max(1, view.maxY - view.minY);
  const fill = profileAverageFill(textureProfile(f.texture));
  const delta = fieldDeltaRgbSum(f);
  const n = fieldCount(f, 'normal');
  const buf: ParticleSample = { x: 0, y: 0, alpha: 0, radius: 0 };
  let acc = 0;
  for (const tick of ticks) {
    for (let i = 0; i < n; i++) {
      const p = sampleParticleInto(buf, f, seed, i, tick, view);
      acc += Math.PI * p.radius * p.radius * f.aspect * p.alpha;
    }
  }
  const meanArea = acc / Math.max(1, ticks.length);
  return (meanArea * fill * delta * ON_SCREEN_AREA_FRACTION) / (w * h);
}

/** 네 필드 기여도의 합. 1차 실측 0.45(노이즈 바닥 0.12) → 2차 목표 ≥ 3.0. */
export function estimateAtmosphereContribution(
  seed: number,
  view: ViewRect,
  ticks: readonly number[],
): number {
  let s = 0;
  for (const f of ATMOSPHERE_FIELDS) s += estimateFieldContribution(f, seed, view, ticks);
  return s;
}

// ---------------------------------------------------------------------------
// 레이어
// ---------------------------------------------------------------------------

/** 필드 하나의 스프라이트 풀 + 컨테이너. */
interface FieldPool {
  readonly spec: FieldSpec;
  readonly container: Container;
  readonly sprites: Sprite[];
  /** 현재 적용된 발광 감소 상태(플립될 때만 blendMode 를 다시 쓴다). */
  glowReduced: boolean;
}

/**
 * 프로파일을 따르는 부드러운 원형 텍스처를 굽는다. **첫 configure 에서만** 호출된다
 * (매 프레임 generateTexture 는 GPU 메모리 누수).
 *
 * ## 왜 링 알파를 프로파일에서 역산하는가 — 1차 결함의 재발 방지
 * 1차는 링마다 "적당한" 알파(0.04~0.18)를 직접 적어 겹쳐 그렸다. 그런데 겹쳐 그린 결과의
 * 중심 알파는 `1 − ∏(1−aᵢ)` 라서 0.61 에서 멈췄고, 그 사실이 어디에도 드러나지 않았다.
 * 여기서는 **원하는 프로파일 `p(t)` 를 먼저 선언하고 링 알파를 역산**한다:
 *
 *     acc 를 이미 칠해진 합성 알파라 할 때, 목표 p(t) 를 맞추는 링 알파 a = (p(t) − acc)/(1 − acc)
 *
 * 그러면 중심 알파는 정의상 `p(1/rings) ≈ 1` 이고, 스프라이트에 건 `alpha` 값이 곧 화면에
 * 보이는 최대 불투명도가 된다 — 주석의 수치와 화면의 수치가 어긋날 수 없다.
 */
function bakeProfileTexture(ctx: EnvContext, kind: TextureKind, rings = 28): Texture | null {
  const renderer = ctx.renderer;
  if (renderer === undefined) return null; // 테스트(캔버스 없음) — 던지지 않는다.
  const p = textureProfile(kind);
  const g = new Graphics();
  let acc = 0;
  for (let i = rings; i >= 1; i--) {
    const t = i / rings; // 1=바깥, 1/rings=중심
    const target = clamp01(p(t));
    if (target <= acc || 1 - acc < 1e-4) continue;
    const a = (target - acc) / (1 - acc);
    g.circle(0, 0, TEXTURE_RADIUS * t).fill({ color: 0xffffff, alpha: a });
    acc = target;
  }
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

export class AtmosphereLayer implements EnvLayer {
  readonly name = 'atmosphere';
  readonly slot = 'over' as const;
  readonly view = new Container();

  private seed = 0;
  private enabled = false;
  /** 종류별로 한 번만 굽는 텍스처(알갱이·덩어리). */
  private textures: Record<TextureKind, Texture | null> = { dot: null, puff: null };
  private readonly pools: FieldPool[] = [];
  /** 매 프레임 재사용하는 샘플 버퍼(할당 0). */
  private readonly sample: ParticleSample = { x: 0, y: 0, alpha: 0, radius: 0 };
  /** 매 프레임 재사용하는 가시 사각형 버퍼(할당 0). */
  private readonly rect: ViewRect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  configure(ctx: EnvContext): boolean {
    this.enabled = ctx.planet === KARGON;
    if (!this.enabled) return false;
    this.seed = ctx.seed | 0;
    if (this.textures.dot === null) this.textures.dot = bakeProfileTexture(ctx, 'dot');
    if (this.textures.puff === null) this.textures.puff = bakeProfileTexture(ctx, 'puff');
    if (this.pools.length === 0) this.buildPools();
    else {
      // 첫 configure 가 렌더러 없이 돌았고 두 번째에 생겼을 때만 텍스처를 채운다.
      for (const p of this.pools) {
        const tex = this.textures[p.spec.texture];
        if (tex !== null) for (const s of p.sprites) s.texture = tex;
      }
    }
    return true;
  }

  /** 고정 크기 풀을 한 번 만든다(런 도중 생성·파괴 없음 → 매 프레임 할당 0). */
  private buildPools(): void {
    for (const spec of ATMOSPHERE_FIELDS) {
      const container = new Container();
      const sprites: Sprite[] = [];
      const tex = this.textures[spec.texture];
      for (let i = 0; i < maxFieldCount(spec); i++) {
        const s = tex === null ? new Sprite() : new Sprite(tex);
        s.anchor.set(0.5);
        s.tint = spec.tint;
        // Pixi 의 tint 는 **곱연산**이라 어두운 배경 위에서 잔불을 밝히려면 가산이어야 한다.
        s.blendMode = spec.additive ? 'add' : 'normal';
        s.visible = false;
        container.addChild(s);
        sprites.push(s);
      }
      this.view.addChild(container);
      this.pools.push({ spec, container, sprites, glowReduced: false });
    }
  }

  update(f: EnvFrame): void {
    if (!this.enabled || this.pools.length === 0) return;

    const settings = graphicsSettings.getSettings();
    const gates = effectGates(graphicsTierController.getActiveTier(), settings);
    const motion = settings.reducedMotion ? REDUCED_MOTION_SCALE : 1;
    const glowReduced = settings.reducedGlow;

    this.rect.minX = f.viewMinX;
    this.rect.minY = f.viewMinY;
    this.rect.maxX = f.viewMaxX;
    this.rect.maxY = f.viewMaxY;

    for (const pool of this.pools) {
      const spec = pool.spec;
      const count = Math.min(fieldCount(spec, gates.particles), pool.sprites.length);
      pool.container.visible = count > 0;

      // 발광 감소 시 가산 발광 필드는 합성 자체를 일반으로 내린다(플립될 때만 쓴다).
      if (spec.glowSensitive && pool.glowReduced !== glowReduced) {
        pool.glowReduced = glowReduced;
        const mode = spec.additive && !glowReduced ? 'add' : 'normal';
        for (const s of pool.sprites) s.blendMode = mode;
      }
      const alphaScale = spec.glowSensitive && glowReduced ? REDUCED_GLOW_ALPHA : 1;

      for (let i = 0; i < pool.sprites.length; i++) {
        const s = pool.sprites[i];
        if (s === undefined) continue;
        if (i >= count) {
          s.visible = false;
          continue;
        }
        const p = sampleParticleInto(
          this.sample,
          spec,
          this.seed,
          i,
          f.tick,
          this.rect,
          f.camX,
          f.camY,
          motion,
        );
        s.visible = true;
        s.position.set(p.x, p.y);
        s.alpha = p.alpha * alphaScale;
        s.scale.set(p.radius / TEXTURE_RADIUS, (p.radius * spec.aspect) / TEXTURE_RADIUS);
      }
    }
  }

  /** 입자는 매 프레임 `EnvFrame` 의 가시 사각형을 직접 쓰므로 크기 변경에 할 일이 없다. */
  resize(_width: number, _height: number): void {}

  destroy(): void {
    this.pools.length = 0;
    this.view.destroy({ children: true });
    // 구운 텍스처는 view 서브트리 소유가 아니므로 직접 해제한다(런 반복 시 GPU 누수 방지).
    this.textures.dot?.destroy(true);
    this.textures.puff?.destroy(true);
    this.textures = { dot: null, puff: null };
  }
}
