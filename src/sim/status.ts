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
// ⚠️ **`skillHooks.js` 가 아니다.** 그 파일은 `skills/*.ts` 를 값으로 import 하고 그중
//    둘(아크캐스터·말로우)이 이 파일을 값으로 import 한다 — 여기서 `skillHooks` 를 당기면
//    런타임 순환이 되고, 그 순환은 `skillHooks.ts` 헤더가 *"번들러가 초기화를 재배치하면
//    TDZ — 클라에서 재현 안 되고 검증 EF 에서만 터진다"* 로 금지한 바로 그것이다.
import { onEnemyStatusExpired } from './chainHooks.js';

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

/**
 * 적에게 냉기 감속을 부여(더 긴 지속으로 갱신). ownerId = 남은 감속 틱.
 *
 * 냉기 어픽스(coldSlow)는 **불리언 게이트**다(리뷰 LOW): 호출부(world.ts)는
 * `coldSlow > 0`일 때 고정 지속 COLD_DURATION으로만 이 함수를 부른다. 감속 강도는
 * COLD_SLOW_MULT 상수 하나로 고정이라 어픽스 값(항상 1)은 지속·강도에 관여하지 않는다.
 * 감속을 강도화하려면 여기에 배율/지속 파라미터를 받고 data/affixes.ts freezing 범위를
 * 넓혀야 한다.
 */
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
 *
 * ## ⚠️ `state` 를 받는 이유 — 앵커 ㉚ 의 자리가 여기밖에 없다
 * 말로우 SQ9「이자 소각」은 *화상이 **만료**되는 순간*(부여 순간이 아니다) 부채를 소액
 * 탕감한다. 만료 판정(`iframes` 가 이번 틱에 0 에 닿았는가)은 감소 규칙과 같은 곳에서만
 * 관측 가능하고, 호출부(`world.ts`)에서 before/after 를 다시 재면 **만료 술어가 두 곳에
 * 살게 된다**(이 저장소가 반복해서 대가를 치른 형태다). 그래서 훅을 여기 둔다.
 *
 * 갱신 규칙("더 강한 값 유지")·만료 규칙(틱 0 소멸)은 **한 줄도 바꾸지 않았다** — 만료
 * 지점에 관측 훅 하나를 얹었을 뿐이다(설계서 SQ9 「재발 패턴 ① 판정」이 요구한 형태).
 */
export function tickEnemyStatus(state: WorldState, e: Entity): void {
  if (e.iframes > 0) {
    e.hp -= e.dashCooldown;
    e.iframes--;
    if (e.iframes === 0) {
      e.dashCooldown = 0;
      // 앵커 ㉚ — **화상이 이번 틱에 만료된 그 지점.** hp≤0 판정보다 앞이라, 같은 틱에
      // 화상 피해로 죽은 적도 "만료" 로 한 번만 통지된다(사망 경로 ②와 배타 — 죽는 순간
      // `iframes` 가 이미 0 이라 `compact` 의 화상 잔존 게이트에 걸리지 않는다).
      onEnemyStatusExpired(state, e, 'burn');
    }
    if (e.hp <= 0) e.dead = true;
  }
  if (e.ownerId > 0) {
    e.ownerId--;
    if (e.ownerId === 0) onEnemyStatusExpired(state, e, 'cold');
  }
}

/**
 * 전격 연쇄: 방금 맞은 적(origin) 주변 CHAIN_RADIUS 안의 다른 적에게 즉시 피해를
 * 준다(최대 CHAIN_MAX_TARGETS마리, 엔티티 배열 순서로 결정론 선택). 즉발이라 잔존
 * 상태가 없다. HP가 0 이하가 된 적은 dead로 표시(compact가 처리).
 *
 * 성능(리뷰 MED-2 재검토): CHAIN_MAX_TARGETS(3)에 도달하면 즉시 break하므로 밀집한
 * 적(연쇄가 실제로 발화하는 상황)에서는 사실상 O(3)이다. 브로드페이즈 그리드 반경 질의로
 * 바꾸는 방안을 벤치했으나 Map 조회·클로저 상수가 이 촘촘한 배열 조기-break 루프보다
 * 커서 실측이 오히려 느렸다(107→127ms/1500t·200적). 결정론 단순성을 지키는 직접 스캔을
 * 유지한다(배열 순서 tie-break도 함께 보존).
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
