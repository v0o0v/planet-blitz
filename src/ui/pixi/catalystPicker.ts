/**
 * 촉매 주입 픽커 팝업 — Pixi (ADR-0029, Lane 4 · 2026-08-03 AAA 시네마틱 전환)
 * · 레인 계약 `.omc/plans/star-map-aaa-2026-08-03.md`.
 *
 * 성계 지도(`planetSelect.ts`)의 [주입 편집] 이 여는 모달이다. 48종 촉매를 그리드로 펼쳐
 * 보유 수량·주입 수(스택)·페널티+보상 방향을 보여 주고, 슬롯 상한(SLOT_CAP)·특산-행성 정합을
 * 강제한다. [확정] 이 주입 배열을 성계 지도에 돌려준다(✕/암막은 취소 — 편집 폐기).
 *
 * ## 왜 `makeModal`(나무)을 안 쓰고 여기서 세우는가
 * 그 모듈은 **다른 화면 다섯이 쓰고 있어** 고치면 그쪽이 함께 바뀐다. 그래서 껍데기만 이 파일
 * 안에서 시네마틱으로 다시 세우고, `modal.ts` 헤더가 실측으로 남긴 규칙 셋은 **그대로 승계**한다:
 *  ① 암막은 **불투명**해야 한다(뒤 화면이 비치면 팝업이 떠 있는지 안 읽힌다).
 *  ② 암막이 **이벤트를 먹어야** 한다(안 먹으면 뒤 목록이 계속 눌린다).
 *  ③ 패널 안쪽 탭은 **전파를 끊어야** 한다(안 끊으면 패널을 눌러도 암막이 받아 닫힌다).
 * 암막 알파는 뒤 화면 밝기마다 다르다 — 성계 지도는 석재 패널 셋이 화면을 거의 덮어 밝으므로
 * 방어 사령부·관제탑·지시 수신소와 같은 **0.99** 를 쓴다(나무 판의 0.78 로는 뒤가 비친다).
 *
 * ⚠️ **바깥 탭 = 취소는 전환 전 거동 그대로 유지한다.** 편집 폐기는 되돌릴 수 있는 조작이라
 * (주입은 확정 전까지 서버를 만지지 않는다) "파괴적 팝업은 바깥 탭으로 닫지 마라" 규칙의
 * 대상이 아니다. 여기서 거동을 바꾸면 이 팝업만 형제와 다르게 닫힌다.
 *
 * ## 전환에서 바뀐 것은 **바탕과 배치**뿐이다
 * `makeModal`(나무) → 암막 + `makeCinematicPanel`(석재), `listRowBg` 셀 바탕 → 석재 판
 * ({@link cellPlate}, 주입된 것은 금색 링), 나무 버튼 → `cinematicButtonTexture` 주입,
 * 하단 요약 구분선 → **파낸 챔버**({@link recessedWell}). 편집 동작·게이트·요약 산식은
 * 한 줄도 안 건드렸다 — 주입 판정은 계속 `catalystInject.ts`(Pixi 없는 순수 계층)가 소유한다.
 *
 * ## 서버 권위 (ADR-0027/0029 — 전환 전과 동일)
 * 보유 수량 정본은 서버 `catalyst_inventory` 다 — 픽커는 성계 지도가 넘긴 스냅샷(catalyst_id→qty)
 * 만 읽고, **실제 차감은 출격 직전 `consume_catalysts`** 가 한다(여기선 원장을 만지지 않는다).
 * 보유 0 이거나 오프라인(스냅샷 없음)이면 주입이 불가능하게 게이트한다.
 *
 * ## 실측 규칙(다른 캔버스 화면과 동일)
 * - **휠은 클립 Container + hitArea 에**(`makeScrollArea`). 마스크 Graphics 는 히트 제외.
 * - **여백은 콘텐츠 상자 안에만**(`PANEL_EDGE_PAD`/`TITLE_BAND` 복제 기하 — 테스트가 대조한다).
 * - ⚠️ **`setEnabled(false)` + `gold` 톤 금지**(글자가 통째로 사라진다). 셀 버튼은 `blue`/`red`
 *   이고 둘 다 크림 라벨이라 alpha 0.4 에서도 읽힌다.
 * - ⚠️ **재렌더 규율**: 옛 구현은 `render()` 가 루트를 통째로 지우고 다시 그렸다. 나무
 *   nine-slice 일 때는 값이 쌌지만 시네마틱 패널은 텍스처를 **굽는다** — 그대로 두면 [주입]
 *   한 번 누를 때마다 1560×940 석재를 다시 굽는다(48종을 훑으며 수십 번 누르는 화면이다).
 *   그래서 `buildChrome()` 1회 + `refresh()`(슬롯 수·셀·요약만)로 갈랐다.
 *
 * 순수 render/UI 레이어(ADR-0005 · ADR-0014) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Sprite, Text, Texture, type FederatedPointerEvent } from 'pixi.js';
import {
  CATALYSTS,
  CATALYST_TAG_PRIORITY,
  catalystById,
  catalystIconFallbackKey,
  catalystIconKey,
  catalystVoidOnPlanet,
  normalizeCatalystArray,
  SIGNATURE_CAP,
  SLOT_CAP,
  type CatalystDef,
} from '../../data/catalysts.js';
import {
  RESONANCE_STRONG_COUNT,
  RESONANCE_WEAK_COUNT,
  resolveResonance,
  resonanceVoidOnPlanet,
  tagCounts,
  type ResonanceDef,
} from '../../data/catalystResonance.js';
import {
  catalystConflicts,
  type CatalystConflictReason,
} from '../../data/catalystConflicts.js';
import {
  catalystCapLine,
  catalystName,
  catalystRule,
  catalystTagLabel,
  resonanceName,
  resonanceRule,
  resonanceTierLabel,
} from '../catalystText.js';
import {
  canInjectCatalyst,
  catalystInjectBlock,
  catalystLocked,
  injectedCount,
  ownedCount,
  type CatalystInjectBlock,
} from '../../data/catalystInject.js';
import { planetById } from '../../../data/planets.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { t } from '../../i18n/index.js';
import type { MessageKey } from '../../i18n/catalog.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { makeScrollArea } from './scrollArea.js';
import { makeCinematicPanel, type CinematicPanel } from './cinematicPanel.js';
import {
  cinematicButtonTexture,
  chromeFallbackColor,
  chromeLabelColor,
  type ChromeTone,
} from './hangarChrome.js';
import { PixiButton } from './button.js';
import { stripEmoji } from './text.js';

/** 보유 원장 스냅샷(catalyst_id → qty). 성계 지도가 서버에서 받아 넘긴다. */
export type CatalystInventorySnapshot = ReadonlyMap<number, number>;

export interface CatalystPickerOptions {
  /** 현재 선택 행성(특산 정합 판정). */
  planet: number;
  /** 현재 주입된 촉매 id(중복=스택). 픽커는 이 복사본을 편집한다. */
  injected: readonly number[];
  /** 보유 수량 스냅샷(서버 권위). 없으면 빈 맵(주입 불가). */
  inventory: CatalystInventorySnapshot;
  /** [확정] 시 편집한 주입 배열(정규화 전, 중복 보존)을 돌려준다. */
  onConfirm: (ids: number[]) => void;
}

// ===========================================================================
// 레이아웃(디자인 스페이스 1920×1080) — Pixi 없이 검증되는 순수 서술
// ===========================================================================

/**
 * `cinematicPanel.ts` 콘텐츠 상자 기하의 **복제본**(출처: 그 파일의 `EDGE_PAD 24` ·
 * `CONTENT_GAP 16` · `TITLE_BAND_H = round(TITLE_SIZE 26 × 2)`).
 *
 * 왜 베끼는가: 좌표 서술이 **Pixi 없이** 검증돼야 하는데 패널 상자는 런타임 객체다. 베낀 값이
 * 조용히 어긋나면 내용이 패널 테두리를 뚫는데 예외도 로그도 없다 —
 * `tests/catalystPickerAaaLayout.test.ts` 가 실제 `makeCinematicPanel(...).box` 와 대조한다.
 */
export const PANEL_EDGE_PAD = 24;
export const PANEL_TITLE_BAND_H = 52;
export const PANEL_CONTENT_GAP = 16;
const TITLED_BOX_Y = PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP;

const MODAL_W = 1560;
const MODAL_H = 940;
const MODAL_X = Math.round((DESIGN_WIDTH - MODAL_W) / 2);
const MODAL_Y = Math.round((DESIGN_HEIGHT - MODAL_H) / 2);

/**
 * 암막 알파. 뒤(성계 지도)는 석재 패널 셋이 화면을 거의 덮어 **밝다** — 나무 판이 쓰던 0.78 로는
 * 행성 목록과 전장 창이 그대로 비쳐 팝업이 떠 있는지 안 읽힌다(형제 화면 셋과 같은 값).
 */
const SCRIM_ALPHA = 0.99;

/** 콘텐츠 상자(패널 로컬) — 위 복제 기하에서 파생. */
const BOX = {
  x: PANEL_EDGE_PAD,
  y: TITLED_BOX_Y,
  w: MODAL_W - PANEL_EDGE_PAD * 2,
  h: MODAL_H - TITLED_BOX_Y - PANEL_EDGE_PAD,
  right: MODAL_W - PANEL_EDGE_PAD,
  bottom: MODAL_H - PANEL_EDGE_PAD,
} as const;

/** 닫기 ✕ — **각인 제목 띠 안** 오른쪽. 제목은 왼쪽 정렬이라 세로로 겹치지 않는다. */
const CLOSE_SIZE = 44;
const CLOSE_X = MODAL_W - PANEL_EDGE_PAD - CLOSE_SIZE;
const CLOSE_Y = 4;

/** 헤더 둘째 줄: 슬롯 카운터(좌) + [전체 해제]/[확정](우). */
const BTN_ROW_H = 52;
const BTN_ROW_GAP = 16;
const CONFIRM_W = 200;
const CLEAR_W = 180;
const BTN_GAP = 16;

/**
 * 하단 **전체 효과 요약** 챔버 — 지금 주입된 조합이 실제로 만드는 배율.
 *
 * ⚠️ 168 이었을 때 페널티 축이 다섯이면 마지막 `외 N개` 줄이 **챔버 바닥을 뚫고** 잘렸다
 * (실화면 1차 확인 2026-08-03). 축은 최대 6종까지 몰릴 수 있으므로 세로를 줄 수에서 역산한다 —
 * {@link summaryRowCapacity} 가 그 산술이고 테스트가 하한을 잠근다.
 */
const SUMMARY_H = 216;
const SUMMARY_PAD = 16;
/** 요약 줄 간격·머리글 아래 여백(용량 산정이 여기서 파생된다). */
const SUMMARY_STEP = 24;
const SUMMARY_ROWS_Y = 48;
/** 열 머리글(페널티/보상)이 먹는 세로 — 첫 줄은 그 아래에서 시작한다. */
const SUMMARY_HEAD_H = 26;

const COLS = 6;
const CELL_GAP = 12;

/**
 * 셀 안 세로 격자.
 *
 * ## ⚠️ 규칙문 줄 수를 상수로 가정하면 안 된다 (2026-08-08 실제 신고)
 * 예전에는 `TAG_ROW_Y`/`CAP_ROW_Y`/`STATUS_ROW_Y` 가 **위에서 잰 고정 상수**(124/150/176)였고,
 * 그 격자는 규칙문이 **3줄**이라고 가정하고 있었다. 실제 문구는 48종 중 **41종이 4줄, 1종이
 * 5줄** 이라 예산(58px = 3.2줄)을 넘겼고, 넘친 줄이 태그 칩과 상한 줄 위에 그대로 겹쳐 찍혔다.
 * 42/48 이 깨져 있었는데도 좌표가 전부 상수라 아무 테스트도 이걸 못 봤다.
 *
 * 그래서 방향을 뒤집는다 — **아래 세 줄은 버튼 행에서 위로 파생**시킨다. 그러면
 *  - 카드마다 태그/상한/상태 줄의 y 가 같아 격자 정렬이 유지되고(칩이 들쭉날쭉해지지 않는다),
 *  - 규칙문이 쓸 수 있는 세로가 `RULE_BUDGET_H` 라는 **하나의 값**으로 드러난다.
 * 규칙문이 그 예산을 넘으면 잘라내지 않고 **폰트를 줄여 맞춘다**(`fitRuleText`) — 이 카드에서
 * 규칙문은 장식이 아니라 본문이라 truncate 는 정보를 잃는다.
 */
const RULE_TOP = 66;
const RULE_LINE_H = 18;
/** 규칙문이 감당해야 하는 최악 줄 수(48종 실측). 셀 높이가 여기서 나온다. */
const RULE_MAX_LINES = 5;
const RULE_BUDGET_H = RULE_MAX_LINES * RULE_LINE_H;
/** 규칙문 아래 틈 → 태그 칩(20) → 상한(22) → 상태(17) → 버튼(34) → 바닥 여백(10). */
const TAG_ROW_H = 20;
const CAP_ROW_H = 22;
const STATUS_ROW_H = 17;
const BTN_ROW_H_CELL = 34;
const CELL_BOTTOM_PAD = 10;
const RULE_ROW_GAP = 6;

const CELL_H =
  RULE_TOP +
  RULE_BUDGET_H +
  RULE_ROW_GAP +
  TAG_ROW_H +
  4 +
  CAP_ROW_H +
  STATUS_ROW_H +
  5 +
  BTN_ROW_H_CELL +
  CELL_BOTTOM_PAD;

const CELL_BTN_Y = CELL_H - CELL_BOTTOM_PAD - BTN_ROW_H_CELL;
const STATUS_ROW_Y = CELL_BTN_Y - 5 - STATUS_ROW_H;
const CAP_ROW_Y = STATUS_ROW_Y - CAP_ROW_H;
const TAG_ROW_Y = CAP_ROW_Y - 4 - TAG_ROW_H;

/**
 * 셀 세로 격자의 **순수 값 복제본**. 렌더 없이 "규칙문 예산이 실제 문구를 감당하는가"와
 * "줄끼리 겹치지 않는가"를 단위 테스트가 직접 보게 하려고 내보낸다.
 */
export const CELL_ROW_METRICS = {
  cellH: CELL_H,
  ruleTop: RULE_TOP,
  ruleLineH: RULE_LINE_H,
  ruleMaxLines: RULE_MAX_LINES,
  ruleBudgetH: RULE_BUDGET_H,
  tagY: TAG_ROW_Y,
  tagH: TAG_ROW_H,
  capY: CAP_ROW_Y,
  capH: CAP_ROW_H,
  statusY: STATUS_ROW_Y,
  statusH: STATUS_ROW_H,
  btnY: CELL_BTN_Y,
  btnH: BTN_ROW_H_CELL,
  /** 규칙문 wrap 폭 = 셀 폭 − 좌우 여백(14×2). */
  ruleWrapWidth: (cellW: number): number => cellW - 28,
} as const;

/** 헤더 슬롯 스트립 — **3칸 고정**(`SLOT_CAP`). 빈 칸도 그린다(헌장 §귀속 규율의 HUD 짝). */
const SLOT_CELL_W = 132;
const SLOT_CELL_GAP = 8;

const BADGE = 0x8affc0;
/** 공명 열 색(청록) · 경고 열 색(회색 기준). 하단 2열의 의미를 색으로도 가른다. */
const RESONANCE_COLOR = 0x8affc0;
const WARN_COLOR = 0xb9b3a6;
/**
 * 경고 2단의 색(헌장 §축소 작동 규율) — **회색 = 이 행성에서 무효**(구조적, `voidOnPlanets`) /
 * **노랑 = 촉매 간 충돌**(축소 작동, 런타임 판정).
 *
 * ⚠️ 둘 다 **경고일 뿐**이다. sim 이 그 카드를 끄는 근거가 아니고, 런 안에서는 축소된 형태로라도
 * 반드시 작동해야 한다.
 */
const WARN_VOID_COLOR = 0x9a94a8;
const WARN_CONFLICT_COLOR = 0xffd45e;
/**
 * 축소의 결 → i18n 키. **전수 매핑**이라 `Record` 로 둔다 — 결을 늘리면 여기서 타입 에러가
 * 나고(`tests/catalystConflicts.test.ts` 도 잡는다), 문구 없는 결이 조용히 새는 일이 없다.
 */
const CONFLICT_REASON_KEY: Record<CatalystConflictReason, MessageKey> = {
  sharedField: 'catalyst.warn.reason.sharedField',
  choice: 'catalyst.warn.reason.choice',
  material: 'catalyst.warn.reason.material',
  ground: 'catalyst.warn.reason.ground',
  aim: 'catalyst.warn.reason.aim',
  precondition: 'catalyst.warn.reason.precondition',
  priority: 'catalyst.warn.reason.priority',
  overlap: 'catalyst.warn.reason.overlap',
};
/** 태그 칩 바탕/글자. */
const TAG_CHIP_FACE = 0x2a2440;
const TAG_CHIP_TEXT = 0xcfc6ff;
/** 석재 슬래브 위 **보조 텍스트색**(정제소 `SLAB_BODY_FILL` 복제 — 그 파일은 화면이다). */
const SLAB_BODY_FILL = 0xe4dac7;
/** 셀 판 바탕색·홈·반경 — 예비역 로스터 `rowPlate` → … → 성계 지도 경유 복제. */
const ROW_FACE = 0x3b3327;
const ROW_GROOVE = 0x17130d;
const ROW_RADIUS = 10;

/** 상한 축 → 셀 토큰 글리프(아이콘 PNG 부재 시 텍스트 폴백). ASCII 유지(캔버스 두부 방지). */
const AXIS_GLYPH: Record<string, string> = {
  drop: 'D',
  rarity: 'R',
  xp: 'X',
  resource: '$',
  catalystDrop: 'C',
};

/**
 * 하단 챔버의 한 줄 — 라벨(왼쪽) + 값(오른쪽). `color` 는 **그 줄만** 열 기준색을 덮는다
 * (경고 열에서 회색/노랑이 한 열 안에 섞여야 하기 때문이다).
 */
export interface PickerRow {
  readonly label: string;
  readonly value: string;
  readonly color?: number;
}

/** 화면/패널 좌표 사각형. */
export interface PickerRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 이 팝업의 레이아웃 전량 — **Pixi 없이 검증되는 순수 서술**이다.
 *
 * 왜 내보내는가: 옛 구현에서 [확정] 버튼이 닫기 ✕ 를 **덮은** 결함이 실제로 났다(사용자 신고
 * 2026-07-28 스크린샷). 좌표를 순수 값으로 꺼내 두면 그 유형이 단위 테스트에서 잡힌다.
 *
 * ⚠️ **인자를 받지 않는 것 자체가 계약**이다 — 주입 수·행성으로 기하가 갈리면 안 된다.
 */
export function catalystPickerLayout(): {
  readonly screen: PickerRect;
  /** 팝업 사각형(화면 좌표). */
  readonly modal: PickerRect;
  /** 콘텐츠 상자(패널 로컬). */
  readonly box: PickerRect & { readonly right: number; readonly bottom: number };
  /** 제목 띠 안 닫기 ✕(패널 로컬). */
  readonly close: PickerRect;
  /** 헤더 둘째 줄 버튼들(패널 로컬, 왼쪽→오른쪽). */
  readonly headerButtons: readonly { readonly id: string; readonly rect: PickerRect }[];
  /** 헤더 왼쪽 **3칸 고정** 슬롯 스트립(패널 로컬). 칸 수는 `SLOT_CAP` 이다. */
  readonly slots: PickerRect & { readonly cells: number; readonly cellW: number };
  /** 그리드 스크롤 창(패널 로컬). */
  readonly grid: PickerRect & { readonly cols: number; readonly cellW: number; readonly cellH: number };
  /** 하단 요약 챔버(패널 로컬). */
  readonly summary: PickerRect;
} {
  const btnY = BOX.y;
  const confirmX = BOX.right - CONFIRM_W;
  const clearX = confirmX - BTN_GAP - CLEAR_W;
  const gridY = BOX.y + BTN_ROW_H + BTN_ROW_GAP;
  const summaryY = BOX.bottom - SUMMARY_H;
  return {
    screen: { x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT },
    modal: { x: MODAL_X, y: MODAL_Y, w: MODAL_W, h: MODAL_H },
    box: { ...BOX },
    close: { x: CLOSE_X, y: CLOSE_Y, w: CLOSE_SIZE, h: CLOSE_SIZE },
    headerButtons: [
      { id: 'clear', rect: { x: clearX, y: btnY, w: CLEAR_W, h: BTN_ROW_H } },
      { id: 'confirm', rect: { x: confirmX, y: btnY, w: CONFIRM_W, h: BTN_ROW_H } },
    ],
    slots: {
      x: BOX.x,
      y: btnY,
      w: SLOT_CAP * SLOT_CELL_W + (SLOT_CAP - 1) * SLOT_CELL_GAP,
      h: BTN_ROW_H,
      cells: SLOT_CAP,
      cellW: SLOT_CELL_W,
    },
    grid: {
      x: BOX.x,
      y: gridY,
      w: BOX.w,
      // 요약 챔버와의 틈은 여백 어휘 하나(16)뿐이다 — 남는 자리를 그리드가 전부 쓴다.
      h: summaryY - BTN_ROW_GAP - gridY,
      cols: COLS,
      cellW: Math.floor((BOX.w - CELL_GAP * (COLS - 1)) / COLS),
      cellH: CELL_H,
    },
    summary: { x: BOX.x, y: summaryY, w: BOX.w, h: SUMMARY_H },
  };
}

/**
 * 요약 한 열이 챔버 안에 그릴 수 있는 **줄 자리 수**.
 *
 * ⚠️ `외 N개` 도 한 줄을 먹는다 — 그걸 안 세면 넘칠 때 그 줄이 챔버 바닥을 뚫는다(실제로 뚫었다).
 * 그래서 호출부는 `rows.length > capacity` 일 때 **capacity−1 줄만 그리고 마지막 자리를 `외 N개`
 * 에 내준다**. 머리글 아래 26px 은 그 열의 제목이 쓰는 자리다.
 */
export function summaryRowCapacity(): number {
  return Math.max(1, Math.floor((SUMMARY_H - SUMMARY_ROWS_Y - SUMMARY_HEAD_H - SUMMARY_PAD) / SUMMARY_STEP));
}

/**
 * 줄 `total` 개 중 **실제로 그릴 줄 수**. 넘치면 마지막 자리를 `외 N개` 에 내준다.
 *
 * ⚠️ 순수 함수로 뺀 이유: 이 산술을 `Math.min(total, capacity)` 로 되돌리는 뮤테이션이 **살아
 * 돌아왔다**(2026-08-03). 좌표만 보는 단언은 용량이 그대로라 안 깨지고, 뚫리는 것은 `외 N개`
 * 줄 하나뿐이라 눈으로만 잡힌다 — 그래서 값 자체를 테스트가 본다.
 */
export function summaryShownRows(total: number): number {
  const capacity = summaryRowCapacity();
  return total <= capacity ? total : Math.max(1, capacity - 1);
}

/** 요약 챔버 세로 산술의 재료(테스트가 "마지막 줄이 바닥을 안 뚫는다"를 되짚는다). */
export const SUMMARY_METRICS = {
  h: SUMMARY_H,
  pad: SUMMARY_PAD,
  rowsY: SUMMARY_ROWS_Y,
  headH: SUMMARY_HEAD_H,
  step: SUMMARY_STEP,
} as const;

// --- 셀 판 조명 램프(모듈 1회 굽기) ------------------------------------------

/**
 * 셀 판의 **방향성 조명**을 위한 세로 알파 램프.
 *
 * ⚠️ 띠를 겹쳐 그라디언트를 근사하지 않는다 — 1px 겹침이 알파를 두 배로 만들어 가로줄이 생긴다
 * (실제 사용자 신고). 폭 1px 캔버스에 픽셀로 굽고 `linear` 로 늘린다.
 */
let rowRampTex: Texture | null | undefined;

function rowRamp(): Texture | null {
  if (rowRampTex !== undefined) return rowRampTex;
  // ⚠️ 이 가드는 **캔버스를 굽는 함수에만** 붙인다.
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
 * 셀 한 장의 바탕 — 2단 접지 그림자 + 석재 면 + 방향성 램프 + 안쪽 어두운 홈.
 * **선은 긋지 않는다.** 셀 사이 구분은 이 그림자와 간격이 만든다. 주입은 금색 링이 말한다.
 * (성계 지도 `rowPlate` 복제 — 그 파일은 공용 모듈이 아니라 화면이다.)
 */
function cellPlate(w: number, h: number, injected: boolean, signature: boolean): Container {
  const root = new Container();

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

  // 주입 = 금색 링. 특산(미주입)은 은은한 놋빛 링으로 "이건 다른 종류"만 말한다 — 두 표식의
  // 밝기 차가 커야 "고른 것"과 "종류가 다른 것"이 안 섞인다.
  if (injected) root.addChild(ring(w, h, COLOR.gold, 3, 0.95));
  else if (signature) root.addChild(ring(w, h, 0x8a7440, 2, 0.7));
  return root;
}

/** 표식 링 하나. 히트 테스트에서 빠져야 아래 버튼 클릭을 삼키지 않는다. */
function ring(w: number, h: number, color: number, width: number, alpha: number): Graphics {
  const g = new Graphics();
  g.roundRect(0, 0, w, h, ROW_RADIUS).stroke({ color, width, alignment: 1, alpha });
  g.eventMode = 'none';
  return g;
}

/**
 * **파낸 면** 한 장(하단 요약 챔버). 볼록한 {@link cellPlate} 와 조명 부호가 정확히 반대다:
 * 위가 그늘이고 **아래 입술만** 빛을 받는다.
 * (정제소 `recessedWell` → … → 성계 지도 경유 복제 — 그 파일들은 화면이지 공용 모듈이 아니다.)
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

export class CatalystPicker {
  private readonly stage: Container;
  private readonly root = new Container();
  private ui: UiTextures = {};
  private opts: CatalystPickerOptions | null = null;
  /** 편집 중인 주입 배열(중복=스택). 확정 시 onConfirm 으로 돌려준다. */
  private working: number[] = [];
  private scrollY = 0;
  /** 열려 있는 동안의 석재 패널(연출 진행 대상 — 닫을 때 반드시 파괴한다). */
  private panel: CinematicPanel | null = null;
  private chromeBuilt = false;
  private gridHost: Container | null = null;
  private summaryHost: Container | null = null;
  /** 헤더 왼쪽 3칸 슬롯 스트립의 내용물(칸은 주입마다 바뀌므로 크롬이 아니라 갱신 대상이다). */
  private slotsHost: Container | null = null;

  constructor(stage: Container) {
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    // 촉매 아이콘은 아직 나무 UI 킷 아틀라스에 들어 있다 — 크롬은 전부 절차적 석재로 바뀌었지만
    // 아이콘 48종은 실제로 쓰이므로 킷을 계속 읽는다.
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      // 아이콘 아틀라스가 도착하면 셀만 다시 그린다 — 석재 패널은 굽는 비용이 커서 손대지 않는다.
      if (this.root.visible) this.refresh();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  show(opts: CatalystPickerOptions): void {
    this.opts = opts;
    this.working = [...opts.injected];
    this.scrollY = 0;
    this.buildChrome();
    this.refresh();
    this.root.visible = true;
    this.raise();
  }

  /**
   * 닫으면 크롬을 **통째로 버린다.**
   *
   * ⚠️ 형제 화면들은 크롬을 남겨 두지만 여기는 팝업이다: 1560×940 석재 패널은 굽는 비용이
   * 크고(텍스처 여러 장) 닫혀 있는 동안 아무도 안 본다. 게다가 이 팝업은 성계 지도 밖에서도
   * `hide()` 가 불릴 수 있어(화면 전환) 남겨 두면 죽은 참조를 매 프레임 미는 자리가 된다.
   */
  hide(): void {
    this.root.visible = false;
    this.opts = null;
    this.destroyChrome();
  }

  /** 석재 패널 연출 진행. 성계 지도가 자기 `update` 에서 흘려 준다 — 닫혀 있으면 즉시 반환. */
  update(dt: number): void {
    if (!this.root.visible) return;
    this.panel?.update(dt);
  }

  private raise(): void {
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
  }

  // --- 편집 동작 -----------------------------------------------------------

  private ownedOf(id: number): number {
    return this.opts === null ? 0 : ownedCount(this.opts.inventory, id);
  }

  private injectedCountOf(id: number): number {
    return injectedCount(this.working, id);
  }

  /** 특산 촉매가 현재 행성에서 잠겼는지(순수 게이트 위임). */
  private locked(def: CatalystDef): boolean {
    return this.opts === null ? true : catalystLocked(def, this.opts.planet);
  }

  /** 한 개 더 주입 가능한지(순수 게이트 위임: 슬롯 여유 + 보유 여유 + 미잠금). */
  private canInject(def: CatalystDef): boolean {
    if (this.opts === null) return false;
    return canInjectCatalyst(def, this.working, this.opts.inventory, this.opts.planet);
  }

  private inject(id: number): void {
    const def = catalystById(id);
    if (def === undefined || !this.canInject(def)) return;
    this.working.push(id);
    this.refresh();
  }

  private remove(id: number): void {
    const i = this.working.lastIndexOf(id);
    if (i < 0) return;
    this.working.splice(i, 1);
    this.refresh();
  }

  private clearAll(): void {
    if (this.working.length === 0) return;
    this.working = [];
    this.refresh();
  }

  private confirm(): void {
    const cb = this.opts?.onConfirm;
    const ids = [...this.working];
    this.hide();
    cb?.(ids);
  }

  // --- 공용 렌더 조각 -------------------------------------------------------

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

  // --- 크롬(1회 조립) -------------------------------------------------------

  private destroyChrome(): void {
    this.panel?.destroy();
    this.panel = null;
    this.gridHost = null;
    this.summaryHost = null;
    this.slotsHost = null;
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }
    this.chromeBuilt = false;
  }

  private clearHost(host: Container): void {
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }
  }

  /**
   * 암막 · 석재 패널 · 닫기 · 헤더 버튼 줄 · 요약 챔버 바탕은 **한 번만** 세운다.
   *
   * ⚠️ 옛 구현은 `render()` 가 루트를 통째로 지우고 다시 그렸다. 나무 nine-slice 일 때는 값이
   * 쌌지만 시네마틱 패널은 텍스처를 **굽는다** — 그대로 두면 [주입] 한 번 누를 때마다
   * 1560×940 석재를 다시 굽는다(48종을 훑으며 수십 번 누르는 화면이다).
   */
  private buildChrome(): void {
    if (this.chromeBuilt) return;

    // ② 암막 — 뒤로 포인터/휠이 새지 않게 막고, 바깥을 누르면 닫는다(전환 전 거동 그대로).
    const scrim = new Graphics();
    scrim.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: 0x05060f, alpha: SCRIM_ALPHA });
    scrim.eventMode = 'static';
    scrim.on('pointertap', () => this.hide());
    this.root.addChild(scrim);

    const panel = makeCinematicPanel({
      width: MODAL_W,
      height: MODAL_H,
      variant: 'slab',
      title: t('catalyst.picker.title'),
      screenX: MODAL_X,
      screenY: MODAL_Y,
      lightOrigin: { x: DESIGN_WIDTH / 2, y: 60 },
    });
    panel.container.position.set(MODAL_X, MODAL_Y);
    // ③ 팝업 안쪽 클릭이 암막으로 새어 창이 닫히는 것을 막는다.
    panel.container.eventMode = 'static';
    panel.container.on('pointertap', (e: FederatedPointerEvent) => e.stopPropagation());
    this.root.addChild(panel.container);
    this.panel = panel;

    const host = panel.container;
    const layout = catalystPickerLayout();

    // 닫기 ✕ — 각인 제목 띠 안 오른쪽. 옛 구현에서는 [확정] 이 이 자리를 **덮었다**(사용자
    // 신고 2026-07-28) — 이제 버튼 줄이 제목 띠 **아래**라 세로로 분리돼 있다(테스트가 잠근다).
    const close = this.chromeButton({
      tone: 'stone',
      width: CLOSE_SIZE,
      height: CLOSE_SIZE,
      fontSize: 20,
      label: '✕',
      onClick: () => this.hide(),
    });
    close.container.position.set(layout.close.x, layout.close.y);
    host.addChild(close.container);

    // 헤더 둘째 줄: **3칸 고정** 슬롯 스트립(좌) + [전체 해제]/[확정](우).
    // 칸의 파낸 면은 상태와 무관하므로 크롬이고, 안에 들어가는 이름은 갱신 대상이다.
    for (let i = 0; i < layout.slots.cells; i++) {
      const cx = layout.slots.x + i * (layout.slots.cellW + SLOT_CELL_GAP);
      host.addChild(recessedWell(cx, layout.slots.y, layout.slots.cellW, layout.slots.h));
    }
    const slotsHost = new Container();
    host.addChild(slotsHost);
    this.slotsHost = slotsHost;

    for (const b of layout.headerButtons) {
      const btn =
        b.id === 'confirm'
          ? this.chromeButton({
              tone: 'gold',
              width: b.rect.w,
              height: b.rect.h,
              fontSize: 22,
              label: t('catalyst.picker.confirm'),
              onClick: () => this.confirm(),
            })
          : this.chromeButton({
              tone: 'stone',
              width: b.rect.w,
              height: b.rect.h,
              fontSize: 20,
              label: t('catalyst.picker.clear'),
              onClick: () => this.clearAll(),
            });
      btn.container.position.set(b.rect.x, b.rect.y);
      host.addChild(btn.container);
    }

    const gridHost = new Container();
    host.addChild(gridHost);
    this.gridHost = gridHost;
    const summaryHost = new Container();
    host.addChild(summaryHost);
    this.summaryHost = summaryHost;
    // 요약 챔버 **바탕**은 상태와 무관하므로 크롬이다(안 그리면 갱신마다 파낸 면을 다시 그린다).
    host.addChild(recessedWell(layout.summary.x, layout.summary.y, layout.summary.w, layout.summary.h));
    host.setChildIndex(summaryHost, host.children.length - 1);

    this.chromeBuilt = true;
  }

  // --- 갱신 -----------------------------------------------------------------

  /** 슬롯 스트립·셀·공명 챔버만 갈아끼운다. 암막·석재 패널·버튼 줄은 다시 굽지 않는다. */
  private refresh(): void {
    if (!this.chromeBuilt) return;
    const layout = catalystPickerLayout();
    const slotsHost = this.slotsHost;
    if (slotsHost !== null) {
      this.clearHost(slotsHost);
      this.renderSlots(slotsHost, layout.slots);
    }
    this.renderGrid();
    const sh = this.summaryHost;
    if (sh !== null) {
      this.clearHost(sh);
      this.renderSummary(sh, layout.summary);
    }
  }

  /**
   * 헤더 왼쪽 **3칸 고정** 슬롯 스트립. 빈 칸도 그린다 — 몇 장을 더 넣을 수 있는지가 숫자가
   * 아니라 자리로 읽혀야 하고(런 중 HUD 의 3칸 배치와 같은 형태), 그래야 픽커에서 본 배치가
   * 런에서 그대로 이어진다(헌장 §귀속 규율 1).
   */
  private renderSlots(host: Container, rect: PickerRect & { cells: number; cellW: number }): void {
    const ids = normalizeCatalystArray(this.working);
    for (let i = 0; i < rect.cells; i++) {
      const x = rect.x + i * (rect.cellW + SLOT_CELL_GAP);
      const id = ids[i];
      const def = id === undefined ? undefined : catalystById(id);
      const label = new Text({
        resolution: 2,
        text: def === undefined ? t('catalyst.picker.slotEmpty') : stripEmoji(catalystName(def)),
        style: {
          fontFamily: UI_FONT,
          fontSize: 17,
          fontWeight: def === undefined ? '400' : '800',
          fill: def === undefined ? COLOR.muted : COLOR.gold,
          align: 'center',
          wordWrap: true,
          wordWrapWidth: rect.cellW - 12,
          dropShadow: TEXT_SHADOW,
        },
      });
      label.anchor.set(0.5);
      label.position.set(x + rect.cellW / 2, rect.y + rect.h / 2);
      host.addChild(label);
    }
  }

  /**
   * 촉매 48종 그리드. ⚠️ 마스크를 행 경계로 자르지 않는다 — 상자 높이를 그대로 쓰면 마지막
   * 행이 반쯤 걸쳐 "아래에 더 있다"를 말한다.
   */
  private renderGrid(): void {
    const host = this.gridHost;
    if (host === null) return;
    this.clearHost(host);
    const layout = catalystPickerLayout();
    const g = layout.grid;
    const rows = Math.ceil(CATALYSTS.length / COLS);
    const totalH = rows * (CELL_H + CELL_GAP) - CELL_GAP;
    const content = makeScrollArea(host, {
      x: g.x,
      y: g.y,
      w: g.w,
      h: g.h,
      totalH,
      get: () => this.scrollY,
      set: (v) => {
        this.scrollY = v;
      },
      thumb: true,
    });

    CATALYSTS.forEach((def, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cell = this.makeCell(def, g.cellW);
      cell.position.set(col * (g.cellW + CELL_GAP), row * (CELL_H + CELL_GAP));
      content.addChild(cell);
    });
  }

  /**
   * 하단 **공명 상태 + 경고** 챔버 — 지금 조합이 무슨 공명을 세우고 있고, 무엇이 이 행성에서
   * 무효인가.
   *
   * 예전 이 자리에는 **축별 배율 줄**(`페널티 적 내구도 +40%` …)이 있었다. ADR-0052 가 축
   * 모델을 없애면서 그 줄은 표시할 값 자체가 사라졌다 — 대신 조합이 실제로 만드는 것은 하나뿐이다:
   * **한 런에 최대 하나 발동하는 태그 공명**(`resolveResonance` 가 유일 정본).
   *
   * ⚠️ 왼쪽 열은 "무엇이 발동했나"가 아니라 **"무엇이 몇 장 모자란가"** 다. 발동한 것 하나는
   * 위 meta 줄이 이름·단·규칙문으로 말하고, 열은 거기까지 가는 길을 말한다 — 둘을 한 열에 섞으면
   * 이미 선 것과 안 선 것이 같은 모양으로 읽힌다.
   */
  private renderSummary(host: Container, rect: PickerRect): void {
    // ⚠️ 파낸 면(챔버 바탕)은 **크롬**이라 여기서 그리지 않는다 — 여기서 또 그리면 주입 한 번에
    // 파낸 면이 한 장씩 쌓인다(host 를 비우긴 하지만 바탕이 갱신 대상이 될 이유가 없다).
    const ids = normalizeCatalystArray(this.working);
    const reso = resolveResonance(ids);

    const innerX = rect.x + SUMMARY_PAD;
    const top = rect.y + 14;

    const title = new Text({
      resolution: 2,
      text: t('catalyst.resonance.head'),
      style: {
        fontFamily: UI_FONT,
        fontSize: 20,
        fontWeight: '800',
        fill: COLOR.gold,
        dropShadow: TEXT_SHADOW,
      },
    });
    title.position.set(innerX, top);
    host.addChild(title);

    const meta = new Text({
      resolution: 2,
      text:
        reso === null
          ? t('catalyst.resonance.none')
          : `${resonanceName(reso)} (${resonanceTierLabel(reso.tier)}) — ${resonanceRule(reso)}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 17,
        fill: reso === null ? COLOR.muted : SLAB_BODY_FILL,
        dropShadow: TEXT_SHADOW,
      },
    });
    meta.position.set(innerX + title.width + 18, top + 3);
    host.addChild(meta);

    // 2열: 왼쪽 태그 진행 · 오른쪽 경고. 열 폭은 챔버 안쪽을 정확히 반으로 나눈다.
    const innerW = rect.w - SUMMARY_PAD * 2;
    const colW = Math.floor((innerW - 24) / 2);
    const rowsY = rect.y + SUMMARY_ROWS_Y;
    this.renderEffectColumn(
      host,
      innerX,
      rowsY,
      colW,
      t('catalyst.tag.head'),
      RESONANCE_COLOR,
      this.tagProgressRows(ids),
    );
    this.renderEffectColumn(
      host,
      innerX + colW + 24,
      rowsY,
      colW,
      t('catalyst.warn.head'),
      WARN_COLOR,
      this.warningRows(ids, reso),
    );
  }

  /**
   * 태그별 진행 — `점화 2/3 · 약공명` / `밀도 1/3 · 1장 더`. 주입에 없는 태그는 줄을 만들지
   * 않는다(6종 전부를 항상 그리면 모자란 것이 눈에 안 띈다).
   *
   * 순서는 {@link CATALYST_TAG_PRIORITY} 고정 — 주입 순서로 뒤섞이면 한 장 넣고 뺄 때마다 읽는
   * 자리가 바뀐다(구 요약 열이 축 순서를 고정했던 것과 같은 이유).
   */
  private tagProgressRows(ids: readonly number[]): readonly PickerRow[] {
    const counts = tagCounts(ids);
    const rows: PickerRow[] = [];
    for (const tag of CATALYST_TAG_PRIORITY) {
      const n = counts.get(tag) ?? 0;
      if (n <= 0) continue;
      const value =
        n >= RESONANCE_STRONG_COUNT
          ? t('catalyst.resonance.tier.strong')
          : n >= RESONANCE_WEAK_COUNT
            ? t('catalyst.resonance.tier.weak')
            : t('catalyst.resonance.need', { n: RESONANCE_WEAK_COUNT - n });
      rows.push({
        label: `${catalystTagLabel(tag)}  ${n}/${RESONANCE_STRONG_COUNT}`,
        value,
        ...(n >= RESONANCE_WEAK_COUNT ? {} : { color: COLOR.muted }),
      });
    }
    return rows;
  }

  /**
   * 경고 2단(헌장 §축소 작동 규율).
   *
   *  - **회색** = 이 행성에서 구조적으로 무효(데이터가 미리 안다). **카드와 공명 둘 다** 낸다 —
   *    카드는 `def.voidOnPlanets`, 공명은 `ResonanceDef.voidOnPlanets` 다.
   *  - **노랑** = 촉매 간 충돌로 축소 작동(`catalystConflicts.ts` 가 판정 정본).
   *
   * ## ⚠️ 공명 회색 줄이 없으면 «3장을 바치고 아무 일도 안 일어난다»가 된다
   * 공명은 카드 셋을 같은 태그로 맞춰야 뜨는 **가장 비싼 선택**인데, 2026-08-08 이전에는
   * `ResonanceDef` 에 무효 칸이 아예 없어 «침식 강 함몰은 베르단·니플헤임에서 안 뜬다»를
   * 픽커가 낼 수단이 **존재하지 않았다**. sim 게이트(`subsidenceActive`)와 이 줄이 지금은
   * 같은 데이터 한 칸을 읽으므로 화면과 규칙이 갈릴 수 없다.
   *
   * ⚠️ **둘은 섞이지 않는다.** 회색은 카드↔행성이고 노랑은 카드↔카드(또는 카드↔공명)다 —
   * 한 카드가 이 행성에서 무효라는 것과 다른 카드가 그것을 깎는다는 것은 다른 사실이라 두 줄로
   * 나온다. 회색이 노랑을 먹거나 그 반대가 되면 "왜 경고인가"가 한쪽으로 뭉개진다.
   *
   * ⚠️ 노랑은 **발동한 공명 하나**만 근거로 삼는다(`resolveResonance` 가 정본). 조건은 맞지만
   * 우선순위에 밀려 안 뜬 공명까지 세면 없는 충돌을 경고하게 된다.
   *
   * ⚠️ 어느 쪽이든 **경고일 뿐**이다. sim 은 이 목록을 근거로 카드를 끄지 않는다 — 무효도
   * 충돌도 런 안에서는 **축소된 형태로라도 작동한다**(헌장 §축소 작동 규율). 그래서 문구도
   * "무효화됨"이 아니라 축소의 결이다.
   */
  private warningRows(ids: readonly number[], reso: ResonanceDef | null): readonly PickerRow[] {
    const planet = this.opts?.planet;
    if (planet === undefined) return [];
    const rows: PickerRow[] = [];
    for (const id of ids) {
      const def = catalystById(id);
      if (def === undefined) continue;
      if (catalystVoidOnPlanet(def, planet)) {
        rows.push({
          label: stripEmoji(catalystName(def)),
          value: t('catalyst.warn.voidOnPlanet'),
          color: WARN_VOID_COLOR,
        });
      }
    }

    // 회색(공명) — 카드 줄 **뒤**다. 공명은 카드 셋의 결과라 원인(카드)을 먼저 읽고 결과를
    // 읽는 순서가 맞고, 순서를 뒤집으면 "왜 무효인가"의 근거가 아래에 오게 된다.
    if (reso !== null && resonanceVoidOnPlanet(reso, planet)) {
      rows.push({
        label: stripEmoji(resonanceName(reso)),
        value: t('catalyst.warn.voidOnPlanet'),
        color: WARN_VOID_COLOR,
      });
    }

    // 노랑 — 지금 고른 조합(부분 선택 포함)에서 **실제로 발동하는** 충돌만.
    for (const hit of catalystConflicts(ids, reso)) {
      const names = hit.ids.map((id) => {
        const def = catalystById(id);
        return def === undefined ? String(id) : stripEmoji(catalystName(def));
      });
      // 카드↔공명이면 상대는 공명 이름이다(태그+단으로 식별된 것 = 지금 뜬 그 공명).
      if (hit.kind === 'resonance' && reso !== null) names.push(stripEmoji(resonanceName(reso)));
      rows.push({
        label: names.join(' ↔ '),
        value: t(CONFLICT_REASON_KEY[hit.reason]),
        color: WARN_CONFLICT_COLOR,
      });
    }
    return rows;
  }

  /**
   * 요약 한 열(제목 + `라벨 …… +NN%` 줄들). 줄이 없으면 `—` 한 줄로 "이 축은 비어 있다"를
   * 명시한다 — 열이 통째로 사라지면 좌우 폭이 흔들려 읽는 자리가 매번 바뀐다.
   *
   * 세로 공간이 모자라면(축을 6종까지 몰아 넣은 조합) 넘치는 줄은 그리지 않고 개수만 알린다 —
   * 조용히 잘리면 "적은 것"과 "안 보이는 것"이 구별되지 않는다.
   */
  private renderEffectColumn(
    host: Container,
    x: number,
    y: number,
    w: number,
    heading: string,
    color: number,
    rows: readonly PickerRow[],
  ): void {
    const head = new Text({
      resolution: 2,
      text: heading,
      style: { fontFamily: UI_FONT, fontSize: 17, fontWeight: '800', fill: color, dropShadow: TEXT_SHADOW },
    });
    head.position.set(x, y);
    host.addChild(head);

    // 넘치면 마지막 한 자리를 `외 N개` 에 내준다 — 안 그러면 그 줄이 챔버 바닥을 뚫는다.
    const shown = summaryShownRows(rows.length);
    const hidden = rows.length - shown;

    if (rows.length === 0) {
      const none = new Text({
        resolution: 2,
        text: t('catalyst.warn.none'),
        style: { fontFamily: UI_FONT, fontSize: 17, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
      });
      none.position.set(x, y + SUMMARY_HEAD_H);
      host.addChild(none);
      return;
    }

    for (let i = 0; i < shown; i++) {
      const row = rows[i];
      if (row === undefined) continue;
      const label = new Text({
        resolution: 2,
        text: row.label,
        style: { fontFamily: UI_FONT, fontSize: 17, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
      });
      label.position.set(x, y + SUMMARY_HEAD_H + i * SUMMARY_STEP);
      host.addChild(label);

      const value = new Text({
        resolution: 2,
        text: row.value,
        style: {
          fontFamily: UI_FONT,
          fontSize: 17,
          fontWeight: '800',
          // 줄 색이 있으면 열 기준색을 덮는다 — 경고 열은 회색(무효)과 노랑(충돌)이 섞인다.
          fill: row.color ?? color,
          dropShadow: TEXT_SHADOW,
        },
      });
      value.anchor.set(1, 0);
      value.position.set(x + w, y + SUMMARY_HEAD_H + i * SUMMARY_STEP);
      host.addChild(value);
    }

    if (hidden > 0) {
      const more = new Text({
        resolution: 2,
        text: t('result.drops.more', { n: hidden }),
        style: { fontFamily: UI_FONT, fontSize: 15, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
      });
      more.position.set(x, y + SUMMARY_HEAD_H + shown * SUMMARY_STEP);
      host.addChild(more);
    }
  }

  /**
   * 셀 상태 한 줄 — 우선순위는 **회색 무효 경고 > 주입됨 > 거부 사유**.
   *
   * ⚠️ 무효 경고(`voidOnPlanets`)가 거부 사유보다 위인 이유: 이 행성에서 구조적으로 무효인 카드도
   * **넣을 수는 있다**(헌장 §축소 작동 규율 — 무효화는 경고로만 존재하고 런 안에서는 축소된
   * 형태로라도 작동한다). 그래서 "왜 회색인가"가 "왜 못 넣는가"보다 먼저 읽혀야 한다.
   *
   * `locked`(다른 행성 특산)는 여기서 다루지 않는다 — 그것은 셀 전체를 덮는 딤 + 사유가 이미 말한다.
   */
  private cellStatus(def: CatalystDef): { text: string; color: number } | null {
    const planet = this.opts?.planet;
    if (planet !== undefined && catalystVoidOnPlanet(def, planet)) {
      return { text: `${t('catalyst.warn.badgeVoid')} · ${t('catalyst.warn.voidOnPlanet')}`, color: WARN_VOID_COLOR };
    }
    if (this.injectedCountOf(def.id) > 0) return { text: t('catalyst.picker.injected'), color: BADGE };
    const block: CatalystInjectBlock =
      this.opts === null
        ? null
        : catalystInjectBlock(def, this.working, this.opts.inventory, this.opts.planet);
    switch (block) {
      case 'noStock':
        return { text: t('catalyst.picker.blockNoStock'), color: COLOR.muted };
      case 'slotFull':
        return { text: t('catalyst.picker.slotFull', { cap: SLOT_CAP }), color: COLOR.muted };
      case 'signatureCap':
        return { text: t('catalyst.picker.blockSignatureCap', { cap: SIGNATURE_CAP }), color: WARN_CONFLICT_COLOR };
      case 'duplicate':
        // 유니크 주입이라 이 사유는 위 '주입됨' 가지가 이미 먹는다(도달 불가지만 계약상 남긴다).
        return { text: t('catalyst.picker.blockDuplicate'), color: COLOR.muted };
      default:
        return null;
    }
  }

  private makeCell(def: CatalystDef, w: number): Container {
    const cell = new Container();
    const injected = this.injectedCountOf(def.id);
    const owned = this.ownedOf(def.id);
    const locked = this.locked(def);
    cell.addChild(cellPlate(w, CELL_H, injected > 0, def.kind === 'signature'));

    // 아이콘: 개별 아트 → 보상축 폴백 → 축 토큰 글리프 순(아트가 코드보다 늦게 와도 안 죽는다).
    const iconTex = this.ui[`${catalystIconKey(def)}.png`] ?? this.ui[`${catalystIconFallbackKey(def)}.png`];
    const iconSize = 44;
    const iconX = 14;
    const iconY = 12;
    if (iconTex) {
      const sp = new Sprite(iconTex);
      sp.width = iconSize;
      sp.height = iconSize;
      sp.position.set(iconX, iconY);
      cell.addChild(sp);
    } else {
      const token = new Graphics();
      token
        .roundRect(iconX, iconY, iconSize, iconSize, 8)
        .fill({ color: def.kind === 'signature' ? 0x3a2f18 : 0x241f18 })
        .stroke({ color: injected > 0 ? COLOR.gold : 0x6a5a3e, width: 2, alignment: 1 });
      cell.addChild(token);
      const glyph = new Text({
        resolution: 2,
        text: AXIS_GLYPH[def.cap.axis] ?? '?',
        style: { fontFamily: UI_FONT, fontSize: 24, fontWeight: '800', fill: SLAB_BODY_FILL },
      });
      glyph.anchor.set(0.5);
      glyph.position.set(iconX + iconSize / 2, iconY + iconSize / 2);
      cell.addChild(glyph);
    }

    // 이름.
    const name = new Text({
      resolution: 2,
      text: stripEmoji(catalystName(def)),
      style: {
        fontFamily: UI_FONT,
        fontSize: 18,
        fontWeight: '800',
        fill: injected > 0 ? COLOR.gold : COLOR.cream,
        wordWrap: true,
        wordWrapWidth: w - iconX * 2 - iconSize - 8,
        dropShadow: TEXT_SHADOW,
      },
    });
    name.position.set(iconX + iconSize + 8, iconY);
    cell.addChild(name);

    // 종류 · 보유 한 줄. 주입은 유니크라 `×N` 스택 표기가 사라졌다 — 있고 없고뿐이다.
    const kind = new Text({
      resolution: 2,
      text: `${t(def.kind === 'signature' ? 'catalyst.kind.signature' : 'catalyst.kind.common')}   ·   ${t('catalyst.picker.owned', { n: owned })}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 13,
        fill: injected > 0 ? BADGE : COLOR.muted,
        dropShadow: TEXT_SHADOW,
      },
    });
    kind.position.set(iconX + iconSize + 8, iconY + 26);
    cell.addChild(kind);

    // 규칙문 — **이 카드가 무엇을 하는가**. 구 모델의 "페널티 …/ 보상 …" 방향 문구가 있던 자리다.
    // 양날이 한 문장 안에 있으므로 축을 두 줄로 가르지 않는다(ADR-0052 §유니크 양날 규칙).
    // ⚠️ 예산(`RULE_BUDGET_H`)을 넘으면 **잘라내지 않고 폰트를 줄여 맞춘다** — 규칙문이 이
    // 카드의 본문이라 truncate 는 정보를 잃는다. 근사 폭 계산이 실제 글꼴과 어긋나거나 앞으로
    // 문구가 길어져도 겹침으로 번지지 않게 하는 안전망이다.
    const rule = new Text({
      resolution: 2,
      text: stripEmoji(catalystRule(def)),
      style: {
        fontFamily: UI_FONT,
        fontSize: 14,
        fill: SLAB_BODY_FILL,
        wordWrap: true,
        wordWrapWidth: w - 28,
        lineHeight: RULE_LINE_H,
        dropShadow: TEXT_SHADOW,
      },
    });
    for (let size = 14; size > 10 && rule.height > RULE_BUDGET_H; size--) {
      rule.style.fontSize = size - 1;
      rule.style.lineHeight = RULE_LINE_H - (14 - (size - 1));
    }
    rule.position.set(14, RULE_TOP);
    cell.addChild(rule);

    // 태그 칩 1~2개 — 공명의 재료다. 칩 폭은 글자에서 재고, 두 번째가 셀을 넘으면 그리지 않는다.
    let chipX = 14;
    for (const tag of def.tags) {
      const label = new Text({
        resolution: 2,
        text: catalystTagLabel(tag),
        style: { fontFamily: UI_FONT, fontSize: 13, fontWeight: '700', fill: TAG_CHIP_TEXT },
      });
      const chipW = Math.round(label.width) + 16;
      if (chipX + chipW > w - 14) break;
      const chip = new Graphics();
      chip.roundRect(chipX, TAG_ROW_Y, chipW, TAG_ROW_H, 6).fill({ color: TAG_CHIP_FACE });
      cell.addChild(chip);
      label.position.set(chipX + 8, TAG_ROW_Y + 3);
      cell.addChild(label);
      chipX += chipW + 6;
    }

    // 상한 — **정산 유계**다("이만큼 발동한다"가 아니다).
    const cap = new Text({
      resolution: 2,
      text: `${t('catalyst.cap.head')} ${catalystCapLine(def.cap)}`,
      style: { fontFamily: UI_FONT, fontSize: 14, fontWeight: '700', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    cap.position.set(14, CAP_ROW_Y);
    cell.addChild(cap);

    // 상태 줄 — 회색 무효 경고(구조적) 또는 주입/거부 사유. 셋 다 없으면 줄 자체가 없다.
    const status = this.cellStatus(def);
    if (status !== null) {
      const node = new Text({
        resolution: 2,
        text: status.text,
        style: {
          fontFamily: UI_FONT,
          fontSize: 13,
          fontWeight: '700',
          fill: status.color,
          wordWrap: true,
          wordWrapWidth: w - 28,
          dropShadow: TEXT_SHADOW,
        },
      });
      node.position.set(14, STATUS_ROW_Y);
      cell.addChild(node);
    }

    if (locked) {
      // 특산 잠금: 딤 + 사유(출신 행성 전용).
      const dim = new Graphics();
      dim.roundRect(0, 0, w, CELL_H, ROW_RADIUS).fill({ color: 0x0b0814, alpha: 0.62 });
      cell.addChild(dim);
      const reason = new Text({
        resolution: 2,
        text: t('catalyst.picker.signatureLocked', {
          planet: def.planet !== undefined ? planetById(def.planet).name : '',
        }),
        style: {
          fontFamily: UI_FONT,
          fontSize: 15,
          fontWeight: '700',
          fill: 0xffb0a0,
          align: 'center',
          wordWrap: true,
          wordWrapWidth: w - 20,
          dropShadow: TEXT_SHADOW,
        },
      });
      reason.anchor.set(0.5);
      reason.position.set(w / 2, CELL_H - 24);
      cell.addChild(reason);
    } else {
      // 주입/해제 버튼 행(하단). ⚠️ 둘 다 어두운 톤이라 `setEnabled(false)`(alpha 0.4)에서도
      // 크림 라벨이 읽힌다 — 여기에 `gold` 를 쓰면 비활성 셀의 글자가 통째로 사라진다.
      const btnW = Math.floor((w - 14 * 2 - 10) / 2);
      const btnY = CELL_BTN_Y;
      const plus = this.chromeButton({
        tone: 'blue',
        width: btnW,
        height: BTN_ROW_H_CELL,
        fontSize: 16,
        label: t('catalyst.picker.inject'),
        onClick: () => this.inject(def.id),
      });
      plus.container.position.set(14, btnY);
      if (!this.canInject(def)) plus.setEnabled(false);
      cell.addChild(plus.container);

      const minus = this.chromeButton({
        tone: 'red',
        width: btnW,
        height: BTN_ROW_H_CELL,
        fontSize: 16,
        label: t('catalyst.picker.remove'),
        onClick: () => this.remove(def.id),
      });
      minus.container.position.set(14 + btnW + 10, btnY);
      if (injected <= 0) minus.setEnabled(false);
      cell.addChild(minus.container);
    }

    return cell;
  }
}
