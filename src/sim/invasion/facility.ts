/**
 * 침공 L2 회랑 설비 — 방향 제한 방어포 · 주기 온오프 해저드 · 드론 스포너 (M7a · L4-facility).
 *
 * L0 이 선언한 {@link EnterLayerFn} / {@link StepFacilityFn} 시그니처를 구현한다. **world.ts 를
 * 열지 않는다** — 배선(stepWorld 안 어디서 부를지, 공간 격자 등록)은 world.ts 소유 레인(L2)의
 * 몫이고, 이 모듈은 함수만 export 한다.
 *
 * ## 구 포탑과 다른 점
 * ① **사계(arc) 제한.** 구 `fireTurret`(src/sim/defense.ts)은 언제나 `atan2(player - t)` 전방위
 *    조준이고 `TurretSpec` 에 facing/arc 필드 자체가 없었다. 설비는 소켓이 정한 facing ± arc/2
 *    안에 표적이 있을 때만 쏜다 → 벽에 붙은 설비가 벽을 뚫고 반대편을 때리지 못한다.
 * ② **주기 온오프 해저드.** 구 해저드는 windup 1회 → active 1회로 끝났다. 여기서는 주기의 시작
 *    틱마다 장판을 다시 융기시켜 반복 리듬을 만든다(src/sim/invasion/hazardCycle.ts).
 * ③ **드론 스포너.** `summonEnemy`(RNG 미소비 결정론) 경유. `spawnEnemy` 는 waveRng 를 소비하므로
 *    침공에서 절대 쓰지 않는다. 사출 지점은 소켓 옆이 아니라 **스크롤 창 진행 방향 앞**이고
 *    (근거는 {@link stepSpawnerFacility}), 강화 3축은 설비가 아니라 **생산물**에 실린다.
 *
 * ## 결정론(ADR-0005)
 * RNG·wall-clock 미소비. 모든 거동은 (틱, 소켓 좌표, 배치 Ref, 정비도)의 순수 함수다. 각도는
 * 데이터에 **정수 도**로 실려 있고 라디안 변환은 사용 시점에 1회만 한다. 스탯 스케일은 정수
 * centi-percent 순차 반올림(f64 누적 금지).
 *
 * ## 엔티티 필드 매핑 — 단일 정본(다른 곳에서 재정의 금지)
 * kind 는 L1-determinism 이 예약한 3종(`facilityGun` / `facilityHazard` / `facilitySpawner`)을 쓴다.
 *
 * | 필드 | facilityGun | facilityHazard | facilitySpawner |
 * |---|---|---|---|
 * | `enemyType` | catalogId | catalogId | catalogId |
 * | `dashCooldown` | 소켓 인덱스 | 소켓 인덱스(주기 위상 파생 키) | 소켓 인덱스 |
 * | `targetX` | 사계 기준 방향(라디안) | 장판 융기 방향(라디안) | 사출 방향(라디안) |
 * | `pierce` | 사계 전체 폭(**정수 도**) | — | — |
 * | `timer` | 발사 카운트다운 | — (주기는 틱의 순수 함수) | 사출 드론 실효 내구도 |
 * | `phase` | 0 대기 / 1 예고선(조준각 잠금) | — | — |
 * | `angle` | 조준각(예고 중 잠긴 값 · 렌더) | — | — |
 * | `aux0` | — | 해저드 subtype(렌더) | 남은 소환 수(-1 = 무한) |
 * | `aux1` | — | — | 다음 소환까지 틱 |
 * | `damage` | 실효 발당 피해 | 실효 틱당 장판 피해 | — |
 * | `hp`/`maxHp`/`radius` | 실효 내구도·히트박스 | 〃 | 〃 |
 *
 * 해저드가 **융기시키는 `hazard` 엔티티**는 위 표 밖이다. 그쪽에서 이 모듈이 쓰는 슬롯은
 * `aux0` 하나뿐이며 의미는 **감속 지속 틱(0 = 기본값)** 이다 — 효용 해저드 전용
 * ({@link isUtilityHazard}). `hazard` kind 는 원래 `aux0` 를 쓰지 않고, 해시는 `aux0`·`aux1`
 * 이 둘 다 0 이면 폴드를 생략하므로(src/sim/replay.ts) 다른 장판은 바이트 불변이다.
 */

import type { Entity, EntityKind } from '../entities.js';
import { blankEntity, addEntity, spawnEnemyBullet, spawnHazard, spawnWall } from '../entities.js';
import type { WorldState } from '../world.js';
import { atan2, cos, sin, wrapAngle, PI } from '../math.js';
import { segmentBlocked, circleOverlapsWall } from '../los.js';
import {
  INVASION_SCROLL_DIR,
  INVASION_WINDOW_HALF_H,
  INVASION_WINDOW_HALF_W,
  scrollAxisFor,
  windowCenterX,
  windowCenterY,
} from './scroll.js';
import { SCROLL_AXIS_HORIZONTAL, SCROLL_AXIS_VERTICAL } from './constants.js';
import { PLAYER_SLOW_DURATION } from '../status.js';
import { normalizeMaintenance } from './guardian.js';
import { invasionFireCooldown } from './guardianBridge.js';
import { summonEnemy } from '../waves.js';
import { ENEMY_BY_TYPE } from '../../../data/enemies.js';
import type { FacilitySpec } from '../../../data/invasion/facilities.js';
import {
  facilitySpecFor,
  FACILITY_BEHAVIOR_HAZARD,
  FACILITY_BEHAVIOR_PRESS,
  FACILITY_BEHAVIOR_SPAWNER,
} from '../../../data/invasion/facilities.js';
import { spawnMovingWall, stepMovingWalls } from './movingWall.js';
import type { InvasionMapTemplate, InvasionSocketDef } from '../../../data/invasion/mapTemplates.js';
import { mapTemplateFor } from '../../../data/invasion/mapTemplates.js';
import { CATALOG_FACILITY } from '../../../data/invasion/catalog.js';
import { isCycleSpawnTick, socketPhaseOffset } from './hazardCycle.js';
import type { FacilityRef, InvasionStepContext } from './types.js';
import {
  AFFIX_NO_CORE_HP_PCT,
  NEUTRAL_AFFIX_MODS,
  affixCooldown,
  affixDamage,
  affixHp,
  affixMaintenance,
  affixSpawnCap,
  defenseAffixSet,
  raiseMaxHp,
  resolveDefenseMods,
} from './affix.js';
import type { DefenseAffixMods, DefenseTriggerState } from './affix.js';
import { applyDefenseBonus } from './defenseBonus.js';

/** 방향 제한 방어포 kind. */
export const FACILITY_GUN_KIND: EntityKind = 'facilityGun';
/** 주기 온오프 해저드 발생기 kind. 융기시키는 장판 자체는 기존 `hazard` kind 다. */
export const FACILITY_HAZARD_KIND: EntityKind = 'facilityHazard';
/** 드론 스포너 kind. */
export const FACILITY_SPAWNER_KIND: EntityKind = 'facilitySpawner';

/** 설비 3종 kind 목록(world.ts 배선·렌더 매핑이 파생해 쓰도록 배열로 노출). */
export const FACILITY_KINDS: readonly EntityKind[] = [
  FACILITY_GUN_KIND,
  FACILITY_HAZARD_KIND,
  FACILITY_SPAWNER_KIND,
];

/** 정수 도 → 라디안. */
const DEG_TO_RAD = PI / 180;

/** 스포너가 동시 생존 상한에 걸렸을 때의 재시도 간격(틱, 결정론 상수). */
const SPAWNER_RETRY_TICKS = 12;

/**
 * 스포너 자식 드론의 **생산자 표식 필드는 `aux1`** 이다(`ownerId` 가 아니다).
 *
 * ⚠️ 예전에는 `drone.ownerId = 스포너 id` 였는데, `enemy` kind 에서 `ownerId` 는 이미
 * **냉기 감속 잔여 틱**으로 재활용돼 있다(src/sim/status.ts 필드 재활용 규율). 그래서 두 가지가
 * 동시에 깨져 있었다:
 *   ① `tickEnemyStatus` 가 매 틱 `ownerId--` 하므로 표식이 `id` 틱 만에 0 이 되고, 그때부터
 *      `spawnMaxAlive` 상한이 **아무도 세지 못한다** → 무제한 생산. 실측(24시드 · 설비 단독
 *      12소켓)에서 설계 상한 36기 대비 **동시 생존 평균 181기**였다.
 *   ② 표식이 살아 있는 동안 `enemyStatusSlowMult` 가 드론을 **냉기 감속 상태로 오인**해
 *      스폰 직후 `id` 틱 동안 이동 속도를 깎았다.
 * `aux1` 은 범용 정수 슬롯이고 `enemy` kind 에서 쓰는 곳이 없다(편대 표식은 `aux0`).
 */
export const SPAWNER_OWNER_FIELD = 'aux1';

/** `aux0` 의 "소환 수 무제한" 표식(파괴 전까지 계속 생산). */
export const SPAWN_BUDGET_UNLIMITED = -1;

// ---------------------------------------------------------------------------
// 실효 스탯 — 정수 centi-percent 순차 반올림
// ---------------------------------------------------------------------------

/** 등급별 스탯 배율(centi-percent). 인덱스 = rarity 코드(0 normal .. 3 unique). */
const RARITY_CP: readonly number[] = [100, 110, 125, 150];

/** 레벨 1당 배율 가산(centi-percent). lv1 = 100cp. */
const LEVEL_STEP_CP = 8;

/** 승급 1단계당 배율 가산(centi-percent). */
const ASCENSION_STEP_CP = 10;

/** 설비 1기의 실효 스탯(전부 정수). */
export interface FacilityStats {
  readonly hp: number;
  readonly damage: number;
  readonly fireCooldown: number;
  readonly spawnInterval: number;
  /**
   * 사출 드론 1기의 실효 내구도(스포너 전용, 그 외 0). 강화 3축이 여기 실린다 —
   * 스포너의 기여를 나르는 것은 설비 내구도가 아니라 **생산물**이기 때문이다
   * (`.omc/research/invasion-spawner-redesign-2026-07-28.md`).
   */
  readonly droneHp: number;
}

/** 정수 배율 1단계: round(base * cp / 100). base·cp 가 정수면 결과도 정수다. */
function scaleCp(base: number, cp: number): number {
  if (cp === 100) return base;
  return Math.round((base * cp) / 100);
}

/**
 * 배치 Ref 의 강화 3축(레벨 → 등급 → 승급)을 **단계마다 정수 반올림**하며 곱한다.
 * 순서가 계약이다 — 바꾸면 값이 달라져 클라·서버 재실행이 갈린다.
 */
function scaleByRef(base: number, ref: FacilityRef): number {
  const levelCp = 100 + (ref.level - 1) * LEVEL_STEP_CP;
  const rarityCp = RARITY_CP[ref.rarity] ?? 100;
  const ascCp = 100 + ref.ascension * ASCENSION_STEP_CP;
  return scaleCp(scaleCp(scaleCp(base, levelCp), rarityCp), ascCp);
}

/**
 * 배치 Ref(레벨·승급·등급)와 정비도로 실효 스탯을 파생한다.
 *
 * 배율은 곱을 f64 로 누적하지 않고 **단계마다 정수로 반올림**한다(레벨 → 등급 → 승급 순).
 * 순서가 계약이다 — 바꾸면 값이 달라져 클라·서버 재실행이 갈린다.
 *
 * 정비도 풍화(ADR-0006, 결정 #18)는 구 포탑과 동일하게 **발사/생산 간격**에만 적용한다
 * (`invasionFireCooldown`) — 피해를 건드리면 충돌 판정 f64 산술에 오차가 섞인다.
 *
 * 방어측 계보 보너스(`defenseBonusBp`, defenseBonus.ts)는 **내구도·피해 두 축에만** 곱한다 —
 * 공격측 `applyPilotLevelScaling` 과 대칭이고, 발사/생산 간격은 정비도·어픽스 담당이라 겹치면
 * 서로 가린다. `droneHp` 도 이 함수가 단일 파생 지점이라 여기서 접는다 — 그래야
 * `stepSpawnerFacility` 가 나르는 드론 내구도·접촉피해(= `damage` 필드 재사용)에 **이중 적용
 * 없이** 자연히 실린다. bp 0 이면 `applyDefenseBonus` 가 무연산이라 비트 동일.
 */
export function resolveFacilityStats(
  spec: FacilitySpec,
  ref: FacilityRef,
  maintenance: number,
  defenseBonusBp = 0,
): FacilityStats {
  const scale = (base: number): number => scaleByRef(base, ref);
  // 거동마다 피해가 실리는 필드가 다르다. 프레스는 `pressCrushDamage` 다 — 예전에는 이 분기가
  // 없어 `spec.damage`(프레스는 0)를 읽었고, 그래서 프레스만 강화 3축이 통째로 무효했다
  // (실측: lv1·lv17·lv50·lv99 전부 L2 누적 피해 **804 고정**).
  //
  // 스포너도 같은 계열의 누락이었다 — 스펙 `damage` 가 0 이라 `scale(0) === 0` 이고, 그래서
  // 레벨·등급·승급이 바꾸는 것이 **설비 내구도뿐**이었다. 스포너의 피해를 나르는 값은
  // 카탈로그가 아니라 **생산물의 접촉 피해**(`ENEMY_BY_TYPE[spawnEnemyType].contactDamage`)라
  // 그 값을 원본으로 삼는다. 실제로 드론에 실리는 지점은 `stepSpawnerFacility` 다.
  const rawDamage =
    spec.behavior === FACILITY_BEHAVIOR_HAZARD
      ? spec.hazardDamage
      : spec.behavior === FACILITY_BEHAVIOR_PRESS
        ? spec.pressCrushDamage
        : spec.behavior === FACILITY_BEHAVIOR_SPAWNER
          ? (ENEMY_BY_TYPE[spec.spawnEnemyType]?.contactDamage ?? 0)
          : spec.damage;
  return {
    hp: applyDefenseBonus(scale(spec.hp), defenseBonusBp),
    damage: applyDefenseBonus(scale(rawDamage), defenseBonusBp),
    fireCooldown: invasionFireCooldown(spec.fireCooldown, maintenance),
    spawnInterval: invasionFireCooldown(spec.spawnIntervalTicks, maintenance),
    droneHp:
      spec.behavior === FACILITY_BEHAVIOR_SPAWNER
        ? applyDefenseBonus(
            scale(
              spec.spawnDroneHp > 0
                ? spec.spawnDroneHp
                : (ENEMY_BY_TYPE[spec.spawnEnemyType]?.hp ?? 0),
            ),
            defenseBonusBp,
          )
        : 0,
  };
}

// ---------------------------------------------------------------------------
// 사계(arc) 판정
// ---------------------------------------------------------------------------

/**
 * 표적 각도가 사계 안인가. `arcDeg >= 360` 이면 항상 true(전방위 — 구 포탑 호환 경로).
 * 경계는 **포함**이다(정확히 arc/2 는 사격 가능).
 */
export function withinArc(facingRad: number, arcDeg: number, targetRad: number): boolean {
  if (arcDeg >= 360) return true;
  if (arcDeg <= 0) return false;
  const half = (arcDeg * DEG_TO_RAD) / 2;
  const d = wrapAngle(targetRad - facingRad);
  return d >= -half && d <= half;
}

/**
 * 사계 안으로 접은 각도. **편차 사격 전용** — 교전 판정({@link withinArc})은 표적의 실제
 * 방향으로 하고, 실제로 겨누는 각도만 이걸로 접는다.
 *
 * ⚠️ 교전 판정을 편차 각도로 하면 안 된다. 그러면 예측각이 사계를 조금만 벗어나도 **발사 자체를
 * 거부**해, 사계 안에 뻔히 있는 표적을 놓친다. 실측으로 밟은 함정이다 — `breachturret` 의 L2
 * 누적 피해가 2226 → **정확히 0** 이 됐다(정확도 저하가 아니라 구조적 무발사).
 */
function clampToArc(facingRad: number, arcDeg: number, ang: number): number {
  if (arcDeg >= 360) return ang;
  const half = (arcDeg * DEG_TO_RAD) / 2;
  const d = wrapAngle(ang - facingRad);
  if (d > half) return facingRad + half;
  if (d < -half) return facingRad - half;
  return ang;
}

// ---------------------------------------------------------------------------
// 스폰
// ---------------------------------------------------------------------------

/** 설비 엔티티인가(3종 kind 중 하나). */
export function isFacility(e: Entity): boolean {
  return (
    e.kind === FACILITY_GUN_KIND ||
    e.kind === FACILITY_HAZARD_KIND ||
    e.kind === FACILITY_SPAWNER_KIND
  );
}

/** 설비 엔티티에서 catalogId 를 되읽는다. 설비가 아니면 -1. */
export function facilityCatalogId(e: Entity): number {
  return isFacility(e) ? e.enemyType : -1;
}

/** 거동 분류 → 엔티티 kind. */
function kindForBehavior(behavior: number): EntityKind {
  if (behavior === FACILITY_BEHAVIOR_HAZARD) return FACILITY_HAZARD_KIND;
  if (behavior === FACILITY_BEHAVIOR_SPAWNER) return FACILITY_SPAWNER_KIND;
  return FACILITY_GUN_KIND;
}

/**
 * 소켓 1기에 설비를 스폰한다. 초기 카운트다운(즉발 방지)도 실효 간격으로 준다 — 방치된 기지는
 * 첫 발사부터 느리다(정비도 일관).
 */
export function spawnFacility(
  state: WorldState,
  socket: InvasionSocketDef,
  socketIndex: number,
  ref: FacilityRef,
  maintenance: number,
  defenseBonusBp = 0,
): Entity | undefined {
  const spec = facilitySpecFor(ref.catalogId);
  if (spec === undefined) return undefined;
  // 압축 프레스는 설비 엔티티가 아니라 **이동 벽**이다(M7c). 좌표·주기 축이 완전히 달라서
  // 여기서 갈라 전용 스폰으로 넘긴다 — 아래 어픽스·조준 경로가 프레스를 보면 `facilitySpecFor`
  // 수치가 전부 0 이라 조용히 무력한 포탑이 하나 생긴다.
  //
  // 다만 **끼임 피해는 다른 설비와 같은 강화 3축·어픽스를 탄다.** 예전에는 이 갈래가 스탯 축을
  // 통째로 건너뛰어 프레스만 레벨·등급·승급이 전부 무효였다(실측: lv1~lv99 L2 누적 피해 804
  // 고정). 이동 벽 구조는 그대로 두고 피해 값만 정본 경로로 다시 실어 준다.
  if (spec.behavior === FACILITY_BEHAVIOR_PRESS) {
    const press = spawnMovingWall(state, socket, socketIndex, ref, spec);
    if (press !== undefined) {
      const pressMods = defenseAffixSet(CATALOG_FACILITY, ref).always;
      press.damage = affixDamage(
        resolveFacilityStats(spec, ref, affixMaintenance(maintenance, pressMods), defenseBonusBp)
          .damage,
        pressMods,
      );
    }
    return press;
  }
  // 방어체 어픽스는 **접두(상시)만** 스폰 시점에 싣는다. 접미(조건부)는 스텝이 매 틱 얹는다
  // (src/sim/invasion/affix.ts 머리말 "적용 시점 규율"). 어픽스 미보유면 배율 1 → 비트 동일.
  const mods = defenseAffixSet(CATALOG_FACILITY, ref).always;
  const stats = resolveFacilityStats(
    spec,
    ref,
    affixMaintenance(maintenance, mods),
    defenseBonusBp,
  );
  const hp = affixHp(stats.hp, mods);
  const facing = socket.facingDeg * DEG_TO_RAD;
  const e = blankEntity(kindForBehavior(spec.behavior));
  e.x = socket.x;
  e.y = socket.y;
  e.enemyType = ref.catalogId;
  e.radius = spec.radius;
  e.hp = hp;
  e.maxHp = hp;
  e.damage = affixDamage(stats.damage, mods);
  e.angle = facing; // 초기 조준각 = 정면(렌더 기본자세)
  e.targetX = facing; // 사계·융기·사출 기준 방향
  e.pierce = socket.arcDeg; // 사계 전체 폭(정수 도)
  e.dashCooldown = socketIndex; // 소켓 인덱스(주기 위상 파생 키)
  e.phase = 0;
  e.life = -1; // 시간으로 소멸하지 않는다
  switch (spec.behavior) {
    case FACILITY_BEHAVIOR_SPAWNER:
      e.aux0 = SPAWN_BUDGET_UNLIMITED; // 파괴 전까지 무제한 생산
      e.aux1 = affixCooldown(stats.spawnInterval, mods); // 다음 소환까지 틱
      e.timer = stats.droneHp; // 사출 드론 실효 내구도(강화 3축 반영)
      break;
    case FACILITY_BEHAVIOR_HAZARD:
      e.aux0 = spec.hazardSubtype; // 렌더 분화용 subtype
      break;
    default:
      e.timer = affixCooldown(stats.fireCooldown, mods);
      break;
  }
  return addEntity(state, e);
}

/**
 * L2 진입 시 1회: 맵 템플릿의 정적 벽 → 소켓 설비 순으로 스폰한다(배열 순서 = 결정론 입력).
 *
 * 빈 소켓(`null`)은 여기서 **아무것도 스폰하지 않는다**. 기본 수비대 자동 충원은 결정 #22 에
 * 따라 스폰 단계에서 ref 를 주입하는 방식(L9-garrison-catalog)이라, 이 함수는 이미 충원이 끝난
 * `ctx.layers` 를 받는다고 본다.
 */
export function enterFacilityLayer(state: WorldState, ctx: InvasionStepContext): void {
  const template = mapTemplateFor(ctx.layers.l2.templateId);
  const maintenance = normalizeMaintenance(ctx.maintenance);
  for (const w of template.walls) spawnWall(state, w.x, w.y, w.halfW, w.halfH);
  const sockets = ctx.layers.l2.sockets;
  const n = Math.min(sockets.length, template.sockets.length);
  for (let i = 0; i < n; i++) {
    const ref = sockets[i];
    if (ref === null || ref === undefined) continue;
    spawnFacility(state, template.sockets[i]!, i, ref, maintenance, ctx.defenseBonusBp);
  }
}

// ---------------------------------------------------------------------------
// 스텝
// ---------------------------------------------------------------------------

/** 플레이어 엔티티(index 0 불변식 + 방어적 스캔). */
function findPlayer(state: WorldState): Entity | undefined {
  const first = state.entities[0];
  if (first !== undefined && first.kind === 'player') return first;
  for (const e of state.entities) {
    if (e.kind === 'player') return e;
  }
  return undefined;
}

/**
 * L2 설비를 1틱 진행한다(방어포·해저드·스포너 디스패치).
 *
 * 엔티티 배열은 **스텝 시작 시점 길이까지만** 훑는다 — 이 틱에 새로 생긴 탄/장판/드론을 다시
 * 훑어 순서가 흔들리는 것을 막는다(결정론).
 */
export function stepFacility(state: WorldState, ctx: InvasionStepContext): void {
  // 압축 프레스(이동 벽)를 **가장 먼저** 옮긴다. 설비 조준·LOS·해저드 융기가 전부
  // `state.activeWalls` 를 읽으므로, 프레스가 뒤에 움직이면 같은 틱 안에서 조준은 옛 벽을,
  // 탄은 새 벽을 보는 어긋남이 생긴다. 플레이어가 없어도(사망 직후) 벽은 계속 움직여야
  // 좌표가 틱의 순수 함수로 남는다 — 그래서 아래 player 가드보다 위에 둔다.
  stepMovingWalls(state, ctx);
  const player = findPlayer(state);
  if (player === undefined) return;
  const maintenance = normalizeMaintenance(ctx.maintenance);
  const template = mapTemplateFor(ctx.layers.l2.templateId);
  const socketCount = template.sockets.length;
  // 접미(조건부) 어픽스 판정 입력을 이 틱에 한 번 만들어 회랑 전체가 공유한다.
  const trigger = facilityTriggerState(state, ctx, player);
  const sockets = ctx.layers.l2.sockets;
  const n = state.entities.length;
  for (let i = 0; i < n; i++) {
    const e = state.entities[i]!;
    if (e.dead) continue;
    if (!isFacility(e)) continue;
    const spec = facilitySpecFor(e.enemyType);
    if (spec === undefined) continue;
    // 소켓 인덱스(`dashCooldown`)로 배치 참조를 되짚어 어픽스를 얹는다. 어픽스 미보유면
    // `NEUTRAL_AFFIX_MODS` 로 떨어져 아래 적용 함수들이 전부 입력을 그대로 돌려준다(비트 동일).
    const ref = sockets[e.dashCooldown];
    const set = defenseAffixSet(CATALOG_FACILITY, ref);
    const mods = set.neutral
      ? NEUTRAL_AFFIX_MODS
      : resolveDefenseMods(set, trigger, e.x, e.y);
    if (!set.neutral && ref !== null && ref !== undefined) {
      syncFacilityAffixStats(e, spec, ref, maintenance, mods, ctx.defenseBonusBp);
    }
    if (e.kind === FACILITY_GUN_KIND) {
      stepTurretFacility(state, e, spec, player, maintenance, mods);
    } else if (e.kind === FACILITY_HAZARD_KIND) {
      // 해저드는 연사 어픽스를 받지 않는다 — 주기가 **틱의 순수 함수**(위상은 소켓 인덱스 파생)
      // 라서 개체마다 주기를 흔들면 예열 예고 리듬이 소켓 간에 엇갈려 읽을 수 없게 된다.
      // 어픽스는 장판 피해(`e.damage`)와 내구도로 실린다(위 syncFacilityAffixStats).
      // `ref` 를 넘기는 것은 **효용 해저드**(피해 0) 전용 경로 때문이다 — 그쪽은 피해가 0 이라
      // 강화 3축을 실을 자리가 없어서, 반경·활성 길이에 직접 태운다({@link isUtilityHazard}).
      stepHazardFacility(state, e, spec, socketCount, ref);
    } else {
      // 스포너는 사출 좌표가 **스크롤 창**에서 나오므로 런타임(ctx)과 플레이어를 받는다.
      // `ref` 는 강화 3축을 생산물(드론 내구도)에 싣기 위한 것이다.
      stepSpawnerFacility(state, e, spec, maintenance, mods, ctx, player);
    }
  }
}

/**
 * L2 접미 계기 판정 입력. 코어는 L3 에서야 스폰되므로 회랑에서는 언제나 "코어 없음"이다.
 * `alliesDestroyed` 는 상태 없이 순수 계산한다: 배치된 소켓 수 − 현재 살아 있는 설비 수.
 */
function facilityTriggerState(
  state: WorldState,
  ctx: InvasionStepContext,
  player: Entity,
): DefenseTriggerState {
  const sockets = ctx.layers.l2.sockets;
  let placed = 0;
  for (const ref of sockets) {
    if (ref === null || ref === undefined) continue;
    // 압축 프레스는 파괴 불가 이동 벽이라 설비 엔티티가 없다. 배치 수에 세면
    // `alliesDestroyed` 가 스폰 직후부터 프레스 수만큼 부풀어 접미 어픽스가 오발동한다.
    const s = facilitySpecFor(ref.catalogId);
    if (s === undefined || s.behavior === FACILITY_BEHAVIOR_PRESS) continue;
    placed++;
  }
  let alive = 0;
  for (const e of state.entities) {
    if (!e.dead && isFacility(e)) alive++;
  }
  const destroyed = placed - alive;
  const elapsed = state.tick - ctx.runtime.phaseEnterTick;
  return {
    elapsedTicks: elapsed < 0 ? 0 : elapsed,
    coreHpPct: AFFIX_NO_CORE_HP_PCT,
    alliesDestroyed: destroyed < 0 ? 0 : destroyed,
    playerX: player.x,
    playerY: player.y,
  };
}

/**
 * 설비 1기의 내구도·피해를 이번 틱 어픽스로 다시 접는다.
 *   - 피해는 매 틱 덮어쓴다(발사 시점에 읽히는 값이라 안전).
 *   - 내구도는 **단조 상향**만 한다({@link raiseMaxHp}) — 되돌리면 이미 입은 피해가 사라진다.
 */
function syncFacilityAffixStats(
  e: Entity,
  spec: FacilitySpec,
  ref: FacilityRef,
  maintenance: number,
  mods: DefenseAffixMods,
  defenseBonusBp: number,
): void {
  const base = resolveFacilityStats(spec, ref, affixMaintenance(maintenance, mods), defenseBonusBp);
  raiseMaxHp(e, affixHp(base.hp, mods));
  e.damage = affixDamage(base.damage, mods);
}

/**
 * 단발 포탑 조준 흔들림 진폭(도). **`pellets === 1` 에만 건다** —
 * `fireFacilityBullets` 의 `spreadDeg` 는 `pellets > 1` 일 때만 부채꼴을 펴므로, 단발 포탑에는
 * 확산이라는 축이 아예 없었다. 그래서 단발은 조준이 한 점에 고정돼 **움직이는 표적을 구조적으로
 * 못 맞혔고**, 다발 포탑만 확산으로 그 오차를 우회하고 있었다.
 *
 * 실측(24시드 · 어픽스 제외 레벨 단독 스윕 · L2 누적 피해)이 그 분리를 예외 없이 보여줬다:
 *   `pellets 1` — `rapid` 240 → 420 → 0 → 0 · `toxinturret` 55 → 44 → 0 → 0 ·
 *                 `rail`·`heavyrail`·`siegecannon` 전 구간 0
 *   `pellets 3+` — `mortar`(5발 44도) 8 → 3195 · `breachturret`(3발 30도) 252 → 2226 정상 단조
 *
 * 이 흔들림을 넣으면 `rapid` 174 → 238 → 270 → 477 · `toxinturret` 15 → 44 → 75 → 132 로
 * **역전이 사라지고 단조로 돌아온다**. 다발 포탑에는 걸지 않는다 — 자체 확산 위에 덧대면
 * 명중률이 되레 떨어진다(실측: `mortar` 3195 → 2676 · `breachturret` 2226 → 318).
 */
export const TURRET_AIM_JITTER_DEG = 4;

/** 흔들림 주기(틱). 소수라 한 회랑의 12소켓이 같은 위상으로 겹치지 않는다. */
const AIM_JITTER_PERIOD = 97;

/**
 * 포탑이 실제로 겨눌 각도. 단발 포탑이면 {@link TURRET_AIM_JITTER_DEG} 만큼 결정론적으로
 * 흔들고, 다발 포탑이면 표적 방향 그대로 돌려준다(자체 확산이 이미 있다).
 *
 * ## 편차 사격(lead)을 넣지 않은 이유 — 실측으로 기각했다
 * 표적의 속도로 도달 지점을 예측하는 편차 사격을 구현해 재 봤으나, 참조봇 기준으로 **해로웠다**:
 *   `rapid` 240/420/0/0 → **24/70/0/0**(역전 그대로) · `mortar` 3195 → 3053 · lv1 구간 하락.
 * 참조봇은 탄도(ballistic)로 움직이지 않고 카이팅·회피로 **진동**하기 때문에, 순간 속도를
 * 외삽하면 표적이 지키지 않을 방향을 겨누게 된다. 흔들림만 넣은 쪽이 모든 축에서 우월했다.
 *
 * ⚠️ **이 판정은 참조봇 기준이다.** 사람은 봇보다 탄도에 가깝게 움직이므로 편차 사격이 사람에게는
 * 유효할 수 있다(m8 인계 §1.4 — 이 리포의 모든 난이도 수치는 봇 기준이다). 플레이테스트
 * 데이터가 생기면 다시 판단할 항목이지, "편차 사격은 틀렸다"로 굳히지 마라.
 *
 * 결정론(ADR-0005): RNG 미소비. 흔들림은 `tick`·`id` 의 순수 삼각파다(해저드 위상을 소켓
 * 인덱스에서 파생하는 선례와 같은 규율).
 */
function turretAimAngle(state: WorldState, e: Entity, spec: FacilitySpec, aimNow: number): number {
  if (spec.pellets > 1) return aimNow;
  return aimNow + aimJitter(state, e, TURRET_AIM_JITTER_DEG);
}

/**
 * 결정론 조준 흔들림(라디안). `tick`·`id` 의 순수 삼각파라 RNG 미소비다(ADR-0005).
 *
 * ## 왜 흔들림이 "정확도 저하"가 아니라 **측정 가능성**의 문제인가
 * L2 참조봇 궤적은 사실상 **시드 불변**이다 — 승패 분산의 출처가 파워업 추첨이라(밸런스
 * 스모크 헤더 ①) 회랑 통과 경로는 시드가 달라도 거의 같다. 그래서 조준이 한 점에 고정된
 * 포탑은 12소켓 × 24시드가 **한 덩이로** 맞거나 빗나간다. 실측에서 그 성질이 그대로 보였다:
 * 최소 접근 거리가 시드·레벨에 걸쳐 소수점까지 동일했고, 예고 길이를 2틱 옮기는 것만으로
 * 누적 피해가 0 ↔ 최대치로 통째로 뒤집혔다. 그런 상태에서 고른 수치는 **하나의 기하학적
 * 우연에 과적합**이라 다음 sim 변경에서 다시 0 이 된다.
 * 흔들림은 발마다 조준을 어긋내 그 상관을 끊는다 — 그래서 강화축이 "코인"이 아니라
 * 레벨에 비례하는 연속량이 된다.
 */
function aimJitter(state: WorldState, e: Entity, ampDeg: number): number {
  const raw = (state.tick + e.id * 13) % AIM_JITTER_PERIOD;
  const phase = raw < 0 ? raw + AIM_JITTER_PERIOD : raw;
  const half = AIM_JITTER_PERIOD / 2;
  // 삼각파 0→1→0 을 −1..+1 로 편다(단일 나눗셈 · f64 누적 없음).
  const tri = phase < half ? phase / half : 2 - phase / half;
  return (tri * 2 - 1) * ampDeg * DEG_TO_RAD;
}

/**
 * 예고선 포탑의 조준 흔들림 진폭(도). 단발 포탑(4도)보다 크다 — 예고 + 비행 동안 쌓이는 잔여
 * 오차가 100~230 유닛이라, 그 폭을 덮지 못하면 명중이 전부-또는-전무로 갈린다
 * ({@link aimJitter} 주석). 사거리 900 기준 10도는 약 157 유닛에 해당한다.
 */
const TELEGRAPH_AIM_JITTER_DEG = 10;

/** 1초 = 60틱(속도 필드가 유닛/초라 편차 계산에서 틱↔초 환산이 필요하다). */
const TICKS_PER_SECOND = 60;

/**
 * 예고선 포탑(`telegraphTicks > 0`)이 겨눌 각도 — **예고 + 탄 비행 시간만큼 앞을 겨눈다**.
 *
 * ## 왜 예고 포탑만 편차 사격인가
 * 예고선은 조준각을 잠근 뒤 `telegraphTicks` 이 지나야 탄이 나간다. 그 사이 표적은 계속
 * 움직이므로, 잠금 시점의 방향을 그대로 쏘면 **오차 = 표적 속도 × (예고 + 비행) 틱** 이 된다.
 * 실측(24시드 · 설비 단독 배치 · L2 누적 피해)은 그 오차가 히트 창을 압도한다는 것을
 * 예외 없이 보여줬다:
 *   `rail`(예고 36틱 · 사거리 1600) — 탄이 플레이어에 **331 유닛 이내로 들어온 적이 없다**.
 *   예고를 12틱으로 줄이고 사거리를 900 으로 좁혀도 최소 거리 173 유닛으로 여전히 못 닿는다.
 *   탄 반경으로 메우는 길도 막혀 있다 — 소켓(y=±500)과 벽 안쪽 면(y=±540) 사이 여유가
 *   40 유닛뿐이라 반경 40 이상은 **자기 벽에 즉사**해 발사 수가 0 이 된다(실측: r=24 는 144발,
 *   r=40 은 0발). 즉 lv1~lv99 전 구간 0 은 정확도 저하가 아니라 **구조적 무명중**이었다.
 *
 * ## 설계 의도(회피 가능한 강타)를 죽이지 않는다 — 오히려 되살린다
 * 앞을 겨누면 예고선이 **탄이 실제로 갈 곳**을 가리키게 된다. 그래서 회피는 "계속 움직이기"가
 * 아니라 **"움직임을 바꾸기"** 가 된다 — 예고를 0 으로 줄이거나 피할 수 없는 폭을 주는 것과
 * 달리 회피 여지는 그대로 남는다. 참조봇은 예고를 인지하지 않고 등속으로 흐르므로 지금까지
 * 100% 회피가 **공짜**였다(사람은 조준을 위해 멈추거나 방향을 바꾸므로 이미 맞고 있었다 —
 * 봇 기준 회피율과 사람 기준 회피 난이도는 다른 값이다).
 *
 * ## 앞선 레인의 편차 사격 기각과 충돌하지 않는다
 * PR#161 이 기각한 것은 **연사 포탑 전반**(`rapid` 등)에 건 편차 사격이다. 그쪽은 비행 시간이
 * 짧고 봇이 카이팅으로 진동해 순간 속도 외삽이 해로웠다. 여기 게이트는 `telegraphTicks > 0`
 * 이라 카탈로그에서 `rail`·`heavyrail` **두 종에만** 닿는다 — 나머지 15종은 호출 지점조차
 * 바뀌지 않아 비트 동일이다.
 *
 * 결정론(ADR-0005): RNG·wall-clock 미소비. 표적 좌표·속도와 스펙 상수만 쓴다.
 */
function telegraphLeadAngle(
  e: Entity,
  spec: FacilitySpec,
  player: Entity,
  dx: number,
  dy: number,
): number {
  // 요격점은 **2회 반복**으로 푼다. 1회로 끝내면 비행 시간을 "지금 거리"로 재게 되는데,
  // 표적은 예고 동안 이미 멀어져 있어 체계적으로 **덜 겨눈다**. 실측에서 그 부족분이 100~230
  // 유닛이라 히트 창(반경 90 + 판정점 8 = 98)을 넘나들며 예고 길이 1~2틱 차이로 명중이
  // 켜졌다 꺼졌다 했다 — 2회 반복이 그 요동을 없앤다.
  let px = player.x;
  let py = player.y;
  for (let i = 0; i < 2; i++) {
    const ax = i === 0 ? dx : px - e.x;
    const ay = i === 0 ? dy : py - e.y;
    const dist = Math.sqrt(ax * ax + ay * ay);
    const flight = spec.bulletSpeed > 0 ? (dist / spec.bulletSpeed) * TICKS_PER_SECOND : 0;
    const lead = (spec.telegraphTicks + flight) / TICKS_PER_SECOND;
    px = player.x + player.vx * lead;
    py = player.y + player.vy * lead;
  }
  return atan2(py - e.y, px - e.x);
}

/**
 * 방향 제한 방어포 1기. 사거리 → **사계** → 벽 LOS 순으로 게이트하고, 예고선 스펙이 있으면
 * 조준각을 잠근 뒤 예고 구간을 소화하고 쏜다(예고 중에는 탄이 없어 피해도 없다).
 *
 * 사거리·사계 밖이면 카운트다운을 **유지**한다(구 포탑과 동일 규율 — 사정권 진입 시 즉발).
 *
 * 사거리·LOS 게이트는 플레이어의 **현재 위치**로 판정하고(교전 성립 여부), 사계·발사는
 * {@link turretAimAngle} 의 **편차 각도**를 쓴다(포탑이 실제로 겨누는 방향).
 */
function stepTurretFacility(
  state: WorldState,
  e: Entity,
  spec: FacilitySpec,
  player: Entity,
  maintenance: number,
  mods: DefenseAffixMods,
): void {
  // 예고선 소화 중: 잠긴 각도로만 발사한다(플레이어가 사계 밖으로 나가도 예고분은 나간다).
  if (e.phase === 1) {
    if (e.timer > 0) {
      e.timer--;
      return;
    }
    fireFacilityBullets(state, e, spec, e.angle);
    e.phase = 0;
    e.timer = facilityReloadTicks(state, spec, maintenance, mods);
    return;
  }
  if (e.timer > 0) {
    e.timer--;
    return;
  }
  const dx = player.x - e.x;
  const dy = player.y - e.y;
  if (dx * dx + dy * dy > spec.range * spec.range) return;
  // 교전 판정은 표적의 **실제 방향**으로 한다(사계 = 이 포탑이 담당하는 구역).
  const aimNow = atan2(dy, dx);
  if (!withinArc(e.targetX, e.pierce, aimNow)) return;
  // 실제로 겨누는 각도만 흔들고(또는 예고 포탑이면 앞을 겨누고), 사계 밖으로 나가면 경계로
  // 접는다(거부하지 않는다).
  const desired =
    spec.telegraphTicks > 0
      ? aimJitter(state, e, TELEGRAPH_AIM_JITTER_DEG) + telegraphLeadAngle(e, spec, player, dx, dy)
      : turretAimAngle(state, e, spec, aimNow);
  const ang = clampToArc(e.targetX, e.pierce, desired);
  if (state.activeWalls.length > 0 && segmentBlocked(e.x, e.y, player.x, player.y, state.activeWalls)) {
    return;
  }
  e.angle = ang;
  if (spec.telegraphTicks > 0) {
    // 조준각을 잠그고 예고선 구간으로 들어간다(관통 레일포).
    e.phase = 1;
    e.timer = spec.telegraphTicks;
    return;
  }
  fireFacilityBullets(state, e, spec, ang);
  e.timer = facilityReloadTicks(state, spec, maintenance, mods);
}

/**
 * 방어포 재장전 틱 = 정비도 풍화(어픽스 저항 반영) → 코어 모듈 연사 → 방어체 어픽스 연사.
 * 세 축이 같은 값을 서로 다른 지점에서 고치므로 접기 순서를 이 함수 하나로 고정한다.
 */
function facilityReloadTicks(
  state: WorldState,
  spec: FacilitySpec,
  maintenance: number,
  mods: DefenseAffixMods,
): number {
  const weathered = invasionFireCooldown(spec.fireCooldown, affixMaintenance(maintenance, mods));
  return affixCooldown(moduleFacilityCooldown(state, weathered), mods);
}

/**
 * 코어 모듈 설비 화력 배율 적용(M7b). 미장착이면 배율 1 → `Math.round(정수*1)===정수` 로
 * 비트 동일이라 거동·해시가 불변이다.
 */
function moduleFacilityDamage(state: WorldState, damage: number): number {
  const mr = state.moduleRuntime;
  if (mr === undefined || mr.facilityDamageMult === 1) return damage;
  return Math.round(damage * mr.facilityDamageMult);
}

/**
 * 코어 모듈 설비 연사 배율 적용(M7b). 연사 +% → 간격 축소. 최소 1틱 하한(0 은 무한 발사).
 * 미장착이면 그대로 반환(비트 동일).
 */
function moduleFacilityCooldown(state: WorldState, cd: number): number {
  const mr = state.moduleRuntime;
  if (mr === undefined || mr.facilityFireRateMult === 1) return cd;
  const scaled = Math.round(cd / mr.facilityFireRateMult);
  return scaled < 1 ? 1 : scaled;
}

/**
 * 소켓 중심에서 회랑 벽 안쪽 면까지의 여유(유닛). 직선형 템플릿 기준 소켓 y=±500 · 벽 안쪽 면
 * y=±540 이다(data/invasion/mapTemplates.ts). 굵은 탄이 이 여유를 넘으면 **발사 즉시 자기 벽에
 * 겹쳐 소멸**한다 — 적탄도 벽에 막히기 때문이다(world.ts `sweptCircleOverlapsWall`).
 * 실측: 반경 24 는 24시드에서 144발이 살아남고 반경 40 은 **0발**이다.
 */
const SOCKET_WALL_CLEARANCE = 40;

/**
 * 총구 오프셋(유닛) — 굵은 탄만 소켓 정면 방향으로 밀어 내보낸다.
 *
 * 반경이 {@link SOCKET_WALL_CLEARANCE} 이하인 탄은 **0** 을 돌려주므로 기존 카탈로그 15종은
 * 발사 좌표가 한 비트도 바뀌지 않는다(현행 최대 반경은 공성 주포 20). 예고 포탑처럼 히트 창을
 * 폭으로 벌어야 하는 설비만 이 경로에 들어온다.
 *
 * 방향은 **조준각이 아니라 소켓 정면(`e.targetX`)** 이다 — 사계 가장자리를 겨눌 때 조준 방향으로
 * 밀면 벽과 나란히 나가서 여유가 생기지 않는다.
 */
function muzzleOffset(spec: FacilitySpec): number {
  return spec.bulletRadius > SOCKET_WALL_CLEARANCE ? spec.bulletRadius : 0;
}

/** 단발 또는 부채꼴 다발 발사(정수 도 → 라디안 변환은 여기서 1회). */
function fireFacilityBullets(state: WorldState, e: Entity, spec: FacilitySpec, ang: number): void {
  const damage = moduleFacilityDamage(state, e.damage);
  const pellets = spec.pellets < 1 ? 1 : spec.pellets;
  const spread = spec.spreadDeg * DEG_TO_RAD;
  const start = pellets > 1 ? ang - spread / 2 : ang;
  const step = pellets > 1 ? spread / (pellets - 1) : 0;
  const muzzle = muzzleOffset(spec);
  const ox = muzzle === 0 ? e.x : e.x + cos(e.targetX) * muzzle;
  const oy = muzzle === 0 ? e.y : e.y + sin(e.targetX) * muzzle;
  for (let i = 0; i < pellets; i++) {
    const a = start + step * i;
    spawnEnemyBullet(
      state,
      ox,
      oy,
      cos(a) * spec.bulletSpeed,
      sin(a) * spec.bulletSpeed,
      a,
      damage,
      spec.bulletRadius,
      spec.bulletLife,
    );
  }
}

/**
 * **효용 해저드**(피해 0 의 순수 디버프 장판)인가. 현행 카탈로그에서는 견인 자기장
 * (`fac.gravwell`, catalogId 7) 하나뿐이다.
 *
 * ## 왜 이 게이트가 필요한가 — 강화 3축이 통째로 죽어 있었다
 * {@link resolveFacilityStats} 가 스케일하는 것은 `hp` · `damage` · 발사/생산 간격 셋이고,
 * 해저드의 `damage` 는 `spec.hazardDamage` 다. 그런데 견인 자기장은 그 값이 **0** 이라
 * `scale(0) === 0` — 레벨·등급·승급이 바꾸는 것이 **내구도뿐**이었다.
 *
 * 실측(24시드 · `rarity 0` · `ascension 0` 레벨 단독 스윕 · L2 감속 틱 비율)이 그 귀결을
 * 그대로 보여줬다 — 축이 **역전**이다:
 *
 *   lv1 12.05% → lv17 8.75% → lv50 8.13% → lv99 8.14%
 *
 * 장판 자체는 레벨과 함께 늘어난다(장판 엔티티-틱 627,473 → 1,016,648 — 설비가 안 부서지니까).
 * 그런데 플레이어가 실제로 감속당한 비율은 내려간다. 원인은 `invasion-nonmonotonic-hazards`
 * 문서가 밝힌 **교전 소멸**과 같다: 내구도만 오르면 설비가 안 부서지고 → 참조봇이 접근할
 * 이유가 사라지고 → 장판에 닿는 경로가 통째로 없어진다(참조봇에는 해저드 회피/접근 항이
 * 아예 없어 장판에 닿는 길이 "설비를 부수러 가는 동안"뿐이다). 즉 **내구도 상승이 유일한
 * 강화축인 설비는 강화할수록 기여가 준다.**
 *
 * 그래서 피해가 0 인 해저드에 한해, 기여를 실제로 나르는 값 — **감속 지속**(본체) ·
 * 활성 길이 · 반경 — 에 강화축을 태운다. 96시드 실측 12.71% → **20.14%**(lv25)로 축이
 * 시드 램프 구간(lv1~29)에서 단조로 돌아왔다.
 *
 * ## 왜 `hazardSubtype === HAZARD_SLOW` 이 아니라 `hazardDamage === 0` 인가
 * 오염 늪(`fac.blightpool`, 10)도 감속 장판이지만 `hazardDamage` 가 2 라 **강화축이 살아
 * 있다**(lv29·rarity3·asc3 에서 12). 죽어 있는 것은 정확히 "곱해도 0 인" 종뿐이므로 게이트를
 * 그 사실에 맞춘다. 덕분에 나머지 16종은 이 경로에서 **한 비트도 바뀌지 않는다**.
 */
function isUtilityHazard(spec: FacilitySpec): boolean {
  return spec.behavior === FACILITY_BEHAVIOR_HAZARD && spec.hazardDamage === 0;
}

/**
 * 효용 해저드 반경 상한 배율(centi-percent). 강화 3축의 곱은 시드 램프 최상단
 * (lv29 · rarity 3 · ascension 3)에서 **6.3배**까지 가는데, 반경 380 을 그대로 6.3배 하면
 * 2,394 가 되어 회랑(반높이 540)을 통째로 덮는다. 그러면 감속이 **상시**가 되어
 * ① 회피라는 축이 사라지고 ② 지표가 100% 에 붙어 강화축이 다시 포화한다
 * (`invasion-nonmonotonic-hazards` 의 즉사 포화와 같은 실패 방식이다).
 *
 * ## ✅ 이 축은 **2026-07-28 에 되살아났다** (예전 기록은 아래 참고)
 * 오랫동안 "상한을 200cp(760)로 두나 400cp(1,520)로 두나 96시드 9행이 한 자리도 같다" 는
 * 이유로 이 축은 **사실상 무효**로 기록돼 있었다. 원인은 밸런스가 아니라 broad-phase 였다 —
 * 공간 해시(`src/sim/collision.ts`, 셀 256)가 엔티티를 **중심 셀 한 칸**에만 넣는데 질의는
 * **탐침 반경**으로만 셀을 훑어서, 장판 중심이 한두 셀 밖이면 반경이 아무리 커도 후보로
 * 들어오지 않았다(실효 상한 약 650).
 *
 * `fix/spatial-hash-large-radius-broadphase` 가 그 broad-phase 를 고쳤다. **이제 반경은 실제로
 * 판정에 반영된다.** 다만 그 수정의 난이도 기여 대부분은 이 축이 아니라 **일반 엔티티가 셀
 * 경계에서 빠지던 몫**이었다(24시드 중위 −14.58pp 중 해저드 몫은 −4.17pp).
 * 상세는 `.omc/research/spatial-hash-large-radius-broadphase-2026-07-28.md` §2-3.
 *
 * ⚠️ **상한 200cp 는 그 수정 이후 재검토된 적이 없다.** 이 값은 축이 죽어 있던 시절에 정해진
 * 것이라 "회랑(반높이 540)을 덮지 않는다" 는 위 근거가 760 에서 이미 아슬아슬하다. 실측상
 * 해저드 몫이 작아 이번 레인에서는 건드리지 않았지만, 밸런스 패스의 검토 대상이다.
 * 곡선을 실제로 세우는 것은 여전히 {@link utilityHazardSlowTicks} 다.
 */
const UTILITY_HAZARD_RADIUS_CAP_CP = 200;

/** 효용 해저드의 실효 장판 반경. 강화 3축을 태우되 {@link UTILITY_HAZARD_RADIUS_CAP_CP} 로 자른다. */
function utilityHazardRadius(spec: FacilitySpec, ref: FacilityRef): number {
  const cap = scaleCp(spec.hazardRadius, UTILITY_HAZARD_RADIUS_CAP_CP);
  const scaled = scaleByRef(spec.hazardRadius, ref);
  return scaled > cap ? cap : scaled;
}

/**
 * 효용 해저드의 실효 활성 길이(틱). 강화 3축을 태우되 카탈로그 계약
 * `windupTicks + onTicks <= periodTicks` 를 넘지 않게 자른다 — 넘기면 다음 주기의 융기가
 * 이전 장판과 겹쳐 예열 리듬이 읽히지 않는다.
 *
 * 견인 자기장 기준 상한은 180 − 20 = **160**(기본 100 대비 1.6배)이라 lv7 부근에서 이미
 * 포화한다. 그래서 이 축 **단독으로는 강화축을 살리지 못하고**(실측 §연구 문서), 반경 축과
 * 함께 태워야 한다. 그럼에도 함께 태우는 이유는, 활성 길이가 늘면 "지나가다 스치는" 확률이
 * 저레벨 구간에서 먼저 올라 곡선의 앞부분이 매끄러워지기 때문이다.
 */
function utilityHazardOnTicks(spec: FacilitySpec, ref: FacilityRef): number {
  const cap = spec.periodTicks - spec.windupTicks;
  const scaled = scaleByRef(spec.onTicks, ref);
  return scaled > cap ? cap : scaled;
}

/**
 * 효용 해저드가 부여하는 감속 지속 상한 배율(centi-percent). 강화 3축의 곱은 시드 램프 최상단
 * (lv29 · rarity 3 · ascension 3)에서 6.3배까지 가는데, 기본 90틱(1.5초)을 그대로 6.3배 하면
 * 567틱(9.5초)이 되어 한 번 스치면 회랑 절반을 감속 상태로 지난다 — 회피라는 축이 사라진다.
 * 상한 300cp = 최대 270틱(4.5초)으로 자른다.
 */
const UTILITY_HAZARD_SLOW_CAP_CP = 300;

/**
 * 효용 해저드 1장이 부여할 감속 지속 틱. 0 이면 기본값(`PLAYER_SLOW_DURATION`)이라는 뜻이고,
 * 그 표식이 `hazard` 엔티티의 `aux0` 에 실린다(아래 {@link stepHazardFacility}).
 *
 * ## 왜 반경·활성 길이가 아니라 **이 축**이 본체인가 — 실측으로 고른 결과다
 * 세 후보를 따로 재 봤다(24시드 · `rarity 0` · `ascension 0` 레벨 단독 스윕):
 *   - **활성 길이(`onTicks`)** — 카탈로그 계약 `windup + on <= period` 때문에 상한이
 *     180 − 20 = **160**(기본 100 대비 1.6배)이라 **lv8 부근에서 포화**한다. 그 위로는 평탄.
 *   - **반경(`hazardRadius`)** — 상한을 200cp 로 두나 400cp 로 두나 **결과가 한 자리도 같았다.**
 *     원인은 밸런스가 아니라 broad-phase 다: 공간 해시(`SpatialHash`, 셀 256)는 엔티티를
 *     **중심 좌표의 셀 한 칸**에만 넣고, 플레이어 접촉 질의는 **플레이어 반경**으로만 셀을
 *     훑는다(`src/sim/world.ts` `resolveCollisions`). 그래서 장판 중심이 플레이어에서 대략
 *     한두 셀 밖이면 반경이 아무리 커도 **후보로 들어오지도 않는다** — 반경은 약 650 부근에서
 *     실효 상한을 만난다. (전역 broad-phase 를 고치면 화염·레이저·충격파 등 모든 해저드의
 *     명중이 한꺼번에 바뀐다. 이 레인 범위 밖이라 손대지 않는다.)
 *   - **감속 지속** — 기하와 무관하게 "한 번 잡히면 얼마나 오래 끌려 있나"를 직접 늘린다.
 *     세 후보 중 유일하게 시드 램프 전 구간(lv1~29)에서 여유가 남는다.
 * 그래서 셋 다 태우되 **곡선을 실제로 세우는 것은 감속 지속**이고, 앞의 둘은 저레벨 구간을
 * 매끄럽게 하는 보조축이다.
 */
function utilityHazardSlowTicks(ref: FacilityRef): number {
  const cap = scaleCp(PLAYER_SLOW_DURATION, UTILITY_HAZARD_SLOW_CAP_CP);
  const scaled = scaleByRef(PLAYER_SLOW_DURATION, ref);
  return scaled > cap ? cap : scaled;
}

/**
 * 주기 온오프 해저드 1기. 주기의 시작 틱마다 장판을 새로 융기시킨다 — 예열·활성 처리는 기존
 * `stepHazards`/`hazardActive`(world.ts)가 그대로 해 준다. 설비가 파괴되면 융기가 멈춰 장판이
 * 남은 활성 시간만큼만 지속된 뒤 사라진다.
 *
 * 위상은 소켓 인덱스에서 결정론 파생해(RNG 미소비) 격자가 일제히 켜지지 않게 엇갈린다.
 */
function stepHazardFacility(
  state: WorldState,
  e: Entity,
  spec: FacilitySpec,
  socketCount: number,
  ref: FacilityRef | null | undefined,
): void {
  const offset = socketPhaseOffset(e.dashCooldown, spec.periodTicks, socketCount);
  if (!isCycleSpawnTick(state.tick, spec.periodTicks, offset)) return;
  const hx = e.x + cos(e.targetX) * spec.hazardOffset;
  const hy = e.y + sin(e.targetX) * spec.hazardOffset;
  const utility = isUtilityHazard(spec) && ref !== null && ref !== undefined;
  const radius = utility ? utilityHazardRadius(spec, ref) : spec.hazardRadius;
  const onTicks = utility ? utilityHazardOnTicks(spec, ref) : spec.onTicks;
  const h = spawnHazard(
    state,
    spec.hazardSubtype,
    hx,
    hy,
    radius,
    spec.windupTicks,
    onTicks,
    e.damage,
    true, // 지속 피해 장판
    e.id,
  );
  // 감속 지속 표식. `hazard` kind 는 `aux0` 를 쓰지 않아 신규 해시 필드 없이 실을 수 있고,
  // **0 이면 기본값**이라 다른 모든 `HAZARD_SLOW` 생산자(니플헤임 보스 감속 지대 등)는
  // 이 줄을 지나지 않는다 → 비트 동일.
  if (utility) h.aux0 = utilityHazardSlowTicks(ref);
}

/**
 * 사출 지점을 창 진행 방향 앞으로 얼마나 더 밀어낼지(유닛). 창 반폭(960) **밖**이라
 * 드론은 화면 오른쪽 경계 밖에서 태어나 스스로 걸어 들어온다 — "예고 없이 눈앞에 나타나는"
 * 부당 스폰이 기하로 불가능하다(드론 반경 36 이라 여유 84).
 */
const SPAWNER_LEAD_MARGIN = 120;

/**
 * 사출 레인 삼각파의 반주기(틱). 소수라 소켓 위상 오프셋과 맞물려도 레인이 금방 겹치지 않는다.
 * RNG 미소비 규율(ADR-0005)상 흔들림은 `tick`·소켓 인덱스의 순수 삼각파로만 만든다.
 */
const SPAWNER_LANE_PERIOD = 97;

/** 소켓마다 레인 위상을 어긋내는 상수(틱). 12소켓이 한 줄로 사출하는 것을 막는다. */
const SPAWNER_LANE_SOCKET_PHASE = 37;

/**
 * 사출 레인의 y 진폭(유닛). 회랑 반높이 540 − 드론 반경 36 − 여유 84.
 * 이 값을 넘기면 직선형 회랑에서도 태어나자마자 벽에 겹친다.
 */
const SPAWNER_LANE_HALF = 420;

/** 사출 지점이 벽·프레스에 막혔을 때의 재시도 간격(틱). 레인 삼각파가 그 사이 옮겨간다. */
const SPAWNER_BLOCKED_RETRY_TICKS = 3;

/**
 * 드론 접촉 피해 상한. 참조 플레이어 최대 HP **211**
 * (`DEFAULT_CONFIG.playerHp` 151 + `GEAR_REFERENCE.maxHpAdd` 60) 아래로 못박는다.
 *
 * ⚠️ **상수는 그대로 120 이다 — 갱신된 것은 이 주석의 참조 HP 뿐이다**(2026-08-08).
 * 기본 HP 가 100 → 151 로 올라(`world.ts` §기체 기본 스탯 상향 · 누적 +51%) 참조 HP 가
 * 160 → 211 이 됐다. 불변식("상한 < 참조 HP")은 **안 깨졌고 오히려 여유가 넓어졌다** —
 * 상한이 참조 HP 에서 차지하는 비율이 `120/160 = 75%` → `120/211 = 57%` 로 내려갔다.
 * 즉 한 방에 죽는 것과의 거리가 멀어진 것이라 상한을 따라 올릴 이유가 없다.
 *
 * ⚠️ 넘기면 "L2 누적 피해" 지표가 설비가 아니라 **플레이어 HP 풀**을 재기 시작하고
 * (지문: `hits === deaths`) 그 위로 레벨·등급·승급이 전부 무효가 된다 —
 * `.omc/research/invasion-difficulty-restore-lane-2026-07-27.md` §3.2 가 정본이다.
 * 시드 램프 상한(lv29 · 등급 3 · 승급 3)의 실효값은 77 이라 이 상한에 닿지 않는다.
 * 상한이 무는 곳은 lv99 외삽 + 등급·승급 최대(207)뿐이다.
 */
const SPAWNER_DRONE_DAMAGE_CAP = 120;


/**
 * 이번 틱의 사출 레인 y(정수, 창 중심 기준 상대). `tick`·소켓 인덱스만의 순수 삼각파라
 * RNG·wall-clock 을 소비하지 않는다(ADR-0005).
 */
function launchLaneY(tick: number, socketIndex: number): number {
  const span = SPAWNER_LANE_PERIOD * 2;
  const t = (((tick + socketIndex * SPAWNER_LANE_SOCKET_PHASE) % span) + span) % span;
  const tri = t < SPAWNER_LANE_PERIOD ? t : span - t; // 0 .. PERIOD
  return Math.trunc((tri * 2 * SPAWNER_LANE_HALF) / SPAWNER_LANE_PERIOD) - SPAWNER_LANE_HALF;
}

/** 좌표가 활성 벽(정적 회랑 벽 + 프레스 이동 벽)에 겹치는가. */
function launchBlocked(state: WorldState, x: number, y: number, radius: number): boolean {
  for (const w of state.activeWalls) {
    if (circleOverlapsWall(x, y, radius, w)) return true;
  }
  return false;
}

/**
 * 드론 스포너 1기. 파괴 전까지 소형 드론을 생산한다. 스폰은 반드시 `summonEnemy`(RNG 미소비)
 * 경유 — `spawnEnemy` 는 `waveRng` 를 소비해 침공 결정론 규율을 깬다.
 *
 * 동시 생존 상한은 {@link SPAWNER_OWNER_FIELD 자식 표식}으로 자기 자식만 세어 판정한다
 * (다른 스포너와 간섭 없음).
 *
 * ## 왜 소켓이 아니라 **창 앞**에 사출하는가 (2026-07-28 재설계)
 * 예전에는 소켓 옆(`spawnOffset`)에 낳았다. 그런데 L2 는 **강제 스크롤 720 u/s** 이고 로스터
 * 최고 적 이동 속도가 **420 u/s** 다 — 뒤에 태어난 드론은 초당 420유닛씩 영구히 뒤처진다.
 * 24시드에 1,327기를 낳고도 최근접 드론 평균 거리가 **15,203 유닛**, L2 누적 피해가
 * **12**(= 사실상 0)였고, 레벨·등급·승급을 아무리 올려도 값이 움직이지 않았다.
 * 정본: `.omc/research/invasion-spawner-redesign-2026-07-28.md`.
 *
 * 그래서 사출 지점을 **스크롤 창 진행 방향 바로 앞**(창 밖 {@link SPAWNER_LEAD_MARGIN})으로
 * 옮겼다. 속도 문제를 우회하면서 "회랑에 병력을 흩뿌린다"는 정체성은 그대로다 — 드론은 화면
 * 경계 밖에서 태어나 정면으로 마주 온다. 대신 소켓과의 공간 인과가 끊기지 않도록
 * **활성 사거리(`spec.range`)** 를 뒀다: 플레이어가 그 안에 있는 동안만 사출한다.
 */
function stepSpawnerFacility(
  state: WorldState,
  e: Entity,
  spec: FacilitySpec,
  maintenance: number,
  mods: DefenseAffixMods,
  ctx: InvasionStepContext,
  player: Entity,
): void {
  if (e.aux0 === 0) return; // 소환 수 소진(무한이면 -1 이라 여기 걸리지 않는다)
  if (e.aux1 > 0) {
    e.aux1--;
    return;
  }
  // 활성 사거리 — 밖이면 생산하지 않는다(방어포와 같은 규율). `range === 0` 은 사거리 개념이
  // 없던 시절의 스펙이라 무제한으로 둔다(구 카탈로그 호환).
  if (spec.range > 0) {
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    if (dx * dx + dy * dy > spec.range * spec.range) {
      e.aux1 = SPAWNER_RETRY_TICKS;
      return;
    }
  }
  let alive = 0;
  for (const other of state.entities) {
    if (other.kind === 'enemy' && !other.dead && other.aux1 === e.id) alive++;
  }
  // 방어체 어픽스 `defSpawnCapFlat` 과 밀도 `l2SpawnAliveAdd` 는 **같은 가산 축**이다 — 어픽스가
  // 절대량 가산이라 밀도도 나란히 더해 자연스럽게 합쳐지게 한다(density.ts 필드 주석).
  // 기본값 0 이면 `+0` 이라 비트 동일.
  if (alive >= affixSpawnCap(spec.spawnMaxAlive, mods) + ctx.density.l2SpawnAliveAdd) {
    e.aux1 = SPAWNER_RETRY_TICKS;
    return;
  }
  const def = ENEMY_BY_TYPE[spec.spawnEnemyType];
  if (def === undefined) return;
  const point = launchPoint(state, ctx, e, spec, def.radius);
  if (point === undefined) {
    // 이번 틱 레인이 벽·프레스에 막혔다. 쿨다운을 태우지 않고 곧 다시 시도한다.
    e.aux1 = SPAWNER_BLOCKED_RETRY_TICKS;
    return;
  }
  const drone = summonEnemy(state, def, point.x, point.y);
  // 생산자 표식 — 필드 선택 근거는 {@link SPAWNER_OWNER_FIELD} 주석(`ownerId` 금지).
  drone.aux1 = e.id;
  // 강화 3축·어픽스를 **생산물**에 싣는다. 예전에는 스포너의 레벨·등급·승급이 설비 내구도만
  // 바꿔 기여 축이 통째로 사문화돼 있었다(`gravwell` 과 같은 계열의 누락).
  //   - 접촉 피해: 설비 `e.damage`(= 드론 접촉 피해의 실효값, `resolveFacilityStats` 가 파생하고
  //     어픽스가 매 틱 다시 접는다). 상한은 {@link SPAWNER_DRONE_DAMAGE_CAP}.
  //   - 내구도: 스폰 시 `e.timer` 에 굳혀 둔 `FacilityStats.droneHp`.
  // 촉매·스테이지 배율은 `summonEnemy` 가 로스터 기본값에 이미 곱해 뒀으므로 **비율로** 옮겨
  // 실어 그 효력을 잃지 않는다(촉매 중립이면 비율이 1 이라 항등).
  if (e.damage > 0) {
    const capped = e.damage > SPAWNER_DRONE_DAMAGE_CAP ? SPAWNER_DRONE_DAMAGE_CAP : e.damage;
    drone.damage = capped * state.catalystMods.enemyDamage;
  }
  if (e.timer > 0 && def.hp > 0) {
    const hp = Math.round((drone.hp * e.timer) / def.hp);
    drone.hp = hp;
    drone.maxHp = hp;
  }
  if (e.aux0 > 0) e.aux0--;
  e.aux1 = affixCooldown(
    invasionFireCooldown(spec.spawnIntervalTicks, affixMaintenance(maintenance, mods)),
    mods,
  );
}

/**
 * 이번 틱의 사출 좌표. 스크롤 축이 있으면 **창 진행 방향 앞**, 없으면(고정 카메라·단위 테스트)
 * 예전과 같은 소켓 옆 `spawnOffset` 자리다. 벽·프레스에 겹치면 `undefined`.
 */
function launchPoint(
  state: WorldState,
  ctx: InvasionStepContext,
  e: Entity,
  spec: FacilitySpec,
  droneRadius: number,
): { readonly x: number; readonly y: number } | undefined {
  const axis = scrollAxisFor(ctx.runtime.phase);
  let x: number;
  let y: number;
  if (axis === SCROLL_AXIS_HORIZONTAL) {
    const dir = INVASION_SCROLL_DIR[ctx.runtime.phase] ?? 1;
    x = windowCenterX(ctx.runtime) + dir * (INVASION_WINDOW_HALF_W + SPAWNER_LEAD_MARGIN);
    y = windowCenterY(ctx.runtime) + launchLaneY(state.tick, e.dashCooldown);
  } else if (axis === SCROLL_AXIS_VERTICAL) {
    const dir = INVASION_SCROLL_DIR[ctx.runtime.phase] ?? -1;
    x = windowCenterX(ctx.runtime) + launchLaneY(state.tick, e.dashCooldown);
    y = windowCenterY(ctx.runtime) + dir * (INVASION_WINDOW_HALF_H + SPAWNER_LEAD_MARGIN);
  } else {
    x = e.x + cos(e.targetX) * spec.spawnOffset;
    y = e.y + sin(e.targetX) * spec.spawnOffset;
  }
  if (launchBlocked(state, x, y, droneRadius)) return undefined;
  return { x, y };
}

/** 템플릿 조회 재수출(하네스·렌더가 소켓 좌표를 읽을 때 쓴다). */
export type { InvasionMapTemplate };
export { mapTemplateFor };
