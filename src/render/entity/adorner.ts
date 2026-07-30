/**
 * 엔티티 **장식자(adorner)** 심(seam) — 엔티티 비주얼 레인이 공유 파일을 건드리지 않고
 * 자기 모듈만으로 이펙트를 붙이기 위한 등록 지점.
 *
 * ## 왜 이 심이 먼저인가
 * `entityRenderer.ts` 는 1,900줄이고 플레이어·적 루프가 **한 함수 안**에 있다. 플레이어 레인과
 * 적 레인이 각자 "여기에 내 이펙트 한 줄"을 더하면 정확히 같은 줄에서 충돌한다. 그래서 등록을
 * **배열 리터럴이 아니라 함수 호출**({@link registerAdornerFactory})로 둔다 — 각 레인은 자기
 * 모듈의 최상위에서 자기 kind 를 한 번 등록할 뿐이고, 공유 파일에는 아무도 손대지 않는다.
 *
 * ## 계약
 * - **render-only**(ADR-0005). `src/sim/` 은 **타입 전용 import** 만 한다. 해시에 기여하지 않는다.
 * - 장식자가 만드는 컨테이너는 스프라이트의 **자식이 아니라 형제**여야 한다(Pixi v8 은
 *   `Sprite.addChild` 를 deprecate 했다). 형제는 **부모 `destroy` 로 회수되지 않으므로**
 *   {@link EntityAdorner.dispose} 가 반드시 자기 것을 떼고 파괴해야 한다 — 킬 루프·reset·
 *   destroy·디졸브 네 경로 전부에서 호출된다. 접지 그림자가 이 회수를 빠뜨려 "사라진 실체의
 *   그림자가 바닥에 얼어붙는" 결함을 실제로 냈다.
 * - 모든 신규 이펙트는 {@link AdornerContext.gates} 뒤에 있어야 한다. 게이트 없는 이펙트는 반려다.
 *
 * ## 등록되지 않은 kind = 장식자 0개
 * 팩토리가 없는 kind 는 {@link NO_ADORNERS}(공유 빈 배열)를 받는다 — 할당도 호출도 없으므로
 * 팩토리를 하나도 등록하지 않은 상태에서는 화면이 한 픽셀도 바뀌지 않는다.
 */

import type { Container, Sprite } from 'pixi.js';

import type { EntityKind } from '../../sim/entities.js';
import type { EntitySnapshot } from '../../sim/snapshot.js';
import type { EnvTheme } from '../env/theme.js';
import type { EffectGates, QualityTier } from '../qualityTier.js';

/**
 * 매 프레임 장식자에게 주어지는 읽기 전용 맥락. 렌더러가 프레임당 **한 번** 만들어 모든
 * 장식자가 공유한다(장식자별 재계산 금지 — 게이트 산출을 엔티티 수만큼 돌리면 안 된다).
 */
export interface AdornerContext {
  /**
   * 스프라이트 **아래** 레이어(가산 합성). 발광·잔상·엔진 불꽃처럼 실루엣을 덮으면 안 되는
   * 것은 전부 여기 붙인다 — 탄막 가독성 계약(발광=아래·폭발=위 비대칭)의 연장이다.
   */
  readonly belowLayer: Container;
  /** 스프라이트 **위** 레이어. 파편·충격·숫자처럼 순간적으로 덮어도 되는 것만. */
  readonly aboveLayer: Container;
  /** 렌더 프레임 카운터. 결정적 애니메이션 위상의 기준(sim tick 이 아니다). */
  readonly frameTick: number;
  /** 프레임 델타(초). 벽시계 기반 감쇠·스프링에만 쓴다(해시 무관). */
  readonly dt: number;
  /** 이번 프레임 이펙트 게이트(티어 × 접근성 감소 토글). */
  readonly gates: EffectGates;
  /** 이번 프레임 실 품질 티어. 게이트로 못 나누는 연속 예산(입자 수 등)에 쓴다. */
  readonly tier: QualityTier;
  /** 이번 런의 환경 테마. `null` = 담당 테마 없음 → 광원 파생 이펙트는 스스로 꺼야 한다. */
  readonly theme: EnvTheme | null;
  /** 스냅샷 보간 계수 [0,1]. 렌더러가 스프라이트에 이미 적용한 값과 동일하다. */
  readonly alpha: number;
  /**
   * 이번 프레임 **플레이어 기체가 런타임 3D 액터로 구동 중**인가
   * ({@link file://../three3d/shipActor.ts}). 플레이어 장식자 중 3D 와 **같은 일을 하는 항목**은
   * 이 값이 참일 때 스스로 물러나야 한다.
   *
   * 왜 게이트가 아니라 별도 필드인가: `EffectGates` 는 "이 이펙트를 켤 예산이 있는가"(티어·접근성)를
   * 뜻하는데, 이건 예산이 아니라 **소유권**이다 — 같은 축을 두 시스템이 그리면 이중이 되거나 서로를
   * 상쇄한다. 보스에서 실제로 그랬다: 2D 과열 tint(곱연산)가 3D 발광을 정확히 되돌려 **보스가
   * 화면에서 사라졌다**(사용자 신고 2026-07-30). 플레이어에는 tint 연출이 없지만 뱅킹 변환과 판면
   * 방향광이 같은 유형의 충돌이라 같은 방식으로 가른다.
   *
   * 플레이어 외 kind 는 이 값을 무시한다(맥락은 프레임당 하나라 전 엔티티가 공유한다).
   */
  readonly ship3d: boolean;
}

/**
 * 엔티티 하나에 붙는 장식자. 스프라이트 수명과 **평행한 수명**을 가진다:
 * 생성(팩토리) → `onAttach` → 매 프레임 `onFrame` → 소멸 시 `dispose`.
 */
export interface EntityAdorner {
  /** 진단·테스트 식별용 이름(선택). 화면 거동에는 관여하지 않는다. */
  readonly name?: string;
  /** 스프라이트가 만들어진 직후 1회. 컨테이너 생성·레이어 부착은 여기서 하는 것이 싸다. */
  onAttach?(sprite: Sprite, e: EntitySnapshot, ctx: AdornerContext): void;
  /**
   * 매 프레임. `sprite` 는 이미 보간 위치·회전이 적용된 상태다.
   *
   * @param prev 직전 스냅샷의 같은 엔티티(없으면 `e` 자신). 속도·피격 델타의 유일한 근원이다 —
   *   sim 에 필드를 더하지 말고 여기서 파생해라(§2-1).
   */
  onFrame(sprite: Sprite, e: EntitySnapshot, prev: EntitySnapshot, ctx: AdornerContext): void;
  /**
   * 회수. **형제 컨테이너를 여기서 반드시 떼고 파괴한다** — 부모 `destroy` 는 형제를 걷지
   * 않는다. 두 번 불려도 안전해야 한다(경로가 겹칠 수 있다).
   */
  dispose(ctx: AdornerContext): void;
}

/** kind 하나에 대해 장식자 목록을 만드는 팩토리. 빈 배열을 돌려주면 아무것도 붙지 않는다. */
export type AdornerFactory = (e: EntitySnapshot) => EntityAdorner[];

/**
 * 장식자가 하나도 없을 때 쓰는 **공유 빈 배열**. 엔티티마다 `[]` 를 새로 만들면 탄막 밀도에서
 * 프레임당 수천 개가 할당된다.
 */
export const NO_ADORNERS: readonly EntityAdorner[] = Object.freeze([]);

/**
 * kind → 팩토리 목록. 한 kind 에 여러 레인이 등록할 수 있다(플레이어 레인이 엔진 불꽃과
 * 뱅킹을 따로 등록하는 식). 등록 순서가 곧 `onFrame` 호출 순서다.
 */
const registry = new Map<EntityKind, AdornerFactory[]>();

/**
 * 팩토리를 등록한다. **각 레인은 자기 모듈에서 한 번만** 부른다(모듈 최상위 부수효과).
 * 같은 kind 에 여러 번 부르면 전부 누적된다 — 등록 해제 API 는 일부러 두지 않았다(런타임에
 * 이펙트를 껐다 켜는 것은 게이트의 몫이지 레지스트리의 몫이 아니다).
 */
export function registerAdornerFactory(kind: EntityKind, factory: AdornerFactory): void {
  const list = registry.get(kind);
  if (list === undefined) registry.set(kind, [factory]);
  else list.push(factory);
}

/**
 * 이 엔티티에 붙일 장식자를 만든다. 등록된 팩토리가 없으면 {@link NO_ADORNERS} 를 그대로
 * 돌려준다(할당 0 · 거동 불변).
 */
export function createAdorners(e: EntitySnapshot): readonly EntityAdorner[] {
  const list = registry.get(e.kind);
  if (list === undefined || list.length === 0) return NO_ADORNERS;
  const out: EntityAdorner[] = [];
  for (const f of list) {
    for (const a of f(e)) out.push(a);
  }
  return out.length === 0 ? NO_ADORNERS : out;
}

/** 등록된 팩토리 수(진단·테스트용 관측창). 렌더 거동에는 관여하지 않는다. */
export function adornerFactoryCount(kind: EntityKind): number {
  return registry.get(kind)?.length ?? 0;
}

/**
 * 레지스트리를 통째로 비운다. **테스트 격리 전용** — 프로덕션 경로는 부르지 않는다
 * (모듈 최상위 등록이라 한 번 지우면 그 프로세스에서 되살릴 방법이 없다).
 */
export function clearAdornerFactories(): void {
  registry.clear();
}
