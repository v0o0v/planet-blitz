/**
 * 기록 보관소 — 서사 열람 시설 (스토리 시스템 Phase C2 · 2026-08-03 AAA 시네마틱 전환)
 * · 레인 계약 `.omc/plans/records-archive-aaa-2026-08-03.md`.
 *
 * 기지 맵에서 진입하는 전체 화면(`main.ts:806 openArchive()`). **suspend/resume 은 없다** —
 * `show(profile, {onBack, onReplayIntro})` / `hide()` 규약이고 공개 인터페이스는 한 줄도
 * 바뀌지 않았다.
 *
 * ---------------------------------------------------------------------------
 * ## 시네마틱 전환에서 바뀐 것은 **바탕과 배치**뿐이다
 * `nineSlicePanel`(나무) → `makeCinematicPanel`(석재), `makeBanner` → `makeHangarTitle`,
 * `makeTabBar`(나무) → 이 파일의 시네마틱 탭, `listRowBg` → 석재 행 판(`rowPlate`),
 * 단색 배경 → `HangarBackdrop`. 해금·수집 판정은 손대지 않았다(읽기 전용).
 *
 * ## 왜 여기는 **창을 뚫지 않는가**(챔피언 선택·방어 사령부는 뚫었다)
 * 형제 화면 아홉의 결론은 "창은 배경이 보이는 구멍이 아니라 **무언가를 보여주는 자리**"였다.
 * 여기서 후보는 파일럿 파일의 **기체 초상**뿐인데 `assets/ship_portrait_*.png` 는 전부
 * **128×128** 이다. 상세 패널의 개구부(`cinematicWindowOpening(1108, 776, true)` = 1094×702)에
 * 채우면 5.4배 확대로 뭉개지고, 정사각을 세로 창에 넣으면 위아래에 맨 배경 띠가 생긴다 —
 * 방어 사령부에서 사용자가 신고한 바로 그 형태다. 게다가 **기록 파편 탭에는 세울 피사체가 아예
 * 없다**: 두 탭이 같은 패널 기하를 써야 재건 없이 전환되는데 한쪽에서 개구부가 빈다.
 * 그래서 패널 둘 다 `slab`, 배경 `windows: []`. 초상은 상세 열 안의 **파낸 챔버**에 앉는다.
 *
 * ## 팝업을 없애고 **2열 목록/상세**로 갔다
 * 옛 구현은 행을 누르면 `makePilotFileModal`(나무 팝업)이 떴다. 2열이면 상세 열이 **행을 바꿀
 * 때마다 바뀌는 자리**가 되어 두 탭 모두 오른쪽이 비지 않고, 팝업 암막 알파를 실측할 일도
 * 캔버스 위 DOM 을 걷어낼 일도 없다(이 화면에는 팝업이 0). 기록 파편 본문이 목록 행 안에서
 * 세로로 늘어나던 **가변 행 높이**도 함께 사라졌다(높이를 역산할 수 없는 구조였다).
 * 그 팝업 모듈(`storyModal.ts`)은 소비처가 이 화면 하나뿐이어서 이 전환에서 삭제했다.
 *
 * ## **프롤로그 탭을 없앴다** — 탭 하나 전체가 버튼 하나였다
 * 안내 한 문단 + 버튼 하나가 전부라 1400×760 패널이 그것만을 위해 있었다(방어 사령부가 같은
 * 형태의 `모듈` 탭을 없앤 것과 같은 판단). `[프롤로그 다시 보기]` 는 **하단 액션 띠**로 내려
 * 상시 표시하고, 안내 문단은 인트로 슬라이드 본인이 이미 말하므로 여기서 다시 쓰지 않는다.
 * `onReplayIntro` 왕복 계약(보관소 위 오버레이 → 끝나면 `openArchive()` 재진입)은 그대로다.
 *
 * ## 빈 자리를 남기지 않는다 — 잠긴 파편은 **불 꺼진 소켓**이다
 * 목록이 짧으면 {@link fillRowHeights} 로 행이 남는 세로를 나눠 갖는다. 기록 파편은 대부분
 * 잠긴 상태가 정상이므로(에코 신호로만 열린다) 잠긴 행은 볼록한 {@link rowPlate} 가 아니라
 * **파낸 소켓**({@link recessedWell})으로 그린다 — "잠겨 있다"를 조명 부호가 말한다.
 * ⚠️ **`?` 글리프는 얹지 않는다**: 관제탑에서 잠금 표식으로 `?` 를 크게 찍었더니 화면에서 가장
 * 튀는 물체가 됐다(사용자 신고 2026-08-03). 몇 개가 열렸는지는 탭 줄 오른쪽 `n / N` 이 말한다.
 *
 * ## 여기서 밟기 쉬운 함정 (전부 실측 근거)
 * - ⚠️ **크롬(헤더·탭·하단 띠)은 패널보다 뒤에 붙인다.** Pixi v8 은 자식을 역순으로 훑다가
 *   픽셀에 걸리면 거기서 멈추고 가장 가까운 상호작용 조상을 반환한다 — 그림자 스프라이트가
 *   passive 여도 탐색은 끝난다. 석재 패널은 접지 그림자를 텍스처에 구워 자기 사각보다 30px
 *   가까이 번지므로, 먼저 붙은 탭은 아래 절반을 통째로 빼앗긴다(방어 사령부 실제 신고).
 * - ⚠️ 탭 흐림은 `PixiButton` container 가 아니라 감싸는 host 에 건다(`pointerout` 이 alpha 를
 *   1로 되돌려 스쳐 지나가기만 해도 미선택 흐림이 영영 풀린다).
 * - **행 클릭은 행 Container 에.** 바탕 Graphics 에 걸면 위에 얹힌 텍스트가 클릭을 삼킨다.
 * - **휠은 클립 Container 에.** 마스크 Graphics 는 히트 테스트에서 제외된다.
 * - 컬러 이모지 금지(`text.ts` stripEmoji). `★ ✕ ▶ ◀` 는 보존 목록.
 * - ⚠️ `hudEl()` 에는 **캔버스 가드를 붙이지 않는다**(HUD 숨김이 통째로 죽는다).
 * - ⚠️ 좌상단 x<120 · y<120 은 **설정 톱니 예약 밴드**다. 그래서 탭 줄이 헤더(104)가 아니라
 *   {@link GEAR_BAND_H}(120) 아래에서 시작한다 — 첫 탭이 x 32 라 가로로 겹친다.
 * - ⚠️ 각인 제목은 중앙 정렬 Text 라 사각형이 없어 겹침 테스트가 못 잡는다 —
 *   {@link TITLE_BAND_HALF_W} 로 대역을 못 박는다.
 * - ⚠️ {@link fillRowHeights} 는 **늘려만 준다.** 자연 높이가 상한을 넘으면 패널을 뚫는데 예외도
 *   로그도 없다 — 사연 챕터는 본문 길이로 넘칠 수 있어 스크롤을 붙였다.
 *
 * ## 재렌더 규율
 * 옛 구현은 `render()` 가 루트를 통째로 지우고 다시 그렸다 — 탭 전환 한 번, 행 클릭 한 번마다
 * 배경과 석재 패널이 다시 **구워진다**. 그래서
 *  - `buildChrome()` 은 1회(자산 도착 시에만 재건 — **탭 전환으로는 재건하지 않는다**),
 *  - `syncValues()` 가 탭 링·알파와 진행 문구·하단 부제를,
 *  - `renderList()`/`renderDetail()` 이 각자 host 안만 갈아끼운다.
 *  - `update(dt)` 는 `main.ts` 가 매 프레임 부른다(`recordsArchive.update(frame)`). 숨겨져
 *    있으면 즉시 반환하므로 이 화면 밖 비용은 0 이다. ⚠️ 연구소가 이 배선을 빠뜨려 배경·패널
 *    연출이 통째로 멈춘 적이 있다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import type { Profile } from '../../save/profile.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, shipPortraitName, type UiTextures } from './uiTextures.js';
import { PixiButton } from './button.js';
import { stripEmoji } from './text.js';
import { makeScrollArea, rowBounds, clampToRows } from './scrollArea.js';
import { attachRowClick, stopRowPropagation } from './listRow.js';
import { loadHangarTextures, HANGAR_BACKDROP_NAME, type HangarTextures } from './hangarTextures.js';
import { HangarBackdrop } from './hangarBackdrop.js';
import { makeCinematicPanel, type CinematicPanel } from './cinematicPanel.js';
import {
  makeHangarTitle,
  cinematicButtonTexture,
  chromeFallbackColor,
  chromeLabelColor,
  type ChromeTone,
} from './hangarChrome.js';
import { t } from '../../i18n/index.js';
import { SHIP_TYPES, type ShipTypeDef } from '../../../data/ships/index.js';
import { SHIP_STORIES, RECORD_SHARDS, shipStory } from '../../../data/lore/index.js';
import type { ShipStory, RecordShard } from '../../../data/lore/index.js';
import { shipTypeName } from './shipLabels.js';
import {
  chapterNo,
  storyTagline,
  storyChapterTitle,
  storyChapterBody,
  storyQuestHint,
  recordShardTitle,
  recordShardBody,
} from './loreLabels.js';
import {
  chapterUnlocked,
  storyProgressFromProfile,
  unlockedChapterCount,
} from './storyUnlock.js';

export interface RecordsArchiveCallbacks {
  onBack: () => void;
  onReplayIntro: () => void;
}

// ===========================================================================
// 레이아웃(디자인 스페이스 1920×1080) — Pixi 없이 검증되는 순수 서술
//
// 여백 어휘(32 / 28 / 20 / 하단 28)와 헤더 높이 104 는 격납고·촉매 보관함·예비역 로스터·
// 챔피언 선택·연구소·정제소·방어 사령부·관제탑과 **같은 값**이다. 형제끼리 다르면 전환에서 튄다.
// ===========================================================================

/**
 * `cinematicPanel.ts` 콘텐츠 상자 기하의 **복제본**(출처: 그 파일의 `EDGE_PAD 24` ·
 * `CONTENT_GAP 16` · `TITLE_BAND_H = round(TITLE_SIZE 26 × 2)`).
 *
 * 왜 베끼는가: 좌표 서술이 **Pixi 없이** 검증돼야 하는데 패널 상자는 런타임 객체다. 베낀 값이
 * 조용히 어긋나면 내용이 패널 테두리를 뚫는데 예외도 로그도 없다 —
 * `tests/recordsArchiveAaaLayout.test.ts` 가 실제 `makeCinematicPanel(...).box` 와 대조한다.
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
const BOTTOM_PAD = 28;

/**
 * 좌상단 예약 밴드 — `main.ts` SettingsScreen 의 설정 톱니가 쓰는 **전 화면 공용 자리**다.
 * 톱니는 매 프레임 stage 최상위로 올라오므로 여기에 컨트롤을 두면 통째로 클릭 불가가 된다.
 * ⚠️ {@link TAB_Y} 가 이 값에서 파생되므로 **선언 순서를 바꾸지 마라**(TDZ).
 */
export const GEAR_BAND_W = 120;
export const GEAR_BAND_H = 120;

const CONTENT_W = DESIGN_WIDTH - EDGE_X * 2;

/** 탭 둘 — 파일럿 파일 · 기록 파편. 프롤로그 탭은 없앴다(파일 헤더 참조). */
export const ARCHIVE_TAB_STORIES = 0;
export const ARCHIVE_TAB_SHARDS = 1;
export const ARCHIVE_TAB_COUNT = 2;
const ARCHIVE_TAB_KEYS = ['archive.tab.stories', 'archive.tab.shards'] as const;

/**
 * 탭 줄 상단. 헤더 밴드(104) 바로 아래가 아니라 **{@link GEAR_BAND_H}(120) 아래**다 —
 * 첫 탭이 화면 좌측 끝(x 32)에서 시작하므로 설정 톱니 예약 밴드와 가로로 겹치고, 세로로 몇 px
 * 만 물려도 톱니가 매 프레임 맨 앞으로 올라와 그 자리를 통째로 삼킨다(테스트가 잠근다).
 */
const TAB_Y = GEAR_BAND_H + 4;
const TAB_H = 56;
const TAB_GAP = 12;

const LIST_X = EDGE_X;
const LIST_W = 720;
const DETAIL_X = LIST_X + LIST_W + GUTTER_X;
const DETAIL_W = DESIGN_WIDTH - EDGE_X - DETAIL_X;

/** 탭 두 칸이 **목록 열 폭을 정확히 나눠 쓴다** — 탭이 다스리는 것이 목록이기 때문이다. */
const TAB_W = Math.floor((LIST_W - TAB_GAP * (ARCHIVE_TAB_COUNT - 1)) / ARCHIVE_TAB_COUNT);
/** 탭 줄 오른쪽 남는 자리 = 진행 문구(`n / N`)의 자리. 빈 자리가 아니다. */
const PROGRESS_X = LIST_X + LIST_W + GUTTER_X;
const PROGRESS_W = DESIGN_WIDTH - EDGE_X - PROGRESS_X;

/** 하단 액션 띠 — 오른쪽에 [프롤로그 다시 보기], 왼쪽은 부제가 쓴다(빈 자리 0). */
const FOOT_H = 64;
const FOOT_Y = DESIGN_HEIGHT - BOTTOM_PAD - FOOT_H;
const REPLAY_W = 320;
const FOOT_BTN_X = EDGE_X + CONTENT_W - REPLAY_W;

/** 패널 세로는 **남는 자리 전부**다(빈 자리 금지 — 하드코딩하면 여백을 바꿀 때 어긋난다). */
const PANEL_Y = TAB_Y + TAB_H + 16;
const PANEL_TO_FOOT = 16;
const PANEL_H = FOOT_Y - PANEL_TO_FOOT - PANEL_Y;

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
const BOX_D = titledBox(DETAIL_W, PANEL_H);

// --- 헤더 컨트롤(형제 화면과 **같은 x**) ---
const CLOSE_W = 56;
const CLOSE_X = DESIGN_WIDTH - EDGE_X - CLOSE_W;

/**
 * 각인 제목이 실제로 차지하는 가로 반폭. 중앙 정렬 Text 는 사각형이 없어 겹침 테스트가 못
 * 잡는다 — 연구소 실화면에서 제목이 헤더 버튼과 **실제로 겹쳤다**. 대역을 상수로 못 박고
 * 좌우 컨트롤이 이 안에 들어오지 못하게 테스트로 잠근다.
 */
export const TITLE_BAND_HALF_W = 280;

/** 석재 슬래브 위 **보조 텍스트색**(정제소 `SLAB_BODY_FILL` 복제 — 그 파일은 화면이다). */
const SLAB_BODY_FILL = 0xe4dac7;
/** 행 판 바탕색·홈·반경 — 예비역 로스터 `rowPlate` → … → 관제탑 경유 복제. */
const ROW_FACE = 0x3b3327;
const ROW_GROOVE = 0x17130d;
const ROW_RADIUS = 10;

// --- 목록/상세 기하 ---
const ROW_GAP = 10;
const ROW_PAD = 16;

/** 파일럿 파일 행 — 초상 썸네일 + 이름 + 태그라인 + 해금 `n / 3`. */
const STORY_ROW_H = 84;
const STORY_ROW_MAX_H = 132;
const STORY_THUMB = 64;
const STORY_TEXT_X = 88;
/** 우측 해금 카운트가 먹는 폭(글자 + 여백) — 이름·태그라인 폭이 여기서 파생된다. */
const STORY_COUNT_W = 96;

/** 기록 파편 행 — 제목 한 줄(잠금이면 '잠김'). 본문은 상세 열이 말한다. */
const SHARD_ROW_H = 72;
const SHARD_ROW_MAX_H = 120;

/** 상세(파일럿) 맨 위 초상 블록 — 정사각 챔버 + 오른쪽 이름·태그라인·해금 수. */
const PORTRAIT_WELL = 200;
const PORTRAIT_ART = 160;
const DETAIL_BLOCK_GAP = 16;
/** 챕터 챔버 상한. 셋뿐이라 상한이 없으면 한 장이 468px 를 통째로 먹는다. */
const CHAPTER_MAX_H = 260;
/** 챕터 챔버가 최소한 담아야 하는 세로(머리글 + 본문 두 줄) — 열 폭 하한을 되짚는 값이다. */
const CHAPTER_MIN_H = 96;

/** 상세(파편) 제목 챔버 높이. 본문 챔버는 상자 바닥까지 내려간다. */
const SHARD_HEAD_H = 72;

/** 화면 좌표 사각형(디자인 스페이스). */
export interface ArchiveRect {
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
 * ⚠️ **인자를 받지 않는 것 자체가 계약**이다 — 탭·선택 상태로 기하가 갈리면 전환마다 배경과
 * 석재를 다시 구워야 한다.
 */
export function recordsArchiveLayout(): {
  readonly screen: ArchiveRect;
  readonly headerH: number;
  readonly tabs: readonly ArchiveRect[];
  readonly progress: ArchiveRect;
  readonly panels: readonly { readonly id: string; readonly rect: ArchiveRect }[];
  readonly footer: { readonly band: ArchiveRect; readonly buttons: readonly ArchiveRect[] };
  readonly headerControls: readonly { readonly id: string; readonly rect: ArchiveRect }[];
  /** 배경이 보존되는 창 — **없다**(파일 헤더 "왜 여기는 창을 뚫지 않는가"). */
  readonly windows: readonly ArchiveRect[];
} {
  const tabs: ArchiveRect[] = [];
  for (let i = 0; i < ARCHIVE_TAB_COUNT; i++) {
    tabs.push({ x: EDGE_X + i * (TAB_W + TAB_GAP), y: TAB_Y, w: TAB_W, h: TAB_H });
  }
  return {
    screen: { x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT },
    headerH: HEADER_H,
    tabs,
    progress: { x: PROGRESS_X, y: TAB_Y, w: PROGRESS_W, h: TAB_H },
    panels: [
      { id: 'list', rect: { x: LIST_X, y: PANEL_Y, w: LIST_W, h: PANEL_H } },
      { id: 'detail', rect: { x: DETAIL_X, y: PANEL_Y, w: DETAIL_W, h: PANEL_H } },
    ],
    footer: {
      band: { x: EDGE_X, y: FOOT_Y, w: CONTENT_W, h: FOOT_H },
      buttons: [{ x: FOOT_BTN_X, y: FOOT_Y, w: REPLAY_W, h: FOOT_H }],
    },
    headerControls: [{ id: 'close', rect: { x: CLOSE_X, y: HEAD_Y, w: CLOSE_W, h: HEAD_H } }],
    windows: [],
  };
}

/** 패널 콘텐츠 상자와 그 안의 고정 블록(단위 테스트가 실제 패널 상자와 대조한다). */
export const ARCHIVE_BOXES = {
  list: { x: BOX_L.x, y: BOX_L.y, w: BOX_L.w, h: BOX_L.h, bottom: BOX_L.bottom },
  detail: { x: BOX_D.x, y: BOX_D.y, w: BOX_D.w, h: BOX_D.h, bottom: BOX_D.bottom },
  rowGap: ROW_GAP,
  storyRowH: STORY_ROW_H,
  storyRowMaxH: STORY_ROW_MAX_H,
  shardRowH: SHARD_ROW_H,
  shardRowMaxH: SHARD_ROW_MAX_H,
  /** 목록 행에서 썸네일·해금 카운트가 먹고 남는 글자 폭 — 하한이 있어야 이름이 안 뭉개진다. */
  storyTextW: BOX_L.w - STORY_TEXT_X - STORY_COUNT_W,
  portraitWell: PORTRAIT_WELL,
  blockGap: DETAIL_BLOCK_GAP,
  chapterMaxH: CHAPTER_MAX_H,
  chapterMinH: CHAPTER_MIN_H,
  shardHeadH: SHARD_HEAD_H,
  /** 탭 폭·간격(탭 줄이 목록 열을 정확히 덮는지 테스트가 되짚는다). */
  tabW: TAB_W,
  tabGap: TAB_GAP,
  listW: LIST_W,
} as const;

/**
 * 남는 세로를 행에 **고르게 나눈** 새 높이 배열(순수 함수 — Pixi 미의존).
 *
 * 넘치면(스크롤이 붙으면) 입력 그대로 돌려준다. 반올림 잔여는 **행 수 미만**이다.
 *
 * ⚠️ **상한은 늘리기만 막는다. 자연 높이를 깎지 않는다.** `Math.min(maxH, h + add)` 만 쓰면
 * 자연 높이가 상한보다 큰 행이 **줄어들어** 내용이 판 밖으로 삐져나온다 — 바탕 판은 최종
 * 높이로 그려지는데 글자는 이미 자연 높이만큼 자라 있기 때문이다(코어 모듈 화면의 같은 산술
 * 복제본에서 실제로 터졌다). 그래서 `Math.max(h, ...)` 로 감싼다.
 * (방어 사령부 `fillRowHeights` 복제 — 그 파일은 공용 모듈이 아니라 화면이다.)
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

// --- 행 판 조명 램프(모듈 1회 굽기) ------------------------------------------

/**
 * 행 판의 **방향성 조명**을 위한 세로 알파 램프.
 *
 * ⚠️ 띠를 겹쳐 그라디언트를 근사하지 않는다 — 1px 겹침이 알파를 두 배로 만들어 가로줄이 생긴다
 * (실제 사용자 신고). 폭 1px 캔버스에 픽셀로 굽고 `linear` 로 늘린다.
 *
 * (예비역 로스터 `rowRamp` → … → 관제탑 경유 복제. 형제 화면이라 같은 값이어야 하고, 그
 * 파일들은 공용 모듈이 아니라 화면이라 import 하지 않는다.)
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
 * **선은 긋지 않는다.** 행 사이 구분은 이 그림자와 행 간격이 만든다(세로 리브·가로 이음선은
 * 사용자가 격납고에서 삭제를 지시한 것들이다). 선택은 금색 링이 말한다.
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
 * **파낸 면** 한 장(초상 챔버 · 챕터 · 잠긴 파편 행 · 빈 자리가 공유한다). 볼록한
 * {@link rowPlate} 와 조명 부호가 정확히 반대다: 위가 그늘이고 **아래 입술만** 빛을 받는다.
 * 이 부호가 뒤집히면 파인 자리가 아니라 얹어 놓은 판때기로 읽힌다.
 * (정제소 `recessedWell` → … → 관제탑 경유 복제 — 그 파일들은 공용 모듈이 아니라 화면이다.)
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

/** ShipStory → 그 기체 타입 정의(초상·표시명이 요구). slug 로 레지스트리를 찾는다. */
function defForStory(story: ShipStory): ShipTypeDef | undefined {
  return SHIP_TYPES.find((d) => d.slug === story.slug);
}

/**
 * 수집한 기록 파편 id 집합. Phase E 에서 `collectedShards` 가 프로필 **정식 필드**가 됐다
 * (`src/save/profile.ts:186` · v5→v6 마이그레이션이 빈 배열로 채운다). 이 화면은 읽기만 한다.
 */
function collectedShardIds(profile: Profile): ReadonlySet<string> {
  return new Set(profile.collectedShards);
}

export class RecordsArchiveScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private ui: UiTextures = {};
  private art: HangarTextures = {};

  private profile: Profile | null = null;
  private onBack: (() => void) | null = null;
  private onReplayIntro: (() => void) | null = null;

  private tab = ARCHIVE_TAB_STORIES;
  /** 탭별 선택(진입 시 첫 항목이 이미 선택돼 있어 상세 열이 비지 않는다). */
  private selectedStory: string | null = null;
  private selectedShard: string | null = null;
  /** 탭별 목록 스크롤 + 상세 스크롤(재렌더 사이 유지). */
  private readonly listScrollY = new Array<number>(ARCHIVE_TAB_COUNT).fill(0);
  private detailScrollY = 0;

  /** 진입 전 런 HUD 의 visibility — 닫을 때 **원래 값으로** 되돌린다(무조건 '' 금지). */
  private hudPrevVisibility: string | null = null;

  // --- 크롬(1회 조립) ---
  private backdrop: HangarBackdrop | null = null;
  private panels: CinematicPanel[] = [];
  private chromeBuilt = false;
  private listHost: Container | null = null;
  private detailHost: Container | null = null;
  private progressNode: Text | null = null;
  private footNote: Text | null = null;
  private tabButtons: { ring: Graphics; host: Container }[] = [];

  constructor(stage: Container) {
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    // UI 킷·배경 텍스처 비동기 로드 — 완료 후 열려 있으면 크롬을 다시 세운다(구운 텍스처가
    // 바뀌므로 갱신으로는 안 된다).
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

  /** 배경·석재 패널 연출 진행. `main.ts` 가 매 프레임 부른다 — 숨겨져 있으면 즉시 반환. */
  update(dt: number): void {
    if (!this.root.visible) return;
    this.backdrop?.update(dt);
    for (const p of this.panels) p.update(dt);
  }

  show(profile: Profile, cb: RecordsArchiveCallbacks): void {
    this.profile = profile;
    this.onBack = cb.onBack;
    this.onReplayIntro = cb.onReplayIntro;
    this.tab = ARCHIVE_TAB_STORIES;
    this.listScrollY.fill(0);
    this.detailScrollY = 0;
    // 첫 항목을 미리 고른다 — 상세 열이 진입부터 무언가를 보여 준다(빈 자리 금지).
    this.selectedStory = SHIP_STORIES[0]?.slug ?? null;
    this.selectedShard = RECORD_SHARDS[0]?.id ?? null;

    this.buildChrome();
    this.refresh();
    this.root.visible = true;
    this.raise();
    this.hideRunHud();
  }

  hide(): void {
    this.root.visible = false;
    this.profile = null;
    this.onBack = null;
    this.onReplayIntro = null;
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

  /** 원래 값으로 되돌린다 — 옛 구현은 무조건 `''` 로 되살려 런 중 HUD 상태를 덮어썼다. */
  private restoreRunHud(): void {
    const el = this.hudEl();
    if (el !== null && this.hudPrevVisibility !== null) el.style.visibility = this.hudPrevVisibility;
    this.hudPrevVisibility = null;
  }

  // --- 상호작용 -------------------------------------------------------------

  private setTab(i: number): void {
    if (i === this.tab || i < 0 || i >= ARCHIVE_TAB_COUNT) return;
    this.tab = i;
    this.detailScrollY = 0;
    this.refresh();
  }

  /** `hide()` 가 콜백을 비우므로 **먼저 캡처**한다(관제탑과 같은 순서 계약). */
  private back(): void {
    const cb = this.onBack;
    this.hide();
    cb?.();
  }

  /**
   * 인트로는 보관소 **위 오버레이**로 뜨고 끝나면 `main.ts` 가 `openArchive()` 로 이 화면을
   * 다시 세운다 — 그래서 여기서 `hide()` 를 부르지 않는다(옛 구현과 같은 왕복 계약).
   */
  private replayIntro(): void {
    this.onReplayIntro?.();
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

  private wrapped(
    text: string,
    size: number,
    color: number,
    w: number,
    weight: '400' | '700' | '800' = '400',
    lineHeight?: number,
  ): Text {
    return new Text({
      resolution: 2,
      text: stripEmoji(text),
      style: {
        fontFamily: UI_FONT,
        fontSize: size,
        fontWeight: weight,
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
      onClick: o.onClick,
    });
  }

  /**
   * 비어 있는 자리를 **파낸 챔버**로 그리고 그 안에서 안내한다. "빈 패널 면"이 아니라 "비어
   * 있는 챔버"가 되면 그 자리가 쓸모도 볼거리도 아닌 자리이기를 멈춘다(정제소 처방).
   */
  private emptyWell(
    host: Container,
    box: { x: number; y: number; w: number; h: number },
    text: string,
  ): void {
    host.addChild(recessedWell(box.x, box.y, box.w, box.h));
    const el = this.wrapped(text, 19, SLAB_BODY_FILL, Math.max(80, box.w - 72));
    el.anchor.set(0.5, 0.5);
    el.position.set(box.x + box.w / 2, box.y + box.h / 2);
    host.addChild(el);
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
    for (const p of this.panels) p.destroy();
    this.panels = [];
    this.listHost = null;
    this.detailHost = null;
    this.progressNode = null;
    this.footNote = null;
    this.tabButtons = [];
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
    // 자식이라 어긋난다). **창은 없다** — 파일 헤더 "왜 여기는 창을 뚫지 않는가".
    const backdrop = new HangarBackdrop(this.art[HANGAR_BACKDROP_NAME], {
      windows: [],
      headerH: HEADER_H,
    });
    this.root.addChild(backdrop.view);
    this.backdrop = backdrop;

    /**
     * ⚠️ **크롬(헤더·탭·하단 띠)은 패널보다 뒤에 붙여 위로 올린다.**
     *
     * 사용자 신고(2026-08-02, 방어 사령부) "탭 아래 절반이 클릭이 안 된다"의 실체가 이 순서였다.
     * 석재 패널은 접지 그림자·글로우를 텍스처에 구워 넣어 **자기 사각보다 30px 가까이 번지고**,
     * 그 번짐이 위 컨트롤을 덮었다. Pixi v8 은 자식을 역순으로 훑다가 **픽셀에 걸리면 거기서
     * 멈추고 가장 가까운 상호작용 조상**을 반환하므로 그림자가 passive 여도 탐색은 끝난다.
     * ⚠️ 여백을 벌리는 것으로는 못 푼다 — 번짐 폭은 패널 치수에서 파생돼 조용히 커진다.
     */
    const listPanel = this.addPanel(LIST_X, PANEL_Y, LIST_W, PANEL_H, t('archive.list.head'));
    const detailPanel = this.addPanel(DETAIL_X, PANEL_Y, DETAIL_W, PANEL_H, t('archive.detail.head'));

    const listHost = new Container();
    listPanel.container.addChild(listHost);
    this.listHost = listHost;
    const detailHost = new Container();
    detailPanel.container.addChild(detailHost);
    this.detailHost = detailHost;

    // 크롬은 여기서부터 — 패널 위에 얹힌다(바로 위 주석이 근거).
    this.buildHeader();
    this.buildTabs();
    this.buildFooter();

    this.chromeBuilt = true;
  }

  /**
   * 석재 패널 한 장을 세운다.
   *
   * ⚠️ `screenX`/`screenY` 를 **반드시 넘긴다.** 안 넘기면 같은 치수의 패널끼리 조명·랜드마크
   * 시드가 같아져 위치별 조명이 조용히 무효가 된다 — 화면은 정상적으로 서고 테스트도 통과하므로
   * 눈으로만 잡히는 유형이다.
   */
  private addPanel(px: number, py: number, pw: number, ph: number, title: string): CinematicPanel {
    const panel = makeCinematicPanel({
      width: pw,
      height: ph,
      variant: 'slab',
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
   * 헤더 밴드(y 0..{@link HEADER_H}) — 각인 제목(중앙) · 닫기(우).
   *
   * ⚠️ **재화 칩은 두지 않는다.** 이 화면은 크레딧·광물을 쓰지 않는다 — 형제 화면의 칩 x
   * (1424/1628)는 재화를 쓰는 화면의 어휘이고, 안 쓰는 화면에 얹는 것은 "그 화면의 결정을 돕지
   * 않는 진입점"이다. ⚠️ 좌측은 **비워 둔다**(설정 톱니 예약 밴드).
   */
  private buildHeader(): void {
    const title = makeHangarTitle(t('archive.title'));
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
   * 탭 두 칸(목록 열 폭을 정확히 나눠 쓴다) + 오른쪽 진행 문구.
   *
   * 나무 `makeTabBar` 를 버리고 방어 사령부·정제소와 **같은 어휘**를 쓴다 — 금색 링 + 미선택
   * 0.72. 톤을 바꾸면 활성/비활성마다 버튼을 다시 구워야 하는데(텍스처가 톤별로 구워진다) 탭은
   * 자주 바뀌므로 링·알파로 상태를 말한다.
   */
  private buildTabs(): void {
    for (let i = 0; i < ARCHIVE_TAB_COUNT; i++) {
      const x = EDGE_X + i * (TAB_W + TAB_GAP);
      const host = new Container();
      host.position.set(x, TAB_Y);
      const select = (): void => this.setTab(i);
      const btn = this.chromeButton({
        tone: 'stone',
        width: TAB_W,
        height: TAB_H,
        fontSize: 20,
        label: t(ARCHIVE_TAB_KEYS[i] ?? 'archive.tab.stories'),
        onClick: select,
      });
      host.addChild(btn.container);

      const ring = new Graphics();
      ring
        .roundRect(0, 0, TAB_W, TAB_H, 12)
        .stroke({ color: COLOR.gold, width: 3, alignment: 1, alpha: 0.95 });
      ring.visible = false;
      // 링은 히트 테스트에서 빠져야 한다 — 안 그러면 활성 탭의 클릭을 링이 삼킨다.
      ring.eventMode = 'none';
      host.addChild(ring);

      /**
       * ⚠️ **판 전체를 host 가 받는다.** 사용자 신고(2026-08-02, 방어 사령부): "위 버튼들의
       * **아래 절반**이 클릭이 안 된다". `PixiButton` 은 자기 container 에 hitArea 를 걸지만
       * 그것만 믿으면 그려진 판과 판정 사각이 어긋나는 순간 **예외도 로그도 없이** 절반이 죽는다.
       * 버튼이 먼저 받으면 `stopRowPropagation` 이 host 까지 올라가는 것을 끊으므로 **두 번
       * 발동하지 않는다**(안 끊으면 UI 음이 두 번 난다).
       */
      host.eventMode = 'static';
      host.cursor = 'pointer';
      host.hitArea = new Rectangle(0, 0, TAB_W, TAB_H);
      host.on('pointertap', select);
      stopRowPropagation(btn.container);

      this.root.addChild(host);
      this.tabButtons.push({ ring, host });
    }

    // 탭 줄 오른쪽 남는 자리는 **진행 문구**가 쓴다(잠금 표식을 행마다 얹는 대신 여기가 센다).
    const progress = this.label('', 20, COLOR.gold, '700', PROGRESS_W);
    progress.anchor.set(1, 0.5);
    progress.position.set(PROGRESS_X + PROGRESS_W, TAB_Y + TAB_H / 2);
    this.root.addChild(progress);
    this.progressNode = progress;
  }

  /**
   * 하단 액션 띠 — 오른쪽에 [프롤로그 다시 보기], 왼쪽에 부제.
   *
   * 옛 프롤로그 **탭**이 여기로 내려왔다(파일 헤더). 옛 헤더 부제도 여기로 옮겨 왼쪽을 채운다 —
   * 띠 안에 빈 자리가 없다.
   */
  private buildFooter(): void {
    const note = this.label(t('archive.subtitle'), 19, COLOR.muted, '400', FOOT_BTN_X - EDGE_X - 24);
    note.anchor.set(0, 0.5);
    note.position.set(EDGE_X, FOOT_Y + FOOT_H / 2);
    this.root.addChild(note);
    this.footNote = note;

    const replay = this.chromeButton({
      tone: 'gold',
      width: REPLAY_W,
      height: FOOT_H,
      fontSize: 21,
      label: t('archive.intro.replay'),
      onClick: () => this.replayIntro(),
    });
    replay.container.position.set(FOOT_BTN_X, FOOT_Y);
    this.root.addChild(replay.container);
  }

  // --- 갱신 -----------------------------------------------------------------

  /** 값과 목록만 갈아끼운다. 배경·석재 패널은 다시 굽지 않는다(파일 헤더 "재렌더 규율"). */
  private refresh(): void {
    if (!this.chromeBuilt) return;
    this.syncValues();
    this.renderList();
    this.renderDetail();
  }

  private syncValues(): void {
    this.tabButtons.forEach((e, i) => {
      const active = i === this.tab;
      e.ring.visible = active;
      // ⚠️ 흐림은 **host** 에 건다. `PixiButton` 의 pointerover/out 이 자기 container.alpha 를
      // 덮어쓰므로, 버튼에 걸면 한 번 지나가기만 해도 미선택 흐림이 영영 풀린다.
      e.host.alpha = active ? 1 : 0.72;
    });
    if (this.progressNode !== null) this.progressNode.text = stripEmoji(this.progressText());
    if (this.footNote !== null) this.footNote.text = stripEmoji(t('archive.subtitle'));
  }

  /** 탭별 `n / N` — "몇 개가 열렸는가"를 여기 하나가 센다(행마다 잠금 표식을 얹지 않는다). */
  private progressText(): string {
    const profile = this.profile;
    if (profile === null) return '';
    if (this.tab === ARCHIVE_TAB_SHARDS) {
      return t('archive.shards.progress', {
        n: collectedShardIds(profile).size,
        total: RECORD_SHARDS.length,
      });
    }
    let unlocked = 0;
    let total = 0;
    for (const story of SHIP_STORIES) {
      unlocked += unlockedChapterCount(story, storyProgressFromProfile(profile, story));
      total += story.chapters.length;
    }
    return t('archive.stories.progress', { n: unlocked, total });
  }

  // --- 목록 열 -------------------------------------------------------------

  private renderList(): void {
    const host = this.listHost;
    const profile = this.profile;
    if (host === null) return;
    this.clearHost(host);
    if (profile === null) return;

    const shards = this.tab === ARCHIVE_TAB_SHARDS;
    const natural = shards ? SHARD_ROW_H : STORY_ROW_H;
    const maxH = shards ? SHARD_ROW_MAX_H : STORY_ROW_MAX_H;
    const count = shards ? RECORD_SHARDS.length : SHIP_STORIES.length;

    // 남는 세로를 행이 나눠 갖는다(빈 자리 금지 — {@link fillRowHeights}).
    const hs = fillRowHeights(
      Array.from({ length: count }, () => natural),
      ROW_GAP,
      BOX_L.h,
      maxH,
    );
    const bounds = rowBounds(hs, ROW_GAP);
    const total = bounds.length === 0 ? 0 : (bounds[bounds.length - 1] ?? 0);
    const maskH = clampToRows(BOX_L.h, bounds);

    const tab = this.tab;
    const content = makeScrollArea(host, {
      x: BOX_L.x,
      y: BOX_L.y,
      w: BOX_L.w,
      h: maskH,
      totalH: total,
      get: () => this.listScrollY[tab] ?? 0,
      set: (v) => {
        this.listScrollY[tab] = v;
      },
      thumb: true,
    });

    let cy = 0;
    for (let i = 0; i < count; i++) {
      const h = hs[i] ?? natural;
      const row = shards
        ? this.makeShardRow(RECORD_SHARDS[i] as RecordShard, profile, BOX_L.w, h)
        : this.makeStoryRow(SHIP_STORIES[i] as ShipStory, profile, BOX_L.w, h);
      row.position.set(0, cy);
      content.addChild(row);
      cy += h + ROW_GAP;
    }
  }

  /** 파일럿 파일 1행 — 초상 썸네일 + 이름 + 태그라인 + 해금 `n / 3`. */
  private makeStoryRow(story: ShipStory, profile: Profile, w: number, h: number): Container {
    const def = defForStory(story);
    const selected = this.selectedStory === story.slug;

    const row = new Container();
    // 클릭은 **행 Container** 가 받는다(바탕 Graphics 에 걸면 위 텍스트가 삼킨다).
    attachRowClick(row, () => {
      if (this.selectedStory === story.slug) return;
      this.selectedStory = story.slug;
      this.detailScrollY = 0;
      this.refresh();
    });
    row.addChild(rowPlate(w, h, selected));

    const thumbY = Math.round((h - STORY_THUMB) / 2);
    const tex = def === undefined ? undefined : this.ui[shipPortraitName(def.id)];
    if (tex) {
      const sp = new Sprite(tex);
      sp.width = STORY_THUMB;
      sp.height = STORY_THUMB;
      sp.position.set(12, thumbY);
      row.addChild(sp);
    } else {
      row.addChild(recessedWell(12, thumbY, STORY_THUMB, STORY_THUMB));
    }

    const textW = w - STORY_TEXT_X - STORY_COUNT_W;
    // 행 높이가 늘어나도 두 줄이 세로 가운데에 남게 위쪽 여백을 파생시킨다.
    const top = Math.round((h - 52) / 2);
    const name = this.label(
      def === undefined ? story.slug : shipTypeName(def),
      21,
      selected ? COLOR.gold : COLOR.cream,
      '800',
      textW,
    );
    name.position.set(STORY_TEXT_X, top);
    row.addChild(name);

    const tag = this.label(storyTagline(story), 15, COLOR.muted, '400', textW);
    tag.position.set(STORY_TEXT_X, top + 28);
    row.addChild(tag);

    const progress = storyProgressFromProfile(profile, story);
    const count = this.label(
      `${unlockedChapterCount(story, progress)} / ${story.chapters.length}`,
      18,
      SLAB_BODY_FILL,
      '700',
      STORY_COUNT_W - 24,
    );
    count.anchor.set(1, 0.5);
    count.position.set(w - ROW_PAD, h / 2);
    row.addChild(count);

    return row;
  }

  /**
   * 기록 파편 1행. **잠긴 행은 볼록한 판이 아니라 파낸 소켓**이다 — "잠겨 있다"를 조명 부호가
   * 말하므로 `?` 같은 글리프를 얹지 않는다(관제탑에서 그 글리프가 화면에서 가장 튀는 물체가 됐다).
   */
  private makeShardRow(shard: RecordShard, profile: Profile, w: number, h: number): Container {
    const has = collectedShardIds(profile).has(shard.id);
    const selected = this.selectedShard === shard.id;

    const row = new Container();
    attachRowClick(row, () => {
      if (this.selectedShard === shard.id) return;
      this.selectedShard = shard.id;
      this.detailScrollY = 0;
      this.refresh();
    });

    if (has) {
      row.addChild(rowPlate(w, h, selected));
    } else {
      row.addChild(recessedWell(0, 0, w, h));
      if (selected) row.addChild(selectionRing(0, 0, w, h, 12));
    }

    const title = this.label(
      has ? recordShardTitle(shard) : t('archive.story.locked'),
      has ? 20 : 18,
      has ? (selected ? COLOR.gold : COLOR.cream) : COLOR.muted,
      has ? '800' : '700',
      w - ROW_PAD * 2 - 8,
    );
    title.anchor.set(0, 0.5);
    title.position.set(ROW_PAD + 4, h / 2);
    row.addChild(title);

    return row;
  }

  // --- 상세 열 -------------------------------------------------------------

  private renderDetail(): void {
    const host = this.detailHost;
    const profile = this.profile;
    if (host === null) return;
    this.clearHost(host);
    if (profile === null) return;
    if (this.tab === ARCHIVE_TAB_SHARDS) this.renderShardDetail(host, profile);
    else this.renderStoryDetail(host, profile);
  }

  /**
   * 파일럿 파일 상세 — 초상 챔버 + 이름·태그라인·해금 수, 아래 **챕터 3장**.
   *
   * 잠긴 챕터는 제목·본문을 감추고 **과제 힌트만** 보여 준다(스포일러 방지). 해금 판정은
   * `storyUnlock.chapterUnlocked` 가 소유하고 이 화면은 읽기만 한다.
   */
  private renderStoryDetail(host: Container, profile: Profile): void {
    const slug = this.selectedStory;
    const story = slug === null ? undefined : shipStory(slug);
    const def = story === undefined ? undefined : defForStory(story);
    if (story === undefined || def === undefined) {
      this.emptyWell(host, BOX_D, t('archive.detail.empty'));
      return;
    }

    // --- 초상 블록 ---
    host.addChild(recessedWell(BOX_D.x, BOX_D.y, PORTRAIT_WELL, PORTRAIT_WELL));
    const art = (PORTRAIT_WELL - PORTRAIT_ART) / 2;
    const tex = this.ui[shipPortraitName(def.id)];
    if (tex) {
      const sp = new Sprite(tex);
      sp.width = PORTRAIT_ART;
      sp.height = PORTRAIT_ART;
      sp.position.set(BOX_D.x + art, BOX_D.y + art);
      host.addChild(sp);
    }

    const infoX = BOX_D.x + PORTRAIT_WELL + DETAIL_BLOCK_GAP + 8;
    const infoW = BOX_D.right - infoX;
    const name = this.label(shipTypeName(def), 30, COLOR.gold, '800', infoW);
    name.position.set(infoX, BOX_D.y + 14);
    host.addChild(name);

    const tag = this.wrapped(storyTagline(story), 19, SLAB_BODY_FILL, infoW, '400', 27);
    tag.position.set(infoX, BOX_D.y + 58);
    host.addChild(tag);

    const progress = storyProgressFromProfile(profile, story);
    const count = this.label(
      t('archive.story.progress', {
        n: unlockedChapterCount(story, progress),
        total: story.chapters.length,
      }),
      17,
      COLOR.muted,
      '700',
      infoW,
    );
    count.position.set(infoX, BOX_D.y + PORTRAIT_WELL - 30);
    host.addChild(count);

    // --- 챕터 셋 ---
    const top = BOX_D.y + PORTRAIT_WELL + DETAIL_BLOCK_GAP;
    const avail = BOX_D.bottom - top;
    const innerW = BOX_D.w - ROW_PAD * 2 - 8;
    // 자연 높이를 먼저 재고(본문 길이가 챕터마다 다르다) 남는 세로를 그 위에서 나눠 준다.
    const built = story.chapters.map((chapter) => {
      const unlocked = chapterUnlocked(chapter, progress);
      const n = chapterNo(chapter.index);
      const head = this.wrapped(
        unlocked
          ? `${t('archive.story.chapter', { n })} · ${storyChapterTitle(story, chapter)}`
          : `${t('archive.story.chapter', { n })} · ${t('archive.story.locked')}`,
        19,
        unlocked ? COLOR.gold : COLOR.muted,
        innerW,
        '800',
        25,
      );
      const body = this.wrapped(
        unlocked ? storyChapterBody(story, chapter) : storyQuestHint(story, chapter),
        15,
        unlocked ? SLAB_BODY_FILL : COLOR.muted,
        innerW,
        '400',
        22,
      );
      const natural = 14 + Math.ceil(head.height) + 8 + Math.ceil(body.height) + 14;
      return { head, body, natural };
    });
    const hs = fillRowHeights(
      built.map((b) => b.natural),
      ROW_GAP,
      avail,
      CHAPTER_MAX_H,
    );
    /**
     * ⚠️ 챕터가 상자를 **넘칠 수 있다** — 본문이 길면 자연 높이가 상한을 넘고 `fillRowHeights`
     * 는 늘려 주기만 할 뿐 줄여 주지 않는다. 그대로 두면 챔버가 패널 테두리를 뚫는데 예외도
     * 로그도 없다. 그래서 스크롤을 붙인다(휠은 클립 Container 가 받는다).
     */
    const bounds = rowBounds(hs, ROW_GAP);
    const total = bounds.length === 0 ? 0 : (bounds[bounds.length - 1] ?? 0);
    const content = makeScrollArea(host, {
      x: BOX_D.x,
      y: top,
      w: BOX_D.w,
      h: Math.min(avail, total),
      totalH: total,
      get: () => this.detailScrollY,
      set: (v) => {
        this.detailScrollY = v;
      },
      thumb: true,
    });
    let cy = 0;
    built.forEach((b, i) => {
      const h = hs[i] ?? b.natural;
      content.addChild(recessedWell(0, cy, BOX_D.w, h));
      b.head.position.set(ROW_PAD + 4, cy + 14);
      content.addChild(b.head);
      b.body.position.set(ROW_PAD + 4, cy + 14 + Math.ceil(b.head.height) + 8);
      content.addChild(b.body);
      cy += h + ROW_GAP;
    });
  }

  /**
   * 기록 파편 상세 — 제목 챔버 + **상자 바닥까지 내려가는 본문 챔버**.
   *
   * 본문이 짧으면 챔버 세로 가운데에 앉는다(`emptyWell` 과 같은 처방 — 빈 면이 아니라 이름 있는
   * 자리다). 길면 위에서부터 흐르고 스크롤이 받는다.
   */
  private renderShardDetail(host: Container, profile: Profile): void {
    const id = this.selectedShard;
    const shard = id === null ? undefined : RECORD_SHARDS.find((s) => s.id === id);
    if (shard === undefined) {
      this.emptyWell(host, BOX_D, t('archive.detail.empty'));
      return;
    }
    const has = collectedShardIds(profile).has(shard.id);

    host.addChild(recessedWell(BOX_D.x, BOX_D.y, BOX_D.w, SHARD_HEAD_H));
    const title = this.label(
      has ? recordShardTitle(shard) : t('archive.story.locked'),
      24,
      has ? COLOR.gold : COLOR.muted,
      '800',
      BOX_D.w - ROW_PAD * 2 - 8,
    );
    title.anchor.set(0, 0.5);
    title.position.set(BOX_D.x + ROW_PAD + 4, BOX_D.y + SHARD_HEAD_H / 2);
    host.addChild(title);

    const top = BOX_D.y + SHARD_HEAD_H + DETAIL_BLOCK_GAP;
    const availH = BOX_D.bottom - top;
    host.addChild(recessedWell(BOX_D.x, top, BOX_D.w, availH));

    const innerW = BOX_D.w - 96;
    const body = this.wrapped(
      has ? recordShardBody(shard) : t('archive.shards.locked'),
      has ? 19 : 18,
      has ? SLAB_BODY_FILL : COLOR.muted,
      innerW,
      '400',
      30,
    );
    const bodyH = Math.ceil(body.height);
    if (bodyH + 48 <= availH) {
      body.anchor.set(0.5, 0.5);
      body.position.set(BOX_D.x + BOX_D.w / 2, top + availH / 2);
      host.addChild(body);
      return;
    }
    const content = makeScrollArea(host, {
      x: BOX_D.x + 48,
      y: top + 24,
      w: innerW,
      h: availH - 48,
      totalH: bodyH,
      get: () => this.detailScrollY,
      set: (v) => {
        this.detailScrollY = v;
      },
      thumb: true,
    });
    content.addChild(body);
  }
}
