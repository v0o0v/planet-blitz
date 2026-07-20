/**
 * 침공 3레이어 — 페이즈 머신 L1→L2→L3 (M7a · L2-scroll-phase).
 *
 * 커버리지:
 *   1. L1/L2 에서 코어 kind 가 죽어도 victory 가 서지 않는다(기만 홀로그램 대비).
 *   2. L3 코어 파괴만 victory.
 *   3. 전이 틱 결정성(같은 입력 → 같은 전이 틱).
 *   4. 레이어 클리어 자원 승계 + 보너스(HP 20% · 폭탄 +1).
 *   5. 총 18000틱 hard 상한에서 gameOver, 17999 는 아님.
 *   6. 레이어 soft 예산 소진 시 강제 전이(주파 미완료여도).
 *   7. 전이 엔티티 정리 규칙(적 제거 · 플레이어 투사체 승계).
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import { blankEntity } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { emptyInvasionLayers } from '../src/sim/invasion/normalize.js';
import {
  INVASION_L1_TICKS,
  INVASION_TOTAL_TICKS,
  LAYER_CLEAR_HEAL_PERCENT,
  PHASE_L1,
  PHASE_L2,
  PHASE_L3,
} from '../src/sim/invasion/constants.js';
import {
  INVASION_BOMB_CAP,
  clearLayerEntities,
  isClearTarget,
  isSegmentCleared,
} from '../src/sim/invasion/phase.js';

const idle: InputFrame = emptyInput();

function invasion3Config(timeLimitTicks = INVASION_TOTAL_TICKS): WorldConfig {
  return {
    arenaWidth: 1920,
    arenaHeight: 1080,
    playerSpeed: 720,
    dashSpeed: 2800,
    dashCooldownTicks: 42,
    dashIframes: 10,
    hitIframes: 40,
    playerHp: 100,
    invasion3: { layers: emptyInvasionLayers(), timeLimitTicks },
  };
}

/** 테스트용 엔티티를 월드에 직접 얹는다(진입 훅이 아직 미배선이라 배치를 손으로 만든다). */
function push(state: WorldState, kind: Entity['kind'], x: number, y: number): Entity {
  const e = blankEntity(kind);
  e.id = state.nextEntityId++;
  e.x = x;
  e.y = y;
  e.hp = 1;
  e.maxHp = 1;
  e.radius = 40;
  state.entities.push(e);
  return e;
}

describe('승리 판정 — 코어는 L3 에서만', () => {
  it('L1 에서 코어 kind 가 죽어도 victory 가 서지 않는다', () => {
    const w = createWorld(11, invasion3Config());
    const core = push(w, 'core', 0, -200);
    core.dead = true;
    stepWorld(w, idle);
    expect(w.victory).toBe(false);
    expect(w.invasion3?.phase).toBe(PHASE_L1);
  });

  it('L2 에서도 동일하다', () => {
    const w = createWorld(12, invasion3Config());
    w.invasion3!.phase = PHASE_L2;
    const core = push(w, 'core', 0, -200);
    core.dead = true;
    stepWorld(w, idle);
    expect(w.victory).toBe(false);
  });

  it('L3 코어 파괴만 victory 를 세운다', () => {
    const w = createWorld(13, invasion3Config());
    w.invasion3!.phase = PHASE_L3;
    const core = push(w, 'core', 0, -200);
    core.dead = true;
    stepWorld(w, idle);
    expect(w.victory).toBe(true);
  });

  it('3레이어 침공에서는 boss kind 격파가 victory 를 세우지 않는다', () => {
    const w = createWorld(14, invasion3Config());
    w.invasion3!.phase = PHASE_L3;
    const boss = push(w, 'boss', 0, -200);
    boss.dead = true;
    stepWorld(w, idle);
    expect(w.victory).toBe(false);
  });
});

describe('페이즈 전이', () => {
  it('빈 배치(구간 전멸)에서 L1→L2→L3 로 순서대로 넘어간다', () => {
    const w = createWorld(21, invasion3Config());
    const seen: number[] = [];
    for (let i = 0; i < INVASION_TOTAL_TICKS; i++) {
      stepWorld(w, idle);
      const p = w.invasion3!.phase;
      if (seen[seen.length - 1] !== p) seen.push(p);
      if (p === PHASE_L3) break;
    }
    expect(seen).toEqual([PHASE_L1, PHASE_L2, PHASE_L3]);
  });

  it('전이 틱이 결정적이다(같은 입력 2회 실행 → 같은 전이 틱)', () => {
    const transitionTicks = (): number[] => {
      const w = createWorld(22, invasion3Config());
      const out: number[] = [];
      let prev = w.invasion3!.phase;
      for (let i = 0; i < 12000; i++) {
        stepWorld(w, { ...idle, moveX: 1, moveY: -1 });
        const p = w.invasion3!.phase;
        if (p !== prev) {
          out.push(w.invasion3!.phaseEnterTick);
          prev = p;
        }
      }
      return out;
    };
    const a = transitionTicks();
    const b = transitionTicks();
    expect(a).toEqual(b);
    expect(a.length).toBe(2);
  });

  it('구간 전멸이면 soft 예산보다 **빨리** 전이한다(가속 보상)', () => {
    const w = createWorld(23, invasion3Config());
    let tick = -1;
    for (let i = 0; i < INVASION_L1_TICKS; i++) {
      stepWorld(w, idle);
      if (w.invasion3!.phase !== PHASE_L1) {
        tick = w.invasion3!.phaseEnterTick;
        break;
      }
    }
    expect(tick).toBeGreaterThan(0);
    expect(tick).toBeLessThan(INVASION_L1_TICKS);
  });

  it('전멸하지 못하면 soft 예산 소진 시점에 강제 전이한다', () => {
    const w = createWorld(24, invasion3Config());
    // 파괴 대상이 계속 살아 있으면 가속이 붙지 않아(항상 100cp) 주파를 못 끝낸다.
    // 플레이어 사거리 밖 먼 좌표라 사고로 격파되지 않는다.
    const blocker = push(w, 'destructible', 900000, 900000);
    blocker.hp = 1e9;
    blocker.maxHp = 1e9;
    for (let i = 0; i < INVASION_L1_TICKS; i++) {
      stepWorld(w, idle);
      // 마지막 틱 전까지는 L1 유지.
      if (i < INVASION_L1_TICKS - 1) expect(w.invasion3!.phase).toBe(PHASE_L1);
    }
    expect(w.invasion3!.phase).toBe(PHASE_L2);
    expect(w.invasion3!.phaseEnterTick).toBe(INVASION_L1_TICKS);
    // 가속은 새 레이어에서 기준값으로 리셋된다.
    expect(w.invasion3!.accelCp).toBe(100);
  });

  it('레이어 클리어 보너스 — 최대 HP 20% 회복 + 폭탄 +1(상한 내)', () => {
    const w = createWorld(25, invasion3Config());
    const player = w.entities[0]!;
    player.hp = 50;
    let healedTo = -1;
    for (let i = 0; i < INVASION_TOTAL_TICKS; i++) {
      stepWorld(w, idle);
      if (w.invasion3!.phase !== PHASE_L1) {
        healedTo = player.hp;
        break;
      }
    }
    expect(healedTo).toBe(50 + Math.round((player.maxHp * LAYER_CLEAR_HEAL_PERCENT) / 100));
    expect(w.invasion3Bombs).toBe(1);
    // L3 까지 마저 진행하면 두 번째 전이 보너스가 더해진다(상한 이하).
    for (let i = 0; i < INVASION_TOTAL_TICKS; i++) {
      stepWorld(w, idle);
      if (w.invasion3!.phase === PHASE_L3) break;
    }
    expect(w.invasion3Bombs).toBe(Math.min(INVASION_BOMB_CAP, 2));
    // HP 는 최대치를 넘지 않는다.
    expect(player.hp).toBeLessThanOrEqual(player.maxHp);
  });
});

describe('전이 엔티티 정리 규칙', () => {
  it('적·적탄·해저드는 제거하고 플레이어와 그 투사체는 승계한다', () => {
    const w = createWorld(31, invasion3Config());
    push(w, 'enemy', 100, 100);
    push(w, 'enemyBullet', 120, 100);
    push(w, 'hazard', 140, 100);
    push(w, 'defenseTurret', 160, 100);
    const bullet = push(w, 'bullet', 180, 100);
    const killsBefore = w.kills;
    clearLayerEntities(w);
    const kinds = w.entities.map((e) => e.kind);
    expect(kinds).toEqual(['player', 'bullet']);
    expect(w.entities[1]!.id).toBe(bullet.id);
    // 전이 정리는 "처치"가 아니다 — 처치 수·젬 환산 경로를 타면 안 된다.
    expect(w.kills).toBe(killsBefore);
  });

  it('스칼라 자원(hp·gems·resources)은 전이로 손실되지 않는다', () => {
    const w = createWorld(32, invasion3Config());
    w.gems = 17;
    w.resources = 5;
    w.xpTotal = 300;
    for (let i = 0; i < INVASION_TOTAL_TICKS; i++) {
      stepWorld(w, idle);
      if (w.invasion3!.phase !== PHASE_L1) break;
    }
    expect(w.gems).toBe(17);
    expect(w.resources).toBe(5);
    expect(w.xpTotal).toBe(300);
  });
});

describe('전멸 판정 대상', () => {
  it('파괴 불가 영구 해저드(life < 0)는 전멸 판정에서 제외된다', () => {
    const w = createWorld(41, invasion3Config());
    const permanent = push(w, 'hazard', 0, 0);
    permanent.life = -1;
    expect(isClearTarget(permanent)).toBe(false);
    expect(isSegmentCleared(w)).toBe(true);
    const finite = push(w, 'hazard', 0, 0);
    finite.life = 60;
    expect(isClearTarget(finite)).toBe(true);
    expect(isSegmentCleared(w)).toBe(false);
  });

  it('벽·젬·탄은 전멸 판정 대상이 아니다', () => {
    const w = createWorld(42, invasion3Config());
    push(w, 'wall', 0, 0);
    push(w, 'gem', 0, 0);
    push(w, 'bullet', 0, 0);
    expect(isSegmentCleared(w)).toBe(true);
  });
});

describe('총 제한 시간(hard)', () => {
  it('18000틱 도달 시 gameOver, 17999 에서는 아니다', () => {
    // 이 테스트가 재는 것은 **hard 상한 틱**이지 승패가 아니다. 스텝 훅이 배선된 뒤로는 런이
    // 실제로 진행되므로 두 가지 조기 종료가 끼어든다 — ① 플레이어 자동 사격이 코어를 부수면
    // victory(실측 tick 15069), ② 코어방 보스·기물 피해로 플레이어가 죽으면 gameOver. 둘 다
    // 막아야 18000틱 상한만 남는다(막지 않으면 gameOver 의 원인이 뒤섞여 상한을 못 잰다).
    const cfg = invasion3Config();
    cfg.invasion3!.layers.l3.core.hp = 1_000_000_000;
    const w = createWorld(51, cfg);
    const p0 = w.entities[0]!;
    p0.maxHp = 1e9;
    p0.hp = 1e9;
    for (let i = 0; i < INVASION_TOTAL_TICKS - 1; i++) stepWorld(w, idle);
    expect(w.gameOver).toBe(false);
    expect(w.victory).toBe(false);
    stepWorld(w, idle);
    expect(w.gameOver).toBe(true);
    expect(w.victory).toBe(false);
    expect(w.tick).toBe(INVASION_TOTAL_TICKS);
  });

  it('짧은 제한 시간도 그대로 존중한다(서버 권위값 주입 경로)', () => {
    const w = createWorld(52, invasion3Config(300));
    for (let i = 0; i < 299; i++) stepWorld(w, idle);
    expect(w.gameOver).toBe(false);
    stepWorld(w, idle);
    expect(w.gameOver).toBe(true);
  });
});
