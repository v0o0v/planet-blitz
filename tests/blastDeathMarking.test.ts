/**
 * `blastDamageAt` 사망 마킹 — 촉매 설계서 「남은 선결 과제 ⑨」.
 *
 * ## 무엇을 증명하는가
 * `compact()`(`world.ts`)는 **`e.dead === true` 만 수거**한다 — `hp <= 0` 단독으로는 걷지
 * 않는다. 그래서 `hp` 만 깎는 폭발 경로는 hp≤0 인 적을 **좀비**로 남긴다: 계속 움직이고
 * 공격하며, `state.kills` 에 안 잡히고 젬·전리품도 안 나온다.
 *
 * 본보기는 `status.ts` 의 `applyChain`·`tickEnemyStatus` 다 — 둘 다 `if (t.hp <= 0) t.dead = true;`
 * 한 줄로 마킹하고 집계는 `compact()` 에 맡긴다. 폭발도 같은 형태여야 한다.
 *
 * ⚠️ 순회 중 변형 금지 규율은 그대로다 — `dead` 플래그만 세우고 엔티티는 낳지도 지우지도
 * 않는다(`blastDamageAt` 주석의 계약).
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { InputFrame, WorldState, Entity } from '../src/sim/world.js';
import { blankEntity } from '../src/sim/entities.js';
import { blastDamageAt, blastDamage } from '../src/sim/activeTypes.js';

const IDLE: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };

/** 자동사격 탄이 1틱에 못 닿는 거리 — 사망 경로를 폭발 하나로 좁히는 장치. */
const ZOMBIE_DIST = 600;

function player(state: WorldState): Entity {
  const p = state.entities[0];
  if (p === undefined) throw new Error('player missing');
  return p;
}

/** 플레이어 기준 상대좌표에 적·보스 1기를 놓는다. */
function foeNear(
  state: WorldState,
  kind: 'enemy' | 'boss',
  dx: number,
  dy: number,
  hp: number,
): Entity {
  const p = player(state);
  const e = blankEntity(kind);
  e.id = 90000 + state.entities.length;
  e.hp = hp;
  e.maxHp = hp;
  e.x = p.x + dx;
  e.y = p.y + dy;
  state.entities.push(e);
  return e;
}

function mk(): WorldState {
  return createWorld(4242, { ...DEFAULT_CONFIG });
}

describe('⓪ 전제 — compact 가 걷는 술어', () => {
  it('폭발 대상은 실제로 반경 안에 있고 hp 가 실제로 줄어든다 (하한)', () => {
    const w = mk();
    const e = foeNear(w, 'enemy', 30, 0, 1000);
    const before = e.hp;
    // 반경 안에 있다는 것을 먼저 단언한다 — 이걸 빼면 아래 단언이 "안 맞았다"로도 통과한다.
    expect(Math.hypot(e.x - player(w).x, e.y - player(w).y)).toBeLessThanOrEqual(100);
    blastDamageAt(w, player(w).x, player(w).y, 100, 40);
    expect(e.hp).toBe(before - 40);
    expect(e.hp).toBeGreaterThan(0); // 이 케이스는 죽이지 않는다
  });

  it('반경 밖의 적은 hp 가 한 톨도 안 준다', () => {
    const w = mk();
    const far = foeNear(w, 'enemy', 400, 0, 1000);
    blastDamageAt(w, player(w).x, player(w).y, 100, 40);
    expect(far.hp).toBe(1000);
    expect(far.dead).toBe(false);
  });
});

describe('① 재현 — 폭발만으로 hp≤0 이 된 적', () => {
  it('폭발로 hp≤0 이 되면 그 자리에서 dead 로 마킹된다', () => {
    const w = mk();
    const e = foeNear(w, 'enemy', 30, 0, 5);
    expect(e.dead).toBe(false);
    blastDamageAt(w, player(w).x, player(w).y, 100, 50);
    expect(e.hp).toBeLessThanOrEqual(0); // 실제로 죽을 만큼 맞았다 (하한)
    expect(e.dead).toBe(true);
  });

  it('다음 stepWorld 에서 수거되고 처치로 집계된다 (좀비로 안 남는다)', () => {
    // ⚠️ 적을 플레이어 코앞에 두면 **자동사격 탄이 같은 틱에 마무리**해 버려서 이 단언이
    // 수정 전에도 통과한다(교란). 그래서 탄이 1틱에 못 닿는 거리(600px, bulletSpeed 1800×DT
    // ≈ 30px/tick)에 두고 폭발 중심을 **적 자신**으로 잡는다 — 사망 경로가 폭발 하나뿐이 된다.
    const w = mk();
    const e = foeNear(w, 'enemy', 0, ZOMBIE_DIST, 5);
    const id = e.id;
    const killsBefore = w.kills;
    blastDamageAt(w, e.x, e.y, 50, 50);
    expect(e.hp).toBeLessThanOrEqual(0);
    stepWorld(w, IDLE);
    // 엔티티 동일성으로 본다 — 같은 틱에 다른 적이 죽어도 이 단언은 흔들리지 않는다.
    expect(w.entities.some((x) => x.id === id)).toBe(false);
    expect(w.kills).toBeGreaterThanOrEqual(killsBefore + 1);
  });

  it('젬 드랍까지 간다 — 처치 집계와 드랍은 같은 분기다', () => {
    const w = mk();
    const e = foeNear(w, 'enemy', 0, ZOMBIE_DIST, 5);
    const gx = e.x;
    const gy = e.y;
    const gemsBefore = w.entities.filter((x) => x.kind === 'gem').length;
    blastDamageAt(w, e.x, e.y, 50, 50);
    stepWorld(w, IDLE);
    // 젬은 시체 자리에 스폰된다(자석·수거로 움직일 수 있어 넉넉한 반경으로 본다).
    const gems = w.entities.filter(
      (x) => x.kind === 'gem' && Math.hypot(x.x - gx, x.y - gy) <= 200,
    );
    expect(gems.length).toBeGreaterThanOrEqual(1);
    expect(w.entities.filter((x) => x.kind === 'gem').length).toBeGreaterThan(gemsBefore);
  });
});

describe('② 회귀 — 안 죽인 적은 종전 그대로', () => {
  it('hp 가 남으면 dead 가 안 서고 stepWorld 후에도 살아 있다', () => {
    const w = mk();
    const e = foeNear(w, 'enemy', 30, 0, 1000);
    const killsBefore = w.kills;
    blastDamageAt(w, player(w).x, player(w).y, 100, 40);
    expect(e.hp).toBe(960); // 실제로 맞았다 (하한)
    expect(e.dead).toBe(false);
    stepWorld(w, IDLE);
    expect(w.entities.some((x) => x.id === e.id)).toBe(true);
    expect(w.kills).toBe(killsBefore);
  });

  it('`blastDamage`(플레이어 중심 위임)도 같은 마킹을 한다', () => {
    const w = mk();
    const dies = foeNear(w, 'enemy', 20, 0, 5);
    const lives = foeNear(w, 'enemy', 40, 0, 1000);
    blastDamage(w, player(w), 100, 50);
    expect(lives.hp).toBe(950); // 둘 다 반경 안이었다 (하한)
    expect(dies.dead).toBe(true);
    expect(lives.dead).toBe(false);
  });
});

describe('③ 보스 — 탄 명중 경로와 같은 처리', () => {
  it('폭발로 hp≤0 이 된 보스도 dead 로 마킹된다', () => {
    // 근거: `world.ts` 의 탄 명중 경로는 `t.hp <= 0` 에서 boss 를 예외 없이 `dead` 로 세운다
    // (guardian 재기동·core 부활만 분기한다 — 둘 다 `blastDamageAt` 의 훑는 kind 가 아니다).
    // 폭발만 다르게 두면 같은 사실에 대한 진실이 두 벌이 된다.
    const w = mk();
    const b = foeNear(w, 'boss', 30, 0, 5);
    blastDamageAt(w, player(w).x, player(w).y, 100, 50);
    expect(b.hp).toBeLessThanOrEqual(0);
    expect(b.dead).toBe(true);
  });

  it('hp 가 남은 보스는 마킹되지 않는다', () => {
    const w = mk();
    const b = foeNear(w, 'boss', 30, 0, 1000);
    blastDamageAt(w, player(w).x, player(w).y, 100, 50);
    expect(b.hp).toBe(950);
    expect(b.dead).toBe(false);
  });
});

describe('④ 계약 — 순회 중 엔티티를 낳거나 지우지 않는다', () => {
  it('`blastDamageAt` 호출 전후로 `state.entities` 길이가 같다', () => {
    const w = mk();
    foeNear(w, 'enemy', 20, 0, 5);
    foeNear(w, 'enemy', 25, 0, 5);
    const n = w.entities.length;
    blastDamageAt(w, player(w).x, player(w).y, 100, 50);
    expect(w.entities.length).toBe(n);
  });

  it('이미 dead 인 적은 다시 안 때린다', () => {
    const w = mk();
    const e = foeNear(w, 'enemy', 20, 0, 1000);
    e.dead = true;
    blastDamageAt(w, player(w).x, player(w).y, 100, 50);
    expect(e.hp).toBe(1000);
  });
});
