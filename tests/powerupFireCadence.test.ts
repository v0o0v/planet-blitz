/**
 * 발사 간격 고정소수점 회귀 (`fix/powerup-rounding-noop`, 밸런스 큐 §R30).
 *
 * ## 이 파일이 막는 것
 * 발사 간격이 **정수 틱**이던 시절, 감소형 파워업은 배율이 통째로 삼켜졌다: 배율 `m`·현재값
 * `c` 에 대해 `c(1 − m) < 0.5` 면 `Math.round` 가 같은 값을 돌려준다. 벌컨 기본 6틱 · 빔 기본
 * 4틱에서 `fp-cadence`(×0.92)는 **처음부터 영구 무동작**, `rapid-fire`(×0.90)는 6→5 한 번만
 * 먹고 이후 무동작이었다. 단위 테스트는 전부 그린이었다 — 그 값을 실제 기본값으로 밟는
 * 테스트가 하나도 없었기 때문이다(§R22 를 잡은 것은 테스트가 아니라 벤치 분류기였다).
 *
 * 그래서 여기서는 ①**실제 무기별 기본 간격**으로 파워업을 걸어 값이 정말 움직이는지
 * ②소수 주기가 **발사 리듬에 실제로 반영**되는지(정규 경로 `createWorld`→`stepWorld` 로 탄을
 * 세어서) ③하한 가드가 살아 있는지 ④**결정론이 유지**되는지를 직접 본다.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  emptyInput,
  DEFAULT_CONFIG,
  DEFAULT_WEAPON,
  FIRE_CD_Q,
  FIRE_CD_MIN_Q,
} from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import { blankEntity, addEntity } from '../src/sim/entities.js';
import { hashWorld } from '../src/sim/replay.js';
import { POWERUPS } from '../src/sim/powerups.js';
import { autopilotInput } from '../src/sim/autopilot.js';

/** 파워업 pool 인덱스(불변 계약 — 재정렬 금지). */
const RAPID_FIRE = 0;
const FP_CADENCE = 17;

/** 무기 타입별 기본 발사 간격(틱) — `applyWeaponTypeBase` 파생값. §R22 표와 같은 값. */
const BASE_TICKS: ReadonlyArray<readonly [string, number]> = [
  ['벌컨', 6],
  ['스프레드', 7],
  ['레일건', 12],
  ['미사일', 16],
  ['빔', 4],
];

function freshWorld(seed = 1): WorldState {
  return createWorld(seed, { ...DEFAULT_CONFIG });
}

/**
 * **표적 하나만 붙박아 둔 판**에서 `ticks` 틱 동안 나간 발사 횟수를 센다.
 *
 * 사거리·조준 오염을 막는 절차는 `tests/weaponRange.test.ts` 의 하네스와 같다: 한 틱 굴려
 * 첫 파도를 스폰시킨 뒤 플레이어와 표적만 남기고 벽을 비운다. 표적 HP 를 크게 잡아 표적이
 * 사라지지 않게 한다 — 사라지면 조기 반환이 섞여 리듬 측정이 오염된다.
 */
function countShots(fireCooldownQ: number, ticks: number): number {
  const state = freshWorld();
  stepWorld(state, emptyInput());
  const player = state.entities[0]!;
  const target = blankEntity('enemy');
  target.x = player.x + 300;
  target.y = player.y;
  target.radius = 30;
  target.hp = 1e12;
  target.maxHp = 1e12;
  target.enemyType = 0;
  addEntity(state, target);
  for (const e of state.entities) {
    if (e !== player && e !== target) e.dead = true;
  }
  state.activeWalls.length = 0;
  state.weapon.fireCooldownQ = fireCooldownQ;
  player.cooldown = 0;

  let shots = 0;
  for (let i = 0; i < ticks; i++) {
    // 무대는 스크롤하고 웨이브는 계속 적을 낳는다 — 매 틱 판을 다시 정리해야 "표적이 늘
    // 사거리 안에 하나만 있다"는 측정 조건이 유지된다(안 하면 표적이 뒤로 밀려 사거리를
    // 벗어나고, 그러면 조기 반환이 섞여 리듬이 아니라 조준 실패를 재게 된다).
    target.x = player.x + 300;
    target.y = player.y;
    target.hp = 1e12;
    target.dead = false;
    player.hp = player.maxHp;
    for (const e of state.entities) {
      if (e !== player && e !== target && e.kind !== 'bullet') e.dead = true;
    }
    state.activeWalls.length = 0;
    stepWorld(state, emptyInput());
    // 이 틱에 새 아군탄이 생겼는가 = 발사했는가. 다음 틱 판정이 수명 만료에 오염되지
    // 않도록 센 뒤 즉시 걷어낸다.
    let created = 0;
    for (const e of state.entities) if (e.kind === 'bullet' && !e.dead) created++;
    if (created > 0) shots++;
    for (const e of state.entities) if (e.kind === 'bullet') e.dead = true;
  }
  return shots;
}

describe('발사 간격 고정소수점(Q) — 반올림 무동작 해소', () => {
  it('기본값이 6틱을 Q 로 표현한다 (단위 계약)', () => {
    expect(FIRE_CD_Q).toBe(256);
    expect(DEFAULT_WEAPON.fireCooldownQ).toBe(6 * FIRE_CD_Q);
    expect(FIRE_CD_MIN_Q).toBe(2 * FIRE_CD_Q);
  });

  it('무기별 실제 기본 간격에서 감소형 파워업이 **매번** 값을 움직인다', () => {
    for (const [label, baseTicks] of BASE_TICKS) {
      for (const idx of [RAPID_FIRE, FP_CADENCE]) {
        const s = freshWorld();
        s.weapon.fireCooldownQ = baseTicks * FIRE_CD_Q;
        // 하한(2틱)에 닿기 전까지는 픽마다 반드시 감소해야 한다.
        for (let k = 0; k < 6; k++) {
          const before = s.weapon.fireCooldownQ;
          POWERUPS[idx]!.apply(s);
          const after = s.weapon.fireCooldownQ;
          if (before > FIRE_CD_MIN_Q) {
            expect(
              after,
              `${label}(${baseTicks}틱) ${POWERUPS[idx]!.id} ${k + 1}회차가 무동작`,
            ).toBeLessThan(before);
          }
        }
      }
    }
  });

  it('하한 2틱 가드는 살아 있다 (프레임당 발사 폭주 방지)', () => {
    const s = freshWorld();
    for (let k = 0; k < 60; k++) POWERUPS[RAPID_FIRE]!.apply(s);
    expect(s.weapon.fireCooldownQ).toBe(FIRE_CD_MIN_Q);
    for (let k = 0; k < 60; k++) POWERUPS[FP_CADENCE]!.apply(s);
    expect(s.weapon.fireCooldownQ).toBe(FIRE_CD_MIN_Q);
  });

  it('정수 배수 간격은 예전 정수 틱과 같은 리듬이다 (회귀 없음)', () => {
    // 6틱 = 1536Q → 600틱에 정확히 100발.
    expect(countShots(6 * FIRE_CD_Q, 600)).toBe(100);
    expect(countShots(4 * FIRE_CD_Q, 600)).toBe(150);
  });

  it('소수 주기가 **발사 리듬에 실제로 반영**된다 (carry 가 작동한다)', () => {
    // 5.52틱(1413Q) → 600 / 5.52 ≈ 108.7발. 정수 틱이었다면 6틱(100발)에 머물렀다.
    const shots = countShots(1413, 600);
    expect(shots).toBeGreaterThan(105);
    expect(shots).toBeLessThan(112);
    // 6틱보다 확실히 많다 = 배율이 삼켜지지 않았다.
    expect(shots).toBeGreaterThan(countShots(6 * FIRE_CD_Q, 600));
  });

  it('결정론: 같은 시드·같은 입력의 재실행이 **비트 동일** 해시를 낸다', () => {
    const run = (seed: number): number[] => {
      const s = createWorld(seed, { ...DEFAULT_CONFIG });
      const hs: number[] = [];
      for (let i = 0; i < 900; i++) {
        stepWorld(s, autopilotInput(s));
        if (i % 100 === 0) hs.push(hashWorld(s));
      }
      hs.push(hashWorld(s));
      return hs;
    };
    expect(run(4242)).toEqual(run(4242));
    expect(run(4242)).not.toEqual(run(4243));
  });

  it('파워업을 실제로 먹인 런도 결정론이 유지된다', () => {
    const run = (): number => {
      const s = createWorld(77, { ...DEFAULT_CONFIG });
      for (let i = 0; i < 400; i++) {
        if (i === 50) POWERUPS[FP_CADENCE]!.apply(s);
        if (i === 120) POWERUPS[RAPID_FIRE]!.apply(s);
        if (i === 200) POWERUPS[FP_CADENCE]!.apply(s);
        stepWorld(s, autopilotInput(s));
      }
      return hashWorld(s);
    };
    expect(run()).toBe(run());
  });
});
