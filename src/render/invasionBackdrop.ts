/**
 * 침공 3레이어 배경 · 레이어 전환 크로스페이드 (M7a · L10-render).
 *
 * ## ⚠️ 이 모듈의 역할이 바뀌었다 — 배경이 아니라 **페이즈 전환 베일**이다
 * 침공에도 Wang 지형(`autotile`)을 켜면서 이 레이어는 스테이지 깊이상 **지형 위**로 올라갔다.
 * Wang 타일은 알파 255 불투명이라 예전 깊이(지형 아래)에 두고 지형을 켜면 배경 3종과
 * 크로스페이드가 통째로 가려져 사라진다 — "지형 추가"가 아니라 "배경 삭제"가 되는 것이다.
 *
 * 그래서 평상시 `view.alpha = 0`(화면 기여 0)이고, 페이즈가 바뀌는 45틱 동안만 떠올랐다
 * 가라앉아 **타일셋 스왑의 하드 컷을 가린다**({@link backdropVeilAlpha}). 베일이 가장
 * 불투명한 순간에 지형을 갈아 끼우면 교체가 화면에서 보이지 않는다 —
 * 그 시점 통지가 {@link InvasionBackdrop.takeTerrainSwap} 이다.
 *
 * `backdropCrossfadeAlpha`·`invasionBackdropTexture`·`INVASION_BACKDROP_INDEX` 는 그대로다.
 * 베일 곡선도 그 순수 함수에서 파생한다(두 개의 감쇠 곡선을 손으로 적으면 갈라진다).
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
 * 전이 경과 틱 → **베일** 알파(0..1). 순수 함수이고 {@link backdropCrossfadeAlpha} 에서 파생한다.
 *
 * 앞 절반에서 0 → 1 로 떠오르고 뒤 절반에서 1 → 0 으로 가라앉는다. 전이 밖(경과 ≤ 0 또는
 * ≥ {@link INVASION_CROSSFADE_TICKS})은 **정확히 0** 이다 — 침공 중 대부분의 프레임에서 이
 * 레이어가 화면에 한 픽셀도 기여하지 않는다는 뜻이고, 그래야 그 아래 Wang 지형이 보인다.
 *
 * 감쇠 곡선을 새로 적지 않고 크로스페이드 함수를 반으로 접어 쓴다. 두 벌을 손으로 적으면
 * 한쪽만 손보다 갈라지는 것이 이 리포의 반복 결함이다.
 */
export function backdropVeilAlpha(elapsed: number): number {
  if (!(elapsed > 0)) return 0; // NaN 방어 포함
  if (elapsed >= INVASION_CROSSFADE_TICKS) return 0;
  const half = INVASION_CROSSFADE_TICKS / 2;
  return elapsed <= half
    ? backdropCrossfadeAlpha(elapsed * 2)
    : backdropCrossfadeAlpha((INVASION_CROSSFADE_TICKS - elapsed) * 2);
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
 * stage.addChild(backdrop.view);            // ⚠️ autotile.layer 와 env 슬롯 **위**(베일)
 * backdrop.begin(PHASE_L1, 0);              // 런 시작 — 베일 없이 즉시 확정(alpha 0)
 * backdrop.sync(world.invasion3.phase, tick); // 매 프레임(멱등)
 * const swap = backdrop.takeTerrainSwap();  // 베일 절정에서 1회만 페이즈를 돌려준다
 * if (swap >= 0) autotile.configure(invasionTiles[swap], seed);
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
  /**
   * 베일이 절정을 지났고 아직 호출부가 가져가지 않은 지형 교체 대상 페이즈(-1 = 없음).
   * {@link takeTerrainSwap} 이 **한 번만** 돌려준다 — 매 프레임 재타일을 유발하지 않는다.
   */
  private pendingSwap = -1;
  /** 이번 전이의 교체 통지가 이미 준비 큐로 넘어갔는가(절정 판정 1회용). */
  private swapArmed = false;

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

  /**
   * 런 시작 — 베일 없이 해당 레이어로 즉시 확정한다. 베일이므로 `view.alpha` 는 0 이고,
   * 이 시점의 지형 타일셋은 호출부가 직접 건다(전환이 아니라 시작이라 가릴 하드 컷이 없다).
   */
  begin(phase: number, tick: number): void {
    const tex = invasionBackdropTexture(this.textures, phase);
    this.back.texture = tex;
    this.front.texture = tex;
    this.front.alpha = 1;
    this.view.alpha = 0;
    this.phase = phase;
    this.transitionTick = tick;
    this.fading = false;
    this.pendingSwap = -1;
    this.swapArmed = false;
  }

  /**
   * 지형 타일셋을 갈아 끼울 시점 통지. 베일이 절정(불투명)을 지난 프레임에 **한 번만**
   * 그 페이즈를 돌려주고, 그 밖에는 -1 이다.
   *
   * 왜 호출부가 페이즈를 직접 보고 갈지 않는가: 페이즈 변화 순간에 갈면 교체가 **맨눈에**
   * 보인다(베일이 아직 투명하다). 이 통지 하나로 "언제 가려지는가"의 정본이 베일 쪽에 남는다.
   */
  takeTerrainSwap(): number {
    const p = this.pendingSwap;
    this.pendingSwap = -1;
    return p;
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
      this.swapArmed = false;
      this.view.alpha = 0;
      return;
    }
    if (!this.fading) return;
    const elapsed = tick - this.transitionTick;
    // 베일 안에서 두 장이 교차 디졸브한다 — 베일이 걷힐 때 앞 장(새 레이어)만 남는다.
    this.front.alpha = backdropCrossfadeAlpha(elapsed);
    this.view.alpha = backdropVeilAlpha(elapsed);
    // 절정(절반)을 지나면 지형 교체를 예약한다. 이 순간 베일이 가장 불투명하다.
    if (!this.swapArmed && elapsed >= INVASION_CROSSFADE_TICKS / 2) {
      this.swapArmed = true;
      this.pendingSwap = this.phase;
    }
    if (elapsed >= INVASION_CROSSFADE_TICKS) {
      this.fading = false;
      this.back.texture = this.front.texture;
      this.view.alpha = 0;
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
