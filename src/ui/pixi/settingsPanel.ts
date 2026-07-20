/**
 * 설정 (Pixi 카툰나무풍 리스킨 — `.omc/plans/cartoonwood-rollout.md` #8, 롤아웃 마지막).
 *
 * `src/ui/settingsPanel.ts` 의 DOM `SettingsPanel` 과 기능 1:1 동등하게 좌상단 톱니 버튼 +
 * 설정 팝업(사운드 토글 · 볼륨 · 언어 · 닫기)을 Pixi 캔버스(1920×1080 디자인 스페이스)로
 * 재구현한다. 다른 이관 화면과 다른 점이 둘 있다.
 *
 * 1. **화면이 아니라 크롬 UI 다.** `clearToMenu()` 에 등장하지 않고 런 중에도 계속 떠 있다.
 *    다른 캔버스 화면들이 `show()` 에서 자기를 stage 맨 앞으로 올리므로, 설정은 매 프레임
 *    {@link SettingsScreen.raise} 로 다시 맨 앞으로 되돌린다(이미 마지막이면 no-op).
 * 2. **Pixi 에는 슬라이더가 없다.** 볼륨은 나무 트랙 + 손잡이를 직접 그리고
 *    `pointerdown` → `globalpointermove` → `window pointerup` 으로 드래그를 처리한다
 *    (캔버스 밖에서 손을 떼도 드래그가 풀리도록 마지막 단계만 DOM 이벤트를 쓴다).
 *
 * 순수 render/UI 레이어(ADR-0005·ADR-0014) — sim 은 이 파일을 모른다. 오디오 설정은
 * {@link GameAudio} 가, 로케일은 i18n 이 소유하고 이 화면은 그 뷰/컨트롤러다.
 */

import { Container, Graphics, NineSliceSprite, Rectangle, Sprite, Text } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { GameAudio } from '../../render/audio.js';
import { getLocale, setLocale, LOCALES, t, type Locale, type MessageKey } from '../../i18n/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { nineSlicePanel, panelContent } from './nineSlicePanel.js';
import { PixiButton } from './button.js';
import { stripEmoji } from './text.js';

const LANG_KEY: Record<Locale, MessageKey> = {
  en: 'settings.lang.en',
  ko: 'settings.lang.ko',
};

// --- 레이아웃 상수(디자인 스페이스) ---
/** 좌상단 톱니 버튼. DOM 판(left:16 top:14, 38px)의 자리를 디자인 좌표로 옮긴 값. */
const GEAR_X = 24;
const GEAR_Y = 20;
const GEAR_SIZE = 76;
/** 톱니 안 아이콘(정사각). */
const GEAR_ICON = 44;

/** 팝업은 톱니 바로 아래에 붙는다(암막 없음 — 뒤 화면이 그대로 보인다). */
const PANEL_X = GEAR_X;
const PANEL_Y = GEAR_Y + GEAR_SIZE + 16;
const PANEL_W = 520;

/** 콘텐츠 상자. 폭·좌상단은 패널 높이와 무관하므로(inset 60 고정) 미리 잡아 둔다. */
const BOX = panelContent(PANEL_W, 0);
const CW = BOX.w;

const ROW_LABEL = 22;
const BTN_H = 48;
/** 볼륨 손잡이 폭 — 트랙 양끝을 이만큼 들여야 손잡이가 상자를 넘지 않는다. */
const KNOB_W = 26;
const KNOB_H = 38;
const TRACK_H = 14;

function label(text: string, size = ROW_LABEL, fill: number = COLOR.cream): Text {
  return new Text({
    resolution: 2,
    text,
    style: { fontFamily: UI_FONT, fontSize: size, fontWeight: '700', fill, dropShadow: TEXT_SHADOW },
  });
}

/**
 * 톱니 아이콘 폴백(자산 누락 시). 컬러 이모지 '⚙' 는 캔버스에서 두부로 떨어질 수 있어
 * (stripEmoji 가 걷어내는 부류) 글자 대신 도형으로 그린다.
 */
function gearGlyph(size: number): Graphics {
  const g = new Graphics();
  const c = size / 2;
  const rOuter = size * 0.32;
  const tooth = size * 0.15;
  // 이빨: 회전 없이 원 둘레 8곳에 사각을 찍는다(작은 아이콘이라 이것으로 충분히 톱니로 읽힌다).
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    g.rect(c + Math.cos(a) * rOuter - tooth / 2, c + Math.sin(a) * rOuter - tooth / 2, tooth, tooth).fill({
      color: COLOR.cream,
    });
  }
  g.circle(c, c, rOuter).fill({ color: COLOR.cream });
  g.circle(c, c, rOuter * 0.42).fill({ color: 0x2a2018 });
  return g;
}

export class SettingsScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  /** 팝업 바깥 클릭을 받아 닫는 투명 판(열려 있을 때만 보인다). */
  private readonly catcher = new Graphics();
  private readonly panel = new Container();
  private readonly gear = new Container();
  private ui: UiTextures = {};
  private opened = false;

  // 볼륨 드래그 상태. 슬라이더는 render() 마다 새로 만들어지므로 적용 함수만 갈아 끼운다
  // (리스너는 생성자에서 한 번만 단다 — 재렌더마다 달면 샌다).
  private dragging = false;
  private applyDrag: ((e: FederatedPointerEvent) => void) | null = null;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.opened && e.key === 'Escape') this.setOpen(false);
  };
  private readonly onPointerUp = (): void => {
    this.dragging = false;
  };

  /**
   * @param audio 볼륨/음소거를 소유하는 사운드 보드.
   * @param stage 디자인 스페이스 stage(레터박스 스케일이 걸린 컨테이너).
   * @param onLocaleChange 언어 전환 후 호출(열린 메뉴 화면 재렌더용).
   */
  constructor(
    private readonly audio: GameAudio,
    stage: Container,
    private readonly onLocaleChange: () => void,
  ) {
    this.stage = stage;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);

    this.catcher.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: 0x000000, alpha: 0.001 });
    this.catcher.eventMode = 'static';
    this.catcher.visible = false;
    this.catcher.on('pointertap', () => this.setOpen(false));
    this.root.addChild(this.catcher);

    this.panel.visible = false;
    this.root.addChild(this.panel);
    // 톱니는 항상 팝업 위 — 열린 상태에서 톱니를 다시 눌러 닫을 수 있어야 한다.
    this.root.addChild(this.gear);
    // 톱니의 상호작용은 **여기서 한 번만** 건다. buildGear() 는 텍스처 로드 후 다시 불리는데
    // 거기서 리스너를 또 달면 클릭 한 번에 pointertap 이 두 번 나 열렸다 즉시 닫힌다(실측).
    this.gear.position.set(GEAR_X, GEAR_Y);
    this.gear.eventMode = 'static';
    this.gear.cursor = 'pointer';
    this.gear.hitArea = new Rectangle(0, 0, GEAR_SIZE, GEAR_SIZE);
    this.gear.on('pointertap', () => {
      // 첫 클릭이 오디오 잠금 해제 제스처를 겸한다(자동재생 정책 — DOM 판과 동일).
      this.audio.unlock();
      this.setOpen(!this.opened);
    });
    this.gear.on('pointerover', () => (this.gear.alpha = 0.85));
    this.gear.on('pointerout', () => (this.gear.alpha = 1));

    this.root.on('globalpointermove', (e: FederatedPointerEvent) => {
      if (this.dragging) this.applyDrag?.(e);
    });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('pointerup', this.onPointerUp);

    this.buildGear();
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      this.buildGear();
      if (this.opened) this.render();
    });
  }

  get visible(): boolean {
    return this.opened;
  }

  /** 팝업 열기/닫기(톱니와 같은 동작 — 하네스 검증에서도 쓴다). */
  toggle(): void {
    this.setOpen(!this.opened);
  }

  /**
   * 설정을 stage 맨 앞으로 되돌린다. 다른 캔버스 화면이 `show()` 에서 자기를 맨 앞으로
   * 올리므로(ADR-0014), 크롬 UI 인 설정은 렌더 루프에서 매 프레임 이 함수를 부른다.
   * 이미 마지막 자식이면 아무것도 하지 않는다.
   */
  raise(): void {
    const parent = this.root.parent;
    if (parent === null) return;
    const last = parent.children.length - 1;
    if (parent.getChildIndex(this.root) !== last) parent.setChildIndex(this.root, last);
  }

  hide(): void {
    this.setOpen(false);
  }

  private setOpen(open: boolean): void {
    this.opened = open;
    if (open) this.render();
    this.panel.visible = open;
    this.catcher.visible = open;
    if (!open) {
      this.dragging = false;
      this.applyDrag = null;
    }
  }

  // --- 톱니 --------------------------------------------------------------

  private buildGear(): void {
    this.gear.removeChildren();
    const tex = this.ui['ui_btn_wood.png'];
    if (tex) {
      const bg = new NineSliceSprite({ texture: tex, leftWidth: 30, topHeight: 0, rightWidth: 30, bottomHeight: 0 });
      bg.width = GEAR_SIZE;
      bg.height = GEAR_SIZE;
      this.gear.addChild(bg);
    } else {
      const g = new Graphics();
      g.roundRect(0, 0, GEAR_SIZE, GEAR_SIZE, 12)
        .fill({ color: 0x5a4028 })
        .stroke({ color: 0x2a1c10, width: 3, alignment: 1 });
      this.gear.addChild(g);
    }

    const icon = this.ui['ui_icon_gear.png'];
    if (icon) {
      const sp = new Sprite(icon);
      sp.width = GEAR_ICON;
      sp.height = GEAR_ICON;
      sp.position.set((GEAR_SIZE - GEAR_ICON) / 2, (GEAR_SIZE - GEAR_ICON) / 2);
      this.gear.addChild(sp);
    } else {
      const glyph = gearGlyph(GEAR_ICON);
      glyph.position.set((GEAR_SIZE - GEAR_ICON) / 2, (GEAR_SIZE - GEAR_ICON) / 2);
      this.gear.addChild(glyph);
    }
  }

  // --- 팝업 --------------------------------------------------------------

  private render(): void {
    this.panel.removeChildren();
    const s = this.audio.getSettings();

    // 콘텐츠를 먼저 조립해 실제 바닥을 재고, 그 높이로 패널을 만든다 — 아래 여백이 위와
    // 대칭이 되도록(롤아웃 교훈: 줄 높이 합으로 어림하면 아래만 좁아 보인다).
    const content = new Container();
    let y = 0;

    const title = label(t('settings.title'), 30, COLOR.gold);
    content.addChild(title);
    y += 48;

    // 사운드 on/off. DOM 판은 라벨 "음소거"에 값 "켜짐"이 붙어 어느 쪽이 켜진 것인지
    // 헷갈렸다 — 카탈로그에 이미 있던 `settings.sound` 를 라벨로 써서 "사운드: 켜짐"으로 읽힌다.
    content.addChild(this.row(t('settings.sound'), y));
    const soundBtn = new PixiButton({
      texture: this.ui[s.muted ? 'ui_btn_wood.png' : 'ui_btn_yellow.png'],
      width: 150,
      height: BTN_H,
      label: stripEmoji(s.muted ? t('settings.off') : t('settings.on')),
      fontSize: 20,
      ...(s.muted ? {} : { labelColor: COLOR.darkLabel }),
      onClick: () => {
        this.audio.setMuted(!this.audio.getSettings().muted);
        this.render();
      },
    });
    soundBtn.container.position.set(CW - 150, y);
    content.addChild(soundBtn.container);
    y += BTN_H + 26;

    // 볼륨: 라벨 + 현재 값(%) + 드래그 슬라이더.
    content.addChild(this.row(t('settings.volume'), y, 0));
    const pct = label(`${Math.round(s.volume * 100)}%`, ROW_LABEL, COLOR.gold);
    pct.anchor.set(1, 0);
    pct.position.set(CW, y);
    content.addChild(pct);
    y += 36;
    const slider = this.buildSlider(s.volume, (v) => {
      this.audio.setVolume(v);
      pct.text = `${Math.round(v * 100)}%`;
    });
    slider.position.set(0, y);
    content.addChild(slider);
    y += KNOB_H + 30;

    // 언어: 라벨 한 줄 + 버튼 2개(좁은 열에서 문구 옆에 붙이면 눌려 읽히지 않는다).
    content.addChild(this.row(t('settings.language'), y, 0));
    y += 34;
    const langW = Math.floor((CW - 12) / 2);
    const cur = getLocale();
    LOCALES.forEach((loc, i) => {
      const sel = loc === cur;
      const b = new PixiButton({
        texture: this.ui[sel ? 'ui_btn_yellow.png' : 'ui_btn_wood.png'],
        width: langW,
        height: BTN_H,
        label: stripEmoji(t(LANG_KEY[loc])),
        fontSize: 20,
        ...(sel ? { labelColor: COLOR.darkLabel } : {}),
        onClick: () => {
          if (loc === getLocale()) return;
          setLocale(loc);
          this.render(); // 팝업 자체를 새 언어로 다시 그린다.
          this.onLocaleChange(); // 열린 메뉴 화면 재렌더.
        },
      });
      b.container.position.set(i * (langW + 12), y);
      content.addChild(b.container);
    });
    y += BTN_H + 26;

    const close = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      width: CW,
      height: 52,
      label: stripEmoji(t('common.close')),
      fontSize: 20,
      onClick: () => this.setOpen(false),
    });
    close.container.position.set(0, y);
    content.addChild(close.container);

    // 실제 바닥을 재서 아래 여백을 위와 같게 잡는다.
    const bottom = content.getLocalBounds().bottom;
    const panelH = Math.round(bottom + BOX.y * 2);

    // 다른 화면과 달리 **밝은 화면 위에 뜨는 팝업**이라 기본 채움 알파(0.96)로는 뒤 화면이
    // 비친다(기지 맵 건물 카드의 글자가 그대로 읽혔다 — 확대 크롭에서 잡혔다). 불투명으로.
    this.panel.addChild(
      nineSlicePanel(PANEL_W, panelH, { texture: this.ui['ui_panel.png'], fillAlpha: 1 }),
    );
    content.position.set(BOX.x, BOX.y);
    this.panel.addChild(content);
    this.panel.position.set(PANEL_X, PANEL_Y);
    // 팝업 안쪽 클릭이 바깥 판(catcher)까지 흘러 창이 닫히지 않도록 끊는다.
    this.panel.eventMode = 'static';
    this.panel.hitArea = new Rectangle(0, 0, PANEL_W, panelH);
    this.panel.removeAllListeners('pointertap');
    this.panel.on('pointertap', (e: FederatedPointerEvent) => e.stopPropagation());
  }

  /** 행 라벨(세로 중앙 정렬 — 오른쪽 컨트롤 높이에 맞춘다). `h=0` 이면 위 정렬. */
  private row(text: string, y: number, h = BTN_H): Text {
    const l = label(text);
    if (h > 0) {
      l.anchor.set(0, 0.5);
      l.position.set(0, y + h / 2);
    } else {
      l.position.set(0, y);
    }
    return l;
  }

  /**
   * 볼륨 슬라이더. 트랙 클릭은 그 지점으로 점프하고, 손잡이를 잡으면 드래그가 이어진다.
   * 손잡이가 상자를 넘지 않도록 트랙을 좌우 `KNOB_W/2` 만큼 들여 잡는다.
   */
  private buildSlider(value0: number, onChange: (v: number) => void): Container {
    const root = new Container();
    const half = KNOB_W / 2;
    const span = CW - KNOB_W; // 손잡이 중심이 움직이는 거리

    const track = new Graphics();
    track
      .roundRect(half, (KNOB_H - TRACK_H) / 2, span, TRACK_H, TRACK_H / 2)
      .fill({ color: 0x2a2018 })
      .stroke({ color: 0x6b4a2a, width: 3, alignment: 1 });
    root.addChild(track);

    const fill = new Graphics();
    root.addChild(fill);

    const knob = new Graphics();
    knob
      .roundRect(-half, 0, KNOB_W, KNOB_H, 7)
      .fill({ color: 0xc99a5b })
      .stroke({ color: 0x3a2a1a, width: 3, alignment: 1 });
    knob.rect(-5, 10, 10, KNOB_H - 20).fill({ color: 0x7a5530 });
    root.addChild(knob);

    let value = value0;
    const paint = (): void => {
      const cx = half + value * span;
      fill.clear();
      if (value > 0) {
        // 트랙 테두리(3px) **안쪽**에 채운다 — 같은 높이로 그리면 채움이 테두리를 덮어
        // 그 구간만 바가 굵어 보인다(모서리 확대에서 잡혔다).
        const inset = 3;
        fill
          .roundRect(
            half + inset,
            (KNOB_H - TRACK_H) / 2 + inset,
            Math.max(0, value * span - inset * 2),
            TRACK_H - inset * 2,
            (TRACK_H - inset * 2) / 2,
          )
          .fill({ color: COLOR.gold });
      }
      knob.position.set(cx, 0);
    };
    paint();

    const apply = (e: FederatedPointerEvent): void => {
      const local = e.getLocalPosition(root);
      const v = Math.min(1, Math.max(0, (local.x - half) / span));
      if (v === value) return;
      value = v;
      paint();
      onChange(v);
    };

    root.eventMode = 'static';
    root.cursor = 'pointer';
    // 트랙보다 넉넉한 판정(가는 트랙은 집기 어렵다).
    root.hitArea = new Rectangle(0, -4, CW, KNOB_H + 8);
    root.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.dragging = true;
      this.applyDrag = apply;
      apply(e);
    });
    return root;
  }
}
