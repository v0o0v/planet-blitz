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

import { Container, Graphics, Rectangle, Sprite, Text } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { GameAudio, AudioBus } from '../../render/audio.js';
import { getLocale, setLocale, LOCALES, t, type Locale, type MessageKey } from '../../i18n/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { nineSlicePanel, panelContent } from './nineSlicePanel.js';
import { makeScrollArea } from './scrollArea.js';
import { GoogleSignInButton } from './googleSignInButton.js';
import { PixiButton } from './button.js';
import { stripEmoji } from './text.js';
import { graphicsSettings, type Quality } from '../../render/graphicsSettings.js';

const LANG_KEY: Record<Locale, MessageKey> = {
  en: 'settings.lang.en',
  ko: 'settings.lang.ko',
};

// --- 레이아웃 상수(디자인 스페이스) ---
/**
 * 좌상단 톱니 버튼. DOM 판(left:16 top:14, 38px)의 자리를 디자인 좌표로 옮긴 값.
 *
 * ⚠️ 톱니는 이 화면 소유가 아니라 **매 프레임 맨 앞으로 올라오는 전역 크롬**이라, 아래에
 * 깔리는 화면들이 좌상단을 비워 두려면 이 자리를 알아야 한다(격납고의 촉매 버튼이 여기
 * 겹쳐 클릭 불가였고, 방어 사령부 탭 바가 4px 차이로 붙어 있었다). 그래서 좌표를 각 화면이
 * 베껴 적는 대신 {@link GEAR_RECT} 하나를 정본으로 export 한다 — 톱니가 움직이면 비켜야
 * 하는 화면들이 자동으로 따라온다.
 */
const GEAR_X = 24;
const GEAR_Y = 20;
const GEAR_SIZE = 76;

/**
 * 전역 톱니가 점유하는 사각형(디자인 스페이스). 다른 화면이 좌상단을 피할 때 쓰는 **단일
 * 정본** — 값을 베껴 적지 말고 이걸 import 해라.
 */
export const GEAR_RECT = {
  x: GEAR_X,
  y: GEAR_Y,
  size: GEAR_SIZE,
  right: GEAR_X + GEAR_SIZE,
  bottom: GEAR_Y + GEAR_SIZE,
} as const;
/** 톱니 안 아이콘(정사각). */
const GEAR_ICON = 44;

/** 팝업은 톱니 바로 아래에 붙는다(암막 없음 — 뒤 화면이 그대로 보인다). */
const PANEL_X = GEAR_X;
/** 팝업 상단 y. 기하 계약의 일부라 테스트가 읽는다(바닥이 화면 안인지 재려면 필요하다). */
export const PANEL_Y = GEAR_Y + GEAR_SIZE + 16;
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

/** 팝업 바닥과 화면 아래 사이에 남기는 여백. */
export const PANEL_BOTTOM_MARGIN = 16;

export interface SettingsPanelGeometry {
  /** 실제로 그릴 패널 높이. */
  panelH: number;
  /** 내용이 보이는 창 높이(패널 높이에서 위아래 inset 을 뺀 값). */
  viewH: number;
  /** 내용이 창을 넘쳐 스크롤이 필요한가. */
  scrolls: boolean;
}

/**
 * 내용 높이 → 패널 기하.
 *
 * ## 이 함수가 왜 생겼나
 * 팝업은 톱니 아래(y=112)에 붙고 **내용 높이만큼 자라기만** 했다. 행이 하나씩 늘어나면서
 * (그래픽 티어 → 모션 감소 → 발광 감소 → 데미지 숫자 → 계정) 결국 화면 아래로 넘쳤고,
 * 넘친 부분은 **잘려서 그냥 안 보였다** — 닫기 버튼과 계정 행이 그렇게 사라졌다. 스크롤도
 * 없어서 사용자가 닿을 방법 자체가 없었다.
 *
 * 계정 행이 그 임계를 넘긴 방아쇠였을 뿐, 그 전에도 이미 넘치고 있었다. 그래서 "계정 행을
 * 줄인다"가 아니라 **높이를 화면에 가두고 넘치면 스크롤**로 고친다 — 다음에 행이 또 늘어도
 * 같은 결함이 재발하지 않는다.
 *
 * 넘치지 않으면 `scrolls=false` 이고 기존과 픽셀 하나 다르지 않다.
 */
export function settingsPanelGeometry(contentH: number): SettingsPanelGeometry {
  const inset = BOX.y;
  const ideal = Math.round(contentH + inset * 2);
  const max = DESIGN_HEIGHT - PANEL_Y - PANEL_BOTTOM_MARGIN;
  if (ideal <= max) return { panelH: ideal, viewH: ideal - inset * 2, scrolls: false };
  return { panelH: max, viewH: max - inset * 2, scrolls: true };
}

/**
 * 설정 팝업 '계정' 행의 상태.
 *
 * 로그인 개념이 있는 빌드(설정 O)에서 **미로그인도 하나의 상태**다 — 그때 로그인 버튼이
 * 없으면, 게이트가 꺼진 상황(DEV·세션 끊김 강등)에서 다시 로그인할 방법이 사라진다.
 */
export type AccountPanelState =
  | { signedIn: true; email: string | null; onSignOut: () => void }
  | { signedIn: false; onSignIn: () => void };

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
  /**
   * 계정 행 상태.
   *
   * `null` = 행 자체를 안 그린다. **로그인이라는 개념이 없는 빌드**가 여기 해당한다
   * (미설정 — vitest·밸런스 러너·시크릿 없는 배포). 그런 환경에 계정 UI 가 뜨면 누를 수도
   * 없는 버튼만 남는다.
   *
   * ## 왜 로그인 버튼이 여기 있나 (타이틀이 아니라)
   * 타이틀은 y=858 에 460×86 버튼 **하나**가 들어가도록 짜여 있고, 그 하나는 게이트가 강제일
   * 때만 로그인이 된다. 그래서 게이트가 꺼진 상황 — ①DEV(하네스를 위해 강제하지 않는다)
   * ②세션이 끊겨 오프라인으로 강등된 뒤 — 에는 **로그인할 방법이 아예 없어진다**. 설정 팝업은
   * 모든 화면 위에 떠 있는 크롬이라(`settings.raise()`) 어느 상황에서도 닿는 유일한 자리다.
   *
   * ## 표시와 로그아웃은 한 쌍이다
   * 로그아웃 버튼만 있고 누구인지 안 보이면, 엉뚱한 계정으로 쌓고 있다는 것을 끝날 때까지
   * 모른다.
   */
  private account: AccountPanelState | null = null;

  /**
   * 계정 행 상태를 갈아 끼운다. 부팅이 세션을 확인한 뒤 `main.ts` 가 부르고, 로그인 실패
   * 직후에도 부른다. 패널이 열려 있으면 즉시 다시 그린다.
   */
  setAccount(account: AccountPanelState | null): void {
    this.account = account;
    if (this.opened) this.render();
  }

  /**
   * 계정 행에 붙일 안내(로그인 시작 실패). null 이면 지운다.
   *
   * 타이틀의 로그인 실패는 타이틀이 직접 문구를 띄우지만, **설정에서 누른 실패는 띄울 곳이
   * 없다** — 팝업을 닫아 버리면 사용자는 아무 일도 안 일어난 것처럼 본다. 그래서 여기에도
   * 같은 안내를 둔다.
   */
  setAccountNotice(notice: string | null): void {
    this.accountNotice = notice;
    if (this.opened) this.render();
  }

  private accountNotice: string | null = null;

  /**
   * 스크롤 위치. `render()` 는 매번 자식을 전부 새로 만들므로 위치를 여기 들고 있어야
   * 토글 하나 눌렀다고 맨 위로 튀지 않는다(그래픽·볼륨 조작이 전부 render 를 다시 부른다).
   */
  private scroll = 0;

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

  /**
   * 톱니 버튼 — **아이콘 배지 한 장**으로 끝낸다(닫기 X 버튼과 같은 구성).
   *
   * ## 나무 느낌이 너무 강했던 이유 (사용자 신고 2026-07-30)
   * 예전에는 `ui_btn_wood.png` 를 9-slice 로 {@link GEAR_SIZE} 만큼 깔고 그 **위에** 톱니
   * 아이콘을 44px 로 얹었다. 그런데 `ui_icon_gear.png` 자체가 이미 테두리를 가진 **완성된 원형
   * 배지**다 — 나무 판과 배지 테두리가 이중으로 겹쳐 팔각 나무틀 안에 또 원형 틀이 들어앉은
   * 모양이 됐고, 그래서 이 버튼만 유독 나무가 두꺼워 보였다.
   *
   * 같은 자리의 닫기 버튼({@link makeIconButton})은 처음부터 배경 없이 `ui_icon_close.png` 한
   * 장만 버튼 크기로 그린다. 톱니를 그 규칙에 맞춘다 — 자산 자체가 배지라 배경이 필요 없다.
   *
   * 클릭·hover 는 컨테이너가 `hitArea` 로 이미 지고 있어(생성자) 자식 구성과 무관하다.
   */
  private buildGear(): void {
    this.gear.removeChildren();
    const icon = this.ui['ui_icon_gear.png'];
    if (icon) {
      const sp = new Sprite(icon);
      sp.width = GEAR_SIZE;
      sp.height = GEAR_SIZE;
      this.gear.addChild(sp);
      return;
    }
    // 폴백(자산 누락) — 배지 어휘를 유지하되 나무가 아니라 중립 원판으로 그린다.
    const g = new Graphics();
    g.circle(GEAR_SIZE / 2, GEAR_SIZE / 2, GEAR_SIZE / 2 - 2)
      .fill({ color: 0x3a2a2a })
      .stroke({ color: 0x000000, width: 2, alpha: 0.5, alignment: 1 });
    this.gear.addChild(g);
    const glyph = gearGlyph(GEAR_ICON);
    glyph.position.set((GEAR_SIZE - GEAR_ICON) / 2, (GEAR_SIZE - GEAR_ICON) / 2);
    this.gear.addChild(glyph);
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

    // 볼륨: 버스별(BGM/SFX/UI) 라벨 + 현재 값(%) + 드래그 슬라이더 3벌. 각 버스 게인을 독립
    // 조절한다. "음악만 끄기"는 별도 버튼 없이 BGM 슬라이더를 0 으로 내려 달성한다.
    const busRows: ReadonlyArray<{ bus: AudioBus; key: MessageKey; value: number }> = [
      { bus: 'bgm', key: 'settings.bgmVolume', value: s.bgmVolume },
      { bus: 'sfx', key: 'settings.sfxVolume', value: s.sfxVolume },
      { bus: 'ui', key: 'settings.uiVolume', value: s.uiVolume },
    ];
    for (const { bus, key, value } of busRows) {
      content.addChild(this.row(t(key), y, 0));
      // 값(%)·드래그 상태는 각 반복이 자기 것을 클로저로 잡는다(버스 간 간섭 없음).
      const pct = label(`${Math.round(value * 100)}%`, ROW_LABEL, COLOR.gold);
      pct.anchor.set(1, 0);
      pct.position.set(CW, y);
      content.addChild(pct);
      y += 36;
      const slider = this.buildSlider(value, (v) => {
        this.audio.setBusVolume(bus, v);
        pct.text = `${Math.round(v * 100)}%`;
      });
      slider.position.set(0, y);
      content.addChild(slider);
      y += KNOB_H + 30;
    }

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

    // 그래픽 품질 셀렉터(Phase 0 — plan §AC-0.7). 언어 버튼과 같은 관용구로 auto/low/med/high
    // 4버튼을 그린다. 좁은 열이라 문구가 짧고(자동/낮음/보통/높음), 선택된 티어만 노란 버튼.
    // 설정은 render-only(graphicsSettings 싱글턴에 저장만) — 이펙트 게이트 소비는 후속 phase.
    const g = graphicsSettings.getSettings();
    content.addChild(this.row(t('settings.graphics'), y, 0));
    y += 34;
    const qGap = 10;
    const qW = Math.floor((CW - qGap * 3) / 4);
    const qualities: ReadonlyArray<{ q: Quality; key: MessageKey }> = [
      { q: 'auto', key: 'settings.quality.auto' },
      { q: 'low', key: 'settings.quality.low' },
      { q: 'med', key: 'settings.quality.med' },
      { q: 'high', key: 'settings.quality.high' },
    ];
    qualities.forEach(({ q, key }, i) => {
      const sel = q === g.quality;
      const b = new PixiButton({
        texture: this.ui[sel ? 'ui_btn_yellow.png' : 'ui_btn_wood.png'],
        width: qW,
        height: BTN_H,
        label: stripEmoji(t(key)),
        fontSize: 18,
        ...(sel ? { labelColor: COLOR.darkLabel } : {}),
        onClick: () => {
          if (q === graphicsSettings.getSettings().quality) return;
          graphicsSettings.setQuality(q);
          this.render();
        },
      });
      b.container.position.set(i * (qW + qGap), y);
      content.addChild(b.container);
    });
    y += BTN_H + 26;

    // 접근성 감소 토글 2종(모션·발광). 사운드 토글과 같은 on/off 관용구 — 켜짐(감소 활성)이면
    // 노란 버튼. 광과민·멀미·저사양 대응이라 티어와 직교하며, 이 역시 저장만 한다.
    const reducedRows: ReadonlyArray<{
      key: MessageKey;
      get: () => boolean;
      set: (v: boolean) => void;
    }> = [
      {
        key: 'settings.reducedMotion',
        get: () => graphicsSettings.getSettings().reducedMotion,
        set: (v) => graphicsSettings.setReducedMotion(v),
      },
      {
        key: 'settings.reducedGlow',
        get: () => graphicsSettings.getSettings().reducedGlow,
        set: (v) => graphicsSettings.setReducedGlow(v),
      },
    ];
    for (const { key, get, set } of reducedRows) {
      const on = get();
      content.addChild(this.row(t(key), y));
      const toggle = new PixiButton({
        texture: this.ui[on ? 'ui_btn_yellow.png' : 'ui_btn_wood.png'],
        width: 150,
        height: BTN_H,
        label: stripEmoji(on ? t('settings.on') : t('settings.off')),
        fontSize: 20,
        ...(on ? { labelColor: COLOR.darkLabel } : {}),
        onClick: () => {
          set(!get());
          this.render();
        },
      });
      toggle.container.position.set(CW - 150, y);
      content.addChild(toggle.container);
      y += BTN_H + 26;
    }

    // 데미지 숫자 토글(AC-4.1). 위 감소 토글과 완전히 같은 on/off 관용구지만 의미는 반대다 —
    // 켜짐(on=노란 버튼)이 "데미지 숫자 표시"다(감소가 아니라 표시 선호). 기본 on 이라 처음엔
    // 노란 버튼으로 뜬다. 이 역시 render-only 로 graphicsSettings 싱글턴에 저장만 한다. 리스너는
    // render() 안에서 매번 새 버튼에 붙고 render() 시작의 removeChildren 으로 옛 버튼이 버려지므로
    // (톱니와 달리) 중복 등록 문제가 없다 — 위 토글들과 동일한 안전 경로다.
    {
      const on = graphicsSettings.getSettings().damageNumbers;
      content.addChild(this.row(t('settings.damageNumbers'), y));
      const toggle = new PixiButton({
        texture: this.ui[on ? 'ui_btn_yellow.png' : 'ui_btn_wood.png'],
        width: 150,
        height: BTN_H,
        label: stripEmoji(on ? t('settings.on') : t('settings.off')),
        fontSize: 20,
        ...(on ? { labelColor: COLOR.darkLabel } : {}),
        onClick: () => {
          graphicsSettings.setDamageNumbers(!graphicsSettings.getSettings().damageNumbers);
          this.render();
        },
      });
      toggle.container.position.set(CW - 150, y);
      content.addChild(toggle.container);
      y += BTN_H + 26;
    }

    // 계정: 라벨 한 줄 + 이메일 한 줄 + 로그아웃 버튼. 언어 행과 같은 관용구(라벨을 위에
    // 따로 두는 형태)를 쓴다 — 이메일은 길어서 오른쪽 150px 컨트롤 옆에 붙이면 잘린다.
    const account = this.account;
    if (account !== null) {
      content.addChild(this.row(t('settings.account'), y, 0));
      y += 34;

      // 이메일이 없을 수도 있다(provider 가 안 주는 경우). 그때도 "로그인됨"은 보여야 하므로
      // 대체 문구를 쓴다 — 빈 줄을 남기면 아래 버튼이 무엇에 대한 것인지 사라진다.
      const who = account.signedIn
        ? (account.email ?? t('settings.accountSignedIn'))
        : t('settings.notSignedIn');
      const whoLabel = label(who, ROW_LABEL, account.signedIn ? COLOR.gold : COLOR.muted);
      whoLabel.position.set(0, y);
      content.addChild(whoLabel);
      y += 36;

      if (account.signedIn) {
        const signOut = new PixiButton({
          texture: this.ui['ui_btn_wood.png'],
          width: CW,
          height: BTN_H,
          label: stripEmoji(t('settings.signOut')),
          fontSize: 20,
          onClick: () => {
            // 로그아웃은 곧 새로고침이므로 팝업이 남아 있을 이유가 없다.
            this.setOpen(false);
            account.onSignOut();
          },
        });
        signOut.container.position.set(0, y);
        content.addChild(signOut.container);
      } else {
        // 타이틀과 **같은 공식 버튼**을 쓴다. 한 제품 안에서 로그인 버튼이 두 모양이면
        // 어느 쪽이 진짜인지 알 수 없고, 게임 나무 버튼은 브랜딩 가이드라인 위반이다.
        const google = new GoogleSignInButton({
          width: CW,
          height: BTN_H,
          label: t('title.signInGoogle'),
          onClick: () => {
            // 로그인은 **닫지 않는다** — 성공하면 어차피 페이지가 떠나고, 실패하면 여기에
            // 안내를 띄워야 하는데 닫아 버리면 아무 일도 안 일어난 것처럼 보인다.
            this.setAccountNotice(null);
            account.onSignIn();
          },
        });
        google.container.position.set(0, y);
        content.addChild(google.container);
      }
      y += BTN_H + 26;

      if (this.accountNotice !== null) {
        const notice = label(this.accountNotice, ROW_LABEL, COLOR.cream);
        notice.position.set(0, y);
        content.addChild(notice);
        y += 34;
      }
    }

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

    // 실제 바닥을 재서 아래 여백을 위와 같게 잡되, 화면을 넘으면 가두고 스크롤한다.
    const contentH = content.getLocalBounds().bottom;
    const geo = settingsPanelGeometry(contentH);
    const panelH = geo.panelH;

    // 다른 화면과 달리 **밝은 화면 위에 뜨는 팝업**이라 기본 채움 알파(0.96)로는 뒤 화면이
    // 비친다(기지 맵 건물 카드의 글자가 그대로 읽혔다 — 확대 크롭에서 잡혔다). 불투명으로.
    this.panel.addChild(
      nineSlicePanel(PANEL_W, panelH, { texture: this.ui['ui_panel.png'], fillAlpha: 1 }),
    );
    if (geo.scrolls) {
      // 위치 표시(thumb)를 켠다 — 마스크가 깔끔하게 자르면 "더 있다"는 시각 신호가 아예
      // 사라진다(scrollArea 모듈 주석 ③). 지금 벌어진 일이 정확히 그것이었다.
      const holder = makeScrollArea(this.panel, {
        x: BOX.x,
        y: BOX.y,
        w: CW,
        h: geo.viewH,
        totalH: contentH,
        get: () => this.scroll,
        set: (v) => {
          this.scroll = v;
        },
        thumb: true,
        // 막대를 **창 밖 오른쪽**에 세운다. 설정 팝업의 컨트롤(버튼·슬라이더)은 창 폭 CW 를
        // 꽉 채우므로, 기본값(창 안쪽)으로 두면 막대가 그 위에 그대로 얹혀 겹쳐 보인다
        // (사용자 신고 2026-08-04). 패널 안쪽 여백은 60px(테두리 46 + 패드 14)이고 내부 채움은
        // 30px 부터라, 창 오른쪽 끝(BOX.right = PANEL_W − 60)과 채움 끝(PANEL_W − 30) 사이에
        // 30px 이 비어 있다 — 막대(6) + 여백(2) = 8px 은 여기에 충분히 들어간다.
        thumbOutside: true,
      });
      holder.addChild(content);
    } else {
      content.position.set(BOX.x, BOX.y);
      this.panel.addChild(content);
    }
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
