/**
 * 거터 석재 콜로네이드 — 카드 격자를 **담는 건축 크롬**(주두 · 기둥 · 칼라 · 기초 · 접지 음영).
 *
 * ## 왜 리브가 존재하는가
 * 4라운드까지 거터의 어둠은 배경 원화에 맡겨져 있었다. 그런데 원화에는 밝은 세로 대역이
 * **있었고**, 그게 하필 카드 뒤에 깔리고 어두운 대역이 거터에 깔렸다 — 원화의 주기와 격자의
 * 주기(458px)가 안 맞았던 것이다. 증폭으로는 못 푼다. AAA 허브가 쓰는 방식은 원화 위에
 * 격자를 얹는 것이 아니라 **격자를 담는 크롬을 그리고 그 뒤에 원화를 두는 것**이다.
 *
 * ## ⚠️ 6라운드가 뒤집은 것 — "올바른 축을 재고 있는가"
 * 5라운드까지 이 파일이 자랑한 수치는 전부 **리브 내부 지표**였다: 폭방향 std 21.9, 잔차 4.16,
 * 주두 대비 +32.7. 전부 참이었다. 그런데 "주두 대비 +32.7" 의 배경값 45 는 **내가 가정한
 * 상수였지 잰 픽셀이 아니었다.** 실화면(v11)을 재 보니 거터 배경 휘도는 자리마다
 * **L21~L96** 으로 네 배 넘게 흔들린다. 그 위에 절대 휘도로 고정된 기둥을 놓았으니 결과는:
 *
 * ```
 *   design y        300   420   560   700   850   960
 *   명부−배경 x=502  +26    +9    -6   -16    +2    -2
 *   명부−배경 x=1418 +48   +30   +24    -6    +1   -11
 * ```
 *
 * **기둥의 밝은 쪽이 배경보다 어두운 자리가 절반이다.** 원통으로 안 읽히는 이유가 여기 있었고,
 * 내 지표 어디에도 이 축이 없었다. 교훈은 상수가 아니라 방법에 있다: **대비는 상대량인데
 * 절대 휘도로 관리하면, 배경이 변하는 순간 지표가 참인 채로 화면이 틀린다.**
 *
 * ## 그래서 이 판의 1차 장치는 재질이 아니라 **AO(주변광 차폐)** 다
 * 배경 휘도를 이 파일이 읽을 수는 없다(원화는 Lane A 소유이고 여기로 넘어오지 않는다).
 * 하지만 **배경을 어둡게 만드는 것은 할 수 있다.** 기둥 둘레에 곱연산 AO 를 깔면 국소 배경이
 * 그 자리에서 절반이 되므로, 배경이 L96 이든 L21 이든 **기둥이 항상 자기 주변보다 밝다** —
 * 절대 휘도를 맞히려는 시도(원리적으로 불가능)가 아니라 **비교 대상을 내가 만드는 것**이다.
 * `baseBackdrop` 의 국소 톤매핑이 "평균을 지정값으로 직접 앉힌" 것과 같은 계열의 처방이다:
 * 원본이 변해도 결과가 고정되게 하려면 연산이 국소적이어야 한다.
 *
 * 부수 효과가 아니라 **주 효과**가 하나 더 있다: 접지. 6라운드 판정 [C2] 는
 * *"아무것도 받치지 않고 아무데도 서 있지 않은 기둥은 이 프레임 전체에서 가장 큰 아마추어
 * 신호"* 였다. 실측으로 기초 구간(design y≈985~1037)에서 **기둥이 배경보다 20~55 어두웠고**,
 * 접촉 그림자가 없으니 기둥이 바닥에 닿는 지점이 그냥 **끊긴 자리**였다. AO 는 그 자리
 * *배경을* 어둡게 만들어 기둥이 바닥을 **누르고 있는** 것으로 만든다.
 *
 * AO 는 세 성분의 **최댓값**이다(합이 아니다 — 합은 겹치는 자리를 두 배로 만들어 띠를 남긴다.
 * `scrim.ts` 헤더의 1px 겹침 가로줄과 같은 함정이고, `baseBackdrop` 의 목표장도 같은 이유로
 * 최댓값을 쓴다):
 *  1. **측면 차폐** — 기둥 실루엣 바깥으로 감쇠. 광원이 좌상단이므로 **오른쪽이 더 넓고 짙다**.
 *  2. **접촉 타원** — 기초 바닥에 폭 1.6×샤프트 · 높이 0.25×폭. 물체가 바닥에 닿는 유일한 증거.
 *  3. **소핏/바닥 포켓** — 주두 위 {@link AO_TOP}px(상인방 밑면 그늘) · 기초 아래
 *     {@link AO_BOT}px(바닥에 고이는 그늘).
 *
 * ## 광원 규약
 * `cinematicTile.ts` 의 베벨과 같다 — **위·왼쪽이 빛을 받고 아래·오른쪽이 그늘진다.** 좌 수광
 * 립, 우 코어 그림자, 주두 아래 그림자, 기초 상단 수광 모서리, AO 의 좌우 비대칭이 전부 그 한
 * 광원에서 나온다. 어긋나면 카드와 리브가 다른 장면이 된다.
 *
 * ## 왜 텍스처로 굽는가 (띠 근사 금지)
 * ⚠️ 얇은 사각형을 겹쳐 그라디언트를 근사하면 **1px 겹침이 알파를 두 배로 만들어 가로줄**이
 * 남는다(`scrim.ts` 헤더, 실제 사용자 신고). 단면 램프·조인트·그레인·AO 를 전부 **픽셀로 한 번
 * 굽고** 스프라이트로 그린다. 그레인 난수는 xorshift 로 **결정적**이다(`cinematicTile.ts` 선례) —
 * 굽기가 매번 같아야 비평 스크린샷 회귀 비교가 성립한다.
 *
 * ## 자산 없이도 서야 한다
 * 캔버스가 없는 환경(vitest)에서는 텍스처를 못 굽는다. 그때는 **겹치지 않는 불투명 단색 띠**로
 * 단면을 계단 근사한다. 화면은 서고, 예외는 나지 않는다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 을 읽지도 쓰지도 않는다. 시간축도 없다(정적 크롬).
 */

import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { DESIGN_WIDTH } from '../../render/app.js';

/** 거터에 세우는 기둥 하나. `x` 는 **중심선**(디자인 좌표), `y0`/`y1` 은 격자 행 상·하단이다. */
export interface RibLine {
  x: number;
  y0: number;
  y1: number;
}

export interface GutterRibs {
  /** 리드가 배경 위·카드 아래에 붙인다. */
  readonly view: Container;
  destroy(): void;
}

// --- 치수(디자인 스페이스 1920×1080) ---
/**
 * 기둥 몸통 폭. 거터는 `TILE_GAP` 34px 이므로 좌우 4px 씩 배경이 남는다 — 그 4px 이 AO 가
 * 보이는 자리이자 "기둥 뒤에 벽이 있다"는 유일한 증거다(꽉 채우면 다시 틈 메우기가 된다).
 * 짝수여야 `x − W/2` 가 정수로 떨어져 위상이 기둥마다 흔들리지 않는다.
 */
const SHAFT_W = 26;
/** 주두·기초·칼라 폭. 몸통보다 넓다 — 돌출한 부재가 그림자를 드리우는 것이 기둥의 정의다. */
const CAP_W = 32;
/** 주두가 격자 위로 올라가는 높이(격자 상단 y0=226 기준 y≈164). */
const CAP_H = 62;
/** 주두가 몸통과 겹치는 길이. 이음매가 격자 경계선과 정확히 겹치지 않게 밀어 넣는다. */
const CAP_LAP = 8;
/** 기초가 격자 아래로 내려가는 깊이(격자 하단 y1≈985 기준 y≈1037). */
const BASE_H = 52;
const BASE_LAP = 8;
/**
 * 중간 칼라 링 높이([C9]). 행 사이 거터(design y≈585~620)가 프레임에서 가장 비어 있다는
 * 판정에 대한 답이다 — **신규 아트 0 으로 가로 리듬을 얻는다.** 위치는 `(y0+y1)/2` 에서
 * 파생하므로(≈605) 격자 행 높이가 바뀌어도 행 사이에 남는다.
 */
const COLLAR_H = 34;

/**
 * 가로 슈퍼샘플 배수. 디자인→디바이스 배율이 0.9115 라 1px 선은 위상에 따라 피크가 절반으로
 * 무너진다. 2배로 구워 `linear` 로 축소하면 그 위상차가 보간으로 흡수된다.
 */
const SHAFT_SS = 2;

// --- 재질 ---
/**
 * 색조 앵커. 가중치 `w` 가 −1(차가운 코어 그림자) → 0(따뜻한 석재) → +1(금빛 수광 립)로
 * 간다. 각 벡터는 굽는 시점에 **루마 1 로 정규화**되므로 색조와 밝기가 분리된다 — 안 그러면
 * 한쪽을 만질 때마다 다른 쪽이 어긋난다.
 *
 * [C3] "명부 웜 · 코어 쿨" 이 이 축으로 표현된다: 명부는 `w>0`(금빛 램프광을 받는 면),
 * 코어 섀도는 `w=−1`(직사광이 안 닿고 환경광만 받는 면). 실물 조명이 그렇다.
 */
const TINT_COOL = { r: 0.86, g: 0.93, b: 1.12 } as const;
const TINT_STONE = { r: 1.17, g: 0.97, b: 0.71 } as const;
const TINT_GOLD = { r: 1.3, g: 1.0, b: 0.58 } as const;

/** 단면 램프의 한 지점. `px` 는 기둥 왼쪽 끝에서의 디자인 px, `l` 은 휘도, `w` 는 색조 가중치. */
interface ProfileStop {
  px: number;
  l: number;
  w: number;
}

/**
 * 기둥 단면 램프 — **이 파일의 1차 조형 수단.**
 *
 * 세로로만 변하는 면은 원리적으로 폭방향 분산이 0 이라, 세로 램프만으로는 아무리 색을 바꿔도
 * 원기둥이 될 수 없다(앞판 실측 폭방향 std 0.71). 여기서는 좌 수광 립 → **넓은 명부** →
 * 터미네이터 → 코어 섀도의 연속 램프가 폭방향 std ≈ 22 를 만든다.
 *
 * ⚠️ [C3] 으로 **명부를 넓히고 올렸다.** 앞판은 밝은 구간이 립 2px + 급강하라, 화면에서
 * "밝은 세로선 하나 + 어두운 판"으로 읽혔다(터미네이터는 있었지만 명부가 없었다). 원통의
 * 밝은 쪽은 **면**이어야 한다 — px 3.5~7 을 96→88 로 완만히 유지해 왼쪽 25% 가 하나의
 * 수광면이 되게 했다. 코어는 9 까지 더 내렸다(앞판 10~12).
 *
 * 검산(폭 26px): 2×118 · 1×104 · 4×평균92 · 6×평균73 · 6×평균48 · 3.5×평균24 · 3.5×9
 * → **평균 ≈ 59.6**. {@link SHAFT_GAIN} 을 곱해 화면 몸통 평균 56 대역(거터 목표 52~58)에 앉는다.
 */
const SHAFT_PROFILE: readonly ProfileStop[] = [
  { px: 0, l: 118, w: 0.85 },
  { px: 2, l: 118, w: 0.85 },
  { px: 3, l: 104, w: 0.55 },
  { px: 3.5, l: 96, w: 0.34 },
  { px: 7, l: 88, w: 0.3 },
  { px: 13, l: 62, w: 0 },
  { px: 19, l: 38, w: -0.35 },
  { px: 22.5, l: 16, w: -0.8 },
  { px: 23.5, l: 9, w: -1 },
  { px: 26, l: 9, w: -1 },
];

/** 세로 램프(위가 밝고 아래로 어두워진다 — 카드 밴드와 같은 광원 규약). */
const SHAFT_V_TOP = 1.1;
const SHAFT_V_BOTTOM = 0.76;
/**
 * 몸통 휘도 이득. **몸통 평균은 유지하라고 못박힌 값**이다(거터 목표 대역 52~58) — 단면을
 * 바꿀 때마다 이 상수가 **반대로 움직여** 평균을 붙잡는다.
 */
const SHAFT_GAIN = 0.94;

// --- 가로 조인트(석재 단) ---
/**
 * 조인트 기준 피치. [C5] "링 피치가 등간격이라 사다리·대나무로 읽힌다" 에 대한 답으로
 * {@link jointRows} 가 지평 기준 단축을 적용하므로, 이 값은 **단축 전** 기준이다.
 */
const JOINT_BASE = 19;
/** 피치 지터(±). 완전 균등은 벽지, 완전 무작위는 석공 작업으로 안 읽힌다. */
const JOINT_JITTER = 2;
/**
 * 지평선(디자인 y). 세로 원통에 감긴 수평 링은 **눈높이에서 가장 납작하게(촘촘하게) 보이고**
 * 위아래로 갈수록 벌어진다 — 그게 원근이다. 아래 식이 그 단축이다:
 * `pitch = JOINT_BASE · (0.55 + 0.45·sin(pi·t))`, `t = |y − HORIZON| / 최대거리`.
 * `t=0`(지평)에서 `sin=0` 이라 피치가 0.55배로 **최소**가 된다.
 */
const JOINT_HORIZON = 560;
/** 조인트 홈(어둡게)과 그 바로 위 단의 수광 모서리(밝게). 위가 밝은 광원 규약 그대로다. */
const JOINT_DARK = 0.58;
const JOINT_LIGHT = 1.13;

/**
 * 표면 잔차 — 셀 노이즈(중주파 얼룩) + 미세 그레인(고주파). 배경 기둥은 4px 흐림이 걸린
 * 저주파 덩어리이므로, **재질 해상도**가 이 기둥을 앞에 세운다(밝기가 아니다).
 */
const CELL_SIZE = 7;
const CELL_AMPL = 5;
const GRAIN_AMPL = 8;

/** 주두·기초·칼라 휘도 이득. 기초가 높은 것은 화면 하단 배경이 밝기 때문이다(실측 L78~96). */
const CAP_GAIN = 1.16;
const BASE_GAIN = 1.12;
const COLLAR_GAIN = 1.06;

// --- AO(주변광 차폐) — [C2] ---
/** AO 텍스처의 좌우 반폭. 감쇠가 이 안에서 끝나야 경계선이 안 생긴다. */
const AO_HALF = 44;
/** 주두 위 소핏 그늘 길이(상인방 밑면). */
const AO_TOP = 40;
/** 기초 아래 바닥 그늘 길이. */
const AO_BOT = 60;
/**
 * 측면 차폐의 최대 세기와 도달 거리. **오른쪽이 더 짙고 넓다** — 광원이 좌상단이므로 기둥이
 * 오른쪽 벽에 그림자를 드리운다. 이 비대칭이 없으면 AO 가 "외곽선"으로 읽힌다.
 */
const AO_LEFT_PEAK = 0.5;
const AO_LEFT_REACH = 16;
const AO_RIGHT_PEAK = 0.68;
const AO_RIGHT_REACH = 30;
/**
 * 격자 **밖**(주두·기초 구간) 차폐 증폭. 그 구간은 배경이 열려 있고 실측상 가장 밝아
 * (주두 옆 L85~113 · 기초 옆 L78~96) 같은 세기로는 부재가 여전히 어두운 얼룩으로 남는다.
 */
const AO_OPEN_BOOST = 1.3;
/** 차폐 상한. 1 에 가까우면 순흑 구멍이 뚫려 배경이 통째로 사라진다. */
const AO_MAX = 0.85;
/**
 * 원경 기둥의 AO 감쇠 계수([C4] 와 짝). 먼 그림자는 흐리지만 **없지는 않다.**
 *
 * ⚠️ 처음엔 `1 − 0.4·recess` 로 잡았다가 예측에서 바깥 기둥 명부 델타가 **음수로 떨어졌다** —
 * 몸통은 헤이즈로 흐려지는데 AO 까지 40% 깎이니 **양쪽에서 동시에 지는** 구조였다. 공기
 * 원근은 대비를 줄이는 것이지 물체를 배경보다 어둡게 만드는 것이 아니다.
 */
const AO_RECESS_FADE = 0.18;
/** 접촉 타원 — 폭 1.6×샤프트, 높이 0.25×폭, 코어 알파 0.55(6라운드 지정값). */
const CONTACT_W_K = 1.6;
const CONTACT_H_K = 0.25;
const CONTACT_ALPHA = 0.55;

// --- 원경 후퇴 — [C4] ---
/**
 * 콜로네이드 끝 기둥의 후퇴. **화면 중앙에서의 거리**로 정한다.
 *
 * ## 왜 "첫 번째와 마지막 기둥"이 아닌가
 * 기둥이 3개(칸 사이만)일 때 끝 두 개는 **안쪽 거터**다 — 서수 규칙은 정확히 반대로 틀린다.
 * 3→5 변경이 이미 한 번 일어났고 또 바뀔 수 있다. "화면 가장자리에 붙은 기둥이 어둡다"는
 * 개수와 무관하게 참이라 서수 특례 없이 두 배치 모두에서 옳다(3개 배치의 x=502/1418 은
 * 정규화 거리 0.48 이라 후퇴가 정확히 0 이 된다).
 *
 * ## ⚠️ [C4] 축소만으로는 "먼 기둥"이 아니라 "다른 기둥"이 된다
 * 앞판은 tint 0.646 곱 하나였다. 곱연산은 평균과 대비를 **같은 비율로** 줄이므로 결과는
 * 그냥 어두운 기둥이다 — 실측 outer 최소 4.4 vs center 6.4 로 **오히려 더 어두웠다.** 공기
 * 원근의 실제 내용은 ①국소 대비가 **줄고** ②색이 **대기색으로 수렴**하는 것, 즉 어두워지는
 * 게 아니라 **흐려지는** 것이다. 그래서 tint 를 버리고 굽는 단계에서 대비를 압축하고 헤이즈에
 * 섞는다(`bakePiece` 의 `recess`).
 */
const RECESS_START = 0.82;
/** 후퇴 최대치에서의 국소 대비 배율. */
const RECESS_CONTRAST = 0.55;
/** 후퇴 최대치에서 대기색으로 섞이는 비율. */
const RECESS_HAZE_MIX = 0.35;
/** 대기(헤이즈) 휘도와 색조. 유적 안의 환경광 — 살짝 차갑다. */
const RECESS_HAZE_L = 32;
const RECESS_HAZE_W = -0.25;

/** 세로 프로파일의 한 지점(`y` 는 부재 상단에서의 디자인 px, `m` 은 휘도 배율). */
interface VStop {
  y: number;
  m: number;
}

/**
 * 주두 세로 조형 — 관판(abacus) → **관판 아래 그림자** → 에키누스 수광 → 목 → 홈 → 전이.
 *
 * ⚠️ y0 캐치라이트를 1.35 → 0.92 로 **내렸다.** Lane C 의 상인방이 주두 **위에 얹히므로**
 * 관판 상면은 빛을 받는 면이 아니라 **가려진 면**이다([C2]③ "기둥 쪽 접점 음영"). 대신
 * y2~5 의 관판 바깥 모서리가 측광을 받아 캐치라이트를 가진다 — 부재가 상인방을 실제로
 * 받치고 있다는 신호가 여기서 나온다.
 *
 * ⚠️ y 는 절대 px 라 {@link CAP_H} 를 바꾸면 여기도 다시 잡아야 한다(비율로 두면 1~2px 홈까지
 * 늘어나 뭉갠다). 총높이 `CAP_H + CAP_LAP` = 70 에 맞춘 표다.
 */
const CAP_V: readonly VStop[] = [
  { y: 0, m: 0.92 },
  { y: 2, m: 1.36 },
  { y: 5, m: 1.18 },
  { y: 10, m: 1.05 },
  { y: 11, m: 0.42 },
  { y: 14, m: 0.48 },
  { y: 15, m: 1.24 },
  { y: 30, m: 0.95 },
  { y: 31, m: 0.8 },
  { y: 40, m: 0.88 },
  { y: 42, m: 0.42 },
  { y: 45, m: 0.92 },
  { y: 70, m: 0.86 },
];

/**
 * 기초 세로 조형 — 몸통 → 홈 → 토러스 수광 → 그 아래 그림자 → 대좌 상단 수광 모서리 →
 * 대좌 → **바닥 접지 그늘**. 마지막 0.38 이 접지다: 이게 없으면 기둥이 바닥에 놓인 것이
 * 아니라 잘린 것으로 읽힌다. 총높이 `BASE_LAP + BASE_H` = 60.
 */
const BASE_V: readonly VStop[] = [
  { y: 0, m: 0.85 },
  { y: 14, m: 0.8 },
  { y: 15, m: 0.45 },
  { y: 17, m: 1.22 },
  { y: 24, m: 0.95 },
  { y: 26, m: 0.5 },
  { y: 28, m: 1.26 },
  { y: 33, m: 1.0 },
  { y: 52, m: 0.78 },
  { y: 60, m: 0.38 },
];

/** 중간 칼라 세로 조형([C9]) — 위 홈 → 수광 모서리 → 띠 → 아래 그림자. 총높이 34. */
const COLLAR_V: readonly VStop[] = [
  { y: 0, m: 0.85 },
  { y: 4, m: 0.45 },
  { y: 6, m: 1.28 },
  { y: 14, m: 1.0 },
  { y: 22, m: 0.85 },
  { y: 24, m: 0.42 },
  { y: 27, m: 0.95 },
  { y: 34, m: 0.88 },
];

// --- 순수 함수 -----------------------------------------------------------------

/** 0..1 을 부드럽게 잇는 표준 smoothstep. */
function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** 결정적 해시(xorshift32) → 0..1. `Math.random` 은 세션마다 굽기를 바꿔 회귀 비교를 깬다. */
function hash01(n: number): number {
  let h = n | 0;
  h ^= h << 13;
  h >>>= 0;
  h ^= h >>> 17;
  h ^= h << 5;
  h >>>= 0;
  return h / 0xffffffff;
}

/** 단면 램프를 `px` 에서 선형 보간한다(구간 밖은 양 끝 값으로 고정). */
function sampleProfile(px: number): { l: number; w: number } {
  const stops = SHAFT_PROFILE;
  const first = stops[0] ?? { px: 0, l: 0, w: 0 };
  if (px <= first.px) return { l: first.l, w: first.w };
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1] ?? first;
    const b = stops[i] ?? first;
    if (px <= b.px) {
      const span = b.px - a.px;
      const t = span > 0 ? (px - a.px) / span : 0;
      return { l: a.l + (b.l - a.l) * t, w: a.w + (b.w - a.w) * t };
    }
  }
  const last = stops[stops.length - 1] ?? first;
  return { l: last.l, w: last.w };
}

/** 세로 프로파일을 `y` 에서 선형 보간한다. */
function sampleV(stops: readonly VStop[], y: number): number {
  const first = stops[0] ?? { y: 0, m: 1 };
  if (y <= first.y) return first.m;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1] ?? first;
    const b = stops[i] ?? first;
    if (y <= b.y) {
      const span = b.y - a.y;
      const t = span > 0 ? (y - a.y) / span : 0;
      return a.m + (b.m - a.m) * t;
    }
  }
  return (stops[stops.length - 1] ?? first).m;
}

/** 색조 가중치 `w`(−1..1)에 해당하는 **루마 1 로 정규화된** RGB 계수. */
function tintFor(w: number): { r: number; g: number; b: number } {
  const a = w < 0 ? TINT_COOL : TINT_STONE;
  const b = w < 0 ? TINT_STONE : TINT_GOLD;
  const t = w < 0 ? w + 1 : w;
  const r = a.r + (b.r - a.r) * t;
  const g = a.g + (b.g - a.g) * t;
  const bl = a.b + (b.b - a.b) * t;
  const luma = 0.299 * r + 0.587 * g + 0.114 * bl;
  const k = luma > 0 ? 1 / luma : 1;
  return { r: r * k, g: g * k, b: bl * k };
}

/** 셀 값 노이즈(중주파 얼룩). 축소 후에도 살아남는 유일한 잔차원이라 그레인보다 중요하다. */
function cellNoise(x: number, y: number, seed: number): number {
  const cx = Math.floor(x / CELL_SIZE);
  const cy = Math.floor(y / CELL_SIZE);
  const tx = smoothstep(x / CELL_SIZE - cx);
  const ty = smoothstep(y / CELL_SIZE - cy);
  const at = (ix: number, iy: number): number =>
    hash01(seed + ix * 374761393 + iy * 668265263) * 2 - 1;
  const v00 = at(cx, cy);
  const v10 = at(cx + 1, cy);
  const v01 = at(cx, cy + 1);
  const v11 = at(cx + 1, cy + 1);
  return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
}

/**
 * 가로 조인트 배율 표 — [C5] 지평 기준 단축을 적용한 **비등간격** 피치다.
 *
 * 등간격 링은 사다리·대나무로 읽힌다. 실제 원통의 수평 링은 눈높이({@link JOINT_HORIZON})에서
 * 가장 촘촘하고 위아래로 갈수록 벌어진다. `originY` 를 받는 이유가 그것이다 — 피치가 부재
 * 내부 좌표가 아니라 **화면 절대 y** 의 함수여야 다섯 기둥의 단이 같은 높이에서 맞는다.
 */
function jointRows(h: number, originY: number): Float32Array {
  const table = new Float32Array(h);
  table.fill(1);
  const far = Math.max(1, Math.abs(JOINT_HORIZON - originY), Math.abs(originY + h - JOINT_HORIZON));
  let y = 8;
  let i = 0;
  while (y < h) {
    const row = Math.round(y);
    if (row >= 1 && row < h) {
      table[row] = JOINT_DARK;
      table[row - 1] = JOINT_LIGHT;
    }
    const t = Math.min(1, Math.abs(originY + y - JOINT_HORIZON) / far);
    const pitch = JOINT_BASE * (0.55 + 0.45 * Math.sin(Math.PI * t));
    y += pitch + (hash01(0x51ed + i * 2654435761) * 2 - 1) * JOINT_JITTER;
    i++;
  }
  return table;
}

/** 캔버스 2D 컨텍스트. 없는 환경(vitest)에서는 `null` — 호출부가 그 없이도 서야 한다. */
function makeCtx(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas.getContext('2d');
}

/** 캔버스를 Pixi 텍스처로. `linear` — 가로 슈퍼샘플을 축소해 쓰는 것이 위상 방어의 절반이다. */
function canvasTexture(ctx: CanvasRenderingContext2D): Texture {
  const tex = new Texture({ source: new CanvasSource({ resource: ctx.canvas }) });
  tex.source.scaleMode = 'linear';
  return tex;
}

/** 기둥 중심 `x` 의 후퇴량 0..1(화면 가장자리일수록 크다). */
function recessAmount(x: number): number {
  const half = DESIGN_WIDTH / 2;
  return smoothstep((Math.abs(x - half) / half - RECESS_START) / (1 - RECESS_START));
}

/** 부재 한 장의 굽기 명세. `half(y)` 가 그 행의 반폭이라 실루엣이 세로로 변한다. */
interface PieceSpec {
  w: number;
  h: number;
  gain: number;
  /** 세로 프로파일(없으면 몸통의 선형 램프). */
  vStops: readonly VStop[] | null;
  half(y: number): number;
  /** 가로 조인트를 넣는가(몸통만). */
  joints: boolean;
  /** 부재 상단의 **화면 절대 y**. 조인트 단축이 이 값을 쓴다. */
  originY: number;
  /** 노이즈 시드 — 부재마다 달라야 같은 얼룩이 반복되지 않는다. */
  seed: number;
  /** 원경 후퇴 0..1([C4]). */
  recess: number;
}

/**
 * 부재 한 장을 픽셀로 굽는다. 단면 램프 · 세로 조형 · 조인트 · 노이즈 · 후퇴가 **한 패스에서
 * 최종 색으로 합쳐진다** — 레이어를 알파로 겹치지 않으므로 겹침 가로줄도, 흑백 그레인의
 * 합성 비대칭도 원리적으로 생기지 않는다.
 *
 * 후퇴는 **부재 자신의 평균 둘레로** 대비를 압축한 뒤 헤이즈에 섞는다. 평균을 먼저 재는 이유는
 * 대비 압축이 "평균은 두고 편차만 줄이는" 연산이기 때문이다 — 상수를 기준으로 압축하면 밝은
 * 부재는 어두워지고 어두운 부재는 밝아져 부재끼리 어긋난다.
 */
function bakePiece(spec: PieceSpec): Texture | null {
  const texW = Math.max(1, Math.round(spec.w * SHAFT_SS));
  const texH = Math.max(1, Math.round(spec.h));
  const ctx = makeCtx(texW, texH);
  if (ctx === null) return null;

  const joints = spec.joints ? jointRows(texH, spec.originY) : null;
  const halfMax = spec.w / 2;
  const lumBuf = new Float32Array(texW * texH);
  const wBuf = new Float32Array(texW * texH);
  const covBuf = new Float32Array(texW * texH);
  let sum = 0;
  let n = 0;

  for (let ty = 0; ty < texH; ty++) {
    const y = ty + 0.5;
    const vm =
      spec.vStops === null
        ? SHAFT_V_TOP + (SHAFT_V_BOTTOM - SHAFT_V_TOP) * (y / texH)
        : sampleV(spec.vStops, y);
    const jm = joints === null ? 1 : (joints[ty] ?? 1);
    const half = spec.half(y);
    for (let tx = 0; tx < texW; tx++) {
      const px = (tx + 0.5) / SHAFT_SS; // 디자인 px(부재 왼쪽 끝 기준)
      // 실루엣 커버리지 — 반폭 경계에서 1 → 0 으로 한 픽셀에 걸쳐 떨어진다(계단 방지).
      const cov = Math.max(0, Math.min(1, half - Math.abs(px - halfMax) + 0.5));
      const i = ty * texW + tx;
      covBuf[i] = cov;
      if (cov <= 0) continue;
      // 단면은 **부재 폭에 정규화**해 샘플한다 — 주두가 넓어도 같은 조명 단면을 갖는다.
      const { l, w } = sampleProfile((px / spec.w) * SHAFT_W);
      const noise =
        cellNoise(px, y, spec.seed) * CELL_AMPL +
        (hash01(spec.seed ^ ((ty * 73856093) ^ (tx * 19349663))) * 2 - 1) * GRAIN_AMPL;
      const lum = Math.max(0, l * vm * jm * spec.gain + noise);
      lumBuf[i] = lum;
      wBuf[i] = w;
      sum += lum;
      n++;
    }
  }

  const mean = n > 0 ? sum / n : 0;
  const contrast = 1 - (1 - RECESS_CONTRAST) * spec.recess;
  const mix = RECESS_HAZE_MIX * spec.recess;
  const img = ctx.createImageData(texW, texH);
  for (let i = 0; i < texW * texH; i++) {
    const cov = covBuf[i] ?? 0;
    const o = i * 4;
    if (cov <= 0) {
      img.data[o + 3] = 0;
      continue;
    }
    let lum = mean + ((lumBuf[i] ?? 0) - mean) * contrast;
    let w = wBuf[i] ?? 0;
    if (mix > 0) {
      lum = lum * (1 - mix) + RECESS_HAZE_L * mix;
      w = w * (1 - mix) + RECESS_HAZE_W * mix;
    }
    const tint = tintFor(w);
    img.data[o] = Math.min(255, lum * tint.r);
    img.data[o + 1] = Math.min(255, lum * tint.g);
    img.data[o + 2] = Math.min(255, lum * tint.b);
    img.data[o + 3] = Math.round(cov * 255);
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(ctx);
}

/** 구운 AO 필드와 그 배치(디자인 좌표). */
interface AoBake {
  tex: Texture;
  top: number;
  height: number;
}

/**
 * AO 필드를 굽는다 — **[C2] 의 본체이자 [C3] 을 가능하게 하는 장치.**
 *
 * 검은색 + 알파로 굽고 `multiply` 로 합성한다. Pixi 의 multiply 는 `dst·(1 − a·(1 − src))` 이고
 * `src = 0` 이므로 결과가 정확히 `dst·(1 − a)` 다 — 배경 휘도가 얼마든 **그 자리에서 비율로**
 * 낮아진다. 절대 휘도를 맞히는 것이 원리적으로 불가능한 상황(배경 L21~96)에서 대비를
 * 보장하는 유일한 방법이다.
 */
function bakeAo(capTop: number, baseBottom: number, recess: number): AoBake | null {
  const top = capTop - AO_TOP;
  const height = Math.round(baseBottom + AO_BOT - top);
  const w = AO_HALF * 2;
  if (height <= 0) return null;
  const ctx = makeCtx(w, height);
  if (ctx === null) return null;

  const shaftHalf = SHAFT_W / 2;
  const contactRx = (SHAFT_W * CONTACT_W_K) / 2;
  const contactRy = (SHAFT_W * CONTACT_W_K * CONTACT_H_K) / 2;
  const gain = 1 - AO_RECESS_FADE * recess; // 먼 기둥은 그림자도 흐리다 — 다만 없지는 않다.
  const img = ctx.createImageData(w, height);

  for (let ty = 0; ty < height; ty++) {
    const ay = top + ty + 0.5; // 화면 절대 y
    // 세로 포락 — 부재 구간에서 1, 위아래로 감쇠. 격자 밖(주두·기초 구간)에서는 배경이
    // 밝고 열려 있어 같은 세기로 부족하므로 증폭한다.
    let env = 1;
    let openBoost = 1;
    if (ay < capTop) {
      env = 1 - smoothstep((capTop - ay) / AO_TOP);
      openBoost = AO_OPEN_BOOST;
    } else if (ay > baseBottom) {
      env = 1 - smoothstep((ay - baseBottom) / AO_BOT);
      openBoost = AO_OPEN_BOOST;
    } else if (ay < capTop + CAP_H || ay > baseBottom - BASE_H) {
      openBoost = AO_OPEN_BOOST;
    }
    for (let tx = 0; tx < w; tx++) {
      const sx = tx + 0.5 - AO_HALF; // 기둥 중심 기준 부호 있는 거리
      const d = Math.abs(sx) - shaftHalf;
      const right = sx > 0;
      const peak = (right ? AO_RIGHT_PEAK : AO_LEFT_PEAK) * openBoost;
      const reach = right ? AO_RIGHT_REACH : AO_LEFT_REACH;
      const lat = d <= 0 ? peak : peak * (1 - smoothstep(d / reach));
      // 접촉 타원 — 기초 바닥에 고이는 코어. 물체가 바닥에 닿는 유일한 증거다.
      const er = Math.hypot(sx / contactRx, (ay - baseBottom) / contactRy);
      const contact = CONTACT_ALPHA * (1 - smoothstep(er));
      // ⚠️ 최댓값 — 합이면 성분이 겹치는 자리가 두 배가 되어 띠가 남는다.
      const occ = Math.min(AO_MAX, Math.max(lat * env, contact) * gain);
      const o = (ty * w + tx) * 4;
      img.data[o] = 0;
      img.data[o + 1] = 0;
      img.data[o + 2] = 0;
      img.data[o + 3] = Math.round(occ * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return { tex: canvasTexture(ctx), top, height };
}

// --- 실루엣 --------------------------------------------------------------------

/** 주두 실루엣 — 관판은 최대폭, 에키누스에서 몸통 반폭으로 좁아진다. */
function capHalf(y: number): number {
  const shaftHalf = SHAFT_W / 2;
  const capHalfW = CAP_W / 2;
  if (y < 12) return capHalfW;
  if (y < 30) return capHalfW + (shaftHalf - capHalfW) * smoothstep((y - 12) / 18);
  return shaftHalf;
}

/** 기초 실루엣 — 몸통 반폭에서 토러스를 지나 대좌 최대폭으로 벌어진다. */
function baseHalf(y: number): number {
  const shaftHalf = SHAFT_W / 2;
  const capHalfW = CAP_W / 2;
  if (y < 15) return shaftHalf;
  if (y < 27) return shaftHalf + (capHalfW - shaftHalf) * smoothstep((y - 15) / 12);
  return capHalfW;
}

/** 칼라 실루엣 — 몸통에서 살짝 부풀었다 돌아온다(주두·기초보다 얕게). */
function collarHalf(y: number): number {
  const shaftHalf = SHAFT_W / 2;
  const bulge = shaftHalf + 2.5;
  if (y < 4) return shaftHalf;
  if (y < 8) return shaftHalf + (bulge - shaftHalf) * smoothstep((y - 4) / 4);
  if (y < 26) return bulge;
  if (y < 32) return bulge + (shaftHalf - bulge) * smoothstep((y - 26) / 6);
  return shaftHalf;
}

// --- 텍스처 캐시 ---------------------------------------------------------------
// 기둥들은 같은 텍스처를 공유한다(높이·후퇴가 같으면). 캐시가 없으면 굽기가 기둥 수만큼
// 반복되고, 더 나쁘게는 기둥마다 노이즈 시드를 달리 주고 싶은 유혹이 생긴다 — 그러면 단
// 이음매가 서로 어긋나 한 건물로 안 읽힌다.
const pieceCache = new Map<string, Texture | null>();
const aoCache = new Map<string, AoBake | null>();

/** 후퇴량을 캐시 키로 쓰기 위해 양자화한다(연속값이면 캐시가 무한히 늘어난다). */
function quant(v: number): string {
  return (Math.round(v * 20) / 20).toFixed(2);
}

function cachedPiece(key: string, make: () => Texture | null): Texture | null {
  const hit = pieceCache.get(key);
  if (hit !== undefined) return hit;
  const tex = make();
  pieceCache.set(key, tex);
  return tex;
}

/**
 * 캔버스가 없을 때의 계단 근사. **불투명·비겹침 단색 띠**라 알파 이중가산이 원리적으로 없다.
 * 화면을 세우는 것이 목적이지 품질이 목적이 아니다.
 */
function fallbackPiece(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  gain: number,
): void {
  const steps = 8;
  for (let i = 0; i < steps; i++) {
    const { l, w: tw } = sampleProfile(((i + 0.5) / steps) * SHAFT_W);
    const tint = tintFor(tw);
    const lum = l * gain;
    const r = Math.min(255, Math.round(lum * tint.r));
    const gg = Math.min(255, Math.round(lum * tint.g));
    const b = Math.min(255, Math.round(lum * tint.b));
    g.rect(x + (i / steps) * w, y, w / steps, h).fill({ color: (r << 16) | (gg << 8) | b });
  }
}

/** 스프라이트 한 장을 정확한 디자인 치수로 놓는다. */
function place(tex: Texture, x: number, y: number, w: number, h: number): Sprite {
  const s = new Sprite(tex);
  s.position.set(x, y);
  s.width = w;
  s.height = h;
  return s;
}

/**
 * 콜로네이드를 만든다. 좌표는 **리드가 격자에서 파생해 넘긴다** — 여기서 하드코딩하면 격자가
 * 바뀌는 순간 어긋난다(그것이 이 크롬을 도입한 이유 자체를 무효로 만든다).
 */
export function makeGutterRibs(ribs: readonly RibLine[]): GutterRibs {
  const view = new Container();
  // 크롬은 클릭 대상이 아니다 — 카드 히트 테스트를 가로채면 안 된다.
  view.eventMode = 'none';
  const destroy = (): void => {
    // 캐시된 텍스처는 **반납하지 않는다** — 다음 렌더가 같은 텍스처를 다시 쓴다.
    // `destroy({ children: true })` 는 기본값이 텍스처 비파괴라 이대로 안전하다.
    view.destroy({ children: true });
  };
  if (ribs.length === 0) return { view, destroy };

  // AO 는 **모든 부재보다 먼저** 깔린다. 배경만 어두워지고 기둥 자신은 그 위에 불투명하게
  // 올라가야 "기둥이 벽에 그림자를 드리운다"가 된다(순서가 뒤집히면 기둥이 자기 그림자에 먹힌다).
  const aoLayer = new Container();
  const bodyLayer = new Container();
  view.addChild(aoLayer);
  view.addChild(bodyLayer);

  const fallback = new Graphics();
  let usedFallback = false;

  for (const rib of ribs) {
    // ⚠️ 정수 스냅 — 소수 좌표는 기둥마다 다른 서브픽셀 위상을 만들고, 그 위상이 좌 립의
    // 피크를 최대 절반까지 갉아먹는다. 배율 0.9115 자체는 못 없애지만, 코드가 만드는 임의
    // 소수부는 여기서 끝난다.
    const cx = Math.round(rib.x);
    const top = Math.round(rib.y0);
    const bottom = Math.round(rib.y1);
    const h = bottom - top;
    if (h <= 0) continue;

    const recess = recessAmount(cx);
    const rq = quant(recess);
    const capTop = top - CAP_H;
    const baseTop = bottom - BASE_LAP;
    const baseBottom = bottom + BASE_H;
    // [C9] 칼라는 격자 행 사이에 앉는다 — y0/y1 에서 파생하므로 행 높이가 바뀌어도 따라간다.
    const collarTop = Math.round((top + bottom) / 2 - COLLAR_H / 2);

    const shaftTex = cachedPiece(`s:${h}:${top}:${rq}`, () =>
      bakePiece({
        w: SHAFT_W,
        h,
        gain: SHAFT_GAIN,
        vStops: null,
        half: () => SHAFT_W / 2,
        joints: true,
        originY: top,
        seed: 0x2f6a1b,
        recess,
      }),
    );
    const capTex = cachedPiece(`c:${rq}`, () =>
      bakePiece({
        w: CAP_W,
        h: CAP_H + CAP_LAP,
        gain: CAP_GAIN,
        vStops: CAP_V,
        half: capHalf,
        joints: false,
        originY: capTop,
        seed: 0x7c19d3,
        recess,
      }),
    );
    const baseTex = cachedPiece(`b:${rq}`, () =>
      bakePiece({
        w: CAP_W,
        h: BASE_LAP + BASE_H,
        gain: BASE_GAIN,
        vStops: BASE_V,
        half: baseHalf,
        joints: false,
        originY: baseTop,
        seed: 0x1de4a7,
        recess,
      }),
    );
    const collarTex = cachedPiece(`k:${rq}`, () =>
      bakePiece({
        w: CAP_W,
        h: COLLAR_H,
        gain: COLLAR_GAIN,
        vStops: COLLAR_V,
        half: collarHalf,
        joints: false,
        originY: collarTop,
        seed: 0x3ab6f1,
        recess,
      }),
    );

    if (shaftTex === null || capTex === null || baseTex === null || collarTex === null) {
      usedFallback = true;
      fallbackPiece(fallback, cx - SHAFT_W / 2, top, SHAFT_W, h, SHAFT_GAIN);
      fallbackPiece(fallback, cx - CAP_W / 2, capTop, CAP_W, CAP_H + CAP_LAP, CAP_GAIN);
      fallbackPiece(fallback, cx - CAP_W / 2, baseTop, CAP_W, BASE_LAP + BASE_H, BASE_GAIN);
      continue;
    }

    const aoKey = `${capTop}:${baseBottom}:${rq}`;
    let ao = aoCache.get(aoKey);
    if (ao === undefined) {
      ao = bakeAo(capTop, baseBottom, recess);
      aoCache.set(aoKey, ao);
    }
    if (ao !== null) {
      const shade = place(ao.tex, cx - AO_HALF, ao.top, AO_HALF * 2, ao.height);
      // 곱연산 — 배경 휘도를 **비율로** 낮춘다. 가산·알파로는 밝은 배경을 못 누른다.
      shade.blendMode = 'multiply';
      aoLayer.addChild(shade);
    }

    bodyLayer.addChild(place(shaftTex, cx - SHAFT_W / 2, top, SHAFT_W, h));
    // 칼라는 몸통 위, 주두·기초는 그 위 — 겹침 구간에서 이음매가 가려져야 "쌓아 올린 것"이 된다.
    bodyLayer.addChild(place(collarTex, cx - CAP_W / 2, collarTop, CAP_W, COLLAR_H));
    bodyLayer.addChild(place(capTex, cx - CAP_W / 2, capTop, CAP_W, CAP_H + CAP_LAP));
    bodyLayer.addChild(place(baseTex, cx - CAP_W / 2, baseTop, CAP_W, BASE_LAP + BASE_H));
  }

  if (usedFallback) bodyLayer.addChildAt(fallback, 0);
  else fallback.destroy();

  return { view, destroy };
}
