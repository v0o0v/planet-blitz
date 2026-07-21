/**
 * 연구소 화면 (Pixi 카툰나무풍 리스킨 — `.omc/plans/cartoonwood-rollout.md` #2).
 *
 * `src/ui/researchLab.ts` 의 DOM `ResearchLab` 과 기능 1:1 동등하게 스킬 트리를 Pixi
 * 캔버스(1920×1080 디자인 스페이스)로 재구현한다: 계열 3종 × 20노드 + 캡스톤 투자
 * (`investSkill`), 리스펙(`respecSkills`/`respecCost`), 파생 스탯 미리보기
 * (`computeSkillStats`), 시너지 안내, i18n, Profile in-place 변이 + saveProfile.
 *
 * ── 화면 구조(사용자 피드백 반영) ──
 * 본 화면의 계열 패널은 그 계열에서 **포인트를 투자한 노드만** 목록으로 보여 준다(아이콘 +
 * 이름 + 투자 포인트). 전체 20노드는 패널의 "전체 스킬 보기" 버튼이 여는 **세로 스크롤
 * 팝업**으로 빠졌고, 상세 설명 열람과 포인트 투자는 거기서 한다.
 *
 * 이 구조가 이전 레이아웃의 전제를 지운다: 4열 × 5행(셀 119×95)은 "20노드를 한 화면에 전부"
 * 라는 제약에서 산술적으로 유도된 배치였는데(ADR-0015 Consequences), 전체 목록이 스크롤
 * 팝업으로 빠지면서 그 제약이 사라졌다. 본 패널은 항목 수가 훨씬 적으므로 2열 목록 행으로
 * 되돌리고(한 계열을 전부 찍어도 10행 × 2열 = 20 이 스크롤 없이 들어간다), 팝업은 세로
 * 스크롤이라 세로 제약을 받지 않는다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Rectangle, Sprite, Text, type Texture } from 'pixi.js';
import type { SkillNode } from '../../../data/skills.js';
import {
  shipTypeDef,
  flattenShipNodes,
  shipTreeRange,
  shipCapstoneIndex,
  type ShipTypeDef,
} from '../../../data/ships/index.js';
import type { StatKey } from '../../items/types.js';
import { computeSkillStats, shipCapstoneUnlocked, shipTreeBaseInvested } from '../../items/skills.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { shipTreeName, AFFINITY_ACCENT } from './shipLabels.js';
import {
  investSkill,
  respecSkills,
  respecCost,
  totalInvested,
  saveProfile,
  activeShip,
  type KeyValueStore,
  type Profile,
} from '../../save/profile.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW, iconContrastRingBands } from './theme.js';
import { loadUiTextures, skillIconName, type UiTextures } from './uiTextures.js';
import { nineSlicePanel, panelContent, PANEL_BORDER } from './nineSlicePanel.js';
import { PixiButton } from './button.js';
import { PixiTooltip } from './tooltip.js';
import { makeBanner, makeCurrencyChip, makeIconButton } from './titleBar.js';
import { rectGridPositions } from './slotGrid.js';
import { makeScrollArea } from './scrollArea.js';

// 계열 강조색(affinity 축)의 정본은 `./shipLabels.ts` 다 — 격납고·챔피언 선택도 같은 값을
// 쓰므로 이 화면 파일에 두면 다른 화면이 연구소 전체를 끌어오게 된다. 재수출만 한다.
export { AFFINITY_ACCENT } from './shipLabels.js';

/** 파생 스탯 미리보기 행: [StatKey, labelKey, isPercent]. DOM 판과 동일. */
const PREVIEW_ROWS: readonly [StatKey, MessageKey, boolean][] = [
  ['damagePct', 'lab.stat.damage', true],
  ['fireRatePct', 'lab.stat.fireRate', true],
  ['bulletCount', 'lab.stat.bulletCount', false],
  ['pierce', 'lab.stat.pierce', false],
  ['bulletSpeedPct', 'lab.stat.bulletSpeed', true],
  ['rangeFlat', 'lab.stat.range', false],
  ['maxHpFlat', 'lab.stat.maxHpFlat', false],
  ['maxHpPct', 'lab.stat.maxHp', true],
  ['dashCdPct', 'lab.stat.dashCd', true],
  ['moveSpeedPct', 'lab.stat.moveSpeed', true],
  ['magnetPct', 'lab.stat.magnet', true],
  ['xpPct', 'lab.stat.xp', true],
];

// --- 본 화면 레이아웃 상수(디자인 스페이스) ---
const BANNER_W = 620;
const BANNER_H = 72;
const BANNER_Y = 10;
const CHIP_W = 190;
const CHIP_H = 52;
const SUB_Y = 84;
const PANEL_Y = 112;
const PANEL_H = 740;
const PANEL_W = 620;
const PANEL_GAP = 14;
const PANEL_COLS = 3;
const PANEL_X0 = Math.round((DESIGN_WIDTH - (PANEL_W * PANEL_COLS + PANEL_GAP * (PANEL_COLS - 1))) / 2);
/**
 * 패널 안쪽 콘텐츠 상자. 제목·부제·목록·버튼·캡스톤을 전부 이 상자 기준으로 잡는다 —
 * 프레임에 붙는 것을 좌표 재유도 없이 구조적으로 막는다(nineSlicePanel §PANEL_INNER_PAD).
 */
const BOX = panelContent(PANEL_W, PANEL_H);
const TITLE_Y = BOX.y;
const TREE_SUB_Y = 96;
/** 전체 스킬 팝업을 여는 버튼(콘텐츠 상자 폭 전체). */
const BROWSE_Y = 118;
const BROWSE_H = 42;
const LIST_TOP = 168;
const CAPSTONE_H = 52;
/** 캡스톤 바는 콘텐츠 상자 바닥에 붙인다 — 목록과의 간격이 자동으로 남는다. */
const CAPSTONE_Y = BOX.bottom - CAPSTONE_H;
/** 캡스톤 버튼 좌측 개별 아트 자리(라벨은 버튼 중앙이라 겹치지 않는다). */
const CAPSTONE_ICON = 40;
const CAPSTONE_ICON_X = 10;

/**
 * 투자 목록 셀: 2열. 한 계열 20노드를 **전부** 찍어도 10행 × 45 = 448 로 가용
 * 450(= `CAPSTONE_Y` 628 − 10 − `LIST_TOP` 168) 안에 들어가므로 본 패널에는 스크롤이
 * 필요 없다(전체 열람은 팝업 몫). 이 여유는 아래 {@link INVESTED_LIST} 가 고정한다.
 */
const INV_COLS = 2;
const INV_GAP_X = 8;
const INV_GAP_Y = 2;
const INV_W = Math.floor((BOX.w - INV_GAP_X * (INV_COLS - 1)) / INV_COLS);
const INV_H = 43;
const INV_ICON = 32;

// --- 전체 스킬 팝업 ---
const POP_W = 900;
const POP_H = 880;
const POP_X = Math.round((DESIGN_WIDTH - POP_W) / 2);
const POP_Y = Math.round((DESIGN_HEIGHT - POP_H) / 2);
const PBOX = panelContent(POP_W, POP_H);
const POP_SUB_Y = 100;
const POP_LIST_TOP = 130;
const POP_ROW_H = 65;
const POP_ROW_GAP = 4;
/** 행 피치 — 마스크 높이를 이 배수로 클램프해 반토막 행을 구조적으로 막는다. */
const POP_ROW_PITCH = POP_ROW_H + POP_ROW_GAP;
const POP_ICON = 48;
const POP_CLOSE = 40;
/** 스크롤 막대 자리 — 행이 그 밑으로 들어가지 않도록 행 폭에서 미리 뺀다. */
const POP_BAR_W = 14;
const POP_ROW_W = PBOX.w - POP_BAR_W;

// --- 파생 스탯 하단 가로 띠 ---
const STRIP_W = PANEL_W * PANEL_COLS + PANEL_GAP * (PANEL_COLS - 1);
const STRIP_X = PANEL_X0;
const STRIP_Y = PANEL_Y + PANEL_H + 12;
const STRIP_H = 172;
/** 띠 안쪽 콘텐츠 상자(1768 × 52). 제목·스탯 그리드·시너지 안내를 가로로 나눠 쓴다. */
const SBOX = panelContent(STRIP_W, STRIP_H);
const STRIP_TITLE_W = 200;
const STRIP_SYN_W = 360;
const STAT_COLS = 6;
const STAT_ROW_H = 26;
/** 제목·시너지 열을 뺀 나머지를 6열로 나눈 폭: (1768 - 200 - 16 - 360 - 16) / 6 = 196. */
const STAT_COL_W = Math.floor((SBOX.w - STRIP_TITLE_W - STRIP_SYN_W - 32) / STAT_COLS);
const STAT_X = SBOX.x + STRIP_TITLE_W + 16;

// 리스펙은 하단 띠에 자리를 내주고 타이틀바 우측(크레딧 칩 ~ 닫기 버튼 사이)으로 옮겼다.
const RESPEC_W = 300;
const RESPEC_H = 52;
const RESPEC_X = 1500;
const RESPEC_Y = BANNER_Y + (BANNER_H - RESPEC_H) / 2;

const HINT_Y = DESIGN_HEIGHT - 8;

/** 목록 행 바탕(카드 화면과 같은 값 — 세트 안에서 목록 행의 생김새를 갈리게 하지 않는다). */
function listRowBg(w: number, h: number, accent: number, active: boolean): Graphics {
  const g = new Graphics();
  g.roundRect(0, 0, w, h, 8).fill({ color: 0x241d33, alpha: 0.92 });
  g.roundRect(0, 0, w, h, 8).stroke({ color: active ? accent : 0x5a4630, width: 2, alignment: 1 });
  return g;
}

function panelX(col: number): number {
  return PANEL_X0 + col * (PANEL_W + PANEL_GAP);
}

/**
 * 계열에서 **포인트를 투자한** base 노드의 flat 인덱스 목록(flat 순서 = 티어 오름차순).
 * 캡스톤은 별도 바가 맡으므로 제외한다. 손상/짧은 벡터도 안전(누락 = 0).
 *
 * ⚠️ M8: 축이 트리 **이름**(`'firepower'|…`)에서 **(타입 정의, 트리 인덱스)** 로 바뀌었다.
 * 이름 축을 남기면 신규 기체의 계열이 이 함수에 아예 들어올 수 없고(타입이 3리터럴), 슬라이스
 * 폭도 스트라이커의 20 으로 고정돼 비온(25)에서 다섯 칸이 조용히 잘린다.
 *
 * 순수 함수(Pixi 미의존) — 본 패널이 "찍은 것만" 보이는 규칙의 진실의 원천이다.
 */
export function investedNodeIndices(
  invest: readonly number[],
  def: ShipTypeDef,
  treeIndex: number,
): number[] {
  const { start, end } = shipTreeRange(def, treeIndex);
  const out: number[] = [];
  for (let i = start; i < end; i++) {
    if ((invest[i] ?? 0) > 0) out.push(i);
  }
  return out;
}

/**
 * `count` 개를 `cols` 열로 쌓았을 때의 목록 총 세로(마지막 행 뒤 간격 제외). 순수 함수 —
 * 본 패널 목록이 스크롤 없이 들어가는지, 팝업 목록의 스크롤 총량이 얼마인지를 같은 식으로 센다.
 */
export function listStackHeight(count: number, cols: number, rowH: number, gapY: number): number {
  if (count <= 0 || cols <= 0) return 0;
  return Math.ceil(count / cols) * (rowH + gapY) - gapY;
}

/**
 * 본 패널 투자 목록의 레이아웃 수치. 상수를 건드려 20노드가 더 이상 안 들어가게 되면 단위
 * 테스트가 즉시 깨지도록 산술 전제를 여기로 노출한다(스크롤 없는 목록이 이 배치의 전제다).
 */
export const INVESTED_LIST = {
  cols: INV_COLS,
  cellW: INV_W,
  cellH: INV_H,
  gapX: INV_GAP_X,
  gapY: INV_GAP_Y,
  /** 목록에 쓸 수 있는 세로(콘텐츠 상자 안, 캡스톤 바 위까지). */
  avail: CAPSTONE_Y - 10 - LIST_TOP,
  /** 콘텐츠 상자 폭 — 2열이 간격까지 포함해 정확히 이 안에 들어가야 한다. */
  boxW: BOX.w,
} as const;

/** 팝업 목록의 레이아웃 수치(마스크 하한·행 피치 — 반토막 행 금지의 산술 전제). */
export const POPUP_LIST = {
  rowH: POP_ROW_H,
  gapY: POP_ROW_GAP,
  pitch: POP_ROW_PITCH,
  top: POP_LIST_TOP,
  /** 마스크 하한(패널 로컬) = 콘텐츠 상자 바닥. 프레임 46 + 여백 14 위다. */
  bottom: PBOX.bottom,
  rowW: POP_ROW_W,
} as const;

/**
 * 마스크 높이를 행 피치의 배수로 내림한다(반토막 행 금지 — 반쪽 셀이 보이면 사용자는
 * "삐져나왔다"고 인지한다). 한 행도 못 들어가면 가용 높이를 그대로 쓴다. 순수 함수.
 */
export function clampToRowHeight(avail: number, pitch: number): number {
  if (pitch <= 0 || avail < pitch) return Math.max(0, avail);
  return Math.floor(avail / pitch) * pitch;
}

/** 스크롤 위치를 [0, totalH - viewH] 로 클램프(순수). 내용이 짧으면 항상 0. */
export function clampScroll(v: number, totalH: number, viewH: number): number {
  const max = Math.max(0, totalH - viewH);
  return Math.max(0, Math.min(max, v));
}

/**
 * 아이콘 자리 뒤에 까는 대비 홈({@link iconContrastRingBands} 근거). 스프라이트보다 먼저
 * 넣어 **뒤에** 깔리게 한다 — 아이콘을 가리지 않고 가장자리에서만 보인다.
 *
 * 홈은 아이콘 상자 밖으로 밴드 폭(44px 기준 2px)만 나가므로, 아이콘을 놓는 자리마다
 * {@link iconRingMargin} 이상의 여백만 잡으면 셀 밖으로 삐져나올 수 없다.
 */
function iconContrastRing(x: number, y: number, size: number): Graphics {
  const g = new Graphics();
  for (const b of iconContrastRingBands(size)) {
    g.roundRect(x - b.inset, y - b.inset, size + b.inset * 2, size + b.inset * 2, b.radius).stroke({
      color: b.color,
      width: b.width,
      alpha: b.alpha,
      alignment: 0.5,
    });
  }
  return g;
}

/** 홈이 아이콘 상자 밖으로 나가는 최대 px(= 밴드 폭). 자리 여백의 하한이다. */
function iconRingMargin(size: number): number {
  return Math.max(...iconContrastRingBands(size).map((b) => b.inset + b.width / 2));
}

/**
 * 스킬 아이콘 한 장을 **주어진 상자 안에만** 그린다(홈 포함). 상자보다 큰 그림이 셀 밖으로
 * 걸치는 결함을 코드로 막는다: 실제 스프라이트 변은 `size - 홈여백 × 2` 로 줄여 놓고 상자
 * 가운데에 앉힌다. 텍스처가 없으면 계열색 플레이스홀더로 폴백한다(자산 한 장이 빠져도 화면은
 * 죽지 않는다 — uiTextures null 폴백 규약).
 */
function makeSkillIcon(
  tex: Texture | null | undefined,
  boxX: number,
  boxY: number,
  boxSize: number,
  accent: number,
  bright: boolean,
): Container {
  const root = new Container();
  // 홈이 상자 밖으로 나가지 않도록 그림을 먼저 줄인다(2회 반복 없이 한 번에 수렴하는 근사).
  const margin = Math.ceil(iconRingMargin(boxSize));
  const size = Math.max(8, boxSize - margin * 2);
  const x = boxX + Math.round((boxSize - size) / 2);
  const y = boxY + Math.round((boxSize - size) / 2);
  root.addChild(iconContrastRing(x, y, size));
  if (tex) {
    const sp = new Sprite(tex);
    sp.width = size;
    sp.height = size;
    sp.position.set(x, y);
    root.addChild(sp);
  } else {
    const g = new Graphics();
    g.roundRect(x, y, size, size, Math.max(4, Math.round(size * 0.18)))
      .fill({ color: 0x000000, alpha: 0.28 })
      .stroke({ color: accent, width: 2, alpha: bright ? 0.9 : 0.45 });
    root.addChild(g);
  }
  return root;
}

export class ResearchLabScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private readonly tooltip = new PixiTooltip();
  private profile: Profile;
  private readonly store: KeyValueStore | null;
  private onClose: (() => void) | null = null;
  private hint = '';
  private ui: UiTextures = {};
  /** 열려 있는 전체 스킬 팝업의 **계열 인덱스**(null = 닫힘). */
  private popupTree: number | null = null;
  private popupScrollY = 0;
  /** 본 패널 투자 목록의 계열별 스크롤 위치(노드가 많은 타입에서만 쓰인다). */
  private readonly listScrollY: number[] = [0, 0, 0];

  /**
   * 현재 편집 대상 = **활성 기체의 타입 정의**. 화면 전체가 이 하나에서 파생된다
   * (트리 수·노드 수·게이트·캡스톤 인덱스). 스트라이커 정본 상수를 직접 읽으면 비온(25노드,
   * 게이트 44)에서 그리드가 붕괴하고 캡스톤 잠금이 오판정된다.
   */
  private def(): ShipTypeDef {
    return shipTypeDef(activeShip(this.profile).typeId);
  }

  /**
   * 투자 벡터의 **정본**(M8 v4) = 활성 기체 벡터. `profile.skillInvest`(폐기 예정 별칭)를
   * 읽으면 M8-L7 이 그 필드를 지우는 순간 화면이 통째로 끊긴다.
   */
  private invest(): number[] {
    return activeShip(this.profile).skillInvest;
  }

  constructor(profile: Profile, stage: Container, store: KeyValueStore | null = null) {
    this.profile = profile;
    this.store = store;
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    this.root.addChild(this.tooltip.container);
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      if (this.root.visible) this.render();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  show(profile: Profile, onClose: () => void): void {
    this.profile = profile;
    this.onClose = onClose;
    this.hint = '';
    // 캔버스 화면은 다음 화면이 자동으로 덮어 주지 않으므로 팝업 상태를 직접 되돌린다.
    this.popupTree = null;
    this.popupScrollY = 0;
    this.render();
    this.root.visible = true;
    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
    // DOM HUD 는 런 전용 — 캔버스 메타 화면 위에 떠 보이므로 숨긴다(스킬 §7).
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = 'hidden';
  }

  hide(): void {
    this.root.visible = false;
    this.tooltip.hide();
    this.onClose = null;
    this.popupTree = null;
    this.popupScrollY = 0;
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = '';
  }

  private persist(): void {
    saveProfile(this.profile, this.store);
  }

  // --- 투자 / 리스펙 (DOM 판과 동일 규칙) ----------------------------------

  private investNode(index: number): void {
    if (!investSkill(this.profile, index)) {
      this.hint = this.profile.skillPoints <= 0 ? t('lab.err.noPoints') : t('lab.err.maxed');
      this.render();
      return;
    }
    this.hint = '';
    this.persist();
    this.render();
  }

  private investCapstone(index: number, unlocked: boolean): void {
    if (!unlocked) {
      // 게이트 폭은 타입별이다(스트라이커·브루저·아크·팬텀 40, 비온 44) — 상수를 박으면 거짓말.
      this.hint = t('lab.capstone.needGate', { g: this.def().capstoneGate });
      this.render();
      return;
    }
    this.investNode(index);
  }

  private respec(): void {
    if (!respecSkills(this.profile)) {
      this.hint =
        totalInvested(this.profile) === 0
          ? t('lab.err.noInvest')
          : t('lab.err.noCredits', { n: respecCost(this.profile) });
      this.render();
      return;
    }
    this.hint = t('lab.respecDone');
    this.persist();
    this.render();
  }

  private openPopup(tree: number): void {
    this.popupTree = tree;
    this.popupScrollY = 0;
    this.hint = '';
    this.tooltip.hide();
    this.render();
  }

  private closePopup(): void {
    this.popupTree = null;
    this.popupScrollY = 0;
    this.render();
  }

  // --- 툴팁 ----------------------------------------------------------------

  private showTip(index: number, accent: number, globalX: number, globalY: number): void {
    const node = flattenShipNodes(this.def())[index];
    if (node === undefined) return;
    const cur = this.invest()[index] ?? 0;
    const p = this.root.toLocal({ x: globalX, y: globalY });
    this.tooltip.show(
      { title: node.name, titleColor: accent, subtitle: `${cur} / ${node.maxPoints} pt`, lines: [node.desc] },
      p.x,
      p.y,
      accent,
    );
    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
  }

  private moveTip(globalX: number, globalY: number): void {
    if (!this.tooltip.container.visible) return;
    const p = this.root.toLocal({ x: globalX, y: globalY });
    this.tooltip.container.position.set(
      Math.min(p.x + 14, DESIGN_WIDTH - this.tooltip.container.width),
      Math.min(p.y + 14, DESIGN_HEIGHT - this.tooltip.container.height),
    );
  }

  // --- 렌더 ----------------------------------------------------------------

  private render(): void {
    for (const child of [...this.root.children]) {
      if (child !== this.tooltip.container) {
        this.root.removeChild(child);
        child.destroy({ children: true });
      }
    }
    this.tooltip.hide();

    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static';
    this.root.addChildAt(bg, 0);

    this.renderTitleBar();
    // 계열 수·구성은 **활성 기체 타입** 이 정한다(3계열 고정 가정 제거).
    this.def().trees.forEach((_, i) => this.renderTreePanel(i));
    this.renderStatsStrip();
    this.renderActions();
    // 팝업을 먼저 얹고 힌트를 그 위에 — 팝업에서 투자에 실패했을 때 안내가 막에 가리지 않는다.
    if (this.popupTree !== null) this.renderPopup(this.popupTree);
    this.renderHint();

    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
  }

  private renderTitleBar(): void {
    const banner = makeBanner(BANNER_W, BANNER_H, t('lab.title'), this.ui['ui_banner.png']);
    banner.position.set((DESIGN_WIDTH - BANNER_W) / 2, BANNER_Y);
    this.root.addChild(banner);

    const chipY = BANNER_Y + (BANNER_H - CHIP_H) / 2;
    const points = makeCurrencyChip(
      CHIP_W,
      CHIP_H,
      String(this.profile.skillPoints),
      this.ui['ui_chip.png'],
      this.ui['ui_icon_star.png'],
    );
    points.position.set((DESIGN_WIDTH - BANNER_W) / 2 - CHIP_W - 20, chipY);
    this.root.addChild(points);

    const credits = makeCurrencyChip(
      CHIP_W,
      CHIP_H,
      String(this.profile.credits),
      this.ui['ui_chip.png'],
      this.ui['ui_icon_coin.png'],
    );
    credits.position.set((DESIGN_WIDTH + BANNER_W) / 2 + 20, chipY);
    this.root.addChild(credits);

    const ship = activeShip(this.profile);
    const sub = new Text({
      resolution: 2,
      text: `${t('lab.bar.invest')} ${totalInvested(this.profile)}pt · ${t('lab.bar.shipLv')} ${ship.level}`,
      style: { fontFamily: UI_FONT, fontSize: 18, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    sub.anchor.set(0.5, 0);
    sub.position.set(DESIGN_WIDTH / 2, SUB_Y);
    this.root.addChild(sub);

    const close = makeIconButton(
      56,
      () => {
        const cb = this.onClose;
        this.hide();
        cb?.();
      },
      this.ui['ui_icon_close.png'],
    );
    close.position.set(DESIGN_WIDTH - 24 - 56, 12);
    this.root.addChild(close);
  }

  // --- 본 화면 계열 패널(찍은 것만) ----------------------------------------

  private renderTreePanel(treeIndex: number): void {
    const def = this.def();
    const treeDef = def.trees[treeIndex];
    if (treeDef === undefined) return;
    const accent = AFFINITY_ACCENT[treeDef.affinity];
    const col = treeIndex;
    const panel = new Container();
    panel.position.set(panelX(col), PANEL_Y);
    this.root.addChild(panel);
    panel.addChild(nineSlicePanel(PANEL_W, PANEL_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));

    const title = new Text({
      resolution: 2,
      text: shipTreeName(treeDef),
      style: { fontFamily: UI_FONT, fontSize: 26, fontWeight: '800', fill: accent, dropShadow: TEXT_SHADOW },
    });
    title.anchor.set(0.5, 0);
    title.position.set(PANEL_W / 2, TITLE_Y);
    panel.addChild(title);

    const invested = shipTreeBaseInvested(this.invest(), def, treeIndex);
    const sub = new Text({
      resolution: 2,
      text: t('lab.tree.sub', { n: invested }),
      style: {
        fontFamily: UI_FONT,
        fontSize: 13,
        fill: COLOR.muted,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: BOX.w,
        dropShadow: TEXT_SHADOW,
      },
    });
    sub.anchor.set(0.5, 0);
    sub.position.set(PANEL_W / 2, TREE_SUB_Y);
    panel.addChild(sub);

    const picked = investedNodeIndices(this.invest(), def, treeIndex);

    // 전체 목록은 팝업 몫 — 이 버튼이 유일한 진입점이자, 투자가 일어나는 자리다.
    const browse = new PixiButton({
      texture: this.ui['ui_btn_blue.png'],
      fallbackColor: 0x2a4a7a,
      width: BOX.w,
      height: BROWSE_H,
      fontSize: 17,
      label: t('lab.browseAll', { n: picked.length, m: def.nodesPerTree }),
      onClick: () => this.openPopup(treeIndex),
    });
    browse.container.position.set(BOX.x, BROWSE_Y);
    panel.addChild(browse.container);

    if (picked.length === 0) {
      const empty = new Text({
        resolution: 2,
        text: t('lab.noInvested'),
        style: {
          fontFamily: UI_FONT,
          fontSize: 15,
          fill: COLOR.muted,
          align: 'center',
          wordWrap: true,
          wordWrapWidth: BOX.w - 20,
          lineHeight: 22,
          dropShadow: TEXT_SHADOW,
        },
      });
      // 빈 목록 자리는 세로로 크므로 안내를 그 한가운데 둔다(위에 붙으면 버려진 여백처럼 보인다).
      empty.anchor.set(0.5, 0.5);
      empty.position.set(PANEL_W / 2, LIST_TOP + INVESTED_LIST.avail / 2);
      panel.addChild(empty);
    } else {
      // ⚠️ 목록 세로가 가용 높이를 넘을 수 있다 — `nodesPerTree` 가 타입별이라(비온 25) 2열
      // 13행 = 585 로 가용 450 을 넘긴다. 스크롤 영역에 넣어 두면 20노드 타입에서는
      // `totalH <= viewH` 라 휠 리스너조차 안 붙어 기존 거동과 같다(makeScrollArea 규약).
      const nodes = flattenShipNodes(def);
      const cells = rectGridPositions(picked.length, INV_COLS, INV_W, INV_H, INV_GAP_X, INV_GAP_Y);
      const totalH = listStackHeight(picked.length, INV_COLS, INV_H, INV_GAP_Y);
      const content = makeScrollArea(panel, {
        x: BOX.x,
        y: LIST_TOP,
        w: BOX.w,
        h: INVESTED_LIST.avail,
        totalH,
        get: () => this.listScrollY[treeIndex] ?? 0,
        set: (v) => {
          this.listScrollY[treeIndex] = v;
        },
      });
      picked.forEach((index, i) => {
        const at = cells[i];
        const node = nodes[index];
        if (at === undefined || node === undefined) return;
        const row = this.makeInvestedRow(index, node, accent);
        row.position.set(at.x, at.y);
        content.addChild(row);
      });
    }

    panel.addChild(this.makeCapstone(treeIndex, accent));
  }

  /**
   * 본 패널의 투자 목록 행(246×43): 아이콘 + 이름 + `현재/최대`. **표시 전용**이다 —
   * 투자는 팝업 한 곳에서만 일어나게 해 진입점을 갈라 놓지 않는다. 설명은 hover 툴팁.
   */
  private makeInvestedRow(index: number, node: SkillNode, accent: number): Container {
    const cur = this.invest()[index] ?? 0;
    const maxed = cur >= node.maxPoints;

    const row = new Container();
    row.addChild(listRowBg(INV_W, INV_H, accent, maxed));

    const iconBoxY = Math.round((INV_H - INV_ICON) / 2);
    row.addChild(
      makeSkillIcon(this.ui[skillIconName(node)], 6, iconBoxY, INV_ICON, accent, maxed),
    );

    const pts = new Text({
      resolution: 2,
      text: `${cur}/${node.maxPoints}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 13,
        fontWeight: '800',
        fill: maxed ? COLOR.gold : accent,
        dropShadow: TEXT_SHADOW,
      },
    });
    pts.anchor.set(1, 0.5);
    pts.position.set(INV_W - 8, INV_H / 2);
    row.addChild(pts);

    const nameX = 6 + INV_ICON + 8;
    const nameRoom = INV_W - nameX - pts.width - 14;
    const name = new Text({
      resolution: 2,
      text: node.name,
      style: {
        fontFamily: UI_FONT,
        fontSize: 14,
        fontWeight: '700',
        fill: maxed ? COLOR.gold : COLOR.cream,
        dropShadow: TEXT_SHADOW,
      },
    });
    name.anchor.set(0, 0.5);
    name.position.set(nameX, INV_H / 2);
    // 로케일이 바뀌어 이름이 길어져도 포인트 배지를 침범하지 않게 가로로 눌러 맞춘다.
    if (name.width > nameRoom) name.scale.x = nameRoom / name.width;
    row.addChild(name);

    // 클릭 판정은 **행 Container** 에 — 바탕 Graphics 에만 걸면 위에 얹힌 텍스트·아이콘이
    // 이벤트를 삼킨다(실측 결함).
    row.eventMode = 'static';
    row.on('pointerover', (e) => this.showTip(index, accent, e.global.x, e.global.y));
    row.on('pointermove', (e) => this.moveTip(e.global.x, e.global.y));
    row.on('pointerout', () => this.tooltip.hide());
    return row;
  }

  /** 캡스톤: 해금이면 노란 버튼, 잠기면 나무 버튼 + 게이트 진행도. */
  private makeCapstone(treeIndex: number, accent: number): Container {
    const def = this.def();
    const invest = this.invest();
    const index = shipCapstoneIndex(def, treeIndex);
    const node = flattenShipNodes(def)[index]!;
    const cur = invest[index] ?? 0;
    const unlocked = shipCapstoneUnlocked(invest, def, treeIndex);
    const gateProgress = shipTreeBaseInvested(invest, def, treeIndex);

    const label = unlocked
      ? `★ ${node.name}   ${cur}/${node.maxPoints}`
      : `${node.name}   ${gateProgress}/${def.capstoneGate}`;
    const btn = new PixiButton({
      texture: this.ui[unlocked ? 'ui_btn_yellow.png' : 'ui_btn_wood.png'],
      fallbackColor: unlocked ? 0x9a7a2a : 0x4a3a24,
      width: BOX.w,
      height: CAPSTONE_H,
      fontSize: 18,
      // 노란 버튼은 바탕이 밝아 흰 라벨이 묻힌다(기지 맵과 동일 처리).
      ...(unlocked ? { labelColor: COLOR.darkLabel } : {}),
      label,
      onClick: () => this.investCapstone(index, unlocked),
    });
    // 캡스톤은 perPoint 0 인 질적 노드라 스탯 아이콘을 붙이면 거짓말이 된다 — 계열별 개별 아트.
    btn.container.addChild(
      makeSkillIcon(
        this.ui[skillIconName(node)],
        CAPSTONE_ICON_X,
        Math.round((CAPSTONE_H - CAPSTONE_ICON) / 2),
        CAPSTONE_ICON,
        accent,
        unlocked,
      ),
    );

    btn.container.position.set(BOX.x, CAPSTONE_Y);
    btn.container.on('pointerover', (e) => this.showTip(index, unlocked ? COLOR.gold : accent, e.global.x, e.global.y));
    btn.container.on('pointermove', (e) => this.moveTip(e.global.x, e.global.y));
    btn.container.on('pointerout', () => this.tooltip.hide());
    if (!unlocked) btn.container.alpha = 0.7;
    return btn.container;
  }

  // --- 전체 스킬 팝업 -------------------------------------------------------

  /**
   * 계열 전체 20노드를 아이콘 + 이름 + 설명 + `현재/최대` 로 보여 주고 거기서 투자시킨다.
   * 세로 스크롤은 마스크 + 클립 Container 조합이고, 마스크 높이는 행 피치의 배수로 클램프해
   * 반토막 행이 나오지 않게 한다.
   */
  private renderPopup(treeIndex: number): void {
    const def = this.def();
    const treeDef = def.trees[treeIndex];
    if (treeDef === undefined) return;
    const meta = { accent: AFFINITY_ACCENT[treeDef.affinity], name: shipTreeName(treeDef) };
    const nodes = flattenShipNodes(def);

    // 뒤 화면을 덮는 막 — 클릭을 흡수하고(뒤 행이 눌리지 않게) 바깥 클릭은 닫기로 쓴다.
    const veil = new Graphics();
    veil.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: 0x000000, alpha: 0.62 });
    veil.eventMode = 'static';
    veil.on('pointertap', () => this.closePopup());
    this.root.addChild(veil);

    const panel = new Container();
    panel.position.set(POP_X, POP_Y);
    this.root.addChild(panel);
    // 밝은 화면 위 팝업은 불투명이어야 한다 — 반투명이면 뒤가 비쳐 읽기 어렵다(실측 결함).
    // 채움과 나무 살 사이 틈(뒤 화면이 비치던 띠)은 `fillInset` 기본값이 자산 실측으로
    // 바뀌면서 없어졌다 — 여기서 따로 당기지 않는다.
    panel.addChild(
      nineSlicePanel(POP_W, POP_H, {
        texture: this.ui['ui_panel.png'],
        border: PANEL_BORDER,
        fillAlpha: 1,
      }),
    );
    // 패널 위 클릭이 뒤의 막까지 새지 않게 막는다(패널 안 빈자리 클릭 = 닫힘 방지).
    const block = new Graphics();
    block.rect(0, 0, POP_W, POP_H).fill({ color: 0x000000, alpha: 0.001 });
    block.eventMode = 'static';
    panel.addChild(block);

    const title = new Text({
      resolution: 2,
      text: t('lab.all.title', { tree: meta.name }),
      style: { fontFamily: UI_FONT, fontSize: 26, fontWeight: '800', fill: meta.accent, dropShadow: TEXT_SHADOW },
    });
    title.anchor.set(0, 0);
    title.position.set(PBOX.x, PBOX.y);
    panel.addChild(title);

    const close = makeIconButton(POP_CLOSE, () => this.closePopup(), this.ui['ui_icon_close.png']);
    close.position.set(PBOX.right - POP_CLOSE, PBOX.y);
    panel.addChild(close);

    const sub = new Text({
      resolution: 2,
      text: t('lab.all.sub', {
        n: this.profile.skillPoints,
        m: shipTreeBaseInvested(this.invest(), def, treeIndex),
      }),
      style: { fontFamily: UI_FONT, fontSize: 15, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    sub.anchor.set(0, 0);
    sub.position.set(PBOX.x, POP_SUB_Y);
    panel.addChild(sub);

    const scrollHint = new Text({
      resolution: 2,
      text: t('lab.all.hint'),
      style: { fontFamily: UI_FONT, fontSize: 13, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    scrollHint.anchor.set(1, 0);
    scrollHint.position.set(PBOX.right, POP_SUB_Y + 2);
    panel.addChild(scrollHint);

    // 마스크 하한은 콘텐츠 상자 바닥(프레임 + 여백 위) — 목록이 나무 테두리에 닿지 않는다.
    const viewH = clampToRowHeight(PBOX.bottom - POP_LIST_TOP, POP_ROW_PITCH);
    const { start } = shipTreeRange(def, treeIndex);
    const perTree = def.nodesPerTree;
    const totalH = listStackHeight(perTree, 1, POP_ROW_H, POP_ROW_GAP);

    const clip = new Container();
    clip.position.set(PBOX.x, POP_LIST_TOP);
    panel.addChild(clip);
    const mask = new Graphics();
    mask.rect(PBOX.x, POP_LIST_TOP, PBOX.w, viewH).fill({ color: 0xffffff });
    panel.addChild(mask);
    clip.mask = mask;

    const content = new Container();
    clip.addChild(content);
    const scrollY = clampScroll(this.popupScrollY, totalH, viewH);
    this.popupScrollY = scrollY;
    content.y = -scrollY;

    for (let local = 0; local < perTree; local++) {
      const index = start + local;
      const node = nodes[index];
      if (node === undefined) continue;
      const row = this.makePopupRow(index, node, meta.accent);
      row.position.set(0, local * POP_ROW_PITCH);
      content.addChild(row);
    }

    if (totalH > viewH) {
      // 스크롤 위치 표시 막대(오른쪽 안쪽, `POP_BAR_W` 만큼 행에서 미리 비워 둔 자리).
      const maxScroll = totalH - viewH;
      const thumbH = Math.max(40, Math.round((viewH / totalH) * viewH));
      const barX = PBOX.right - 6;
      const track = new Graphics();
      track.roundRect(barX, POP_LIST_TOP, 4, viewH, 2).fill({ color: 0x000000, alpha: 0.35 });
      panel.addChild(track);
      const thumb = new Graphics();
      thumb.roundRect(barX, 0, 4, thumbH, 2).fill({ color: meta.accent, alpha: 0.75 });
      thumb.y = POP_LIST_TOP + Math.round((scrollY / maxScroll) * (viewH - thumbH));
      panel.addChild(thumb);

      // 휠은 **클립 Container** 가 받는다. 마스크로 쓰이는 Graphics 는 히트 테스트에서 제외돼
      // (`isMask`) 리스너가 영영 안 불린다(실측). hitArea 를 주면 행 사이 빈자리에서도 잡히고,
      // 행 위에서는 행 → 클립으로 버블링되어 함께 성립한다.
      clip.eventMode = 'static';
      clip.hitArea = new Rectangle(0, 0, PBOX.w, viewH);
      clip.on('wheel', (e) => {
        // 스크롤량을 행 피치에 맞춰 스냅한다 — 멈춘 자리에서 위쪽에 반토막 행이 남지 않는다.
        const snapped = Math.round((this.popupScrollY + e.deltaY) / POP_ROW_PITCH) * POP_ROW_PITCH;
        const next = clampScroll(snapped, totalH, viewH);
        this.popupScrollY = next;
        content.y = -next;
        thumb.y = POP_LIST_TOP + Math.round((next / maxScroll) * (viewH - thumbH));
      });
    }
  }

  /** 팝업 목록 행(780×65): 아이콘 + 이름 + 상세 설명 + `현재/최대`. 행 클릭 = 1포인트 투자. */
  private makePopupRow(index: number, node: SkillNode, accent: number): Container {
    const cur = this.invest()[index] ?? 0;
    const maxed = cur >= node.maxPoints;
    const canInvest = !maxed && this.profile.skillPoints > 0;

    const row = new Container();
    row.addChild(listRowBg(POP_ROW_W, POP_ROW_H, accent, cur > 0));

    const iconBoxY = Math.round((POP_ROW_H - POP_ICON) / 2);
    row.addChild(makeSkillIcon(this.ui[skillIconName(node)], 10, iconBoxY, POP_ICON, accent, maxed));

    const pts = new Text({
      resolution: 2,
      text: `${cur}/${node.maxPoints}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 18,
        fontWeight: '800',
        fill: maxed ? COLOR.gold : cur > 0 ? accent : COLOR.muted,
        dropShadow: TEXT_SHADOW,
      },
    });
    pts.anchor.set(1, 0.5);
    pts.position.set(POP_ROW_W - 14, POP_ROW_H / 2);
    row.addChild(pts);

    const textX = 10 + POP_ICON + 12;
    const textW = POP_ROW_W - textX - pts.width - 28;

    const name = new Text({
      resolution: 2,
      text: node.name,
      style: {
        fontFamily: UI_FONT,
        fontSize: 17,
        fontWeight: '800',
        fill: maxed ? COLOR.gold : COLOR.cream,
        dropShadow: TEXT_SHADOW,
      },
    });
    name.anchor.set(0, 0);
    name.position.set(textX, 11);
    if (name.width > textW) name.scale.x = textW / name.width;
    row.addChild(name);

    const detail = new Text({
      resolution: 2,
      text: `${node.desc} · ${t('lab.node.meta', { t: node.tier + 1, m: node.maxPoints })}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 13,
        fill: COLOR.muted,
        wordWrap: true,
        wordWrapWidth: textW,
        lineHeight: 17,
        dropShadow: TEXT_SHADOW,
      },
    });
    detail.anchor.set(0, 0);
    detail.position.set(textX, 36);
    row.addChild(detail);

    // 투자 여력이 없으면 흐리게 — 클릭은 살려 안내 힌트를 띄운다(DOM 판과 같은 규칙).
    if (!canInvest) row.alpha = maxed ? 0.85 : 0.6;

    // 클릭 판정은 행 Container 에(바탕 Graphics 에만 걸면 텍스트·아이콘이 삼킨다).
    row.eventMode = 'static';
    row.cursor = canInvest ? 'pointer' : 'default';
    row.on('pointertap', () => this.investNode(index));
    return row;
  }

  // --- 파생 스탯 하단 띠 ----------------------------------------------------

  /**
   * 파생 스탯 미리보기 — 화면 하단 가로 띠. 세로 목록이던 것을 눕혀 화면 폭을 쓴다
   * (계열 패널이 620px 로 넓어지면서 4번째 세로 패널 자리가 없어졌다).
   *
   * 콘텐츠 상자(1768×52)를 [제목 200 | 스탯 6열×2행 | 시너지 안내 360] 으로 가로 분할한다.
   */
  private renderStatsStrip(): void {
    const panel = new Container();
    panel.position.set(STRIP_X, STRIP_Y);
    this.root.addChild(panel);
    panel.addChild(nineSlicePanel(STRIP_W, STRIP_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));

    const midY = SBOX.y + SBOX.h / 2;

    const title = new Text({
      resolution: 2,
      text: t('lab.derivedStats'),
      style: {
        fontFamily: UI_FONT,
        fontSize: 18,
        fontWeight: '800',
        fill: COLOR.cream,
        wordWrap: true,
        wordWrapWidth: STRIP_TITLE_W,
        dropShadow: TEXT_SHADOW,
      },
    });
    title.anchor.set(0, 0.5);
    title.position.set(SBOX.x, midY);
    panel.addChild(title);

    // 파생 스탯도 **기체 타입** 을 함께 넘긴다 — 노드 정의가 타입별이라 타입을 빼면 비온의
    // 25번째 이후 노드가 통째로 무시되고, 트리 슬라이스 폭도 20 으로 오판정된다.
    const sums = computeSkillStats(this.invest(), this.def().id);
    const rows = PREVIEW_ROWS.filter(([key]) => sums[key] !== 0);
    const cells = rectGridPositions(rows.length, STAT_COLS, STAT_COL_W, STAT_ROW_H, 0, 0);
    rows.forEach(([key, labelKey, isPct], i) => {
      const at = cells[i];
      if (at === undefined) return;
      const cy = SBOX.y + at.y + STAT_ROW_H / 2;
      const k = new Text({
        resolution: 2,
        text: t(labelKey),
        style: { fontFamily: UI_FONT, fontSize: 14, fill: COLOR.cream, dropShadow: TEXT_SHADOW },
      });
      k.anchor.set(0, 0.5);
      k.position.set(STAT_X + at.x, cy);
      panel.addChild(k);
      // 시너지 증폭은 분수를 만든다(예: 59.072) — 소수 1자리로 반올림해 표시 노이즈를 줄인다.
      const v = sums[key];
      const shownV = Number.isInteger(v) ? String(v) : v.toFixed(1);
      const val = new Text({
        resolution: 2,
        text: isPct ? `+${shownV}%` : `+${shownV}`,
        style: { fontFamily: UI_FONT, fontSize: 14, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
      });
      val.anchor.set(1, 0.5);
      val.position.set(STAT_X + at.x + STAT_COL_W - 10, cy);
      panel.addChild(val);
      // 최악 조합(긴 라벨 "대시 재충전 감소" + 3자리 값 "+149.0%")이 붙어 보이지 않게, 값이
      // 차지하고 남은 자리에 라벨을 가로로 눌러 맞춘다. 로케일이 바뀌어도 겹치지 않는다.
      const labelRoom = STAT_COL_W - 10 - val.width - 10;
      if (k.width > labelRoom) k.scale.x = labelRoom / k.width;
    });

    if (rows.length === 0) {
      const empty = new Text({
        resolution: 2,
        text: t('lab.noStats'),
        style: { fontFamily: UI_FONT, fontSize: 16, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
      });
      empty.anchor.set(0, 0.5);
      empty.position.set(STAT_X, midY);
      panel.addChild(empty);
    }

    const syn = new Text({
      resolution: 2,
      text: t('lab.synergy'),
      style: {
        fontFamily: UI_FONT,
        fontSize: 13,
        fill: COLOR.muted,
        wordWrap: true,
        wordWrapWidth: STRIP_SYN_W,
        lineHeight: 17,
        dropShadow: TEXT_SHADOW,
      },
    });
    syn.anchor.set(0, 0.5);
    syn.position.set(SBOX.right - STRIP_SYN_W, midY);
    panel.addChild(syn);
  }

  /** 리스펙 버튼 — 하단 띠에 자리를 내주고 타이틀바 우측으로 옮겼다. */
  private renderActions(): void {
    const cost = respecCost(this.profile);
    const respec = new PixiButton({
      texture: this.ui['ui_btn_red.png'],
      fallbackColor: 0x9a2a2a,
      width: RESPEC_W,
      height: RESPEC_H,
      fontSize: 18,
      label: t('lab.respecBtn', { n: cost }),
      onClick: () => this.respec(),
    });
    respec.container.position.set(RESPEC_X, RESPEC_Y);
    this.root.addChild(respec.container);
    if (totalInvested(this.profile) === 0) respec.setEnabled(false);
  }

  private renderHint(): void {
    if (this.hint === '') return;
    const h = new Text({
      resolution: 2,
      text: this.hint,
      style: { fontFamily: UI_FONT, fontSize: 18, fontWeight: '700', fill: 0xff9a7a, dropShadow: TEXT_SHADOW },
    });
    h.anchor.set(0.5, 1);
    h.position.set(DESIGN_WIDTH / 2, HINT_Y);
    this.root.addChild(h);
  }
}
