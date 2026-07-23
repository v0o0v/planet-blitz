/**
 * 에코 신호(story Phase D · ADR-0023) — sim 코어 검증.
 *
 * 이 저장소의 반복 결함은 "단위 테스트는 그린인데 배선이 통째로 없다"(8+회). 그래서 순수
 * 헬퍼만 못박지 않고, 실제 앱이 부르는 `buildRunConfig` → `createWorld`/`stepWorld` 정규 경로로
 * 에코가 실제로 롤인·스폰·안정화·보상까지 도달함을 증명한다.
 *
 * 결정론(§1) 방어:
 *   (A) 에코 미발생 런은 hashWorld 가 echo 폴드를 실행하지 않는다(조건부 꼬리 — 바이트 불변).
 *   (B) 에코 발생 런은 같은 seed 로 per-tick 해시가 완전 재현된다.
 *   (C) 관측 카운터 6종은 **비-해시**다(값을 바꿔도 hashWorld 불변). 실제 발동 런에서 증가한다.
 */
import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  emptyInput,
  packPowerupPick,
  SPECIAL_POWERUP_PICK,
  runStoryMetrics,
  echoStabilizedOf,
} from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import { hashWorld, idleInputs, runReplay } from '../src/sim/replay.js';
import type { Replay } from '../src/sim/replay.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { blankEntity } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { SeededRng } from '../src/sim/rng.js';
import {
  rollEcho,
  stepEchoStabilize,
  ECHO_SPAWN_PROB,
  ECHO_MIN_SPAWN_TICK,
  ECHO_MAX_SPAWN_TICK,
  ECHO_DWELL_TICKS,
  ECHO_REWARD_CREDITS,
  ECHO_STABILIZE_RADIUS,
  ECHO_TRIGGER_RADIUS,
  type EchoRuntime,
} from '../src/sim/echo.js';

/** 런이 접촉·피격으로 조기 종료되지 않게 버티는 무대 HP(프로필 파생값이 아니다). */
const DURABLE_HP = 100_000_000;

/** 뱀서류(planet0=vampire) PvE 런 설정 — invasion3 없음이라 에코가 롤된다. */
function vampireConfig(): WorldConfig {
  return { ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }), playerHp: DURABLE_HP };
}

/** typeId 시그니처 기체 PvE 런 설정. */
function shipConfig(typeId: number): WorldConfig {
  const profile = defaultProfile();
  activeShip(profile).typeId = typeId;
  return { ...buildRunConfig(profile, { planet: 0, stage: 1 }), playerHp: DURABLE_HP };
}

/** 레벨업 프리즈를 자동 소화하며 한 틱 진행한다. */
function stepAuto(w: WorldState): void {
  const input: InputFrame = w.pendingLevelUp
    ? { ...emptyInput(), special: packPowerupPick(0) }
    : emptyInput();
  stepWorld(w, input);
}

/** 조건을 만족하는 첫 seed 를 찾는다(라벨/확률 변경에도 견고하게 — 하드코딩 seed 를 피한다). */
function firstSeedWhere(pred: (w: WorldState) => boolean): number {
  for (let s = 1; s < 20000; s++) {
    if (pred(createWorld(s, vampireConfig()))) return s;
  }
  throw new Error('조건을 만족하는 seed 를 못 찾았다');
}

const NEG_SEED = firstSeedWhere((w) => w.echoRuntime === undefined);
const POS_SEED = firstSeedWhere((w) => w.echoRuntime !== undefined);

// ---------------------------------------------------------------------------
// §1 — rollEcho 순수 롤(worldRng.fork('echoEvent'))
// ---------------------------------------------------------------------------

describe('에코 — rollEcho 순수 롤', () => {
  it('출현 확률이 ECHO_SPAWN_PROB(≈3%) 근처이고, positive 는 유효 spawnTick 을 낸다', () => {
    let positives = 0;
    let sampled = 0;
    for (let s = 1; s <= 4000; s++) {
      const rt = rollEcho(new SeededRng(s).fork('world'));
      if (rt !== undefined) {
        positives++;
        expect(rt.state).toBe(0);
        expect(rt.dwell).toBe(0);
        expect(rt.entityId).toBe(0);
        // 스폰 틱은 [MIN, MAX] 범위의 정수다.
        expect(Number.isInteger(rt.spawnTick)).toBe(true);
        expect(rt.spawnTick).toBeGreaterThanOrEqual(ECHO_MIN_SPAWN_TICK);
        expect(rt.spawnTick).toBeLessThanOrEqual(ECHO_MAX_SPAWN_TICK);
      }
      sampled++;
    }
    const rate = positives / sampled;
    // 느슨한 경계(희소 이벤트 — 정확 3% 를 강제하지 않되 배선이 살아 있음을 본다).
    expect(rate).toBeGreaterThan(ECHO_SPAWN_PROB * 0.4);
    expect(rate).toBeLessThan(ECHO_SPAWN_PROB * 2.2);
  });

  it('fork 는 부모 worldRng 를 전진시키지 않는다(해시 상태 불변 — 무소비 롤)', () => {
    const worldRng = new SeededRng(POS_SEED).fork('world');
    const before = worldRng.getState();
    rollEcho(worldRng);
    expect(worldRng.getState()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// §2 — 결정론(조건부 폴드 바이트 불변 + 발생 런 재현)
// ---------------------------------------------------------------------------

describe('에코 — 결정론(조건부 꼬리 폴드)', () => {
  it('(A) 에코 미발생 런은 echo 폴드를 실행하지 않는다(조건부 꼬리 — 바이트 불변)', () => {
    const w = createWorld(NEG_SEED, vampireConfig());
    expect(w.echoRuntime).toBeUndefined();
    const hNoEcho = hashWorld(w);
    // 같은 상태에 echoRuntime 을 얹으면 해시가 갈린다 = 폴드가 조건부다(present 일 때만 접힌다).
    (w as WorldState).echoRuntime = { state: 0, spawnTick: 5000, dwell: 0, entityId: 0 };
    expect(hashWorld(w)).not.toBe(hNoEcho);
    // 다시 지우면 원래 바이트로 **정확히** 복귀한다 = 꼬리 폴드가 앞 폴드를 건드리지 않는 순수
    // append 다(재배치 0). 이게 뱀서류·침공·타 모드 골든이 불변인 근본 이유다.
    delete (w as { echoRuntime?: EchoRuntime }).echoRuntime;
    expect(hashWorld(w)).toBe(hNoEcho);
  });

  it('(A2) 에코 미발생 런은 두 번 재생해도 per-tick 해시가 동일하다', () => {
    const replay: Replay = { seed: NEG_SEED, config: vampireConfig(), inputs: idleInputs(120) };
    const a = runReplay(replay);
    const b = runReplay(replay);
    expect(a.hashes).toEqual(b.hashes);
    // 미발생 런은 끝까지 echoRuntime 이 없다.
    expect(a.finalState.echoRuntime).toBeUndefined();
  });

  it('(B) 에코 발생 런은 같은 seed 로 per-tick 해시가 완전 재현된다(echoRuntime 폴드 포함)', () => {
    const replay: Replay = { seed: POS_SEED, config: vampireConfig(), inputs: idleInputs(300) };
    const a = runReplay(replay);
    const b = runReplay(replay);
    expect(a.hashes).toEqual(b.hashes);
    // 발생 런은 echoRuntime 이 present 라 폴드가 실제로 접힌다(state 0 이라도 정수 4필드 접힘).
    expect(a.finalState.echoRuntime).toBeDefined();
  });

  it('(B2) echoRuntime.dwell 이 다르면 해시가 갈린다(안정화 진행이 봉인된다)', () => {
    const w = createWorld(POS_SEED, vampireConfig());
    const rt = w.echoRuntime as EchoRuntime;
    const h0 = hashWorld(w);
    rt.dwell += 1;
    expect(hashWorld(w)).not.toBe(h0);
    rt.dwell -= 1;
    expect(hashWorld(w)).toBe(h0);
  });
});

// ---------------------------------------------------------------------------
// §3 — 스폰 + 안정화 + 보상(정규 경로 배선 실도달)
// ---------------------------------------------------------------------------

describe('에코 — 스폰·안정화·보상', () => {
  it('stepEchoStabilize 격리: 반경 내 체류 누적 → 안정화 성공 시 resources 증가 + state=2 + 오브젝트 dead', () => {
    // 순수 배선 격리(뱀서류 보급 습격 등 confound 없이 보상 델타를 정확히 본다).
    const echo = blankEntity('echo');
    echo.id = 42;
    echo.x = 0;
    echo.y = 0;
    echo.radius = ECHO_TRIGGER_RADIUS;
    const player = blankEntity('player');
    player.x = 0;
    player.y = 0;
    const rt: EchoRuntime = { state: 1, spawnTick: 0, dwell: 0, entityId: 42 };
    const state = {
      entities: [player, echo],
      resources: 10,
      echoRuntime: rt,
    } as unknown as WorldState;

    // 반경 밖이면 드웰이 안 오른다(오히려 감소하지만 0 하한).
    player.x = ECHO_STABILIZE_RADIUS + 100;
    stepEchoStabilize(state, player);
    expect(rt.dwell).toBe(0);
    expect(rt.state).toBe(1);

    // 반경 안(중심)으로 들어와 DWELL_TICKS 만큼 버틴다.
    player.x = 0;
    for (let i = 0; i < ECHO_DWELL_TICKS && rt.state !== 2; i++) {
      stepEchoStabilize(state, player);
    }
    expect(rt.state).toBe(2);
    expect(state.resources).toBe(10 + ECHO_REWARD_CREDITS); // 해시된 경제 정확 델타
    expect(echo.dead).toBe(true); // compact 가 다음에 수거
    expect(echoStabilizedOf(state)).toBe(true);
  });

  it('버티기: 반경을 벗어나면 드웰이 감소한다(0 하한)', () => {
    const echo = blankEntity('echo');
    echo.id = 7;
    const player = blankEntity('player');
    const rt: EchoRuntime = { state: 1, spawnTick: 0, dwell: 0, entityId: 7 };
    const state = { entities: [player, echo], resources: 0, echoRuntime: rt } as unknown as WorldState;
    // 반경 안에서 5틱 누적.
    player.x = 0;
    for (let i = 0; i < 5; i++) stepEchoStabilize(state, player);
    expect(rt.dwell).toBe(5);
    // 반경 밖으로 나가면 감소.
    player.x = ECHO_STABILIZE_RADIUS + 50;
    stepEchoStabilize(state, player);
    expect(rt.dwell).toBe(4);
    // 계속 밖이면 0 까지만 내려간다.
    for (let i = 0; i < 100; i++) stepEchoStabilize(state, player);
    expect(rt.dwell).toBe(0);
    expect(rt.state).toBe(1); // 안정화되지 않는다
  });

  it('정규 경로 full-path: createWorld→stepWorld 로 에코가 실제로 스폰되고 안정화까지 도달한다', () => {
    // spawnTick 을 낮게 덮어 1800틱 대기 없이 스폰 경로를 태운다(롤 자체는 §1 이 검증).
    const w = createWorld(POS_SEED, vampireConfig());
    const player = w.entities[0] as Entity;
    w.echoRuntime = { state: 0, spawnTick: 3, dwell: 0, entityId: 0 };
    // 스폰 틱 도달까지 진행 → 에코 오브젝트가 실제로 생긴다.
    for (let i = 0; i < 12 && !w.entities.some((e) => e.kind === 'echo'); i++) stepAuto(w);
    const echo = w.entities.find((e) => e.kind === 'echo');
    expect(echo, '에코 오브젝트가 스폰돼야 한다').toBeDefined();
    expect(w.echoRuntime.state).toBe(1);
    expect((w.echoRuntime as EchoRuntime).entityId).toBe((echo as Entity).id);
    // 플레이어를 에코 좌표에 붙여 DWELL 만큼 버틴다 → 안정화 성공.
    let resBefore = w.resources;
    for (let i = 0; i < ECHO_DWELL_TICKS + 60 && w.echoRuntime.state !== 2; i++) {
      const e = w.entities.find((x) => x.kind === 'echo' && !x.dead);
      if (e !== undefined) {
        player.x = e.x;
        player.y = e.y;
      }
      resBefore = w.resources; // 안정화 직전 틱의 resources
      stepAuto(w);
    }
    expect(w.echoRuntime.state, '안정화가 완료돼야 한다').toBe(2);
    // 안정화 그 틱에 정확히 ECHO_REWARD_CREDITS 만큼 오른다(다른 소스는 그 틱에 개입하지 않는다).
    expect(w.resources).toBe(resBefore + ECHO_REWARD_CREDITS);
    expect(echoStabilizedOf(w)).toBe(true);
    // 오브젝트는 dead → compact 이 수거해 살아있는 echo 가 남지 않는다.
    expect(w.entities.some((e) => e.kind === 'echo' && !e.dead)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §4 — 관측 카운터(비-해시 + 실제 발동 증가)
// ---------------------------------------------------------------------------

describe('에코 — 관측 카운터(비-해시 · 사연 마일스톤)', () => {
  it('createWorld 는 관측 6카운터를 0 으로 초기화하고 runStoryMetrics 가 그대로 노출한다', () => {
    const w = createWorld(1, vampireConfig());
    const m = runStoryMetrics(w);
    expect(m).toEqual({
      hitsTaken: 0,
      overchargeKills: 0,
      cloakBreaks: 0,
      broodLaunches: 0,
      cushionHealed: 0,
      filmPops: 0,
    });
  });

  it('관측 카운터는 hashWorld 에 접히지 않는다(값을 바꿔도 해시 불변 — 결정론 무영향)', () => {
    const w = createWorld(1, vampireConfig());
    const h0 = hashWorld(w);
    w.hitsTaken = 12345;
    w.overchargeKills = 678;
    w.cloakBreaks = 9;
    w.broodLaunches = 42;
    w.cushionHealed = 99999;
    w.filmPops = 7;
    expect(hashWorld(w)).toBe(h0);
  });

  it('브루저(typeId 1) 런은 hitsTaken 이 실제로 증가한다(피격 관측 배선 실도달)', () => {
    const w = createWorld(0xa2c, shipConfig(1));
    for (let i = 0; i < 7200; i++) {
      const frame = emptyInput();
      if (w.pendingLevelUp) frame.special = SPECIAL_POWERUP_PICK;
      stepWorld(w, frame);
    }
    expect(w.hitsTaken).toBeGreaterThan(0);
    // runStoryMetrics 가 그 값을 metric id 키로 실어 준다(W3 이 RunResult 로 소비).
    expect(runStoryMetrics(w).hitsTaken).toBe(w.hitsTaken);
    // 다른 기체 metric 은 이 런에서 안 오른다(브루저 훅만 게이트를 통과).
    expect(w.broodLaunches).toBe(0);
    expect(w.filmPops).toBe(0);
  });

  it('해츨링(typeId 4) 런은 broodLaunches 가 실제로 증가한다(출격 관측 배선 실도달)', () => {
    const w = createWorld(0xb10f, shipConfig(4));
    for (let i = 0; i < 7200; i++) {
      const frame = emptyInput();
      if (w.pendingLevelUp) frame.special = SPECIAL_POWERUP_PICK;
      stepWorld(w, frame);
    }
    expect(w.broodLaunches).toBeGreaterThan(0);
  });
});
