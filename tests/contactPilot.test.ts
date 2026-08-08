/**
 * **접촉 조향 파일럿**(`bench/contactPilot.ts`) — 계약 전수.
 *
 * ## 이 파일이 잠그는 것
 * | # | 계약 | 절 |
 * |---|---|---|
 * | 1 | `id 1` 도 `--contact-steer` 도 없는 런은 프레임이 `measurePilotInput` 과 **비트 동일** | ① |
 * | 2 | 표적 선택: 잡몹은 **아직 안 뜯긴** 표식, 보스는 **kind** (보스 `aux0` 오독 없음) | ② |
 * | 3 | **sim 이 스스로** 표식을 세운다(`fired` 가 0 이 아니다) · 정산 `earned` 가 실린다 | ③ |
 * | 4 | 같은 시드 두 번 → 같은 해시 스트림(RNG 미소비) | ④ |
 * | 5 | HP 하한 아래에서는 접촉 조향이 꺼진다(자살 방지) | ⑤ |
 * | 6 | `--contact-steer` 는 카드와 무관하게 켜고, 미지정이면 종전과 비트 동일 | ⑥ |
 *
 * ① 이 이 레인의 실질이다 — 이 파일은 **다른 모든 계측을 오염시키지 않는다**는 것이 존재 조건이고,
 * "게이트를 바깥에 뒀다"는 주장이 아니라 프레임 대조가 증거다.
 *
 * ## ⚠️ ③ 은 **손으로 표식을 심지 않는다** — 그렇게 재던 옛 rig 가 항진이었다
 * 종전 ③ 은 매 틱 바깥에서 `writeMark(최근접 적, 'plunder', 1)` 을 직접 찍고 "표적으로 간다"를
 * 쟀다. 그런데 그 상태는 **sim 이 결코 만들지 않는 것**이었다(비트는 `1 = 강탈 완료`이고 세우는
 * 자리는 접촉 성립 지점 하나뿐이다). 즉 실제 파이프가 0 이어도 초록이었고, `isElite` 게이트까지
 * 우회했다 — 실제로 `contactPilot.ts` 의 표적 술어가 **반대로 박혀 있었는데도** 이 파일은
 * 통과했다(실측: `CatalystContribution.fired` p50 = 0).
 *
 * 그래서 ③ 은 **표준 빌드 + 내구 파일럿으로 실제 런을 돌려** sim 이 세운 `fired` 를 읽는다
 * (rig 는 `tests/pilotPickPolicy.test.ts` 와 같은 모양이다 — 기본 설정으로는 봇이 못 버티거나
 * 엘리트를 거의 안 만나 그 위의 초록이 아무것도 안 잰 초록이 된다).
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import type { Entity, EntityKind } from '../src/sim/entities.js';
import { blankEntity } from '../src/sim/entities.js';
import { hashWorld } from '../src/sim/replay.js';
import { measurePilotInput, beginMeasureRun } from '../src/sim/measurePilot.js';
import { writeMark } from '../src/sim/catalystMarks.js';
import { catalystContributionsOf } from '../src/sim/catalyst/fx.js';
import {
  standardEquipped,
  standardPerTree,
  standardStage,
  investVector,
} from '../src/bench/standardBuild.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { contactPilotInput, CONTACT_HP_FLOOR, PLUNDER_CATALYST_ID } from '../bench/contactPilot.js';

function playerOf(s: WorldState): Entity {
  const p = s.entities[0];
  if (p === undefined) throw new Error('player entity missing');
  return p;
}

/** `id 1` 이 실린 런 설정(표적 선택 축 전용 — ② ⑤ 는 sim 을 굴리지 않는다). */
function plunderConfig(): WorldConfig {
  return { ...DEFAULT_CONFIG, catalysts: [PLUNDER_CATALYST_ID] };
}

// ---------------------------------------------------------------------------
// ① 게이트 바깥 — `id 1` 이 없으면 측정 파일럿과 프레임이 비트 동일하다
// ---------------------------------------------------------------------------

/**
 * 같은 월드에 두 파일럿을 **같은 틱에** 물어 프레임을 비교한다. 월드를 둘 만들어 각각 돌리면
 * 상태가 갈릴 여지가 남지만, 여기서는 관측 대상이 하나뿐이라 갈릴 곳이 없다.
 */
function assertIdenticalFrames(
  seed: number,
  cfg: WorldConfig,
  ticks: number,
  contactSteer?: boolean,
): number {
  const state = createWorld(seed, cfg);
  beginMeasureRun(state);
  let compared = 0;
  for (let i = 0; i < ticks; i++) {
    const m = measurePilotInput(state);
    const c = contactPilotInput(state, contactSteer);
    expect(c).toEqual(m);
    compared++;
    stepWorld(state, m);
    if (state.victory || state.gameOver) break;
  }
  return compared;
}

describe('① `id 1` 미주입 런은 종전과 비트 동일하다', () => {
  it('무촉매 런 (기본 곡선 스윕이 도는 경로)', () => {
    // 공허 방어 — 비교 틱이 없으면 이 단언 전체가 아무것도 안 잰 초록이다.
    expect(assertIdenticalFrames(1234, { ...DEFAULT_CONFIG }, 900)).toBeGreaterThan(300);
  });

  it('다른 촉매만 실린 런 (`id 1` 아님)', () => {
    // id 6(gilding)·17(greed) 은 `plunder` 와 같은 `aux0` 구역을 쓰는 이웃이라, 게이트가 "촉매가
    // 하나라도 있으면"(`catalystOn`)으로 새 있으면 여기서 걸린다.
    const cfg: WorldConfig = { ...DEFAULT_CONFIG, catalysts: [6, 17] };
    expect(assertIdenticalFrames(777, cfg, 900)).toBeGreaterThan(300);
  });

  it('`contactSteer` 를 **명시적으로 끄면** 미지정과 같다 (`--contact-steer` 미지정 경로)', () => {
    expect(assertIdenticalFrames(1234, { ...DEFAULT_CONFIG }, 900, false)).toBeGreaterThan(300);
  });
});

// ---------------------------------------------------------------------------
// ② 표적 선택 — 잡몹은 «아직 안 뜯긴» 표식, 보스는 kind
// ---------------------------------------------------------------------------

/**
 * 표적 후보가 **하나도 없는** 상태의 월드를 만든다: `id 1` 을 실은 채 몇 틱 굴린 뒤,
 * (a) 보스가 아직 없음을 확인하고 (b) **살아 있는 잡몹 전부에 `plunder` 를 세워** 표적에서 뺀다.
 *
 * ⚠️ (b) 가 필요한 이유가 술어 방향 그 자체다 — 표적은 *"표식이 **안** 선 잡몹"* 이므로 자연
 * 스폰된 적이 전부 후보다. 그것을 안 지우면 주입한 후보가 최근접이 아닐 수 있어 이 절이 재는
 * 것이 거리가 아니라 우연이 된다. 여기서 심는 표식은 «표적이 아님»을 만드는 쪽이라 ③ 의
 * 항진(«표적임»을 손으로 만드는 것)과 방향이 반대다.
 *
 * 월드를 더 굴리지 않으므로 이 주입이 sim 을 깨지 않는다.
 */
function riggedWorld(seed: number): WorldState {
  const state = createWorld(seed, plunderConfig());
  beginMeasureRun(state);
  for (let i = 0; i < 30; i++) stepWorld(state, measurePilotInput(state));
  expect(state.pendingLevelUp).toBeFalsy();
  expect(
    state.entities.some((e) => !e.dead && (e.kind === 'boss' || e.kind === 'defenseBoss')),
  ).toBe(false);
  for (const e of state.entities) {
    if (!e.dead && e.kind === 'enemy') writeMark(e, 'plunder', 1);
  }
  // 후보가 정말 하나도 안 남았는지 — 여기가 초록이어야 아래 주입이 유일 표적이다.
  expect(contactPilotInput(state)).toEqual(measurePilotInput(state));
  const p = playerOf(state);
  p.hp = p.maxHp; // HP 하한(⑤)에 걸리지 않게 — 여기서 재는 것은 표적 선택 축뿐이다.
  return state;
}

function inject(s: WorldState, kind: EntityKind, dx: number, dy: number, aux0: number): Entity {
  const p = playerOf(s);
  const e = blankEntity(kind);
  e.id = s.nextEntityId++;
  e.x = p.x + dx;
  e.y = p.y + dy;
  e.radius = 30;
  e.hp = 100;
  e.maxHp = 100;
  e.aux0 = aux0;
  s.entities.push(e);
  return e;
}

/** 이동 성분이 (ux,uy) 단위 벡터를 향하는가. */
function expectMoveToward(f: InputFrame, ux: number, uy: number): void {
  expect(f.moveX).toBeCloseTo(ux, 5);
  expect(f.moveY).toBeCloseTo(uy, 5);
}

describe('② 표적 선택', () => {
  it('표식이 **선**(= 이미 강탈한) 잡몹은 표적이 아니다', () => {
    const state = riggedWorld(21);
    const e = inject(state, 'enemy', 500, 0, 0);
    writeMark(e, 'plunder', 1);
    expect(contactPilotInput(state)).toEqual(measurePilotInput(state));
  });

  it('표식이 **안 선**(= 아직 안 뜯긴) 잡몹으로 직진한다', () => {
    const state = riggedWorld(21);
    inject(state, 'enemy', 500, 0, 0);
    expectMoveToward(contactPilotInput(state), 1, 0);
  });

  it('보스는 표식과 무관하게 표적이다 (kind 로 잡는다)', () => {
    const state = riggedWorld(22);
    // 비트 0 을 세워 둔다 — 그것을 `plunder` 로 오독하면 «이미 뜯었다»가 되어 표적에서 빠진다.
    inject(state, 'boss', 0, 600, 1);
    expectMoveToward(contactPilotInput(state), 0, 1);
  });

  it('보스 `aux0` 비트 0(추격 취약화)을 표식으로 오독하지 않는다', () => {
    // 보스는 멀고(1200) 안 뜯긴 잡몹은 가깝다(300). 보스의 aux0 비트 0 이 서 있지만 그것은
    // 추격 모드 플래그다 — 거리 규칙만 적용되면 가까운 잡몹이 뽑힌다.
    const state = riggedWorld(23);
    inject(state, 'boss', 1200, 0, 1);
    inject(state, 'enemy', 0, -300, 0);
    expectMoveToward(contactPilotInput(state), 0, -1);

    // 반대 배치에서는 보스가 뽑힌다 — 거리만 갈렸는데 결과가 뒤집히므로 규칙이 거리다.
    const state2 = riggedWorld(23);
    inject(state2, 'boss', 300, 0, 1);
    inject(state2, 'enemy', 0, -1200, 0);
    expectMoveToward(contactPilotInput(state2), 1, 0);
  });

  it('조준·대시·액티브 비트는 측정 파일럿 정본 그대로다 (이동 성분만 교체)', () => {
    const state = riggedWorld(24);
    inject(state, 'enemy', 500, 0, 0);
    const base = measurePilotInput(state);
    const c = contactPilotInput(state);
    expect(c.aim).toBe(base.aim);
    expect(c.dash).toBe(base.dash);
    expect(c.special).toBe(base.special);
  });
});

// ---------------------------------------------------------------------------
// ③ sim 이 스스로 표식을 세운다 · ④ 결정론 — **실제 런**으로 잰다
// ---------------------------------------------------------------------------

/** 내구 파일럿 HP — `bench/runCurve.ts --durable` 과 같은 값. 죽어서 관측이 끊기는 것을 막는다. */
const DURABLE_HP = 100_000_000;

/**
 * `bench/runCurve.ts` 의 `runOne` 과 같은 런 설정(표준 빌드 · 행성 0 · 내구 파일럿).
 * `tests/pilotPickPolicy.test.ts` 의 `benchConfig` 와 같은 모양이다.
 */
function benchConfig(level: number, seed: number, catalysts: readonly number[]): WorldConfig {
  const p = defaultProfile();
  const s = activeShip(p);
  s.typeId = 0;
  s.skillInvest = investVector(0, standardPerTree(level));
  s.level = level;
  s.equipped = standardEquipped(level, seed, 0);
  const cfg = buildRunConfig(p, {
    planet: 0,
    stage: standardStage(level),
    catalysts: [...catalysts],
  });
  cfg.playerHp = DURABLE_HP;
  return cfg;
}

/**
 * ⚠️ Lv40 인 이유 — Lv10 에서는 6000틱에 엘리트 접촉이 시드에 따라 0~6회로 흔들린다(실측).
 * 그 위에서 «> 0» 을 단언하면 시드 하나에 매달린 초록이 된다.
 */
const REAL_LEVEL = 40;
const REAL_TICKS = 6000;
/**
 * ⚠️ **이 시드 셋은 판별력으로 골랐다** — 아무 시드나 쓰면 안 된다.
 *
 * 표적 술어를 **반대로 되돌린 채**(`!== 0`) 재면 접촉 조향은 «보스만» 쫓는다. 그런데 보스로
 * 돌진하는 경로가 적 무리를 관통하므로 **부수 접촉으로 `fired` 가 새어 나온다** — 실측
 * (2026-08-08, Lv40 6000틱)에서 시드 1234 는 반대 술어로도 2 를 찍었고 카이팅이 1 이라
 * «> 0» 도 «> 대조군» 도 둘 다 통과했다. 즉 **시드 선택이 곧 이 절의 판별력**이다.
 *
 * 아래 셋은 반대 술어·카이팅이 **셋 다 정확히 0** 이고 고친 술어는 15·11·7 이다.
 * | 시드 | 고친 술어 | 반대 술어 | 카이팅 |
 * |---|---|---|---|
 * | 31337 | 15 | 0 | 0 |
 * | 55 | 11 | 0 | 0 |
 * | 101 | 7 | 0 | 0 |
 * 그래서 아래 단언은 **시드마다** `> 0` 을 요구한다 — 합계만 보면 한 시드의 누출이 셋을 덮는다.
 */
const REAL_SEEDS = [31337, 55, 101] as const;

interface RealRun {
  readonly fired: number;
  readonly earned: number;
  readonly ticks: number;
}

/** 실제 런 하나. `steer` 가 거짓이면 카이팅 정본으로 돌려 대조군을 만든다. */
function runReal(seed: number, steer: boolean): RealRun {
  const state = createWorld(seed, benchConfig(REAL_LEVEL, seed, [PLUNDER_CATALYST_ID]));
  beginMeasureRun(state);
  for (let i = 0; i < REAL_TICKS; i++) {
    stepWorld(state, steer ? contactPilotInput(state) : measurePilotInput(state));
    if (state.victory || state.gameOver) break;
  }
  const row = (catalystContributionsOf(state) ?? []).find((r) => r.id === PLUNDER_CATALYST_ID);
  return { fired: row?.fired ?? 0, earned: row?.earned ?? 0, ticks: state.tick };
}

describe('③ sim 이 스스로 강탈 표식을 세운다 (손으로 심지 않는다)', () => {
  it('접촉 조향 런의 `fired` 가 0 이 아니고, 카이팅 대조군보다 많다', () => {
    let contactFired = 0;
    let kiteFired = 0;
    let earned = 0;
    for (const seed of REAL_SEEDS) {
      const c = runReal(seed, true);
      const k = runReal(seed, false);
      // 공허 방어 — 런이 즉시 끝났으면 양쪽 0 이 당연하다.
      expect(c.ticks).toBeGreaterThan(1000);
      expect(k.ticks).toBeGreaterThan(1000);
      // 표식을 세우는 자리는 `dropsOnEnemyContact` 하나뿐이므로, 이 수가 곧 «sim 이 세웠다» 다.
      // **시드마다** 요구한다 — 합계로 접으면 한 시드의 누출이 나머지 0 을 덮는다(위 표).
      expect(c.fired).toBeGreaterThan(0);
      contactFired += c.fired;
      kiteFired += k.fired;
      earned += c.earned;
    }
    // 대조 없는 «접촉했다» 는 증거가 아니다 — 카이팅은 `KITE_DISTANCE` 를 유지하므로 붙지 않는다.
    expect(contactFired).toBeGreaterThan(kiteFired);
    // 정산 `earned` 배선(`dropsOnLootRoll` 의 `creditCatalyst`) — 없으면 화면이 0 으로 남는다.
    expect(earned).toBeGreaterThan(0);
  });
});

describe('④ 결정론 — 같은 시드 두 번이면 같은 해시 스트림', () => {
  it('실제 런의 해시 열이 완전히 같다 (RNG 미소비)', () => {
    function hashes(seed: number): number[] {
      const state = createWorld(seed, benchConfig(REAL_LEVEL, seed, [PLUNDER_CATALYST_ID]));
      beginMeasureRun(state);
      const out: number[] = [hashWorld(state)];
      for (let i = 0; i < 1500; i++) {
        stepWorld(state, contactPilotInput(state));
        out.push(hashWorld(state));
        if (state.victory || state.gameOver) break;
      }
      return out;
    }
    const a = hashes(1234);
    const b = hashes(1234);
    expect(a.length).toBeGreaterThan(500);
    expect(a).toEqual(b);
  });

  it('같은 월드에 두 번 물으면 같은 프레임이다', () => {
    const state = riggedWorld(99);
    inject(state, 'enemy', 400, 300, 0);
    expect(contactPilotInput(state)).toEqual(contactPilotInput(state));
  });
});

// ---------------------------------------------------------------------------
// ⑤ 이탈 규율
// ---------------------------------------------------------------------------

describe('⑤ HP 하한 아래에서는 접촉 조향이 꺼진다', () => {
  it('HP 가 하한 이하면 카이팅 정본으로 돌아간다', () => {
    const state = riggedWorld(55);
    inject(state, 'enemy', 500, 0, 0);
    const p = playerOf(state);

    p.hp = p.maxHp * CONTACT_HP_FLOOR; // 경계값(이하)은 꺼진다
    expect(contactPilotInput(state)).toEqual(measurePilotInput(state));

    p.hp = p.maxHp * CONTACT_HP_FLOOR + 1; // 경계 바로 위는 켜진다
    expectMoveToward(contactPilotInput(state), 1, 0);
  });
});

// ---------------------------------------------------------------------------
// ⑥ `--contact-steer` — 카드와 무관하게 켠다
// ---------------------------------------------------------------------------

describe('⑥ `--contact-steer` 손잡이', () => {
  it('`id 1` 이 없어도 켜지면 조향이 갈린다 (짝지음이 복원된다)', () => {
    // 무촉매 월드에 표적 후보(잡몹)를 심고, 손잡이만 켰을 때 이동 성분이 그쪽으로 갈리는지 본다.
    const state = createWorld(21, { ...DEFAULT_CONFIG });
    beginMeasureRun(state);
    for (let i = 0; i < 30; i++) stepWorld(state, measurePilotInput(state));
    for (const e of state.entities) {
      if (!e.dead && e.kind === 'enemy') e.dead = true; // 자연 스폰을 표적에서 뺀다
    }
    const p = playerOf(state);
    p.hp = p.maxHp;
    inject(state, 'enemy', 500, 0, 0);

    // 꺼진 상태 = 종전 경로(카드가 없으므로 게이트가 닫힌다).
    expect(contactPilotInput(state)).toEqual(measurePilotInput(state));
    // 켜면 카드 없이도 표적으로 직진한다.
    expectMoveToward(contactPilotInput(state, true), 1, 0);
  });

  it('`id 1` 이 실린 런에서 손잡이는 거동을 바꾸지 않는다 (이미 켜져 있다)', () => {
    const state = riggedWorld(21);
    inject(state, 'enemy', 500, 0, 0);
    expect(contactPilotInput(state, true)).toEqual(contactPilotInput(state));
  });
});
