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
 *    침공에서 절대 쓰지 않는다.
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
 * | `timer` | 발사 카운트다운 | — (주기는 틱의 순수 함수) | — |
 * | `phase` | 0 대기 / 1 예고선(조준각 잠금) | — | — |
 * | `angle` | 조준각(예고 중 잠긴 값 · 렌더) | — | — |
 * | `aux0` | — | 해저드 subtype(렌더) | 남은 소환 수(-1 = 무한) |
 * | `aux1` | — | — | 다음 소환까지 틱 |
 * | `damage` | 실효 발당 피해 | 실효 틱당 장판 피해 | — |
 * | `hp`/`maxHp`/`radius` | 실효 내구도·히트박스 | 〃 | 〃 |
 */

import type { Entity, EntityKind } from '../entities.js';
import { blankEntity, addEntity, spawnEnemyBullet, spawnHazard, spawnWall } from '../entities.js';
import type { WorldState } from '../world.js';
import { atan2, cos, sin, wrapAngle, PI } from '../math.js';
import { segmentBlocked } from '../los.js';
import { normalizeMaintenance } from './guardian.js';
import { invasionFireCooldown } from './guardianBridge.js';
import { summonEnemy } from '../waves.js';
import { ENEMY_BY_TYPE } from '../../../data/enemies.js';
import type { FacilitySpec } from '../../../data/invasion/facilities.js';
import {
  facilitySpecFor,
  FACILITY_BEHAVIOR_HAZARD,
  FACILITY_BEHAVIOR_SPAWNER,
} from '../../../data/invasion/facilities.js';
import type { InvasionMapTemplate, InvasionSocketDef } from '../../../data/invasion/mapTemplates.js';
import { mapTemplateFor } from '../../../data/invasion/mapTemplates.js';
import { isCycleSpawnTick, socketPhaseOffset } from './hazardCycle.js';
import type { FacilityRef, InvasionStepContext } from './types.js';

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
}

/** 정수 배율 1단계: round(base * cp / 100). base·cp 가 정수면 결과도 정수다. */
function scaleCp(base: number, cp: number): number {
  if (cp === 100) return base;
  return Math.round((base * cp) / 100);
}

/**
 * 배치 Ref(레벨·승급·등급)와 정비도로 실효 스탯을 파생한다.
 *
 * 배율은 곱을 f64 로 누적하지 않고 **단계마다 정수로 반올림**한다(레벨 → 등급 → 승급 순).
 * 순서가 계약이다 — 바꾸면 값이 달라져 클라·서버 재실행이 갈린다.
 *
 * 정비도 풍화(ADR-0006, 결정 #18)는 구 포탑과 동일하게 **발사/생산 간격**에만 적용한다
 * (`invasionFireCooldown`) — 피해를 건드리면 충돌 판정 f64 산술에 오차가 섞인다.
 */
export function resolveFacilityStats(
  spec: FacilitySpec,
  ref: FacilityRef,
  maintenance: number,
): FacilityStats {
  const levelCp = 100 + (ref.level - 1) * LEVEL_STEP_CP;
  const rarityCp = RARITY_CP[ref.rarity] ?? 100;
  const ascCp = 100 + ref.ascension * ASCENSION_STEP_CP;
  const scale = (base: number): number => scaleCp(scaleCp(scaleCp(base, levelCp), rarityCp), ascCp);
  const rawDamage = spec.behavior === FACILITY_BEHAVIOR_HAZARD ? spec.hazardDamage : spec.damage;
  return {
    hp: scale(spec.hp),
    damage: scale(rawDamage),
    fireCooldown: invasionFireCooldown(spec.fireCooldown, maintenance),
    spawnInterval: invasionFireCooldown(spec.spawnIntervalTicks, maintenance),
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
): Entity | undefined {
  const spec = facilitySpecFor(ref.catalogId);
  if (spec === undefined) return undefined;
  const stats = resolveFacilityStats(spec, ref, maintenance);
  const facing = socket.facingDeg * DEG_TO_RAD;
  const e = blankEntity(kindForBehavior(spec.behavior));
  e.x = socket.x;
  e.y = socket.y;
  e.enemyType = ref.catalogId;
  e.radius = spec.radius;
  e.hp = stats.hp;
  e.maxHp = stats.hp;
  e.damage = stats.damage;
  e.angle = facing; // 초기 조준각 = 정면(렌더 기본자세)
  e.targetX = facing; // 사계·융기·사출 기준 방향
  e.pierce = socket.arcDeg; // 사계 전체 폭(정수 도)
  e.dashCooldown = socketIndex; // 소켓 인덱스(주기 위상 파생 키)
  e.phase = 0;
  e.life = -1; // 시간으로 소멸하지 않는다
  switch (spec.behavior) {
    case FACILITY_BEHAVIOR_SPAWNER:
      e.aux0 = SPAWN_BUDGET_UNLIMITED; // 파괴 전까지 무제한 생산
      e.aux1 = stats.spawnInterval; // 다음 소환까지 틱
      break;
    case FACILITY_BEHAVIOR_HAZARD:
      e.aux0 = spec.hazardSubtype; // 렌더 분화용 subtype
      break;
    default:
      e.timer = stats.fireCooldown;
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
    spawnFacility(state, template.sockets[i]!, i, ref, maintenance);
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
  const player = findPlayer(state);
  if (player === undefined) return;
  const maintenance = normalizeMaintenance(ctx.maintenance);
  const template = mapTemplateFor(ctx.layers.l2.templateId);
  const socketCount = template.sockets.length;
  const n = state.entities.length;
  for (let i = 0; i < n; i++) {
    const e = state.entities[i]!;
    if (e.dead) continue;
    if (e.kind === FACILITY_GUN_KIND) {
      const spec = facilitySpecFor(e.enemyType);
      if (spec !== undefined) stepTurretFacility(state, e, spec, player, maintenance);
    } else if (e.kind === FACILITY_HAZARD_KIND) {
      const spec = facilitySpecFor(e.enemyType);
      if (spec !== undefined) stepHazardFacility(state, e, spec, socketCount);
    } else if (e.kind === FACILITY_SPAWNER_KIND) {
      const spec = facilitySpecFor(e.enemyType);
      if (spec !== undefined) stepSpawnerFacility(state, e, spec, maintenance);
    }
  }
}

/**
 * 방향 제한 방어포 1기. 사거리 → **사계** → 벽 LOS 순으로 게이트하고, 예고선 스펙이 있으면
 * 조준각을 잠근 뒤 예고 구간을 소화하고 쏜다(예고 중에는 탄이 없어 피해도 없다).
 *
 * 사거리·사계 밖이면 카운트다운을 **유지**한다(구 포탑과 동일 규율 — 사정권 진입 시 즉발).
 */
function stepTurretFacility(
  state: WorldState,
  e: Entity,
  spec: FacilitySpec,
  player: Entity,
  maintenance: number,
): void {
  // 예고선 소화 중: 잠긴 각도로만 발사한다(플레이어가 사계 밖으로 나가도 예고분은 나간다).
  if (e.phase === 1) {
    if (e.timer > 0) {
      e.timer--;
      return;
    }
    fireFacilityBullets(state, e, spec, e.angle);
    e.phase = 0;
    e.timer = moduleFacilityCooldown(state, invasionFireCooldown(spec.fireCooldown, maintenance));
    return;
  }
  if (e.timer > 0) {
    e.timer--;
    return;
  }
  const dx = player.x - e.x;
  const dy = player.y - e.y;
  if (dx * dx + dy * dy > spec.range * spec.range) return;
  const ang = atan2(dy, dx);
  if (!withinArc(e.targetX, e.pierce, ang)) return;
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
  e.timer = moduleFacilityCooldown(state, invasionFireCooldown(spec.fireCooldown, maintenance));
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

/** 단발 또는 부채꼴 다발 발사(정수 도 → 라디안 변환은 여기서 1회). */
function fireFacilityBullets(state: WorldState, e: Entity, spec: FacilitySpec, ang: number): void {
  const damage = moduleFacilityDamage(state, e.damage);
  const pellets = spec.pellets < 1 ? 1 : spec.pellets;
  const spread = spec.spreadDeg * DEG_TO_RAD;
  const start = pellets > 1 ? ang - spread / 2 : ang;
  const step = pellets > 1 ? spread / (pellets - 1) : 0;
  for (let i = 0; i < pellets; i++) {
    const a = start + step * i;
    spawnEnemyBullet(
      state,
      e.x,
      e.y,
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
): void {
  const offset = socketPhaseOffset(e.dashCooldown, spec.periodTicks, socketCount);
  if (!isCycleSpawnTick(state.tick, spec.periodTicks, offset)) return;
  const hx = e.x + cos(e.targetX) * spec.hazardOffset;
  const hy = e.y + sin(e.targetX) * spec.hazardOffset;
  spawnHazard(
    state,
    spec.hazardSubtype,
    hx,
    hy,
    spec.hazardRadius,
    spec.windupTicks,
    spec.onTicks,
    e.damage,
    true, // 지속 피해 장판
    e.id,
  );
}

/**
 * 드론 스포너 1기. 파괴 전까지 소형 드론을 생산한다. 스폰은 반드시 `summonEnemy`(RNG 미소비)
 * 경유 — `spawnEnemy` 는 `waveRng` 를 소비해 침공 결정론 규율을 깬다.
 *
 * 동시 생존 상한은 `ownerId` 로 자기 자식만 세어 판정한다(다른 스포너와 간섭 없음).
 */
function stepSpawnerFacility(
  state: WorldState,
  e: Entity,
  spec: FacilitySpec,
  maintenance: number,
): void {
  if (e.aux0 === 0) return; // 소환 수 소진(무한이면 -1 이라 여기 걸리지 않는다)
  if (e.aux1 > 0) {
    e.aux1--;
    return;
  }
  let alive = 0;
  for (const other of state.entities) {
    if (other.kind === 'enemy' && !other.dead && other.ownerId === e.id) alive++;
  }
  if (alive >= spec.spawnMaxAlive) {
    e.aux1 = SPAWNER_RETRY_TICKS;
    return;
  }
  const def = ENEMY_BY_TYPE[spec.spawnEnemyType];
  if (def === undefined) return;
  const sx = e.x + cos(e.targetX) * spec.spawnOffset;
  const sy = e.y + sin(e.targetX) * spec.spawnOffset;
  const drone = summonEnemy(state, def, sx, sy);
  drone.ownerId = e.id; // 생산자 표식(동시 생존 상한 판정 키)
  if (e.aux0 > 0) e.aux0--;
  e.aux1 = invasionFireCooldown(spec.spawnIntervalTicks, maintenance);
}

/** 템플릿 조회 재수출(하네스·렌더가 소켓 좌표를 읽을 때 쓴다). */
export type { InvasionMapTemplate };
export { mapTemplateFor };
