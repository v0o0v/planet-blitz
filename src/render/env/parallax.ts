/**
 * 대규모 저주파 환경 변조 레이어 (슬롯 `floor`) — **메커니즘만** 여기 있고 행성별 색·알파·
 * 주기는 전부 {@link file://./contracts/parallax.ts} 의 `ParallaxTheme` 로 주입된다.
 *
 * ## 왜 `far` 가 아니라 `floor` 인가 (슬롯 근거)
 * 원래 슬롯은 `far`(지형 바닥 뒤)였다. 그런데 Wang autotile 바닥이 활성인 행성에서
 * `AutotileBackground.update` 는 가시 사각형 전체(+MARGIN 2타일 링)를 **불투명 스프라이트로
 * 빈틈없이** 채운다({@link file://../autotile.ts} `ensureCoverage`/`update`). main.ts 는
 * `env.slot('far')` 를 autotile 레이어 **아래** 인덱스에 끼우므로, `far` 에 무엇을 그리든 화면에
 * 단 한 픽셀도 나오지 않는다 — 이 리포의 단골 결함("만들었는데 안 보인다")을 그대로 재현한다.
 *
 * 그래서 슬롯을 `floor`(지형 위·엔티티 아래)로 옮기고, 역할을 **지형을 통해 비치는 원경**이
 * 아니라 **지형 위에 얹는 거대 스케일 저주파 명암·색온도 변조**로 재정의했다. 시차는 여전히
 * 성립한다 — 지형은 카메라 1.0배로 흐르는데 이 변조 필드는 1 미만의 배율로 흐르므로, 카메라가
 * 움직이면 "지형이 어떤 지역 ↔ 다른 지역을 지나간다"로 읽힌다. 정지한 막이 아니라 **속도가
 * 다른 여러 대역의 상대 운동**이 깊이를 만든다.
 *
 * 같은 `floor` 슬롯의 다른 레이어와 대역이 겹치지 않는다: 데칼=고주파 산포물,
 * 지형광=국소 균열 발광, 이 레이어=**화면보다 큰 주기의 저주파 대역만**(계약이 강제한다).
 * 레지스트리 등록 순서상 이 레이어가 `floor` 의 맨 뒤라 나머지가 그 위에 얹힌다(의도).
 *
 * ## 합성 산식이 대역 설계를 지배한다
 * `normal` 델타는 `a*(L − base)` 라 **바닥이 밝을수록 커지고 검정 위에서는 0 으로 수렴**한다
 * (뺄 빛이 없다). `add` 델타는 `a*L` 로 바닥과 무관하다. 그래서 밝은 바닥과 어두운 바닥은
 * 서로 다른 합성으로만 다룰 수 있고, 그 사실을 자료로 박은 축이 `BandSpec.domain` 이다.
 * 이 관계에서 나오는 불변식은 전부 `validateParallaxTheme` 이 강제한다.
 *
 * ## 결정론(ADR-0005)
 * `Math.random` 없음. 텍스처 무늬는 **고정 상수 시드**의 {@link hash2} 로 구워 런마다 동일하고
 * (= 다시 구울 이유가 없어 GPU 누수도 구조적으로 불가능), 런별 변화는 `ctx.seed` 로 뽑은
 * **월드 오프셋**만으로 준다. 애니메이션(느린 드리프트·맥동)은 전부 `EnvFrame.tick` 의
 * 순수 함수라 리플레이가 그대로 재현된다. `f.dt` 는 쓰지 않는다.
 *
 * ## 성능
 * - 텍스처는 모듈 수준 캐시에 **테마·대역당 한 번만** 굽는다(256×256 RGBA). 런을 반복해도
 *   재굽지 않으며 `generateTexture` 를 쓰지 않아 `ctx.renderer` 가 없어도(테스트) 던지지 않는다.
 * - 매 프레임: TilingSprite 몇 장의 `tilePosition`/`alpha` 갱신뿐. **할당 0**(설정·티어는 변할
 *   때만 재계산). 화면 채우기 비용이 유일한 실비용이라 저티어에서 장수를 줄인다.
 * - `tilePosition` 에 넣기 전 **f64 모듈로를 먼저** 취한다(f32 UV swim 방지, invasionBackdrop 규율).
 */

import { Container, Texture, TilingSprite } from 'pixi.js';
import { hash2 } from './noise.js';
import { graphicsTierController } from '../graphicsRuntime.js';
import { effectGates, type QualityTier } from '../qualityTier.js';
import { graphicsSettings, type GraphicsSettings } from '../graphicsSettings.js';
import type { EnvContext, EnvFrame, EnvLayer } from './types.js';
import type { BandSpec, Falloff, ParallaxTheme } from './contracts/parallax.js';
import { themeFor } from './themes/index.js';

/** 구운 필드 텍스처 한 변(px). 초저주파라 해상도가 필요 없다 — 크게 늘려도 그라디언트는 매끈하다. */
const TEX_SIZE = 256;

/** 무늬 굽기용 **고정** 시드. 런 시드와 무관해야 텍스처를 한 번만 굽는다. */
const BAKE_SEED = 0x4b41_5247 | 0; // 'KARG'

/** 티어 축(저→고). 대역의 `minTier` 와 비교한다. */
const TIER_RANK: Readonly<Record<QualityTier, number>> = { low: 0, med: 1, high: 2 };

/* ────────────────────────── 순수 함수(단위 테스트 대상) ────────────────────────── */

/** 항상 `[0, period)` 인 모듈로(음수 입력 방어). period 가 유효하지 않으면 0. */
export function wrapOffset(value: number, period: number): number {
  if (!(period > 0) || !Number.isFinite(value)) return 0;
  const m = value % period;
  return m < 0 ? m + period : m;
}

/**
 * 런 시드로 정해지는 대역별 월드 오프셋(design px). 같은 시드면 같은 배치, 다른 시드면 무늬가
 * 다른 자리에서 시작한다 — **텍스처를 다시 굽지 않고** 런별 변화를 주는 유일한 수단이다.
 *
 * @param axis 0=x, 1=y.
 */
export function bandSeedOffset(seed: number, band: number, axis: number, period: number): number {
  return hash2(seed, band * 2 + axis + 1, 0x51ed) * period;
}

/**
 * 대역의 최종 `tilePosition` 성분(design px, `[0, period)`).
 *
 * `-(카메라×시차 + 시드오프셋 + 드리프트×틱 + 뷰 원점)` 을 **f64 로 먼저 모듈로** 취한다.
 * 월드 좌표는 수만 단위까지 커지므로 그대로 넘기면 f32 UV 정밀도가 무너져 무늬가 떨린다
 * (invasionBackdrop.scroll 과 동일한 규율).
 */
export function bandTileOffset(
  cam: number,
  parallax: number,
  seedOffset: number,
  drift: number,
  tick: number,
  viewMin: number,
  period: number,
): number {
  return wrapOffset(-(cam * parallax + seedOffset + drift * tick + viewMin), period);
}

/**
 * 맥동 배율(≈`1-amplitude` .. `1`). `tick` 의 순수 함수라 리플레이가 재현되고, 프레임 스킵·탭
 * 복귀에도 위상이 어긋나지 않는다. 대역마다 주기가 서로 배수가 아니어서 합성 결과가 눈에
 * 띄게 반복되지 않는다.
 */
export function bandPulse(tick: number, period: number, amplitude: number, phase: number): number {
  if (!(period > 0) || !Number.isFinite(tick)) return 1;
  const s = Math.sin((tick / period + phase) * Math.PI * 2);
  return 1 - amplitude * 0.5 * (1 - s);
}

/* ────────────────────────── 텍스처 굽기(테마·대역당 1회) ────────────────────────── */

/**
 * 모듈 수준 텍스처 캐시. 무늬가 런 시드와 무관하므로 **프로세스 전체에서 1회**만 굽는다.
 * 런을 반복해도, 레이어 인스턴스를 여러 개 만들어도 재굽지 않는다(GPU 메모리 누수 방지).
 *
 * ⚠️ 키에 `themeId` 가 **반드시** 들어간다. 두 행성이 같은 대역 이름(`cool-shadow` 등)을 쓰는
 * 것은 자연스러운데, 키가 대역 이름뿐이면 **먼저 구운 행성의 색이 조용히 재사용된다** —
 * 예외도 경고도 없이 니플헤임 화면에 카르곤 주황이 뜬다.
 *
 * `null` = 이 환경(테스트·캔버스 없음)에서 굽지 못함.
 */
const TEXTURE_CACHE = new Map<string, Texture | null>();

/** 텍스처 캐시 키. 대역 이름에 `:` 가 없다는 것은 계약이 보장한다(구분자 충돌 방지). */
function textureKey(themeId: string, bandKey: string): string {
  return `${themeId}:${bandKey}`;
}

/** 색 정지점을 그라디언트에 적는다(흰색 + 알파 → 이후 `source-in` 으로 색을 갈아 끼운다). */
function applyStops(g: CanvasGradient, falloff: Falloff, peak: number, intensity: number): void {
  for (const [offset, a] of falloff) {
    g.addColorStop(offset, `rgba(255,255,255,${(a * peak * intensity).toFixed(4)})`);
  }
}

/**
 * 한 대역의 **이음매 없는** 저주파 블롭 필드를 굽는다.
 *
 * 1. 투명 캔버스에 `lighter` 로 흰 방사 그라디언트를 누적 → 알파 채널이 곧 필드 세기.
 *    각 블롭을 3×3 로 감싸 그려(오프셋 −S/0/+S) 경계를 넘어가는 꼬리가 반대편에 이어진다.
 * 2. `source-in` 으로 대역 색을 통째로 채워 **알파는 유지하고 RGB 만** 교체.
 *    → `tint`(곱연산) 없이 원하는 색이 나오고, `add` 합성에서는 알파가 그대로 세기가 된다.
 *
 * 캔버스가 없는 환경(node 테스트)에서는 `null` 을 반환하고 아무것도 던지지 않는다.
 */
function bakeBandTexture(themeId: string, spec: BandSpec, bandIndex: number): Texture | null {
  const key = textureKey(themeId, spec.key);
  const cached = TEXTURE_CACHE.get(key);
  if (cached !== undefined) return cached;

  let tex: Texture | null = null;
  try {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = TEX_SIZE;
      canvas.height = TEX_SIZE;
      const g2d = canvas.getContext('2d');
      if (g2d !== null) {
        g2d.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
        g2d.globalCompositeOperation = 'lighter';
        for (let i = 0; i < spec.blobs; i++) {
          // 위치·크기·세기는 전부 고정 시드 해시 — 런과 무관하게 항상 같은 무늬.
          const cx = hash2(BAKE_SEED, bandIndex * 97 + i, 1) * TEX_SIZE;
          const cy = hash2(BAKE_SEED, bandIndex * 97 + i, 2) * TEX_SIZE;
          const r =
            (spec.rMin + (spec.rMax - spec.rMin) * hash2(BAKE_SEED, bandIndex * 97 + i, 3)) *
            TEX_SIZE;
          const intensity = 0.55 + 0.45 * hash2(BAKE_SEED, bandIndex * 97 + i, 4);
          for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
              const x = cx + ox * TEX_SIZE;
              const y = cy + oy * TEX_SIZE;
              // 타일 밖으로 완전히 벗어난 사본은 건너뛴다(굽기 비용 절감).
              if (x + r < 0 || x - r > TEX_SIZE || y + r < 0 || y - r > TEX_SIZE) continue;
              const grad = g2d.createRadialGradient(x, y, 0, x, y, r);
              applyStops(grad, spec.falloff, spec.peak, intensity);
              g2d.fillStyle = grad;
              g2d.fillRect(x - r, y - r, r * 2, r * 2);
            }
          }
        }
        // 알파는 남기고 RGB 만 대역 색으로 교체.
        g2d.globalCompositeOperation = 'source-in';
        g2d.fillStyle = spec.color;
        g2d.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
        g2d.globalCompositeOperation = 'source-over';

        tex = Texture.from(canvas);
        // 진단: 하네스에서 `texture.source.label` 로 **어느 테마의** 어느 대역이 실제로
        // 바인딩됐는지 대조한다(캐시 오염이 눈에 보이는 유일한 지점).
        tex.source.label = `parallax:${key}`;
        tex.source.addressMode = 'repeat';
      }
    }
  } catch {
    // 캔버스 API 부재·보안 예외 등 어떤 실패도 레이어를 조용히 끄기만 한다(런은 계속된다).
    tex = null;
  }
  TEXTURE_CACHE.set(key, tex);
  return tex;
}

/** 대역 하나의 런타임 상태(스프라이트 + 시드 오프셋). 전부 사전 할당. */
interface BandRuntime {
  readonly spec: BandSpec;
  readonly sprite: TilingSprite;
  seedX: number;
  seedY: number;
  /** 티어·감소 토글 반영 후의 알파 상한(맥동은 여기에 곱해진다). */
  gatedAlpha: number;
  /** 티어가 이 대역을 허용하는가. */
  enabled: boolean;
}

/**
 * 거대 스케일 저주파 환경 변조 레이어.
 *
 * 슬롯이 `floor` 인 이유·합성 산식은 파일 상단 주석 참조. 담당 행성은 스스로 알지 않는다 —
 * `themeFor(ctx.planet)` 가 `undefined` 면 꺼진다.
 */
export class ParallaxLayer implements EnvLayer {
  readonly name = 'parallax';
  readonly slot = 'floor' as const;
  readonly view = new Container();

  private readonly bands: BandRuntime[] = [];
  /**
   * 현재 스프라이트가 어느 테마로 지어졌는가. `null` = 아직 안 지음.
   *
   * ⚠️ 영구 boolean 이면 안 된다. 같은 레이어 인스턴스가 런 사이에 재사용되므로, 행성이 바뀐
   * 두 번째 `configure` 에서 즉시 return 하면 **첫 테마의 스프라이트가 그대로 남고** `bands` 는
   * push-only 라 대역이 누적된다.
   */
  private builtThemeId: string | null = null;
  private active = false;
  private width = 0;
  private height = 0;

  /** 마지막으로 게이트를 계산한 티어(변할 때만 재계산 → 매 프레임 할당 0). */
  private lastTier: QualityTier | null = null;
  /** 그래픽 설정 변경 구독 해제 함수. */
  private readonly unsubscribe: () => void;
  /** 설정이 바뀌었으니 게이트를 다시 계산해야 한다는 플래그. */
  private gatesDirty = true;
  private settings: GraphicsSettings;

  constructor() {
    this.settings = graphicsSettings.getSettings();
    this.unsubscribe = graphicsSettings.onChange((s) => {
      this.settings = s;
      this.gatesDirty = true;
    });
  }

  /** 진단·테스트용: 실제로 스프라이트가 만들어진 대역 이름들(텍스처를 못 구우면 빈 배열). */
  get bandKeys(): readonly string[] {
    return this.bands.map((b) => b.spec.key);
  }

  /** 진단·테스트용: 현재 지어진 테마 슬러그(`null` = 아직 안 지음). */
  get themeId(): string | null {
    return this.builtThemeId;
  }

  configure(ctx: EnvContext): boolean {
    const theme = themeFor(ctx.planet)?.parallax;
    if (theme === undefined) {
      this.active = false;
      return false;
    }
    this.build(theme);
    // 런 시드로 대역별 월드 오프셋을 다시 뽑는다(텍스처는 그대로 재사용).
    for (let i = 0; i < this.bands.length; i++) {
      const b = this.bands[i];
      if (b === undefined) continue;
      b.seedX = bandSeedOffset(ctx.seed, i, 0, b.spec.tile);
      b.seedY = bandSeedOffset(ctx.seed, i, 1, b.spec.tile);
    }
    this.gatesDirty = true;
    this.lastTier = null;
    this.active = true;
    // 텍스처를 하나도 못 구웠으면(캔버스 없는 환경) 그릴 게 없다 — 그래도 활성으로 두면 빈
    // 컨테이너가 매 프레임 도니 꺼 둔다.
    return this.bands.length > 0;
  }

  /**
   * 스프라이트·텍스처 구축. 같은 테마로 여러 번 불러도 다시 굽지 않고, **테마가 바뀌면 이전
   * 스프라이트를 걷어낸 뒤** 새로 짓는다.
   */
  private build(theme: ParallaxTheme): void {
    if (this.builtThemeId === theme.themeId) return;
    if (this.builtThemeId !== null) this.teardownBands();
    this.builtThemeId = theme.themeId;
    for (let i = 0; i < theme.bands.length; i++) {
      const spec = theme.bands[i];
      if (spec === undefined) continue;
      const tex = bakeBandTexture(theme.themeId, spec, i);
      if (tex === null) continue;
      const sprite = new TilingSprite({ texture: tex, width: 1, height: 1 });
      sprite.label = `parallax:${textureKey(theme.themeId, spec.key)}`;
      sprite.blendMode = spec.blend;
      sprite.tileScale.set(spec.tile / TEX_SIZE);
      sprite.alpha = spec.alpha;
      this.view.addChild(sprite);
      this.bands.push({ spec, sprite, seedX: 0, seedY: 0, gatedAlpha: spec.alpha, enabled: true });
    }
    if (this.width > 0 && this.height > 0) this.applySize();
  }

  /**
   * 이전 테마의 스프라이트를 회수한다. **텍스처는 파괴하지 않는다** — 모듈 캐시가 소유하고
   * 있고 같은 행성으로 돌아오면 재사용한다(파괴하면 다음 런에서 빈 텍스처가 바인딩된다).
   */
  private teardownBands(): void {
    for (const b of this.bands) {
      this.view.removeChild(b.sprite);
      b.sprite.destroy({ texture: false, textureSource: false });
    }
    this.bands.length = 0;
  }

  /**
   * 티어·감소 토글 → 대역별 활성 여부와 알파 상한. **변할 때만** 부른다(매 프레임 호출하면
   * `effectGates`/`getSettings` 가 객체를 할당한다).
   */
  private recomputeGates(tier: QualityTier): void {
    const gates = effectGates(tier, this.settings);
    const rank = TIER_RANK[tier];
    // 저티어에서는 화면 채우기 자체가 비용이라 장수를 줄이고 남은 장도 살짝 눌러 둔다.
    const tierScale = tier === 'low' ? 0.8 : 1;
    for (const b of this.bands) {
      b.enabled = rank >= TIER_RANK[b.spec.minTier];
      // `gates.halo` 는 저티어와 `reducedGlow` 를 한 번에 담는다 — 발광 대역만 추가로 억제.
      const glowScale = b.spec.glow && !gates.halo ? 0.45 : 1;
      b.gatedAlpha = b.spec.alpha * tierScale * glowScale;
      b.sprite.visible = b.enabled;
    }
  }

  update(f: EnvFrame): void {
    if (!this.active || this.bands.length === 0) return;
    const tier = graphicsTierController.getActiveTier();
    if (this.gatesDirty || tier !== this.lastTier) {
      this.lastTier = tier;
      this.gatesDirty = false;
      this.recomputeGates(tier);
    }
    // 모션 감소 시 드리프트·맥동을 얼린다(위상 0 고정). 시차 자체는 카메라 조작의 직접 결과라
    // 그대로 둔다 — 그걸 끄면 배경이 지형에 붙어 깊이가 통째로 사라진다.
    const tick = this.settings.reducedMotion ? 0 : f.tick;
    // 스프라이트를 가시 사각형 원점에 맞춘다(레터박스·오버스캔 포함).
    const vx = f.viewMinX;
    const vy = f.viewMinY;
    for (let i = 0; i < this.bands.length; i++) {
      const b = this.bands[i];
      if (b === undefined || !b.enabled) continue;
      const s = b.spec;
      b.sprite.position.set(vx, vy);
      b.sprite.tilePosition.set(
        bandTileOffset(f.camX, s.parallax, b.seedX, s.driftX, tick, vx, s.tile),
        bandTileOffset(f.camY, s.parallax, b.seedY, s.driftY, tick, vy, s.tile),
      );
      // 대역마다 위상을 어긋나게 해 여러 장이 동시에 밝아지지 않게 한다.
      b.sprite.alpha = b.gatedAlpha * bandPulse(tick, s.period, s.pulse, i * 0.37);
    }
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.applySize();
  }

  private applySize(): void {
    if (!(this.width > 0) || !(this.height > 0)) return;
    for (const b of this.bands) {
      b.sprite.width = this.width;
      b.sprite.height = this.height;
    }
  }

  destroy(): void {
    this.unsubscribe();
    // 텍스처는 모듈 캐시가 소유하므로 파괴하지 않는다(다음 런이 재사용 — 재굽기 = 누수).
    this.view.destroy({ children: true });
    this.bands.length = 0;
    this.builtThemeId = null;
  }
}
