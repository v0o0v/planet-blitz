/**
 * 전경 대기 레이어 (슬롯 `over` — 엔티티 위).
 *
 * 지형과 엔티티 사이에 아무것도 떠 있지 않으면 화면이 진공처럼 죽는다 — 이 레이어의 존재
 * 이유는 오직 하나, **화면에 공기를 넣는 것**이다. 무엇이 떠 있는가(잔불·재·눈·포자·먼지)는
 * 행성별 테마 데이터이고, 이 파일에는 **메커니즘만** 있다.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ## 왜 "상태 없는 입자"인가
 *
 * 입자 시스템의 상식적 구현은 "생성 시 `Math.random` 으로 속성을 뽑고 → 매 프레임 상태를 갱신"
 * 이다. 이 리포에서 그 구현은 **세 가지가 동시에 깨진다**:
 *  1. `Math.random` 이라 같은 시드의 리플레이가 다른 배경을 그린다(noise.ts 서두의 규율 위반).
 *  2. 상태 적분이라 프레임 스킵·탭 복귀(큰 dt)에서 입자가 순간이동하거나 뭉친다.
 *  3. 매 프레임 배열을 돌며 상태를 쓰고, 수명이 끝난 입자를 재생성하며 할당이 생긴다.
 *
 * 그래서 여기서는 입자를 **순수 함수** 로 만든다:
 *
 *     (seed, 입자 인덱스 i, tick) → { x, y, alpha, radius }
 *
 * 수명 주기는 상태가 아니라 **`tick` 을 입자별 위상만큼 밀고 주기로 나눈 나머지**(`u ∈ [0,1)`)다.
 * 상태 갱신이 없으니 프레임을 건너뛰어도 튀지 않고(어느 tick 이든 곧바로 정답 위치를 계산한다),
 * 같은 시드·같은 tick 이면 항상 같은 화면이 나오며, 갱신 루프가 곧 그리기 루프라 할당이 0 이다.
 * 되감김(무한 상승 금지)도 `u` 의 나머지 연산이 구조적으로 보장한다 — 잊어서 새는 코드가 없다.
 *
 * ## 좌표계 — 화면 기준 + 시차
 * 입자는 **화면(design) 좌표**에 산다. 월드 고정으로 두면 카메라가 멈춘 순간 공기도 같이 멈춰
 * 죽어 보인다. 대신 카메라 이동량에 필드별 계수(`parallax`)를 곱해 빼고 화면 밖으로 나간 만큼
 * 되감아(`wrap`), "화면 앞에 떠 있는 공기"로 읽히게 한다. 계수가 클수록 앞(빠르게 흐름).
 *
 * ## 왜 화면 기여도를 코드로 모델링하는가
 * 이 레이어의 1차 구현은 순수성·되감김·상한을 전부 지키고도 화면 기여도 0.45(노이즈 바닥
 * 0.12)로 기각됐다. 실패의 실체는 개별 결정이 아니라 **보수적 결정 넷이 곱해진 결과**였고,
 * 사람은 곱셈을 눈으로 추적하지 못한다. 그래서 {@link estimateAtmosphereContribution} 이
 * 곱셈의 결과를 계산하고 테스트가 그 값을 직접 감시한다.
 *
 * ### 왜 "면적"이 기여도의 지배항인가
 * 지표는 **화면 전 픽셀의 평균 차이**다. 반경 4px 입자 30개의 총 면적은 화면의 0.04%라 알파를
 * 1.0 으로 올려도 평균 차이가 0.1 을 못 넘는다 — 작은 입자는 이 지표를 구조적으로 움직일 수
 * 없다. 반대로 반경 200px 뭉치 11개는 화면의 절반을 덮어 알파 0.26 만으로 3 이상을 낸다.
 * 그래서 "잘 보이게"와 "가독성을 해치지 않게"는 **충돌하지 않는다**: 답은 언제나 넓은 면적 ×
 * 낮은 진폭이고, 그건 탄(좁은 면적 × 최대 진폭)의 정확한 반대다.
 *
 * ## 결정론·비용
 * render-only(ADR-0005). `src/sim/` 미import, `Math.random`·`performance.now` 미사용,
 * 애니메이션 위상은 오직 {@link EnvFrame.tick}. 스프라이트 풀은 고정 크기이고 매 프레임 할당·
 * `generateTexture` 가 0 이다(텍스처는 `configure` 에서 프로파일마다 한 장씩만 굽고 캐시).
 */

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { EnvContext, EnvFrame, EnvLayer } from './types.js';
import { hash3 } from './noise.js';
import { graphicsTierController } from '../graphicsRuntime.js';
import { effectGates } from '../qualityTier.js';
import { graphicsSettings } from '../graphicsSettings.js';
import { themeFor } from './themes/index.js';
import {
  fieldDeltaRgbSum,
  profileAverageFill,
  type AtmosphereField,
  type AtmosphereTheme,
  type TextureProfile,
} from './contracts/atmosphere.js';

/** 모션 감소 시 시간 진행·흔들림 배율. 완전 정지는 오히려 부자연스러워 크게 줄이기만 한다. */
const REDUCED_MOTION_SCALE = 0.3;

/** 발광 감소 시 가산 필드 알파 배율(가산 발광의 눈부심 완화). */
const REDUCED_GLOW_ALPHA = 0.5;

/**
 * 구운 원형 텍스처의 반경(px). 스프라이트는 `radius / 이 값` 으로 스케일한다.
 * 큰 덩어리는 반경 300px 까지 커지므로 텍스처가 작으면 확대 시 계단이 보인다 — 64px(=128² 텍스처)
 * 면 4.7배 확대라 소프트 그라디언트가 뭉개지지 않는다. 작은 알갱이는 축소라 품질 문제가 없다.
 */
const TEXTURE_RADIUS = 64;

/** 0~1 클램프. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------------------
// 순수 샘플러 — 이 레이어의 전부. 상태가 없다.
// ---------------------------------------------------------------------------

/** 화면(design) 가시 사각형. */
export interface ViewRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 입자 하나의 이번 프레임 표시 상태. */
export interface ParticleSample {
  x: number;
  y: number;
  alpha: number;
  radius: number;
}

/** `gates.particles` 3단 → 이 필드의 입자 수(순수). */
export function fieldCount(f: AtmosphereField, particles: 'off' | 'min' | 'normal'): number {
  return particles === 'off' ? f.counts.off : particles === 'min' ? f.counts.min : f.counts.normal;
}

/** 필드 전체의 최대 입자 수(풀 크기 산정용). */
export function maxFieldCount(f: AtmosphereField): number {
  return Math.max(f.counts.off, f.counts.min, f.counts.normal);
}

/** 값을 `[lo, lo+span)` 안으로 되감는다(음수 안전). span ≤ 0 이면 lo. */
function wrap(v: number, lo: number, span: number): number {
  if (!(span > 0)) return lo;
  return lo + (((v - lo) % span) + span) % span;
}

/** 소수부 [0,1) (음수 안전). */
function frac(v: number): number {
  return v - Math.floor(v);
}

/** 화면 밖 여유 비율 — 입자가 경계에서 갑자기 나타나거나 사라지지 않게 한다. */
const PAD_X_RATIO = 0.12;
const PAD_Y_RATIO = 0.15;

/**
 * 입자 하나의 표시 상태를 **`out` 에 써 넣는다**(할당 0). 순수 계산이며 `out` 외의 부작용이 없다.
 *
 * 같은 `(seed, index, tick, view, cam, motion)` 이면 항상 같은 결과다 — 상태를 전혀 읽지 않는다.
 *
 * @param out    결과를 받을 재사용 객체.
 * @param f      필드 사양.
 * @param seed   런 시드(위치 의존 난수의 유일한 근원).
 * @param index  입자 인덱스.
 * @param tick   보간된 sim 틱(애니메이션 위상의 유일한 시간축).
 * @param view   화면 가시 사각형(design).
 * @param camX   카메라 중심 X(시차용).
 * @param camY   카메라 중심 Y(시차용).
 * @param motion 시간·흔들림 배율(모션 감소 시 < 1).
 */
export function sampleParticleInto(
  out: ParticleSample,
  f: AtmosphereField,
  seed: number,
  index: number,
  tick: number,
  view: ViewRect,
  camX = 0,
  camY = 0,
  motion = 1,
): ParticleSample {
  // 비유한 입력 방어 — 한 프레임의 NaN 이 스프라이트를 영구히 화면 밖으로 날리는 걸 막는다.
  const t = Number.isFinite(tick) ? tick : 0;
  const cx = Number.isFinite(camX) ? camX : 0;
  const cy = Number.isFinite(camY) ? camY : 0;

  // 입자별 고정 속성(전부 순수 해시 — Math.random 금지).
  const r0 = hash3(seed, index, f.key, 0); // 가로 레인
  const r1 = hash3(seed, index, f.key, 1); // 주기 지터
  const r2 = hash3(seed, index, f.key, 2); // 수명 위상
  const r3 = hash3(seed, index, f.key, 3); // 흔들림 위상
  const r4 = hash3(seed, index, f.key, 4); // 깜빡임 위상
  const r5 = hash3(seed, index, f.key, 5); // 알파 지터
  const r6 = hash3(seed, index, f.key, 6); // 크기 지터
  const r7 = hash3(seed, index, f.key, 7); // 깊이(주기·크기 동시 스케일 → 층 분리)

  const spanX = Math.max(1, view.maxX - view.minX);
  const spanY = Math.max(1, view.maxY - view.minY);
  const padX = spanX * PAD_X_RATIO;
  const padY = spanY * PAD_Y_RATIO;
  const fieldW = spanX + padX * 2;
  const fieldH = spanY + padY * 2;
  const originX = view.minX - padX;
  const originY = view.minY - padY;

  // 깊이: 0.7~1.4. 먼 개체일수록 느리고 크다(층 분리의 근원).
  const depth = 0.7 + r7 * 0.7;
  const period = Math.max(1, f.periodTicks * (1 - f.periodJitter + 2 * f.periodJitter * r1) * depth);

  // 수명 주기 — **상태가 아니라 tick 의 나머지**. 되감김(무한 상승 금지)이 여기서 구조적으로 보장된다.
  const u = frac((t * motion) / period + r2);

  // 세로: 대역(band) 안에서 진행 방향에 따라 한쪽 끝에서 들어와 반대편으로 빠진다.
  // 대역이 전체(0..1)가 아니면 그 구간 안에서만 오가고 되감긴다 — 열기 기둥이 하단에 머무는 장치.
  const bandH = fieldH * f.bandSpan;
  const bandY = originY + fieldH * f.bandStart;
  const travel = f.riseUp ? 1 - u : u; // 0 → 1 이 항상 "들어온 쪽 → 나가는 쪽"
  out.y = wrap(bandY + travel * bandH - cy * f.parallax, bandY, bandH);

  // 가로: 레인 + 흐름 + 흔들림 + 시차. 역시 되감는다.
  const sway = f.swayPx * motion * Math.sin(Math.PI * 2 * (f.swayCycles * u + r3));
  const rawX = originX + frac(r0 + u * f.driftTurns) * fieldW + sway - cx * f.parallax;
  out.x = wrap(rawX, originX, fieldW);

  // 알파: 수명 포락선(양끝 0 → 중간 최대) × 깜빡임 × 개체 지터. 상한은 필드의 maxAlpha.
  const envelope = Math.sin(Math.PI * u); // u=0,1 에서 0 → 페이드 인/아웃이 공짜로 나온다.
  const flick =
    f.flicker > 0
      ? 1 - f.flicker + f.flicker * (0.5 + 0.5 * Math.sin(Math.PI * 2 * (t * motion * 0.05 + r4)))
      : 1;
  const jitter = 0.6 + 0.4 * r5;
  out.alpha = Math.max(0, Math.min(f.maxAlpha, f.maxAlpha * envelope * flick * jitter));

  // 크기: 하한~상한 사이 + 깊이. 상한을 절대 넘지 않게 클램프(가독성 상한의 코드 강제).
  const base = f.minRadius + (f.maxRadius - f.minRadius) * r6;
  out.radius = Math.max(f.minRadius, Math.min(f.maxRadius, base * (0.85 + depth * 0.15)));
  return out;
}

/** {@link sampleParticleInto} 의 할당형 래퍼(테스트·진단용). 렌더 루프에서는 쓰지 않는다. */
export function sampleParticle(
  f: AtmosphereField,
  seed: number,
  index: number,
  tick: number,
  view: ViewRect,
  camX = 0,
  camY = 0,
  motion = 1,
): ParticleSample {
  return sampleParticleInto(
    { x: 0, y: 0, alpha: 0, radius: 0 },
    f,
    seed,
    index,
    tick,
    view,
    camX,
    camY,
    motion,
  );
}

// ---------------------------------------------------------------------------
// 화면 기여도 모델 — "보이는가"를 코드로 잠근다.
// ---------------------------------------------------------------------------

/**
 * 입자 면적 중 실제로 화면 안에 들어오는 기대 비율. 입자는 패딩 포함 사각형에 균일 분포하고
 * 화면은 그 안쪽 일부다 — `(1/(1+2·padX비)) × (1/(1+2·padY비))`.
 */
export const ON_SCREEN_AREA_FRACTION = (1 / (1 + 2 * PAD_X_RATIO)) * (1 / (1 + 2 * PAD_Y_RATIO));

/**
 * 필드 하나의 **화면 기여도 추정치**(RGB 합산 절대차의 전 픽셀 평균, 최대 765 척도).
 *
 *     Σᵢ (π·r·r·aspect) × alpha × 프로파일평균채움률 × Δrgb × 화면내비율 / (W·H)
 *
 * 오케스트레이터가 픽셀로 측정하는 값과 같은 척도의 **모델**이다(정확한 재현이 아니라 상한
 * 근사 — 겹침을 선형 합으로 세므로 실측보다 다소 크게 나온다).
 *
 * `Δrgb` 가 테마의 `referenceBackdrop` 을 읽는다는 점이 핵심이다. 배경색을 테마와 함께 옮기지
 * 않으면 흰 배경 행성에서 흰 입자가 "잘 보인다"고 계산되어, 카르곤 1차 결함이 색만 뒤집혀
 * 그대로 재현된다.
 */
export function estimateFieldContribution(
  theme: AtmosphereTheme,
  f: AtmosphereField,
  seed: number,
  view: ViewRect,
  ticks: readonly number[],
): number {
  const w = Math.max(1, view.maxX - view.minX);
  const h = Math.max(1, view.maxY - view.minY);
  const fill = profileAverageFill(f.profile);
  const delta = fieldDeltaRgbSum(f, theme.referenceBackdrop);
  const n = fieldCount(f, 'normal');
  const buf: ParticleSample = { x: 0, y: 0, alpha: 0, radius: 0 };
  let acc = 0;
  for (const tick of ticks) {
    for (let i = 0; i < n; i++) {
      const p = sampleParticleInto(buf, f, seed, i, tick, view);
      acc += Math.PI * p.radius * p.radius * f.aspect * p.alpha;
    }
  }
  const meanArea = acc / Math.max(1, ticks.length);
  return (meanArea * fill * delta * ON_SCREEN_AREA_FRACTION) / (w * h);
}

/** 테마 전 필드 기여도의 합. 카르곤 1차 실측 0.45(노이즈 바닥 0.12) → 2차 목표 ≥ 3.0. */
export function estimateAtmosphereContribution(
  theme: AtmosphereTheme,
  seed: number,
  view: ViewRect,
  ticks: readonly number[],
): number {
  let s = 0;
  for (const f of theme.fields) s += estimateFieldContribution(theme, f, seed, view, ticks);
  return s;
}

// ---------------------------------------------------------------------------
// 레이어
// ---------------------------------------------------------------------------

/** 필드 하나의 스프라이트 풀 + 컨테이너. */
interface FieldPool {
  readonly spec: AtmosphereField;
  readonly container: Container;
  readonly sprites: Sprite[];
  /** 현재 적용된 발광 감소 상태(플립될 때만 blendMode 를 다시 쓴다). */
  glowReduced: boolean;
}

/**
 * 프로파일을 따르는 부드러운 원형 텍스처를 굽는다. **프로파일마다 한 번만** 호출된다
 * (매 프레임 generateTexture 는 GPU 메모리 누수).
 *
 * ## 왜 링 알파를 프로파일에서 역산하는가 — 1차 결함의 재발 방지
 * 1차는 링마다 "적당한" 알파(0.04~0.18)를 직접 적어 겹쳐 그렸다. 그런데 겹쳐 그린 결과의
 * 중심 알파는 `1 − ∏(1−aᵢ)` 라서 0.61 에서 멈췄고, 그 사실이 어디에도 드러나지 않았다.
 * 여기서는 **원하는 프로파일 `p(t)` 를 먼저 선언하고 링 알파를 역산**한다:
 *
 *     acc 를 이미 칠해진 합성 알파라 할 때, 목표 p(t) 를 맞추는 링 알파 a = (p(t) − acc)/(1 − acc)
 *
 * 그러면 중심 알파는 정의상 `p(1/rings) ≈ 1` 이고, 스프라이트에 건 `alpha` 값이 곧 화면에
 * 보이는 최대 불투명도가 된다 — 주석의 수치와 화면의 수치가 어긋날 수 없다.
 *
 * **완전히 프로파일 주도라 새 모양(눈송이·포자)이 들어와도 이 코드는 그대로다.**
 */
function bakeProfileTexture(ctx: EnvContext, profile: TextureProfile, rings = 28): Texture | null {
  const renderer = ctx.renderer;
  if (renderer === undefined) return null; // 테스트(캔버스 없음) — 던지지 않는다.
  const g = new Graphics();
  let acc = 0;
  for (let i = rings; i >= 1; i--) {
    const t = i / rings; // 1=바깥, 1/rings=중심
    const target = clamp01(profile.alphaAt(t));
    if (target <= acc || 1 - acc < 1e-4) continue;
    const a = (target - acc) / (1 - acc);
    g.circle(0, 0, TEXTURE_RADIUS * t).fill({ color: 0xffffff, alpha: a });
    acc = target;
  }
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

export class AtmosphereLayer implements EnvLayer {
  readonly name = 'atmosphere';
  readonly slot = 'over' as const;
  readonly view = new Container();

  private seed = 0;
  private theme: AtmosphereTheme | null = null;
  /**
   * 프로파일마다 한 번만 굽는 텍스처. 키는 `테마슬러그/프로파일id` 다 — 프로파일 id 만 키로
   * 쓰면 두 테마가 같은 id 로 다른 모양을 선언했을 때 먼저 구운 텍스처가 조용히 재사용된다
   * (검증이 같은 테마 안의 충돌은 잡지만, 테마 사이는 캐시 키가 막아야 한다).
   */
  private readonly textures = new Map<string, Texture>();
  private readonly pools: FieldPool[] = [];
  /** 풀이 어느 테마로 지어졌는가. 행성이 바뀌면 풀을 통째로 다시 짓는다. */
  private builtThemeId: string | null = null;
  /** 매 프레임 재사용하는 샘플 버퍼(할당 0). */
  private readonly sample: ParticleSample = { x: 0, y: 0, alpha: 0, radius: 0 };
  /** 매 프레임 재사용하는 가시 사각형 버퍼(할당 0). */
  private readonly rect: ViewRect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  configure(ctx: EnvContext): boolean {
    const theme = themeFor(ctx.planet)?.atmosphere ?? null;
    this.theme = theme;
    if (theme === null) {
      this.teardown();
      return false;
    }
    this.seed = ctx.seed | 0;

    // 행성이 바뀌면 필드 목록 자체가 달라진다. 풀을 남겨두면 이전 테마의 스프라이트가 그대로
    // 화면에 남는다(레이어가 "켜졌는데 다른 행성 공기가 떠 있는" 상태).
    if (this.builtThemeId !== null && this.builtThemeId !== theme.themeId) this.teardown();

    this.bakeTextures(ctx, theme);
    if (this.pools.length === 0) this.buildPools(theme);
    else {
      // 첫 configure 가 렌더러 없이 돌았고 두 번째에 생겼을 때만 텍스처를 채운다.
      for (const p of this.pools) {
        const tex = this.textures.get(this.textureKey(theme, p.spec.profile));
        if (tex !== undefined) for (const s of p.sprites) s.texture = tex;
      }
    }
    this.builtThemeId = theme.themeId;
    return true;
  }

  private textureKey(theme: AtmosphereTheme, profile: TextureProfile): string {
    return `${theme.themeId}/${profile.id}`;
  }

  /** 테마가 실제로 쓰는 프로파일만 굽는다(중복 id 는 한 번). */
  private bakeTextures(ctx: EnvContext, theme: AtmosphereTheme): void {
    for (const f of theme.fields) {
      const key = this.textureKey(theme, f.profile);
      if (this.textures.has(key)) continue;
      const tex = bakeProfileTexture(ctx, f.profile);
      if (tex !== null) this.textures.set(key, tex);
    }
  }

  /** 고정 크기 풀을 한 번 만든다(런 도중 생성·파괴 없음 → 매 프레임 할당 0). */
  private buildPools(theme: AtmosphereTheme): void {
    for (const spec of theme.fields) {
      const container = new Container();
      const sprites: Sprite[] = [];
      const tex = this.textures.get(this.textureKey(theme, spec.profile));
      for (let i = 0; i < maxFieldCount(spec); i++) {
        const s = tex === undefined ? new Sprite() : new Sprite(tex);
        s.anchor.set(0.5);
        s.tint = spec.tint;
        // Pixi 의 tint 는 **곱연산**이라 어두운 배경 위에서 입자를 밝히려면 가산이어야 한다.
        s.blendMode = spec.additive ? 'add' : 'normal';
        s.visible = false;
        container.addChild(s);
        sprites.push(s);
      }
      this.view.addChild(container);
      this.pools.push({ spec, container, sprites, glowReduced: false });
    }
  }

  /** 풀·텍스처를 전부 회수한다(행성 전환·destroy 공용). `view` 자신은 남는다. */
  private teardown(): void {
    for (const p of this.pools) p.container.destroy({ children: true });
    this.pools.length = 0;
    // 구운 텍스처는 view 서브트리 소유가 아니므로 직접 해제한다(런 반복 시 GPU 누수 방지).
    for (const tex of this.textures.values()) tex.destroy(true);
    this.textures.clear();
    this.builtThemeId = null;
  }

  update(f: EnvFrame): void {
    if (this.theme === null || this.pools.length === 0) return;

    const settings = graphicsSettings.getSettings();
    const gates = effectGates(graphicsTierController.getActiveTier(), settings);
    const motion = settings.reducedMotion ? REDUCED_MOTION_SCALE : 1;
    const glowReduced = settings.reducedGlow;

    this.rect.minX = f.viewMinX;
    this.rect.minY = f.viewMinY;
    this.rect.maxX = f.viewMaxX;
    this.rect.maxY = f.viewMaxY;

    for (const pool of this.pools) {
      const spec = pool.spec;
      const count = Math.min(fieldCount(spec, gates.particles), pool.sprites.length);
      pool.container.visible = count > 0;

      // 발광 감소 시 가산 발광 필드는 합성 자체를 일반으로 내린다(플립될 때만 쓴다).
      if (spec.glowSensitive && pool.glowReduced !== glowReduced) {
        pool.glowReduced = glowReduced;
        const mode = spec.additive && !glowReduced ? 'add' : 'normal';
        for (const s of pool.sprites) s.blendMode = mode;
      }
      const alphaScale = spec.glowSensitive && glowReduced ? REDUCED_GLOW_ALPHA : 1;

      for (let i = 0; i < pool.sprites.length; i++) {
        const s = pool.sprites[i];
        if (s === undefined) continue;
        if (i >= count) {
          s.visible = false;
          continue;
        }
        const p = sampleParticleInto(
          this.sample,
          spec,
          this.seed,
          i,
          f.tick,
          this.rect,
          f.camX,
          f.camY,
          motion,
        );
        s.visible = true;
        s.position.set(p.x, p.y);
        s.alpha = p.alpha * alphaScale;
        s.scale.set(p.radius / TEXTURE_RADIUS, (p.radius * spec.aspect) / TEXTURE_RADIUS);
      }
    }
  }

  /** 입자는 매 프레임 `EnvFrame` 의 가시 사각형을 직접 쓰므로 크기 변경에 할 일이 없다. */
  resize(_width: number, _height: number): void {}

  destroy(): void {
    this.teardown();
    this.theme = null;
    this.view.destroy({ children: true });
  }
}
