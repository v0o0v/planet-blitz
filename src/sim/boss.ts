/**
 * Boss fight logic (M1 boss — plan task 15, spec R2).
 *
 * Deterministic by construction: like the enemy pattern engine it draws no RNG
 * and reads no wall-clock time. Boss state is carried on the entity's generic
 * fields:
 *   - `phase`   : current phase index 0/1/2 (folded into the hash)
 *   - `timer`   : phase-transition animation countdown; > 0 = frozen & clearing
 *   - `cooldown`: ticks until the next pattern cast
 *   - `iframes` : OVERHEAT window remaining — the boss takes DOUBLE damage while
 *                 this is > 0 (spec: 5s after casting a pattern)
 *   - `pierce`  : round-robin index into the current phase's attack list
 *   - `dashCooldown`: OVERHEAT re-arm timer — ticks until the window may open
 *                 again. Repurposed generic field (the boss never dashes); keeps
 *                 the overheat window from re-opening on every cast, so the 5s
 *                 window has a closed gap between openings (see BossPhaseDef).
 *
 * On crossing an HP threshold (70% / 35%) the boss enters a 2s transition that
 * freezes it and CLEARS every enemy bullet on screen (spec). The transition is
 * itself deterministic — no visual-only randomness leaks into the sim.
 */

import type { WorldState } from './world.js';
import { playerCloaked } from './cloak.js';
import type { Entity } from './entities.js';
import { spawnEnemyBullet, spawnHazard } from './entities.js';
import { HAZARD_LAVA, HAZARD_SLOW } from './patterns/types.js';
import { cos, sin, atan2, TWO_PI, HALF_PI, clamp } from './math.js';
import { DT, VIEW_HEIGHT, HAZARD_LINE_SPAN, SPAWN_RING_RADIUS } from './constants.js';
import type { BossAttack, BossDef } from '../../data/boss.js';
import { planetContent } from '../../data/planets/index.js';
import { commissionBossDef } from '../../data/commissionBosses.js';
import { summonEnemy } from './waves.js';
import { PLANET_MODE } from './planetMode.js';
import { chasePredatorPursue } from './modes/chase.js';
import { applyBehavior, accelBehavior, splitBehavior, homingBehavior } from './bullets.js';

/**
 * 보스 탄 시그니처 거동(탄막 다양성 Lane 1). 밀도·거동 다양성을 보스에 집중한다
 * (CONTEXT.md: "탄 밀도는 보스·엘리트에 집중"). 판정점(ADR-0010)이 작아 이 밀도가
 * 공정해진다 — 빽빽해 보여도 판정점으로 틈을 빠져나가는 "피하는 맛".
 *   - ring        → 가속 직진: 링이 밖으로 갈수록 빨라져 회피 창을 좁힌다.
 *   - spiral      → 분열 산탄: 나선 탄이 퓨즈 뒤 자탄으로 갈라져 2차 위협(밀도 집중).
 *   - aimedBurst  → 유도 호밍(락 만료): 조준 창격이 잠깐 따라오다 직진(회피 가능).
 */
const BOSS_RING_ACCEL = 620; // units/second²
const BOSS_SPIRAL_FUSE = 40; // 분열 퓨즈(틱)
const BOSS_SPIRAL_CHILDREN = 2; // 자탄 수(절제 — 상한 gate와 함께 폭주 방지)
const BOSS_SPIRAL_CHILD_SPEED_MULT = 0.62;
const BOSS_HOMING_LOCK = 48; // 유도 락 지속(틱) ≈ 0.8s
const BOSS_HOMING_TURN = 0.055; // rad/tick 선회 상한(회피 가능한 완만함)

/** Phase-transition animation length: 2 seconds (spec). */
export const BOSS_PHASE_TRANSITION_TICKS = 120;
/** Overheat window after casting a pattern: 5 seconds, double damage taken (spec). */
export const BOSS_OVERHEAT_TICKS = 300;

/**
 * 이 런의 보스 정의를 고르는 **단일 정본**.
 *
 * ⚠️ **스폰과 매 틱이 같은 함수를 불러야 한다.** 예전에는 스폰(`world.ts`)만 의뢰 보스로 갈리고
 * `updateBoss` 는 계속 `planetContent(config.planet).boss` 를 읽었다. 그러면 런에 닿는 것이
 * `hp`·`radius`·`contactDamage` 뿐이고 **3페이즈 공격 프리미티브와 `moveSpeed` 는 전부 행성 보스
 * 것으로 대체**된다 — 화면에는 의뢰 보스 모델이 뜨는데 싸우는 패턴은 그 행성 보스이고, 예외도
 * 로그도 없다. 연쇄 원정은 정의상 여러 행성을 밟으므로 **같은 의뢰 보스가 구간마다 다른 보스처럼
 * 싸운다**. 두 호출자를 여기로 모아 그 갈림이 구조적으로 불가능하게 만든다.
 *
 * 무의뢰 런은 `commission` 이 `undefined` 라 예전 표현식 그대로다 — **해시 바이트 불변**.
 */
export function bossDefFor(state: WorldState): BossDef {
  const order = state.config.commission?.order;
  return order !== undefined ? commissionBossDef(order) : planetContent(state.config.planet).boss;
}

/** Advance the boss by one tick: transitions, movement, overheat, patterns. */
export function updateBoss(state: WorldState, boss: Entity, player: Entity): void {
  // 행성 보스(카르곤 용암 요새 / 베르단 여왕) 또는 의뢰 보스. 3페이즈·과열 리듬 골격은 공유.
  const bossDef = bossDefFor(state);
  // Phase-transition animation: frozen, no fire, no overheat decay.
  if (boss.timer > 0) {
    boss.timer--;
    boss.vx = 0;
    boss.vy = 0;
    return;
  }

  // Threshold crossing → advance phase, freeze, clear the screen of enemy fire.
  // Overkill policy: if a single tick's damage crosses BOTH thresholds at once
  // (e.g. 80% → 20%), `targetPhase` is the final phase (2) and the boss jumps
  // straight there, playing ONE transition (the intermediate phase 1 and its
  // transition are skipped). This is intentional — a burst that big has earned
  // the skip, and we never want two 2s freezes stacked on one tick. Phase index
  // therefore only ever moves forward, one resolve per tick.
  const frac = boss.maxHp > 0 ? boss.hp / boss.maxHp : 0;
  const targetPhase = frac > 0.7 ? 0 : frac > 0.35 ? 1 : 2;
  if (targetPhase > boss.phase) {
    boss.phase = targetPhase;
    boss.timer = BOSS_PHASE_TRANSITION_TICKS;
    boss.iframes = 0;
    boss.cooldown = 0;
    boss.dashCooldown = 0; // re-arm overheat for the new phase's first signature
    clearEnemyBullets(state);
    return;
  }

  // 추격(Lane6): 취약화 전(aux0===0) 무적 포식자는 머리 위 hover(moveBoss)가 아니라 플레이어
  // 실좌표로 수렴해 접촉 즉사가 조직적 위협이 되게 한다(리뷰 MED — '끝없이 추격·회피 불가 즉사'
  // 시그니처 발현). 취약화(aux0===1) 후엔 일반 보스전(moveBoss hover + 패턴)으로 복귀한다.
  // planetMode 게이트라 뱀서류·침공·블록격파·레이싱·오염은 else 경로(moveBoss)로 바이트 불변.
  if (state.config.planetMode === PLANET_MODE.chase && boss.aux0 === 0) {
    chasePredatorPursue(boss, player);
  } else {
    moveBoss(boss, player, bossDef);
  }

  if (boss.iframes > 0) boss.iframes--;
  if (boss.dashCooldown > 0) boss.dashCooldown--;

  if (boss.cooldown > 0) {
    boss.cooldown--;
    return;
  }
  // 팬텀 은신(M8 시그니처, 비트 20): 조준 대상을 잃은 보스는 이번 틱 패턴을 **캐스트하지
  // 않는다**. 위 `moveBoss` 는 이미 끝났으므로 호버 추적은 그대로다(정지시키지 않는다).
  // 여기서 반환하면 `boss.cooldown` 이 0 에 머물고 `boss.pierce`(패턴 라운드로빈)·과열 창도
  // 진행하지 않아, 은신이 풀린 첫 틱에 원래 쏘려던 패턴이 그대로 나간다 — 은신이 보스의 패턴
  // 순서를 건너뛰게 만들지 않는다. 시그니처 미보유 런에서는 즉시 false 라 무영향.
  if (playerCloaked(state, player)) return;
  const phase = bossDef.phases[boss.phase];
  if (phase === undefined) return;
  const attackIndex = boss.pierce % phase.attacks.length;
  const attack = phase.attacks[attackIndex];
  if (attack !== undefined) executeAttack(state, boss, player, attack);
  boss.pierce++;
  boss.cooldown = phase.patternCooldown;
  // The overheat window opens only after the phase's SIGNATURE cast (attack
  // index 0), and only once its re-arm timer has elapsed. That gives the 5s
  // vulnerable window a genuine closed gap (overheatInterval - 300 ticks)
  // instead of resetting on every cast — restoring the spec's open/close rhythm.
  if (attackIndex === 0 && boss.dashCooldown === 0) {
    boss.iframes = BOSS_OVERHEAT_TICKS;
    boss.dashCooldown = phase.overheatInterval;
  }
}

/** Slow hover above the player, tracking them horizontally (infinite map:
 *  hover point is player-relative, no arena clamp). */
function moveBoss(boss: Entity, player: Entity, bossDef: BossDef): void {
  const sp = bossDef.moveSpeed;
  const stepMax = sp * DT;
  const targetY = player.y - VIEW_HEIGHT * 0.28;
  const dy = targetY - boss.y;
  boss.y += clamp(dy, -stepMax, stepMax);
  const dx = player.x - boss.x;
  boss.x += clamp(dx, -stepMax, stepMax);
  boss.angle = atan2(player.y - boss.y, player.x - boss.x);
}

function executeAttack(state: WorldState, boss: Entity, player: Entity, atk: BossAttack): void {
  switch (atk.kind) {
    case 'ring': {
      for (let i = 0; i < atk.count; i++) {
        if (state.enemyBulletCount >= state.bulletCap) break;
        const ang = (i * TWO_PI) / atk.count;
        // ownerId = 보스 자신(배치7 F2a — AS7 원한 표적 선결).
        const b = spawnEnemyBullet(
          state,
          boss.x,
          boss.y,
          cos(ang) * atk.speed,
          sin(ang) * atk.speed,
          ang,
          atk.damage,
          atk.bulletRadius,
          atk.bulletLife,
          boss.id,
        );
        // 시그니처: 가속 직진.
        applyBehavior(b, accelBehavior(atk.speed, BOSS_RING_ACCEL));
        state.enemyBulletCount++;
      }
      break;
    }
    case 'spiral': {
      // Base angle advances each cast (stored on targetX) to trace a spiral.
      const base = boss.targetX;
      for (let i = 0; i < atk.count; i++) {
        if (state.enemyBulletCount >= state.bulletCap) break;
        const ang = base + (i * TWO_PI) / atk.count;
        // ownerId = 보스 자신(배치7 F2a — AS7 원한 표적 선결).
        const b = spawnEnemyBullet(
          state,
          boss.x,
          boss.y,
          cos(ang) * atk.speed,
          sin(ang) * atk.speed,
          ang,
          atk.damage,
          atk.bulletRadius,
          atk.bulletLife,
          boss.id,
        );
        // 시그니처: 분열 산탄(퓨즈 뒤 자탄 방사). 밀도를 보스에 집중.
        applyBehavior(
          b,
          splitBehavior(
            atk.speed,
            BOSS_SPIRAL_FUSE,
            BOSS_SPIRAL_CHILDREN,
            atk.speed * BOSS_SPIRAL_CHILD_SPEED_MULT,
          ),
        );
        state.enemyBulletCount++;
      }
      boss.targetX = base + atk.turn;
      break;
    }
    case 'lavaLine': {
      // Fixed viewport-width pillar span centred on the player (infinite map).
      const step = HAZARD_LINE_SPAN / (atk.pillars + 1);
      const startX = player.x - HAZARD_LINE_SPAN / 2;
      for (let i = 1; i <= atk.pillars; i++) {
        spawnHazard(
          state,
          HAZARD_LAVA,
          startX + step * i,
          player.y,
          atk.radius,
          atk.windup,
          atk.activeTicks,
          atk.damage,
          true,
          boss.id,
        );
      }
      break;
    }
    case 'summon': {
      // 무리개체 소환(plan E2): 현재 행성 로스터에서 역할을 뽑아 보스 주변 링에
      // 즉시 스폰. 고정 각도(RNG 미소비) — 결정론. 정의되지 않은 역할이면 무시.
      const def = planetContent(state.config.planet).roster[atk.role];
      if (def === undefined) break;
      const ringR = SPAWN_RING_RADIUS * 0.5;
      for (let i = 0; i < atk.count; i++) {
        const ang = (i * TWO_PI) / atk.count;
        summonEnemy(state, def, boss.x + cos(ang) * ringR, boss.y + sin(ang) * ringR);
      }
      break;
    }
    case 'aimedBurst': {
      // 과열 창/포위(plan E2): 플레이어를 향해 조준된 부채꼴 고속탄. arc=0이면 단일
      // 직선 창. 세그먼트 탄 상한을 존중한다(결정론, 조준각은 위치의 함수).
      const aim = atan2(player.y - boss.y, player.x - boss.x);
      const n = atk.count;
      const start = n > 1 ? aim - atk.arc / 2 : aim;
      const stepA = n > 1 ? atk.arc / (n - 1) : 0;
      for (let i = 0; i < n; i++) {
        if (state.enemyBulletCount >= state.bulletCap) break;
        const ang = start + stepA * i;
        // ownerId = 보스 자신(배치7 F2a — AS7 원한 표적 선결).
        const b = spawnEnemyBullet(
          state,
          boss.x,
          boss.y,
          cos(ang) * atk.speed,
          sin(ang) * atk.speed,
          ang,
          atk.damage,
          atk.bulletRadius,
          atk.bulletLife,
          boss.id,
        );
        // 시그니처: 유도 호밍(락 만료 후 직진 — 회피 가능한 조준 창격).
        applyBehavior(b, homingBehavior(atk.speed, BOSS_HOMING_LOCK, BOSS_HOMING_TURN));
        state.enemyBulletCount++;
      }
      break;
    }
    case 'laserNet': {
      // 레이저 그물(plan B1): 뷰포트 폭 위에 균등 배치한 수직 열(아래로) + 수평 행
      // (오른쪽으로)으로 격자를 만든다. 고정 간격·방향(RNG 미소비) — 결정론.
      const span = HAZARD_LINE_SPAN;
      const step = span / (atk.lines + 1);
      // 수직 열: 플레이어 위쪽에서 아래로.
      for (let i = 1; i <= atk.lines; i++) {
        if (state.enemyBulletCount >= state.bulletCap) break;
        // ownerId = 보스 자신(배치7 F2a — AS7 원한 표적 선결).
        spawnEnemyBullet(
          state,
          player.x - span / 2 + step * i,
          player.y - span / 2,
          0,
          atk.speed,
          HALF_PI,
          atk.damage,
          atk.bulletRadius,
          atk.bulletLife,
          boss.id,
        );
        state.enemyBulletCount++;
      }
      // 수평 행: 플레이어 왼쪽에서 오른쪽으로.
      for (let i = 1; i <= atk.lines; i++) {
        if (state.enemyBulletCount >= state.bulletCap) break;
        // ownerId = 보스 자신(배치7 F2a — AS7 원한 표적 선결).
        spawnEnemyBullet(
          state,
          player.x - span / 2,
          player.y - span / 2 + step * i,
          atk.speed,
          0,
          0,
          atk.damage,
          atk.bulletRadius,
          atk.bulletLife,
          boss.id,
        );
        state.enemyBulletCount++;
      }
      break;
    }
    case 'slowField': {
      // 감속 지대(plan B1): 플레이어 주변 뷰포트 폭에 HAZARD_SLOW 장판을 균등 융기.
      const step = HAZARD_LINE_SPAN / (atk.zones + 1);
      const startX = player.x - HAZARD_LINE_SPAN / 2;
      for (let i = 1; i <= atk.zones; i++) {
        spawnHazard(
          state,
          HAZARD_SLOW,
          startX + step * i,
          player.y,
          atk.radius,
          atk.windup,
          atk.activeTicks,
          atk.damage,
          true,
          boss.id,
        );
      }
      break;
    }
    case 'polygonSpin': {
      // 기하학 회전 다각형 탄막(plan B2): sides각형 각 변 방향으로 perSide 발 부채꼴을
      // 쏘고, 기준각(boss.targetX)을 turn만큼 돌려 회전시킨다. 결정론(누산 각도만).
      const base = boss.targetX;
      for (let s = 0; s < atk.sides; s++) {
        const sideAngle = base + (s * TWO_PI) / atk.sides;
        const n = atk.perSide;
        const start = n > 1 ? sideAngle - atk.spread / 2 : sideAngle;
        const stepA = n > 1 ? atk.spread / (n - 1) : 0;
        for (let i = 0; i < n; i++) {
          if (state.enemyBulletCount >= state.bulletCap) break;
          const ang = start + stepA * i;
          // ownerId = 보스 자신(배치7 F2a — AS7 원한 표적 선결).
          spawnEnemyBullet(
            state,
            boss.x,
            boss.y,
            cos(ang) * atk.speed,
            sin(ang) * atk.speed,
            ang,
            atk.damage,
            atk.bulletRadius,
            atk.bulletLife,
            boss.id,
          );
          state.enemyBulletCount++;
        }
      }
      boss.targetX = base + atk.turn;
      break;
    }
  }
}

/** Wipe every live enemy bullet — the phase-transition screen clear (spec). */
function clearEnemyBullets(state: WorldState): void {
  for (const e of state.entities) {
    if (e.kind === 'enemyBullet') e.dead = true;
  }
}
