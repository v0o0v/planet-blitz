/**
 * 침공 3레이어 — 배치 스키마 정본 (M7a · L0-schema).
 *
 * `defenses.layout` jsonb / T0 스냅샷 `authority.layers` / 클라 배치 에디터 / EF 재실행이
 * 전부 이 하나의 계약을 쓴다. 구 `DefenseLayout`(src/sim/defense.ts:305 — core/turrets/
 * obstacles)은 M7a 웨이브 0~2 동안 병존하다가 L11 에서 삭제된다.
 *
 * ## 불변식 — 스키마 전체가 정수다
 * {@link normalizeInvasionLayers} 를 통과한 InvasionLayers 의 **모든 수치 리프는 정수**다
 * (좌표·HP 포함). f64 를 스키마에서 완전히 몰아내면
 *   ① 위조 대조(layersEqual)가 비트 비교로 정확해지고,
 *   ② hashWorld 가 hashFloat 대신 hashU32/hashI32 만 쓰면 되며,
 *   ③ 클라(Node)·서버(Deno) 재실행의 갈림 원인이 하나 줄어든다.
 * 정규화되지 않은 raw 를 sim·해시에 넣는 경로는 없어야 한다.
 *
 * ## 레이어 구성
 *   L1 = 웨이브 슬롯 6 (편대)
 *   L2 = 맵 템플릿 1 + 설치 소켓 N (직선 12 / 굴곡 10 / 병목 8)
 *   L3 = 보스 1 + 수호 2 + 기물 6 + 코어(HP·좌표) + 코어 모듈 2
 */

import type { GuardianSnapshot } from '../../../data/guardian.js';
import type { WorldState } from '../world.js';
import type { CoreModuleConfig } from '../moduleEffects.js';

// ---------------------------------------------------------------------------
// 공용 Ref — 카탈로그 참조 + 강화 3축
// ---------------------------------------------------------------------------

/**
 * 배치된 방어체 1기의 참조. **정수 5필드**로 완결된다(실제 스탯은 카탈로그 × 이 축들로
 * 결정론 파생 — 스탯 값 자체를 직렬화하지 않는다. 위조 표면을 줄이는 설계).
 */
export interface InvasionRef {
  /** 카탈로그 배열 인덱스(append-only 계약). 0 이상 정수. */
  catalogId: number;
  /** 레벨 [{@link INVASION_LEVEL_MIN}, {@link INVASION_LEVEL_MAX}]. */
  level: number;
  /** 승급 단계 [0, {@link INVASION_ASCENSION_MAX}]. */
  ascension: number;
  /** 어픽스 롤 시드(uint32). 같은 시드 → 같은 어픽스(결정론 재현). */
  affixSeed: number;
  /** 등급 코드 [0, {@link INVASION_RARITY_COUNT}-1] — 0=normal, 3=unique. */
  rarity: number;
}

/** L1 웨이브 슬롯에 배치된 편대. */
export type FormationRef = InvasionRef;
/** L2 소켓에 배치된 설비(방어포·해저드·스포너). */
export type FacilityRef = InvasionRef;
/** L3 기물 소켓에 배치된 기물. */
export type PropRef = InvasionRef;
/** L3 방어 보스. */
export type BossRef = InvasionRef;
/** L3 코어 모듈(구 '방어 카드' 계승). */
export type ModuleRef = InvasionRef;

// ---------------------------------------------------------------------------
// L3 수호 기체 배치
// ---------------------------------------------------------------------------

/**
 * L3 수호 기체 1기의 배치(구 GuardianPlacement 계승 — 필드 의미 동일).
 * 슬롯 i ↔ 활성 수호 i 매핑이 SQL·EF·클라 3자에서 비트 동일해야 하므로 배열은 **고정 길이
 * {@link INVASION_GUARDIAN_SLOTS} + null 허용**이다(밀집 배열이면 슬롯 인덱스가 어긋난다).
 */
export interface InvasionGuardianPlacement {
  /** 배치 x(정수 월드 유닛). */
  x: number;
  /** 배치 y(정수 월드 유닛). */
  y: number;
  /** 퇴역 복사 스냅샷(전 필드 정수). */
  snapshot: GuardianSnapshot;
  /** 남은 성능%(centi-percent, 풍화 반영). */
  performanceCP: number;
  /** 계보 수호 가지 보너스(basis-point 0..5000). */
  lineageBonusBp: number;
  /** 계보 마일스톤 비트마스크(data/lineage.ts MILESTONE_*). 0 = 없음. */
  milestones: number;
}

// ---------------------------------------------------------------------------
// 레이어
// ---------------------------------------------------------------------------

/** L1 — 대기권 돌파(종스크롤). 웨이브 슬롯 {@link INVASION_WAVE_SLOTS} 고정 길이. */
export interface InvasionLayer1 {
  /** 고정 길이 6. null = 빈 슬롯(스폰 단계에서 기본 수비대가 충원). */
  waveSlots: (FormationRef | null)[];
}

/** L2 — 회랑 돌파(횡스크롤). 맵 템플릿이 소켓 개수를 정한다. */
export interface InvasionLayer2 {
  /** 맵 템플릿 코드 [0, {@link INVASION_TEMPLATE_COUNT}-1]. */
  templateId: number;
  /** 고정 길이 = INVASION_SOCKET_COUNTS[templateId]. null = 빈 소켓. */
  sockets: (FacilityRef | null)[];
}

/** L3 코어 배치(내구도 + 좌표). */
export interface InvasionCorePlacement {
  /** 코어 내구도(1 이상 정수). 기본 {@link INVASION_CORE_HP}. */
  hp: number;
  /** 코어 x(정수 월드 유닛). */
  x: number;
  /** 코어 y(정수 월드 유닛). */
  y: number;
}

/** L3 — 코어방(고정 카메라). */
export interface InvasionLayer3 {
  /** 방어 보스 1(슬롯 {@link INVASION_BOSS_SLOTS}). null = 없음(기본 수비대 충원 대상). */
  boss: BossRef | null;
  /** 고정 길이 {@link INVASION_GUARDIAN_SLOTS}. null = 빈 슬롯. */
  guardians: (InvasionGuardianPlacement | null)[];
  /** 고정 길이 {@link INVASION_PROP_SLOTS}. null = 빈 소켓(비움 — 충원 안 함). */
  props: (PropRef | null)[];
  /** 코어. */
  core: InvasionCorePlacement;
  /** 고정 길이 {@link INVASION_CORE_MODULE_SLOTS}. null = 빈 슬롯. */
  modules: (ModuleRef | null)[];
}

/** 방어 배치 전체(3레이어). `defenses.layout` jsonb 계약. */
export interface InvasionLayers {
  l1: InvasionLayer1;
  l2: InvasionLayer2;
  l3: InvasionLayer3;
}

// ---------------------------------------------------------------------------
// 런타임 페이즈 상태
// ---------------------------------------------------------------------------

/** 페이즈 코드(0=L1, 1=L2, 2=L3). 값 자체는 constants.ts 의 PHASE_* 를 쓴다. */
export type InvasionPhase = 0 | 1 | 2;

/**
 * 침공 런타임 상태(sim 권위). WorldState 가 이 형태를 품고, hashWorld 침공 블록 v2 가
 * 필드 순서대로 접는다(phase → phaseEnterTick → scrollX → scrollY → accelCp).
 * **전 필드 정수**다 — 스크롤 오프셋도 정수 유닛으로 누적해 f64 드리프트를 없앤다.
 */
export interface InvasionRuntime {
  /** 현재 페이즈. */
  phase: InvasionPhase;
  /** 현재 페이즈에 진입한 틱(전이 결정성 대조용). */
  phaseEnterTick: number;
  /** 스크롤 창의 x 오프셋(정수 월드 유닛). */
  scrollX: number;
  /** 스크롤 창의 y 오프셋(정수 월드 유닛). */
  scrollY: number;
  /** 전멸 가속 배율(centi-percent, [100, 200]). */
  accelCp: number;
}

/** 침공 런 설정(WorldConfig.invasion3). 구 InvasionConfig 는 L11 에서 삭제돼 이것이 유일하다. */
export interface Invasion3Config {
  /** 정규화된 3레이어 배치. */
  layers: InvasionLayers;
  /** 총 제한 시간(틱). 기본 {@link INVASION_TOTAL_TICKS}. */
  timeLimitTicks: number;
  /** 방어 정비도(centi-percent 0..10000). 미지정 = 완전 정비. */
  maintenance?: number;
  /**
   * 코어 모듈 효력(M7b · ADR-0018). T0 스냅샷이 고정한 서버 권위 {instances, matchup} 이며,
   * `defenses.equipped_module_ids` → `core_modules` 행을 서버가 풀어 준 결과다.
   *
   * **{@link InvasionLayer3.modules}(ModuleRef 슬롯)와 다른 축이다.** 코어 모듈은 카탈로그
   * 참조가 아니라 시드 롤이 굳은 **소모성 인스턴스**라 layers 직렬화로는 표현되지 않는다.
   * l3.modules 는 스키마 예약(항상 null)으로 남기고 정본은 이 필드다 — 스키마에서 빼면
   * normalize/layersEqual/해시 v2 재생성이 동반되므로 M7a 계약을 건드리지 않는다.
   *
   * 미장착이면 필드 자체를 두지 않는다(조건부 접기 → 거동·해시 바이트 불변).
   */
  modules?: CoreModuleConfig;
}

// ---------------------------------------------------------------------------
// 스텝 훅 시그니처 — W1 레인 병렬화의 핵심 장치
// ---------------------------------------------------------------------------

/**
 * 스텝 함수 공용 컨텍스트. world.ts 소유 레인(L2)이 이 객체 하나를 만들어 L3/L4/L5 의
 * 스텝 함수에 넘긴다. 각 레인은 world.ts 를 열지 않고 이 시그니처만 구현하면 된다.
 */
export interface InvasionStepContext {
  /** 정규화된 배치(런 내내 불변). */
  readonly layers: InvasionLayers;
  /** 런타임 페이즈 상태(스텝 함수는 읽기만 — 갱신은 L2 페이즈 머신 소관). */
  readonly runtime: InvasionRuntime;
  /** 방어 정비도(centi-percent 0..10000, 정규화 완료값). */
  readonly maintenance: number;
}

/** L1 편대 스폰·진행(src/sim/invasion/formation.ts — L3 레인 구현). */
export type StepFormationFn = (state: WorldState, ctx: InvasionStepContext) => void;

/** L2 설비 거동(방어포·주기 해저드·스포너, src/sim/invasion/facility.ts — L4 레인 구현). */
export type StepFacilityFn = (state: WorldState, ctx: InvasionStepContext) => void;

/** L3 코어방 거동(보스·기물·코어·수호, src/sim/invasion/coreRoom.ts — L5 레인 구현). */
export type StepCoreRoomFn = (state: WorldState, ctx: InvasionStepContext) => void;

/**
 * 레이어 진입 시 1회 호출되는 스폰 훅. 페이즈 전이 틱에 L2 가 부른다.
 * (편대는 스크롤 진행에 따라 지속 스폰되므로 formation 은 스텝 훅만 쓰지만, 설비·코어방은
 * 진입 시 정적 배치를 한 번에 깔기 때문에 이 훅이 필요하다.)
 */
export type EnterLayerFn = (state: WorldState, ctx: InvasionStepContext) => void;

/** L2 가 stepInvasion 에서 배선할 훅 묶음. 미구현 레인은 undefined 로 두면 no-op 이다. */
export interface InvasionStepHooks {
  enterFormation?: EnterLayerFn;
  stepFormation?: StepFormationFn;
  enterFacility?: EnterLayerFn;
  stepFacility?: StepFacilityFn;
  enterCoreRoom?: EnterLayerFn;
  stepCoreRoom?: StepCoreRoomFn;
}

// ---------------------------------------------------------------------------
// 필드 전수 대조를 위한 메타(테스트 파생용)
// ---------------------------------------------------------------------------

/** 필드 경로 1건의 종류. */
export type LayerFieldKind =
  /** 수치 리프(정수). 변조 = 값 ±1. */
  | 'number'
  /** 슬롯(Ref 또는 수호 배치 또는 null). 변조 = 채움↔비움 토글. */
  | 'slot';

/** {@link enumerateLayerFields} 가 돌려주는 필드 1건. */
export interface LayerField {
  /** `l3.guardians[0].snapshot.hp` 같은 점·인덱스 경로. */
  readonly path: string;
  readonly kind: LayerFieldKind;
}
