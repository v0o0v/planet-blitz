/**
 * 침공 방어 배치 — 방어 엔티티(포탑 6종·코어)와 결정론 거동 (M4 plan Phase C1/C2).
 *
 * 갈림길③A(계획 §2): 방어 배치(포탑·장애물·코어)는 침공 런 config의 **정적 스폰 데이터**다.
 * createWorld가 이 데이터로 방어 엔티티를 스폰하면, 침공은 PvE와 동일한 결정론 시뮬 코어에
 * 방어 엔티티를 더한 런이 되어 서버가 [시드+입력+config]로 전수 재실행할 수 있다(ADR-0005).
 *
 * 결정론(ADR-0005): 포탑 거동은 위치·타이머의 순수 함수다. RNG를 뽑지 않으며 wall-clock을
 * 읽지 않는다. 조준각은 결정론 math(atan2/cos/sin), 발사 판정은 사거리·엔티티 배열 순서·벽
 * LOS(segmentBlocked)로만 결정한다. 상태이상(냉기)·미사일(제한 선회 유도)은 M3 산출물을
 * 그대로 재사용한다(status.ts의 HAZARD_SLOW 감속 지대, bullets.ts의 BK_HOMING).
 *
 * 필드 재활용(entities.ts Entity 플랫 구조 — 신규 Entity 필드 없음, hashEntity 레이아웃 불변):
 *   - defenseTurret: `enemyType` = 포탑 유형(0..5), `cooldown` = 발사 쿨다운 카운트다운,
 *     `hp/maxHp` = 내구도, `radius` = 히트박스. 조준은 매 틱 플레이어 위치로 재계산(무상태).
 *   - core: `hp/maxHp` = 코어 내구도, `radius` = 히트박스. 파괴(hp<=0) 시 compact가 victory.
 *   - 장애물: 기존 `wall` kind 재사용(계획 §C1 "기존 벽 메커닉 재사용"). spawnWall이 이동·탄·
 *     LOS 차단을 모두 제공하므로 신규 차단 코드가 없다.
 *
 * 이 모듈은 sim 리프에 가깝다: 런타임 의존은 entities/bullets/math/patterns(HAZARD_SLOW 상수)/
 * los 뿐이고, WorldState는 **type-only** import(status.ts와 동일 규율)라 world ↔ defense 런타임
 * 사이클이 없다.
 */

import type { WorldState } from './world.js';
import type { Entity, EntitySink } from './entities.js';
import { blankEntity, addEntity, spawnEnemyBullet, spawnHazard, spawnWall } from './entities.js';
import { applyBehavior, homingBehavior } from './bullets.js';
import { HAZARD_SLOW } from './patterns/types.js';
import { atan2, cos, sin } from './math.js';
import { segmentBlocked } from './los.js';

// ---------------------------------------------------------------------------
// 포탑 유형 코드 (defenseTurret.enemyType 에 저장; 절대 재번호 금지 — 배치 JSON 계약)
// ---------------------------------------------------------------------------
/** ① 발칸: 단일 연사 기본. */
export const TURRET_VULCAN = 0;
/** ② 저격: 장거리 고피해 저속(연사 느림·탄속 빠름·고피해). */
export const TURRET_SNIPER = 1;
/** ③ 산탄: 근거리 부채꼴 다발. */
export const TURRET_SHOTGUN = 2;
/** ④ 감속: 냉기장 — 플레이어 위치에 감속 장판(HAZARD_SLOW) 융기(M3 감속 재사용). */
export const TURRET_FROST = 3;
/** ⑤ 미사일: 제한 선회 유도(M3 BK_HOMING 재사용). */
export const TURRET_MISSILE = 4;
/** ⑥ 전격: 연쇄 다수 약공(부채꼴 고속 약탄 다발). */
export const TURRET_TESLA = 5;
/** 확정된 포탑 유형 수(§8 OQ-M4-1 확정). */
export const TURRET_TYPE_COUNT = 6;

/**
 * 포탑 1종의 스펙. 밸런스 표(계획 §5) 기준 **초기 추정값** — 코어 방어 vs 침공 3분 제한의
 * 균형은 M5 밸런싱 패스에서 확정한다(주석의 값은 튜닝 대상). 필드가 모든 유형에 다 쓰이지는
 * 않는다(미사용은 0). `cost`는 방어 배치 에디터(C3)의 배치 포인트 예산제가 읽는다.
 */
export interface TurretSpec {
  /** 유형 이름(디버그·에디터 라벨). */
  readonly name: string;
  /** 배치 포인트 비용(에디터 예산제, 계획 §5 — 전원 동일 예산에서 차감). */
  readonly cost: number;
  /** 내구도(플레이어 탄에 파괴됨). */
  readonly hp: number;
  /** 히트박스 반지름(월드 유닛). */
  readonly radius: number;
  /** 조준 사거리(유닛). 이 밖의 플레이어는 무시(발사 보류). */
  readonly range: number;
  /** 발사 간격(틱). 클수록 저속 연사. */
  readonly fireCooldown: number;
  /** 발당 피해(감속 포탑은 장판 피해). */
  readonly damage: number;
  /** 탄속(유닛/초). 감속 포탑은 미사용(0). */
  readonly bulletSpeed: number;
  /** 탄 반지름. */
  readonly bulletRadius: number;
  /** 탄 수명(틱). */
  readonly bulletLife: number;
  /** 부채꼴 발수(산탄·전격; 그 외 1). */
  readonly pellets: number;
  /** 부채꼴 총 벌어짐(라디안; 산탄·전격). */
  readonly spread: number;
  /** 감속 장판 반지름(감속 포탑 전용; 그 외 0). */
  readonly hazardRadius: number;
  /** 감속 장판 예열 틱(감속 포탑 전용). */
  readonly hazardWindup: number;
  /** 감속 장판 활성 틱(감속 포탑 전용). */
  readonly hazardActive: number;
  /** 유도 락 지속 틱(미사일 포탑 전용; 그 외 0). */
  readonly lockTicks: number;
  /** 유도 최대 선회율(라디안/틱; 미사일 포탑 전용). */
  readonly turnRate: number;
}

/**
 * 포탑 6종 스펙 테이블. 인덱스 = 유형 코드(TURRET_*). **초기 밸런스 추정값**(계획 §5,
 * 튜닝 대상). 모두 결정론 정수/고정 실수라 플랫폼 무관.
 */
export const TURRET_SPECS: readonly TurretSpec[] = [
  // ① 발칸: 기본 연사. 중피해·중사거리·빠른 연사.
  {
    name: 'vulcan',
    cost: 1,
    hp: 240,
    radius: 34,
    range: 820,
    fireCooldown: 12,
    damage: 6,
    bulletSpeed: 1200,
    bulletRadius: 8,
    bulletLife: 70,
    pellets: 1,
    spread: 0,
    hazardRadius: 0,
    hazardWindup: 0,
    hazardActive: 0,
    lockTicks: 0,
    turnRate: 0,
  },
  // ② 저격: 장거리·고피해·저속 연사·빠른 탄속·얇은 탄.
  {
    name: 'sniper',
    cost: 3,
    hp: 200,
    radius: 32,
    range: 1500,
    fireCooldown: 90,
    damage: 30,
    bulletSpeed: 2400,
    bulletRadius: 6,
    bulletLife: 90,
    pellets: 1,
    spread: 0,
    hazardRadius: 0,
    hazardWindup: 0,
    hazardActive: 0,
    lockTicks: 0,
    turnRate: 0,
  },
  // ③ 산탄: 근거리 부채꼴 다발. 짧은 사거리·중간 연사.
  {
    name: 'shotgun',
    cost: 2,
    hp: 300,
    radius: 36,
    range: 560,
    fireCooldown: 40,
    damage: 5,
    bulletSpeed: 1000,
    bulletRadius: 7,
    bulletLife: 42,
    pellets: 6,
    spread: 0.9,
    hazardRadius: 0,
    hazardWindup: 0,
    hazardActive: 0,
    lockTicks: 0,
    turnRate: 0,
  },
  // ④ 감속: 냉기장. 플레이어 위치에 HAZARD_SLOW 장판(M3 감속 재사용). 소량 피해.
  {
    name: 'frost',
    cost: 2,
    hp: 220,
    radius: 34,
    range: 900,
    fireCooldown: 100,
    damage: 2,
    bulletSpeed: 0,
    bulletRadius: 0,
    bulletLife: 0,
    pellets: 0,
    spread: 0,
    hazardRadius: 240,
    hazardWindup: 30,
    hazardActive: 150,
    lockTicks: 0,
    turnRate: 0,
  },
  // ⑤ 미사일: 제한 선회 유도(M3 BK_HOMING). 중피해·저속 연사.
  {
    name: 'missile',
    cost: 3,
    hp: 220,
    radius: 34,
    range: 1200,
    fireCooldown: 75,
    damage: 18,
    bulletSpeed: 720,
    bulletRadius: 12,
    bulletLife: 180,
    pellets: 1,
    spread: 0,
    hazardRadius: 0,
    hazardWindup: 0,
    hazardActive: 0,
    lockTicks: 150,
    turnRate: 0.05,
  },
  // ⑥ 전격: 연쇄 다수 약공. 부채꼴 고속 약탄 다발·빠른 연사.
  {
    name: 'tesla',
    cost: 2,
    hp: 200,
    radius: 32,
    range: 700,
    fireCooldown: 30,
    damage: 3,
    bulletSpeed: 1900,
    bulletRadius: 5,
    bulletLife: 40,
    pellets: 4,
    spread: 0.5,
    hazardRadius: 0,
    hazardWindup: 0,
    hazardActive: 0,
    lockTicks: 0,
    turnRate: 0,
  },
];

// ---------------------------------------------------------------------------
// 코어 + 제한 시간
// ---------------------------------------------------------------------------
/** 코어 내구도(침공 목표). 초기 추정값(계획 §5, 튜닝 대상). */
export const CORE_HP = 3000;
/** 코어 히트박스 반지름. */
export const CORE_RADIUS = 90;
/** 코어 배치 비용(에디터 예산제 — 코어는 필수 1개, 참고용). */
export const CORE_COST = 0;
/** 장애물(벽) 1개 배치 비용(에디터 예산제). */
export const OBSTACLE_COST = 1;

/** 침공 제한 시간: 3분(GDD §8) = 180초 × 60틱. */
export const DEFAULT_TIME_LIMIT_TICKS = 180 * 60;

// ---------------------------------------------------------------------------
// 방어 배치 직렬화 계약 (defenses 테이블 layout 컬럼 · C3 에디터 입출력)
// ---------------------------------------------------------------------------
/** 포탑 1기의 배치 데이터. `type`은 TURRET_* 코드. */
export interface TurretPlacement {
  type: number;
  x: number;
  y: number;
}
/** 장애물(벽) 1개의 배치 데이터. AABB 반폭/반높이(spawnWall 규약과 동일). */
export interface ObstaclePlacement {
  x: number;
  y: number;
  halfW: number;
  halfH: number;
}
/** 코어 1개의 배치 데이터(침공 목표, 배치당 1개). */
export interface CorePlacement {
  x: number;
  y: number;
}
/**
 * 방어 배치 전체(직렬화 JSON). `defenses.layout` 컬럼과 C3 에디터가 주고받는 계약이다.
 * `guardianSlots`는 M5 수호 기체 슬롯 자리(OQ-M4-4 — 이번 마일스톤 비활성, 계약 안정용 예약).
 */
export interface DefenseLayout {
  core: CorePlacement;
  turrets: TurretPlacement[];
  obstacles: ObstaclePlacement[];
  /** M5 수호 기체 슬롯(비활성 — 스키마·에디터 자리만, 시뮬 미참여). */
  guardianSlots?: unknown[];
}
/**
 * 침공 런 설정(WorldConfig.invasion). 방어 배치 + 제한 시간. 존재하면 침공 런, 없으면 기존
 * PvE 런(거동·해시 100% 불변).
 */
export interface InvasionConfig {
  layout: DefenseLayout;
  /** 제한 시간(틱). 기본 {@link DEFAULT_TIME_LIMIT_TICKS}(3분). */
  timeLimitTicks: number;
}

// ---------------------------------------------------------------------------
// 스폰
// ---------------------------------------------------------------------------
/** 방어 포탑 1기를 스폰(유형별 스펙으로 내구도·반지름·초기 발사 지연 세팅). */
export function spawnDefenseTurret(sink: EntitySink, type: number, x: number, y: number): Entity {
  const spec = TURRET_SPECS[type] ?? TURRET_SPECS[TURRET_VULCAN]!;
  const t = blankEntity('defenseTurret');
  t.x = x;
  t.y = y;
  t.enemyType = type; // 유형 코드(렌더 분화 + 스텝 디스패치)
  t.radius = spec.radius;
  t.hp = spec.hp;
  t.maxHp = spec.hp;
  t.cooldown = spec.fireCooldown; // 초기 발사 지연(스폰 즉발 방지)
  return addEntity(sink, t);
}

/** 방어 코어를 스폰(침공 목표). */
export function spawnCore(sink: EntitySink, x: number, y: number): Entity {
  const c = blankEntity('core');
  c.x = x;
  c.y = y;
  c.radius = CORE_RADIUS;
  c.hp = CORE_HP;
  c.maxHp = CORE_HP;
  return addEntity(sink, c);
}

/**
 * 방어 배치 전체를 스폰: 코어 → 포탑(배열 순서) → 장애물(wall). 순서는 배치 데이터로 완전
 * 결정되므로 재현이 자명하다. 플레이어는 호출 전에 이미 index 0에 있어야 한다(hashWorld는
 * index 0에 player가 있음을 불변식으로 가정).
 */
export function spawnInvasionLayout(sink: EntitySink, layout: DefenseLayout): void {
  spawnCore(sink, layout.core.x, layout.core.y);
  for (const t of layout.turrets) spawnDefenseTurret(sink, t.type, t.x, t.y);
  for (const o of layout.obstacles) spawnWall(sink, o.x, o.y, o.halfW, o.halfH);
}

// ---------------------------------------------------------------------------
// 스텝(결정론 거동) — WorldState는 type-only, 실제 스폰·수학은 리프 모듈만 사용
// ---------------------------------------------------------------------------
/**
 * 방어 포탑을 1틱 진행: 쿨다운이 오면 사거리·LOS를 확인하고 플레이어를 향해 발사한다.
 * 순수·결정론(위치·타이머·엔티티 배열 순서·벽 LOS로만 판정, RNG 미소비). 유형별 발사는
 * {@link fireTurret}가 디스패치한다.
 */
export function stepDefenseTurrets(state: WorldState, player: Entity): void {
  for (const t of state.entities) {
    if (t.kind !== 'defenseTurret' || t.dead) continue;
    if (t.cooldown > 0) {
      t.cooldown--;
      continue;
    }
    const spec = TURRET_SPECS[t.enemyType];
    if (spec === undefined) continue;
    // 사거리 밖이면 발사 보류(쿨다운 0 유지 → 사정권 진입 시 즉시 발사).
    const dx = player.x - t.x;
    const dy = player.y - t.y;
    if (dx * dx + dy * dy > spec.range * spec.range) continue;
    // 장애물에 시야가 가리면 보류(감속 장판은 위치 지정이라 LOS 무관하게 발사).
    if (
      spec.hazardRadius === 0 &&
      state.activeWalls.length > 0 &&
      segmentBlocked(t.x, t.y, player.x, player.y, state.activeWalls)
    ) {
      continue;
    }
    fireTurret(state, t, spec, player);
    t.cooldown = spec.fireCooldown;
  }
}

/** 포탑 1기의 발사를 유형별로 디스패치(결정론). */
function fireTurret(state: WorldState, t: Entity, spec: TurretSpec, player: Entity): void {
  const ang = atan2(player.y - t.y, player.x - t.x);
  switch (t.enemyType) {
    case TURRET_FROST: {
      // ④ 감속: 플레이어 현재 위치에 냉기 장판(HAZARD_SLOW)을 융기(M3 감속 지대 재사용).
      // 예열 뒤 활성 구간 동안 접촉하면 playerSlowTicks 부여 + 소량 피해(world.ts 판정 재사용).
      spawnHazard(
        state,
        HAZARD_SLOW,
        player.x,
        player.y,
        spec.hazardRadius,
        spec.hazardWindup,
        spec.hazardActive,
        spec.damage,
        true, // 지속 피해 장판
        t.id,
      );
      return;
    }
    case TURRET_MISSILE: {
      // ⑤ 미사일: 제한 선회 유도탄(M3 BK_HOMING). 락 지속 동안 매 틱 turnRate까지 플레이어로
      // 선회, 이후 직진(회피 여지 — GDD §10 정신).
      const b = spawnEnemyBullet(
        state,
        t.x,
        t.y,
        cos(ang) * spec.bulletSpeed,
        sin(ang) * spec.bulletSpeed,
        ang,
        spec.damage,
        spec.bulletRadius,
        spec.bulletLife,
      );
      applyBehavior(b, homingBehavior(spec.bulletSpeed, spec.lockTicks, spec.turnRate));
      return;
    }
    case TURRET_SHOTGUN:
    case TURRET_TESLA: {
      // ③ 산탄 / ⑥ 전격: 부채꼴로 pellets발 균등 발사(전격은 약탄 고속 다발 = "연쇄 다수 약공").
      const n = spec.pellets < 1 ? 1 : spec.pellets;
      const start = n > 1 ? ang - spec.spread / 2 : ang;
      const step = n > 1 ? spec.spread / (n - 1) : 0;
      for (let i = 0; i < n; i++) {
        const a = start + step * i;
        spawnEnemyBullet(
          state,
          t.x,
          t.y,
          cos(a) * spec.bulletSpeed,
          sin(a) * spec.bulletSpeed,
          a,
          spec.damage,
          spec.bulletRadius,
          spec.bulletLife,
        );
      }
      return;
    }
    default: {
      // ① 발칸 / ② 저격: 플레이어를 향해 단발 직사(스펙 차이 = 사거리·피해·탄속·연사).
      spawnEnemyBullet(
        state,
        t.x,
        t.y,
        cos(ang) * spec.bulletSpeed,
        sin(ang) * spec.bulletSpeed,
        ang,
        spec.damage,
        spec.bulletRadius,
        spec.bulletLife,
      );
      return;
    }
  }
}
