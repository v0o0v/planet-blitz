/**
 * 함선 도크 — 쇼케이스 창 안에서 함선을 **장면에 앉히는** 조명·접지·받침 (격납고 AAA Lane D).
 *
 * ## 왜 이 모듈이 존재하는가 (1차 비평 CRITICAL C3, 전부 실측)
 * 함선 픽셀아트를 창 한가운데에 `Sprite` 한 장으로 얹어 두고 있었다. 실루엣을 색상(B > R+12)
 * 으로 추출해 재 보니 세 가지가 동시에 참이었다:
 *  1. **접지가 정확히 0.** 실루엣 바로 아래 띠(y+2~+14) 평균 L\* 를 **같은 y 의 좌우 측면
 *     대조 구간**(±40~260px)과 비교하면 `under/flanking = 1.001` 이다. 그림자가 약한 게
 *     아니라 **없다**. 물체가 바닥에 닿아 있다는 신호가 화면에 한 픽셀도 없었다.
 *  2. **장면광이 없다.** 창 배경 R/B = 1.844 (바닥에 강한 금빛 램프 반사광이 있다)인데
 *     함선 상단 33% R/B 0.464 · 하단 33% R/B 0.511 — 웜 시프트가 10% 뿐이라 **스프라이트
 *     자체 음영 수준**이다. 아랫면이 금빛 바닥을 받지 않는 물체는 그 방에 있지 않다.
 *  3. ~~**figure-ground 분리 4.72 L\***~~ — ⚠️ **2차에 비평가가 철회했다.** 역감마를 빼먹은
 *     오측정이었고 실제는 v2 12.24 · v3 14.26 L\* 다. **밝기 분리를 올리는 방향의 처방은
 *     무효다** — 이 파일의 림·언더라이트는 밝기가 아니라 **색온도(R/B)** 로만 판정한다.
 *     (남겨 둔 이유: 지운 지표는 다음 라운드에 되살아난다. 무엇이 왜 철회됐는지가 기록이다.)
 * 이 게임의 자기 아트 바이블이 이미 반증한다: `assets/base/base_bld_hangar.webp` 의 함선은
 * 조명 받는 플랫폼 위에 접지 그림자와 함께 놓여 있다.
 *
 * ## ⚠️ 픽셀아트는 다시 그리지 않는다 (사용자 확정)
 * 기체 정체성·파밍 시각 언어라 원본 스프라이트를 유지한다. "픽셀을 다시 그려라"는 처방은
 * 무효고, 유효한 것은 **조명·접지·프레이밍으로 페인터리 배경에 앉히는 것**뿐이다. 그래서
 * 이 모듈은 원본 텍스처를 건드리지 않고(`source.scaleMode` 도 바꾸지 않는다 — 공유 자산이다)
 * 그 **주위와 위에** 레이어를 얹는다.
 *
 * ## 처방 셋과 그 축
 *  ⓐ **2단 접지 그림자** — 좁고 짙은 접촉 + 넓고 옅은 확산. `cinematicTile.ts` `CONTACT`/
 *    `DIFFUSE` 헤더의 실측 결론을 그대로 승계한다(출처 명시 — 그 파일은 기지 화면 소유라
 *    수정하지 않고 레시피만 복제했다): **넓고 옅은 확산만으로는 눈이 "앰비언트 얼룩"으로
 *    읽는다.** 접지는 좁고 짙은 접촉 어둠이 만든다.
 *  ⓑ **도크 크래들** — 접지가 물리적으로 성립하려면 받침이 있어야 한다. 절차적 금빛 크래들
 *    (원호 2개 + 지지대 + 데크판)을 창 하단에 그리고 그 위에 함선을 앉힌다.
 *  ⓒ **웜 언더라이트** — 바닥 램프의 반사광. 함선 아랫면에 금빛을 **가산**으로 얹는다.
 *
 * ## 지표를 왜 곱연산·색비로 잡는가
 * `gutterRibs.ts` 6라운드가 산 교훈이다: **대비는 상대량인데 절대 휘도로 관리하면 배경이
 * 변하는 순간 지표가 참인 채로 화면이 틀린다.** 창 안 배경(Lane A 소유)은 이 파일이 읽을 수
 * 없고 자리마다 밝기가 다르다. 그래서
 *  - 접지는 `multiply` 로 굽는다. Pixi 의 multiply 는 `dst·(1 − a·(1 − src))` 이고 `src=0`
 *    이므로 결과가 정확히 `dst·(1 − a)` — 배경이 얼마든 **그 자리에서 비율로** 낮아진다.
 *    게이트는 **절대 델타가 아니라 `under/flanking` 비**다(`Δ = bg × (1 − ratio)` 라 절대
 *    델타는 배경 밝기에 따라 제멋대로 움직인다).
 *  - 조명은 **R/B 비**로 잰다. 표본을 어떻게 잘라도 정의가 같은 비율량이다.
 * 둘 다 "균일하게 하라"가 아니라 **없는 것을 만들라**이므로, 계약 §6-1(대리 지표를 상한으로
 * 주면 그림이 지워진다)에 걸리지 않는다.
 *
 * ## 창 배경을 덮지 않는다
 * 창 안의 DOF 보케와 웜/쿨 보색 구성은 이 화면에서 **유일하게 진짜 회화**다(|HF| 17.15 vs
 * 슬래브 면 1.55). 크래들은 **실루엣이지 판때기가 아니다** — 새로 불투명해지는 화소는 창
 * 면적의 **약 1.5%**(아래 {@link makeShipDock} 말미 검산)이고, 나머지 레이어는 전부
 * `multiply`/`add` 라 원화를 지우지 않고 변조만 한다. 따뜻한 바닥 램프 보케 구간(창 하단)은
 * 배경에서 가장 잘 그려진 자리라 크래들 지지대를 얇게 유지해 살려 둔다.
 *
 * ## 왜 이 모듈이 함선 스프라이트까지 직접 그리는가
 * 리드는 위치만 준다. 접지 → 후광 → 림 → 함선 → 언더라이트 → 크래들 앞턱의 z 순서가
 * 하나라도 어긋나면 처방이 통째로 무효가 되기 때문이다(특히 **앞턱이 함선 아래 실루엣을
 * 가로지르는 것**이 "앉아 있다"의 가장 강한 단서다). 한 곳에서 보장한다.
 *
 * ## Pixi v8 제약 (계약 §0-5)
 *  - `Sprite` 에 자식을 넣을 수 없다 → 림·언더라이트는 전부 **형제 + 변환 미러**다.
 *  - `tint` 는 곱연산이라 **밝힐 수 없다.** 금빛 림을 시안 함선에 `tint` 로 주면 곱해져
 *    탁한 녹색이 된다(cyan 60,200,255 × gold 255,180,60 → 60,141,60). 그래서 사본을
 *    {@link whiten} 색 행렬로 **실루엣만 남긴 흰색**으로 만든 뒤 금색 tint + `add` 로 얹는다.
 *  - 캔버스 없는 환경(vitest)에서 `document`·`new ColorMatrixFilter()` 가 던진다 → 전부
 *    방어. 텍스처가 없어도, 캔버스가 없어도 컨테이너는 예외 없이 선다(계약 §0-6·§0-7).
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 을 읽지도 쓰지도 않고 시간축은 벽시계다.
 * 치수는 전부 `width`/`height`/`shipSize` 파생이다(하드코딩된 창 좌표 없음).
 */

import { CanvasSource, ColorMatrixFilter, Container, Graphics, Sprite, Texture } from 'pixi.js';

// --- 배치 상수(전부 shipSize·height 파생) ---------------------------------------

/**
 * **함선 실루엣의 바닥**이 스프라이트 중심에서 얼마나 아래인가(shipSize 비).
 *
 * ## ⚠️ 이 값을 눈대중으로 잡아 2차 판정 CRITICAL 을 만들었다
 * 1차판은 "대략 0.40 이니 0.38 이면 물리겠지"로 적었다. 2차 실측은 정확히 반대였다:
 * 함선 최하단 화소와 그 아래 첫 크래들 화소 사이가 **중앙값 16px(shot)** 벌어져 있었고,
 * **받침을 그려 놓고 안 닿으니 화면이 스스로 모순을 선언**했다(받침이 없던 1차보다 나쁘다).
 *
 * 그래서 추정을 버리고 **실측 bbox 에서 역산**한다. 비평 실측: 실루엣 bbox `x1189~1399`,
 * 바닥 `y459`(shot px, 디자인→shot 배율 0.9115). 스프라이트는 256px 로 그려지고 중심은
 * 창 로컬에서 정해지므로, 관측된 간격 16 shot px = **17.6 design px** 를 빼면
 * `0.38 − 17.6/256 = 0.311` 이다. 폭도 같은 방법으로: `(1399−1189)/0.9115 = 230 design px`
 * → 반폭 `115/256 = 0.45` ({@link SIL_HALF_K}).
 *
 * **이 두 값이 이 파일의 모든 접지 기하의 정본이다.** 그림자도 크래들도 여기서 파생한다 —
 * 따로 적으면 또 어긋난다.
 */
const SIL_BOTTOM_K = 0.311;
/** 함선 실루엣의 반폭(shipSize 비). 위 실측에서 역산 — 접촉 그림자 코어 폭이 여기서 나온다. */
const SIL_HALF_K = 0.45;
/**
 * 함선 중심에서 **크래들 접지선**까지. 실루엣 바닥과 **같다** — 새들 원호의 양 끝이 그
 * 접지선보다 위로 올라오도록 그리므로({@link drawCradle}) 원호가 선체를 **물고 들어간다.**
 * 접지는 겹침으로 증명한다. 틈이 1px 이라도 보이면 "얹혀 있다"가 아니라 "위에 떠 있다"다.
 */
const SEAT_RATIO = SIL_BOTTOM_K;
/** 크래들 데크 아래로 남겨야 하는 최소 여백(px). 이보다 좁아지면 함선을 위로 올린다. */
const FLOOR_MIN = 34;

/** 접촉 그림자 최대 차폐. 아래 {@link shadowTexture} 검산에서 역산한 값이다. */
const CONTACT_ALPHA = 0.66;
/**
 * 접촉 그림자가 평탄한 코어 반폭(shipSize 비). **{@link SIL_HALF_K} 0.45 에 맞춰 잡는다** —
 * 1차판은 0.30 이었고, 실루엣 가장자리(0.45)에서 감쇠가 0.21 까지 떨어져 띠 평균을 통째로
 * 끌어올렸다. 실루엣 전 폭에서 거의 평탄해야 "실루엣 직하" 표본이 균질해진다.
 */
const CONTACT_CORE_K = SIL_HALF_K - 0.03;
const CONTACT_FEATHER_K = 0.2;
/** 접촉 그림자의 아래쪽 도달(px). 측정 띠가 y+14 까지이므로 그 끝까지 살아 있어야 한다. */
const CONTACT_REACH = 26;
/** 접촉 그림자의 위쪽 도달(px). 선체에 가려지는 쪽이라 짧다. */
const CONTACT_RISE = 8;

/** 확산 그림자 — 부피감. 얕고 넓다. */
const DIFFUSE_ALPHA = 0.24;
/**
 * 확산 코어 반폭 + 페더 = 0.72 = {@link SIL_HALF_K}(0.45) × **1.6** — 계약이 지정한
 * "확산 폭 함선폭 ×1.6" 이다. 1차판은 0.80 이었는데 그건 실루엣 폭이 아니라 **스프라이트 폭**
 * 기준이라 1.78배였다(대조 구간을 필요 이상으로 어둡게 해 비를 왜곡한다).
 */
const DIFFUSE_CORE_K = 0.4;
/** 계약의 "×1.6" 을 상수로 **베끼지 않고 파생**시킨다 — {@link SIL_HALF_K} 가 바뀌면 따라온다. */
const DIFFUSE_FEATHER_K = SIL_HALF_K * 1.6 - DIFFUSE_CORE_K;
const DIFFUSE_REACH = 56;
const DIFFUSE_RISE = 16;
/** 차폐 상한. 1 에 가까우면 순흑 구멍이 뚫려 창 배경이 통째로 사라진다(`gutterRibs` AO_MAX 선례). */
const OCC_MAX = 0.82;

/** 그림자 텍스처가 실루엣 바닥선 위로 잡는 여백(px). {@link CONTACT_RISE}·{@link DIFFUSE_RISE} 를 담는다. */
const SHADOW_PAD_TOP = 24;
/** 그림자 텍스처 높이(px). `SHADOW_PAD_TOP + DIFFUSE_REACH` 보다 넉넉해야 감쇠가 안에서 끝난다. */
const SHADOW_TEX_H = 128;

/**
 * 언더라이트 가산 세기 — **2차 실측으로 재교정**(C3-R2).
 *
 * ## 1차 검산이 왜 절반만 맞았나
 * 1차는 절대값을 모른 채 `B=150·200` 두 시나리오로 잡아 유효 α 0.238 을 냈다. 실측은
 * **0.511 → 0.631**(목표 0.75~0.85)로 절반만 왔다. 상단 33% 는 0.464 → 0.467 로 사실상
 * 불변이라 **방향은 맞고 양이 부족**했다. 게다가 램프 평균도 틀렸다: 0.70 이라고 적었는데
 * 그건 t=0.67~1.0 구간 평균이고, **스프라이트 t=0.81 아래에는 함선 화소가 없다**
 * ({@link SIL_BOTTOM_K}). 실루엣 하단 33% 는 t 0.60~0.81 이고 옛 램프의 그 구간 평균은
 * **0.44** 였다 → 실제 유효 α 는 0.150 이었다.
 *
 * ## 이번엔 관측점 하나로 계를 고정한다(추정 대신 역산)
 * `add` = `dst + src·α`. 유효 α 0.150 에서 R/B 0.631, 무보정 R/B 0.511 이라는 **두 개의
 * 실측**을 연립하면 미지수 B 가 풀린다:
 * ```
 *   (0.511·B + 255·0.150) = 0.631·(B + 60·0.150)
 *   0.511B + 38.25 = 0.631B + 5.68  →  B ≈ 271,  R ≈ 138.7
 * ```
 * (선형광 이상모델의 B 상한 255 를 조금 넘는데, 측정이 sRGB 평균이고 어두운 화소에서 가산이
 * 다르게 포화하기 때문이다. 그래서 **이상모델이 아니라 이 실측 계수를 쓴다.**)
 *
 * 색을 `#FFA028`(255, 160, 40)으로 조금 더 붉게 바꾸면 ΔR=255a · ΔB=40a 이므로 목표 0.80:
 * ```
 *   (138.7 + 255a) = 0.80·(271 + 40a)  →  223a = 78.4  →  유효 α = 0.352
 * ```
 * 새 램프의 하단 33% 평균이 **0.57** 이므로({@link underRampTexture}) 스프라이트 알파
 * **0.62** → 유효 0.353 → **예측 R/B 0.801**. 목표 대역 0.75~0.85 한가운데다.
 *
 * ## 상단 33% 는 왜 안 움직이나
 * 램프가 t ≤ 0.55 에서 정확히 0 이고 실루엣 상단 33% 는 t 0.19~0.40 이라 **한 화소도 닿지
 * 않는다** → 0.467 유지(요구: 0.47 ± 0.03). 상단을 상한으로 거는 것은 대상이 배경 회화가
 * 아니라 스프라이트 오버레이라 계약 §6-1 위험이 없다.
 *
 * ⚠️ 상한의 의미: R/B 가 0.85 를 넘으면 기체 색 정체성이 무너진다. 실루엣 판정식
 * (`B > R+12`)도 함께 봐야 하는데, R/B 0.85 에서 `B−R = 0.15B ≈ 41 > 12` 라 **추출 마스크는
 * 깨지지 않는다**(0.80 이면 54). 여기가 안전 여유의 정본이다.
 */
const UNDERLIGHT_ALPHA = 0.62;
/** 언더라이트 색 — 위 역산이 지정한 값. 림보다 붉다(바닥에서 올라오는 반사광이라 더 따뜻하다). */
const WARM_UNDER = 0xffa028;
/** 림·후광 색 — 창 하단 금빛 램프광. 순백이면 색이 아니라 노출 과다로 읽힌다. */
const WARM = 0xffb43c;
/**
 * 언더라이트 램프가 0 을 벗어나기 시작하는 스프라이트 세로 위치(0=위, 1=아래).
 * 실루엣 상단 33%(t 0.19~0.40)보다 확실히 아래여야 한다 — 그래야 상단 R/B 가 안 움직인다.
 * 종점은 상수가 아니라 {@link SIL_BOTTOM_K} 파생이다(따로 적으면 조용히 어긋난다).
 */
const RAMP_START = 0.55;
/**
 * 선체 뒤 하드 림 사본의 세기·오프셋(px)·확대.
 *
 * ⚠️ 오프셋·확대를 **줄였다**(2 → 1, 1.035 → 1.02). 실루엣 아래로 삐져나온 금빛 프린지가
 * 하필 접지 측정 띠(y+2~+14)에 얹혀 `under/flanking` 을 위로 밀어 올린다. 게다가 접지
 * 그림자를 **림보다 뒤에** 깔면 그 프린지를 못 누른다 — 그래서 z 순서도 함께 바꿨다
 * ({@link makeShipDock} 레이어 표: 림 → 그림자 → 함선).
 */
const RIM_ALPHA = 0.42;
const RIM_OFFSET = 1;
const RIM_SCALE = 1.02;
/**
 * 선체 뒤 소프트 후광(구운 방사 텍스처). 픽셀아트 사본을 확대하면 계단이 생기므로 별도로 굽는다.
 *
 * ## ⚠️ 이 후광이 2차 CRITICAL 의 절반이었다
 * 1차판은 중심을 `shipY + 0.20·shipSize`, 세로 1.05·shipSize 로 두어 **실루엣 아래로 한참
 * 내려왔다.** 가산이라 측정 띠를 그대로 밝히는데, 대조군인 좌우 측면(±40~260px)은 방사
 * 감쇠로 훨씬 덜 받는다 → **함선 직하가 옆보다 밝아진다**(실측 `under/flanking = 1.135`).
 * 내가 보고한 0.63 은 크래들 받침대 아래였고 비평은 함선 실루엣 아래를 쟀다 — 표본 정의가
 * 달라 정반대 결론이 났다(계약 §6-5 가 경고하는 바로 그것).
 *
 * 그래서 후광을 **위로 올리고 좁힌다**: 중심 `shipY − 0.06·shipSize`, 세로 0.78·shipSize.
 * 검산 — 실루엣 바닥(`shipY + 0.311·256 = shipY+79.6`) 아래 +2px 지점까지의 거리는
 * `81.6 + 15.4 = 97` 이고 세로 반경은 100 이라 `p = 0.97` → 폴오프 `(1−p)^2.4 ≈ 0.003`.
 * **측정 띠에 사실상 0 이 닿는다.** 게다가 z 순서를 후광 → 그림자로 두어 남은 몫까지
 * 곱연산으로 눌린다.
 */
const HALO_ALPHA = 0.18;
const HALO_RISE_K = 0.06;
const HALO_H_K = 0.78;
const HALO_W_K = 1.5;

/**
 * 크래들 금빛 4단(그늘 → 앞면 → 윗면 → 수광 립). 순흑·순백 없음 — 회화 위 벡터선 금지 규율.
 * {@link CRADLE_FRONT} 는 2차 판정 ⓒ 로 추가됐다: 받침대가 단색 8px + 1px 밝은 윗변이라
 * **납작한 `div`** 로 읽혔다. 두께가 있는 부재는 윗면과 앞면의 **밝기가 다르다** — 그 2톤이
 * 두께의 유일한 시각적 정의다(광원 규약상 윗면이 밝고 앞면이 그늘진다).
 */
const CRADLE_DARK = 0x2b1c0c;
const CRADLE_FRONT = 0x7d5a24;
const CRADLE_BODY = 0xb8893c;
const CRADLE_LIGHT = 0xf0d08a;

/** 연출 맥동 주기(초)와 진폭. 정비 도크 램프의 아주 느린 숨 — 조작 화면이라 극도로 절제한다. */
const PULSE_PERIOD = 7.4;
const PULSE_AMP = 0.08;
/** dt 상한 — 탭 복귀로 프레임이 튀어도 연출이 순간이동하지 않게(`cinematicTile` 선례). */
const MAX_DT = 1 / 15;

export interface ShipDockOpts {
  /** 창(쇼케이스 패널 콘텐츠 상자)의 로컬 크기. 모든 치수를 여기서 파생시킨다. */
  width: number;
  height: number;
  /** 함선 스프라이트 텍스처(픽셀아트, 없으면 절차적 폴백 삼각형을 리드가 그린다). */
  ship: Texture | undefined;
  /** 함선을 그릴 한 변 크기(px). */
  shipSize: number;
  /** 함선 중심(창 로컬 좌표). */
  cx: number;
  cy: number;
  /**
   * 도크 크래들(원호 새들 · 지지대 · 데크판)을 그릴지. 기본 `true`.
   *
   * ⚠️ **사용자가 격납고에서 이것을 끄기로 확정했다**(2026-08-02). AAA 비평은 "받침이 있어야
   * 접지가 물리적으로 성립한다"며 크래들을 요구했고 실제로 함선을 크래들에 물리는 데까지
   * 갔지만(간격 중앙값 16px → 0), 화면을 본 사용자 판단은 **함선 뒤가 비어 있는 쪽**이었다.
   * 판정 기준은 스크린샷이고 비평 수치는 대리 지표다(계약 §6-6) — 여기서는 사용자가 최종
   * 판정자다.
   *
   * 끄더라도 **접지 그림자·언더라이트·림은 그대로 산다** — 그것들은 실루엣 바닥선
   * ({@link SIL_BOTTOM_K})에서 파생하지 크래들에서 파생하지 않는다. 그래서 함선은 여전히
   * 바닥에 그림자를 드리우고 장면광을 받는다(그게 C3 의 실체였다).
   */
  cradle?: boolean;
}

export interface ShipDock {
  readonly container: Container;
  /** 함선 중심의 실제 좌표(크래들에 앉히느라 조정된 값). 리드가 연결선을 여기로 잇는다. */
  readonly shipX: number;
  readonly shipY: number;
  update(dt: number): void;
  destroy(): void;
}

// --- 굽기 유틸 ------------------------------------------------------------------

/** 0..1 을 부드럽게 잇는 표준 smoothstep. */
function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** 캔버스 2D 컨텍스트 하나. 없으면 `null`(vitest 등) — 호출부는 그래도 화면을 세운다. */
function bakeCanvas(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas.getContext('2d');
}

function fromCanvas(ctx: CanvasRenderingContext2D): Texture {
  const tex = new Texture({ source: new CanvasSource({ resource: ctx.canvas }) });
  tex.source.scaleMode = 'linear';
  return tex;
}

/**
 * 2단 접지 그림자 필드(검정 + 알파, `multiply` 로 합성).
 *
 * ## ⚠️ 표본 정의 — 이 주석이 이 파일에서 가장 중요하다
 * 1차에 내가 보고한 `0.63` 과 비평의 독립 측정 `1.135` 가 정반대였던 이유는 **표본이 서로
 * 다른 것**이었기 때문이다(계약 §6-5). 재발을 막기 위해 정의를 여기 못박는다:
 *
 * > **under** = 함선 **실루엣 마스크**(`B > R+12`)의 열별 최하단 화소 바로 아래 `y+2~+14` 띠.
 * > **flanking** = **같은 y**, 실루엣 좌우 바깥 `±40~260px`.
 * > **지표** = `mean(under) / mean(flanking)` — **곱연산 비**다. 절대 델타는 쓰지 않는다
 * > (`Δ = bg × (1 − ratio)` 라 배경 밝기에 따라 제멋대로 움직인다).
 *
 * 크래들 받침대 아래는 **이 표본이 아니다.** 받침대 접지는 별개로 실재하고(비평 실측
 * 0.486 → 0.611) 그건 그것대로 유효하지만, C3-R1 이 요구하는 것은 **함선 자신의 접지**다.
 *
 * 텍스처 좌표 규약: 폭 `shipSize·2`(중앙이 함선 중심), 세로는 위에서 {@link SHADOW_PAD_TOP}
 * 지점이 **실루엣 바닥선**({@link SIL_BOTTOM_K})이다 — 1차판은 여기를 **크래들 데크선**에
 * 걸었고, 그래서 그림자가 함선이 아니라 받침대 밑에 생겼다. 호출부가 이 규약대로 놓는다.
 *
 * ⚠️ 두 성분은 **최댓값**으로 합친다(합이 아니다). 합은 겹치는 자리를 두 배로 만들어 띠를
 * 남긴다 — `scrim.ts` 의 1px 겹침 가로줄, `gutterRibs.ts` AO 와 같은 함정이다.
 *
 * ## 검산 — `under/flanking` 0.55~0.65 (1.135 → 목표)
 * 대조군도 완전히 0 은 아니다. 확산 반경이 `0.72·256 = 184px` 이고 flanking 은 실루엣 끝
 * (115px)에서 +40 = **155px** 부터 시작하므로 그 안쪽이다:
 *  `(0.605−0.40)/0.32 = 0.64` → `1−ss(0.64) = 0.28` → `occ_f ≈ 0.24·0.28·0.95 ≈ 0.064`.
 *
 * 실루엣 직하(중심선, `fx ≈ 1`):
 *  - dy=2  → `0.66·(1−ss(2/26))  = 0.649`
 *  - dy=8  → `0.66·(1−ss(8/26))  = 0.500`
 *  - dy=14 → `0.66·(1−ss(14/26)) = 0.288`
 *  → 띠 평균 ≈ **0.48**. 코어 반폭 0.42 가 실루엣 반폭 0.45 를 거의 덮어 폭방향 계수는
 *    **0.96**(가장자리에서도 `1−ss(0.145) = 0.94`) → `occ_u ≈ 0.46`.
 *
 * → 비 `= (1 − 0.46) / (1 − 0.064) = 0.54 / 0.936 = ` **0.577** — 대역 한가운데다.
 */
const shadowCache = new Map<number, Texture | null>();

function shadowTexture(shipSize: number): Texture | null {
  const key = Math.round(shipSize);
  const hit = shadowCache.get(key);
  if (hit !== undefined) return hit;

  const w = Math.max(4, key * 2);
  const h = SHADOW_TEX_H;
  const ctx = bakeCanvas(w, h);
  if (ctx === null) {
    shadowCache.set(key, null);
    return null;
  }

  const contactCore = key * CONTACT_CORE_K;
  const contactFeather = Math.max(1, key * CONTACT_FEATHER_K);
  const diffuseCore = key * DIFFUSE_CORE_K;
  const diffuseFeather = Math.max(1, key * DIFFUSE_FEATHER_K);
  const img = ctx.createImageData(w, h);

  for (let ty = 0; ty < h; ty++) {
    const dy = ty + 0.5 - SHADOW_PAD_TOP; // 데크선 기준(양수 = 아래)
    const cy = dy >= 0 ? 1 - smoothstep(dy / CONTACT_REACH) : 1 - smoothstep(-dy / CONTACT_RISE);
    const dyy = dy >= 0 ? 1 - smoothstep(dy / DIFFUSE_REACH) : 1 - smoothstep(-dy / DIFFUSE_RISE);
    for (let tx = 0; tx < w; tx++) {
      const dx = Math.abs(tx + 0.5 - w / 2);
      const cxk = 1 - smoothstep((dx - contactCore) / contactFeather);
      const dxk = 1 - smoothstep((dx - diffuseCore) / diffuseFeather);
      const occ = Math.min(OCC_MAX, Math.max(CONTACT_ALPHA * cy * cxk, DIFFUSE_ALPHA * dyy * dxk));
      const o = (ty * w + tx) * 4;
      img.data[o] = 0;
      img.data[o + 1] = 0;
      img.data[o + 2] = 0;
      img.data[o + 3] = Math.round(occ * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = fromCanvas(ctx);
  shadowCache.set(key, tex);
  return tex;
}

let haloCache: Texture | null | undefined;

/**
 * 소프트 후광(중심 흰색 → 가장자리 소멸). 흰색으로 굽고 쓰는 쪽에서 `tint` 로 색을 준다.
 * 폴오프 지수 2.4 · 16 스톱은 `cinematicTile.ts` `radialGlowTexture` 의 검증된 값이다
 * (선형이면 가장자리에 또렷한 원이 보이고, 스톱이 적으면 밴딩이 보인다).
 */
function haloTexture(): Texture | null {
  if (haloCache !== undefined) return haloCache;
  const size = 128;
  const ctx = bakeCanvas(size, size);
  if (ctx === null) {
    haloCache = null;
    return null;
  }
  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  for (let i = 0; i <= 16; i++) {
    const p = i / 16;
    grad.addColorStop(p, `rgba(255, 255, 255, ${(1 - p) ** 2.4})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  haloCache = fromCanvas(ctx);
  return haloCache;
}

let rampCache: Texture | null | undefined;

/**
 * 언더라이트 마스크 램프(1×256, 흰색 + 알파). 바닥에서 올라오는 반사광이므로 **아랫면에만**
 * 실려야 한다.
 *
 * ⚠️ 띠를 겹쳐 근사하지 않는다(계약 §0-4: 1px 겹침이 알파를 두 배로 만들어 가로줄이 생긴다).
 * 폭 1px 캔버스에 픽셀로 굽고 `linear` 로 늘린다 — 이음매가 원리적으로 없다.
 *
 * ## ⚠️ 1차판 램프가 스프라이트 바닥을 기준으로 잡혀 있었다
 * 옛 램프는 `t=0.45` 에서 시작해 **`t=1.0`(스프라이트 바닥)에서 1** 에 닿았다. 그런데
 * 함선 화소는 `t = 0.5 + `{@link SIL_BOTTOM_K}` = 0.81` 에서 끝난다 — **램프의 가장 센
 * 구간(0.81~1.0)이 빈 공간에 낭비되고 있었다.** 실루엣 하단 33%(t 0.60~0.81)의 평균은
 * 0.44 에 그쳤고, 그게 유효 α 를 0.238 이 아니라 0.150 으로 만든 원인이다.
 *
 * 그래서 램프의 종점을 **실루엣 바닥에 맞춘다**: `ss((t − 0.55) / 0.26)` 이면 `t=0.81` 에서
 * 정확히 1 이다. 검산(실루엣 하단 33% = t 0.60~0.81):
 *  t=0.60 → ss(0.192) = 0.100
 *  t=0.70 → ss(0.577) = 0.634
 *  t=0.81 → 1.000
 *  → 평균 ≈ **0.57**. {@link UNDERLIGHT_ALPHA} 0.62 × 0.57 = 유효 α **0.353**.
 * 상단 33%(t 0.19~0.40)는 시작점 0.55 아래라 **정확히 0** 이다.
 */
function underRampTexture(): Texture | null {
  if (rampCache !== undefined) return rampCache;
  const h = 256;
  const ctx = bakeCanvas(1, h);
  if (ctx === null) {
    rampCache = null;
    return null;
  }
  for (let i = 0; i < h; i++) {
    const t = i / (h - 1);
    // 종점을 **실루엣 바닥**(t = 0.5 + SIL_BOTTOM_K)에 맞춘다 — 스프라이트 바닥이 아니다.
    const a = smoothstep((t - RAMP_START) / (0.5 + SIL_BOTTOM_K - RAMP_START));
    ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
    ctx.fillRect(0, i, 1, 1);
  }
  rampCache = fromCanvas(ctx);
  return rampCache;
}

/**
 * 스프라이트의 **RGB 를 통째로 흰색으로** 밀어 실루엣만 남긴다(알파는 보존).
 *
 * 이게 필요한 이유는 `tint` 가 곱연산이기 때문이다(계약 §0-5). 시안 선체에 금색 tint 를 주면
 * 곱해져 탁한 녹색이 되고, 그 상태로 `add` 하면 원하는 웜 시프트가 아니라 초록 오염이 된다.
 * 흰색으로 만든 뒤 tint 를 주면 **정확히 그 색**이 실루엣 모양으로 가산된다.
 *
 * 실패(캔버스 없는 환경에서 GL 프로그램 준비가 던진다)하면 `false` — 호출부는 그 레이어를
 * 통째로 포기한다. 자산·연출은 덧붙임이지 전제가 아니다(계약 §0-6).
 */
function whiten(sprite: Sprite): boolean {
  try {
    const cm = new ColorMatrixFilter();
    // 5×4 행렬: RGB 계수 0, 오프셋 1(정규화) → 알파와 무관하게 흰색. 알파 행은 그대로 통과.
    cm.matrix = [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0];
    sprite.filters = [cm];
    return true;
  } catch {
    return false;
  }
}

// --- 크래들 --------------------------------------------------------------------

/**
 * 도크 크래들 한 쌍(원호 2개 + 지지대 + 데크판)을 절차적으로 그린다.
 *
 * `front` 가 `true` 면 **함선 위로** 지나가는 앞턱만 그린다. 이 앞턱이 선체 아래 실루엣을
 * 가로지르는 것이 "받침에 앉아 있다"의 가장 강한 단서다 — 뒤에만 그리면 크래들이 함선과 같은
 * 평면에 있는 장식으로 읽힌다.
 *
 * 광원 규약은 `cinematicTile.ts` 베벨·`gutterRibs.ts` 와 같다: **위·왼쪽이 빛을 받고
 * 아래·오른쪽이 그늘진다.** 그래서 어두운 사본을 먼저 아래로 1px 밀어 깔고 몸통을 얹은 뒤
 * 위쪽 모서리에만 수광 립을 남긴다(사방 균일 밝은 스트로크는 금지 — 그게 "오려 붙인 웹 카드"
 * 신호다).
 *
 * ⚠️ **판때기가 아니라 실루엣이다.** 창 배경(이 화면의 유일한 회화)을 덮지 않도록 채움은
 * 데크판 하나뿐이고 나머지는 전부 스트로크다.
 */
/** 새들 두 개의 중심(접지선 원점 기준 ±). 실루엣 반폭 0.45 안쪽이라 둘 다 선체에 물린다. */
const ARM_X_K = 0.3;
/** 새들 원호 반경. */
const ARC_R_K = 0.2;
/**
 * 새들 원호의 중심 높이(반경 비, 음수 = 접지선 위).
 *
 * ## 왜 −0.62 인가 — "같은 카메라를 공유하지 않는다"(2차 MINOR)
 * 1차판은 `−0.34` 에 반원에 가까운 스윕(0.12π~0.88π)이라 **위에서 내려다본 3/4 시점의 깊은
 * 타원**으로 읽혔다. 함선은 순수 정투영 픽셀 스프라이트다 — 두 물체의 카메라가 다르면 아무리
 * 정교해도 한 장면이 안 된다.
 *
 * 그래서 **정면도(front elevation)** 로 바꾼다: 중심을 더 올리고(−0.62) 스윕을 얕게
 * (0.18π~0.82π) 잘라 원호의 **바닥 얕은 구간만** 남긴다. 결과는 깊이감 없는 얕은 U 라
 * 정투영 스프라이트와 같은 카메라로 읽힌다.
 *
 * 부수 효과가 본론이다 — 원호의 **양 끝이 접지선 위로 올라온다**:
 * `y = −0.62·r + sin(0.18π)·r = (−0.62 + 0.536)·r = −0.084·r ≈ −4.3px`.
 * 접지선 = 실루엣 바닥이므로({@link SEAT_RATIO}) 원호가 선체를 **4.3px 물고 들어간다.**
 * 1차판은 이 값이 `+1.2px`(선체 아래)라 실측 간격 중앙값 16px 의 직접 원인이었다.
 */
const ARC_CY_K = -0.62;
const ARC_A0 = Math.PI * 0.18;
const ARC_A1 = Math.PI * 0.82;
/** 뒤 팔이 위로 물러난 양(shipSize 비). 앞뒤 두 팔이 있어야 크래들이 선체를 감싼다. */
const ARM_REAR_LIFT_K = 0.031;

function drawCradle(g: Graphics, shipSize: number, front: boolean): void {
  const armX = shipSize * ARM_X_K;
  const r = shipSize * ARC_R_K;
  const arcCy = r * ARC_CY_K;
  const width = Math.max(6, shipSize * 0.042);
  const plateY = shipSize * 0.17;
  const plateW = shipSize * 0.92;
  // 두께 — 1차판 0.032(8px)는 단색 판 + 1px 밝은 윗변이라 납작한 `div` 로 읽혔다(2차 ⓒ).
  const plateH = Math.max(9, shipSize * 0.055);
  /** 윗면이 차지하는 높이. 나머지가 앞면이다 — 이 2톤이 두께의 유일한 시각적 정의다. */
  const plateTop = Math.max(3, plateH * 0.36);
  const capW = Math.max(4, plateW * 0.035);

  // ⚠️ 호마다 `moveTo` 로 시작한다. 직전 경로의 끝점에서 호가 이어지면 새들 사이에 있지도
  // 않은 연결선이 그어진다(엔진에 따라 다르게 나오는 자리라 명시적으로 끊는다).
  const saddle = (sx: number, dy: number, a0: number, a1: number, color: number, w: number, alpha: number): void => {
    const cy = dy + arcCy;
    g.moveTo(sx + Math.cos(a0) * r, cy + Math.sin(a0) * r)
      .arc(sx, cy, r, a0, a1)
      .stroke({ color, width: w, alpha, cap: 'round' });
  };

  if (front) {
    // 앞 팔 — **선체 위를 가로지른다.** 이것이 "받침에 앉아 있다"의 가장 강한 단서다.
    for (const s of [-armX, armX]) {
      saddle(s, 0, ARC_A0, ARC_A1, CRADLE_DARK, width * 1.3, 0.6);
      saddle(s, 0, ARC_A0, ARC_A1, CRADLE_BODY, width, 0.96);
      // 수광 립은 **왼쪽 위 구간에만**. 사방 균일 밝은 스트로크는 금지(cinematicTile BEVEL_LIGHT).
      saddle(s, 0, ARC_A0, Math.PI * 0.42, CRADLE_LIGHT, Math.max(1.5, width * 0.24), 0.75);
    }
    return;
  }

  // 뒤 팔 — 위로 물러나 있고 그늘져 있다(공기 원근이 아니라 조명이다: 빛이 앞에서 온다).
  const rear = -shipSize * ARM_REAR_LIFT_K;
  for (const s of [-armX, armX]) {
    saddle(s, rear, ARC_A0, ARC_A1, CRADLE_DARK, width * 1.25, 0.7);
    saddle(s, rear, ARC_A0, ARC_A1, CRADLE_FRONT, width * 0.85, 0.9);
  }

  // 지지대 — 새들 바닥에서 데크판까지. 얇게 유지해 창 배경의 램프 보케를 살려 둔다.
  const legTop = arcCy + r;
  for (const s of [-armX, armX]) {
    g.moveTo(s, legTop)
      .lineTo(s, plateY)
      .stroke({ color: CRADLE_DARK, width: width * 0.95, alpha: 0.8 });
    g.moveTo(s - width * 0.18, legTop)
      .lineTo(s - width * 0.18, plateY)
      .stroke({ color: CRADLE_FRONT, width: width * 0.5, alpha: 0.92 });
  }
  // 사재(斜材) — 두 지지대를 잇는 대각. 구조로 읽히게 하는 최소 부재.
  g.moveTo(-armX, plateY)
    .lineTo(armX, legTop)
    .moveTo(armX, plateY)
    .lineTo(-armX, legTop)
    .stroke({ color: CRADLE_DARK, width: Math.max(2, width * 0.3), alpha: 0.45 });

  // --- 데크판(두께 있는 부재) -----------------------------------------------------
  // 판 아래로 번지는 어둠 — 판이 바닥을 누르고 있다는 신호. 비평이 "받침대 아래 접지는
  // 실재한다"(0.486 → 0.611)고 확인한 자리라 유지한다.
  g.rect(-plateW / 2, plateY + plateH - 1, plateW * 0.98, plateH * 0.5).fill({
    color: CRADLE_DARK,
    alpha: 0.5,
  });
  // 앞면(그늘) → 윗면(수광) 순. **이 2톤이 두께다.**
  g.rect(-plateW / 2, plateY + plateTop, plateW, plateH - plateTop).fill({ color: CRADLE_FRONT, alpha: 0.96 });
  g.rect(-plateW / 2, plateY, plateW, plateTop).fill({ color: CRADLE_BODY, alpha: 0.96 });
  // 윗면 앞 모서리의 캐치라이트 — 빛을 받는 모서리 1줄(면 전체를 밝히지 않는다).
  g.rect(-plateW / 2, plateY, plateW, Math.max(1, plateH * 0.12)).fill({ color: CRADLE_LIGHT, alpha: 0.55 });
  // 양 끝 마감 — 끝단을 깎아 판이 **잘린 것이 아니라 끝난 것**으로 읽히게 한다.
  for (const ex of [-plateW / 2, plateW / 2 - capW]) {
    g.rect(ex, plateY, capW, plateH).fill({ color: CRADLE_DARK, alpha: 0.38 });
  }
}

/**
 * 접촉 AO — 선체와 새들이 만나는 **크레바스**에 고이는 그늘(2차 처방 ⓐ 후반부).
 *
 * 원호를 선체에 물리는 것만으로는 부족하다: 겹쳐 놓아도 **닿았다는 증거는 그림자**다. 원호가
 * 선체를 파고드는 네 접점(새들 2개 × 좌우 끝)에 좁고 짙은 어둠을 찍고, 원호 안쪽 가장자리를
 * 따라 얇은 그늘 띠를 두른다.
 *
 * `multiply` 로 합성한다 — 선체 화소의 밝기가 얼마든 **그 자리에서 비율로** 낮아진다
 * (`gutterRibs.ts` AO 와 같은 이유: 절대 휘도로 관리하면 배경이 변할 때 지표가 참인 채로
 * 화면이 틀린다). 호출부가 `blendMode = 'multiply'` 를 걸므로 여기서는 **검정으로만** 그린다.
 */
function drawContactAo(g: Graphics, shipSize: number): void {
  const armX = shipSize * ARM_X_K;
  const r = shipSize * ARC_R_K;
  const arcCy = r * ARC_CY_K;
  const width = Math.max(6, shipSize * 0.042);
  const blob = Math.max(4, shipSize * 0.028);

  for (const s of [-armX, armX]) {
    // 원호 안쪽 가장자리를 따르는 얇은 그늘 띠(선체 쪽으로 반 폭 들어간 자리).
    const ri = Math.max(1, r - width * 0.55);
    g.moveTo(s + Math.cos(ARC_A0) * ri, arcCy + Math.sin(ARC_A0) * ri)
      .arc(s, arcCy, ri, ARC_A0, ARC_A1)
      .stroke({ color: 0x000000, width: Math.max(2, width * 0.45), alpha: 0.34, cap: 'round' });
    // 네 접점 — 원호가 선체를 파고드는 자리. 가로로 눌린 타원이라 크레바스로 읽힌다.
    for (const a of [ARC_A0, ARC_A1]) {
      g.ellipse(s + Math.cos(a) * r, arcCy + Math.sin(a) * r, blob, blob * 0.55).fill({
        color: 0x000000,
        alpha: 0.45,
      });
    }
  }
}

// --- 본체 ----------------------------------------------------------------------

/**
 * 도크 한 벌. 반환 `container` 는 **창 콘텐츠 상자 로컬 좌표계**에 그린다(리드가 상자 원점에
 * 붙인다). `shipX`/`shipY` 는 크래들에 앉히느라 조정된 최종 함선 중심이다.
 *
 * ## 레이어 순서 (뒤 → 앞) — 하나라도 어긋나면 처방이 무효다
 * ```
 *   shadow    2단 접지(multiply) — 창 배경을 비율로 눌러 "닿은 자리"를 만든다
 *   cradle    크래들 본체(데크판·지지대·뒤 새들)
 *   halo      소프트 후광(add) — 도크 램프. **맨 뒤**여야 접지 그림자가 이걸 누른다
 *   cradle    크래들 본체(뒤 팔 · 지지대 · 사재 · 데크판)
 *   rim       선체 뒤 하드 림 사본(흰색화 + 금색 tint + add)
 *   shadow    2단 접지(multiply) — **실루엣 바닥** 기준. 후광·림의 새어 나온 밝기까지 누른다
 *   ship      원본 픽셀아트(무보정 — 기체 정체성)
 *   under     언더라이트(흰색화 + 호박색 tint + add, 세로 램프 마스크)
 *   contact   접촉 AO(multiply) — 선체와 새들 사이 크레바스
 *   front     크래들 앞 팔 — 선체 위를 가로질러 "앉아 있다"를 확정한다
 * ```
 * ⚠️ 2차 판정에서 **순서 자체가 결함이었다**: 후광이 접지 그림자 뒤(=위)에 있어 측정 띠를
 * 밝혔고, 그림자는 실루엣이 아니라 크래들 데크에 걸려 있었다. 배치를 바꾸지 않고 값만
 * 만졌다면 영영 안 맞는 구조였다.
 *
 * ## 창 배경을 새로 덮는 화소 비율 (계약 요구 보고 항목)
 * 불투명 채움은 데크판 하나뿐이고, 2차 처방 ⓒ 로 두께가 8 → 14px 이 됐다:
 * `0.92×256 × 0.055×256 ≈ 236 × 14 ≈ 3,300 px²`. 스트로크(새들 4호·지지대·사재)는
 * α 0.38~0.96 이라 완전 불투명이 아니지만 최악을 가정해 전부 세면
 * 새들 4 × (호길이 103 × 11) ≈ 4,530 px² · 지지대 2 × 10×24 ≈ 480 px² · 사재 ≈ 700 px²
 * → 합계 **≈ 9,000 px²**. 창 936×428 ≈ 400,600 px² 대비 **약 2.2%** 다(1차 1.45%,
 * 비평 독립 측정 Δ>60 = 1.62%). 나머지 레이어는 전부 `multiply`/`add` 라 원화를 지우지
 * 않고 변조만 한다 — 비평이 확인한 창 |HF| 17.15 → 17.59 무회귀를 이 구조가 보장한다.
 */
export function makeShipDock(o: ShipDockOpts): ShipDock {
  const { width, height, shipSize, cx, cy } = o;
  const container = new Container();
  // 도크는 클릭 대상이 아니다 — 뒤의 창·슬롯 히트 테스트를 가로채면 안 된다.
  container.eventMode = 'none';

  // --- 접지선 결정 ---------------------------------------------------------------
  // 데크선은 **함선에서 파생**한다(창 하단에 고정하지 않는다). 창이 낮아 데크가 바닥 여백을
  // 침범할 때만 함선을 위로 올린다 — 그래야 어떤 창 높이에서도 크래들이 상자 안에 들어온다.
  const seat = shipSize * SEAT_RATIO;
  const maxDeck = height - FLOOR_MIN;
  let deckY = cy + seat;
  let shipY = cy;
  if (deckY > maxDeck) {
    deckY = maxDeck;
    shipY = deckY - seat;
  }
  // 크래들 데크판이 창 밖으로 나가면 잘린 판때기가 되어 받침으로 안 읽힌다. 리드가 `cx` 를
  // 창 중앙이 아닌 곳에 둘 수 있으므로 여기서 창 폭을 실제로 쓴다(전제하지 않고 강제한다).
  const halfPlate = shipSize * 0.46 + 8;
  const shipX = width >= halfPlate * 2 ? Math.min(Math.max(cx, halfPlate), width - halfPlate) : cx;

  // --- ⓒ 후광(도크 램프) ---------------------------------------------------------
  // ⚠️ **가장 먼저** 깐다. 2차 판정에서 이 가산 후광이 접지 측정 띠를 밝혀 `under/flanking`
  // 을 1.135 로 만들었다({@link HALO_ALPHA} 헤더). 접지 그림자보다 뒤에 두면 남은 몫까지
  // 곱연산으로 눌린다 — 순서가 처방의 일부다.
  const haloTex = haloTexture();
  let halo: Sprite | null = null;
  if (haloTex !== null) {
    halo = new Sprite(haloTex);
    halo.anchor.set(0.5);
    halo.tint = WARM;
    halo.blendMode = 'add';
    halo.alpha = HALO_ALPHA;
    // 실루엣 아래로 내려오지 않게 **위로 올려** 좁게 잡는다. 아랫면 웜 시프트는 후광이 아니라
    // 언더라이트가 만든다(그쪽은 실루엣 마스크 안이라 측정 띠를 건드리지 않는다).
    halo.position.set(shipX, shipY - shipSize * HALO_RISE_K);
    halo.width = shipSize * HALO_W_K;
    halo.height = shipSize * HALO_H_K;
    container.addChild(halo);
  }

  // --- ⓑ 크래들(본체) -----------------------------------------------------------
  const showCradle = o.cradle !== false;
  if (showCradle) {
    const cradleBack = new Graphics();
    drawCradle(cradleBack, shipSize, false);
    cradleBack.position.set(shipX, deckY);
    container.addChild(cradleBack);
  }

  // --- ⓒ 선체 뒤 하드 림 ---------------------------------------------------------
  // ⚠️ Pixi v8 은 `Sprite` 에 자식을 못 넣는다 → **형제 + 변환 미러**(스케일 포함)다.
  let rim: Sprite | null = null;
  if (o.ship !== undefined) {
    const s = new Sprite(o.ship);
    s.anchor.set(0.5);
    s.width = shipSize * RIM_SCALE;
    s.height = shipSize * RIM_SCALE;
    s.position.set(shipX, shipY + RIM_OFFSET);
    if (whiten(s)) {
      s.tint = WARM;
      s.blendMode = 'add';
      s.alpha = RIM_ALPHA;
      container.addChild(s);
      rim = s;
    } else {
      // 흰색화가 불가능하면 금색 tint 가 선체색과 곱해져 탁해진다 → 레이어를 포기한다.
      s.destroy();
    }
  }

  // --- ⓐ 2단 접지 그림자 ---------------------------------------------------------
  // ⚠️ 기준선은 **크래들 데크가 아니라 실루엣 바닥**이다(1차판의 CRITICAL 원인 —
  // {@link shadowTexture} 헤더의 표본 정의). 지금은 둘이 같은 값이지만
  // ({@link SEAT_RATIO} = {@link SIL_BOTTOM_K}) 의미가 다르므로 실루엣에서 파생시킨다.
  // ⚠️ 후광·림 **뒤에** 깐다 — 그래야 그 둘이 측정 띠에 흘린 밝기까지 함께 눌린다.
  const silBottomY = shipY + shipSize * SIL_BOTTOM_K;
  const shadowTex = shadowTexture(shipSize);
  if (shadowTex !== null) {
    const shadow = new Sprite(shadowTex);
    shadow.width = shipSize * 2;
    shadow.height = SHADOW_TEX_H;
    shadow.position.set(shipX - shipSize, silBottomY - SHADOW_PAD_TOP);
    // 곱연산 — 배경 휘도를 **비율로** 낮춘다. 알파 검정으로는 밝은 자리와 어두운 자리에서
    // 서로 다른 비가 나와 지표가 자리마다 뒤집힌다(`gutterRibs.ts` 6라운드 교훈).
    shadow.blendMode = 'multiply';
    container.addChild(shadow);
  }

  // --- 함선 원본 ------------------------------------------------------------------
  // 무보정이다. 채도·색조를 만지면 기체 정체성(파밍 시각 언어)이 인게임과 갈린다.
  // 공유 텍스처의 `source.scaleMode` 도 건드리지 않는다 — 다른 화면이 같은 source 를 쓴다.
  if (o.ship !== undefined) {
    const sp = new Sprite(o.ship);
    sp.anchor.set(0.5);
    sp.width = shipSize;
    sp.height = shipSize;
    sp.position.set(shipX, shipY);
    container.addChild(sp);
  }

  // --- ⓒ 언더라이트(아랫면 웜 바운스) --------------------------------------------
  let under: Sprite | null = null;
  const rampTex = underRampTexture();
  if (o.ship !== undefined && rampTex !== null) {
    const s = new Sprite(o.ship);
    s.anchor.set(0.5);
    s.width = shipSize;
    s.height = shipSize;
    s.position.set(shipX, shipY);
    if (whiten(s)) {
      s.tint = WARM_UNDER;
      s.blendMode = 'add';
      s.alpha = UNDERLIGHT_ALPHA;
      // 세로 램프 마스크 — 스프라이트 마스크는 알파를 쓴다. 마스크도 씬 그래프에 있어야 한다.
      const ramp = new Sprite(rampTex);
      ramp.width = shipSize;
      ramp.height = shipSize;
      ramp.position.set(shipX - shipSize / 2, shipY - shipSize / 2);
      container.addChild(s);
      container.addChild(ramp);
      s.mask = ramp;
      under = s;
    } else {
      s.destroy();
    }
  }

  // --- ⓐ 접촉 AO(선체–새들 크레바스) ----------------------------------------------
  // 겹쳐 놓는 것만으로는 부족하다 — **닿았다는 증거는 그림자**다. 앞턱보다 아래(뒤)에 둬야
  // 그늘이 크레바스 안에 고인 것으로 읽힌다(앞턱 위에 얹으면 부재에 낀 때가 된다).
  //
  // ⚠️ **크래들이 없으면 이 AO 도 없다.** 이것은 원호가 선체를 파고드는 네 접점의 그늘이라
  // 새들이 안 그려지면 근거 없는 어둠이 된다 — 함선 아래 좌우에 **정체 모를 검은 갈고리 두
  // 개**로 남는다(챔피언 선택 화면에서 shipSize 380 으로 키우자 또렷이 드러났다. 격납고는
  // 256 이라 눈에 덜 띄었을 뿐 같은 결함이다).
  if (showCradle) {
    const contactAo = new Graphics();
    drawContactAo(contactAo, shipSize);
    contactAo.position.set(shipX, deckY);
    contactAo.blendMode = 'multiply';
    container.addChild(contactAo);
  }

  // --- ⓑ 크래들 앞턱 ---------------------------------------------------------------
  let cradleFront: Graphics | null = null;
  if (showCradle) {
    cradleFront = new Graphics();
    drawCradle(cradleFront, shipSize, true);
    cradleFront.position.set(shipX, deckY);
    container.addChild(cradleFront);
  }

  // --- 연출 ------------------------------------------------------------------------
  // 아주 느린 램프 숨. 정비 도구 화면이라 진폭 8% 를 넘기지 않는다(움직이는 배경은 클릭이
  // 흔들리는 느낌을 준다 — 계약 Lane A 항목과 같은 규율).
  let time = 0;
  const update = (dt: number): void => {
    const step = Math.min(Math.max(dt, 0), MAX_DT);
    time += step;
    const k = 1 + Math.sin((time / PULSE_PERIOD) * Math.PI * 2) * PULSE_AMP;
    if (halo !== null) halo.alpha = HALO_ALPHA * k;
    if (rim !== null) rim.alpha = RIM_ALPHA * k;
    if (under !== null) under.alpha = UNDERLIGHT_ALPHA * k;
    if (cradleFront !== null) cradleFront.alpha = 1 - (k - 1) * 0.25;
  };
  // 첫 프레임 전에도 정지 상태가 정확하도록 한 번 정착시킨다(update 가 안 불려도 안전).
  update(0);

  const destroy = (): void => {
    // 캐시된 굽기 텍스처는 **반납하지 않는다** — 다음 렌더가 같은 텍스처를 다시 쓴다.
    // `destroy({ children: true })` 는 기본값이 텍스처 비파괴라 이대로 안전하다.
    container.destroy({ children: true });
  };

  return { container, shipX, shipY, update, destroy };
}
