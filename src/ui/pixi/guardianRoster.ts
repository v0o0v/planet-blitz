/**
 * 예비역 수호기 로스터 화면 — Pixi (ADR-0024 Task #8 · 2026-08-02 AAA 시네마틱 전환).
 *
 * 격납고에서 진입하는 **하위 화면**이다(챔피언 선택·촉매 보관함과 동일 suspend/resume 규약).
 * 미소멸 수호기를 한 줄씩 나열하고, 각 행의 [소멸] 버튼 → 확인 팝업으로 그 수호기를 소멸시킨다.
 * 소멸하면 잠긴 장비가 창고로 반환되고(`dismissGuardianRecord`) 계보 포인트를 회수한다.
 *
 * ## 시네마틱 전환에서 바뀐 것은 **바탕**뿐이다
 * `nineSlicePanel`(나무) → `makeCinematicPanel`(석재 슬래브), `makeBanner` → `makeHangarTitle`,
 * `ui_btn_*.png` → `cinematicButtonTexture`, `makeModal`(나무) → 이 파일의 시네마틱 팝업.
 * 소멸 계약·저장 경로·구 수호기 폴백은 한 줄도 건드리지 않았다.
 *
 * ## 왜 슬래브 + 행인가 — 기지의 카드(`cinematicTile`)가 아니라
 * 로스터는 **길이가 무제한**이다(퇴역할 때마다 한 기씩 쌓인다). 카드 격자를 배경 위에 직접
 * 띄우면 스크롤 클리핑 경계가 배경 위 허공에 생겨 잘린 카드가 떠 있는 것처럼 읽힌다 — 목록에는
 * 담는 **그릇**이 필요하다. 그릇을 두고 그 안에 카드를 넣으면 패널 안의 패널이 된다. 바로 앞
 * 형제 화면(촉매 보관함 PR#247)이 같은 문제를 슬래브 + 행 판으로 이미 풀었고, 형제끼리 언어가
 * 갈리면 화면 전환에서 튄다.
 *
 * ## 왜 배경 **창을 두지 않는가**(`windows: []`)
 * 촉매 보관함의 교훈 그대로다: **창은 "배경이 보이는 구멍"이 아니라 "무언가를 보여주는 자리"다.**
 * 이 화면에도 함선을 세울 수는 있지만(`shipDock.ts`), 예비역은 기체 타입만 같고 개체가 다른
 * 것들이라 행을 바꿔도 같은 그림이 나오는 자리가 된다. 그 자리는 **소멸이 무엇을 되돌려주는지**가
 * 차지한다 — 되돌릴 수 없는 조작 표면에서 가장 값어치 있는 정보다.
 *
 * ## 행 사이에 **선을 긋지 않는다**
 * 세로 리브·가로 이음선·각인 번호판은 사용자가 격납고에서 삭제를 지시한 것들이다(2026-08-02).
 * 행 구분은 선이 아니라 **면의 밝기 차 + 2단 접지 그림자 + 행 간격**이 만든다.
 *
 * ## 소멸은 되돌릴 수 없다 — 가독성이 연출보다 우선이다
 * 확인 팝업의 암막은 뒤 화면 글자가 **읽히지 않을 만큼** 짙고(`alpha 0.92`), 본문은 크림색 큰
 * 글자(20px)다. 팝업 위에는 배경 연출을 얹지 않는다.
 *
 * ## 실측 규칙
 * - **휠은 클립 Container + hitArea 에**(`makeScrollArea`). 마스크 Graphics 는 히트 제외.
 * - **행 클릭은 행 Container 에**. 버튼은 `stopRowPropagation` 으로 전파를 끊는다.
 * - **여백은 패널의 `box` 안에만**(패널 로컬).
 * - **격납고와는 `show()`/`onClose`** — `show()` 로 되돌리면 미저장 편집이 사라진다.
 * - 연출은 `update(dt)` 로만 산다. 격납고가 **자기 가시성 가드보다 먼저** dt 를 흘린다(이 화면이
 *   떠 있는 동안 격납고 root 는 `suspend()` 로 숨겨져 있다).
 *
 * ## 재렌더 규율
 * `render()` 로 루트를 통째로 다시 그리면 목록이 갈릴 때마다 1376×768 배경과 석재 패널이 다시
 * 구워진다. `buildChrome()` 은 1회, `renderList()` 가 행만, 선택 변경은 두 행의 링과 상세
 * 패널의 `.text` 만 갈아끼운다.
 *
 * 순수 render/UI 레이어(ADR-0005 · ADR-0014) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { EQUIP_SLOTS, type EquipSlotId, type Item } from '../../items/types.js';
import {
  saveProfile,
  type KeyValueStore,
  type Profile,
  type GuardianRecord,
} from '../../save/profile.js';
import { activeGuardians, dismissGuardianRecord } from '../../save/guardianLifecycle.js';
import { dismissGuardianOnServer, isLineageOnline, pullLineageState } from '../../net/lineage.js';
import { applyServerLineageState } from '../../net/lineageMirror.js';
import { dismissPoints, GUARDIAN_INTERCEPTOR } from '../../../data/guardian.js';
import { shipTypeDef } from '../../../data/ships/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW, RARITY_COLOR_NUM } from './theme.js';
import { PixiButton } from './button.js';
import { attachRowClick, stopRowPropagation } from './listRow.js';
import { makeScrollArea } from './scrollArea.js';
import { itemDisplayName } from '../itemNames.js';
import { equipIconName } from '../equipIcons.js';
import { loadUiTextures, shipPortraitName, type UiTextures } from './uiTextures.js';
import { shipTypeName } from './shipLabels.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { loadHangarTextures, HANGAR_BACKDROP_NAME, type HangarTextures } from './hangarTextures.js';
import { HangarBackdrop } from './hangarBackdrop.js';
import { makeCinematicPanel, type CinematicPanel } from './cinematicPanel.js';
import { HELP_HEAD_W, openHelpOverlay, type HelpSpec } from './helpModal.js';
import {
  makeHangarTitle,
  cinematicButtonTexture,
  chromeFallbackColor,
  chromeLabelColor,
  type ChromeTone,
} from './hangarChrome.js';

// ---------------------------------------------------------------------------
// 레이아웃(디자인 스페이스 1920×1080)
//
// 여백 어휘(32 / 28 / 20 / 하단 28)와 헤더 높이 104 는 격납고·촉매 보관함과 **같은 값**이다.
// 형제 화면끼리 다르면 전환에서 튄다.
// ---------------------------------------------------------------------------

/** 헤더 밴드 높이 — 배경이 그대로 보이는 자리. 각인 석재 인방은 얹지 않는다(사용자 확정). */
const HEADER_H = 104;
/** 헤더 컨트롤의 세로 띠 — 전부 이 하나를 쓴다(격납고 헤더 겹침 결함 이력). */
const HEAD_Y = 26;
const HEAD_H = 52;
const EDGE_X = 32;
const GUTTER_X = 28;

const LIST_X = EDGE_X;
const LIST_Y = HEADER_H + 8;
const LIST_W = 1150;
const LIST_H = 940;
const SIDE_X = LIST_X + LIST_W + GUTTER_X;
const SIDE_W = DESIGN_WIDTH - EDGE_X - SIDE_X;
const DETAIL_Y = LIST_Y;
/**
 * 상세 패널 높이는 **콘텐츠가 정한다.** 처음에는 목록 패널과 같은 940 으로 뒀는데, 상세가 쓰는
 * 세로는 이름 + 수치 4행 + 장비 8행 ≈ 500 뿐이라 아래로 400px 가 통째로 비었다 — 촉매 보관함이
 * 창을 뚫었다가 뺀 것과 정확히 같은 결함("쓸모도 볼거리도 아닌 자리")이다. 남는 세로는 계보
 * 패널이 받는다.
 */
const DETAIL_H = 596;
const ROW_GAP_Y = 20;
const AUX_Y = DETAIL_Y + DETAIL_H + ROW_GAP_Y;
/** 계보 패널 바닥은 목록 패널 바닥과 **같아야** 한다 — 파생으로 강제한다(하드코딩 금지). */
const AUX_H = LIST_Y + LIST_H - AUX_Y;

/** 헤더 닫기 한 변. */
const CLOSE_W = 56;
const HEAD_GAP = 12;
const CLOSE_X = DESIGN_WIDTH - EDGE_X - CLOSE_W;
const HELP_X = CLOSE_X - HEAD_GAP - 2 - HELP_HEAD_W;

export const ROSTER_HELP: HelpSpec = {
  prefix: 'guardians.help',
  sections: ['s1', 's2', 's3', 's4'],
};

/**
 * 좌상단 예약 밴드 — `main.ts` SettingsScreen 의 설정 톱니가 쓰는 **전 화면 공용 자리**다.
 * 톱니는 매 프레임 stage 최상위로 올라오므로, 여기에 컨트롤을 두면 통째로 클릭 불가가 된다
 * (격납고에서 실측으로 확인된 자리).
 */
export const GEAR_BAND_W = 120;
export const GEAR_BAND_H = 120;

/** 화면 좌표 사각형(디자인 스페이스). */
export interface GuardianRosterRect {
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
 * 꺼내 두면 겹침·화면 이탈·예약 밴드 침범을 단위 테스트가 잠근다
 * (`tests/guardianRosterLayout.test.ts`).
 */
export function guardianRosterLayout(): {
  readonly screen: GuardianRosterRect;
  readonly headerH: number;
  readonly panels: readonly {
    readonly id: 'list' | 'detail' | 'lineage';
    readonly rect: GuardianRosterRect;
  }[];
  readonly headerControls: readonly { readonly id: string; readonly rect: GuardianRosterRect }[];
} {
  const closeX = CLOSE_X;
  const head = (x: number, w: number): GuardianRosterRect => ({ x, y: HEAD_Y, w, h: HEAD_H });
  return {
    screen: { x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT },
    headerH: HEADER_H,
    panels: [
      { id: 'list', rect: { x: LIST_X, y: LIST_Y, w: LIST_W, h: LIST_H } },
      { id: 'detail', rect: { x: SIDE_X, y: DETAIL_Y, w: SIDE_W, h: DETAIL_H } },
      { id: 'lineage', rect: { x: SIDE_X, y: AUX_Y, w: SIDE_W, h: AUX_H } },
    ],
    headerControls: [
      { id: 'help', rect: head(HELP_X, HELP_HEAD_W) },
      { id: 'close', rect: head(closeX, CLOSE_W) },
    ],
  };
}

/** 행 한 칸(이름 + 정보 한 줄 + 소멸 버튼)과 행 사이 틈. */
const ROW_H = 116;
const ROW_GAP = 12;
/** 제목 띠와 첫 행 사이 숨 — 붙여 놓으면 목록이 띠에서 흘러나온 것처럼 읽힌다. */
const LIST_TOP_PAD = 10;

const DISMISS_W = 180;
const DISMISS_H = 56;
/** 행 우측 컨트롤 여백. */
const ROW_CTRL_PAD = 16;
/** 행 아이콘 한 변과 좌측 여백 — 글자 x 는 여기서 **파생**한다(하드코딩 금지). */
const ROW_ICON = 72;
const ROW_ICON_X = 18;
const ROW_TEXT_X = ROW_ICON_X + ROW_ICON + 16;

const CONFIRM_W = 760;
/**
 * 팝업 높이는 **본문이 정한다.** 처음 420 으로 뒀더니 2줄짜리 본문과 바닥 버튼 사이가 200px
 * 넘게 비어 "무언가 로딩 중"처럼 읽혔다(실화면 1차 확인). 본문 3줄(EN 로케일 최악)까지 담고
 * 버튼 위로 숨 쉴 틈만 남긴다.
 */
const CONFIRM_H = 288;

/**
 * 계보 패널 세로 예산(패널 로컬, 상자 기준). 큰 숫자(68px) → 용도 1줄 → 경고 2줄 순으로 위에서
 * 아래로만 쌓는다. 결과 문구만 바닥에 붙는다 — 양쪽에서 쌓으면 겹친다({@link buildAux} 주석).
 */
const AUX_USE_Y = 84;
const AUX_WARN_Y = 116;

/** 상세 패널 수치 표 — 행 수 고정이라 위젯을 미리 만든다. */
const STAT_ROWS = 4;
const STAT_ROW_H = 34;
/** 잠긴 장비 목록 — 슬롯이 8칸이므로 그 이상은 나올 수 없다. */
const GEAR_ROWS = EQUIP_SLOTS.length;
const GEAR_ROW_H = 34;
/** 장비 행 아이콘 한 변 — 행 높이보다 작아야 세로로 안 겹친다. 글자 x 가 여기서 파생된다. */
const GEAR_ICON = 26;
const GEAR_TEXT_X = GEAR_ICON + 12;

/**
 * 석재 슬래브 위 **보조 텍스트색**. `hangar.ts` 의 `SLAB_BODY_FILL` 을 복제한 것이다(레인 계약
 * "복제하고 헤더에 출처를 밝혀라" — 그 파일은 화면이지 공용 모듈이 아니다).
 *
 * 옛 `COLOR.muted`(#aa9b87)를 쓸 수 없는 이유: 슬래브 면의 동작점이 L* 19 → 28 로 올라가면서
 * 그 위 글자의 대비가 3.00:1 로 WCAG AA 미달이 됐다. 배경을 도로 어둡게 하면 "화면 과반이
 * 평평한 암면" 결함이 되돌아오므로 **전경만 올린다.** `#e4dac7` 은 최악의 바탕에서 4.84:1.
 */
const SLAB_BODY_FILL = 0xe4dac7;

/** 경고 문구색 — 소멸은 되돌릴 수 없다. 붉은 계열이되 슬래브 위에서 읽히는 밝기로. */
const WARN_FILL = 0xffa98a;

/**
 * 행 판 바탕색. 슬래브 면보다 한 단 밝아야 판으로 선다.
 * (촉매 보관함 `rowPlate` 에서 복제 — 형제 화면끼리 행 어휘가 갈리면 안 된다.)
 */
const ROW_FACE = 0x3b3327;
/** 행 판 안쪽 어두운 홈. 밝은 링이 아니라 **어두운 홈**으로 대비를 만든다(iconContrastRingBands). */
const ROW_GROOVE = 0x17130d;
const ROW_RADIUS = 10;

// --- 행 판 조명 램프(모듈 1회 굽기) ------------------------------------------

/**
 * 행 판의 **방향성 조명**을 위한 세로 알파 램프.
 *
 * ⚠️ 띠를 겹쳐 그라디언트를 근사하지 않는다 — 1px 겹침이 알파를 두 배로 만들어 가로줄이 생긴다
 * (실제 사용자 신고). 폭 1px 캔버스에 픽셀로 굽고 `linear` 로 늘린다.
 *
 * (촉매 보관함 `rowRamp` 에서 복제. 두 화면이 형제라 같은 값이어야 하고, 그 파일은 공용 모듈이
 * 아니라 화면이라 import 하지 않는다.)
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
 * **선은 긋지 않는다.** 행 사이 구분은 이 그림자와 행 간격이 만든다(파일 헤더).
 */
function rowPlate(w: number, h: number): { view: Container; setSelected: (on: boolean) => void } {
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

  /**
   * 선택 링. **구분선이 아니라 상태 표시다** — 행 사이를 가르는 선은 표의 괘선으로 읽혀 금지지만,
   * 지금 무엇을 보고 있는지는 목록과 상세 패널을 잇는 유일한 단서다. 한 번에 한 행에만 붙는다.
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

/** 수호기의 잠긴 장비 수(build 없는 구 수호기는 0). 순수. */
export function countLockedGear(g: GuardianRecord): number {
  const eq = g.build?.equipped;
  if (eq === undefined) return 0;
  let n = 0;
  for (const key of Object.keys(eq) as EquipSlotId[]) {
    if (eq[key] !== undefined) n++;
  }
  return n;
}

/**
 * 잠긴 장비를 **슬롯 순서**로 편다(빈 칸은 뺀다). 소멸 시 창고로 돌아오는 것들이다.
 * `EQUIP_SLOTS` 순서를 쓰는 이유: `Object.keys` 순서는 세이브 직렬화 순서에 끌려다닌다.
 */
export function lockedGearList(g: GuardianRecord): { slot: EquipSlotId; item: Item }[] {
  const eq = g.build?.equipped;
  if (eq === undefined) return [];
  const out: { slot: EquipSlotId; item: Item }[] = [];
  for (const slot of EQUIP_SLOTS) {
    const item = eq[slot];
    if (item !== undefined) out.push({ slot, item });
  }
  return out;
}

/**
 * 행에 보여 줄 수호기 이름. build 가 있으면 그 기체 타입 표시명, 없으면(ADR-0024 이전 구 수호기)
 * 프리셋 라벨(타이탄형/인터셉터형)로 폴백한다.
 */
export function guardianTypeLabel(g: GuardianRecord): string {
  if (g.build !== undefined) return shipTypeName(shipTypeDef(g.build.typeId));
  return t(g.preset === GUARDIAN_INTERCEPTOR ? 'def.guardian.interceptor' : 'def.guardian.titan');
}

/** 남은 성능 표시값(centi-percent → 퍼센트 문자열). 정수면 소수점을 붙이지 않는다. */
function perfText(g: GuardianRecord): string {
  const v = g.performanceCP / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export interface GuardianRosterCallbacks {
  /** 화면을 닫을 때. 격납고가 `resume()` 하는 자리. */
  onClose: () => void;
}

export class GuardianRosterScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private profile: Profile;
  private readonly store: KeyValueStore | null;
  private ui: UiTextures = {};
  private cb: GuardianRosterCallbacks | null = null;
  private art: HangarTextures = {};
  private scrollY = 0;
  /** 소멸 확인 팝업 대상 수호기 id(null = 팝업 닫힘). */
  private confirming: string | null = null;
  /** 소멸 직후 피드백 한 줄(반환 장비 수·회수 포인트). 상세 패널 바닥에 뜬다. */
  private hint = '';
  /** 서버 왕복 중 — 같은 수호기를 두 번 소멸 요청하지 않는다(되돌릴 수 없다). */
  private busy = false;
  /** 상세 패널이 보여 줄 수호기 id. */
  private selectedId: string | null = null;
  /** 진입 시점의 런 HUD `visibility`(닫을 때 그대로 되돌린다 — 챔피언 선택 C-4 규약). */
  private hudPrevVisibility: string | null = null;

  // --- 유지되는 크롬(파일 헤더 "재렌더 규율") ---
  private backdrop: HangarBackdrop | null = null;
  private panels: CinematicPanel[] = [];
  /** 팝업 패널은 나고 지므로 따로 잡는다(연출 dt 를 받아야 한다). */
  private modalPanel: CinematicPanel | null = null;
  private listHost: Container | null = null;
  private listBox: { x: number; y: number; w: number; h: number } | null = null;
  /** 계보 잔고 큰 숫자와 결과 문구 — 소멸 후 `.text` 만 갈린다. */
  private lineageValue: Text | null = null;
  private hintText: Text | null = null;
  private modalHost: Container | null = null;
  private helpOpen = false;
  private helpScroll = 0;
  /** 상세 패널 위젯 — 선택이 바뀌면 `.text`·가시성만 갈아끼운다(패널은 다시 안 만든다). */
  private detail: {
    box: { x: number; y: number; w: number; h: number };
    name: Text;
    stats: { label: Text; value: Text }[];
    gearTitle: Text;
    gearRows: { icon: Sprite; slot: Text; item: Text }[];
    gearNone: Text;
    empty: Text;
  } | null = null;
  /** 행별 선택 표시 토글 — 선택이 바뀔 때 목록을 다시 그리지 않기 위한 핸들. */
  private readonly rowSelect = new Map<string, (on: boolean) => void>();
  private chromeBuilt = false;

  constructor(profile: Profile, stage: Container, store: KeyValueStore | null = null) {
    this.profile = profile;
    this.store = store;
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
   * ⚠️ 격납고가 **자기 가시성 가드보다 먼저** 이 메서드를 부른다 — 이 화면이 떠 있는 동안 격납고
   * root 는 `suspend()` 로 숨겨져 있기 때문이다. 숨겨져 있으면 즉시 반환하므로 비용은 0 이다.
   */
  update(dt: number): void {
    if (!this.root.visible) return;
    this.backdrop?.update(dt);
    for (const p of this.panels) p.update(dt);
    this.modalPanel?.update(dt);
  }

  show(profile: Profile, cb: GuardianRosterCallbacks): void {
    this.profile = profile;
    this.cb = cb;
    this.hint = '';
    this.confirming = null;
    this.busy = false;
    this.scrollY = 0;
    this.buildChrome();
    this.ensureSelection();
    this.syncChrome();
    this.renderList();
    this.renderModal();
    this.root.visible = true;
    this.raise();
    this.hideRunHud();
    // 서버 정본(계보 잔고 + 수호 목록) pull 은 화면을 띄운 뒤 시작한다. 다른 기기에서 소멸한
    // 수호기가 목록에 남아 있으면 소멸 버튼이 서버에 없는 행을 가리키게 된다.
    if (isLineageOnline()) {
      void pullLineageState().then((state) => {
        if (state === null) return;
        applyServerLineageState(this.profile, state);
        saveProfile(this.profile, this.store ?? undefined);
        this.ensureSelection();
        this.syncChrome();
        this.renderList();
      });
    }
  }

  hide(): void {
    this.root.visible = false;
    this.cb = null;
    this.restoreRunHud();
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

  // --- 동작 ----------------------------------------------------------------

  /**
   * 소멸 확정 — **서버가 확정한다**(ADR-0007 서버 권위, 2026-08-03 배선).
   *
   * 순서가 중요하다: `dismiss_guardian` RPC 가 **먼저** 성공해야 로컬을 변형한다. 소멸은
   * 되돌릴 수 없고 계보 포인트는 서버 잔고가 정본이라, 낙관적으로 지운 뒤 서버가 거부하면
   * 수호기도 장비도 되살릴 방법이 없다.
   *
   * 서버가 회수 포인트를 돌려주지만 **잔고는 pull 로 맞춘다** — RPC 반환은 이번 회수분이지
   * 잔고가 아니다. 로컬 `dismissGuardianRecord` 는 장비 stash 반환과 목록 갱신을 위해 계속
   * 부르고(그 함수가 로컬 available 도 올리지만) 곧바로 pull 이 서버 정본으로 덮는다.
   *
   * `store` 가 null 이면 `?? undefined` 로 기본 store 를 태운다 — `saveProfile` 은 **명시적
   * null 을 "저장하지 마라"로 읽고 즉시 return** 하기 때문이다(격납고/챔피언 선례).
   */
  private performDismiss(id: string): void {
    const g = this.profile.guardians.find((x) => x.id === id);
    this.confirming = null;
    if (g === undefined || g.retired || this.busy) {
      this.renderModal();
      this.renderList();
      return;
    }
    const gearCount = countLockedGear(g);
    this.busy = true;
    this.hint = t('lineage.busy');
    this.renderModal();
    this.syncChrome();
    this.renderList();
    void dismissGuardianOnServer(id).then(async (points) => {
      this.busy = false;
      if (points === null) {
        // 서버가 확정하지 않았다 = 아무 일도 없었다. 수호기도 장비도 그대로다.
        this.hint = t('lineage.failed');
        this.syncChrome();
        this.renderList();
        return;
      }
      const res = dismissGuardianRecord(this.profile, id);
      if (res.dismissed) {
        this.hint = t('guardians.dismissed', { n: gearCount, points });
      }
      if (this.selectedId === id) this.selectedId = null;
      // 서버 정본으로 계보 잔고·수호 목록을 맞춘다. 실패하면 로컬 반영만 남는데, 그건 서버가
      // 이미 소멸을 확정한 뒤라 방향이 같다(다음 진입의 pull 이 마저 맞춘다).
      const state = await pullLineageState();
      if (state !== null) applyServerLineageState(this.profile, state);
      saveProfile(this.profile, this.store ?? undefined);
      this.ensureSelection();
      this.syncChrome();
      this.renderList();
    });
  }

  /** 선택이 비었거나 사라졌으면 첫 수호기로 맞춘다 — 상세 패널이 이유 없이 비지 않게. */
  private ensureSelection(): void {
    const list = activeGuardians(this.profile);
    if (list.length === 0) {
      this.selectedId = null;
      return;
    }
    if (this.selectedId !== null && list.some((g) => g.id === this.selectedId)) return;
    this.selectedId = list[0]?.id ?? null;
  }

  /** 행 선택 — 목록을 다시 그리지 않고 이전/현재 행의 링만 뒤집는다. */
  private select(id: string): void {
    if (this.selectedId === id) return;
    const prev = this.selectedId;
    this.selectedId = id;
    if (prev !== null) this.rowSelect.get(prev)?.(false);
    this.rowSelect.get(id)?.(true);
    this.syncDetail();
  }

  // --- 크롬(1회 조립) -------------------------------------------------------

  /** 자산이 도착하면 크롬을 통째로 다시 세운다(구운 텍스처가 바뀌므로 갱신으로는 안 된다). */
  private rebuild(): void {
    if (!this.chromeBuilt) return;
    this.destroyChrome();
    this.buildChrome();
    this.ensureSelection();
    this.syncChrome();
    this.renderList();
    this.renderModal();
  }

  private destroyChrome(): void {
    // 연출 참조를 먼저 끊는다 — destroy 된 컨테이너를 update 가 만지면 안 된다.
    this.backdrop?.destroy();
    this.backdrop = null;
    for (const p of this.panels) p.destroy();
    this.panels = [];
    this.modalPanel?.destroy();
    this.modalPanel = null;
    this.listHost = null;
    this.listBox = null;
    this.lineageValue = null;
    this.hintText = null;
    this.modalHost = null;
    this.detail = null;
    this.rowSelect.clear();
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
    // 자식이라 어긋난다). 창은 없다 — 배경 노출은 헤더 밴드와 패널 사이 틈뿐이다.
    const backdrop = new HangarBackdrop(this.art[HANGAR_BACKDROP_NAME], {
      windows: [],
      headerH: HEADER_H,
    });
    this.root.addChild(backdrop.view);
    this.backdrop = backdrop;

    // ⚠️ **위 → 아래 순서로 붙인다.** 패널 접지 그림자는 아래로 59px 번지는데 행 간격은 20 이라,
    // 순서가 뒤집히면 위 패널의 그림자가 아래 패널 **위에** 얹혀 얼룩으로 읽힌다.
    const listBox = this.addPanel(LIST_X, LIST_Y, LIST_W, LIST_H, t('guardians.title'));
    const detailBox = this.addPanel(SIDE_X, DETAIL_Y, SIDE_W, DETAIL_H, t('guardians.detail.title'));
    const auxBox = this.addPanel(SIDE_X, AUX_Y, SIDE_W, AUX_H, t('guardians.lineage.title'));

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

    // 팝업은 항상 맨 위에 뜬다 — 그릇을 마지막에 붙인다.
    const modal = new Container();
    this.root.addChild(modal);
    this.modalHost = modal;

    this.chromeBuilt = true;
  }

  /**
   * 석재 패널 한 장을 세우고 **패널 로컬** 콘텐츠 상자를 돌려준다.
   *
   * ⚠️ `screenX`/`screenY` 를 **반드시 넘긴다.** 안 넘기면 같은 치수의 패널끼리 조명·랜드마크
   * 시드가 같아져 위치별 조명이 조용히 무효가 된다 — 화면은 정상적으로 서고 테스트도 통과하므로
   * 눈으로만 잡히는 유형이다. 램프 위치는 형제 화면과 같은 헤더 밴드 중앙 상단이다.
   */
  private addPanel(
    px: number,
    py: number,
    pw: number,
    ph: number,
    title: string,
  ): { x: number; y: number; w: number; h: number } {
    const panel = makeCinematicPanel({
      width: pw,
      height: ph,
      variant: 'slab',
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
      // ⚠️ 텍스처는 128×64 로 구워져 있다 — `cap: 32` 여야 모서리가 안 뭉개진다.
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
   * 헤더 밴드(y 0..{@link HEADER_H}) — 각인 제목(중앙) · 닫기.
   *
   * 계보 포인트는 **헤더 칩이 아니라 우하단 패널의 큰 숫자**다. 소멸이 회수하는 값이라 이 화면의
   * 화폐인데, 헤더 칩과 패널 양쪽에 같은 수를 두면 노이즈가 된다(촉매 보관함이 잔재를 패널
   * 하나로만 낸 것과 같은 판단 — 전 화면 공용 재화만 헤더에 둔다).
   *
   * ⚠️ 컨트롤은 **전부 같은 세로 띠**를 쓰고 가로로만 배치한다(격납고 헤더 겹침 결함 이력).
   * ⚠️ 좌상단 {@link GEAR_BAND_W}×{@link GEAR_BAND_H} 에는 아무것도 두지 않는다 — 설정 톱니가
   * 나중에 stage 최상위로 그려져 그 컨트롤을 통째로 클릭 불가로 만든다.
   * ⚠️ **각인 석재 인방은 넣지 않는다**(격납고에서 사용자 판단으로 제거됨). 헤더는 배경이 그대로
   * 보이는 띠이고, 배경 모듈이 이 대역을 중간 세기로 눌러 글자 대비를 보장한다.
   */
  private buildHeader(): void {
    const title = makeHangarTitle(t('guardians.title'));
    title.position.set(DESIGN_WIDTH / 2, HEAD_Y - 4);
    this.root.addChild(title);

    const closeX = CLOSE_X;
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

    // 도움말 — 닫기와 **같은 세로 띠**를 쓰고 가로로만 자리를 잡는다.
    const help = this.chromeButton({
      tone: 'stone',
      width: HELP_HEAD_W,
      height: HEAD_H,
      fontSize: 20,
      label: t('guardians.help'),
      onClick: () => {
        this.helpOpen = true;
        this.helpScroll = 0;
        this.renderModal();
      },
    });
    help.container.position.set(HELP_X, HEAD_Y);
    this.root.addChild(help.container);
  }

  /**
   * 계보 포인트 패널 — 이 화면의 **화폐**다. 소멸이 회수하는 것이 바로 이 값이라, 큰 숫자가
   * 주인공이고 그 아래에 이 값이 무엇인지·소멸이 되돌릴 수 없다는 경고·직전 결과가 붙는다.
   *
   * 상세 패널의 남는 세로를 이 패널이 받는다(상세는 콘텐츠 높이가 정한다 — {@link DETAIL_H} 주석).
   */
  private buildAux(box: { x: number; y: number; w: number; h: number }): void {
    const panel = this.panels[2];
    if (panel === undefined) return;
    const P = panel.container;
    const cx = box.x + box.w / 2;

    const value = new Text({
      resolution: 2,
      text: '—',
      style: { fontFamily: UI_FONT, fontSize: 68, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    value.anchor.set(0.5, 0);
    value.position.set(cx, box.y + 6);
    P.addChild(value);
    this.lineageValue = value;

    // 큰 숫자 하나만 두면 패널이 안내판이 아니라 공백이 된다 — 이 값이 무엇인지 한 줄로 말한다.
    const use = new Text({
      resolution: 2,
      text: t('guardians.lineage.use'),
      style: {
        fontFamily: UI_FONT, fontSize: 17, fill: SLAB_BODY_FILL, wordWrap: true,
        wordWrapWidth: box.w, align: 'center', lineHeight: 24, dropShadow: TEXT_SHADOW,
      },
    });
    use.anchor.set(0.5, 0);
    use.position.set(cx, box.y + AUX_USE_Y);
    P.addChild(use);

    /**
     * ⚠️ 경고는 **위에서 아래로** 쌓고 결과 문구만 바닥에 붙인다.
     *
     * 처음에는 경고도 바닥 기준(anchor bottom)이었는데, 이 패널은 세로가 232 뿐이라 위에서
     * 내려온 용도 문구(2줄)와 아래에서 올라간 경고(3줄)가 **가운데서 겹쳤다**(실화면 1차 확인).
     * 양쪽에서 쌓으면 세로가 짧을 때 겹침이 구조적으로 생긴다 — 한 방향으로만 쌓고, 문구를
     * 그 예산 안에 들어오는 길이로 줄이는 것이 옳다.
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
    hint.position.set(cx, box.y + box.h - 6);
    P.addChild(hint);
    this.hintText = hint;

    const warn = new Text({
      resolution: 2,
      text: t('guardians.detail.warn'),
      style: {
        fontFamily: UI_FONT, fontSize: 17, fill: WARN_FILL, wordWrap: true,
        wordWrapWidth: box.w, align: 'center', lineHeight: 24, dropShadow: TEXT_SHADOW,
      },
    });
    warn.anchor.set(0.5, 0);
    warn.position.set(cx, box.y + AUX_WARN_Y);
    P.addChild(warn);
  }

  /**
   * 상세 패널 — 목록의 짝이자 **소멸이 무엇을 되돌려주는지**를 말하는 자리.
   *
   * 위젯을 한 번만 만들고 선택이 바뀌면 `.text`·가시성만 갈아끼운다. 행 클릭마다 패널을 다시
   * 세우면 석재 텍스처가 매번 다시 구워진다(파일 헤더 "재렌더 규율").
   */
  private buildDetail(box: { x: number; y: number; w: number; h: number }): void {
    const panel = this.panels[1];
    if (panel === undefined) return;
    const P = panel.container;
    const cx = box.x + box.w / 2;

    const name = new Text({
      resolution: 2,
      text: '',
      style: {
        fontFamily: UI_FONT, fontSize: 30, fontWeight: '800', fill: COLOR.gold,
        align: 'center', wordWrap: true, wordWrapWidth: box.w, dropShadow: TEXT_SHADOW,
      },
    });
    name.anchor.set(0.5, 0);
    name.position.set(cx, box.y + 4);
    P.addChild(name);

    // 수치 표 — 라벨 왼쪽, 값 오른쪽. 행 수 고정.
    const statTop = box.y + 56;
    const stats: { label: Text; value: Text }[] = [];
    for (let i = 0; i < STAT_ROWS; i++) {
      const y = statTop + i * STAT_ROW_H;
      const label = new Text({
        resolution: 2,
        text: '',
        style: { fontFamily: UI_FONT, fontSize: 18, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
      });
      label.position.set(box.x + 6, y);
      P.addChild(label);
      const value = new Text({
        resolution: 2,
        text: '',
        style: { fontFamily: UI_FONT, fontSize: 19, fontWeight: '700', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
      });
      value.anchor.set(1, 0);
      value.position.set(box.x + box.w - 6, y);
      P.addChild(value);
      stats.push({ label, value });
    }

    const gearTop = statTop + STAT_ROWS * STAT_ROW_H + 22;
    const gearTitle = new Text({
      resolution: 2,
      text: t('guardians.detail.gearTitle'),
      style: { fontFamily: UI_FONT, fontSize: 18, fontWeight: '700', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    gearTitle.position.set(box.x + 6, gearTop);
    P.addChild(gearTitle);

    // 장비 행 — 좌측 아이콘 + 슬롯명, 우측 등급(등급색). 등급색은 파밍 시각 언어라 값 그대로 쓴다.
    // 아이콘은 `equipIcons.ts` 단일 정본에서 유도한다(격납고 슬롯 셀과 **같은 그림**이어야
    // "창고로 돌아오는 장비"가 창고에서 무엇으로 보일지 알 수 있다).
    const gearRows: { icon: Sprite; slot: Text; item: Text }[] = [];
    for (let i = 0; i < GEAR_ROWS; i++) {
      const y = gearTop + 34 + i * GEAR_ROW_H;
      const icon = new Sprite();
      icon.width = GEAR_ICON;
      icon.height = GEAR_ICON;
      icon.position.set(box.x + 2, y - 3);
      P.addChild(icon);
      const slot = new Text({
        resolution: 2,
        text: '',
        style: { fontFamily: UI_FONT, fontSize: 17, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
      });
      slot.position.set(box.x + GEAR_TEXT_X, y);
      P.addChild(slot);
      const item = new Text({
        resolution: 2,
        text: '',
        style: { fontFamily: UI_FONT, fontSize: 17, fontWeight: '700', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
      });
      item.anchor.set(1, 0);
      item.position.set(box.x + box.w - 6, y);
      P.addChild(item);
      gearRows.push({ icon, slot, item });
    }

    const gearNone = new Text({
      resolution: 2,
      text: t('guardians.detail.gearNone'),
      style: { fontFamily: UI_FONT, fontSize: 17, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
    });
    gearNone.position.set(box.x + GEAR_TEXT_X, gearTop + 34);
    P.addChild(gearNone);

    const empty = new Text({
      resolution: 2,
      text: t('guardians.detail.empty'),
      style: {
        fontFamily: UI_FONT, fontSize: 19, fill: SLAB_BODY_FILL, wordWrap: true,
        wordWrapWidth: box.w - 32, align: 'center', lineHeight: 26, dropShadow: TEXT_SHADOW,
      },
    });
    empty.anchor.set(0.5);
    empty.position.set(cx, box.y + box.h / 2);
    P.addChild(empty);

    this.detail = { box, name, stats, gearTitle, gearRows, gearNone, empty };
    this.syncDetail();
  }

  /** 크롬의 **값만** 갱신한다(계보 잔고·결과 문구·상세). 배경·패널은 다시 만들지 않는다. */
  private syncChrome(): void {
    if (this.lineageValue !== null) this.lineageValue.text = String(this.profile.lineage.available);
    if (this.hintText !== null) {
      // 오프라인 사유는 **행이 아니라 여기** 한 곳에서 말한다 — 행마다 적으면 목록이 경고문으로
      // 덮인다. 직전 조작 결과가 있으면 그쪽이 우선이다(방금 한 일이 더 급한 정보다).
      const text = this.hint !== '' ? this.hint : isLineageOnline() ? '' : t('lineage.offline');
      this.hintText.text = text;
      this.hintText.visible = text !== '';
    }
    this.syncDetail();
  }

  /** 상세 패널의 값만 갱신한다. 선택 없음이면 안내 문구 하나만 남긴다. */
  private syncDetail(): void {
    const d = this.detail;
    if (d === null) return;
    const g =
      this.selectedId === null
        ? undefined
        : activeGuardians(this.profile).find((x) => x.id === this.selectedId);
    const on = g !== undefined;

    d.name.visible = on;
    d.gearTitle.visible = on;
    d.empty.visible = !on;

    if (g === undefined) {
      for (const s of d.stats) {
        s.label.visible = false;
        s.value.visible = false;
      }
      for (const r of d.gearRows) {
        r.icon.visible = false;
        r.slot.visible = false;
        r.item.visible = false;
      }
      d.gearNone.visible = false;
      return;
    }

    d.name.text = guardianTypeLabel(g);

    const gear = lockedGearList(g);
    const lines: { label: string; value: string }[] = [
      { label: t('guardians.detail.perf'), value: `${perfText(g)}%` },
      { label: t('guardians.detail.score'), value: String(g.combatScore) },
      { label: t('guardians.detail.gear'), value: String(gear.length) },
      {
        label: t('guardians.detail.recover'),
        value: t('guardians.recover', { points: dismissPoints(g.combatScore, g.performanceCP) }),
      },
    ];
    d.stats.forEach((s, i) => {
      const line = lines[i];
      const has = line !== undefined;
      s.label.visible = has;
      s.value.visible = has;
      if (line === undefined) return;
      s.label.text = line.label;
      s.value.text = line.value;
    });

    d.gearNone.visible = gear.length === 0;
    d.gearRows.forEach((r, i) => {
      const entry = gear[i];
      const has = entry !== undefined;
      r.slot.visible = has;
      r.item.visible = has;
      r.icon.visible = false;
      if (entry === undefined) return;
      const iconName = equipIconName(entry.item);
      const iconTex = iconName === null ? undefined : (this.ui[iconName] ?? undefined);
      if (iconTex !== undefined) {
        r.icon.texture = iconTex;
        r.icon.visible = true;
        // 텍스처를 갈면 Sprite 가 원본 치수로 되돌아간다 — 매번 다시 못 박아야 한다.
        r.icon.width = GEAR_ICON;
        r.icon.height = GEAR_ICON;
      }
      // module0/module1 은 같은 slot kind 라 표시명이 겹친다 — 슬롯 id 로 번호를 붙인다.
      r.slot.text =
        entry.slot === 'module0'
          ? t('inv.module1')
          : entry.slot === 'module1'
            ? t('inv.module2')
            : itemDisplayName(entry.item);
      r.item.text = t(`item.rarity.${entry.item.rarity}` as MessageKey);
      r.item.style.fill = RARITY_COLOR_NUM[entry.item.rarity];
    });
  }

  // --- 목록 ----------------------------------------------------------------

  /** 행만 갈아끼운다. 배경·패널·헤더는 그대로 둔다(파일 헤더 "재렌더 규율"). */
  private renderList(): void {
    const host = this.listHost;
    const box = this.listBox;
    if (host === null || box === null) return;

    this.rowSelect.clear();
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }

    const guardians = activeGuardians(this.profile);
    if (guardians.length === 0) {
      const empty = new Text({
        resolution: 2,
        text: t('guardians.empty'),
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

    const totalH = guardians.length * (ROW_H + ROW_GAP) - ROW_GAP;
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

    guardians.forEach((g, i) => {
      const row = this.makeRow(g, box.w);
      row.position.set(0, i * (ROW_H + ROW_GAP));
      content.addChild(row);
    });
  }

  /** 행·상세가 함께 쓰는 수호기 아이콘 선택. 이름 폴백과 같은 갈림길이다. */
  private rowIcon(g: GuardianRecord): Texture | undefined {
    if (g.build !== undefined) return this.ui[shipPortraitName(g.build.typeId)] ?? undefined;
    const key = g.preset === GUARDIAN_INTERCEPTOR ? 'guardian_interceptor.png' : 'guardian_titan.png';
    return this.ui[key] ?? undefined;
  }

  private makeRow(g: GuardianRecord, rowW: number): Container {
    const row = new Container();
    const plate = rowPlate(rowW, ROW_H);
    row.addChild(plate.view);
    plate.setSelected(this.selectedId === g.id);
    this.rowSelect.set(g.id, plate.setSelected);
    // ⚠️ 행 클릭은 **행 Container** 에 건다. 바탕 Graphics 에만 걸면 위에 얹힌 텍스트가 클릭을
    // 삼킨다(Pixi 히트 테스트는 형제로 내려가지 않는다 — 이 리포가 관제탑에서 실제로 밟았다).
    attachRowClick(row, () => this.select(g.id));

    /**
     * 행 아이콘 — 빌드가 있으면 그 **기체 초상**, 없으면(ADR-0024 이전 구 수호기) 프리셋 아트다.
     * 이름 폴백(`guardianTypeLabel`)과 **같은 갈림길**을 쓴다: 구 수호기는 기체 타입 자체를
     * 모르므로 초상을 고를 근거가 없다. 자산이 없으면 아이콘만 빠지고 행은 그대로 선다.
     */
    const iconTex = this.rowIcon(g);
    if (iconTex !== undefined) {
      const sp = new Sprite(iconTex);
      sp.width = ROW_ICON;
      sp.height = ROW_ICON;
      sp.position.set(ROW_ICON_X, (ROW_H - ROW_ICON) / 2);
      row.addChild(sp);
    }

    const name = new Text({
      resolution: 2,
      text: guardianTypeLabel(g),
      style: { fontFamily: UI_FONT, fontSize: 24, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    name.position.set(ROW_TEXT_X, 16);
    row.addChild(name);

    const info = new Text({
      resolution: 2,
      text: `${t('guardians.perf', { pct: perfText(g) })}  ·  ${t('guardians.gear', { n: countLockedGear(g) })}  ·  ${t('guardians.recover', { points: dismissPoints(g.combatScore, g.performanceCP) })}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 17,
        fill: SLAB_BODY_FILL,
        wordWrap: true,
        // 우측 컨트롤 폭에서 파생한다 — 하드코딩하면 버튼을 넓힐 때 글자가 버튼 밑으로 들어간다.
        wordWrapWidth: rowW - ROW_TEXT_X - DISMISS_W - ROW_CTRL_PAD - 24,
        lineHeight: 22,
        dropShadow: TEXT_SHADOW,
      },
    });
    info.position.set(ROW_TEXT_X, 58);
    row.addChild(info);

    const dismiss = this.chromeButton({
      tone: 'red',
      width: DISMISS_W,
      height: DISMISS_H,
      fontSize: 20,
      label: t('guardians.dismiss'),
      onClick: () => {
        // 소멸은 되돌릴 수 없다 — 여기서는 팝업만 연다. 실행은 팝업의 확정 버튼이다.
        // 서버가 확정하는 조작이라 오프라인·왕복 중에는 팝업조차 열지 않는다.
        if (!isLineageOnline() || this.busy) return;
        this.selectedId = g.id;
        this.confirming = g.id;
        this.syncDetail();
        this.renderList();
        this.renderModal();
      },
    });
    dismiss.container.position.set(rowW - DISMISS_W - ROW_CTRL_PAD, Math.round((ROW_H - DISMISS_H) / 2));
    stopRowPropagation(dismiss.container);
    row.addChild(dismiss.container);
    // 오프라인이면 서버가 소멸을 확정할 수 없다 — 버튼을 눌리는 채로 두면 아무 반응 없는
    // 버튼이 된다. 사유는 계보 패널이 한 줄로 말한다(행마다 적으면 목록이 경고문으로 덮인다).
    if (!isLineageOnline()) dismiss.setEnabled(false);

    return row;
  }

  // --- 소멸 확인 팝업 --------------------------------------------------------

  /**
   * 시네마틱 확인 팝업. **`makeModal` 을 쓰지 않는다** — 그 모듈은 나무 nine-slice 에 묶여 있고
   * 다른 화면 5곳이 쓰기 때문에 고치면 그 화면들이 같이 갈린다. 대신 `modal.ts` 헤더의 실측 규칙
   * 세 가지를 그대로 승계한다:
   *  ① 암막은 **완전 불투명 채움**(뒤 화면 글자가 비쳐 읽히는 결함).
   *  ② 암막이 **이벤트를 먹는다**(안 그러면 뒤 목록이 스크롤된다).
   *  ③ 패널 안쪽 탭은 암막까지 **전파를 끊는다**(안 그러면 팝업 안을 누를 때마다 닫힌다).
   */
  private renderModal(): void {
    const host = this.modalHost;
    if (host === null) return;

    this.modalPanel?.destroy();
    this.modalPanel = null;
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }
    if (this.helpOpen) {
      this.root.setChildIndex(host, this.root.children.length - 1);
      this.modalPanel = openHelpOverlay(host, {
        spec: ROSTER_HELP,
        get: () => this.helpScroll,
        set: (v) => {
          this.helpScroll = v;
        },
        onClose: () => {
          this.helpOpen = false;
          this.renderModal();
        },
      });
      return;
    }
    if (this.confirming === null) return;

    const g = this.profile.guardians.find((x) => x.id === this.confirming);
    if (g === undefined) {
      this.confirming = null;
      return;
    }

    // ① · ② 암막.
    const scrim = new Graphics();
    scrim.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: 0x05060f, alpha: 0.92 });
    scrim.eventMode = 'static';
    scrim.on('pointertap', () => {
      this.confirming = null;
      this.renderModal();
    });
    host.addChild(scrim);

    const px = Math.round((DESIGN_WIDTH - CONFIRM_W) / 2);
    const py = Math.round((DESIGN_HEIGHT - CONFIRM_H) / 2);
    const panel = makeCinematicPanel({
      width: CONFIRM_W,
      height: CONFIRM_H,
      variant: 'slab',
      title: t('guardians.dismiss.title'),
      screenX: px,
      screenY: py,
      lightOrigin: { x: DESIGN_WIDTH / 2, y: 60 },
    });
    panel.container.position.set(px, py);
    // ③ 패널 안쪽 탭이 암막까지 내려가지 않게 막는다.
    stopRowPropagation(panel.container);
    host.addChild(panel.container);
    this.modalPanel = panel;

    const box = panel.box;
    const cx = box.x + box.w / 2;

    const body = new Text({
      resolution: 2,
      text: t('guardians.dismiss.confirm', {
        name: guardianTypeLabel(g),
        gear: countLockedGear(g),
        points: dismissPoints(g.combatScore, g.performanceCP),
      }),
      style: {
        fontFamily: UI_FONT,
        fontSize: 20,
        fill: COLOR.cream,
        wordWrap: true,
        wordWrapWidth: box.w,
        align: 'center',
        lineHeight: 30,
        dropShadow: TEXT_SHADOW,
      },
    });
    body.anchor.set(0.5, 0);
    body.position.set(cx, box.y + 10);
    panel.container.addChild(body);

    /**
     * 버튼은 패널 **바닥 기준**으로 놓는다. 본문 줄 수가 로케일·기체명 길이에 따라 변하는데
     * 본문 아래에 이어 붙이면 긴 문장에서 패널 밖으로 밀린다(옛 구현이 `getLocalBounds` 로
     * 이어 붙이다 `Math.max` 로 방어하던 자리다 — 바닥 기준이면 방어가 필요 없다).
     */
    const btnY = box.y + box.h - DISMISS_H - 4;
    const gap = 20;
    const yesW = 240;
    const noW = 200;
    const startX = cx - (yesW + gap + noW) / 2;

    const id = g.id;
    const yes = this.chromeButton({
      tone: 'red',
      width: yesW,
      height: DISMISS_H,
      fontSize: 19,
      label: t('guardians.dismiss'),
      onClick: () => this.performDismiss(id),
    });
    yes.container.position.set(startX, btnY);
    panel.container.addChild(yes.container);

    const no = this.chromeButton({
      tone: 'stone',
      width: noW,
      height: DISMISS_H,
      fontSize: 19,
      label: t('guardians.cancel'),
      onClick: () => {
        this.confirming = null;
        this.renderModal();
      },
    });
    no.container.position.set(startX + yesW + gap, btnY);
    panel.container.addChild(no.container);
  }
}
