/**
 * Deterministic fixed-timestep world (ADR-0005).
 *
 * The simulation advances in fixed 60 Hz ticks. `stepWorld` is a deterministic
 * transition: given a world state and the input frame for a tick, it mutates the
 * state in place using only seeded RNG streams and the deterministic math module
 * — no wall-clock time, no `Math.random`, no platform trig. Running the same
 * [seed + input frames] therefore reproduces the exact same tick-by-tick state.
 *
 * M1 Phase 3 scope: full run loop. Per tick, in a FIXED order (order changes the
 * state hash): player movement/dash → wave spawns → enemy behaviour → boss →
 * player auto-attack → projectile/gem/supply integration → hazards → collisions
 * → dead-entity compaction → combo decay → level-up check → game-over check.
 *
 * The level-up powerup pick freezes the world (spec: sim ticks stall, not a
 * pause) and is resolved by a `SPECIAL_POWERUP_PICK` input frame carrying the
 * chosen index in its high bits — so a recorded run reproduces the same build.
 */

import { SeededRng } from './rng.js';
import { cos, sin, atan2, length, TWO_PI, wrapAngle } from './math.js';
import { DT, VIEW_WIDTH, VIEW_HEIGHT, OFFSCREEN_X } from './constants.js';
import type { PlanetMode } from './planetMode.js';
// 타입 전용 import 다 — `verbatimModuleSyntax` 로 런타임에 완전히 지워지므로 sim → run 런타임
// 의존이 생기지 않는다(Deno 검증 경로가 `src/sim` 을 소스 그대로 import 하는 계약에 무영향).
import type { CommissionRunConfig } from '../run/commission.js';
import type { Entity, EntityKind } from './entities.js';
import {
  blankEntity,
  spawnBullet,
  spawnEnemyBullet,
  spawnGem,
  spawnSupply,
  spawnBoss,
  spawnWall,
  spawnDestructible,
  spawnEventObject,
  spawnLoot,
} from './entities.js';
import { catalystPowerMult } from '../data/catalysts.js';
import { multFromCenti } from '../economy/planetPopularity.js';
import { resolveCatalystMods } from './catalystMods.js';
import type { CatalystMods } from './catalystMods.js';
import {
  isElite,
  eliteAffix,
  eliteSpeedMult,
  eliteDamageTakenMult,
  applyEliteRegen,
  spawnEliteDeathFx,
  ELITE_SPLIT,
  ELITE_VOLATILE,
} from './elite.js';
import { rollEliteDrop, rollEliteDropGate, rollBossDrop, bonusLootSeeds } from './drops.js';
import {
  hasUnique,
  overheatCooldown,
  UQ_OVERHEAT_DRUM,
  UQ_SPLIT_CORE,
  UQ_PIERCE_GYRO,
  UQ_DRONE_BAY,
  UQ_PHASE_ARMOR,
  OVERHEAT_MAX_STACK,
  GYRO_DAMAGE_AMP,
  SPLIT_FRAGMENTS,
  SPLIT_SPREAD,
  SPLIT_FRAGMENT_SPEED,
  SPLIT_FRAGMENT_LIFE,
  SPLIT_FRAGMENT_RADIUS,
  SPLIT_FRAGMENT_MARK,
  DRONE_INTERVAL,
  DRONE_SPAWN_OFFSET,
  DRONE_MARK,
  PHASE_ARMOR_BONUS_IFRAMES,
  PHASE_ARMOR_DASH_CD_MULT,
  UQ_SINGULARITY,
  UQ_REACTIVE_ARMOR,
  UQ_PHASE_MEMBRANE,
  UQ_AFTERIMAGE,
  UQ_GREED_HEART,
  UQ_RELIC_AMP,
  UQ_HIVE_SWARM,
  UQ_CONVERGE_PRISM,
  UQ_TWIN_STAR,
  UQ_GAMBLER_CHIP,
  HIVE_MICRO_COUNT,
  HIVE_MICRO_SPEED,
  HIVE_MICRO_LIFE,
  HIVE_MICRO_RADIUS,
  HIVE_MICRO_DAMAGE_FRAC,
  HIVE_MICRO_MARK,
  PRISM_DAMAGE_AMP,
  TWIN_STAR_DAMAGE_MULT,
  GAMBLER_EXTRA_CHOICES,
  SINGULARITY_RADIUS,
  SINGULARITY_PULL_SPEED,
  REACTIVE_PULSE_COUNT,
  REACTIVE_PULSE_SPEED,
  REACTIVE_PULSE_DAMAGE,
  REACTIVE_PULSE_RADIUS,
  REACTIVE_PULSE_LIFE,
  PHASE_MEMBRANE_HP_FRAC,
  PHASE_MEMBRANE_COOLDOWN,
  PHASE_MEMBRANE_HEAL_FRAC,
  GREED_COMBO_BONUS_TICKS,
  GREED_MAGNET_STEP,
  GREED_MAGNET_CAP,
  RELIC_XP_MULT,
  AFTERIMAGE_RADIUS,
} from './uniques.js';
import {
  hasCapstone,
  CAP_FIREPOWER_LASER,
  CAP_SURVIVAL_CRIT,
  CAP_MOBILITY_DASH,
  LASER_PERIOD,
  laserHits,
  CRIT_NEGATE_IFRAMES,
  DASH_CLEAR_RADIUS,
} from './capstones.js';
import {
  hasSignature,
  SIGNATURE_BITS,
  SIG_BRUISER_ARMOR,
  SIG_ARC_OVERCHARGE,
  SIG_PHANTOM_CLOAK,
  SIG_HATCHLING_BROOD,
  SIG_MALLOW_CUSHION,
  SIG_BUBBLE_FILM,
  ARMOR_PER_STACK_BP,
  ARMOR_DECAY_TICKS,
  clampArmorStacks,
  overchargeBp,
  CLOAK_BREAK_BP,
  CLOAK_UNHIT_TICKS,
  CLOAK_HOLD_TICKS,
  hatchThreshold,
  BROOD_MARK,
  CUSHION_RECOVER_TICKS,
  cushionDeferredDamage,
  cushionRecovered,
  cushionSettled,
  FILM_ABSORB_FLAT,
  FILM_BURST_RADIUS,
  filmReady,
  filmAbsorbed,
  filmRemainingDamage,
  filmBurstPush,
} from './shipSignature.js';
import { shipTypeDef } from '../../data/ships/index.js';
import { SpatialHash, circlesOverlap, sweptCircleHitT } from './collision.js';
import { updateEnemy } from './patterns/index.js';
import { updateBoss } from './boss.js';
import { drawPowerupChoices, applyPowerup } from './powerups.js';
import type { WaveRuntime } from './waves.js';
import { createWaveRuntime, updateWaves, enemyDefFor } from './waves.js';
import { planetContent } from '../../data/planets/index.js';
// 단계 → eliteCount 해석은 sim 코어(world)의 책임이다 — `src/sim/drops.ts` 는 데이터 레이어를
// import 하지 않는 계약이라(tests/planetDrops.test.ts ⑤) 드랍 확률 함수에 값으로 넘긴다.
import { stageParams } from '../../data/waves.js';
import {
  CHUNK_SIZE,
  CHUNK_GEN_RADIUS,
  CHUNK_CULL_RADIUS,
  MAX_ACTIVE_GIMMICKS,
  chunkPlacements,
} from './chunks.js';
import { slideCircleWalls, segmentBlocked, sweptCircleOverlapsWall } from './los.js';
import type { SlidePin } from './los.js';
import { HAZARD_SLOW } from './patterns/types.js';
import { stepEnemyBulletBehavior, BK_NONE, type BulletSplit } from './bullets.js';
import {
  applyBurn,
  applySlow,
  tickEnemyStatus,
  applyChain,
  enemyStatusSlowMult,
  PLAYER_SLOW_MULT,
  PLAYER_SLOW_DURATION,
  FIRE_DURATION,
  COLD_DURATION,
} from './status.js';
import {
  triggerMagnetEmitter,
  triggerBombDevice,
  activateTurret,
  isActiveTurret,
  MAGNET_BUFF_MULT,
  TURRET_FIRE_COOLDOWN,
  TURRET_RANGE,
  TURRET_BULLET_SPEED,
  TURRET_BULLET_DAMAGE,
  TURRET_BULLET_RADIUS,
  TURRET_BULLET_LIFE,
} from './events.js';
import { rebootHp, REBOOT_DELAY_TICKS } from '../../data/guardian.js';
import type { ModuleRuntime } from './moduleEffects.js';
import { initModuleRuntime, stepModuleRuntime } from './moduleEffects.js';
// --- 침공 3레이어(M7a) — 강제 스크롤 카메라 · 페이즈 머신 -----------------------------
import type { Invasion3Config, InvasionRuntime } from './invasion/types.js';
import { PHASE_L3, SCROLL_AXIS_NONE } from './invasion/constants.js';
import { normalizeInvasionLayers } from './invasion/normalize.js';
import {
  clampToWindow,
  createInvasionRuntime,
  windowCenterX,
  windowCenterY,
  scrollAxisFor,
  INVASION_SCROLL_DIR,
} from './invasion/scroll.js';
import {
  advanceInvasionPhase,
  advanceInvasionScroll,
  checkInvasion3Timeout,
  initInvasionPhase,
} from './invasion/phase.js';
import { makeInvasionContext, stepInvasionLayer } from './invasion/step.js';
import { InvasionWallIndex } from './invasion/wallIndex.js';
// --- PvE 행성 모드 강제 스크롤(Lane3 · ADR-0021) — invasion3 과 분리된 경량 런타임 ---------
import {
  createScrollRuntime,
  advanceScrollRuntime,
  scrollModeAxisDir,
  isScrollMode,
  applyScrollAnchor,
  type ScrollRuntime,
} from './scrollMode.js';
// --- 블록격파 콘텐츠(Lane4 · ADR-0021 §2.2) — Lane3 스크롤 위에 파괴가능 벽·진행 게이트·압사 ---
import { PLANET_MODE } from './planetMode.js';
import {
  placeBlockBreakWalls,
  blockBreakCleared,
  crushBlockBreak,
  isPinnedByWall,
  isBreakableWall,
  cullScrollEnemies,
  BLOCKBREAK_ENEMY_CULL_RADIUS,
} from './modes/blockBreak.js';
// --- 레이싱 콘텐츠(Lane5 · ADR-0021 §2.3) — Lane3 스크롤 위에 분기 코스·부스트·뒤 경계 압박 ---
import {
  placeRacingCourse,
  racingCleared,
  racingRearPressure,
  RACING_ENEMY_CULL_RADIUS,
  RACING_WALL_MARK,
} from './modes/racing.js';
// --- 오염 확산 콘텐츠(Lane8 · ADR-0021 §2.6) — 비-스크롤 자유추적. 파괴가능 오염 노드가 실시간
//     확산, 지형 지속피해, 노드 파괴로 억제, 정화율 게이트, 임계 오염 실패 -----------------------
import {
  placeContaminationField,
  stepContamination,
  purifyContamination,
  contaminationCritical,
  CONTAMINATION_NODE_MARK,
  HAZARD_CONTAMINATION,
} from './modes/contamination.js';
// --- 추격·탈출 콘텐츠(Lane6 · ADR-0021 §2.4) — 비-스크롤 자유추적. 무적 포식자(boss.aux0=0)가
//     끝없이 추격, 대피소 도달로 진행, 반격 장치 전부 파괴로 취약화(aux0=1)→보스전, 접촉 시 실패 ---
import { placeChaseCourse, updateChasePredator, COUNTER_DEVICE_MARK } from './modes/chase.js';
// --- 수축지대 콘텐츠(Lane7 · ADR-0021 §2.5) — 비-스크롤 자유추적. 아레나 중심(원점 0,0) 기준
//     동적으로 줄어드는 안전 반경 밖이면 지속 피해, 안전 반경 안 적 전멸로 진행, 중심 보스 처치로
//     완주. 이 재설계의 첫 "신규 해시 필드" 모드(shrinkRuntime, 정수 2필드) -----------------------
import {
  createShrinkRuntime,
  advanceShrinkRuntime,
  shrinkOutOfBounds,
  type ShrinkRuntime,
} from './modes/shrink.js';
// --- 에코 신호 콘텐츠(story Phase D · ADR-0023) — 런 중 드문(시드 파생 ≈3%) 서사 이벤트.
//     반경 내 체류 누적으로 안정화, 보상은 크레딧(런 경제)+기록 파편(메타)뿐 · 전투력 불개입.
//     positive 런에만 echoRuntime 이 서고 hashWorld 가 조건부 폴드 → 에코 미발생 런 바이트 불변. --
import { rollEcho, stepEcho, type EchoRuntime } from './echo.js';
// RunResult 리더 헬퍼는 W3(정산·main.ts)이 `from './world.js'` 로 소비할 수 있게 재수출한다
// (playerCloaked 재수출 선례). sim 내부 배선은 stepEcho 뿐이고 이 둘은 순수 리더다.
export { echoStabilizedOf, runStoryMetrics } from './echo.js';
// --- 조우 프레임워크(ADR-0033) — 에코를 일반화한 런 중 opt-in 희귀 이벤트. 롤은 에코와 같은
//     fork 전용이고(부모 미전진), positive 런에만 encounterRuntime 이 서서 hashWorld 가 조건부
//     폴드한다 → 조우 미발생 런 바이트 불변(AC1). detour(보물 격실)만 신규 제어흐름이라 아래
//     stepWorld 최상단 단일 분기로 격리한다. --------------------------------------------------
import { rollEncounter, stepEncounter, type EncounterRuntime } from './encounter.js';
import { stepDetour } from './encounterDetour.js';
// 액티브 스킬 발동 엔진(ADR-0041). 단방향: world.ts → actives.ts(그쪽은 world.ts 를 **타입으로만**
// import 하므로 순환이 아니다).
import { stepActives } from './actives.js';
// 정산·관측이 소비하는 순수 리더 재수출(echoStabilizedOf 선례).
export { encounterCompletedOf, encounterTypeOf, encounterShardOf } from './encounter.js';

export { TICK_RATE, DT, VIEW_WIDTH, VIEW_HEIGHT } from './constants.js';

/**
 * Projectile cull radius (world units): bullets/enemy bullets farther than this
 * from the player despawn regardless of remaining lifetime. Sized at the
 * viewport diagonal x1.5 so a projectile is culled only well beyond the visible
 * frame — comfortably larger than any spawn ring, so no bullet is removed
 * before it can enter the screen. `Math.sqrt` is IEEE-754 correctly rounded and
 * evaluated once at load, so this constant is bit-identical on every platform.
 */
const PROJECTILE_CULL_RADIUS = Math.sqrt(VIEW_WIDTH * VIEW_WIDTH + VIEW_HEIGHT * VIEW_HEIGHT) * 1.5;

/**
 * Broad-phase grid cell size (world units). Larger cells mean fewer buckets to
 * visit per query but more candidates per bucket; smaller cells the reverse. For
 * the 2x-scale world (entity radii ~20..128), 256 measured faster than 128 in
 * the headless sim bench (G3, src/bench/simBench.ts) at the 2,000-projectile
 * stress load, so 256 is adopted. Grid is broad-phase only (exact distance is
 * re-checked) and rebuilt every tick, so this value never affects the sim hash.
 */
export const GRID_CELL_SIZE = 256;
export type { Entity, EntityKind } from './entities.js';

/** Special-event bit flags packed into `InputFrame.special`. */
export const SPECIAL_NONE = 0;
export const SPECIAL_POWERUP_PICK = 1 << 0;

/** Pack a powerup pick (index 0..2) into an input `special` value. */
export function packPowerupPick(index: number): number {
  return SPECIAL_POWERUP_PICK | ((index & 0x3) << 1);
}

// --- 조우 입력 비트(ADR-0033) — 정의는 `data/encounters.ts` 에 있고 여기서는 **재수출만**
//     한다. 정의를 이 파일에 두면 encounter.ts/encounterDetour.ts 가 비트를 읽으려고 world.ts
//     를 런타임 import 해야 하는데, world.ts 는 이미 그 둘을 런타임 import 하므로 순환이 된다.
//     leaf 데이터 층에 정의를 두는 것이 그 순환을 원천 차단한다. 비트 배치(0..2 = 파워업 점유,
//     3 이상 = 조우)와 append-only 규율은 data/encounters.ts 주석이 정본이다.
export {
  SPECIAL_ENCOUNTER_ENTER,
  SPECIAL_ENCOUNTER_DECLINE,
  SPECIAL_ENCOUNTER_ALTAR_PICK,
  SPECIAL_ENCOUNTER_EXIT,
  packEncounterAltar,
} from '../../data/encounters.js';

// --- 액티브 스킬 발동 비트(ADR-0041) — 정의는 `data/inputBits.ts` 에 있고 여기서는 **재수출만**
//     한다. 이유는 위 조우 비트와 완전히 같다(leaf 층 정의로 순환 import 원천 차단).
export { SPECIAL_ACTIVE_SLOT1, SPECIAL_ACTIVE_SLOT2, activeSlotBit } from '../../data/inputBits.js';

// --- Progression / feel tuning (M1 prototype values; spec fixes only the
//     structure — combo cap x1.5, 20s supply window, boss 3-phase/overheat). ---
/** Ticks a combo survives without a pickup before it resets. */
const COMBO_WINDOW_TICKS = 120;
/** Multiplier gained per stacked pickup. */
const COMBO_STEP = 0.05;
/** Stacks at which the multiplier reaches its x1.5 cap (spec). */
const COMBO_MAX_STACK = 10;
/** Gem magnet speed once inside the radius (units/second). Raised for the 2x
 *  scale so gems close the larger distances at a comparable feel. */
const MAGNET_SPEED = 1520;
/** Base gem magnet radius (units); grown by the gem-magnet powerup. Doubled for
 *  the 2x scale so collection convenience keeps pace with the bigger map. */
const BASE_MAGNET_RADIUS = 420;
/** Supply raider hit points. */
const SUPPLY_HP = 420;
/** Supply raider on-screen window: 20 seconds (spec). */
const SUPPLY_LIFE_TICKS = 1200;
/** Supply raider crossing speed (units/second). Doubled for the 2x scale. */
const SUPPLY_SPEED = 380;
/** Gems dropped when a supply raider is shot down. */
const SUPPLY_REWARD_GEMS = 14;
/** XP value of each supply-drop gem. */
const SUPPLY_GEM_XP = 6;
/** Ticks at which a supply raider enters the run (once each). */
const SUPPLY_SPAWN_TICKS: readonly number[] = [1800, 6000];

/**
 * 판정점 반지름(ADR-0010): 플레이어 피격 판정에 쓰는, 기체 반지름(32)보다 훨씬 작은
 * 중심 원. 적탄·적 접촉·해저드 피해와 감속 장판 판정에만 쓴다. 젬·전리품·기믹 픽업 등
 * 이로운 접촉은 여전히 관대한 기체 반지름(player.radius)으로 판정한다. 화면에 표시하지
 * 않는다 — 관대한 회피를 명시적 UI 없이 체감으로 전달(억울한 피격 대신 "아슬아슬").
 * 이 값이 작아야 고밀도 탄막(보스·엘리트)이 공정해지므로 탄 수를 공격적으로 올릴 수 있다.
 */
export const PLAYER_HIT_RADIUS = 8;

/**
 * **런 풀** 커브 — 런 안에서 다음 레벨(= 파워업 3택 1회)까지 필요한 XP.
 *
 * ⚠️ 이 함수는 **런 내 성장 전용**이다. 기체 레벨(메타 풀)은 완전히 별개 커브
 * `xpToNextMeta`(`src/save/progressionPath.ts`)를 쓴다 — 경험치 이원화(ADR-0036).
 * 둘을 한 커브로 묶으면 파밍 속도를 바꾸려는 모든 시도가 런 체감을 함께 부순다.
 *
 * 계수(10 + 66L)는 **런당 레벨업 5~8회**를 목표로 잡았다(ADR-0036 §런 내 리듬).
 *
 * ⚠️ 이 계수는 **적 축 `SEGMENTS.killGoal` 합계에 종속된다** — 런이 길어지면 처치·젬이 비례해
 * 늘어 같은 커브에서 레벨업 횟수가 함께 오른다. 실제로 한 번 어긋났다: 초깃값 `10 + 13L` 은
 * `killGoal` 합계가 80 이던 시절 기준이었는데, 적 곡선 레인이 합계를 240 으로 올리자 런당
 * 레벨업이 **14~18회**로 폭주했다(목표 5~8). 그동안 단위 테스트는 전부 초록이었다.
 *
 * 현재값의 근거(2026-07-27 경제 재보정 · 표준 빌드 96시드 · planet 0 · 밴드 20점):
 * 런 풀 누적 XP 가 단계1 1,724 → 단계20 약 2,500 이고, 이 커브에서 레벨업이 **5.6~7.6회**로
 * 전 구간 대역 안에 떨어진다. 상세·수렴 이력은
 * `.omc/research/economy-recalibrated-2026-07-27.md`.
 *
 * **`killGoal` 합계를 다시 만지면 이 계수를 다시 재야 한다.** `tests/progressionPath.test.ts`
 * 의 정규 경로 실런 가드가 어긋나면 큰 소리로 실패한다.
 *
 * ⚠️ **이 커브는 PvE(설계 런) 전용이다.** 침공(3레이어 단판)은 {@link xpToNextInvasion} 을 쓴다 —
 * 아래 그 함수의 주석에 갈라 놓은 근거가 있다.
 */
export function xpToNext(level: number): number {
  return 10 + level * 66;
}

/**
 * **침공 런 전용** 런 풀 커브 — 3레이어 단판(PvP 배치전)에서 다음 파워업까지 필요한 XP.
 *
 * ## 왜 PvE 와 갈랐는가 (2026-07-27, 사용자 결정)
 * {@link xpToNext} 의 `10 + 66L` 은 **PvE 의 처치 볼륨(`SEGMENTS.killGoal` 합계 240)** 위에서
 * 잡은 값이다. 침공은 런 구조가 전혀 다르다 — 웨이브 세그먼트가 없고(`!designedRun` 이라
 * `updateWaves` 를 아예 돌리지 않는다), 3레이어 단판이며, 젬 획득량이 훨씬 적다. **한 커브가
 * 두 다른 런 구조를 같이 모시는 것 자체가 구조적 불일치**였다.
 *
 * 실제로 그 불일치가 계약을 깼다: `10 + 66L` 을 침공에도 적용하자 침공 런 내 레벨업이 약 1회로
 * 줄었고(실측 종료 레벨 2.00), 그 결과 **기지 #16 이 96시드 전패**(0/96 · 24시드 전부 코어
 * 무피해 사망)가 되어 `tests/invasionBalance.test.ts` 의 "클리어 불가 기지가 없다" 불변식이
 * 깨졌다. 침공 승률 분산은 통째로 파워업 추첨(`rng.fork('powerups')`)에서 나오므로
 * (그 파일 헤더 ①), 추첨 횟수가 줄면 최저 기지가 분포 바닥 밖으로 밀려난다.
 *
 * ## 값의 출처
 * - PvE `10 + 66L` — Lane F 5회차 수렴값(`.omc/research/economy-recalibrated-2026-07-27.md` §1).
 * - 침공 `10 + 6L` — **2026-07-27 밸런싱 레인 이전 값의 복원**이다. `tests/invasionBalance.test.ts`
 *   의 24시드 밴드·상한은 전부 `10 + 6L` 위에서 재기준화된 것이라(그 파일 헤더 ②·③),
 *   되돌리면 그 재기준화가 그대로 유효해진다 — 침공을 다시 튜닝하지 않는다.
 *
 * 분기는 **호출부**(`checkLevelUp`)에서 기존 술어 `state.config.invasion3 !== undefined` 로만
 * 한다. 새 `WorldConfig` 필드를 만들지 않는다 — `src/run/runConfig.ts` 단일 정본 규율에 걸리고
 * 리플레이 제출 스키마·`verify-invasion` EF 계약이 연쇄로 붙기 때문이다.
 *
 * ## ✅ 실측 — 이 분리로 침공 sim 이 밸런싱 레인 **이전과 바이트 동일**해졌다
 * `bc73201`(레인 이전) detached 워크트리와 현 트리에서 같은 녹화기를 돌려 침공 per-tick 해시를
 * 대조했다: 기지 #1·#8·#12·#16·#20 × 승패가 갈리는 시드 5개, 합계 **48,477틱**, 직렬화
 * **520,844 bytes 가 완전히 일치**했다. 즉 이 레인의 다른 변경은 침공 경로에 한 바이트도 닿지
 * 않는다 — 드랍 확률화·`eliteCount`·품질 곡선은 `!designedRun` 이라 `updateWaves` 가 안 돌고,
 * `HP_ANCHOR_*` 는 `stageHpMult` 미사용, `stageMetaXpMult` 는 침공 stage 1 이라 ×1,
 * `stageLevelCap` 은 메타 계층이다. `tests/encounterHashInvariance.test.ts` 의 AC2(invasion)
 * 6건이 픽스처(레인 이전 녹화본) 대비 전량 통과하는 것이 같은 사실의 독립 확인이다.
 *
 * ⚠️ **그래도 `verify-invasion` EF 재배포는 필요하다.** 골든 바이트 불변은 재배포 불필요의
 * 근거가 못 된다(루트 `README.md` `## 서버 배포`) — 번들 소스가 바뀌었으면 번들도 바꾼다.
 */
export function xpToNextInvasion(level: number): number {
  return 10 + level * 6;
}

/**
 * **메타 풀** 단계 배율 — 젬 1회 수집이 기체 레벨(영구)에 넣는 값의 배수(ADR-0036).
 *
 * 런 풀은 단계 무관 고정이고, 메타 풀만 침략 단계에 비례한다. 이렇게 해야 "고단계일수록
 * 파밍이 빠르다"가 성립한다 — 기준선 실측에서는 정반대였다(젬 XP 가 적 종류별 고정값이라
 * 단계가 오를수록 XP/시간이 급락, `.omc/research/economy-baseline-2026-07-27.md` §3-1).
 *
 * 정수 배율이라 부동소수 오차가 없다. 단계 1 = ×1 이므로 단계1 메타 적립은 구 거동과 같다.
 * 단계는 `WorldConfig.stage` 에서 이미 클램프된 [1,∞) 정수다(`runConfig.ts`) — 손상 세이브
 * 방어로 여기서도 하한 1 을 건다.
 *
 * ⚠️ **저단계 감쇠는 여기 없다.** 감쇠는 기체 레벨을 알아야 해서 정산 계층이 맡는다
 * (`src/save/progressionPath.ts` `lowStageXpDecay`, ADR-0036 §계층 배치).
 */
export function stageMetaXpMult(stage: number | undefined): number {
  return stage !== undefined && stage > 1 ? stage | 0 : 1;
}

/** Combo multiplier for the current stack, capped at x1.5 (spec). */
export function comboMultiplier(combo: number): number {
  const stacks = combo < COMBO_MAX_STACK ? combo : COMBO_MAX_STACK;
  return 1 + stacks * COMBO_STEP;
}

/**
 * Player primary weapon (vulcan) stats. Phase 3 powerups mutate this object in
 * place — every field is a documented amplification hook. Auto-attack reads it
 * each fire; nothing else caches these values.
 */
export interface WeaponStats {
  /** Ticks between shots (lower = faster fire). */
  fireCooldown: number;
  bulletSpeed: number;
  damage: number;
  /** Projectiles per volley (fanned across `spread`). */
  bulletCount: number;
  /** Total fan angle in radians when bulletCount > 1. */
  spread: number;
  /** Extra enemies a bullet passes through (0 = despawn on first hit). */
  pierce: number;
  bulletRadius: number;
  /**
   * 이 무기가 **실제로 닿는 거리**(월드 단위). 조준 대상 탐색 상한이자, 발사체가 커버해야
   * 하는 거리다. 두 쓰임이 같은 값이라는 것이 이 필드의 계약이다 — 조준만 되고 탄이 닿지
   * 않거나(그 반대) 하면 "에임은 맞는데 총알이 안 나간다" 부류의 결함이 된다.
   *
   * ⚠️ **`0 = 무제한` 센티널은 폐기됐다**(M8, `fix/weapon-range-semantics`). 예전에는
   * 기본값이 0(무제한)이라 **사거리에 1점이라도 투자하면 조준 상한이 무한에서 유한값으로
   * 좁아지는** 부호 반전이 있었다: 데이터 문안은 전부 "사거리 +N/pt" 로 이득을 약속하는데
   * 실제로는 손해였고, 오토파일럿 카이팅 거리(460)보다 짧아지면 `autoAttack` 이 매 틱
   * 표적 없음으로 조기 반환해 **사격이 통째로 멎었다**(만렙 투자 시 스트라이커 170 ·
   * 브루저 106 · 팬텀 135 · 말로우 22 — 7기체 중 4기체가 붕괴). 이제 기준값이
   * {@link BASE_WEAPON_RANGE} 로 유한하고 투자는 전 구간 단조 이득이다.
   */
  range: number;
  /**
   * 발사체 수명(틱). **사거리 커버 보정의 하한**이다 — 실제 발사에는
   * {@link reachLife} 가 `max(이 값, 사거리 ÷ 틱당 이동)` 을 쓰므로, 사거리 투자가
   * 늘어나면 탄이 그 끝까지 살아서 날아간다.
   */
  bulletLife: number;
  /**
   * Primary weapon firing archetype (M2 plan B2): 0 = 발칸 (fanned volley), 1 =
   * 스프레드 (wide multi-pellet), 2 = 레일건 (single fast piercing shot). Seeded
   * from the equipped main weapon's loadout; drives the autoAttack branch.
   */
  weaponType: number;
}

/**
 * 무투자 기준 사거리(월드 단위). `weapon.range` 의미론의 **유일한 기준점**이다.
 *
 * 1650 은 임의값이 아니라 **발칸 탄의 자연 도달거리** 그 자체다:
 * `bulletSpeed 1800 × DT × bulletLife 55 = 1650`. 사거리를 "닿는 거리"로 정의한 이상
 * 무투자 기준값은 탄이 실제로 날아가는 거리와 같아야 한다 — 더 짧으면 닿을 수 있는데
 * 안 쏘고(교전 거리를 스스로 깎는다), 더 길면 조준만 하고 탄이 죽는다.
 *  - 적 스폰 링 `SPAWN_RING_RADIUS ≈ 1322`(constants.ts) **초과** — 무투자 플레이어가
 *    화면에 들어온 적을 놓치지 않는다.
 *  - 오토파일럿 카이팅 거리 `KITE_DISTANCE 460`(autopilot.ts)의 3배 — 봇이 붙박이는
 *    거리에서 사격이 멎는 일이 어떤 투자 조합에서도 생기지 않는다.
 *  - 기준값에서는 {@link reachLife} 보정이 정확히 항등이라 무투자 탄 거동이 불변이다.
 *
 * ⚠️ 값을 낮추면 **교전 거리가 실제로 줄어든다.** 1400 으로 잡아 봤을 때 침공 최상위
 * 기지(#20) 클리어율이 25% → 8.3%(24시드) 로 떨어졌다 — 접근해 오는 적을 사거리 밖에서
 * 놓치기 때문이다. 1650 에서는 기존 실측과 같은 25% 다.
 *
 * 이 값 위로 `rangeFlat` 투자가 **더해지기만** 한다. 따라서 사거리 투자는 전 구간
 * 단조 이득이고, 데이터 문안("사거리 +N/pt")과 부호가 일치한다.
 */
export const BASE_WEAPON_RANGE = 1650;

export const DEFAULT_WEAPON: WeaponStats = {
  fireCooldown: 6,
  // Bullet speed doubled for the 2x-scale world so shots feel as fast relative to
  // the larger entities and distances.
  bulletSpeed: 1800,
  damage: 8,
  bulletCount: 1,
  spread: 0.18,
  pierce: 0,
  bulletRadius: 5,
  range: BASE_WEAPON_RANGE,
  bulletLife: 55,
  weaponType: 0,
};

/**
 * Per-tick input. This is the ONLY external influence on the simulation, and it
 * is what gets recorded into the replay log.
 */
export interface InputFrame {
  /** Movement axis X in [-1, 1]. */
  moveX: number;
  /** Movement axis Y in [-1, 1]. */
  moveY: number;
  /** Aim angle in radians (world space, atan2 convention). */
  aim: number;
  /** Dash requested this tick. */
  dash: boolean;
  /** Bit flags for discrete events (powerup pick, etc.). 0 = none. */
  special: number;
}

export function emptyInput(): InputFrame {
  return { moveX: 0, moveY: 0, aim: 0, dash: false, special: SPECIAL_NONE };
}

/**
 * Loadout-derived stat block (M2 plan A4/B1). Produced OUTSIDE the sim by
 * `computeLoadoutStats` (src/items/loadout.ts) and injected via WorldConfig so
 * the sim never imports the item layer. Applied once at createWorld; carried in
 * `Replay.config` and folded into the state hash so the verification server
 * reproduces the exact run. All fields are plain deterministic numbers.
 */
export interface LoadoutConfig {
  /** Main weapon archetype (mirrors WeaponStats.weaponType). */
  weaponType: number;
  /** Sub weapon variant: -1 none, else 0.. (drives the independent subWeapon fire). */
  subWeaponType: number;
  damageMult: number;
  /** Fire-cooldown multiplier (< 1 faster, > 1 slower). */
  fireRateMult: number;
  bulletCountAdd: number;
  pierceAdd: number;
  bulletSpeedMult: number;
  /** Extra fan angle (radians) added to the base spread. */
  spreadAdd: number;
  rangeAdd: number;
  moveSpeedMult: number;
  maxHpAdd: number;
  /** Dash-cooldown multiplier (< 1 = recharges faster). */
  dashCdMult: number;
  magnetMult: number;
  /** XP-gain multiplier (affix 경험치+%). */
  xpMult: number;
  /** Bitmask of active unique effects (Lane 3 hooks). */
  uniqueMask: number;
  // --- M3 원소 어픽스(상태이상) 파생 (plan B4, AC6; APPEND-ONLY) ---
  /** 화염 어픽스 총합 → 명중 시 적에게 거는 지속피해 틱당 피해(정수, 0 = 없음). */
  fireDmg: number;
  /** 냉기 어픽스 총합 → 명중 시 적 감속 부여 강도(> 0 = 감속 활성). */
  coldSlow: number;
  /** 전격 어픽스 총합 → 명중 시 인접 적 연쇄 피해(정수, 0 = 없음). */
  lightning: number;
}

export interface WorldConfig {
  arenaWidth: number;
  arenaHeight: number;
  playerSpeed: number; // units/second
  dashSpeed: number; // impulse units/second
  dashCooldownTicks: number;
  dashIframes: number;
  /** Invulnerability granted after taking damage (ticks). */
  hitIframes: number;
  playerHp: number;
  // --- M2 farming loop (all optional; absent = M1 behaviour) ---
  /** Source planet index (0 = 카르곤, 1 = 베르단). Stamped onto drops. */
  planet?: number;
  /**
   * 침략 단계(1..∞, ADR-0022). 미지정 = 1(구 정찰). 엘리트 어픽스·드랍 품질·HP·밀도를
   * 구간 마일스톤 + 연속 곡선으로 올린다(구 `tier` 리네임 — append-only 위치 유지).
   */
  stage?: number;
  /**
   * 이 런에 주입된 촉매 id 배열(런 1회 소모품, ADR-0029). 미지정/빈 배열 = 무촉매(거동·해시
   * 완전 불변). 중복(스택) 허용 — 정규화·배율 해석은 `resolveCatalystMods`/`hashWorld` 가 한다.
   * 침공 런은 항상 `[]`(촉매는 PvE 전용). append-only 규율: 신규 필드는 이 아래에만.
   */
  catalysts?: number[];
  /**
   * 서버 소모 영수증 런 id(Lane 3, ADR-0029). 촉매 소모 RPC(`consume_catalysts`)가 발급해
   * `buildRunConfig` 가 스탬프하며, 정산(`settle_pve_run`)이 이 id 로 서버측 영수증을 조회한다.
   * **sim 은 이 값을 읽지 않는다**(거동·해시 무영향 — `hashWorld` 가 접지 않는다). 무촉매/오프라인
   * 런은 미지정. append-only.
   */
  runId?: string;
  /** Loadout-derived stats; absent = neutral (no equipment). */
  loadout?: LoadoutConfig;
  /**
   * Skill investment snapshot (M3 plan A2). The 60-length vector is already
   * folded into `loadout` at config-build time, so it does not re-apply to the
   * sim; it is carried for the verification server (Replay.config) and read by
   * the powerup-pool soft weighting (C2, drawPowerupChoices). Absent = no skills.
   */
  skillInvest?: number[];
  /**
   * 튜토리얼 단축판(M3 후속): 보스 이전 일반 세그먼트 수 상한. 이 수만큼 일반
   * 세그먼트를 소화하면 곧장 보스 세그먼트로 점프한다. absent = 풀 런(거동 불변).
   * append-only 규율: WorldConfig 신규 필드는 항상 이 아래에만 추가.
   */
  maxSegments?: number;
  /**
   * 침공 런 설정(M7a, ADR-0017). 존재하면 3레이어 침공: 강제 스크롤 카메라가 sim 권위가 되고
   * 페이즈 머신 L1(대기권)→L2(회랑)→L3(코어방)이 돈다. 없으면 기존 PvE 런(거동·해시 100%
   * 불변). 구 단일 아레나 필드 `invasion`(코어·포탑 6종·장애물)은 L11 에서 삭제됐다.
   * append-only 규율: 신규 필드는 항상 이 아래에만 추가.
   */
  invasion3?: Invasion3Config;
  /**
   * 기체 타입 id(`data/ships` 의 `SHIP_TYPES` 인덱스, ADR-0019). **optional** —
   * **미지정 = 0(스트라이커)** 이며, 그 경우 이 필드가 만드는 신규 경로는 전부 조기 탈출한다:
   * 시그니처 비트 없음(`signatureBit = -1`) · 파워업 affinity 슬라이스가 레거시와 바이트 동일 ·
   * `hashWorld` 꼬리 폴드 미실행. 즉 **기존 config 조립을 한 줄도 안 고쳐도 해시가 불변**이다
   * (설계서 §5 다섯 겹 방어 중 3번).
   * append-only 규율: 신규 필드는 항상 이 아래에만 추가.
   */
  shipType?: number;
  /**
   * 행성 모드(ADR-0021, Lane2). **optional** — 미지정 = vampire(0) = 뱀서류.
   * shipType 과 같은 조건부 폴드 규율: 0 이면 `hashWorld` 꼬리 폴드가 실행되지 않아
   * 기존 PvE·침공·골든 해시가 바이트 불변이다. Lane2 에서 sim 은 이 필드로 분기하지
   * 않는다(각 모드 거동은 Lane3~8). append-only: 신규 필드는 이 아래에만.
   */
  planetMode?: PlanetMode;
  /**
   * 행성 인기 보상 배율(**centi 정수**, 중립 = 100, ADR-0038). 런 시작에 클라가 서버 스냅샷에서
   * 받아 `buildRunConfig` 가 스탬프한다 — 런이 도는 동안 배율이 바뀌어도 이 런은 출격 시점 값에
   * 묶인다(설명가능성 + 서버 재검증 가능).
   *
   * shipType·planetMode 와 같은 **조건부 폴드 규율**: 미지정/100 이면 `hashWorld` 꼬리 폴드가
   * 실행되지 않고 sim 산술도 `× 1` 무연산이라 기존 PvE 골든·침공 해시가 **바이트 불변**이다
   * (그래서 `verify-invasion` EF 재배포가 필요 없다). 침공·예비역 소집 런은 항상 미지정이다.
   * append-only: 신규 필드는 이 아래에만.
   */
  planetMultCenti?: number;
  /**
   * 위 배율이 나온 스냅샷 **epoch**(30분 단위 정수, ADR-0038). **sim 은 읽지 않는 순수 메타**로
   * `runId` 와 같은 성격이다(`hashWorld` 가 접지 않는다) — 정산이 `p_summary.epoch` 로 서버에
   * 실어 보내면 서버가 **그 epoch 의 자기 스냅샷**으로 자원 지급 상한을 재산정한다(클라가 실은
   * 배율값 자체는 서버가 신뢰하지 않는다). 오프라인·미설정 런은 미지정. append-only.
   */
  planetMultEpoch?: number;
  /**
   * 장착한 액티브 스킬 2칸의 **wire 정수**(ADR-0041 · 계획 0a-6). 길이 2 고정, 빈 슬롯은
   * `ACTIVE_WIRE_EMPTY`(-1). `data/ships/actives` 의 `activeWireId(shipTypeId, indexInShip)`
   * 가 정본이다.
   *
   * ⚠️ **둘 다 비면 `buildRunConfig` 가 이 필드 자체를 싣지 않는다**(`planetMultCenti` 선례).
   * "항상 명시"하지 않는 이유는 조건부 해시 폴드의 불변식을 **필드 부재로도** 성립시켜,
   * 기존 런의 config 직렬화(리플레이 스냅샷)까지 바이트 동일하게 두기 위함이다. 그래서
   * `hashWorld` 꼬리 폴드와 `drawPowerupChoices` 필터가 둘 다 `?? []` 로 정규화해 읽는다.
   *
   * `Ship.activeSlots` 는 사람이 읽는 문자열 id 를 저장하고, 정수 변환은 `buildRunConfig`
   * 한 곳에서만 일어난다(단일 정본).
   */
  activeSlots?: number[];
  /**
   * 의뢰 런 설정(의뢰서 시스템, 계획 §A-1). **optional** — 미지정 = 일반 런(거동·해시 100% 불변).
   *
   * 존재하면 다구간 의뢰 런이다: 구간 종료 감지와 구간 전환(새 월드 생성 + 승계)이 열리고
   * `hashWorld` 꼬리에 의뢰 폴드가 붙는다. `planetMultCenti`·`activeSlots` 와 같은 **조건부
   * 스탬프** 규율을 따른다 — `buildRunConfig` 가 미지정 시 **필드 자체를 싣지 않아** 무의뢰 런의
   * config 직렬화(리플레이 스냅샷)까지 기존과 바이트 동일하다.
   *
   * ⚠️ **`DEFAULT_CONFIG` 에 넣지 마라.** 넣으면 모든 런에 필드가 생겨 골든이 깨진다.
   * ⚠️ 의뢰 술어의 정본은 **이 필드**다. 런타임 상태로 "의뢰인가"를 판정하지 마라(파생 정본 금지).
   * append-only 규율: 신규 필드는 항상 이 아래에만 추가.
   */
  commission?: CommissionRunConfig;
}

export const DEFAULT_CONFIG: WorldConfig = {
  arenaWidth: VIEW_WIDTH,
  arenaHeight: VIEW_HEIGHT,
  // Movement speeds doubled for the 2x-scale world (units feel slow relative to
  // the enlarged entities/distances otherwise).
  playerSpeed: 720,
  dashSpeed: 2800,
  dashCooldownTicks: 42,
  dashIframes: 10,
  hitIframes: 40,
  playerHp: 100,
};

/** A single collected loot drop (drop seed + rarity code + provenance). */
export interface LootRecord {
  /** Drop seed the item is rolled from (rollItem). */
  seed: number;
  /** Rarity code (0 normal .. 3 unique). */
  rarity: number;
  /** Source planet index (from config). */
  planet: number;
  /** Source 침략 단계(from config, 1..∞). */
  stage: number;
  /**
   * 이 드랍이 **엘리트 유래**인가(1 = 엘리트, 미지정 = 보스 확정 드랍, ADR-0038).
   *
   * 정산의 설계도 파생(`blueprintDropsFromLoot`)이 행성 인기 **수량** 배율을 역수로 보정할 때
   * 필요하다: 배율은 엘리트 게이트에만 걸리고 **보스 확정 드랍 1개는 배율 밖**(ADR-0035 확정성
   * 계약)이라, 두 출처를 구분하지 않으면 보스 몫까지 과보정돼 기대 설계도 획득률이 되레 흔들린다.
   *
   * ⚠️ `hashWorld` 는 이 필드를 **접지 않는다** — 이미 접히는 상태(어느 코드 경로가 이 레코드를
   * 만들었는가)에서 완전히 결정되는 순수 파생값이라, 접지 않아도 결정론 구멍이 없다(`sigBit`·
   * `grid` 와 같은 파생/스크래치 규율). 접지 않는 덕에 기존 loot 폴드가 **바이트 불변**이다.
   */
  elite?: 1;
}

export interface WorldState {
  tick: number;
  config: WorldConfig;
  /** Master RNG (other streams fork from it at creation). */
  rng: SeededRng;
  /** Wave director stream (spec: rng.fork('waves')). */
  waveRng: SeededRng;
  /** Powerup-offer stream (spec: rng.fork('powerups')). */
  powerupRng: SeededRng;
  /** Supply-raider placement stream. */
  supplyRng: SeededRng;
  /**
   * Chunk-placement stream (rng.fork('world')). NEVER advanced — chunk RNGs are
   * forked from it by coordinate, so its state is constant across a run. Folded
   * into the hash for symmetry with the other streams.
   */
  worldRng: SeededRng;
  /** Drop-determination stream (rng.fork('drops')) — elite/boss loot rarity+seed. */
  dropRng: SeededRng;
  /** Elite-affix stream (rng.fork('elite'), OQ-M2-4) — independent of wave draws. */
  eliteRng: SeededRng;
  /**
   * 이 런의 촉매 배율 번들(ADR-0029). `createWorld` 가 `config.catalysts` 로부터 한 번 해석해
   * 싣는다. 적 스폰·드랍·자원·경험치 적용점이 여기서 배율을 읽는다(단일 정본, 배선 누락 방어).
   * `config.catalysts` 의 순수 파생값이라 `hashWorld` 에 따로 접지 않는다(catalysts 배열 자체가
   * 꼬리에서 접힘 — sigBit/grid 와 같은 파생·스크래치 규율).
   */
  catalystMods: CatalystMods;
  /**
   * 자원 배율(catalystMods.resource)의 **소수 누적 캐리**(milli 단위 정수). 보급 습격마다
   * 배율×1000 을 더해 1000 이상이면 정수 자원으로 승격하고 나머지를 이월한다(소수 자원의 정수
   * 결정론 모델). 촉매 무주입(배율 1) 이면 매번 +1000 → +1 자원으로 기존 `resources++` 와 바이트
   * 동일. `state.resources`(정수)가 관측·해시 대상이고 이 캐리는 그를 구동하는 결정론 스크래치라
   * `hashWorld` 에 접지 않는다(grid 선례 — 재실행 시 같은 이벤트열로 동일 재계산).
   */
  catalystResourceMilli: number;
  /**
   * 이 런의 행성 인기 보상 배율(ADR-0038) — `config.planetMultCenti / 100` 을 `createWorld` 가
   * **한 번** 해석해 싣는다(catalystMods 와 같은 "단일 정본" 규율 — 적용점이 셋이라 배선 누락을
   * 구조적으로 줄인다). `config` 의 순수 파생값이라 `hashWorld` 에 따로 접지 않는다.
   *
   * ⚠️ 중립(centi 100)이면 **정확히 1.0** 이다(`100 / 100` 은 IEEE754 정확) — 세 적용점의
   * 곱셈이 전부 무연산이라 기존 골든이 바이트 불변이다.
   *
   * 적용점은 셋뿐이다: 엘리트 드랍 게이트(수량) · 메타 풀 XP · 보급 습격 자원.
   * **품질(rarity) 축에는 절대 곱하지 않는다** — ADR-0022 "품질은 전 행성 동일"이 계약이다.
   */
  planetMult: number;
  /**
   * Loot picked up this run (drop seed + rarity + source). Consumed at settlement
   * (Lane 2) where `rollItem` confirms each item. Folded into the hash so replay
   * verification sees the same collected sequence.
   */
  loot: LootRecord[];
  weapon: WeaponStats;
  wave: WaveRuntime;
  entities: Entity[];
  nextEntityId: number;
  /** Id of the player entity (always the entity at index 0). */
  playerId: number;
  /** Current segment's simultaneous enemy-bullet cap. */
  bulletCap: number;
  /** Live enemy-bullet count this tick (maintained during the enemy phase). */
  enemyBulletCount: number;
  /**
   * 이 런에서 **유일하게** 활성인 시그니처 비트(18~23), 없으면 -1. `createWorld` 가 config 에서
   * 한 번 계산하고 런 중에는 절대 바뀌지 않는다(`config.shipType`·`config.loadout.uniqueMask`
   * 는 sim 이 쓰지 않는 읽기 전용 입력이다 — 파워업도 loadout 을 갈아끼우지 않는다).
   *
   * ⚠️ **정규화가 유일한 이유**(적대적 리뷰 HIGH-1): 예전 `signatureOn` 은 마스크 축과 타입 축의
   * OR 를 **비트마다 독립으로** 판정했다. 그래서 마스크에 시그니처 비트가 둘 이상 켜지면
   * `stepShipSignature`(첫 분기에서 return)는 하나만 굴리는데 소비 지점(autoAttack·
   * resolveCollisions)은 여럿이 참이 되어 **aux 슬롯이 별칭**이 됐다 — 예: 마스크 18|20 런에서
   * 팬텀 소비자가 브루저의 장갑 소멸 타이머(1..179)를 "은신 해제 대기 플래그"로 읽어 사실상
   * 모든 발사에 2.5배가 실렸다(실측 kills 41→45, 잔존 적 hp 241→78). 침공 EF 는 공격자
   * loadout 을 검증 없이 재실행에 쓰므로 자기 강화 위조가 내적 일관 상태로 accept 된다.
   * 여기서 **런당 시그니처를 정확히 하나로 접어** 그 별칭을 구조적으로 없앤다.
   *
   * 캐시인 부수 효과로 `playerCloaked` 가 적 1기·1틱마다 `shipTypeDef()` 정규화를 다시 도는
   * 비용(적 200기 × 14400틱 ≈ 290만 회)도 사라진다.
   */
  sigBit: number;
  kills: number;
  gems: number;
  // --- Progression (Phase 3) ---
  /** XP toward the next level (resets on level-up). */
  xp: number;
  /** Total XP earned this run (settlement screen). */
  xpTotal: number;
  level: number;
  /** Current gem combo stack. */
  combo: number;
  /** Ticks left before the combo resets. */
  comboTimer: number;
  /** Highest combo reached this run (settlement screen). */
  maxCombo: number;
  /** Gem magnet radius (grown by the gem-magnet powerup). */
  magnetRadius: number;
  /**
   * Ticks remaining on a magnet-emitter buff (multiplies the effective magnet
   * radius while > 0). Folded into the hash (deterministic gimmick state).
   */
  magnetBuffTicks: number;
  /**
   * 플레이어 감속 잔여 틱(니플헤임 유령 기함 '감속 지대', plan B1). > 0인 동안 이동
   * 속도에 PLAYER_SLOW_MULT를 곱한다. 결정론 스칼라 — hashWorld에 append-only로 접힌다.
   */
  playerSlowTicks: number;
  /** Supply-raid reward currency (M1 placeholder). */
  resources: number;
  /** World frozen awaiting a powerup pick (sim tick stall, not a pause). */
  pendingLevelUp: boolean;
  /** Powerup pool indices offered for the pending level-up. */
  powerupChoices: number[];
  /** Index into SUPPLY_SPAWN_TICKS of the next raider to spawn. */
  supplyNextIndex: number;
  /** Boss has been spawned for the boss segment. */
  bossSpawned: boolean;
  /** Player died (HP 0). */
  gameOver: boolean;
  /** Boss defeated — run cleared. */
  victory: boolean;
  /**
   * Reused broad-phase collision grid (cleared and refilled each tick instead of
   * reallocated). NOT part of the state hash — it is scratch space rebuilt from
   * scratch every tick, so it never influences determinism.
   */
  grid: SpatialHash<Entity>;
  /**
   * Which chunk coordinates have already had their gimmicks generated, keyed by
   * a folded integer chunk key. SCRATCH (like `grid`) — excluded from the hash
   * (its Map iteration order is not a determinism input). The generated gimmick
   * ENTITIES are hashed instead, which is sufficient. A culled chunk is removed
   * so re-entry regenerates it identically (pure placement, OQ1 default (a)).
   */
  generatedChunks: Map<string, true>;
  /**
   * Active cover walls, rebuilt every tick in entity-array order (same
   * determinism discipline as the grid). Walls are NOT inserted into the spatial
   * hash — they can exceed a cell, so movement/bullet/LOS checks iterate this
   * array directly. Scratch — not hashed (the wall entities themselves are).
   */
  activeWalls: Entity[];
  /**
   * 활성 벽 broad-phase 인덱스(침공 3레이어 전용, 그 외 null). `activeWalls` 재빌드 직후 갱신되며
   * `firstBlocking` 이 직접 스윕과 **배열 최소 인덱스까지 동일**해 결과가 비트 일치한다.
   */
  wallIndex: InvasionWallIndex | null;
  /**
   * 오염 런 표시(ADR-0008). 치트·하네스 개입이 한 번이라도 일어난 런에 `markTainted`로
   * 세운다. 순수 DEV 메타데이터 — 시뮬레이션 거동과 `hashWorld` 출력 모두에 영향이 없다
   * (hashWorld는 이 필드를 접지 않는다). 정산·리플레이 제출에서 오염 런을 제외하는 데만
   * 쓰인다.
   */
  tainted: boolean;
  /**
   * 코어 모듈 효력 런타임(M7b · ADR-0018 — 구 `cardRuntime` 계승). `config.invasion3.modules`
   * 가 있는 침공에만 존재하며(그 외 undefined), 정적 카운터 해석값·동적 트리거 상태·유니크
   * 파라미터·매 틱 유효 배율을 담는다(src/sim/moduleEffects.ts). undefined = 모듈 미장착 =
   * 기존 침공/PvE 경로와 거동·해시 완전 불변(조건부 접기).
   */
  moduleRuntime?: ModuleRuntime;
  /**
   * 침공 3레이어 런타임(M7a). `config.invasion3` 가 있는 런에만 존재한다(그 외 undefined →
   * 조건부 접기로 PvE·구 침공 해시 완전 불변). 스크롤 오프셋이 여기 실리면서 카메라가
   * **sim 권위**가 된다 — 스냅샷의 플레이어 파생 카메라(snapshot.ts)를 대체한다.
   */
  invasion3?: InvasionRuntime;
  /**
   * 레이어 클리어 폭탄 적립분(정수, 상한 INVASION_BOMB_CAP). 3레이어 침공에서만 증가하고
   * 그 외 런에서는 항상 0 이다. 소비 경로(입력 프레임 비트)는 후속 레인 소관 — M7a 는
   * 적립까지다.
   */
  invasion3Bombs: number;
  /**
   * PvE 강제 스크롤 런타임(Lane3, ADR-0021). 존재 = 블록격파/레이싱 등 강제 스크롤 모드.
   * invasion3 과 **상호 배타**(createWorld 가 한쪽만 세운다). 없으면 자유추적 카메라(뱀서류).
   * hashWorld 는 존재 시에만 조건부 폴드 → 뱀서류·침공 바이트 불변. append-only.
   */
  scrollRuntime?: ScrollRuntime;
  /**
   * 수축지대 런타임(Lane7, ADR-0021 §2.5). 존재 = 수축 모드(비-스크롤 자유추적). 안전 반경·유예
   * 정수 2필드를 담는다. 이 재설계의 첫 "신규 해시 필드" 모드 — 반경이 게임플레이 이력에 의존해
   * 누적되는 동적 정수라 파생 불가(scrollRuntime 선례). hashWorld 는 존재 시에만 조건부 폴드 →
   * 뱀서류·침공·타 모드 바이트 불변. append-only.
   */
  shrinkRuntime?: ShrinkRuntime;
  /**
   * 에코 신호 런타임(story Phase D, ADR-0023). 존재 = 이 런에 에코가 롤인됐다(시드 파생 ≈3%,
   * PvE 전용 — 침공엔 안 붙는다). 정수 필드만 담고(echo.ts EchoRuntime), hashWorld 는 존재 시에만
   * 조건부 폴드 → 에코 미발생 런(뱀서류·침공·타 모드 전부) 바이트 불변. append-only.
   */
  echoRuntime?: EchoRuntime;
  /**
   * 조우 런타임(ADR-0033). echoRuntime 과 완전히 같은 규율 — **조우 발생(positive) 런에만**
   * 존재하고(그 외 필드 자체를 두지 않는다), hashWorld 가 존재 시에만 조건부 꼬리 폴드 →
   * 조우 미발생 런(기존 전 PvE 모드·침공) 바이트 불변(AC1). append-only.
   */
  encounterRuntime?: EncounterRuntime;
  // --- 사연 마일스톤 관측 카운터(story Phase D · 비-해시 · 설계서 §4) ----------------------
  // ⚠️ **반드시 hashWorld 에서 접지 않는다**(tainted 선례 — 순수 메타데이터라 결정론·해시 무영향).
  // 각 기체 시그니처 훅 발동 지점에서만 누적되고, 정산(W3)이 RunResult 델타로 읽어 프로필의
  // storyMetrics 에 쌓는다. createWorld 가 전부 0 으로 초기화한다. metric id 계약(data/lore)과
  // 같은 이름이라 runStoryMetrics(echo.ts)가 그대로 키로 쓴다.
  /** 플레이어가 실제 피해를 입은 피격 횟수(브루저 사연 metric). 전 기체 집계. */
  hitsTaken: number;
  /** 과충전(bp>0) 활성 중 낸 처치 수(아크캐스터 사연 metric). */
  overchargeKills: number;
  /** 은신 해제 첫 타 발동 횟수(팬텀 사연 metric). */
  cloakBreaks: number;
  /** 병아리 드론 출격 횟수(해츨링 사연 metric). */
  broodLaunches: number;
  /** 완충 회복분 HP 누적(말로우 사연 metric). */
  cushionHealed: number;
  /** 방막 파열 횟수(버블 사연 metric). */
  filmPops: number;
  // --- 액티브 스킬 런타임 정수 4개(ADR-0041 · 계획 0a-4) --------------------------------------
  // ⚠️ **`aux0`/`aux1` 재사용 불가** — 그 두 칸은 기체별 시그니처 런타임 상태가 이미 점유했다
  // (world.ts 의 인코딩 표). `Entity` 에 넣는 것도 불가다: `ENTITY_HASH_LAYOUT` 이 바뀌어
  // 조건부 폴드 중립화가 **원리적으로 불가능**해진다. 그래서 `WorldState` 평평한 정수 4개다
  // (`invasion3Bombs`·사연 카운터와 같은 선례).
  //
  // 넷은 `hashWorld` 맨 꼬리에서 **하나의 조건부 폴드**로 묶인다 — **넷이 전부 0이면 한 폴드도
  // 실행하지 않는다**(액티브 미사용 런 = 기존 골든 전량 바이트 불변). 부분 폴드 금지: 하나라도
  // 0이 아니면 **넷 전부**를 고정 폭으로 접는다(`aux0/aux1` 꼬리와 같은 규율 —
  // (1,0,0,0) 과 (0,1,0,0) 이 갈려야 한다).
  //
  // ## 작성자 분리 (0c 계약 — 어기면 검증이 항진이 된다)
  // **공통 발동 코드는 쿨다운 2개만 쓴다. 버프 잔여 틱 2개는 핸들러가 쓴다.** 공통 코드가
  // 버프 틱까지 초기화하면 `buffTicks` 단언이 핸들러 본문과 무관하게 참이 되어 배선 전수
  // 테스트 ②가 무의미해진다(계획 개정 3 CR-1 과 같은 기제의 재발).
  /** 슬롯 1 액티브 쿨다운 잔여 틱(0 = 발동 가능). 공통 발동 코드가 쓴다. */
  activeCd0: number;
  /** 슬롯 2 액티브 쿨다운 잔여 틱(0 = 발동 가능). 공통 발동 코드가 쓴다. */
  activeCd1: number;
  /** 슬롯 1 `kind='buff'` 잔여 틱(0 = 비활성). **핸들러가 쓴다**(공통 코드 금지). */
  activeBuff0: number;
  /** 슬롯 2 `kind='buff'` 잔여 틱(0 = 비활성). **핸들러가 쓴다**(공통 코드 금지). */
  activeBuff1: number;
  /**
   * 의뢰 런 런타임(의뢰서 시스템 · 계약 §5·§8·§10). **`config.commission` 이 있을 때만 존재**한다
   * — 조건부 필드라 무의뢰 런은 `hashWorld` 의뢰 꼬리 폴드가 아예 실행되지 않는다(바이트 불변).
   *
   * ⚠️ 의뢰 술어의 **정본은 `config.commission`** 이다. 이 런타임의 유무로 "의뢰인가"를
   * 판정하지 마라(파생 정본 금지 — `sigBit` 과 같은 규율).
   * append-only 규율: 신규 필드는 항상 이 아래에만 추가.
   */
  commissionRuntime?: CommissionRuntime;
}

/**
 * 의뢰 런의 구간 진행 런타임.
 *
 * 두 필드가 사는 이유가 서로 다르다 — 섞어 읽지 마라:
 *  - {@link CommissionRuntime.segmentDone} 은 **sim → 루프 층의 신호**다. `compact()` 가 세우고
 *    `stepRun` 이 소비해 다음 구간 월드를 만든다. `hashWorld` 가 접는다(레벨업 프리즈로 전환이
 *    한 틱 이상 지연되면 실제로 스트림에 나타난다).
 *  - {@link CommissionRuntime.totalTicks} 는 **런 전체 누적 틱**이다. `state.tick` 은 구간마다
 *    0 으로 돌아가므로(승계 계약 §7) 런 시간의 정본은 이쪽뿐이다. `hashWorld` 는 **접지 않는다**
 *    — 스트림 인덱스 i 에서 항상 `i+1` 이라 정보량이 0인 순수 파생값이다(파생 폴드 금지 규율).
 */
export interface CommissionRuntime {
  /** 이번 구간이 종료됐는가(1 = 종료, 전환 대기). 새 구간 진입 시 0 으로 돌아간다. */
  segmentDone: number;
  /** 런 전체 누적 틱(구간 경계를 넘어 단조 증가). 표시·정산이 읽는 런 시간의 정본. */
  totalTicks: number;
}

/**
 * 현재 런을 오염 런으로 표시한다(ADR-0008). 치트나 하네스 개입이 감지되면 호출한다.
 * 시뮬레이션 상태·해시에는 영향이 없고, 정산/리플레이 제출 경로에서만 이 플래그를 읽는다.
 */
export function markTainted(world: WorldState): void {
  world.tainted = true;
}

/**
 * Create the initial world for a run. The wave director drives all enemy
 * spawning, so the starting layout past the player is empty until the first
 * card is drawn (tick 0). Everything is a pure function of the seed.
 */
export interface CreateWorldOpts {
  /**
   * **파생 스탯이 이미 config 에 구워져 있다**(의뢰 구간 전환 · 계약 §4).
   *
   * `createWorld` 는 기본적으로 `loadout`·촉매 파워 보상축을 `weapon`/`cfg` 에 **굽는다**.
   * 그런데 의뢰 2구간 이후의 config 는 1구간 월드의 `state.config` 를 계승한 것이라 그 굽기가
   * **이미 적용돼 있다** — 다시 구우면 이동 속도·피해·최대 HP 가 구간마다 곱해져 5구간짜리
   * 최종 지시에서 스탯이 지수적으로 폭주한다. 이 플래그가 그 블록을 건너뛴다.
   *
   * ⚠️ **건너뛰는 것은 굽기뿐이다.** `catalystMods`·`planetMult` 는 그 블록 **밖**이라 계승
   * config 로부터 정상 재도출되고, `weapon`/`magnetRadius` 는 승계가 덮는다(`carryAcrossSegment`).
   */
  preDerived?: boolean;
}

export function createWorld(
  seed: number,
  config: WorldConfig = DEFAULT_CONFIG,
  opts: CreateWorldOpts = {},
): WorldState {
  const cfg = { ...config };
  // ⚠️ 이 함수는 `cfg`(얕은 사본)를 **변형**한다. 원본 `config` 는 절대 건드리지 않는다 —
  // 계승 config 를 오염시키면 다음 구간이 또 그 위에 굽는다(계약 §4의 경고).
  const preDerived = opts.preDerived === true;
  const rng = new SeededRng(seed);
  const entities: Entity[] = [];
  let nextEntityId = 1;

  // 촉매 배율 번들(ADR-0029) — config.catalysts 로부터 한 번 해석한다. 무촉매면 중립 번들이라
  // 아래 모든 촉매 배율이 1 → 산술 무연산(기존 경로와 바이트 동일). 적 스폰·드랍·자원 등 런 중
  // 적용점은 state.catalystMods 로 이걸 읽는다(아래 state 리터럴에 싣는다).
  const catalystMods = resolveCatalystMods(cfg.catalysts);

  // 행성 인기 보상 배율(ADR-0038) — centi 정수를 여기서 **한 번** 배율로 푼다. 미지정/100 이면
  // 정확히 1.0 이라 세 적용점(드랍 게이트·메타 XP·자원)의 곱셈이 무연산 → 기존 골든 바이트 불변.
  const planetMult = multFromCenti(cfg.planetMultCenti);

  // Loadout-derived stats (plan B1): apply once here so the run starts strengthened
  // and the effect is captured in the initial weapon/config/player/magnet — all of
  // which are already hashed. The loadout block itself is folded into the hash too.
  const weapon: WeaponStats = { ...DEFAULT_WEAPON };
  let magnetRadius = BASE_MAGNET_RADIUS;
  const lo = preDerived ? undefined : cfg.loadout;
  if (lo !== undefined) {
    weapon.weaponType = lo.weaponType;
    weapon.damage = Math.round(weapon.damage * lo.damageMult * 100) / 100;
    weapon.fireCooldown = Math.max(2, Math.round(weapon.fireCooldown * lo.fireRateMult));
    weapon.bulletCount += lo.bulletCountAdd;
    weapon.pierce += lo.pierceAdd;
    weapon.bulletSpeed = Math.round(weapon.bulletSpeed * lo.bulletSpeedMult * 100) / 100;
    weapon.spread += lo.spreadAdd;
    // 아키타입 기준 보정은 음수일 수 있다(빔). 사거리가 음수로 내려가면 `nearestTarget`
    // 이 아무것도 못 고르므로 0 에서 막는다 — 옛 `0 = 무제한` 센티널과 달리 지금 0 은
    // 문자 그대로 "닿는 거리 없음"이다.
    weapon.range = Math.max(0, weapon.range + lo.rangeAdd);
    cfg.playerSpeed = Math.round(cfg.playerSpeed * lo.moveSpeedMult);
    cfg.dashCooldownTicks = Math.max(12, Math.round(cfg.dashCooldownTicks * lo.dashCdMult));
    cfg.playerHp += lo.maxHpAdd;
    magnetRadius = Math.round(magnetRadius * lo.magnetMult);
  }

  // 촉매 파워 보상축(런 한정 스탯 강화, ADR-0029) — **적용 지점 1곳**. loadout 파생(위)과
  // 이중 적용 금지: 여기서 별개 인자로 한 번만 곱한다(파워업 적용 지점과 같은 지위). 결과는
  // weapon/cfg 에 반영돼 이미 해시에 접힌다(파워축은 별도 폴드 불필요). 무촉매면 전 배율 1 →
  // 무연산이라 기존 골든이 바이트 불변이다.
  //  · damage/moveSpeed/maxHp = 상향 곱, fireRate = 쿨다운 하향 나눗셈(연사 상승).
  //  · skillAll("모든 스킬 +N" 계열)은 전용 런타임 스킬-효과 노브가 없어(스킬은 buildRunConfig
  //    에서 loadout 에 이미 접힘) 네 전투 스탯의 **공동 인자**로 얹는다 — loadout 파생과는 별개
  //    인자라 이중 적용이 아니다(완전한 스킬-효과 배선은 후속). 무주입이면 1 → 무연산.
  // ⚠️ `preDerived` 는 이 촉매 파워 굽기도 함께 건너뛴다 — loadout 굽기와 **같은 블록**으로
  // 취급해야 한다(계약 §4가 지정한 굽기 범위). 하나만 건너뛰면 촉매 런의 2구간부터
  // 피해·연사·이속·HP 가 구간마다 다시 곱해진다.
  const cats = preDerived ? undefined : cfg.catalysts;
  if (cats !== undefined && cats.length > 0) {
    const skillAll = catalystPowerMult(cats, 'skillAll');
    const dmgMul = catalystPowerMult(cats, 'damage') * skillAll;
    const fireMul = catalystPowerMult(cats, 'fireRate') * skillAll;
    const moveMul = catalystPowerMult(cats, 'moveSpeed') * skillAll;
    const hpMul = catalystPowerMult(cats, 'maxHp') * skillAll;
    weapon.damage = Math.round(weapon.damage * dmgMul * 100) / 100;
    weapon.fireCooldown = Math.max(2, Math.round(weapon.fireCooldown / fireMul));
    cfg.playerSpeed = Math.round(cfg.playerSpeed * moveMul);
    // 파워 maxHp 상향 → 촉매 playerHpDown 페널티 하향 순으로 소비한다. playerHpDown ≥ 1 이라
    // **나눗셈**이 페널티 방향(HP 감소)이다(부호 규약: 배율 클수록 페널티 큼). catalystMods 는
    // cats 와 같은 배열에서 나오므로, cats 가 비었으면 이 블록에 오지 않고 playerHpDown 도 1 이다.
    cfg.playerHp = Math.round((cfg.playerHp * hpMul) / catalystMods.playerHpDown);
  }

  const player = blankEntity('player');
  player.id = nextEntityId++;
  // Infinite map: the player begins at the natural world origin (0,0). The
  // camera follows the player, so the starting frame looks the same regardless.
  player.x = 0;
  player.y = 0;
  // 2x hitbox scale (plan D1): 16 -> 32. Render doubles again via ART_SCALE.
  player.radius = 32;
  player.hp = cfg.playerHp;
  player.maxHp = cfg.playerHp;
  entities.push(player);

  // 침공 3레이어(M7a): 배치를 **여기서 한 번** 정규화해 sim·해시가 항상 정규형만 본다
  // (raw 가 새어 들어가면 클라·서버 재실행이 갈린다). cfg 는 이미 얕은 사본이라 호출부의
  // config 객체를 변형하지 않는다. 레이어 정적 배치 스폰은 진입 훅(L4/L5 소관)이 맡는다.
  let invasion3Runtime: InvasionRuntime | undefined;
  if (cfg.invasion3 !== undefined) {
    cfg.invasion3 = {
      ...cfg.invasion3,
      layers: normalizeInvasionLayers(cfg.invasion3.layers),
    };
    invasion3Runtime = createInvasionRuntime();
  }

  // PvE 강제 스크롤 모드(블록격파/레이싱). invasion3 이면 세우지 않는다(상호 배타).
  let scrollRuntime: ScrollRuntime | undefined;
  if (cfg.invasion3 === undefined && isScrollMode(cfg.planetMode)) {
    scrollRuntime = createScrollRuntime();
  }

  // PvE 수축지대 모드(Lane7). 비-스크롤 자유추적이라 scrollRuntime 은 안 선다(위 조건 밖).
  // invasion3 이면 세우지 않는다(침공 중엔 수축 안 켜짐 — scrollRuntime 과 같은 상호 배타 가드).
  let shrinkRuntime: ShrinkRuntime | undefined;
  if (cfg.invasion3 === undefined && cfg.planetMode === PLANET_MODE.shrink) {
    shrinkRuntime = createShrinkRuntime();
  }

  // PvE 에코 신호(story Phase D, ADR-0023). worldRng.fork('echoEvent') 로 이 런의 에코 출현
  // 여부·스폰 틱을 롤한다. fork 는 부모(worldRng)를 전진시키지 않으므로 worldRng 의 해시 상태가
  // 불변 — 에코 미발생 런은 물론 발생 런도 기존 RNG 스트림 소비가 0 이다(새 상시 스트림 추가
  // 금지). 침공(invasion3)엔 붙이지 않는다(설계된 방어전 + 침공 해시 골든 불변 · scrollRuntime/
  // shrinkRuntime 과 같은 상호 배타 가드). **positive 일 때만** echoRuntime 을 세운다 → hashWorld
  // 조건부 폴드가 성립해 에코 미발생 런은 바이트 불변이다. worldRng 은 이 로컬 인스턴스를 state
  // 에 그대로 싣는다(아래 리터럴) — fork 는 소비가 아니라 파생이라 getState() 가 여전히 pristine.
  //
  // ⚠️ **의뢰 런(cfg.commission)도 억제한다**(계약 §9). 근거는 RNG 전진이 **아니다** — `rollEcho`
  // 는 `worldRng.fork(...)` 만 쓰고 부모를 소비하지 않으므로 굴리고 버려도 스트림은 그대로다.
  // 진짜 근거는 **런타임 객체가 존재하면 조건부 꼬리 폴드가 켜지고** `stepEcho` 가 상태를
  // 갖는다는 것이다. 의뢰는 구간마다 새 월드를 만드는데 에코 런타임은 무대 단위 미승계라,
  // 구간 수만큼 에코가 재추첨되어 의뢰 1건이 에코 N회를 낳는다.
  const worldRng = rng.fork('world');
  const commissionRun = cfg.commission !== undefined;
  let echoRuntime: EchoRuntime | undefined;
  if (cfg.invasion3 === undefined && !commissionRun) echoRuntime = rollEcho(worldRng);

  // PvE 조우(ADR-0033). 에코와 같은 fork 전용 롤(`worldRng.fork('encounter')`)이라 worldRng 을
  // 한 번도 소비하지 않는다 — 조우 발생 런에서도 웨이브·드랍·파워업 스트림이 전부 그대로다.
  // 침공(invasion3)엔 붙이지 않는다(설계된 방어전 + 침공 해시 골든 불변 단언 AC2 · 에코와 같은
  // 상호 배타 가드). **positive 일 때만** encounterRuntime 을 세운다 → 조건부 폴드 성립(AC1).
  //
  // v1 에 있던 `allowWarp` 모드 게이트는 **제거**했다. 그 게이트의 근거는 "워프가 플레이어를
  // 창 밖 12만 유닛으로 옮기는데, 강제 스크롤 창 클램프(clampToWindow)·수축 안전 반경
  // (shrinkOutOfBounds)·블록격파 압사·레이싱 후방압박이 전부 좌표에 기대는 규칙이라 워프를
  // 되돌리거나 즉사를 낸다"였다. 그런데 그 경계 규칙 3블록이 stepPlayer 꼬리에서 stepWorld 의
  // `stepPlayer(...)` 호출 **직후**로 빠졌고, detour 분기는 그 줄 이전에 return 한다 —
  // 즉 **detour 중에는 모드 규칙이 아예 실행되지 않는다**. 근거가 사라졌으니 게이트도 없앤다.
  // 이제 워프는 모든 행성 모드에서 안전하고, 조우는 6개 모드 전부에서 도달 가능하다.
  // 롤 구조(chance → 유형 가중 → 스폰 틱 3회 소비)는 그대로라 RNG 소비량은 불변이다.
  //
  // ⚠️ **의뢰 런도 억제한다**(계약 §9) — 근거는 위 에코 주석과 같다. 조우는 게다가 detour 로
  // 메인 파이프라인을 통째로 멈추므로, 구간마다 재추첨되면 의뢰의 틱 예산 계산이 무너진다.
  let encounterRuntime: EncounterRuntime | undefined;
  if (cfg.invasion3 === undefined && !commissionRun) {
    encounterRuntime = rollEncounter(worldRng);
  }

  const state: WorldState = {
    tick: 0,
    config: cfg,
    rng,
    waveRng: rng.fork('waves'),
    powerupRng: rng.fork('powerups'),
    supplyRng: rng.fork('supply'),
    worldRng,
    dropRng: rng.fork('drops'),
    eliteRng: rng.fork('elite'),
    catalystMods,
    catalystResourceMilli: 0,
    planetMult,
    loot: [],
    weapon,
    wave: createWaveRuntime(),
    entities,
    nextEntityId,
    playerId: player.id,
    bulletCap: 300,
    enemyBulletCount: 0,
    sigBit: computeActiveSignature(config),
    kills: 0,
    gems: 0,
    xp: 0,
    xpTotal: 0,
    level: 1,
    combo: 0,
    comboTimer: 0,
    maxCombo: 0,
    magnetRadius,
    magnetBuffTicks: 0,
    playerSlowTicks: 0,
    resources: 0,
    pendingLevelUp: false,
    powerupChoices: [],
    supplyNextIndex: 0,
    bossSpawned: false,
    gameOver: false,
    victory: false,
    grid: new SpatialHash<Entity>(GRID_CELL_SIZE),
    generatedChunks: new Map<string, true>(),
    activeWalls: [],
    tainted: false,
    // 사연 마일스톤 관측 카운터(비-해시). 0 초기화 — 시그니처 훅 발동 지점에서만 누적된다.
    hitsTaken: 0,
    overchargeKills: 0,
    cloakBreaks: 0,
    broodLaunches: 0,
    cushionHealed: 0,
    filmPops: 0,
    invasion3Bombs: 0,
    // 액티브 스킬 런타임 정수 4개(ADR-0041). 0 초기화 = 미장착·미발동 런에서 끝까지 0 →
    // hashWorld 꼬리 폴드 미실행(바이트 불변).
    activeCd0: 0,
    activeCd1: 0,
    activeBuff0: 0,
    activeBuff1: 0,
    // 탄-벽 broad-phase 는 침공 3레이어에서만 쓴다. PvE 는 null → 기존 직접 스윕 그대로라
    // 해시가 바이트 불변이다(회랑 벽이 '활성 벽 ≤~19' 전제를 깨는 것은 침공 경로뿐).
    wallIndex: invasion3Runtime !== undefined ? new InvasionWallIndex() : null,
    // 3레이어 침공이 아니면 필드 자체를 두지 않는다(exactOptionalPropertyTypes — undefined
    // 대입 금지 · 조건부 접기 정합).
    ...(invasion3Runtime !== undefined ? { invasion3: invasion3Runtime } : {}),
    // PvE 강제 스크롤 런타임도 존재할 때만 싣는다(exactOptionalPropertyTypes · 조건부 접기
    // 정합). invasion3 과 상호 배타라 둘 다 실리는 상태는 위 가드로 발생하지 않는다.
    ...(scrollRuntime !== undefined ? { scrollRuntime } : {}),
    // PvE 수축지대 런타임도 존재할 때만 싣는다(exactOptionalPropertyTypes · 조건부 접기 정합).
    // shrink 는 비-스크롤이라 scrollRuntime 과 동시에 서지 않고, invasion3 과도 상호 배타다.
    ...(shrinkRuntime !== undefined ? { shrinkRuntime } : {}),
    // PvE 에코 신호 런타임도 positive 런에만 싣는다(exactOptionalPropertyTypes · 조건부 폴드 정합).
    // 침공엔 위 롤 가드로 애초에 세우지 않으므로 invasion3 과 공존하지 않는다.
    ...(echoRuntime !== undefined ? { echoRuntime } : {}),
    // PvE 조우 런타임도 positive 런에만 싣는다(exactOptionalPropertyTypes · 조건부 폴드 정합).
    // 침공엔 위 롤 가드로 애초에 세우지 않으므로 invasion3 과 공존하지 않는다.
    ...(encounterRuntime !== undefined ? { encounterRuntime } : {}),
    // 의뢰 런타임도 의뢰 런에만 싣는다(exactOptionalPropertyTypes · 조건부 폴드 정합).
    // 무의뢰 런은 필드 자체가 없어 `hashWorld` 의뢰 꼬리 폴드가 미실행이다(바이트 불변).
    // `totalTicks` 는 여기서 0 으로 시작하지만 2구간 이후 월드는 `carryAcrossSegment` 가
    // 직전 구간 값으로 덮는다(런 단위 누적).
    ...(commissionRun ? { commissionRuntime: { segmentDone: 0, totalTicks: 0 } } : {}),
  };

  // L1 진입 훅(정적 배치 스폰)은 상태가 완성된 뒤에 태운다 — 훅이 state.entities 에 스폰하기
  // 때문이다. 플레이어는 이미 index 0 에 있으므로 hashWorld 불변식이 유지된다.
  if (cfg.invasion3 !== undefined && invasion3Runtime !== undefined) {
    initInvasionPhase(state, cfg.invasion3, invasion3Runtime);
    // 코어 모듈 효력(M7b): 배치 스폰이 끝난 뒤 해석한다 — 스폰 시점 효과(코어 HP·기물 내구·
    // 신기루 코어)가 대상 엔티티를 봐야 하기 때문이다. 미장착이면 필드 자체를 두지 않는다.
    const modules = cfg.invasion3.modules;
    if (modules !== undefined) state.moduleRuntime = initModuleRuntime(modules, state);
  }

  // PvE 블록격파(Lane4): 파괴가능 벽 코스를 state 완성 후 1회 배치한다(entities sink·플레이어
  // index 0 확정 이후 append 하므로 hashWorld 불변식 유지). scrollRuntime 이 서 있는 blockBreak
  // 런에만 배치 — 뱀서류·침공은 조건 밖이라 벽이 하나도 안 생겨 골든 바이트 불변.
  if (scrollRuntime !== undefined && cfg.planetMode === PLANET_MODE.blockBreak) {
    placeBlockBreakWalls(state);
  } else if (scrollRuntime !== undefined && cfg.planetMode === PLANET_MODE.racing) {
    // PvE 레이싱(Lane5): 정적 분기 코스(불파괴 채널 벽 + 부스트 패드)를 1회 배치한다. 마찬가지로
    // racing 런에만 — 뱀서류·블록격파·침공은 조건 밖이라 부스트 패드·레이싱 벽이 안 생겨 불변.
    placeRacingCourse(state);
  } else if (cfg.planetMode === PLANET_MODE.contamination) {
    // PvE 오염(Lane8): 비-스크롤 자유추적이라 scrollRuntime 이 없다(위 두 분기 조건 밖). 오염
    // 노드 필드(고정 링)를 1회 배치한다. contamination 런에만 — 뱀서류·블록격파·레이싱·침공은
    // 조건 밖이라 오염 노드가 하나도 안 생겨 골든 바이트 불변.
    placeContaminationField(state);
  } else if (cfg.planetMode === PLANET_MODE.chase) {
    // PvE 추격(Lane6): 비-스크롤 자유추적이라 scrollRuntime 이 없다(위 두 분기 조건 밖). 무적
    // 포식자(boss, aux0=0) + 반격 장치 + 대피소 코스를 1회 배치하고 bossSpawned 을 세운다(포식자가
    // 곧 보스다 — stepBoss 가 두 번째 보스를 안 세운다). chase 런에만 — 뱀서류·블록격파·레이싱·
    // 오염·침공은 조건 밖이라 포식자·장치·대피소가 하나도 안 생겨 골든 바이트 불변.
    placeChaseCourse(state);
  }
  return state;
}

function getPlayer(state: WorldState): Entity {
  const p = state.entities[0];
  if (p === undefined || p.kind !== 'player') {
    throw new Error('world invariant violated: player entity missing at index 0');
  }
  return p;
}

/**
 * Advance the world by exactly one tick. Deterministic in (state, input).
 */
export function stepWorld(state: WorldState, input: InputFrame): void {
  // 의뢰 런 누적 틱(계약 §10) — **모든 조기 반환보다 앞**이다. `state.tick` 은 구간마다 0 으로
  // 돌아가고 프리즈·detour 틱도 세야 하므로, 여기가 아니면 "스트림 인덱스 i 에서 i+1" 이라는
  // 불변식이 깨진다. 해시에는 접지 않는다(순수 파생 — replay.ts 의뢰 폴드 주석 참조).
  // 무의뢰 런은 필드 자체가 없어 무연산이다.
  if (state.commissionRuntime !== undefined) state.commissionRuntime.totalTicks++;

  // Run is over — the world is inert (settlement screen is showing).
  if (state.gameOver || state.victory) return;

  // Level-up freeze: the world stalls until a pick arrives. The pick is applied
  // on the exact tick its input frame carries SPECIAL_POWERUP_PICK, keeping the
  // choice reproducible from the replay log.
  if (state.pendingLevelUp) {
    if ((input.special & SPECIAL_POWERUP_PICK) !== 0) {
      const idxOffered = (input.special >> 1) & 0x3;
      // Ignore an out-of-range offer index (fewer than 4 choices were offered):
      // keep the level-up pending rather than silently consuming it with no
      // powerup applied, so a malformed frame cannot skip a build choice.
      if (idxOffered < state.powerupChoices.length) {
        const poolIndex = state.powerupChoices[idxOffered];
        if (poolIndex !== undefined) applyPowerup(state, poolIndex);
        state.pendingLevelUp = false;
        state.powerupChoices = [];
      }
    }
    state.tick++;
    return;
  }

  const player = getPlayer(state);

  // 보물 격실 detour(조우 프레임워크 · ADR-0033 · 계획 CRIT-1): 메인 파이프라인을 통째로
  // 건너뛰는 **단일 분기**다. 바로 위 레벨업 프리즈와 동형이라, 이 한 줄로 updateWaves·
  // stepEnemies·stepBoss·autoAttack·clampToWindow·shrinkOutOfBounds·advanceScroll/Shrink·
  // applySingularityPull·updateChasePredator·resolveCollisions·compact 가 **전부 자연 생략**
  // 된다. 메인 엔티티는 state.entities 에 프리즈된 채 남아 hashWorld 가 계속 접으므로
  // 결정론과 AC6(detour 중 메인 월드 tick 외 바이트 동결)이 동시에 성립한다.
  //
  // ⚠️ 산발적 `if (!inDetour)` 게이트를 코드 곳곳에 흩뿌리는 원안은 컨센서스에서 REJECT
  // 됐다 — 충돌점이 최소 7곳이라 열거로는 반드시 새기 때문이다. **이 분기가 유일한 게이트**
  // 라는 것이 계약이니, detour 관련 조건문을 아래 루프에 추가하지 마라.
  //
  // stepPlayer 는 이 모듈의 내부 함수라 encounterDetour.ts 가 import 할 수 없다. 순환을 피해
  // **의존성 주입**으로 넘긴다(world.ts → encounterDetour.ts 단방향 유지). 방 안에서도
  // 이동 감각(대시 쿨다운·무적 프레임·감속)이 메인과 완전히 같아야 해서 복제하지 않는다.
  if (state.encounterRuntime?.inDetour === 1) {
    stepDetour(state, player, input, stepPlayer);
    state.tick++;
    return;
  }

  // 침공 3레이어(M7a): config·런타임이 모두 있을 때만 활성. 컨텍스트는 런타임을 참조로 담아
  // 페이즈 머신 갱신이 훅에 즉시 보이게 한다.
  const invasion3 = state.config.invasion3;
  const inv3Runtime = state.invasion3;
  // PvE 강제 스크롤(Lane3): 런타임·축방향이 모두 있을 때만 활성. invasion3 과 상호 배타다.
  const scrollRuntime = state.scrollRuntime;
  const scrollAxisDir = scrollModeAxisDir(state.config.planetMode);
  const inv3Ctx =
    invasion3 !== undefined && inv3Runtime !== undefined
      ? makeInvasionContext(invasion3, inv3Runtime)
      : undefined;
  /**
   * 절차 생성(청크 기믹·웨이브 적·보급 습격)을 끄는 조건 — 침공은 설계된 방어 기지만 상대한다.
   * 정적 배치 장애물(wall)이 청크 컬링에 잘려나가지 않게 하는 것도 겸한다(activateChunks 미실행).
   * rebuildActiveWalls 는 방어 장애물이 wall kind 라 유지한다.
   */
  const designedRun = invasion3 !== undefined;

  // Materialise/cull scroll-map gimmicks around the player, then rebuild the
  // active-wall list (both before movement so walls obstruct this tick).
  if (!designedRun) activateChunks(state, player);
  rebuildActiveWalls(state);
  // 침공 회랑은 활성 벽이 수십 개라 탄-벽 직접 스윕(O(탄 × 벽))이 무너진다. 인덱스를 여기서
  // 한 번 재빌드해 이번 틱 stepProjectiles 가 질의만 하게 한다.
  state.wallIndex?.rebuild(state.activeWalls);

  // 강제 스크롤: 가속 갱신 + 창 전진을 **플레이어 이동 이전에** 처리한다. 창이 먼저 밀고,
  // 플레이어는 갱신된 창 안에서 움직인다(같은 틱 안에서 창 밖으로 튀는 프레임이 없다).
  //
  // 앵커(ADR-0034): 창을 전진시킨 **직후·stepPlayer 이전에** 창 이동량을 ANCHOR 엔티티에
  // 가산한다. 창이 없는 모드(뱀서류·수축·추격·오염)는 anchorWin 이 undefined 라 아래 호출
  // 자체가 없다 → 해시 바이트 불변(ADR-0005).
  const anchorWin = inv3Runtime ?? scrollRuntime;
  const beforeX = anchorWin?.scrollX ?? 0;
  const beforeY = anchorWin?.scrollY ?? 0;
  if (inv3Runtime !== undefined) advanceInvasionScroll(state, inv3Runtime);
  else if (scrollRuntime !== undefined && scrollAxisDir !== undefined) {
    // 전멸 가속 신호: 블록격파(Lane4)는 창 안 적·보스 전멸 시, 레이싱(Lane5)은 전멸 OR 부스트
    // 패드 위에서 가속(cleared=true). 두 모드 모두 planetMode 게이트라 뱀서류는 미진입(불변).
    const cleared =
      state.config.planetMode === PLANET_MODE.blockBreak
        ? blockBreakCleared(state)
        : state.config.planetMode === PLANET_MODE.racing
          ? racingCleared(state)
          : false;
    advanceScrollRuntime(scrollRuntime, scrollAxisDir, cleared);
  }
  // 델타를 scrollStep(accelCp) 로 **재계산하지 않는다** — advanceScrollRuntime·
  // advanceInvasionScroll 이 같은 호출 안에서 accelCp 를 갱신하므로 재계산하면 한 틱 어긋난다.
  // 전/후 오프셋 차이가 정본이고, 두 오프셋 모두 정수 누적이라 차이도 정수다.
  //
  // 위치가 중요하다: 앵커는 stepPlayer **이전**이어야 한다. 그래야 앵커로 밀린 플레이어에
  // stepPlayer 안의 slideCircleWalls(벽 슬라이드) → clampToWindow(창 클램프)가 최종 권위를
  // 갖는다 — 앵커가 벽에 박힌 상태를 남기지 않고, 블록격파에서 벽에 막히면 isPinnedByWall
  // 압사 판정이 정상 발동한다(압박이 "속도 열세"에서 "장애물"로 이동하는 것이 설계 의도).
  if (anchorWin !== undefined) {
    applyScrollAnchor(state.entities, anchorWin, anchorWin.scrollX - beforeX, anchorWin.scrollY - beforeY);
  }

  // 수축지대(Lane7): 안전 반경을 한 틱 전진(유예 소진 후 정수 감소)한다. **stepPlayer 이전에**
  // 두어 같은 틱 밖 판정(shrinkOutOfBounds)이 이번 틱의 최신 반경을 본다. 반경 전진은 적 상태를
  // 보지 않으므로(순수 정수 산술) compact 타이밍과 무관하다. planetMode 게이트라 뱀서류·블록격파·
  // 레이싱·오염·추격·침공은 미실행(shrinkRuntime 미존재 → 조기 반환) → 골든 바이트 불변.
  if (state.shrinkRuntime !== undefined) advanceShrinkRuntime(state.shrinkRuntime);

  // 코어 모듈(장착 시): 이번 틱 유효 배율·트리거 상태를 stepPlayer 이전에 갱신해 모든 접점이
  // 같은 틱 값을 읽게 한다. moduleRuntime 미존재(미장착·PvE)면 조기 반환 → 거동·해시 불변.
  if (state.moduleRuntime !== undefined) stepModuleRuntime(state, player);

  stepPlayer(state, player, input);
  // 액티브 스킬(ADR-0041) — **이 자리가 계약이다.** `pendingLevelUp` 프리즈 블록과 detour
  // 분기가 위에서 조기 return 하므로, 여기 두면 **플래그 하나 없이** 프리즈 중 z/x 가 구조적
  // 으로 버려진다(AC-8·AC-9). 위로 옮기면 AC-8 이 즉시 깨진다. 미장착 런은 `stepActives` 가
  // `config.activeSlots` 부재로 조기 반환하고 정수 4개가 끝까지 0 이라 해시 폴드가 미실행이다.
  stepActives(state, player, input, activeDirOf(input, player));
  // ── 모드별 플레이어 경계 규칙 (원래 stepPlayer 꼬리에 있던 3블록을 그대로 옮겨 왔다) ──
  // 조우 detour 는 stepPlayer 를 재사용하지만 포켓 방(창 밖 12만 유닛)에서는 이 규칙들이
  // 전부 오작동한다(창 클램프가 좌표를 되돌리고, 수축 밖 판정이 즉사를 낸다). detour 분기는
  // 위에서 이미 return 했으므로, 호출 직후인 이 자리에 두면 **플래그 하나 없이** 방 안에서만
  // 규칙이 빠진다(ADR-0033 "산발 게이트 금지" 규율). 벽 슬라이드 다음 실행 지점 그대로라
  // 메인 경로 실행 순서는 이동 전후로 동일하다 — 기존 런 해시 바이트 불변.
  //
  // 강제 스크롤(침공 3레이어 또는 PvE 스크롤 모드=Lane3): 창 밖으로 나갈 수 없다. PvE 의
  // "무한 맵, 아레나 클램프 없음" 규율은 그대로고(창 미존재 → 이 블록 자체를 건너뜀),
  // 강제 스크롤에서만 창이 경계가 된다. 벽 슬라이드 **이후**에 적용해 창 경계가 항상 최종
  // 권위를 갖게 한다(벽이 플레이어를 창 밖으로 밀어내는 상태를 허용하지 않는다).
  const scrollWin = state.invasion3 ?? state.scrollRuntime;
  if (scrollWin !== undefined) {
    const clamped = clampToWindow(player.x, player.y, player.radius, scrollWin);
    player.x = clamped.x;
    player.y = clamped.y;
  }
  // 블록격파 압사(Lane4): 벽 슬라이드·창 클램프 이후에도 파괴가능 벽에 끼여 있으면 누적 피해.
  // 창 경계와 부술 수 있는 벽 사이에 몰렸다는 뜻이다(불파괴 벽 hp=0 은 대상 아님). 레이싱
  // (Lane5)은 벽이 아니라 창 뒤(−X) 경계에 몰리면 누적 피해(즉사 아님). 뱀서류·침공은 두 조건
  // 모두 밖이라 미실행 → 거동·해시 불변.
  if (
    state.config.planetMode === PLANET_MODE.blockBreak &&
    isPinnedByWall(player, state.activeWalls)
  ) {
    crushBlockBreak(state, player);
  } else if (state.config.planetMode === PLANET_MODE.racing) {
    racingRearPressure(state, player);
  } else if (state.config.planetMode === PLANET_MODE.shrink) {
    // 수축지대(Lane7): 아레나 중심(원점 0,0) 안전 반경 밖이면 지속 피해(하드 클램프 없음 —
    // 밖으로 나갈 수는 있고 피해만 받는다). iframes 존중·즉사 아님. shrinkRuntime 미존재면 no-op.
    shrinkOutOfBounds(state, player);
  }
  // 기체 시그니처 카운터는 이동 직후·발사 이전에 갱신한다 — autoAttack 이 이번 틱의 과충전
  // 값을 읽고, 피격 판정(resolveCollisions)이 이번 틱의 장갑 스택을 읽는다.
  stepShipSignature(state, player, input);
  // 에코 신호(story Phase D): 스폰 틱 도달 시 오브젝트 스폰 + 반경 내 체류 누적으로 안정화한다.
  // stepPlayer 직후라 이번 틱의 최신 플레이어 좌표로 판정한다. echoRuntime 미존재(에코 미발생
  // 런·침공)면 즉시 no-op → 거동·해시 불변. 안정화 보상(resources)은 hashWorld 에 접힌다.
  stepEcho(state, player);
  // 조우(ADR-0033): 스폰 틱 도달 시 조우 오브젝트 스폰 + 유형별 한 틱 진행. 에코와 같은 성격의
  // 시드 이벤트라 바로 뒤에 둔다(이번 틱 최신 플레이어 좌표로 근접 판정). encounterRuntime
  // 미존재(조우 미발생 런·침공)면 즉시 no-op → 거동·해시 불변. 보물 격실 진입이 확정되면
  // 좌표만 저장하고 실제 워프는 **다음 틱** detour 분기가 한다 — 진입 틱에 워프하면 아래
  // updateWaves·stepSupply 가 포켓 좌표 주위에 메인 적을 스폰해 버리기 때문이다
  // (encounterDetour.ts `enterDetour` 주석이 정본).
  stepEncounter(state, player, input);
  if (!designedRun) updateWaves(state, player);
  stepEnemies(state, player);
  // 강제 스크롤(Lane4/5): 창 뒤로 흘러간 적을 정리한다(보스 제외). 컬 반경은 모드별로 고른다 —
  // 각 모드의 최대 스폰 거리보다 크다는 구조적 불변식이 상수 doc 에 못박혀 있다(Lane4 MED 교훈).
  // 뱀서류·침공은 창 미존재 → no-op(거동·해시 불변). compact 가 dead 를 수거한다.
  if (scrollRuntime !== undefined) {
    const cullRadius =
      state.config.planetMode === PLANET_MODE.racing
        ? RACING_ENEMY_CULL_RADIUS
        : BLOCKBREAK_ENEMY_CULL_RADIUS;
    cullScrollEnemies(state, cullRadius);
  }
  // 오염 확산(Lane8): 살아있는 오염 노드가 결정론 확산으로 오염 지형 셀을 뿌린다(확산 틱마다).
  // stepEnemies~stepHazards 사이라 이번 틱 스폰된 지형이 resolveCollisions 판정에 든다. planetMode
  // 게이트라 뱀서류·블록격파·레이싱·침공은 미실행(골든 바이트 불변). 스폰은 노드 순회 후 일괄 append.
  // 정화 되돌림(Lane8): 파괴된 노드가 뿌려 둔 오염 셀을 차례로 걷는다. 확산과 **한 쌍**이라
  // 같은 게이트 안에서 이어 돈다 — 이게 없으면 오염이 단조 증가라 실패가 되돌릴 수 없는
  // 숨은 카운트다운이 된다(purifyContamination 주석 참조, 사용자 신고 2026-07-27).
  if (state.config.planetMode === PLANET_MODE.contamination) {
    stepContamination(state);
    purifyContamination(state);
  }
  stepBoss(state, player);
  autoAttack(state, player);
  capstoneLaser(state, player);
  subWeapon(state, player);
  droneBay(state, player);
  stepTurrets(state, player);
  // 3레이어 침공: 현재 페이즈의 스텝 훅(L1 편대 / L2 설비 / L3 코어방)을 단일 디스패치.
  // 미배선 훅은 no-op 이라 W1 병렬 중에도 런이 성립한다.
  if (inv3Ctx !== undefined) stepInvasionLayer(state, inv3Ctx);
  stepProjectiles(state, player);
  stepGems(state, player);
  if (!designedRun) stepSupply(state, player);
  stepHazards(state);
  resolveCollisions(state, player);
  compact(state);
  // 추격(Lane6): 살아있는 반격 장치가 0개면 포식자를 취약화(aux0=1)한다. **compact 이후**라
  // 이번 틱 파괴된 장치가 반영된다. planetMode 게이트라 뱀서류·블록격파·레이싱·오염·침공은
  // 미실행(골든 바이트 불변). 취약화 후엔 아군탄이 포식자 hp 를 깎아 다음 compact 가 처치→victory.
  if (state.config.planetMode === PLANET_MODE.chase) updateChasePredator(state);
  updateCombo(state);
  checkLevelUp(state);
  checkGameOver(state, player);
  // 3레이어: 페이즈 전이(soft 예산·주파 완료)를 compact 이후에 판정해 이번 틱에 죽은 적까지
  // 반영한 뒤, 총 예산(hard) 초과를 확인한다.
  if (invasion3 !== undefined && inv3Runtime !== undefined) {
    advanceInvasionPhase(state, invasion3, inv3Runtime);
    checkInvasion3Timeout(state, invasion3);
  }

  state.tick++;
}

// ---------------------------------------------------------------------------
// Scroll-map chunks (deterministic procedural gimmicks)
// ---------------------------------------------------------------------------

/** True for any chunk-placed gimmick entity (terrain hazards are gimmicks only
 *  when permanent — life < 0 — so enemy mortar/lava hazards are never culled).
 *  드론 베이가 소환한 유니크 포탑(ownerId === DRONE_MARK)은 청크 기믹이 아니라
 *  플레이어 소환물이므로 제외한다 — MAX_ACTIVE_GIMMICKS 카운트·청크 컬링을 받지 않고
 *  TURRET_LIFE_TICKS 수명만 따른다. */
function isGimmick(e: Entity): boolean {
  return (
    // 파괴가능 벽(hp>0, blockBreak Lane4)은 청크 기믹이 아니라 createWorld 에서 미리 깐 코스라
    // activateChunks 의 청크 컬링 대상에서 제외한다(플레이어 청크에서 멀어지면 dead 로 지워져
    // 코스가 소멸하는 것을 막는다). 침공/뱀서류 벽은 hp=0 이라 조건이 그대로라 거동·해시 불변.
    // ⚠️ 레이싱(Lane5) 채널 벽은 hp=0 불파괴라 이 조건에 걸려 코스가 지워지므로, ownerId
    // 마커(RACING_WALL_MARK — DRONE_MARK 선례)로 제외한다. 침공/뱀서류/블록격파 벽은 ownerId=0
    // 이라 조건이 그대로 성립해 거동·해시 완전 불변이다.
    (e.kind === 'wall' && e.hp <= 0 && e.ownerId !== RACING_WALL_MARK) ||
    // ⚠️ 오염 노드(Lane8 · destructible + CONTAMINATION_NODE_MARK)는 createWorld 에서 원점에
    // 고정 배치한 코스라 청크 컬링 대상이 아니다. 제외하지 않으면 자유추적 플레이어가 필드에서
    // 컬 반경(3000) 밖으로 벗어날 때 노드가 dead 로 지워지고, `contaminationPurifyRate` 가 그
    // 컬링된 노드를 "정화됨"으로 세어 **도망만으로 정화율이 오르는** 코어 루프 붕괴가 난다
    // (리뷰 CRITICAL 확증). 절차 청크 destructible 은 ownerId=0 이라 조건 그대로 성립 → 불변.
    // ⚠️ 반격 장치(Lane6 · destructible + COUNTER_DEVICE_MARK)도 같은 이유로 제외한다(AND 결합) —
    // 제외하지 않으면 추격 자유추적 플레이어가 필드 밖으로 도망칠 때 장치가 컬링돼 `chaseAlive
    // CounterDevices` 가 0 이 되고 포식자가 **무노력 취약화**된다(Lane8 도망 exploit 동형).
    (e.kind === 'destructible' &&
      e.ownerId !== CONTAMINATION_NODE_MARK &&
      e.ownerId !== COUNTER_DEVICE_MARK) ||
    e.kind === 'magnetEmitter' ||
    e.kind === 'bombDevice' ||
    (e.kind === 'turretPickup' && e.ownerId !== DRONE_MARK && e.ownerId !== BROOD_MARK) ||
    // 오염 셀(Lane8 · 영구 해저드 + HAZARD_CONTAMINATION)도 같은 이유로 컬링에서 제외 —
    // 셀이 컬링되면 임계 오염 실패 게이트를 카이팅으로 무력화할 수 있다(같은 근본 원인의 이면).
    // 절차 지형 해저드는 enemyType=HAZARD_TERRAIN(2)≠3 이라 조건 그대로 성립 → 거동·해시 불변.
    (e.kind === 'hazard' && e.life < 0 && e.enemyType !== HAZARD_CONTAMINATION)
  );
}

/** Loss-free chunk identity key. SpatialHash-style uint32 mixing is fine for
 *  broad-phase (collisions get re-checked) but here the key IS the chunk's
 *  identity — a collision would silently mark a distinct chunk as generated
 *  and drop its gimmicks, so use the exact coordinate pair. */
function chunkKey(cx: number, cy: number): string {
  return cx + ',' + cy;
}

/**
 * Generate not-yet-visited chunks within the generation radius and cull gimmicks
 * (and their chunk markers) beyond the cull radius. Deterministic:
 *  - generation scans a fixed (cy outer, cx inner) box and draws from the pure
 *    per-coordinate chunk RNG, so arrival order never changes a chunk's layout;
 *  - the active-gimmick cap defers far chunks in scan order when reached;
 *  - culling marks entities dead (order-independent) and prunes markers so a
 *    revisited chunk regenerates identically.
 */
function activateChunks(state: WorldState, player: Entity): void {
  const pcx = Math.floor(player.x / CHUNK_SIZE);
  const pcy = Math.floor(player.y / CHUNK_SIZE);

  // Count currently-live gimmicks to honour the active-region cap.
  let activeGimmicks = 0;
  for (const e of state.entities) if (isGimmick(e)) activeGimmicks++;

  const genR2 = CHUNK_GEN_RADIUS * CHUNK_GEN_RADIUS;
  const genChunkR = Math.ceil(CHUNK_GEN_RADIUS / CHUNK_SIZE) + 1;
  for (let cy = pcy - genChunkR; cy <= pcy + genChunkR; cy++) {
    for (let cx = pcx - genChunkR; cx <= pcx + genChunkR; cx++) {
      const key = chunkKey(cx, cy);
      if (state.generatedChunks.has(key)) continue;
      // Generate once the chunk centre is within the generation radius.
      const ccx = (cx + 0.5) * CHUNK_SIZE;
      const ccy = (cy + 0.5) * CHUNK_SIZE;
      const dx = ccx - player.x;
      const dy = ccy - player.y;
      if (dx * dx + dy * dy > genR2) continue;
      // Chunks are atomic: spawn a chunk's placements all-or-nothing so the
      // live gimmick set of a generated chunk is always the full pure-function
      // layout (AC3 path independence). If the cap can't fit the whole chunk,
      // defer it — marker stays unset and generation retries next tick.
      const placements = chunkPlacements(state.worldRng, cx, cy);
      if (activeGimmicks + placements.length > MAX_ACTIVE_GIMMICKS) continue;
      for (const g of placements) {
        spawnPlacement(state, g);
        activeGimmicks++;
      }
      state.generatedChunks.set(key, true);
    }
  }

  // Cull gimmicks whose chunk centre has drifted beyond the cull radius. Using
  // the chunk CENTRE (not the gimmick position) means every gimmick in a chunk
  // culls together on the same tick — no partial-chunk regeneration.
  const cullR2 = CHUNK_CULL_RADIUS * CHUNK_CULL_RADIUS;
  for (const e of state.entities) {
    if (!isGimmick(e)) continue;
    const cx = Math.floor(e.x / CHUNK_SIZE);
    const cy = Math.floor(e.y / CHUNK_SIZE);
    const ccx = (cx + 0.5) * CHUNK_SIZE;
    const ccy = (cy + 0.5) * CHUNK_SIZE;
    const dx = ccx - player.x;
    const dy = ccy - player.y;
    if (dx * dx + dy * dy > cullR2) e.dead = true;
  }
  // Prune chunk markers (including empty chunks) beyond the cull radius so the
  // map stays bounded and revisits regenerate. Fixed box scan (no Map iteration).
  //
  // 불변식(암묵 가정): 이 스캔 박스는 "1틱 이동량 ≪ CHUNK_SIZE"를 전제로 현재
  // 플레이어 청크 주변만 훑는다. 한 틱에 스캔 박스 폭보다 멀리 이동하면 컬 반경 밖
  // marker가 스캔에서 누락돼 잔존할 수 있다. 최대 1틱 이동(dashSpeed 임펄스 + 기본
  // 속도, DT=1/60)은 CHUNK_SIZE(1024)의 수십 분의 1 수준이라 안전하며, 여기에
  // 여유 +1 청크(총 +2)를 더해 경계 청크까지 확실히 커버한다. dashSpeed·CHUNK_SIZE
  // 변경 시 이 여유가 여전히 1틱 이동을 덮는지 재확인할 것. 여유 확대는 스캔 순서
  // (cy 외곽·cx 내곽 고정)와 marker 삭제(위치만의 함수)를 바꾸지 않아 결정론 불변.
  const cullChunkR = Math.ceil(CHUNK_CULL_RADIUS / CHUNK_SIZE) + 2;
  for (let cy = pcy - cullChunkR; cy <= pcy + cullChunkR; cy++) {
    for (let cx = pcx - cullChunkR; cx <= pcx + cullChunkR; cx++) {
      const ccx = (cx + 0.5) * CHUNK_SIZE;
      const ccy = (cy + 0.5) * CHUNK_SIZE;
      const dx = ccx - player.x;
      const dy = ccy - player.y;
      if (dx * dx + dy * dy > cullR2) state.generatedChunks.delete(chunkKey(cx, cy));
    }
  }
}

/** Turn one placement descriptor into its entity. */
function spawnPlacement(state: WorldState, g: ReturnType<typeof chunkPlacements>[number]): void {
  switch (g.kind) {
    case 'wall':
      spawnWall(state, g.x, g.y, g.radius, g.halfH);
      break;
    case 'destructible':
      spawnDestructible(state, g.x, g.y, g.radius, g.hp, g.value);
      break;
    case 'hazard': {
      // Permanent terrain hazard: no telegraph (timer 0), never expires
      // (life = -1). stepHazards keeps life < 0 alive; hazardActive treats it as
      // continuously damaging.
      const h = blankEntity('hazard');
      h.enemyType = g.sub;
      h.x = g.x;
      h.y = g.y;
      h.radius = g.radius;
      h.timer = 0;
      h.life = -1;
      h.damage = g.value;
      h.phase = 1; // continuous damage
      addEntityTo(state, h);
      break;
    }
    case 'magnetEmitter':
    case 'bombDevice':
    case 'turretPickup':
      spawnEventObject(state, g.kind, g.x, g.y, g.radius);
      break;
  }
}

/** Append an entity, assigning the next id (mirrors entities.addEntity). */
function addEntityTo(state: WorldState, e: Entity): void {
  e.id = state.nextEntityId++;
  state.entities.push(e);
}

/** Rebuild the active-wall list in entity-array order (deterministic). */
function rebuildActiveWalls(state: WorldState): void {
  const walls = state.activeWalls;
  walls.length = 0;
  for (const e of state.entities) {
    if (e.kind === 'wall' && !e.dead) walls.push(e);
  }
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

/**
 * 벽 슬라이드 끼임 규칙에 넘길 창 전진 축·방향(없으면 `undefined` = 기존 최소 침투 경로).
 *
 * ⚠️ **창이 실제로 전진하는 방식에서 파생해야 한다.** 값을 베껴 적으면 창 방향이 바뀔 때
 * 끼임 되밀 방향이 반대가 되어 관통이 되돌아온다. 그래서 침공은 `scrollAxisFor(phase)` +
 * `INVASION_SCROLL_DIR[phase]`(= `advanceScrollOffset` 이 쓰는 바로 그 두 값), PvE 스크롤은
 * `scrollModeAxisDir(planetMode)`(= `advanceScrollRuntime` 이 받는 그 값)를 그대로 읽는다.
 *
 * 침공의 코어방 페이즈는 축이 `SCROLL_AXIS_NONE`(창 정지)이라 `undefined` 를 돌려준다 —
 * 창이 밀지 않으면 끼임 규칙이 필요 없고, 그 구간 해시도 건드리지 않는다.
 */
function slidePinFor(state: WorldState): SlidePin | undefined {
  const inv = state.invasion3;
  if (inv !== undefined) {
    const axis = scrollAxisFor(inv.phase);
    if (axis === SCROLL_AXIS_NONE) return undefined;
    const dir = INVASION_SCROLL_DIR[inv.phase] ?? 0;
    if (dir === 0) return undefined;
    return { axis, dir };
  }
  if (state.scrollRuntime !== undefined) return scrollModeAxisDir(state.config.planetMode);
  return undefined;
}

/**
 * 발동 방향 폴백의 **단일 정본**(ADR-0041 · 계획 0a-10 ③).
 *
 * 이동 입력 방향을 쓰고, 길이가 0 에 가까우면 조준각(`player.angle`)으로 떨어진다. 대시가
 * 원래 인라인으로 갖고 있던 규칙을 그대로 함수로 뺀 것이며(산술 동일 = 골든 바이트 불변),
 * 액티브 스킬 `kind='dash'` 가 **이것을 재사용**한다 — ADR-0041 이 "대시와 동일 규칙"을
 * 명시적으로 택했고, 복제하면 두 규칙이 나중에 조용히 갈린다.
 *
 * @param mx 이동 입력 x(길이 > 1 이면 **호출 전에** 정규화돼 있어야 한다)
 * @param my 이동 입력 y(동상)
 * @param angle 조준각(폴백)
 */
function resolveDirFallback(mx: number, my: number, angle: number): { x: number; y: number } {
  if (length(mx, my) < 0.001) return { x: cos(angle), y: sin(angle) };
  return { x: mx, y: my };
}

/**
 * 이 틱의 액티브 발동 방향. `stepPlayer` 와 **같은 정규화**(길이 > 1 이면 나눈다)를 거친 뒤
 * `resolveDirFallback` 을 태운다. `mx`/`my` 는 `stepPlayer` 의 지역 변수라 밖에서 볼 수 없어
 * 여기서 다시 만든다 — 산술이 같으므로 결과는 동일하다.
 */
function activeDirOf(input: InputFrame, player: Entity): { x: number; y: number } {
  let mx = input.moveX;
  let my = input.moveY;
  const mlen = length(mx, my);
  if (mlen > 1) {
    mx /= mlen;
    my /= mlen;
  }
  return resolveDirFallback(mx, my, player.angle);
}

function stepPlayer(state: WorldState, player: Entity, input: InputFrame): void {
  const config = state.config;
  let mx = input.moveX;
  let my = input.moveY;
  const mlen = length(mx, my);
  if (mlen > 1) {
    mx /= mlen;
    my /= mlen;
  }
  // 감속 지대(plan B1): 잔여 틱 동안 이동 속도를 배율로 낮춘다(대시 임펄스에는
  // 미적용 — 아래 dash는 별도 가산). 매 틱 1 감소.
  const slowMult = state.playerSlowTicks > 0 ? PLAYER_SLOW_MULT : 1;
  if (state.playerSlowTicks > 0) state.playerSlowTicks--;
  // 코어 모듈 mt-attrition(지연전): 공격자(플레이어) 이동 감속. 미장착·미발동이면 배율 1 이라
  // `v * 1 === v` 로 비트 동일(거동·해시 불변). 대시 임펄스에는 미적용(감속 지대와 동일 규율).
  const moduleSlow = state.moduleRuntime !== undefined ? state.moduleRuntime.attackerSlowMult : 1;
  player.vx = mx * config.playerSpeed * slowMult * moduleSlow;
  player.vy = my * config.playerSpeed * slowMult * moduleSlow;
  player.angle = input.aim;

  if (player.dashCooldown > 0) player.dashCooldown--;
  if (player.iframes > 0) player.iframes--;
  // ⑩ 위상 전환막 내부 쿨다운(plan B4): player.targetY에 카운트다운으로 실어 매 틱 감소
  // (신규 필드 없이 관리; 미장착 시 항상 0이라 거동 불변).
  if (player.targetY > 0) player.targetY--;

  if (input.dash && player.dashCooldown === 0) {
    // 방향 폴백은 `resolveDirFallback` 이 정본이다 — 액티브 스킬(ADR-0041)이 **같은 규칙을
    // 재사용**한다(복제하면 두 규칙이 조용히 갈린다). 산술은 이전 인라인 코드와 동일하다.
    const { x: dx, y: dy } = resolveDirFallback(mx, my, player.angle);
    player.vx += dx * config.dashSpeed;
    player.vy += dy * config.dashSpeed;
    // ⑤ 위상 장갑: 대시 직후 무적 프레임 연장 + 대시 쿨다운 감소(장착 시).
    const mask = config.loadout?.uniqueMask ?? 0;
    if (hasUnique(mask, UQ_PHASE_ARMOR)) {
      player.dashCooldown = Math.round(config.dashCooldownTicks * PHASE_ARMOR_DASH_CD_MULT);
      player.iframes = config.dashIframes + PHASE_ARMOR_BONUS_IFRAMES;
    } else {
      player.dashCooldown = config.dashCooldownTicks;
      player.iframes = config.dashIframes;
    }
    // ⑪ 잔상 추진기(유니크) + 기동 캡스톤(대시 잔상 소거): 대시 순간 주변 적탄 소거.
    // 중첩 규칙: 둘 다 보유하면 더 큰 반경(캡스톤 DASH_CLEAR_RADIUS=320 > 잔상 220)으로
    // **한 번만** 소거한다(반경을 더하지 않음). 미보유 시 no-op.
    const afterOn = hasUnique(mask, UQ_AFTERIMAGE);
    const dashCapOn = hasCapstone(mask, CAP_MOBILITY_DASH);
    if (afterOn || dashCapOn) {
      const clearR = dashCapOn ? DASH_CLEAR_RADIUS : AFTERIMAGE_RADIUS;
      const clearR2 = clearR * clearR;
      for (const t of state.entities) {
        if (t.kind !== 'enemyBullet' || t.dead) continue;
        const ex = t.x - player.x;
        const ey = t.y - player.y;
        if (ex * ex + ey * ey <= clearR2) t.dead = true;
      }
    }
  }

  // 벽 슬라이드의 "직전 좌표" — 속도 적분 **이전**. 강제 스크롤에서는 이 시점의 좌표가 이미
  // 창 앵커에 밀려 벽 안일 수 있고, 그 "끼임" 판정이 곧 관통 방지의 트리거다(los.ts 규칙 2).
  const preMoveX = player.x;
  const preMoveY = player.y;
  player.x += player.vx * DT;
  player.y += player.vy * DT;
  // Infinite map: no arena clamp. Movement obstruction is the job of gimmick
  // walls — slide out of any overlapped wall (dash included; the max dash step
  // ~59u/tick is far below a wall's minimum full width 120u, so no tunnelling).
  //
  // 창이 있는 모드(강제 스크롤 PvE · 침공)에서는 창 전진 축·방향을 함께 넘긴다. 창이 플레이어를
  // 벽 안으로 밀어 넣은 상태에서 최소 침투가 **먼 쪽 면**을 골라 플레이어를 벽 반대편으로 뱉는
  // 관통을 막는다(근거·실측은 `slideCircleWalls` 주석). 창이 없으면 `undefined` 를 넘겨 기존
  // 최소 침투 경로가 그대로 돈다 — 뱀서류·수축·추격·오염은 해시 바이트 불변.
  if (state.activeWalls.length > 0) {
    const slid = slideCircleWalls(
      player.x,
      player.y,
      player.radius,
      state.activeWalls,
      preMoveX,
      preMoveY,
      slidePinFor(state),
    );
    player.x = slid.x;
    player.y = slid.y;
  }
  // ⚠️ 모드별 경계 규칙(창 클램프·압사·후방압박·수축 밖 판정)은 **여기 있지 않다**. 조우
  // detour(ADR-0033)가 stepPlayer 를 의존성 주입으로 재사용하는데, 포켓 방 안에서는 그 규칙이
  // 하나도 성립하지 않기 때문이다(포켓 좌표는 창 밖 12만 유닛). 그래서 stepWorld 의
  // `stepPlayer(...)` 호출 **직후**로 통째로 옮겼다 — detour 분기는 그 줄에 닿기 전에 return
  // 하므로 플래그 없이 구조적으로 제외된다. 옮긴 위치는 벽 슬라이드 바로 다음 실행 지점이라
  // 메인 경로의 실행 순서는 바이트 단위로 동일하다. 되돌려 넣지 마라.
}

// ---------------------------------------------------------------------------
// 기체 시그니처 패시브 (M8 — 설계서 §3·§4). 순수 산술은 전부 sim/shipSignature.ts 소유.
//
// ## 신규 필드 0 · 신규 해시 폴드 0
// 런타임 상태는 플레이어 엔티티의 범용 확장 슬롯(`aux0`/`aux1`)에만 싣는다. 그 슬롯은 이미
// **조건부 꼬리**(replay.ts hashEntity — 둘 다 0 이면 무폴드)라 시그니처 없는 런(스트라이커 =
// 기존 fixtures·W0 골든 전량)의 해시가 바이트 단위로 불변이다.
//
// ## 슬롯 배정 (한 런에 시그니처는 최대 하나라 충돌하지 않는다)
//   브루저   aux0 = 장갑 스택(0..8) · aux1 = 마지막 피격 이후 경과 틱
//   아크캐스터 aux0 = 연속 정지 틱      · aux1 = 미사용(0)
//   팬텀      aux0 = 연속 무피격 틱(0..CLOAK_TICK_CAP) · aux1 = 은신 해제 첫 타 대기 플래그(0/1)
//   해츨링    aux0 = 마지막 출격 시점의 state.kills 스냅샷 · aux1 = 미사용(0)
//   말로우    aux0 = 적립된 지연 피해(비음 정수) · aux1 = 연속 무피격 틱
//   버블      aux0 = 남은 막 내구(0..FILM_ABSORB_FLAT) · aux1 = 마지막 파열 이후 경과 틱
//
// ## 활성 판정을 두 축으로 OR 하는 이유
// 정본은 `LoadoutConfig.uniqueMask` 의 시그니처 비트(M8-L4 가 loadout.ts 에서 OR-in)다. 다만
// 그 배선이 빠지면 **패시브가 영구 미발동인데 어떤 테스트도 실패하지 않는다**(설계서 §10-1 이
// 예측한 결함 유형). 그래서 sim 이 아는 또 하나의 권위 — `config.shipType`(해시에 봉인됨) —
// 도 함께 인정한다. 스트라이커는 `signatureBit === -1` 이고 마스크에도 18~23 비트가 없으므로
// **두 축 모두 false** → 조기 탈출(해시 불변).
// ---------------------------------------------------------------------------

/** 과충전 정지 카운터 상한. bp 는 190틱에서 이미 상한이라 거동 무영향, 정수 유계 유지용. */
const OVERCHARGE_TICK_CAP = 600;

/**
 * 완충 무피격 카운터 상한. 정산은 임계(CUSHION_RECOVER_TICKS=180)에서 일어나므로 정상
 * 경로에서는 도달하지 않지만, **적립분이 0 인 구간**(정산할 것이 없어 카운터가 리셋되지 않는
 * 구간)에서 aux1 이 무한히 커지는 것을 막는다 — aux 는 u32 로 해시된다(replay.ts hashEntity).
 * 상한에 걸려도 임계(180)는 이미 넘긴 뒤라 거동에는 영향이 없다.
 */
const CUSHION_TICK_CAP = 600;

/**
 * 이 런의 **유일한** 시그니처 비트를 config 에서 계산한다(없으면 -1). `createWorld` 가 딱 한 번
 * 부르고 결과를 `state.sigBit` 에 봉인한다.
 *
 * ## 정규화 규칙 (정확히 하나를 고른다)
 *  ① 마스크 축이 우선이다 — `uniqueMask` 에 켜진 시그니처 비트 중 **가장 낮은 것 하나**.
 *     최저 비트를 고르는 이유는 예전 `stepShipSignature` 의 if-체인 순서(18→23)와 같은 승자를
 *     내어, 정상적인 단일 시그니처 런의 거동·해시가 한 비트도 바뀌지 않기 때문이다.
 *  ② 마스크 축이 비면 타입 축(`shipTypeDef(shipType).signatureBit`).
 *  ③ 둘 다 없으면 -1(스트라이커) — 신규 코드가 한 줄도 실행되지 않는다.
 *
 * 정상 경로에서는 loadout.ts 가 타입의 시그니처 비트를 그대로 OR-in 하므로 ①과 ②가 같은 값이라
 * 이 정규화는 무연산이다. 둘 이상이 켜진 입력(위조·미래의 합성 장비)에서만 하나로 접힌다.
 */
function computeActiveSignature(config: WorldConfig): number {
  const mask = config.loadout?.uniqueMask ?? 0;
  for (const bit of SIGNATURE_BITS) {
    if (hasSignature(mask, bit)) return bit;
  }
  const typeBit = shipTypeDef(config.shipType ?? 0).signatureBit;
  return typeBit;
}

/** 이 런에서 시그니처 `bit` 이 활성인가 — 정규화된 단일 비트와의 동치 비교. */
function signatureOn(state: WorldState, bit: number): boolean {
  return state.sigBit === bit;
}

// 팬텀 은신 술어는 leaf 모듈 `./cloak.js` 로 내려갔다 — world ↔ patterns/boss 런타임 순환
// import 를 만들지 않기 위해서다(사유는 그 파일 헤더). 여기서 재수출해 기존 import 경로
// (`from './world.js'`)를 그대로 유지한다.
export { playerCloaked } from './cloak.js';

/**
 * 시그니처 런타임 카운터를 1틱 진행한다(피해·발사 경로의 게이트가 읽는 값). 스트라이커는
 * 두 분기 모두 false 라 본문이 한 줄도 실행되지 않는다.
 */
function stepShipSignature(state: WorldState, player: Entity, input: InputFrame): void {
  if (signatureOn(state, SIG_BRUISER_ARMOR)) {
    // 비피격 지속 시 스택이 하나씩 빠진다(설계서 §3: 비피격 180틱 후 1스택 소멸).
    player.aux1++;
    if (player.aux1 >= ARMOR_DECAY_TICKS) {
      player.aux1 = 0;
      if (player.aux0 > 0) player.aux0--;
    }
    return;
  }
  if (signatureOn(state, SIG_ARC_OVERCHARGE)) {
    // 정지 판정은 **입력**으로 한다 — 속도는 감속 장판·코어 모듈 배율이 섞여 "멈춰 있는데
    // 이동 중"으로 읽힐 여지가 있다. 입력은 리플레이가 그대로 재생하므로 재현이 자명하다.
    const still = input.moveX === 0 && input.moveY === 0 && !input.dash;
    if (!still) player.aux0 = 0;
    else if (player.aux0 < OVERCHARGE_TICK_CAP) player.aux0++;
    // ⚠️ 함수 끝이라 의미는 없지만 **명시적으로** 반환한다 — 뒤에 분기를 append 하는 순간
    // 아크캐스터 런이 다음 시그니처 분기로 흘러들어간다(한 런에 시그니처는 최대 하나).
    return;
  }
  if (signatureOn(state, SIG_PHANTOM_CLOAK)) {
    // 팬텀 시그니처 — 은신(설계서 §3). aux0 = 연속 무피격 틱 · aux1 = 해제 첫 타 대기 플래그.
    //
    // ## 왜 두 슬롯인가 (aux0 만으로도 유도되는데)
    // 은신 판정(`cloakActive(aux0)`)과 "이번 발사가 해제 첫 타인가" 는 지금 규칙에서는 같은
    // 값이지만, **소진 표식을 정수 플래그로 따로 들고 발사 시점에 0 으로 되돌린다.** 배율이
    // 두 번 실릴 여지를 상태로 못 박아 없애는 쪽이, 조건식이 우연히 두 번 참이 되는 경로가
    // 생겼을 때 조용히 2.5배가 중복되는 것보다 안전하다. 두 값은 항상 같이 리셋된다
    // (발사: autoAttack · 피격: resolveCollisions).
    //
    // ## 은신 해제 조건 = **피격** (배율 토큰만 발사로 소진한다)
    // 설계서 §3 은 "무피격 지속 시 은신(적 조준 제외) + 해제 첫 타 배율" 이다. 즉 은신을 푸는
    // 것은 **피격**이고, 발사는 배율을 소진할 뿐이다. 그래서 두 슬롯의 역할이 갈린다:
    //   aux0 = 연속 무피격 틱(은신 여부의 정본) — 오직 피격으로만 0 이 된다.
    //   aux1 = 해제 첫 타 배율 토큰(0/1) — 임계를 넘는 틱에 한 번 서고 발사로 소진된다.
    //
    // ⚠️ 초판은 "발사하면 은신도 풀린다" 였고 그것이 **HIGH 결함**이었다: 자동 조준 sim 에서
    // `autoAttack` 은 사거리 안에 적이 하나라도 있으면 무조건 쏘므로, 실질 조건이 "4초 동안
    // 사거리 안에 적이 하나도 없을 것" 이 되어 은신이 사실상 발동하지 않았다(정규 경로 실측
    // 14400틱 기준 p0t0 14틱=0.10%, p1t1/p2t2 seed3311 은 **0틱**). 설계서가 선언한 축이
    // 관측 불가 수준이면 그것은 밸런스가 아니라 미배선이다.
    //
    // 새 규칙에서 은신은 자기 제한적이다 — 적은 은신 중에도 **이동하고 접촉(램) 피해를 준다**
    // (cloak.ts 헤더). 한 대만 맞으면 aux0 이 0 으로 돌아가 다시 240틱을 채워야 한다.
    // 그리고 배율 토큰은 은신 진입당 정확히 1회다(`===` 임계 판정).
    // 침공(3레이어)에서는 시그니처 자체를 접는다 — 억제(대가)는 방어체 어픽스 좌표 계약 때문에
    // 걸 수 없는데(cloak.ts 헤더) 배율(이득)만 남기면 침공에서 팬텀이 공짜로 강해진다. 여기서
    // 통째로 반환하면 aux0/aux1 이 끝까지 0 이라 "둘 다 0 이면 무폴드" 조건부 해시 규약도 그대로다.
    if (state.config.invasion3 !== undefined) return;
    player.aux0++;
    // 토큰은 임계를 **넘는 그 틱에 한 번만** 선다(`>=` 가 아니라 `===`). 매 틱 다시 세우면
    // 발사로 소진해도 다음 틱에 부활해 **모든 발사에 2.5배가 실린다.**
    if (player.aux0 === CLOAK_UNHIT_TICKS) player.aux1 = 1;
    // 유지 창(CLOAK_HOLD_TICKS)이 끝나면 사이클을 통째로 되감는다 — 다시 240틱을 채워야 한다.
    // 여기가 aux0 의 구조적 상한이기도 하다(0..CLOAK_UNHIT_TICKS+CLOAK_HOLD_TICKS-1 = 0..359).
    else if (player.aux0 >= CLOAK_UNHIT_TICKS + CLOAK_HOLD_TICKS) {
      player.aux0 = 0;
      player.aux1 = 0;
    }
    // ⚠️ 아크캐스터·해츨링 분기와 같은 이유로 **명시적으로** 반환한다.
    return;
  }
  if (signatureOn(state, SIG_HATCHLING_BROOD)) {
    // 해츨링 시그니처 — 부화(설계서 §3). aux0 = **마지막 출격 시점의 state.kills 스냅샷** ·
    // aux1 = 미사용(0).
    //
    // ## 왜 처치 카운터를 aux 에 따로 세지 않는가
    // 순수 함수 계약(shipSignature.ts ④절 hatchThreshold 주석)은 "출격 이후 처치 카운터를 0
    // 으로 리셋하고 그 카운터가 임계 이상이 되는 틱에 출격" 이다. 그 카운터를 aux1 에 직접
    // 적립하면 **런 누적 처치(state.kills)와 사본이 두 벌** 생겨 갈릴 여지가 생긴다. 대신
    // 마지막 출격 시점의 누적치만 aux0 에 스냅샷해 두고 `state.kills - aux0` 을 카운터로
    // 읽는다 — 값이 정확히 같으면서 정본은 하나다. state.kills 는 단조 증가 정수이고
    // (compact 의 `state.kills++` 단 한 곳) 이미 해시에 접히므로(replay.ts) 신규 폴드도 0 이다.
    //
    // ## 처치 집계 경로가 반쪽이 될 수 없는 이유
    // 총알 명중·화염 지속피해·전격 연쇄·폭탄 기물 — 모든 사망 경로가 `e.dead = true` 로만
    // 수렴하고 집계는 compact() 한 곳에서만 일어난다. 따라서 state.kills 를 읽는 이 배선은
    // 처치 판정 지점을 하나도 놓칠 수 없다(지점별 훅을 심었다면 반쪽 배선이 됐을 자리다).
    //
    // ## 진행 순서
    // stepShipSignature 는 compact() **이전**에 돈다 — 즉 이번 틱에 죽을 적은 아직 세지지
    // 않았고, 판정은 항상 "직전 틱까지의 누적" 으로 이뤄진다. 매 틱 같은 규칙이라 결정론에
    // 영향이 없고, 출격이 한 틱 늦을 뿐이다.
    stepHatchBrood(state, player);
    // ⚠️ 아크캐스터·말로우 분기와 같은 이유로 **명시적으로** 반환한다.
    return;
  }
  if (signatureOn(state, SIG_MALLOW_CUSHION)) {
    // 말로우 시그니처 — 완충(설계서 §3). aux0 = 적립된 지연 피해(비음 정수) · aux1 = 연속 무피격 틱.
    //
    // ## "미룬 피해가 언제 hp 에 들어가는가" — 이 배선이 정한 소진 규칙과 근거
    // 순수 함수 층(shipSignature.ts ⑤절)은 적립·회복만 정의하고 소진을 비워 두었다. 여기서
    // 택한 규칙은 **연속 무피격이 CUSHION_RECOVER_TICKS 를 채운 그 틱에 풀을 통째로 정산**
    // 이다 — 회복분(cushionRecovered)은 사라지고 나머지(cushionSettled)가 그때 선체로 들어간다.
    //  ① **가장 단순하다.** 상태는 이미 배정된 aux 2칸뿐이고, 틱당 상환율 같은 신규 밸런스
    //     상수를 발명하지 않는다(설계 정본 밖의 수치를 만들지 않는다).
    //  ② **결정론적이다.** 정산 시점이 정수 카운터의 단일 임계뿐이라 f64 누적이 낄 자리가
    //     없고, 적립·회복·정산이 전부 정수 bp 단일 나눗셈에서 나온다(ADR-0005).
    //  ③ 설계 의도("피해를 미루고, 안 맞으면 일부를 되돌린다")를 문자 그대로 만족한다. 순
    //     경감은 35% × 60% = 21%(반올림 전)이고, 남은 피해는 **교전이 끊긴 안전한 순간**에
    //     들어온다. 반대로 풀을 영영 남기는 규칙은 "지연"이 아니라 순수 감쇄가 되어 버린다.
    // 정산 후 aux1 도 0 으로 되돌린다 — 그래야 다음 정산이 임계를 처음부터 다시 채우고,
    // 임계 이후 매 틱 정산이 반복되지 않는다.
    // 결과로 **압박이 끊기지 않는 무대에서는 풀이 정산되지 않고 계속 쌓인다**(실측: 행성2/
    // 티어2 정지 파일럿은 무피격 최대 146틱 < 180). 이것은 결함이 아니라 축 그 자체다 —
    // 완충은 "안전해질 때까지 피해를 미루는" 기체이고, 미룬 분은 교전이 끊기는 순간 들어온다.
    // 풀은 비음 정수이고 런 누적 피해로 유계라 u32 폴드에 안전하다.
    if (player.aux1 < CUSHION_TICK_CAP) player.aux1++;
    if (player.aux0 > 0 && player.aux1 >= CUSHION_RECOVER_TICKS) {
      const due = cushionSettled(player.aux0, player.aux1);
      // 사연 관측(비-해시): 이번 정산에서 회복으로 사라진 지연분 HP 를 누적한다(aux0 을 0 으로
      // 되돌리기 **전**에 읽는다). 결정론 무영향 — hashWorld 가 접지 않는 순수 메타.
      state.cushionHealed += cushionRecovered(player.aux0, player.aux1);
      player.aux0 = 0;
      player.aux1 = 0;
      // ⚠️ 완충은 절대 치명적이지 않다. 미룬 피해가 hp 를 1 미만으로 내리지 못하게 클램프한다 —
      // 안전한 곳으로 빠진 직후 화면상 아무 원인 없이 죽는 사인은 플레이어가 관측할 수도
      // 반응할 수도 없다("완충" 이라는 축과도 정면으로 어긋난다). 초과분은 소멸시킨다.
      // hp 는 f64 일 수 있으므로(엘리트 배율 접촉 피해) floor 로 정수 여유분을 잡는다.
      const room = Math.floor(player.hp) - 1;
      const applied = due > room ? room : due;
      if (applied > 0) player.hp -= applied;
    }
    // ⚠️ 아크캐스터 분기와 같은 이유로 **명시적으로** 반환한다 — 뒤에 버블 분기를 append 한
    // 지금, return 이 없으면 말로우 런이 버블 분기까지 흘러 aux 의미가 두 겹으로 겹친다.
    return;
  }
  if (signatureOn(state, SIG_BUBBLE_FILM)) {
    // 버블 시그니처 — 방막(설계서 §3). aux0 = 남은 막 내구 · aux1 = 마지막 파열 이후 경과 틱.
    //
    // ## 왜 이 순서·이 게이트인가
    // 재생 타이머(aux1)는 **막이 없을 때만**(aux0 === 0) 돈다. 그래야 "막이 터진 뒤
    // FILM_PERIOD_TICKS 지나면 다시 선다" 가 되고, 막이 서 있는 동안 타이머가 굴러
    // 재생성 시점이 앞당겨지는 일이 없다. 런 시작은 aux0 = aux1 = 0 이므로 첫 막도 같은
    // 규칙으로 FILM_PERIOD_TICKS 뒤에 선다(시작 즉시 무료 흡수막을 주지 않는다).
    //
    // 카운터 상한은 별도로 두지 않는다 — aux1 은 임계(FILM_PERIOD_TICKS)에서 반드시 0 으로
    // 리셋되므로 구조적으로 유계이고, aux0 은 FILM_ABSORB_FLAT 을 넘지 않는다. 둘 다 비음
    // 정수라 u32 폴드(replay.ts hashEntity)에 안전하다.
    if (player.aux0 === 0) {
      player.aux1++;
      if (filmReady(player.aux1)) {
        player.aux0 = FILM_ABSORB_FLAT;
        player.aux1 = 0;
      }
    }
    return;
  }
}

/**
 * 병아리 드론 동시 생존 상한. `hatchThreshold` 가 누적 처치에 따라 요구치를 올리지만
 * (상한 HATCH_MAX_KILLS), 드론이 잡은 적도 state.kills 에 들어가 **드론이 드론을 부르는 양의
 * 되먹임**이 생긴다. 상한이 없으면 발산하지는 않아도 후반 프레임이 조용히 무너진다.
 *
 * 상한은 `ownerId === BROOD_MARK` 인 병아리**만** 센다 — 유니크 ④ 자율 드론 베이·보조무기 ③
 * 센트리(둘 다 `DRONE_MARK`)와 상한을 공유하지 않는다. 초판은 공유였고 그것이 결함이었다
 * (적대적 리뷰 invariants-6): 드론 베이를 장착한 해츨링 런에서 베이 드론이 상한을 채우면
 * **시그니처가 한 기도 출격하지 않는데 아무 테스트도 실패하지 않는다.** 출처별로 나누면 최악의
 * 동시 생존 대수가 4(병아리) + 1(베이) + 1(센트리) = 6 으로, 프레임·조준 부하 관점에서도
 * 여전히 유계다.
 */
const BROOD_MAX_DRONES = 4;

/** 병아리 드론 반경. 드론 베이·센트리 선례와 같은 값(같은 스프라이트 슬롯을 쓴다). */
const BROOD_DRONE_RADIUS = 44;

/**
 * 해츨링 부화 판정 — 임계를 넘긴 틱에 병아리 드론 1기를 출격시킨다.
 *
 * ## 왜 신규 EntityKind 를 만들지 않는가
 * 병아리는 **플레이어를 돕는 유닛**이다. `summonEnemy`/`spawnEnemy`(waves.ts)는 kind 를
 * `'enemy'` 로 하드코딩하는 **적 생성** 함수라 애초에 대상이 아니다(특히 `spawnEnemy` 는
 * `waveRng` 를 소비해 결정론까지 깬다). sim 에 이미 있는 유일한 아군 유닛 메커니즘이
 * `turretPickup` + `DRONE_MARK` 이고, 선례가 둘(유니크 ④ 드론 베이 `droneBay`, 보조무기 ③
 * 센트리)이다. 재사용으로 자동 조준·사격(stepTurrets)·수명(TURRET_LIFE_TICKS)·청크 컬링
 * 제외(isGimmick)·충돌 격자·렌더 스프라이트가 전부 공짜로 따라오고, 신규 KIND_CODE 가 0 이라
 * 해시 레이아웃이 불변이다.
 *
 * ⚠️ 마커는 `BROOD_MARK`(병아리 전용)이고, `isGimmick` 이 **DRONE_MARK 와 함께** 이 상수도
 * 기믹 분류에서 제외한다. 둘 중 하나라도 빠지면 병아리가 청크 컬링에 잘리고
 * MAX_ACTIVE_GIMMICKS 를 잡아먹는데, 컬링은 조용히 일어나 "가끔 안 나온다" 로만 관측된다.
 *
 * ## RNG 미소비
 * `spawnEventObject`·`activateTurret` 은 어느 RNG 스트림도 건드리지 않는다. 배치 좌표도
 * 살아 있는 드론 수로 고른 고정 4방향이라 난수가 없다 — 웨이브 구성·드랍 시퀀스가 해츨링
 * 런에서도 밀리지 않는다.
 */
function stepHatchBrood(state: WorldState, player: Entity): void {
  if (state.kills - player.aux0 < hatchThreshold(state.kills)) return;
  // 임계를 넘긴 틱에만 스캔한다(수십 틱에 한 번) — 매 틱 전체 순회를 만들지 않기 위해서다.
  let live = 0;
  for (const e of state.entities) {
    if (!e.dead && e.ownerId === BROOD_MARK && isActiveTurret(e)) live++;
  }
  // 상한에 걸리면 **aux0 을 갱신하지 않고** 보류한다 — 자리가 나는 즉시 다음 틱에 출격하고,
  // 그동안 쌓인 처치가 소멸하지 않는다.
  if (live >= BROOD_MAX_DRONES) return;
  // 배치는 살아 있는 대수로 고른 고정 4방향(우·좌·하·상). 여러 기가 정확히 겹쳐 한 대처럼
  // 보이는 것을 막는 목적이고, 난수·삼각함수를 쓰지 않아 결정론이 자명하다.
  const slot = live % 4;
  const ox = slot === 0 ? DRONE_SPAWN_OFFSET : slot === 1 ? -DRONE_SPAWN_OFFSET : 0;
  const oy = slot === 2 ? DRONE_SPAWN_OFFSET : slot === 3 ? -DRONE_SPAWN_OFFSET : 0;
  const chick = spawnEventObject(
    state,
    'turretPickup',
    player.x + ox,
    player.y + oy,
    BROOD_DRONE_RADIUS,
  );
  chick.ownerId = BROOD_MARK; // 청크 기믹과 구분(isGimmick 제외 → 컬링 비대상) + 병아리 전용 상한
  activateTurret(chick); // 즉시 활성 포탑(TURRET_LIFE_TICKS 동안 자동 사격)
  // 사연 관측(비-해시): 병아리 드론이 실제로 출격한 이 지점에서만 센다(상한·보류로 미출격이면
  // 여기 도달 안 함). 결정론 무영향 — hashWorld 가 접지 않는 순수 메타.
  state.broodLaunches++;
  // 출격 성공 시에만 스냅샷을 갱신한다 = 순수 함수 계약의 "카운터 0 리셋".
  player.aux0 = state.kills;
}

/**
 * 버블 방막 파열 — 반경 안의 적을 **좌표로** 직접 밀어낸다(설계서 §3).
 *
 * ⚠️ `e.vx`/`e.vy` 에 실으면 안 된다. 적 속도는 이동 컴포넌트가 매 틱 대입으로 덮어쓰므로
 * (patterns/index.ts 의 moveStandoff·moveSeekWounded·stationary) 밀어내기가 다음 틱에 흔적
 * 없이 사라지고, **화면상 아무 일도 안 일어나는데 그 1틱의 해시만 갈린다.** 좌표를 직접
 * 옮기는 선례가 바로 위 `applySingularityPull` 이며 산술 형태를 그대로 복제했다 —
 * `length` 1회 · 나눗셈 1회 · 곱셈 1회, `Math.pow`/`Math.hypot`/각도 경유 없음.
 * (ADR-0005 의 정수 bp 규율은 배율·피해 산술에 대한 것이고 위치는 f64 로 해시된다.)
 *
 * 대상은 `enemy` 로만 좁힌다 — 침공 방어체(prop·facility*)는 배치 좌표가 소켓 계약이라
 * 밀면 안 되고, 벽은 activeWalls·wallIndex 재빌드와 얽힌다.
 *
 * ## 침공에서도 그대로 작동한다 — 팬텀과 달리 게이트하지 않는 근거 (적대적 리뷰 wiring MED-2)
 * 침공 L1 편대원은 `kind === 'enemy'` 라 이 밀어내기의 대상이고, `refreshFormationAffixes`
 * (invasion/formation.ts)가 **매 틱** `resolveDefenseMods(set, trigger, e.x, e.y)` 로 좌표 기반
 * 어픽스를 다시 접는다. 그럼에도 게이트하지 않는 이유: 그 재계산은 원래 **매 틱 살아 있는 좌표**
 * 에서 이뤄지고 적은 어차피 매 틱 이동한다 — 파열은 "한 틱에 크게 움직인 이동" 일 뿐 계약을
 * 깨지 않는다. 팬텀을 침공에서 뺀 사유는 좌표가 아니라 **방어체가 공격할 수 있는지 여부**를
 * 바꾸는 것이었다(DefenseTriggerState 의 입력 자체가 사라진다). 둘은 같은 문제가 아니다.
 * (이 판단을 문서에 남기지 않으면 다음 세션이 "왜 하나만 게이트돼 있나" 를 다시 묻게 된다.)
 */
/**
 * `resolveCollisions` 의 시그니처 완화 스택(브루저 장갑 → 버블 방막 → 말로우 완충)을 타지 않고
 * `player.hp` 를 **직접** 깎는 경로에서, 시그니처의 "무피격" 의미만이라도 맞춰 준다.
 *
 * 대상은 침공 코어 모듈 반격 2종(`mt-reflection` 반사 · `mt-retribution` 일제사격)이다. 그대로
 * 두면(적대적 리뷰 wiring MED-3):
 *  · 말로우 — `aux1`(연속 무피격 틱)이 리셋되지 않아 **반사 피해를 매 틱 맞는 중에도** 임계
 *    180틱을 채워 완충 정산이 진행된다. "안전해진 순간에 미룬 피해가 들어온다" 는 축이 교전
 *    한복판에서 깨진다.
 *  · 브루저 — 같은 이유로 반사 피해를 맞는 동안 장갑 스택이 `ARMOR_DECAY_TICKS` 로 계속 빠진다.
 * 팬텀은 침공에서 시그니처 자체가 비활성이라(stepShipSignature) 대상이 아니고, 버블의 `aux1` 은
 * 피격과 무관한 **재생 타이머**라 절대 리셋하면 안 된다.
 *
 * ⚠️ 완화 스택 자체를 태우지는 않는다(반사·일제사격은 장갑/막/완충을 그대로 통과한다). 그것은
 * "플레이어 피해 진입점 3곳을 하나로 합치는" 리팩터가 필요하고 침공 밸런스(M7b 방어체 경제)를
 * 함께 움직이는 결정이라, M8 배선 범위 밖으로 남긴다 — 대신 여기에 근거를 남겨 다음 세션이
 * 미배선으로 오인하지 않게 한다.
 */
function noteDirectPlayerDamage(state: WorldState, player: Entity): void {
  if (state.sigBit === SIG_BRUISER_ARMOR || state.sigBit === SIG_MALLOW_CUSHION) {
    player.aux1 = 0;
  }
}

function burstFilm(state: WorldState, player: Entity): void {
  const push = filmBurstPush();
  const r2 = FILM_BURST_RADIUS * FILM_BURST_RADIUS;
  for (const e of state.entities) {
    if (e.dead || e.kind !== 'enemy') continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const d2 = dx * dx + dy * dy;
    // 반경 판정은 제곱 비교로(선례: nearestTarget·applySingularityPull) — sqrt 를 아끼는 것이
    // 아니라 반경 밖 적에 대해 산술 자체를 실행하지 않기 위해서다.
    if (d2 > r2) continue;
    const d = length(dx, dy);
    // 플레이어와 정확히 겹친 적은 밀 방향이 정의되지 않는다 — 임의 방향을 만들지 않고 둔다.
    if (d <= 1) continue;
    e.x += (dx / d) * push;
    e.y += (dy / d) * push;
    // ⚠️ 밀어낸 직후 벽 충돌을 **즉시** 재해결한다(적대적 리뷰 MED-4). 260 유닛은 벽 두께보다
    // 크므로, 그냥 두면 침공 회랑처럼 벽이 촘촘한 무대에서 적이 벽 안쪽 깊숙이 박힌다. 다음 틱
    // 이동 단계의 `slideCircleWalls` 는 **최근접 면**으로 밀어내므로 침투 깊이가 두께의 절반을
    // 넘으면 반대편으로 튀어나온다(터널링) — 결정론은 유지되므로 서버 재실행도 같은 결과를 내고,
    // 그래서 해시 검증으로는 절대 잡히지 않는 조용한 배치 계약 위반이 된다.
    if (state.activeWalls.length > 0) {
      const slid = slideCircleWalls(e.x, e.y, e.radius, state.activeWalls);
      e.x = slid.x;
      e.y = slid.y;
    }
  }
}

// ---------------------------------------------------------------------------
// Enemies (pattern engine)
// ---------------------------------------------------------------------------

function stepEnemies(state: WorldState, player: Entity): void {
  // Snapshot the enemy set so bullets/hazards emitted this tick are not treated
  // as enemies, and count live enemy bullets for the per-segment cap.
  state.enemyBulletCount = countKind(state, 'enemyBullet');
  // ⑧ 특이점 발생기(plan B4): 장착 시 반경 안 적을 매 틱 플레이어 쪽으로 흡인. 미장착
  // 이면 no-op.
  const singularityOn = hasUnique(state.config.loadout?.uniqueMask ?? 0, UQ_SINGULARITY);
  const enemies: Entity[] = [];
  for (const e of state.entities) if (e.kind === 'enemy') enemies.push(e);
  for (const e of enemies) {
    // 원소 상태이상 진행(화염 지속피해·냉기/전격 타이머). 상태이상 없는 적은 세 재활용
    // 필드가 모두 0이라 no-op(거동 불변). 화염으로 처치되면 dead 표시 후 스킵.
    tickEnemyStatus(e);
    if (e.dead) continue;
    // 재생하는 엘리트: 매 틱 HP 회복(그 외 no-op).
    applyEliteRegen(e);
    let def = enemyDefFor(e);
    if (def === undefined) continue;
    // 가속하는 elite(×1.6) × 냉기 감속(<1) × 촉매 적 속도 페널티(≥1)를 곱해 이동 속도를
    // 조정한다(공유 데이터 행은 절대 변형하지 않고 def를 복제). 전부 없으면/무촉매면 mult 1(불변).
    const sm = eliteSpeedMult(e) * enemyStatusSlowMult(e) * state.catalystMods.enemySpeed;
    if (sm !== 1) def = { ...def, speed: def.speed * sm };
    updateEnemy(state, e, def, player);
    if (singularityOn) applySingularityPull(e, player);
  }
}

/** ⑧ 특이점 발생기: 반경 안 적을 플레이어 쪽으로 결정론적으로 당긴다(RNG 미소비). */
function applySingularityPull(e: Entity, player: Entity): void {
  const dx = player.x - e.x;
  const dy = player.y - e.y;
  const d = length(dx, dy);
  if (d <= 1 || d >= SINGULARITY_RADIUS) return;
  const step = Math.min(SINGULARITY_PULL_SPEED * DT, d);
  e.x += (dx / d) * step;
  e.y += (dy / d) * step;
}

// ---------------------------------------------------------------------------
// Boss (spawned once the wave director reaches the boss segment).
// ---------------------------------------------------------------------------

function stepBoss(state: WorldState, player: Entity): void {
  if (state.wave.boss && !state.bossSpawned) {
    // Infinite map: spawn the boss just off-screen above the player rather than
    // at an absolute arena position. moveBoss then hovers it relative to the player.
    // 행성별 보스 선택(카르곤 용암 요새 / 베르단 여왕). enemyType에 행성 인덱스를
    // 태깅해 렌더가 보스 스프라이트를 분화할 수 있게 한다(카르곤=0 유지 → 해시 불변).
    const bossDef = planetContent(state.config.planet).boss;
    // 강제 스크롤(Lane4/5): 카메라가 플레이어가 아니라 스크롤 창이므로 보스도 창 중심 기준으로
    // 소환한다(플레이어 기준이면 창 안 오프셋만큼 어긋난다). 모드별 방향으로 코스 끝에 둔다 —
    // 레이싱(+X 스크롤)은 오른쪽 끝(+X), 블록격파(−Y 스크롤)·뱀서류는 위(−Y). 뱀서류는 창
    // 미존재 → 플레이어 기준 + −Y 그대로(바이트 불변). 침공은 wave.boss 를 세우지 않아 미도달.
    const bossWin = state.invasion3 ?? state.scrollRuntime;
    let bossX = bossWin !== undefined ? windowCenterX(bossWin) : player.x;
    let bossY = bossWin !== undefined ? windowCenterY(bossWin) : player.y;
    if (state.config.planetMode === PLANET_MODE.shrink) {
      // 수축지대(Lane7): 보스를 아레나 중심(원점 0,0)에 소환한다 — 안전 반경이 조여드는 코어에서
      // 최후전. 플레이어/창 기준 오프셋을 쓰지 않는다(shrink 는 창 미존재 → bossWin undefined).
      bossX = 0;
      bossY = 0;
    } else if (state.config.planetMode === PLANET_MODE.racing)
      bossX += VIEW_WIDTH * 0.55; // 코스 끝(+X)
    else bossY -= VIEW_HEIGHT * 0.55; // 블록격파 top(−Y)·뱀서류 기존
    // 촉매 적 HP·접촉 피해 페널티는 보스에도 적용한다(잡몹과 같은 규율). 무촉매면 ×1(불변).
    const bossHp = Math.round(bossDef.hp * state.catalystMods.enemyHp);
    const boss = spawnBoss(state, bossX, bossY, bossHp, bossDef.radius);
    boss.damage = bossDef.contactDamage * state.catalystMods.enemyDamage;
    boss.enemyType = state.config.planet ?? 0;
    state.bossSpawned = true;
  }
  for (const e of state.entities) {
    if (e.kind === 'boss') updateBoss(state, e, player);
  }
}

// ---------------------------------------------------------------------------
// Player auto-attack (vulcan): target nearest enemy/boss, fire a fanned volley.
// ---------------------------------------------------------------------------

/** Weapon archetype codes (shared with src/items/loadout.ts). */
const WEAPON_TYPE_SPREAD = 1;
const WEAPON_TYPE_RAILGUN = 2;
const WEAPON_TYPE_MISSILE = 3;
const WEAPON_TYPE_BEAM = 4;

/**
 * Homing-missile marker on a friendly bullet's `ownerId` (already hashed). A
 * bullet carrying it re-steers toward the nearest target each tick in
 * stepProjectiles, clamped to MISSILE_TURN_RATE (limited turn — OQ-M3-4). Chosen
 * distinct from SPLIT_FRAGMENT_MARK / DRONE_MARK so the marks never alias. */
const MISSILE_MARK = 0x3155110;
/** Max radians a missile turns toward its target per tick (evadable, GDD §10). */
const MISSILE_TURN_RATE = 0.09;
/** Beam segment count cap and spacing (매틱 짧은 수명 세그먼트 판정 — OQ-M3-3). */
const BEAM_MAX_SEGMENTS = 16;
const BEAM_SEGMENT_SPACING = 90;
/** Beam segment radius (tiles the line with slight overlap for a continuous hit). */
const BEAM_SEGMENT_RADIUS = 52;
/** Beam segment lifetime (ticks): a brief static hit line, re-laid each fire. */
const BEAM_SEGMENT_LIFE = 2;
/**
 * 빔이 세그먼트로 **물리적으로 덮을 수 있는** 최대 거리. 세그먼트 개수 상한이 곧 사거리
 * 상한이므로 두 값을 따로 두지 않고 여기서 파생시킨다 — 예전에는 조준 상한(`w.range`)과
 * 세그먼트 커버리지가 각각 굴러가서, 사거리 투자가 세그먼트에는 이득이고 조준에는 손해인
 * **부호가 엇갈린 상태**였다.
 */
const BEAM_MAX_REACH = BEAM_MAX_SEGMENTS * BEAM_SEGMENT_SPACING;

/**
 * 이 무기가 **실제로 닿는 거리**. 조준 탐색과 발사체 커버리지가 반드시 같은 값을 써야
 * "조준은 되는데 안 닿는다"(혹은 그 반대)가 생기지 않는다.
 *
 * 빔만 예외적으로 상한이 있다: 세그먼트를 {@link BEAM_MAX_SEGMENTS} 개까지만 깔 수 있어
 * 그보다 먼 표적은 조준해도 타격선이 닿지 않는다. 그래서 조준 자체를 상한까지만 한다.
 */
function weaponReach(w: WeaponStats): number {
  const r = w.range > 0 ? w.range : 0;
  if (w.weaponType === WEAPON_TYPE_BEAM) return r < BEAM_MAX_REACH ? r : BEAM_MAX_REACH;
  return r;
}

/**
 * 발사체가 사거리 끝까지 살아 있도록 보정한 수명(틱).
 *
 * 사거리는 "닿는 거리"라는 계약이므로(WeaponStats.range), 조준한 표적까지 탄이 실제로
 * 날아가야 한다. 기본값(발칸 1800×DT×55 = 1650)은 기준 사거리 1400 을 이미 덮으므로
 * 무투자 거동은 그대로이고, 사거리에 투자했거나 탄속이 낮은 아키타입(미사일 ×0.7 →
 * 자연 도달 1155)에서만 수명이 늘어난다.
 */
function reachLife(w: WeaponStats, reach: number): number {
  const perTick = w.bulletSpeed * DT;
  if (perTick <= 0) return w.bulletLife;
  const need = Math.ceil(reach / perTick);
  return need > w.bulletLife ? need : w.bulletLife;
}

function autoAttack(state: WorldState, player: Entity): void {
  const w = state.weapon;
  if (player.cooldown > 0) player.cooldown--;
  if (player.cooldown > 0) return;

  const reach = weaponReach(w);
  const target = nearestTarget(state, player, reach);
  if (target === undefined) return;
  const bulletLife = reachLife(w, reach);

  // ① 과열 드럼: 연속 명중 스택(player.phase)만큼 발사 쿨다운 단축. 미장착 시
  //    스택은 항상 0이라 base 그대로(거동 불변).
  const mask = state.config.loadout?.uniqueMask ?? 0;
  const fireCd = hasUnique(mask, UQ_OVERHEAT_DRUM)
    ? overheatCooldown(w.fireCooldown, player.phase)
    : w.fireCooldown;

  // 아크캐스터 시그니처 — 연속 정지 틱(player.aux0)에 비례한 피해 증폭(설계서 §3·§4).
  // 미보유·이동 중이면 bp = 0 → `wDamage === w.damage` 로 **완전히 같은 값**이라 거동·해시 불변.
  // ⚠️ L2 의 `overchargedDamage` 를 직접 부르지 않고 `overchargeBp` 만 쓰는 이유: 그 함수는
  // 입력을 `Math.trunc` 하는데(정수 in/정수 out 규약), 이 sim 의 `weapon.damage` 는 소수 2자리
  // 실수라(`Math.round(x*100)/100`) bp=0 인 평상시에도 소수부가 사라져 **비과충전 피해까지
  // 바뀐다.** 적용 산술은 그 함수와 동형(정수 bp · 단일 나눗셈 · 반올림 1회)이며, 정수 피해에
  // 대해서는 두 경로가 완전히 같은 값임을 tests/weapons.test.ts 가 못 박는다.
  const ocBp = signatureOn(state, SIG_ARC_OVERCHARGE) ? overchargeBp(player.aux0) : 0;
  let wDamage = ocBp === 0 ? w.damage : w.damage + Math.round((w.damage * ocBp) / 10000);

  // 팬텀 시그니처 — 은신 해제 첫 타 배율(설계서 §3·§4). **여기가 유일한 소진 지점이다**:
  // 이 줄 아래의 모든 무기 아키타입 분기(레일건·미사일·빔·발칸/스프레드)가 예외 없이
  // 발사하므로, 위쪽 조기 반환(쿨다운 미준비 `player.cooldown > 0` · 사거리 안 표적 없음)에
  // 걸린 틱에는 표식이 소모되지 않는다 — "쏘지 않으면 은신이 유지된다" 가 코드 구조로
  // 보장된다. 배율은 플레이어가 **주는** 피해에 실린다(암살자 축).
  // ⚠️ L2 의 `cloakBreakDamage` 를 직접 부르지 않는 이유는 아크캐스터 주석과 같다: 그 함수는
  // 입력을 `Math.trunc` 하는데 `weapon.damage` 는 소수 2자리 실수다. 산술은 그 함수와 동형
  // (정수 bp · 단일 나눗셈 · 반올림 1회)이라 정수 피해에 대해 값이 완전히 같다.
  // 미보유·비은신이면 이 블록은 한 줄도 실행되지 않아 `wDamage` 가 위 값 그대로다(해시 불변).
  if (signatureOn(state, SIG_PHANTOM_CLOAK) && player.aux1 !== 0) {
    wDamage = Math.round((wDamage * CLOAK_BREAK_BP) / 10000);
    // 사연 관측(비-해시): 은신 해제 첫 타가 실제로 발동한 이 지점에서만 센다. 결정론 무영향 —
    // hashWorld 가 접지 않는 순수 메타.
    state.cloakBreaks++;
    // 토큰만 소진한다 — **aux0(무피격 스트릭)은 건드리지 않는다.** 은신을 푸는 것은 피격이지
    // 발사가 아니다(stepShipSignature 팬텀 분기 주석). aux0 을 여기서 0 으로 되돌리면 은신이
    // 사실상 발동하지 않는 초판 결함으로 되돌아간다.
    player.aux1 = 0;
  }

  const baseAngle = atan2(target.y - player.y, target.x - player.x);
  // Firing archetypes off `weaponType` (M2 B2 + M3 C1):
  //   2 = 레일건: one shot straight at the target (pierce/speed do the work).
  //   3 = 미사일: `bulletCount` homing missiles — slow, hard, limited turn.
  //   4 = 빔: a line of short-life static segments covering the aim (매틱 판정).
  //   0/1 = 발칸 / 스프레드: fanned volley (differ only by loadout baseline).
  if (w.weaponType === WEAPON_TYPE_RAILGUN) {
    spawnBullet(
      state,
      player.x,
      player.y,
      baseAngle,
      w.bulletSpeed,
      wDamage,
      w.pierce,
      w.bulletRadius,
      bulletLife,
      cos(baseAngle),
      sin(baseAngle),
    );
    player.cooldown = fireCd;
    return;
  }

  if (w.weaponType === WEAPON_TYPE_MISSILE) {
    const n = w.bulletCount < 1 ? 1 : w.bulletCount;
    const start = n > 1 ? baseAngle - w.spread / 2 : baseAngle;
    const stepA = n > 1 ? w.spread / (n - 1) : 0;
    for (let i = 0; i < n; i++) {
      const ang = start + stepA * i;
      const m = spawnBullet(
        state,
        player.x,
        player.y,
        ang,
        w.bulletSpeed,
        wDamage,
        w.pierce,
        w.bulletRadius,
        bulletLife,
        cos(ang),
        sin(ang),
      );
      m.ownerId = MISSILE_MARK; // 유도 마커: stepProjectiles가 매 틱 제한 선회.
    }
    player.cooldown = fireCd;
    return;
  }

  if (w.weaponType === WEAPON_TYPE_BEAM) {
    // 타격선은 **조준한 거리와 정확히 같은 만큼** 깐다(`reach`). 상한 클램프가 따로 없는
    // 이유는 `weaponReach` 가 이미 BEAM_MAX_REACH(= 상한 개수 × 간격)로 잘라 주기 때문이다
    // — `floor(BEAM_MAX_REACH / BEAM_SEGMENT_SPACING) === BEAM_MAX_SEGMENTS` 로 정의상 일치한다.
    // (예전 `w.range > 0 ? w.range : BEAM_DEFAULT_RANGE` 폴백은 도달 불가능한 죽은 분기였다:
    //  빔은 `applyWeaponTypeBase` 가 사거리를 무조건 더해 `range` 가 항상 0 초과였다.)
    let segs = Math.floor(reach / BEAM_SEGMENT_SPACING);
    if (segs < 1) segs = 1;
    const ca = cos(baseAngle);
    const sa = sin(baseAngle);
    for (let i = 1; i <= segs; i++) {
      const dist = i * BEAM_SEGMENT_SPACING;
      // Static segment (speed 0): a brief hit point along the beam line. High
      // pierce so it damages every enemy overlapping it; short life re-laid each
      // fire so a fast cadence reads as a continuous line.
      spawnBullet(
        state,
        player.x + ca * dist,
        player.y + sa * dist,
        baseAngle,
        0,
        wDamage,
        9999,
        BEAM_SEGMENT_RADIUS,
        BEAM_SEGMENT_LIFE,
        ca,
        sa,
      );
    }
    player.cooldown = fireCd;
    return;
  }

  // ⑦ 쌍둥이 항성: 부채꼴 발사체 2배 + 발당 피해 ×TWIN_STAR_DAMAGE_MULT. 미장착 시
  //    n·dmg 그대로(거동 불변). 스프레드(weaponType 1) 파생 유니크이므로 스프레드
  //    무기에서만 발화(리뷰 MED-1 이중 게이트 — roll.ts 페어링과 정합). 발칸 등 타
  //    무기에 롤될 수 없고, 설령 실려도 no-op.
  const twinOn = hasUnique(mask, UQ_TWIN_STAR) && w.weaponType === WEAPON_TYPE_SPREAD;
  const n = twinOn ? w.bulletCount * 2 : w.bulletCount;
  const dmg = twinOn ? wDamage * TWIN_STAR_DAMAGE_MULT : wDamage;
  const start = n > 1 ? baseAngle - w.spread / 2 : baseAngle;
  const stepA = n > 1 ? w.spread / (n - 1) : 0;
  for (let i = 0; i < n; i++) {
    const ang = start + stepA * i;
    spawnBullet(
      state,
      player.x,
      player.y,
      ang,
      w.bulletSpeed,
      dmg,
      w.pierce,
      w.bulletRadius,
      bulletLife,
      cos(ang),
      sin(ang),
    );
  }
  player.cooldown = fireCd;
}

/**
 * 화력 캡스톤 — 탄막 상쇄 레이저(GDD §4). 캡스톤 활성 시 LASER_PERIOD(90틱=1.5초)마다
 * 조준 방향으로 전방 레이저를 쏴, 사거리·반폭 안의 적탄을 소거한다. 순수 결정론: 발화 시점은
 * state.tick 배수, 판정은 정수/부동 산술(laserHits)만 사용 — RNG·wall-clock 없음. 적탄만
 * 소거하고 새 엔티티/필드를 만들지 않아 hashWorld 레이아웃 불변.
 */
function capstoneLaser(state: WorldState, player: Entity): void {
  const mask = state.config.loadout?.uniqueMask ?? 0;
  if (!hasCapstone(mask, CAP_FIREPOWER_LASER)) return;
  // tick 0 에는 적탄이 없으므로 사실상 무의미하지만, 배수 판정은 그대로 유지(결정론).
  if (state.tick % LASER_PERIOD !== 0) return;
  const dirX = cos(player.angle);
  const dirY = sin(player.angle);
  for (const t of state.entities) {
    if (t.kind !== 'enemyBullet' || t.dead) continue;
    if (laserHits(player.x, player.y, dirX, dirY, t.x, t.y)) t.dead = true;
  }
}

// --- Sub-weapon 5종 (M2 plan B2, OQ-M2-2: 독립 발사 슬롯; GDD §5 "보조무기 5종") ------
//
// 보조무기는 주무기(autoAttack)와 완전히 분리된 자기 사이클로 동작한다. 사이클 카운트다운은
// 플레이어의 미사용 `timer` 필드(이미 해시됨)에 실어 신규 WorldState 필드·해시 스키마 변경
// 없이 결정론을 유지한다. 미장착(subWeaponType === SUB_WEAPON_NONE = -1)이면 즉시 반환 →
// 기존 PvE 런과 비트 동일(거동·해시 불변). 5종은 확실히 다른 플레이 감각을 목표로 한다:
//   0 사이드킥  — 빠른 연사 단발 볼트(근접 자동 조준). 꾸준한 보조 DPS.
//   1 스캐터    — 3발 광각 산탄(짧은 사거리). 근거리 다수 제압.
//   2 기뢰장    — 플레이어 위치에 설치형 지속 피해 장판(정지 발사체·긴 수명·넓은 반경).
//   3 센트리    — 주기적으로 임시 자동 포탑 배치(독립 자동 사격). 자율 드론 베이 로직 재사용.
//   4 호밍 플레어 — 유도 미사일(제한 선회). 느린 연사·강한 단발.
//
// 렌더 구분(요구 #4): 보조무기가 직접 쏘는 발사체는 blankEntity의 기본 enemyType(-1) 대신
// 자기 타입 코드(0..4)를 실어 스폰한다. sim은 friendly bullet의 enemyType을 읽지 않으므로
// (오직 ownerId만 유도 마커로 사용) 순수 렌더 태그다 — entityRenderer가 이 코드로 색을
// 구분한다. 센트리(3)의 포탑탄은 stepTurrets가 표준 포탑탄으로 쏘므로 기본 렌더.
//
// 어픽스 상호작용(요구 #5): 데미지·연사 어픽스는 주무기와 동일한 배율(loadout.damageMult /
// fireRateMult)을 보조무기의 직접 발사체(사이드킥·스캐터·기뢰·플레어)에 그대로 공유한다.
// 센트리(3)가 배치하는 포탑은 자율 드론 베이와 동일하게 고정 스탯 포탑이다(포탑탄은 별도
// 시스템 stepTurrets가 관리) — 문서화된 예외.

/** 보조무기 타입 코드(loadout.ts SUB_* 상수와 동일 — friendly bullet 렌더 태그로도 사용). */
const SUB_TYPE_SIDEKICK = 0;
const SUB_TYPE_SCATTER = 1;
const SUB_TYPE_MINE = 2;
const SUB_TYPE_SENTRY = 3;
const SUB_TYPE_FLARE = 4;

// 사이드킥(0): 빠른 단발.
const SUB_SIDEKICK_COOLDOWN = 18;
const SUB_SIDEKICK_DAMAGE = 6;
const SUB_SIDEKICK_SPEED = 1600;
const SUB_SIDEKICK_RADIUS = 5;
const SUB_SIDEKICK_LIFE = 60;
const SUB_SIDEKICK_RANGE = 900;

// 스캐터(1): 3발 광각 산탄, 짧은 사거리, 중간 쿨다운.
const SUB_SCATTER_COOLDOWN = 33;
const SUB_SCATTER_DAMAGE = 4;
const SUB_SCATTER_SPEED = 1400;
const SUB_SCATTER_RADIUS = 5;
const SUB_SCATTER_LIFE = 38;
const SUB_SCATTER_RANGE = 620;
const SUB_SCATTER_PELLETS = 3;
/** 총 부채꼴 각(라디안). */
const SUB_SCATTER_SPREAD = 0.52;

// 기뢰장(2): 플레이어 위치에 정지 발사체(속도 0)를 설치. 긴 수명·넓은 반경 동안 위로
// 지나가는 적에게 매 틱 피해를 주되, 관통 예산이 소진되면 소멸(장판 총 피해 상한). 조준
// 대상 없이도 설치(선제 지역 거부). 빔 세그먼트(정지 발사체) 판정 경로를 그대로 재사용.
const SUB_MINE_COOLDOWN = 66;
const SUB_MINE_DAMAGE = 3;
const SUB_MINE_RADIUS = 64;
const SUB_MINE_LIFE = 150;
/** 장판이 흡수하는 총 명중 횟수(적×틱). 소진 시 즉시 소멸 → 총 피해 상한. */
const SUB_MINE_PIERCE = 40;

// 센트리(3): 임시 자동 포탑 주기 배치(자율 드론 베이 재사용). 조준 대상 없이도 배치.
const SUB_SENTRY_COOLDOWN = 300;
/** 배치 오프셋(플레이어 옆). 드론 베이와 동일 상수 재사용(DRONE_SPAWN_OFFSET). */

// 호밍 플레어(4): 유도 미사일. 느린 연사·강한 단발. MISSILE_MARK로 stepProjectiles가 매 틱
// 제한 선회. 탄속을 낮춰 곡선 추적이 눈에 보이게 한다.
const SUB_FLARE_COOLDOWN = 45;
const SUB_FLARE_DAMAGE = 14;
const SUB_FLARE_SPEED = 1000;
const SUB_FLARE_RADIUS = 6;
const SUB_FLARE_LIFE = 95;
const SUB_FLARE_RANGE = 950;

/** 보조무기 직접 발사체에 주무기와 공유하는 데미지 배율 적용(요구 #5). 주무기와 동일한
 *  반올림(소수 2자리)으로 결정론·플랫폼 불변 유지. */
function subDamage(state: WorldState, base: number): number {
  const mult = state.config.loadout?.damageMult ?? 1;
  return Math.round(base * mult * 100) / 100;
}

/**
 * 침공 방어 측 엔티티인가(코어 모듈 피해 감소 대상). 3레이어의 방어체는 편대(L1)·설비(L2)·
 * 기물/보스/수호/코어(L3) 전부다. 편대원·소환 드론은 `summonEnemy` 경유라 kind 가 'enemy' 다.
 */
function isInvasionDefender(kind: EntityKind): boolean {
  return (
    kind === 'core' ||
    kind === 'guardian' ||
    kind === 'enemy' ||
    kind === 'formation' ||
    kind === 'formationDrone' ||
    kind === 'facilityGun' ||
    kind === 'facilityHazard' ||
    kind === 'facilitySpawner' ||
    kind === 'spawnedDrone' ||
    kind === 'prop' ||
    kind === 'defenseBoss'
  );
}

/** 보조무기 사이클 쿨다운에 주무기와 공유하는 연사 배율 적용(요구 #5). 최소 2틱 하한
 *  (주무기 fireCooldown 하한과 정합). */
function subCooldown(state: WorldState, base: number): number {
  const mult = state.config.loadout?.fireRateMult ?? 1;
  // 코어 모듈 정적 카운터(절연/교란): 공격자 보조무기 쿨다운 증가(+% → 간격↑). 미장착·미일치면
  // subMult=1 이라 `base*mult*1===base*mult` 로 비트 동일(거동·해시 불변).
  const subMult =
    state.moduleRuntime !== undefined ? 1 + state.moduleRuntime.attackerSubCdPct / 100 : 1;
  const cd = Math.round(base * mult * subMult);
  return cd < 2 ? 2 : cd;
}

/**
 * 독립 보조무기 발사(plan B2 / OQ-M2-2). 자기 사이클(player.timer)로 주무기 쿨다운과
 * 경쟁하지 않는다. subWeaponType 0..4로 분기, -1(미장착)은 no-op(거동·해시 불변).
 */
function subWeapon(state: WorldState, player: Entity): void {
  const subType = state.config.loadout?.subWeaponType ?? -1;
  if (subType < 0) return;
  if (player.timer > 0) {
    player.timer--;
    return;
  }

  // 기뢰장·센트리는 조준 대상 없이 선제 설치(지역 거부·자율 사격). 나머지는 최근접 적을
  // 조준하며, 대상이 없으면 사이클을 소비하지 않고 대기(timer 유지 = 즉시 발사 준비).
  if (subType === SUB_TYPE_MINE) {
    const mine = spawnBullet(
      state,
      player.x,
      player.y,
      0,
      0,
      subDamage(state, SUB_MINE_DAMAGE),
      SUB_MINE_PIERCE,
      SUB_MINE_RADIUS,
      SUB_MINE_LIFE,
      1,
      0,
    );
    mine.enemyType = SUB_TYPE_MINE; // 렌더 태그
    player.timer = subCooldown(state, SUB_MINE_COOLDOWN);
    return;
  }

  if (subType === SUB_TYPE_SENTRY) {
    // 자율 드론 베이와 동일: turretPickup을 배치 후 즉시 활성 포탑화. DRONE_MARK로 청크
    // 기믹 컬링·상한 대상에서 제외(플레이어 소환물). stepTurrets가 자동 사격·수명 처리.
    const sentry = spawnEventObject(state, 'turretPickup', player.x + DRONE_SPAWN_OFFSET, player.y, 44);
    sentry.ownerId = DRONE_MARK;
    activateTurret(sentry);
    player.timer = subCooldown(state, SUB_SENTRY_COOLDOWN);
    return;
  }

  const range =
    subType === SUB_TYPE_SCATTER
      ? SUB_SCATTER_RANGE
      : subType === SUB_TYPE_FLARE
        ? SUB_FLARE_RANGE
        : SUB_SIDEKICK_RANGE;
  const target = nearestTarget(state, player, range);
  if (target === undefined) return;
  const baseAngle = atan2(target.y - player.y, target.x - player.x);

  if (subType === SUB_TYPE_SCATTER) {
    const n = SUB_SCATTER_PELLETS;
    const start = baseAngle - SUB_SCATTER_SPREAD / 2;
    const stepA = n > 1 ? SUB_SCATTER_SPREAD / (n - 1) : 0;
    const dmg = subDamage(state, SUB_SCATTER_DAMAGE);
    for (let i = 0; i < n; i++) {
      const ang = start + stepA * i;
      const b = spawnBullet(
        state,
        player.x,
        player.y,
        ang,
        SUB_SCATTER_SPEED,
        dmg,
        0,
        SUB_SCATTER_RADIUS,
        SUB_SCATTER_LIFE,
        cos(ang),
        sin(ang),
      );
      b.enemyType = SUB_TYPE_SCATTER;
    }
    player.timer = subCooldown(state, SUB_SCATTER_COOLDOWN);
    return;
  }

  if (subType === SUB_TYPE_FLARE) {
    const flare = spawnBullet(
      state,
      player.x,
      player.y,
      baseAngle,
      SUB_FLARE_SPEED,
      subDamage(state, SUB_FLARE_DAMAGE),
      0,
      SUB_FLARE_RADIUS,
      SUB_FLARE_LIFE,
      cos(baseAngle),
      sin(baseAngle),
    );
    flare.ownerId = MISSILE_MARK; // 유도 마커: stepProjectiles가 매 틱 제한 선회
    flare.enemyType = SUB_TYPE_FLARE; // 렌더 태그
    player.timer = subCooldown(state, SUB_FLARE_COOLDOWN);
    return;
  }

  // 0 사이드킥(기본): 단발.
  const b = spawnBullet(
    state,
    player.x,
    player.y,
    baseAngle,
    SUB_SIDEKICK_SPEED,
    subDamage(state, SUB_SIDEKICK_DAMAGE),
    0,
    SUB_SIDEKICK_RADIUS,
    SUB_SIDEKICK_LIFE,
    cos(baseAngle),
    sin(baseAngle),
  );
  b.enemyType = SUB_TYPE_SIDEKICK;
  player.timer = subCooldown(state, SUB_SIDEKICK_COOLDOWN);
}

/**
 * ④ 자율 드론 베이(plan F1, OQ-M2-6 #4): 장착 시 주기적으로 임시 포탑(드론)을
 * 플레이어 곁에 소환한다. scroll-map turretPickup 로직 재사용(spawnEventObject +
 * activateTurret) — 소환된 포탑은 stepTurrets가 자동 사격/수명 처리한다. 소환 주기는
 * player.ownerId(플레이어 미사용 필드, 이미 해시됨)에 카운트다운으로 실어 신규
 * WorldState 필드·해시 변경 없이 결정론 유지. 미장착 시 ownerId는 항상 0(거동 불변).
 */
function droneBay(state: WorldState, player: Entity): void {
  const mask = state.config.loadout?.uniqueMask ?? 0;
  if (!hasUnique(mask, UQ_DRONE_BAY)) return;
  if (player.ownerId > 0) {
    player.ownerId--;
    return;
  }
  const drone = spawnEventObject(state, 'turretPickup', player.x + DRONE_SPAWN_OFFSET, player.y, 44);
  drone.ownerId = DRONE_MARK; // 청크 기믹과 구분(isGimmick 제외 → 컬링·상한 비대상)
  activateTurret(drone); // 즉시 활성 포탑(TURRET_LIFE_TICKS 동안 자동 사격)
  player.ownerId = DRONE_INTERVAL;
}

/** Max candidates LOS-tested per aim (nearest few); bounds the wall raycast cost. */
const LOS_MAX_CANDIDATES = 6;

/**
 * nearestTarget slow-path 후보 스크래치(모듈 레벨 재사용). 매 조준마다 배열을 새로
 * 할당하지 않아 GC 압력을 줄인다. 매 호출 시작에 length=0으로 리셋하고 처음부터 다시
 * 채우므로 이전 호출의 잔존 데이터를 참조하지 않는다(내용은 매번 재계산 — 결정론 유지).
 * WorldState가 아니라 모듈 스크래치이므로 hashWorld 대상에 포함되지 않는다.
 */
const losCands: { e: Entity; d: number }[] = [];

/**
 * Nearest hostile the vulcan can target: any enemy, boss, or supply raider.
 *
 * LOS (plan F1c): a candidate hidden behind a wall is skipped and the NEXT
 * nearest visible candidate is chosen ("filter blocked, then nearest" — not
 * "nearest, else none"). When there are no active walls this collapses to the
 * plain nearest scan (no allocation, identical to the pre-gimmick behaviour).
 */
/**
 * 플레이어(및 아군 포탑·유도탄)가 조준·타격할 수 있는 적성 대상인가. 기존 PvE 적성
 * (enemy·boss·supply)에 침공 방어 엔티티(core·수호·설비 등)를 더한다. PvE 런에는 방어
 * 엔티티가 존재하지 않으므로 이 확장은 기존 거동·해시에 영향이 없다(순수 추가 대상).
 *
 * **세 목록은 항상 같이 바뀐다.** ① 충돌 격자 등록(약 1840행) ② 아군탄 표적 화이트리스트
 * (약 2114행) ③ 이 조준 술어. M7a 통합 시 ①②만 확장돼 3레이어 방어체가 '맞기는 하지만
 * 조준되지는 않는' 상태로 남았고, 그 결과 실드 발생기(기물 역할 0)가 소켓에 하나만 있어도
 * 침공이 **수학적으로 클리어 불가**였다 — 발생기가 살아 있는 동안 코어 보호막이 매 틱
 * 전량 재충전되는데(updateCoreShield, 의도된 '먼저 파괴 강제' 설계), 정작 그 발생기를
 * 플레이어가 조준할 수 없어 영원히 파괴하지 못했다. 무적 플레이어로 L3 를 7200틱 돌려도
 * 코어 8000/8000·발생기 900/900 으로 무피해였다.
 */
function isPlayerTargetable(e: Entity): boolean {
  // 발생기 보호막 국면의 코어는 **조준 대상에서 뺀다**(`timer === 1` = 실드 발생기가 살아
  // 있음, coreRoom.updateCoreShield 가 세우는 결정론 플래그). 이 국면의 코어는 매 틱 보호막이
  // 전량 재충전돼 피해가 0 이므로, 조준을 허용하면 언제나 코어가 최근접 표적으로 뽑혀 플레이어가
  // 무적 표적을 영원히 때리고 정작 발생기는 한 대도 맞지 않는다 — 기물 설계 의도(공격 순서
  // 강제)가 자동 조준 때문에 뒤집히던 지점이다. 뺀 동안에는 발생기·설비가 최근접으로 뽑혀
  // 파괴되고, 마지막 발생기가 죽는 틱에 timer 가 0 이 되어 코어가 다시 조준 가능해진다.
  // (수동 조준·직접 충돌 피해는 이 술어와 무관하게 그대로 코어에 들어간다.)
  //
  // ⚠️ **이 조건은 아군탄 명중 루프의 코어 통과 규칙과 쌍이다**(`resolveCollisions` 안의
  // `t.kind === 'core' && t.timer === 1` continue). 여기서 조준만 빼고 충돌을 남겨 두면 코어가
  // 반지름 90 짜리 **무적 차폐물**이 되어 발생기로 가는 사선을 막는다 — 실제로 그 상태였고,
  // 기지 #12 패배 런의 100%가 코어 그림자 안에서 일어났다. 한쪽만 고치지 마라.
  if (e.kind === 'core') return e.timer !== 1;
  return (
    e.kind === 'enemy' ||
    e.kind === 'boss' ||
    e.kind === 'supply' ||
    e.kind === 'decoyCore' ||
    e.kind === 'guardian' ||
    // M7a 3레이어 방어체(위 ①② 목록과 쌍).
    e.kind === 'facilityGun' ||
    e.kind === 'facilityHazard' ||
    e.kind === 'facilitySpawner' ||
    e.kind === 'defenseBoss' ||
    e.kind === 'prop'
  );
}

/**
 * `range` 안에서 가장 가까운 조준 대상.
 *
 * ⚠️ **`range` 는 언제나 유한한 실제 사거리다.** 예전에는 `0` 을 "무제한" 센티널로 썼는데,
 * 그 탓에 기본 무기(`range 0`)가 무한 조준이고 사거리에 1점이라도 투자하면 조준 상한이
 * **좁아지는** 부호 반전이 있었다({@link BASE_WEAPON_RANGE} 주석). 센티널은 폐기됐고
 * 호출자 4곳(주무기·보조무기 3종·포탑)은 모두 유한값을 넘긴다. `range <= 0` 이면 표적을
 * 하나도 고르지 않는다 — 무제한으로 되돌아가지 않는 것이 의도다.
 */
function nearestTarget(state: WorldState, from: Entity, range: number): Entity | undefined {
  const maxD2 = range * range;

  // Fast path: no walls → nearest candidate, nothing to occlude.
  if (state.activeWalls.length === 0) {
    let best: Entity | undefined;
    let bestD = maxD2;
    for (const e of state.entities) {
      if (e.dead) continue;
      if (!isPlayerTargetable(e)) continue;
      const dx = e.x - from.x;
      const dy = e.y - from.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  // Collect in-range candidates, sort by distance (tie-break: entityId ascending
  // so the order never depends on the platform's sort stability), then return
  // the first whose sightline to the player is unobstructed. Only the nearest
  // LOS_MAX_CANDIDATES are ray-tested to bound cost.
  const cands = losCands;
  cands.length = 0; // 재사용 스크래치 리셋(할당 회피).
  for (const e of state.entities) {
    if (e.dead) continue;
    if (!isPlayerTargetable(e)) continue;
    const dx = e.x - from.x;
    const dy = e.y - from.y;
    const d = dx * dx + dy * dy;
    if (d < maxD2) cands.push({ e, d });
  }
  cands.sort((a, b) => (a.d !== b.d ? a.d - b.d : a.e.id - b.e.id));
  const k = cands.length < LOS_MAX_CANDIDATES ? cands.length : LOS_MAX_CANDIDATES;
  for (let i = 0; i < k; i++) {
    const c = cands[i];
    if (c === undefined) continue;
    if (!segmentBlocked(from.x, from.y, c.e.x, c.e.y, state.activeWalls)) return c.e;
  }
  return undefined;
}

/**
 * Advance any active turret pickups (plan F4c): each fires a friendly bullet at
 * its nearest LOS target on its cadence, reusing the vulcan targeting/bullet
 * path, until its lifetime elapses. Deterministic (position/timer only).
 */
function stepTurrets(state: WorldState, _player: Entity): void {
  for (const t of state.entities) {
    if (!isActiveTurret(t) || t.dead) continue;
    if (t.life > 0) t.life--;
    if (t.life === 0) {
      t.dead = true;
      continue;
    }
    if (t.cooldown > 0) {
      t.cooldown--;
      continue;
    }
    const target = nearestTarget(state, t, TURRET_RANGE);
    if (target === undefined) continue;
    const ang = atan2(target.y - t.y, target.x - t.x);
    spawnBullet(
      state,
      t.x,
      t.y,
      ang,
      TURRET_BULLET_SPEED,
      TURRET_BULLET_DAMAGE,
      0,
      TURRET_BULLET_RADIUS,
      TURRET_BULLET_LIFE,
      cos(ang),
      sin(ang),
    );
    t.cooldown = TURRET_FIRE_COOLDOWN;
  }
}

// ---------------------------------------------------------------------------
// Projectiles, gems & supply raiders
// ---------------------------------------------------------------------------

/**
 * Steer a homing missile (weaponType 3) toward the nearest hostile with a capped
 * per-tick turn (MISSILE_TURN_RATE), preserving its speed. Nearest scan ignores
 * walls (missiles curve around), uses only deterministic trig. No target → the
 * missile flies straight (its current heading is unchanged).
 *
 * 성능(리뷰 MED-2 재검토): 이 함수는 미사일마다 전 엔티티를 한 번 훑는다(O(미사일×N)).
 * 브로드페이즈 그리드로 대체하는 방안을 벤치로 검증했으나, ①유도 미사일 수가 대개 한 자리
 * 라 스캔 총량이 작고 ②미사일 단계엔 갓 만든 그리드가 없어 매 틱 전용 그리드를 새로
 * 채워야 하며(O(N) 삽입) ③Map 조회·클로저 호출 상수가 촘촘한 배열 순회보다 커서, 실측상
 * 오히려 40%가량 느려졌다(107→151ms/1500t·200적). 따라서 결정론·단순성을 지키는 이 직접
 * 스캔을 유지한다(전역 최근접·배열 순서 tie-break도 함께 보존).
 */
function homeMissile(state: WorldState, e: Entity): void {
  const speed = length(e.vx, e.vy);
  if (speed === 0) return;
  let best: Entity | undefined;
  let bestD = Infinity;
  for (const t of state.entities) {
    if (t.dead) continue;
    if (!isPlayerTargetable(t)) continue;
    const dx = t.x - e.x;
    const dy = t.y - e.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  if (best === undefined) return;
  const desired = atan2(best.y - e.y, best.x - e.x);
  let delta = wrapAngle(desired - e.angle);
  if (delta > MISSILE_TURN_RATE) delta = MISSILE_TURN_RATE;
  else if (delta < -MISSILE_TURN_RATE) delta = -MISSILE_TURN_RATE;
  e.angle += delta;
  e.vx = cos(e.angle) * speed;
  e.vy = sin(e.angle) * speed;
}

function stepProjectiles(state: WorldState, player: Entity): void {
  // Infinite map: there is no arena edge to despawn against. A projectile dies
  // when its lifetime elapses OR it drifts beyond the player-relative cull
  // radius. Both conditions are checked so a bullet can never accumulate
  // forever off-screen (see tests/projectiles.test.ts).
  const cullR2 = PROJECTILE_CULL_RADIUS * PROJECTILE_CULL_RADIUS;
  // 강제 스크롤(침공 3레이어 또는 PvE 스크롤 모드=Lane3)에서는 화면이 플레이어가 아니라
  // 스크롤 창을 따라가므로, 컬링 기준점도 창 중심이어야 한다(플레이어 기준이면 창 앞쪽에서
  // 대기 중인 탄이 조기 소멸한다). 뱀서류는 창 미존재 → cullX/cullY 가 그대로 player.x/y 라
  // 산술이 바이트 동일하다.
  const scrollWin = state.invasion3 ?? state.scrollRuntime;
  const cullX = scrollWin !== undefined ? windowCenterX(scrollWin) : player.x;
  const cullY = scrollWin !== undefined ? windowCenterY(scrollWin) : player.y;
  const walls = state.activeWalls;
  const wallIndex = state.wallIndex;
  // 촉매 적탄 속도 페널티(≥1): enemy bullets travel faster (single application point so no
  // emitter needs touching). Friendly bullets are unaffected (mult = 1). 무촉매면 1(불변).
  const enemyBulletMult = state.catalystMods.enemyBulletSpeed;
  // 적탄 거동(탄막 다양성 Lane 1): BK_SPLIT 만료 시 방사할 자탄을 모아 루프 뒤 스폰
  // (엔티티 배열 순회 중 push 회피). 거동 없는 적탄(enemyType === BK_NONE)은 no-op.
  const bulletSplits: BulletSplit[] = [];
  for (const e of state.entities) {
    if (e.kind !== 'bullet' && e.kind !== 'enemyBullet') continue;
    // 유도 미사일(제한 선회, OQ-M3-4): 위치 적분 전에 최근접 적으로 각도를 소폭 튼다.
    if (e.kind === 'bullet' && e.ownerId === MISSILE_MARK) homeMissile(state, e);
    // 적탄 거동 갱신(위치 적분 전 vx/vy/angle 재구성). 분열로 소멸하면 이번 틱 스킵.
    if (e.kind === 'enemyBullet' && e.enemyType !== BK_NONE) {
      if (stepEnemyBulletBehavior(e, player, bulletSplits)) continue;
    }
    const m = e.kind === 'enemyBullet' ? enemyBulletMult : 1;
    // 벽 판정용 이동 **전** 좌표. 적 판정이 선분인데 벽 판정만 지점이면 빠른 탄이 벽을 통째로
    // 건너뛰어 **벽 뒤 적을 때린다**(근거·실측은 `sweptCircleOverlapsWall` 주석).
    const preX = e.x;
    const preY = e.y;
    e.x += e.vx * DT * m;
    e.y += e.vy * DT * m;
    if (e.life > 0) e.life--;
    const dx = e.x - cullX;
    const dy = e.y - cullY;
    if (e.life === 0 || dx * dx + dy * dy > cullR2) {
      e.dead = true;
      continue;
    }
    // Both factions' bullets are stopped by walls (activeWalls direct sweep —
    // walls are never in the spatial hash). First overlap kills the bullet.
    // 성능 가드: 이 스윕은 O(투사체 × 활성 벽). 활성 벽은 청크 활성 영역 상한
    // (MAX_ACTIVE_GIMMICKS, 실측 ≤~19벽)에 묶여 있고 탄은 bulletCap(≤~2000)이라
    // 현 스케일에선 안전하다. 활성 벽 수가 이 전제를 크게 넘어서면(예: 벽 밀집
    // 청크·상한 상향) 벽에도 broad-phase(공간 격자/스윕-프룬)가 필요하다.
    // 침공 3레이어는 broad-phase 인덱스로 질의한다(firstBlocking 은 배열 최소 인덱스를 돌려주어
    // 아래 직접 스윕의 first-hit 와 비트 동일 — 결과가 갈릴 여지가 구조적으로 없다).
    // ⚠️ 이 broad-phase 빠른 경로는 벽 파괴를 적용하지 않는다(firstBlocking 은 bool 만 반환) —
    // 탄만 죽이고 벽 hp 는 못 깎는다. 현재 wallIndex 는 **침공 3레이어에서만** non-null 이고
    // blockBreak 는 null 이라 아래 직접 스윕으로 파괴가 정상 동작한다. 훗날 PvE 스크롤 모드에
    // 성능용 wallIndex 를 붙이면 파괴가능 벽이 조용히 불파괴가 되어 모드 클리어 불가가 되므로,
    // 그때는 이 분기에도 벽 피해를 적용해야 한다(firstBlocking 이 벽 참조를 반환하도록 확장).
    if (wallIndex !== null) {
      if (wallIndex.firstBlockingSwept(preX, preY, e.x, e.y, e.radius) !== null) e.dead = true;
      continue;
    }
    for (const w of walls) {
      if (sweptCircleOverlapsWall(preX, preY, e.x, e.y, e.radius, w)) {
        // 블록격파(Lane4): 아군탄(bullet)이 파괴가능 벽(hp>0)에 피해를 주고 hp≤0 이면 벽을
        // 파괴한다(관통 무시 = 밸런스, 첫 겹침에서 탄 소멸). 적탄·hp=0 벽(침공/뱀서류)은
        // isBreakableWall=false → 탄만 소멸(기존 거동·해시 완전 불변). 파괴된 벽은 **의도적으로
        // 젬을 안 준다**(destructible 은 보상 오브젝트라 젬을 주지만, 코스 벽은 통과 장애물이라
        // 무보상 — compact 에 wall 드랍 분기가 없는 것이 이 설계다).
        if (e.kind === 'bullet' && isBreakableWall(w)) {
          w.hp -= e.damage;
          if (w.hp <= 0) w.dead = true;
        }
        e.dead = true;
        break;
      }
    }
  }
  // BK_SPLIT 자탄 방사(퓨즈 만료 위치에서 균등 각도로). 자탄은 거동 없는 순수 직진탄
  // (enemyType 기본 -1)이라 재분열하지 않는다. 세그먼트 탄 상한(bulletCap)을 존중해
  // 폭주를 막는다 — 상한 도달 시 남은 자탄은 버린다(결정론: 배열 순서 고정 소비).
  // 상한 계수는 발사 경로의 enemyBulletCount(틱 시작 재계산)와 달리 countKind(라이브 스캔)를
  // 쓴다 — 이번 틱 dead 표시분까지 세어 과대계상될 수 있으나, 자탄 스폰이 상한보다 보수적으로
  // 나올 뿐이며 결정론에는 무해하다. 부모 탄 소멸분을 즉시 반영하려는 의도적 선택.
  if (bulletSplits.length > 0) {
    let live = countKind(state, 'enemyBullet');
    for (const s of bulletSplits) {
      for (let i = 0; i < s.count; i++) {
        if (live >= state.bulletCap) break;
        const ang = s.baseAngle + (i * TWO_PI) / s.count;
        spawnEnemyBullet(
          state,
          s.x,
          s.y,
          cos(ang) * s.speed,
          sin(ang) * s.speed,
          ang,
          s.damage,
          s.radius,
          70,
        );
        live++;
      }
    }
  }
}

/** Gems drift toward the player once inside the magnet radius (deterministic). */
function stepGems(state: WorldState, player: Entity): void {
  if (state.magnetBuffTicks > 0) state.magnetBuffTicks--;
  // Magnet-emitter buff multiplies the (powerup-grown) base radius transiently.
  const r = state.magnetBuffTicks > 0 ? state.magnetRadius * MAGNET_BUFF_MULT : state.magnetRadius;
  const r2 = r * r;
  for (const e of state.entities) {
    if (e.kind !== 'gem') continue;
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= r2 && d2 > 0.0001) {
      const d = length(dx, dy);
      e.vx = (dx / d) * MAGNET_SPEED;
      e.vy = (dy / d) * MAGNET_SPEED;
    } else {
      e.vx = 0;
      e.vy = 0;
    }
    e.x += e.vx * DT;
    e.y += e.vy * DT;
  }
}

/** Supply raiders cross the player's view; despawn when their window elapses. */
function stepSupply(state: WorldState, player: Entity): void {
  maybeSpawnSupply(state, player);
  // Despawn once the raider has passed a full off-screen span beyond the player
  // (fully crossed the view) or its time window elapses. hp stays > 0, so
  // compaction treats it as an escape (no reward).
  const despawnDist = OFFSCREEN_X + 120;
  for (const e of state.entities) {
    if (e.kind !== 'supply') continue;
    e.x += e.vx * DT;
    if (e.life > 0) e.life--;
    if (e.life === 0 || Math.abs(e.x - player.x) > despawnDist) e.dead = true;
  }
}

function maybeSpawnSupply(state: WorldState, player: Entity): void {
  const nextTick = SUPPLY_SPAWN_TICKS[state.supplyNextIndex];
  if (nextTick === undefined || state.tick < nextTick) return;
  // Infinite map: enter from an off-screen side relative to the player and cross
  // horizontally through the view.
  const fromLeft = state.supplyRng.chance(0.5);
  const y = player.y + state.supplyRng.range(-VIEW_HEIGHT * 0.3, VIEW_HEIGHT * 0.3);
  const x = player.x + (fromLeft ? -OFFSCREEN_X : OFFSCREEN_X);
  const vx = (fromLeft ? 1 : -1) * SUPPLY_SPEED;
  spawnSupply(state, x, y, vx, SUPPLY_HP, SUPPLY_LIFE_TICKS);
  state.supplyNextIndex++;
}

function stepHazards(state: WorldState): void {
  for (const e of state.entities) {
    if (e.kind !== 'hazard') continue;
    if (e.timer > 0) {
      e.timer--; // still telegraphing
    } else if (e.life > 0) {
      e.life--; // active window ticking down
      if (e.life === 0) e.dead = true;
    } else if (e.life < 0) {
      // Permanent terrain hazard (chunk-placed, plan F2): never expires. Its
      // lifetime is bounded only by chunk culling, not by this timer.
    } else {
      e.dead = true; // life === 0: expired
    }
  }
}

function hazardActive(h: Entity): boolean {
  // Damaging once its telegraph (if any) is done and it has not expired. life<0
  // marks a permanent terrain hazard (always active); life>0 a timed window.
  return h.timer <= 0 && h.life !== 0;
}

// ---------------------------------------------------------------------------
// Collision resolution (spatial hash)
// ---------------------------------------------------------------------------

function resolveCollisions(state: WorldState, player: Entity): void {
  // Reuse the per-world grid (cleared, not reallocated) — pure perf, no effect on
  // determinism since the grid is rebuilt from the entity array every tick.
  const grid = state.grid;
  grid.clear();
  // Insert everything the player or friendly bullets can interact with. Walls
  // are intentionally excluded (they can exceed a cell — handled via activeWalls).
  for (const e of state.entities) {
    if (
      e.kind === 'enemy' ||
      e.kind === 'enemyBullet' ||
      e.kind === 'hazard' ||
      e.kind === 'gem' ||
      e.kind === 'supply' ||
      e.kind === 'boss' ||
      e.kind === 'destructible' ||
      e.kind === 'magnetEmitter' ||
      e.kind === 'bombDevice' ||
      e.kind === 'turretPickup' ||
      e.kind === 'loot' ||
      e.kind === 'core' ||
      e.kind === 'decoyCore' ||
      e.kind === 'guardian' ||
      // M7a 3레이어 신규 피격 대상. 격자 등록과 아래 아군탄 표적 화이트리스트는 **항상 같이**
      // 바뀌어야 한다 — 한쪽만 빠지면 설비·보스·기물이 조용히 무적으로 남는다.
      e.kind === 'facilityGun' ||
      e.kind === 'facilityHazard' ||
      e.kind === 'facilitySpawner' ||
      e.kind === 'defenseBoss' ||
      e.kind === 'prop'
    ) {
      grid.insert(e);
    }
  }

  // Friendly bullets vs enemies / boss / supply raiders / destructibles.
  // 유니크 게이트(장착 시에만 분기): ① 과열 드럼(명중 스택), ② 분열 코어(명중 파편),
  // ③ 관통 자이로(무한 관통 + 관통당 피해 증폭). 미장착 시 아래 분기는 전부 no-op.
  const uMask = state.config.loadout?.uniqueMask ?? 0;
  // 코어 모듈 런타임(장착 침공만). undefined 면 아래 모듈 분기는 전부 no-op(거동·해시 불변).
  const cr = state.moduleRuntime;
  const overheatOn = hasUnique(uMask, UQ_OVERHEAT_DRUM);
  const splitOn = hasUnique(uMask, UQ_SPLIT_CORE);
  const gyroOn = hasUnique(uMask, UQ_PIERCE_GYRO);
  // M3 통합 신규 훅: ⑤ 군집 벌통(미사일 격추 시 마이크로탄 방사), ⑥ 수렴 프리즘(빔이
  // 관통한 적 수만큼 피해 증폭). 미장착 시 no-op. ⑤⑥⑦은 모두 주무기 슬롯이라 상호 배타.
  // weaponType 이중 게이트(리뷰 MED-1): 군집 벌통=미사일(3)·수렴 프리즘=빔(4) 전용.
  // roll.ts 페어링이 1차 방어, 여기가 2차 방어 — 비대응 무기엔 no-op(프리즘이 전 무기
  // 관통탄에 새던 결함 차단). 벌통은 트리거가 이미 MISSILE_MARK지만 명시적으로 게이트.
  const weaponType = state.weapon.weaponType;
  const hiveOn = hasUnique(uMask, UQ_HIVE_SWARM) && weaponType === WEAPON_TYPE_MISSILE;
  const prismOn = hasUnique(uMask, UQ_CONVERGE_PRISM) && weaponType === WEAPON_TYPE_BEAM;
  // M3 원소 어픽스(상태이상, plan B4): 명중 시 적에게 화염(지속피해)·냉기(감속)·전격
  // (연쇄)을 건다. 미장착(값 0)이면 아래 분기는 no-op. enemy에만 적용(보스 재활용 필드
  // 충돌 방지).
  const lo = state.config.loadout;
  const fireDmg = lo?.fireDmg ?? 0;
  const coldSlow = lo?.coldSlow ?? 0;
  const lightning = lo?.lightning ?? 0;
  const elementalOn = fireDmg > 0 || coldSlow > 0 || lightning > 0;
  // 분열 파편은 그리드 순회 중 엔티티 배열을 건드리지 않도록 좌표만 모아 루프 뒤 스폰.
  const splitSpawns: { x: number; y: number; angle: number }[] = [];
  // ⑤ 군집 벌통: 미사일 격추 위치를 모아 루프 뒤 방사 스폰(엔티티 배열 순회 중 안전).
  const hiveSpawns: { x: number; y: number }[] = [];
  // ── 한 틱 다중 명중은 **경로 순서**로 해소한다 ─────────────────────────────────
  // 선분 판정을 도입한 뒤 탄 하나가 62유닛 경로 위 여러 표적을 한 틱에 후보로 갖는다. 그런데
  // `grid.query` 는 셀을 고정 `(cy, cx)` 순으로 훑으므로 콜백 순서는 **경로 순서가 아니다**.
  // 정렬 없이 해소하면 ① `pierce === 0` 인 기본 탄이 가까운 적을 지나쳐 먼 적을 때리고(탄이 앞
  // 적을 통과하는 것처럼 보인다), ② 관통 자이로·수렴 프리즘의 관통 증폭타가 공간과 무관한 적에게
  // 간다. 그래서 후보를 진입 매개변수와 함께 모아 오름차순으로 해소한다.
  //
  // 버퍼는 탄마다 새로 만들지 않고 재사용한다 — 틱당 최대 ~2,000발이라 발당 할당은 GC 부담이다.
  // 객체 배열 대신 병렬 배열을 쓰는 이유도 같다.
  const hitTargets: Entity[] = [];
  const hitParams: number[] = [];
  for (const b of state.entities) {
    if (b.kind !== 'bullet' || b.dead) continue;
    // 선분(swept) 판정 — 이 틱의 **이동 경로 전체**를 본다. 이동 후 한 점만 보면 틱당 62 유닛을
    // 나아가는 탄이 37 유닛짜리 히트 창을 건너뛰어, 플레이어에 붙은 적이 자기 탄에 구조적으로
    // 맞지 않는다(근거·실측은 `sweptCircleOverlap` 주석).
    //
    // 이전 좌표는 **속도로 역산**한다 — 엔티티에 prevX/prevY 를 새로 달면 해시 필드가 늘어나기
    // 때문이다(신규 해시 필드 최소화 규율). `stepProjectiles` 가 바로 앞에서 `x += vx*DT` 로
    // 적분했고 아군탄은 적탄 배율(enemyBulletMult)을 타지 않으므로, `x − vx*DT` 는 적분 직전
    // 좌표를 **정확히** 되돌린다(유도 미사일도 각도 갱신이 적분 **이전**이라 같은 등식이 성립).
    // 이 틱에 태어난 탄도 같은 적분을 거치므로 역산 결과가 곧 발사 지점이다 — 점사거리 구멍이
    // 닫히는 지점이 바로 여기다.
    const bPrevX = b.x - b.vx * DT;
    const bPrevY = b.y - b.vy * DT;
    // broad-phase 는 선분 전체를 덮는 원으로 질의한다(중점 + 반길이 + 탄 반경). 좁은 원으로
    // 질의하면 경로 중간 칸의 후보를 못 봐서 선분 판정이 무의미해진다.
    const bMidX = (bPrevX + b.x) / 2;
    const bMidY = (bPrevY + b.y) / 2;
    const bQueryR = length(b.x - bPrevX, b.y - bPrevY) / 2 + b.radius;
    hitTargets.length = 0;
    hitParams.length = 0;
    grid.query(bMidX, bMidY, bQueryR, (t) => {
      if (t.dead) return;
      if (
        t.kind !== 'enemy' &&
        t.kind !== 'boss' &&
        t.kind !== 'supply' &&
        t.kind !== 'destructible' &&
        t.kind !== 'core' &&
        t.kind !== 'decoyCore' &&
        t.kind !== 'guardian' &&
        // M7a 3레이어(위 격자 등록과 쌍).
        t.kind !== 'facilityGun' &&
        t.kind !== 'facilityHazard' &&
        t.kind !== 'facilitySpawner' &&
        t.kind !== 'defenseBoss' &&
        t.kind !== 'prop'
      )
        return;
      const hitT = sweptCircleHitT(bPrevX, bPrevY, b.x, b.y, b.radius, t.x, t.y, t.radius);
      if (hitT === undefined) return;
      // 삽입 정렬로 t 오름차순 유지. 후보는 보통 0~2개라 비용이 사실상 없고, 비교자 콜백 없이
      // 정수 인덱스만 옮기므로 플랫폼 무관하게 같은 순서가 나온다(`Array.sort` 의 구현 재량을
      // 피한다). `>` 비교라 **안정 정렬** — t 동률은 격자 순회 순서를 그대로 보존하고, 그 순서
      // 자체가 결정론적이다(`SpatialHash` 주석).
      let i = hitTargets.length;
      while (i > 0 && (hitParams[i - 1] as number) > hitT) {
        hitTargets[i] = hitTargets[i - 1] as Entity;
        hitParams[i] = hitParams[i - 1] as number;
        i--;
      }
      hitTargets[i] = t;
      hitParams[i] = hitT;
    });
    for (const t of hitTargets) {
      // 앞선 명중으로 탄이 소멸했으면 남은 후보는 보지 않는다(경로 뒤쪽이므로 도달 못 한다).
      if (b.dead) break;
      // 같은 틱에 다른 경로로 죽은 표적(전격 연쇄·앞 후보의 처치 등)은 건너뛴다.
      if (t.dead) continue;
      // 마일스톤 ① 격추 재기동 딜레이(M5): 재기동 중(iframes>0)인 수호 기체는 무적이라 피해를
      // 받지 않고 탄도 소비하지 않는다(다음 표적을 계속 노릴 수 있게 continue). defense.stepGuardians
      // 가 iframes 를 감소시켜 딜레이가 끝나면 다시 피격 가능해진다.
      if (t.kind === 'guardian' && t.iframes > 0) continue;
      // 실드 발생기 국면의 코어(`timer === 1`)는 **탄을 통과시킨다** — 피해도 0, 관통도 소비하지
      // 않는다. `isPlayerTargetable` 이 같은 조건에서 코어를 조준 대상에서 빼는 것과 **쌍**이다:
      // 조준만 빼고 충돌은 남겨 두면 코어가 반지름 90 짜리 **무적 차폐물**이 되어, 정작 부수라고
      // 요구한 발생기(코어 주위 소켓에 놓인다)로 가는 사선을 코어가 막는다. 게다가 판정은 선분
      // 겹침이라 코어 안을 지나는 틱마다 관통이 1 씩 깎여(지름 180u ÷ 탄속 30u/틱 ≈ 6틱) 어떤
      // 현실적인 관통 수치로도 코어를 통과하지 못한다 — 기물 설계 의도('먼저 파괴 강제')가
      // 두 번째로 뒤집히던 지점이다(첫 번째는 위 `isPlayerTargetable` 주석의 조준 누락).
      //
      // 실측(기지 #12 · 96시드 · 참조봇): 패배 37런은 **패배 구간 전 틱(100.0%)** 에서 코어가
      // 플레이어→발생기 사선을 가렸고 발생기 hp 가 1453/1453 그대로였다(승리 런은 61.0%).
      // 이 국면의 코어는 어차피 매 틱 보호막이 전량 재충전돼 순 피해가 0 이므로(updateCoreShield),
      // 통과시켜도 코어가 입는 피해는 바뀌지 않는다. 수동 조준·직접 충돌은 종전대로다.
      if (t.kind === 'core' && t.timer === 1) continue;
      // 추격(Lane6): 무적 포식자(boss.aux0===0)는 아군탄에 무피해다 — 반격 장치를 전부 파괴해
      // 취약화(aux0===1)하기 전까지는 처치할 수 없다(수호 재기동 무적 선례). 탄도 소비하지 않고
      // continue 해 다음 표적을 계속 노릴 수 있게 한다. ⚠️ boss `iframes>0` 은 과열=피해 2배라
      // 무적 재활용이 불가하므로 **aux0 로만** 판정한다. planetMode 게이트라 타 모드는 미진입(불변).
      if (state.config.planetMode === PLANET_MODE.chase && t.kind === 'boss' && t.aux0 === 0)
        continue;
      // Boss takes double damage while overheated (iframes > 0), spec.
      // 방어 보스도 시그니처 캐스트 뒤 과열 창(iframes>0)을 연다 — PvE 보스와 같은 규칙.
      const mult = (t.kind === 'boss' || t.kind === 'defenseBoss') && t.iframes > 0 ? 2 : 1;
      // ③ 관통 자이로: bullet.phase = 지금까지 관통한 횟수 → 관통당 피해 증폭.
      const gyroAmp = gyroOn ? 1 + b.phase * GYRO_DAMAGE_AMP : 1;
      // ⑥ 수렴 프리즘: 빔 세그먼트가 관통한 적 수(phase)만큼 피해 증폭(자이로와 배타).
      const prismAmp = prismOn ? 1 + b.phase * PRISM_DAMAGE_AMP : 1;
      // 보호막의 엘리트: 받는 피해 절반(그 외 1).
      let dealt = b.damage * mult * gyroAmp * prismAmp * eliteDamageTakenMult(t);
      // 코어 모듈 정적 카운터/지구전(피해 감소): **방어체**가 받는 피해를 배율로 낮춘다(실드
      // 흡수 이전 적용). 미장착·미발동이면 defenseDmgMult=1 이라 `dealt*1===dealt`(거동·해시
      // 불변). moduleRuntime 은 침공에만 존재하므로 여기서 'enemy'(편대원·소환 드론)를 포함해도
      // PvE 경로에는 닿지 않는다 — PvE 는 cr===undefined 로 분기 자체가 접힌다.
      if (cr !== undefined && isInvasionDefender(t.kind)) {
        dealt *= cr.defenseDmgMult;
      }
      // 반사(mt-reflection/거울 관문): 실제 코어 피격 시 감소 후 입사 피해의 일부를 공격자에 반사.
      // 실드 흡수 전 입사량 기준(피격 자체에 반응). 미보유면 reflectPct=0 → 반사 없음.
      if (cr !== undefined && t.kind === 'core' && cr.reflectPct > 0 && dealt > 0) {
        player.hp -= (dealt * cr.reflectPct) / 100;
        if (player.hp < 0) player.hp = 0;
        noteDirectPlayerDamage(state, player);
      }
      // 마일스톤 ③ 실드 공유(M5): 코어·포탑에 부여된 실드(targetY)가 남아 있으면 HP 보다 먼저
      // 흡수한다. 실드가 피해를 다 막으면 HP 는 그대로다. 실드가 없으면(targetY<=0) 무영향이라
      // 기존 거동과 완전히 동일하다(하위 호환). 결정론: 모든 항이 동일 f64 연산이라 플랫폼 무관.
      if (t.kind === 'core' && t.targetY > 0) {
        if (t.targetY >= dealt) {
          t.targetY -= dealt;
          dealt = 0;
        } else {
          dealt -= t.targetY;
          t.targetY = 0;
        }
      }
      t.hp -= dealt;
      if (t.hp <= 0) {
        // 마일스톤 ① 격추 재기동(M5): 수호 기체가 부활 충전(phase>0)을 가진 채 HP 0 에 도달하면
        // 죽지 않고 1회 부활한다 — 충전을 소진하고 실효 최대 HP 비율로 회복, 재기동 딜레이(iframes)
        // 동안 무적·정지. 충전이 없으면(phase===0) 일반 격추. 다른 종류는 종전대로 즉시 격추.
        if (t.kind === 'guardian' && t.phase > 0) {
          t.phase--;
          t.hp = rebootHp(t.maxHp);
          t.iframes = REBOOT_DELAY_TICKS;
        } else if (t.kind === 'core' && cr !== undefined && cr.reviveCount > 0) {
          // 유니크 '최후의 재기동': 코어 파괴 직전 1회 부활(실효 최대 HP 비율, 최소 1). 충전을
          // 소진하고 살아남는다 → compact 의 victory 판정을 피한다. 충전 없으면 아래 일반 격파.
          cr.reviveCount--;
          t.hp = Math.max(1, Math.round((t.maxHp * cr.reviveHpPct) / 100));
        } else {
          t.dead = true;
          // 코어 모듈 mt-retribution(응징): 수호 기체가 실제 격추(부활 없이)될 때 공격자에 일제사격
          // 피해. cr 미존재·미보유면 volleyDamage=0 → 무영향.
          if (cr !== undefined && t.kind === 'guardian' && cr.volleyDamage > 0) {
            player.hp -= cr.volleyDamage;
            if (player.hp < 0) player.hp = 0;
            noteDirectPlayerDamage(state, player);
          }
          // ⑤ 군집 벌통: 미사일 원본(MISSILE_MARK)이 적/보스를 격추하면 마이크로탄 방사 예약.
          if (hiveOn && b.ownerId === MISSILE_MARK && (t.kind === 'enemy' || t.kind === 'boss')) {
            hiveSpawns.push({ x: t.x, y: t.y });
          }
        }
      }
      // M3 원소 상태이상(plan B4): 적 명중 시 화염/냉기/전격 부여(장착 시에만).
      if (elementalOn && t.kind === 'enemy') {
        if (fireDmg > 0) applyBurn(t, fireDmg, FIRE_DURATION);
        if (coldSlow > 0) applySlow(t, COLD_DURATION);
        if (lightning > 0) applyChain(state, t, lightning);
      }
      // ① 과열 드럼: 적/보스 명중마다 스택 +1(상한). 피격 시 아래에서 리셋.
      if (overheatOn && (t.kind === 'enemy' || t.kind === 'boss')) {
        if (player.phase < OVERHEAT_MAX_STACK) player.phase++;
      }
      // ② 분열 코어: 원본 아군탄(마커 없는)이 명중하면 파편 2발 예약(무한 연쇄 방지).
      // 좌표는 탄 끝점(b.x, b.y)이 아니라 **맞은 표적**을 쓴다 — 선분 판정이라 명중은 경로
      // 앞부분에서 일어날 수 있고, 끝점을 쓰면 파편이 표적보다 최대 62유닛 앞에서 태어난다.
      if (splitOn && b.ownerId !== SPLIT_FRAGMENT_MARK) {
        splitSpawns.push({ x: t.x, y: t.y, angle: b.angle });
      }
      // 관통 처리: 자이로는 무한 관통(수명으로만 소멸). 프리즘은 관통 카운트를 위해
      // phase를 올리되 세그먼트의 기존 pierce 예산(9999)을 소비 → 짧은 수명으로 소멸.
      // 그 외는 기존 규칙.
      if (gyroOn) {
        b.phase++;
      } else if (prismOn) {
        b.phase++;
        if (b.pierce > 0) b.pierce--;
        else b.dead = true;
      } else if (b.pierce > 0) {
        b.pierce--;
      } else {
        b.dead = true;
      }
    }
  }
  // ② 분열 파편 스폰(진행 방향 ± SPLIT_SPREAD). 파편은 마커를 달아 재분열하지 않는다.
  for (const s of splitSpawns) {
    for (let i = 0; i < SPLIT_FRAGMENTS; i++) {
      const off = SPLIT_FRAGMENTS > 1 ? -SPLIT_SPREAD + (2 * SPLIT_SPREAD * i) / (SPLIT_FRAGMENTS - 1) : 0;
      const ang = s.angle + off;
      const frag = spawnBullet(
        state,
        s.x,
        s.y,
        ang,
        SPLIT_FRAGMENT_SPEED,
        state.weapon.damage,
        0,
        SPLIT_FRAGMENT_RADIUS,
        SPLIT_FRAGMENT_LIFE,
        cos(ang),
        sin(ang),
      );
      frag.ownerId = SPLIT_FRAGMENT_MARK; // 재분열 방지 마커
    }
  }
  // ⑤ 군집 벌통 마이크로 미사일 방사: 격추 위치에서 HIVE_MICRO_COUNT발을 균등 방사.
  //    HIVE_MICRO_MARK를 달아 유도(MISSILE_MARK) 제외 + 재분열 트리거 제외 → 무한 연쇄 방지.
  if (hiveSpawns.length > 0) {
    const microDmg = state.weapon.damage * HIVE_MICRO_DAMAGE_FRAC;
    for (const h of hiveSpawns) {
      for (let i = 0; i < HIVE_MICRO_COUNT; i++) {
        const ang = (TWO_PI * i) / HIVE_MICRO_COUNT;
        const micro = spawnBullet(
          state,
          h.x,
          h.y,
          ang,
          HIVE_MICRO_SPEED,
          microDmg,
          0,
          HIVE_MICRO_RADIUS,
          HIVE_MICRO_LIFE,
          cos(ang),
          sin(ang),
        );
        micro.ownerId = HIVE_MICRO_MARK;
      }
    }
  }

  // Player vs enemies / enemy bullets / hazards / gems / boss.
  //
  // 판정점(ADR-0010): 이로운 픽업(젬·전리품·기믹)은 관대한 기체 반지름으로, 해로운
  // 접촉(적탄·적·해저드·감속 장판)은 훨씬 작은 판정점(PLAYER_HIT_RADIUS)으로 판정한다.
  // 브로드페이즈 검색은 기존대로 기체 반지름(player.radius)으로 훑고(픽업 후보 누락 방지),
  // 좁은 판정은 콜백 안에서 종류별로 나눠 정확 거리 테스트한다.
  let dmg = 0;
  const invulnerable = player.iframes > 0;
  const px = player.x;
  const py = player.y;
  const pickR = player.radius; // 관대한 픽업 반경
  const hitR = PLAYER_HIT_RADIUS; // 좁은 피격 판정점
  grid.query(px, py, pickR, (t) => {
    if (t.dead) return;
    if (t.kind === 'gem') {
      if (circlesOverlap(px, py, pickR, t.x, t.y, t.radius)) collectGem(state, t);
      return;
    }
    // Floor loot: auto-collect on contact (OQ-M2-1 default). Record the drop seed
    // + rarity + provenance for settlement (Lane 2 confirms the item via rollItem).
    if (t.kind === 'loot') {
      if (circlesOverlap(px, py, pickR, t.x, t.y, t.radius)) collectLoot(state, t);
      return;
    }
    // Proximity event objects fire on contact (deterministic, no input). Consumed
    // objects are marked dead; a picked-up turret converts in place (stays alive).
    if (t.kind === 'magnetEmitter') {
      if (circlesOverlap(px, py, pickR, t.x, t.y, t.radius)) {
        triggerMagnetEmitter(state);
        t.dead = true;
      }
      return;
    }
    if (t.kind === 'bombDevice') {
      if (circlesOverlap(px, py, pickR, t.x, t.y, t.radius)) {
        triggerBombDevice(state, t.x, t.y);
        t.dead = true;
      }
      return;
    }
    if (t.kind === 'turretPickup') {
      if (t.phase === 0 && circlesOverlap(px, py, pickR, t.x, t.y, t.radius)) activateTurret(t);
      return;
    }
    // 이하 해로운 접촉: 판정점(hitR)으로만 판정 — 기체를 스쳐도 판정점에 안 닿으면 무해.
    if (!circlesOverlap(px, py, hitR, t.x, t.y, t.radius)) return;
    // 추격(Lane6): 무적 포식자(boss.aux0===0) 접촉 = 회피 불가 죽음. iframes(무적 프레임)를
    // 무시하고 즉시 실패다 — 포식자는 피격 무적으로 흘려보낼 수 없다. 취약화(aux0===1) 후엔
    // 아래 일반 접촉 피해(보스전)로 떨어진다. planetMode 게이트라 타 모드는 미진입(불변).
    if (state.config.planetMode === PLANET_MODE.chase && t.kind === 'boss' && t.aux0 === 0) {
      state.gameOver = true;
      return;
    }
    // 감속 지대(plan B1): 활성 HAZARD_SLOW 장판에 닿으면 감속 부여(무적 여부와 무관 —
    // 이동 디버프이지 피해가 아니다). 소량 피해는 아래 일반 hazard 분기가 처리한다.
    if (t.kind === 'hazard' && t.enemyType === HAZARD_SLOW && hazardActive(t)) {
      // `aux0` 는 침공 **효용 해저드**(피해 0 · 견인 자기장)가 실어 보내는 감속 지속 틱이다 —
      // 그 설비는 피해가 0 이라 강화 3축(레벨·등급·승급)을 실을 자리가 damage 에 없어서, 축을
      // 감속 지속에 태운다(`src/sim/invasion/facility.ts` `utilityHazardSlowTicks`).
      // 다른 모든 `HAZARD_SLOW` 생산자는 `aux0` 를 건드리지 않아 0 → 기본값 그대로다(비트 동일).
      state.playerSlowTicks = t.aux0 > 0 ? t.aux0 : PLAYER_SLOW_DURATION;
    }
    if (invulnerable) return;
    if (t.kind === 'enemyBullet') {
      if (t.damage > dmg) dmg = t.damage;
      t.dead = true;
      // 'prop'(L3 기물)은 여기 넣지 않는다 — 기물의 damage 는 탄·장판 피해라 접촉 피해로
      // 겸용하면 코어방에 들어서기만 해도 플레이어가 갈린다.
    } else if (
      t.kind === 'enemy' ||
      t.kind === 'boss' ||
      t.kind === 'guardian' ||
      t.kind === 'defenseBoss'
    ) {
      // 수호 기체(M5)는 추적형 요격 유닛 — 접촉(램) 피해를 준다(방어전에만 존재). 단 마일스톤 ①
      // 격추 재기동 딜레이 중(iframes>0)인 수호는 정지·무력 상태라 접촉 피해도 주지 않는다.
      if (t.kind === 'guardian' && t.iframes > 0) return;
      if (t.damage > dmg) dmg = t.damage;
    } else if (t.kind === 'hazard' && hazardActive(t)) {
      if (t.damage > dmg) dmg = t.damage;
    }
    // Supply raiders never harm the player (they do not attack).
  });
  if (dmg > 0 && !invulnerable) {
    // 브루저 시그니처 — 장갑 스택 피해 감소(설계서 §3·§4). **생존 캡스톤 판정보다 먼저** 적용해
    // "치명타 1회 무효" 가 감소된 피해로 치사 여부를 판정하게 한다(장갑이 살려낸 피격까지
    // 캡스톤을 소진시키지 않는다). 미보유면 armorOn=false 로 한 줄도 실행되지 않는다.
    // ⚠️ 산술은 shipSignature.ts 의 `armorReducedDamage` 와 동형(합산 bp · 단일 나눗셈)이되
    // 그 함수의 `Math.trunc` 만 뺐다 — 접촉 피해에는 엘리트 배율이 섞여 소수가 될 수 있고,
    // trunc 는 스택 0(bp=0)일 때조차 소수부를 지워 **무스택 피해까지 바꾼다.** 정수 피해에
    // 대해 두 경로가 같은 값임은 tests/weapons.test.ts 가 못 박는다.
    const armorOn = signatureOn(state, SIG_BRUISER_ARMOR);
    if (armorOn) {
      const bp = clampArmorStacks(player.aux0) * ARMOR_PER_STACK_BP;
      if (bp > 0) dmg -= Math.round((dmg * bp) / 10000);
    }
    // 버블 시그니처 — 방막 흡수(설계서 §3·§4). 막은 선체 **바깥** 층이므로 브루저 장갑 감소
    // **뒤** · 완충 지연 전환과 생존 캡스톤 판정 **앞**이다.
    //  · 완충보다 먼저인 이유: 지연 전환이 먼저면 애초에 막이 다 막아 낼 피해가 지연분으로
    //    적립돼 **막을 통과하지 않은 피해가 나중에 선체로 들어온다.** 두 시그니처는 한 런에
    //    공존할 수 없지만(§ 슬롯 배정), 순서를 코드로 못 박아 훗날 합성될 때 논쟁이 없게 한다.
    //  · 캡스톤보다 먼저인 이유: 장갑·완충과 같은 논증 — 캡스톤은 `hp - dmg <= 0` 으로 치사를
    //    보므로, 막이 살려 낸 피격까지 "치명타 1회 무효" 를 소진시키면 안 된다.
    // ⚠️ `Math.round(dmg)` 는 반드시 이 게이트 **안**이다(브루저·말로우 주석과 같은 함정):
    //    밖으로 빼면 시그니처 없는 런의 소수 접촉 피해(엘리트 배율)까지 바뀐다. 게이트 안에서
    //    먼저 정수화하는 이유는 aux0(막 내구)이 u32 로 해시되기 때문이다 — 소수를 깎으면
    //    소수부가 조용히 잘려 클라와 서버 재실행이 갈린다.
    // 무적(iframes) 중에는 위 수집 루프가 피해를 아예 누적하지 않으므로(2280행 조기 반환)
    // 막 내구도 소모되지 않는다 — 무적은 이미 완전 방어라 막을 함께 태우면 이중 손실이다.
    if (signatureOn(state, SIG_BUBBLE_FILM) && player.aux0 > 0) {
      dmg = Math.round(dmg);
      const absorbed = filmAbsorbed(dmg, player.aux0);
      // 남는 피해는 순수 함수로 받는다(= dmg - absorbed). 두 값의 합이 원래 피해와 같다는
      // 계약(shipSignature.ts ⑥절)을 world 배선이 재구현하지 않고 그대로 상속한다.
      const rest = filmRemainingDamage(dmg, player.aux0);
      player.aux0 -= absorbed;
      dmg = rest;
      // 막이 이번 피격으로 **소진된 순간**이 파열이다. "피격 시 항상 터진다" 를 택하지 않은
      // 이유: 그러면 내구(FILM_ABSORB_FLAT)가 사실상 무의미해지고 막이 한 대만 막는 유틸이
      // 된다. 소진 조건이라야 "흡수량을 다 쓰면 터진다" 는 축이 성립한다. 재생 타이머(aux1)는
      // 이 틱부터 0 에서 다시 돈다(stepShipSignature 의 aux0 === 0 게이트).
      if (player.aux0 === 0) {
        // 사연 관측(비-해시): 막이 이번 피격으로 소진돼 파열한 이 지점에서만 센다. 결정론
        // 무영향 — hashWorld 가 접지 않는 순수 메타.
        state.filmPops++;
        burstFilm(state, player);
      }
      // ⚠️ 막이 전량 흡수했으면 **여기서 함수를 빠져나간다** — 다만 무적 창은 세우고 나간다.
      //    · 나머지 피격 후속(과열 스택 리셋·반응 장갑 펄스·위상 전환막·캡스톤 소진·장갑 적립)은
      //      건너뛴다: 피해가 0 이므로 "맞지 않은 것" 으로 취급하는 편이 일관적이고, 플레이어가
      //      공짜로 강해지는 방향의 조용한 오류를 만들지 않는다.
      //    · 반면 `iframes` 를 세우지 않으면 **막이 피격당 1대가 아니라 틱당 1대로 증발한다**
      //      (적대적 리뷰 MED-3/invariants-2). 접촉 피해가 이어지는 무대에서 실측 막 수명이
      //      25틱·22틱으로 무적 창(hitIframes=40틱)보다 짧았다 — 막이 없었다면 그 구간에 들어올
      //      피해가 정확히 1회인데, 막은 그 1회를 막느라 내구 60 을 전량 태웠다. 재생 주기가
      //      420틱이라 "주기적 흡수막" 이라는 축이 사실상 1회 접촉분으로 붕괴한다.
      //    무적을 세우는 것이 정당한 이유: 막은 선체 바깥 층이고 **이 피격은 실제로 막혔다.**
      //    무적 창은 "방금 한 대 처리했다" 는 표식이지 "선체가 깎였다" 는 표식이 아니다.
      if (dmg <= 0) {
        player.iframes = state.config.hitIframes;
        return;
      }
    }
    // 말로우 시그니처 — 완충 지연 전환(설계서 §3·§4). 이번 피격 피해의 CUSHION_DEFER_BP 만큼을
    // 지금 넣지 않고 떼어 둔다. **적립(aux0 += deferred)은 여기서 하지 않고 아래 hp 차감 분기
    // 안에서만** 한다 — 근거는 그쪽 주석.
    // 브루저 감소 **뒤** · 생존 캡스톤 판정 **앞**인 이유는 장갑과 완전히 같은 논증이다
    // (위 2252-2254 주석): 캡스톤은 `hp - dmg <= 0` 으로 치사 여부를 보므로, 완충이 살려 낸
    // 피격까지 캡스톤을 소진시키지 않으려면 감액이 먼저여야 한다.
    // ⚠️ `Math.round(dmg)` 는 **반드시 이 게이트 안**에 둔다 — 밖으로 빼면 시그니처 없는 런의
    //    소수 접촉 피해(엘리트 배율)까지 바뀐다. 게이트 안에서 먼저 정수화하는 이유는 aux0 이
    //    u32 로 해시되기 때문이다(replay.ts hashEntity 의 `>>> 0`): 소수를 적립하면 소수부가
    //    조용히 잘려 클라와 서버 재실행이 갈린다. 정수화 뒤에 나누면 "즉시분 + 지연분 = 원래
    //    피해" 라는 순수 함수 계약(cushionImmediateDamage)도 world 배선에서 그대로 보존된다.
    const cushionOn = signatureOn(state, SIG_MALLOW_CUSHION);
    let deferred = 0;
    if (cushionOn) {
      dmg = Math.round(dmg);
      deferred = cushionDeferredDamage(dmg);
      dmg -= deferred;
    }
    // 생존 캡스톤 — 치명타 1회 무효(GDD §4): 이 피격이 치명적(hp가 0 이하로 떨어짐)이고 아직
    // 미소진(player.targetX===0)이면 피해를 전부 무효화하고 짧은 무적(CRIT_NEGATE_IFRAMES)을
    // 준다. 소진 표식은 player.targetX(플레이어 미사용 필드, 이미 해시됨)에 1로 실어 런당 1회로
    // 제한한다 — createWorld가 매 런 targetX=0으로 시작하므로 리셋이 자명하다. 무효 시 피격
    // 후속(과열 리셋·반응 장갑·위상 전환막)은 모두 건너뛴다(없던 피격처럼 취급).
    if (hasCapstone(uMask, CAP_SURVIVAL_CRIT) && player.targetX === 0 && player.hp - dmg <= 0) {
      player.targetX = 1;
      player.iframes = CRIT_NEGATE_IFRAMES;
    } else {
    // 사연 관측(비-해시): 실제로 선체 피해를 입은 이 지점에서만 센다(막 전량 흡수·캡스톤 무효
    // = "없던 피격"은 여기 도달하지 않는다). iframes 부여 직전 · 전 기체 집계(storyUnlock 은
    // 브루저 사연만 이 metric 을 보지만 카운트는 기체 무관). 결정론 무영향 — hashWorld 미접.
    state.hitsTaken++;
    player.hp -= dmg;
    if (player.hp < 0) player.hp = 0;
    player.iframes = state.config.hitIframes;
    // 브루저 시그니처 — 실제로 피해를 입은 이번 피격으로 장갑 1스택 적립 + 소멸 타이머 리셋.
    // (캡스톤 무효 분기는 "없던 피격"이라 여기 도달하지 않는다 = 스택도 쌓이지 않는다.)
    if (armorOn) {
      player.aux0 = clampArmorStacks(player.aux0 + 1);
      player.aux1 = 0;
    }
    // 말로우 시그니처 — 실제로 피해를 입은 이번 피격에서만 지연분을 적립하고 무피격 스트릭을
    // 리셋한다. 적립을 위쪽 감액 지점에 두면 **캡스톤이 무효화한 "없던 피격"에서 지연 피해가
    // 태어나** 몇 초 뒤 플레이어를 죽인다(사인이 캡스톤으로 보이지 않아 추적이 어렵다).
    // deferred 는 위 게이트에서 정수화한 dmg 에서 나오므로 항상 비음 정수다 — aux0 의 u32
    // 규율(replay.ts hashEntity)이 여기서 지켜진다.
    if (cushionOn) {
      player.aux1 = 0;
      player.aux0 += deferred;
    }
    // 팬텀 시그니처 — 실제로 피해를 입은 이번 피격에서만 무피격 스트릭과 해제 표식을 리셋한다.
    // **반드시 이 분기 안**이어야 한다: 생존 캡스톤이 무효화한 피격은 "없던 피격"(위 주석)이라
    // 거기서 리셋하면 맞지도 않은 타격이 은신을 깨서 은신이 사실상 발동하지 않게 되고, 반대로
    // 리셋을 아예 빼면 **맞아도 은신이 유지**된다. 둘 다 화면상으로는 조용하다.
    if (signatureOn(state, SIG_PHANTOM_CLOAK)) {
      player.aux0 = 0;
      player.aux1 = 0;
    }
    // ① 과열 드럼: 피격 시 연속 명중 스택 리셋(장착 시에만 phase가 비0).
    if (overheatOn) player.phase = 0;
    // ⑨ 반응 장갑(plan B4): 피격 시 방사형 반격 펄스(아군탄) 방출.
    if (hasUnique(uMask, UQ_REACTIVE_ARMOR)) {
      for (let i = 0; i < REACTIVE_PULSE_COUNT; i++) {
        const ang = (i * TWO_PI) / REACTIVE_PULSE_COUNT;
        spawnBullet(
          state,
          player.x,
          player.y,
          ang,
          REACTIVE_PULSE_SPEED,
          REACTIVE_PULSE_DAMAGE,
          0,
          REACTIVE_PULSE_RADIUS,
          REACTIVE_PULSE_LIFE,
          cos(ang),
          sin(ang),
        );
      }
    }
    // ⑩ 위상 전환막(plan B4): 저체력 진입 + 내부 쿨다운 준비 시 광역 폭발(적탄 소거) +
    // 최대 체력 절반 회복. targetY에 쿨다운을 실어 재발동을 막는다.
    if (
      hasUnique(uMask, UQ_PHASE_MEMBRANE) &&
      player.targetY === 0 &&
      player.hp > 0 &&
      player.hp <= player.maxHp * PHASE_MEMBRANE_HP_FRAC
    ) {
      for (const t of state.entities) if (t.kind === 'enemyBullet') t.dead = true;
      player.hp = Math.min(player.maxHp, player.hp + Math.round(player.maxHp * PHASE_MEMBRANE_HEAL_FRAC));
      player.targetY = PHASE_MEMBRANE_COOLDOWN;
    }
    }
  }
}

/** Collect a gem: bump the combo, award XP scaled by combo × loadout XP mult. */
function collectGem(state: WorldState, gem: Entity): void {
  gem.dead = true;
  state.gems++;
  state.combo++;
  state.comboTimer = COMBO_WINDOW_TICKS;
  if (state.combo > state.maxCombo) state.maxCombo = state.combo;
  const mask = state.config.loadout?.uniqueMask ?? 0;
  // ⑫ 탐욕의 심장(plan B4): 젬 획득마다 콤보 지속을 연장하고 자석 반경을 상한까지 스택.
  if (hasUnique(mask, UQ_GREED_HEART)) {
    state.comboTimer += GREED_COMBO_BONUS_TICKS;
    state.magnetRadius = Math.min(GREED_MAGNET_CAP, state.magnetRadius + GREED_MAGNET_STEP);
  }
  const baseXp = gem.damage; // gem carries its XP value in `damage`
  const xpMult = state.config.loadout?.xpMult ?? 1; // affix 경험치+%
  // 촉매 경험치 보상축(≥1)을 함께 곱한다(무촉매면 1 → 불변). loadout affix 와는 별개 인자.
  let gained = Math.floor(baseXp * comboMultiplier(state.combo) * xpMult * state.catalystMods.xp);
  // ⑭ 유물 증폭기(plan B4): 경험치 소폭↑(광물·유니크 드랍률은 정산 메타에서 처리).
  if (hasUnique(mask, UQ_RELIC_AMP)) gained = Math.floor(gained * RELIC_XP_MULT);
  // 경험치 이원화(ADR-0036): 같은 젬이 두 풀에 **서로 다른 값**을 넣는다.
  //  · 런 풀(state.xp)   = 단계 무관 고정 → 런 내 리듬이 단계에 흔들리지 않는다.
  //  · 메타 풀(state.xpTotal) = 단계 비례 → 고단계일수록 기체 레벨이 빨리 오른다.
  state.xp += gained;
  // 행성 인기 XP 배율(ADR-0038)은 **메타 풀에만** 곱한다. 런 풀(state.xp)은 ADR-0036 이 "단계
  // 무관 고정 → 런 내 리듬이 외부 축에 흔들리지 않는다"로 정의한 축이라, 플레이어가 고르지 않은
  // 앰비언트 배율이 레벨업 리듬을 ±20% 흔드는 것은 그 정의를 깬다. 촉매 xp 축이 두 풀에 다 걸리는
  // 것과의 차이는 **능동 소비 여부**다(촉매는 플레이어가 넣은 것, 인기 배율은 전체 통계 파생).
  // 중립(planetMult === 1)이면 곱셈이 정확히 무연산 → 기존 골든 바이트 불변.
  state.xpTotal += gained * stageMetaXpMult(state.config.stage) * state.planetMult;
}

/** Collect a loot drop: record its seed + rarity + provenance for settlement. */
function collectLoot(state: WorldState, loot: Entity): void {
  loot.dead = true;
  state.loot.push({
    seed: loot.damage >>> 0, // drop seed stored in `damage`
    rarity: loot.enemyType, // rarity code stored in `enemyType`
    planet: state.config.planet ?? 0,
    stage: state.config.stage ?? 1,
    // 바닥에서 주운 전리품은 전부 엘리트 유래다(`spawnLoot` 호출부가 엘리트 드랍 하나뿐).
    // 보스 확정 드랍은 승리 tick 이라 바닥을 거치지 않고 `state.loot` 에 직접 들어간다.
    elite: 1,
  });
}

// ---------------------------------------------------------------------------
// Dead-entity compaction (order-preserving; player stays at index 0).
// ---------------------------------------------------------------------------

/**
 * 구간(또는 런) 종료 판정 **단일 정본** — 계약 §5 의 3분기가 여기 한 곳에만 산다.
 *
 * | 분기 | 조건 | 결과 |
 * |---|---|---|
 * | ① 중간 구간 종료 | `cleared` 또는 `escaped`, `segmentIndex < length-1` | `segmentDone = 1` |
 * | ② 마지막 구간 완수 | `cleared`, `segmentIndex === length-1` | `victory = true` |
 * | ③ 마지막 구간 실패 | `escaped`, `segmentIndex === length-1` | **`gameOver = true`** |
 *
 * ⚠️ **③ 을 ② 로 떨어뜨리면 의뢰 실패가 성공으로 판정된다.** ADR-0046 이 위조 가치 최고로 지목한
 * 확정 유니크 지급 경로에서 벌어지는 오판이라, 전용 테스트 3건이 이 표를 못 박고 있다.
 *
 * ⚠️ **`escaped` 호출부는 아직 없다**(현상금 표적 도주는 Phase D/F 소관). 그럼에도 지금 분기를
 * 세우는 이유는, 나중에 도주를 배선할 때 "어디에 무엇을 세울 것인가"를 다시 결정하게 두면 이
 * 저장소가 반복해서 당한 실패 모드(③을 ②로 떨어뜨림)가 그 시점에 열리기 때문이다. 계약과
 * 테스트를 먼저 굳혀 둔다.
 *
 * @param outcome `'cleared'` = 표적 처치(보스 격파) · `'escaped'` = 표적 도주(실패)
 */
export function endCommissionSegment(state: WorldState, outcome: 'cleared' | 'escaped'): void {
  const cm = state.config.commission;
  if (cm === undefined) {
    // 무의뢰 런: 보스 격파 = 즉시 승리(기존 거동과 바이트 동일). 도주 개념이 없다.
    if (outcome === 'cleared') state.victory = true;
    return;
  }
  const isLast = cm.segmentIndex >= cm.segments.length - 1;
  if (!isLast) {
    // ① 중간 구간. `victory`/`gameOver` 를 세우지 않는다 — 세우면 `stepWorld` 첫 줄 가드에
    //    걸려 런이 그 자리에서 끝난다. 전환은 루프 층(`stepRun`)이 이 신호를 보고 한다.
    if (state.commissionRuntime !== undefined) state.commissionRuntime.segmentDone = 1;
    return;
  }
  if (outcome === 'cleared') state.victory = true;
  else state.gameOver = true;
}

function compact(state: WorldState): void {
  const survivors: Entity[] = [];
  const drops: { x: number; y: number; xp: number }[] = [];
  const supplyDrops: { x: number; y: number }[] = [];
  // Loot drops (elite/boss) + split-elite death fragments, spawned AFTER the
  // survivor array is rebuilt so we never mutate `state.entities` mid-iteration.
  const lootDrops: { x: number; y: number; seed: number; rarity: number }[] = [];
  const splitElites: Entity[] = [];
  const stage = state.config.stage ?? 1;
  const planet = state.config.planet ?? 0;
  // 이 compact에서 보스가 죽어 승리가 확정됐는지. 승리 tick에는 다음 stepWorld가
  // 즉시 return(gameOver/victory 가드)하므로 collectLoot(resolveCollisions 내부)가
  // 다시 실행되지 않는다 → 이 tick에 바닥 스폰된 loot는 영영 수거되지 않아 유실된다.
  let bossKilled = false;
  // 사연 관측(비-해시): 이번 틱 과충전(bp>0)이 활성인가 — 아크캐스터 시그니처 런에서만 참이다.
  // player.aux0 은 stepShipSignature 가 이번 틱에 갱신한 정지 틱이고 autoAttack 이후 불변이라
  // "이번 틱 과충전 발사" 와 정확히 같은 판정이다. sigBit 게이트로 다른 기체의 aux0(장갑 스택·
  // 은신 틱 등)을 과충전으로 오독하지 않는다. 결정론 무영향 — hashWorld 가 접지 않는 순수 메타.
  const p0 = state.entities[0];
  const ocKill =
    p0 !== undefined && state.sigBit === SIG_ARC_OVERCHARGE && overchargeBp(p0.aux0) > 0;
  // 행성별 드랍 테이블(rarity 기준 확률)을 엘리트/보스 드랍 판정에 넘긴다(E3).
  const dropOdds = planetContent(state.config.planet).dropTable;
  for (const e of state.entities) {
    if (!e.dead) {
      survivors.push(e);
      continue;
    }
    // 처치 집계는 `hp<=0`(실제 격추)로 게이트한다 — supply(아래 "vs. escaped")·destructible
    // ("vs. culled")과 동일 규율. 기존 전 사망 경로(탄 명중·화염 DoT·전격·폭탄 기물)는 항상
    // hp<=0 에서 dead 가 되므로 이 게이트는 그들에게 무연산(뱀서류·침공 바이트 불변)이다.
    // 강제 스크롤 컬링(cullScrollEnemies, Lane4)만 hp>0 인 적을 dead 로 표시하는데, 그건 도망쳐
    // 창 뒤로 빠진 적이라 처치가 아니다 — 공짜 처치·젬·엘리트 루팅을 여기서 정확히 배제한다.
    if (e.kind === 'enemy' && e.hp <= 0) {
      state.kills++;
      if (ocKill) state.overchargeKills++; // 사연 관측(비-해시): 과충전 활성 중 처치.
      const def = enemyDefFor(e);
      drops.push({ x: e.x, y: e.y, xp: def?.xpValue ?? 1 });
      // Elites are the only rank-and-file loot source (GDD §3); a 분열하는 elite
      // additionally bursts fragments on death (B4).
      if (isElite(e)) {
        // 엘리트 드랍은 **확정이 아니라 확률**이다(ADR-0035). eliteDropChance 가 eliteCount 에
        // 반비례해 런당 기대 수량을 고정하므로, 적 곡선 레인이 eliteCount 를 움직여도 인벤
        // 유입은 그대로다. 게이트 실패면 등급 롤 자체를 하지 않는다(드랍이 없으면 등급도 없다).
        // 행성 인기 수량 배율(ADR-0038)은 이 **게이트 확률**에만 곱한다 — 등급 롤(rollEliteDrop)
        // 은 품질 축이라 절대 건드리지 않는다(ADR-0022 "품질은 전 행성 동일"). RNG 소비 횟수는
        // 배율과 무관하게 1회 고정이라 드랍 스트림이 밀리지 않는다.
        if (rollEliteDropGate(state.dropRng, stageParams(stage).eliteCount, state.planetMult)) {
          // 촉매 희귀도 보상축을 드랍 롤에 곱한다(무촉매 rarity===1 → 등급 threshold 불변).
          const roll = rollEliteDrop(state.dropRng, stage, state.catalystMods.rarity, dropOdds);
          lootDrops.push({ x: e.x, y: e.y, seed: roll.seed, rarity: roll.rarityCode });
          // 촉매 드랍량 보상축: 배율 > 1 이면 같은 등급의 추가 루팅을 결정론적으로 파생한다
          // (dropRng 미소비 → 드랍 스트림 무영향). 무촉매면 빈 배열이라 무연산.
          for (const bs of bonusLootSeeds(roll.seed, state.catalystMods.drop)) {
            lootDrops.push({ x: e.x, y: e.y, seed: bs, rarity: roll.rarityCode });
          }
        }
        // 분열하는·폭발성의 엘리트는 사망 시 방사 폭발을 남긴다(spawnEliteDeathFx).
        // 드랍 게이트와 무관 — 어픽스 연출은 전리품 축이 아니다.
        const ea = eliteAffix(e);
        if (ea === ELITE_SPLIT || ea === ELITE_VOLATILE) splitElites.push(e);
      }
    } else if (e.kind === 'supply' && e.hp <= 0) {
      // Shot down (vs. escaped with hp > 0): grant the raid reward. 촉매 자원 보상축(≥1)을
      // milli 캐리로 반영한다 — 무촉매(배율 1)면 매번 +1000 → +1 자원으로 구 `resources++` 와
      // 바이트 동일. 배율>1 이면 소수분이 누적돼 여러 습격에 걸쳐 추가 자원으로 승격된다.
      // 행성 인기 자원 배율(ADR-0038)도 같은 milli 캐리에 함께 실린다 — 두 배율은 그냥 곱이다
      // (상한 캡 없음). 중립(planetMult === 1)이면 곱셈이 정확히 무연산이라 구 경로와 바이트 동일.
      state.catalystResourceMilli += Math.round(
        state.catalystMods.resource * 1000 * state.planetMult,
      );
      const whole = Math.floor(state.catalystResourceMilli / 1000);
      state.resources += whole;
      state.catalystResourceMilli -= whole * 1000;
      supplyDrops.push({ x: e.x, y: e.y });
    } else if (e.kind === 'destructible' && e.hp <= 0) {
      // Broken (vs. culled with hp > 0): drop a gem worth its stored XP value.
      drops.push({ x: e.x, y: e.y, xp: e.damage });
    } else if (e.kind === 'core') {
      // 침공 승리(M4 plan C2): 코어 파괴 = 침공 성공. 보스와 달리 드랍은 없다(침공 보상은
      // 래더 스왑·복제 약탈로 서버가 처리 — Phase D). 승리 확정만 세운다.
      //
      // 3레이어(M7a): **L3 에서만** 승리가 선다. L1/L2 에 코어 kind 가 등장하면(기만 홀로그램·
      // 잔재) victory 가 서고 stepWorld 첫 줄 가드에 걸려 런이 그 자리에서 죽기 때문이다.
      // 구 침공·PvE 는 invasion3 미존재 → 조건이 항상 참이라 거동 불변.
      if (state.config.invasion3 === undefined || state.invasion3?.phase === PHASE_L3) {
        state.victory = true;
      }
    } else if (e.kind === 'boss' && state.config.invasion3 === undefined) {
      // 3레이어 침공에서는 보스 격파가 승리 조건이 아니다(승리 = L3 코어 파괴). 방어 보스는
      // 전용 kind 를 쓰는 것이 정본이지만, 'boss' 가 섞여 들어와도 런이 조기 종료되지 않도록
      // 여기서 막는다. PvE·구 침공은 조건이 항상 참이라 거동·해시 불변.
      // 의뢰 런은 여기서 3분기로 갈린다(계약 §5) — 중간 구간이면 승리가 아니라 **구간 종료**다.
      // 무의뢰 런은 `endCommissionSegment` 가 `state.victory = true` 한 줄로 떨어진다(거동 불변).
      endCommissionSegment(state, 'cleared');
      bossKilled = true;
      // Boss guaranteed rare+ drop (GDD §3, plan B3). 승리 tick이라 바닥 스폰→접촉 수거가
      // 불가능하므로 state.loot에 직접 기록해 정산에 포함시킨다(해시 포함, replay.ts).
      // 촉매 희귀도 배율을 드랍 롤에 곱하고(무촉매 1 → 불변), 드랍량 배율로 추가 루팅을 파생한다.
      const roll = rollBossDrop(state.dropRng, stage, state.catalystMods.rarity, dropOdds);
      state.loot.push({ seed: roll.seed >>> 0, rarity: roll.rarityCode, planet, stage });
      for (const bs of bonusLootSeeds(roll.seed, state.catalystMods.drop)) {
        state.loot.push({ seed: bs >>> 0, rarity: roll.rarityCode, planet, stage });
      }
    }
  }
  state.entities = survivors;
  for (const d of drops) spawnGem(state, d.x, d.y, d.xp);
  if (bossKilled) {
    // 보스와 같은 tick에 죽은 엘리트 loot도 승리 tick이라 바닥에서 수거될 수 없다.
    // 보스 드랍과 동일하게 state.loot에 직접 기록해 유실을 막는다(결정론: 배열 순서 고정).
    for (const d of lootDrops) {
      // 엘리트 유래 표식(ADR-0038) — 바닥을 못 거쳤을 뿐 출처는 엘리트다.
      state.loot.push({ seed: d.seed >>> 0, rarity: d.rarity, planet, stage, elite: 1 });
    }
  } else {
    for (const d of lootDrops) spawnLoot(state, d.x, d.y, d.seed, d.rarity);
  }
  for (const e of splitElites) spawnEliteDeathFx(state, e);
  for (const d of supplyDrops) {
    for (let i = 0; i < SUPPLY_REWARD_GEMS; i++) {
      const ang = (i * 6.283185307179586) / SUPPLY_REWARD_GEMS;
      spawnGem(state, d.x + cos(ang) * 40, d.y + sin(ang) * 40, SUPPLY_GEM_XP);
    }
  }
}

// ---------------------------------------------------------------------------
// Progression bookkeeping
// ---------------------------------------------------------------------------

function updateCombo(state: WorldState): void {
  if (state.comboTimer > 0) {
    state.comboTimer--;
    if (state.comboTimer === 0) state.combo = 0;
  }
}

/** Level up when XP crosses the threshold; opens the powerup pick (one level). */
function checkLevelUp(state: WorldState): void {
  if (state.pendingLevelUp) return;
  // 런 풀 커브는 런 구조에 따라 갈린다(2026-07-27) — PvE 는 처치 볼륨 240 기준 `10+66L`,
  // 침공(3레이어 단판)은 `10+6L`. 판정은 `stepWorld` 의 `designedRun` 과 **같은 술어**를 쓴다
  // (`invasion3` 유무). 근거는 `xpToNextInvasion` 주석.
  const need =
    state.config.invasion3 === undefined
      ? xpToNext(state.level)
      : xpToNextInvasion(state.level);
  if (state.xp < need) return;
  state.xp -= need;
  state.level++;
  // ⑬ 도박사의 칩: 파워업 선택지 +GAMBLER_EXTRA_CHOICES(로드아웃 고정 → 결정론적).
  //    선택 입력 프레임은 2비트(0~3)라 4번째 선택지까지 와이어 호환(stepWorld).
  const gambleOn = hasUnique(state.config.loadout?.uniqueMask ?? 0, UQ_GAMBLER_CHIP);
  const choiceCount = gambleOn ? 3 + GAMBLER_EXTRA_CHOICES : 3;
  state.powerupChoices = drawPowerupChoices(state, choiceCount);
  state.pendingLevelUp = true;
}

function checkGameOver(state: WorldState, player: Entity): void {
  if (player.hp <= 0) state.gameOver = true;
  // 오염(Lane8): 맵이 임계까지 오염되면(마킹 오염 지형 수 ≥ 임계) 실패. planetMode 게이트라
  // 타 모드는 이 조건이 항상 거짓 → 거동 불변.
  else if (state.config.planetMode === PLANET_MODE.contamination && contaminationCritical(state))
    state.gameOver = true;
}

function countKind(state: WorldState, kind: Entity['kind']): number {
  let n = 0;
  for (const e of state.entities) if (e.kind === kind) n++;
  return n;
}
