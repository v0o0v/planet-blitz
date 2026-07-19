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

import { Container, Graphics, NineSliceSprite, Text } from 'pixi.js';
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
const BANNER_W = 620;
const BANNER_H = 72;
const BANNER_Y = 12;
const CHIP_W = 190;
const CHIP_H = 52;
const SUB_Y = 88;
const PANEL_Y = 118;
const PANEL_H = 776;
const PANEL_W = 461;
const PANEL_GAP = 14;
const PANEL_X0 = Math.round((DESIGN_WIDTH - (PANEL_W * 4 + PANEL_GAP * 3)) / 2);
/**
 * 패널 안쪽 콘텐츠 상자. 제목·부제·노드·캡스톤·스탯 행을 전부 이 상자 기준으로 잡는다 —
 * 프레임에 붙는 것을 좌표 재유도 없이 구조적으로 막는다(nineSlicePanel §PANEL_INNER_PAD).
 */
const BOX = panelContent(PANEL_W, PANEL_H);
const TITLE_Y = BOX.y;
const TREE_SUB_Y = 100;
const NODE_TOP = 130;
const NODE_H = 44;
const NODE_STEP = 52;
const NODE_ROWS = NODES_PER_TREE / 2;
const NODE_W = Math.floor((BOX.w - 11) / 2);
const NODE_GAP_X = BOX.w - NODE_W * 2;
const CAPSTONE_H = 56;
/** 노드 그리드가 끝나는 y(10행 = 650). */
const NODE_GRID_BOTTOM = NODE_TOP + NODE_ROWS * NODE_STEP;
/**
 * 캡스톤은 콘텐츠 상자 바닥에 붙인다(660) — 마지막 노드 행과의 간격이 자동으로 남는다.
 * `Math.max` 는 그리드가 커져도 캡스톤이 노드 위로 겹치지 않게 하는 안전장치다.
 */
const CAPSTONE_Y = Math.max(NODE_GRID_BOTTOM + 10, BOX.bottom - CAPSTONE_H);
const STAT_STEP = 34;
const RESPEC_W = 420;
const RESPEC_H = 60;
const RESPEC_Y = 908;

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
    this.renderStatsPanel();
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
      style: { fontFamily: UI_FONT, fontSize: 20, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
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
      style: { fontFamily: UI_FONT, fontSize: 28, fontWeight: '800', fill: meta.accent, dropShadow: TEXT_SHADOW },
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
        fontSize: 14,
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

    // 20노드 2열 그리드(티어 오름차순 = SKILLS 내 인덱스 순서).
    for (let local = 0; local < NODES_PER_TREE; local++) {
      const index = start + local;
      if (SKILLS[index] === undefined) continue;
      const cell = this.makeNodeCell(index, meta.accent);
      cell.position.set(BOX.x + (local % 2) * (NODE_W + NODE_GAP_X), NODE_TOP + Math.floor(local / 2) * NODE_STEP);
      panel.addChild(cell);
    }

    panel.addChild(this.makeCapstone(tree, meta.accent));
  }

  /** 노드 카드: 칩 9-slice + 이름 + 투자량. 설명은 hover 툴팁. */
  private makeNodeCell(index: number, accent: number): Container {
    const node = SKILLS[index]!;
    const cur = this.profile.skillInvest[index] ?? 0;
    const maxed = cur >= node.maxPoints;
    const canInvest = !maxed && this.profile.skillPoints > 0;

    const cell = new Container();
    const chipTex = this.ui['ui_chip.png'];
    if (chipTex) {
      const bg = new NineSliceSprite({ texture: chipTex, leftWidth: 24, topHeight: 0, rightWidth: 24, bottomHeight: 0 });
      bg.width = NODE_W;
      bg.height = NODE_H;
      cell.addChild(bg);
    } else {
      const g = new Graphics();
      g.roundRect(0, 0, NODE_W, NODE_H, 10).fill({ color: 0x2a2440 }).stroke({ color: 0x000000, width: 2, alpha: 0.5 });
      cell.addChild(g);
    }

    const name = new Text({
      resolution: 2,
      text: node.name,
      style: {
        fontFamily: UI_FONT,
        fontSize: 15,
        fontWeight: '700',
        fill: maxed ? COLOR.gold : COLOR.cream,
        dropShadow: TEXT_SHADOW,
      },
    });
    name.anchor.set(0, 0.5);
    name.position.set(16, NODE_H / 2);
    // 긴 이름("고기동 스러스터")이 우측 포인트 수치와 붙지 않게 가로만 축소해 맞춘다
    // (줄바꿈은 44px 카드에 안 들어가고, 잘라내면 어떤 노드인지 알 수 없다).
    const maxNameW = NODE_W - 16 - 52;
    if (name.width > maxNameW) name.scale.x = maxNameW / name.width;
    cell.addChild(name);

    const pts = new Text({
      resolution: 2,
      text: `${cur}/${node.maxPoints}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 15,
        fontWeight: '800',
        fill: maxed ? COLOR.gold : cur > 0 ? accent : COLOR.muted,
        dropShadow: TEXT_SHADOW,
      },
    });
    pts.anchor.set(1, 0.5);
    pts.position.set(NODE_W - 16, NODE_H / 2);
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

  private renderStatsPanel(): void {
    const px = panelX(3);
    const panel = new Container();
    panel.position.set(px, PANEL_Y);
    this.root.addChild(panel);
    panel.addChild(nineSlicePanel(PANEL_W, PANEL_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));

    const title = new Text({
      resolution: 2,
      text: t('lab.derivedStats'),
      style: {
        fontFamily: UI_FONT,
        fontSize: 22,
        fontWeight: '800',
        fill: COLOR.cream,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: BOX.w,
        dropShadow: TEXT_SHADOW,
      },
    });
    title.anchor.set(0.5, 0);
    title.position.set(PANEL_W / 2, TITLE_Y);
    panel.addChild(title);

    const sums = computeSkillStats(this.profile.skillInvest);
    let y = NODE_TOP;
    let shown = 0;
    for (const [key, labelKey, isPct] of PREVIEW_ROWS) {
      const v = sums[key];
      if (v === 0) continue;
      const k = new Text({
        resolution: 2,
        text: t(labelKey),
        style: { fontFamily: UI_FONT, fontSize: 18, fill: COLOR.cream, dropShadow: TEXT_SHADOW },
      });
      k.position.set(BOX.x, y);
      panel.addChild(k);
      // 시너지 증폭은 분수를 만든다(예: 59.072) — 소수 1자리로 반올림해 표시 노이즈를 줄인다.
      const shownV = Number.isInteger(v) ? String(v) : v.toFixed(1);
      const val = new Text({
        resolution: 2,
        text: isPct ? `+${shownV}%` : `+${shownV}`,
        style: { fontFamily: UI_FONT, fontSize: 18, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
      });
      val.anchor.set(1, 0);
      val.position.set(BOX.right, y);
      panel.addChild(val);
      y += STAT_STEP;
      shown++;
    }

    if (shown === 0) {
      const empty = new Text({
        resolution: 2,
        text: t('lab.noStats'),
        style: {
          fontFamily: UI_FONT,
          fontSize: 17,
          fill: COLOR.muted,
          align: 'center',
          wordWrap: true,
          wordWrapWidth: BOX.w,
          dropShadow: TEXT_SHADOW,
        },
      });
      empty.anchor.set(0.5, 0);
      empty.position.set(PANEL_W / 2, y);
      panel.addChild(empty);
      y += STAT_STEP * 2;
    }

    // 시너지 안내는 스탯 행 아래. 12행 전부 나와도(y=538) 콘텐츠 하한(BOX.bottom) 안에 든다.
    const syn = new Text({
      resolution: 2,
      text: t('lab.synergy'),
      style: {
        fontFamily: UI_FONT,
        fontSize: 15,
        fill: COLOR.muted,
        wordWrap: true,
        wordWrapWidth: BOX.w,
        dropShadow: TEXT_SHADOW,
      },
    });
    syn.position.set(BOX.x, y + 20);
    panel.addChild(syn);
  }

  private renderActions(): void {
    const cost = respecCost(this.profile);
    const respec = new PixiButton({
      texture: this.ui['ui_btn_red.png'],
      fallbackColor: 0x9a2a2a,
      width: RESPEC_W,
      height: RESPEC_H,
      fontSize: 22,
      label: t('lab.respecBtn', { n: cost }),
      onClick: () => this.respec(),
    });
    respec.container.position.set((DESIGN_WIDTH - RESPEC_W) / 2, RESPEC_Y);
    this.root.addChild(respec.container);
    if (totalInvested(this.profile) === 0) respec.setEnabled(false);
  }

  private renderHint(): void {
    if (this.hint === '') return;
    const h = new Text({
      resolution: 2,
      text: this.hint,
      style: { fontFamily: UI_FONT, fontSize: 20, fontWeight: '700', fill: 0xff9a7a, dropShadow: TEXT_SHADOW },
    });
    h.anchor.set(0.5, 1);
    h.position.set(DESIGN_WIDTH / 2, DESIGN_HEIGHT - 12);
    this.root.addChild(h);
  }
}
