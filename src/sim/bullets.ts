/**
 * 적탄 거동 카탈로그 — 결정론 순수 함수(ADR-0005, 탄막 다양성 Lane 1).
 *
 * 이 모듈은 sim 리프다: Math.random / Date.now / PixiJS를 절대 import 하지 않으며,
 * 오직 결정론 math 모듈과 고정 timestep(DT)만 사용한다. 두 런이 같은 시드·같은 입력
 * 이면 탄 궤적도 tick 단위로 bit-identical 하게 재현된다.
 *
 * 설계(CONTEXT.md 「탄막」, docs/adr/0010): 1차 카탈로그 4종.
 *   ① 직진 속도변화(가속/감속)  — BK_ACCEL
 *   ② 유도 호밍(락 만료 → 직진)  — BK_HOMING
 *   ③ 곡사(가속 회전/사인)        — BK_CURVE
 *   ④ 분열 산탄(퓨즈 후 자탄 방사) — BK_SPLIT
 *
 * 거동은 "데이터 파라미터"로 표현하고 tick 함수는 순수하다. 상태 정보는 enemyBullet의
 * 기존 free 필드에 얹어(신규 Entity 필드 0 → hashEntity/스냅샷/blankEntity 무변경)
 * 결정론 해시가 자동으로 이를 포착한다. 필드 매핑(SINGLE SOURCE OF TRUTH):
 *   - `enemyType` = 거동 종류 코드(BK_*). 기본 -1(BK_NONE) = 순수 직진(레거시, no-op).
 *   - `maxHp`     = 기준 속도(units/second). 거동이 매 틱 vx/vy를 이 속도로 재구성.
 *   - `targetX`   = 파라미터 A(가속도 / 선회율 / 각속도 / 자탄 속도).
 *   - `targetY`   = 파라미터 B(각가속도; CURVE 전용).
 *   - `timer`     = 카운트다운(HOMING 락 잔여 틱 / SPLIT 퓨즈).
 *   - `phase`     = 자탄 수(SPLIT 전용).
 * 위 6개 필드는 모두 이미 hashEntity가 접으므로(replay.ts) 결정론에 자동 포함된다.
 * 시각 정보(색·모양)는 여기 살지 않는다 — 렌더는 `enemyType`(거동 코드)만 읽어 색을 고른다.
 */

import type { Entity } from './entities.js';
import { cos, sin, atan2, wrapAngle } from './math.js';
import { DT } from './constants.js';

/** 거동 종류 코드(enemyBullet.enemyType에 저장). -1 = 거동 없음(순수 직진). */
export const BK_NONE = -1;
export const BK_ACCEL = 0;
export const BK_HOMING = 1;
export const BK_CURVE = 2;
export const BK_SPLIT = 3;
/** 유효 거동 코드 수(렌더 색 팔레트·검증에 사용). */
export const BULLET_BEHAVIOR_COUNT = 4;

/**
 * 탄 거동 데이터 파라미터. 발사 시 {@link applyBehavior}로 enemyBullet에 각인한다.
 * 필드 의미는 kind마다 다르다(모듈 헤더 매핑 참조).
 */
export interface BulletBehavior {
  /** 거동 종류(BK_*). */
  readonly kind: number;
  /** 기준 속도(units/second). */
  readonly speed: number;
  /** 파라미터 A(가속도 / 선회율 rad·tick / 각속도 rad·tick / 자탄 속도). */
  readonly a: number;
  /** 파라미터 B(각가속도 rad·tick², CURVE 전용; 그 외 0). */
  readonly b: number;
  /** 카운트다운(HOMING 락 틱 / SPLIT 퓨즈 틱). */
  readonly countdown: number;
  /** 자탄 수(SPLIT 전용; 그 외 0). */
  readonly count: number;
}

/**
 * 갓 스폰된 적탄에 거동을 각인한다(기존 free 필드에만 기록 — 신규 필드 없음). 호출
 * 시점의 e.angle을 기준 진행 방향으로 삼는다(spawnEnemyBullet가 vx=cos(angle)*speed로
 * 발사했다는 전제). 이후 매 틱 {@link stepEnemyBulletBehavior}가 vx/vy를 재구성한다.
 */
export function applyBehavior(e: Entity, beh: BulletBehavior): void {
  e.enemyType = beh.kind;
  e.maxHp = beh.speed;
  e.targetX = beh.a;
  e.targetY = beh.b;
  e.timer = beh.countdown;
  e.phase = beh.count;
}

/** SPLIT 퓨즈 만료 시 루프 뒤에서 방사할 자탄 스폰 요청(엔티티 배열 순회 중 안전). */
export interface BulletSplit {
  x: number;
  y: number;
  /** 자탄 속도. */
  speed: number;
  /** 자탄 피해(원본 탄 damage 승계). */
  damage: number;
  /** 자탄 반지름(원본 탄 radius 승계). */
  radius: number;
  /** 자탄 수. */
  count: number;
  /** 방사 기준각(원본 탄 진행각). */
  baseAngle: number;
}

/**
 * 적탄 하나의 거동을 1틱 전진시킨다(위치 적분 전에 vx/vy/angle을 갱신). 순수·결정론
 * — RNG·wall-clock 미사용. BK_NONE(-1) 또는 미지 코드는 no-op(순수 직진 유지).
 *
 * SPLIT은 퓨즈 만료 틱에 `splits`에 방사 요청을 push하고 자신을 dead 표시한다(자탄
 * 스폰은 호출자가 루프 종료 후 수행). 반환값 true = 이 탄이 이번 틱에 분열로 소멸.
 */
export function stepEnemyBulletBehavior(e: Entity, player: Entity, splits: BulletSplit[]): boolean {
  switch (e.enemyType) {
    case BK_ACCEL: {
      // ① 직진 속도변화: 진행각 고정, 속도만 가속도(a)로 적분(감속 시 0에서 클램프).
      let s = e.maxHp + e.targetX * DT;
      if (s < 0) s = 0;
      e.maxHp = s;
      e.vx = cos(e.angle) * s;
      e.vy = sin(e.angle) * s;
      return false;
    }
    case BK_HOMING: {
      // ② 유도 호밍: 락 잔여(timer)>0 동안만 플레이어 쪽으로 선회율(a) 상한 선회.
      // 락 만료 후에는 마지막 진행각으로 직진(재획득 없음 — 회피 가능, GDD §10 정신).
      if (e.timer > 0) {
        e.timer--;
        const desired = atan2(player.y - e.y, player.x - e.x);
        let d = wrapAngle(desired - e.angle);
        const turn = e.targetX;
        if (d > turn) d = turn;
        else if (d < -turn) d = -turn;
        e.angle += d;
      }
      const s = e.maxHp;
      e.vx = cos(e.angle) * s;
      e.vy = sin(e.angle) * s;
      return false;
    }
    case BK_CURVE: {
      // ③ 곡사: 각속도(a)로 진행각을 매 틱 돌리고, 각가속도(b)로 각속도를 누적한다.
      // b=0이면 일정 곡률의 원호, b≠0이면 조여드는/풀리는 나선. 속도는 일정.
      let w = e.targetX;
      e.angle = wrapAngle(e.angle + w);
      w += e.targetY;
      e.targetX = w;
      const s = e.maxHp;
      e.vx = cos(e.angle) * s;
      e.vy = sin(e.angle) * s;
      return false;
    }
    case BK_SPLIT: {
      // ④ 분열 산탄: 퓨즈(timer) 만료 틱에 자탄 phase발을 균등 방사 예약 후 소멸.
      // 퓨즈 전에는 발사 당시 속도로 직진(vx/vy 불변). 자탄은 거동 없는 순수 직진(재분열 방지).
      // 경계 계약: fuse=0으로 각인하면 timer=0이라 영원히 분열하지 않는다(즉시 분열 아님).
      // 즉시 분열이 필요하면 fuse=1을 쓸 것.
      if (e.timer > 0) {
        e.timer--;
        if (e.timer === 0) {
          splits.push({
            x: e.x,
            y: e.y,
            speed: e.targetX,
            damage: e.damage,
            radius: e.radius,
            count: e.phase,
            baseAngle: e.angle,
          });
          e.dead = true;
          return true;
        }
      }
      return false;
    }
    default:
      return false; // BK_NONE(-1) 또는 미지 코드: 순수 직진(no-op).
  }
}

// ---------------------------------------------------------------------------
// 거동 팩토리(데이터 생성기) — 발사부에서 applyBehavior와 함께 쓴다.
// ---------------------------------------------------------------------------

/** ① 가속/감속 직진: accel>0 가속, <0 감속. */
export function accelBehavior(speed: number, accel: number): BulletBehavior {
  return { kind: BK_ACCEL, speed, a: accel, b: 0, countdown: 0, count: 0 };
}

/** ② 유도 호밍: lockTicks 동안 매 틱 turn(rad)까지 플레이어로 선회, 이후 직진. */
export function homingBehavior(speed: number, lockTicks: number, turn: number): BulletBehavior {
  return { kind: BK_HOMING, speed, a: turn, b: 0, countdown: lockTicks, count: 0 };
}

/** ③ 곡사: w(rad/tick) 각속도 + wa(rad/tick²) 각가속도. wa 기본 0(일정 곡률). */
export function curveBehavior(speed: number, w: number, wa = 0): BulletBehavior {
  return { kind: BK_CURVE, speed, a: w, b: wa, countdown: 0, count: 0 };
}

/** ④ 분열 산탄: fuse틱 뒤 children발을 childSpeed로 균등 방사. */
export function splitBehavior(
  speed: number,
  fuse: number,
  children: number,
  childSpeed: number,
): BulletBehavior {
  return { kind: BK_SPLIT, speed, a: childSpeed, b: 0, countdown: fuse, count: children };
}
