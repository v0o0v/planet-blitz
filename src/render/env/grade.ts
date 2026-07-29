/**
 * 컬러 그레이딩·비네트 레이어 (슬롯 `post` — 최상단, HUD 아래).
 *
 * ## 이 레이어가 하는 일
 * 실제 AAA 타이틀이 스크린샷 한 장만으로 "완성된 게임"처럼 보이는 큰 이유는 최종 톤 패스다.
 * 요소마다 색이 따로 노는 화면을 ①가장자리 비네트로 시선을 중앙에 모으고 ②하이라이트·그림자의
 * 색온도를 갈라 화면 전체에 하나의 성격을 주고 ③미세 그레인으로 그라디언트 밴딩을 깨서
 * 한 장의 그림으로 묶는다.
 *
 * **행성별 값은 이 파일에 없다.** 알파 6개·형상·색 5종은 {@link file://./contracts/grade.ts}
 * 의 `GradeTheme` 이고, `configure` 가 `themeFor(planet)` 로 주입받는다. 여기 남은 것은 그
 * 데이터를 화면으로 바꾸는 **메커니즘**뿐이다 — 합성 순서, 텍스처 굽기, 티어 배율, 화면 정합.
 *
 * ## 이 레이어가 할 수 있는 것의 한계 (설계의 출발점)
 * `post` 슬롯의 스프라이트 합성으로 표현 가능한 연산은 **목적지 색 c 에 대한 위치별 아핀 사상**
 * 하나뿐이다:
 *
 * ```
 *   c' = M(x,y) · c + A(x,y)      // M = multiply 스프라이트들의 곱, A = add 스프라이트들의 합
 * ```
 *
 * 여기서 두 가지가 **원리적으로 불가능**하다.
 *
 * 1. **전경/배경 대비 개선.** 아핀 사상은 두 색의 차를 |M| 배로 줄일 뿐 결코 늘리지 못한다.
 *    즉 "주황 바닥만 눌러 흰 탄환을 띄운다"는 post 에서 성립하지 않는다. 유일하게 남는 선택성은
 *    채널 가중(주황은 R 지배 32.7%, 청록 함선은 R 7.5%)인데, 알파 상한 0.3 안에서 유효 차이가
 *    1% 미만이라 실효가 없다. → **배경 명도 캡은 타일셋·시차 레인(배경 전용 슬롯)의 몫**이다.
 * 2. **진짜 톤 커브(하이라이트 롤오프·블랙포인트 압축).** 둘 다 c 의 비선형 함수라 아핀으로는
 *    표현할 수 없다. 풀스크린 셰이더 없이는 도달 불가.
 *
 * 슬롯을 `floor` 로 옮기면 1 은 풀리지만 비네트·전역 톤을 잃는다. 두 슬롯을 동시에 쓰려면 새
 * 레이어 **파일**이 필요한데(`slot` 은 클래스당 하나이고, `envWiring.test.ts` 가 "레지스트리
 * 레이어 수 = 모듈 수"를 잠근다) 그건 이 레인의 소유 범위 밖이다. 그래서 이 레이어는 post 에
 * 남아 **아핀으로 실제 도달 가능한 것**에 집중한다 — 아래의 스플릿 톤이다.
 *
 * ## 스플릿 톤 = lift/gain 이중성 (아핀으로 도달 가능한 톤 분리)
 * 아핀 사상의 두 항은 서로 다른 명도 대역을 지배한다. 이게 필름 그레이딩의 lift/gain 그 자체다.
 *
 * - **A(add) = lift → 암부를 지배한다.** 검정에 가까운 화소는 c≈0 이라 결과가 사실상 A 의 색이
 *   된다. 밝은 화소에서는 상대 기여가 1/10 로 묻힌다.
 * - **M(multiply) = gain → 하이라이트를 지배한다.** 검정은 어떤 M 을 곱해도 검정이라 절대
 *   변화량이 0 이고, 밝은 화소일수록 절대 변화량이 c 에 **비례해** 커진다.
 *
 * 그래서 암부 색조를 add 로, 하이라이트 색조를 multiply 로 깔면 중성 회색 g 의 전달함수
 * (`toneMap`)가 한쪽 색온도에서 반대쪽으로 **단조롭게** 건너간다. 이것이 "명도 2단계" 인상을
 * 깨는 색상 다리이며, 어느 쪽이 따뜻한가는 테마의 `warmthDirection` 이 정한다.
 *
 * 부수 효과 두 가지가 공짜로 따라온다:
 * - **하이라이트 가중 감쇠(롤오프의 아핀 근사).** gain 의 절대 밝기 손실은 c 에 정비례하므로
 *   흰 화소만 눈에 띄게 잃고 어두운 바닥은 사실상 안 잃는다.
 * - **블랙포인트를 띄우지 않을 수 있다.** lift tint 를 휘도가 싼 방향(파랑 지배)으로 잡으면
 *   암부 채도만 오르고 밝기는 거의 그대로다. 이 조건은 계약이 수치로 강제한다.
 *
 * ## 가장 위험한 레이어다 (가독성 상한)
 * 이 레이어만 화면 **전체**를 덮는다. 즉 잘못 만들면 전투 자체가 안 보인다. 그래서 상한 넷은
 * 테마가 바꿀 수 없는 계약 상수이고({@link file://./contracts/grade.ts}), 검증기가 임의 테마에
 * 대해 화면 격자 전체를 훑어 잠근다:
 *
 *  1. **어떤 요소도 {@link LAYER_MAX_ALPHA} 를 넘지 않는다.** 티어·설정 어떤 조합에서도.
 *  2. **화면 중앙은 사실상 손대지 않는다** — 플레이어와 근접 전투가 벌어지는 곳이라 최소
 *     잔존율을 반드시 남긴다. 비네트·색온도는 중앙에서 0 이고 전역 gain 만 바닥값으로 먹는다
 *     (이전 판에서는 중앙 감쇠가 정확히 0 이라 이 상한이 항진 조건이었다 — 이제 실제로 잠근다).
 *  3. **가장자리는 "적이 안 보일 만큼" 어둡히지 않는다.** 이 게임은 적이 화면 밖에서 들어온다.
 *
 * ⚠️ 그래서 **알파 6개는 독립 슬라이더가 아니라 공동 예산의 배분이다.** 비네트·cool·gain 셋이
 * 같은 밝기 손실 예산에서 먹으므로 하나를 키우면 다른 하나를 줄여야 한다. 새 행성 값을 넣을
 * 때 이 관계를 모르면 캡이 조용히 뚫린다 — 검증기가 조합적으로 잡는다.
 *
 * ## 기술 규율
 * - **화면 고정**: 카메라를 무시하고 {@link EnvFrame} 의 view 사각형에 정확히 맞춘다. 레터박스
 *   띠를 칠하지 않는 유일한 방법은 "화면보다 크게 깔고 넘치게" 가 아니라 매 프레임 그 사각형에
 *   정확히 스냅하는 것이다(리포에 레터박스 오염 선례가 있다).
 * - **결정론(ADR-0005)**: `Math.random`·`performance.now` 금지. 그레인 위상은 `seed` + `tick`
 *   의 순수 해시({@link file://./noise.ts})다.
 * - **성능**: 스프라이트 6장. 텍스처는 **테마당 1회**만 굽고 캐시한다. 매 프레임 할당 0
 *   (설정 스냅샷은 구독으로 캐시하고, 티어는 무할당 getter 로 읽는다). 풀스크린 필터 미사용.
 * - **테스트 안전**: `ctx.renderer` 가 없으면 1×1 흰 텍스처로 대체해 기하만 유지한다(던지지 않고,
 *   화면 기여도 없다) — 사각형 정합·상한 검증은 GL 없이도 성립한다.
 */

import { Container, Graphics, Rectangle, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { hash3 } from './noise.js';
import { graphicsTierController } from '../graphicsRuntime.js';
import { effectGates, type QualityTier } from '../qualityTier.js';
import { graphicsSettings, type GraphicsSettings } from '../graphicsSettings.js';
import type { EnvContext, EnvFrame, EnvLayer } from './types.js';
import type { GradeStrengths, GradeTheme, VignetteShape } from './contracts/grade.js';
import {
  LAYER_MAX_ALPHA,
  makeCoolProfile,
  makeWarmProfile,
  vignetteAtRadius,
} from './contracts/grade.js';
import { themeFor } from './themes/index.js';

// ───────────────────────── 텍스처 굽기 파라미터 ─────────────────────────

/** 비네트 텍스처 한 변(px). 스프라이트로 늘려 쓰므로 작아도 되고, 선형 보간이 계단을 녹인다. */
const VIGNETTE_TEX = 256;

/** 비네트 링 개수. 링당 알파 증분이 1/64 라 늘렸을 때 밴딩이 보이지 않는다. */
const VIGNETTE_RINGS = 64;

/** 색온도 그라디언트 텍스처 격자(가로 × 세로 셀). 한 번만 굽는다. */
const GRADIENT_COLS = 24;
const GRADIENT_ROWS = 96;

/** 그레인 타일 한 변(px). TilingSprite 로 반복하므로 작게 굽는다. */
const GRAIN_TEX = 64;

/** 그레인 위상 갱신 주기(sim 틱). 매 틱 바꾸면 지글거림이 과하다. */
const GRAIN_PHASE_TICKS = 4;

// ───────────────────────── 품질 티어 대응 ─────────────────────────

/** 티어별 전체 배율. 상위 티어가 하위의 상위집합이 되도록 단조 증가. */
const TIER_SCALE: Record<QualityTier, number> = { low: 0.7, med: 0.86, high: 1 };

/**
 * (티어 × 그래픽 설정) → 강도 스냅샷(순수함수).
 *
 * 단조성이 계약이다 — low ≤ med ≤ high 이고, `reducedGlow`·`reducedMotion` 은 어떤 필드도
 * 키우지 않는다. 그래야 "접근성 토글을 켰더니 더 세졌다" 같은 결함이 구조적으로 불가능해진다.
 *
 * - `reducedGlow` → 따뜻한 **가산** 기운을 크게 줄인다(halo·bloom 과 같은 발광 감소축).
 *   티어와 직교인 접근성 축이므로 티어와 무관하게 항상 줄어든다.
 * - `reducedMotion` → 그레인 애니메이션을 끄고 양도 줄인다(모션 감소축).
 * - low 티어 → 그레인 자체를 끈다(저사양에서 풀스크린 타일링은 순이익이 없다). 티어 판정은
 *   자체 표를 만들지 않고 {@link effectGates} 의 `trails`(저티어에서 꺼지는 부가 장식 축)를
 *   그대로 쓴다 — 티어 표가 개정되면 이 레이어도 같이 따라간다.
 */
export function gradeStrengths(
  tier: QualityTier,
  settings: GraphicsSettings,
  theme: GradeTheme,
): GradeStrengths {
  const k = TIER_SCALE[tier];
  const a = theme.alpha;
  const gates = effectGates(tier, settings);
  const glow = settings.reducedGlow ? 0.35 : 1;
  const grainBase = gates.trails ? a.grain : 0;
  const motion = settings.reducedMotion ? 0.5 : 1;
  return {
    vignette: a.vignette * k,
    warm: a.warm * k * glow,
    cool: a.cool * k,
    // gain·shadow 는 티어에만 반응한다. 둘 다 접근성 축(발광·모션)과 무관한 **톤 성격**이고,
    // 한쪽만 티어 외 배율로 줄이면 스플릿 톤의 교차점이 설정에 따라 움직여 화면 성격이 갈린다.
    gain: a.gain * k,
    shadow: a.shadow * k,
    grain: grainBase * k * motion,
    grainAnimation: grainBase > 0 && !settings.reducedMotion,
  };
}

/**
 * 테마가 주입되기 전의 강도. 전부 0 이라 화면 기여가 없다 — `configure` 전에 update 가 들어와도
 * 흰 사각형이나 남의 행성 톤이 한 프레임 스치는 일이 없다.
 */
const ZERO_STRENGTHS: GradeStrengths = {
  vignette: 0,
  warm: 0,
  cool: 0,
  gain: 0,
  shadow: 0,
  grain: 0,
  grainAnimation: false,
};

// ───────────────────────── 레이어 ─────────────────────────

export class GradeLayer implements EnvLayer {
  readonly name = 'grade';
  readonly slot = 'post' as const;
  readonly view = new Container();

  /** 굽은 텍스처 캐시(첫 configure 1회). destroy 에서만 해제한다. */
  private vignetteTex: Texture | null = null;
  private warmTex: Texture | null = null;
  private coolTex: Texture | null = null;
  private grainTex: Texture | null = null;

  private vignette: Sprite | null = null;
  private warm: Sprite | null = null;
  private cool: Sprite | null = null;
  private grain: TilingSprite | null = null;
  /** 전역 톤 두 장. 균일해서 굽지 않는다 — `Texture.WHITE` 를 늘려 쓴다(bake 0). */
  private toneGain: Sprite | null = null;
  private shadowLift: Sprite | null = null;

  private seed = 0;
  /** `configure` 가 주입한다. 그 전에는 이 레이어가 그릴 대상이 없다. */
  private theme: GradeTheme | null = null;
  /** 굽은 텍스처가 어느 테마 것인가. 테마가 바뀌면 형상·색이 달라지므로 다시 구워야 한다. */
  private builtThemeId: string | null = null;
  private strengths: GradeStrengths = ZERO_STRENGTHS;
  /** 강도 재계산 트리거용. 설정은 구독으로, 티어는 매 프레임 무할당 비교로 감시한다. */
  private settingsSnapshot: GraphicsSettings = graphicsSettings.getSettings();
  private lastTier: QualityTier | null = null;
  private unsubscribe: (() => void) | null = null;
  /** 텍스처가 실제로 구워졌는지(=화면에 기여하는지). 없으면 알파를 0 으로 눕힌다. */
  private hasTextures = false;

  configure(ctx: EnvContext): boolean {
    const theme = themeFor(ctx.planet)?.grade;
    // 담당 테마가 없는 행성이면 스스로 꺼진다. 행성 인덱스를 이 파일이 알 필요가 없다.
    if (theme === undefined) return false;
    this.theme = theme;
    this.seed = ctx.seed | 0;
    this.build(ctx.renderer, theme);
    // 설정은 이벤트로만 바뀌므로 구독해 캐시한다 — 매 프레임 getSettings() 는 객체를 새로 만든다.
    if (this.unsubscribe === null) {
      this.unsubscribe = graphicsSettings.onChange((s) => {
        this.settingsSnapshot = s;
        this.lastTier = null; // 다음 update 에서 강제 재계산.
      });
    }
    this.settingsSnapshot = graphicsSettings.getSettings();
    this.lastTier = null;
    return true;
  }

  update(f: EnvFrame): void {
    // 티어는 무할당 getter. 바뀌었거나 설정이 바뀌었을 때만 강도를 다시 만든다(프레임 할당 0).
    const tier = graphicsTierController.getActiveTier();
    const theme = this.theme;
    if (theme !== null && tier !== this.lastTier) {
      this.lastTier = tier;
      this.strengths = gradeStrengths(tier, this.settingsSnapshot, theme);
      this.applyStrengths();
    }

    const x = f.viewMinX;
    const y = f.viewMinY;
    const w = f.viewMaxX - f.viewMinX;
    const h = f.viewMaxY - f.viewMinY;
    // 폭·높이가 0 이하인 프레임(초기화 직전)은 스프라이트 기하를 건드리지 않는다.
    if (!(w > 0) || !(h > 0)) return;

    this.fit(this.toneGain, x, y, w, h);
    this.fit(this.vignette, x, y, w, h);
    this.fit(this.warm, x, y, w, h);
    this.fit(this.cool, x, y, w, h);
    this.fit(this.shadowLift, x, y, w, h);

    const grain = this.grain;
    if (grain !== null) {
      grain.position.set(x, y);
      grain.width = w;
      grain.height = h;
      if (this.strengths.grainAnimation) {
        // 결정적 위상: seed + 틱 버킷 해시. performance.now 금지(리플레이 재현성).
        const bucket = Math.floor(f.tick / GRAIN_PHASE_TICKS);
        const ox = hash3(this.seed, bucket, 0, 11) * GRAIN_TEX;
        const oy = hash3(this.seed, bucket, 0, 23) * GRAIN_TEX;
        grain.tilePosition.set(Math.floor(ox), Math.floor(oy));
      }
    }
  }

  resize(_width: number, _height: number): void {
    // 기하는 매 프레임 view 사각형에 스냅하므로(update) 여기서 할 일이 없다. 오히려 여기서
    // design 크기로 맞추면 레터박스·오버스캔 화면에서 사각형이 어긋난다.
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.teardown();
    this.view.destroy({ children: true });
    this.theme = null;
  }

  /**
   * 진단·테스트용: 화면을 덮는 스프라이트들(순서는 렌더 순서).
   * **그레인은 항상 마지막**이다(위상 검증이 마지막 원소를 TilingSprite 로 읽는다).
   */
  get overlays(): readonly (Sprite | TilingSprite)[] {
    const out: (Sprite | TilingSprite)[] = [];
    if (this.toneGain !== null) out.push(this.toneGain);
    if (this.cool !== null) out.push(this.cool);
    if (this.vignette !== null) out.push(this.vignette);
    if (this.shadowLift !== null) out.push(this.shadowLift);
    if (this.warm !== null) out.push(this.warm);
    if (this.grain !== null) out.push(this.grain);
    return out;
  }

  /** 진단·테스트용: 현재 적용 중인 강도 스냅샷. */
  get activeStrengths(): GradeStrengths {
    return this.strengths;
  }

  // ── 내부 ──

  /** 스프라이트를 view 사각형에 **정확히** 맞춘다(넘치지도, 모자라지도 않게). */
  private fit(s: Sprite | null, x: number, y: number, w: number, h: number): void {
    if (s === null) return;
    s.position.set(x, y);
    s.width = w;
    s.height = h;
  }

  /**
   * 스프라이트와 굽은 텍스처를 회수한다. `view` 자체는 남긴다 — 컴포저가 stage 에 붙여 둔
   * 컨테이너라 교체할 수 없기 때문이다(테마 교체는 그 안의 내용물만 갈아 끼운다).
   */
  private teardown(): void {
    for (const s of this.view.removeChildren()) s.destroy();
    for (const t of [this.vignetteTex, this.warmTex, this.coolTex, this.grainTex]) {
      t?.destroy(true);
    }
    this.vignetteTex = null;
    this.warmTex = null;
    this.coolTex = null;
    this.grainTex = null;
    this.vignette = null;
    this.warm = null;
    this.cool = null;
    this.grain = null;
    this.toneGain = null;
    this.shadowLift = null;
    this.hasTextures = false;
    this.builtThemeId = null;
  }

  /**
   * 텍스처를 굽고 스프라이트를 만든다. **테마당 1회**다.
   *
   * 같은 테마로 다시 `configure` 되면(런 반복) 즉시 반환한다 — 굽기는 비싸고 결과가 같다.
   * 반대로 테마가 바뀌면 반드시 다시 구워야 한다: 굽은 텍스처는 그 테마의 형상·색이라
   * 재사용하면 **새 행성 화면에 이전 행성 톤이 그대로 남는다**(조용히, 화면은 그럴싸하게).
   */
  private build(renderer: Renderer | undefined, theme: GradeTheme): void {
    if (this.builtThemeId === theme.themeId) return;
    if (this.builtThemeId !== null) this.teardown();
    this.builtThemeId = theme.themeId;

    this.vignetteTex = renderer ? bakeVignette(renderer, theme.vignette) : null;
    this.warmTex = renderer ? bakeGradient(renderer, makeWarmProfile(theme.warm)) : null;
    this.coolTex = renderer ? bakeGradient(renderer, makeCoolProfile(theme.cool)) : null;
    this.grainTex = renderer ? bakeGrain(renderer, this.seed) : null;

    // 렌더 순: 전역 gain(곱) → 차가운 가장자리(곱) → 비네트(검정) → 전역 lift(가산) →
    // 따뜻한 하단(가산) → 그레인(가산). 곱연산을 먼저 다 태우고 가산을 얹어야 lift 가 gain 에
    // 다시 곱해지지 않는다(= 전달함수 `c·M + A` 와 실제 합성이 일치한다).
    this.toneGain = new Sprite(Texture.WHITE);
    this.toneGain.tint = theme.tint.gain;
    this.toneGain.blendMode = 'multiply';

    this.cool = new Sprite(this.coolTex ?? Texture.WHITE);
    this.cool.tint = theme.tint.cool;
    this.cool.blendMode = 'multiply';

    this.vignette = new Sprite(this.vignetteTex ?? Texture.WHITE);
    this.vignette.tint = 0x000000;

    this.shadowLift = new Sprite(Texture.WHITE);
    this.shadowLift.tint = theme.tint.shadow;
    this.shadowLift.blendMode = 'add';

    this.warm = new Sprite(this.warmTex ?? Texture.WHITE);
    this.warm.tint = theme.tint.warm;
    this.warm.blendMode = 'add';

    this.grain = new TilingSprite({ texture: this.grainTex ?? Texture.WHITE, width: 1, height: 1 });
    this.grain.tint = theme.tint.grain;
    this.grain.blendMode = 'add';

    // 렌더러가 없으면(테스트) 텍스처가 1×1 흰색이라 화면 기여가 의미 없다 — 알파 0 으로 눕혀
    // "GL 없는 환경에서 흰 사각형이 깔리는" 사고를 원천 차단한다. 기하는 그대로 유지된다.
    // 전역 톤 두 장은 Texture.WHITE 라 렌더러 없이도 "진짜" 텍스처지만, 여기서 함께 눕힌다 —
    // 나머지 레이어가 빠진 반쪽 화면에 톤만 적용되는 상태를 만들지 않기 위한 일관성이다.
    if (renderer === undefined) {
      for (const s of [this.toneGain, this.cool, this.vignette, this.shadowLift, this.warm, this.grain]) {
        s.alpha = 0;
      }
      this.hasTextures = false;
    } else {
      this.hasTextures = true;
    }

    this.view.addChild(
      this.toneGain,
      this.cool,
      this.vignette,
      this.shadowLift,
      this.warm,
      this.grain,
    );
    this.applyStrengths();
  }

  /** 강도 스냅샷을 스프라이트 알파에 반영. 상한을 여기서 한 번 더 강제한다(이중 안전장치). */
  private applyStrengths(): void {
    const s = this.strengths;
    const cap = (v: number): number => (this.hasTextures ? Math.min(LAYER_MAX_ALPHA, v) : 0);
    if (this.cool !== null) this.cool.alpha = cap(s.cool);
    if (this.vignette !== null) this.vignette.alpha = cap(s.vignette);
    if (this.warm !== null) this.warm.alpha = cap(s.warm);
    if (this.toneGain !== null) this.toneGain.alpha = cap(s.gain);
    if (this.shadowLift !== null) this.shadowLift.alpha = cap(s.shadow);
    if (this.grain !== null) {
      this.grain.alpha = cap(s.grain);
      this.grain.visible = s.grain > 0;
    }
  }
}

// ───────────────────────── 텍스처 굽기 (configure 1회, 매 프레임 금지) ─────────────────────────

/**
 * 비네트 텍스처. 동심 **링 스트로크**를 바깥→안쪽으로 그린다.
 *
 * 채운 원을 겹치면 중앙이 가장 진해져 비네트와 정반대가 되므로, 링을 각자 자기 알파로 한 번씩만
 * 칠한다(서로 겹치지 않으므로 알파가 곧 프로파일 값이다). 링 폭을 1.12 배로 살짝 키워 이음매를
 * 막고, 텍스처 밖으로 나가는 링은 `frame` 으로 잘라 텍스처가 커지는 것을 막는다.
 */
function bakeVignette(renderer: Renderer, v: VignetteShape): Texture {
  const half = VIGNETTE_TEX / 2;
  const cx = half;
  const cy = half * (1 + v.centerY);
  const step = v.outer / VIGNETTE_RINGS;
  const g = new Graphics();
  for (let i = VIGNETTE_RINGS - 1; i >= 0; i--) {
    const r = (i + 0.5) * step;
    const a = vignetteAtRadius(r, v);
    if (a <= 0.002) continue;
    g.circle(cx, cy, r * half).stroke({
      color: 0xffffff,
      width: step * half * 1.12,
      alpha: a,
      alignment: 0.5,
    });
  }
  const tex = renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, 0, VIGNETTE_TEX, VIGNETTE_TEX),
    resolution: 1,
  });
  g.destroy();
  return tex;
}

/**
 * 색온도 그라디언트 텍스처. 정규 좌표 프로파일을 저해상 격자로 구워 스프라이트로 늘린다
 * (선형 보간이 계단을 녹인다 — 셀당 알파 증분이 1/96 이라 밴딩이 보이지 않는다).
 */
function bakeGradient(renderer: Renderer, profile: (nx: number, ny: number) => number): Texture {
  const g = new Graphics();
  for (let j = 0; j < GRADIENT_ROWS; j++) {
    const ny = ((j + 0.5) / GRADIENT_ROWS) * 2 - 1;
    for (let i = 0; i < GRADIENT_COLS; i++) {
      const nx = ((i + 0.5) / GRADIENT_COLS) * 2 - 1;
      const a = profile(nx, ny);
      if (a <= 0.002) continue;
      g.rect(i, j, 1, 1).fill({ color: 0xffffff, alpha: Math.min(1, a) });
    }
  }
  const tex = renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, 0, GRADIENT_COLS, GRADIENT_ROWS),
    resolution: 1,
  });
  g.destroy();
  return tex;
}

/**
 * 필름 그레인 타일. 시드 해시로 만든 결정적 백색 노이즈이며 TilingSprite 로 반복한다.
 * 절반가량의 픽셀만 칠해 드로 수를 줄이고, 알파도 낮게 흩어 뭉침을 피한다.
 */
function bakeGrain(renderer: Renderer, seed: number): Texture {
  const g = new Graphics();
  for (let y = 0; y < GRAIN_TEX; y++) {
    for (let x = 0; x < GRAIN_TEX; x++) {
      const n = hash3(seed, x, y, 7);
      if (n < 0.5) continue;
      g.rect(x, y, 1, 1).fill({ color: 0xffffff, alpha: (n - 0.5) * 2 });
    }
  }
  const tex = renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, 0, GRAIN_TEX, GRAIN_TEX),
    resolution: 1,
  });
  g.destroy();
  return tex;
}
