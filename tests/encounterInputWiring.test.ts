/**
 * 조우 입력 **배선** 게이트 — 프로덕션 입력 경로가 실제로 `SPECIAL_ENCOUNTER_*` 비트를
 * 만들어 내는지 검증한다(ADR-0033).
 *
 * ## 왜 이 파일이 따로 필요한가 (이 저장소의 반복 결함 8회차)
 * 기존 조우 테스트(`encounterLight`·`encounterDetour`·`encounterHashInvariance`)는 전부 입력
 * 프레임을 **직접 합성해서**(`{ ...emptyInput(), special: SPECIAL_ENCOUNTER_ENTER }`) sim 함수에
 * 넣는다. 그래서 sim 은 완벽했는데도 **그 비트를 만드는 프로덕션 경로가 통째로 없다**는 사실을
 * 한 개도 잡지 못했다 — 조우 5종 중 3종(가중치 합 70%)이 실제 플레이에서 도달 불가였고 포탈은
 * 런이 끝날 때까지 떠 있기만 했다. "단위 테스트는 그린인데 배선이 통째로 없다"는 이 저장소의
 * 여덟 번째 사례다.
 *
 * 그래서 이 파일의 **모든** 단언은 `InputController.sample()` 이 돌려준 실물 프레임을 본다.
 * 합성 입력을 sim 에 넣는 단언은 여기에 단 하나도 없어야 한다 — 있으면 이 게이트는 다시
 * 무력화된다.
 *
 * ## DOM 스텁 규율
 * vitest 환경이 `node` 라 `window` 가 없다. `InputController` 는 생성자에서 리스너를 달고
 * `sample()` 에서 `gameApp.clientToDesign` 을 부르므로 그 **둘만** 최소 스텁한다. `sample()`
 * 자체는 절대 감싸지 않는다 — 그것을 스텁하면 이 테스트가 검증하려는 바로 그 경로가 사라진다.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { InputController } from '../src/input/controller.js';
import {
  createWorld,
  stepWorld,
  DEFAULT_CONFIG,
  SPECIAL_POWERUP_PICK,
} from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import type { GameApp } from '../src/render/app.js';
import type { EncounterRuntime } from '../src/sim/encounter.js';
import {
  SPECIAL_ENCOUNTER_ENTER,
  SPECIAL_ENCOUNTER_DECLINE,
  SPECIAL_ENCOUNTER_ALTAR_PICK,
  SPECIAL_ENCOUNTER_EXIT,
  ENCOUNTER_TYPE,
} from '../data/encounters.js';

// ---------------------------------------------------------------------------
// 최소 DOM 스텁 (프로덕션 경로를 우회하지 않는 범위에서만)
// ---------------------------------------------------------------------------

interface WindowStub {
  addEventListener: () => void;
  removeEventListener: () => void;
}

const windowStub: WindowStub = {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

let hadWindow = false;

beforeAll(() => {
  hadWindow = 'window' in globalThis;
  if (!hadWindow) {
    (globalThis as unknown as { window: WindowStub }).window = windowStub;
  }
});

afterAll(() => {
  if (!hadWindow) {
    delete (globalThis as unknown as { window?: WindowStub }).window;
  }
});

/**
 * `clientToDesign` 만 채운 GameApp 스텁. 항상 화면 중앙을 돌려주므로 조준각은 상수가 되고,
 * 이 파일의 관심사인 `special` 비트만 남는다.
 */
function stubGameApp(): GameApp {
  return {
    clientToDesign: () => ({ x: 960, y: 540 }),
  } as unknown as GameApp;
}

function makeController(): InputController {
  return new InputController(stubGameApp());
}

/** `sample()` 실물 호출 — 플레이어 좌표는 원점 고정(조준각 무관심). */
function sampleSpecial(c: InputController): number {
  return c.sample(0, 0).special;
}

// ---------------------------------------------------------------------------
// ① 큐잉 → 비트 생성 (CRITICAL 결함의 직접 회귀)
// ---------------------------------------------------------------------------

describe('InputController — 조우 입력 비트 생성', () => {
  it('queueEncounterEnter() 가 SPECIAL_ENCOUNTER_ENTER 를 만든다', () => {
    const c = makeController();
    c.queueEncounterEnter();
    expect(sampleSpecial(c) & SPECIAL_ENCOUNTER_ENTER).not.toBe(0);
  });

  it('queueEncounterDecline() 가 SPECIAL_ENCOUNTER_DECLINE 을 만든다', () => {
    const c = makeController();
    c.queueEncounterDecline();
    expect(sampleSpecial(c) & SPECIAL_ENCOUNTER_DECLINE).not.toBe(0);
  });

  it('queueEncounterExit() 가 SPECIAL_ENCOUNTER_EXIT 을 만든다', () => {
    const c = makeController();
    c.queueEncounterExit();
    expect(sampleSpecial(c) & SPECIAL_ENCOUNTER_EXIT).not.toBe(0);
  });

  it('아무것도 큐잉하지 않으면 special 이 0 이다(조우 비트 누출 없음)', () => {
    const c = makeController();
    expect(sampleSpecial(c)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ② 제단 3택 — 인덱스가 비트 6..7 에 정확히 실리는가
// ---------------------------------------------------------------------------

describe('InputController — 제단 3택 인덱스 패킹', () => {
  it.each([0, 1, 2])('인덱스 %i 가 ALTAR_PICK + 비트 6..7 로 실린다', (index) => {
    const c = makeController();
    c.queueEncounterAltarPick(index);
    const special = sampleSpecial(c);
    expect(special & SPECIAL_ENCOUNTER_ALTAR_PICK).not.toBe(0);
    // sim(`stepAltar`)이 인덱스를 읽는 식과 **같은 산술**로 되읽는다.
    expect((special >>> 6) & 0x3).toBe(index);
  });

  it('인덱스가 비트 3..5(다른 조우 비트)를 오염시키지 않는다', () => {
    for (const index of [0, 1, 2, 3]) {
      const c = makeController();
      c.queueEncounterAltarPick(index);
      const special = sampleSpecial(c);
      expect(special & SPECIAL_ENCOUNTER_ENTER).toBe(0);
      expect(special & SPECIAL_ENCOUNTER_DECLINE).toBe(0);
      expect(special & SPECIAL_ENCOUNTER_EXIT).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// ③ 비트 0..2(파워업 픽) 무오염 — 리플레이 wire 계약
// ---------------------------------------------------------------------------

describe('조우 비트가 파워업 비트 0..2 를 오염시키지 않는다', () => {
  it('네 종류 어느 것도 SPECIAL_POWERUP_PICK 과 인덱스 비트를 세우지 않는다', () => {
    const queues: ((c: InputController) => void)[] = [
      (c) => c.queueEncounterEnter(),
      (c) => c.queueEncounterDecline(),
      (c) => c.queueEncounterAltarPick(2),
      (c) => c.queueEncounterExit(),
    ];
    for (const q of queues) {
      const c = makeController();
      q(c);
      const special = sampleSpecial(c);
      // 비트 0..2 = SPECIAL_POWERUP_PICK(0) + 선택 인덱스(1..2). 통째로 0 이어야 한다.
      expect(special & 0b111).toBe(0);
      expect(special & SPECIAL_POWERUP_PICK).toBe(0);
      // 반대로 조우 비트는 반드시 비트 3 이상에만 있다.
      expect(special >>> 3).not.toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// ④ 소비 후 큐 비움 — 한 번 누른 것이 두 프레임에 실리면 sim 이 두 번 판정한다
// ---------------------------------------------------------------------------

describe('큐는 한 번만 소비된다', () => {
  it('enter/decline/exit/제단 픽 전부 다음 sample 에서는 사라진다', () => {
    const queues: ((c: InputController) => void)[] = [
      (c) => c.queueEncounterEnter(),
      (c) => c.queueEncounterDecline(),
      (c) => c.queueEncounterAltarPick(1),
      (c) => c.queueEncounterExit(),
    ];
    for (const q of queues) {
      const c = makeController();
      q(c);
      expect(sampleSpecial(c)).not.toBe(0);
      expect(sampleSpecial(c)).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// ⑤ 파워업 픽과의 동시 프레임 — 택한 동작을 못 박는다
// ---------------------------------------------------------------------------

describe('파워업 픽 대기 중에는 조우 큐를 보류한다', () => {
  it('같은 프레임에 조우 비트를 싣지 않는다(프리즈 프레임에서 증발 방지)', () => {
    const c = makeController();
    c.queuePowerupPick(1);
    c.queueEncounterEnter();
    const first = sampleSpecial(c);
    // 파워업만 실린다 — stepWorld 는 pendingLevelUp 프레임에서 파워업만 처리하고 return 하므로
    // 여기에 조우 비트를 함께 실으면 그 입력이 조용히 증발한다.
    expect(first & SPECIAL_POWERUP_PICK).not.toBe(0);
    expect((first >>> 1) & 0x3).toBe(1);
    expect(first & SPECIAL_ENCOUNTER_ENTER).toBe(0);
  });

  it('보류된 조우 입력은 다음 프레임에 온전히 실려 나간다(유실 없음)', () => {
    const c = makeController();
    c.queuePowerupPick(0);
    c.queueEncounterEnter();
    sampleSpecial(c); // 프리즈 프레임(파워업만).
    const second = sampleSpecial(c);
    expect(second & SPECIAL_ENCOUNTER_ENTER).not.toBe(0);
    expect(second & SPECIAL_POWERUP_PICK).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑥ end-to-end — Controller.sample() → stepWorld → 조우 상태 변화
//    (합성 입력이 아니라 실물 프레임이 sim 을 움직이는지 사슬 전체로 확인)
// ---------------------------------------------------------------------------

/**
 * 조우 롤(≈2%)에 기대지 않고 런타임을 직접 싣는다(다른 조우 테스트와 같은 하네스 규율).
 *
 * `state: 0`(대기)로 다는 것이 중요하다 — `maybeSpawnEncounter` 는 대기 상태에서만 오브젝트를
 * 세우고 state 를 1 로 올린다. 1 을 미리 박아 넣으면 포탈·제단이 영영 스폰되지 않는다.
 */
function attachRuntime(state: WorldState, type: number, spawnTick: number): EncounterRuntime {
  const rt: EncounterRuntime = {
    state: 0,
    type,
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

/**
 * 스폰된 조우 오브젝트를 플레이어 위로 끌어다 놓는다.
 *
 * 스폰 오프셋(`ENCOUNTER_SPAWN_OFFSET` = 540)이 상호작용 반경(`ENCOUNTER_INTERACT_RADIUS`
 * = 320)보다 크므로, 정상 플레이에서는 **플레이어가 걸어가서** 반경 안에 들어가야 입력이 먹는다.
 * 이 테스트의 관심사는 이동이 아니라 입력 배선이라 좌표만 맞춰 주고 반경 판정은 실물 sim 이
 * 그대로 하게 둔다(반경 판정을 건너뛰지 않는다 — 그것도 프로덕션 경로다).
 */
function pullObjectToPlayer(state: WorldState): void {
  const rt = state.encounterRuntime;
  const player = state.entities[0];
  if (rt === undefined || player === undefined || rt.entityId === 0) return;
  for (const e of state.entities) {
    if (e.id !== rt.entityId) continue;
    e.x = player.x;
    e.y = player.y;
    return;
  }
}

describe('end-to-end — 실물 입력 프레임이 sim 조우를 움직인다', () => {
  it('보물 격실: queueEncounterEnter() → sample() → stepWorld → inDetour === 1', () => {
    const world = createWorld(0x51_ee_d0, DEFAULT_CONFIG);
    // 포탈 스폰은 `stepEncounter` 가 스폰 틱 도달 시 플레이어 곁 고정 오프셋에 놓는다.
    // spawnTick=0 이면 첫 틱에 포탈이 서고, 상호작용 반경 안이므로 다음 틱 ENTER 가 먹는다.
    const rt = attachRuntime(world, ENCOUNTER_TYPE.treasureVault, 0);
    const c = makeController();

    // 1틱: 아무 입력 없이 굴려 포탈을 세운다(입력도 실물 sample 로 만든다).
    stepWorld(world, c.sample(0, 0));
    expect(rt.entityId).not.toBe(0);
    pullObjectToPlayer(world);

    // 2틱: 진입. **여기가 이 파일의 핵심** — 합성 special 이 아니라 컨트롤러가 만든 프레임이다.
    c.queueEncounterEnter();
    const enterFrame = c.sample(0, 0);
    expect(enterFrame.special & SPECIAL_ENCOUNTER_ENTER).not.toBe(0);
    stepWorld(world, enterFrame);

    expect(rt.inDetour).toBe(1);
    expect(rt.state).toBe(2);
  });

  it('오스카 제단: queueEncounterAltarPick(0) → sample() → stepWorld → 완료(state 3)', () => {
    const world = createWorld(0x51_ee_d1, DEFAULT_CONFIG);
    const rt = attachRuntime(world, ENCOUNTER_TYPE.oscarAltar, 0);
    const c = makeController();

    stepWorld(world, c.sample(0, 0)); // 제단 스폰.
    expect(rt.entityId).not.toBe(0);
    pullObjectToPlayer(world);

    c.queueEncounterAltarPick(0);
    const pickFrame = c.sample(0, 0);
    expect(pickFrame.special & SPECIAL_ENCOUNTER_ALTAR_PICK).not.toBe(0);
    const lootBefore = world.loot.length;
    stepWorld(world, pickFrame);

    expect(rt.state).toBe(3); // 완료.
    expect(world.loot.length).toBeGreaterThan(lootBefore); // 즉시 보상이 실제로 나갔다.
  });

  it('거부: queueEncounterDecline() → sample() → stepWorld → state 4', () => {
    const world = createWorld(0x51_ee_d2, DEFAULT_CONFIG);
    const rt = attachRuntime(world, ENCOUNTER_TYPE.sealedGuardian, 0);
    const c = makeController();

    stepWorld(world, c.sample(0, 0)); // 출현(수호자는 오브젝트 없이 state 만 1).
    c.queueEncounterDecline();
    stepWorld(world, c.sample(0, 0));

    expect(rt.state).toBe(4);
  });

  it('detour 조기 이탈: queueEncounterExit() → sample() → stepWorld → inDetour 해제', () => {
    const world = createWorld(0x51_ee_d3, DEFAULT_CONFIG);
    const rt = attachRuntime(world, ENCOUNTER_TYPE.treasureVault, 0);
    const c = makeController();

    stepWorld(world, c.sample(0, 0)); // 포탈 스폰.
    pullObjectToPlayer(world);
    c.queueEncounterEnter();
    stepWorld(world, c.sample(0, 0)); // 진입 선언(좌표 저장).
    stepWorld(world, c.sample(0, 0)); // 방 실체화(첫 detour 틱).
    expect(rt.inDetour).toBe(1);

    c.queueEncounterExit();
    const exitFrame = c.sample(0, 0);
    expect(exitFrame.special & SPECIAL_ENCOUNTER_EXIT).not.toBe(0);
    stepWorld(world, exitFrame);

    expect(rt.inDetour).toBe(0);
    expect(rt.state).toBe(3);
  });
});
