/**
 * 기지 맵 허브 화면 — 시네마틱 전환(`.omc/plans/base-screen-aaa-2026-08-02.md`).
 *
 * ## 왜 나무 패널을 걷어냈나
 * 타이틀·인트로를 풀블리드 시네마틱 키아트로 올린 뒤(PR#236·#238·#240) **기지 화면이
 * 상대적으로 아마추어로 보인다**는 사용자 판정이 나왔다. 이전 판은 평면 `COLOR.bg` 바탕에
 * 나무 nine-slice 카드 7장 + 144px 픽셀 아이콘 + 텍스트 두 줄이었다 — 깊이도 조명도 없고,
 * 픽셀 아이콘과 페인터리 키아트의 붓이 정면으로 충돌했다.
 *
 * 그래서 이 화면만 **시네마틱 언어로 전환**한다(사용자 확정, 다른 화면은 이 결과를 보고
 * 순차 롤아웃). 나무 프레임은 기지 화면에서 은퇴하고, 타이틀과 같은 붓으로 통일한다.
 *
 * ## 레이어 구조 (뒤 → 앞)
 * ```
 *   backdrop  BaseBackdrop      풀블리드 격납고 홀 + 패럴랙스 · 티끌 · 광선 · 중앙 베일
 *   tiles     CinematicTile ×7  건물 일러스트 밴드 + 금박 헤어라인 + 접지 그림자 + 호버
 *   chrome    제목 · 재화 칩 · 출격 CTA · 메타 줄
 * ```
 *
 * ## 세 모듈로 쪼갠 이유
 * 배경(`baseBackdrop`)·타일(`cinematicTile`)·크롬(`cinematicChrome`)은 **병렬 레인이 각자
 * 소유**했다. 이 파일은 조립만 한다 — 세 모듈은 서로를 import 하지 않고, 여기서만 만난다.
 * 덕분에 다른 화면으로 롤아웃할 때 타일·크롬을 그대로 재사용할 수 있다(그게 다음 단계다).
 *
 * ## 연출은 `update(dt)` 로만 산다
 * 배경 패럴랙스·타일 호버·CTA 맥동은 전부 벽시계 기반이고 **렌더 루프가 불러 줘야** 돈다
 * (`main.ts` 의 `baseMap.update(frame)`). 화면이 숨겨져 있으면 즉시 반환하므로 런 중 비용은
 * 0 이다. 배경 티어는 생성 시점 1회 판정이라(설정 오버라이드 직접 읽기) 품질 설정을 바꾸면
 * 다음 `show()` 에서 다시 만들어진다 — `render()` 가 배경을 새로 세우기 때문이다.
 *
 * 공개 인터페이스(show/hide/visible)와 콜백 타입은 DOM 판과 동일해 `main.ts` 호출부는 그대로다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다. Profile 은 읽기만 한다.
 */

import { Container, Graphics, Rectangle, Text } from 'pixi.js';
import { DAILY_STREAK_CYCLE } from '../../../data/dailyReward.js';
import { computeUnlocks, activeShip, RESEARCH_UNLOCK_LEVEL, type Profile } from '../../save/profile.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import {
  loadBaseTextures,
  baseBuildingAssetName,
  BASE_BACKDROP_NAME,
  BASE_LAUNCH_NAME,
  type BaseTextures,
} from './baseTextures.js';
import { BaseBackdrop } from './baseBackdrop.js';
import { makeGutterRibs, type GutterRibs } from './gutterRibs.js';
import { makeCinematicTile, type CinematicTile } from './cinematicTile.js';
import { makeScreenTitle, makeCinematicChip, makeHeroTile, type HeroButton } from './cinematicChrome.js';
import type { BaseMapCallbacks } from '../baseMap.js';

/** 건물 타일 정의. 일러스트는 `baseTextures` 의 이름 규약으로 파생한다(basename 하드코딩 없음). */
interface Building {
  key: 'hangar' | 'research' | 'refinery' | 'defense' | 'control' | 'archive' | 'commission';
  nameKey: MessageKey;
  descKey: MessageKey;
  /** 잠금/폴백 시 쓰는 강조색. */
  accent: number;
}

const BUILDINGS: readonly Building[] = [
  { key: 'hangar', nameKey: 'base.bld.hangar.name', descKey: 'base.bld.hangar.desc', accent: 0x4cd7ff },
  { key: 'research', nameKey: 'base.bld.research.name', descKey: 'base.bld.research.desc', accent: 0xff7a4c },
  { key: 'refinery', nameKey: 'base.bld.refinery.name', descKey: 'base.bld.refinery.desc', accent: 0xffd24c },
  { key: 'defense', nameKey: 'base.bld.defense.name', descKey: 'base.bld.defense.desc', accent: 0x8fd94c },
  { key: 'control', nameKey: 'base.bld.control.name', descKey: 'base.bld.control.desc', accent: 0xc86aff },
  // 기록 보관소(스토리 시스템 Phase C2) — 상시 개방 서사 열람 시설.
  { key: 'archive', nameKey: 'base.bld.archive.name', descKey: 'base.bld.archive.desc', accent: 0xffb24c },
  // 지시 수신소(의뢰서 시스템 Phase E) — 상시 개방(성계 지도와 별개의 PvE 출격구).
  { key: 'commission', nameKey: 'base.bld.commission.name', descKey: 'base.bld.commission.desc', accent: 0x7affea },
];

// --- 레이아웃 상수(디자인 스페이스 1920×1080) ---
/**
 * 제목 블록. `makeScreenTitle` 은 앵커 (0.5, 0) 이고 블록 높이가 약 112px 이다(제목 + 부제 +
 * 화면을 가로지르는 장식선). 재화 칩을 장식선과 같은 y 에 두면 겹치므로 **제목 줄과 같은
 * 높이**의 좌우 바깥에 둔다(Lane C 인계 제약 ①).
 */
const TITLE_Y = 26;
export const CHIP_W = 200;
export const CHIP_H = 54;
export const CHIP_Y = 52;
/** 좌우 여백. 좌상단 설정 톱니(크롬 UI, 매 프레임 최상단)를 피할 만큼은 떨어져야 한다. */
export const CHIP_MARGIN = 150;

// --- 연속 접속 칩 (AC-20 — 일일 보상 재열람 입구) ---------------------------
/**
 * ## 왜 건물이 아니라 헤더 칩인가 — 재결정 금지 (ADR-0048)
 *
 * 실측이 새 건물을 기각했다. 건물 7 + 출격 카드 = 8칸이고 `rowSplit(8) = [4,4]` 라 1행이
 * `4×424 + 3×34 = 1798` 로 {@link DESIGN_WIDTH} 1920 의 여유 끝이다. 9칸이면 `[5,4]` 가 되어
 * 1행이 `5×424 + 4×34 = 2256` — 화면을 336px 넘긴다. 세로도 못 쓴다(2행 바닥 978 + 그림자
 * 48 위에 {@link META_Y} 1036 이 이미 앉아 있다). 5칸을 넣으려면 `TILE_W ≤ 356` 으로 카드
 * 8장 전부를 16% 줄여야 하고, 그러면 AAA 비평이 잡았던 일러스트 밴드 잘림이 재발한다.
 *
 * ## 이 칩의 진짜 위험은 겹침이다
 * 헤더에는 **제목(중앙 정렬)** 과 재화 칩 둘이 이미 있다. 칩이 셋이 되는 순간
 * {@link CHIP_MARGIN} 과 제목이 가로를 다투기 시작하는데, 이 리포는 **헤더 겹침이 테스트
 * 초록으로 통과한 전례가 여러 건**이다(격납고 헤더 = 겹치면 안 되는 세로 띠 4줄). 그래서
 * 배치를 눈대중이 아니라 {@link headerSpans} 라는 **순수 구간 함수**로 뽑고,
 * `tests/baseMapDailyRewardChip.test.ts` 가 쌍마다 부등식으로 잠근다.
 */
/** 칩끼리의 최소 간격. 재화 칩과 **다른 부류**임이 보이도록 좁게 붙이지 않는다. */
export const CHIP_GAP = 24;
/**
 * 연속 접속 칩 폭. 재화 칩(200)보다 넓다 — 값이 `n/30` 두 자리 쌍인 데다 앞에 한글 문구가
 * 붙기 때문이다(EN 보다 KO 가 길다). 이 폭에서 텍스트 가용 구간은 192px 이고, 그보다 긴
 * 문구는 {@link streakChipValue} 가 숫자형으로 **축약**한다.
 */
export const STREAK_CHIP_W = 260;
/** 크레딧 칩 오른쪽. 좌상단은 시선의 시작점이고, 우측 광물 칩 안쪽에 밀어 넣으면 두 칩이 한 덩어리로 뭉쳐 "재화 셋"으로 오독된다. */
export const STREAK_CHIP_X = CHIP_MARGIN + CHIP_W + CHIP_GAP;
/**
 * 제목 ↔ 칩 최소 여백. 붙어 있지만 안 겹치는 상태는 겹친 것과 같은 결함이라(헤더는 한 줄로
 * 읽혀야 한다) 부등식에 여유를 함께 박는다.
 */
export const HEADER_CLEARANCE = 48;
/** 연속일이 아직 확정되지 않았을 때(0일) 칩 투명도 — 숨기지 않는다(재열람 입구가 사라지면 안 된다). */
const STREAK_DIM_ALPHA = 0.55;

/**
 * 타일 격자. 이전 판(430×340)보다 **키가 크다** — 일러스트 밴드가 카드 상단 60% 를 먹으므로
 * 세로가 짧으면 정사각 원본이 과하게 잘린다(Lane B 인계 제약 ③: 가로로 길수록 건물 위아래가
 * 더 잘린다). 접지 그림자가 카드 아래로 `h*0.13` 번지므로 행 간격도 그만큼 벌렸다(제약 ②).
 *
 * ⚠️ **넘침 함정(과거 실측)**: 7건물을 "1행 최대 3칸 고정"으로 분배하면 2행에 4칸이 몰려
 * `DESIGN_WIDTH` 를 넘는다. `rowSplit` 의 균등 반반이 그 재발을 막는다.
 */
export const TILE_W = 424;
/**
 * ⚠️ **세로 예산이 이 화면의 진짜 제약이다.** 1080 안에 제목 블록(112) · 타일 2행 ·
 * 출격 CTA · 메타 줄이 전부 들어가야 한다. 첫 조립에서 `TILE_H=386` 으로 잡았더니 2행이
 * y=1010 까지 내려와 **CTA 가 기록 보관소 카드 위에 겹쳤다**(실화면에서 잡았다).
 *
 * 폭은 못 줄인다 — 1행이 4칸이라 `4×424+3×34 = 1798` 이 이미 여유의 끝이다. 그래서 높이로
 * 맞춘다. 밴드가 상단 60% 라 `424×198` 짜리 슬라이스가 되는데, 이건 Lane B 가 기준으로 삼은
 * 430×340(밴드 204) 과 사실상 같은 잘림이라 건물이 여전히 읽힌다.
 */
const TILE_H = 352;
const TILE_GAP = 34;
/**
 * 1행 상단. 제목이 84px 새김으로 커지면서 헤더 블록(제목 → 부제 → 각인 장식선 → 눈금)이
 * y 26..176 을 쓴다. 거기서 **50px** 을 띄운다 — 1차 판(158)은 장식선과 격자 사이가 27px
 * 뿐이라 "헤더가 그리드에 눌려 있다"는 판정을 받았다(AAA 비평 §8).
 */
const ROW1_Y = 226;
/**
 * 행 간격. 가로 거터(34)와 맞추는 것이 리듬상 맞지만(비평 §8), 접지 그림자가 카드 아래로
 * `h*0.13`(≈41px) 번지므로 34 로 두면 아래 행 위에 그림자가 얹힌다. 그 둘의 타협점이다.
 */
const ROW_GAP = 44;
const ROW2_Y = ROW1_Y + TILE_H + ROW_GAP;
/**
 * 하단 메타. 2행 바닥(978)에 카드 그림자가 48px 번지므로 그보다 아래여야 한다 —
 * 그림자 위에 글자를 놓으면 글자가 얼룩 위에 앉는다.
 */
export const META_Y = 1036;

/**
 * 격자에 놓이는 칸 수 = 건물 7 + **출격 카드 1**.
 *
 * ## 왜 CTA 가 격자 안으로 들어왔나
 * 4+3 배치는 2행 좌우에 **227px 짜리 죽은 기둥 두 개**를 남겼다. 배경을 그 자리에서 밝혀
 * 채우려 했더니 오히려 **빈 배경이 카드보다 밝아지는 도-지 반전**이 났다(AAA 비평 2라운드
 * N2·N3 — "가장 밝은 화소가 아무것도 없는 좌하단 배경"). 조명 문제가 아니라 레이아웃
 * 문제였다.
 *
 * 4+4 로 채우고 8번째 칸을 출격 카드로 만들면 결함 셋이 한꺼번에 사라진다:
 *  ① 죽은 기둥 소멸 ② CTA 가 격자 안에서 가장 밝은 것이 됨 ③ 하단 CTA 막대가 없어져 남는
 *  세로 여유로 카드 높이를 314 → 372 로 키울 수 있고, 그 덕에 건물 잘림도 함께 풀린다.
 */
const CELLS = BUILDINGS.length + 1;

/**
 * 2행 분배(각 행 칸 수). **균등 반반**이 계약이다 — 남는 칸을 전부 둘째 행에 몰면(옛
 * "1행 최대 3칸 고정") 칸 수가 홀수로 늘 때 둘째 행이 더 커져 넘침이 재발한다.
 */
export function rowSplit(n: number): readonly [number, number] {
  const row0 = Math.ceil(n / 2);
  return [row0, n - row0];
}

/** i 번째 칸의 좌상단(2행 배치, 각 행 가운데 정렬). 마지막 칸이 출격 카드다. */
export function tilePosition(i: number): { x: number; y: number } {
  const [cols0, cols1] = rowSplit(CELLS);
  const row = i < cols0 ? 0 : 1;
  const cols = row === 0 ? cols0 : cols1;
  const col = row === 0 ? i : i - cols0;
  const rowW = cols * TILE_W + (cols - 1) * TILE_GAP;
  const x0 = (DESIGN_WIDTH - rowW) / 2;
  return { x: x0 + col * (TILE_W + TILE_GAP), y: row === 0 ? ROW1_Y : ROW2_Y };
}

/**
 * 배경 베일이 눌러야 할 사각형 — **격자에서 파생한다.**
 *
 * 배경은 이 사각형 **안쪽만** 어둡게 눌러 타일 대비를 만들고, 바깥(특히 2행 좌우의 넓은
 * 알코브)은 거의 누르지 않아 장소가 비친다. 좌표를 배경 모듈에 하드코딩해 두면 여기 격자를
 * 바꿀 때 조용히 어긋나므로(실제로 Lane A 가 그렇게 인계했다) 격자 상수에서 계산해 넘긴다.
 */
export function veilRects(): readonly { x0: number; y0: number; x1: number; y1: number }[] {
  const [cols0, cols1] = rowSplit(CELLS);
  const a = rowSpan(cols0);
  const b = rowSpan(cols1);
  return [
    { x0: a.x0, y0: ROW1_Y, x1: a.x1, y1: ROW1_Y + TILE_H },
    { x0: b.x0, y0: ROW2_Y, x1: b.x1, y1: ROW2_Y + TILE_H },
  ];
}

/** 한 행(칸 `cols` 개)이 차지하는 x 구간. 행 가운데 정렬. */
function rowSpan(cols: number): { x0: number; x1: number } {
  const w = cols * TILE_W + (cols - 1) * TILE_GAP;
  const x0 = (DESIGN_WIDTH - w) / 2;
  return { x0, x1: x0 + w };
}

/**
 * 거터에 세우는 석재 리브 — **격자에서 파생한다.**
 *
 * ## 왜 배경이 아니라 크롬이 거터를 그리는가
 * 4라운드까지 거터의 어둠은 배경 원화에 맡겨져 있었다. 그런데 원화에는 밝은 세로 대역이
 * **있었고**, 그게 하필 카드 뒤에 깔리고 어두운 대역이 거터에 깔렸다 — 원화의 주기와 격자의
 * 주기(458px)가 안 맞았던 것이다. 그 결과 배경이 가로로는 밝고(47) 세로로는 어두워(24~32)
 * 격자 뒤에 **가로 줄무늬**가 생겼다(AAA 비평 4라운드 실측).
 *
 * 증폭으로는 못 푼다. AAA 허브가 실제로 쓰는 방식은 원화 위에 격자를 얹는 것이 아니라
 * **격자를 담는 크롬을 그리고 그 뒤에 원화를 두는 것**이다. 리브가 있으면 어떤 배경을 끼워도
 * 거터 주기가 격자 주기와 영구히 일치한다 — 배경 재생성의 성패에 화면이 걸리지 않는다.
 */
export function ribLines(): readonly { x: number; y0: number; y1: number }[] {
  const [cols0] = rowSplit(CELLS);
  const { x0 } = rowSpan(cols0);
  const y0 = ROW1_Y;
  const y1 = ROW2_Y + TILE_H;
  const out: { x: number; y0: number; y1: number }[] = [];
  /**
   * 칸 **경계마다** 하나 — 안쪽 거터뿐 아니라 **격자 양 바깥에도** 세운다.
   *
   * 처음엔 안쪽 3개만 세웠다. 그랬더니 거터는 균일해졌는데(편차 1.4) **좌·우 여백**이 배경
   * 원화 그대로라 밴드 사이 휘도 스프레드가 24.6 으로 남았다(AAA 비평 5라운드 N1). 배경
   * 조명 보정으로 그 띠를 맞추려는 시도는 실패했다 — 정규화 커널이 띠(24~44px)보다 넓으면
   * 띠를 이웃과 함께 움직이고, 좁으면 매크로 구조가 무너진다(둘 다 실측으로 확인).
   *
   * 거터를 푼 원리를 여백에 그대로 적용하는 것이 답이다: **크롬이 직접 그린다.** 그러면
   * 리브가 `44 · 502 · 960 · 1418 · 1876` 으로 **피치 458 에 정확히 등간격**이 되어, 4개 칸이
   * 5개 기둥 사이의 베이(bay)에 앉은 콜로네이드가 된다. 스프레드는 보정이 아니라 **구성으로**
   * 사라진다.
   */
  for (let i = 0; i <= cols0; i++) {
    out.push({ x: x0 + i * (TILE_W + TILE_GAP) - TILE_GAP / 2, y0, y1 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 헤더 가로 구간 — 겹침을 부등식으로 잠그기 위한 순수 함수
// ---------------------------------------------------------------------------

/** 헤더 요소 하나가 차지하는 x 구간(좌 포함, 우 배타). */
export interface HeaderSpan {
  readonly key: 'credits' | 'streak' | 'title' | 'minerals';
  readonly x0: number;
  readonly x1: number;
}

/**
 * 헤더 요소들의 x 구간. **칩은 상수에서, 제목은 실측 폭에서** 나온다.
 *
 * ⚠️ 제목 폭을 상수로 가정하지 않는 것이 요점이다. `makeScreenTitle` 의 `fitWidth` 상한
 * (`TITLE_MAX_W = 1000`)을 그대로 쓰면 제목 구간이 `[460, 1460]` 이 되어 칩을 놓을 자리가
 * 좌우 110px 씩밖에 안 남는다 — 칩(200·260)이 들어갈 수 없는 폭이다. 실제 제목은 `기지`
 * (2글자) · `Base`(4글자)라 200~260px 이고, 그 **실측**이 배치의 근거다. 그래서 문구가
 * 길어지면 이 계약이 깨져야 하고, 테스트가 두 로케일의 실측 폭으로 그것을 잡는다.
 *
 * @param titleWidth 제목 텍스트의 실측 폭(px, 디자인 스페이스).
 * @param streakShown 연속 접속 칩을 세우는가(콜백이 없으면 안 세운다).
 */
export function headerSpans(titleWidth: number, streakShown: boolean): readonly HeaderSpan[] {
  const half = Math.max(0, titleWidth) / 2;
  const out: HeaderSpan[] = [
    { key: 'credits', x0: CHIP_MARGIN, x1: CHIP_MARGIN + CHIP_W },
    { key: 'title', x0: DESIGN_WIDTH / 2 - half, x1: DESIGN_WIDTH / 2 + half },
    { key: 'minerals', x0: DESIGN_WIDTH - CHIP_MARGIN - CHIP_W, x1: DESIGN_WIDTH - CHIP_MARGIN },
  ];
  if (streakShown) out.push({ key: 'streak', x0: STREAK_CHIP_X, x1: STREAK_CHIP_X + STREAK_CHIP_W });
  return out;
}

/**
 * 칩들 사이에 남는 **제목 최대 폭**. 제목은 화면 중앙 대칭이라 좌우 중 좁은 쪽이 정한다.
 *
 * 칩을 세운 상태의 값이 계약이다 — 칩을 숨겼을 때 더 넓어지는 것은 덤이고, 그 여유에
 * 기대어 제목을 늘리면 칩이 돌아오는 순간 겹친다.
 */
export function maxTitleWidth(streakShown: boolean): number {
  const leftEnd = streakShown ? STREAK_CHIP_X + STREAK_CHIP_W : CHIP_MARGIN + CHIP_W;
  const rightStart = DESIGN_WIDTH - CHIP_MARGIN - CHIP_W;
  const half = Math.min(DESIGN_WIDTH / 2 - leftEnd, rightStart - DESIGN_WIDTH / 2) - HEADER_CLEARANCE;
  return Math.max(0, half * 2);
}

// ---------------------------------------------------------------------------
// 연속 접속 칩 문구 — 캔버스 없이 판정 가능한 상한 근사
// ---------------------------------------------------------------------------

/**
 * 칩 값 글자 크기. ⚠️ `cinematicChrome.makeCinematicChip` 의 `Math.round(h * 0.46)` 을
 * **미러**한다 — 그쪽이 바뀌면 여기 예산이 조용히 틀어진다.
 */
const STREAK_TEXT_SIZE = Math.round(CHIP_H * 0.46);
/**
 * 칩 안에서 값 텍스트가 쓸 수 있는 가로 구간. 역시 `makeCinematicChip` 의 산술 미러다:
 * `CHIP_PAD(12) + iconSize(h-18=36) + 8` 부터 `w - CHIP_PAD(12)` 까지.
 */
const STREAK_TEXT_AVAIL = STREAK_CHIP_W - 12 - (CHIP_H - 18) - 8 - 12;
/**
 * 문구 길이 예산. `fitWidth` 는 **0.6 배까지만** 줄인다 — 실측이 `가용폭 / 0.6` 을 넘으면
 * 축소로도 못 담고 그대로 칩 밖으로 넘친다(그 함수의 `Math.max(min, max/measured)` 때문).
 * 그래서 넘칠 문구는 그리기 전에 숫자형으로 갈아 끼운다. 상한에서 조금 물러난 값이다 —
 * {@link estimateChipTextWidth} 는 근사라 여유가 있어야 한다.
 */
const STREAK_TEXT_BUDGET = Math.floor((STREAK_TEXT_AVAIL / 0.6) * 0.94);

/**
 * 한글·한자·가나 등 **전각 폭 1em** 으로 나아가는 글자. 나머지는 0.62em 으로 잡는다.
 * 둘 다 실제 어드밴스의 **상한**이다 — 겹침·넘침 판정은 상한으로만 안전하다(하한을 쓰면
 * 통과해 놓고 화면에서 넘친다).
 */
const FULL_WIDTH_RE =
  /[ᄀ-ᇿ⺀-꓏ꥠ-꥿가-퟿豈-﫿︰-﹏＀-｠￠-￦]/u;

/**
 * 칩 값 텍스트 폭의 **상한 근사**(px). 캔버스가 없는 환경(vitest/SSR)에서도 판정할 수 있어야
 * 하므로 측정이 아니라 글자 분류로 센다 — 실제 폰트 메트릭을 읽지 않는 대신 절대 과소평가하지
 * 않는 쪽으로 기운다.
 */
export function estimateChipTextWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += FULL_WIDTH_RE.test(ch) ? STREAK_TEXT_SIZE : STREAK_TEXT_SIZE * 0.62;
  return w;
}

/**
 * 칩에 적을 값 문자열.
 *
 * `label` 은 **호출자가 i18n 으로 완성해 넘긴 문구**다(이 레인은 카탈로그를 만지지 않는다 —
 * 키 추가는 별도 레인). 없거나 예산을 넘으면 `n/주기` 숫자형으로 축약한다. 좁은 칩의 축약은
 * 카탈로그 §두 가지 예외 정책이 허용하는 경로다.
 *
 * 연속일이 0(오프라인·아직 확정 전)이면 숫자 자리를 `-` 로 둔다. `0/30` 으로 적으면 "연속이
 * 끊겼다"는 **틀린 사실**을 단언하게 된다 — 모르는 것과 0인 것은 다르다.
 */
export function streakChipValue(label: string | undefined, streak: number, cycle: number): string {
  const numeric = `${streak > 0 ? String(streak) : '-'}/${cycle}`;
  if (label === undefined || label.length === 0) return numeric;
  return estimateChipTextWidth(label) <= STREAK_TEXT_BUDGET ? label : numeric;
}

/**
 * `show()` 의 선택 인자 — 일일 보상(ADR-0048) 배선. **전부 선택**이라 기존 호출부는 그대로다.
 *
 * `onDailyReward` 가 없으면 칩 자체를 세우지 않는다. "갈 곳이 없으면 입구를 만들지 않는다"가
 * 가시성 규칙이고, 그래서 화면이 모달 모듈을 import 하지 않는다(배선은 `main.ts` 몫).
 */
export interface BaseMapShowOptions {
  /** 현재 연속 접속일. 0/미지정 = 아직 확정되지 않음 → 칩이 흐려지고 값이 `-` 가 된다. */
  readonly dailyStreak?: number;
  /** 주기. 미지정이면 {@link DAILY_STREAK_CYCLE}(30). */
  readonly dailyCycle?: number;
  /** 칩에 적을 완성된 문구. 미지정·과길이면 `n/주기` 로 축약된다. */
  readonly dailyLabel?: string;
  /** 칩 클릭 → 일일 보상 모달 재열람(AC-20). 없으면 칩을 세우지 않는다. */
  readonly onDailyReward?: () => void;
}

export class BaseMapScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private ui: UiTextures = {};
  private art: BaseTextures = {};
  private profile: Profile | null = null;
  private cb: BaseMapCallbacks | null = null;
  /** 일일 보상 배선. `render()` 가 자산 로드 완료 때 다시 불리므로 인스턴스에 남긴다. */
  private opts: BaseMapShowOptions = {};

  /** 연출을 가진 것들 — `update(dt)` 가 매 프레임 이 셋만 돌린다. */
  private backdrop: BaseBackdrop | null = null;
  private ribs: GutterRibs | null = null;
  private tiles: CinematicTile[] = [];
  private hero: HeroButton | null = null;

  constructor(stage: Container) {
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    // 자산 비동기 로드 — 완료 후 열려 있으면 실 아트로 다시 그린다(그 전엔 절차적 폴백).
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      if (this.root.visible) this.render();
    });
    void loadBaseTextures().then((tex) => {
      this.art = tex;
      if (this.root.visible) this.render();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  show(profile: Profile, cb: BaseMapCallbacks, opts: BaseMapShowOptions = {}): void {
    this.profile = profile;
    this.cb = cb;
    this.opts = opts;
    this.render();
    this.root.visible = true;
    // DOM HUD(HP/LV, 좌하단)는 런 전용 — 캔버스 메타 화면 위에 떠 보이므로 숨긴다.
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = 'hidden';
  }

  hide(): void {
    this.root.visible = false;
    this.cb = null;
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = '';
  }

  /**
   * 매 프레임 연출 진행(`main.ts` 렌더 루프). `dt` 는 **벽시계 초**다. 화면이 숨겨져 있으면
   * 아무것도 하지 않는다 — 기지 밖에서는 비용이 0 이다.
   */
  update(dt: number): void {
    if (!this.root.visible) return;
    this.backdrop?.update(dt);
    for (const tile of this.tiles) tile.update(dt);
    this.hero?.update(dt);
  }

  /** 건물 잠금 사유(해금이면 null). DOM 판 `lockReason` 과 동일 규칙. */
  private lockReason(key: Building['key'], profile: Profile): string | null {
    const u = computeUnlocks(profile);
    switch (key) {
      case 'hangar':
        return u.hangar ? null : t('base.lock.pre');
      case 'research':
        return u.research ? null : t('base.lock.level', { lvl: RESEARCH_UNLOCK_LEVEL });
      case 'refinery':
        return u.refinery ? null : t('base.lock.clear');
      case 'defense':
        return u.defenseCommand ? null : t('base.lock.clear');
      case 'control':
        // 관제탑(침공·래더) — 방어 사령부와 동일 해금 조건(행성 1회 클리어).
        return u.defenseCommand ? null : t('base.lock.clear');
      case 'archive':
        // 기록 보관소 — 서사 열람 시설이라 상시 개방(잠금 없음).
        return null;
      case 'commission':
        // 지시 수신소 — 의뢰서는 보스 처치로만 발령되므로 시설 자체는 상시 개방(잠금 없음).
        return null;
      default:
        return null;
    }
  }

  private enter(key: Building['key']): void {
    const cb = this.cb;
    if (cb === null) return;
    switch (key) {
      case 'hangar':
        cb.onHangar();
        break;
      case 'research':
        cb.onResearch();
        break;
      case 'refinery':
        cb.onRefinery();
        break;
      case 'defense':
        cb.onDefense();
        break;
      case 'control':
        cb.onControl();
        break;
      case 'archive':
        cb.onArchive();
        break;
      case 'commission':
        cb.onCommission();
        break;
    }
  }

  // --- 렌더 ----------------------------------------------------------------

  private render(): void {
    // 연출 참조를 먼저 끊는다 — destroy 된 컨테이너를 update 가 만지면 안 된다.
    this.backdrop?.destroy();
    this.backdrop = null;
    this.ribs?.destroy();
    this.ribs = null;
    this.tiles = [];
    this.hero = null;
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }
    const profile = this.profile;
    if (profile === null) return;

    // 바닥 — 배경 자산이 없거나 실패해도 화면이 비지 않게. 이벤트도 여기서 막는다.
    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static';
    this.root.addChild(bg);

    // --- 배경(격납고 홀 + 공기 + 중앙 베일) ---
    const backdrop = new BaseBackdrop(this.art[BASE_BACKDROP_NAME], { veilRects: veilRects() });
    this.root.addChild(backdrop.view);
    this.backdrop = backdrop;

    // --- 거터 석재 리브 --- 배경(비네트·하단 스크림 포함) **위**, 카드 **아래**.
    // 스크림 밑에 넣으면 기초의 대비가 감쇠에 먹힌다(Lane D 인계 제약 ①).
    const ribs = makeGutterRibs(ribLines());
    this.root.addChild(ribs.view);
    this.ribs = ribs;

    this.renderTitleBar(profile);
    BUILDINGS.forEach((b, i) => this.renderBuilding(b, i, profile));
    this.renderLaunch();
    this.renderMeta(profile);
  }

  private renderTitleBar(profile: Profile): void {
    // 부제(`base.sub` — "건물을 선택해 정비하거나…")는 **넘긴다**(사용자 지시 2026-08-04).
    // 카드 8장이 각자 제목+설명을 달고 있어 그 한 줄이 알려 주는 것이 화면에 이미 다 있었고,
    // 헤더가 두 줄이면 제목 각인의 무게가 그만큼 깎인다. `makeScreenTitle` 은 빈 문자열이면
    // 부제 블록 자체를 세우지 않는다(그쪽 `subtitle.length > 0` 가드) — 여백도 남지 않는다.
    // 카탈로그 키는 DOM 판(`src/ui/baseMap.ts`)이 아직 쓰므로 지우지 않는다.
    const title = makeScreenTitle(t('base.title'), '');
    title.position.set(DESIGN_WIDTH / 2, TITLE_Y);
    this.root.addChild(title);

    const credits = makeCinematicChip(
      CHIP_W,
      CHIP_H,
      String(profile.credits),
      this.ui['ui_icon_coin.png'] ?? undefined,
      'gold',
    );
    credits.position.set(CHIP_MARGIN, CHIP_Y);
    this.root.addChild(credits);

    const minerals = makeCinematicChip(
      CHIP_W,
      CHIP_H,
      String(profile.minerals),
      this.ui['ui_icon_crystal.png'] ?? undefined,
      'teal',
    );
    minerals.position.set(DESIGN_WIDTH - CHIP_MARGIN - CHIP_W, CHIP_Y);
    this.root.addChild(minerals);

    this.renderStreakChip();
  }

  /**
   * 연속 접속 칩 — 일일 보상 모달 재열람 입구(AC-20).
   *
   * ## 아이콘을 반드시 넘긴다
   * `makeCinematicChip` 은 아이콘이 없으면 tone 에 따라 **금화 / 청록 결정**을 절차적으로
   * 그린다. 그대로 두면 세 번째 칩이 "재화 하나 더"로 읽혀 이 칩의 의미가 통째로 사라진다.
   * 체크 표식을 쓰는 이유는 서사와 맞기 때문이다 — 수령은 행위가 아니라 시점이고(CONTEXT
   * §일일 보상), 화면은 **이미 받은 것을 통지**한다.
   *
   * ## 연출은 알파만
   * 호버에 스케일을 주지 않는다. 서브픽셀 부유가 1px 테두리를 매 프레임 리샘플해 "테두리가
   * 번쩍인다"는 신고가 된 전례가 있다(`cinematicChrome.TILE_FLOAT_RATIO` 주석).
   */
  private renderStreakChip(): void {
    const open = this.opts.onDailyReward;
    if (open === undefined) return;

    const cycle = this.opts.dailyCycle ?? DAILY_STREAK_CYCLE;
    const raw = this.opts.dailyStreak ?? 0;
    const streak = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;

    const chip = makeCinematicChip(
      STREAK_CHIP_W,
      CHIP_H,
      streakChipValue(this.opts.dailyLabel, streak, cycle),
      this.ui['ui_icon_check.png'] ?? undefined,
      'gold',
    );
    // 좌표는 정수다 — 반픽셀 부유가 테두리 번쩍임을 만든 전례가 있다.
    chip.position.set(STREAK_CHIP_X, CHIP_Y);

    const base = streak > 0 ? 1 : STREAK_DIM_ALPHA;
    chip.alpha = base;
    chip.eventMode = 'static';
    chip.cursor = 'pointer';
    // 고정 hitArea — 자식 알파가 흔들려도 클릭 판정이 따라 흔들리지 않는다.
    chip.hitArea = new Rectangle(0, 0, STREAK_CHIP_W, CHIP_H);
    chip.on('pointertap', () => open());
    chip.on('pointerover', () => (chip.alpha = Math.min(1, base + 0.2)));
    chip.on('pointerout', () => (chip.alpha = base));
    this.root.addChild(chip);
  }

  private renderBuilding(b: Building, i: number, profile: Profile): void {
    const { x: px, y: py } = tilePosition(i);
    const reason = this.lockReason(b.key, profile);
    const locked = reason !== null;

    const tile = makeCinematicTile({
      width: TILE_W,
      height: TILE_H,
      art: this.art[baseBuildingAssetName(b.key)],
      accent: b.accent,
      title: t(b.nameKey),
      desc: t(b.descKey),
      locked,
      lockReason: reason,
      // 잠금 타일은 클릭 자체를 달지 않아 호버 연출도 함께 꺼진다(DOM 판과 동일).
      ...(locked ? {} : { onClick: () => this.enter(b.key) }),
    });
    tile.container.position.set(px, py);
    this.root.addChild(tile.container);
    this.tiles.push(tile);
  }

  /** 출격 카드 — 격자의 마지막 칸(8번째). 건물 타일과 같은 골격, 다른 무게. */
  private renderLaunch(): void {
    const { x, y } = tilePosition(CELLS - 1);
    // ⚠️ 아트를 안 넘기면 **조용히 절차적 엠블럼 폴백**으로 떨어진다(어두운 판). 이 리포가
    // 반복해서 밟은 "배선이 없는데 테스트는 그린" 유형이라, 화면으로 확인한 뒤에 닫는다.
    const hero = makeHeroTile(
      TILE_W,
      TILE_H,
      t('base.launch'),
      t('base.launchSub'),
      () => this.cb?.onStarMap(),
      this.art[BASE_LAUNCH_NAME],
    );
    hero.container.position.set(x, y);
    this.root.addChild(hero.container);
    this.hero = hero;
  }

  private renderMeta(profile: Profile): void {
    const ship = activeShip(profile);
    const meta = new Text({
      resolution: 2,
      // 크레딧·광물은 상단 칩이 이미 보여 준다 — 같은 화면에서 두 번 적으면 디버그
      // 텍스트로 읽힌다(AAA 비평 지적). `meta.line` 대신 짧은 전용 키를 쓴다.
      text: t('base.metaShort', { lv: ship.level, sp: profile.skillPoints }),
      style: {
        fontFamily: UI_FONT,
        fontSize: 20,
        // `COLOR.muted`(#aa9b87)는 이 자리의 청록 바닥(L 29~45) 위에서 대비 4.83:1 로
        // WCAG AA(4.5)를 겨우 넘고 카드 부제(6.29:1)보다 흐리다 — 같은 화면에서 더 작은
        // 글자가 더 흐린 것은 위계가 아니라 결함이다(AAA 비평 5라운드 N7).
        fill: 0xc6bba6,
        dropShadow: TEXT_SHADOW,
      },
    });
    meta.anchor.set(0.5, 0);
    meta.position.set(DESIGN_WIDTH / 2, META_Y);
    this.root.addChild(meta);
  }
}
