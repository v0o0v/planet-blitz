/**
 * 추격·탈출(chase) 모드 — Lane6 (ADR-0021 §2.4). 비-스크롤 **자유추적** 모드.
 * 무적 포식자(boss.aux0=0)가 끝없이 추격하고, 맵의 **반격 장치**(파괴가능 오브젝트)를 전부
 * 파괴하면 포식자가 취약화(aux0=1)되어 보스전으로 전환된다. 진행은 **대피소** 도달로 세그먼트를
 * 넘고, 승리는 취약해진 포식자 처치(공통 compact→victory 재사용)다. 무적 포식자 접촉 =
 * 회피 불가 실패(iframes 무시). 서바이벌 코어(웨이브 디렉터·파워업·드랍)는 불변, 진행/승리/실패
 * 게이트만 추격 규칙으로 바꾼다. 전 계수는 플레이스홀더 — TODO(밸런스): 출시 전 일괄 튜닝.
 *
 * ## 신규 WorldState 필드 0 (Lane4/5/8 철학 계승)
 * 추격 상태는 전부 **엔티티 + boss/노드 aux**에 싣는다:
 *   - 포식자 = `boss` kind, createWorld 에서 스폰(`aux0=0` 무적), `updateBoss` 가 이미 매 틱 추격.
 *     취약화 = `aux0=1`(정수, hashEntity 조건부 꼬리에 접힘).
 *   - 반격 장치 = `destructible` + `ownerId === COUNTER_DEVICE_MARK`(센티넬, CONTAMINATION_NODE_MARK
 *     선례). 살아있는 장치 수 = 파생(필드 불요). 아군탄 파괴 = destructible 기존 드랍 경로.
 *   - 대피소 = 신규 kind `shelter`(inert, boostPad 선례). `aux0` = 세그먼트 인덱스.
 *   - 시야 = snapshot 필드(`chaseVisionRadius`) — sim 이 값을 정하고 렌더가 암흑/안개로 쓴다(art 후속).
 * → 신규 WorldState 필드 없음 → hashWorld 폴드 없음. boss.aux0(정수)·엔티티가 이미 해시에 접힌다.
 *   추격은 `planetMode === chase` 게이트라 뱀서류·침공·블록격파·레이싱·오염 바이트 불변.
 *
 * ## 결정론(ADR-0005)
 * RNG·Date.now·전역을 쓰지 않는다. 배치는 고정 좌표(플레이어 시작 0,0 주변 링, 결정론 트리그
 * `cos`/`sin`). aux0 은 **정수 필수**(hashU32 로 접힘 — 소수부 유실). 배치·판정 모두 순수.
 *
 * ## 순환 의존 주의
 * world.ts / waves.ts / snapshot.ts 가 이 모듈을 런타임 import 하므로, 이 모듈은 world 에서
 * **타입만** 가져온다(`import type`). 런타임 의존은 leaf 모듈(entities·math·planetMode)과
 * 데이터 레지스트리(planetContent — world 를 import 하지 않는다)로만(contamination/racing 선례).
 */
import type { Entity } from '../entities.js';
import { spawnBoss, spawnDestructible, spawnShelter } from '../entities.js';
import type { WorldState } from '../world.js';
import { PLANET_MODE, type PlanetMode } from '../planetMode.js';
import { planetContent } from '../../../data/planets/index.js';
import { cos, sin, TWO_PI } from '../math.js';

// --- 플레이스홀더 계수 (TODO(밸런스): 출시 전 일괄 튜닝, 구조만 고정) ---
/** 추격 시야 반경(월드 유닛). 렌더가 이 값으로 암흑/안개 오버레이(art 후속). TODO(밸런스). */
export const CHASE_VISION_RADIUS = 1400;
/** 포식자 초기 스폰 위치(플레이어 시작 0,0 대비 위쪽 offset). moveBoss 가 곧 추격 궤도로 당긴다. TODO(밸런스). */
export const CHASE_PREDATOR_SPAWN_OFFSET = 1200;
/** 반격 장치 수(전부 파괴 = 포식자 취약화 조건). TODO(밸런스). */
export const CHASE_COUNTER_DEVICE_COUNT = 5;
/** 반격 장치 HP(아군탄이 깎아 파괴). TODO(밸런스). */
export const CHASE_COUNTER_DEVICE_HP = 40;
/** 반격 장치 반경(조준·피격 판정). TODO(밸런스). */
export const CHASE_COUNTER_DEVICE_RADIUS = 70;
/** 반격 장치 파괴 시 드랍 젬 XP(destructible 기존 드랍 경로). TODO(밸런스). */
export const CHASE_COUNTER_DEVICE_GEM_XP = 6;
/** 반격 장치 배치 링 반경(플레이어 시작 0,0 주변). TODO(밸런스). */
export const CHASE_COUNTER_DEVICE_RING_RADIUS = 1100;
/** 대피소 수(= 일반 세그먼트 수 5, 각 aux0=세그먼트 인덱스). TODO(밸런스). */
export const CHASE_SHELTER_COUNT = 5;
/** 대피소 반경(도달 판정, 관대). TODO(밸런스). */
export const CHASE_SHELTER_RADIUS = 140;
/** 대피소 배치 링 반경(플레이어 시작 0,0 주변). TODO(밸런스). */
export const CHASE_SHELTER_RING_RADIUS = 1600;

/**
 * 반격 장치 마커(ownerId 센티넬). 절차 청크 destructible(ownerId=0)·오염 노드와 구분해
 * ① 살아있는 장치 카운트(취약화 게이트)와 ② isGimmick 청크 컬링 제외에 쓴다. 기존 7개 마커
 * (DRONE 0xd4090e·BROOD 0xb400d5·MISSILE 0x3155110·HIVE 0x81ce77·SPLIT 0xf12a6·
 * RACING_WALL 0x4ac1a6·CONTAMINATION_NODE 0xc0f7a1)와 전부 다르다. 이 값은 추격 런에만
 * 등장한다(그 외 destructible 은 ownerId=0/오염 마커라 조건 그대로 성립 → 거동·해시 불변).
 */
export const COUNTER_DEVICE_MARK = 0xc07e5d;

/** 반격 장치인가(파괴가능 오브젝트 + 반격 마커). 절차 청크 destructible(ownerId=0)·오염 노드는 false. */
export function isCounterDevice(e: Entity): boolean {
  return e.kind === 'destructible' && e.ownerId === COUNTER_DEVICE_MARK;
}

/** 대피소인가(신규 inert kind). */
export function isShelter(e: Entity): boolean {
  return e.kind === 'shelter';
}

/** 포식자(boss)가 무적인가 = 취약화 전(aux0===0). 취약(aux0===1) 후엔 아군탄이 처치할 수 있다. */
export function isPredatorInvincible(boss: Entity): boolean {
  return boss.aux0 === 0;
}

/** 살아있는 반격 장치 수. 0 이면 포식자 취약화(updateChasePredator). 순수 판정. */
export function chaseAliveCounterDevices(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) {
    if (!e.dead && isCounterDevice(e)) n++;
  }
  return n;
}

/**
 * 추격 코스를 고정(RNG 없는) 결정론 좌표에 배치한다(createWorld 1회). ① 무적 포식자(boss,
 * aux0=0)를 플레이어 시작(0,0) 위쪽 offset 에 스폰하고 `state.bossSpawned=true` 를 세워 stepBoss
 * 가 두 번째 보스를 세우지 않게 한다. ② 반격 장치 N개(destructible + 마커)를 원점 링에 배치한다.
 * ③ 대피소 N개(shelter kind, aux0=세그먼트 인덱스)를 원점 링에 배치한다. 배치는 인덱스만의
 * 함수(결정론 트리그)라 같은 필드가 항상 동일 배치다 — 시드·해시 스트림에 영향이 없다.
 *
 * `state.entities` 에 append 하는데, 플레이어는 이미 index 0 에 있으므로 hashWorld 불변식이
 * 유지된다(createWorld 가 state 완성 후 호출).
 */
export function placeChaseCourse(state: WorldState): void {
  const planet = state.config.planet ?? 0;
  const bossDef = planetContent(planet).boss;
  // ① 포식자 = boss kind. 행성 보스 정의로 hp/radius, enemyType=planet(렌더 스프라이트 분화),
  //    aux0=0(무적). moveBoss(boss.ts)가 매 틱 플레이어를 향해 추격한다.
  const predator = spawnBoss(state, 0, -CHASE_PREDATOR_SPAWN_OFFSET, bossDef.hp, bossDef.radius);
  predator.damage = bossDef.contactDamage;
  predator.enemyType = planet;
  predator.aux0 = 0; // 무적(취약화 전) — blankEntity 기본 0 이지만 계약을 명시.
  state.bossSpawned = true; // stepBoss 가 두 번째 보스를 세우지 않는다(포식자가 곧 보스다).

  // ② 반격 장치(destructible + MARK). 전부 파괴 = 취약화 조건. 원점 링 고정 배치(RNG 없음).
  for (let i = 0; i < CHASE_COUNTER_DEVICE_COUNT; i++) {
    const angle = (i * TWO_PI) / CHASE_COUNTER_DEVICE_COUNT;
    const x = cos(angle) * CHASE_COUNTER_DEVICE_RING_RADIUS;
    const y = sin(angle) * CHASE_COUNTER_DEVICE_RING_RADIUS;
    const dev = spawnDestructible(
      state,
      x,
      y,
      CHASE_COUNTER_DEVICE_RADIUS,
      CHASE_COUNTER_DEVICE_HP,
      CHASE_COUNTER_DEVICE_GEM_XP,
    );
    dev.ownerId = COUNTER_DEVICE_MARK;
  }

  // ③ 대피소(shelter kind, aux0=세그먼트 인덱스). 도달 = 세그먼트 전진(chaseShelterReached).
  for (let i = 0; i < CHASE_SHELTER_COUNT; i++) {
    const angle = (i * TWO_PI) / CHASE_SHELTER_COUNT;
    const x = cos(angle) * CHASE_SHELTER_RING_RADIUS;
    const y = sin(angle) * CHASE_SHELTER_RING_RADIUS;
    const shelter = spawnShelter(state, x, y, CHASE_SHELTER_RADIUS);
    shelter.aux0 = i; // 세그먼트 인덱스 대응(정수).
  }
}

/**
 * 추격 포식자 취약화 한 틱(stepWorld 배선, compact 이후 호출 — 이번 틱 파괴된 장치 반영).
 * 살아있는 반격 장치가 0개면 포식자(boss) `aux0=1`(취약)로 전환한다 → 이제 아군탄이 hp 를
 * 깎아 처치할 수 있고, compact 가 보스 처치를 victory 로 잡는다(공통 경로 재사용). 장치가
 * 하나라도 남아 있으면 무적을 유지한다. 순수(엔티티 aux 만 변경).
 */
export function updateChasePredator(state: WorldState): void {
  if (chaseAliveCounterDevices(state) > 0) return;
  for (const e of state.entities) {
    if (e.kind === 'boss') e.aux0 = 1; // 취약(아군탄 피해 가능).
  }
}

/**
 * 대피소 도달 여부(세그먼트 전진 게이트, waves.ts 배선). 플레이어(entities[0])가 `aux0 ===
 * segmentIndex` 인 대피소와 overlap 하면 true. 순수 판정 — 상태를 바꾸지 않는다. 플레이어
 * 부재면 false.
 */
export function chaseShelterReached(state: WorldState, segmentIndex: number): boolean {
  const player = state.entities[0];
  if (player === undefined) return false;
  for (const e of state.entities) {
    if (e.dead || !isShelter(e) || e.aux0 !== segmentIndex) continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const rr = e.radius + player.radius;
    if (dx * dx + dy * dy <= rr * rr) return true;
  }
  return false;
}

/**
 * 시야 반경(snapshot 용, 렌더 전용 — 해시 무관). chase 면 `CHASE_VISION_RADIUS`, 그 외 0(무제한).
 * sim 이 정수 상태로 값을 정하고, 렌더가 이 값으로 암흑/안개 오버레이를 그린다(렌더 세부는 art 후속).
 */
export function chaseVisionRadius(mode: PlanetMode | undefined): number {
  return mode === PLANET_MODE.chase ? CHASE_VISION_RADIUS : 0;
}
