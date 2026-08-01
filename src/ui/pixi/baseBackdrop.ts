/**
 * 기지 화면 배경 — 풀블리드 시네마틱 키아트 + 절제된 패럴랙스 + 공기(티끌·광선) + 국소 톤매핑.
 *
 * ## 왜 배경이 "한 장 붙이기"가 아닌가
 * 기지는 **오래 머무는 화면**이다. 정지 이미지 한 장은 몇 초만 지나면 배경이 아니라 벽지로
 * 읽히고, 그 위에 놓인 타일이 종이처럼 떠 보인다. 그래서 이 클래스는 ①시선에 따라 아주 조금
 * 움직이고 ②입력이 없어도 스스로 표류하며 ③공기(먼지·가끔 지나는 광선)를 가진다. 장소가
 * 살아 있어야 타일이 그 안에 **놓인 것**으로 읽힌다.
 *
 * ## 왜 타이틀보다 진폭이 작은가
 * 타이틀은 몇 초 보고 지나가는 화면이라 `MOUSE_RANGE 26`·`DRIFT_AMPL 14` 가 인상적으로 읽힌다.
 * 기지는 클릭 대상(타일·CTA)이 화면에 깔린 채 오래 머무는 화면이라, 같은 진폭이면 ①커서를
 * 움직일 때마다 클릭 목표가 흔들리고 ②멀미가 난다. 그래서 절반 아래로 줄였다. 배경만 움직이고
 * **전경(타일·크롬)은 리드가 고정으로 붙인다** — 움직이는 것과 눌러야 하는 것을 분리한다.
 *
 * ## 왜 딤 오버레이가 아니라 **국소 톤매핑**인가 — 세 번의 실패가 그렇게 시켰다
 * 1차: 화면 전체를 균일한 알파로 눌렀다 → 다른 화면보다 한 스톱 어두웠다(중앙값 24 vs 타이틀
 * 32·인트로 49). 배경이 "무특징 어둠"이 됐다.
 *
 * 2차: 딤을 걷고 격자 행 안쪽만 눌렀다 → **도-지가 반전됐다.** 원화는 아래쪽 좌우가 밝은데
 * 거기엔 격자가 없어 딤도 없었다(2행 카드 L 57.7 < 그 바깥 배경 79.0).
 *
 * 3차: 원화 휘도를 재서 알파를 역산했다 → 평균은 내려갔는데 **국소대비가 −85% 무너졌다**
 * (거터 std 48.5 → 7.3). 카드 사이가 그라디언트 한 장이 되어 지하 유적이라는 장소 정보가
 * 통째로 사라졌다.
 *
 * 3차의 원인이 결정적이다: **알파 곱은 평균과 대비를 같은 비율로 함께 죽인다.**
 * `out = A·(1−a)` 는 `std_out = std_A·(1−a)` 이므로, 평균을 절반으로 낮추면 대비도 반드시
 * 절반이 된다 — 휘도만 목표로 삼은 역산에는 대비가 지표로 존재하지 않았다.
 *
 * 그래서 딤 오버레이를 **버리고**, 배경을 굽는 단계에서 국소 톤매핑을 한다:
 * ```
 *   out_lum = M(x,y) + (A − Lp)·gain          A  = 표시용 원화(4px 흐림)
 *                                             Lp = A 의 저주파(넓은 흐림) = 국소 평균
 *   out_rgb = A_rgb · (out_lum / A_lum)        M  = 목표 국소 평균(자리마다 상수)
 * ```
 * `A − Lp` 가 **디테일(석재 부조·램프 코어·잔해)** 이고, 이 항은 `M` 과 **독립**이다. 그래서
 * 아무리 어둡게 눌러도 대비가 따라 죽지 않는다 — 오히려 `gain` 으로 되살릴 수 있다. 평균은
 * `M` 이 **직접 지정**하므로(스케일이 아니다) 거터 셋이 원화 밝기와 무관하게 같은 값에 앉는다
 * — 3차에서 못 맞춘 균일성(Δ10.1)이 여기서는 구조적으로 보장된다. RGB 는 휘도 비로만 스케일해
 * 색상·채도를 보존한다.
 *
 * `gain` 도 상수가 아니라 **측정값에서 나온다**: 격자 안쪽의 디테일 표준편차를 재서
 * {@link TARGET_DETAIL_STD} 에 닿도록 역산한다(상한 {@link MAX_DETAIL_GAIN}).
 *
 * ## 자리마다 다른 목표를 어떻게 이음매 없이 섞는가
 * 목표는 세 종류다 — 격자 **안쪽**({@link TARGET_INNER_L}), 그 **주변**
 * ({@link TARGET_SURROUND_L}), 그리고 **손대지 않는 바깥**(원화 그대로). 이것을 사각형 경계로
 * 자르면 선이 보인다. 그래서 행마다 거리 감쇠 두 개(안쪽/주변)를 만들고 **행 사이에서는
 * 최댓값**을 취한다(합이 아니다 — 합은 겹치는 자리를 두 배로 만든다. `scrim.ts` 헤더의 1px
 * 겹침 가로줄과 같은 함정이다). 감쇠가 0 인 곳에서는 `M = Lp`, `gain = 1` 이 되어 톤매핑이
 * **항등식**이 되므로, 처리 영역의 경계라는 것이 원리적으로 존재하지 않는다.
 *
 * 가장자리 비네트·하단 스크림은 톤매핑 **뒤에** 곱해지므로, 목표 휘도를 그 감쇠로 미리
 * 나눠 보정한다(상한 {@link COMP_MAX}) — 안 그러면 화면 가장자리 쪽 거터만 어두워져 균일성이
 * 깨진다.
 *
 * ## 피사계 심도 — 왜 필터가 아니라 구운 텍스처인가
 * 배경·타일·크롬이 전부 같은 초점면에 있으면 깊이가 안 생긴다. Pixi `BlurFilter` 는 **매 프레임
 * 2패스**라 오래 머무는 화면에서 계속 비용을 내는데, 배경은 절대 변하지 않으므로 캔버스에서
 * **1회 구워** 그 텍스처를 쓴다(런타임 비용 0). 같은 캔버스가 톤매핑의 입력이자 측정 표본이다.
 *
 * ## 자산 없이도 서야 한다
 * `tex` 가 `undefined` 면 절차적 폴백으로 넘어간다 — 짙은 바탕 + 청록·자홍 성운 얼룩 + 비네트
 * + 티끌. 그 경로에는 톤매핑할 원화가 없으므로 예전 방식의 가벼운 딤 한 장만 얹는다.
 *
 * ## 품질 티어
 * ⚠️ `graphicsTierController.getActiveTier()` 만 읽으면 안 된다. 그 컨트롤러는 `'high'` 로 시작해
 * 렌더 루프가 돌아야 갱신되는데, 기지는 **부팅 직후 진입할 수 있는 화면**이라 그때는 아직
 * 'high' 다 — 사용자가 품질을 'low' 로 못 박아 두었어도 저사양 폴백이 통째로 무력화된다(실측,
 * 타이틀에서 같은 함정을 밟았다). 설정의 명시적 오버라이드를 **직접** 읽는다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 을 읽지도 쓰지도 않고 시간축은 벽시계다.
 */

import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { effectGates } from '../../render/qualityTier.js';
import { graphicsTierController } from '../../render/graphicsRuntime.js';
import { graphicsSettings } from '../../render/graphicsSettings.js';
import { verticalScrimTexture } from './scrim.js';

// --- 움직임(디자인 스페이스 1920×1080) ---
/** 마우스 추종 최대 변위(px). 타이틀 26 의 절반 이하 — 오래 머무는 화면이라 절제한다. */
const MOUSE_RANGE = 11;
/** 마우스 목표값 추종 시상수. 커서가 튀어도 배경은 부드럽게 따라간다. */
const MOUSE_LERP = 2.6;
/** 자동 드리프트 — 입력이 없어도(터치 기기) 화면이 정지하지 않게. */
const DRIFT_AMPL = 7;
/** 서로소에 가까운 주기 — 왕복이 눈에 띄지 않는다. */
const DRIFT_PERIOD_X = 41;
const DRIFT_PERIOD_Y = 59;
/**
 * 레이어별 패럴랙스 계수. 배경판이 가장 크게, 공기(티끌)는 앞이라 더 크게 움직인다 —
 * 근경이 원경보다 더 움직이는 것이 깊이의 정의다. 비네트는 **전경 UI 에 붙는 것**이라 아예
 * 움직이지 않는다.
 */
const PARALLAX = { art: 1, air: 1.45 } as const;

/**
 * 배경판 오버스캔 배수. 드리프트(≈±18px)로 밀려도 가장자리가 드러나지 않을 만큼 크게 그린다.
 * 여유가 없으면 화면 끝에 빈 줄이 스치는데, 그 한 줄이 "합성물"이라는 인상을 만든다.
 */
const OVERSCAN = 1.1;

/**
 * 배경 흐림 반경(원화 픽셀). 디자인 스페이스 ~6px 에 해당한다(원화 1376 폭이 2112 로 늘어나
 * 확대율 ≈1.53 → 6/1.53 ≈ 4). 이보다 세게 걸면 석재 부조가 뭉개져 배경이 다시 "무특징
 * 어둠"이 된다 — 깊이를 얻으려고 랜드마크를 잃으면 손해다.
 */
const BLUR_RADIUS = 4;
/**
 * 국소 평균(저주파)을 뽑는 흐림 반경(원화 픽셀). 디자인 ~93px 에 해당한다.
 *
 * 실측으로 고른 값이다. 26(디자인 40px)에서는 카드 사이 거터 폭(디자인 30px)과 비슷해
 * **거터 안의 구조까지 평균에 먹혀** 되살릴 디테일이 남지 않았다(거터 std 6.5). 반대로
 * 140 이상이면 조명 얼룩이 통째로 디테일로 잡혀 거터끼리 밝기가 48 이나 벌어졌다. 60 이
 * 거터 안 구조를 남기면서 거터 사이 편차를 가장 작게 만든 지점이다.
 */
const LOWPASS_RADIUS = 60;

// --- 톤매핑 목표 ---
/**
 * 격자 행 **안쪽**(카드 사이 거터)의 목표 평균 휘도. 수용 기준 40~48 의 하단부 — 낮게 잡을수록
 * 카드와의 대비 여유가 커진다. 이 값은 **스케일이 아니라 지정값**이라 거터 셋이 원화 밝기와
 * 무관하게 같은 자리에 앉는다(균일성 Δ≤4 가 구조적으로 보장되는 근거).
 */
const TARGET_INNER_L = 55;
/** 격자 행 **바깥**(좌우·위아래 여백)의 목표 평균 휘도. 안쪽과 거의 같게 둬 화면이 갈리지 않게. */
const TARGET_SURROUND_L = 41;
/** 디테일 목표 표준편차. 수용 기준 std ≥ 30 에 여유를 둔 값. */
const TARGET_DETAIL_STD = 34;
/** 디테일 증폭 상한 — 원화에 없는 것을 만들어 낼 수는 없고, 과하면 압축 잡음이 올라온다. */
const MAX_DETAIL_GAIN = 2.4;
/** 비네트·스크림 선보정 상한. 가장자리에서 무한대로 부풀지 않게 막는다. */
const COMP_MAX = 1.7;
/**
 * 검정 바닥의 부드러운 하한(휘도). 이 아래로는 **자르지 않고** 지수적으로 수렴시킨다.
 *
 * 하드 클리핑(`max(v, 0)`)을 쓰면 어두운 화소가 통째로 0 에 뭉쳐 ①평균이 목표보다 훨씬
 * 아래로 끌려가고 ②그 구간의 대비가 사라진다 — 실측으로 확인한 함정이다(목표 44 를 걸었는데
 * 클리핑 때문에 21.9 로 앉았다). 지수 수렴은 어두운 쪽 기울기를 남긴다.
 */
const SOFT_FLOOR = 7;
/**
 * **국소 평균(`Lp`)의 하한.** 톤매핑 전체가 이 값에 걸려 있다 — 목표 평균의 약 40%.
 *
 * ⚠️ 이걸 비율 항의 분모에만 걸었다가 화면 하단 1/6 을 죽였다(실측: 하단 평균 7.5 · 순흑 화소
 * 1.32% = 직전판의 42배). `Lp` 가 0 에 가까우면 ①`m = Lp + (목표−Lp)·w` 가 0 근처에서 시작하고
 * ②대비 배율 `m/Lp` 이 함께 무너져, 세기가 중간인 자리(격자 아래·상단 코너)에서 출력이
 * `원화·(1−w)` 로 수렴한다 — 누르라고 하지도 않은 곳이 검게 꺼진다. **`Lp` 를 읽는 모든
 * 자리에서 하한을 건다**(평균식·디테일·배율 전부).
 */
const LP_FLOOR = 18;
/**
 * 처리된 배경 전체에 더하는 따뜻한 환경광(휘도). **곱이 아니라 합**이어야 한다 — 순흑 화소는
 * 어떤 배율로도 검정이라, RGB 스케일만으로는 `순흑 0.00%` 를 만들 수 없다(위 실측의 코너
 * 클러스터 15.8%·21.0%가 그 형태였다). 유적 안의 반사광으로 읽히는 최소량이다.
 */
const AMBIENT_LUM = 14;
/** 환경광 색(금빛 램프 반사). 아래 계수는 이 색을 휘도 1 로 정규화한 값이다. */
const AMBIENT_R = 1.1445;
const AMBIENT_G = 0.9829;
const AMBIENT_B = 0.7091;

// --- 톤매핑 영역 ---
/** 목표가 적용될 사각형(디자인 스페이스). */
export interface BaseVeilRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 기본 사각형 — **격자 행마다 하나**다. 리드가 `baseMap.ts` 에서 실제 격자 사각형을 넘기므로
 * (생성자 옵션) 이건 그 값이 없을 때의 폴백일 뿐이다. **행 개수는 어디에도 하드코딩되어 있지
 * 않다** — 아래 로직은 전부 이 배열을 순회한다.
 */
const DEFAULT_VEIL_RECTS: readonly BaseVeilRect[] = [
  { x0: 60, y0: 179, x1: 1860, y1: 507 },
  { x0: 290, y0: 567, x1: 1632, y1: 893 },
];

/** 안쪽 목표가 주변 목표로 넘어가는 거리(px). */
const INNER_REACH = 160;
/** 주변 목표가 원화 그대로로 돌아가는 거리(px). 여기서 톤매핑은 항등식이 된다. */
const SURROUND_REACH = 460;
/** 목표장 격자 해상도(디자인 스페이스). 15px 간격 — 감쇠가 저주파라 이중선형으로 충분히 매끄럽다. */
const FIELD_W = 128;
const FIELD_H = 72;
/** 디테일 표준편차를 잴 때의 원화 픽셀 보폭(전수 조사는 불필요하다). */
const MEASURE_STRIDE = 3;

/** 원화를 못 굽는 경우(폴백)의 격자 딤 알파. */
const FALLBACK_DIM_ALPHA = 0.36;
/** 폴백 딤 알파장 텍스처 해상도. */
const DIM_TEX_W = 320;
const DIM_TEX_H = 180;

// --- 거터 석재 리브 ---
/**
 * 리브 본체 폭(px). 거터 폭(약 24~30px)을 거의 채워, **거터에 무엇이 보이는지가 원화가 아니라
 * 이 리브로 결정되게** 한다. 배경이 교체돼도 거터의 밝기·주기가 격자 주기와 영구히 일치한다.
 */
const RIB_W = 24;
/**
 * 본체 세로 램프의 **기준색**(위 → 아래, 평균 휘도 ≈45.9). 위가 밝고 아래로 어두워지는,
 * 라벨 밴드와 같은 광원 규약이다.
 *
 * ⚠️ 이 값을 그대로 쓰지 않는다 — {@link ribRampColors} 가 {@link TARGET_INNER_L} 에서
 * 배율을 파생해 스케일한다. 거터에 실제로 보이는 것은 배경이 아니라 **리브**이므로, 목표
 * 휘도만 올리고 리브를 그대로 두면 거터는 꿈쩍도 하지 않는다(실측: 목표 44 인데 거터 37.6).
 * 상수 하나가 배경과 리브를 **함께** 움직여야 한다.
 */
const RIB_TOP_BASE = 0x4a3826;
const RIB_BOTTOM_BASE = 0x2a1e14;
/**
 * 리브 본체 램프 평균 → 화면 거터 평균의 실측 비율(0.82). 2px 그늘·좌우 배경 노출·비네트가
 * 깎아 내는 몫이다. 목표 휘도를 이 값으로 나눠 램프를 정한다.
 */
const RIB_COMPOSITE_K = 0.82;
/** 왼쪽 수광 립(1px)과 오른쪽 그늘(2px). 카드 베벨과 광원 방향이 같아야 한 장면으로 읽힌다. */
const RIB_LIP = 0xd9b070;
const RIB_LIP_ALPHA = 0.5;
const RIB_SHADE = 0x120b06;
const RIB_SHADE_ALPHA = 0.6;

/** 하단 비네트가 시작하는 y — CTA·메타 줄이 앉는 자리를 눌러 준다. */
const BOTTOM_SCRIM_TOP = 790;
/**
 * 0.44 → 0.34 로 낮췄다. 톤매핑이 목표 휘도를 스크림 감쇠로 미리 나눠 보정하는데, 0.44 는
 * 화면 맨 아래에서 보정 상한({@link COMP_MAX})을 넘겨 버려 보정이 불가능해진다 — 그 구간이
 * 곧 "격자 아래가 사라졌다"는 신고 지점이다.
 */
const BOTTOM_SCRIM_ALPHA = 0.34;
/**
 * 화면 네 변을 두르는 가장자리 비네트. 중앙 ~1/3 은 손대지 않고(plateau) 가장자리에서만
 * 최대 알파에 닿는다. 거터(화면 중앙부)에서의 값은 1% 미만이라 균일성을 해치지 않는다.
 */
const EDGE_VIGNETTE_ALPHA = 0.34;
const EDGE_VIGNETTE_PLATEAU_X = 0.34;
const EDGE_VIGNETTE_PLATEAU_Y = 0.3;

// --- 공기 ---
/** 먼지 티끌 수(고티어). 저티어는 절반. 타이틀보다 적다 — 오래 보는 화면이라 산만하면 안 된다. */
const MOTE_COUNT = 34;
/** 광선 스윕 1회 주기(초)와 통과 시간. 대부분의 시간 동안 화면에 없어야 "가끔"으로 읽힌다. */
const SHAFT_PERIOD = 21;
const SHAFT_SWEEP = 3.4;

/** 절차적 폴백 팔레트 — 타이틀·인트로와 같은 붓(청록·자홍 성운, 금빛 램프광). */
const FALLBACK_BASE = 0x120e1e;
const FALLBACK_NEBULA_TEAL = 0x2f8ca0;
const FALLBACK_NEBULA_MAGENTA = 0x8a3a72;
const FALLBACK_LAMP = 0xffca78;

interface Mote {
  gfx: Graphics;
  baseX: number;
  baseY: number;
  speed: number;
  phase: number;
  amp: number;
}

/** 아주 느리게 알파가 오가는 발광체(절차적 폴백의 성운 얼룩). */
interface Breather {
  sprite: Sprite;
  base: number;
  period: number;
  phase: number;
}

/**
 * 목표장 — 격자 위의 `목표 평균 휘도`와 `적용 세기`. 세기 0 이면 그 자리의 톤매핑은 항등식이다.
 */
interface TargetField {
  /** 목표 평균 휘도(비네트·스크림 선보정 포함). 세기 0 인 곳의 값은 의미가 없다. */
  lum: Float32Array;
  /** 적용 세기 0..1. */
  weight: Float32Array;
}

/** 격자 사이에 세우는 세로 석재 리브(디자인 스페이스). `x` 는 **중심선**이다. */
export interface BaseRib {
  x: number;
  y0: number;
  y1: number;
}

/** 생성자 옵션. 전부 선택적이다 — 리드가 아무것도 넘기지 않아도 기본값으로 선다. */
export interface BaseBackdropOpts {
  /**
   * 타일 격자 행 사각형(디자인 스페이스). 행 개수 제한 없음 — 각 사각형이 같은 규칙으로
   * 처리된다. 넘기지 않으면 {@link DEFAULT_VEIL_RECTS}.
   */
  veilRects?: readonly BaseVeilRect[];
  /**
   * 카드 사이 거터에 세우는 세로 석재 리브. **리드가 격자에서 파생해 넘긴다** — 여기서
   * 좌표를 하드코딩하면 격자가 바뀌는 순간 어긋난다. 넘기지 않으면 리브가 없다.
   */
  ribs?: readonly BaseRib[];
}

/**
 * 지금 유효한 이펙트 게이트. 오버라이드가 있으면 컨트롤러 대신 그 값을 쓴다 — 부팅 직후
 * 컨트롤러가 'high' 로 거짓말하는 창을 건너뛰기 위해서다(헤더 "품질 티어" 참조).
 */
function currentGates(): ReturnType<typeof effectGates> {
  const settings = graphicsSettings.getSettings();
  const tier =
    settings.quality === 'auto' ? graphicsTierController.getActiveTier() : settings.quality;
  return effectGates(tier, settings);
}

/** 0..1 을 부드럽게 잇는 표준 smoothstep(양 끝 기울기 0 — 단차가 눈에 남지 않는다). */
function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * 중심에서 `plateau` 까지 1, 거기서 경계까지 0 으로 떨어지는 축별 페이드. 가로·세로를 곱해
 * 쓰므로 모서리가 자연히 둥글고, 경계에서 정확히 0 이라 테두리가 생기지 않는다.
 */
function axisFade(u: number, plateau: number): number {
  const a = Math.abs(u);
  if (a <= plateau) return 1;
  if (plateau >= 1) return 1;
  return 1 - smoothstep((a - plateau) / (1 - plateau));
}

/** 점에서 사각형까지의 거리(안이면 0). 유클리드라 모서리가 자연히 둥글다. */
function distToRect(rect: BaseVeilRect, x: number, y: number): number {
  const dx = Math.max(rect.x0 - x, x - rect.x1, 0);
  const dy = Math.max(rect.y0 - y, y - rect.y1, 0);
  return Math.hypot(dx, dy);
}

/**
 * 가장자리 비네트의 알파(해석식). 굽는 텍스처와 **같은 식**이어야 선보정이 실제 화면과 맞는다 —
 * 그래서 상수를 공유하고 식을 한 군데만 둔다.
 */
function edgeVignetteAlpha(x: number, y: number): number {
  const nx = (x / DESIGN_WIDTH) * 2 - 1;
  const ny = (y / DESIGN_HEIGHT) * 2 - 1;
  const inner = axisFade(nx, EDGE_VIGNETTE_PLATEAU_X) * axisFade(ny, EDGE_VIGNETTE_PLATEAU_Y);
  return EDGE_VIGNETTE_ALPHA * (1 - inner) ** 1.6;
}

/** 하단 스크림의 알파(해석식). `scrim.ts` 의 감마 1.6 램프와 같은 곡선이다. */
function bottomScrimAlpha(y: number): number {
  if (y <= BOTTOM_SCRIM_TOP) return 0;
  const t = (y - BOTTOM_SCRIM_TOP) / (DESIGN_HEIGHT - BOTTOM_SCRIM_TOP);
  return BOTTOM_SCRIM_ALPHA * Math.min(1, t) ** 1.6;
}

/** Rec.601 루마. */
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** 정수색의 루마. */
function colorLuma(c: number): number {
  return luma((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff);
}

/** 정수색을 배율만큼 밝힌다(색상 보존 — 채널 비를 유지한다). */
function scaleColor(c: number, s: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 0xff) * s));
  const g = Math.min(255, Math.round(((c >> 8) & 0xff) * s));
  const b = Math.min(255, Math.round((c & 0xff) * s));
  return (r << 16) | (g << 8) | b;
}

/**
 * 리브 본체 램프 색 — {@link TARGET_INNER_L} **에서 파생한다.** 배경 목표와 리브가 한 상수에
 * 묶여 있어야 거터 밝기를 한 군데서 조절할 수 있다(둘을 따로 적으면 반드시 어긋난다).
 */
function ribRampColors(): { top: number; bottom: number } {
  const baseMean = (colorLuma(RIB_TOP_BASE) + colorLuma(RIB_BOTTOM_BASE)) / 2;
  const s = TARGET_INNER_L / RIB_COMPOSITE_K / baseMean;
  return { top: scaleColor(RIB_TOP_BASE, s), bottom: scaleColor(RIB_BOTTOM_BASE, s) };
}

/**
 * 검정 바닥을 **자르지 않고** 부드럽게 수렴시킨다. `SOFT_FLOOR` 위는 항등식이고, 아래는
 * 지수적으로 0 에 가까워진다 — 하드 클리핑이 만드는 "뭉친 검정"과 그로 인한 평균 붕괴를
 * 피하기 위해서다({@link SOFT_FLOOR} 주석 참조).
 */
function softFloor(v: number): number {
  return v >= SOFT_FLOOR ? v : SOFT_FLOOR * Math.exp((v - SOFT_FLOOR) / SOFT_FLOOR);
}

/** 캔버스 2D 컨텍스트를 만든다. 없는 환경(vitest)에서는 null — 호출부가 그 없이도 서야 한다. */
function makeCtx(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas.getContext('2d', { willReadFrequently: true });
}

/** 캔버스를 Pixi 텍스처로(항상 `linear` — 저주파 장을 늘려 쓰기 때문). */
function canvasTexture(ctx: CanvasRenderingContext2D): Texture {
  const tex = new Texture({ source: new CanvasSource({ resource: ctx.canvas }) });
  tex.source.scaleMode = 'linear';
  return tex;
}

/**
 * 부드러운 사각형(또는 `plateau` 0 이면 블롭) 알파장을 픽셀로 굽는다.
 * @param invert true 면 중앙이 0, 가장자리가 최대(비네트).
 */
function bakeSoftRect(
  color: number,
  maxAlpha: number,
  plateauX: number,
  plateauY: number,
  invert = false,
): Texture | null {
  const w = 128;
  const h = 80;
  const ctx = makeCtx(w, h);
  if (ctx === null) return null;
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const ny = ((y + 0.5) / h) * 2 - 1;
    const fy = axisFade(ny, plateauY);
    for (let x = 0; x < w; x++) {
      const nx = ((x + 0.5) / w) * 2 - 1;
      const inner = axisFade(nx, plateauX) * fy;
      const a = maxAlpha * (invert ? (1 - inner) ** 1.6 : inner);
      const i = (y * w + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(ctx);
}

/**
 * 세로 색 램프 텍스처(1×256). 얇은 띠를 겹쳐 근사하지 않는다 — 1px 겹침이 알파를 두 배로
 * 만들어 가로줄을 남기는 함정이 이 리포에 이미 있다(`scrim.ts` 헤더).
 */
function bakeVerticalRamp(top: number, bottom: number): Texture | null {
  const h = 256;
  const ctx = makeCtx(1, h);
  if (ctx === null) return null;
  const r0 = (top >> 16) & 0xff;
  const g0 = (top >> 8) & 0xff;
  const b0 = top & 0xff;
  const r1 = (bottom >> 16) & 0xff;
  const g1 = (bottom >> 8) & 0xff;
  const b1 = bottom & 0xff;
  const img = ctx.createImageData(1, h);
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    img.data[y * 4] = r0 + (r1 - r0) * t;
    img.data[y * 4 + 1] = g0 + (g1 - g0) * t;
    img.data[y * 4 + 2] = b0 + (b1 - b0) * t;
    img.data[y * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(ctx);
}

/** 캔버스에 그릴 수 있는 이미지 자원인가(구울 수 없는 자원이면 톤매핑을 포기한다). */
function drawableSource(res: unknown): CanvasImageSource | null {
  if (typeof HTMLImageElement !== 'undefined' && res instanceof HTMLImageElement) return res;
  if (typeof HTMLCanvasElement !== 'undefined' && res instanceof HTMLCanvasElement) return res;
  if (typeof ImageBitmap !== 'undefined' && res instanceof ImageBitmap) return res;
  return null;
}

/**
 * 원화를 지정 반경으로 흐려 굽고 화소를 돌려준다.
 *
 * 캔버스 `filter: blur()` 는 경계 바깥을 투명검정으로 샘플링해 테두리에 어두운 띠를 남긴다.
 * 그래서 원본을 반경의 몇 배만큼 **확대해 그려** 그 띠가 캔버스 밖으로 나가게 한다. 어차피
 * 오버스캔으로 더 확대돼 쓰이므로 잘려 나가는 몇 픽셀은 화면에 없다.
 */
function blurPixels(
  src: CanvasImageSource,
  w: number,
  h: number,
  radius: number,
): Uint8ClampedArray | null {
  const ctx = makeCtx(w, h);
  if (ctx === null) return null;
  try {
    ctx.filter = `blur(${radius}px)`;
    const grow = 1 + (radius * 3) / Math.min(w, h);
    const dw = w * grow;
    const dh = h * grow;
    ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.filter = 'none';
    return ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null; // `filter` 미지원 · CORS 오염 — 톤매핑을 포기한다.
  }
}

/** 텍스처를 화면 중앙에 `scale` 배 오버스캔으로 놓은 스프라이트(타이틀과 같은 규약). */
function coverSprite(tex: Texture, scale: number): Sprite {
  const s = new Sprite(tex);
  s.anchor.set(0.5);
  const k = Math.max(DESIGN_WIDTH / tex.width, DESIGN_HEIGHT / tex.height) * scale;
  s.scale.set(k);
  s.position.set(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);
  return s;
}

/** 결정적 의사난수 — 매 생성마다 배치가 튀지 않게 인덱스에서 파생한다(타이틀과 같은 식). */
function hash01(seed: number): number {
  return (((Math.sin(seed) * 43758.5453) % 1) + 1) % 1;
}

/**
 * 목표장을 격자에 굽는다. **행 인덱스를 순회하는 이 함수 하나가 모든 행의 목표 밝기를
 * 정한다** — 행마다 다른 상수를 두는 것이 원리적으로 불가능하다(2차 실패의 형태였다).
 *
 * 행별 기여는 거리의 연속 감쇠 두 개이고, 행 사이에서는 **최댓값**을 취한다(합이 아니다).
 * `ws` 가 0 인 곳에서는 세기도 0 이라 톤매핑이 항등식이 되므로 경계가 생기지 않는다.
 */
function buildTargetField(rects: readonly BaseVeilRect[]): TargetField {
  const lum = new Float32Array(FIELD_W * FIELD_H);
  const weight = new Float32Array(FIELD_W * FIELD_H);
  for (let gy = 0; gy < FIELD_H; gy++) {
    const y = ((gy + 0.5) / FIELD_H) * DESIGN_HEIGHT;
    for (let gx = 0; gx < FIELD_W; gx++) {
      const x = ((gx + 0.5) / FIELD_W) * DESIGN_WIDTH;
      let wi = 0;
      let ws = 0;
      for (const rect of rects) {
        const d = distToRect(rect, x, y);
        if (d < INNER_REACH) {
          const a = 1 - smoothstep(d / INNER_REACH);
          if (a > wi) wi = a;
        }
        if (d < SURROUND_REACH) {
          const a = 1 - smoothstep(d / SURROUND_REACH);
          if (a > ws) ws = a;
        }
      }
      const i = gy * FIELD_W + gx;
      if (ws <= 1e-4) {
        weight[i] = 0;
        lum[i] = 0;
        continue;
      }
      // 안쪽 기여 wi 는 항상 ws 이하다(도달 거리가 짧으므로) — 나머지가 주변 몫이다.
      const target = (wi * TARGET_INNER_L + (ws - wi) * TARGET_SURROUND_L) / ws;
      // 비네트·스크림은 톤매핑 뒤에 곱해진다 — 미리 나눠 두어야 화면에서 목표에 앉는다.
      const atten = (1 - edgeVignetteAlpha(x, y)) * (1 - bottomScrimAlpha(y));
      const comp = Math.min(COMP_MAX, atten > 0.01 ? 1 / atten : COMP_MAX);
      weight[i] = ws;
      lum[i] = target * comp;
    }
  }
  return { lum, weight };
}

/** 목표장을 디자인 좌표에서 이중선형 보간한다(격자 15px — 감쇠가 저주파라 충분히 매끄럽다). */
function sampleField(field: Float32Array, x: number, y: number): number {
  const fx = Math.min(FIELD_W - 1, Math.max(0, (x / DESIGN_WIDTH) * FIELD_W - 0.5));
  const fy = Math.min(FIELD_H - 1, Math.max(0, (y / DESIGN_HEIGHT) * FIELD_H - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(FIELD_W - 1, x0 + 1);
  const y1 = Math.min(FIELD_H - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const v00 = field[y0 * FIELD_W + x0] ?? 0;
  const v10 = field[y0 * FIELD_W + x1] ?? 0;
  const v01 = field[y1 * FIELD_W + x0] ?? 0;
  const v11 = field[y1 * FIELD_W + x1] ?? 0;
  return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
}

/**
 * 국소 톤매핑된 배경을 굽는다(헤더 "왜 딤 오버레이가 아니라 국소 톤매핑인가" 참조).
 * 실패하면 `null` — 호출부는 원본을 그대로 쓰고 폴백 딤으로 물러난다.
 */
function bakeToneMapped(tex: Texture, rects: readonly BaseVeilRect[]): Texture | null {
  const w = Math.round(tex.source.width);
  const h = Math.round(tex.source.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const src = drawableSource(tex.source.resource);
  if (src === null) return null;
  const detailPx = blurPixels(src, w, h, BLUR_RADIUS);
  const lowPx = blurPixels(src, w, h, LOWPASS_RADIUS);
  if (detailPx === null || lowPx === null) return null;
  const outCtx = makeCtx(w, h);
  if (outCtx === null) return null;

  // 원화 화소 → 디자인 좌표(`coverSprite` 와 **같은 매핑**이어야 엉뚱한 자리를 처리하지 않는다).
  const k = Math.max(DESIGN_WIDTH / w, DESIGN_HEIGHT / h) * OVERSCAN;
  const designX = (sx: number): number => DESIGN_WIDTH / 2 + (sx - w / 2) * k;
  const designY = (sy: number): number => DESIGN_HEIGHT / 2 + (sy - h / 2) * k;

  const field = buildTargetField(rects);

  // --- 1패스: 처리 영역 안의 **정규화된** 디테일 표준편차를 재서 증폭률을 역산한다 ---
  // 디테일을 그대로 재면 안 된다. 어두워진 뒤의 대비는 `목표평균/국소평균` 만큼 함께 줄어드는데
  // (곱연산이라서), 그 축소 뒤의 값이 화면에 나오는 값이다. 그래서 재는 단계에서 미리 곱한다.
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  for (let sy = 0; sy < h; sy += MEASURE_STRIDE) {
    const dy = designY(sy);
    for (let sx = 0; sx < w; sx += MEASURE_STRIDE) {
      const dx = designX(sx);
      // 격자 안쪽(카드 사이 거터)이 판정 대상이다 — 수용 기준이 그 자리의 std 로 적혀 있다.
      if (sampleField(field.weight, dx, dy) < 0.999) continue;
      const i = (sy * w + sx) * 4;
      const lumLp = Math.max(LP_FLOOR, luma(lowPx[i] ?? 0, lowPx[i + 1] ?? 0, lowPx[i + 2] ?? 0));
      const detail =
        (luma(detailPx[i] ?? 0, detailPx[i + 1] ?? 0, detailPx[i + 2] ?? 0) - lumLp) *
        (sampleField(field.lum, dx, dy) / lumLp);
      sum += detail;
      sumSq += detail * detail;
      n++;
    }
  }
  let gain = 1;
  if (n > 16) {
    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
    if (std > 1) gain = Math.min(MAX_DETAIL_GAIN, Math.max(1, TARGET_DETAIL_STD / std));
  }

  // --- 2패스: 픽셀마다 목표 평균 + 증폭된 디테일 ---
  const out = outCtx.createImageData(w, h);
  for (let sy = 0; sy < h; sy++) {
    const dy = designY(sy);
    for (let sx = 0; sx < w; sx++) {
      const i = (sy * w + sx) * 4;
      const r = detailPx[i] ?? 0;
      const g = detailPx[i + 1] ?? 0;
      const b = detailPx[i + 2] ?? 0;
      const dx = designX(sx);
      const wgt = sampleField(field.weight, dx, dy);
      const lumA = luma(r, g, b);
      let outLum = lumA;
      if (wgt > 1e-3) {
        // **하한이 걸린 국소 평균.** 아래 세 식이 전부 이 값을 쓴다 — 하나라도 날것의 `Lp` 를
        // 쓰면 어두운 자리에서 출력이 무너진다({@link LP_FLOOR} 주석의 실측).
        const lumLp = Math.max(LP_FLOOR, luma(lowPx[i] ?? 0, lowPx[i + 1] ?? 0, lowPx[i + 2] ?? 0));
        const target = sampleField(field.lum, dx, dy);
        const m = lumLp + (target - lumLp) * wgt;
        // 대비는 **절대량이 아니라 비율**로 옮긴다(`m/Lp`). 어두워진 자리에 원래 밝기의 진폭을
        // 그대로 얹으면 음수로 내려가 검게 잘리고, 그 클리핑이 다시 대비를 죽인다.
        // 세기 0 → m = Lp, 배율 1, gain 1 → out = A(항등식). 처리 경계가 원리적으로 없다.
        const detailScale = 1 + wgt * (m / lumLp - 1);
        const gEff = 1 + (gain - 1) * wgt;
        outLum = softFloor(m + (lumA - lumLp) * gEff * detailScale);
      }
      // RGB 는 휘도 비로만 민다 — 색상·채도를 보존하기 위해서다. 그 뒤 환경광을 **더한다**:
      // 곱은 순흑 화소를 절대 들어올리지 못한다(0 × 무엇 = 0).
      const scale = Math.max(0, outLum / Math.max(1, lumA));
      out.data[i] = Math.min(255, r * scale + AMBIENT_LUM * AMBIENT_R);
      out.data[i + 1] = Math.min(255, g * scale + AMBIENT_LUM * AMBIENT_G);
      out.data[i + 2] = Math.min(255, b * scale + AMBIENT_LUM * AMBIENT_B);
      out.data[i + 3] = 255;
    }
  }
  outCtx.putImageData(out, 0, 0);
  return canvasTexture(outCtx);
}

export class BaseBackdrop {
  /** 리드가 root 맨 뒤에 붙인다. */
  readonly view = new Container();

  /** 패럴랙스가 붙는 레이어. 비네트는 여기 들어가지 않는다(고정). */
  private readonly artLayer = new Container();
  private readonly airLayer = new Container();

  private readonly motes: Mote[] = [];
  private shaft: Graphics | null = null;
  /** 절차적 폴백의 성운 얼룩 — 아주 느리게 숨 쉬듯 알파가 오간다. */
  private readonly breathers: Breather[] = [];
  /** 톤매핑으로 구운 텍스처. `view.destroy` 가 모르는 자원이라 직접 반납한다. */
  private bakedArt: Texture | null = null;

  /** 격자 행 사각형(리드가 넘긴 실제 배치 또는 폴백). */
  private readonly rects: readonly BaseVeilRect[];

  private time = 0;
  private aimX = 0;
  private aimY = 0;
  private curX = 0;
  private curY = 0;
  private readonly onPointerMove: (e: PointerEvent) => void;

  constructor(tex: Texture | undefined, opts?: BaseBackdropOpts) {
    this.rects = opts?.veilRects ?? DEFAULT_VEIL_RECTS;

    // 캔버스가 아니라 window 에 건다 — 커서가 캔버스 밖으로 나가도 마지막 값이 굳지 않고,
    // Pixi 이벤트 계층(위에 깔린 타일이 포인터를 삼키는 문제)과도 무관해진다.
    this.onPointerMove = (e: PointerEvent) => {
      if (!this.view.visible) return;
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      this.aimX = ((e.clientX / w) * 2 - 1) * MOUSE_RANGE;
      this.aimY = ((e.clientY / h) * 2 - 1) * MOUSE_RANGE;
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    }

    const gates = currentGates();

    // --- 바닥 ---
    // 자산이 없거나 로드 전이어도 화면이 비지 않게. 오버스캔 배경 뒤에도 늘 깔아 둔다.
    const floor = new Graphics();
    floor.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: FALLBACK_BASE });
    this.view.addChild(floor);

    this.view.addChild(this.artLayer);
    this.view.addChild(this.airLayer);

    if (tex !== undefined) {
      // 흐림(피사계 심도) + 국소 톤매핑을 한 번에 구운다.
      this.bakedArt = bakeToneMapped(tex, this.rects);
      this.artLayer.addChild(coverSprite(this.bakedArt ?? tex, OVERSCAN));
    } else {
      this.buildProceduralArt();
    }

    // --- 공기: 먼지 티끌 ---
    if (gates.particles !== 'off') {
      const count = gates.particles === 'min' ? Math.round(MOTE_COUNT / 2) : MOTE_COUNT;
      for (let i = 0; i < count; i++) {
        const r1 = hash01((i + 1) * 12.9898);
        const r2 = hash01((i + 1) * 78.233);
        const r3 = hash01((i + 1) * 39.425);
        const g = new Graphics();
        g.circle(0, 0, 1.1 + r3 * 2.1).fill({ color: 0xffe6bb, alpha: 0.16 + r3 * 0.22 });
        // 가산 — 어두운 배경 위에서 램프광 속 먼지처럼 읽힌다(tint 는 곱연산이라 밝힐 수 없다).
        g.blendMode = 'add';
        const mote: Mote = {
          gfx: g,
          baseX: r1 * DESIGN_WIDTH,
          baseY: DESIGN_HEIGHT * 0.45 + r2 * DESIGN_HEIGHT * 0.62,
          // 타이틀(6~22)보다 느리다 — 오래 보는 화면에서는 빠른 입자가 시선을 뺏는다.
          speed: 3.5 + r3 * 9,
          phase: r1 * Math.PI * 2,
          amp: 5 + r2 * 11,
        };
        g.position.set(mote.baseX, mote.baseY);
        this.airLayer.addChild(g);
        this.motes.push(mote);
      }
    }

    // --- 공기: 가끔 지나는 광선(가산) ---
    if (gates.halo) {
      // 단일 사각형이면 좌우 경계가 칼같이 서서 **광선이 아니라 띠**로 읽힌다(타이틀 실측).
      // Pixi Graphics 에는 그라디언트가 없으므로 폭이 다른 사각형을 중심에서 겹쳐 쌓아 단면을
      // 만든다 — 같은 색을 가산으로 쌓는 것이라 알파 이중가산 가로줄(scrim 함정)과는 무관하다.
      const shaft = new Graphics();
      const slabs = 7;
      for (let i = slabs; i >= 1; i--) {
        const halfW = 30 * i;
        const a = 0.075 * (1 - (i - 1) / slabs) ** 1.5;
        shaft
          .rect(-halfW, -DESIGN_HEIGHT, halfW * 2, DESIGN_HEIGHT * 3)
          .fill({ color: FALLBACK_LAMP, alpha: a });
      }
      shaft.rotation = 0.22;
      shaft.y = DESIGN_HEIGHT / 2;
      shaft.blendMode = 'add';
      shaft.visible = false;
      this.airLayer.addChild(shaft);
      this.shaft = shaft;
    }

    // --- 대비 장치(고정 — 패럴랙스 밖) ---
    // 톤매핑이 성공했으면 딤은 **없다**(그게 3차 실패의 원인이었다). 실패했을 때만 최소한의
    // 딤을 얹어 카드가 배경에 묻히지 않게 한다.
    if (this.bakedArt === null) this.buildFallbackDim();
    this.buildRibs(opts?.ribs ?? []);
    this.buildVignettes();
  }

  /** 자산이 없을 때의 절차적 배경 — 짙은 바탕 위 성운 얼룩 + 좌우 램프광. */
  private buildProceduralArt(): void {
    const put = (
      color: number,
      x: number,
      y: number,
      w: number,
      h: number,
      alpha: number,
      period: number,
    ): void => {
      const tex = bakeSoftRect(color, 1, 0, 0);
      if (tex === null) return;
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.width = w;
      s.height = h;
      s.position.set(x, y);
      s.alpha = alpha;
      s.blendMode = 'add';
      this.artLayer.addChild(s);
      this.breathers.push({ sprite: s, base: alpha, period, phase: this.breathers.length });
    };

    // 성운 두 덩이 — 중앙 위쪽(아치 너머)에서 청록·자홍이 겹친다.
    put(FALLBACK_NEBULA_TEAL, 900, 380, 1500, 900, 0.52, 23);
    put(FALLBACK_NEBULA_MAGENTA, 1180, 300, 1150, 720, 0.36, 31);
    // 좌우 벽의 금색 램프광 — 화면 양옆을 따뜻하게 붙잡아 "실내"로 읽히게 한다.
    put(FALLBACK_LAMP, 120, 620, 900, 1300, 0.22, 37);
    put(FALLBACK_LAMP, DESIGN_WIDTH - 120, 620, 900, 1300, 0.22, 43);
  }

  /**
   * 톤매핑을 못 구운 경로(자산 없음·캔버스 없음·CORS)에서만 쓰는 최소 딤 한 장. 텍셀 알파 =
   * 행별 감쇠의 **최댓값**이라 행이 가까워도 알파가 이중으로 쌓이지 않는다.
   */
  private buildFallbackDim(): void {
    if (this.rects.length === 0) return;
    const ctx = makeCtx(DIM_TEX_W, DIM_TEX_H);
    if (ctx === null) return;
    const img = ctx.createImageData(DIM_TEX_W, DIM_TEX_H);
    for (let ty = 0; ty < DIM_TEX_H; ty++) {
      const py = ((ty + 0.5) / DIM_TEX_H) * DESIGN_HEIGHT;
      for (let tx = 0; tx < DIM_TEX_W; tx++) {
        const px = ((tx + 0.5) / DIM_TEX_W) * DESIGN_WIDTH;
        let best = 0;
        for (const rect of this.rects) {
          const d = distToRect(rect, px, py);
          if (d >= INNER_REACH) continue;
          const a = FALLBACK_DIM_ALPHA * (1 - smoothstep(d / INNER_REACH));
          if (a > best) best = a;
        }
        const i = (ty * DIM_TEX_W + tx) * 4;
        img.data[i] = 0x0a;
        img.data[i + 1] = 0x08;
        img.data[i + 2] = 0x12;
        img.data[i + 3] = Math.round(best * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const s = new Sprite(canvasTexture(ctx));
    s.position.set(0, 0);
    s.width = DESIGN_WIDTH;
    s.height = DESIGN_HEIGHT;
    this.view.addChild(s);
  }

  /**
   * 거터 석재 리브 — **격자를 원화 위에 얹는 대신, 격자를 담는 크롬을 그리고 그 뒤에 원화를
   * 둔다.** AAA 허브가 실제로 쓰는 구성이다.
   *
   * 왜 필요한가: 원화에는 밝은 세로 대역이 분명히 있는데(실측 L61~63), 그 주기가 격자 주기
   * (458px)와 맞지 않아 하필 카드 뒤에 깔리고 거터에는 어두운 대역이 깔렸다. 원화를 아무리
   * 톤매핑해도 이 위상 불일치는 못 고친다 — 배경이 교체되면 또 어긋난다. 리브는 격자에서
   * 파생한 좌표에 서므로 **어떤 배경을 끼워도 거터의 리듬이 격자와 일치**한다.
   *
   * 본체는 세로 램프(구운 텍스처 — 띠 근사 금지), 좌우는 1px 수광 립 / 2px 그늘이다.
   */
  private buildRibs(ribs: readonly BaseRib[]): void {
    if (ribs.length === 0) return;
    const ramp = ribRampColors();
    const bodyTex = bakeVerticalRamp(ramp.top, ramp.bottom);
    const host = new Container();
    for (const rib of ribs) {
      const h = rib.y1 - rib.y0;
      if (h <= 0) continue;
      const left = rib.x - RIB_W / 2;
      if (bodyTex !== null) {
        const body = new Sprite(bodyTex);
        body.position.set(left, rib.y0);
        body.width = RIB_W;
        body.height = h;
        host.addChild(body);
      }
      const edges = new Graphics();
      // 왼쪽 수광 립(1px) · 오른쪽 그늘(2px) — 카드 베벨과 같은 광원 방향.
      edges.rect(left, rib.y0, 1, h).fill({ color: RIB_LIP, alpha: RIB_LIP_ALPHA });
      edges
        .rect(left + RIB_W - 2, rib.y0, 2, h)
        .fill({ color: RIB_SHADE, alpha: RIB_SHADE_ALPHA });
      host.addChild(edges);
    }
    this.view.addChild(host);
  }

  /** 하단 스크림(CTA·메타 줄 자리) + 네 변 비네트(시선을 화면 안쪽으로 모은다). */
  private buildVignettes(): void {
    const edge = bakeSoftRect(
      0x07050e,
      EDGE_VIGNETTE_ALPHA,
      EDGE_VIGNETTE_PLATEAU_X,
      EDGE_VIGNETTE_PLATEAU_Y,
      true,
    );
    if (edge !== null) {
      const s = new Sprite(edge);
      s.position.set(0, 0);
      s.width = DESIGN_WIDTH;
      s.height = DESIGN_HEIGHT;
      this.view.addChild(s);
    }
    // 세로 램프는 공용 `scrim.ts` 를 쓴다 — 띠 근사가 만들던 가로줄을 없앤 자리다.
    const scrimTex = verticalScrimTexture(0, BOTTOM_SCRIM_ALPHA);
    if (scrimTex !== null) {
      const scrim = new Sprite(scrimTex);
      scrim.position.set(0, BOTTOM_SCRIM_TOP);
      scrim.width = DESIGN_WIDTH;
      scrim.height = DESIGN_HEIGHT - BOTTOM_SCRIM_TOP;
      this.view.addChild(scrim);
    }
  }

  /** 매 프레임 진행. `dt` 는 **벽시계 초**다. 숨겨져 있으면 아무것도 하지 않는다. */
  update(dt: number): void {
    if (!this.view.visible) return;
    this.time += dt;

    // 지수 추종 — 프레임률이 달라도 같은 시상수가 되도록 dt 지수 감쇠를 쓴다.
    const k = 1 - Math.exp(-MOUSE_LERP * dt);
    this.curX += (this.aimX - this.curX) * k;
    this.curY += (this.aimY - this.curY) * k;

    const driftX = Math.sin((this.time / DRIFT_PERIOD_X) * Math.PI * 2) * DRIFT_AMPL;
    const driftY = Math.cos((this.time / DRIFT_PERIOD_Y) * Math.PI * 2) * DRIFT_AMPL * 0.6;
    const ox = this.curX + driftX;
    const oy = this.curY + driftY;

    this.artLayer.position.set(ox * PARALLAX.art, oy * PARALLAX.art);
    this.airLayer.position.set(ox * PARALLAX.air, oy * PARALLAX.air);

    // 먼지 — 아주 느리게 떠오른다. 위로 벗어나면 아래로 되감는다.
    for (const m of this.motes) {
      m.gfx.y = m.baseY - ((this.time * m.speed) % (DESIGN_HEIGHT * 0.75));
      m.gfx.x = m.baseX + Math.sin(this.time * 0.4 + m.phase) * m.amp;
    }

    // 발광체의 미세한 호흡 — 폴백에서도 화면이 완전히 정지하지 않게(기준값 ±10%).
    for (const b of this.breathers) {
      b.sprite.alpha = b.base * (1 + 0.1 * Math.sin((this.time / b.period) * Math.PI * 2 + b.phase));
    }

    // 광선 — 주기의 앞부분(SHAFT_SWEEP 초) 동안만 화면을 가로지른다.
    const shaft = this.shaft;
    if (shaft !== null) {
      const phase = this.time % SHAFT_PERIOD;
      if (phase < SHAFT_SWEEP) {
        const p = phase / SHAFT_SWEEP;
        shaft.visible = true;
        shaft.x = DESIGN_WIDTH * (-0.3 + p * 1.6);
        // 양 끝에서 0 이 되는 사인 페이드 — 갑자기 나타났다 사라지지 않게.
        shaft.alpha = Math.sin(p * Math.PI);
      } else {
        shaft.visible = false;
      }
    }
  }

  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.onPointerMove);
    }
    this.motes.length = 0;
    this.breathers.length = 0;
    this.shaft = null;
    this.view.destroy({ children: true });
    // 구운 텍스처는 스프라이트가 아니라 우리가 만든 자원이다 — 직접 반납한다.
    this.bakedArt?.destroy(true);
    this.bakedArt = null;
  }
}
