/**
 * 타이틀 화면 — 풀블리드 시네마틱 키아트 + 패럴랙스 + 3D 함선.
 *
 * ## 나무 패널을 왜 없앴나
 * 이전 판은 불투명 나무 패널(`nineSlicePanel`, `fillAlpha: 1`)이 화면 중앙 980px 을 덮고 그
 * 안에 텍스트 로고·버튼이 들어 있었다. 키아트를 넣어도 패널이 그 위를 가리면 **키아트가
 * 보이지 않는다** — 패널을 남긴 채 배경만 바꾸는 것은 반쪽짜리다. 그래서 패널을 걷어내고
 * 로고·버튼을 화면에 직접 띄운다(AAA 타이틀의 표준형).
 *
 * 다만 이 화면이 애초에 캔버스로 이관된 이유가 **좌상단 설정 톱니가 가려지는 것**이었다
 * (2026-07-20 사용자 판정). 패널을 없애도 톱니는 렌더 루프의 `settings.raise()` 로 매 프레임
 * 최상단에 오므로 계속 보인다 — 다만 이제 그 아래가 밝은 키아트일 수 있다는 점이 다르다.
 *
 * ## 레이어 구조 (뒤 → 앞)
 * ```
 *   sky      title_sky.webp     가장 느린 드리프트
 *   planet   title_planet.webp  중간
 *   ship     TitleShip3D        3D, 창 안을 가로지른다
 *   frame    title_frame.webp   아치 전경판 — 개구부만 투명
 *   shaft    광선 스윕(가산)
 *   logo     title_logo.webp
 *   scrim    하단 어둠 그라디언트
 *   button   시작 버튼 · 부제 · 첫 실행 안내
 * ```
 * **마스크가 없다.** 전경판이 개구부 바깥을 전부 불투명하게 덮으므로, 뒤 레이어는 그냥 뒤에
 * 있기만 하면 창 밖으로 새지 않는다. Pixi 마스크를 쓰면 배치 오차가 곧 결함이 되는데(마스크
 * Graphics 는 히트 테스트에서도 빠진다) 그 위험을 통째로 없앤 것이다.
 *
 * ## 왜 하단에 스크림이 필요한가
 * 이 키아트는 **바닥이 밝은 금색**이다. 그 위에 버튼을 그냥 놓으면 라벨이 묻힌다. 버튼 뒤에
 * 아래로 갈수록 짙어지는 어둠을 깔아 대비를 만든다(키아트를 가리지 않는 최소량).
 *
 * ## 결정론(ADR-0005)
 * 순수 render/UI 레이어다. sim 을 읽지도 쓰지도 않고 시간축은 벽시계다(연출 전용).
 */

import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { t } from '../../i18n/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { effectGates, type QualityTier } from '../../render/qualityTier.js';
import { graphicsTierController } from '../../render/graphicsRuntime.js';
import { graphicsSettings, type Quality } from '../../render/graphicsSettings.js';
import { TitleShip3D } from '../../render/three3d/titleShip.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { loadTitleTextures, type TitleTextures } from './titleTextures.js';
import { PixiButton } from './button.js';
import { stripEmoji } from './text.js';

export interface TitleShowOpts {
  /** true = 시작 버튼이 강제 튜토리얼 런을 띄운다(첫 실행). */
  firstRun: boolean;
  onStart: () => void;
}

// --- 레이아웃 상수(디자인 스페이스 1920×1080) ---
const START_W = 460;
const START_H = 86;
const START_Y = 858;
/**
 * 로고 자산은 **투명 여백이 잘려 있다**(`title-art-prep keyblack --trim`). 그래서 스프라이트
 * 박스가 곧 글자 박스이고, `LOGO_Y` 는 글자 윗변을 그대로 가리킨다. 여백이 남아 있던 판에서는
 * 같은 y=96 이 글자를 화면 한복판(y≈490)에 놓아 행성을 가렸다.
 */
const LOGO_W = 1150;
const LOGO_Y = 74;
const TAG_Y = 690;

/**
 * 레이어별 패럴랙스 계수(마우스 오프셋 · 자동 드리프트에 곱한다). 뒤일수록 작게 —
 * 원경이 근경보다 덜 움직이는 것이 깊이의 정의다. 전경판만 **부호가 반대**라 창틀이
 * 시선과 함께 미세하게 반대로 밀리며 입체감을 만든다.
 */
const PARALLAX = { sky: 0.35, planet: 0.62, ship: 0.85, frame: -0.18, logo: -0.08 } as const;

/** 마우스 추종 최대 변위(px, 디자인 스페이스). 크게 잡으면 멀미가 나므로 절제한다. */
const MOUSE_RANGE = 26;
/** 마우스 목표값 추종 시상수 — 커서가 튀어도 화면은 부드럽게 따라간다. */
const MOUSE_LERP = 3.2;
/** 자동 드리프트(마우스가 없어도, 터치 기기에서도 화면이 살아 있게). */
const DRIFT_AMPL = 14;
const DRIFT_PERIOD_X = 37;
const DRIFT_PERIOD_Y = 53;

/**
 * 뒤 레이어의 오버스캔 배수. 드리프트로 밀려도 가장자리가 드러나지 않을 만큼 크게 그린다.
 * 전경판은 화면을 덮는 것이 임무라 여유가 조금만 있으면 된다.
 */
const OVERSCAN = { sky: 1.22, frame: 1.06 } as const;

/** 먼지 티끌 수(고티어). 저티어는 절반. */
const MOTE_COUNT = 46;

/** 광선 스윕 1회 주기(초)와 통과 시간. 대부분의 시간 동안 화면에 없다 — 가끔 지나야 눈에 띈다. */
const SHAFT_PERIOD = 13;
const SHAFT_SWEEP = 2.6;

/**
 * 지금 유효한 이펙트 게이트.
 *
 * ⚠️ **`graphicsTierController.getActiveTier()` 만 읽으면 안 된다.** 그 컨트롤러는
 * `INITIAL_TIER = 'high'` 로 시작해 렌더 루프가 `tick()` 을 돌려야 갱신되는데, 타이틀은
 * **부팅 시점**에 뜨므로 그때는 아직 'high' 다. 사용자가 설정에서 품질을 'low' 로 못 박아
 * 두었어도 타이틀은 그것을 보지 못한 채 3D 를 올린다(실측 — 저사양 폴백이 통째로 무력화됐다).
 *
 * 그래서 **명시적 오버라이드가 있으면 그 값을 그대로 쓴다.** `selectTier` 도 오버라이드를
 * 잠그므로 의미가 같고, 다만 컨트롤러가 그 사실을 아는 시점보다 우리가 먼저 알 뿐이다.
 */
export function resolveTitleTier(quality: Quality, autoTier: QualityTier): QualityTier {
  return quality === 'auto' ? autoTier : quality;
}

function currentGates(): ReturnType<typeof effectGates> {
  const settings = graphicsSettings.getSettings();
  return effectGates(
    resolveTitleTier(settings.quality, graphicsTierController.getActiveTier()),
    settings,
  );
}

interface Mote {
  gfx: Graphics;
  baseX: number;
  baseY: number;
  speed: number;
  phase: number;
  amp: number;
}

function centeredText(text: string, size: number, fill: number): Text {
  const el = new Text({
    resolution: 2,
    text,
    style: {
      fontFamily: UI_FONT,
      fontSize: size,
      fontWeight: '700',
      fill,
      align: 'center',
      dropShadow: TEXT_SHADOW,
    },
  });
  el.anchor.set(0.5, 0);
  el.x = DESIGN_WIDTH / 2;
  return el;
}

/** 텍스처를 화면 중앙에 `scale` 배 오버스캔으로 놓은 스프라이트. */
function coverSprite(tex: Texture, scale: number): Sprite {
  const s = new Sprite(tex);
  s.anchor.set(0.5);
  const k = Math.max(DESIGN_WIDTH / tex.width, DESIGN_HEIGHT / tex.height) * scale;
  s.scale.set(k);
  s.position.set(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);
  return s;
}

export class TitleScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private ui: UiTextures = {};
  private art: TitleTextures = {};
  private opts: TitleShowOpts | null = null;

  /** 패럴랙스가 붙는 레이어들(없을 수도 있다 — 자산 로드 전/실패). */
  private layers: Partial<Record<keyof typeof PARALLAX, Container>> = {};
  private motes: Mote[] = [];
  private shaft: Graphics | null = null;
  private moteHost = new Container();

  /** 3D 함선. 저티어·WebGL 실패면 끝까지 null 이다(배경만 나온다). */
  private ship: TitleShip3D | null = null;
  /** 로드를 여러 번 걸지 않기 위한 래치(show/hide 를 오가도 1회). */
  private shipRequested = false;

  private time = 0;
  /** 마우스 목표 오프셋과 현재(보간) 오프셋. */
  private aimX = 0;
  private aimY = 0;
  private curX = 0;
  private curY = 0;
  private readonly onPointerMove: (e: PointerEvent) => void;

  constructor(stage: Container) {
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);

    // 캔버스가 아니라 window 에 건다 — 커서가 캔버스 밖으로 나가도 마지막 값이 굳지 않고,
    // Pixi 이벤트 계층(전경판이 포인터를 삼키는 문제)과도 무관해진다.
    this.onPointerMove = (e: PointerEvent) => {
      if (!this.root.visible) return;
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      this.aimX = ((e.clientX / w) * 2 - 1) * MOUSE_RANGE;
      this.aimY = ((e.clientY / h) * 2 - 1) * MOUSE_RANGE;
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    }

    void loadUiTextures().then((tex) => {
      this.ui = tex;
      if (this.root.visible) this.render();
    });
    void loadTitleTextures().then((tex) => {
      this.art = tex;
      if (this.root.visible) this.render();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  show(opts: TitleShowOpts): void {
    this.opts = opts;
    this.time = 0;
    this.render();
    this.root.visible = true;
    // 다른 캔버스 화면(카드 등)이 자기를 맨 앞으로 올려 둔 뒤일 수 있다 — 타이틀도 올린다.
    // 설정은 렌더 루프의 raise() 로 다음 프레임에 다시 그 위로 돌아온다(크롬 UI).
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
    // DOM HUD(HP/LV, 좌하단)는 런 전용 — 캔버스 메타 화면 위에 떠 보이므로 숨긴다.
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = 'hidden';
    this.requestShip();
  }

  hide(): void {
    this.root.visible = false;
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = '';
  }

  /**
   * 화면을 완전히 버린다(WebGL 컨텍스트 반납 포함). 현재 호출자는 없지만 — 타이틀은 앱 수명
   * 내내 재사용된다 — 하네스/테스트가 컨텍스트를 정리할 수 있게 열어 둔다.
   */
  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.onPointerMove);
    }
    this.ship?.destroy();
    this.ship = null;
    this.root.destroy({ children: true });
  }

  /**
   * 3D 함선 로드를 **한 번만** 건다. 저티어면 아예 시도하지 않는다 — 실패해서 끄는 것과
   * 처음부터 안 만드는 것은 비용이 다르다(컨텍스트를 점유했다 버리는 낭비가 없다).
   */
  private requestShip(): void {
    if (this.shipRequested) return;
    if (!currentGates().model3d) return;
    this.shipRequested = true;
    void TitleShip3D.create().then((ship) => {
      if (ship === null) return; // 폴백: 배경만.
      this.ship = ship;
      this.attachShip();
    });
  }

  /** 로드가 끝난 함선을 현재 레이어 트리에 붙인다(렌더 이후에 끝날 수 있어 분리돼 있다). */
  private attachShip(): void {
    const ship = this.ship;
    const host = this.layers.ship;
    if (ship === null || host === undefined) return;
    const sprite = new Sprite(ship.texture);
    sprite.anchor.set(0.5);
    // 아치 개구부 안쪽, 행성보다 앞. 창 중앙에서 좌하로 — 행성과 겹치지 않는 자리다.
    sprite.position.set(DESIGN_WIDTH * 0.365, DESIGN_HEIGHT * 0.545);
    // 오프스크린 렌더(768×512)를 1.35배로 띄운다. 모델은 프레이밍 여유를 두고 그려지므로
    // 실제 함선 실루엣은 이 박스의 약 2/3 다(≈690×310).
    sprite.scale.set(1.35);
    host.removeChildren();
    host.addChild(sprite);
  }

  /**
   * 매 프레임 진행. `dt` 는 **벽시계 초**다. 화면이 숨겨져 있으면 아무것도 하지 않는다 —
   * 특히 3D 는 여기서만 그려지므로 타이틀 밖에서는 GPU 비용이 0 이다.
   */
  update(dt: number): void {
    if (!this.root.visible) return;
    this.time += dt;

    // 마우스 오프셋 지수 추종. 프레임률이 달라도 같은 시상수가 되도록 dt 지수 감쇠를 쓴다.
    const k = 1 - Math.exp(-MOUSE_LERP * dt);
    this.curX += (this.aimX - this.curX) * k;
    this.curY += (this.aimY - this.curY) * k;

    // 자동 드리프트 — 입력이 없어도(터치 기기) 화면이 정지하지 않게. 서로소 주기로 왕복이
    // 눈에 띄지 않게 한다.
    const driftX = Math.sin((this.time / DRIFT_PERIOD_X) * Math.PI * 2) * DRIFT_AMPL;
    const driftY = Math.cos((this.time / DRIFT_PERIOD_Y) * Math.PI * 2) * DRIFT_AMPL * 0.6;
    const ox = this.curX + driftX;
    const oy = this.curY + driftY;

    for (const [name, factor] of Object.entries(PARALLAX) as [keyof typeof PARALLAX, number][]) {
      const layer = this.layers[name];
      if (layer === undefined) continue;
      layer.x = ox * factor;
      layer.y = oy * factor;
    }

    // 먼지 티끌 — 창 안을 아주 느리게 떠오른다. 위로 벗어나면 아래로 되감는다.
    for (const m of this.motes) {
      const y = m.baseY - ((this.time * m.speed) % (DESIGN_HEIGHT * 0.5));
      m.gfx.y = y;
      m.gfx.x = m.baseX + Math.sin(this.time * 0.6 + m.phase) * m.amp;
    }

    // 광선 스윕 — 주기의 앞부분(SHAFT_SWEEP 초) 동안만 화면을 가로지른다.
    const shaft = this.shaft;
    if (shaft !== null) {
      const phase = this.time % SHAFT_PERIOD;
      if (phase < SHAFT_SWEEP) {
        const p = phase / SHAFT_SWEEP;
        shaft.visible = true;
        shaft.x = DESIGN_WIDTH * (-0.25 + p * 1.5);
        // 양 끝에서 0 이 되는 사인 페이드 — 갑자기 나타났다 사라지지 않게. 단면 알파는 이미
        // 슬랩에 구워져 있으므로 여기서는 0..1 로만 곱한다.
        shaft.alpha = Math.sin(p * Math.PI);
      } else {
        shaft.visible = false;
      }
    }

    // 3D 게이트는 **매 프레임 다시 본다.** 두 가지가 런타임에 바뀌기 때문이다:
    //  ① 부팅 직후엔 자동 티어가 아직 확정 전이라, 'auto' 사용자는 여기서 처음 자격을 얻는다.
    //  ② FPS 가 떨어져 티어가 강등되면 **이미 로드된 함선을 계속 그리는 것이 곧 원인**이 된다 —
    //     한 번 켜면 끝인 구조로 두면 저티어 폴백이 사후에는 아무 일도 하지 못한다.
    const shipLayer = this.layers.ship;
    if (currentGates().model3d) {
      this.requestShip();
      if (shipLayer !== undefined) shipLayer.visible = true;
      this.ship?.update(dt);
    } else if (shipLayer !== undefined) {
      shipLayer.visible = false; // 그리지도 않고 보이지도 않는다.
    }
  }

  private render(): void {
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }
    this.layers = {};
    this.motes = [];
    this.shaft = null;

    const opts = this.opts;
    if (opts === null) return;

    const gates = currentGates();

    // 바닥 — 자산이 아직 없거나 실패해도 화면이 비지 않게. 이벤트도 여기서 막는다.
    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static';
    this.root.addChild(bg);

    const addLayer = (name: keyof typeof PARALLAX): Container => {
      const c = new Container();
      this.root.addChild(c);
      this.layers[name] = c;
      return c;
    };

    // --- 하늘 ---
    const skyTex = this.art['title_sky.webp'];
    const sky = addLayer('sky');
    if (skyTex !== undefined) sky.addChild(coverSprite(skyTex, OVERSCAN.sky));

    // --- 행성 ---
    const planetTex = this.art['title_planet.webp'];
    const planet = addLayer('planet');
    if (planetTex !== undefined) {
      const s = new Sprite(planetTex);
      s.anchor.set(0.5);
      s.scale.set(660 / planetTex.width);
      // 창 중앙보다 우측·아래 — 로고 아래를 비우고, 함선이 지날 좌하 공간을 남긴다.
      s.position.set(DESIGN_WIDTH * 0.565, DESIGN_HEIGHT * 0.47);
      planet.addChild(s);
    }

    // --- 3D 함선 자리(로드가 끝나면 attachShip 이 채운다) ---
    addLayer('ship');
    if (this.ship !== null) this.attachShip();

    // --- 아치 전경판 ---
    const frameTex = this.art['title_frame.webp'];
    const frame = addLayer('frame');
    if (frameTex !== undefined) frame.addChild(coverSprite(frameTex, OVERSCAN.frame));

    // --- 먼지 티끌(전경판 앞 — 창 안팎 모두에 떠 있는 공기) ---
    this.moteHost = new Container();
    this.root.addChild(this.moteHost);
    if (gates.particles !== 'off') {
      const count = gates.particles === 'min' ? Math.round(MOTE_COUNT / 2) : MOTE_COUNT;
      for (let i = 0; i < count; i++) {
        // 결정적 의사난수 — 매 render 마다 배치가 튀지 않게 인덱스에서 파생한다.
        const r1 = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
        const r2 = ((Math.sin(i * 78.233) * 43758.5453) % 1 + 1) % 1;
        const r3 = ((Math.sin(i * 39.425) * 43758.5453) % 1 + 1) % 1;
        const g = new Graphics();
        const radius = 1.2 + r3 * 2.4;
        g.circle(0, 0, radius).fill({ color: 0xdff6ff, alpha: 0.22 + r3 * 0.3 });
        g.blendMode = 'add';
        const mote: Mote = {
          gfx: g,
          baseX: r1 * DESIGN_WIDTH,
          baseY: DESIGN_HEIGHT * 0.5 + r2 * DESIGN_HEIGHT * 0.5,
          speed: 6 + r3 * 16,
          phase: r1 * Math.PI * 2,
          amp: 6 + r2 * 14,
        };
        g.position.set(mote.baseX, mote.baseY);
        this.moteHost.addChild(g);
        this.motes.push(mote);
      }
    }

    // --- 광선 스윕(가산). 기울어진 넓은 띠 하나 ---
    if (gates.halo) {
      // 단일 사각형이면 좌우 경계가 칼같이 서서 **광선이 아니라 띠**로 읽힌다(실측). Pixi
      // Graphics 에는 그라디언트가 없으므로, 폭이 다른 사각형을 중심에서 겹쳐 쌓아 가장자리가
      // 부드럽게 사라지는 단면을 만든다 — 필터 1패스보다 싸고 저티어에서도 안전하다.
      const shaft = new Graphics();
      const slabs = 7;
      for (let i = slabs; i >= 1; i--) {
        const halfW = 26 * i;
        const a = 0.16 * (1 - (i - 1) / slabs) ** 1.5;
        shaft.rect(-halfW, -DESIGN_HEIGHT, halfW * 2, DESIGN_HEIGHT * 3).fill({
          color: 0xbfe9ff,
          alpha: a,
        });
      }
      shaft.rotation = 0.28;
      shaft.y = DESIGN_HEIGHT / 2;
      shaft.blendMode = 'add';
      shaft.visible = false;
      this.root.addChild(shaft);
      this.shaft = shaft;
    }

    // --- 로고 ---
    const logoTex = this.art['title_logo.webp'];
    const logoLayer = addLayer('logo');
    if (logoTex !== undefined) {
      const s = new Sprite(logoTex);
      s.anchor.set(0.5, 0);
      s.scale.set(LOGO_W / logoTex.width);
      s.position.set(DESIGN_WIDTH / 2, LOGO_Y);
      logoLayer.addChild(s);
    } else {
      // 자산 실패 폴백 — 예전 텍스트 로고. 화면에 제목이 없는 상태보다는 낫다.
      const fallback = new Text({
        resolution: 2,
        text: 'PLANET BLITZ',
        style: {
          fontFamily: UI_FONT,
          fontSize: 96,
          fontWeight: '900',
          fill: COLOR.gold,
          align: 'center',
          dropShadow: TEXT_SHADOW,
          letterSpacing: 6,
        },
      });
      fallback.anchor.set(0.5, 0);
      fallback.position.set(DESIGN_WIDTH / 2, LOGO_Y + 120);
      logoLayer.addChild(fallback);
    }

    // --- 하단 스크림 ---
    // 이 키아트는 바닥이 밝은 금색이라 버튼 라벨이 묻힌다. 아래로 갈수록 짙어지는 띠를 깐다.
    // Pixi Graphics 에 그라디언트가 없으므로 얇은 사각형을 겹쳐 근사한다(필터보다 싸다).
    const scrim = new Container();
    const bands = 18;
    const scrimTop = TAG_Y - 60;
    const bandH = (DESIGN_HEIGHT - scrimTop) / bands;
    for (let i = 0; i < bands; i++) {
      const g = new Graphics();
      const a = 0.5 * ((i + 1) / bands) ** 1.6;
      g.rect(0, scrimTop + i * bandH, DESIGN_WIDTH, bandH + 1).fill({ color: 0x0a0812, alpha: a });
      scrim.addChild(g);
    }
    this.root.addChild(scrim);

    // --- 부제 · 버튼 · 첫 실행 안내 ---
    const tag = centeredText(t('title.tag'), 27, COLOR.cream);
    tag.y = TAG_Y;
    this.root.addChild(tag);

    const start = new PixiButton({
      texture: this.ui['ui_btn_yellow.png'],
      width: START_W,
      height: START_H,
      label: stripEmoji(opts.firstRun ? t('title.startTutorial') : t('title.enterBase')),
      fontSize: 32,
      labelColor: COLOR.darkLabel,
      onClick: () => {
        this.hide();
        opts.onStart();
      },
    });
    start.container.position.set((DESIGN_WIDTH - START_W) / 2, START_Y);
    this.root.addChild(start.container);

    if (opts.firstRun) {
      const note = centeredText(t('title.note'), 22, COLOR.muted);
      note.y = START_Y + START_H + 18;
      this.root.addChild(note);
    }
  }
}
