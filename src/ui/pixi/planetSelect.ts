/**
 * 성계 지도 / 행성 선택 화면 (Pixi 카툰나무풍 리스킨 — `.omc/plans/cartoonwood-rollout.md` #4).
 *
 * `src/ui/planetSelect.ts` 의 DOM `PlanetSelect` 와 기능 1:1 동등하게 출격 전 화면을 Pixi
 * 캔버스(1920×1080 디자인 스페이스)로 재구현한다: 행성 카드 선택, 티어(정찰/교전/섬멸) 선택
 * 과 레벨 잠금(`canEnterTier`), 시드가 굴린 변칙 제안 수락/거부, 출격/장비 정비/기지 복귀.
 * 공개 인터페이스(`show`/`hide`/`visible`)와 `LaunchSelection` 은 DOM 판 그대로라 main.ts 는
 * 생성자 한 줄만 바뀐다(롤아웃 공통 규칙 2). DOM 클래스는 회귀 대비로 남긴다.
 *
 * 앞선 3화면(기지 맵·연구소·정제소)과 달리 **카드형 레이아웃**이다 — 카드 골격은 기지 맵
 * 건물 타일과 겹쳐 `./card.ts` 로 승격했다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다. 변칙 종류 상수(숫자)만 읽는다.
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { PLANETS, TIERS, planetById, type PlanetMeta } from '../../../data/planets.js';
import { canEnterTier, ANNIHILATION_UNLOCK_LEVEL } from '../../../data/waves.js';
import { ANOMALY_GRAVITY, ANOMALY_SWARM, ANOMALY_NEBULA, ANOMALY_NONE } from '../../sim/anomaly.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import type { LaunchSelection } from '../planetSelect.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { panelContent, PANEL_BORDER, nineSlicePanel } from './nineSlicePanel.js';
import { makePanelCard } from './card.js';
import { PixiButton } from './button.js';
import { makeBanner } from './titleBar.js';
import { stripEmoji } from './text.js';

export type { LaunchSelection };

/** 변칙 종류 → i18n 키(DOM 판과 동일 테이블 — 렌더 전용). */
const ANOMALY_LABEL: Record<number, { nameKey: MessageKey; descKey: MessageKey }> = {
  [ANOMALY_GRAVITY]: { nameKey: 'anomaly.gravity.name', descKey: 'anomaly.gravity.desc' },
  [ANOMALY_SWARM]: { nameKey: 'anomaly.swarm.name', descKey: 'anomaly.swarm.desc' },
  [ANOMALY_NEBULA]: { nameKey: 'anomaly.nebula.name', descKey: 'anomaly.nebula.desc' },
};

/** 섬멸 티어 해금 레벨(잠금 사유 문구에 노출). */
const ANNIHILATION_LEVEL = ANNIHILATION_UNLOCK_LEVEL;

/** 변칙 패널 강조색(DOM 판 보라 계열 유지 — "위험한 선택" 시각 언어). */
const ANOMALY_ACCENT = 0xe0a8ff;
const ANOMALY_DESC_COLOR = 0xc9b6d6;

// --- 레이아웃 상수(디자인 스페이스) ---
/** 배너 폭은 제목("성계 지도") 길이에 맞춘다 — 짧은 제목에 넓은 배너는 허전하다(정제소 #3 과 동일). */
const BANNER_W = 440;
const BANNER_H = 72;
const BANNER_Y = 12;
const SUB_Y = 94;

// 행성 카드 행.
const CARD_Y = 126;
/** 콘텐츠(오브 → 이름 → 부제 2줄)가 콘텐츠 상자 바닥에 딱 맞는 높이. */
const CARD_H = 364;
const CARD_MAX_W = 460;
const CARD_GAP = 32;
/** 카드 행이 쓸 수 있는 최대 폭(좌우 48px 여백). */
const CARD_ROW_MAX_W = 1824;
/** 행성 오브 지름. 자산이 64px 이므로 ×2 정수 배율(픽셀아트가 뭉개지지 않는다). */
const ORB_D = 128;
const CARD_NAME_Y = 212;
const CARD_SUB_Y = 254;

// 하단 패널 행(티어 · 변칙). 두 패널의 콘텐츠가 상자(60..220)를 꽉 채우는 높이다.
const LOW_Y = 546;
const LOW_H = 280;
const LOW_GAP = 24;
const ANOM_W = 740;
const TIER_W_WITH_ANOM = CARD_ROW_MAX_W - ANOM_W - LOW_GAP;
const TIER_W_ALONE = 1200;
const TIER_BTN_W = 280;
const TIER_BTN_H = 64;
const TIER_BTN_GAP = 22;
const TIER_BTN_Y = 108;
const TIER_DESC_Y = 186;
const ANOM_DESC_Y = 104;
const ANOM_BTN_W = 290;
const ANOM_BTN_H = 62;
const ANOM_BTN_GAP = 20;
const ANOM_BTN_Y = 146;

// 하단 액션.
const LAUNCH_W = 460;
const LAUNCH_H = 84;
const LAUNCH_Y = 872;
const SIDE_W = 240;
const SIDE_H = 64;
const SIDE_GAP = 24;
const SIDE_Y = LAUNCH_Y + (LAUNCH_H - SIDE_H) / 2;
const META_Y = 1000;

/** 카드 n 장이 한 행에 들어가도록 카드 폭을 정한다(행성이 늘어도 삐져나가지 않게). */
function cardWidth(n: number): number {
  if (n <= 0) return CARD_MAX_W;
  return Math.min(CARD_MAX_W, Math.floor((CARD_ROW_MAX_W - CARD_GAP * (n - 1)) / n));
}

/** '#rrggbb' → Pixi 정수색. 형식이 어긋나면 중립 회청색으로 폴백한다. */
function hexColor(css: string): number {
  const n = Number.parseInt(css.replace('#', ''), 16);
  return Number.isNaN(n) ? 0x8896b8 : n;
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
 * 행성 오브 **폴백**. 실 자산(`ui_planet_<id>.png`)이 없을 때만 쓴다. DOM 판의
 * `radial-gradient(circle at 35% 30%, accent, #05060a)` 를 동심원 레이어로 근사한다
 * (Pixi Graphics 에는 방사 그라데이션이 없다). 하이라이트 중심을 좌상단으로 밀어 구체감을 낸다.
 */
function makeOrb(diameter: number, accent: number): Graphics {
  const g = new Graphics();
  const r = diameter / 2;
  // 바깥 glow(DOM box-shadow 0 0 22px currentColor).
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

export class PlanetSelectScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private ui: UiTextures = {};
  private planet = 0;
  private tier = 0;
  private anomalyKind = ANOMALY_NONE;
  private anomalyAccepted = false;
  /** 활성 기체 레벨 — 섬멸 티어 게이트(canEnterTier). */
  private level = 1;
  private meta = '';
  private onLaunch: ((sel: LaunchSelection) => void) | null = null;
  private onInventory: (() => void) | null = null;
  private onBack: (() => void) | null = null;

  constructor(stage: Container) {
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    // UI 킷 텍스처 비동기 로드 — 완료 후 열려 있으면 실 아트로 다시 그린다(그 전엔 폴백).
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      if (this.root.visible) this.render();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /**
   * 다음 런의 성계 지도를 연다(DOM 판과 동일 시그니처).
   * @param opts.anomalyOffered 시드가 굴린 변칙 종류(ANOMALY_NONE = 제안 없음).
   * @param opts.meta 하단 상태 줄(크레딧 / 기체 레벨 등).
   */
  show(opts: {
    anomalyOffered: number;
    meta: string;
    /** 활성 기체 레벨(섬멸 티어 게이트). 생략 시 1. */
    level?: number;
    onLaunch: (sel: LaunchSelection) => void;
    onInventory: () => void;
    /** 기지 맵 복귀(왕복 동선). */
    onBack?: () => void;
  }): void {
    this.anomalyKind = opts.anomalyOffered;
    this.anomalyAccepted = false;
    this.level = opts.level ?? 1;
    // 레벨이 내려갔으면 선택 티어를 유효 범위로 되돌린다(DOM 판과 동일).
    if (!canEnterTier(this.tier, this.level)) this.tier = 0;
    this.meta = opts.meta;
    this.onLaunch = opts.onLaunch;
    this.onInventory = opts.onInventory;
    this.onBack = opts.onBack ?? null;
    this.render();
    this.root.visible = true;
    // DOM HUD 는 런 전용 — 캔버스 메타 화면 위에 떠 보이므로 숨긴다(스킬 §7).
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = 'hidden';
  }

  hide(): void {
    this.root.visible = false;
    this.onLaunch = null;
    this.onInventory = null;
    this.onBack = null;
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = '';
  }

  // --- 선택 / 출격 (DOM 판과 동일 규칙) ------------------------------------

  private selectPlanet(id: number): void {
    this.planet = id;
    this.render();
  }

  private selectTier(id: number): void {
    if (!canEnterTier(id, this.level)) return; // 잠금 티어: 선택 유지
    this.tier = id;
    this.render();
  }

  private setAnomaly(accepted: boolean): void {
    this.anomalyAccepted = accepted;
    this.render();
  }

  private launch(): void {
    const cb = this.onLaunch;
    const sel: LaunchSelection = {
      planet: this.planet,
      tier: this.tier,
      anomalyAccepted: this.anomalyKind !== ANOMALY_NONE && this.anomalyAccepted,
    };
    this.hide();
    cb?.(sel);
  }

  private back(): void {
    const cb = this.onBack;
    this.hide();
    cb?.();
  }

  // --- 렌더 ----------------------------------------------------------------

  private render(): void {
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }

    // 배경(불투명 — 뒤 아레나를 가린다). 별 장식 금지(세트 팔레트 확정).
    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static'; // 뒤로 이벤트가 새지 않게 막는다.
    this.root.addChild(bg);

    this.renderTitleBar();
    this.renderPlanetCards();
    this.renderLowPanels();
    this.renderActions();
    this.renderMeta();
  }

  private renderTitleBar(): void {
    const banner = makeBanner(BANNER_W, BANNER_H, t('planet.title'), this.ui['ui_banner.png']);
    banner.position.set((DESIGN_WIDTH - BANNER_W) / 2, BANNER_Y);
    this.root.addChild(banner);

    const sub = new Text({
      resolution: 2,
      text: t('planet.sub'),
      style: { fontFamily: UI_FONT, fontSize: 20, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    sub.anchor.set(0.5, 0);
    sub.position.set(DESIGN_WIDTH / 2, SUB_Y);
    this.root.addChild(sub);
  }

  private renderPlanetCards(): void {
    const n = PLANETS.length;
    const w = cardWidth(n);
    const rowW = n * w + (n - 1) * CARD_GAP;
    const x0 = (DESIGN_WIDTH - rowW) / 2;
    PLANETS.forEach((p, i) => {
      const card = this.makePlanetCard(p, w);
      card.position.set(x0 + i * (w + CARD_GAP), CARD_Y);
      this.root.addChild(card);
    });
  }

  private makePlanetCard(p: PlanetMeta, w: number): Container {
    const selected = p.id === this.planet;
    const accent = hexColor(p.accent);
    const card = makePanelCard({
      width: w,
      height: CARD_H,
      texture: this.ui['ui_panel.png'],
      selected,
      onClick: () => this.selectPlanet(p.id),
    });
    // 콘텐츠는 전부 이 상자 안에만 — 프레임 침범도, 테두리에 붙는 것도 여기서 막힌다.
    const box = panelContent(w, CARD_H);

    // 실 자산(PixelLab 생성 64px 행성)이 있으면 ×2 nearest 로 확대해 쓰고, 없으면 코드 오브.
    const orbTex = this.ui[`ui_planet_${p.id}.png`];
    const orb = orbTex ? new Sprite(orbTex) : makeOrb(ORB_D, accent);
    if (orbTex) {
      orb.width = ORB_D;
      orb.height = ORB_D;
    }
    orb.position.set((w - ORB_D) / 2, box.y);
    card.addChild(orb);

    const name = new Text({
      resolution: 2,
      text: p.name,
      style: {
        fontFamily: UI_FONT,
        fontSize: 30,
        fontWeight: '800',
        fill: selected ? COLOR.gold : COLOR.cream,
        dropShadow: TEXT_SHADOW,
      },
    });
    name.anchor.set(0.5, 0);
    name.position.set(w / 2, CARD_NAME_Y);
    card.addChild(name);

    const sub = new Text({
      resolution: 2,
      text: p.subtitle,
      style: {
        fontFamily: UI_FONT,
        fontSize: 18,
        fill: COLOR.muted,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: box.w,
        dropShadow: TEXT_SHADOW,
      },
    });
    sub.anchor.set(0.5, 0);
    sub.position.set(w / 2, CARD_SUB_Y);
    card.addChild(sub);

    return card;
  }

  /** 하단 패널 행: 티어(항상) + 변칙 제안(시드가 굴렸을 때만). */
  private renderLowPanels(): void {
    const hasAnomaly = this.anomalyKind !== ANOMALY_NONE;
    const tierW = hasAnomaly ? TIER_W_WITH_ANOM : TIER_W_ALONE;
    const rowW = hasAnomaly ? tierW + LOW_GAP + ANOM_W : tierW;
    const x0 = (DESIGN_WIDTH - rowW) / 2;

    const tier = this.makeTierPanel(tierW);
    tier.position.set(x0, LOW_Y);
    this.root.addChild(tier);

    if (hasAnomaly) {
      const anomaly = this.makeAnomalyPanel();
      anomaly.position.set(x0 + tierW + LOW_GAP, LOW_Y);
      this.root.addChild(anomaly);
    }
  }

  /** 패널 제목 — top = 콘텐츠 상자 top(스킬 §4, 제목이 나무 테두리에 붙던 결함 재발 방지). */
  private panelTitle(parent: Container, w: number, text: string, color: number = COLOR.cream): void {
    const box = panelContent(w, LOW_H);
    const title = new Text({
      resolution: 2,
      text,
      style: {
        fontFamily: UI_FONT,
        fontSize: 26,
        fontWeight: '800',
        fill: color,
        wordWrap: true,
        wordWrapWidth: box.w,
        dropShadow: TEXT_SHADOW,
      },
    });
    title.position.set(box.x, box.y);
    parent.addChild(title);
  }

  /**
   * 선택형 버튼 한 개. 선택된 것은 노란 버튼(밝은 바탕 → 진한 라벨), 나머지는 나무 버튼.
   * 롤아웃 #1~#3 과 같은 규칙이다(노란 버튼에 흰 라벨은 묻힌다).
   */
  private choiceButton(opts: {
    label: string;
    width: number;
    height: number;
    selected: boolean;
    onClick: () => void;
    fontSize?: number;
  }): PixiButton {
    return new PixiButton({
      texture: this.ui[opts.selected ? 'ui_btn_yellow.png' : 'ui_btn_wood.png'],
      fallbackColor: opts.selected ? 0x9a7a2a : 0x4a3a24,
      width: opts.width,
      height: opts.height,
      fontSize: opts.fontSize ?? 24,
      ...(opts.selected ? { labelColor: COLOR.darkLabel } : {}),
      label: opts.label,
      onClick: opts.onClick,
    });
  }

  private makeTierPanel(w: number): Container {
    const panel = new Container();
    panel.addChild(nineSlicePanel(w, LOW_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));
    const box = panelContent(w, LOW_H);
    this.panelTitle(panel, w, t('planet.tierLabel'));

    const n = TIERS.length;
    const rowW = n * TIER_BTN_W + (n - 1) * TIER_BTN_GAP;
    const bx = box.x + Math.floor((box.w - rowW) / 2);
    TIERS.forEach((tm, i) => {
      const unlocked = canEnterTier(tm.id, this.level);
      const btn = this.choiceButton({
        label: tm.name,
        width: TIER_BTN_W,
        height: TIER_BTN_H,
        selected: unlocked && tm.id === this.tier,
        onClick: () => this.selectTier(tm.id),
      });
      btn.container.position.set(bx + i * (TIER_BTN_W + TIER_BTN_GAP), TIER_BTN_Y);
      panel.addChild(btn.container);
      if (!unlocked) {
        // 잠금 티어: 클릭 불가 + 자물쇠 아이콘(DOM 판 pixelIcon 과 같은 자산).
        btn.setEnabled(false);
        const lockTex = this.ui['ui_icon_lock.png'];
        if (lockTex) {
          const lockSize = 28;
          const lock = new Sprite(lockTex);
          lock.width = lockSize;
          lock.height = lockSize;
          lock.position.set(16, (TIER_BTN_H - lockSize) / 2);
          btn.container.addChild(lock);
        }
      }
    });

    const selTier = TIERS.find((tm) => tm.id === this.tier);
    const lockedTier = TIERS.find((tm) => !canEnterTier(tm.id, this.level));
    const descText =
      lockedTier !== undefined
        ? `${selTier?.desc ?? ''}   ·   ${t('planet.lock', { tier: lockedTier.name, lvl: ANNIHILATION_LEVEL, cur: this.level })}`
        : (selTier?.desc ?? '');
    const desc = new Text({
      resolution: 2,
      // 잠금 문구의 🔒 는 캔버스에서 두부로 떨어진다(자물쇠는 버튼 아이콘이 이미 보여준다).
      text: stripEmoji(descText),
      style: { fontFamily: UI_FONT, fontSize: 19, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    desc.anchor.set(0.5, 0);
    // 한 줄 고정: 줄바꿈을 허용하면 로케일에 따라 두 번째 줄이 콘텐츠 상자 바닥을 넘는다.
    // 넘칠 때는 가로만 줄인다(잘라내면 무슨 티어인지 모른다 — 정제소 어픽스 행과 같은 처리).
    if (desc.width > box.w) desc.scale.x = box.w / desc.width;
    desc.position.set(w / 2, TIER_DESC_Y);
    panel.addChild(desc);

    return panel;
  }

  private makeAnomalyPanel(): Container {
    const panel = new Container();
    panel.addChild(nineSlicePanel(ANOM_W, LOW_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));
    const box = panelContent(ANOM_W, LOW_H);

    const info = ANOMALY_LABEL[this.anomalyKind];
    const anomalyName = info !== undefined ? t(info.nameKey) : t('planet.anomaly.unknown');
    // 제목의 ⚠ 는 캔버스에서 두부 글리프로 떨어진다 — "변칙 경보" 문구가 이미 경고다.
    this.panelTitle(panel, ANOM_W, stripEmoji(t('planet.anomaly.title', { name: anomalyName })), ANOMALY_ACCENT);

    const desc = new Text({
      resolution: 2,
      text: info !== undefined ? t(info.descKey) : '',
      style: {
        fontFamily: UI_FONT,
        fontSize: 18,
        fill: ANOMALY_DESC_COLOR,
        wordWrap: true,
        wordWrapWidth: box.w,
        dropShadow: TEXT_SHADOW,
      },
    });
    desc.position.set(box.x, ANOM_DESC_Y);
    panel.addChild(desc);

    const rowW = ANOM_BTN_W * 2 + ANOM_BTN_GAP;
    const bx = box.x + Math.floor((box.w - rowW) / 2);
    const accept = this.choiceButton({
      label: t('planet.anomaly.accept'),
      width: ANOM_BTN_W,
      height: ANOM_BTN_H,
      selected: this.anomalyAccepted,
      onClick: () => this.setAnomaly(true),
    });
    accept.container.position.set(bx, ANOM_BTN_Y);
    panel.addChild(accept.container);

    const reject = this.choiceButton({
      label: t('planet.anomaly.reject'),
      width: ANOM_BTN_W,
      height: ANOM_BTN_H,
      selected: !this.anomalyAccepted,
      onClick: () => this.setAnomaly(false),
    });
    reject.container.position.set(bx + ANOM_BTN_W + ANOM_BTN_GAP, ANOM_BTN_Y);
    panel.addChild(reject.container);

    return panel;
  }

  private renderActions(): void {
    const launchX = (DESIGN_WIDTH - LAUNCH_W) / 2;

    if (this.onBack !== null) {
      const back = new PixiButton({
        texture: this.ui['ui_btn_wood.png'],
        fallbackColor: 0x4a3a24,
        width: SIDE_W,
        height: SIDE_H,
        fontSize: 22,
        label: t('planet.back'),
        onClick: () => this.back(),
      });
      back.container.position.set(launchX - SIDE_GAP - SIDE_W, SIDE_Y);
      this.root.addChild(back.container);
    }

    const inv = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: SIDE_W,
      height: SIDE_H,
      fontSize: 22,
      // '🛠 장비 정비' 의 컬러 이모지는 캔버스에서 두부가 된다.
      label: stripEmoji(t('planet.inventory')),
      onClick: () => this.onInventory?.(),
    });
    inv.container.position.set(launchX + LAUNCH_W + SIDE_GAP, SIDE_Y);
    this.root.addChild(inv.container);

    const launch = new PixiButton({
      texture: this.ui['ui_btn_yellow.png'],
      fallbackColor: 0x9a7a2a,
      width: LAUNCH_W,
      height: LAUNCH_H,
      fontSize: 30,
      // 노란 버튼은 바탕이 밝아 흰 라벨이 묻힌다(롤아웃 #1~#3 과 동일 처리).
      labelColor: COLOR.darkLabel,
      label: t('planet.launch', { name: planetById(this.planet).name }),
      onClick: () => this.launch(),
    });
    launch.container.position.set(launchX, LAUNCH_Y);
    this.root.addChild(launch.container);
  }

  private renderMeta(): void {
    const meta = new Text({
      resolution: 2,
      text: this.meta,
      style: { fontFamily: UI_FONT, fontSize: 20, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    meta.anchor.set(0.5, 0);
    meta.position.set(DESIGN_WIDTH / 2, META_Y);
    this.root.addChild(meta);
  }
}
