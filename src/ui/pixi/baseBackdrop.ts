/**
 * 기지 화면 배경 — 풀블리드 시네마틱 키아트 + 절제된 패럴랙스 + 공기(티끌·광선) + 대비 베일.
 *
 * ## 왜 배경이 "한 장 붙이기"가 아닌가
 * 기지는 **오래 머무는 화면**이다. 정지 이미지 한 장은 몇 초만 지나면 배경이 아니라 벽지로
 * 읽히고, 그 위에 놓인 타일이 종이처럼 떠 보인다. 그래서 이 클래스는 ①시선에 따라 아주 조금
 * 움직이고 ②입력이 없어도 스스로 표류하며 ③공기(먼지·가끔 지나는 광선)를 가진다. 장소가
 * 살아 있어야 타일이 그 안에 **놓인 것**으로 읽힌다.
 *
 * ## 왜 타이틀보다 진폭이 작은가
 * 타이틀은 몇 초 보고 지나가는 화면이라 `MOUSE_RANGE 26`·`DRIFT_AMPL 14` 가 인상적으로 읽힌다.
 * 기지는 클릭 대상(타일·CTA)이 화면에 깔린 채 오래 머무는 화면이라, 같은 진폭이면 ①커서를
 * 움직일 때마다 클릭 목표가 흔들리고 ②멀미가 난다. 그래서 절반 아래로 줄였다. 배경만 움직이고
 * **전경(타일·크롬)은 리드가 고정으로 붙인다** — 움직이는 것과 눌러야 하는 것을 분리한다.
 *
 * ## 중앙 베일 — 왜 사각형 알파가 아닌가
 * 배경 중앙은 아치 너머 성운이라 밝다. 타일 격자(대략 x 46..1874 · y 134..704)가 그 위에 그냥
 * 앉으면 대비가 무너진다. 그렇다고 반투명 사각형을 깔면 **경계선이 그대로 보인다**(직선 알파
 * 단차는 인간 시각이 가장 잘 잡는 신호다). 띠를 겹쳐 부드럽게 만드는 근사는 이 리포가 이미
 * 밟은 함정이다 — 1px 겹침이 알파를 두 배로 만들어 가로줄이 생겼다(`scrim.ts` 헤더).
 *
 * 그래서 베일도 **픽셀로 굽는다**: 중앙에 평탄부(plateau)를 두고 가장자리로 갈수록 0 으로
 * 떨어지는 알파장을 캔버스에 직접 써서 `linear` 로 늘린다. 가로·세로 페이드를 곱하므로 모서리가
 * 자연히 둥글어지고, 경계에서 알파가 정확히 0 이라 **테두리가 원리적으로 생기지 않는다**.
 *
 * ## 자산 없이도 서야 한다
 * `tex` 가 `undefined` 면 절차적 폴백으로 넘어간다 — 짙은 바탕 + 청록·자홍 성운 얼룩(같은
 * 방식으로 구운 부드러운 블롭) + 비네트 + 티끌. 자산은 덧붙임이지 전제가 아니다.
 *
 * ## 품질 티어
 * ⚠️ `graphicsTierController.getActiveTier()` 만 읽으면 안 된다. 그 컨트롤러는 `'high'` 로 시작해
 * 렌더 루프가 돌아야 갱신되는데, 기지는 **부팅 직후 진입할 수 있는 화면**이라 그때는 아직
 * 'high' 다 — 사용자가 품질을 'low' 로 못 박아 두었어도 저사양 폴백이 통째로 무력화된다(실측,
 * 타이틀에서 같은 함정을 밟았다). 설정의 명시적 오버라이드를 **직접** 읽는다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 을 읽지도 쓰지도 않고 시간축은 벽시계다.
 */

import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { effectGates } from '../../render/qualityTier.js';
import { graphicsTierController } from '../../render/graphicsRuntime.js';
import { graphicsSettings } from '../../render/graphicsSettings.js';
import { verticalScrimTexture } from './scrim.js';

// --- 움직임(디자인 스페이스 1920×1080) ---
/** 마우스 추종 최대 변위(px). 타이틀 26 의 절반 이하 — 오래 머무는 화면이라 절제한다. */
const MOUSE_RANGE = 11;
/** 마우스 목표값 추종 시상수. 커서가 튀어도 배경은 부드럽게 따라간다. */
const MOUSE_LERP = 2.6;
/** 자동 드리프트 — 입력이 없어도(터치 기기) 화면이 정지하지 않게. */
const DRIFT_AMPL = 7;
/** 서로소에 가까운 주기 — 왕복이 눈에 띄지 않는다. */
const DRIFT_PERIOD_X = 41;
const DRIFT_PERIOD_Y = 59;
/**
 * 레이어별 패럴랙스 계수. 배경판이 가장 크게, 공기(티끌)는 앞이라 더 크게 움직인다 —
 * 근경이 원경보다 더 움직이는 것이 깊이의 정의다. 베일·비네트는 **전경 UI 에 붙는 것**이라
 * 아예 움직이지 않는다(움직이면 눌러 주는 자리가 타일에서 벗어난다).
 */
const PARALLAX = { art: 1, air: 1.45 } as const;

/**
 * 배경판 오버스캔 배수. 드리프트(≈±18px)로 밀려도 가장자리가 드러나지 않을 만큼 크게 그린다.
 * 여유가 없으면 화면 끝에 빈 줄이 스치는데, 그 한 줄이 "합성물"이라는 인상을 만든다.
 */
const OVERSCAN = 1.1;

// --- 중앙 베일(타일 격자가 앉는 자리) ---
/** 리드가 배치하는 타일 격자의 대략적 외곽(레인 계약). 베일 평탄부가 이 사각형을 덮는다. */
const VEIL_RECT = { x0: 46, y0: 134, x1: 1874, y1: 704 } as const;
/** 평탄부 바깥으로 알파가 0 까지 사라지는 거리(px). 넉넉해야 경계가 안 보인다. */
const VEIL_FEATHER = 190;
/** 베일 최대 알파. 성운을 죽이지 않으면서 타일 대비를 확보하는 최소량. */
const VEIL_ALPHA = 0.44;

/** 하단 비네트가 시작하는 y — CTA·메타 줄이 앉는 자리를 눌러 준다. */
const BOTTOM_SCRIM_TOP = 760;
const BOTTOM_SCRIM_ALPHA = 0.52;
/** 화면 네 변을 두르는 가장자리 비네트 최대 알파(중앙은 0). */
const EDGE_VIGNETTE_ALPHA = 0.5;

// --- 공기 ---
/** 먼지 티끌 수(고티어). 저티어는 절반. 타이틀보다 적다 — 오래 보는 화면이라 산만하면 안 된다. */
const MOTE_COUNT = 34;
/** 광선 스윕 1회 주기(초)와 통과 시간. 대부분의 시간 동안 화면에 없어야 "가끔"으로 읽힌다. */
const SHAFT_PERIOD = 21;
const SHAFT_SWEEP = 3.4;

/** 절차적 폴백 팔레트 — 타이틀·인트로와 같은 붓(청록·자홍 성운, 금빛 램프광). */
const FALLBACK_BASE = 0x120e1e;
const FALLBACK_NEBULA_TEAL = 0x2f8ca0;
const FALLBACK_NEBULA_MAGENTA = 0x8a3a72;
const FALLBACK_LAMP = 0xffca78;

interface Mote {
  gfx: Graphics;
  baseX: number;
  baseY: number;
  speed: number;
  phase: number;
  amp: number;
}

/**
 * 지금 유효한 이펙트 게이트. 오버라이드가 있으면 컨트롤러 대신 그 값을 쓴다 — 부팅 직후
 * 컨트롤러가 'high' 로 거짓말하는 창을 건너뛰기 위해서다(헤더 "품질 티어" 참조).
 */
function currentGates(): ReturnType<typeof effectGates> {
  const settings = graphicsSettings.getSettings();
  const tier =
    settings.quality === 'auto' ? graphicsTierController.getActiveTier() : settings.quality;
  return effectGates(tier, settings);
}

/** 0..1 을 부드럽게 잇는 표준 smoothstep(양 끝 기울기 0 — 단차가 눈에 남지 않는다). */
function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * 중심에서 `plateau` 까지 1, 거기서 경계까지 0 으로 떨어지는 축별 페이드. 가로·세로를 곱해
 * 쓰므로 모서리가 자연히 둥글고, 경계에서 정확히 0 이라 테두리가 생기지 않는다.
 */
function axisFade(u: number, plateau: number): number {
  const a = Math.abs(u);
  if (a <= plateau) return 1;
  if (plateau >= 1) return 1;
  return 1 - smoothstep((a - plateau) / (1 - plateau));
}

/**
 * 부드러운 사각형(또는 `plateau` 0 이면 블롭) 알파장을 픽셀로 굽는다.
 *
 * 캔버스가 없는 환경(vitest)에서는 `null` — 호출부는 이 텍스처들 없이도 컨테이너를 돌려줘야
 * 한다. `scrim.ts` 와 같은 방어다.
 *
 * @param invert true 면 중앙이 0, 가장자리가 최대(비네트).
 */
function bakeSoftRect(
  color: number,
  maxAlpha: number,
  plateauX: number,
  plateauY: number,
  invert = false,
): Texture | null {
  if (typeof document === 'undefined') return null;
  // 128×80 이면 충분하다 — 알파장이 저주파라 linear 확대로 이음매 없이 늘어난다.
  const w = 128;
  const h = 80;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const ny = ((y + 0.5) / h) * 2 - 1;
    const fy = axisFade(ny, plateauY);
    for (let x = 0; x < w; x++) {
      const nx = ((x + 0.5) / w) * 2 - 1;
      const inner = axisFade(nx, plateauX) * fy;
      // 비네트는 (1-inner) 를 한 번 더 눌러 중앙 근처가 일찍 어두워지지 않게 한다.
      const a = maxAlpha * (invert ? (1 - inner) ** 1.6 : inner);
      const i = (y * w + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new Texture({ source: new CanvasSource({ resource: canvas }) });
  tex.source.scaleMode = 'linear';
  return tex;
}

/** 텍스처를 화면 중앙에 `scale` 배 오버스캔으로 놓은 스프라이트(타이틀과 같은 규약). */
function coverSprite(tex: Texture, scale: number): Sprite {
  const s = new Sprite(tex);
  s.anchor.set(0.5);
  const k = Math.max(DESIGN_WIDTH / tex.width, DESIGN_HEIGHT / tex.height) * scale;
  s.scale.set(k);
  s.position.set(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);
  return s;
}

/** 결정적 의사난수 — 매 생성마다 배치가 튀지 않게 인덱스에서 파생한다(타이틀과 같은 식). */
function hash01(seed: number): number {
  return (((Math.sin(seed) * 43758.5453) % 1) + 1) % 1;
}

export class BaseBackdrop {
  /** 리드가 root 맨 뒤에 붙인다. */
  readonly view = new Container();

  /** 패럴랙스가 붙는 레이어. 베일·비네트는 여기 들어가지 않는다(고정). */
  private readonly artLayer = new Container();
  private readonly airLayer = new Container();

  private readonly motes: Mote[] = [];
  private shaft: Graphics | null = null;
  /** 절차적 폴백의 성운 얼룩 — 아주 느리게 숨 쉬듯 알파가 오간다. */
  private readonly nebulae: Sprite[] = [];

  private time = 0;
  private aimX = 0;
  private aimY = 0;
  private curX = 0;
  private curY = 0;
  private readonly onPointerMove: (e: PointerEvent) => void;

  constructor(tex: Texture | undefined) {
    // 캔버스가 아니라 window 에 건다 — 커서가 캔버스 밖으로 나가도 마지막 값이 굳지 않고,
    // Pixi 이벤트 계층(위에 깔린 타일이 포인터를 삼키는 문제)과도 무관해진다.
    this.onPointerMove = (e: PointerEvent) => {
      if (!this.view.visible) return;
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      this.aimX = ((e.clientX / w) * 2 - 1) * MOUSE_RANGE;
      this.aimY = ((e.clientY / h) * 2 - 1) * MOUSE_RANGE;
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    }

    const gates = currentGates();

    // --- 바닥 ---
    // 자산이 없거나 로드 전이어도 화면이 비지 않게. 오버스캔 배경 뒤에도 늘 깔아 둔다.
    const floor = new Graphics();
    floor.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: FALLBACK_BASE });
    this.view.addChild(floor);

    this.view.addChild(this.artLayer);
    this.view.addChild(this.airLayer);

    if (tex !== undefined) {
      this.artLayer.addChild(coverSprite(tex, OVERSCAN));
    } else {
      this.buildProceduralArt();
    }

    // --- 공기: 먼지 티끌 ---
    if (gates.particles !== 'off') {
      const count = gates.particles === 'min' ? Math.round(MOTE_COUNT / 2) : MOTE_COUNT;
      for (let i = 0; i < count; i++) {
        const r1 = hash01((i + 1) * 12.9898);
        const r2 = hash01((i + 1) * 78.233);
        const r3 = hash01((i + 1) * 39.425);
        const g = new Graphics();
        g.circle(0, 0, 1.1 + r3 * 2.1).fill({ color: 0xffe6bb, alpha: 0.16 + r3 * 0.22 });
        // 가산 — 어두운 배경 위에서 램프광 속 먼지처럼 읽힌다(tint 는 곱연산이라 밝힐 수 없다).
        g.blendMode = 'add';
        const mote: Mote = {
          gfx: g,
          baseX: r1 * DESIGN_WIDTH,
          baseY: DESIGN_HEIGHT * 0.45 + r2 * DESIGN_HEIGHT * 0.62,
          // 타이틀(6~22)보다 느리다 — 오래 보는 화면에서는 빠른 입자가 시선을 뺏는다.
          speed: 3.5 + r3 * 9,
          phase: r1 * Math.PI * 2,
          amp: 5 + r2 * 11,
        };
        g.position.set(mote.baseX, mote.baseY);
        this.airLayer.addChild(g);
        this.motes.push(mote);
      }
    }

    // --- 공기: 가끔 지나는 광선(가산) ---
    if (gates.halo) {
      // 단일 사각형이면 좌우 경계가 칼같이 서서 **광선이 아니라 띠**로 읽힌다(타이틀 실측).
      // Pixi Graphics 에는 그라디언트가 없으므로 폭이 다른 사각형을 중심에서 겹쳐 쌓아 단면을
      // 만든다 — 같은 색을 가산으로 쌓는 것이라 알파 이중가산 가로줄(scrim 함정)과는 무관하다.
      const shaft = new Graphics();
      const slabs = 7;
      for (let i = slabs; i >= 1; i--) {
        const halfW = 30 * i;
        const a = 0.075 * (1 - (i - 1) / slabs) ** 1.5;
        shaft
          .rect(-halfW, -DESIGN_HEIGHT, halfW * 2, DESIGN_HEIGHT * 3)
          .fill({ color: FALLBACK_LAMP, alpha: a });
      }
      shaft.rotation = 0.22;
      shaft.y = DESIGN_HEIGHT / 2;
      shaft.blendMode = 'add';
      shaft.visible = false;
      this.airLayer.addChild(shaft);
      this.shaft = shaft;
    }

    // --- 대비 장치(고정 — 패럴랙스 밖) ---
    this.buildVeil();
    this.buildVignettes();
  }

  /** 자산이 없을 때의 절차적 배경 — 짙은 바탕 위 성운 얼룩 + 좌우 램프광. */
  private buildProceduralArt(): void {
    const put = (
      tex: Texture | null,
      x: number,
      y: number,
      w: number,
      h: number,
      alpha: number,
      add: boolean,
    ): void => {
      if (tex === null) return;
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.width = w;
      s.height = h;
      s.position.set(x, y);
      s.alpha = alpha;
      if (add) s.blendMode = 'add';
      this.artLayer.addChild(s);
      this.nebulae.push(s);
    };

    // 성운 두 덩이 — 중앙 위쪽(아치 너머)에서 청록·자홍이 겹친다.
    put(bakeSoftRect(FALLBACK_NEBULA_TEAL, 1, 0, 0), 900, 380, 1500, 900, 0.5, true);
    put(bakeSoftRect(FALLBACK_NEBULA_MAGENTA, 1, 0, 0), 1180, 300, 1150, 720, 0.34, true);
    // 좌우 벽의 금색 램프광 — 화면 양옆을 따뜻하게 붙잡아 "실내"로 읽히게 한다.
    put(bakeSoftRect(FALLBACK_LAMP, 1, 0, 0), 120, 620, 900, 1300, 0.2, true);
    put(bakeSoftRect(FALLBACK_LAMP, 1, 0, 0), DESIGN_WIDTH - 120, 620, 900, 1300, 0.2, true);
  }

  /**
   * 중앙 베일 — 타일 격자가 앉을 자리를 눌러 준다. 평탄부가 격자 사각형을 덮고, 그 바깥
   * `VEIL_FEATHER` 만큼에서 알파가 0 으로 사라진다(경계선이 생기지 않는 유일한 방식).
   */
  private buildVeil(): void {
    const halfW = (VEIL_RECT.x1 - VEIL_RECT.x0) / 2 + VEIL_FEATHER;
    const halfH = (VEIL_RECT.y1 - VEIL_RECT.y0) / 2 + VEIL_FEATHER;
    const tex = bakeSoftRect(
      0x0a0812,
      VEIL_ALPHA,
      1 - VEIL_FEATHER / halfW,
      1 - VEIL_FEATHER / halfH,
    );
    if (tex === null) return;
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    s.width = halfW * 2;
    s.height = halfH * 2;
    s.position.set((VEIL_RECT.x0 + VEIL_RECT.x1) / 2, (VEIL_RECT.y0 + VEIL_RECT.y1) / 2);
    this.view.addChild(s);
  }

  /** 하단 스크림(CTA·메타 줄 자리) + 네 변 비네트(시선을 화면 안쪽으로 모은다). */
  private buildVignettes(): void {
    const edge = bakeSoftRect(0x07050e, EDGE_VIGNETTE_ALPHA, 0.12, 0.1, true);
    if (edge !== null) {
      const s = new Sprite(edge);
      s.position.set(0, 0);
      s.width = DESIGN_WIDTH;
      s.height = DESIGN_HEIGHT;
      this.view.addChild(s);
    }
    // 세로 램프는 공용 `scrim.ts` 를 쓴다 — 띠 근사가 만들던 가로줄을 없앤 자리다.
    const scrimTex = verticalScrimTexture(0, BOTTOM_SCRIM_ALPHA);
    if (scrimTex !== null) {
      const scrim = new Sprite(scrimTex);
      scrim.position.set(0, BOTTOM_SCRIM_TOP);
      scrim.width = DESIGN_WIDTH;
      scrim.height = DESIGN_HEIGHT - BOTTOM_SCRIM_TOP;
      this.view.addChild(scrim);
    }
  }

  /** 매 프레임 진행. `dt` 는 **벽시계 초**다. 숨겨져 있으면 아무것도 하지 않는다. */
  update(dt: number): void {
    if (!this.view.visible) return;
    this.time += dt;

    // 지수 추종 — 프레임률이 달라도 같은 시상수가 되도록 dt 지수 감쇠를 쓴다.
    const k = 1 - Math.exp(-MOUSE_LERP * dt);
    this.curX += (this.aimX - this.curX) * k;
    this.curY += (this.aimY - this.curY) * k;

    const driftX = Math.sin((this.time / DRIFT_PERIOD_X) * Math.PI * 2) * DRIFT_AMPL;
    const driftY = Math.cos((this.time / DRIFT_PERIOD_Y) * Math.PI * 2) * DRIFT_AMPL * 0.6;
    const ox = this.curX + driftX;
    const oy = this.curY + driftY;

    this.artLayer.position.set(ox * PARALLAX.art, oy * PARALLAX.art);
    this.airLayer.position.set(ox * PARALLAX.air, oy * PARALLAX.air);

    // 먼지 — 아주 느리게 떠오른다. 위로 벗어나면 아래로 되감는다.
    for (const m of this.motes) {
      m.gfx.y = m.baseY - ((this.time * m.speed) % (DESIGN_HEIGHT * 0.75));
      m.gfx.x = m.baseX + Math.sin(this.time * 0.4 + m.phase) * m.amp;
    }

    // 성운 얼룩의 미세한 호흡 — 폴백에서도 화면이 완전히 정지하지 않게.
    for (let i = 0; i < this.nebulae.length; i++) {
      const s = this.nebulae[i];
      if (s === undefined) continue;
      s.alpha = this.nebulaAlpha(i);
    }

    // 광선 — 주기의 앞부분(SHAFT_SWEEP 초) 동안만 화면을 가로지른다.
    const shaft = this.shaft;
    if (shaft !== null) {
      const phase = this.time % SHAFT_PERIOD;
      if (phase < SHAFT_SWEEP) {
        const p = phase / SHAFT_SWEEP;
        shaft.visible = true;
        shaft.x = DESIGN_WIDTH * (-0.3 + p * 1.6);
        // 양 끝에서 0 이 되는 사인 페이드 — 갑자기 나타났다 사라지지 않게.
        shaft.alpha = Math.sin(p * Math.PI);
      } else {
        shaft.visible = false;
      }
    }
  }

  /** 폴백 성운 i 의 현재 알파(기준값 ±10% 를 서로 다른 느린 주기로 오간다). */
  private nebulaAlpha(i: number): number {
    const base = [0.5, 0.34, 0.2, 0.2][i] ?? 0.3;
    const period = 23 + i * 7;
    return base * (1 + 0.1 * Math.sin((this.time / period) * Math.PI * 2 + i));
  }

  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.onPointerMove);
    }
    this.motes.length = 0;
    this.nebulae.length = 0;
    this.shaft = null;
    this.view.destroy({ children: true });
  }
}
