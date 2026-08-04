/**
 * 성계 지도 — 정규 PvE 출격구 (2026-08-03 AAA 시네마틱 전환)
 * · 레인 계약 `.omc/plans/star-map-aaa-2026-08-03.md`.
 *
 * 기지 맵에서 진입하는 전체 화면(`main.ts:1246 openStarMap()`). **suspend/resume 은 없다** —
 * `show({meta, bestStageCleared, onLaunch, onInventory, onBack, fetchCatalystInventory})` /
 * `hide()` 규약이고, `LaunchSelection` 은 DOM 판(`src/ui/planetSelect.ts`)과 공유하는 타입이다.
 * **공개 인터페이스는 한 줄도 바뀌지 않았다.**
 * ⚠️ `main.ts` 는 `hide()` 를 하네스 goto 스위치를 포함해 여러 경로에서 부른다 — **멱등**이다.
 *
 * ---------------------------------------------------------------------------
 * ## 출격 계약 (전환 전과 동일 — 손대지 않았다)
 * `onLaunch(sel)` → `beginSortie(seed, sel)` → 촉매가 있으면 `consume_catalysts` → `startRun`
 * 이 `buildRunConfig` **단일 정본**을 쓴다. 이 파일은 `sel` 만 만든다:
 * `{planet, stage, ...(촉매 있으면 catalysts)}`. 여기서 config 를 손대면
 * `tests/shipIntegration.test.ts` 의 grep 게이트가 잡는다.
 * 모든 단계 이동은 예외 없이 {@link clampStageTo} 한 지점을 지난다(ADR-0022).
 *
 * ---------------------------------------------------------------------------
 * ## ⚠️ 왜 여기는 **창을 뚫는가** (형제 화면 일곱은 뚫었다 뺐다)
 * 기각의 근거는 언제나 **해상도**였다 — 촉매 보관함·기록 보관소·지시 수신소의 후보는
 * `assets/ui_planet_*.png` 64×64 오브뿐이라 개구부를 채우면 17배 확대였다. 여기 후보는 다르다:
 *
 * | 후보 | 실측 | 판정 |
 * | --- | --- | --- |
 * | `ui_planet_0..3.png` | 64×64 · 행성 6종 중 **4종만** | ✗ (형제들이 기각한 그것) |
 * | `textures.background[i]` | **절차 생성** 256×256(단색 + 균열 3줄 + 잉걸 8점) | ✗ 화면에서 가장 정보가 없는 면 |
 * | `assets/tilesets/<planet>.png` | 128×256 아틀라스 = 32px wang 타일 16종 · **6종 전부** | ✅ |
 *
 * wang 타일셋은 **런에서 실제로 바닥에 깔리는 그 그림**이고({@link AutotileBackground} 가 32px
 * 소스를 64px 로 그린다 — 게임 안과 **같은 배율**, 확대가 없다), 행성 6종 전부가 갖고 있으며,
 * **행성을 바꾸면 창이 바뀐다.** 창이 "배경이 보이는 구멍"이 아니라 **결정을 돕는 자리**여야
 * 한다는 형제 화면 열의 조건을 그대로 만족한다 — 여기가 곧 "이 행성이 어떻게 생겼나"다.
 *
 * 구현 규율(방어 사령부에서 실측으로 얻은 것):
 *  - 내용물은 `box` 가 아니라 **{@link cinematicWindowOpening}** 을 채운다(`box` 에 맞췄더니
 *    프레임과 그림 사이에 위 16px·좌우·아래 17px 맨 배경 띠가 둘러 생겼다 — 사용자 신고).
 *  - 내용물은 **창 패널 바로 뒤**에 둔다. 앞에 두면 석재 단면·안쪽 AO·유리 반사·바닥 스크림을
 *    통째로 가려 개구부가 "유리창"이 아니라 그냥 검은 사각이 된다.
 *  - 배경 `windows` 는 **정확히 그 개구부**다(어긋나면 밝기 보존이 헛돈다).
 *
 * ## 카드 그리드를 버리고 **2열 + 오른쪽 세로 분할**로 갔다
 * 옛 구현은 460×404 카드 6장을 가로로 늘어놓았다. 카드가 정보를 편 것이 아니라 오브 하나 +
 * 이름 + 부제 + 배율 한 줄을 404px 높이에 띄엄띄엄 흘린 것이라, 카드 안 세로가 절반 이상 비었다
 * (이 파일에 `CARD_SUB_MAX_BOTTOM` 같은 "겹치지 않게 띄우는" 상수가 쌓여 있던 것 자체가 증상).
 * 이제 목록 행은 얇은 고정 높이고, 오른쪽이 **행을 바꿀 때마다 바뀌는 자리**다(위=전장 창,
 * 아래=출격 제원). 격납고 선례 "밀도 높은 화면은 카드가 아니라 창을 뚫어라"와 같은 처방이다.
 *
 * ## 재화 칩은 두지 않는다
 * 촉매 주입이 소모하는 것은 **촉매 아이템**(`consume_catalysts`)이지 크레딧·광물이 아니고
 * 출격은 무료다. 다만 `show({meta})` 가 넘기는 상태 줄은 **계약이라 반드시 표시한다** — 하단
 * 액션 띠 왼쪽 첫 줄이 받는다.
 *
 * ## 여기서 밟기 쉬운 함정 (전부 실측 근거)
 * - ⚠️ **크롬(헤더·하단 띠)은 패널보다 뒤에 붙인다.** 석재 패널은 접지 그림자를 텍스처에 구워
 *   자기 사각보다 30px 가까이 번지고, Pixi v8 은 자식을 역순으로 훑다가 픽셀에 걸리면 거기서
 *   멈춘다 — 그림자가 passive 여도 탐색은 끝난다(방어 사령부 실제 신고).
 * - ⚠️ **`setEnabled(false)` + `gold` 톤 금지.** container alpha 0.4 + 어두운 갈색 라벨 +
 *   그림자 꺼짐이 겹쳐 글자가 통째로 사라진다. 비활성은 크림 라벨인 `stone` 이다.
 * - ⚠️ **`PixiButton` 의 `pointerout` 이 `container.alpha` 를 1 로 되돌린다** — 흐림은 버튼
 *   container 가 아니라 감싸는 host 에 건다.
 * - **행 클릭은 행 Container 에**(바탕 Graphics 에 걸면 위 텍스트가 삼킨다).
 * - **휠은 클립 Container 에**(마스크 Graphics 는 히트 테스트에서 제외된다).
 * - 컬러 이모지 금지(`text.ts` stripEmoji). `★ ✕ ▶ ◀ ≪ ≫` 는 보존 목록.
 * - ⚠️ `hudEl()` 에는 **캔버스 가드를 붙이지 않는다**(HUD 숨김이 통째로 죽는다).
 * - ⚠️ 좌상단 x<120 · y<120 은 **설정 톱니 예약 밴드**다.
 * - ⚠️ 각인 제목은 중앙 정렬 Text 라 사각형이 없어 겹침 테스트가 못 잡는다 —
 *   {@link TITLE_BAND_HALF_W} 로 대역을 못 박는다.
 *
 * ## 재렌더 규율
 * 옛 구현은 `render()` 가 루트를 통째로 지우고 다시 그렸다 — 카드 한 번, 단계 한 칸마다 배경과
 * 석재 패널이 다시 **구워진다**. 그래서
 *  - `buildChrome()` 은 1회(자산 도착 시에만 재건),
 *  - `renderList()`/`renderOps()`/`syncValues()` 가 각자 host 안만 갈아끼우고,
 *  - `syncArena()` 는 **행성이 바뀔 때만** 타일셋을 교체하며,
 *  - `update(dt)` 는 `main.ts` 가 매 프레임 부른다(`planetSelect.update(frame)`). 숨겨져 있으면
 *    즉시 반환하므로 이 화면 밖 비용은 0 이다. ⚠️ 연구소가 이 배선을 빠뜨려 배경·패널 연출이
 *    통째로 멈춘 적이 있다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { PLANETS, planetById, type PlanetMeta } from '../../../data/planets.js';
import { stageOpenCap } from '../../../data/waves.js';
import { multCentiFor } from '../../net/planetMultipliers.js';
import { NEUTRAL_MULT_CENTI } from '../../economy/planetPopularity.js';
import { catalystById, normalizeCatalystArray, SLOT_CAP } from '../../data/catalysts.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { AutotileBackground, loadWangTiles, upperAt, type WangTiles } from '../../render/autotile.js';
import type { LaunchSelection, BestStageClearedFn } from '../planetSelect.js';
import {
  planetReconRoster,
  reconCaption,
  reconUnitLabel,
  type ReconUnit,
} from '../enemyLabels.js';
import type { CatalystInventory } from '../../net/index.js';
import { COLOR, UI_FONT, TEXT_SHADOW, hexColor } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { PixiButton } from './button.js';
import { stripEmoji } from './text.js';
import { attachRowClick } from './listRow.js';
import { makeScrollArea, rowBounds } from './scrollArea.js';
import { loadHangarTextures, HANGAR_BACKDROP_NAME, type HangarTextures } from './hangarTextures.js';
import { HangarBackdrop } from './hangarBackdrop.js';
import { makeCinematicPanel, cinematicWindowOpening, type CinematicPanel } from './cinematicPanel.js';
import {
  makeHangarTitle,
  cinematicButtonTexture,
  chromeFallbackColor,
  chromeLabelColor,
  type ChromeTone,
} from './hangarChrome.js';
import { CatalystPicker } from './catalystPicker.js';

export type { LaunchSelection };

// ===========================================================================
// 레이아웃(디자인 스페이스 1920×1080) — Pixi 없이 검증되는 순수 서술
//
// 여백 어휘(32 / 28 / 20 / 하단 28)와 헤더 높이 104 는 격납고·연구소·정제소·방어 사령부·
// 관제탑·기록 보관소·지시 수신소와 **같은 값**이다.
// ===========================================================================

/**
 * `cinematicPanel.ts` 콘텐츠 상자 기하의 **복제본**(출처: 그 파일의 `EDGE_PAD 24` ·
 * `CONTENT_GAP 16` · `TITLE_BAND_H = round(TITLE_SIZE 26 × 2)`).
 *
 * 왜 베끼는가: 좌표 서술이 **Pixi 없이** 검증돼야 하는데 패널 상자는 런타임 객체다. 베낀 값이
 * 조용히 어긋나면 내용이 패널 테두리를 뚫는데 예외도 로그도 없다 —
 * `tests/planetSelectAaaLayout.test.ts` 가 실제 `makeCinematicPanel(...).box` 와 대조한다.
 */
export const PANEL_EDGE_PAD = 24;
export const PANEL_TITLE_BAND_H = 52;
export const PANEL_CONTENT_GAP = 16;
/** 제목 띠가 있는 패널의 콘텐츠 상자 로컬 y. */
const TITLED_BOX_Y = PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP;

/** 헤더 밴드 높이 — 배경이 그대로 보이는 자리. 각인 석재 인방은 얹지 않는다(사용자 확정). */
const HEADER_H = 104;
/** 헤더 컨트롤의 세로 띠 — 전부 이 하나를 쓴다(격납고 헤더 겹침 결함 이력). */
const HEAD_Y = 26;
const HEAD_H = 52;
const EDGE_X = 32;
const GUTTER_X = 28;
const STACK_GAP_Y = 20;
const BOTTOM_PAD = 28;

/**
 * 좌상단 예약 밴드 — `main.ts` SettingsScreen 의 설정 톱니가 쓰는 **전 화면 공용 자리**다.
 * 톱니는 매 프레임 stage 최상위로 올라오므로 여기에 컨트롤을 두면 통째로 클릭 불가가 된다.
 * ⚠️ {@link PANEL_Y} 가 이 값에서 파생되므로 **선언 순서를 바꾸지 마라**(TDZ).
 */
export const GEAR_BAND_W = 120;
export const GEAR_BAND_H = 120;

const CONTENT_W = DESIGN_WIDTH - EDGE_X * 2;

/** 하단 액션 띠 — 오른쪽에 [장비 정비][출격], 왼쪽은 상태 두 줄이 쓴다(빈 자리 0). */
const FOOT_H = 64;
const FOOT_Y = DESIGN_HEIGHT - BOTTOM_PAD - FOOT_H;
const LAUNCH_W = 360;
const LAUNCH_X = EDGE_X + CONTENT_W - LAUNCH_W;
const INV_W = 220;
const FOOT_BTN_GAP = 16;
const INV_X = LAUNCH_X - FOOT_BTN_GAP - INV_W;

/**
 * 패널 줄 상단. 헤더 밴드(104) 바로 아래가 아니라 **{@link GEAR_BAND_H}(120) 아래**다 —
 * 목록 패널이 화면 좌측 끝(x 32)에서 시작하므로 설정 톱니 예약 밴드와 가로로 겹치고, 세로로
 * 몇 px 만 물려도 톱니가 매 프레임 맨 앞으로 올라와 그 자리를 통째로 삼킨다(테스트가 잠근다).
 */
const PANEL_Y = GEAR_BAND_H + 4;
const PANEL_TO_FOOT = 16;
/** 패널 세로는 **남는 자리 전부**다(빈 자리 금지 — 하드코딩하면 여백을 바꿀 때 어긋난다). */
const PANEL_H = FOOT_Y - PANEL_TO_FOOT - PANEL_Y;

const LIST_X = EDGE_X;
const LIST_W = 520;
const RIGHT_X = LIST_X + LIST_W + GUTTER_X;
const RIGHT_W = DESIGN_WIDTH - EDGE_X - RIGHT_X;
/**
 * 전장 창 세로. 남는 세로에서 이것을 뺀 나머지가 출격 제원 패널이다 — 창이 이 화면의 주인공이라
 * 큰 쪽을 먼저 정하고 제원이 나머지를 받는다(제원 콘텐츠는 두 줄이라 228 로 충분하다).
 */
const ARENA_H = 600;
const OPS_Y = PANEL_Y + ARENA_H + STACK_GAP_Y;
const OPS_H = PANEL_H - ARENA_H - STACK_GAP_Y;

/** 제목 띠가 있는 패널의 콘텐츠 상자(패널 로컬) — 위 복제 기하에서 파생. */
function titledBox(
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number; right: number; bottom: number } {
  return {
    x: PANEL_EDGE_PAD,
    y: TITLED_BOX_Y,
    w: w - PANEL_EDGE_PAD * 2,
    h: h - TITLED_BOX_Y - PANEL_EDGE_PAD,
    right: w - PANEL_EDGE_PAD,
    bottom: h - PANEL_EDGE_PAD,
  };
}

const BOX_L = titledBox(LIST_W, PANEL_H);
const BOX_O = titledBox(RIGHT_W, OPS_H);

/**
 * 전장 프리뷰가 그려질 뷰포트 = 창 패널이 **실제로 파낸 개구부**(화면 좌표).
 *
 * ⚠️ **콘텐츠 상자가 아니다.** 개구부 기하는 `cinematicPanel.ts` 가 정본이다 — 여기서 다시
 * 유도하면 조용히 어긋나고, 어긋나면 프레임과 그림 사이에 맨 배경 띠가 둘러 생긴다.
 */
const ARENA_OPENING = cinematicWindowOpening(RIGHT_W, ARENA_H, true);
/** 배경 `windows` 와 프리뷰 마스크가 **같은 사각**을 써야 밝기 보존이 헛돌지 않는다. */
export const ARENA_VIEWPORT = {
  x: RIGHT_X + ARENA_OPENING.x,
  y: PANEL_Y + ARENA_OPENING.y,
  w: ARENA_OPENING.w,
  h: ARENA_OPENING.h,
} as const;

// --- 헤더 컨트롤(형제 화면과 **같은 x**) ---
const CLOSE_W = 56;
const CLOSE_X = DESIGN_WIDTH - EDGE_X - CLOSE_W;

/**
 * 각인 제목이 실제로 차지하는 가로 반폭. 중앙 정렬 Text 는 사각형이 없어 겹침 테스트가 못
 * 잡는다 — 연구소 실화면에서 제목이 헤더 버튼과 **실제로 겹쳤다**.
 */
export const TITLE_BAND_HALF_W = 280;

/** 석재 슬래브 위 **보조 텍스트색**(정제소 `SLAB_BODY_FILL` 복제 — 그 파일은 화면이다). */
const SLAB_BODY_FILL = 0xe4dac7;
/** 행 판 바탕색·홈·반경 — 예비역 로스터 `rowPlate` → … → 지시 수신소 경유 복제. */
const ROW_FACE = 0x3b3327;
const ROW_GROOVE = 0x17130d;
const ROW_RADIUS = 10;

// --- 목록 기하 ---
const ROW_GAP = 10;
const ROW_PAD = 16;
/** 행성 오브 지름 — 자산이 64px 이므로 **1:1**(픽셀아트가 뭉개지지 않는다). */
const ORB_D = 64;
const ORB_GAP = 16;
/** 행 오른쪽 보상 배율이 먹는 폭 — 행 왼쪽 글자 폭이 여기서 파생된다. */
const ROW_REWARD_W = 100;
/** 행성 행 — 1줄 이름, 2줄 부제. 나머지(전장·단계·촉매)는 오른쪽 열이 말한다. */
const ROW_H = 96;
/**
 * 행 높이 상한.
 *
 * ⚠️ **아무 값이나 못 쓴다.** 상한이 높으면 행이 먼저 상한에 걸려 남는 자리가 {@link TAIL_MIN_H}
 * 보다 작아지고, 그러면 꼬리 챔버가 안 생겨 목록 아래에 **이름 없는 빈 면**이 남는다 —
 * 130 으로 뒀을 때 5개 구간에서 실제로 66px 가 남았다(단위 테스트가 잡았다). 122 는 1..7 개
 * 전 구간에서 "행이 채우거나, 남으면 꼬리가 받거나" 둘 중 하나가 성립하는 값이다.
 */
const ROW_MAX_H = 122;
/** 목록 **꼬리 챔버**의 최소 세로(읽을 만한 크기일 때만 생긴다). */
const TAIL_MIN_H = 96;

// --- 출격 제원 기하(패널 로컬 상자 BOX_O 안) ---
const CHAMBER_GAP = 24;
/** 침략 단계 챔버 폭 — 조절 행({@link stageRowWidth} = 836)이 안쪽 여백까지 담아야 한다. */
const STAGE_CH_W = 880;
/** 촉매 챔버는 **나머지 전부**다(빈 자리 금지 — 하드코딩하면 폭 합이 조용히 어긋난다). */
const CAT_CH_W = BOX_O.w - STAGE_CH_W - CHAMBER_GAP;
const CH_PAD = 16;

/** 단계 조절 버튼 폭(좌→우). 옛 값(96/120/96/200)에서 좁혔다 — 챔버 880 안에 들어가야 한다. */
const STAGE_JUMP_W = 88;
const STAGE_BIG_W = 112;
const STAGE_STEP_W = 88;
const STAGE_VALUE_W = 176;
const STAGE_BTN_GAP = 14;
/** 조절 행 높이와 챔버 안 세로 위치(1줄 = 머리글+캡션, 2줄 = 조절 행). */
export const STAGE_ROW_H = 72;
export const STAGE_HEAD_Y = 12;
export const STAGE_ROW_Y = 50;

/**
 * 전장 프리뷰 노드가 놓일 z 인덱스 — **창 패널 바로 뒤**(인자는 그 패널의 현재 인덱스).
 *
 * 앞에 두면 프리뷰가 창의 석재 단면·안쪽 AO·유리 반사·바닥 스크림을 통째로 가려, 개구부가
 * "유리창"이 아니라 그냥 검은 사각이 된다(방어 사령부 실화면에서 AO 그라디언트가 프리뷰 위에
 * 하나도 안 나타났다). 순수 함수로 빼 둔 이유는 노드 없이 이 계약을 테스트하기 위해서다
 * (vitest 는 node 환경이라 Pixi 표시 객체를 세우기 어렵다).
 */
export function arenaChildIndex(windowPanelIndex: number): number {
  return Math.max(0, windowPanelIndex);
}

// --- 전장 정찰 편성(순수 층) -----------------------------------------------
//
// 창이 "이 행성이 어떻게 생겼나"만 말하던 자리에 **"여기서 무엇이 나오는가"**를 얹는다
// (사용자 요청 2026-08-04). 얹는 방식이 이 절의 전부다:
//
// ⚠️ **띠에 칩으로 나열하지 않는다.** 첫 구현이 창 아래에 카드 띠를 깔았는데, 그러면 창이
// "전장"이 아니라 "지형 위에 붙은 목록"이 된다(사용자가 곧바로 되돌렸다 — "실제 행성 전장이
// 보여지고 있는데 **그 위에** 보스와 몹들이 같이 보여지면 좋겠어"). 그래서 적들은 판·테두리
// 없이 **지형 위에 그대로 선다** — 창이 곧 정찰 사진이다.
//
// ⚠️ **크기는 sim 반지름에서 온다**(`EnemyDef.radius`·`BossDef.radius` ×2 = 지름). 이 창은
// 런과 **같은 배율**이라(파일 헤더 "왜 여기는 창을 뚫는가" — 32px 타일을 64px 로 그린다)
// 반지름을 그대로 쓰면 화면에 보이는 크기가 실제 교전에서 보게 될 크기와 같다. 임의 크기로
// 그리면 "용암샘이 수리드론보다 크다" 같은 **실제 정보**가 지워진다.
//
// 자리는 Pixi 없이 검증되는 순수 서술이다(이 화면의 다른 좌표와 같은 규율).

/** 편성 좌우 여백. */
export const RECON_PAD = 24;
/** 잡몹 사이 최소 간격(지름 밖 여백). */
export const RECON_MOB_GAP = 24;
/** 이름표가 스프라이트 아래에서 떨어지는 거리. */
export const RECON_LABEL_GAP = 6;
/**
 * 잡몹 줄이 창 바닥에서 띄우는 여백.
 *
 * ⚠️ **이름표 자리를 포함해야 한다** — 스프라이트만 보고 잡으면 지그재그로 내려간 개체의
 * 이름표가 창 밖으로 나가 마스크에 잘린다(단위 테스트가 2px 초과로 잡았다):
 * {@link RECON_ZIGZAG} + {@link RECON_LABEL_GAP} + 이름표 높이(≈24) 가 하한이다.
 */
const RECON_ROW_BOTTOM = 50;
/** 보스와 잡몹 줄 사이 최소 간격. */
const RECON_BOSS_GAP = 16;
/** 캡션 아래 — 보스는 여기서부터 아래로만 선다(글자와 안 겹친다). */
const RECON_TOP_RESERVED = 46;
/** 잡몹 줄의 지그재그 폭 — 한 줄로 반듯하면 목록처럼 읽힌다(편성으로 보이게 어긋낸다). */
const RECON_ZIGZAG = 14;

/** 편성 한 자리 — 스프라이트 **중심**과 그려질 지름(창 로컬 좌표). */
export interface ReconSpot {
  readonly x: number;
  readonly y: number;
  /** 실제로 그릴 지름(sim 지름에서 시작해 자리에 맞게 줄어들 수 있다). */
  readonly d: number;
  /** 이름표 기준선(스프라이트 아래). */
  readonly labelY: number;
}

/** 창 위 편성 배치(창 로컬 좌표). */
export interface ReconScene {
  readonly caption: { readonly x: number; readonly y: number };
  readonly boss: ReconSpot;
  readonly mobs: readonly ReconSpot[];
}

/**
 * 창 크기 + **sim 지름**으로 편성 자리를 만든다(순수).
 *
 * - 잡몹은 창 아래쪽에 한 줄로 서고 지그재그로 어긋난다. 자리는 창 폭을 마리 수로 나눈
 *   **칸의 중앙**이다(붙여 세우면 넓은 창 한가운데 작은 무리가 된다 — 실화면에서 되돌렸다).
 *   가장 큰 개체가 칸을 넘으면 **전부 같은 비율로** 줄인다(한 마리만 줄이면 크기 비교가
 *   거짓말이 된다).
 * - 보스는 잡몹 줄 위 남는 자리 한가운데. 남는 세로가 sim 지름보다 좁으면 그만큼만 줄인다 —
 *   창을 넘어 잘리는 것보다 낫고, 여전히 잡몹보다 크다.
 * - 카르곤은 정예가 없어 4마리, 나머지 다섯 행성은 6마리다(칸 수가 행성마다 다르다).
 */
export function reconScene(
  w: number,
  h: number,
  bossD: number,
  mobDs: readonly number[],
): ReconScene {
  const inner = Math.max(0, w - RECON_PAD * 2);
  const ds = mobDs.filter((d) => d > 0);
  const n = ds.length;
  /**
   * 한 마리가 받는 칸 — 창 폭을 마리 수로 나눈다. ⚠️ **붙여 세우지 않는다**: 실측 지름
   * (56~88px)대로 서로 붙이면 1294px 창 한가운데 작은 무리 하나가 되어 "전장에 깔린 적"이
   * 아니라 "가운데 모인 아이콘"으로 읽혔다(실화면에서 되돌렸다).
   */
  const slot = n === 0 ? 0 : inner / n;
  const maxRaw = n === 0 ? 0 : Math.max(...ds);
  const shrink =
    n > 0 && maxRaw + RECON_MOB_GAP > slot ? Math.max(0, (slot - RECON_MOB_GAP) / maxRaw) : 1;
  const maxMobD = maxRaw * shrink;

  const rowY = h - RECON_ROW_BOTTOM - maxMobD / 2;
  const mobs: ReconSpot[] = [];
  ds.forEach((raw, i) => {
    const d = raw * shrink;
    // 지그재그는 **큰 개체가 아래**로 오게 짝수 인덱스를 내린다(작은 것이 뒤에 가려지지 않는다).
    const y = rowY + (i % 2 === 0 ? RECON_ZIGZAG : -RECON_ZIGZAG);
    const cx = RECON_PAD + slot * (i + 0.5);
    mobs.push({ x: cx, y, d, labelY: y + d / 2 + RECON_LABEL_GAP });
  });

  const rowTop = n === 0 ? h - RECON_ROW_BOTTOM : rowY - maxMobD / 2 - RECON_ZIGZAG;
  const avail = Math.max(0, rowTop - RECON_TOP_RESERVED - RECON_BOSS_GAP);
  // 보스 이름표도 보스 자리 안에서 나온다 — 지름은 이름표 높이를 뺀 자리에 맞춘다.
  const bd = Math.max(0, Math.min(bossD, avail - 24, inner));
  const bossY = RECON_TOP_RESERVED + Math.max(0, (avail - bd - 24) / 2) + bd / 2;
  return {
    caption: { x: RECON_PAD, y: 14 },
    boss: { x: w / 2, y: bossY, d: bd, labelY: bossY + bd / 2 + RECON_LABEL_GAP },
    mobs,
  };
}

/** 화면 좌표 사각형(디자인 스페이스). */
export interface StarRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 이 화면의 레이아웃 전량 — **Pixi 없이 검증되는 순수 서술**이다.
 *
 * 왜 내보내는가: 이 리포는 "겹치면 안 되는 세로 띠"가 실제로 겹친 결함을 격납고 헤더에서 겪었고,
 * 캔버스 없는 vitest 는 화면을 세울 수 없어 눈으로만 잡히는 유형이 된다. 좌표를 순수 값으로
 * 꺼내 두면 겹침·화면 이탈·톱니 예약 밴드 침범을 단위 테스트가 잠근다.
 *
 * ⚠️ **인자를 받지 않는 것 자체가 계약**이다 — 선택 행성·단계로 기하가 갈리면 조작 한 번마다
 * 배경과 석재를 다시 구워야 한다.
 */
export function planetSelectLayout(): {
  readonly screen: StarRect;
  readonly headerH: number;
  readonly panels: readonly { readonly id: string; readonly rect: StarRect }[];
  readonly footer: { readonly band: StarRect; readonly buttons: readonly StarRect[] };
  readonly headerControls: readonly { readonly id: string; readonly rect: StarRect }[];
  /** 배경이 보존되는 창 — **전장 프리뷰 하나**(파일 헤더 "왜 여기는 창을 뚫는가"). */
  readonly windows: readonly StarRect[];
} {
  return {
    screen: { x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT },
    headerH: HEADER_H,
    panels: [
      { id: 'list', rect: { x: LIST_X, y: PANEL_Y, w: LIST_W, h: PANEL_H } },
      { id: 'arena', rect: { x: RIGHT_X, y: PANEL_Y, w: RIGHT_W, h: ARENA_H } },
      { id: 'ops', rect: { x: RIGHT_X, y: OPS_Y, w: RIGHT_W, h: OPS_H } },
    ],
    footer: {
      band: { x: EDGE_X, y: FOOT_Y, w: CONTENT_W, h: FOOT_H },
      // 왼쪽→오른쪽(장비 정비 · 출격). 주 동작이 오른쪽 끝을 잡는다.
      buttons: [
        { x: INV_X, y: FOOT_Y, w: INV_W, h: FOOT_H },
        { x: LAUNCH_X, y: FOOT_Y, w: LAUNCH_W, h: FOOT_H },
      ],
    },
    headerControls: [{ id: 'close', rect: { x: CLOSE_X, y: HEAD_Y, w: CLOSE_W, h: HEAD_H } }],
    windows: [{ ...ARENA_VIEWPORT }],
  };
}

/** 패널 콘텐츠 상자와 그 안의 고정 블록(단위 테스트가 실제 패널 상자와 대조한다). */
export const STAR_BOXES = {
  list: { x: BOX_L.x, y: BOX_L.y, w: BOX_L.w, h: BOX_L.h, bottom: BOX_L.bottom },
  ops: { x: BOX_O.x, y: BOX_O.y, w: BOX_O.w, h: BOX_O.h, bottom: BOX_O.bottom },
  rowGap: ROW_GAP,
  rowH: ROW_H,
  rowMaxH: ROW_MAX_H,
  /** 목록 행에서 오브·여백·보상 배율이 먹고 남는 글자 폭 — 하한이 있어야 부제가 안 뭉개진다. */
  rowTextW: BOX_L.w - ROW_PAD * 2 - ORB_D - ORB_GAP - ROW_REWARD_W,
  rowRewardW: ROW_REWARD_W,
  chamberGap: CHAMBER_GAP,
  stageChW: STAGE_CH_W,
  catChW: CAT_CH_W,
  chamberPad: CH_PAD,
  /** 전장 개구부(패널 로컬) — 배경 `windows` 와 프리뷰 마스크가 이걸 함께 쓴다. */
  arenaOpening: { ...ARENA_OPENING },
  planets: PLANETS.length,
} as const;

/**
 * 남는 세로를 행에 **고르게 나눈** 새 높이 배열(순수 함수 — Pixi 미의존).
 *
 * 넘치면(스크롤이 붙으면) 입력 그대로 돌려준다. 반올림 잔여는 **행 수 미만**이다.
 *
 * ⚠️ **상한은 늘리기만 막는다. 자연 높이를 깎지 않는다.** `Math.min(maxH, h + add)` 만 쓰면
 * 자연 높이가 상한보다 큰 행이 **줄어들어** 내용이 판 밖으로 삐져나온다 — 바탕 판은 최종
 * 높이로 그려지는데 글자는 이미 자연 높이만큼 자라 있기 때문이다(`modulesView.ts` 에서 실제로
 * 터졌다). 그래서 `Math.max(h, ...)` 로 감싼다.
 * (지시 수신소 `fillRowHeights` 복제 — 그 파일은 공용 모듈이 아니라 화면이다.)
 */
export function fillRowHeights(
  heights: readonly number[],
  gap: number,
  avail: number,
  maxH: number,
): number[] {
  const n = heights.length;
  if (n === 0) return [];
  const total = heights.reduce((a, b) => a + b, 0) + gap * (n - 1);
  if (total >= avail) return [...heights];
  const add = Math.floor((avail - total) / n);
  if (add <= 0) return [...heights];
  return heights.map((h) => Math.max(h, Math.min(maxH, h + add)));
}

/**
 * 목록 열의 세로 배분 — 행 높이들과 **꼬리 챔버** 높이(0 이면 없음). 순수 함수라 Pixi 없이
 * 검증된다. 행성 6종이면 잔여가 행 수 미만이라 꼬리는 생기지 않지만, 레지스트리에 행성이
 * 추가/제거돼도 목록에 이름 없는 빈 면이 남지 않는다(테스트가 전 구간을 훑는다).
 */
export function listFill(count: number): { heights: number[]; tailH: number } {
  const avail = BOX_L.h;
  if (count <= 0) return { heights: [], tailH: avail };
  const heights = fillRowHeights(
    Array.from({ length: count }, () => ROW_H),
    ROW_GAP,
    avail,
    ROW_MAX_H,
  );
  const used = heights.reduce((a, b) => a + b, 0) + ROW_GAP * (count - 1);
  const rest = avail - used - ROW_GAP;
  return { heights, tailH: rest >= TAIL_MIN_H ? rest : 0 };
}

// --- 침략 단계 조절 컨트롤(순수 층) ---------------------------------------
//
// 단계 조절의 **의미**를 픽시와 분리해 여기 순수 함수로 둔다. 렌더는 이 사양을 버튼으로
// 옮겨 그릴 뿐이고, 모든 이동은 예외 없이 `clampStageTo` 를 통과한 절대 목표 단계다 —
// "새 컨트롤이 클램프를 우회한다"는 결함이 구조적으로 불가능해지고, 단위 테스트가 캔버스
// 없이 전 컨트롤의 도달 범위를 검사할 수 있다.

/** 단계를 [1, cap] 안으로 가둔다(모든 단계 이동의 유일한 관문). */
export function clampStageTo(stage: number, cap: number): number {
  const lo = 1;
  const hi = cap < lo ? lo : cap;
  const s = Number.isFinite(stage) ? Math.round(stage) : lo;
  return s < lo ? lo : s > hi ? hi : s;
}

/**
 * 큰 걸음 폭. 개방 상한은 클리어가 쌓이면 계속 커지므로(`stageOpenCap` = max(10, best+5))
 * 고정 5로 두면 상한 100 에서 다시 "여러 번 눌러야" 문제로 돌아간다. 상한의 1/10 로 두되
 * 하한 5 를 지켜 초반(상한 10~50)에는 익숙한 ±5 가 유지된다.
 */
export function stageBigStep(cap: number): number {
  return Math.max(5, Math.ceil((cap < 1 ? 1 : cap) / 10));
}

/** 단계 조절 버튼 한 칸의 사양(좌→우 순서로 배열). */
export interface StageControlSpec {
  /** 안정 식별자(테스트·하네스가 라벨 문자열에 의존하지 않게). */
  key: 'min' | 'bigDec' | 'dec' | 'value' | 'inc' | 'bigInc' | 'max';
  label: string;
  width: number;
  fontSize: number;
  /** 누르면 도달할 **절대** 단계(이미 클램프됨). */
  target: number;
  /** 눌러서 의미가 있는가(끝에 닿았으면 false → 비활성). */
  enabled: boolean;
  /** 현재 단계 표시 칸인가(금색 버튼·클릭 없음). */
  readonly current?: true;
}

/**
 * 현재 단계·상한에서 조절 행 사양을 만든다. `−`/`+` 한 칸 조절은 정밀 조정용으로 항상 남고,
 * 큰 걸음(±{@link stageBigStep})과 최소/최대 점프(`≪`/`≫`)가 먼 단계로의 도달을 짧게 만든다.
 * 라벨은 기호·숫자뿐이라 새 i18n 문자열이 필요 없다(걸음 폭이 라벨에 그대로 드러난다).
 */
export function stageControlSpecs(stage: number, cap: number): StageControlSpec[] {
  const cur = clampStageTo(stage, cap);
  const hi = clampStageTo(cap, cap);
  const big = stageBigStep(cap);
  const canDec = cur > 1;
  const canInc = cur < hi;
  return [
    { key: 'min', label: '≪', width: STAGE_JUMP_W, fontSize: 28, target: 1, enabled: canDec },
    { key: 'bigDec', label: `−${big}`, width: STAGE_BIG_W, fontSize: 24, target: clampStageTo(cur - big, cap), enabled: canDec },
    { key: 'dec', label: '−', width: STAGE_STEP_W, fontSize: 34, target: clampStageTo(cur - 1, cap), enabled: canDec },
    { key: 'value', label: String(cur), width: STAGE_VALUE_W, fontSize: 30, target: cur, enabled: false, current: true },
    { key: 'inc', label: '+', width: STAGE_STEP_W, fontSize: 34, target: clampStageTo(cur + 1, cap), enabled: canInc },
    { key: 'bigInc', label: `+${big}`, width: STAGE_BIG_W, fontSize: 24, target: clampStageTo(cur + big, cap), enabled: canInc },
    { key: 'max', label: '≫', width: STAGE_JUMP_W, fontSize: 28, target: hi, enabled: canInc },
  ];
}

/** 조절 행 전체 폭(버튼 폭 합 + 간격). 챔버 안쪽 폭을 넘으면 안 된다. */
export function stageRowWidth(specs: readonly StageControlSpec[]): number {
  if (specs.length === 0) return 0;
  let w = 0;
  for (const s of specs) w += s.width;
  return w + STAGE_BTN_GAP * (specs.length - 1);
}

// --- 행 판 조명 램프(모듈 1회 굽기) ------------------------------------------

/**
 * 행 판의 **방향성 조명**을 위한 세로 알파 램프.
 *
 * ⚠️ 띠를 겹쳐 그라디언트를 근사하지 않는다 — 1px 겹침이 알파를 두 배로 만들어 가로줄이 생긴다
 * (실제 사용자 신고). 폭 1px 캔버스에 픽셀로 굽고 `linear` 로 늘린다.
 */
let rowRampTex: Texture | null | undefined;

function rowRamp(): Texture | null {
  if (rowRampTex !== undefined) return rowRampTex;
  // ⚠️ 이 가드는 **캔버스를 굽는 함수에만** 붙인다. DOM 조회(`hudEl`)에 붙이면 HUD 숨김이
  // 통째로 죽는다(이 리포가 실제로 밟았다).
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    rowRampTex = null;
    return null;
  }
  try {
    const n = 64;
    const cv = document.createElement('canvas');
    cv.width = 1;
    cv.height = n;
    const ctx = cv.getContext('2d');
    if (ctx === null) {
      rowRampTex = null;
      return null;
    }
    const img = ctx.createImageData(1, n);
    for (let i = 0; i < n; i++) {
      // 위 1 → 아래 0. 선형이 아니라 위쪽에 몰리게(면이 위에서 빛을 받는다).
      const u = 1 - i / (n - 1);
      const a = Math.round(255 * u * u);
      img.data[i * 4] = 255;
      img.data[i * 4 + 1] = 255;
      img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    rowRampTex = Texture.from(cv);
    return rowRampTex;
  } catch {
    rowRampTex = null;
    return null;
  }
}

/**
 * 행 한 장의 바탕 — 2단 접지 그림자 + 석재 면 + 방향성 램프 + 안쪽 어두운 홈.
 *
 * **선은 긋지 않는다.** 행 사이 구분은 이 그림자와 행 간격이 만든다. 선택은 금색 링이 말한다.
 */
function rowPlate(w: number, h: number, selected: boolean): Container {
  const root = new Container();

  // 2단 접지 그림자 — 한 층으로는 접지가 안 읽힌다(넓고 옅은 확산 + 좁고 짙은 접촉).
  const diffuse = new Graphics();
  diffuse.roundRect(-3, 6, w + 6, h, ROW_RADIUS + 3).fill({ color: 0x000000, alpha: 0.22 });
  root.addChild(diffuse);
  const contact = new Graphics();
  contact.roundRect(1, 3, w - 2, h, ROW_RADIUS).fill({ color: 0x000000, alpha: 0.3 });
  root.addChild(contact);

  const face = new Graphics();
  face.roundRect(0, 0, w, h, ROW_RADIUS).fill({ color: ROW_FACE });
  root.addChild(face);

  const ramp = rowRamp();
  if (ramp !== null) {
    const clip = new Container();
    const mask = new Graphics();
    mask.roundRect(0, 0, w, h, ROW_RADIUS).fill({ color: 0xffffff });
    clip.addChild(mask);
    clip.mask = mask;

    const lit = new Sprite(ramp);
    lit.width = w;
    lit.height = h;
    lit.alpha = 0.11;
    clip.addChild(lit);

    const shade = new Sprite(ramp);
    shade.width = w;
    shade.height = h;
    shade.tint = 0x000000;
    shade.alpha = 0.3;
    // 뒤집어 아래쪽이 짙어지게 한다.
    shade.scale.y = -Math.abs(shade.scale.y);
    shade.y = h;
    clip.addChild(shade);

    root.addChild(clip);
  }

  const groove = new Graphics();
  groove
    .roundRect(0, 0, w, h, ROW_RADIUS)
    .stroke({ color: ROW_GROOVE, width: 2, alignment: 1, alpha: 0.85 });
  root.addChild(groove);

  if (selected) root.addChild(selectionRing(0, 0, w, h, ROW_RADIUS));
  return root;
}

/** 선택 표식 — 금색 링 하나. 히트 테스트에서 빠져야 행 클릭을 삼키지 않는다. */
function selectionRing(x: number, y: number, w: number, h: number, radius: number): Graphics {
  const ring = new Graphics();
  ring
    .roundRect(x, y, w, h, radius)
    .stroke({ color: COLOR.gold, width: 3, alignment: 1, alpha: 0.95 });
  ring.eventMode = 'none';
  return ring;
}

/**
 * **파낸 면** 한 장(출격 제원 챔버 · 목록 꼬리가 공유한다). 볼록한 {@link rowPlate} 와 조명
 * 부호가 정확히 반대다: 위가 그늘이고 **아래 입술만** 빛을 받는다. 이 부호가 뒤집히면 파인
 * 자리가 아니라 얹어 놓은 판때기로 읽힌다.
 * (정제소 `recessedWell` → … → 지시 수신소 경유 복제 — 그 파일들은 화면이지 공용 모듈이 아니다.)
 */
function recessedWell(x: number, y: number, w: number, h: number): Graphics {
  const g = new Graphics();
  g.roundRect(x, y, w, h, 12)
    .fill({ color: 0x14100a, alpha: 0.82 })
    .stroke({ color: 0x0a0705, width: 2, alignment: 1, alpha: 0.9 });
  g.moveTo(x + 14, y + h - 1.5)
    .lineTo(x + w - 14, y + h - 1.5)
    .stroke({ color: 0x6a5a3e, width: 1.5, alpha: 0.45 });
  return g;
}

/** 두 색을 tt(0=a, 1=b) 로 섞는다 — 오브 그라데이션용. */
function mixColor(a: number, b: number, tt: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * tt);
  const g = Math.round(ag + (bg - ag) * tt);
  const bl = Math.round(ab + (bb - ab) * tt);
  return (r << 16) | (g << 8) | bl;
}

/**
 * 행성 오브 **폴백**. 실 자산(`ui_planet_<id>.png`)이 없을 때만 쓴다 — 자산은 6종 중 4종뿐이라
 * 이 경로는 실제로 밟힌다(톡사르·크라스). DOM 판의
 * `radial-gradient(circle at 35% 30%, accent, #05060a)` 를 동심원 레이어로 근사한다
 * (Pixi Graphics 에는 방사 그라데이션이 없다).
 */
function makeOrb(diameter: number, accent: number): Graphics {
  const g = new Graphics();
  const r = diameter / 2;
  g.circle(r, r, r + 6).fill({ color: accent, alpha: 0.16 });
  const steps = 12;
  for (let i = steps; i >= 1; i--) {
    const tt = i / steps; // 1 = 가장 바깥
    const rr = r * tt;
    // 하이라이트 중심(35%, 30%)으로 갈수록 중심이 이동한다.
    const cx = r + (1 - tt) * (-r * 0.3);
    const cy = r + (1 - tt) * (-r * 0.4);
    g.circle(cx, cy, rr).fill({ color: mixColor(0x05060a, accent, 1 - tt) });
  }
  g.circle(r, r, r).stroke({ color: accent, width: 2, alpha: 0.55, alignment: 0 });
  return g;
}

/**
 * 전장 프리뷰의 지형 시드 — **행성 id 에서 결정론적으로** 뽑는다. 같은 행성은 언제 열어도 같은
 * 지형이라 "이 행성은 이렇게 생겼다"가 기억에 남고, 행성이 다르면 지형도 다르다.
 */
function arenaSeed(planet: number): number {
  return (Math.imul(planet + 1, 0x9e3779b1) ^ 0x5bf03635) >>> 0;
}

/** 창이 담아야 할 **두 지형의 섞임 비율**. 한쪽이 압도하면 창이 단색 면으로 읽힌다. */
const ARENA_TARGET_UPPER = 0.42;

/**
 * 창에 **어느 자리를 비출지** 고른다(순수 함수 — Pixi 미의존).
 *
 * ## 왜 필요한가 (실화면 1차 확인 2026-08-03)
 * 카메라를 원점에 두고 찍었더니 카르곤은 창의 3/4 가 어두운 현무암 한 덩어리였고 용암은
 * 오른쪽 아래 귀퉁이에만 걸쳤다. wang 지형은 런에서는 적·투사체·환경 레이어가 그 위를 덮어
 * 살지만, 1294×541 개구부에 **바닥만** 깔면 "한쪽 지형이 다 먹은 자리"가 그대로 화면의 절반이
 * 된다 — 창을 뚫은 근거(정보가 있는 면)를 스스로 무너뜨린다.
 *
 * 그래서 지형 필드를 **미리 훑어** 두 지형이 가장 고르게 섞인 타일 좌표를 고른다. 지형 필드는
 * `upperAt(seed, vx, vy)` 라는 순수 함수라 렌더 없이 셀 수 있고, 결과는 시드에서 결정되므로
 * 같은 행성은 언제 열어도 같은 자리를 비춘다.
 *
 * @param cols/rows 창이 담는 타일 수. @returns 타일 단위 카메라 오프셋.
 */
export function arenaFraming(
  seed: number,
  cols: number,
  rows: number,
): { tx: number; ty: number } {
  let best = { tx: 0, ty: 0 };
  let bestErr = Number.POSITIVE_INFINITY;
  // 후보는 창 하나 폭/높이 간격으로 흩는다 — 겹치는 후보를 촘촘히 보는 것은 낭비다.
  for (let cy = 0; cy < 8; cy++) {
    for (let cx = 0; cx < 8; cx++) {
      const ox = cx * cols;
      const oy = cy * rows;
      let upper = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (upperAt(seed, ox + c, oy + r)) upper++;
        }
      }
      const err = Math.abs(upper / (cols * rows) - ARENA_TARGET_UPPER);
      if (err < bestErr) {
        bestErr = err;
        best = { tx: ox, ty: oy };
      }
    }
  }
  return best;
}

/**
 * 전장 창의 내용물 — 선택 행성의 **wang 타일 지형**(런에서 바닥에 깔리는 그 그림).
 *
 * `AutotileBackground` 는 카메라 좌표계로 동작한다: 레이어를 `(W/2 − camX, H/2 − camY)` 로 옮기고
 * 타일을 `tx*64` 에 깐다. `camX` 를 화면 중앙으로 고정하면 가로 오프셋이 0 이 되어 개구부의
 * 디자인 좌표를 그대로 뷰 사각으로 넘길 수 있고, `camY` 만 천천히 밀면 런에서처럼 바닥이 흐른다.
 * 재타일링은 카메라가 타일 경계를 넘을 때만 일어난다(그 사이는 레이어 이동만).
 */
/**
 * 로스터 띠 안 글자 한 줄. `maxW` 를 넘으면 가로로 눌러 담는다(줄바꿈 대신) — 칸 폭이 행성마다
 * 다르고 한글 이름은 길어서, 넘치면 옆 칸을 침범한다(관제탑에서 겪은 유형).
 */
function reconText(
  text: string,
  size: number,
  color: number,
  weight: '400' | '700' | '800',
  maxW: number,
): Text {
  const el = new Text({
    resolution: 2,
    text: stripEmoji(text),
    style: { fontFamily: UI_FONT, fontSize: size, fontWeight: weight, fill: color, dropShadow: TEXT_SHADOW },
  });
  if (maxW > 0 && el.width > maxW) el.scale.x = maxW / el.width;
  return el;
}

class ArenaView {
  readonly view = new Container();
  private readonly auto = new AutotileBackground(64);
  private readonly fill = new Graphics();
  private readonly caption: Text;
  /**
   * 로스터 띠 — **행성이 바뀔 때가 아니라 `select` 마다** 다시 세운다. 지형(타일셋)은 무거워
   * 행성 교체 때만 갈아 끼우지만 로스터는 스프라이트 7장 + 글자 14줄이라 비용이 없고, 갱신을
   * 행성 변화로 묶으면 **로케일을 바꿔도 이름이 영어로 남는다**(형제 화면에서 겪은 유형).
   */
  private readonly reconHost = new Container();
  /** 부유 애니메이션 대상(편성 재건마다 다시 채운다). */
  private bobs: { node: Container; phase: number; boss: boolean }[] = [];
  private bobT = 0;
  /** 적·보스 스프라이트(basename → Texture|null). 자산 도착 시 화면이 통째로 재건된다. */
  private readonly ui: UiTextures;
  private planet = -1;
  /** 창이 비추는 자리(타일 좌표 → 카메라). {@link arenaFraming} 이 행성마다 골라 준다. */
  private camX = DESIGN_WIDTH / 2;
  private camY = DESIGN_HEIGHT / 2;
  /** 로드 경합 방지 — 늦게 도착한 타일셋이 이미 바뀐 행성을 덮어쓰지 않게 한다. */
  private pending = 0;
  private readonly rect: { x: number; y: number; w: number; h: number };

  constructor(rect: { x: number; y: number; w: number; h: number }, ui: UiTextures) {
    this.rect = rect;
    this.ui = ui;
    const mask = new Graphics();
    mask.rect(rect.x, rect.y, rect.w, rect.h).fill({ color: 0xffffff });
    this.view.addChild(mask);
    this.view.mask = mask;
    // 타일셋이 아직 없거나(첫 프레임·로드 실패) 타일 사이가 비어도 개구부가 뚫린 채로 보이지
    // 않게 바닥을 먼저 깐다 — 색은 행성 강조색에서 파생된다.
    this.view.addChild(this.fill);
    this.view.addChild(this.auto.layer);

    // 로스터 띠는 지형 **위**, 캡션 **아래**다(글자가 띠 판에 가리면 안 된다).
    this.view.addChild(this.reconHost);

    this.caption = new Text({
      resolution: 2,
      text: '',
      style: {
        fontFamily: UI_FONT,
        fontSize: 20,
        fontWeight: '700',
        fill: SLAB_BODY_FILL,
        dropShadow: TEXT_SHADOW,
      },
    });
    // ⚠️ 캡션은 **창 위쪽**이다 — 아래(옛 자리)는 잡몹 줄과 이름표가 쓴다.
    const at = reconScene(rect.w, rect.h, 0, []);
    this.caption.anchor.set(0, 0);
    this.caption.position.set(rect.x + at.caption.x, rect.y + at.caption.y);
    this.view.addChild(this.caption);
  }

  /**
   * 행성이 **바뀔 때만** 타일셋을 갈아 끼운다(같은 행성이면 no-op — 매 갱신마다 다시 안 읽는다).
   * 캡션과 로스터 띠는 매번 다시 세운다(비용이 없고, 로케일 전환을 놓치지 않는다).
   */
  select(p: PlanetMeta, caption: string): void {
    this.caption.text = stripEmoji(caption);
    this.renderRecon(p);
    if (p.id === this.planet) return;
    this.planet = p.id;
    const accent = hexColor(p.accent);
    this.fill.clear();
    this.fill
      .rect(this.rect.x, this.rect.y, this.rect.w, this.rect.h)
      .fill({ color: mixColor(0x05060a, accent, 0.16) });
    const seed = arenaSeed(p.id);
    // 창이 담는 타일 수만큼 지형을 훑어 두 지형이 가장 고르게 섞인 자리를 고른다. 카메라에서
    // `rect` 를 빼는 이유: 레이어 오프셋이 `W/2 − camX` 라, 창 왼쪽 위에 타일 (tx,ty) 가 오려면
    // 창의 화면 좌표만큼 되돌려야 한다(안 빼면 실제로 보이는 자리가 9타일 어긋난다).
    const cols = Math.ceil(this.rect.w / 64);
    const rows = Math.ceil(this.rect.h / 64);
    const frame = arenaFraming(seed, cols, rows);
    this.camX = DESIGN_WIDTH / 2 + frame.tx * 64 - this.rect.x;
    this.camY = DESIGN_HEIGHT / 2 + frame.ty * 64 - this.rect.y;
    this.auto.configure(null, seed);
    const token = ++this.pending;
    void loadWangTiles(p.id)
      .then((tiles: WangTiles | null) => {
        // 늦게 도착했으면 버린다(행성을 빠르게 넘기면 순서가 뒤집힐 수 있다).
        if (token !== this.pending) return;
        this.auto.configure(tiles, seed);
      })
      .catch(() => {
        /* 자산 누락·오프라인이면 바닥색만 남는다(로더가 이미 null 로 삼키지만 이중 방어). */
      });
  }

  /**
   * 편성을 다시 세운다 — 보스 하나 + 역할 4종 + 정예(있으면 2종)가 **지형 위에 그대로 선다**.
   *
   * 목록은 `planetReconRoster` 가 콘텐츠 레지스트리에서 파생하고 자리는 {@link reconScene} 이
   * 정한다 — 여기서는 그리기만 한다. 스프라이트가 없으면(자산 미도착) 행성 강조색 도형으로
   * 내려앉는다(자리가 비어 "이 행성엔 없는 적"처럼 읽히면 안 된다).
   *
   * ⚠️ 판·테두리를 두르지 않는다 — 창이 목록이 아니라 **전장 사진**이어야 한다(절 머리말).
   * 대신 접지 그림자와 이름표 뒤 어둠으로 지형에서 떠올린다(지형이 밝으면 글자가 사라진다).
   */
  private renderRecon(p: PlanetMeta): void {
    for (const child of [...this.reconHost.children]) {
      this.reconHost.removeChild(child);
      child.destroy({ children: true });
    }
    this.bobs = [];
    const units = planetReconRoster(p.id);
    const boss = units.find((u) => u.boss) ?? null;
    const mobs = units.filter((u) => !u.boss);
    const at = reconScene(
      this.rect.w,
      this.rect.h,
      (boss?.radius ?? 0) * 2,
      mobs.map((u) => u.radius * 2),
    );
    const accent = hexColor(p.accent);

    mobs.forEach((u, i) => {
      const spot = at.mobs[i];
      if (spot === undefined) return;
      this.reconHost.addChild(this.reconUnit(u, spot, accent, i));
    });
    if (boss !== null && at.boss.d > 0) {
      this.reconHost.addChild(this.reconUnit(boss, at.boss, accent, -1));
    }
  }

  /**
   * 적 하나 — 접지 그림자 + 스프라이트 + 이름표(창 로컬 자리를 화면 좌표로 옮긴다).
   * @param seat 부유 위상 시드. -1 = 보스(느리고 크게 흔들린다).
   */
  private reconUnit(unit: ReconUnit, spot: ReconSpot, accent: number, seat: number): Container {
    const node = new Container();
    node.position.set(this.rect.x + spot.x, this.rect.y + spot.y);

    // 접지 그림자 — 이것이 없으면 스프라이트가 지형에 **붙어** 보이지 않고 떠 있는 스티커가 된다.
    const shadow = new Graphics();
    shadow
      .ellipse(0, spot.d * 0.42, spot.d * 0.34, spot.d * 0.12)
      .fill({ color: 0x000000, alpha: 0.38 });
    node.addChild(shadow);

    const art = new Container();
    node.addChild(art);
    const tex = unit.asset === null ? null : (this.ui[unit.asset] ?? null);
    if (tex !== null && tex.width > 0 && tex.height > 0) {
      const sprite = new Sprite(tex);
      // **sim 지름에 맞춘다** — 런에서 보게 될 크기 그대로다(절 머리말).
      sprite.scale.set(spot.d / Math.max(tex.width, tex.height));
      sprite.anchor.set(0.5, 0.5);
      art.addChild(sprite);
    } else {
      // 자산 폴백 — 행성 강조색 마름모(자리가 비지 않게).
      const g = new Graphics();
      const r = spot.d / 2;
      g.moveTo(0, -r).lineTo(r, 0).lineTo(0, r).lineTo(-r, 0).closePath().fill({ color: accent });
      art.addChild(g);
    }
    this.bobs.push({ node: art, phase: seat < 0 ? 0 : seat * 1.7, boss: seat < 0 });

    // 이름표 — 지형은 밝기가 제각각이라 글자만 얹으면 사라진다. 어두운 알약을 깐다.
    const size = unit.boss ? 20 : 15;
    const label = reconText(
      reconUnitLabel(unit),
      size,
      unit.boss ? COLOR.gold : COLOR.cream,
      unit.boss ? '800' : '700',
      Math.max(80, spot.d * 1.6),
    );
    label.anchor.set(0.5, 0);
    const lw = label.width + 14;
    const lh = size + 8;
    const ly = spot.labelY - spot.y;
    const pill = new Graphics();
    pill
      .roundRect(-lw / 2, ly - 2, lw, lh, 6)
      .fill({ color: 0x05060a, alpha: 0.68 })
      .stroke({ color: unit.boss ? COLOR.gold : ROW_GROOVE, width: unit.boss ? 2 : 1, alignment: 0 });
    node.addChild(pill);
    label.position.set(0, ly + 2);
    node.addChild(label);

    return node;
  }

  update(dt: number): void {
    // 편성은 **제자리에서 부유**한다 — 지형만 흐르고 적이 굳어 있으면 붙여 넣은 그림처럼 보인다.
    // 사인 위상이라 결정론(해시)과 무관하고 비용도 노드 수만큼뿐이다.
    this.bobT += dt;
    for (const b of this.bobs) {
      b.node.position.y = Math.sin(this.bobT * (b.boss ? 0.9 : 1.6) + b.phase) * (b.boss ? 6 : 4);
    }
    // 런에서 바닥이 흐르는 방향(전방 비행) — 카메라가 아래로 밀리면 타일이 위로 흐른다.
    this.camY += dt * 22;
    this.auto.update(
      this.camX,
      this.camY,
      this.rect.x,
      this.rect.y,
      this.rect.x + this.rect.w,
      this.rect.y + this.rect.h,
    );
  }

  destroy(): void {
    this.auto.destroy();
    this.view.destroy({ children: true });
  }
}

export class PlanetSelectScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private ui: UiTextures = {};
  private art: HangarTextures = {};
  private planet = 0;
  /** 선택된 침략 단계(1..개방 상한). `stage`(Pixi Container)와 이름이 겹치지 않게 별칭. */
  private selectedStage = 1;
  /** 행성별 개방 상한 산정 콜백(미지정 = 최고 클리어 0 → 상한 10). */
  private bestStageCleared: BestStageClearedFn = () => 0;
  private meta = '';
  private onLaunch: ((sel: LaunchSelection) => void) | null = null;
  private onInventory: (() => void) | null = null;
  private onBack: (() => void) | null = null;
  /** 이 런에 주입한 촉매 id(중복=스택, ADR-0029). 픽커가 편집하고 launch 가 sel 에 실어 넘긴다. */
  private injectedCatalysts: number[] = [];
  /** 보유 수량 스냅샷(서버 권위 — show 시 온라인 조회). 없으면 빈 맵(주입 불가). */
  private inventory: CatalystInventory = new Map<number, number>();
  /** 보유 원장 조회 provider(온라인=net, 하네스=모의). 미지정이면 조회하지 않는다. */
  private fetchInventory: (() => Promise<CatalystInventory | null>) | null = null;
  /** 촉매 주입 픽커 팝업(하위 컴포넌트). */
  private readonly picker: CatalystPicker;
  private listScrollY = 0;

  /** 진입 전 런 HUD 의 visibility — 닫을 때 **원래 값으로** 되돌린다(무조건 '' 금지). */
  private hudPrevVisibility: string | null = null;

  // --- 크롬(1회 조립) ---
  private backdrop: HangarBackdrop | null = null;
  private panels: CinematicPanel[] = [];
  private arena: ArenaView | null = null;
  private chromeBuilt = false;
  private listHost: Container | null = null;
  private opsHost: Container | null = null;
  private footHost: Container | null = null;
  private metaNode: Text | null = null;
  private summaryNode: Text | null = null;
  private launchBtn: PixiButton | null = null;
  /**
   * [출격] 라벨은 행성 이름을 품는다 — 라벨이 바뀌면 버튼을 다시 세워야 하는데, 매 갱신마다
   * 세우면 조작 한 번마다 텍스처가 다시 붙는다. 라벨이 **바뀔 때만** 세운다.
   */
  private launchKey = '';

  constructor(stage: Container) {
    this.stage = stage;
    this.picker = new CatalystPicker(stage);
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    // 행성 오브(`ui_planet_*.png`)는 아직 나무 UI 킷에 들어 있다 — 크롬은 전부 절차적 석재로
    // 바뀌었지만 이 4장은 실제로 쓰이므로 킷을 계속 읽는다.
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      this.rebuild();
    });
    void loadHangarTextures().then((tex) => {
      this.art = tex;
      this.rebuild();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** 배경·석재 패널·전장 연출 진행. `main.ts` 가 매 프레임 부른다 — 숨겨져 있으면 즉시 반환. */
  update(dt: number): void {
    if (!this.root.visible) return;
    this.backdrop?.update(dt);
    for (const p of this.panels) p.update(dt);
    this.arena?.update(dt);
    // 촉매 픽커도 시네마틱 석재 패널을 쓴다 — 이 화면이 유일한 소유자라 dt 공급원도 여기뿐이다.
    // 빠뜨리면 팝업이 떠 있는 동안만 연출이 멈춰, 눈으로만 잡히는 유형이 된다.
    this.picker.update(dt);
  }

  /**
   * 다음 런의 성계 지도를 연다(DOM 판과 동일 시그니처 — **한 줄도 바꾸지 않는다**).
   * @param opts.meta 하단 상태 줄(크레딧 / 기체 레벨 등).
   */
  show(opts: {
    meta: string;
    /** 행성별 개방 상한 산정 콜백(ADR-0022). 생략 시 최고 클리어 0(상한 10). */
    bestStageCleared?: BestStageClearedFn;
    onLaunch: (sel: LaunchSelection) => void;
    onInventory: () => void;
    /** 기지 맵 복귀(왕복 동선). */
    onBack?: () => void;
    /**
     * 촉매 보유 원장 조회 provider(ADR-0029). 온라인은 net `fetchCatalystInventoryOnline`,
     * 하네스는 모의를 넘긴다. 미지정이면 조회하지 않는다(빈 보유 = 주입 불가, 오프라인 폴백 보존).
     */
    fetchCatalystInventory?: () => Promise<CatalystInventory | null>;
  }): void {
    this.bestStageCleared = opts.bestStageCleared ?? (() => 0);
    // 선택 단계를 현재 행성 개방 상한으로 클램프한다(DOM 판과 동일).
    this.selectedStage = this.clampStage(this.selectedStage);
    this.meta = opts.meta;
    this.onLaunch = opts.onLaunch;
    this.onInventory = opts.onInventory;
    this.onBack = opts.onBack ?? null;
    this.fetchInventory = opts.fetchCatalystInventory ?? null;
    // 이전 런 주입이 이번 행성 특산 정합을 깨지 않게 정리(무촉매로 시작하는 것이 안전하다).
    this.pruneInjectedForPlanet();
    this.listScrollY = 0;
    this.buildChrome();
    this.refresh();
    this.root.visible = true;
    this.raise();
    // 보유 원장은 서버 권위라 비동기 조회한다 — 도착하면 픽커·패널이 반영한다(그 전엔 빈 보유).
    const fetchInv = this.fetchInventory;
    if (fetchInv !== null) {
      void fetchInv().then((inv) => {
        if (inv !== null) this.inventory = inv;
        if (this.root.visible) this.refresh();
      });
    }
    // DOM HUD 는 런 전용 — 캔버스 메타 화면 위에 떠 보이므로 숨긴다(스킬 §7).
    this.hideRunHud();
  }

  /** ⚠️ **멱등**이어야 한다 — `main.ts` 가 하네스 goto 스위치를 포함해 여러 경로에서 부른다. */
  hide(): void {
    this.root.visible = false;
    this.picker.hide(); // 픽커 모달이 떠 있으면 함께 내린다(화면 전환 시 잔상 방지).
    this.onLaunch = null;
    this.onInventory = null;
    this.onBack = null;
    this.restoreRunHud();
  }

  private raise(): void {
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
  }

  // --- 런 HUD ---------------------------------------------------------------

  /**
   * ⚠️ 여기에는 **캔버스 가드를 붙이지 않는다.** `typeof document.createElement !== 'function'`
   * 까지 검사하면 HUD 숨김이 통째로 죽는다(이 리포가 실제로 밟았다). 가드는 캔버스를 굽는
   * 함수({@link rowRamp})에만 붙인다.
   */
  private hudEl(): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    return document.getElementById('pb-hud');
  }

  private hideRunHud(): void {
    const el = this.hudEl();
    if (el === null) return;
    if (this.hudPrevVisibility === null) this.hudPrevVisibility = el.style.visibility;
    el.style.visibility = 'hidden';
  }

  /** 원래 값으로 되돌린다 — 무조건 `''` 로 되살리면 런 중 HUD 상태를 덮어쓴다. */
  private restoreRunHud(): void {
    const el = this.hudEl();
    if (el !== null && this.hudPrevVisibility !== null) el.style.visibility = this.hudPrevVisibility;
    this.hudPrevVisibility = null;
  }

  // --- 선택 / 출격 (DOM 판과 동일 규칙) ------------------------------------

  private selectPlanet(id: number): void {
    if (id === this.planet) return;
    this.planet = id;
    // 행성마다 개방 상한이 다르므로 선택 단계를 새 행성 상한으로 클램프한다.
    this.selectedStage = this.clampStage(this.selectedStage);
    // 특산 촉매는 출신 행성 전용이라 행성이 바뀌면 정합이 깨진 특산 주입을 걷어낸다(consume 거부 예방).
    this.pruneInjectedForPlanet();
    this.refresh();
  }

  /** 현재 선택 행성에서 잠기는 특산 촉매 주입을 제거한다(공용은 유지). */
  private pruneInjectedForPlanet(): void {
    this.injectedCatalysts = this.injectedCatalysts.filter((id) => {
      const def = catalystById(id);
      if (def === undefined) return false;
      return def.kind === 'common' || def.planet === this.planet;
    });
  }

  /** 현재 선택 행성의 개방 상한(max(10, 최고 클리어 + 5), ADR-0022). */
  private openCap(): number {
    return stageOpenCap(this.bestStageCleared(this.planet));
  }

  /** 단계를 [1, 개방 상한]으로 클램프한다. */
  private clampStage(stage: number): number {
    return clampStageTo(stage, this.openCap());
  }

  /**
   * 목표 단계로 이동한다(절대값). 큰 걸음·점프·한 칸 조절이 전부 이 한 지점을 지나므로
   * 클램프 불변이 컨트롤 종류와 무관하게 유지된다.
   */
  private setStage(stage: number): void {
    this.selectedStage = this.clampStage(stage);
    this.refresh();
  }

  /** 현재 선택 단계(하네스·테스트가 읽는 접점). */
  getSelectedStage(): number {
    return this.selectedStage;
  }

  private launch(): void {
    const cb = this.onLaunch;
    // 주입 촉매를 sel 에 실어 넘긴다(중복=스택). 출격 오케스트레이터(main.ts)가 비지 않으면
    // consume_catalysts 를 거쳐 런을 시작한다. 무촉매면 catalysts 를 싣지 않아 기존 경로 불변.
    const cats = this.injectedCatalysts.slice();
    const sel: LaunchSelection = {
      planet: this.planet,
      stage: this.selectedStage,
      ...(cats.length > 0 ? { catalysts: cats } : {}),
    };
    this.hide();
    cb?.(sel);
  }

  private back(): void {
    const cb = this.onBack;
    this.hide();
    cb?.();
  }

  // --- 공용 렌더 조각 -------------------------------------------------------

  private label(
    text: string,
    size: number,
    color: number,
    weight: '400' | '700' | '800' = '400',
    maxW?: number,
  ): Text {
    const el = new Text({
      resolution: 2,
      text: stripEmoji(text),
      style: { fontFamily: UI_FONT, fontSize: size, fontWeight: weight, fill: color, dropShadow: TEXT_SHADOW },
    });
    if (maxW !== undefined && el.width > maxW) el.scale.x = maxW / el.width;
    return el;
  }

  private wrapped(text: string, size: number, color: number, w: number, lineHeight?: number): Text {
    return new Text({
      resolution: 2,
      text: stripEmoji(text),
      style: {
        fontFamily: UI_FONT,
        fontSize: size,
        fill: color,
        wordWrap: true,
        wordWrapWidth: w,
        ...(lineHeight === undefined ? {} : { lineHeight }),
        dropShadow: TEXT_SHADOW,
      },
    });
  }

  /** 시네마틱 버튼 — 기존 `PixiButton` 에 석재 텍스처만 주입한다(로직은 그대로). */
  private chromeButton(o: {
    tone: ChromeTone;
    width: number;
    height: number;
    fontSize: number;
    label: string;
    onClick: () => void;
    sound?: 'uiConfirm';
  }): PixiButton {
    return new PixiButton({
      // ⚠️ 텍스처는 128×64 로 구워져 있다 — `cap: 32` 여야 모서리가 안 뭉개진다.
      texture: cinematicButtonTexture(o.tone),
      cap: 32,
      fallbackColor: chromeFallbackColor(o.tone),
      labelColor: chromeLabelColor(o.tone),
      width: o.width,
      height: o.height,
      fontSize: o.fontSize,
      label: stripEmoji(o.label),
      ...(o.sound === undefined ? {} : { sound: o.sound }),
      onClick: o.onClick,
    });
  }

  private clearHost(host: Container): void {
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }
  }

  // --- 크롬(1회 조립) -------------------------------------------------------

  /** 자산이 도착하면 크롬을 통째로 다시 세운다(구운 텍스처가 바뀌므로 갱신으로는 안 된다). */
  private rebuild(): void {
    if (!this.chromeBuilt) return;
    this.destroyChrome();
    this.buildChrome();
    this.refresh();
  }

  private destroyChrome(): void {
    this.backdrop?.destroy();
    this.backdrop = null;
    this.arena?.destroy();
    this.arena = null;
    for (const p of this.panels) p.destroy();
    this.panels = [];
    this.listHost = null;
    this.opsHost = null;
    this.footHost = null;
    this.metaNode = null;
    this.summaryNode = null;
    this.launchBtn = null;
    this.launchKey = '';
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }
    this.chromeBuilt = false;
  }

  private buildChrome(): void {
    if (this.chromeBuilt) return;

    // 바닥 — 배경 자산이 없거나 실패해도 화면이 비지 않게(불투명, 뒤 아레나를 가린다).
    // 이벤트도 여기서 막는다(뒤 화면으로 클릭·휠이 새지 않게).
    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static';
    this.root.addChild(bg);

    // ⚠️ `view` 는 root 맨 뒤에 그대로 붙이고 스케일·이동을 걸지 마라(공기 마스크가 `view` 의
    // 자식이라 어긋난다). 창은 **정확히** 전장 개구부다(파일 헤더 "왜 여기는 창을 뚫는가").
    const backdrop = new HangarBackdrop(this.art[HANGAR_BACKDROP_NAME], {
      windows: [{ ...ARENA_VIEWPORT }],
      headerH: HEADER_H,
    });
    this.root.addChild(backdrop.view);
    this.backdrop = backdrop;

    // 전장 프리뷰는 **창 패널 바로 뒤**여야 한다 — 앞에 두면 석재 단면·AO·유리 반사·바닥
    // 스크림을 통째로 가려 개구부가 검은 사각이 된다(방어 사령부 실측). 여기서 먼저 붙이고
    // 아래에서 창 패널을 그 위에 얹는다.
    const arena = new ArenaView({ ...ARENA_VIEWPORT }, this.ui);
    arena.view.eventMode = 'none';
    this.root.addChild(arena.view);
    this.arena = arena;

    /**
     * ⚠️ **크롬(헤더·하단 띠)은 패널보다 뒤에 붙여 위로 올린다.**
     *
     * 사용자 신고(2026-08-02, 방어 사령부) "탭 아래 절반이 클릭이 안 된다"의 실체가 이 순서였다.
     * 석재 패널은 접지 그림자·글로우를 텍스처에 구워 넣어 **자기 사각보다 30px 가까이 번지고**,
     * 그 번짐이 위 컨트롤을 덮었다. Pixi v8 은 자식을 역순으로 훑다가 **픽셀에 걸리면 거기서
     * 멈추고 가장 가까운 상호작용 조상**을 반환하므로 그림자가 passive 여도 탐색은 끝난다.
     * ⚠️ 여백을 벌리는 것으로는 못 푼다 — 번짐 폭은 패널 치수에서 파생돼 조용히 커진다.
     */
    const listPanel = this.addPanel(LIST_X, PANEL_Y, LIST_W, PANEL_H, t('planet.list.head'), 'slab');
    const arenaPanel = this.addPanel(
      RIGHT_X,
      PANEL_Y,
      RIGHT_W,
      ARENA_H,
      t('planet.arena.head'),
      'window',
    );
    const opsPanel = this.addPanel(RIGHT_X, OPS_Y, RIGHT_W, OPS_H, t('planet.ops.head'), 'slab');

    const listHost = new Container();
    listPanel.container.addChild(listHost);
    this.listHost = listHost;
    const opsHost = new Container();
    opsPanel.container.addChild(opsHost);
    this.opsHost = opsHost;

    // 크롬은 여기서부터 — 패널 위에 얹힌다(바로 위 주석이 근거).
    this.buildHeader();
    this.buildFooter();

    // 프리뷰를 창 패널 **바로 뒤**로 돌린다. 인덱스는 런타임에 읽으므로 위 조립 순서가 바뀌어도
    // 따라온다({@link arenaChildIndex}).
    const at = this.root.getChildIndex(arenaPanel.container);
    this.root.setChildIndex(arena.view, arenaChildIndex(at));

    this.chromeBuilt = true;
  }

  /**
   * 석재 패널 한 장을 세운다.
   *
   * ⚠️ `screenX`/`screenY` 를 **반드시 넘긴다.** 안 넘기면 같은 치수의 패널끼리 조명·랜드마크
   * 시드가 같아져 위치별 조명이 조용히 무효가 된다 — 화면은 정상적으로 서고 테스트도 통과하므로
   * 눈으로만 잡히는 유형이다.
   */
  private addPanel(
    px: number,
    py: number,
    pw: number,
    ph: number,
    title: string,
    variant: 'slab' | 'window',
  ): CinematicPanel {
    const panel = makeCinematicPanel({
      width: pw,
      height: ph,
      variant,
      title,
      screenX: px,
      screenY: py,
      lightOrigin: { x: DESIGN_WIDTH / 2, y: 60 },
    });
    panel.container.position.set(px, py);
    this.root.addChild(panel.container);
    this.panels.push(panel);
    return panel;
  }

  /**
   * 헤더 밴드(y 0..{@link HEADER_H}) — 각인 제목(중앙) · 닫기(우 = 기지 복귀).
   *
   * ⚠️ **재화 칩은 두지 않는다.** 출격은 무료고 촉매 주입이 소모하는 것은 촉매 아이템이다.
   * `meta` 상태 줄은 하단 띠가 받는다. ⚠️ 좌측은 **비워 둔다**(설정 톱니 예약 밴드).
   */
  private buildHeader(): void {
    const title = makeHangarTitle(t('planet.title'));
    title.position.set(DESIGN_WIDTH / 2, HEAD_Y - 4);
    this.root.addChild(title);

    const close = this.chromeButton({
      tone: 'stone',
      width: CLOSE_W,
      height: HEAD_H,
      fontSize: 22,
      // 컬러 이모지는 Pixi 에서 두부가 된다(`text.ts` stripEmoji) — U+2715 는 흑백 글리프다.
      label: '✕',
      onClick: () => this.back(),
    });
    close.container.position.set(CLOSE_X, HEAD_Y);
    this.root.addChild(close.container);
  }

  /**
   * 하단 액션 띠 — 왼쪽 **두 줄**(`meta` 상태 줄 · 선택 요약), 오른쪽 [장비 정비] [출격].
   *
   * 옛 구현은 `meta` 를 화면 맨 아래 중앙에 떠 있는 Text 로 두고 버튼 셋을 그 위에 가로로
   * 늘어놓았다. 둘을 한 띠로 모으면 띠 안에 빈 자리가 없고, 선택 요약(행성·단계·촉매)이
   * **출격 직전에 무엇이 확정됐는지**를 버튼 바로 옆에서 말한다.
   */
  private buildFooter(): void {
    const host = new Container();
    this.root.addChild(host);
    this.footHost = host;

    const textW = INV_X - EDGE_X - 24;
    const metaNode = this.label('', 18, SLAB_BODY_FILL, '400', textW);
    metaNode.anchor.set(0, 0.5);
    metaNode.position.set(EDGE_X, FOOT_Y + FOOT_H / 2 - 13);
    host.addChild(metaNode);
    this.metaNode = metaNode;

    const summary = this.label('', 17, COLOR.muted, '400', textW);
    summary.anchor.set(0, 0.5);
    summary.position.set(EDGE_X, FOOT_Y + FOOT_H / 2 + 13);
    host.addChild(summary);
    this.summaryNode = summary;

    const inv = this.chromeButton({
      tone: 'stone',
      width: INV_W,
      height: FOOT_H,
      fontSize: 21,
      // '🛠 장비 정비' 의 컬러 이모지는 캔버스에서 두부가 된다.
      label: t('planet.inventory'),
      onClick: () => this.onInventory?.(),
    });
    inv.container.position.set(INV_X, FOOT_Y);
    host.addChild(inv.container);
  }

  /**
   * [출격] 버튼을 **라벨이 바뀔 때만** 다시 세운다(라벨이 행성 이름을 품는다).
   *
   * ⚠️ 톤은 항상 `gold` 다 — 이 화면에는 "출격할 수 없는 상태"가 없다(오프라인이어도 무촉매
   * 폴백으로 런은 시작된다). 그래서 `setEnabled(false)` + `gold` 조합(글자가 통째로 사라진다)이
   * 애초에 만들어지지 않는다.
   */
  private syncLaunchButton(): void {
    const host = this.footHost;
    if (host === null) return;
    const label = t('planet.launch', { name: planetById(this.planet).name });
    if (label === this.launchKey && this.launchBtn !== null) return;
    this.launchKey = label;

    const old = this.launchBtn;
    if (old !== null) {
      host.removeChild(old.container);
      old.container.destroy({ children: true });
    }
    const btn = this.chromeButton({
      tone: 'gold',
      width: LAUNCH_W,
      height: FOOT_H,
      fontSize: 24,
      label,
      // 출격 = 결정성 확정 액션(AC16 팔레트 재사용 — 기본 navigate 와 구분).
      sound: 'uiConfirm',
      onClick: () => this.launch(),
    });
    btn.container.position.set(LAUNCH_X, FOOT_Y);
    host.addChild(btn.container);
    this.launchBtn = btn;
  }

  // --- 갱신 -----------------------------------------------------------------

  /** 값과 목록만 갈아끼운다. 배경·석재 패널은 다시 굽지 않는다(파일 헤더 "재렌더 규율"). */
  private refresh(): void {
    if (!this.chromeBuilt) return;
    this.syncValues();
    this.syncArena();
    this.renderList();
    this.renderOps();
  }

  private syncValues(): void {
    if (this.metaNode !== null) this.metaNode.text = stripEmoji(this.meta);
    if (this.summaryNode !== null) {
      this.summaryNode.text = stripEmoji(
        t('planet.summary', {
          name: planetById(this.planet).name,
          stage: this.selectedStage,
          n: this.injectedCatalysts.length,
        }),
      );
    }
    this.syncLaunchButton();
  }

  /** 전장 창 — 행성이 바뀔 때만 타일셋을 갈아 끼운다(캡션은 매번 갱신). */
  private syncArena(): void {
    const p = planetById(this.planet);
    this.arena?.select(p, reconCaption(p.name, p.subtitle));
  }

  // --- 목록 열 -------------------------------------------------------------

  private renderList(): void {
    const host = this.listHost;
    if (host === null) return;
    this.clearHost(host);

    const { heights: hs, tailH } = listFill(PLANETS.length);
    const bounds = rowBounds(hs, ROW_GAP);
    const total = bounds.length === 0 ? 0 : (bounds[bounds.length - 1] ?? 0);

    if (tailH > 0) {
      // ⚠️ 스크롤 콘텐츠 **밖**에 둔다 — 꼬리가 생긴다는 것은 곧 스크롤이 없다는 뜻이고
      // (남는 자리가 있다), 안에 넣으면 스크롤 총 높이가 늘어 헛돌게 된다.
      const y = BOX_L.y + total + ROW_GAP;
      host.addChild(recessedWell(BOX_L.x, y, BOX_L.w, tailH));
      const el = this.wrapped(t('planet.list.tail'), 18, SLAB_BODY_FILL, BOX_L.w - 64, 28);
      el.anchor.set(0.5, 0.5);
      el.position.set(BOX_L.x + BOX_L.w / 2, y + tailH / 2);
      host.addChild(el);
    }

    /**
     * ⚠️ 마스크를 **행 경계로 자르지 않는다**(`clampToRows` 미사용). 상자 높이를 그대로 쓰면
     * 넘칠 때 마지막 행이 반쯤 걸쳐 "아래에 더 있다"를 말한다 — 행 경계로 자르면 상자 아래에
     * 맨 석재 면이 남는다(지시 수신소 실화면 확인).
     */
    const content = makeScrollArea(host, {
      x: BOX_L.x,
      y: BOX_L.y,
      w: BOX_L.w,
      h: BOX_L.h,
      totalH: total,
      get: () => this.listScrollY,
      set: (v) => {
        this.listScrollY = v;
      },
      thumb: true,
    });

    let cy = 0;
    PLANETS.forEach((p, i) => {
      const h = hs[i] ?? ROW_H;
      const node = this.makePlanetRow(p, BOX_L.w, h);
      node.position.set(0, cy);
      content.addChild(node);
      cy += h + ROW_GAP;
    });
  }

  /** 행성 1행 — 오브(1:1 64px) + 이름 + 부제, 오른쪽에 인기 보상 배율. */
  private makePlanetRow(p: PlanetMeta, w: number, h: number): Container {
    const selected = p.id === this.planet;
    const accent = hexColor(p.accent);

    const node = new Container();
    // 클릭은 **행 Container** 가 받는다(바탕 Graphics 에 걸면 위 텍스트가 삼킨다).
    attachRowClick(node, () => this.selectPlanet(p.id));
    node.addChild(rowPlate(w, h, selected));

    // 실 자산(PixelLab 생성 64px 행성)이 있으면 1:1 로 쓰고, 없으면 코드 오브(6종 중 2종).
    const orbTex = this.ui[`ui_planet_${p.id}.png`];
    const orb = orbTex ? new Sprite(orbTex) : makeOrb(ORB_D, accent);
    if (orbTex) {
      orb.width = ORB_D;
      orb.height = ORB_D;
    }
    orb.position.set(ROW_PAD, Math.round((h - ORB_D) / 2));
    node.addChild(orb);

    const textX = ROW_PAD + ORB_D + ORB_GAP;
    const textW = w - textX - ROW_PAD - ROW_REWARD_W;
    // 행 높이가 늘어나도 두 줄이 세로 가운데에 남게 위쪽 여백을 파생시킨다.
    const top = Math.round((h - 52) / 2);

    const name = this.label(p.name, 24, selected ? COLOR.gold : COLOR.cream, '800', textW);
    name.position.set(textX, top);
    node.addChild(name);

    const sub = this.label(p.subtitle, 16, COLOR.muted, '400', textW);
    sub.position.set(textX, top + 30);
    node.addChild(sub);

    // 행성 인기 보상 배율(ADR-0038) — **실수치 상시 노출**이 결정 사항이다. 감추면 플레이어가
    // "왜 여기가 더 잘 나오지?"를 추측하게 되고, 그 추측은 대개 미신이 된다. 중립(×1.00)이든
    // 아니든 항상 같은 자리에 같은 형식으로 찍어 비교 가능하게 둔다.
    // 색은 방향 신호: 상향=금색(가라), 하향=흐림(덜 준다), 중립=크림.
    const centi = multCentiFor(p.id);
    const mult = this.label(
      t('planet.rewardMult', { x: (centi / 100).toFixed(2) }),
      18,
      centi > NEUTRAL_MULT_CENTI
        ? COLOR.gold
        : centi < NEUTRAL_MULT_CENTI
          ? COLOR.muted
          : COLOR.cream,
      '700',
      ROW_REWARD_W - 8,
    );
    mult.anchor.set(1, 0.5);
    mult.position.set(w - ROW_PAD, h / 2);
    node.addChild(mult);

    return node;
  }

  // --- 출격 제원 열 ---------------------------------------------------------

  /**
   * 출격 제원 — 챔버 둘이 상자 폭을 **등호로** 나눠 갖는다(침략 단계 · 촉매 주입).
   *
   * 챔버 안 콘텐츠는 위에서부터 채워 아래 여백이 한 칸만 남는다. 세로 중앙 정렬을 쓰지 않는
   * 이유는 두 챔버의 콘텐츠 줄 수가 달라 중앙 정렬하면 서로 어긋나 보이기 때문이다.
   */
  private renderOps(): void {
    const host = this.opsHost;
    if (host === null) return;
    this.clearHost(host);

    const stageX = BOX_O.x;
    const catX = BOX_O.x + STAGE_CH_W + CHAMBER_GAP;
    host.addChild(recessedWell(stageX, BOX_O.y, STAGE_CH_W, BOX_O.h));
    host.addChild(recessedWell(catX, BOX_O.y, CAT_CH_W, BOX_O.h));

    this.renderStageChamber(host, stageX, BOX_O.y);
    this.renderCatalystChamber(host, catX, BOX_O.y);
  }

  /**
   * 침략 단계 챔버(ADR-0022). 초기 3버튼(`−`/값/`+`)은 한 번에 한 단계만 움직여, 개방 상한이
   * 10 이상인 지금은 목표 단계까지 여러 번 눌러야 했다. 그래서 같은 한 행에 **큰 걸음
   * (±{@link stageBigStep})과 최소/최대 점프(`≪`/`≫`)** 를 더한다 — `−`/`+` 한 칸 조절은
   * 정밀 조정용으로 그대로 남는다. 사양은 순수 함수({@link stageControlSpecs})가 만들고 여기서는
   * 버튼으로 옮겨 그릴 뿐이라, 모든 이동이 `setStage`(→ clamp) 한 지점을 지난다.
   */
  private renderStageChamber(host: Container, x: number, y: number): void {
    const cap = this.openCap();
    const innerW = STAGE_CH_W - CH_PAD * 2;

    const head = this.label(t('planet.stageLabel'), 20, COLOR.gold, '800', innerW / 2);
    head.position.set(x + CH_PAD, y + STAGE_HEAD_Y);
    host.addChild(head);

    const desc = this.label(
      t('planet.stageDesc', { stage: this.selectedStage, cap }),
      18,
      SLAB_BODY_FILL,
      '400',
      innerW / 2,
    );
    desc.anchor.set(1, 0);
    desc.position.set(x + STAGE_CH_W - CH_PAD, y + STAGE_HEAD_Y + 3);
    host.addChild(desc);

    const specs = stageControlSpecs(this.selectedStage, cap);
    // 행 전체를 챔버 안에서 가운데 정렬 — 파낸 면 밖으로는 절대 나가지 않는다.
    const rowW = stageRowWidth(specs);
    let bx = x + CH_PAD + Math.max(0, Math.floor((innerW - rowW) / 2));

    for (const spec of specs) {
      const btn = this.chromeButton({
        // 현재 단계 칸만 금색(값이 어디 있는지가 이 행의 유일한 상태다). 비활성 버튼에는
        // 금색을 쓰지 않는다 — alpha 0.4 + 어두운 라벨이 겹쳐 글자가 통째로 사라진다.
        tone: spec.current === true ? 'gold' : 'stone',
        width: spec.width,
        height: STAGE_ROW_H,
        fontSize: spec.fontSize,
        label: spec.label,
        // 현재 단계 칸은 표시 전용(비활성). 나머지는 절대 목표 단계로 이동한다.
        onClick: spec.current === true ? () => {} : () => this.setStage(spec.target),
      });
      if (spec.current === true) {
        // ⚠️ **현재 값 칸에는 `setEnabled(false)` 를 쓰지 않는다.** 이 칸은 금색인데
        // `setEnabled(false)` 는 container alpha 를 0.4 로 낮추고 그림자를 끄므로, 금색 바탕 +
        // 어두운 라벨과 겹쳐 **글자가 통째로 사라진다**(형제 화면에서 실화면으로 확인한 조합).
        // 표시 전용이라는 뜻은 "흐리다"가 아니라 "누를 수 없다"이므로 이벤트만 끊는다.
        btn.container.eventMode = 'none';
        btn.container.cursor = 'default';
      } else if (!spec.enabled) {
        // 비활성 칸은 크림 라벨인 `stone` 이라 alpha 0.4 에서도 읽힌다.
        btn.setEnabled(false);
      }
      // 챔버(파낸 면)는 클릭을 받지 않으므로 행 전파를 끊을 필요가 없다 — 목록 행 안 버튼과
      // 달리 여기 버튼은 어떤 클릭 대상 위에도 얹혀 있지 않다.
      btn.container.position.set(bx, y + STAGE_ROW_Y);
      host.addChild(btn.container);
      bx += spec.width + STAGE_BTN_GAP;
    }
  }

  /**
   * 촉매 주입 챔버(ADR-0029). 현재 주입 요약 + [주입 편집] 버튼. 편집은 픽커 팝업
   * (`CatalystPicker`)에서 하고, 확정된 배열을 여기 상태에 반영해 출격 때 sel 로 넘긴다.
   * ⚠️ 그 모듈은 다른 화면도 쓸 수 있으므로 **한 줄도 고치지 않는다** — 자리만 새로 잡았다.
   */
  private renderCatalystChamber(host: Container, x: number, y: number): void {
    const innerW = CAT_CH_W - CH_PAD * 2;

    const head = this.label(t('catalyst.panel.title'), 20, COLOR.gold, '800', innerW);
    head.position.set(x + CH_PAD, y + STAGE_HEAD_Y);
    host.addChild(head);

    // 주입 요약: 개수 + 주입한 촉매 이름(잘림). 미주입인데 보유가 있으면 첫 주입을 유도하는 힌트
    // (해금 게이트 부재 — 첫 획득 즉시 주입 가능, ADR-0029 온보딩). 보유도 없으면 기본 안내.
    const n = this.injectedCatalysts.length;
    const ownedTypes = this.inventory.size;
    const summary =
      n > 0
        ? `${t('catalyst.panel.count', { n, cap: SLOT_CAP })} — ${this.injectedNames()}`
        : ownedTypes > 0
          ? t('catalyst.panel.available', { n: ownedTypes })
          : t('catalyst.panel.none');
    // 색: 주입 있으면 크림, 보유만 있으면 골드(첫 주입 넛지), 둘 다 없으면 뮤트.
    const fill = n > 0 ? COLOR.cream : ownedTypes > 0 ? COLOR.gold : COLOR.muted;
    const sum = this.wrapped(summary, 16, fill, innerW, 22);
    sum.position.set(x + CH_PAD, y + STAGE_HEAD_Y + 32);
    host.addChild(sum);

    const btnH = 52;
    const edit = this.chromeButton({
      tone: 'stone',
      width: innerW,
      height: btnH,
      fontSize: 20,
      label: t('catalyst.panel.edit'),
      onClick: () => this.openCatalystPicker(),
    });
    edit.container.position.set(x + CH_PAD, y + BOX_O.h - CH_PAD - btnH);
    host.addChild(edit.container);
  }

  /** 주입한 촉매 이름을 콤마로 이어 붙인다(요약용, i18n name). */
  private injectedNames(): string {
    return this.injectedCatalysts
      .map((id) => {
        const def = catalystById(id);
        return def === undefined ? '' : t(`catalyst.${def.slug}.name` as MessageKey);
      })
      .filter((s) => s !== '')
      .join(', ');
  }

  /**
   * 촉매 주입 픽커 팝업을 연다(하네스 훅 지점 — public). 확정된 배열을 주입 상태에 반영하고
   * 성계 지도를 다시 그린다. 보유 스냅샷·현재 행성을 픽커에 넘겨 슬롯 상한·특산 정합을 강제한다.
   */
  openCatalystPicker(): void {
    this.picker.show({
      planet: this.planet,
      injected: this.injectedCatalysts,
      inventory: this.inventory,
      onConfirm: (ids) => {
        // 정규화(오름차순·중복 보존·미지 제거)로 저장 — consume·해시 정본과 같은 형태.
        this.injectedCatalysts = normalizeCatalystArray(ids);
        this.refresh();
      },
    });
  }

  // --- 하네스 훅(Lane 5 접점) ----------------------------------------------

  /** 현재 주입된 촉매 id(복사본). 하네스가 출격 상태를 읽는 접점. */
  getInjectedCatalysts(): number[] {
    return this.injectedCatalysts.slice();
  }

  /** 주입 촉매를 직접 세팅한다(하네스 셋업용). 현재 행성 특산 정합에 맞게 정리한다. */
  setInjectedCatalysts(ids: readonly number[]): void {
    this.injectedCatalysts = normalizeCatalystArray([...ids]);
    this.pruneInjectedForPlanet();
    if (this.root.visible) this.refresh();
  }

  /** 보유 원장 스냅샷을 직접 주입한다(하네스 모의 — 서버 조회 우회). */
  setCatalystInventory(inv: CatalystInventory): void {
    this.inventory = inv;
    if (this.root.visible) this.refresh();
  }
}
