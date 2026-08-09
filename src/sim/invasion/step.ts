/**
 * 침공 3레이어 — 레이어 스텝 디스패치 (M7a · L2-scroll-phase).
 *
 * `world.ts` 는 L2 레인 단독 소유고, L3(편대)·L4(설비)·L5(코어방)는 world 를 열지 않는다.
 * 그 경계를 지키는 장치가 이 모듈이다 — 각 레인은 L0 이 선언한 시그니처
 * ({@link InvasionStepHooks})만 구현하고, 여기 **한 번** 등록한다. world.ts 는 훅 묶음만
 * 알면 되므로 world → formation/facility/coreRoom 의 정적 의존이 생기지 않는다.
 *
 * ## 결정론 주의
 * 등록은 **모듈 로드 시 1회(정적 배선)** 여야 한다. 런 도중 훅을 갈아끼우면 같은 seed·입력이
 * 다른 결과를 내 ADR-0005 가 깨진다. 테스트에서 훅을 갈아끼운 뒤에는 반드시
 * {@link resetInvasionStepHooks} 로 되돌린다.
 */

import { garrisonLayers, normalizeGarrisonLevel } from '../../../data/invasion/garrison.js';
import { normalizeMaintenance } from './guardian.js';
import { normalizeInvasionDensity } from './density.js';
import type { WorldState } from '../world.js';
import { PHASE_L1, PHASE_L2 } from './constants.js';
import type { Invasion3Config, InvasionRuntime, InvasionStepContext, InvasionStepHooks } from './types.js';
import { stepInvasionFormation, stepInvasionCorridorFormation } from './formation.js';
import { enterFacilityLayer, stepFacility } from './facility.js';
import { enterCoreRoom, stepCoreRoom } from './coreRoom.js';
import { applyModuleSpawnEffects } from '../moduleEffects.js';

/**
 * 정본 배선 — L3(편대)·L4(설비)·L5(코어방) 구현체를 **모듈 로드 시 1회** 정적으로 묶는다.
 *
 * 통합 게이트에서 확정. 이 상수가 없으면 훅이 영원히 비어 3레이어 런이 아무것도 스폰하지 않고
 * 조용히 빈 맵을 5분간 스크롤한다(결함이 예외가 아니라 '무내용'으로 나타나 눈에 안 띈다).
 * `enterFormation` 은 없다 — 편대는 진입 1회 스폰이 아니라 스크롤 진행에 따른 지속 스폰이다.
 */
const DEFAULT_HOOKS: InvasionStepHooks = {
  stepFormation: stepInvasionFormation,
  stepCorridorFormation: stepInvasionCorridorFormation,
  enterFacility: enterFacilityLayer,
  stepFacility,
  enterCoreRoom,
  stepCoreRoom,
};

/** 현재 배선된 훅 묶음. 미등록 필드는 no-op. */
let registered: InvasionStepHooks = { ...DEFAULT_HOOKS };

/**
 * 훅 묶음을 갈아끼운다. 정본 경로는 위 {@link DEFAULT_HOOKS} 정적 배선이고, 이 함수는 테스트가
 * 특정 레이어만 격리해 관찰할 때 쓴다. **런 도중 호출 금지**(ADR-0005 — 같은 seed·입력이 다른
 * 결과를 낸다). 되돌릴 때는 {@link resetInvasionStepHooks}.
 */
export function registerInvasionStepHooks(hooks: InvasionStepHooks): void {
  registered = { ...hooks };
}

/** 정본 정적 배선으로 되돌린다(테스트 격리 해제). */
export function resetInvasionStepHooks(): void {
  registered = { ...DEFAULT_HOOKS };
}

/** 현재 배선된 훅 묶음(읽기용 사본이 아니라 원본 — 호출부는 수정하지 않는다). */
export function invasionStepHooks(): InvasionStepHooks {
  return registered;
}

/**
 * 스텝 컨텍스트를 만든다. `runtime` 은 **참조로** 실린다 — 페이즈 머신이 갱신하는 같은 객체를
 * 훅들이 그대로 읽는다(틱 중간 값 불일치 방지).
 *
 * ## 기본 수비대 충원(결정 #22)
 * `layers` 는 원본이 아니라 {@link garrisonLayers} 파생 사본이다 — 빈 웨이브 슬롯·빈 소켓이
 * 스폰 단계에서만 기본 수비대로 채워진다. 충원은 **정규화가 아니라 스폰 단계 주입**이라
 * `config.layers`(직렬화·hashWorld 침공 블록·EF `layersEqual` 이 보는 값)는 끝까지 빈 정규형으로
 * 남는다. 이 한 줄이 빠지면 빈 배치 기지가 적 0마리 '무저항 기지'가 된다.
 * `garrisonLayers` 는 입력 객체 신원 기준 WeakMap 메모이즈라 매 틱 호출해도 재할당이 없다.
 */
export function makeInvasionContext(
  config: Invasion3Config,
  runtime: InvasionRuntime,
): InvasionStepContext {
  const density = normalizeInvasionDensity(config.density);
  const bp = config.defenseBonusBp;
  const garrisonLevel = normalizeGarrisonLevel(config.garrisonLevel);
  return {
    // 빈 L2 소켓을 스포너로 채울 기수·충원 레벨이 둘 다 튜닝 축이므로 충원에 함께 넘긴다.
    // 메모는 (layers 신원 × 기수 × 레벨) 조합 기준이라 축을 돌려도 이전 사본이 새지 않는다.
    layers: garrisonLayers(config.layers, density.l2GarrisonSpawners, garrisonLevel),
    runtime,
    maintenance: normalizeMaintenance(config.maintenance),
    density,
    defenseBonusBp:
      bp === undefined || !Number.isFinite(bp) || bp <= 0 ? 0 : Math.trunc(bp),
    garrisonLevel,
  };
}

/** 현재 페이즈에 대응하는 진입 훅을 1회 호출한다(정적 배치 스폰). */
export function enterInvasionLayer(state: WorldState, ctx: InvasionStepContext): void {
  const phase = ctx.runtime.phase;
  if (phase === PHASE_L1) registered.enterFormation?.(state, ctx);
  else if (phase === PHASE_L2) registered.enterFacility?.(state, ctx);
  else registered.enterCoreRoom?.(state, ctx);
  // 코어 모듈 스폰 시점 효과(M7b): 설비(L2)·코어/기물(L3)은 **이 진입에서** 깔리므로 진입
  // 직후에 적용해야 대상이 존재한다. T0 1회 적용으로는 전부 빗나간다. 각 효과는 자기 래치로
  // 1회만 적용되므로(applyModuleSpawnEffects) 진입마다 불러도 이중 적용이 없다.
  if (state.moduleRuntime !== undefined) applyModuleSpawnEffects(state.moduleRuntime, state);
}

/** 현재 페이즈에 대응하는 매 틱 스텝 훅을 호출한다. */
export function stepInvasionLayer(state: WorldState, ctx: InvasionStepContext): void {
  const phase = ctx.runtime.phase;
  if (phase === PHASE_L1) registered.stepFormation?.(state, ctx);
  else if (phase === PHASE_L2) {
    registered.stepFacility?.(state, ctx);
    // L2 배경 편대(밀도 축). 설비 훅과 **별개**로 돈다 — 회랑의 이동 적 공급원이 스포너
    // 설비뿐이라 밴드에 따라 동시 이동 적이 0마리였던 것을 메운다. 간격 0 이면 즉시 반환.
    registered.stepCorridorFormation?.(state, ctx);
  } else registered.stepCoreRoom?.(state, ctx);
}
