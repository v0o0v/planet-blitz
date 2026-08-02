/**
 * 촉매 보관함 화면 — Pixi (ADR-0029 Lane 4 · ADR-0042 상점 겸용 · 2026-08-02 AAA 시네마틱 전환).
 *
 * 격납고에서 진입하는 **하위 화면**이다(챔피언 선택과 동일 suspend/resume 규약). ADR-0042 로
 * 이 화면이 **촉매 상점을 겸한다** — 48종 전 카탈로그를 한 줄씩 나열하고, 한 행에서 [분해]
 * (→ 촉매 잔재)와 [구매](← 촉매 잔재)를 모두 처리한다. 공용 30종만 판매되고 특산 18종은
 * 분해만 된다.
 *
 * ## 시네마틱 전환에서 바뀐 것은 **바탕**뿐이다
 * `nineSlicePanel`(나무) → `makeCinematicPanel`(석재 슬래브), `ui_btn_*.png` →
 * `cinematicButtonTexture`, `makeBanner` → `makeHangarTitle`, `makeCurrencyChip` →
 * `makeHangarChip`. 판정·서버 왕복·행 예산 산술은 한 줄도 건드리지 않았다.
 *
 * ## 왜 배경 **창을 두지 않는가** — 한 번 뚫었다가 뺐다
 * 격납고는 패널 4장이 화면의 약 97% 를 덮어 배경이 보일 자리가 없었고, 그래서 쇼케이스 패널을
 * `variant: 'window'` 로 뚫었다. 이 화면도 같은 어법으로 우측 상단에 도크 창(678×496)을 냈었다.
 *
 * **사용자 판단으로 기능 패널로 교체했다**(2026-08-02). 이유는 격납고의 창과 결정적으로 달랐다는
 * 것이다: 격납고 창에는 함선이라는 **초점 피사체**가 있었지만, 여기 창에는 배경의 DOF 보케만
 * 남아 화면의 16% 가 "쓸모도 볼거리도 아닌 자리"가 됐다. 그 자리는 지금 선택한 촉매의 상세다 —
 * 48행 목록의 짝으로서 기능도 얻는다.
 *
 * 그래서 이 화면의 배경 노출은 **헤더 밴드와 패널 사이 틈**뿐이다(`windows: []`).
 *
 * ## 배경 모듈의 계수는 "창 밖을 강하게 누른다" — 창이 없어도 그게 옳다
 * `HangarBackdrop` 은 창 밖을 ×0.30, 헤더를 ×0.46 으로 누른다. 이 화면에서 창 밖은 전부
 * 불투명 슬래브가 덮으므로 밝기가 화면에 나오지 않고, 패널 가장자리로 새어 보이는 배경이
 * 패널보다 밝으면 도-지가 반전된다(기지 2라운드 실측 결함). 슬래브는 "배경(눌린 상태)보다
 * 밝아야 물체로 선다"는 전제로 만들어지므로, 그 전제를 **배경 모듈이** 보장해야 한다.
 *
 * ## 재렌더 규율 — 격납고와 **다르게** 크롬을 유지한다
 * 격납고 `render()` 는 배경·패널을 매번 파괴·재생성한다. 여기서 같은 짓을 하면 **필터 탭 한
 * 번에 1376×768 배경이 다시 구워진다** — 격납고의 render 는 장착·resume 에서만 도는 반면 이
 * 화면은 필터 전환이 상시 조작이기 때문이다. 그래서:
 *  - `buildChrome()` — 배경·패널 3장·헤더는 **한 번만** 세운다(자산 로드 시 1회 재건).
 *  - `renderList()` — 48행만 `listHost` 안에서 갈아끼운다.
 *  - 스테퍼는 **둘 다 부르지 않는다** — `rowRefs` 로 해당 행의 `Text.text` 와 버튼 활성만
 *    갈아끼운다(`resolution: 2` Text 라 인스턴스마다 텍스처 업로드가 난다).
 *
 * ## 행 사이에 **선을 긋지 않는다**
 * 48행이 세로로 쌓이므로 구분선을 그으면 정확히 사용자가 격납고에서 삭제를 지시한 "표의 괘선"이
 * 된다(2026-08-02). 행 구분은 선이 아니라 **면의 밝기 차 + 2단 접지 그림자 + 행 간격**이 만든다.
 * 같은 이유로 세로 리브·수평 이음선·각인 번호판은 이 화면에도 넣지 않는다.
 *
 * ## 실측 규칙
 * - **휠은 클립 Container + hitArea 에**(`makeScrollArea`). 마스크 Graphics 는 히트 테스트에서
 *   통째로 빠진다.
 * - **여백은 패널의 `box` 안에만**. `box` 는 패널 로컬이다.
 * - **격납고와는 `show()`/`onClose`** — 격납고가 `suspend()`/`resume()` 로 자리를 주고받는다.
 * - 연출은 `update(dt)` 로만 산다. 격납고가 **자기 가시성 가드보다 먼저** 이 화면으로 dt 를
 *   흘린다(이 화면이 떠 있는 동안 격납고 root 는 숨겨져 있다).
 *
 * 순수 render/UI 레이어(ADR-0005 · ADR-0014) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { KeyValueStore, Profile } from '../../save/profile.js';
import {
  CATALYSTS,
  catalystById,
  catalystBuyPrice,
  catalystIconFallbackKey,
  catalystIconKey,
  catalystIsPurchasable,
  catalystSalvageValue,
  SLOT_CAP,
  type CatalystDef,
} from '../../data/catalysts.js';
import {
  fetchCatalystInventoryOnline,
  fetchCatalystResidueOnline,
  salvageCatalystOnServer,
  buyCatalystOnServer,
  type CatalystInventory,
} from '../../net/index.js';
import {
  clampQty,
  salvageQty,
  salvageLabel,
  salvageEnabled,
  buyEnabled,
  buyRejectKey,
  salvageRejectKey,
  rowNoteText,
  noteLayout,
  QTY_MIN,
  ROW_H,
  ROW_CTRL_W,
  INFO_Y,
  INFO_LINE_H,
  NOTE_LINE_H,
  type CatalystRowShopState,
} from './catalystShopView.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { PixiButton } from './button.js';
import { makeScrollArea } from './scrollArea.js';
import { attachRowClick, stopRowPropagation } from './listRow.js';
import { penaltyRow, rewardRow } from '../catalystLabels.js';
import { loadHangarTextures, HANGAR_BACKDROP_NAME, type HangarTextures } from './hangarTextures.js';
import { HangarBackdrop } from './hangarBackdrop.js';
import { makeCinematicPanel, type CinematicPanel } from './cinematicPanel.js';
import {
  makeHangarTitle,
  makeHangarChip,
  cinematicButtonTexture,
  chromeFallbackColor,
  chromeLabelColor,
  type ChromeTone,
} from './hangarChrome.js';

// ---------------------------------------------------------------------------
// 레이아웃(디자인 스페이스 1920×1080)
//
// 여백 어휘(32 / 28 / 20 / 하단 28)는 격납고와 **같은 값**이다. 형제 화면끼리 다르면 전환에서
// 튄다.
//
// 우측 열은 위가 선택 촉매 상세, 아래가 잔재다. 둘 다 불투명 슬래브다 — 배경 창은 두지 않는다
// (파일 헤더 "왜 배경 창을 두지 않는가").
// ---------------------------------------------------------------------------

/** 헤더 밴드 높이 — 배경이 그대로 보이는 두 자리 중 하나. 격납고와 같은 값. */
const HEADER_H = 104;
/** 헤더 컨트롤 상단과 높이 — 전부 같은 세로 띠를 쓴다(겹침을 구조적으로 없앤다). */
const HEAD_Y = 26;
const HEAD_H = 52;
const EDGE_X = 32;
const GUTTER_X = 28;
const ROW_GAP_Y = 20;

/** 목록 패널 — 원화의 어두운 좌측 절반 위에 앉는다. */
const LIST_X = EDGE_X;
const LIST_Y = HEADER_H + 8;
const LIST_W = 1150;
const LIST_H = 940;
/** 우측 열 — 선택 촉매 상세(위)와 잔재(아래). */
const SIDE_X = LIST_X + LIST_W + GUTTER_X;
const SIDE_W = DESIGN_WIDTH - EDGE_X - SIDE_X;
const DETAIL_Y = LIST_Y;
const DETAIL_H = 596;
const AUX_Y = DETAIL_Y + DETAIL_H + ROW_GAP_Y;
/** 잔재 패널 바닥은 목록 패널 바닥과 **같아야** 한다 — 파생으로 강제한다(하드코딩 금지). */
const AUX_H = LIST_Y + LIST_H - AUX_Y;

/** 헤더 필터 탭 치수. 좌상단 x<120 은 설정 톱니 예약 밴드라 132 부터 시작한다. */
const FILTER_X = 132;
const FILTER_W = 120;
const FILTER_GAP = 12;
/** 헤더 재화 칩 폭과 간격. */
const CHIP_W = 190;
const HEAD_GAP = 14;
const CLOSE_W = 56;

/** 화면 좌표 사각형(디자인 스페이스). */
export interface CatalystArchiveRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 이 화면의 레이아웃 전량 — **Pixi 없이 검증되는 순수 서술**이다.
 *
 * 왜 내보내는가: 이 리포는 "겹치면 안 되는 세로 띠"가 실제로 겹친 결함을 격납고 헤더에서 이미
 * 겪었고(`hangar.ts` `BOTTOM_PY` 위 주석), 캔버스 없는 vitest 는 화면을 세울 수 없어 눈으로만
 * 잡히는 유형이 된다. 좌표를 순수 값으로 꺼내 두면 **겹침·화면 이탈·좌상단 예약 밴드 침범**을
 * 단위 테스트가 잠근다(`tests/catalystArchiveLayout.test.ts`).
 *
 * ⚠️ `settings` 는 `main.ts` 가 소유한 전 화면 공용 크롬이고 **매 프레임 stage 최상위로 올라온다**.
 * 좌상단 예약 밴드(x < {@link GEAR_BAND_W} · y < {@link GEAR_BAND_H})에 컨트롤을 두면 그 컨트롤이
 * 통째로 클릭 불가가 된다 — 격납고에서 실측으로 확인된 자리다.
 */
export const GEAR_BAND_W = 120;
export const GEAR_BAND_H = 120;

export function catalystArchiveLayout(): {
  readonly screen: CatalystArchiveRect;
  readonly headerH: number;
  readonly panels: readonly { readonly id: 'list' | 'detail' | 'residue'; readonly rect: CatalystArchiveRect }[];
  readonly headerControls: readonly { readonly id: string; readonly rect: CatalystArchiveRect }[];
} {
  const closeX = DESIGN_WIDTH - EDGE_X - CLOSE_W;
  const mineralsX = closeX - HEAD_GAP - CHIP_W;
  const creditsX = mineralsX - HEAD_GAP - CHIP_W;
  const head = (x: number, w: number): CatalystArchiveRect => ({ x, y: HEAD_Y, w, h: HEAD_H });
  return {
    screen: { x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT },
    headerH: HEADER_H,
    panels: [
      { id: 'list', rect: { x: LIST_X, y: LIST_Y, w: LIST_W, h: LIST_H } },
      { id: 'detail', rect: { x: SIDE_X, y: DETAIL_Y, w: SIDE_W, h: DETAIL_H } },
      { id: 'residue', rect: { x: SIDE_X, y: AUX_Y, w: SIDE_W, h: AUX_H } },
    ],
    headerControls: [
      ...FILTERS.map((f, i) => ({ id: `filter:${f.id}`, rect: head(FILTER_X + i * (FILTER_W + FILTER_GAP), FILTER_W) })),
      { id: 'credits', rect: head(creditsX, CHIP_W) },
      { id: 'minerals', rect: head(mineralsX, CHIP_W) },
      { id: 'close', rect: head(closeX, CLOSE_W) },
    ],
  };
}

/** 행 간격. 행 사이를 **선이 아니라 틈과 그림자**로 가른다. */
const ROW_GAP = 12;
/** 제목 띠와 첫 행 사이 여백. */
const LIST_TOP_PAD = 10;
/** 컨트롤 우측 여백. */
const ROW_CTRL_PAD = 16;
/** [분해][구매] 사이 간격. */
const ROW_BTN_GAP = 10;
/** 버튼 폭 — 하드코딩 금지, ROW_CTRL_W 파생. */
const ROW_BTN_W = (ROW_CTRL_W - ROW_BTN_GAP) / 2;
const ROW_BTN_H = 52;
/** 스테퍼(− n +) 한 단의 높이 = ± 버튼 한 변. */
const STEP_H = 44;
/** 하단 문구 높이를 못 잰 경우(캔버스 없는 환경)의 안전 y — 1줄 기준 상단. */
const NOTE_FALLBACK_Y = ROW_H - 24;
/** 스테퍼 상단 여백 / 스테퍼와 버튼 줄 사이 간격. */
const STEP_Y = 14;
const ROW_BTN_Y = STEP_Y + STEP_H + 12;
/** 상세 패널 아이콘 한 변. 텍스처를 갈면 Sprite 가 원본 치수로 돌아가므로 매번 다시 못 박는다. */
const DETAIL_ICON = 128;
/** 수치 표 행 수(고정 — 위젯을 미리 만든다). */
const DETAIL_ROWS = 7;
/** 수치 표 한 행 높이. */
const DETAIL_ROW_H = 32;
/** 설명 높이를 못 잰 경우(캔버스 없는 환경)의 안전 높이 — 2줄 기준. */
const DETAIL_DESC_FALLBACK_H = 48;
/** 설명과 수치 표 사이 간격. */
const DETAIL_TABLE_GAP = 18;
/** 아이콘 한 변과 좌측 여백 — 텍스트 x 가 여기서 파생된다. */
const ICON_SIZE = 56;
const ICON_X = 18;
const ROW_TEXT_X = ICON_X + ICON_SIZE + 16;

/**
 * 석재 슬래브 위 **보조 텍스트색**. `hangar.ts` 의 `SLAB_BODY_FILL` 을 복제한 것이다(레인 계약
 * §2 "복제하고 헤더에 출처를 밝혀라" — 그 파일은 화면이지 공용 모듈이 아니다).
 *
 * 옛 `COLOR.muted`(#aa9b87)를 쓸 수 없는 이유: 슬래브 면의 동작점이 L* 19 → 28 로 올라가면서
 * 그 위 글자의 대비가 내려갔고, 콘텐츠 상자 안 가장 밝은 지점에서 3.00:1 로 WCAG AA 미달이
 * 됐다. 배경을 도로 어둡게 하면 "화면 과반이 평평한 암면" 결함이 함께 되돌아오므로 **전경만
 * 올린다.** `#e4dac7` 은 최악의 바탕에서 4.84:1.
 */
const SLAB_BODY_FILL = 0xe4dac7;

/** 행 판 바탕색(공용) — 슬래브 면보다 한 단 밝아야 판으로 선다. */
const ROW_FACE_COMMON = 0x3b3327;
/** 행 판 바탕색(특산) — 색상만 더 따뜻하게. 밝기 차가 아니라 **색온도 차**로 가른다. */
const ROW_FACE_SIGNATURE = 0x453521;
/** 행 판 안쪽 어두운 홈. 밝은 링이 아니라 **어두운 홈**으로 대비를 만든다(iconContrastRingBands). */
const ROW_GROOVE = 0x17130d;
const ROW_RADIUS = 10;

const AXIS_GLYPH: Record<string, string> = {
  drop: 'D',
  rarity: 'R',
  xp: 'X',
  resource: '$',
  catalystDrop: 'C',
  power: 'P',
};

type Filter = 'all' | 'common' | 'signature';

const FILTERS: readonly { id: Filter; key: MessageKey }[] = [
  { id: 'all', key: 'catalyst.manage.filterAll' },
  { id: 'common', key: 'catalyst.manage.filterCommon' },
  { id: 'signature', key: 'catalyst.manage.filterSignature' },
];

// --- 행 판 조명 램프(모듈 1회 굽기) ------------------------------------------

/**
 * 행 판의 **방향성 조명**을 위한 세로 알파 램프.
 *
 * ⚠️ 띠를 겹쳐 그라디언트를 근사하지 않는다 — 1px 겹침이 알파를 두 배로 만들어 가로줄이 생긴다
 * (실제 사용자 신고). 폭 1px 캔버스에 픽셀로 굽고 `linear` 로 늘린다.
 *
 * 흰 램프 한 장을 위(밝게)·아래(어둡게 tint 0) 두 번 쓴다. 사방 균일 밝은 스트로크는 금지이고
 * (`cinematicTile.ts` `BEVEL_LIGHT` 실측 근거), 램프는 광원이 위에 있다는 것을 면 자체로 말한다.
 */
let rowRampTex: Texture | null | undefined;

function rowRamp(): Texture | null {
  if (rowRampTex !== undefined) return rowRampTex;
  // ⚠️ 이 가드는 **캔버스를 굽는 함수에만** 붙인다. DOM 조회(`hudEl`)에 붙이면 HUD 숨김이
  // 통째로 죽는다(실제로 밟았다).
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
 * **선은 긋지 않는다.** 행 사이 구분은 이 그림자와 행 간격이 만든다(§ 파일 헤더).
 */
function rowPlate(w: number, h: number, signature: boolean): { view: Container; setSelected: (on: boolean) => void } {
  const root = new Container();

  // 2단 접지 그림자 — 한 층으로는 접지가 안 읽힌다(넓고 옅은 확산 + 좁고 짙은 접촉).
  const diffuse = new Graphics();
  diffuse.roundRect(-3, 6, w + 6, h, ROW_RADIUS + 3).fill({ color: 0x000000, alpha: 0.22 });
  root.addChild(diffuse);
  const contact = new Graphics();
  contact.roundRect(1, 3, w - 2, h, ROW_RADIUS).fill({ color: 0x000000, alpha: 0.3 });
  root.addChild(contact);

  const face = new Graphics();
  face
    .roundRect(0, 0, w, h, ROW_RADIUS)
    .fill({ color: signature ? ROW_FACE_SIGNATURE : ROW_FACE_COMMON });
  root.addChild(face);

  // 방향성 조명 — 위는 밝게, 아래는 어둡게. 둘 다 면 모양으로 잘라 밖으로 새지 않게 한다.
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

  // 안쪽 어두운 홈 — 밝은 링을 두르지 않는다(밝은 링은 "오려 붙인 웹 카드"로 읽힌다).
  const groove = new Graphics();
  groove
    .roundRect(0, 0, w, h, ROW_RADIUS)
    .stroke({ color: ROW_GROOVE, width: 2, alignment: 1, alpha: 0.85 });
  root.addChild(groove);

  /**
   * 선택 링. **이건 구분선이 아니라 상태 표시다** — 행 사이를 가르는 선은 표의 괘선으로 읽혀
   * 금지지만(파일 헤더), 지금 무엇을 보고 있는지는 목록·상세 두 패널을 잇는 유일한 단서라
   * 없으면 상세 패널이 어디서 왔는지 알 수 없다. 한 번에 한 행에만 붙는다.
   */
  const ring = new Graphics();
  ring
    .roundRect(0, 0, w, h, ROW_RADIUS)
    .stroke({ color: COLOR.gold, width: 3, alignment: 1, alpha: 0.95 });
  ring.visible = false;
  root.addChild(ring);

  return {
    view: root,
    setSelected: (on: boolean) => {
      ring.visible = on;
    },
  };
}

export interface CatalystArchiveCallbacks {
  /** 화면을 닫을 때. 격납고가 `resume()` 하는 자리. */
  onClose: () => void;
}

export class CatalystArchiveScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private profile: Profile;
  private cb: CatalystArchiveCallbacks | null = null;
  private ui: UiTextures = {};
  private art: HangarTextures = {};
  private inventory: CatalystInventory = new Map<number, number>();
  private filter: Filter = 'all';
  private scrollY = 0;
  private hint = '';
  /** 분해 서버 왕복 중 재진입(동시 클릭) 가드. */
  private busy = false;
  private hudPrevVisibility: string | null = null;
  /**
   * 촉매 잔재 잔고(ADR-0042). `null` = 아직 못 읽음 — 0 과 구분해야 `catalyst.shop.noProfile`
   * 안내가 성립한다(신규 가입 직후 창에서 서버가 실제로 `no-profile` 을 낸다).
   */
  private residue: number | null = null;
  /** 서버 왕복이 가능한 세션인가(미설정/오프라인이면 false — 버튼 전량 비활성). */
  private online = false;
  /** 행별 스테퍼 수량(분해·구매 공용). 미지정은 QTY_MIN. */
  private readonly qtyById = new Map<number, number>();
  /**
   * 행 로컬 갱신 핸들. 48행 전량 addChild + `resolution: 2` Text 라 스테퍼 한 번에 목록을 다시
   * 그리면 텍스처 업로드가 통째로 다시 난다. 스테퍼는 이 핸들로 **해당 행의 Text.text 와 버튼
   * 활성만** 갈아끼운다.
   */
  private readonly rowRefs = new Map<number, () => void>();

  // --- 유지되는 크롬(파일 헤더 "재렌더 규율") ---
  /** 연출을 가진 것들 — `update(dt)` 가 이 둘만 돌린다. */
  private backdrop: HangarBackdrop | null = null;
  private panels: CinematicPanel[] = [];
  /** 목록만 갈아끼우는 그릇(목록 패널의 자식). */
  private listHost: Container | null = null;
  /** 목록 패널의 콘텐츠 상자(패널 로컬) — 목록 재구성이 매번 다시 읽는다. */
  private listBox: { x: number; y: number; w: number; h: number } | null = null;
  /** 필터 탭만 갈아끼우는 그릇(활성 표시가 텍스처라 버튼을 다시 만든다 — 3개뿐이라 싸다). */
  private filterHost: Container | null = null;
  /** 재화 칩만 갈아끼우는 그릇(값이 구워져 있어 세터가 없다). */
  private chipHost: Container | null = null;
  /** 잔재 패널의 큰 숫자·보유 요약·안내 문구·결과 문구 — 서버 왕복 때 `.text` 만 갈린다. */
  private residueValue: Text | null = null;
  private residueNote: Text | null = null;
  private affordable: Text | null = null;
  private hintText: Text | null = null;
  /** 상세 패널 위젯들 — 선택이 바뀌면 `.text`·텍스처만 갈아끼운다(패널은 다시 안 만든다). */
  private detail: {
    icon: Sprite;
    glyph: Text;
    name: Text;
    desc: Text;
    rows: { label: Text; value: Text }[];
    empty: Text;
  } | null = null;
  /** 수치 표가 넘어서면 안 되는 바닥 y(패널 로컬) — `buildDetail` 이 상자에서 파생해 채운다. */
  private detailRowsBottom = 0;
  /** 선택된 촉매 id(없으면 null). 상세 패널의 입력이자 행 강조의 기준. */
  private selectedId: number | null = null;
  /** 행별 선택 표시 토글 — 선택이 바뀔 때 48행을 다시 그리지 않기 위한 핸들. */
  private readonly rowSelect = new Map<number, (on: boolean) => void>();
  /** 크롬이 서 있는가(자산 도착 시 1회 재건). */
  private chromeBuilt = false;

  /**
   * `store` 는 더 이상 쓰이지 않는다(ADR-0042: 분해가 재화 미러를 갱신하지 않으므로 로컬 세이브
   * 기록이 없다). 호출부 배선을 깨지 않기 위해 인자는 남긴다.
   */
  constructor(profile: Profile, stage: Container, _store: KeyValueStore | null = null) {
    this.profile = profile;
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
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

  /**
   * 매 프레임 연출 진행. `dt` 는 **벽시계 초**다.
   *
   * ⚠️ 격납고가 **자기 가시성 가드보다 먼저** 이 메서드를 부른다 — 이 화면이 떠 있는 동안
   * 격납고 root 는 `suspend()` 로 숨겨져 있기 때문이다. 화면이 숨겨져 있으면 여기서 즉시
   * 반환하므로 격납고 밖에서는 비용이 0 이다.
   */
  update(dt: number): void {
    if (!this.root.visible) return;
    this.backdrop?.update(dt);
    for (const p of this.panels) p.update(dt);
  }

  show(profile: Profile, cb: CatalystArchiveCallbacks): void {
    this.profile = profile;
    this.cb = cb;
    this.hint = '';
    this.scrollY = 0;
    this.buildChrome();
    this.syncChrome();
    this.renderList();
    this.root.visible = true;
    this.raise();
    this.hideRunHud();
    void this.refreshInventory();
  }

  hide(): void {
    this.root.visible = false;
    this.cb = null;
    this.restoreRunHud();
  }

  /** 하네스/테스트가 보유 스냅샷을 직접 주입한다(서버 조회 우회). */
  setCatalystInventory(inv: CatalystInventory): void {
    this.inventory = inv;
    if (this.root.visible) {
      this.syncChrome();
      this.renderList();
    }
  }

  private raise(): void {
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
  }

  private close(): void {
    const cb = this.cb;
    this.hide();
    cb?.onClose();
  }

  /**
   * ⚠️ 여기에는 캔버스 가드를 붙이지 않는다 — `typeof document.createElement !== 'function'`
   * 까지 검사하면 HUD 숨김이 통째로 죽는다(실제로 밟았다). DOM 조회는 `document` 유무만 본다.
   */
  private hudEl(): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    return document.getElementById('pb-hud');
  }

  private hideRunHud(): void {
    const hud = this.hudEl();
    if (hud === null) return;
    this.hudPrevVisibility = hud.style.visibility;
    hud.style.visibility = 'hidden';
  }

  private restoreRunHud(): void {
    const hud = this.hudEl();
    if (hud === null || this.hudPrevVisibility === null) return;
    hud.style.visibility = this.hudPrevVisibility;
    this.hudPrevVisibility = null;
  }

  private async refreshInventory(): Promise<void> {
    const inv = await fetchCatalystInventoryOnline();
    // 조회가 null = 미설정/구버전/오류 → 오프라인 세션. 목록은 그리되 버튼을 전량 잠근다.
    this.online = inv !== null;
    this.inventory = inv ?? new Map<number, number>();
    this.residue = this.online ? await fetchCatalystResidueOnline() : null;
    if (this.root.visible) {
      this.syncChrome();
      this.renderList();
    }
  }

  /** 이 행의 스테퍼 수량(미지정은 QTY_MIN). */
  private qtyOf(id: number): number {
    return clampQty(this.qtyById.get(id) ?? QTY_MIN);
  }

  /** 이 행의 순수 판정 입력. 표시·활성 판정은 전부 `catalystShopView` 가 한다. */
  private rowState(def: CatalystDef): CatalystRowShopState {
    return {
      id: def.id,
      owned: this.inventory.get(def.id) ?? 0,
      qty: this.qtyOf(def.id),
      residue: this.residue,
      online: this.online,
    };
  }

  // --- 분해 · 구매 ----------------------------------------------------------

  /**
   * 촉매 분해(ADR-0042) — 서버 `salvage_catalyst` 가 보유를 차감하고 **촉매 잔재**를 지급한다.
   * 크레딧·광물은 이 경로에서 더 이상 변하지 않으므로 재화 미러를 만지지 않는다.
   * rejected/unconfigured 면 안내만(미차감). 동시 클릭 가드(busy)로 과분해를 막는다.
   */
  private async salvageOne(def: CatalystDef): Promise<void> {
    if (this.busy) return;
    const n = salvageQty(this.rowState(def));
    if (n <= 0) return;
    this.busy = true;
    try {
      const res = await salvageCatalystOnServer(def.id, n);
      if (res.status === 'ok') {
        this.residue = res.residue;
        this.hint = t('catalyst.manage.salvageDone', {
          name: t(`catalyst.${def.slug}.name` as MessageKey),
          residue: res.gained,
        });
        await this.refreshInventory();
      } else if (res.status === 'unconfigured') {
        this.hint = t('catalyst.shop.offline');
        this.syncChrome();
        this.renderList();
      } else {
        this.hint = t(salvageRejectKey(res.note));
        this.syncChrome();
        this.renderList();
      }
    } finally {
      this.busy = false;
    }
  }

  /**
   * 촉매 구매(ADR-0042) — 서버 `buy_catalyst` 가 잔재를 차감하고 보유 원장에 얹는다. 가격은
   * 클라가 보내지 않는다(서버가 시드된 `catalyst_defs.buy_price` 를 조회). 거부는 서버 `note` 를
   * 그대로 문구로 옮긴다 — 특히 `no-profile` 을 흘리면 원인 불명 무반응이 된다.
   */
  private async buyOne(def: CatalystDef): Promise<void> {
    if (this.busy) return;
    const n = this.qtyOf(def.id);
    this.busy = true;
    try {
      const res = await buyCatalystOnServer(def.id, n);
      if (res.status === 'ok') {
        this.residue = res.residue;
        this.hint = `${t(`catalyst.${def.slug}.name` as MessageKey)}  ·  −${t('catalyst.shop.price', { n: res.spent })}`;
        await this.refreshInventory();
      } else if (res.status === 'unconfigured') {
        this.hint = t('catalyst.shop.offline');
        this.syncChrome();
        this.renderList();
      } else {
        this.hint = t(buyRejectKey(res.note));
        this.syncChrome();
        this.renderList();
      }
    } finally {
      this.busy = false;
    }
  }

  // --- 크롬(1회 조립) -------------------------------------------------------

  /** 자산이 도착하면 크롬을 통째로 다시 세운다(구운 텍스처가 바뀌므로 갱신으로는 안 된다). */
  private rebuild(): void {
    if (!this.chromeBuilt) return;
    this.destroyChrome();
    this.buildChrome();
    this.syncChrome();
    if (this.root.visible) this.renderList();
  }

  private destroyChrome(): void {
    // 연출 참조를 먼저 끊는다 — destroy 된 컨테이너를 update 가 만지면 안 된다.
    this.backdrop?.destroy();
    this.backdrop = null;
    for (const p of this.panels) p.destroy();
    this.panels = [];
    this.listHost = null;
    this.listBox = null;
    this.filterHost = null;
    this.chipHost = null;
    this.residueValue = null;
    this.residueNote = null;
    this.affordable = null;
    this.hintText = null;
    this.detail = null;
    this.rowSelect.clear();
    this.rowRefs.clear();
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }
    this.chromeBuilt = false;
  }

  private buildChrome(): void {
    if (this.chromeBuilt) return;

    // 바닥 — 배경 자산이 없거나 실패해도 화면이 비지 않게(불투명, 뒤 아레나를 가린다).
    // 이벤트도 여기서 막는다.
    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static';
    this.root.addChild(bg);

    // 배경 — 창 좌표는 **레이아웃에서 파생해** 넘긴다(하드코딩 금지).
    // ⚠️ `view` 는 root 맨 뒤에 그대로 붙이고 스케일·이동을 걸지 마라(공기 마스크가 `view`
    // 자식이라 어긋난다).
    // 창은 없다 — 배경이 그대로 보이는 자리는 헤더 밴드와 패널 사이 틈뿐이다.
    const backdrop = new HangarBackdrop(this.art[HANGAR_BACKDROP_NAME], {
      windows: [],
      headerH: HEADER_H,
    });
    this.root.addChild(backdrop.view);
    this.backdrop = backdrop;

    // ⚠️ **위 → 아래 순서로 붙인다.** 패널 접지 그림자는 아래로 59px 번지는데 행 간격은 20 이라,
    // 순서가 뒤집히면 위 패널의 그림자가 아래 패널 **위에** 얹혀 얼룩으로 읽힌다.
    const listBox = this.addPanel(LIST_X, LIST_Y, LIST_W, LIST_H, 'slab', t('catalyst.manage.title'));
    const detailBox = this.addPanel(SIDE_X, DETAIL_Y, SIDE_W, DETAIL_H, 'slab', t('catalyst.archive.detailTitle'));
    const auxBox = this.addPanel(SIDE_X, AUX_Y, SIDE_W, AUX_H, 'slab', t('catalyst.residue.name'));

    // 목록은 패널 안에서만 갈린다 — 그릇을 미리 만들어 둔다.
    const listPanel = this.panels[0];
    if (listPanel !== undefined) {
      const host = new Container();
      listPanel.container.addChild(host);
      this.listHost = host;
      this.listBox = listBox;
    }

    this.buildDetail(detailBox);
    this.buildAux(auxBox);
    this.buildHeader();
    this.chromeBuilt = true;
  }

  /**
   * 석재 패널 한 장을 세우고 **패널 로컬** 콘텐츠 상자를 돌려준다.
   *
   * 목록·잔재 내용이 전부 패널의 자식이라 로컬 좌표가 맞다(격납고는 root 직속이라 화면 좌표로
   * 풀어 줬다 — 여기서 그 관용구를 그대로 쓰면 두 번 더해진다).
   */
  private addPanel(
    px: number,
    py: number,
    pw: number,
    ph: number,
    variant: 'slab' | 'window',
    title: string,
  ): { x: number; y: number; w: number; h: number } {
    // ⚠️ `screenX`/`screenY` 를 **반드시 넘긴다**. 안 넘기면 같은 치수의 패널끼리 조명·랜드마크
    // 시드가 같아져 위치별 조명이 조용히 무효가 된다 — 화면은 정상적으로 서고 테스트도
    // 통과하므로 눈으로만 잡히는 유형이다. 램프 위치는 격납고와 같은 헤더 밴드 중앙 상단이다.
    const panel = makeCinematicPanel({
      width: pw,
      height: ph,
      variant,
      ...(title === '' ? {} : { title }),
      screenX: px,
      screenY: py,
      lightOrigin: { x: DESIGN_WIDTH / 2, y: 60 },
    });
    panel.container.position.set(px, py);
    this.root.addChild(panel.container);
    this.panels.push(panel);
    const b = panel.box;
    return { x: b.x, y: b.y, w: b.w, h: b.h };
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
      // ⚠️ 텍스처는 128×64 로 1:1 구워져 있다 — `cap: 32` 여야 모서리가 안 뭉개진다.
      texture: cinematicButtonTexture(o.tone),
      cap: 32,
      fallbackColor: chromeFallbackColor(o.tone),
      labelColor: chromeLabelColor(o.tone),
      width: o.width,
      height: o.height,
      fontSize: o.fontSize,
      label: o.label,
      onClick: o.onClick,
    });
  }

  /**
   * 헤더 밴드(y 0..{@link HEADER_H}) — 필터 3탭 · 각인 제목 · 재화 칩 2 · 닫기.
   *
   * ⚠️ **전부 같은 세로 띠**(y {@link HEAD_Y}..{@link HEAD_Y}+{@link HEAD_H})를 쓴다. 격납고
   * 헤더가 겹치는 결함을 이미 겪었으므로 세로로 쌓지 않고 **가로로만** 배치해 겹침을 구조적으로
   * 없앤다. 좌→우: [전체][공용][특산] … 제목(중앙) … [크레딧][광물][닫기].
   *
   * ⚠️ 좌상단 x<120 · y<120 은 **설정 톱니**(main.ts SettingsScreen)가 쓰는 전 화면 공용
   * 자리다 — 톱니는 나중에 stage 최상위로 그려져 항상 위에 얹히므로, 겹치면 그 컨트롤이 통째로
   * 클릭 불가가 된다. 그래서 필터 탭이 132 에서 시작한다.
   *
   * ⚠️ **각인 석재 인방은 넣지 않는다**(격납고에서 사용자 판단으로 제거됨, 2026-08-02). 헤더는
   * 배경이 그대로 보이는 띠다 — 배경 모듈이 이 대역을 중간 세기로 눌러 글자 대비를 보장한다.
   */
  private buildHeader(): void {
    const host = new Container();
    this.root.addChild(host);
    this.filterHost = host;
    this.buildFilters();

    const title = makeHangarTitle(t('catalyst.manage.title'));
    title.position.set(DESIGN_WIDTH / 2, HEAD_Y - 4);
    this.root.addChild(title);

    // 우측: [크레딧][광물][닫기]. 닫기부터 오른쪽 끝에 붙이고 왼쪽으로 쌓는다.
    const closeX = DESIGN_WIDTH - EDGE_X - CLOSE_W;
    const close = this.chromeButton({
      tone: 'stone',
      width: CLOSE_W,
      height: HEAD_H,
      fontSize: 22,
      // 컬러 이모지는 Pixi 에서 두부가 된다(`text.ts` stripEmoji) — U+2715 는 흑백 글리프다.
      label: '✕',
      onClick: () => this.close(),
    });
    close.container.position.set(closeX, HEAD_Y);
    this.root.addChild(close.container);

    const chips = new Container();
    this.root.addChild(chips);
    this.chipHost = chips;
    this.buildChips();
  }

  /**
   * 재화 칩 2개. `makeHangarChip` 은 값을 구운 Container 를 돌려줄 뿐 세터가 없으므로 **다시
   * 만든다** — `show()` 는 프로필을 재바인딩하므로, 유지만 하면 격납고에서 재화를 쓰고 돌아왔을
   * 때 옛 값이 그대로 남는다(크롬을 유지하는 구조라 실제로 발생하는 결함이다).
   */
  private buildChips(): void {
    const host = this.chipHost;
    if (host === null) return;
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }
    const closeX = DESIGN_WIDTH - EDGE_X - CLOSE_W;
    const mineralsX = closeX - HEAD_GAP - CHIP_W;
    const creditsX = mineralsX - HEAD_GAP - CHIP_W;

    const credits = makeHangarChip(
      CHIP_W,
      HEAD_H,
      String(this.profile.credits),
      this.ui['ui_icon_coin.png'] ?? undefined,
      'gold',
    );
    credits.position.set(creditsX, HEAD_Y);
    host.addChild(credits);

    const minerals = makeHangarChip(
      CHIP_W,
      HEAD_H,
      String(this.profile.minerals),
      this.ui['ui_icon_crystal.png'] ?? undefined,
      'teal',
    );
    minerals.position.set(mineralsX, HEAD_Y);
    host.addChild(minerals);
  }

  /** 필터 탭 3개. 활성 표시가 텍스처라 다시 만든다 — 3개뿐이라 배경·패널 재건과 비교가 안 된다. */
  private buildFilters(): void {
    const host = this.filterHost;
    if (host === null) return;
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }
    FILTERS.forEach((f, i) => {
      const active = this.filter === f.id;
      const btn = this.chromeButton({
        tone: active ? 'gold' : 'stone',
        width: FILTER_W,
        height: HEAD_H,
        fontSize: 18,
        label: t(f.key),
        onClick: () => {
          if (this.filter === f.id) return;
          this.filter = f.id;
          this.scrollY = 0;
          this.buildFilters();
          this.renderList();
        },
      });
      btn.container.position.set(FILTER_X + i * (FILTER_W + FILTER_GAP), HEAD_Y);
      host.addChild(btn.container);
    });
  }

  /**
   * 잔재 패널 — 이 화면의 **화폐**다.
   *
   * 크레딧·광물이 헤더에 있고 잔재만 따로 패널을 갖는 이유: ADR-0042 가 "잔재는 촉매 밖에서
   * 가치가 0이므로 전 화면 상단 재화 칩에 3번째로 올리지 않는다"고 정했다. 전 화면 공용 재화는
   * 헤더에, 이 화면 전용 화폐는 이 화면의 패널에 둔다.
   */
  /**
   * 선택 촉매 상세 패널 — 48행 목록의 짝.
   *
   * 원래 이 자리는 배경을 비추는 창이었다. 격납고의 같은 창에는 함선이라는 초점 피사체가
   * 있었지만 여기에는 보케만 남아 화면의 16% 가 쓸모도 볼거리도 아닌 자리가 됐고, 사용자
   * 판단으로 기능 패널이 됐다(2026-08-02).
   *
   * **수치를 그대로 보여준다.** 목록 행의 설명은 방향만 말하고("적 내구도 증가"), 얼마나인지는
   * 어디에도 안 나와 있었다 — 촉매는 페널티와 보상을 한 몸으로 갖는 도박이라 그 크기를 모르면
   * 고를 근거가 없다. 축 이름은 `catalystLabels.ts` 한 곳에서만 유도한다(픽커·런 중 정보판과
   * **같은 문구**여야 한다 — 각자 매핑을 들면 "픽커는 적 체력, HUD 는 Enemy HP" 가 된다).
   *
   * 위젯을 **한 번만 만들고** 선택이 바뀌면 `.text`·텍스처만 갈아끼운다. 목록 행 클릭마다
   * 패널을 다시 세우면 석재 텍스처가 매번 다시 구워진다(파일 헤더 "재렌더 규율").
   */
  private buildDetail(box: { x: number; y: number; w: number; h: number }): void {
    const panel = this.panels[1];
    if (panel === undefined) return;
    const cx = box.x + box.w / 2;
    const P = panel.container;

    const icon = new Sprite();
    icon.width = DETAIL_ICON;
    icon.height = DETAIL_ICON;
    icon.position.set(cx - DETAIL_ICON / 2, box.y + 4);
    P.addChild(icon);

    // 아이콘 자산이 없는 촉매를 위한 축 토큰 글리프(목록 행과 같은 사다리).
    const glyph = new Text({
      resolution: 2,
      text: '',
      style: { fontFamily: UI_FONT, fontSize: 56, fontWeight: '800', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
    });
    glyph.anchor.set(0.5);
    glyph.position.set(cx, box.y + 4 + DETAIL_ICON / 2);
    P.addChild(glyph);

    const name = new Text({
      resolution: 2,
      text: '',
      style: { fontFamily: UI_FONT, fontSize: 30, fontWeight: '800', fill: COLOR.gold, align: 'center', dropShadow: TEXT_SHADOW },
    });
    name.anchor.set(0.5, 0);
    name.position.set(cx, box.y + DETAIL_ICON + 12);
    P.addChild(name);

    const desc = new Text({
      resolution: 2,
      text: '',
      style: {
        fontFamily: UI_FONT, fontSize: 17, fill: SLAB_BODY_FILL, wordWrap: true,
        wordWrapWidth: box.w - 24, align: 'center', lineHeight: 24, dropShadow: TEXT_SHADOW,
      },
    });
    desc.anchor.set(0.5, 0);
    desc.position.set(cx, box.y + DETAIL_ICON + 54);
    P.addChild(desc);

    // 수치 표 — 라벨은 왼쪽, 값은 오른쪽. 행 수는 고정이라 위젯을 미리 만들어 둔다.
    const rows: { label: Text; value: Text }[] = [];
    for (let i = 0; i < DETAIL_ROWS; i++) {
      const label = new Text({
        resolution: 2,
        text: '',
        style: { fontFamily: UI_FONT, fontSize: 17, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
      });
      label.position.set(box.x + 6, 0);
      P.addChild(label);
      const value = new Text({
        resolution: 2,
        text: '',
        style: { fontFamily: UI_FONT, fontSize: 18, fontWeight: '700', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
      });
      value.anchor.set(1, 0);
      value.position.set(box.x + box.w - 6, 0);
      P.addChild(value);
      rows.push({ label, value });
    }

    const empty = new Text({
      resolution: 2,
      text: t('catalyst.archive.detailEmpty'),
      style: {
        fontFamily: UI_FONT, fontSize: 20, fill: SLAB_BODY_FILL, wordWrap: true,
        wordWrapWidth: box.w - 40, align: 'center', dropShadow: TEXT_SHADOW,
      },
    });
    empty.anchor.set(0.5);
    empty.position.set(cx, box.y + box.h / 2);
    P.addChild(empty);

    this.detailRowsBottom = box.y + box.h - 6;
    this.detail = { icon, glyph, name, desc, rows, empty };
    this.syncDetail();
  }

  /** 상세 패널의 **값만** 갱신한다. 선택 없음이면 안내 문구 하나만 남긴다. */
  private syncDetail(): void {
    const d = this.detail;
    if (d === null) return;
    const def = this.selectedId === null ? undefined : catalystById(this.selectedId);
    const on = def !== undefined;
    d.name.visible = on;
    d.desc.visible = on;
    d.empty.visible = !on;
    if (def === undefined) {
      d.icon.visible = false;
      d.glyph.visible = false;
      for (const r of d.rows) {
        r.label.visible = false;
        r.value.visible = false;
      }
      return;
    }

    const tex = this.ui[`${catalystIconKey(def)}.png`] ?? this.ui[`${catalystIconFallbackKey(def)}.png`];
    if (tex) {
      d.icon.texture = tex;
      d.icon.visible = true;
      d.glyph.visible = false;
      // 텍스처를 갈면 Sprite 가 원본 치수로 되돌아간다 — 매번 다시 못 박아야 한다.
      d.icon.width = DETAIL_ICON;
      d.icon.height = DETAIL_ICON;
    } else {
      d.icon.visible = false;
      d.glyph.visible = true;
      d.glyph.text = AXIS_GLYPH[def.reward.axis] ?? '?';
    }

    d.name.text = t(`catalyst.${def.slug}.name` as MessageKey);
    d.desc.text = t(`catalyst.${def.slug}.desc` as MessageKey);

    // 장당 효과 — `mult = 1 + perStack` 이 `formatCatalystMult` 의 입력 계약이다.
    const rew = rewardRow({
      axis: def.reward.axis,
      mult: 1 + def.reward.perStack,
      ...(def.reward.powerStat === undefined ? {} : { powerStat: def.reward.powerStat }),
    });
    const pen = penaltyRow({ axis: def.penalty.axis, mult: 1 + def.penalty.perStack });
    // 상한까지 몰았을 때 — 선형 가산이라 N장 = N·perStack(`catalysts.ts` 스택 수학 R9).
    const capRew = rewardRow({
      axis: def.reward.axis,
      mult: 1 + def.reward.perStack * SLOT_CAP,
      ...(def.reward.powerStat === undefined ? {} : { powerStat: def.reward.powerStat }),
    });
    const capPen = penaltyRow({ axis: def.penalty.axis, mult: 1 + def.penalty.perStack * SLOT_CAP });

    const purchasable = catalystIsPurchasable(def.id) && catalystBuyPrice(def.id) > 0;
    const lines: { label: string; value: string }[] = [
      {
        label: t('catalyst.archive.rowKind'),
        value: t(def.kind === 'signature' ? 'catalyst.kind.signature' : 'catalyst.kind.common'),
      },
      {
        label: t('catalyst.archive.labelOwned'),
        value: t('catalyst.manage.owned', { n: this.inventory.get(def.id) ?? 0 }),
      },
      { label: t('catalyst.archive.rewardPerStack'), value: `${rew.label}  ${rew.value}` },
      { label: t('catalyst.archive.penaltyPerStack'), value: `${pen.label}  ${pen.value}` },
      {
        label: t('catalyst.archive.atCap', { n: SLOT_CAP }),
        value: t('catalyst.archive.capValue', { reward: capRew.value, penalty: capPen.value }),
      },
      {
        label: t('catalyst.archive.labelSalvage'),
        value: t('catalyst.salvage.gained', { n: catalystSalvageValue(def.id) }),
      },
      {
        label: t('catalyst.archive.labelPrice'),
        value: purchasable
          ? t('catalyst.shop.price', { n: catalystBuyPrice(def.id) })
          : t('catalyst.archive.notSold'),
      },
    ];

    /**
     * 설명은 줄 수가 촉매마다 다르다. 표를 패널 바닥에 고정하면 짧은 설명에서 가운데가 통째로
     * 비고, 설명 바로 아래에 고정하면 긴 설명에서 겹친다. **실측 높이로 이어 붙이고** 바닥을
     * 넘으면 그만큼 위로 당긴다 — 행 하단 문구(`placeNote`)와 같은 규율이다. 캔버스 없는
     * 환경에서 `Text.height` 가 던지므로 폴백을 둔다.
     */
    let descH = 0;
    try {
      descH = d.desc.height;
    } catch {
      descH = 0;
    }
    const wanted = d.desc.position.y + (descH > 0 ? descH : DETAIL_DESC_FALLBACK_H) + DETAIL_TABLE_GAP;
    const top = Math.min(wanted, this.detailRowsBottom - lines.length * DETAIL_ROW_H);

    d.rows.forEach((r, i) => {
      const line = lines[i];
      const has = line !== undefined;
      r.label.visible = has;
      r.value.visible = has;
      if (line === undefined) return;
      r.label.text = line.label;
      r.value.text = line.value;
      const y = top + i * DETAIL_ROW_H;
      r.label.position.y = y;
      r.value.position.y = y;
    });
  }

  /** 행 선택 — 48행을 다시 그리지 않고 이전/현재 행의 표시만 뒤집는다. */
  private select(id: number): void {
    if (this.selectedId === id) return;
    const prev = this.selectedId;
    this.selectedId = id;
    if (prev !== null) this.rowSelect.get(prev)?.(false);
    this.rowSelect.get(id)?.(true);
    this.syncDetail();
  }

  private buildAux(box: { x: number; y: number; w: number; h: number }): void {
    const panel = this.panels[2];
    if (panel === undefined) return;
    const cx = box.x + box.w / 2;

    const value = new Text({
      resolution: 2,
      text: '—',
      style: { fontFamily: UI_FONT, fontSize: 68, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    value.anchor.set(0.5, 0);
    value.position.set(cx, box.y + 10);
    panel.container.addChild(value);
    this.residueValue = value;

    // 잔재가 **무엇인지**. 큰 숫자 하나만 두면 패널이 안내판이 아니라 공백이 된다.
    const use = new Text({
      resolution: 2,
      text: t('catalyst.archive.residueUse'),
      style: {
        fontFamily: UI_FONT, fontSize: 17, fill: SLAB_BODY_FILL, wordWrap: true,
        wordWrapWidth: box.w, align: 'center', lineHeight: 24, dropShadow: TEXT_SHADOW,
      },
    });
    use.anchor.set(0.5, 0);
    use.position.set(cx, box.y + 100);
    panel.container.addChild(use);

    const summary = new Text({
      resolution: 2,
      text: '',
      style: { fontFamily: UI_FONT, fontSize: 20, fontWeight: '700', fill: COLOR.cream, align: 'center', dropShadow: TEXT_SHADOW },
    });
    summary.anchor.set(0.5, 0);
    summary.position.set(cx, box.y + 150);
    panel.container.addChild(summary);
    this.affordable = summary;

    const note = new Text({
      resolution: 2,
      text: '',
      style: {
        fontFamily: UI_FONT, fontSize: 17, fill: SLAB_BODY_FILL, wordWrap: true,
        wordWrapWidth: box.w, align: 'center', lineHeight: 24, dropShadow: TEXT_SHADOW,
      },
    });
    note.anchor.set(0.5, 0);
    note.position.set(cx, box.y + 196);
    panel.container.addChild(note);
    this.residueNote = note;

    /**
     * 분해·구매 결과 문구를 **이 패널 바닥**에 둔다(옛 위치: 화면 하단 중앙).
     *
     * 이 화면의 액션은 전부 우측 컨트롤에서 일어나고 결과는 잔재 잔고의 변화다. 문구를 화면
     * 반대편 끝에 두면 방금 무슨 일이 일어났는지 보려고 시선이 화면을 가로질러야 하고, 패널
     * 접지 그림자가 번지는 띠라 바탕도 불안정하다. 잔고 바로 아래가 그 결과의 자리다.
     */
    const hint = new Text({
      resolution: 2,
      text: '',
      style: {
        fontFamily: UI_FONT, fontSize: 19, fontWeight: '700', fill: 0x8affc0, wordWrap: true,
        wordWrapWidth: box.w, align: 'center', lineHeight: 26, dropShadow: TEXT_SHADOW,
      },
    });
    hint.anchor.set(0.5, 1);
    hint.position.set(cx, box.y + box.h - 8);
    panel.container.addChild(hint);
    this.hintText = hint;
  }

  /** 크롬의 **값만** 갱신한다(서버 왕복·힌트 변경). 배경·패널은 다시 만들지 않는다. */
  private syncChrome(): void {
    this.buildChips();
    if (this.residueValue !== null) {
      this.residueValue.text = this.residue === null ? '—' : String(this.residue);
    }
    if (this.residueNote !== null) {
      // 정상 상태에서는 **비워 둔다.** 여기 설명을 채우려면 새 i18n 키가 필요한데, 잔고가
      // 정상일 때 굳이 문장을 얹으면 패널이 안내판이 된다 — 이 자리는 큰 숫자가 주인공이다.
      // 상태가 나쁠 때만 사유를 낸다(원인 불명 무반응 금지).
      const bad = !this.online
        ? t('catalyst.shop.offline')
        : this.residue === null
          ? t('catalyst.shop.noProfile')
          : '';
      this.residueNote.text = bad;
      this.residueNote.visible = bad !== '';
    }
    if (this.affordable !== null) {
      // **잔재 패널은 잔재만 다룬다.** 여기 있던 "보유 N종 · 합계 N개"는 잔재와 무관한 값이라
      // 제목("촉매 잔재")과 소속이 어긋났고, 필터 탭을 눌러도 안 변해 목록과 어긋나 보였다
      // (사용자 지적 2026-08-02). 지금 잔고로 **무엇을 할 수 있는지**가 이 자리의 값이다.
      const r = this.residue;
      let n = 0;
      if (r !== null) {
        for (const def of CATALYSTS) {
          const price = catalystBuyPrice(def.id);
          if (catalystIsPurchasable(def.id) && price > 0 && r >= price) n++;
        }
      }
      this.affordable.text = r === null ? '' : t('catalyst.archive.affordable', { n });
      this.affordable.visible = r !== null;
    }
    if (this.hintText !== null) {
      this.hintText.text = this.hint;
      this.hintText.visible = this.hint !== '';
    }
    this.syncDetail();
  }

  // --- 목록 ----------------------------------------------------------------

  /**
   * 필터를 통과하는 **전 카탈로그**(id 오름차순). ADR-0042 이후 촉매 보관함은 상점을 겸하므로
   * 미보유 행도 그린다 — 보유분만 그리면 CONTEXT.md 의 "상시 전 카탈로그가 진열"과 어긋나고,
   * 신규 플레이어에게 `signature` 필터 탭이 통째로 빈 목록이 된다.
   */
  private visibleList(): { def: CatalystDef; qty: number }[] {
    const out: { def: CatalystDef; qty: number }[] = [];
    for (const def of CATALYSTS) {
      if (this.filter === 'common' && def.kind !== 'common') continue;
      if (this.filter === 'signature' && def.kind !== 'signature') continue;
      out.push({ def, qty: this.inventory.get(def.id) ?? 0 });
    }
    return out;
  }

  /** 48행만 갈아끼운다. 배경·패널·헤더는 그대로 둔다(파일 헤더 "재렌더 규율"). */
  private renderList(): void {
    const host = this.listHost;
    const box = this.listBox;
    if (host === null || box === null) return;

    this.rowRefs.clear();
    this.rowSelect.clear();
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }

    const list = this.visibleList();
    if (list.length === 0) {
      const empty = new Text({
        resolution: 2,
        text: t('catalyst.manage.empty'),
        style: {
          fontFamily: UI_FONT,
          fontSize: 20,
          fill: SLAB_BODY_FILL,
          wordWrap: true,
          wordWrapWidth: box.w - 40,
          align: 'center',
          dropShadow: TEXT_SHADOW,
        },
      });
      empty.anchor.set(0.5);
      empty.position.set(box.x + box.w / 2, box.y + box.h / 2);
      host.addChild(empty);
      return;
    }

    const totalH = list.length * (ROW_H + ROW_GAP) - ROW_GAP;
    // 제목 띠와 첫 행 사이 숨 — 붙여 놓으면 목록이 띠에서 흘러나온 것처럼 읽힌다.
    const content = makeScrollArea(host, {
      x: box.x,
      y: box.y + LIST_TOP_PAD,
      w: box.w,
      h: box.h - LIST_TOP_PAD,
      totalH,
      get: () => this.scrollY,
      set: (v) => {
        this.scrollY = v;
      },
      thumb: true,
    });

    list.forEach((entry, i) => {
      const row = this.makeRow(entry.def, entry.qty, box.w);
      row.position.set(0, i * (ROW_H + ROW_GAP));
      content.addChild(row);
    });
  }

  private makeRow(def: CatalystDef, qty: number, rowW: number): Container {
    const row = new Container();
    const plate = rowPlate(rowW, ROW_H, def.kind === 'signature');
    row.addChild(plate.view);
    plate.setSelected(this.selectedId === def.id);
    this.rowSelect.set(def.id, plate.setSelected);
    // ⚠️ 행 클릭은 **행 Container** 에 건다. 바탕 Graphics 에만 걸면 위에 얹힌 텍스트가 클릭을
    // 삼킨다(Pixi 히트 테스트는 형제로 내려가지 않는다 — 이 리포가 관제탑에서 실제로 밟았다).
    attachRowClick(row, () => this.select(def.id));

    // 아이콘: 개별 아트 → 보상축 폴백 → 축 토큰 글리프 순(픽커와 같은 사다리).
    const iconTex = this.ui[`${catalystIconKey(def)}.png`] ?? this.ui[`${catalystIconFallbackKey(def)}.png`];
    if (iconTex) {
      const sp = new Sprite(iconTex);
      sp.width = ICON_SIZE;
      sp.height = ICON_SIZE;
      sp.position.set(ICON_X, (ROW_H - ICON_SIZE) / 2);
      row.addChild(sp);
    } else {
      const token = new Graphics();
      token
        .roundRect(ICON_X, (ROW_H - ICON_SIZE) / 2, ICON_SIZE, ICON_SIZE, 8)
        .fill({ color: def.kind === 'signature' ? 0x3a2f18 : 0x2a2440 })
        .stroke({ color: ROW_GROOVE, width: 2, alignment: 1 });
      row.addChild(token);
      const glyph = new Text({
        resolution: 2,
        text: AXIS_GLYPH[def.reward.axis] ?? '?',
        style: { fontFamily: UI_FONT, fontSize: 28, fontWeight: '800', fill: COLOR.cream },
      });
      glyph.anchor.set(0.5);
      glyph.position.set(ICON_X + ICON_SIZE / 2, ROW_H / 2);
      row.addChild(glyph);
    }

    const name = new Text({
      resolution: 2,
      text: `${t(`catalyst.${def.slug}.name` as MessageKey)}  ${t('catalyst.manage.owned', { n: qty })}`,
      style: { fontFamily: UI_FONT, fontSize: 22, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    name.position.set(ROW_TEXT_X, 16);
    row.addChild(name);

    // 우측 컨트롤 폭 파생 — SALVAGE_W 만 빼던 옛 식으로는 구매 버튼을 얹는 순간 글자가 버튼
    // 밑으로 들어간다.
    const wrapW = rowW - ROW_TEXT_X - ROW_CTRL_W - 32;

    const info = new Text({
      resolution: 2,
      text: `${t(def.kind === 'signature' ? 'catalyst.kind.signature' : 'catalyst.kind.common')}  ·  ${t(`catalyst.${def.slug}.desc` as MessageKey)}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 16,
        fill: SLAB_BODY_FILL,
        wordWrap: true,
        wordWrapWidth: wrapW,
        // ⚠️ y·lineHeight 를 여기서 직접 정하지 않는다 — 하단 문구의 세로 예산이 이 값들에서
        // 파생되므로, 둘이 서로를 모르는 채 각자 고정되면 줄 수가 늘 때 조용히 겹친다.
        lineHeight: INFO_LINE_H,
        dropShadow: TEXT_SHADOW,
      },
    });
    info.position.set(ROW_TEXT_X, INFO_Y);
    row.addChild(info);

    // 행 하단 한 줄: 분해 획득량 · 구매가 · 거부 사유. 스테퍼로 수량이 바뀌면 이 Text 만 갈린다.
    const note = new Text({
      resolution: 2,
      text: rowNoteText(this.rowState(def)),
      style: {
        fontFamily: UI_FONT,
        fontSize: 15,
        fill: COLOR.cream,
        wordWrap: true,
        wordWrapWidth: wrapW,
        lineHeight: NOTE_LINE_H,
        dropShadow: TEXT_SHADOW,
      },
    });
    row.addChild(note);
    /**
     * 문구는 줄 수가 런타임에 변한다(사유가 붙으면 2줄). 고정 y 로 두면 둘째 줄이 행 테두리
     * 밖으로 잘리므로 **실측 높이로 하단 정렬**한다. 배치 산술은 순수 헬퍼가 하고, 캔버스 없는
     * 환경에서 `Text.height` 접근이 던지면 상단 기준으로 안전 폴백한다.
     */
    const placeNote = (): void => {
      let h = 0;
      try {
        h = note.height;
      } catch {
        h = 0;
      }
      const layout = noteLayout(h);
      note.scale.set(layout.scale);
      note.position.set(ROW_TEXT_X, h > 0 ? layout.y : NOTE_FALLBACK_Y);
    };
    placeNote();

    // --- 우측 컨트롤(세로 2단: 스테퍼 / [분해][구매]) ---
    const ctrlX = rowW - ROW_CTRL_W - ROW_CTRL_PAD;

    const qtyText = new Text({
      resolution: 2,
      text: String(this.qtyOf(def.id)),
      style: { fontFamily: UI_FONT, fontSize: 22, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    qtyText.anchor.set(0.5);
    qtyText.position.set(ctrlX + ROW_CTRL_W / 2, STEP_Y + STEP_H / 2);
    row.addChild(qtyText);

    const salvage = this.chromeButton({
      tone: 'red',
      width: ROW_BTN_W,
      height: ROW_BTN_H,
      fontSize: 16,
      label: salvageLabel(this.rowState(def)),
      onClick: () => void this.salvageOne(def),
    });
    salvage.container.position.set(ctrlX, ROW_BTN_Y);
    stopRowPropagation(salvage.container);
    row.addChild(salvage.container);

    const buy = this.chromeButton({
      tone: 'gold',
      width: ROW_BTN_W,
      height: ROW_BTN_H,
      fontSize: 17,
      label: t('catalyst.shop.buy'),
      onClick: () => void this.buyOne(def),
    });
    buy.container.position.set(ctrlX + ROW_BTN_W + ROW_BTN_GAP, ROW_BTN_Y);
    stopRowPropagation(buy.container);
    row.addChild(buy.container);

    /** 행 로컬 갱신 — 목록을 다시 그리지 않고 텍스트·활성만 갈아끼운다(재렌더 규율). */
    const sync = (): void => {
      const s = this.rowState(def);
      qtyText.text = String(s.qty);
      note.text = rowNoteText(s);
      // 문구가 갈리면 줄 수도 갈린다 — 갈아끼운 **뒤에** 다시 배치해야 넘침이 안 생긴다.
      placeNote();
      // 라벨도 수량을 반영한다(고정 "1개 분해" 는 실제 3개 분해와 모순돼 오조작을 부른다).
      salvage.setLabel(salvageLabel(s));
      salvage.setEnabled(salvageEnabled(s));
      buy.setEnabled(buyEnabled(s));
    };
    this.rowRefs.set(def.id, sync);

    const step = (d: number): void => {
      this.qtyById.set(def.id, clampQty(this.qtyOf(def.id) + d));
      sync();
    };
    const minus = this.chromeButton({
      tone: 'stone',
      width: STEP_H,
      height: STEP_H,
      fontSize: 22,
      label: '−',
      onClick: () => step(-1),
    });
    minus.container.position.set(ctrlX, STEP_Y);
    stopRowPropagation(minus.container);
    row.addChild(minus.container);

    const plus = this.chromeButton({
      tone: 'stone',
      width: STEP_H,
      height: STEP_H,
      fontSize: 22,
      label: '+',
      onClick: () => step(1),
    });
    plus.container.position.set(ctrlX + ROW_CTRL_W - STEP_H, STEP_Y);
    stopRowPropagation(plus.container);
    row.addChild(plus.container);

    if (!this.online) {
      minus.setEnabled(false);
      plus.setEnabled(false);
    }
    sync();

    return row;
  }
}
