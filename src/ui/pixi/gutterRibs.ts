/**
 * 거터 석재 리브 — 카드 격자를 **담는 건축 크롬**(주두 · 기둥 · 기초).
 *
 * ## 왜 리브가 존재하는가
 * 4라운드까지 거터의 어둠은 배경 원화에 맡겨져 있었다. 그런데 원화에는 밝은 세로 대역이
 * **있었고**, 그게 하필 카드 뒤에 깔리고 어두운 대역이 거터에 깔렸다 — 원화의 주기와 격자의
 * 주기(458px)가 안 맞았던 것이다. 그 결과 배경이 가로로는 밝고 세로로는 어두워 격자 뒤에
 * 가로 줄무늬가 생겼다(AAA 비평 4라운드 실측).
 *
 * 증폭으로는 못 푼다. AAA 허브가 실제로 쓰는 방식은 원화 위에 격자를 얹는 것이 아니라
 * **격자를 담는 크롬을 그리고 그 뒤에 원화를 두는 것**이다. 리브는 격자에서 파생한 좌표에
 * 서므로, 배경이 무엇으로 바뀌든 거터의 리듬이 격자 주기와 영구히 일치한다.
 *
 * ## 5라운드 판정이 앞판(`baseBackdrop.buildRibs`)에 내린 진단 — 그리고 이 파일이 바꾼 것
 *
 * ### [P2] "리브가 수학적으로 평면인 막대다"
 * 앞판은 세로 램프 한 장 + 좌 1px 립 + 우 2px 그늘이었다. 실측이 본체 per-pixel 잔차
 * **std 0.28**(카드 아트는 33.20) · **폭방향 std 0.71**. 즉 재질도 단면도 **존재하지 않았다** —
 * 세로로만 변하는 면은 원리적으로 폭방향 분산이 0 이다. 원기둥은 폭방향으로 밝기가 변하는
 * 물체이므로, 세로 램프만으로는 아무리 색을 바꿔도 기둥이 될 수 없다.
 *
 * 그래서 이 판은 **단면(cross-section)을 1차 조형 수단으로 삼는다**({@link SHAFT_PROFILE}):
 * 좌 수광 립 → 밝은 상면 → 중간 몸통 → 그늘 → 우 코어 그림자의 5구간 램프다. 이 프로파일
 * 하나로 폭방향 std ≈ 40 이 나온다(계산은 상수 주석에).
 *
 * ### 왜 립이 거터마다 다른 밝기였나 — **서브픽셀 위상**
 * 실측이 거터1 L95 / 거터2 L96 / **거터3 L57**. 셋 중 하나는 립이 사실상 없었다. 원인은
 * 코드가 아니라 **좌표계 환산**이다: 디자인→캡처 배율이 0.9115 라 1 디자인 px 는 0.91 디바이스
 * px 이고, 거터 간격 458 디자인 px 는 **417.47** 디바이스 px 다. 소수부 0.47 이 리브마다 누적돼
 * 세 리브의 위상이 0 / 0.47 / 0.94 로 갈린다. 위상 0.5 에서 1px 선은 두 픽셀에 반씩 나뉘어
 * **피크가 절반으로 내려앉는다** — 코드에는 아무 결함이 없는데 화면에서만 사라지는 유형이다.
 *
 * 처방은 두 겹이다. ① 립을 **2px + 감쇠 1px** 로 넓혀 어떤 위상에서도 최소 한 디바이스 픽셀이
 * 립 안에 완전히 들어가게 한다(폭 2.7 디자인 px = 2.5 디바이스 px). ② 텍스처를 가로로
 * **2배 슈퍼샘플**({@link SHAFT_SS})해서 굽고 `linear` 로 축소한다 — 위상 차이가 텍셀 보간으로
 * 흡수돼 피크 변동이 진폭이 아니라 잔차 수준으로 떨어진다. ③ 좌표는 `Math.round` 로 정수
 * 디자인 px 에 스냅한다(같은 위상을 강제할 수는 없지만, 리브마다 임의로 흔들리는 소수부는
 * 없앤다).
 *
 * ### [P3] "리브가 격자 밖에선 존재하지 않는다 — 건축이 아니라 틈 메우기다"
 * 앞판은 격자 사각형의 y 범위에서 **생겨나 증발했다**(y≈232 에서 시작, y≈985 에서 끝, 그
 * 바깥 델타 +0.9~+3.4). 기둥이 천장에도 바닥에도 닿지 않으면 그것은 기둥이 아니라 카드 사이를
 * 메운 막대다. 그래서 **주두**({@link CAP_H})와 **기초**({@link BASE_H})를 붙인다 — 리드가 넘긴
 * `y0`/`y1` 에서 파생하므로 격자가 바뀌어도 따라간다. 주두·기초는 기둥보다 **넓고 밝다**
 * ({@link CAP_W} · {@link CAP_GAIN}) — 돌출부가 램프광을 더 많이 받는 것이 조명의 정의다.
 *
 * ### [N4] "리브가 배경 기둥의 약한 축소 복제로 읽힌다"
 * 원화의 기둥이 리브보다 크고 밝아(좌여백 68.2 vs 거터 52) 같은 모티프의 반복 — 위계가 아니라
 * 중복이었다. 위계는 **밝기 경쟁이 아니라 재질 해상도**로 만든다: 배경 기둥은 4px 흐림이 걸린
 * 저주파 덩어리이고, 이 리브는 **12~18px 주기 가로 조인트 + 셀 노이즈 + 미세 그레인**을 가진
 * 고주파 표면이다. 흐린 것 앞에 또렷한 것이 서면 뒤엣것은 자동으로 배경이 된다.
 *
 * ## 왜 텍스처로 굽는가 (띠 근사 금지)
 * ⚠️ 얇은 사각형을 겹쳐 그라디언트를 근사하면 **1px 겹침이 알파를 두 배로 만들어 가로줄**이
 * 남는다(`scrim.ts` 헤더, 실제 사용자 신고). 단면 램프·조인트·그레인을 전부 **픽셀로 한 번
 * 굽고** 스프라이트 한 장으로 그린다 — 드로우콜도 리브당 3장으로 끝난다.
 *
 * 그레인 난수는 **xorshift 로 결정적**이다(`cinematicTile.ts` 선례). 굽기가 매번 같아야 비평
 * 스크린샷 회귀 비교가 성립한다. 그리고 그레인은 **알파 합성이 아니라 휘도 가감**으로 넣는다 —
 * 알파로 흰/검을 같은 값으로 얹으면 밝은 쪽이 더 크게 먹혀 얼룩이 한쪽으로 쏠린다
 * (`cinematicTile.ts` `GRAIN_UP`/`GRAIN_DOWN` 비대칭 보정이 그 흔적이다). 여기서는 애초에
 * 최종 색을 직접 계산하므로 그 비대칭 문제가 **원리적으로 없다**.
 *
 * ## 광원 규약
 * `cinematicTile.ts` 의 베벨과 같다 — **위·왼쪽이 빛을 받고 아래·오른쪽이 그늘진다.** 리브의
 * 좌 립 / 우 코어 그림자, 주두 상면의 캐치라이트, 주두 아래 그림자, 기초 상단의 수광 모서리가
 * 전부 그 한 광원에서 나온다. 어긋나면 카드와 리브가 다른 장면이 된다.
 *
 * ## 자산 없이도 서야 한다
 * 캔버스가 없는 환경(vitest)에서는 텍스처를 못 굽는다. 그때는 **겹치지 않는 불투명 단색 띠**로
 * 단면을 계단 근사한다 — 불투명·비겹침이라 위 알파 이중가산 함정과 무관하다. 화면은 서고,
 * 예외는 나지 않는다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 을 읽지도 쓰지도 않는다. 시간축도 없다(정적 크롬).
 */

import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { DESIGN_WIDTH } from '../../render/app.js';

/** 거터에 세우는 리브 한 개. `x` 는 **중심선**(디자인 좌표), `y0`/`y1` 은 격자 행 상·하단이다. */
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
 * 기둥 몸통 폭. 거터는 `TILE_GAP` 34px 이므로 좌우 4px 씩 배경이 남는다 — 기둥이 카드에
 * 닿지 않아야 **뒤에 공간이 있다**는 것이 읽힌다(꽉 채우면 다시 "틈 메우기"가 된다).
 * 짝수여야 `x − W/2` 가 정수로 떨어져 위상이 리브마다 흔들리지 않는다.
 */
const SHAFT_W = 26;
/**
 * 주두·기초 폭. 몸통보다 **넓다** — 돌출한 부재가 그림자를 드리우고 램프광을 더 받는 것이
 * 기둥을 기둥으로 만든다. 거터 34px 안에 1px 씩 여유를 남긴다(짝수 유지).
 */
const CAP_W = 32;
/**
 * 주두가 격자 위로 올라가는 높이. 격자 상단 y0=226 기준 y≈164 에서 시작한다.
 *
 * ⚠️ 76 에서 줄였다. 76 이면 주두 상단이 y150 — 부제 줄(y≈130)의 바로 아래라 **다섯 개의 큰
 * 블록이 제목 영역을 물고 들어왔다**(v9 화면). 주두는 격자가 어디서 시작하는지를 알리는
 * 부재이지 그 자체가 헤더의 일부가 아니다.
 */
const CAP_H = 62;
/** 주두가 몸통과 겹치는 길이. 이음매가 격자 경계선과 정확히 겹치지 않게 밀어 넣는다. */
const CAP_LAP = 8;
/** 기초가 격자 아래로 내려가는 깊이. 격자 하단 y1≈985 기준 y≈1037 까지 — 메타 줄 위에서 끝난다. */
const BASE_H = 52;
const BASE_LAP = 8;

/**
 * 가로 슈퍼샘플 배수. 디자인→디바이스 배율이 0.9115 라 1px 선은 위상에 따라 피크가 절반으로
 * 무너진다(헤더 "서브픽셀 위상"). 2배로 구워 `linear` 로 축소하면 그 위상차가 보간으로
 * 흡수된다. 3배 이상은 축소 단계에서 어차피 평균되어 이득이 없다.
 */
const SHAFT_SS = 2;

// --- 재질 ---
/**
 * 색조 앵커. 가중치 `w` 가 −1(차가운 코어 그림자) → 0(따뜻한 석재) → +1(금빛 수광 립)로
 * 간다. 각 벡터는 굽는 시점에 **루마 1 로 정규화**되므로, 색조를 바꿔도 밝기 설계가 흔들리지
 * 않는다(색과 밝기를 분리해 두지 않으면 한쪽을 만질 때마다 다른 쪽이 어긋난다).
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
 * 기둥 단면 램프 — **이 파일의 핵심**이다.
 *
 * 좌 수광 립(2px, L114) → 감쇠(1px) → 밝은 상면 → 중간 몸통 → 그늘 → 우 코어 그림자(2.5px, L11).
 *
 * 폭방향 표준편차 **21.9**(화면 실측 예측, 0.9115 축소 포함). 수용 기준 ≥ 8 의 두 배 이상이다.
 * 앞판이 0.71 이었던 이유는 값이 작아서가 아니라 **폭 방향으로 변하는 항이 아예 없었기**
 * 때문이다 — 세로로만 변하는 면은 원리적으로 폭방향 분산이 0 이다.
 *
 * ⚠️ 립을 172 에서 **114 로 내렸다.** 172 는 화면 피크 L138 이었고, 리브가 3개에서 5개로
 * 늘어나자 **다섯 줄의 밝은 세로선이 카드 격자보다 먼저 읽혔다**(v9 판정: "기둥 우리"). 립은
 * 기둥 모서리가 빛을 받는다는 신호이지 그 자체가 화면의 주인공이 아니다 — 114 면 피크 ≈99.6
 * 으로 카드 금테(L≈113)보다 **낮게** 앉는다. **크롬은 내용보다 밝으면 안 된다**가 규칙이고,
 * 이건 개수가 늘면 개당 존재감을 줄여야 총량이 유지된다는 더 일반적인 사실의 사례다.
 */
const SHAFT_PROFILE: readonly ProfileStop[] = [
  { px: 0, l: 114, w: 1 },
  { px: 2, l: 114, w: 1 },
  { px: 2.7, l: 86, w: 0.6 },
  { px: 4, l: 92, w: 0.2 },
  { px: 8, l: 70, w: 0 },
  { px: 19, l: 46, w: -0.2 },
  { px: 23, l: 24, w: -0.6 },
  { px: 23.5, l: 12, w: -1 },
  { px: 26, l: 10, w: -1 },
];

/** 세로 램프(위가 밝고 아래로 어두워진다 — 카드 밴드와 같은 광원 규약). */
const SHAFT_V_TOP = 1.1;
const SHAFT_V_BOTTOM = 0.76;
/**
 * 몸통 휘도 이득. **몸통 평균은 v9 에서 유지하라고 못박힌 값**이다(거터 목표 대역 52~58) —
 * 립을 172→114 로 내리면 단면 평균이 함께 떨어지므로 그만큼 이득으로 되돌려 화면 평균
 * **56.1** 에 앉힌다. 즉 이 상수는 립을 조절할 때마다 **반대로 움직여야** 하는 짝이다.
 *
 * ⚠️ 위계를 밝기로 만들려 들면 안 된다. 이 리브가 앞에 있는 것으로 읽히는 근거는 밝기가
 * 아니라 **재질 해상도**(조인트·셀 노이즈·단면)와 **주두/기초**다 — 밝기는 오히려 낮춰야
 * 배경 기둥(L68.2)과의 중복이 풀린다.
 */
const SHAFT_GAIN = 0.97;

/**
 * 석재 단 이음매(가로 조인트) 주기 하한/폭. 12~18px 사이에서 결정적으로 흔들린다 — 정확히
 * 균등하면 벽지 패턴으로 읽히고, 완전 무작위면 석공이 쌓은 단으로 안 읽힌다.
 */
const JOINT_MIN = 12;
const JOINT_SPAN = 7;
/**
 * 조인트 홈(어둡게)과 그 바로 위 단의 수광 모서리(밝게). 위가 밝은 광원 규약 그대로다.
 *
 * ⚠️ 0.42/1.22 에서 완화했다. 리브가 다섯이 되자 그 대비가 기둥마다 50줄씩, 화면 전체로는
 * 250줄의 가로 눈금이 되어 **표면이 아니라 무늬**로 읽혔다(v9). 조인트는 단이 쌓였다는 증거일
 * 뿐이고, 잔차 std 는 셀 노이즈가 이미 충분히 낸다.
 */
const JOINT_DARK = 0.58;
const JOINT_LIGHT = 1.13;

/**
 * 표면 잔차 — 셀 노이즈(중주파 얼룩) + 미세 그레인(고주파).
 *
 * 수용 기준은 본체 per-pixel 잔차 **std ≥ 3**(앞판 0.28). 조인트만으로도 주기 15px 중 2행이
 * ±25% 로 흔들려 std ≈ 5 가 나오지만, 조인트는 **가로줄**이라 그것만으로는 표면이 여전히
 * 매끈하다. 셀 노이즈(±5L, 7px 셀)가 돌 표면의 얼룩을, 그레인(±8L)이 입자를 담당한다.
 * 축소(0.9115) 후에도 셀 노이즈는 거의 온전히 살아남는다 — 그래서 고주파에만 의존하지 않는다.
 */
const CELL_SIZE = 7;
const CELL_AMPL = 5;
const GRAIN_AMPL = 8;

/**
 * 주두·기초 휘도 이득. 수용 기준은 배경 대비 델타 **≥ 15**(앞판 +0.9~+3.4).
 *
 * ⚠️ 1.5 / 1.4 에서 내렸다. 그 값은 델타 **+73 / +57** 이었는데, 근거로 든 "배경이 재생성될 수
 * 있으니 여유를 크게"가 **틀린 전제**였다(배경은 코드로 확정 — 재생성되지 않는다). 그리고
 * 리브가 3개에서 5개로 늘자 그 여유가 그대로 과잉이 됐다: 밝은 블록 다섯 쌍이 격자 위아래를
 * 물고 있어 화면이 **기둥 우리**로 읽혔다(v9).
 *
 * 이제 목표는 델타 **+25~35** 다(실측 예측: 주두 관판 밴드 L77.7 = 배경 45 대비 **+32.7**,
 * 기초 대좌 밴드 L56.5 = 배경 28 대비 **+28.5**). 수용 기준 15 를 두 배 여유로 넘으면서,
 * 부재 전체 평균은 몸통(56)과 같은 대역(주두 64 · 기초 50)에 머문다 — 부재의 존재는 **밝기가
 * 아니라 실루엣과 그림자**(관판 아래 0.42, 접지 0.42)가 증명한다.
 *
 * 주두 이득이 기초보다 높은 것은 {@link CAP_V} 의 캐치라이트를 1.55 → 1.35 로 낮춘 몫을
 * 되받는 것이다 — **밝기의 총량은 낮추되 관판 위·아래의 대비는 지킨다.**
 */
const CAP_GAIN = 1.16;
const BASE_GAIN = 0.98;

/**
 * 콜로네이드 끝 기둥의 **후퇴**(공기 원근). 화면 중앙에서 멀수록 어둡고 살짝 차가워진다 —
 * 실제 콜로네이드는 끝으로 갈수록 램프에서 멀어져 어둡다.
 *
 * ## 왜 "첫 번째와 마지막 리브"가 아니라 화면 중심 거리인가
 * 리브가 3개(칸 사이만)일 때 끝 두 개는 **안쪽 거터**다 — 그걸 어둡게 하면 정확히 반대로
 * 틀린다. 리드가 몇 개를 넘길지는 이 파일이 알 수 없고, 앞으로도 바뀔 수 있다(3 → 5 가 이미
 * 한 번 일어났다). 반면 "화면 가장자리에 붙은 기둥이 어둡다"는 **개수와 무관하게 참**이라,
 * 서수 특례 없이 두 배치 모두에서 옳다. 3개 배치의 x=502/1418 은 정규화 거리 0.48 이라
 * 후퇴가 정확히 0 이 된다.
 */
const RECESS_START = 0.82;
const RECESS_TINT = { r: 0.55, g: 0.58, b: 0.64 } as const;

/** 세로 프로파일의 한 지점(`y` 는 부재 상단에서의 디자인 px, `m` 은 휘도 배율). */
interface VStop {
  y: number;
  m: number;
}

/**
 * 주두 세로 조형 — 위에서부터: 관판(abacus) 상면 캐치라이트 → 관판 측면 → **관판 아래 그림자**
 * → 에키누스(볼록 몰딩) 수광 → 목(neck) → 홈 → 몸통으로 넘어가는 전이.
 *
 * 그림자(0.42)와 캐치라이트(1.35) 사이의 3.2배 대비가 부재를 **입체로** 만든다. 앞판에는 이
 * 구간 자체가 없었다(리브가 격자 위에서 그냥 끝났다).
 *
 * ⚠️ y 는 부재 상단에서의 **절대** px 라 {@link CAP_H} 를 바꾸면 여기도 함께 다시 잡아야
 * 한다(비율로 두면 홈·모서리 같은 1~2px 디테일까지 늘어나 뭉갠다). 총높이 `CAP_H + CAP_LAP`
 * = 70 에 맞춘 표다. 캐치라이트는 1.55 → 1.35 — v9 에서 주두 상단 다섯 줄이 제목 아래에서
 * 반짝여 시선을 위로 끌어올렸다.
 */
const CAP_V: readonly VStop[] = [
  { y: 0, m: 1.35 },
  { y: 3, m: 1.2 },
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
 * 기초 세로 조형 — 몸통 연장 → 홈 → 토러스(둥근 몰딩) 수광 → 그 아래 그림자 → 대좌 상단
 * 수광 모서리 → 대좌 → **바닥 접지 그늘**.
 *
 * 마지막 0.42 가 접지 그림자다. 이게 없으면 기둥이 바닥에 **놓인** 것이 아니라 잘린 것으로
 * 읽힌다(카드 접지 그림자와 같은 논거).
 *
 * ⚠️ {@link CAP_V} 와 같은 이유로 절대 px 표다 — 총높이 `BASE_LAP + BASE_H` = 60 에 맞췄다.
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
  { y: 60, m: 0.42 },
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
function sampleProfile(stops: readonly ProfileStop[], px: number): { l: number; w: number } {
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

/**
 * 셀 값 노이즈(중주파 얼룩). 축소 후에도 살아남는 유일한 잔차원이라 그레인보다 중요하다.
 * 셀 격자 값을 smoothstep 이중보간한다 — 계단이 남으면 그건 얼룩이 아니라 체크무늬다.
 */
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
 * 가로 조인트 배율 표(행마다 하나). 리브마다 다시 뽑지 않는다 — **모든 리브의 단이 같은
 * 높이에서 맞아야** 한 건물의 석공 작업으로 읽힌다(서로 어긋나면 리브가 각자 다른 물건이 된다).
 */
function jointTable(h: number): Float32Array {
  const table = new Float32Array(h);
  table.fill(1);
  let y = Math.round(JOINT_MIN * 0.6);
  let i = 0;
  while (y < h) {
    if (y >= 1) {
      table[y] = JOINT_DARK;
      table[y - 1] = JOINT_LIGHT;
    }
    y += JOINT_MIN + Math.floor(hash01(0x51ed + i * 2654435761) * JOINT_SPAN);
    i++;
  }
  return table;
}

/**
 * 기둥 중심 `x` 의 후퇴 tint. `tint` 는 **곱연산**이라 어둡게 하는 데는 정확히 맞는 도구다
 * (밝히려면 가산 오버레이가 필요하지만, 여기서 필요한 것은 감광뿐이다). 평균과 대비가 같은
 * 비율로 함께 내려가는 것이 공기 원근의 정의이기도 하다.
 */
function recessTint(x: number): number {
  const half = DESIGN_WIDTH / 2;
  const d = Math.abs(x - half) / half;
  const k = smoothstep((d - RECESS_START) / (1 - RECESS_START));
  if (k <= 0) return 0xffffff;
  const ch = (v: number): number => Math.round(255 * (1 - k * (1 - v)));
  return (ch(RECESS_TINT.r) << 16) | (ch(RECESS_TINT.g) << 8) | ch(RECESS_TINT.b);
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

/** 부재 한 장의 굽기 명세. `half(y)` 가 그 행의 반폭(디자인 px)이라 실루엣이 세로로 변한다. */
interface PieceSpec {
  /** 디자인 폭. */
  w: number;
  /** 디자인 높이. */
  h: number;
  /** 휘도 이득. */
  gain: number;
  /** 세로 프로파일(없으면 몸통의 선형 램프). */
  vStops: readonly VStop[] | null;
  /** 행별 반폭. 이 밖은 알파 0(부분 화소는 커버리지로 부드럽게). */
  half(y: number): number;
  /** 가로 조인트를 넣는가(몸통만). */
  joints: boolean;
  /** 노이즈 시드 — 부재마다 달라야 같은 얼룩이 반복되지 않는다. */
  seed: number;
}

/**
 * 부재 한 장을 픽셀로 굽는다. 단면 램프 · 세로 조형 · 조인트 · 셀 노이즈 · 그레인이 **한
 * 패스에서 최종 색으로 합쳐진다** — 레이어를 겹쳐 알파로 합성하지 않으므로 겹침 가로줄
 * (`scrim.ts` 함정)도, 흑백 그레인의 합성 비대칭도 원리적으로 생기지 않는다.
 */
function bakePiece(spec: PieceSpec): Texture | null {
  const texW = Math.max(1, Math.round(spec.w * SHAFT_SS));
  const texH = Math.max(1, Math.round(spec.h));
  const ctx = makeCtx(texW, texH);
  if (ctx === null) return null;
  const img = ctx.createImageData(texW, texH);
  const joints = spec.joints ? jointTable(texH) : null;
  const halfMax = spec.w / 2;

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
      const dist = Math.abs(px - halfMax);
      const cov = Math.max(0, Math.min(1, half - dist + 0.5));
      const i = (ty * texW + tx) * 4;
      if (cov <= 0) {
        img.data[i + 3] = 0;
        continue;
      }
      // 단면은 **부재 폭에 정규화**해 샘플한다 — 주두가 넓어도 같은 조명 단면을 갖는다.
      const { l, w } = sampleProfile(SHAFT_PROFILE, (px / spec.w) * SHAFT_W);
      const noise =
        cellNoise(px, y, spec.seed) * CELL_AMPL +
        (hash01(spec.seed ^ ((ty * 73856093) ^ (tx * 19349663))) * 2 - 1) * GRAIN_AMPL;
      const lum = Math.max(0, l * vm * jm * spec.gain + noise);
      const tint = tintFor(w);
      img.data[i] = Math.min(255, lum * tint.r);
      img.data[i + 1] = Math.min(255, lum * tint.g);
      img.data[i + 2] = Math.min(255, lum * tint.b);
      img.data[i + 3] = Math.round(cov * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(ctx);
}

// --- 텍스처 캐시 ---------------------------------------------------------------
// 리브 셋은 같은 텍스처를 공유한다(높이가 같다). 캐시가 없으면 굽기가 리브 수만큼 반복되고,
// 더 나쁘게는 리브마다 노이즈 시드를 달리 주고 싶은 유혹이 생긴다 — 그러면 단 이음매가
// 서로 어긋나 한 건물로 안 읽힌다.
const shaftCache = new Map<number, Texture | null>();
let capCache: Texture | null | undefined;
let baseCache: Texture | null | undefined;

function shaftTexture(h: number): Texture | null {
  const hit = shaftCache.get(h);
  if (hit !== undefined) return hit;
  const tex = bakePiece({
    w: SHAFT_W,
    h,
    gain: SHAFT_GAIN,
    vStops: null,
    half: () => SHAFT_W / 2,
    joints: true,
    seed: 0x2f6a1b,
  });
  shaftCache.set(h, tex);
  return tex;
}

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

function capitalTexture(): Texture | null {
  if (capCache !== undefined) return capCache;
  capCache = bakePiece({
    w: CAP_W,
    h: CAP_H + CAP_LAP,
    gain: CAP_GAIN,
    vStops: CAP_V,
    half: capHalf,
    joints: false,
    seed: 0x7c19d3,
  });
  return capCache;
}

function baseTexture(): Texture | null {
  if (baseCache !== undefined) return baseCache;
  baseCache = bakePiece({
    w: CAP_W,
    h: BASE_LAP + BASE_H,
    gain: BASE_GAIN,
    vStops: BASE_V,
    half: baseHalf,
    joints: false,
    seed: 0x1de4a7,
  });
  return baseCache;
}

/**
 * 캔버스가 없을 때의 계단 근사. **불투명·비겹침 단색 띠**라 알파 이중가산이 원리적으로 없다
 * (겹쳐 쌓는 그라디언트 근사 금지 규칙의 취지를 지키는 형태다). 화면을 세우는 것이 목적이지
 * 품질이 목적이 아니다.
 */
function fallbackPiece(g: Graphics, x: number, y: number, w: number, h: number, gain: number): void {
  const steps = 8;
  for (let i = 0; i < steps; i++) {
    const px = ((i + 0.5) / steps) * SHAFT_W;
    const { l, w: tw } = sampleProfile(SHAFT_PROFILE, px);
    const tint = tintFor(tw);
    const lum = l * gain;
    const r = Math.min(255, Math.round(lum * tint.r));
    const gg = Math.min(255, Math.round(lum * tint.g));
    const b = Math.min(255, Math.round(lum * tint.b));
    const bx = x + (i / steps) * w;
    const bw = w / steps;
    g.rect(bx, y, bw, h).fill({ color: (r << 16) | (gg << 8) | b });
  }
}

/**
 * 리브 셋을 만든다. 좌표는 **리드가 격자에서 파생해 넘긴다** — 여기서 하드코딩하면 격자가
 * 바뀌는 순간 어긋난다(그것이 리브를 도입한 이유 자체를 무효로 만든다).
 */
export function makeGutterRibs(ribs: readonly RibLine[]): GutterRibs {
  const view = new Container();
  // 크롬은 클릭 대상이 아니다 — 카드 히트 테스트를 가로채면 안 된다.
  view.eventMode = 'none';

  if (ribs.length === 0) return { view, destroy: () => view.destroy({ children: true }) };

  const fallback = new Graphics();
  let usedFallback = false;

  for (const rib of ribs) {
    // ⚠️ 정수 스냅 — 소수 좌표는 리브마다 다른 서브픽셀 위상을 만들고, 그 위상이 좌 립의
    // 피크를 최대 절반까지 갉아먹는다(헤더 [P2]ⓑ). 배율 0.9115 자체는 못 없애지만, 코드가
    // 만드는 임의 소수부는 여기서 끝난다.
    const cx = Math.round(rib.x);
    const top = Math.round(rib.y0);
    const bottom = Math.round(rib.y1);
    const h = bottom - top;
    if (h <= 0) continue;

    const shaftTex = shaftTexture(h);
    const capTex = capitalTexture();
    const baseTex = baseTexture();

    if (shaftTex === null || capTex === null || baseTex === null) {
      usedFallback = true;
      fallbackPiece(fallback, cx - SHAFT_W / 2, top, SHAFT_W, h, SHAFT_GAIN);
      fallbackPiece(fallback, cx - CAP_W / 2, top - CAP_H, CAP_W, CAP_H + CAP_LAP, CAP_GAIN);
      fallbackPiece(fallback, cx - CAP_W / 2, bottom - BASE_LAP, CAP_W, BASE_LAP + BASE_H, BASE_GAIN);
      continue;
    }

    // 콜로네이드 끝일수록 어둡다. 세 부재가 **같은 값**을 받아야 한 기둥으로 물러난다.
    const tint = recessTint(cx);

    const shaft = new Sprite(shaftTex);
    shaft.position.set(cx - SHAFT_W / 2, top);
    shaft.width = SHAFT_W;
    shaft.height = h;
    shaft.tint = tint;
    view.addChild(shaft);

    // 주두·기초는 몸통 **위에** 올린다 — 겹침 구간(LAP)에서 이음매가 부재에 가려져야
    // "쌓아 올린 것"으로 읽힌다.
    const cap = new Sprite(capTex);
    cap.position.set(cx - CAP_W / 2, top - CAP_H);
    cap.width = CAP_W;
    cap.height = CAP_H + CAP_LAP;
    cap.tint = tint;
    view.addChild(cap);

    const foot = new Sprite(baseTex);
    foot.position.set(cx - CAP_W / 2, bottom - BASE_LAP);
    foot.width = CAP_W;
    foot.height = BASE_LAP + BASE_H;
    foot.tint = tint;
    view.addChild(foot);
  }

  if (usedFallback) view.addChildAt(fallback, 0);
  else fallback.destroy();

  return {
    view,
    destroy: (): void => {
      // 캐시된 텍스처는 **반납하지 않는다** — 다음 렌더가 같은 텍스처를 다시 쓴다.
      // `destroy({ children: true })` 는 기본값이 텍스처 비파괴라 이대로 안전하다.
      view.destroy({ children: true });
    },
  };
}
