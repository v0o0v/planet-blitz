/**
 * 기지 화면 배경 — 풀블리드 시네마틱 키아트 + 절제된 패럴랙스 + 공기(티끌·광선) + 국소 톤매핑.
 *
 * ## 왜 배경이 "한 장 붙이기"가 아닌가
 * 기지는 **오래 머무는 화면**이다. 정지 이미지 한 장은 몇 초만 지나면 배경이 아니라 벽지로
 * 읽히고, 그 위에 놓인 타일이 종이처럼 떠 보인다. 그래서 이 클래스는 ①시선에 따라 아주 조금
 * 움직이고 ②입력이 없어도 스스로 표류하며 ③공기(먼지·상시 걸린 평행 광축)를 가진다. 장소가
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
// 140 원화px ≈ 디자인 215px. 60(≈93px) 이었을 때 홀의 깊이·화로·바닥 안개가 통째로 평탄해졌다
// — 커널보다 큰 구조는 전부 "국소 평균"으로 흡수돼 사라지기 때문이다. 조명 얼룩만 고르고
// 회화는 남기는 경계가 이 값이다.
const LOWPASS_RADIUS = 140;

// --- 톤매핑 목표 ---
/**
 * 격자 행 **안쪽**(카드 사이 거터)의 목표 평균 휘도. 수용 기준 40~48 의 하단부 — 낮게 잡을수록
 * 카드와의 대비 여유가 커진다. 이 값은 **스케일이 아니라 지정값**이라 거터 셋이 원화 밝기와
 * 무관하게 같은 자리에 앉는다(균일성 Δ≤4 가 구조적으로 보장되는 근거).
 */
/**
 * 국소 평균을 목표로 얼마나 끌어당길지(0=원화 그대로, 1=완전 정규화).
 *
 * ⚠️ **한때 1(완전 정규화)이었고, 그게 배경을 회화에서 평평한 갈회색 벽으로 만든 원인이다.**
 * "네거티브 스페이스를 균일하게" 라는 기준을 정직하게 달성하면 **배경이 회화이기를 그만둔다** —
 * 둘은 같은 말이다. 매크로 대비 실측이 그걸 보여 줬다(상단대 std 19.3 → 9.6, 행 사이 16.9 → 7.1).
 *
 * 지금은 노출만 살짝 고르고(15%) 홀의 깊이·화로·바닥 안개는 원화 그대로 둔다. 진짜 결함
 * (우측 레일 폭주·죽은 바닥·순흑)은 균일화가 아니라 **전용 장치**가 맡는다 — 띠형 비네트,
 * 하단 가산 리프트, 환경광.
 */
const NORM_STRENGTH = 0.15;
/**
 * 격자 안쪽 목표 평균 휘도. {@link NORM_STRENGTH} 가 낮아 이제는 미세 조정용이다 —
 * 거터 평균을 이 값으로 못 박던 시절의 기준(52~58)은 폐기됐고, 그 자리는 리브가 덮는다.
 */
const TARGET_INNER_L = 55;
/** 격자 행 **바깥**(좌우·위아래 여백)의 목표 평균 휘도. 안쪽과 거의 같게 둬 화면이 갈리지 않게. */
const TARGET_SURROUND_L = 41;
/** 디테일 목표 표준편차. 수용 기준 std ≥ 30 에 여유를 둔 값. */
const TARGET_DETAIL_STD = 34;
/** 디테일 증폭 상한 — 원화에 없는 것을 만들어 낼 수는 없고, 과하면 압축 잡음이 올라온다. */
const MAX_DETAIL_GAIN = 1.15;
/** 비네트·스크림 선보정 상한. 가장자리에서 무한대로 부풀지 않게 막는다. */
const COMP_MAX = 2.0;
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

// --- 하이라이트 무릎(N2·N3 의 근본 처방) ---
/**
 * 출력이 국소 목표 `m` 의 몇 배까지 올라갈 수 있는지. 이 위로는 부드럽게 압축된다.
 *
 * ⚠️ **네거티브 스페이스의 폭주 하이라이트가 여기서 막힌다.** 화면 우변에 원화의 밝은 설비가
 * 있었는데, 톤매핑이 목표 평균은 54 로 맞추면서도 **디테일 항에는 상한이 없어** 그 자리가
 * L 141.6(좌측 동일 영역의 2.7배)까지 올라갔다 — 카드가 아닌 빈 자리가 화면에서 가장 밝아
 * 시선이 캔버스 밖으로 끌렸다. 같은 변의 위아래가 12배(11.7 ↔ 142) 벌어진 것도 같은 원인이다.
 *
 * 어두운 쪽은 이미 {@link LOW_KNEE} 로 막고 있었는데 밝은 쪽만 열려 있었다 — 비대칭이 결함의
 * 형태였다. 무릎은 **`m` 에 비례**하므로 어떤 배경이 들어와도 같은 규칙이 선다.
 */
const HIGH_KNEE = 1.9;
/** 무릎 위로 허용하는 추가 여유(`m` 배수). */
const HIGH_HEADROOM = 0.5;
/** 아래쪽 무릎(`m` 배수)과 그 아래의 점근선. 자르지 않고 지수적으로 수렴시킨다. */
const LOW_KNEE = 0.35;
const LOW_ASYMPTOTE = 0.2;

// --- 색온도 정규화(N1) ---
/**
 * 네거티브 스페이스의 목표 `r−b`(호박). 실측에서 좌여백 +45.9 → 거터 +30 → 우여백 +3.8 →
 * 하단 −15.8 로 **62유닛**이 흔들려 "한 방에서 찍힌 화면"으로 안 보였다. 휘도만 맞추고 색온도를
 * 놔두면 밝기가 같아도 콜라주로 읽힌다.
 */
const TARGET_RB = 28;
/** 목표 밴드 반폭. 이 안에 있으면 손대지 않는다(원화의 색 변화를 전부 지우지는 않는다). */
const RB_TOL = 18;
/** 녹색 편향 `g−(r+b)/2` 의 허용 반폭. 우여백이 +7.1 로 치우쳐 중성으로 읽혔다. */
const GREEN_TOL = 14;

/** 하단 비네트가 시작하는 y — CTA·메타 줄이 앉는 자리를 눌러 준다. */
const BOTTOM_SCRIM_TOP = 790;
/**
 * 0.44 → 0.28. 톤매핑이 목표 휘도를 스크림 감쇠로 미리 나눠 보정하는데, 크게 잡으면 화면 맨
 * 아래에서 보정 상한({@link COMP_MAX})을 넘겨 보정 자체가 불가능해진다 — 그 구간이 곧
 * "격자 아래가 사라졌다"는 신고 지점이었다.
 */
const BOTTOM_SCRIM_ALPHA = 0.28;
/**
 * 화면 네 변의 **띠형** 곱 비네트. 가장자리에서 계수 `1−EDGE_VIGNETTE_ALPHA`, 안쪽으로
 * {@link EDGE_VIGNETTE_BAND}px 지나면 1(무손실)이다.
 *
 * 검은 알파 오버레이는 곱과 같다(`dst·(1−a)`). 예전 판은 중앙 1/3 을 뺀 **전면** 감쇠라
 * 네거티브 스페이스 밴드 전체를 서로 다른 양으로 눌러 5밴드 균일성을 흔들었다. 띠로 좁히면
 * 프레이밍은 유지하면서 밴드 대부분이 무손실 구간에 들어간다. 남는 감쇠는 톤매핑이
 * 선보정하므로(`comp`) 밴드 평균은 목표에 그대로 앉는다.
 */
const EDGE_VIGNETTE_ALPHA = 0.28;
const EDGE_VIGNETTE_BAND = 96;

// --- 배경 재질(N5) ---
/**
 * 그레인 진폭(휘도 표준편차, 원화 픽셀 기준).
 *
 * ⚠️ **한때 30 이었고, 그게 이 화면 최악의 회귀였다.** 잔차 std ≥4 라는 대리 지표를 맞추려고
 * 올렸더니 페인터리 홀(기둥·화로·바닥 안개)이 통째로 **얼룩진 콘크리트 벽**이 됐다. 타이틀·
 * 인트로는 회화인데 기지만 노이즈가 되어 톤 정합이 깨졌고, 덤으로 큰 진폭이 어두운 화소를
 * 0 으로 잘라 **순흑을 다시 만들었다**(거터 0.83%/0.29%/0.34% · 행 사이 0.45%). 지표가
 * 거짓말을 한 사례다 — **판정 기준은 스크린샷이고 수치는 그 대리일 뿐이다.**
 *
 * 지금 값은 "있는지 없는지 눈으로는 거의 모르지만 완전 매끈함은 아닌" 양이다. 카드 밖 재질의
 * 주인은 배경이 아니라 **리브(Lane D, 폭방향 std 31.5)** 다.
 */
const GRAIN_LUM = 6;
/** 그레인이 완전 진폭에 닿는 휘도. 이 아래에서는 0 클리핑 편향을 피해 진폭을 줄인다. */
const GRAIN_FADE_L = 70;
/** 그레인 색(거의 중성, 아주 살짝 따뜻). 휘도 1 정규화 계수. */
const GRAIN_R = 1.06;
const GRAIN_G = 1.0;
const GRAIN_B = 0.9;
/**
 * 리브(Lane D 소관)가 덮는 열에서 그레인을 줄이는 계수와 반폭. 두 레이어가 각자 결을 얹으면
 * 그 열만 이중으로 거칠어진다 — 재질의 주인을 한쪽으로 정한다.
 */
const RIB_GRAIN_ATTEN = 0.8;
const RIB_GRAIN_HALF_W = 12;
/** 리브 중심 x(디자인). 격자 피치 458 에서 파생 — Lane D 와 같은 자리를 가리켜야 한다. */
const RIB_COLUMNS: readonly number[] = [502, 960, 1418];

// --- 하단 가산 바닥광(P4 → C6) ---
/**
 * 화면 아래쪽에 **더하는** 빛(휘도). 곱이나 하한으로는 못 고친다 — {@link LP_FLOOR} 는 곱
 * **이전** 하한이라 원화가 L 11 인 자리를 끌어올리지 못했고, 그래서 하단 평균 35.6 뒤에
 * **L<24 가 24.5%** 숨어 있었다(좌하단 타일 11.2~14.0). 평균이 가린 결함이라 최솟값으로
 * 잡아야 한다. 비네트·스크림 **뒤에** 얹으므로 아무것도 이 값을 깎지 않는다.
 *
 * ⚠️ **한때 34 짜리 단조 증가 램프였고(y 890→1080 선형), 그게 값 위계를 뒤집었다.**
 * 크러시는 풀렸지만 대가로 **화면 맨 아래가 프레임에서 제일 밝아졌다** — 실측(오프-리브
 * 배경) y 920~960 L 44 vs y 1020~1060 L 77~81. 실내는 광원에서 멀어질수록 어두워지는 것이
 * 자연의 위계인데 그 반대가 됐고, 부작용이 결정적이었다: **기둥 발치가 프레임 최고 밝기라
 * 접지 그림자가 앉을 자리가 없다**(Lane D 의 기둥이 바닥에 놓이지 않고 떠 보이던 근인).
 *
 * 그래서 램프를 **바닥 그라디언트**로 바꿨다 — 카드 바닥 바로 아래({@link BOTTOM_LIFT_PEAK_Y})
 * 에서 빛이 고이고, 화면 맨 아래(관객 쪽)로 갈수록 다시 어두워진다. 크러시 방지는 최댓값이
 * 아니라 **커버 구간 전체가 0 이 아니라는 사실**이 맡으므로 정점을 낮춰도 바닥은 보장된다.
 */
const BOTTOM_LIFT_LUM = 22;
/** 바닥광이 0 에서 올라오기 시작하는 y(디자인). 이 위로는 정확히 0 이라 시작선이 없다. */
const BOTTOM_LIFT_TOP = 872;
/**
 * 바닥광의 **정점** y. 카드 격자 바닥(≈977) 바로 아래 — 뒷벽 램프광이 바닥에 고이는 자리다.
 * 여기가 하단에서 가장 밝고, 아래로는 {@link BOTTOM_LIFT_EDGE_RATIO} 까지 롤오프한다.
 */
const BOTTOM_LIFT_PEAK_Y = 985;
/**
 * 화면 맨 아래(y = {@link DESIGN_HEIGHT})에 남는 비율. 0 으로 떨어뜨리면 안 된다 — 프레임
 * 최하단이 원화만 남아 다시 크러시 위험 구간이 된다. 자연스러운 위계(정점 대비 약 1/4)와
 * 크러시 방지의 하한이 만나는 값이다.
 */
const BOTTOM_LIFT_EDGE_RATIO = 0.4;
/** 리프트 색(따뜻한 바닥 반사광). 아래 계수는 휘도 1 정규화값이다. */
const BOTTOM_LIFT_COLOR = 0xffd696;
const BOTTOM_LIFT_LUMA = 218.9;

// --- 공기 ---
/** 먼지 티끌 수(고티어). 저티어는 절반. 타이틀보다 적다 — 오래 보는 화면이라 산만하면 안 된다. */
const MOTE_COUNT = 34;
/**
 * 광선 알파가 아주 느리게 오가는 진폭. **꺼지지는 않는다.**
 *
 * ⚠️ 예전 판은 21초에 3.4초만 지나가는 **스윕 1줄**이었다. 그 결과 화면의 84%의 시간 동안
 * 벽 대역에 **대역 규모의 명암 구성이 0** 이었다 — 실측(하이패스 σ40)에서 평행 광축 개수
 * v11 5개 → v12 **0개**, 벽 y23/67/111 이 98/105/117 → 63/74/81 로 내려앉았다. 배경이
 * "그레인 텍스처 + 비네트"가 된 형태다. 광선은 이 화면의 **유일한 회화적 단서**라 상시
 * 존재해야 하고, 살아 있다는 신호는 등장/퇴장이 아니라 이 미세한 호흡이 맡는다.
 */
const SHAFT_BREATH = 0.12;
/**
 * 광선 기울기(rad). **부호가 규약이다** — `gutterRibs.ts` "광원 규약"의 키라이트가 **좌상단**
 * (좌 수광 립 / 우 코어 그림자, 위가 밝은 세로 램프)이므로 광선도 좌상 → 우하로 내려와야 한다.
 * 스프라이트 로컬 +y(광선 진행 방향)를 회전시키면 `(−sinθ, cosθ)` 이므로 `θ = −SHAFT_TILT` 일
 * 때 x 가 증가한다.
 *
 * ⚠️ 예전 판은 `rotation = +0.22` 라 **우상 → 좌하**로 흘렀다. 기둥은 왼쪽에서, 광선은
 * 오른쪽에서 빛을 받는 화면이 되어 광선이 볼류메트릭이 아니라 **압축 잡음 같은 비대칭 번짐**
 * 으로 읽혔다.
 */
const SHAFT_TILT = 0.2;
/** 광선 길이(디자인 px). 화면보다 길게 잡고 꼬리를 텍스처가 재운다. 폭은 배치마다 다르다. */
const SHAFT_LENGTH = 1720;
/**
 * 광선 머리(광원)의 y. 화면 위 조금 바깥 — {@link SHAFT_HEAD} 의 선단 페이드가 화면 상단
 * 1/6 에 걸쳐 서므로 빛이 **위에서 내려오는** 위계가 생긴다. 예전처럼 −151 로 멀리 올리면
 * 선단이 프레임 밖에서 이미 다 서 버려 상단이 평평해진다.
 */
const SHAFT_HEAD_Y = -95;
/**
 * 광선 정점 알파(구운 단면의 최댓값).
 *
 * ⚠️ 슬랩 적층을 걷어내면서 0.25 → 0.125 로 **절반 낮춘 것이 과했다.** 계단 에지는 사라졌지만
 * 광선도 함께 사라졌다(위 {@link SHAFT_BREATH} 의 실측). 단면이 이제 가우시안이라 예전 슬랩
 * 누적처럼 중심만 뾰족하지 않고 부드럽게 퍼진다 — 같은 인상을 내려면 정점이 그때보다 낮을
 * 이유가 없다.
 */
const SHAFT_ALPHA = 0.21;
/** 코어·헤일로 가우시안 반폭(정규화 폭 −1..1 기준)과 헤일로 비중. */
const SHAFT_CORE_SIGMA = 0.26;
const SHAFT_HALO_SIGMA = 0.62;
const SHAFT_HALO_MIX = 0.34;
/** 광선 길이 방향에서 선단이 서는 구간과 꼬리가 사라지기 시작하는 지점(0..1). */
const SHAFT_HEAD = 0.09;
const SHAFT_TAIL = 0.24;
/** 광선 속 먼지 진폭(0..1). 결이 없으면 젤리처럼 매끈해 볼류메트릭으로 안 읽힌다. */
const SHAFT_DUST = 0.5;

/**
 * 광선 배치. **텍스처는 한 장을 구워** 배치마다 회전·스케일·알파만 달리해 겹친다 — 폭이 다른
 * 사각형을 쌓아 단면을 근사하던 방식(§0-4 금지)과는 다르다. 여기서 겹치는 것은 **완성된
 * 단면끼리**라 합이 언제나 가우시안의 합이고, 계단이 생길 자리가 원리적으로 없다.
 *
 * `x` 는 머리(광원)의 디자인 x 다 — 기울어져 있으므로 화면 중단의 중심은 여기서
 * `깊이·sin(tilt)` 만큼 오른쪽이다. 주 광축(1번)의 중심이 벽 대역 실측 지점(디자인 x≈550)에
 * 오도록 잡았고, 나머지 셋은 폭·세기를 낮춰 **평행하되 종속**으로 읽히게 한다.
 *
 * `tiltDelta` 는 {@link SHAFT_TILT} 에 더해지는 미세 편차다. 전부 같은 각이면 복사-붙여넣기로
 * 읽히고, 부호를 뒤집으면 광원 규약이 깨진다 — 그래서 부호는 유지한 채 크기만 흔든다.
 */
interface ShaftPlacement {
  x: number;
  width: number;
  alpha: number;
  tiltDelta: number;
  period: number;
}
const SHAFT_PLACEMENTS: readonly ShaftPlacement[] = [
  { x: 520, width: 360, alpha: 1, tiltDelta: 0, period: 17 },
  { x: 132, width: 250, alpha: 0.5, tiltDelta: -0.025, period: 23 },
  { x: 1006, width: 300, alpha: 0.55, tiltDelta: 0.015, period: 29 },
  { x: 1472, width: 230, alpha: 0.42, tiltDelta: -0.01, period: 37 },
];

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

/** 생성자 옵션. 전부 선택적이다 — 리드가 아무것도 넘기지 않아도 기본값으로 선다. */
export interface BaseBackdropOpts {
  /**
   * 타일 격자 행 사각형(디자인 스페이스). 행 개수 제한 없음 — 각 사각형이 같은 규칙으로
   * 처리된다. 넘기지 않으면 {@link DEFAULT_VEIL_RECTS}.
   */
  veilRects?: readonly BaseVeilRect[];
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
  const d = Math.min(x, DESIGN_WIDTH - x, y, DESIGN_HEIGHT - y);
  if (d >= EDGE_VIGNETTE_BAND) return 0;
  return EDGE_VIGNETTE_ALPHA * (1 - smoothstep(d / EDGE_VIGNETTE_BAND));
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

/**
 * 출력을 국소 목표 `m` 둘레의 좁은 대역으로 부드럽게 접는다. **양쪽 다** 접어야 한다 —
 * 아래쪽만 막고 위쪽을 열어 뒀더니 네거티브 스페이스가 카드보다 밝아졌다({@link HIGH_KNEE}).
 *
 * `wgt` 가 0 이면 무릎이 사실상 무한대로 벌어져 항등식이 된다(처리 경계 없음).
 */
function kneeCompress(v: number, m: number, wgt: number): number {
  // 세기가 0 이면 두 무릎이 무한히 벌어져 항등식이 된다(처리 경계 없음).
  const lo = m * (1 - (1 - LOW_KNEE) * wgt);
  const asy = m * (1 - (1 - LOW_ASYMPTOTE) * wgt);
  if (v < lo) return asy + (lo - asy) * Math.exp((v - lo) / Math.max(1, lo - asy));
  const hi = m * (1 + (HIGH_KNEE - 1) / Math.max(0.05, wgt));
  if (v <= hi) return v;
  const head = Math.max(1, (m * HIGH_HEADROOM) / Math.max(0.05, wgt));
  return hi + head * (1 - Math.exp(-(v - hi) / head));
}

/**
 * 가장자리 띠형 곱 비네트를 굽는다. 밴드 안에서만 어두워지고 안쪽은 완전 무손실이다 —
 * 전면 감쇠는 네거티브 스페이스 밴드를 서로 다른 양으로 눌러 균일성을 깬다.
 */
function bakeEdgeVignette(): Texture | null {
  const w = 256;
  const h = 144;
  const ctx = makeCtx(w, h);
  if (ctx === null) return null;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const py = ((y + 0.5) / h) * DESIGN_HEIGHT;
    for (let x = 0; x < w; x++) {
      const px = ((x + 0.5) / w) * DESIGN_WIDTH;
      const a = edgeVignetteAlpha(px, py);
      const i = (y * w + x) * 4;
      img.data[i] = 0x07;
      img.data[i + 1] = 0x05;
      img.data[i + 2] = 0x0e;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(ctx);
}

/**
 * 바닥광의 세기(0..1)를 디자인 y 에서 준다. **위로도 아래로도 0 을 향해 떨어지는 봉우리**다 —
 * 단조 증가 램프가 값 위계를 뒤집었던 자리({@link BOTTOM_LIFT_LUM} 주석).
 *
 * 위쪽 어깨는 `smoothstep` 이라 시작선이 보이지 않고, 아래쪽은 완전히 0 이 아니라
 * {@link BOTTOM_LIFT_EDGE_RATIO} 로 수렴해 프레임 최하단의 크러시 하한을 남긴다.
 */
function bottomLiftProfile(y: number): number {
  if (y <= BOTTOM_LIFT_TOP) return 0;
  if (y <= BOTTOM_LIFT_PEAK_Y) {
    return smoothstep((y - BOTTOM_LIFT_TOP) / (BOTTOM_LIFT_PEAK_Y - BOTTOM_LIFT_TOP));
  }
  const t = (y - BOTTOM_LIFT_PEAK_Y) / Math.max(1, DESIGN_HEIGHT - BOTTOM_LIFT_PEAK_Y);
  return 1 - (1 - BOTTOM_LIFT_EDGE_RATIO) * smoothstep(t);
}

/**
 * 하단 가산 바닥광 텍스처(1×256). 가산 합성이라 곱 레이어(비네트·스크림)가 이미 지나간
 * 뒤에도 바닥을 확실히 들어올린다. 세로 프로파일은 {@link bottomLiftProfile} 하나가 정한다 —
 * 띠를 겹쳐 근사하지 않는다(1px 겹침이 알파를 두 배로 만드는 `scrim.ts` 함정).
 */
function bakeBottomLift(): Texture | null {
  const h = 256;
  const ctx = makeCtx(1, h);
  if (ctx === null) return null;
  const r = (BOTTOM_LIFT_COLOR >> 16) & 0xff;
  const g = (BOTTOM_LIFT_COLOR >> 8) & 0xff;
  const b = BOTTOM_LIFT_COLOR & 0xff;
  const maxAlpha = BOTTOM_LIFT_LUM / BOTTOM_LIFT_LUMA;
  const span = DESIGN_HEIGHT - BOTTOM_LIFT_TOP;
  const img = ctx.createImageData(1, h);
  for (let y = 0; y < h; y++) {
    const dy = BOTTOM_LIFT_TOP + ((y + 0.5) / h) * span;
    const a = maxAlpha * bottomLiftProfile(dy);
    img.data[y * 4] = r;
    img.data[y * 4 + 1] = g;
    img.data[y * 4 + 2] = b;
    img.data[y * 4 + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(ctx);
}

/**
 * 볼류메트릭 광선 한 줄기를 **텍스처로 굽는다**(로컬 좌표: x=폭, y=진행 방향).
 *
 * ⚠️ 예전 판은 폭이 다른 사각형 7장을 중심에서 겹쳐 쌓아 단면을 근사했다. 그게 계약 §0-4 가
 * 금지한 바로 그 방식이고, 결과는 30px 간격의 **계단 에지 7쌍**이었다 — 화면에서 광선이 아니라
 * "압축 노이즈 같은 사선 번짐"으로 보이던 실체다. 그라디언트는 겹쳐 근사하지 말고 픽셀로 굽는다.
 *
 * 구운 단면은 세 성분이다:
 *  - **코어**(좁은 가우시안) — 빛줄기의 심.
 *  - **헤일로**(넓은 가우시안) — 공기 산란. 코어만 있으면 칼로 자른 띠가 된다.
 *  - **먼지**(세로로 늘인 값 노이즈 + 잔 입자) — 진행 방향으로 늘어난 결. 이게 없으면 매끈한
 *    젤리라 볼류메트릭으로 안 읽힌다.
 *
 * 길이 방향으로는 선단({@link SHAFT_HEAD})에서 서고 꼬리({@link SHAFT_TAIL})부터 사라진다 —
 * 화면 위아래 끝에서 잘리지 않아야 "창에서 들어온 빛"으로 읽힌다.
 */
function bakeLightShaft(): Texture | null {
  const w = 96;
  const h = 256;
  const ctx = makeCtx(w, h);
  if (ctx === null) return null;
  const r = (FALLBACK_LAMP >> 16) & 0xff;
  const g = (FALLBACK_LAMP >> 8) & 0xff;
  const b = FALLBACK_LAMP & 0xff;
  // 진행 방향으로 늘인 결(2×34) + 잔 입자(5×11). 셀이 이방적이라 방향성이 생긴다.
  const dust = new Float32Array(w * h);
  noiseOctave(dust, w, h, 3, 40, 1, 131);
  noiseOctave(dust, w, h, 7, 13, 0.55, 149);
  noiseOctave(dust, w, h, 17, 60, 0.7, 163);
  let sq = 0;
  for (let i = 0; i < dust.length; i++) sq += (dust[i] ?? 0) ** 2;
  const inv = 1 / (Math.sqrt(sq / dust.length) || 1);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    // 선단은 서고 꼬리는 사라진다. 두 smoothstep 의 곱이라 어느 끝에서도 단차가 없다.
    const along =
      smoothstep(v / SHAFT_HEAD) * (1 - smoothstep((v - SHAFT_TAIL) / (1 - SHAFT_TAIL)));
    for (let x = 0; x < w; x++) {
      const u = ((x + 0.5) / w) * 2 - 1;
      const core = Math.exp(-(u * u) / (2 * SHAFT_CORE_SIGMA ** 2));
      const halo = Math.exp(-(u * u) / (2 * SHAFT_HALO_SIGMA ** 2));
      const cross = (1 - SHAFT_HALO_MIX) * core + SHAFT_HALO_MIX * halo;
      const d = 1 + SHAFT_DUST * (dust[y * w + x] ?? 0) * inv;
      const a = SHAFT_ALPHA * along * cross * Math.max(0, d);
      const i = (y * w + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(ctx);
}

/** 캔버스 2D 컨텍스트를 만든다. 없는 환경(vitest)에서는 null — 호출부가 그 없이도 서야 한다. */
function makeCtx(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
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

/** 리브 열 안에서 그레인을 줄이는 계수(디자인 x). 밖이면 1. */
function ribGrainAtten(x: number): number {
  for (const cx of RIB_COLUMNS) {
    if (Math.abs(x - cx) <= RIB_GRAIN_HALF_W) return RIB_GRAIN_ATTEN;
  }
  return 1;
}

/** 결정적 2D 해시(0..1). 시드가 같으면 언제나 같은 결 — 재생성마다 자글거리지 않는다. */
function hash2(x: number, y: number, seed: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * 셀 크기 `cx`×`cy` 의 값 노이즈 한 옥타브(이중선형). `cx ≠ cy` 면 **방향성**이 생긴다 —
 * 석재 결·수직 스트리크가 그 형태다.
 */
function noiseOctave(
  out: Float32Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  amp: number,
  seed: number,
): void {
  const gw = Math.ceil(w / cx) + 2;
  const gh = Math.ceil(h / cy) + 2;
  const lat = new Float32Array(gw * gh);
  for (let i = 0; i < lat.length; i++) {
    lat[i] = hash2(i % gw, Math.floor(i / gw), seed) - 0.5;
  }
  for (let y = 0; y < h; y++) {
    const fy = y / cy;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = x / cx;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const v00 = lat[y0 * gw + x0] ?? 0;
      const v10 = lat[y0 * gw + x0 + 1] ?? 0;
      const v01 = lat[(y0 + 1) * gw + x0] ?? 0;
      const v11 = lat[(y0 + 1) * gw + x0 + 1] ?? 0;
      const v = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
      out[y * w + x] = (out[y * w + x] ?? 0) + v * amp;
    }
  }
}

/**
 * 배경 재질 — **다중 옥타브** 결을 굽는다.
 *
 * ## 왜 단일 노이즈로는 안 되나
 * 카드 밖 전 영역의 마이크로 콘트라스트가 0.28~0.36 인데 카드 아트는 7.6~33 이다. 그 격차가
 * "코드로 그린 티"의 정체다. 다만 여기에 노이즈 한 겹을 얹으면 **입자 크기가 한 종류**라
 * 즉시 CG 로 읽힌다 — 문제는 "절차적"이 아니라 **"단일 스케일"** 이다.
 *
 * 그래서 세 종류를 섞는다:
 *  - **등방 옥타브 4겹**(1·3·9·27px, 진폭 감쇠) — 입자 크기가 한 종류가 아니게 만든다.
 *  - **방향성 2겹**(2×22 세로 결, 30×3 가로 퇴적층) — 석재의 결. 등방 노이즈에는 없는 신호다.
 *  - **저주파 얼룩**(90px) — 먼지·습기 얼룩.
 *
 * 마지막에 **평균 0·표준편차 1 로 정규화**한다. 그레인이 밝기를 움직이면 5밴드 균일성이
 * 깨지므로, 진폭이 아니라 **분포**를 고정하는 것이 안전하다.
 */
function bakeGrainField(w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  // 화면은 원화를 1.53배 확대해 쓴다 — 1px 옥타브는 보간에 대부분 먹히므로 2~8px 에 무게를 둔다.
  noiseOctave(g, w, h, 1, 1, 0.5, 11);
  noiseOctave(g, w, h, 2, 2, 1.0, 23);
  noiseOctave(g, w, h, 4, 4, 0.9, 37);
  noiseOctave(g, w, h, 8, 8, 0.7, 51);
  noiseOctave(g, w, h, 16, 16, 0.5, 59);
  noiseOctave(g, w, h, 32, 32, 0.35, 71);
  noiseOctave(g, w, h, 3, 26, 0.6, 67); // 세로 석재 결
  noiseOctave(g, w, h, 40, 4, 0.4, 83); // 가로 퇴적층
  noiseOctave(g, w, h, 100, 100, 0.5, 97); // 먼지·습기 얼룩
  let sum = 0;
  for (let i = 0; i < g.length; i++) sum += g[i] ?? 0;
  const mean = sum / g.length;
  let sq = 0;
  for (let i = 0; i < g.length; i++) sq += ((g[i] ?? 0) - mean) ** 2;
  const std = Math.sqrt(sq / g.length) || 1;
  for (let i = 0; i < g.length; i++) g[i] = ((g[i] ?? 0) - mean) / std;
  return g;
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
      // 환경광은 톤매핑 **뒤에** 더해지므로 목표에서 미리 빼 둔다 — 안 빼면 그만큼 초과한다.
      lum[i] = Math.max(4, target * comp - AMBIENT_LUM);
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
  const grain = bakeGrainField(w, h);

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

  // --- 2패스: 픽셀마다 목표 평균 + 접은 디테일(색·그레인은 아직) ---
  const tmpCtx = makeCtx(w, h);
  if (tmpCtx === null) return null;
  const tmp = tmpCtx.createImageData(w, h);
  for (let sy = 0; sy < h; sy++) {
    const dy = designY(sy);
    for (let sx = 0; sx < w; sx++) {
      const i = (sy * w + sx) * 4;
      const r = detailPx[i] ?? 0;
      const g = detailPx[i + 1] ?? 0;
      const b = detailPx[i + 2] ?? 0;
      const wgt = sampleField(field.weight, designX(sx), dy);
      const lumA = luma(r, g, b);
      let outLum = lumA;
      if (wgt > 1e-3) {
        // **하한이 걸린 국소 평균.** 아래 세 식이 전부 이 값을 쓴다 — 하나라도 날것의 `Lp` 를
        // 쓰면 어두운 자리에서 출력이 무너진다({@link LP_FLOOR} 주석의 실측).
        const lumLp = Math.max(LP_FLOOR, luma(lowPx[i] ?? 0, lowPx[i + 1] ?? 0, lowPx[i + 2] ?? 0));
        const target = sampleField(field.lum, designX(sx), dy);
        const m = lumLp + (target - lumLp) * wgt * NORM_STRENGTH;
        // 대비는 **절대량이 아니라 비율**로 옮긴다(`m/Lp`). 어두워진 자리에 원래 밝기의 진폭을
        // 그대로 얹으면 음수로 내려가 검게 잘리고, 그 클리핑이 다시 대비를 죽인다.
        // 세기 0 → m = Lp, 배율 1, gain 1 → out = A(항등식). 처리 경계가 원리적으로 없다.
        const detailScale = 1 + wgt * (m / lumLp - 1);
        const gEff = 1 + (gain - 1) * wgt;
        // 양쪽 무릎으로 접는다 — 위쪽을 열어 두면 빈 자리가 카드보다 밝아진다(N2·N3).
        outLum = kneeCompress(m + (lumA - lumLp) * gEff * detailScale, m, wgt);
      }
      // RGB 는 휘도 비로만 민다 — 색상·채도를 보존하기 위해서다.
      const scale = Math.max(0, outLum / Math.max(1, lumA));
      tmp.data[i] = Math.min(255, r * scale);
      tmp.data[i + 1] = Math.min(255, g * scale);
      tmp.data[i + 2] = Math.min(255, b * scale);
      tmp.data[i + 3] = 255;
    }
  }
  tmpCtx.putImageData(tmp, 0, 0);

  // --- 3패스: 환경광 · 재질 · 색온도 ---
  //
  // ⚠️ 여기에 **닫힘 보정**(2패스 결과를 다시 흐려 실제 국소 평균을 재고 목표와의 비율만큼
  // 곱하는 되먹임)을 넣었다가 **뺐다.** 원리는 맞지만 이 화면에서는 해롭다: 보정 커널은
  // 저주파 평균(93px)이라 **24~44px 폭의 여백·거터 띠**를 그 이웃과 함께 움직인다. 띠가
  // 이웃보다 어두우면 이웃을 목표에 맞추느라 띠를 통째로 밀어 올려, 실측에서 좌여백이
  // 63 → 76, 우측 레일이 57 → 92 로 되레 나빠지고 순흑이 0% → 0.86% 로 돌아왔다.
  // 기록으로 남긴다 — 다음 사람이 같은 아이디어를 다시 시도하지 않도록.
  const basePx = tmpCtx.getImageData(0, 0, w, h).data;
  const out = outCtx.createImageData(w, h);
  for (let sy = 0; sy < h; sy++) {
    const dy = designY(sy);
    for (let sx = 0; sx < w; sx++) {
      const i = (sy * w + sx) * 4;
      const dx = designX(sx);
      const wgt = sampleField(field.weight, dx, dy);
      const r = basePx[i] ?? 0;
      const g = basePx[i + 1] ?? 0;
      const b = basePx[i + 2] ?? 0;
      // 환경광·그레인은 **더한다**: 곱은 순흑 화소를 절대 들어올리지 못한다(0 × 무엇 = 0).
      // 그레인은 평균 0 이라 밴드 평균을 움직이지 않는다. 다만 어두운 자리에서는 음의 진폭이
      // 0 에서 잘려 평균이 **위로** 밀리므로(실측 +9.6), 어두울수록 진폭을 줄인다.
      const lumBase = luma(r, g, b);
      const fade = Math.min(1, (lumBase + AMBIENT_LUM) / GRAIN_FADE_L);
      // 리브(Lane D)가 덮는 열에서는 약하게 — 두 레이어의 결이 겹쳐 이중으로 보이지 않게.
      const gr = (grain[sy * w + sx] ?? 0) * GRAIN_LUM * wgt * ribGrainAtten(dx) * fade;
      let outR = r + AMBIENT_LUM * AMBIENT_R + gr * GRAIN_R;
      let outG = g + AMBIENT_LUM * AMBIENT_G + gr * GRAIN_G;
      let outB = b + AMBIENT_LUM * AMBIENT_B + gr * GRAIN_B;
      // 색온도 정규화(N1) — 휘도가 같아도 색온도가 갈리면 한 방에서 찍힌 화면으로 안 보인다.
      // `r−b`(호박축)와 `g−(r+b)/2`(녹색 편향)를 목표 대역으로 접고, **휘도를 보존한 채**
      // 세 채널을 다시 푼다. 미는 방식(shift)은 채널이 0 에서 잘리면 목표에 못 닿는다 —
      // 우여백이 녹색 편향(+7.1) 때문에 그렇게 빗나갔다.
      if (wgt > 1e-3) {
        const y = luma(outR, outG, outB);
        const rb = outR - outB;
        const gx = outG - (outR + outB) / 2;
        const d =
          rb + (Math.min(TARGET_RB + RB_TOL, Math.max(TARGET_RB - RB_TOL, rb)) - rb) * wgt;
        const xg = gx + (Math.min(GREEN_TOL, Math.max(-GREEN_TOL, gx)) - gx) * wgt;
        // Y = (R+B)/2 + 0.0925·(R−B) + 0.587·(G−(R+B)/2) 를 R+B 에 대해 푼 것.
        const s = 2 * (y - 0.0925 * d - 0.587 * xg);
        outR = (s + d) / 2;
        outB = (s - d) / 2;
        outG = s / 2 + xg;
      }
      out.data[i] = Math.min(255, Math.max(0, outR));
      out.data[i + 1] = Math.min(255, Math.max(0, outG));
      out.data[i + 2] = Math.min(255, Math.max(0, outB));
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
  /** 광선 텍스처. **한 장을 모든 광축이 공유한다** — 우리가 구운 자원이라 직접 반납한다. */
  private shaftTex: Texture | null = null;
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

    // --- 공기: 상시 걸린 평행 광축(가산) ---
    if (gates.halo) {
      // 단면·먼지·선단은 전부 **구운 텍스처 한 장**이 갖는다(`bakeLightShaft` 주석 — 슬랩
      // 적층은 계단 에지를 남겨 "사선 번짐"으로 읽혔다). 여기서는 그것을 **놓는 일만** 한다.
      this.shaftTex = bakeLightShaft();
      if (this.shaftTex !== null) {
        for (const [i, p] of SHAFT_PLACEMENTS.entries()) {
          const shaft = new Sprite(this.shaftTex);
          // 위 끝(광원)을 기준으로 회전한다 — 창은 고정이고 빛줄기가 그 아래로 뻗는 형태다.
          shaft.anchor.set(0.5, 0);
          shaft.width = p.width;
          shaft.height = SHAFT_LENGTH;
          // 좌상 → 우하. 부호 규약은 {@link SHAFT_TILT} 주석 참조.
          shaft.rotation = -(SHAFT_TILT + p.tiltDelta);
          shaft.x = p.x;
          shaft.y = SHAFT_HEAD_Y;
          shaft.blendMode = 'add';
          shaft.alpha = p.alpha;
          this.airLayer.addChild(shaft);
          // 호흡은 폴백 발광체와 **같은 장치**를 쓴다(주기가 서로소에 가까워 위상이 안 맞는다).
          this.breathers.push({
            sprite: shaft,
            base: p.alpha,
            period: p.period,
            phase: i * 1.7,
          });
        }
      }
    }

    // --- 대비 장치(고정 — 패럴랙스 밖) ---
    // 톤매핑이 성공했으면 딤은 **없다**(그게 3차 실패의 원인이었다). 실패했을 때만 최소한의
    // 딤을 얹어 카드가 배경에 묻히지 않게 한다.
    if (this.bakedArt === null) this.buildFallbackDim();
    this.buildVignettes();
    this.buildBottomLift();
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

  /** 하단 스크림(CTA·메타 줄 자리) + 네 변 비네트(시선을 화면 안쪽으로 모은다). */
  private buildVignettes(): void {
    const edge = bakeEdgeVignette();
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

  /**
   * 하단 가산 바닥광 — **맨 마지막**에 얹는다. 곱 레이어(비네트·스크림)보다 뒤라 아무것도
   * 이 값을 깎지 않으므로 화면 바닥의 최솟값이 보장된다. 평균이 아니라 **최솟값**을 고쳐야
   * 하는 결함이라(하단 평균 35.6 뒤에 L<24 가 24.5% 숨어 있었다) 곱이 아니라 합이어야 한다.
   */
  private buildBottomLift(): void {
    const tex = bakeBottomLift();
    if (tex === null) return;
    const s = new Sprite(tex);
    s.position.set(0, BOTTOM_LIFT_TOP);
    s.width = DESIGN_WIDTH;
    s.height = DESIGN_HEIGHT - BOTTOM_LIFT_TOP;
    s.blendMode = 'add';
    this.view.addChild(s);
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

    // 광선·발광체의 미세한 호흡 — 같은 장치다. 광선은 **꺼지지 않고** 세기만 아주 느리게
    // 오간다({@link SHAFT_BREATH} — 스윕으로 껐다 켰다 하던 판이 벽 대역을 비웠다).
    for (const b of this.breathers) {
      b.sprite.alpha =
        b.base * (1 + SHAFT_BREATH * Math.sin((this.time / b.period) * Math.PI * 2 + b.phase));
    }
  }

  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.onPointerMove);
    }
    this.motes.length = 0;
    this.breathers.length = 0;
    this.view.destroy({ children: true });
    // 구운 텍스처는 스프라이트가 아니라 우리가 만든 자원이다 — 직접 반납한다.
    this.bakedArt?.destroy(true);
    this.bakedArt = null;
    this.shaftTex?.destroy(true);
    this.shaftTex = null;
  }
}
