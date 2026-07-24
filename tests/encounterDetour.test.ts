/**
 * 보물 격실 detour — **메인 월드 동결(AC6)** 과 **런 전투력 무개입(AC7)** 게이트.
 *
 * ## 왜 이 두 개가 핵심인가
 * detour 는 이 변경에서 **유일한 신규 제어흐름**이다(ADR-0033). 계획 컨센서스가 CRITICAL 로 잡은
 * 두 실패 모드가 정확히 이것들이다.
 *
 *  - **CRIT-1 (게이트 과소열거)** — detour 를 산발적인 `if (!inDetour)` 게이트로 구현하면
 *    `stepBoss` hover · `applySingularityPull` · `autoAttack` · `clampToWindow` ·
 *    `shrinkOutOfBounds` · `advanceScrollRuntime` / `advanceShrinkRuntime` · `updateChasePredator`
 *    같은 7+ 지점을 **반드시 누락**한다(이 프로젝트의 실증된 반복 결함: "단위 테스트는 그린인데
 *    배선이 통째로 없다"). 그래서 구현은 `stepWorld` 최상단 **단일 분기**여야 하고, 이 테스트는
 *    그 결과를 열거가 아니라 **바이트 동결**로 검증한다 — "무피격" 같은 약한 판정은 금지다.
 *  - **CRIT-2 (xp 누수)** — 방내 처치가 gem 을 드랍하면 gem → xp → 레벨업으로 **런 전투력이 조용히
 *    오른다**(xp 는 처치가 아니라 `collectGem` 에서 나온다). 그래서 방내 처치는 `state.kills`·gem·
 *    xp/combo/level 어디에도 닿지 않아야 한다.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  emptyInput,
  packPowerupPick,
  DEFAULT_CONFIG,
} from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { SeededRng } from '../src/sim/rng.js';
import { ENCOUNTER_TYPE, SPECIAL_ENCOUNTER_EXIT } from '../data/encounters.js';
import { DETOUR_MARK, enterDetour } from '../src/sim/encounterDetour.js';
import type { EncounterRuntime } from '../src/sim/encounter.js';

// ---------------------------------------------------------------------------
// 하네스
// ---------------------------------------------------------------------------

/** 조우 롤(≈2%)에 기대지 않고 보물 격실 런타임을 직접 싣는다(결정론 관측 하네스). */
function attachVaultRuntime(state: WorldState, spawnTick: number): EncounterRuntime {
  const rt: EncounterRuntime = {
    state: 1,
    type: ENCOUNTER_TYPE.treasureVault,
    spawnTick,
    entityId: 0,
    inDetour: 0,
    savedX: 0,
    savedY: 0,
    detourTimer: 0,
    aux: 0,
  };
  (state as { encounterRuntime?: EncounterRuntime }).encounterRuntime = rt;
  return rt;
}

/** 적·탄이 실제로 깔리도록 한동안 굴린다(동결 대상이 없으면 AC6 이 공회전한다). */
function warmUp(state: WorldState, ticks: number): void {
  const gen = new SeededRng(0x5eed);
  for (let t = 0; t < ticks; t++) {
    const frame: InputFrame = {
      moveX: gen.range(-1, 1),
      moveY: gen.range(-1, 1),
      aim: gen.range(-Math.PI, Math.PI),
      dash: false,
      special: 0,
    };
    // 레벨업 프리즈는 여기선 관심 밖이라 즉시 소화한다(안 풀면 월드가 그 자리에서 멈춘다).
    stepWorld(state, state.pendingLevelUp ? { ...emptyInput(), special: packPowerupPick(0) } : frame);
  }
}

/**
 * `enterDetour` 는 좌표만 저장하고 **워프·세트피스 실체화는 다음 틱 `stepDetour` 로 미룬다**.
 * `stepEncounter` 호출 지점이 메인 루프 중간이라, 진입 틱에 즉시 워프하면 뒤이어 도는
 * `updateWaves`·`stepSupply` 가 **포켓 좌표 주위에 메인 적을 스폰**하고, 그 적들은
 * `DETOUR_MARK` 가 없어 `exitDetour` 가 회수하지 못한다(뱀서류는 적 컬링이 없어 영구 유령이 된다).
 * 그래서 테스트도 진입 후 한 틱을 굴려 방이 실체화된 상태에서 관측한다.
 */
function materializeTick(state: WorldState): void {
  stepWorld(state, emptyInput());
}

/** 엔티티 1건의 전 수치 필드를 문자열로 굳힌다(바이트 동결 대조용). */
function freeze(e: Entity): string {
  return JSON.stringify(e);
}

function mainEntities(state: WorldState): Entity[] {
  // 플레이어(인덱스 0)는 detour 안에서 당연히 움직이므로 동결 대상이 아니다.
  return state.entities.filter((e, i) => i !== 0 && e.ownerId !== DETOUR_MARK);
}

function pveConfig(): WorldConfig {
  return { ...DEFAULT_CONFIG, playerHp: 100000 } as WorldConfig;
}

// ---------------------------------------------------------------------------
// AC6 — detour 중 메인 월드가 `tick` 외 바이트 동결
// ---------------------------------------------------------------------------

describe('AC6 — detour 중 메인 월드 바이트 동결', () => {
  it('적·탄·웨이브·보스 상태가 detour 진행 중 한 필드도 변하지 않는다', () => {
    const state = createWorld(0xa11ce, pveConfig());
    const rt = attachVaultRuntime(state, 1);
    warmUp(state, 900);

    const player = state.entities[0] as Entity;
    // 동결 대상이 실제로 존재하는지부터 확인한다(공회전 방지).
    expect(mainEntities(state).length).toBeGreaterThan(3);

    enterDetour(state, player, rt);
    expect(rt.inDetour).toBe(1);

    const before = mainEntities(state).map(freeze);
    const waveBefore = JSON.stringify(state.wave);
    const tickBefore = state.tick;

    for (let t = 0; t < 120; t++) stepWorld(state, emptyInput());

    const after = mainEntities(state).map(freeze);
    expect(after).toEqual(before);
    expect(JSON.stringify(state.wave)).toBe(waveBefore);
    // 유일하게 전진해도 되는 것은 tick 이다.
    expect(state.tick).toBe(tickBefore + 120);
  });

  it('detour 복귀 시 플레이어가 워프 전 좌표로 복원되고 detour 엔티티가 남지 않는다', () => {
    const state = createWorld(0xb0b, pveConfig());
    const rt = attachVaultRuntime(state, 1);
    warmUp(state, 600);

    const player = state.entities[0] as Entity;
    const savedX = Math.round(player.x);
    const savedY = Math.round(player.y);

    enterDetour(state, player, rt);
    expect(rt.savedX).toBe(savedX);
    expect(rt.savedY).toBe(savedY);
    materializeTick(state);
    // 워프가 실제로 멀리 보냈는지(메인 탄이 자연 소멸할 거리인지) 확인한다.
    expect(Math.abs(player.x - savedX) + Math.abs(player.y - savedY)).toBeGreaterThan(10000);

    const exitFrame: InputFrame = { ...emptyInput(), special: SPECIAL_ENCOUNTER_EXIT };
    stepWorld(state, exitFrame);

    expect(rt.inDetour).toBe(0);
    const p = state.entities[0] as Entity;
    expect(p.x).toBe(savedX);
    expect(p.y).toBe(savedY);
    expect(state.entities.some((e) => e.ownerId === DETOUR_MARK)).toBe(false);
  });

  it('타이머가 만료되면 자동으로 이젝트된다', () => {
    const state = createWorld(0xc0de, pveConfig());
    const rt = attachVaultRuntime(state, 1);
    warmUp(state, 300);
    const player = state.entities[0] as Entity;
    enterDetour(state, player, rt);
    materializeTick(state);
    const budget = rt.detourTimer + 5;
    expect(budget).toBeGreaterThan(5);
    for (let t = 0; t < budget && rt.inDetour === 1; t++) stepWorld(state, emptyInput());
    expect(rt.inDetour).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC7 — 방내 처치가 런 전투력 경로에 무개입
// ---------------------------------------------------------------------------

describe('AC7 — detour 전투력 무개입', () => {
  it('detour 전후로 xp·xpTotal·level·combo·kills·gems 가 바이트 불변이다', () => {
    const state = createWorld(0xfeed, pveConfig());
    const rt = attachVaultRuntime(state, 1);
    warmUp(state, 900);
    const player = state.entities[0] as Entity;

    const snap = {
      xp: state.xp,
      xpTotal: state.xpTotal,
      level: state.level,
      combo: state.combo,
      comboTimer: state.comboTimer,
      maxCombo: state.maxCombo,
      kills: state.kills,
      gems: state.gems,
      pendingLevelUp: state.pendingLevelUp,
    };

    enterDetour(state, player, rt);
    materializeTick(state);
    // 방내 적을 전부 즉사시켜 "처치 경로"를 확실히 태운다.
    for (const e of state.entities) {
      if (e.ownerId === DETOUR_MARK && e.kind === 'enemy') e.hp = 0;
    }
    for (let t = 0; t < 60; t++) stepWorld(state, emptyInput());

    expect({
      xp: state.xp,
      xpTotal: state.xpTotal,
      level: state.level,
      combo: state.combo,
      comboTimer: state.comboTimer,
      maxCombo: state.maxCombo,
      kills: state.kills,
      gems: state.gems,
      pendingLevelUp: state.pendingLevelUp,
    }).toEqual(snap);
  });

  it('방내 처치는 gem 을 한 개도 스폰하지 않는다(xp 누수 회귀 가드)', () => {
    const state = createWorld(0x1234, pveConfig());
    const rt = attachVaultRuntime(state, 1);
    warmUp(state, 600);
    const player = state.entities[0] as Entity;

    const gemsBefore = state.entities.filter((e) => e.kind === 'gem').length;
    enterDetour(state, player, rt);
    for (const e of state.entities) {
      if (e.ownerId === DETOUR_MARK && e.kind === 'enemy') e.hp = 0;
    }
    for (let t = 0; t < 60; t++) stepWorld(state, emptyInput());
    const gemsAfter = state.entities.filter((e) => e.kind === 'gem').length;
    // 메인 gem 은 프리즈된 채 그대로 남고(수도 그대로), 방내에서 새로 생기지도 않는다.
    expect(gemsAfter).toBe(gemsBefore);
  });

  it('방내 사망은 런 실패이고 이미 확보한 전리품은 보존된다', () => {
    const state = createWorld(0x777, { ...DEFAULT_CONFIG, playerHp: 30 } as WorldConfig);
    const rt = attachVaultRuntime(state, 1);
    warmUp(state, 240);
    const player = state.entities[0] as Entity;
    enterDetour(state, player, rt);
    materializeTick(state);
    // 전리품이 이미 정산 배열에 담긴 상태를 만든다.
    state.loot.push({ seed: 0xabcdef, rarity: 3, planet: 0, stage: 1 });
    const lootLen = state.loot.length;
    player.hp = 0;
    stepWorld(state, emptyInput());
    expect(state.gameOver).toBe(true);
    expect(state.loot.length).toBe(lootLen);
    expect(state.loot[lootLen - 1]?.seed).toBe(0xabcdef);
  });
});
