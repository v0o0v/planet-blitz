/**
 * 기지 맵 허브 화면 (Pixi 카툰나무풍 리스킨 — `.omc/plans/cartoonwood-rollout.md` #1).
 *
 * `src/ui/baseMap.ts` 의 DOM `BaseMap` 과 기능 1:1 동등하게 허브를 Pixi 캔버스(1920×1080
 * 디자인 스페이스, src/render/app.ts)로 재구현한다: 건물 5종 타일(해금/잠금 사유), 진입
 * 콜백, 출격 버튼, 재화·레벨 메타 줄, i18n. 공개 인터페이스(show/hide/visible)와 콜백
 * 타입은 DOM 판과 동일해 main.ts 호출부는 그대로다(롤아웃 공통 규칙 2).
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다. Profile 은 읽기만 한다.
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { computeUnlocks, activeShip, RESEARCH_UNLOCK_LEVEL, type Profile } from '../../save/profile.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { panelContent } from './nineSlicePanel.js';
import { makePanelCard, panelDim } from './card.js';
import { PixiButton } from './button.js';
import { makeBanner, makeCurrencyChip } from './titleBar.js';
import type { BaseMapCallbacks } from '../baseMap.js';

/** 건물 타일 정의. 아이콘은 UI 킷 텍스처 basename 으로 참조한다. */
interface Building {
  key: 'hangar' | 'research' | 'refinery' | 'defense' | 'control' | 'archive' | 'commission';
  nameKey: MessageKey;
  descKey: MessageKey;
  tex: string;
  /** 잠금/폴백 시 쓰는 강조색(DOM 판과 동일 값). */
  accent: number;
}

const BUILDINGS: readonly Building[] = [
  { key: 'hangar', nameKey: 'base.bld.hangar.name', descKey: 'base.bld.hangar.desc', tex: 'ui_bld_hangar.png', accent: 0x4cd7ff },
  { key: 'research', nameKey: 'base.bld.research.name', descKey: 'base.bld.research.desc', tex: 'ui_bld_research.png', accent: 0xff7a4c },
  { key: 'refinery', nameKey: 'base.bld.refinery.name', descKey: 'base.bld.refinery.desc', tex: 'ui_bld_refinery.png', accent: 0xffd24c },
  { key: 'defense', nameKey: 'base.bld.defense.name', descKey: 'base.bld.defense.desc', tex: 'ui_bld_defense.png', accent: 0x8fd94c },
  { key: 'control', nameKey: 'base.bld.control.name', descKey: 'base.bld.control.desc', tex: 'ui_bld_control.png', accent: 0xc86aff },
  // 기록 보관소(스토리 시스템 Phase C2) — 상시 개방 서사 열람 시설. 아이콘 미도착 시 accent 폴백.
  { key: 'archive', nameKey: 'base.bld.archive.name', descKey: 'base.bld.archive.desc', tex: 'ui_bld_archive.png', accent: 0xffb24c },
  // 지시 수신소(의뢰서 시스템 Phase E) — 상시 개방(성계 지도와 별개의 PvE 출격구, CONTEXT.md
  // "지시 수신소" 절). 아이콘 미도착이라 `ui_bld_commission.png` 는 KNOWN_MISSING 등재(accent 폴백).
  { key: 'commission', nameKey: 'base.bld.commission.name', descKey: 'base.bld.commission.desc', tex: 'ui_bld_commission.png', accent: 0x7affea },
];

// --- 레이아웃 상수(디자인 스페이스). 목업 좌표를 그대로 옮긴다 — 재유도 금지(스킬 §2-3). ---
const BANNER_W = 620;
const BANNER_H = 76;
const BANNER_Y = 16;
const CHIP_W = 190;
const CHIP_H = 52;
const SUB_Y = 100;
// ⚠️ **넘침 함정(실측)**: 예전 `TILE_W=470` 은 6건물(3+3)까지만 맞았다. 7번째(지시 수신소)를
// 넣으면 `tilePosition` 의 옛 "1행 최대 3칸 고정" 분배가 2행에 4칸을 몰아 `4×470+3×36=1988px`
// 로 `DESIGN_WIDTH`(1920)를 넘어 화면 밖으로 잘렸다. 폭을 줄이고(430) 행 분배를 **균등
// 반반**(`Math.ceil(n/2)`/나머지)으로 바꿔 두 문제를 함께 없앤다 — 6건물(3+3)은 산술이 그대로라
// 회귀가 없고, 7건물(4+3)도 `4×430+3×36=1828 < 1920` 로 여유가 남는다.
export const TILE_W = 430;
const TILE_H = 340;
const TILE_GAP = 36;
const ROW1_Y = 134;
const ROW2_Y = ROW1_Y + TILE_H + 30;
/**
 * 타일 안쪽 콘텐츠 상자. 아이콘·이름·설명을 전부 이 상자 안에 둔다 — 프레임 침범도,
 * 테두리에 붙는 것도 막는다(nineSlicePanel §PANEL_INNER_PAD).
 */
const BOX = panelContent(TILE_W, TILE_H);
const ICON_SIZE = 144;
const ICON_Y = BOX.y;
const NAME_Y = 210;
const DESC_Y = 250;
const LAUNCH_W = 460;
const LAUNCH_H = 84;
const LAUNCH_Y = 872;
const META_Y = 996;

/**
 * 2행 분배(각 행 칸 수). **균등 반반**이 계약이다 — 남는 건물을 전부 둘째 행에 몰면(옛
 * "1행 최대 3칸 고정") 건물 수가 홀수로 늘 때 둘째 행이 더 커져 넘침이 재발한다(실측: 7건물이
 * 4칸을 2행에 몰아 `DESIGN_WIDTH` 초과). 반반이면 첫 행이 항상 같거나 하나 많다.
 */
export function rowSplit(n: number): readonly [number, number] {
  const row0 = Math.ceil(n / 2);
  return [row0, n - row0];
}

/**
 * i 번째 건물 타일의 좌상단(2행 배치, 각 행 가운데 정렬). 6건물(3+3)은 기존과 동일 산술이라
 * 회귀가 없고, 7건물(지시 수신소 추가)은 4+3 으로 갈린다.
 */
export function tilePosition(i: number): { x: number; y: number } {
  const [cols0, cols1] = rowSplit(BUILDINGS.length);
  const row = i < cols0 ? 0 : 1;
  const cols = row === 0 ? cols0 : cols1;
  const col = row === 0 ? i : i - cols0;
  const rowW = cols * TILE_W + (cols - 1) * TILE_GAP;
  const x0 = (DESIGN_WIDTH - rowW) / 2;
  return { x: x0 + col * (TILE_W + TILE_GAP), y: row === 0 ? ROW1_Y : ROW2_Y };
}

export class BaseMapScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private ui: UiTextures = {};
  private profile: Profile | null = null;
  private cb: BaseMapCallbacks | null = null;

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

  show(profile: Profile, cb: BaseMapCallbacks): void {
    this.profile = profile;
    this.cb = cb;
    this.render();
    this.root.visible = true;
    // DOM HUD(HP/LV, 좌하단)는 런 전용 — 캔버스 메타 화면 위에 떠 보이므로 숨긴다(스킬 §7).
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = 'hidden';
  }

  hide(): void {
    this.root.visible = false;
    this.cb = null;
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = '';
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
        // 보유 0장이면 화면 안에서 "보유한 의뢰서가 없다"로 안내한다(잠금 타일이 아니다).
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
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }
    const profile = this.profile;
    if (profile === null) return;

    // 배경(불투명 — 뒤 아레나를 가린다). 별 장식 금지(세트 팔레트 확정).
    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static'; // 뒤로 이벤트가 새지 않게 막는다.
    this.root.addChild(bg);

    this.renderTitleBar(profile);
    BUILDINGS.forEach((b, i) => this.renderBuilding(b, i, profile));
    this.renderLaunch();
    this.renderMeta(profile);
  }

  private renderTitleBar(profile: Profile): void {
    const banner = makeBanner(BANNER_W, BANNER_H, t('base.title'), this.ui['ui_banner.png']);
    banner.position.set((DESIGN_WIDTH - BANNER_W) / 2, BANNER_Y);
    this.root.addChild(banner);

    const credits = makeCurrencyChip(
      CHIP_W,
      CHIP_H,
      String(profile.credits),
      this.ui['ui_chip.png'],
      this.ui['ui_icon_coin.png'],
    );
    credits.position.set((DESIGN_WIDTH - BANNER_W) / 2 - CHIP_W - 20, BANNER_Y + (BANNER_H - CHIP_H) / 2);
    this.root.addChild(credits);

    const minerals = makeCurrencyChip(
      CHIP_W,
      CHIP_H,
      String(profile.minerals),
      this.ui['ui_chip.png'],
      this.ui['ui_icon_crystal.png'],
    );
    minerals.position.set((DESIGN_WIDTH + BANNER_W) / 2 + 20, BANNER_Y + (BANNER_H - CHIP_H) / 2);
    this.root.addChild(minerals);

    const sub = new Text({
      resolution: 2,
      text: t('base.sub'),
      style: { fontFamily: UI_FONT, fontSize: 20, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    sub.anchor.set(0.5, 0);
    sub.position.set(DESIGN_WIDTH / 2, SUB_Y);
    this.root.addChild(sub);
  }

  private renderBuilding(b: Building, i: number, profile: Profile): void {
    const { x: px, y: py } = tilePosition(i);
    const reason = this.lockReason(b.key, profile);
    const locked = reason !== null;

    // 카드 골격(패널 + hover 리프트 + 클릭)은 행성 선택 카드와 공용이다(card.ts).
    // 잠금 타일은 클릭 자체를 달지 않아 hover 리프트도 함께 꺼진다(DOM 판과 동일).
    const tile = makePanelCard({
      width: TILE_W,
      height: TILE_H,
      texture: this.ui['ui_panel.png'],
      ...(locked ? {} : { onClick: () => this.enter(b.key) }),
    });
    tile.position.set(px, py);
    this.root.addChild(tile);

    // 건물 아이콘(nearest ×N 확대). 텍스처가 없으면 강조색 사각 폴백.
    const iconTex = this.ui[b.tex];
    if (iconTex) {
      const sp = new Sprite(iconTex);
      sp.width = ICON_SIZE;
      sp.height = ICON_SIZE;
      sp.position.set((TILE_W - ICON_SIZE) / 2, ICON_Y);
      tile.addChild(sp);
    } else {
      const g = new Graphics();
      g.roundRect((TILE_W - ICON_SIZE) / 2, ICON_Y, ICON_SIZE, ICON_SIZE, 12).fill({ color: b.accent, alpha: 0.75 });
      tile.addChild(g);
    }

    if (locked) {
      // 잠금 막: 패널 안쪽 프레임 안에만 깐다(막은 콘텐츠가 아니라 오버레이라 BORDER 기준).
      // 아이콘 위·이름 아래에 끼워야 해서 z 순서를 여기서 직접 잡는다. 사유는 설명 줄 자리에
      // 넣는다(이름과 겹치지 않게 — 겹침이 첫 검증 결함이었다).
      tile.addChild(panelDim(TILE_W, TILE_H));

      const lockSize = 60;
      const lockTex = this.ui['ui_icon_lock.png'];
      if (lockTex) {
        const lk = new Sprite(lockTex);
        lk.width = lockSize;
        lk.height = lockSize;
        lk.position.set((TILE_W - lockSize) / 2, ICON_Y + (ICON_SIZE - lockSize) / 2);
        tile.addChild(lk);
      }
    }

    const name = new Text({
      resolution: 2,
      text: t(b.nameKey),
      style: {
        fontFamily: UI_FONT,
        fontSize: 30,
        fontWeight: '800',
        fill: locked ? COLOR.muted : COLOR.cream,
        dropShadow: TEXT_SHADOW,
      },
    });
    name.anchor.set(0.5, 0);
    name.position.set(TILE_W / 2, NAME_Y);
    tile.addChild(name);

    const bottom = new Text({
      resolution: 2,
      text: locked ? reason : t(b.descKey),
      style: {
        fontFamily: UI_FONT,
        fontSize: locked ? 19 : 17,
        fontWeight: locked ? '700' : 'normal',
        fill: locked ? 0xff9a7a : COLOR.muted,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: BOX.w,
        dropShadow: TEXT_SHADOW,
      },
    });
    bottom.anchor.set(0.5, 0);
    bottom.position.set(TILE_W / 2, DESC_Y);
    tile.addChild(bottom);

  }

  private renderLaunch(): void {
    const launch = new PixiButton({
      texture: this.ui['ui_btn_yellow.png'],
      fallbackColor: 0x9a7a2a,
      width: LAUNCH_W,
      height: LAUNCH_H,
      fontSize: 30,
      // 노란 버튼은 바탕이 밝아 흰 글씨가 묻힌다 — 진한 갈색 라벨로 대비 확보(사용자 지적).
      labelColor: COLOR.darkLabel,
      label: t('base.launch'),
      onClick: () => this.cb?.onStarMap(),
    });
    launch.container.position.set((DESIGN_WIDTH - LAUNCH_W) / 2, LAUNCH_Y);
    this.root.addChild(launch.container);
  }

  private renderMeta(profile: Profile): void {
    const ship = activeShip(profile);
    const meta = new Text({
      resolution: 2,
      text: t('meta.line', {
        c: profile.credits,
        m: profile.minerals,
        lv: ship.level,
        sp: profile.skillPoints,
      }),
      style: { fontFamily: UI_FONT, fontSize: 20, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    meta.anchor.set(0.5, 0);
    meta.position.set(DESIGN_WIDTH / 2, META_Y);
    this.root.addChild(meta);
  }
}
