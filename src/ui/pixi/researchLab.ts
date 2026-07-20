/**
 * 연구소 화면 (Pixi 카툰나무풍 리스킨 — `.omc/plans/cartoonwood-rollout.md` #2).
 *
 * `src/ui/researchLab.ts` 의 DOM `ResearchLab` 과 기능 1:1 동등하게 스킬 트리를 Pixi
 * 캔버스(1920×1080 디자인 스페이스)로 재구현한다: 계열 3종 × 20노드 + 캡스톤 투자
 * (`investSkill`), 리스펙(`respecSkills`/`respecCost`), 파생 스탯 미리보기
 * (`computeSkillStats`), 시너지 안내, i18n, Profile in-place 변이 + saveProfile.
 *
 * 노드 설명은 DOM 판의 `title` 툴팁 대신 공용 `PixiTooltip` 으로 띄운다 — 카드에서
 * 설명 줄을 빼 20노드+캡스톤이 스크롤 없이 한 화면에 들어온다(스킬 §4: 반토막 금지).
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import {
  SKILLS,
  SKILL_TREES,
  NODES_PER_TREE,
  treeRange,
  capstoneIndex,
  capstoneUnlocked,
  treeBaseInvested,
  CAPSTONE_GATE,
  type SkillTree,
} from '../../../data/skills.js';
import type { StatKey } from '../../items/types.js';
import { computeSkillStats } from '../../items/skills.js';
import { t, type MessageKey } from '../../i18n/index.js';
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
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { nineSlicePanel, panelContent, PANEL_BORDER } from './nineSlicePanel.js';
import { PixiButton } from './button.js';
import { PixiTooltip } from './tooltip.js';
import { makeBanner, makeCurrencyChip, makeIconButton } from './titleBar.js';
import { rectGridPositions } from './slotGrid.js';

/** 계열 → 헤더 라벨 키 + 강조색(정수). DOM 판 TREE_META 와 같은 색. */
const TREE_META: Record<SkillTree, { nameKey: MessageKey; accent: number }> = {
  firepower: { nameKey: 'lab.tree.firepower', accent: 0xff7a4c },
  survival: { nameKey: 'lab.tree.survival', accent: 0x4cd7ff },
  mobility: { nameKey: 'lab.tree.mobility', accent: 0x8fd94c },
};

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

// --- 레이아웃 상수(디자인 스페이스) ---
//
// 노드 셀에 44px 아이콘이 들어가면서 2열 그리드는 산술적으로 불가능해졌다: 이름 가용 폭이
// 97 → 57px 로 줄어 한글 이름이 읽히지 않고, 셀을 키우려 해도 10행이라 세로 증분이 10배로
// 곱해져 1080 천장을 넘는다. 그래서 **열을 늘려 행을 줄인다**(4열 × 5행 = 티어 1행씩).
// 넓어진 계열 패널(620) 자리를 만들려고 파생 스탯 패널은 화면 하단 가로 띠로 내렸다.
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
 * 패널 안쪽 콘텐츠 상자. 제목·부제·노드·캡스톤을 전부 이 상자 기준으로 잡는다 —
 * 프레임에 붙는 것을 좌표 재유도 없이 구조적으로 막는다(nineSlicePanel §PANEL_INNER_PAD).
 */
const BOX = panelContent(PANEL_W, PANEL_H);
const TITLE_Y = BOX.y;
const TREE_SUB_Y = 94;
const NODE_TOP = 116;
/** 노드 셀: 아이콘 44 + 이름 2줄(13px) + 포인트 배지가 들어가는 최소 크기. */
const NODE_W = 119;
const NODE_H = 95;
const NODE_COLS = 4;
const NODE_ROWS = NODES_PER_TREE / NODE_COLS;
/** 4열이 콘텐츠 상자 폭(500)을 정확히 채우는 간격: (500 - 4×119) / 3 = 8. */
const NODE_GAP_X = Math.floor((BOX.w - NODE_W * NODE_COLS) / (NODE_COLS - 1));
const NODE_GAP_Y = 5;
/** 셀 안 아이콘 자리(정사각). Lane D2 가 여기에 스킬 아이콘 텍스처를 넣는다. */
const NODE_ICON = 44;
const NODE_ICON_Y = 8;
/** 이름 2줄 블록의 상단 y(2줄 × lineHeight 17 = 34 → 88 에서 끝나 하단 여백 7). */
const NODE_NAME_Y = 54;
const CAPSTONE_H = 52;
/** 노드 그리드가 끝나는 y(5행 = 616). */
const NODE_GRID_BOTTOM = NODE_TOP + NODE_ROWS * (NODE_H + NODE_GAP_Y);
/**
 * 캡스톤은 콘텐츠 상자 바닥에 붙인다(628) — 마지막 노드 행과의 간격이 자동으로 남는다.
 * `Math.max` 는 그리드가 커져도 캡스톤이 노드 위로 겹치지 않게 하는 안전장치다.
 */
const CAPSTONE_Y = Math.max(NODE_GRID_BOTTOM + 8, BOX.bottom - CAPSTONE_H);

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

function panelX(col: number): number {
  return PANEL_X0 + col * (PANEL_W + PANEL_GAP);
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
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = '';
  }

  private persist(): void {
    saveProfile(this.profile, this.store);
  }

  // --- 투자 / 리스펙 (DOM 판과 동일 규칙) ----------------------------------

  private invest(index: number): void {
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
      this.hint = t('lab.capstone.needGate', { g: CAPSTONE_GATE });
      this.render();
      return;
    }
    this.invest(index);
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

  // --- 툴팁 ----------------------------------------------------------------

  private showTip(index: number, accent: number, globalX: number, globalY: number): void {
    const node = SKILLS[index];
    if (node === undefined) return;
    const cur = this.profile.skillInvest[index] ?? 0;
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
    SKILL_TREES.forEach((tree, i) => this.renderTreePanel(tree, i));
    this.renderStatsStrip();
    this.renderActions();
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

  private renderTreePanel(tree: SkillTree, col: number): void {
    const meta = TREE_META[tree];
    const px = panelX(col);
    const panel = new Container();
    panel.position.set(px, PANEL_Y);
    this.root.addChild(panel);
    panel.addChild(nineSlicePanel(PANEL_W, PANEL_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));

    const title = new Text({
      resolution: 2,
      text: t(meta.nameKey),
      style: { fontFamily: UI_FONT, fontSize: 26, fontWeight: '800', fill: meta.accent, dropShadow: TEXT_SHADOW },
    });
    title.anchor.set(0.5, 0);
    title.position.set(PANEL_W / 2, TITLE_Y);
    panel.addChild(title);

    const { start } = treeRange(tree);
    let invested = 0;
    for (let j = 0; j < NODES_PER_TREE; j++) invested += this.profile.skillInvest[start + j] ?? 0;
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

    // 20노드 4열 × 5행 그리드 — 한 행이 한 티어다(티어 오름차순 = SKILLS 내 인덱스 순서).
    const cells = rectGridPositions(NODES_PER_TREE, NODE_COLS, NODE_W, NODE_H, NODE_GAP_X, NODE_GAP_Y);
    for (let local = 0; local < NODES_PER_TREE; local++) {
      const index = start + local;
      const at = cells[local];
      if (SKILLS[index] === undefined || at === undefined) continue;
      const cell = this.makeNodeCell(index, meta.accent);
      cell.position.set(BOX.x + at.x, NODE_TOP + at.y);
      panel.addChild(cell);
    }

    panel.addChild(this.makeCapstone(tree, meta.accent));
  }

  /**
   * 노드 카드(119×95): 아이콘 44px 상단 + 이름 2줄(13px) + 포인트 배지. 설명은 hover 툴팁.
   *
   * 세로 구성은 8(상단 여백) → 아이콘 44 → 이름 2줄(34) → 8(하단 여백) = 94 ≈ NODE_H.
   */
  private makeNodeCell(index: number, accent: number): Container {
    const node = SKILLS[index]!;
    const cur = this.profile.skillInvest[index] ?? 0;
    const maxed = cur >= node.maxPoints;
    const canInvest = !maxed && this.profile.skillPoints > 0;

    const cell = new Container();
    const slotTex = this.ui['ui_slot.png'];
    if (slotTex) {
      const bg = new Sprite(slotTex);
      bg.width = NODE_W;
      bg.height = NODE_H;
      cell.addChild(bg);
    } else {
      const g = new Graphics();
      g.roundRect(0, 0, NODE_W, NODE_H, 10).fill({ color: 0x2a2440 }).stroke({ color: 0x000000, width: 2, alpha: 0.5 });
      cell.addChild(g);
    }

    // === [Lane D2] 스킬 아이콘 텍스처 삽입 지점 ===============================
    // 아래 플레이스홀더(둥근 사각 + 계열색 테두리)를 스킬별 아이콘 스프라이트로 교체한다:
    //   const tex = this.ui[skillIconKey(node)];
    //   if (tex) { const sp = new Sprite(tex); sp.width = sp.height = NODE_ICON;
    //              sp.position.set(iconX, NODE_ICON_Y); cell.addChild(sp); }
    // 자리(정사각 NODE_ICON=44)는 이미 확보돼 있으므로 레이아웃 상수는 건드릴 필요가 없다.
    const iconX = Math.round((NODE_W - NODE_ICON) / 2);
    const icon = new Graphics();
    icon
      .roundRect(iconX, NODE_ICON_Y, NODE_ICON, NODE_ICON, 8)
      .fill({ color: 0x000000, alpha: 0.28 })
      .stroke({ color: accent, width: 2, alpha: maxed ? 0.9 : 0.45 });
    cell.addChild(icon);
    // === 삽입 지점 끝 =========================================================

    const name = new Text({
      resolution: 2,
      text: node.name,
      style: {
        fontFamily: UI_FONT,
        fontSize: 13,
        fontWeight: '700',
        fill: maxed ? COLOR.gold : COLOR.cream,
        align: 'center',
        wordWrap: true,
        // 두 줄(13px × lineHeight 17)까지 들어가므로 잘라내지 않고 접는다. 폭은 셀보다
        // 24px 좁게 — 슬롯 텍스처의 베벨에 글자가 닿아 답답해 보이는 것을 막는다
        // (최장 이름 "고기동 스러스터" 96px 가 여기서 두 줄로 접힌다).
        wordWrapWidth: NODE_W - 24,
        breakWords: true,
        lineHeight: 17,
        dropShadow: TEXT_SHADOW,
      },
    });
    name.anchor.set(0.5, 0.5);
    name.position.set(NODE_W / 2, NODE_NAME_Y + 17);
    cell.addChild(name);

    // 포인트 배지: 셀 우상단(아이콘은 가운데 44px 라 겹치지 않는다).
    const pts = new Text({
      resolution: 2,
      text: `${cur}/${node.maxPoints}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 13,
        fontWeight: '800',
        fill: maxed ? COLOR.gold : cur > 0 ? accent : COLOR.muted,
        dropShadow: TEXT_SHADOW,
      },
    });
    pts.anchor.set(1, 0);
    pts.position.set(NODE_W - 8, 7);
    cell.addChild(pts);

    // 투자 여력이 없으면(포인트 0 또는 만렙) 흐리게 — 클릭은 살려 안내 힌트를 띄운다.
    if (!canInvest) cell.alpha = maxed ? 0.85 : 0.55;

    cell.eventMode = 'static';
    cell.cursor = canInvest ? 'pointer' : 'default';
    cell.on('pointertap', () => this.invest(index));
    cell.on('pointerover', (e) => this.showTip(index, accent, e.global.x, e.global.y));
    cell.on('pointermove', (e) => this.moveTip(e.global.x, e.global.y));
    cell.on('pointerout', () => this.tooltip.hide());
    return cell;
  }

  /** 캡스톤: 해금이면 노란 버튼, 잠기면 나무 버튼 + 게이트 진행도. */
  private makeCapstone(tree: SkillTree, accent: number): Container {
    const index = capstoneIndex(tree);
    const node = SKILLS[index]!;
    const cur = this.profile.skillInvest[index] ?? 0;
    const unlocked = capstoneUnlocked(this.profile.skillInvest, tree);
    const gateProgress = treeBaseInvested(this.profile.skillInvest, tree);

    const label = unlocked
      ? `★ ${node.name}   ${cur}/${node.maxPoints}`
      : `${node.name}   ${gateProgress}/${CAPSTONE_GATE}`;
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
    btn.container.position.set(BOX.x, CAPSTONE_Y);
    btn.container.on('pointerover', (e) => this.showTip(index, unlocked ? COLOR.gold : accent, e.global.x, e.global.y));
    btn.container.on('pointermove', (e) => this.moveTip(e.global.x, e.global.y));
    btn.container.on('pointerout', () => this.tooltip.hide());
    if (!unlocked) btn.container.alpha = 0.7;
    return btn.container;
  }

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

    const sums = computeSkillStats(this.profile.skillInvest);
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
