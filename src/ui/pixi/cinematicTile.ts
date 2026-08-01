/**
 * 시네마틱 건물 타일 — 기지 화면 AAA 전환 Lane B (`.omc/plans/base-screen-aaa-2026-08-02.md` §3).
 *
 * ## 왜 나무 nine-slice 를 버리는가
 * 이전 타일은 불투명 나무 프레임 + 144px 아이콘 + 텍스트 두 줄이었다. 프레임이 두껍고
 * 아이콘이 작아 **카드 면적의 대부분이 빈 나무**였고, 깊이(그림자)도 조명(림·글로우)도 없어
 * 타이틀·인트로의 풀블리드 키아트 옆에 놓으면 낙차가 그대로 보였다. 여기서는 AAA 허브의
 * 표준형 — **상단 일러스트 밴드 → 아래로 녹아드는 석재 → 각인된 라벨** — 로 바꾼다.
 *
 * ## ⚠️ 1차 실화면 판정에서 불합격한 지점(전부 실측, 고친 근거를 남긴다)
 * 1. **카드가 배경보다 어두우면 물체가 아니라 "배경에 뚫린 구멍"이 된다.** 1차판의 라벨
 *    밴드는 평균 휘도 16.4 로 거터(22.8)·좌측 배경(32)보다 **어두웠고**, 게다가 차가운
 *    청보라(17,15,23)라 따뜻한 갈색 배경(40,30,21) 위에 **붙여 놓은 패널**로 읽혔다.
 *    → 카드 바탕을 {@link BODY_TOP}→{@link BODY_BOTTOM} 의 **따뜻한 석재 그라디언트**로
 *    바꿔 라벨 밴드 평균 휘도를 거터보다 약 +10 높였다. figure-ground 는 테두리가 아니라
 *    **면의 밝기**가 만든다 — 1px 헤어라인 하나로는 실루엣이 서지 않는다.
 * 2. **그림자가 화면에서 안 보이면 없는 것이다.** 방사 그라디언트를 늘려 만든 타원은 카드
 *    모서리에 닿지 못해 사라졌다. → 캔버스 `filter: blur()` 로 **둥근 사각 실루엣을 구워**
 *    NineSliceSprite 로 쓴다. 어떤 카드 치수에서도 모서리 곡률과 흐림 반경이 보존된다.
 * 3. **밴드 높이를 텍스트가 다 못 쓰면 순수 검정 여백이 남는다**(실측 라벨 밴드 138px 중
 *    텍스트 77px). → {@link BAND_RATIO} 0.6 → 0.71. 잘림도 함께 개선된다.
 * 4. **일러스트에 스페큘러가 하나도 없었다**(최대 휘도 111~151, 화면 채도 18.7 vs 타이틀
 *    28.4). → 채도 행렬 + `screen` 소프트 하이라이트 두 겹.
 * 5. **한글 2~4음절에 트래킹을 주면 디자인이 아니라 띄어쓰기 버그로 읽힌다**(`방 어 사 령 부`).
 *    → 타일 텍스트 `letterSpacing: 0`. 라틴 대문자 조판 습관을 한글에 그대로 옮긴 실수다.
 * 6. 제목–룰–설명 3단은 좁아진 라벨 밴드에서 과하다 → 룰을 지우고 2단(제목/설명)으로.
 *
 * ## 레이어 구조 (뒤 → 앞)
 * ```
 *   shadow   구운 드롭 섀도(NineSlice) — inner 밖이라 카드와 같이 뜨지 않는다
 *   inner    ← 리프트·부유가 걸리는 컨테이너 (root 위치는 리드 소유)
 *     glow   호버 accent 후광(가산, 카드 뒤)
 *     clip   ← 카드 모양 마스크. 아래 전부가 둥근 모서리로 잘린다
 *       body   석재 그라디언트(불투명)
 *       art    일러스트 밴드(프레임 크롭 + 호버 줌)
 *       spec   스페큘러(screen) — tint 로는 못 밝힌다
 *       fade   밴드 하단 페더 — 종착색이 그 지점의 body 색과 **정확히 같다**
 *       warm   호버 온기(가산)
 *       lock   탈채도 딤
 *     seam   아트/라벨 경계 금박 헤어라인
 *     badge  절차적 자물쇠
 *     edge   안쪽 어두운 홈 + 금박 헤어라인 + 호버 림
 *     text   제목 · 설명(또는 잠금 사유)
 * ```
 *
 * ## 마스크를 쓰면서도 클릭이 죽지 않는 이유
 * 마스크 Graphics 는 히트 테스트에서 빠지므로 "바탕에만 이벤트"를 걸면 클릭이 새거나 삼켜진다
 * (이 리포가 실제로 밟은 함정). 그래서 **이벤트는 root 에 걸고 `hitArea` 를 명시**한다 —
 * 히트 판정이 자식 트리와 완전히 무관해져 마스크·텍스트·필터가 무엇을 하든 영향이 없다.
 * 비율 크롭 자체는 프레임(UV) 크롭이라 공짜고, 마스크는 둥근 모서리와 호버 줌 넘침만 막는다.
 *
 * ## 테두리는 왜 "밝은 링"이 아니라 "어두운 홈"인가
 * `theme.ts` `iconContrastRingBands` 가 실측으로 남긴 결론이다: 일러스트의 휘도 폭이 넓어
 * 어떤 단일 밝은 링도 중간 톤을 묻는다. 반대로 가장자리에 접하는 어두운 홈은 무엇이 오든
 * 경계 대비를 올린다. 그래서 금박은 **바깥 헤어라인뿐**이고 그 안쪽은 홈이다.
 *
 * ## 그라디언트를 띠로 근사하지 않는다
 * 얇은 사각형을 겹쳐 쌓으면 1px 겹침이 알파를 두 배로 만들어 가로줄이 생긴다(§0-4, 실제
 * 사용자 신고). 세로로만 변하는 램프는 전부 폭 1px 캔버스에 **픽셀로 굽고** `linear` 로
 * 늘린다 — 이음매가 원리적으로 생기지 않는다.
 *
 * ## 품질 티어를 읽지 않는다
 * 기지는 부팅 직후 화면일 수 있어 `graphicsTierController` 값이 아직 수렴 전이다(§0-3).
 * 여기서 쓰는 것은 스프라이트 몇 장과 **모듈 전체가 공유하는** 구운 텍스처 다섯 장(바탕 램프·
 * 페더·방사 글로우·그림자 2단)뿐이라 저사양에서 끌 것이 없다. 타일 수가 늘어도 굽기는 1회다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 을 읽지도 쓰지도 않고 시간축은 벽시계다.
 * `width`/`height` 는 리드가 정한다(§3) — 내부에 하드코딩된 치수는 없고 전부 파생이다.
 */

import {
  CanvasSource,
  ColorMatrixFilter,
  Container,
  Graphics,
  NineSliceSprite,
  Rectangle,
  Sprite,
  Text,
  Texture,
  TilingSprite,
} from 'pixi.js';
import { UI_FONT, TEXT_SHADOW } from './theme.js';

// --- 비율 상수(전부 width/height 파생 — 절대 치수 없음) -------------------------

/**
 * 일러스트 밴드가 차지하는 높이 비율.
 *
 * 0.6 은 실화면에서 **라벨 밴드 138px 에 텍스트가 77px** 만 들어가 카드마다 61px 짜리 죽은
 * 여백을 남겼다(1차 판정 CRIT). 0.71 이면 라벨 밴드가 텍스트 블록에 거의 맞고, 남는 높이는
 * 전부 일러스트로 가서 정사각 원본의 세로 잘림도 함께 줄어든다.
 */
const BAND_RATIO = 0.71;
/** 아트→라벨 페더 높이(카드 높이 기준). 너무 길면 일러스트를 먹고, 짧으면 경계가 칼같이 선다. */
const FEATHER_RATIO = 0.145;
/** 카드 모서리 반경(짧은 변 기준). 너무 둥글면 장난감이 된다 — 석재·금속의 절제된 반경. */
const RADIUS_RATIO = 0.045;
/** 콘텐츠 좌우 여백(폭 기준). */
const PAD_RATIO = 0.062;

/**
 * 정사각 일러스트를 밴드 비율로 중앙 크롭할 때의 세로 초점(0=위, 1=아래).
 * 건물 일러스트는 구조물이 가운데보다 조금 위에 앉아 있어 정중앙을 잡으면 지붕이 잘린다.
 *
 * ## ⚠️ 가로로 아주 긴 카드의 구조적 한계(치수 스윕 실측)
 * 크롭은 **비율 보존**이라 밴드가 가로로 길수록 원본 세로가 더 잘린다. `h=372` 기준:
 *  - `w=424` → 밴드 424×264, 1024² 중 세로 **638px(62%)** 유지 — 건물이 온전하다.
 *  - `w=878` → 밴드 878×264, 세로 **308px(30%)** 만 유지 — 지붕과 바닥이 함께 날아간다.
 * 예외도 폴백도 없고 화면은 정상적으로 서지만, **자산이 정사각인 한 이건 코드로 못 푼다** —
 * 넓은 카드를 쓰려면 높이를 같이 키우거나(밴드 세로가 늘어 잘림이 줄어든다) 그 칸만
 * 가로형 원본을 따로 받아야 한다. 리드 판단 사항이라 여기서 임의로 왜곡하지 않는다.
 */
const FOCUS_Y = 0.42;

/** 호버 시 카드가 뜨는 높이(카드 높이 기준). */
const LIFT_RATIO = 0.026;
/** 호버 시 일러스트가 밀려 들어오는 배율(Ken Burns). 마스크가 넘침을 막는다. */
const ART_ZOOM = 1.055;
/** 호버 보간 시상수(1/초). dt 지수 감쇠라 프레임률이 달라도 같은 체감이다. */
const HOVER_LERP = 9;
/** 미세 부유 진폭(카드 높이 기준)과 주기(초). 격자 전체가 출렁이면 안 되므로 아주 작게. */
const FLOAT_RATIO = 0.004;
const FLOAT_PERIOD = 6.2;
/** dt 상한 — 탭 복귀·백그라운드로 프레임이 크게 튀어도 연출이 순간이동하지 않게. */
const MAX_DT = 1 / 15;

/**
 * 라벨 밴드 석재 램프의 **양 끝 색**(밴드 상단 → 밴드 하단). 카드 전체 램프는 여기서 역산한다
 * ({@link bodyChannel}) — 반대로 카드 끝점을 적고 밴드 색을 눈대중하면 `BAND_RATIO` 를 바꿀 때
 * 조용히 어긋난다.
 *
 * ⚠️ 색상은 **따뜻한 갈색 계열**이어야 한다 — 배경과 색온도가 다르면 붙여 놓은 패널로 읽힌다.
 *
 * ## 지표를 세 번 갈아탄 기록(같은 실수를 반복하지 않기 위해 남긴다)
 *  - 1차: "카드 **전체** 평균 ≥ 거터 +8" → 숫자는 초과 달성(72.4 vs 36.3)했지만 **+36 은 전부
 *    아트 절반이 번 것**이었다. 밴드만 재면 32.1 로 거터보다 −4 였고 카드 하단이 배경에
 *    녹았다. **평균이 국소 결함을 가린 전형**이다.
 *  - 2차: "밴드 bg 평균 ≥ 거터 +5" → 밴드 42.4(예측 43.5, 오차 1.1)로 달성. 그런데 **대조군인
 *    거터가 36.3 → 22.9 로 움직여** 실제 델타가 +19.5 가 됐다 — 밴드가 이번엔 반대로 떠올랐다.
 *    **내 수치는 맞았는데 기준이 움직인 실패**다. 절대 휘도는 배경(Lane A)이 확정된 뒤에만
 *    의미가 있다.
 *  - 3차(현재): 그래서 **절대 휘도를 쫓지 않는다.** 밴드 bg 평균을 40~44 대역에 두고
 *    (검산: 상단 rgb(62,45,32) L48.5 · 하단 rgb(46,33,24) L35.9 → **평균 42.2**),
 *    나머지는 **재질 구조**로 푼다 — 세로 램프(Δ12.6L)·미세 그레인·상단 그림자선.
 *    "std 1.42 의 완전 균일한 사각형"이 CSS `div` 로 읽힌 원인이지 밝기가 아니었다.
 */
const BAND_TOP = { r: 0x3e, g: 0x2d, b: 0x20 } as const;
const BAND_BOTTOM = { r: 0x2e, g: 0x21, b: 0x18 } as const;

/**
 * 미세 그레인 진폭(±3L 목표). 흰 점과 검은 점의 알파가 다른 이유는 **합성이 비대칭**이기
 * 때문이다: 바탕 L≈42 위에 흰색을 알파 a 로 얹으면 `42 + 213a`, 검은색은 `42(1−a)` 라
 * 같은 ±3L 을 내려면 흰쪽 0.014 · 검은쪽 0.071 이 필요하다. 같은 값을 쓰면 얼룩이 한쪽으로
 * 쏠린다.
 */
const GRAIN_UP = 0.016;
const GRAIN_DOWN = 0.075;

/** 아트/라벨 경계: 선반이 드리우는 그림자선과 그 위 립의 캐치라이트. */
const SEAM_SHADOW = 0x0e0906;
const SEAM_GOLD = 0xc9a04a;
const SEAM_ALPHA = 0.2;

/**
 * 방향성 베벨(3차 판정 HIGH·N3).
 *
 * ⚠️ 1차·2차판은 사방 균일한 금색 1px 스트로크였다. 실측이 상 114.8 / 좌 113.3 / 우 110.4 /
 * 하 113.4 — **편차 4L**. 광원이 위에 있는 화면에서 **바닥 모서리가 천장 모서리와 똑같이 밝은
 * 것은 조명이 아니라 스트로크다.** 카드 내부 L≈65 와 배경 L≈25 사이에 L113 하드 키라인이
 * 박히니 유화 타일이 "오려 붙인 것"·"웹 카드 컴포넌트"로 읽혔다.
 *
 * 그래서 위/왼쪽만 빛을 받고 아래/오른쪽은 그늘지는 **실제 베벨**로 바꾼다. 경로는 대각선
 * (좌하·우상 모서리 호의 중점)에서 갈라 이음매가 모서리 한가운데에 오게 한다 — 변에서 끊으면
 * 끊긴 자리가 눈에 띈다. 바깥으로는 **한 픽셀도 그리지 않는다**(스트로크를 안쪽 정렬로
 * 인셋해서 그린다) — 카드 바깥 밝은 선이 이 처방이 없애려는 바로 그 신호다.
 */
const BEVEL_LIGHT = 0xd9b070;
const BEVEL_LIGHT_ALPHA = 0.55;
const BEVEL_DARK = 0x120b06;
const BEVEL_DARK_ALPHA = 0.7;
/**
 * 밝은 립 **안쪽**에 파는 어두운 홈. `theme.ts` `iconContrastRingBands` 의 실측 결론(밝은 링은
 * 중간 톤을 묻는다, 어두운 홈이 답)을 베벨과 양립시키는 자리다 — 이게 없으면 밝은 일러스트
 * 상단이 금색 립과 붙어 **2px 짜리 밝은 띠**가 되어 원래 문제가 되돌아온다.
 */
const BEVEL_RECESS = 0x0d0805;
const BEVEL_RECESS_ALPHA = 0.5;
/** 제목·설명색(1차 판정 MED-6 처방값). 위계를 크기와 **색·굵기 양쪽**으로 벌린다. */
const TITLE_FILL = 0xf0e6d2;
const DESC_FILL = 0x9a8f7d;
/** 잠금 사유 문구색 — 경고이되 붉게 타오르지 않는 따뜻한 살구색. */
const LOCK_TEXT = 0xffab84;

/**
 * 그림자 한 층의 굽기·배치 명세.
 *
 * ## 왜 한 층으로는 안 되는가 (2차 판정 MED-2b)
 * 1차 처방(offsetY 11 · blur 22 · α0.55) 한 층만 깔았더니 실측 최심이 카드 아래 y+3 에서
 * **−11.7L** 에 그쳤고 24px 에 걸쳐 소멸했다 — **테두리 바로 아래 0~3px 에 near-black 이
 * 없으면** 눈은 그것을 접지가 아니라 **앰비언트 얼룩**으로 읽는다. 물체가 바닥에 닿아 있다는
 * 신호는 넓고 옅은 확산이 아니라 **좁고 짙은 접촉 어둠(contact shadow)** 이 만든다.
 *
 * 그래서 두 층으로 나눈다:
 *  - {@link CONTACT} 좁고 짙게(blur 4 · α0.85) — 카드가 바닥에 **닿은** 자리
 *  - {@link DIFFUSE} 넓고 옅게(blur 22 · α0.45) — 카드가 바닥에서 **떨어진** 부피감
 *
 * **검증 불변식**: 카드 하단 테두리 아래 **y+2~y+5 가 같은 y 의 측면 대조군보다 −28L 이상**
 * 어두울 것. 검산(바닥 L 51.2 기준, 두 층은 알파가 곱으로 합성된다):
 *  - y+2 — 접촉층은 사각 바닥 모서리(h+2)라 α≈0.85·0.5=0.42, 확산층은 사각 내부라 α=0.45
 *    → 투과 (1−0.42)(1−0.45)=0.319 → L 16.3 = **−34.9**
 *  - y+5 — 접촉층 3px 밖(σ=4) α≈0.85·0.23=0.19, 확산층 여전히 0.45
 *    → 투과 0.81·0.55=0.446 → L 22.8 = **−28.4**
 * 두 지점 모두 −28 을 넘는다.
 */
interface ShadowBake {
  /** 카드 바깥으로 번지는 폭(px). 구운 텍스처의 여백과 같아야 정렬이 맞는다. */
  readonly spread: number;
  /** 캔버스 `filter: blur()` 반경(px) = 가우시안 표준편차. */
  readonly blur: number;
  /** 나인슬라이스 경계(여백 + 모서리 반경). 텍스처 절반보다 작아야 한다. */
  readonly border: number;
  /** 기본 세로 오프셋과 알파. */
  readonly offset: number;
  readonly alpha: number;
  /** 호버 시(카드가 뜰 때) 도달할 오프셋·알파·추가 번짐. */
  readonly hoverOffset: number;
  readonly hoverAlpha: number;
  readonly hoverGrow: number;
}

/**
 * 접촉층 — 카드가 바닥에 닿은 자리. 호버로 카드가 뜨면 **접촉이 끊기므로 거의 사라진다**
 * (오프셋을 키우는 게 아니라 알파를 죽이는 것이 물리적으로 맞는 신호다).
 */
const CONTACT: ShadowBake = {
  spread: 12,
  blur: 4,
  border: 30,
  offset: 2,
  alpha: 0.85,
  hoverOffset: 3,
  hoverAlpha: 0.4,
  hoverGrow: 2,
};

/** 확산층 — 부피감. 카드가 뜰수록 더 내려가고 옅고 넓어진다. */
const DIFFUSE: ShadowBake = {
  spread: 48,
  blur: 22,
  border: 68,
  offset: 11,
  alpha: 0.45,
  hoverOffset: 18,
  hoverAlpha: 0.34,
  hoverGrow: 10,
};

/** 구운 그림자 텍스처 안쪽 사각의 한 변(px). 나인슬라이스라 실제 카드 크기와 무관하다. */
const SHADOW_CORE = 96;
/** 구운 사각의 모서리 반경. 카드 반경(짧은 변 ×0.045 ≈ 17)과 맞춰 둔다. */
const SHADOW_RADIUS = 18;

export interface CinematicTileOpts {
  width: number;
  height: number;
  /** 건물 일러스트(1024², 없으면 accent 폴백). */
  art: Texture | undefined;
  /** 잠금/폴백 강조색. */
  accent: number;
  title: string;
  desc: string;
  locked: boolean;
  lockReason: string | null;
  onClick?: () => void;
}

export interface CinematicTile {
  readonly container: Container;
  /** 호버 글로우·미세 부유 등 연출. dt 는 벽시계 초. */
  update(dt: number): void;
}

// --- 구운 텍스처(모듈 1회, 모든 타일이 공유) -----------------------------------

/** 캔버스 2D 컨텍스트 하나. 없으면 `null`(vitest 등) — 호출부는 그래도 화면을 세운다. */
function bakeCanvas(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
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
 * 카드 바탕 램프의 세로 위치 `t`(0..1)에서의 채널값.
 *
 * 정본은 **밴드 구간의 색**({@link BAND_TOP}/{@link BAND_BOTTOM})이고, 카드 전체 램프는 그
 * 직선을 `t=BAND_RATIO..1` 이 정확히 밴드 색이 되도록 **역산**한 것이다. 아트가 덮는 위쪽은
 * 어차피 안 보이므로 자유롭고, 대신 `BAND_RATIO` 를 바꿔도 밴드 색이 따라 어긋나지 않는다.
 * 페더 색({@link bandFadeTexture})도 같은 함수에서 파생한다 — 둘을 따로 적으면 이음매가 생긴다.
 */
function bodyChannel(k: 'r' | 'g' | 'b', t: number): number {
  const slope = (BAND_BOTTOM[k] - BAND_TOP[k]) / (1 - BAND_RATIO);
  const at0 = BAND_TOP[k] - slope * BAND_RATIO;
  return Math.max(0, Math.min(255, Math.round(at0 + slope * t)));
}

let bodyCache: Texture | null | undefined;

/** 카드 바탕 석재 램프(1×256, 불투명). 폭 1px 이면 충분하다 — 세로로만 변한다. */
function bodyGradientTexture(): Texture | null {
  if (bodyCache !== undefined) return bodyCache;
  const h = 256;
  const ctx = bakeCanvas(1, h);
  if (ctx === null) {
    bodyCache = null;
    return null;
  }
  for (let i = 0; i < h; i++) {
    const t = i / (h - 1);
    ctx.fillStyle = `rgb(${bodyChannel('r', t)}, ${bodyChannel('g', t)}, ${bodyChannel('b', t)})`;
    ctx.fillRect(0, i, 1, 1);
  }
  bodyCache = fromCanvas(ctx);
  return bodyCache;
}

let fadeCache: Texture | null | undefined;

/**
 * 아트/라벨 페더(1×256). 색은 **밴드 바닥에서의 바탕색과 정확히 같다**(`t = BAND_RATIO`).
 * 그래서 알파가 1 에 닿는 지점의 픽셀값이 그 아래 바탕과 동일해 이음매가 원리적으로 없다.
 * 알파 곡선 지수 1.5 — 선형이면 위쪽이 너무 빨리 덮여 일러스트가 잘린 것처럼 보인다.
 */
function bandFadeTexture(): Texture | null {
  if (fadeCache !== undefined) return fadeCache;
  const h = 256;
  const ctx = bakeCanvas(1, h);
  if (ctx === null) {
    fadeCache = null;
    return null;
  }
  const r = bodyChannel('r', BAND_RATIO);
  const g = bodyChannel('g', BAND_RATIO);
  const b = bodyChannel('b', BAND_RATIO);
  for (let i = 0; i < h; i++) {
    const t = (i + 1) / h;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${t ** 1.5})`;
    ctx.fillRect(0, i, 1, 1);
  }
  fadeCache = fromCanvas(ctx);
  return fadeCache;
}

let glowCache: Texture | null | undefined;

/**
 * 중심이 흰색이고 가장자리로 사라지는 방사 텍스처(후광·스페큘러·폴백 조명 공용).
 * 흰색으로 굽고 쓰는 쪽에서 `tint` 로 색을 준다.
 */
function radialGlowTexture(): Texture | null {
  if (glowCache !== undefined) return glowCache;
  const size = 128;
  const ctx = bakeCanvas(size, size);
  if (ctx === null) {
    glowCache = null;
    return null;
  }
  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  // 지수 2.4 폴오프 — 선형이면 가장자리에 또렷한 원이 보인다. 16 스톱이면 밴딩이 안 보인다.
  const stops = 16;
  for (let i = 0; i <= stops; i++) {
    const p = i / stops;
    grad.addColorStop(p, `rgba(255, 255, 255, ${(1 - p) ** 2.4})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  glowCache = fromCanvas(ctx);
  return glowCache;
}

let grainCache: Texture | null | undefined;

/**
 * 미세 그레인(64² 타일, 알파만 있는 흑백 점).
 *
 * ⚠️ 3차 판정 MED-N: 밴드 bg 의 **표준편차가 1.42** 였다 — 4장 전부 42.35~42.55 로 픽셀 단위
 * 완전 균일한 사각형이라, 유화 일러스트 바로 아래에서 CSS `div` 로 읽혔다. 유화 옆에 놓이는
 * 면은 **평평하면 안 된다.** 밝기가 아니라 재질이 문제였다.
 *
 * 난수는 xorshift 로 **결정적**이다 — 굽기가 매번 같아야 스크린샷 회귀 비교가 성립한다
 * (`Math.random()` 을 쓰면 프레임마다가 아니라 세션마다 달라져 비평 실측이 흔들린다).
 * 보간은 `nearest` — `linear` 로 늘리면 그레인이 뭉개져 그냥 얼룩이 된다.
 */
function grainTexture(): Texture | null {
  if (grainCache !== undefined) return grainCache;
  const size = 64;
  const ctx = bakeCanvas(size, size);
  if (ctx === null) {
    grainCache = null;
    return null;
  }
  const img = ctx.createImageData(size, size);
  let seed = 0x9e3779b9;
  for (let i = 0; i < size * size; i++) {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    const n = (seed / 0xffffffff) * 2 - 1; // -1..1
    const up = n > 0;
    const o = i * 4;
    const v = up ? 255 : 0;
    img.data[o] = v;
    img.data[o + 1] = v;
    img.data[o + 2] = v;
    img.data[o + 3] = Math.round(Math.abs(n) * (up ? GRAIN_UP : GRAIN_DOWN) * 255);
  }
  ctx.putImageData(img, 0, 0);
  const tex = fromCanvas(ctx);
  tex.source.scaleMode = 'nearest';
  grainCache = tex;
  return tex;
}

const shadowCache = new Map<string, Texture | null>();

/**
 * 드롭 섀도 실루엣(나인슬라이스용). 안쪽 {@link SHADOW_CORE}² 사각 둘레에 `spread` 만큼
 * 여백을 두고, 그 사각을 캔버스 `filter: blur()` 로 흐려 굽는다.
 *
 * ⚠️ 1차판은 방사 그라디언트를 타원으로 늘려 썼는데, **모서리에 닿지 못해 화면에서 사라졌다**
 * (비평 판정: "캐스트 섀도가 없고 테두리 스트로크뿐"). 그림자는 카드와 **같은 모양**이어야
 * 물체로 읽힌다.
 *
 * 나인슬라이스로 쓰는 이유: 스프라이트를 그냥 늘리면 카드 비율에 따라 **모서리 곡률과 흐림
 * 반경이 함께 늘어나** 카드마다 다른 그림자가 된다(878×372 같은 가로로 긴 카드에서 즉시
 * 드러난다). 나인슬라이스는 모서리를 고정하고 변만 늘리므로 어떤 치수에서도 같은 흐림이다.
 *
 * `ctx.filter`·`roundRect` 가 없는 구형 엔진이면 `null` — 호출부가 방사 폴백으로 내려간다.
 */
function softShadowTexture(bake: ShadowBake): Texture | null {
  const key = `${bake.spread}:${bake.blur}`;
  const hit = shadowCache.get(key);
  if (hit !== undefined) return hit;
  const size = SHADOW_CORE + bake.spread * 2;
  const ctx = bakeCanvas(size, size);
  if (ctx === null || typeof ctx.filter !== 'string' || typeof ctx.roundRect !== 'function') {
    shadowCache.set(key, null);
    return null;
  }
  ctx.filter = `blur(${bake.blur}px)`;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.roundRect(bake.spread, bake.spread, SHADOW_CORE, SHADOW_CORE, SHADOW_RADIUS);
  ctx.fill();
  const tex = fromCanvas(ctx);
  shadowCache.set(key, tex);
  return tex;
}

// --- 순수 헬퍼 ------------------------------------------------------------------

/**
 * 텍스트 높이(캔버스가 없는 환경 방어). Pixi 의 `Text.height` 는 측정을 위해 캔버스 컨텍스트를
 * 요구해서 vitest 에서 던진다 — 이 리포가 UI 테스트에서 실제로 밟은 지점이라 폴백을 둔다.
 */
function safeHeight(text: Text, fallback: number): number {
  try {
    const h = text.height;
    return Number.isFinite(h) && h > 0 ? h : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 정사각(혹은 임의 비율) 일러스트를 `w:h` 비율로 **중앙 크롭**한 텍스처.
 *
 * 스프라이트를 늘리지 않는다 — 늘리면 건물이 납작해져 즉시 아마추어로 읽힌다. 마스크가 아니라
 * 프레임(UV) 크롭이라 드로우콜도 스텐실도 늘지 않는다. 원본 텍스처는 건드리지 않고 같은
 * `source` 위에 새 `frame` 을 얹은 별도 Texture 를 만든다(공유 자산 오염 금지).
 */
function cropToAspect(art: Texture, w: number, h: number): Texture {
  const src = art.frame;
  if (!(src.width > 0) || !(src.height > 0) || !(w > 0) || !(h > 0)) return art;
  const target = w / h;
  let cw = src.width;
  let ch = src.height;
  if (src.width / src.height > target) cw = src.height * target;
  else ch = src.width / target;
  const cx = src.x + (src.width - cw) / 2;
  const cy = src.y + (src.height - ch) * FOCUS_Y;
  try {
    return new Texture({ source: art.source, frame: new Rectangle(cx, cy, cw, ch) });
  } catch {
    return art;
  }
}

/**
 * 일러스트 색보정 — 채도 +18%, 대비 소폭.
 *
 * 1차 판정 HIGH-4: 타일 아트 최대 휘도가 111~151 로 **스페큘러가 하나도 없었고**, 화면 채도
 * 평균 18.7 로 타이틀(28.4)·인트로(26.9)보다 확연히 죽어 있었다. `tint` 는 곱연산이라 채도도
 * 하이라이트도 못 올린다 — 색 행렬이 유일한 정답이다.
 *
 * ⚠️ `new ColorMatrixFilter()` 는 생성 시점에 GL 프로그램을 준비하려 들어 **캔버스가 없는
 * 환경(vitest)에서 던진다**(실측: `getMaxFragmentPrecision`). 자산이 없어도 화면이 서야 한다는
 * 규칙(§0-6)과 같은 이유로 실패하면 조용히 보정 없이 지나간다 — 하이라이트는 `screen`
 * 스페큘러가 별도로 책임지므로 폴백에서도 밴드가 완전히 죽지는 않는다.
 */
function gradeArt(sprite: Sprite): void {
  try {
    const cm = new ColorMatrixFilter();
    cm.saturate(0.18, true);
    cm.contrast(0.06, true);
    sprite.filters = [cm];
  } catch {
    /* 보정 없이 진행 — screen 스페큘러가 하이라이트를 담당한다. */
  }
}

/**
 * 잠금 일러스트 탈채도. `tint` 는 곱연산이라 채도를 **못 낮춘다**(어둡게만 만든다).
 * 필터가 불가능하면 회청 곱색 폴백 — 완전한 흑백은 아니지만 잠금 딤과 합쳐지면 "죽어 있는
 * 타일"로 충분히 읽힌다({@link gradeArt} 와 같은 이유의 방어).
 */
function desaturate(sprite: Sprite): void {
  try {
    const cm = new ColorMatrixFilter();
    cm.desaturate();
    cm.brightness(0.55, true);
    sprite.filters = [cm];
  } catch {
    sprite.tint = 0x5f5c68;
  }
}

/**
 * 둥근 사각의 **위/왼쪽 반**(빛을 받는 쪽) 경로. 좌하 모서리 호의 중점에서 시작해 왼쪽 변 →
 * 좌상 호 → 윗변 → 우상 호의 중점에서 끝난다. 대각선에서 갈라야 이음매가 모서리 한가운데에
 * 놓여 눈에 띄지 않는다(변 중간에서 끊으면 그 자리가 보인다).
 *
 * `inset` 만큼 안으로 들여 그린다 — Pixi 의 열린 경로 스트로크는 중심 정렬이라, 선 두께의
 * 절반을 인셋해야 **카드 바깥으로 한 픽셀도 새지 않는다**.
 */
function bevelLightPath(g: Graphics, w: number, h: number, radius: number, inset: number): void {
  const r = Math.max(0, radius - inset);
  const x0 = inset;
  const y0 = inset;
  const x1 = w - inset;
  const y1 = h - inset;
  const q = Math.PI / 2;
  g.arc(x0 + r, y1 - r, r, q * 1.5, Math.PI) // 좌하 호의 아래→중점
    .lineTo(x0, y0 + r)
    .arc(x0 + r, y0 + r, r, Math.PI, q * 3) // 좌상 호 전체
    .lineTo(x1 - r, y0)
    .arc(x1 - r, y0 + r, r, q * 3, q * 3.5); // 우상 호의 절반
}

/** 둥근 사각의 **아래/오른쪽 반**(그늘지는 쪽) 경로. {@link bevelLightPath} 와 정확히 상보다. */
function bevelDarkPath(g: Graphics, w: number, h: number, radius: number, inset: number): void {
  const r = Math.max(0, radius - inset);
  const x0 = inset;
  const y0 = inset;
  const x1 = w - inset;
  const y1 = h - inset;
  const q = Math.PI / 2;
  g.arc(x1 - r, y0 + r, r, q * 3.5, q * 4) // 우상 호의 중점→오른쪽
    .lineTo(x1, y1 - r)
    .arc(x1 - r, y1 - r, r, 0, q) // 우하 호 전체
    .lineTo(x0 + r, y1)
    .arc(x0 + r, y1 - r, r, q, q * 1.5); // 좌하 호의 절반
}

/** 문자열에서 뽑은 결정적 위상(0..2π) — 타일마다 부유가 어긋나게. 매 프레임 같은 값이다. */
function phaseOf(seed: string): number {
  let acc = 0;
  for (let i = 0; i < seed.length; i++) acc = (acc * 31 + seed.charCodeAt(i)) % 9973;
  return (acc / 9973) * Math.PI * 2;
}

/** 절차적 자물쇠(텍스처 의존 0 — 자산이 없어도 잠금이 잠금으로 읽혀야 한다). */
function lockBadge(size: number, color: number): Container {
  const c = new Container();
  const body = size * 0.62;
  const bodyY = size * 0.34;

  // 어두운 원반 — 밝은 일러스트 위에서도 자물쇠가 뜨게(홈과 같은 원리).
  const disc = new Graphics();
  disc.circle(0, size * 0.5, size * 0.82).fill({ color: 0x000000, alpha: 0.5 });
  c.addChild(disc);

  const g = new Graphics();
  // 고리 — 반원 + 양 다리. `arc` 로 그려야 두께가 균일하다.
  const shackleR = size * 0.26;
  g.moveTo(-shackleR, bodyY)
    .lineTo(-shackleR, bodyY - size * 0.06)
    .arc(0, bodyY - size * 0.06, shackleR, Math.PI, 0)
    .lineTo(shackleR, bodyY)
    .stroke({ color, width: Math.max(2, size * 0.1), alpha: 0.95, cap: 'round' });
  // 몸통.
  g.roundRect(-body / 2, bodyY, body, size * 0.52, size * 0.1).fill({ color, alpha: 0.95 });
  // 열쇠구멍 — 몸통과 대비되게 파낸다.
  g.circle(0, bodyY + size * 0.22, size * 0.075).fill({ color: 0x140c04, alpha: 0.9 });
  c.addChild(g);
  return c;
}

// --- 본체 ----------------------------------------------------------------------

/**
 * 타일 한 장. 반환 `container` 는 (0,0) 기준 width×height 를 차지하고(그림자만 바깥으로
 * {@link DIFFUSE}`.spread`(48px, 호버 시 58px) 만큼 번진다), 위치는 리드가
 * `.position.set()` 으로 잡는다.
 */
export function makeCinematicTile(o: CinematicTileOpts): CinematicTile {
  const { width: w, height: h, accent, locked } = o;
  const radius = Math.max(6, Math.round(Math.min(w, h) * RADIUS_RATIO));
  const pad = Math.round(w * PAD_RATIO);
  const bandH = Math.round(h * BAND_RATIO);
  const lift = h * LIFT_RATIO;
  const floatAmp = h * FLOAT_RATIO;
  const glowTex = radialGlowTexture();

  const root = new Container();
  const inner = new Container();

  // --- 드롭 섀도(2단: 확산 → 접촉) ----------------------------------------------
  // inner **밖**에 둔다 — 카드가 뜰 때 그림자까지 같이 뜨면 부유가 아니라 통째로 미끄러진
  // 것으로 읽힌다. 바닥에 남아 내려가고 옅어지고 넓어져야 "떴다"가 성립한다.
  // 확산층을 먼저(뒤에) 깔고 접촉층을 그 위에 얹어야 테두리 바로 밑이 가장 짙어진다.
  const shadows: { sprite: NineSliceSprite; bake: ShadowBake }[] = [];
  for (const bake of [DIFFUSE, CONTACT]) {
    const tex = softShadowTexture(bake);
    if (tex === null) continue;
    // 텍스처의 사각은 [spread, size−spread] 구간이므로, 스프라이트를 (−spread, −spread)에
    // 두고 w+2·spread 크기로 잡으면 안쪽 사각이 정확히 카드와 겹친다.
    const ns = new NineSliceSprite({
      texture: tex,
      leftWidth: bake.border,
      topHeight: bake.border,
      rightWidth: bake.border,
      bottomHeight: bake.border,
    });
    ns.alpha = bake.alpha;
    root.addChild(ns);
    shadows.push({ sprite: ns, bake });
  }
  // 폴백: `ctx.filter` 가 없는 엔진. 방사 타원이라 모서리에는 못 닿고 접촉층도 못 만들지만,
  // 아무것도 없는 것보다는 낫다(구운 텍스처가 하나도 안 나온 경우에만 쓴다).
  let fallbackShadow: Sprite | null = null;
  if (shadows.length === 0 && glowTex !== null) {
    fallbackShadow = new Sprite(glowTex);
    fallbackShadow.anchor.set(0.5);
    fallbackShadow.tint = 0x000000;
    fallbackShadow.alpha = DIFFUSE.alpha;
    root.addChild(fallbackShadow);
  }
  root.addChild(inner);

  // --- 호버 후광(카드 뒤, 가산) -------------------------------------------------
  let glow: Sprite | null = null;
  if (glowTex !== null) {
    glow = new Sprite(glowTex);
    glow.anchor.set(0.5);
    glow.tint = locked ? 0x6b6470 : accent;
    glow.blendMode = 'add';
    glow.alpha = 0;
    glow.position.set(w / 2, h * 0.44);
    glow.width = w * 1.55;
    glow.height = h * 1.55;
    inner.addChild(glow);
  }

  // --- 카드 내용물(둥근 모서리 클리핑) -------------------------------------------
  const clip = new Container();
  const clipMask = new Graphics();
  clipMask.roundRect(0, 0, w, h, radius).fill({ color: 0xffffff });
  inner.addChild(clip);
  inner.addChild(clipMask);
  clip.mask = clipMask;

  // 바탕 — 따뜻한 석재 그라디언트. 배경보다 **밝아야** 카드가 물체로 선다(CRIT-1).
  const bodyTex = bodyGradientTexture();
  if (bodyTex !== null) {
    const body = new Sprite(bodyTex);
    body.width = w;
    body.height = h;
    clip.addChild(body);
  } else {
    const body = new Graphics();
    body.rect(0, 0, w, h).fill({ color: 0x322517 });
    clip.addChild(body);
  }

  // --- 일러스트 밴드 ------------------------------------------------------------
  // 호버 줌은 `scale` 이 아니라 **픽셀 크기**로 건다. 크롭 스프라이트의 기준 배율은
  // `width`/`height` 대입으로 이미 정해져 있어 `scale.set()` 이 그것을 통째로 덮어쓰기 때문이다.
  let artSprite: Sprite | null = null;
  let artBaseW = w;
  let artBaseH = bandH;
  if (o.art !== undefined) {
    artSprite = new Sprite(cropToAspect(o.art, w, bandH));
    artSprite.anchor.set(0.5);
    artSprite.position.set(w / 2, bandH / 2);
    artSprite.width = w;
    artSprite.height = bandH;
    if (locked) desaturate(artSprite);
    else gradeArt(artSprite);
    clip.addChild(artSprite);
  } else {
    // accent 절차 폴백 — 자산은 덧붙임이지 전제가 아니다(§0-6). 단색 사각이 아니라 "빛이
    // 고여 있는 밴드"로 만들어야 결손이 사고가 아니라 스타일로 보인다.
    const fill = new Graphics();
    fill.rect(0, 0, w, bandH).fill({ color: accent, alpha: 0.16 });
    clip.addChild(fill);
    if (glowTex !== null) {
      const orb = new Sprite(glowTex);
      orb.anchor.set(0.5);
      orb.tint = accent;
      orb.blendMode = 'add';
      orb.alpha = locked ? 0.16 : 0.4;
      orb.position.set(w / 2, bandH * 0.52);
      clip.addChild(orb);
      // 호버 줌은 폴백에서도 동작한다 — 기준 크기만 다르게 붙잡는다.
      artSprite = orb;
      artBaseW = w * 0.86;
      artBaseH = bandH * 1.05;
    }
  }

  // --- 스페큘러(screen) ----------------------------------------------------------
  // HIGH-4 처방의 후반부. 색 행렬은 채도만 올릴 뿐 **없는 하이라이트를 만들지 못한다**.
  // 밴드 위쪽 1/3 에 따뜻한 빛무리를 screen 으로 얹어 상위 휘도 대역을 끌어올린다.
  // (가산이 아니라 screen 인 이유: 가산은 이미 밝은 화소를 흰색으로 태워 디테일을 지운다.)
  if (!locked && glowTex !== null) {
    const spec = new Sprite(glowTex);
    spec.anchor.set(0.5);
    spec.tint = 0xfff2d8;
    spec.blendMode = 'screen';
    spec.alpha = 0.26;
    spec.position.set(w * 0.5, bandH * 0.34);
    spec.width = w * 1.15;
    spec.height = bandH;
    clip.addChild(spec);
  }

  // --- 밴드 하단 페더 -----------------------------------------------------------
  // 딱 잘린 경계선이 보이면 실패다. 종착색이 그 지점의 바탕색과 정확히 같도록 구웠으므로
  // (bandFadeTexture 헤더) 페더가 끝나는 y 에서 색 계단이 원리적으로 없다.
  const fadeTex = bandFadeTexture();
  const feather = Math.max(12, Math.round(h * FEATHER_RATIO));
  if (fadeTex !== null) {
    const fade = new Sprite(fadeTex);
    fade.position.set(0, bandH - feather);
    fade.width = w;
    fade.height = feather;
    clip.addChild(fade);
    // 페더 아래(밴드 바닥~카드 바닥)는 바탕 그라디언트가 이미 채우고 있다.
  }

  // --- 미세 그레인 ---------------------------------------------------------------
  // 페더 **위**에 얹는다 — 베일까지 함께 거칠어져야 아트에서 선반으로 넘어가는 구간이 하나의
  // 재질로 읽힌다. 페더 아래만 그레인을 주면 그 경계가 또 다른 가로줄이 된다.
  const grainTex = grainTexture();
  if (grainTex !== null) {
    const grainTop = Math.max(0, bandH - feather);
    const grain = new TilingSprite({
      texture: grainTex,
      width: w,
      height: h - grainTop,
    });
    grain.position.set(0, grainTop);
    clip.addChild(grain);
  }

  // --- 호버 온기(가산) ----------------------------------------------------------
  // tint 는 곱연산이라 밝힐 수 없다(§0-5). 밴드 위에 얇은 가산 판을 얹어 조명이 든 것처럼.
  const warm = new Graphics();
  warm.rect(0, 0, w, bandH).fill({ color: 0xffe0a8 });
  warm.blendMode = 'add';
  warm.alpha = 0;
  clip.addChild(warm);

  // --- 잠금 딤 -------------------------------------------------------------------
  if (locked) {
    const dim = new Graphics();
    dim.rect(0, 0, w, h).fill({ color: 0x0e0a06, alpha: 0.5 });
    clip.addChild(dim);
  }

  // --- 아트/라벨 경계 ------------------------------------------------------------
  // 라벨 선반은 아트보다 **뒤로 물러난 면**이다. 그러면 경계에 생기는 것은 밝은 각인선이
  // 아니라 **선반이 받는 그림자**다(3차 판정 MED-N ③). 그 위 1px 에만 아주 옅은 금빛 립을
  // 남겨 "빛을 받는 모서리 → 그늘진 안쪽"의 2단을 만든다 — 금선 하나만 두면 선반이 오히려
  // 앞으로 튀어나온 것처럼 보인다.
  const seam = new Graphics();
  seam.rect(0, bandH - 1, w, 1).fill({ color: SEAM_GOLD, alpha: locked ? SEAM_ALPHA * 0.5 : SEAM_ALPHA });
  seam.rect(0, bandH, w, 1).fill({ color: SEAM_SHADOW, alpha: 0.9 });
  inner.addChild(seam);

  if (locked) {
    const badge = lockBadge(Math.round(Math.min(w, bandH) * 0.2), 0xd8c79a);
    badge.position.set(w / 2, bandH * 0.42);
    inner.addChild(badge);
  }

  // --- 테두리: 방향성 베벨 --------------------------------------------------------
  // 사방 균일 스트로크는 폐기했다(BEVEL_LIGHT 헤더의 실측 근거). 위/왼쪽 = 립, 아래/오른쪽 =
  // 그늘, 그 립 안쪽에 어두운 홈. 셋 다 안쪽으로 인셋해 카드 **바깥에는 아무것도 없다**.
  const edge = new Graphics();
  // ① 아래/오른쪽 그늘 2px — 카드가 바닥에서 어둠으로 넘어가는 자리.
  bevelDarkPath(edge, w, h, radius, 1);
  edge.stroke({ color: BEVEL_DARK, width: 2, alpha: locked ? BEVEL_DARK_ALPHA * 0.7 : BEVEL_DARK_ALPHA });
  // ② 위/왼쪽 립 안쪽의 어두운 홈 1px([1,2] 구간) — 밝은 일러스트가 립과 붙어 2px 밝은 띠가
  //    되는 것을 막는다(theme.ts iconContrastRingBands 결론).
  bevelLightPath(edge, w, h, radius, 1.5);
  edge.stroke({ color: BEVEL_RECESS, width: 1, alpha: BEVEL_RECESS_ALPHA });
  // ③ 위/왼쪽 립 1px([0,1] 구간) — 이 카드에서 유일하게 밝은 테두리.
  bevelLightPath(edge, w, h, radius, 0.5);
  edge.stroke({
    color: BEVEL_LIGHT,
    width: 1,
    alpha: locked ? BEVEL_LIGHT_ALPHA * 0.4 : BEVEL_LIGHT_ALPHA,
  });
  inner.addChild(edge);

  // 림라이트도 **방향성**이다 — 호버라고 사방을 밝히면 그 순간 다시 웹 카드 키라인이 된다.
  // 빛을 받는 위/왼쪽만 강해진다. 별도 Graphics 라 알파만 흔들면 된다(매 프레임 재작도 없음).
  const rim = new Graphics();
  bevelLightPath(rim, w, h, radius, 1);
  rim.stroke({ color: 0xfff0c8, width: 2, alpha: 1 });
  rim.alpha = 0;
  inner.addChild(rim);

  // --- 타이포 --------------------------------------------------------------------
  // ⚠️ `letterSpacing` 은 **0 이다.** 한글 2~4음절 단어에 트래킹을 주면 `방 어 사 령 부` 처럼
  // 띄어쓰기 버그로 읽힌다(1차 판정 HIGH-5, 실화면 확인). 라틴 대문자 조판 습관을 그대로
  // 옮긴 실수였다 — 위계는 자간이 아니라 **크기·굵기·색**으로 만든다.
  const titleSize = Math.min(34, Math.max(20, Math.round(h * 0.079)));
  const descSize = Math.min(18, Math.max(12, Math.round(h * 0.0425)));
  const wrapW = w - pad * 2;

  const title = new Text({
    resolution: 2,
    text: o.title,
    style: {
      fontFamily: UI_FONT,
      fontSize: titleSize,
      fontWeight: '700',
      letterSpacing: 0,
      fill: locked ? 0x9a9186 : TITLE_FILL,
      align: 'center',
      wordWrap: true,
      wordWrapWidth: wrapW,
      lineHeight: Math.round(titleSize * 1.14),
      dropShadow: { color: 0x000000, alpha: 0.8, blur: 5, distance: 2, angle: Math.PI / 2 },
    },
  });
  title.anchor.set(0.5, 0);

  const bottom = new Text({
    resolution: 2,
    text: locked ? (o.lockReason ?? o.desc) : o.desc,
    style: {
      fontFamily: UI_FONT,
      fontSize: locked ? descSize + 1 : descSize,
      fontWeight: locked ? '700' : '400',
      letterSpacing: 0,
      fill: locked ? LOCK_TEXT : DESC_FILL,
      align: 'center',
      wordWrap: true,
      wordWrapWidth: wrapW,
      lineHeight: Math.round(descSize * 1.42),
      dropShadow: TEXT_SHADOW,
    },
  });
  bottom.anchor.set(0.5, 0);

  // 라벨 밴드 안에서 **블록 전체를 세로 중앙 정렬**한다. 고정 y 로 찍으면 설명이 두 줄인
  // 카드만 아래가 붙어 격자가 어긋나고, 남는 높이가 통째로 밑에 죽은 여백으로 남는다
  // (1차 판정 CRIT-3 이 지적한 61px 검정 여백의 형태다).
  const titleH = safeHeight(title, titleSize * 1.14);
  const descH = safeHeight(bottom, descSize * 1.42);
  const gap = Math.max(6, Math.round(h * 0.024));
  const labelH = h - bandH;
  const blockTop = bandH + Math.max(Math.round(h * 0.012), (labelH - (titleH + gap + descH)) / 2);
  title.position.set(w / 2, blockTop);
  bottom.position.set(w / 2, blockTop + titleH + gap);
  inner.addChild(title);
  inner.addChild(bottom);

  // --- 상호작용 -------------------------------------------------------------------
  // ⚠️ 이벤트는 **root 에** 걸고 hitArea 를 명시한다. 바탕 Graphics 에만 걸면 위에 얹힌
  // 텍스트가 클릭을 삼키고, 마스크 Graphics 는 히트 테스트에서 빠져 구멍이 난다.
  // 잠금 타일은 핸들러를 아예 달지 않아 호버 연출도 함께 죽는다(계약 §3) — 다만 `static` 은
  // 유지해 뒤 배경으로 이벤트가 새지 않게 막는다.
  root.eventMode = 'static';
  root.hitArea = new Rectangle(0, 0, w, h);
  root.cursor = locked ? 'default' : 'pointer';

  let hoverTarget = 0;
  let hover = 0;
  let time = phaseOf(o.title) * FLOAT_PERIOD;

  const onClick = o.onClick;
  if (!locked) {
    if (onClick !== undefined) root.on('pointertap', onClick);
    root.on('pointerover', () => {
      hoverTarget = 1;
    });
    root.on('pointerout', () => {
      hoverTarget = 0;
    });
  }

  const update = (dt: number): void => {
    const step = Math.min(Math.max(dt, 0), MAX_DT);
    time += step;

    const k = 1 - Math.exp(-HOVER_LERP * step);
    hover += (hoverTarget - hover) * k;
    // 임계값 밑은 0 으로 스냅 — 미세 잔량이 남아 알파가 영영 0 이 안 되는 것을 막는다.
    if (hover < 0.001 && hoverTarget === 0) hover = 0;

    const bob = Math.sin((time / FLOAT_PERIOD) * Math.PI * 2) * floatAmp;
    inner.y = bob - lift * hover;

    if (glow !== null) glow.alpha = 0.34 * hover;
    warm.alpha = 0.085 * hover;
    rim.alpha = 0.7 * hover;
    if (artSprite !== null) {
      const z = 1 + (ART_ZOOM - 1) * hover;
      artSprite.width = artBaseW * z;
      artSprite.height = artBaseH * z;
    }
    // 카드가 뜰수록 확산층은 **더 내려가고 옅고 넓어지고**, 접촉층은 **끊겨 사라진다** —
    // 그 둘의 차이가 높이의 신호다. (`bob` 을 더해 부유와 위상을 맞춘다. 안 맞추면 카드만
    // 떠는 것으로 보인다.)
    for (const { sprite, bake } of shadows) {
      const grow = bake.spread + bake.hoverGrow * hover;
      const drop = bake.offset + (bake.hoverOffset - bake.offset) * hover;
      sprite.width = w + grow * 2;
      sprite.height = h + grow * 2;
      sprite.position.set(-grow, -grow + drop + bob);
      sprite.alpha = bake.alpha + (bake.hoverAlpha - bake.alpha) * hover;
    }
    if (fallbackShadow !== null) {
      const drop = DIFFUSE.offset + (DIFFUSE.hoverOffset - DIFFUSE.offset) * hover;
      fallbackShadow.width = w * (1.1 + 0.06 * hover);
      fallbackShadow.height = h * 0.4;
      fallbackShadow.position.set(w / 2, h + drop + bob);
      fallbackShadow.alpha = DIFFUSE.alpha + (DIFFUSE.hoverAlpha - DIFFUSE.alpha) * hover;
    }
  };

  // 첫 프레임 전에도 정지 상태가 정확하도록 한 번 정착시킨다(update 가 안 불려도 안전).
  update(0);

  return { container: root, update };
}
