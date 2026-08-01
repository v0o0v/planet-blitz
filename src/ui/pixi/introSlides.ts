/**
 * 세계관 인트로 슬라이드 — 오스카 문명 배경 4컷 (스토리 시스템 Phase C).
 *
 * 첫 실행 1회(Phase C3 가 트리거) + 기록 보관소 "프롤로그" 탭 다시보기가 **같은 컴포넌트**를
 * 쓴다. 언제든 스킵 가능. 슬라이드 문구는 `data/lore` 의 `INTRO_SLIDES` 순서를 그대로 따르고
 * (`loreLabels.introTitle/introBody`), 컷마다 전용 키아트(`assets/intro/intro_<id>.webp`)가 있다.
 *
 * ## 나무 패널을 왜 없앴나
 * 이전 판은 불투명 나무 패널(1160×660) 안에 **176px 정사각 엠블럼**을 놓고 그것도 기존 UI
 * 아이콘(행성 오브·초상·크리스털)을 재사용했다. 그런데 사용자가 **처음 보는 순서는 인트로가
 * 먼저, 타이틀이 나중**이다. 타이틀이 풀블리드 시네마틱 키아트로 바뀐 뒤로는 그 낙차가
 * 그대로 첫인상이 됐다. 그래서 타이틀과 **같은 언어**로 맞춘다 — 키아트가 화면을 채우고,
 * 문구는 하단 스크림 위에 얹는다.
 *
 * ## 레이어 구조 (뒤 → 앞)
 * ```
 *   art     intro_<id>.webp   풀블리드(오버스캔 커버)
 *   scrim   하단 어둠 그라디언트 — 밝은 키아트 위 글자 대비
 *   text    제목 · 본문
 *   dots    진행 점
 *   button  Skip · Next/Begin
 * ```
 *
 * ## 텍스트 블록은 **아래에서 위로** 자란다
 * 본문 줄 수가 컷마다 다르다(2~3줄). 위에서 아래로 쌓으면 컷을 넘길 때마다 버튼과의 간격이
 * 들쭉날쭉해진다. 그래서 블록의 **바닥**을 `TEXT_BOTTOM` 에 고정하고 위로 키운다 — 진행
 * 점·버튼과의 거리가 항상 같다. (수동 줄바꿈은 넣지 않는다. 넣으면 로케일마다 고아 줄이
 * 생긴다 — `wordWrap` 에 맡기고 폭으로만 조절한다.)
 *
 * ## 품질 티어에 의존하지 않는다
 * 인트로는 **부팅 화면**이다. `graphicsTierController` 는 `INITIAL_TIER='high'` 로 시작해
 * 렌더 루프가 돌아야 갱신되므로 이 시점의 티어는 신뢰할 수 없다(타이틀이 실제로 밟은 함정 —
 * `titleScreen.resolveTitleTier` 헤더). 여기서는 아예 티어를 읽지 않는다 — 스프라이트 4장과
 * 그라디언트 1장뿐이라 저사양에서 끌 것이 없다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다. 컬러 이모지 금지(text.ts stripEmoji).
 */

import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { loadIntroTextures, introAssetName, type IntroTextures } from './introTextures.js';
import { verticalScrimTexture } from './scrim.js';
import { PixiButton } from './button.js';
import { t } from '../../i18n/index.js';
import { INTRO_SLIDES } from '../../../data/lore/index.js';
import { introTitle, introBody } from './loreLabels.js';

// --- 레이아웃 상수(디자인 스페이스 1920×1080) ---
/** 하단 어둠이 시작하는 y. 키아트는 아래쪽 1/3 이 어둡게 구성돼 있어 이 위는 건드리지 않는다. */
const SCRIM_TOP = 470;
/** 스크림 바닥 알파. 본문이 묻히지 않는 최소량(타이틀 0.5 보다 짙다 — 여긴 글이 많다). */
const SCRIM_ALPHA = 0.88;
/** 텍스트 블록의 바닥 y. 위로 자란다(헤더 참조). */
const TEXT_BOTTOM = 890;
/** 본문 줄바꿈 폭. 화면 폭의 70% — 더 넓히면 한 줄이 길어져 시선이 되돌아오지 못한다. */
const BODY_WRAP = 1344;
const TITLE_SIZE = 46;
const BODY_SIZE = 24;
const BODY_LINE_H = 38;
/** 제목 ↔ 본문 간격. */
const TITLE_GAP = 22;
const DOTS_Y = 936;
const BTN_H = 60;
const BTN_Y = 980;
const BTN_MARGIN = 140;
const SKIP_W = 200;
const NEXT_W = 240;

/** 키아트를 화면에 꽉 채운 스프라이트(중앙 크롭). 1376×768 → 1920×1080 은 1.4배 확대다. */
function coverSprite(tex: Texture): Sprite {
  const s = new Sprite(tex);
  s.anchor.set(0.5);
  s.scale.set(Math.max(DESIGN_WIDTH / tex.width, DESIGN_HEIGHT / tex.height));
  s.position.set(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);
  return s;
}

export interface IntroShowOptions {
  onDone: () => void;
}

export class IntroSlidesScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private ui: UiTextures = {};
  private art: IntroTextures = {};
  private onDone: (() => void) | null = null;
  private index = 0;

  constructor(stage: Container) {
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      if (this.root.visible) this.render();
    });
    void loadIntroTextures().then((tex) => {
      this.art = tex;
      if (this.root.visible) this.render();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  show(opts: IntroShowOptions): void {
    this.onDone = opts.onDone;
    this.index = 0;
    this.render();
    this.root.visible = true;
    this.raise();
  }

  hide(): void {
    this.root.visible = false;
    this.onDone = null;
  }

  private raise(): void {
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
  }

  private next(): void {
    if (this.index >= INTRO_SLIDES.length - 1) {
      this.finish();
      return;
    }
    this.index += 1;
    this.render();
  }

  private finish(): void {
    const cb = this.onDone;
    this.hide();
    cb?.();
  }

  private render(): void {
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }

    const slide = INTRO_SLIDES[this.index];
    if (slide === undefined) {
      this.finish();
      return;
    }

    // 바닥 — 키아트가 아직 없거나 실패해도 화면이 비지 않게. 뒤 화면으로 이벤트도 여기서 막는다.
    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static';
    this.root.addChild(bg);

    // --- 키아트(풀블리드) ---
    const artTex = this.art[introAssetName(slide.id)];
    if (artTex !== undefined) this.root.addChild(coverSprite(artTex));

    // --- 하단 스크림 --- 밝은 키아트 위에서 문구가 묻히지 않게(구현은 scrim.ts 헤더 참조).
    const scrimTex = verticalScrimTexture(0, SCRIM_ALPHA);
    if (scrimTex !== null) {
      const scrim = new Sprite(scrimTex);
      scrim.position.set(0, SCRIM_TOP);
      scrim.width = DESIGN_WIDTH;
      scrim.height = DESIGN_HEIGHT - SCRIM_TOP;
      this.root.addChild(scrim);
    } else {
      // 캔버스가 없는 환경(테스트) — 그라디언트 대신 평면 암막이라도 깐다.
      const flat = new Graphics();
      flat
        .rect(0, SCRIM_TOP, DESIGN_WIDTH, DESIGN_HEIGHT - SCRIM_TOP)
        .fill({ color: 0x0a0812, alpha: SCRIM_ALPHA * 0.7 });
      this.root.addChild(flat);
    }

    // --- 문구 --- 바닥 고정, 위로 자란다(헤더 참조).
    const title = new Text({
      resolution: 2,
      text: introTitle(slide),
      style: {
        fontFamily: UI_FONT,
        fontSize: TITLE_SIZE,
        fontWeight: '800',
        fill: COLOR.gold,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: BODY_WRAP,
        dropShadow: TEXT_SHADOW,
      },
    });
    const body = new Text({
      resolution: 2,
      text: introBody(slide),
      style: {
        fontFamily: UI_FONT,
        fontSize: BODY_SIZE,
        fill: COLOR.cream,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: BODY_WRAP,
        lineHeight: BODY_LINE_H,
        dropShadow: TEXT_SHADOW,
      },
    });
    const cx = DESIGN_WIDTH / 2;
    const bodyH = body.getLocalBounds().height;
    const titleH = title.getLocalBounds().height;
    title.anchor.set(0.5, 0);
    body.anchor.set(0.5, 0);
    title.position.set(cx, TEXT_BOTTOM - bodyH - TITLE_GAP - titleH);
    body.position.set(cx, TEXT_BOTTOM - bodyH);
    this.root.addChild(title);
    this.root.addChild(body);

    // --- 진행 점(현재 컷 강조) ---
    const dotR = 7;
    const dotGap = 26;
    const dotsW = (INTRO_SLIDES.length - 1) * dotGap;
    const dots = new Graphics();
    INTRO_SLIDES.forEach((_, i) => {
      dots
        .circle(cx - dotsW / 2 + i * dotGap, DOTS_Y, dotR)
        .fill({ color: i === this.index ? COLOR.gold : 0x5a4f66 });
    });
    this.root.addChild(dots);

    // --- Skip(좌) + Next/Begin(우). 마지막 컷이면 Begin 이 인트로를 닫는다 ---
    const last = this.index >= INTRO_SLIDES.length - 1;
    const skip = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: SKIP_W,
      height: BTN_H,
      fontSize: 19,
      label: t('intro.skip'),
      onClick: () => this.finish(),
    });
    skip.container.position.set(BTN_MARGIN, BTN_Y);
    this.root.addChild(skip.container);

    const nextBtn = new PixiButton({
      texture: this.ui['ui_btn_yellow.png'],
      fallbackColor: 0xc9a227, // 밝은 골드 버튼(폴백)
      width: NEXT_W,
      height: BTN_H,
      fontSize: 19,
      labelColor: COLOR.darkLabel,
      label: last ? t('intro.begin') : t('intro.next'),
      onClick: () => this.next(),
    });
    nextBtn.container.position.set(DESIGN_WIDTH - BTN_MARGIN - NEXT_W, BTN_Y);
    this.root.addChild(nextBtn.container);
  }
}
