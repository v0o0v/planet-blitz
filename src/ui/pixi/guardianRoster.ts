/**
 * 예비역 수호기 로스터 화면 — Pixi (ADR-0024 Task #8).
 *
 * 격납고에서 진입하는 **하위 화면**이다(챔피언 선택과 동일한 suspend/resume 규약). 미소멸 수호
 * 기체를 한 줄씩 나열해 기체 타입·남은 성능%·잠긴 장비 수·소멸 회수 포인트를 보여 주고, 각 행의
 * [소멸] 버튼으로 그 수호기를 소멸시킨다. 소멸하면 잠긴 장비가 창고로 반환되고(returnLockedGear,
 * guardianLifecycle) 계보 포인트를 회수하며, 목록에서 사라진다.
 *
 * 범위는 **의도적으로 소박**하다(설계서 §UI Task #8): 상세 빌드 미리보기(장착/스킬 트리 렌더)는
 * 만들지 않는다. 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 *
 * ## 여기서도 통하는 실측 규칙(챔피언 선택과 동일)
 * - **DOM 혼용 금지**(ADR-0014). 캔버스는 남은 DOM 오버레이 아래로 깔린다.
 * - **휠은 클립 Container + hitArea 에**({@link makeScrollArea}). 마스크 Graphics 는 히트 제외.
 * - **여백은 `panelContent` 상자 안에만**. 제목이 나무 테두리에 붙는 결함 방지.
 * - **밝은 화면 위 팝업은 `fillAlpha: 1`** — `makeModal` 이 고정한다.
 * - **격납고와는 `suspend()`/`resume()`** — `show()` 로 되돌리면 미저장 편집이 사라진다.
 * - 리스너는 wipe-then-rebuild 규약으로 다룬다(`render()` 가 매번 자식을 파괴·재생성).
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { EquipSlotId } from '../../items/types.js';
import {
  saveProfile,
  type KeyValueStore,
  type Profile,
  type GuardianRecord,
} from '../../save/profile.js';
import { activeGuardians, dismissGuardianRecord } from '../../save/guardianLifecycle.js';
import { dismissPoints, GUARDIAN_INTERCEPTOR } from '../../../data/guardian.js';
import { shipTypeDef } from '../../../data/ships/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { nineSlicePanel, panelContent, PANEL_BORDER } from './nineSlicePanel.js';
import { PixiButton } from './button.js';
import { makeBanner, makeIconButton } from './titleBar.js';
import { listRowBg } from './listRow.js';
import { makeScrollArea } from './scrollArea.js';
import { makeModal } from './modal.js';
import { shipTypeName, tShipKey } from './shipLabels.js';
import { t } from '../../i18n/index.js';

// --- 레이아웃(디자인 스페이스 1920×1080) ---
const BANNER_W = 640;
const BANNER_H = 72;
const BANNER_Y = 10;

const PANEL_X = 460;
const PANEL_Y = 140;
const PANEL_W = 1000;
const PANEL_H = 820;
const BOX = panelContent(PANEL_W, PANEL_H);

/** 로스터 목록 시작 y(패널 로컬, 제목 아래). */
const LIST_TOP = BOX.y + 60;
const LIST_AVAIL = BOX.bottom - LIST_TOP;

/** 행 한 칸(이름 + 정보 한 줄 + 소멸 버튼). */
const ROW_H = 116;
const ROW_GAP = 12;

const DISMISS_W = 180;
const DISMISS_H = 56;

const CONFIRM_W = 720;
const CONFIRM_H = 380;

const HINT_Y = DESIGN_HEIGHT - 10;

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
 * 행에 보여 줄 수호기 이름. build 가 있으면 그 기체 타입 표시명, 없으면(ADR-0024 이전 구 수호기)
 * 프리셋 라벨(타이탄형/인터셉터형)로 폴백한다.
 */
export function guardianTypeLabel(g: GuardianRecord): string {
  if (g.build !== undefined) return shipTypeName(shipTypeDef(g.build.typeId));
  return t(g.preset === GUARDIAN_INTERCEPTOR ? 'def.guardian.interceptor' : 'def.guardian.titan');
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
  private cb: GuardianRosterCallbacks | null = null;
  private ui: UiTextures = {};
  private scrollY = 0;
  /** 소멸 확인 팝업 대상 수호기 id(null = 팝업 닫힘). */
  private confirming: string | null = null;
  /** 소멸 직후 피드백 한 줄(반환 장비 수·회수 포인트). */
  private hint = '';
  /** 진입 시점의 런 HUD `visibility`(닫을 때 그대로 되돌린다 — 챔피언 선택 C-4 규약). */
  private hudPrevVisibility: string | null = null;

  constructor(profile: Profile, stage: Container, store: KeyValueStore | null = null) {
    this.profile = profile;
    this.store = store;
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      if (this.root.visible) this.render();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  show(profile: Profile, cb: GuardianRosterCallbacks): void {
    this.profile = profile;
    this.cb = cb;
    this.hint = '';
    this.confirming = null;
    this.scrollY = 0;
    this.render();
    this.root.visible = true;
    this.raise();
    this.hideRunHud();
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
   * 소멸 확정: 잠긴 장비 수를 **소멸 전에** 세어 둔 뒤 {@link dismissGuardianRecord} 로 소멸하고
   * (장비 stash 반환·계보 포인트 회수는 그 함수가 처리) 저장한다. 화면은 재렌더로 목록에서 그
   * 수호기를 지운다. store 가 null 이면 `?? undefined` 로 기본 store 를 태운다(격납고/챔피언 선례).
   */
  private performDismiss(id: string): void {
    const g = this.profile.guardians.find((x) => x.id === id);
    this.confirming = null;
    if (g === undefined || g.retired) {
      this.render();
      return;
    }
    const gearCount = countLockedGear(g);
    const res = dismissGuardianRecord(this.profile, id);
    saveProfile(this.profile, this.store ?? undefined);
    if (res.dismissed) {
      this.hint = t('guardians.dismissed', { n: gearCount, points: res.points });
    }
    this.render();
  }

  // --- 렌더 ----------------------------------------------------------------

  private render(): void {
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }

    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static'; // 뒤 화면으로 이벤트가 새지 않게 막는다.
    this.root.addChild(bg);

    this.renderTitleBar();
    this.renderRoster();
    this.renderHint();
    if (this.confirming !== null) this.renderConfirmModal();
  }

  private renderTitleBar(): void {
    const banner = makeBanner(
      BANNER_W,
      BANNER_H,
      tShipKey('guardians.title', 'Reserve Guardians'),
      this.ui['ui_banner.png'],
    );
    banner.position.set((DESIGN_WIDTH - BANNER_W) / 2, BANNER_Y);
    this.root.addChild(banner);

    const close = makeIconButton(56, () => this.close(), this.ui['ui_icon_close.png']);
    close.position.set(DESIGN_WIDTH - 24 - 56, 12);
    this.root.addChild(close);
  }

  private renderRoster(): void {
    const panel = new Container();
    panel.position.set(PANEL_X, PANEL_Y);
    this.root.addChild(panel);
    panel.addChild(
      nineSlicePanel(PANEL_W, PANEL_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }),
    );

    const title = new Text({
      resolution: 2,
      text: t('guardians.title'),
      style: { fontFamily: UI_FONT, fontSize: 28, fontWeight: '800', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
    });
    title.position.set(BOX.x, BOX.y);
    panel.addChild(title);

    const guardians = activeGuardians(this.profile);
    if (guardians.length === 0) {
      const empty = new Text({
        resolution: 2,
        text: t('guardians.empty'),
        style: {
          fontFamily: UI_FONT,
          fontSize: 20,
          fill: COLOR.muted,
          wordWrap: true,
          wordWrapWidth: BOX.w - 40,
          align: 'center',
          dropShadow: TEXT_SHADOW,
        },
      });
      // 패널 로컬 좌표로 중앙 배치(패널이 이미 PANEL_X/Y 로 옮겨져 있다).
      empty.anchor.set(0.5);
      empty.position.set(PANEL_W / 2, LIST_TOP + LIST_AVAIL / 2);
      panel.addChild(empty);
      return;
    }

    const totalH = guardians.length * (ROW_H + ROW_GAP) - ROW_GAP;
    const content = makeScrollArea(panel, {
      x: BOX.x,
      y: LIST_TOP,
      w: BOX.w,
      h: LIST_AVAIL,
      totalH,
      get: () => this.scrollY,
      set: (v) => {
        this.scrollY = v;
      },
    });

    guardians.forEach((g, i) => {
      const row = this.makeRow(g);
      row.position.set(0, i * (ROW_H + ROW_GAP));
      content.addChild(row);
    });
  }

  private makeRow(g: GuardianRecord): Container {
    const row = new Container();
    row.addChild(listRowBg(BOX.w, ROW_H));

    const name = new Text({
      resolution: 2,
      text: guardianTypeLabel(g),
      style: { fontFamily: UI_FONT, fontSize: 24, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    name.position.set(18, 16);
    row.addChild(name);

    const perfVal = g.performanceCP / 100;
    const pct = Number.isInteger(perfVal) ? String(perfVal) : perfVal.toFixed(1);
    const gear = countLockedGear(g);
    const recover = dismissPoints(g.combatScore, g.performanceCP);
    const info = new Text({
      resolution: 2,
      text: `${t('guardians.perf', { pct })}  ·  ${t('guardians.gear', { n: gear })}  ·  ${t('guardians.recover', { points: recover })}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 17,
        fill: COLOR.muted,
        wordWrap: true,
        wordWrapWidth: BOX.w - DISMISS_W - 48,
        lineHeight: 22,
        dropShadow: TEXT_SHADOW,
      },
    });
    info.position.set(18, 58);
    row.addChild(info);

    const dismiss = new PixiButton({
      texture: this.ui['ui_btn_red.png'],
      fallbackColor: 0x9a2a2a,
      width: DISMISS_W,
      height: DISMISS_H,
      fontSize: 20,
      label: t('guardians.dismiss'),
      onClick: () => {
        this.confirming = g.id;
        this.render();
      },
    });
    dismiss.container.position.set(BOX.w - DISMISS_W - 16, Math.round((ROW_H - DISMISS_H) / 2));
    row.addChild(dismiss.container);

    return row;
  }

  /** 소멸 확인 팝업(되돌릴 수 없음 — 무엇이 반환되고 얼마를 회수하는지 먼저 말한다). */
  private renderConfirmModal(): void {
    const g = this.profile.guardians.find((x) => x.id === this.confirming);
    if (g === undefined) {
      this.confirming = null;
      return;
    }
    const parts = makeModal({
      width: CONFIRM_W,
      height: CONFIRM_H,
      title: t('guardians.dismiss.title'),
      onClose: () => {
        this.confirming = null;
        this.render();
      },
      panelTexture: this.ui['ui_panel.png'],
      closeTexture: this.ui['ui_icon_close.png'],
    });
    this.root.addChild(parts.root);

    const body = new Text({
      resolution: 2,
      text: t('guardians.dismiss.confirm', {
        name: guardianTypeLabel(g),
        gear: countLockedGear(g),
        points: dismissPoints(g.combatScore, g.performanceCP),
      }),
      style: {
        fontFamily: UI_FONT,
        fontSize: 18,
        fill: COLOR.cream,
        wordWrap: true,
        wordWrapWidth: parts.box.w,
        lineHeight: 26,
        dropShadow: TEXT_SHADOW,
      },
    });
    body.position.set(parts.box.x, parts.box.y + 60);
    parts.panel.addChild(body);

    // 자라는 본문 아래에 버튼을 놓는다 — 바닥을 실측(`getLocalBounds`)해 여백을 맞춘다.
    const bodyBottom = body.y + body.getLocalBounds().height;
    const btnY = Math.max(bodyBottom + 28, parts.box.bottom - 60);

    const id = g.id;
    const yes = new PixiButton({
      texture: this.ui['ui_btn_red.png'],
      fallbackColor: 0x9a2a2a,
      width: 240,
      height: 56,
      fontSize: 18,
      label: t('guardians.dismiss'),
      onClick: () => this.performDismiss(id),
    });
    yes.container.position.set(parts.box.x, btnY);
    parts.panel.addChild(yes.container);

    const no = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: 200,
      height: 56,
      fontSize: 18,
      label: t('guardians.cancel'),
      onClick: () => {
        this.confirming = null;
        this.render();
      },
    });
    no.container.position.set(parts.box.x + 260, btnY);
    parts.panel.addChild(no.container);
  }

  private renderHint(): void {
    if (this.hint === '') return;
    const h = new Text({
      resolution: 2,
      text: this.hint,
      style: { fontFamily: UI_FONT, fontSize: 20, fontWeight: '700', fill: 0x8affc0, dropShadow: TEXT_SHADOW },
    });
    h.anchor.set(0.5, 1);
    h.position.set(DESIGN_WIDTH / 2, HINT_Y);
    this.root.addChild(h);
  }
}
