/**
 * 한 틱 다중 명중의 **해소 순서** — 격자 순서가 아니라 경로 순서.
 *
 * ## 무엇이 문제였나
 * PR#146 이 플레이어탄 대 적 판정을 선분(`sweptCircleOverlap`)으로 올리면서, 탄 하나가 한 틱에
 * 62유닛 경로 위 **여러** 표적을 후보로 갖게 됐다. 그런데 후보를 넘겨주는 `SpatialHash.query` 는
 * 셀을 고정 `(cy, cx)` 순으로 훑는다 — **경로 순서와 무관하다.** `pierce === 0` 인 기본 탄은 첫
 * 명중에서 소멸하므로, 정렬하지 않으면 가까운 적을 지나쳐 **먼 적을 때린다**(결정론은 유지되지만
 * 화면에서는 탄이 앞 적을 통과한다).
 *
 * ## 이 저장소의 반복 결함
 * "단위 테스트는 그린인데 배선이 통째로 없다"(8+회). 그래서 프리미티브 계약(`tests/collision.ts`
 * 의 `sweptCircleHitT`)만 못박지 않고, 여기서는 **실제 `stepWorld`** 를 굴려 `resolveCollisions`
 * 가 정말 t 순으로 해소하는지 본다.
 *
 * ## 격자 순서를 일부러 뒤집는 법
 * 셀은 `cx` 오름차순으로 방문되고, 같은 셀 안에서는 `state.entities` 삽입 순서다. 그래서
 * **−x 방향으로 날아가는 탄**을 쓰고 **먼 표적을 먼저 push** 하면, 어느 셀 배치가 되든 격자
 * 순회는 항상 "먼 표적 먼저" 다. 정렬이 빠지면 이 테스트가 실패한다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import { blankEntity, spawnBullet, addEntity } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { DT } from '../src/sim/constants.js';

const idle: InputFrame = emptyInput();

/**
 * 무대 좌표. 플레이어는 원점에 서 있고, 두 상한 사이의 좁은 띠에 세워야 한다:
 *   - `BASE_WEAPON_RANGE`(1650) **밖** — 플레이어 오토어택이 이 표적들을 쏘지 않는다(오염 방지).
 *   - `PROJECTILE_CULL_RADIUS`(≈2200) **안** — 그 밖이면 탄이 판정 전에 컬링돼 죽는다.
 * 피해량(100)이 무기 피해와 달라서, 표적이 받은 피해가 우리 탄의 것임이 값으로 구별된다.
 */
const STAGE_X = 1980;
const STAGE_Y = 0;
/** 무대 탄의 피해 — 플레이어 무기 피해와 겹치지 않는 식별값. */
const STAGE_DAMAGE = 100;
/** 한 틱 이동량(유닛). 실제 아군탄(62)보다 크게 잡아 표적 두 개를 넉넉히 덮는다. */
const STEP = 250;

function stageConfig(): WorldConfig {
  return buildRunConfig(defaultProfile(), { planet: 0, stage: 1 });
}

/** 무대 좌표에 잡몹 하나를 세운다. hp 는 한 방에 죽지 않게 크게 잡는다(관통 예산 관측용). */
function plantEnemy(state: WorldState, x: number, y: number): Entity {
  const e = blankEntity('enemy');
  e.x = x;
  e.y = y;
  e.radius = 32;
  e.hp = 1_000_000;
  e.maxHp = 1_000_000;
  return addEntity(state, e);
}

/**
 * 탄 하나를 −x 로 날려 한 틱 굴린다. 표적은 **먼 것부터** 심어 격자 순회 순서를 뒤집는다.
 * `pierce` 로 관통 예산을 준다(0 = 기본 탄).
 */
function fireThrough(pierce: number): { near: Entity; far: Entity } {
  const state = createWorld(0x51de, stageConfig());
  // 먼 표적 먼저 → 같은 셀이면 삽입 순서로, 다른 셀이면 cx 오름차순으로, 어느 쪽이든 먼저 방문.
  const far = plantEnemy(state, STAGE_X - 200, STAGE_Y);
  const near = plantEnemy(state, STAGE_X - 60, STAGE_Y);
  // 탄은 x=STAGE_X 에서 태어나 이 틱에 STAGE_X-250 으로 간다 → 두 표적이 모두 경로 위.
  spawnBullet(state, STAGE_X, STAGE_Y, Math.PI, STEP / DT, STAGE_DAMAGE, pierce, 5, 120, -1, 0);
  stepWorld(state, idle);
  return { near, far };
}

describe('한 틱 다중 명중은 경로 순서로 해소된다', () => {
  it('관통 없는 탄은 가까운 표적을 때린다 (격자 순서가 먼 표적을 먼저 줘도)', () => {
    // 정렬 전에는 이 단언이 정확히 뒤집혀 있었다 — 먼 표적이 맞고 가까운 표적은 멀쩡했다.
    const { near, far } = fireThrough(0);
    expect(near.maxHp - near.hp).toBe(STAGE_DAMAGE);
    expect(far.hp).toBe(far.maxHp);
  });

  it('관통 1 인 탄은 두 표적을 모두 때린다 (관통 예산은 그대로 소비)', () => {
    const { near, far } = fireThrough(1);
    expect(near.maxHp - near.hp).toBe(STAGE_DAMAGE);
    expect(far.maxHp - far.hp).toBe(STAGE_DAMAGE);
  });
});
