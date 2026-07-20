/**
 * 침공 3레이어 배경 · 레이어 전환 크로스페이드 (M7a · L10-render).
 *
 * ## 왜 별도 모듈인가
 * 정찰 결론대로 **스크롤 방향 파라미터화는 불필요**하다 — 배경은 이미 카메라(camX/camY)
 * 구동이고, 침공에서는 sim 이 권위 카메라(강제 스크롤 창 중심)를 스냅샷에 실어 주므로
 * 종/횡 어느 축으로 밀려도 기존 타일 오프셋 계산이 그대로 성립한다. 따라서 이 모듈이 하는
 * 일은 딱 둘이다: ①레이어별 배경 텍스처 선택 ②레이어 전이 시 **크로스페이드**.
 *
 * ## 구조
 * TilingSprite 2 장(뒤 = 이전 레이어, 앞 = 현재 레이어)을 겹치고 앞 장의 alpha 만 올린다.
 * 전이가 끝나면 앞 장을 뒤로 승격시키고 앞 장 alpha 를 1 로 고정한다 — 중간 상태가 없어
 * 프레임 스킵·탭 백그라운드 복귀에도 어긋나지 않는다.
 *
 * ## 결정론(ADR-0005)
 * 렌더 전용이다. sim 을 읽기만 하고 쓰지 않으며, 크로스페이드 진행도는 **전이 시작 틱과
 * 현재 틱의 순수 함수**({@link backdropCrossfadeAlpha})라 렌더 상태(프레임 수·wall clock)에
 * 의존하지 않는다. 탭이 멈췄다 돌아와도 알파가 튀지 않고 정확한 위치에서 이어진다.
 *
 * ## 소유 경계
 * 배경 텍스처 **교체 호출은 main.ts(L8 소유)** 가 한다. 이 모듈은 API 만 제공한다.
 */

import { Container, TilingSprite, type Texture } from 'pixi.js';
import { PHASE_L1, PHASE_L2, PHASE_L3 } from '../sim/invasion/constants.js';
import type { PlaceholderTextures } from './textures.js';

/** 크로스페이드 길이(틱, 60Hz 기준 0.75초). 전이 연출 길이의 정본. */
export const INVASION_CROSSFADE_TICKS = 45;

/** 침공 페이즈 코드 → 배경 텍스처 인덱스. 페이즈 코드가 곧 인덱스다(계약). */
export const INVASION_BACKDROP_INDEX: readonly number[] = [PHASE_L1, PHASE_L2, PHASE_L3];

/**
 * 전이 경과 틱 → 크로스페이드 알파(0..1). **순수 함수**다.
 *
 * `elapsed` 는 `현재 틱 - 전이 시작 틱` 이며 보간 프레임 때문에 소수일 수 있다. 0 이하는 0,
 * {@link INVASION_CROSSFADE_TICKS} 이상은 1 이고 그 사이는 smoothstep(3t²-2t³) 으로 완만하게
 * 들어오고 나간다(선형은 시작·끝에서 눈에 띄게 끊긴다).
 */
export function backdropCrossfadeAlpha(elapsed: number): number {
  if (!(elapsed > 0)) return 0; // NaN 방어 포함
  if (elapsed >= INVASION_CROSSFADE_TICKS) return 1;
  const t = elapsed / INVASION_CROSSFADE_TICKS;
  return t * t * (3 - 2 * t);
}

/**
 * 페이즈에 해당하는 배경 텍스처. 범위 밖 페이즈는 L1(0)로 폴백하고, 침공 배경 슬롯이 비어
 * 있으면 행성 배경 0 번으로 폴백한다(자산 누락에도 화면이 검게 남지 않는다).
 */
export function invasionBackdropTexture(textures: PlaceholderTextures, phase: number): Texture {
  const idx = INVASION_BACKDROP_INDEX[phase] ?? PHASE_L1;
  return (
    textures.invasionBackdrop[idx] ??
    textures.invasionBackdrop[PHASE_L1] ??
    textures.background[0] ??
    textures.gem
  );
}

/**
 * 침공 배경 레이어. main.ts 가 `view` 를 스테이지 맨 뒤에 붙이고, 매 프레임
 * {@link sync} → {@link scroll} 순으로 부른다.
 *
 * ```ts
 * const backdrop = new InvasionBackdrop(textures, DESIGN_WIDTH, DESIGN_HEIGHT);
 * stage.addChildAt(backdrop.view, 0);
 * backdrop.begin(PHASE_L1, 0);              // 런 시작 — 페이드 없이 즉시 확정
 * backdrop.sync(world.invasion3.phase, tick); // 매 프레임(멱등)
 * backdrop.scroll(camX, camY);
 * ```
 */
export class InvasionBackdrop {
  readonly view = new Container();
  /** 뒤 장(이전 레이어). 전이 중에만 의미가 있다. */
  private readonly back: TilingSprite;
  /** 앞 장(현재 레이어). 전이가 끝나면 alpha 1 로 고정된다. */
  private readonly front: TilingSprite;
  /** 현재 표시 중인 페이즈(-1 = 아직 시작 안 함). */
  private phase = -1;
  /** 마지막 전이 시작 틱. */
  private transitionTick = 0;
  /** 전이 진행 중인지(끝나면 false — 매 프레임 알파를 다시 쓰지 않는다). */
  private fading = false;

  constructor(
    private readonly textures: PlaceholderTextures,
    width: number,
    height: number,
  ) {
    const blank = invasionBackdropTexture(textures, PHASE_L1);
    this.back = new TilingSprite({ texture: blank, width, height });
    this.front = new TilingSprite({ texture: blank, width, height });
    this.front.alpha = 1;
    this.view.addChild(this.back);
    this.view.addChild(this.front);
  }

  /** 현재 표시 페이즈(테스트·진단용). 아직 시작 전이면 -1. */
  get currentPhase(): number {
    return this.phase;
  }

  /** 전이 진행 중 여부(테스트·진단용). */
  get isFading(): boolean {
    return this.fading;
  }

  /** 런 시작 — 페이드 없이 해당 레이어로 즉시 확정한다. */
  begin(phase: number, tick: number): void {
    const tex = invasionBackdropTexture(this.textures, phase);
    this.back.texture = tex;
    this.front.texture = tex;
    this.front.alpha = 1;
    this.phase = phase;
    this.transitionTick = tick;
    this.fading = false;
  }

  /**
   * 페이즈 변화를 감지해 크로스페이드를 걸고, 진행 중이면 알파를 갱신한다.
   *
   * **매 프레임 호출해도 무해**하다(멱등) — main.ts 가 페이즈 비교를 직접 하지 않아도 되고,
   * 비교를 잊어 전이가 조용히 사라지는 결함이 구조적으로 불가능해진다.
   */
  sync(phase: number, tick: number): void {
    if (this.phase === -1) {
      this.begin(phase, tick);
      return;
    }
    if (phase !== this.phase) {
      // 이전 전이가 안 끝났어도 현재 합성 결과를 뒤 장으로 확정하지 않는다 —
      // 앞 장(직전 목표 레이어)을 뒤로 내리는 편이 시각적으로 자연스럽다.
      this.back.texture = this.front.texture;
      this.front.texture = invasionBackdropTexture(this.textures, phase);
      this.front.alpha = 0;
      this.phase = phase;
      this.transitionTick = tick;
      this.fading = true;
      return;
    }
    if (!this.fading) return;
    const a = backdropCrossfadeAlpha(tick - this.transitionTick);
    this.front.alpha = a;
    if (a >= 1) {
      this.fading = false;
      this.back.texture = this.front.texture;
    }
  }

  /**
   * 이음매 없는 배경 스크롤. main.ts 의 기존 규율과 동일하게 **f64 모듈로를 먼저 취해**
   * 작은 값만 렌더러에 넘긴다(PIXI f32 UV 정밀도 "swim" 방지).
   */
  scroll(camX: number, camY: number): void {
    for (const s of [this.back, this.front]) {
      const tw = s.texture.width;
      const th = s.texture.height;
      if (tw > 0 && th > 0) s.tilePosition.set(-camX % tw, -camY % th);
    }
  }

  /** 뷰포트 크기 변경(main.ts 의 리사이즈 훅에서). */
  resize(width: number, height: number): void {
    this.back.width = width;
    this.back.height = height;
    this.front.width = width;
    this.front.height = height;
  }

  set visible(v: boolean) {
    this.view.visible = v;
  }

  get visible(): boolean {
    return this.view.visible;
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
