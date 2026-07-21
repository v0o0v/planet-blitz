/**
 * Pattern engine — executes enemy movement + attack components each tick.
 *
 * Kept deterministic by construction: every behaviour is a pure function of the
 * current state (player/enemy positions, timers). No RNG is drawn here, so two
 * runs with the same wave spawns evolve identically. Enemies only *emit* things
 * (bullets, hazards); the world loop owns integrating and resolving them.
 */

import type { WorldState } from '../world.js';
import { playerCloaked } from '../world.js';
import type { Entity } from '../entities.js';
import type { EnemyDef } from './types.js';
import { HAZARD_MORTAR, HAZARD_LAVA } from './types.js';
import { spawnEnemyBullet, spawnHazard } from '../entities.js';
import { cos, sin, atan2, length, TWO_PI, HALF_PI } from '../math.js';
import { DT, HAZARD_LINE_SPAN } from '../constants.js';
import { slideCircleWalls } from '../los.js';
import { tierParams } from '../../../data/waves.js';
import { applyBehavior, curveBehavior, accelBehavior } from '../bullets.js';

/**
 * 잡몹 시그니처 탄 거동(탄막 다양성 Lane 1). 몹 정체성을 데이터로 못박되 밀도는 절제
 * (탄 수를 늘리지 않는 거동만 잡몹에 배정 — 밀도는 보스·엘리트에 집중, CONTEXT.md).
 *   - 돌격형(파편) → 곡사: 발사 수 그대로, 파편이 완만히 휘어 "흩뿌리는 파쇄" 정체성.
 *   - 사수형(섬멸 서브탄) → 가속 직진: 조준 견제탄이 뒤로 갈수록 빨라지는 압박.
 */
const CHARGER_FRAGMENT_CURVE_W = 0.045; // rad/tick 곡률(완만)
const GUNNER_SHARD_ACCEL = 850; // units/second² 가속

/** Advance one enemy: steer, then fire if its cadence is ready. */
export function updateEnemy(state: WorldState, e: Entity, def: EnemyDef, player: Entity): void {
  applyMovement(state, e, def, player);

  if (e.cooldown > 0) {
    e.cooldown--;
  }
  // Fragments fire from the movement step (periodic cadence burst + wall-impact
  // hook), never from the generic cadence path below.
  //
  // 팬텀 은신(M8 시그니처, 비트 20): 은신 중에는 **방출만** 막는다 — 이동(applyMovement)은
  // 위에서 이미 끝났고 여기서 되돌리지 않는다. 쿨다운도 리셋하지 않아 `e.cooldown` 이 0 에
  // 머물다가 은신이 풀린 첫 틱에 곧바로 발사된다(은신이 쿨다운을 태워 없애지 않는다).
  // `playerCloaked` 는 시그니처 미보유 런에서 즉시 false 라 조건식이 원래와 동일 경로다.
  if (def.attack.kind !== 'fragments' && e.cooldown <= 0 && !playerCloaked(state)) {
    runAttack(state, e, def, player);
    e.cooldown = def.fireCooldown;
  }
}

function applyMovement(state: WorldState, e: Entity, def: EnemyDef, player: Entity): void {
  switch (def.movement) {
    case 'chargeStraight':
      moveCharge(state, e, def, player);
      break;
    case 'stationary':
      e.vx = 0;
      e.vy = 0;
      break;
    case 'standoff':
      moveStandoff(e, def, player);
      integrate(state, e);
      break;
    case 'seekWounded':
      moveSeekWounded(state, e, def, player);
      integrate(state, e);
      break;
  }
}

/**
 * Straight rush on the infinite map. There are no arena walls to bounce off, so
 * the charger drives straight in the direction it aimed at spawn. Its fragments
 * attack is re-hooked (plan C5c) with two deterministic triggers:
 *   - PRIMARY (Phase F1a, follow-up worker): the moment it slides against a
 *     gimmick wall — call {@link chargerHitWall} from the wall-slide resolver.
 *   - SECONDARY (here): a periodic burst gated by `fireCooldown` so its threat
 *     never vanishes on open terrain where walls are sparse. It also re-aims at
 *     the player after overshooting, to circle back and re-engage.
 * Purely position/timer driven — no RNG — so replays stay bit-identical.
 */
function moveCharge(state: WorldState, e: Entity, def: EnemyDef, player: Entity): void {
  // Establish heading on the first tick after spawn (velocity still zero).
  if (e.vx === 0 && e.vy === 0) {
    aimAt(e, def.speed, player.x, player.y);
  }
  e.x += e.vx * DT;
  e.y += e.vy * DT;

  // PRIMARY fragments trigger: sliding against a gimmick wall bursts fragments
  // (plan C5c/F1a). Slide out of any overlapped wall first, then react on hit.
  if (state.activeWalls.length > 0) {
    const slid = slideCircleWalls(e.x, e.y, e.radius, state.activeWalls);
    e.x = slid.x;
    e.y = slid.y;
    if (slid.hit) chargerHitWall(state, e, def, player);
  }

  // Secondary fragments trigger: fire on the fire-cadence timer (open terrain),
  // re-aiming at the player so the charger keeps pressing after each burst.
  //
  // 팬텀 은신: 돌격형은 **이 경로로만** 쏘므로 여기도 같은 게이트가 필요하다(위 generic
  // cadence 경로만 막으면 돌격형이 은신을 그대로 뚫는 반쪽 배선이 된다). 은신 중에는 else 로
  // 흘러 "지나쳤으면 다시 조준" 규칙만 남는다 — 정지시키지 않고, 난수도 쓰지 않으며,
  // 쿨다운이 0 에 머물러 은신이 풀린 첫 틱에 즉시 분출한다.
  if (def.attack.kind === 'fragments' && e.cooldown <= 0 && !playerCloaked(state)) {
    sprayFragments(state, e, def.attack);
    e.cooldown = def.fireCooldown;
    aimAt(e, def.speed, player.x, player.y);
  } else {
    // Between bursts, re-aim once the charger has overshot the player so it turns
    // back instead of receding forever (heading points away from the target).
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    if (e.vx * dx + e.vy * dy < 0) {
      aimAt(e, def.speed, player.x, player.y);
    }
  }
  e.angle = atan2(e.vy, e.vx);
}

/**
 * Charger wall-impact reaction — the PRIMARY fragments trigger (plan C5c/F1a).
 * A follow-up worker calls this the instant a charging enemy slides against a
 * gimmick-wall AABB (Phase F1a): spray fragments (respecting the fire cadence)
 * and re-aim at the player, reproducing the M1 "hit a wall, burst" feel on the
 * infinite map. Deterministic (position/timer only, no RNG).
 */
export function chargerHitWall(state: WorldState, e: Entity, def: EnemyDef, player: Entity): void {
  // 팬텀 은신: 벽 충돌 분출도 방출이라 같은 게이트를 건다. 아래 `aimAt`(이동 방향 재설정)은
  // 게이트 밖에 그대로 둔다 — 벽에 부딪힌 뒤 방향을 다시 잡는 것은 사격이 아니라 물리적
  // 반응이고, 여기서 막으면 은신 중 돌격형이 벽에 박혀 미는 미정의 상태가 된다.
  if (def.attack.kind === 'fragments' && e.cooldown <= 0 && !playerCloaked(state)) {
    sprayFragments(state, e, def.attack);
    e.cooldown = def.fireCooldown;
  }
  aimAt(e, def.speed, player.x, player.y);
}

function moveStandoff(e: Entity, def: EnemyDef, player: Entity): void {
  const dx = player.x - e.x;
  const dy = player.y - e.y;
  const dist = length(dx, dy);
  const preferred = 380;
  const ang = atan2(dy, dx);
  if (dist > preferred + 40) {
    e.vx = cos(ang) * def.speed;
    e.vy = sin(ang) * def.speed;
  } else if (dist < preferred - 40) {
    e.vx = -cos(ang) * def.speed;
    e.vy = -sin(ang) * def.speed;
  } else {
    // Hold range with a slow perpendicular strafe.
    e.vx = cos(ang + HALF_PI) * def.speed * 0.5;
    e.vy = sin(ang + HALF_PI) * def.speed * 0.5;
  }
  e.angle = ang;
}

function moveSeekWounded(state: WorldState, e: Entity, def: EnemyDef, player: Entity): void {
  const ally = nearestWoundedAlly(state, e);
  const tx = ally?.x ?? player.x;
  const ty = ally?.y ?? player.y;
  const dx = tx - e.x;
  const dy = ty - e.y;
  const dist = length(dx, dy);
  const ang = atan2(dy, dx);
  // Approach the target but stop ~120u short so it hovers alongside to heal.
  if (dist > 120) {
    e.vx = cos(ang) * def.speed;
    e.vy = sin(ang) * def.speed;
  } else {
    e.vx = 0;
    e.vy = 0;
  }
  e.angle = ang;
}

function runAttack(state: WorldState, e: Entity, def: EnemyDef, player: Entity): void {
  switch (def.attack.kind) {
    case 'mortar': {
      // Telegraph a circular impact at the player's current position.
      spawnHazard(
        state,
        HAZARD_MORTAR,
        player.x,
        player.y,
        def.attack.radius,
        def.attack.windup,
        8, // short burst window
        def.attack.damage,
        false,
        e.id,
      );
      // 섬멸 티어 패턴 변형(plan B3): 사수형이 포격과 함께 방사형 견제탄(서브탄)을 흩뿌린다.
      // 정찰/교전은 subBullets 0이라 no-op(거동 불변).
      const sub = tierParams(state.config.tier).subBullets;
      const shardSpeed = 460;
      const shardDamage = Math.max(4, Math.round(def.attack.damage * 0.5));
      for (let i = 0; i < sub; i++) {
        if (state.enemyBulletCount >= state.bulletCap) break;
        const ang = (i * TWO_PI) / sub;
        const shard = spawnEnemyBullet(
          state,
          e.x,
          e.y,
          cos(ang) * shardSpeed,
          sin(ang) * shardSpeed,
          ang,
          shardDamage,
          5,
          70,
        );
        // 사수형 시그니처: 가속 직진(조준 견제탄).
        applyBehavior(shard, accelBehavior(shardSpeed, GUNNER_SHARD_ACCEL));
        state.enemyBulletCount++;
      }
      break;
    }
    case 'lava': {
      // Raise a horizontal line of pillars centred on the player (infinite map:
      // a fixed viewport-width span replaces the old absolute arena span).
      const a = def.attack;
      const step = HAZARD_LINE_SPAN / (a.pillars + 1);
      const startX = player.x - HAZARD_LINE_SPAN / 2;
      for (let i = 1; i <= a.pillars; i++) {
        spawnHazard(
          state,
          HAZARD_LAVA,
          startX + step * i,
          player.y,
          a.radius,
          a.windup,
          a.activeTicks,
          a.damage,
          true,
          e.id,
        );
      }
      break;
    }
    case 'heal': {
      const ally = nearestWoundedAlly(state, e);
      if (ally !== undefined) {
        const dx = ally.x - e.x;
        const dy = ally.y - e.y;
        if (length(dx, dy) <= def.attack.range) {
          ally.hp = Math.min(ally.maxHp, ally.hp + def.attack.healPerTick);
          e.phase = 1; // render: beam active
          e.targetX = ally.x;
          e.targetY = ally.y;
          return;
        }
      }
      e.phase = 0;
      break;
    }
    case 'fragments':
      break; // handled on wall impact
  }
}

function sprayFragments(
  state: WorldState,
  e: Entity,
  atk: Extract<EnemyDef['attack'], { kind: 'fragments' }>,
): void {
  // 섬멸 티어 패턴 변형(plan B3): 서브탄 수만큼 파편 부채를 더 촘촘히 만든다(데이터
  // 주도). 정찰/교전은 subBullets 0이라 atk.count 그대로(거동 불변).
  const count = atk.count + tierParams(state.config.tier).subBullets;
  for (let i = 0; i < count; i++) {
    // Respect the segment's simultaneous enemy-bullet cap (perf + fairness).
    if (state.enemyBulletCount >= state.bulletCap) break;
    const ang = (i * TWO_PI) / count;
    const frag = spawnEnemyBullet(
      state,
      e.x,
      e.y,
      cos(ang) * atk.speed,
      sin(ang) * atk.speed,
      ang,
      atk.damage,
      atk.bulletRadius,
      atk.bulletLife,
    );
    // 돌격형 시그니처: 곡사(파편이 완만히 휨). 발사 수는 그대로 — 밀도 절제.
    applyBehavior(frag, curveBehavior(atk.speed, CHARGER_FRAGMENT_CURVE_W));
    state.enemyBulletCount++;
  }
}

/** Nearest same-faction enemy below full HP (excluding self). Deterministic order. */
function nearestWoundedAlly(state: WorldState, self: Entity): Entity | undefined {
  let best: Entity | undefined;
  let bestD = Infinity;
  for (const o of state.entities) {
    if (o.kind !== 'enemy' || o.id === self.id || o.hp >= o.maxHp) continue;
    const dx = o.x - self.x;
    const dy = o.y - self.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

function aimAt(e: Entity, speed: number, tx: number, ty: number): void {
  const ang = atan2(ty - e.y, tx - e.x);
  e.vx = cos(ang) * speed;
  e.vy = sin(ang) * speed;
}

function integrate(state: WorldState, e: Entity): void {
  // Infinite map: no arena box to clamp against — enemies move freely. Movement
  // obstruction is solely the job of gimmick walls (Phase F): slide out of any
  // overlapped wall so enemies cannot pass through cover.
  e.x += e.vx * DT;
  e.y += e.vy * DT;
  if (state.activeWalls.length > 0) {
    const slid = slideCircleWalls(e.x, e.y, e.radius, state.activeWalls);
    e.x = slid.x;
    e.y = slid.y;
  }
}
