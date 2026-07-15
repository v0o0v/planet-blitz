/**
 * 상태이상 시스템 — 결정론 산술 (M3 plan B1/B4, AC4·AC6).
 *
 * 두 갈래를 다룬다:
 *  1) 플레이어 감속(니플헤임 유령 기함 '감속 지대', B1): WorldState.playerSlowTicks
 *     스칼라로 관리(hashWorld append-only). stepPlayer가 이동 속도에 배율을 곱하고 매
 *     틱 1 감소시킨다. 대시 임펄스에는 적용하지 않아 회피 여지를 남긴다.
 *  2) 적 원소 상태이상(어픽스 화염·냉기·전격, B4): 플레이어의 원소 어픽스 탄이 적을
 *     맞히면 다음을 부여한다.
 *       - 화염(fire): 지속피해(burn). enemy.iframes = 남은 틱, enemy.dashCooldown = 틱당
 *         피해량.
 *       - 냉기(cold): 감속(slow). enemy.ownerId = 남은 감속 틱.
 *       - 전격(lightning): 연쇄(chain). 즉발 — 인접 적에게 즉시 피해(잔존 상태 없음).
 *
 * 필드 재활용(uniques.ts와 동일 규율): 적('enemy' kind)은 iframes·dashCooldown·ownerId를
 * 전혀 쓰지 않는다(각각 플레이어·보스 전용). 따라서 이 필드에 상태이상을 실어도 거동
 * 충돌이 없고, 이미 hashEntity에 접히므로 해시 레이아웃이 불변이다. 상태이상 미사용 시
 * 세 필드는 항상 0(blankEntity 기본)이라 기존 콘텐츠 거동도 완전히 동일하다.
 *
 * 결정론(ADR-0005): 모든 값은 정수/고정 배율이며 RNG를 뽑지 않는다. 연쇄 대상 선택은
 * 엔티티 배열 순서(고정) + 거리 임계로만 판정한다.
 */

import type { WorldState } from './world.js';
import type { Entity } from './entities.js';

// --- 플레이어 감속(감속 지대) ----------------------------------------------
/** 감속 지대 접촉 시 이동 속도 배율(< 1 = 느려짐). */
export const PLAYER_SLOW_MULT = 0.5;
/** 감속 지대 접촉 1회당 감속 지속(틱, 1.5초). */
export const PLAYER_SLOW_DURATION = 90;

// --- 화염(지속피해) ---------------------------------------------------------
/** 화염 상태이상 지속(틱, 2초). */
export const FIRE_DURATION = 120;

// --- 냉기(감속) -------------------------------------------------------------
/** 냉기 상태이상 지속(틱, 1.5초). */
export const COLD_DURATION = 90;
/** 냉기에 걸린 적의 이동 속도 배율(< 1 = 느려짐). */
export const COLD_SLOW_MULT = 0.55;

// --- 전격(연쇄) -------------------------------------------------------------
/** 연쇄가 뻗는 반경(월드 유닛). */
export const CHAIN_RADIUS = 260;
/** 한 번의 명중이 연쇄로 때리는 최대 인접 적 수. */
export const CHAIN_MAX_TARGETS = 3;

/**
 * 적에게 화염 지속피해를 부여(갱신 시 더 강한 값으로 유지). iframes = 남은 틱,
 * dashCooldown = 틱당 피해. 값은 정수(해시 u32).
 */
export function applyBurn(e: Entity, dmgPerTick: number, ticks: number): void {
  if (ticks > e.iframes) e.iframes = ticks;
  if (dmgPerTick > e.dashCooldown) e.dashCooldown = dmgPerTick;
}

/** 적에게 냉기 감속을 부여(더 긴 지속으로 갱신). ownerId = 남은 감속 틱. */
export function applySlow(e: Entity, ticks: number): void {
  if (ticks > e.ownerId) e.ownerId = ticks;
}

/** 냉기 감속 중인 적의 이동 속도 배율(그 외 1). */
export function enemyStatusSlowMult(e: Entity): number {
  return e.ownerId > 0 ? COLD_SLOW_MULT : 1;
}

/**
 * 적의 원소 상태이상을 1틱 진행: 화염 지속피해 적용 + 타이머 감소. 화염으로 HP가
 * 0 이하가 되면 dead로 표시(compact가 처치·드랍 처리). enemy에만 호출한다.
 */
export function tickEnemyStatus(e: Entity): void {
  if (e.iframes > 0) {
    e.hp -= e.dashCooldown;
    e.iframes--;
    if (e.iframes === 0) e.dashCooldown = 0;
    if (e.hp <= 0) e.dead = true;
  }
  if (e.ownerId > 0) e.ownerId--;
}

/**
 * 전격 연쇄: 방금 맞은 적(origin) 주변 CHAIN_RADIUS 안의 다른 적에게 즉시 피해를
 * 준다(최대 CHAIN_MAX_TARGETS마리, 엔티티 배열 순서로 결정론 선택). 즉발이라 잔존
 * 상태가 없다. HP가 0 이하가 된 적은 dead로 표시(compact가 처리).
 */
export function applyChain(state: WorldState, origin: Entity, chainDmg: number): void {
  if (chainDmg <= 0) return;
  const r2 = CHAIN_RADIUS * CHAIN_RADIUS;
  let hit = 0;
  for (const t of state.entities) {
    if (hit >= CHAIN_MAX_TARGETS) break;
    if (t.kind !== 'enemy' || t.id === origin.id || t.dead) continue;
    const dx = t.x - origin.x;
    const dy = t.y - origin.y;
    if (dx * dx + dy * dy > r2) continue;
    t.hp -= chainDmg;
    if (t.hp <= 0) t.dead = true;
    hit++;
  }
}
