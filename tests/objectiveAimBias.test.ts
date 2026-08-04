/**
 * 목표 오브젝트(추격 반격 장치 · 오염 노드)의 **조준 우선 가중치** 계약.
 *
 * `src/sim/modes/objective.ts` 머리의 결함 4회는 "조준 목록에 없어서 **아예** 못 친다"였고,
 * 이 축은 그다음 단계 — "목록에는 있는데 **순번이 오지 않는다**" — 를 막는다. 잡몹은 언제나
 * 플레이어를 향해 몰려오므로 최근접 조준에서 거의 항상 목표보다 가깝고, 단계가 오를수록
 * 수·밀도가 함께 늘어 그 확률이 1 에 수렴한다.
 *
 * 세 가지를 각각 못 박는다:
 *
 * 1. **단계 1 은 정확히 1** — 저단계 거동이 바이트 불변이라는 계약(이 축의 도입 근거가
 *    "고정 우선권은 저단계를 깎는다"는 실측이었다. 니플헤임 Lv5 38% → 29%).
 * 2. **단조 감소 · 포화** — 단계가 오르면 우선권이 세지고 상한 단계에서 멎는다.
 * 3. **배선 실도달** — 실제 `stepWorld` 조준 경로가 이 값을 탄다. 순수 함수만 검사하면
 *    "함수는 맞는데 world 가 안 부른다"를 통과시킨다(이 저장소의 대표적 반복 결함).
 *
 * ⚠️ 3번의 대조군(단계 1)이 이 파일의 핵심이다. 고단계만 재면 "우선권이 걸렸다"가 아니라
 * "원래 장치를 쏘고 있었다"와 구분되지 않는다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import { blankEntity } from '../src/sim/entities.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import {
  isContaminationNode,
  contaminationNodeHp,
  CONTAMINATION_NODE_HP_BASE,
} from '../src/sim/modes/contamination.js';
import {
  objectiveLowStageRelief,
  OBJECTIVE_LOW_STAGE_RELIEF,
  OBJECTIVE_RELIEF_ENDS_AT,
} from '../data/waves.js';
import {
  objectiveAimBias,
  isObjectiveDestructible,
  OBJECTIVE_AIM_BIAS_STAGE_1,
  OBJECTIVE_AIM_BIAS_STAGE_MAX,
  OBJECTIVE_AIM_BIAS_STAGE_MAX_AT,
} from '../src/sim/modes/objective.js';

/**
 * 오염 무대(톡사르) 판 — 이 축의 **유일한 실배선 무대**다.
 *
 * ⚠️ 예전에는 추격(반격 장치) 판이 짝을 이뤄 "두 무대 모두"를 못 박았다. 반격 장치는
 * 2026-08-05 재설계로 사라졌고(`sim/modes/chase.ts`), 추격의 목표는 파괴물이 아니라 **미확보
 * 대피소**가 됐다 — 조준이 아니라 이동으로 닿는 것이라 이 축을 타지 않는다. 그래서 여기서
 * 추격을 재려는 시도는 전부 거짓 신호다(장치가 없어 `find` 가 undefined 를 낸다).
 *
 * ⚠️ 자인: `nearestTarget` 의 벽-없음 fast path 는 여기서도 **재지 못한다**. 오염은 벽이 상시
 * 존재해(실측 activeWalls 5개) 실전에서 LOS 경로만 타기 때문이다 — 실제로 fast path 의
 * 가중치를 지워도 이 파일은 전부 초록이었다. 그 줄의 존재 이유는 world.ts 주석 참조.
 */
function nodeDamageWithCloserEnemy(stage: number, ticks = 120): number {
  const state: WorldState = createWorld(1234, {
    ...buildRunConfig(defaultProfile(), { planet: 4, stage }),
    planetMode: PLANET_MODE.contamination,
    playerHp: 1_000_000,
  });
  const player = state.entities[0]!;
  const node = state.entities.find((e) => !e.dead && isContaminationNode(e))!;

  player.x = node.x - 200;
  player.y = node.y;
  const enemy = blankEntity('enemy');
  enemy.x = player.x;
  enemy.y = player.y + 100; // 사선 밖 · 노드보다 가깝다(위 헬퍼와 같은 이유).
  enemy.radius = 24;
  enemy.hp = 1e9;
  enemy.maxHp = 1e9;
  state.entities.push(enemy);

  const before = node.hp;
  for (let i = 0; i < ticks; i++) stepWorld(state, emptyInput());
  return before - node.hp;
}

describe('목표 오브젝트 조준 우선 가중치', () => {
  it('단계 1 은 정확히 1 이다 — 저단계 거동 불변 계약', () => {
    expect(objectiveAimBias(1)).toBe(1);
    expect(objectiveAimBias(0)).toBe(1);
    expect(objectiveAimBias(-5)).toBe(1);
    expect(OBJECTIVE_AIM_BIAS_STAGE_1).toBe(1);
  });

  it('단계가 오르면 우선권이 단조로 세지고 상한 단계에서 포화한다', () => {
    let prev = objectiveAimBias(1);
    for (let s = 2; s <= OBJECTIVE_AIM_BIAS_STAGE_MAX_AT; s++) {
      const cur = objectiveAimBias(s);
      expect(cur, `stage ${s}`).toBeLessThan(prev);
      prev = cur;
    }
    expect(objectiveAimBias(OBJECTIVE_AIM_BIAS_STAGE_MAX_AT)).toBe(OBJECTIVE_AIM_BIAS_STAGE_MAX);
    // 상한 밖은 더 세지지 않는다(포화) — 만렙 상향이 조준을 계속 바꾸면 안 된다.
    expect(objectiveAimBias(OBJECTIVE_AIM_BIAS_STAGE_MAX_AT + 30)).toBe(
      OBJECTIVE_AIM_BIAS_STAGE_MAX,
    );
    // 우선권은 "더 가깝게 친다"이지 "사거리를 늘린다"가 아니다 — 0 초과 1 이하.
    expect(OBJECTIVE_AIM_BIAS_STAGE_MAX).toBeGreaterThan(0);
    expect(OBJECTIVE_AIM_BIAS_STAGE_MAX).toBeLessThan(1);
  });

  it('고단계에서는 더 가까운 잡몹을 제치고 오염 노드를 친다 — 단계 1 은 안 친다(배선 실도달)', () => {
    // 대조군이 먼저다. 단계 1 에서 가중치는 1 이므로 최근접(잡몹)만 맞아야 한다.
    expect(nodeDamageWithCloserEnemy(1)).toBe(0);
    // 같은 배치에서 고단계는 노드에 화력이 들어간다.
    expect(nodeDamageWithCloserEnemy(OBJECTIVE_AIM_BIAS_STAGE_MAX_AT)).toBeGreaterThan(0);
  });

  it('추격에는 목표 파괴물이 없다 — 이 축이 적용될 대상 자체가 없다(재설계 계약)', () => {
    // 이 단언이 깨지면(추격에 파괴물이 다시 생기면) 위 조준 축을 그 무대에도 배선했는지
    // 반드시 확인해야 한다 — "목록이 갈린다"가 이 축의 대표 실패 모드다.
    const w = createWorld(1234, {
      ...buildRunConfig(defaultProfile(), { planet: 2, stage: 1 }),
      planetMode: PLANET_MODE.chase,
      playerHp: 1_000_000,
    });
    expect(w.entities.some((e) => !e.dead && isObjectiveDestructible(e))).toBe(false);
  });
});

/**
 * 목표 총 HP 의 **저단계 완화**(2026-08-03, Lv5 축).
 *
 * 완화가 끝나는 단계 이상에서 **정확히 1** 이어야 한다는 것이 이 축의 안전 계약이다 —
 * 그래야 §R12 에서 함께 정해진 세 손잡이(목표 HP · 피격 배율 · 단계 기울기)의 중·고단계
 * 균형이 한 글자도 안 바뀐다.
 */
describe('목표 총 HP 저단계 완화', () => {
  it('완화 종료 단계 이상은 정확히 1 이다 — 중·고단계 균형 불변 계약', () => {
    for (const s of [OBJECTIVE_RELIEF_ENDS_AT, OBJECTIVE_RELIEF_ENDS_AT + 1, 11, 20, 50]) {
      expect(objectiveLowStageRelief(s), `stage ${s}`).toBe(1);
    }
  });

  it('단계 1 에서 가장 크게 덜고 종료 단계까지 단조로 복귀한다', () => {
    expect(objectiveLowStageRelief(1)).toBe(OBJECTIVE_LOW_STAGE_RELIEF);
    expect(objectiveLowStageRelief(0)).toBe(OBJECTIVE_LOW_STAGE_RELIEF);
    let prev = objectiveLowStageRelief(1);
    for (let s = 2; s <= OBJECTIVE_RELIEF_ENDS_AT; s++) {
      const cur = objectiveLowStageRelief(s);
      expect(cur, `stage ${s}`).toBeGreaterThan(prev);
      prev = cur;
    }
    expect(OBJECTIVE_LOW_STAGE_RELIEF).toBeGreaterThan(0);
    expect(OBJECTIVE_LOW_STAGE_RELIEF).toBeLessThan(1);
  });

  it('오염 노드 HP 가 실제로 이 계수를 탄다(배선 실도달)', () => {
    // 단계 1 은 기울기 항이 0 이라 `base × 완화` 와 정확히 같아야 한다. 배선이 빠지면 base
    // 그대로가 되어 이 단언이 깨진다(항진이 아니다 — 실제 상수와 대조한다).
    //
    // ⚠️ 짝이던 `chaseCounterDeviceHp` 는 2026-08-05 재설계로 **어떤 엔티티에도 쓰이지 않는다**
    // (반격 장치가 배치되지 않는다). 계속 재면 "배선이 살아 있다"는 거짓 신호가 된다.
    expect(contaminationNodeHp(1)).toBe(
      Math.round(CONTAMINATION_NODE_HP_BASE * OBJECTIVE_LOW_STAGE_RELIEF),
    );
  });
});
