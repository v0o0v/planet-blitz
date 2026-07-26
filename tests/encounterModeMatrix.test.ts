/**
 * 조우 × 6개 행성 모드 매트릭스 게이트 — "조우가 **모든 모드에서 실제로 도달 가능한가**".
 *
 * ## 왜 매트릭스여야 하는가
 * 조우 v1 은 워프 detour 를 뱀서류로 게이트했고(`rollEncounter(rng, allowWarp)`), 근접
 * 오브젝트 3종은 플레이어 곁 고정 오프셋(+540, 0)에 그냥 놓였다. 그 배치는 뱀서류(무한 맵)
 * 에서만 성립한다 — 강제 스크롤 창(블록격파·레이싱)에서는 창 밖이라 `clampToWindow` 가
 * 플레이어를 되돌려 **영원히 반경 320 안에 못 들어가고**, 수축지대에서는 안전 반경 밖이라
 * 다가가는 동안 지속 피해를 받는다. 즉 "sim 은 완벽한데 그 모드에서 도달 자체가 불가"라는,
 * 이 저장소의 반복 결함과 정확히 같은 형태다.
 *
 * 그래서 이 파일은 유형 하나·모드 하나를 깊게 파지 않고 **6모드 × 5단언**을 같은 시나리오로
 * 훑는다. 단언은 전부 "최종 상태에 대한 것"이며, 아직 배선되지 않은 레인이 있으면 그 모드가
 * 빨갛게 뜨는 것이 정상이다(단언을 약화해 초록으로 만들지 않는다).
 *
 * ## 5단언
 *  ① **도달 가능** — 조우 오브젝트가 플레이어가 실제로 걸어가서 상호작용 반경(320) 안에
 *     들어올 수 있는 자리에 선다. 좌표 산술이 아니라 **런으로** 확인한다(모드 규칙이 이동을
 *     막으면 좌표만으로는 알 수 없다).
 *  ② **포켓에 있다** — detour 진입 후 플레이어가 워프 좌표에 그대로 있다. 창 클램프·수축
 *     클램프가 플레이어를 끌어오면 워프 거리(≈12만 유닛 ×2축)가 무너진다.
 *  ③ **모드 규칙 무피해** — detour 45초 동안 HP 불변. 창 압사·후방 압박·수축 밖 판정이
 *     detour 안에서 돌면 여기서 HP 가 깎인다.
 *  ④ **원좌표 복원** — 복귀 시 저장 좌표 정확히 그대로(정수 비교).
 *  ⑤ **메인 월드 동결** — detour 중 플레이어 외 엔티티·웨이브·모드 런타임이 바이트 불변.
 *
 * 추가로 강제 스크롤 2모드(아르케·크라스)는 **창이 전진한 뒤에도** 오브젝트가 도달 가능한지
 * 본다 — 창 고정이 없으면 오브젝트가 창 뒤로 흘러 다시 도달 불가가 된다.
 *
 * ## 정규 입력 경로 규율 (CRITICAL 재발 방지)
 * 이 파일의 모든 입력 프레임은 **`InputController.sample()` 실물 호출**로 만든다. 이동은
 * 실제 keydown 리스너에 키 코드를 흘려 넣고, 조우 진입/이탈은 UI 오버레이가 부르는 것과 같은
 * `queueEncounterEnter()`/`queueEncounterExit()` 로 큐잉한다. 하네스의 `injectInput` 같은
 * DEV 우회는 쓰지 않는다 — 과거 `Controller.sample()` 이 조우 비트를 한 비트도 만들지 않아
 * 조우 3종이 도달 불가였던 CRITICAL 이 그 우회 검증을 그대로 통과했다.
 * 부득이한 직접 상태 조작은 아래 두 군데뿐이며 각각 한글 주석으로 근거를 밝혔다:
 *   (가) 조우 롤(≈2%)에 기대지 않으려고 `encounterRuntime` 을 직접 싣는 것(기존 조우 테스트
 *        전부의 공통 하네스 규율).
 *   (나) ③의 관측 대상을 "모드 규칙 피해"로 좁히려고 방 안 경비 적의 접촉 피해를 0 으로
 *        만드는 것(방 안 피해는 이 파일의 관심사가 아니다).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import type { EncounterRuntime } from '../src/sim/encounter.js';
import type { GameApp } from '../src/render/app.js';
import { InputController } from '../src/input/controller.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import type { PlanetMode } from '../src/sim/planetMode.js';
import { DETOUR_MARK } from '../src/sim/encounterDetour.js';
import {
  ENCOUNTER_TYPE,
  ENCOUNTER_INTERACT_RADIUS,
  VAULT_TIMER_TICKS,
  VAULT_WARP_OFFSET_X,
  VAULT_WARP_OFFSET_Y,
} from '../data/encounters.js';

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/** 접촉·지속 피해로 런이 조기 종료되지 않게 버티는 무대 HP(관측 하네스 관용값). */
const DURABLE_HP = 100_000_000;

/** 오브젝트를 향해 걸어갈 수 있는 최대 틱(도달 못 하면 ① 실패). 60fps 기준 20초. */
const APPROACH_BUDGET_TICKS = 1200;

/** 이 거리 이하로 X/Y 차가 줄면 해당 축 키를 놓는다(±1 양자화 입력의 떨림 방지). */
const APPROACH_DEADZONE = 48;

/**
 * 강제 스크롤 모드에서 "창이 충분히 전진했다"고 볼 틱 수. 요구치는 블록격파 90틱 · 레이싱
 * 160틱이며, 두 모드 모두 **그보다 더** 굴려 한쪽만 우연히 통과하는 일이 없게 한다.
 */
const SCROLL_ADVANCE_TICKS = 200;

/** detour 안에서 머무는 관측 구간(타이머 만료 직전까지 — 자동 이젝트에 걸리지 않는다). */
const DETOUR_OBSERVE_TICKS = VAULT_TIMER_TICKS - 30;

// ---------------------------------------------------------------------------
// 정규 입력 경로 하네스 — window 스텁 + 실물 InputController
// ---------------------------------------------------------------------------

type Listener = (e: { code: string; preventDefault: () => void }) => void;

interface WindowStub {
  addEventListener: (type: string, fn: Listener) => void;
  removeEventListener: (type: string, fn: Listener) => void;
}

let hadWindow = false;

beforeAll(() => {
  hadWindow = 'window' in globalThis;
});

afterAll(() => {
  if (!hadWindow) {
    delete (globalThis as unknown as { window?: WindowStub }).window;
  }
});

/**
 * 키보드 → `InputController` → `InputFrame` 사슬을 그대로 태우는 하네스.
 *
 * `sample()` 을 절대 감싸지 않는다 — 감싸는 순간 이 파일이 검증하려는 프로덕션 경로가
 * 사라진다. 이동도 합성하지 않고 실제 `keydown`/`keyup` 리스너에 키 코드를 흘려 넣어
 * 컨트롤러가 스스로 moveX/moveY 를 만들게 한다.
 */
class Pilot {
  private readonly controller: InputController;
  private keyDownFn: Listener | undefined;
  private keyUpFn: Listener | undefined;
  private readonly held = new Set<string>();

  constructor() {
    // 화살표 함수라 `this` 가 렉시컬로 잡힌다 — 별칭(self) 없이 그대로 쓴다.
    const stub: WindowStub = {
      addEventListener: (type, fn) => {
        if (type === 'keydown') this.keyDownFn = fn;
        if (type === 'keyup') this.keyUpFn = fn;
      },
      removeEventListener: () => undefined,
    };
    // 컨트롤러마다 새 스텁을 심어 리스너가 테스트 사이에 누적되지 않게 한다.
    (globalThis as unknown as { window: WindowStub }).window = stub;
    this.controller = new InputController({
      clientToDesign: () => ({ x: 960, y: 540 }),
    } as unknown as GameApp);
  }

  /** 이번 프레임에 누르고 있을 키 집합을 갱신한다(실제 keydown/keyup 이벤트로). */
  private setKeys(codes: string[]): void {
    const want = new Set(codes);
    for (const code of this.held) {
      if (!want.has(code)) this.keyUpFn?.({ code, preventDefault: () => undefined });
    }
    for (const code of want) {
      if (!this.held.has(code)) this.keyDownFn?.({ code, preventDefault: () => undefined });
    }
    this.held.clear();
    for (const code of want) this.held.add(code);
  }

  /** 조우 진입(UI 오버레이가 부르는 것과 같은 API). */
  queueEnter(): void {
    this.controller.queueEncounterEnter();
  }

  /** detour 조기 이탈(UI 오버레이가 부르는 것과 같은 API). */
  queueExit(): void {
    this.controller.queueEncounterExit();
  }

  /**
   * 한 틱 진행. 레벨업 프리즈는 관심 밖이라 파워업 픽으로 즉시 소화한다(안 풀면 월드가
   * 그 자리에서 멈춘다) — 이것도 컨트롤러 큐를 거치는 정규 경로다. 컨트롤러는 프리즈
   * 프레임에 조우 큐를 **보류**하므로 진입 입력이 증발하지 않는다.
   */
  step(state: WorldState, keys: string[] = []): InputFrame {
    this.setKeys(keys);
    const player = playerOf(state);
    if (state.pendingLevelUp) this.controller.queuePowerupPick(0);
    const frame = this.controller.sample(player.x, player.y);
    stepWorld(state, frame);
    return frame;
  }
}

// ---------------------------------------------------------------------------
// 공용 헬퍼
// ---------------------------------------------------------------------------

function playerOf(state: WorldState): Entity {
  const p = state.entities[0];
  if (p === undefined) throw new Error('player missing');
  return p;
}

function modeConfig(planet: number): WorldConfig {
  return {
    ...buildRunConfig(defaultProfile(), { planet, stage: 1 }),
    playerHp: DURABLE_HP,
  };
}

/**
 * 조우 롤(≈2%)에 기대지 않고 보물 격실 런타임을 직접 싣는다 — 기존 조우 테스트 전부의
 * 공통 하네스 규율이다. `state: 0`(대기)로 다는 것이 중요하다: `maybeSpawnEncounter` 는
 * 대기 상태에서만 오브젝트를 세우므로 1 을 미리 박으면 포탈이 영영 스폰되지 않는다.
 */
function attachVaultRuntime(state: WorldState, spawnTick: number): EncounterRuntime {
  const rt: EncounterRuntime = {
    state: 0,
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

/** rt.entityId 가 가리키는 살아 있는 조우 오브젝트(없으면 undefined). */
function encounterObject(state: WorldState, rt: EncounterRuntime): Entity | undefined {
  if (rt.entityId === 0) return undefined;
  return state.entities.find((e) => e.id === rt.entityId && !e.dead);
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 목표 좌표로 향하는 WASD 키 집합(±1 양자화 입력이라 데드존을 둔다). */
function keysToward(from: Entity, to: { x: number; y: number }): string[] {
  const keys: string[] = [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx > APPROACH_DEADZONE) keys.push('KeyD');
  else if (dx < -APPROACH_DEADZONE) keys.push('KeyA');
  if (dy > APPROACH_DEADZONE) keys.push('KeyS');
  else if (dy < -APPROACH_DEADZONE) keys.push('KeyW');
  return keys;
}

/**
 * 조우 오브젝트까지 **실제로 걸어간다**. 매 틱 오브젝트의 최신 좌표를 다시 읽는 것이
 * 중요하다 — 강제 스크롤 모드에서는 오브젝트가 창에 고정돼 함께 전진하기 때문이다.
 *
 * 반환값은 관측 결과(도달 여부·최근접 거리·소요 틱)다. 판정은 호출부가 한다.
 */
function approach(
  state: WorldState,
  rt: EncounterRuntime,
  pilot: Pilot,
  budget = APPROACH_BUDGET_TICKS,
): { reached: boolean; closest: number; ticks: number; gameOver: boolean } {
  let closest = Number.POSITIVE_INFINITY;
  for (let t = 0; t < budget; t++) {
    const obj = encounterObject(state, rt);
    if (obj === undefined) return { reached: false, closest, ticks: t, gameOver: state.gameOver };
    const player = playerOf(state);
    const d = dist(player, obj);
    if (d < closest) closest = d;
    if (d <= ENCOUNTER_INTERACT_RADIUS) {
      return { reached: true, closest, ticks: t, gameOver: state.gameOver };
    }
    if (state.gameOver) return { reached: false, closest, ticks: t, gameOver: true };
    pilot.step(state, keysToward(player, obj));
  }
  return { reached: false, closest, ticks: budget, gameOver: state.gameOver };
}

/** 플레이어·방 안 소유물을 뺀 메인 월드 엔티티(동결 대조 대상). */
function mainEntities(state: WorldState): Entity[] {
  const player = playerOf(state);
  return state.entities.filter((e) => e !== player && e.ownerId !== DETOUR_MARK);
}

/** 메인 월드 스냅샷 — 엔티티 전 필드 + 웨이브 + 모드 런타임을 문자열로 굳힌다. */
function snapshotMain(state: WorldState): string {
  return JSON.stringify({
    entities: mainEntities(state),
    wave: state.wave,
    scrollRuntime: state.scrollRuntime,
    shrinkRuntime: state.shrinkRuntime,
    kills: state.kills,
    xp: state.xp,
    level: state.level,
  });
}

/**
 * 조우 오브젝트가 설 때까지 굴린다. 스폰 자체는 `stepEncounter` → `maybeSpawnEncounter`
 * 의 정규 경로가 한다(좌표를 손으로 놓지 않는다 — 그 좌표가 ① 의 관측 대상이다).
 */
function runUntilSpawned(state: WorldState, rt: EncounterRuntime, pilot: Pilot): void {
  for (let t = 0; t < 300 && rt.entityId === 0 && rt.state === 0; t++) pilot.step(state);
}

// ---------------------------------------------------------------------------
// 모드 매트릭스 (ADR-0021 배정 — data/planets/index.ts 가 정본)
// ---------------------------------------------------------------------------

interface ModeCase {
  readonly planet: number;
  readonly label: string;
  readonly mode: PlanetMode;
  /** 강제 스크롤 창을 가진 모드인가(창 전진 후 재도달 단언 대상). */
  readonly scroll: boolean;
  /** 케이스별 고정 시드(모드 간 시드 충돌로 우연히 통과하는 일 방지). */
  readonly seed: number;
}

const MODES: readonly ModeCase[] = [
  { planet: 0, label: '카르곤=뱀서류', mode: PLANET_MODE.vampire, scroll: false, seed: 0xe0_00_01 },
  { planet: 1, label: '베르단=수축', mode: PLANET_MODE.shrink, scroll: false, seed: 0xe0_00_02 },
  { planet: 2, label: '니플헤임=추격', mode: PLANET_MODE.chase, scroll: false, seed: 0xe0_00_03 },
  { planet: 3, label: '아르케=레이싱', mode: PLANET_MODE.racing, scroll: true, seed: 0xe0_00_04 },
  { planet: 4, label: '톡사르=오염', mode: PLANET_MODE.contamination, scroll: false, seed: 0xe0_00_05 },
  { planet: 5, label: '크라스=블록격파', mode: PLANET_MODE.blockBreak, scroll: true, seed: 0xe0_00_06 },
];

// ---------------------------------------------------------------------------
// 모드 조립 자체가 옳은가 (함정: DEFAULT_CONFIG 에 planet 만 얹으면 planetMode 가 안 선다)
// ---------------------------------------------------------------------------

describe('모드 config 조립 — 테스트가 조용히 뱀서류로 도는 함정 차단', () => {
  it.each(MODES)('$label 은 buildRunConfig 로 planetMode 가 실제로 선다', (c) => {
    const cfg = modeConfig(c.planet);
    expect(cfg.planetMode).toBe(c.mode);
    const world = createWorld(c.seed, cfg);
    // 모드 런타임이 실제로 섰는지까지 본다 — planetMode 만 맞고 런타임이 없으면
    // 창 클램프·수축 판정이 애초에 돌지 않아 이 파일의 단언이 공회전한다.
    expect(world.scrollRuntime !== undefined).toBe(c.scroll);
    if (c.mode === PLANET_MODE.shrink) expect(world.shrinkRuntime).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// ① 도달 가능한 위치에 스폰된다
// ---------------------------------------------------------------------------

describe('① 조우 오브젝트가 도달 가능한 위치에 스폰된다', () => {
  it.each(MODES)('$label — 걸어가서 상호작용 반경 320 안에 들어간다', (c) => {
    const world = createWorld(c.seed, modeConfig(c.planet));
    const pilot = new Pilot();
    const rt = attachVaultRuntime(world, world.tick + 1);

    runUntilSpawned(world, rt, pilot);
    expect(rt.state).toBe(1);
    expect(rt.entityId).not.toBe(0);
    const obj = encounterObject(world, rt);
    expect(obj).toBeDefined();

    const r = approach(world, rt, pilot);
    expect(r.gameOver).toBe(false);
    // 실패 시 최근접 거리가 원인을 그대로 말해 준다(창 밖에 박혀 있으면 큰 값에서 정체).
    expect(r.reached, `최근접 ${Math.round(r.closest)} (${r.ticks}틱)`).toBe(true);
    expect(r.closest).toBeLessThanOrEqual(ENCOUNTER_INTERACT_RADIUS);
  });
});

// ---------------------------------------------------------------------------
// ②③④⑤ detour — 포켓 체류 · 무피해 · 원좌표 복원 · 메인 월드 동결
// ---------------------------------------------------------------------------

describe('②③④⑤ detour 가 모든 모드에서 같은 계약으로 돈다', () => {
  it.each(MODES)('$label — 워프 유지·HP 불변·좌표 복원·메인 동결', (c) => {
    const world = createWorld(c.seed ^ 0xa5a5, modeConfig(c.planet));
    const pilot = new Pilot();
    const rt = attachVaultRuntime(world, world.tick + 1);

    runUntilSpawned(world, rt, pilot);
    const reach = approach(world, rt, pilot);
    expect(reach.reached).toBe(true); // ① 이 실패하면 여기부터는 관측 자체가 불가능하다.

    // ── 진입: 정규 경로(UI 오버레이 → 컨트롤러 큐 → sample → stepWorld).
    pilot.queueEnter();
    const enterFrame = pilot.step(world);
    expect(enterFrame.special).not.toBe(0); // 컨트롤러가 실제로 비트를 만들었는가.
    expect(rt.inDetour).toBe(1);
    expect(rt.state).toBe(2);
    const savedX = rt.savedX;
    const savedY = rt.savedY;

    // 진입 틱은 좌표만 저장한다 — 실제 워프·세트피스는 다음 틱 stepDetour 가 한다.
    pilot.step(world);

    // ── ② 정말 포켓에 있다: 클램프가 플레이어를 끌어왔으면 이 거리가 무너진다.
    const player = playerOf(world);
    const warpDist = Math.abs(player.x - savedX) + Math.abs(player.y - savedY);
    const expectedWarp = Math.abs(VAULT_WARP_OFFSET_X) + Math.abs(VAULT_WARP_OFFSET_Y);
    // 워프 직후라 플레이어 이동은 한 틱분(수십 유닛)뿐 — 여유를 크게 잡아도 클램프는 못 통과한다.
    expect(warpDist).toBeGreaterThan(expectedWarp - 1000);

    // (나) 직접 상태 조작: 방 안 경비 적의 **접촉 피해만** 0 으로 만든다. ③ 의 관측 대상은
    //      "모드 규칙 피해"이고 방 안 전투 피해는 이 파일의 관심사가 아니다. 엔티티를 지우지
    //      않는 이유는 지우면 방 안 파이프라인(이동·충돌·정리)이 공회전해 동결 단언이 약해지기
    //      때문이다.
    let guards = 0;
    for (const e of world.entities) {
      if (e.ownerId === DETOUR_MARK && e.kind === 'enemy') {
        e.damage = 0;
        guards++;
      }
    }
    expect(guards).toBeGreaterThan(0); // 방이 실제로 실체화됐는지 확인(공회전 방지).

    const hpBefore = player.hp;
    const mainBefore = snapshotMain(world);
    const tickBefore = world.tick;

    for (let t = 0; t < DETOUR_OBSERVE_TICKS; t++) pilot.step(world);

    // ── ③ 모드 규칙으로 피해를 받지 않는다(창 압사·후방 압박·수축 밖 판정 전부 미실행).
    expect(rt.inDetour).toBe(1); // 아직 자동 이젝트 전이다(45초 구간을 실제로 채웠다).
    expect(world.gameOver).toBe(false);
    expect(playerOf(world).hp).toBe(hpBefore);

    // ── ⑤ 메인 월드 동결: 플레이어 외 엔티티·웨이브·모드 런타임이 한 필드도 안 변했다.
    expect(snapshotMain(world)).toBe(mainBefore);
    expect(world.tick).toBe(tickBefore + DETOUR_OBSERVE_TICKS); // 전진해도 되는 것은 tick 뿐.

    // ── ④ 복귀: 원좌표 정확히 복원 + 방 안 소유물 잔류 0.
    pilot.queueExit();
    pilot.step(world);
    expect(rt.inDetour).toBe(0);
    const back = playerOf(world);
    expect(back.x).toBe(savedX);
    expect(back.y).toBe(savedY);
    expect(world.entities.some((e) => e.ownerId === DETOUR_MARK)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 강제 스크롤 전용 — 창이 전진한 뒤에도 도달 가능한가(창 고정 동작 확인)
// ---------------------------------------------------------------------------

const SCROLL_MODES = MODES.filter((m) => m.scroll);

describe('강제 스크롤: 창이 전진한 뒤에도 조우 오브젝트가 도달 가능하다', () => {
  it.each(SCROLL_MODES)('$label — 200틱 전진 후에도 반경 320 안에 들어간다', (c) => {
    const world = createWorld(c.seed ^ 0x5c_20_11, modeConfig(c.planet));
    const pilot = new Pilot();
    const rt = attachVaultRuntime(world, world.tick + 1);

    runUntilSpawned(world, rt, pilot);
    expect(rt.entityId).not.toBe(0);
    const scroll = world.scrollRuntime;
    if (scroll === undefined) throw new Error('scrollRuntime missing');
    const winBefore = { x: scroll.scrollX, y: scroll.scrollY };

    // 오브젝트를 향해 가지 않고 가만히 있는 동안 창만 전진시킨다.
    for (let t = 0; t < SCROLL_ADVANCE_TICKS; t++) pilot.step(world);
    expect(world.gameOver).toBe(false);
    // 창이 실제로 밀렸는지 먼저 확인한다(안 밀렸으면 이 단언은 공회전이다).
    const moved = Math.abs(scroll.scrollX - winBefore.x) + Math.abs(scroll.scrollY - winBefore.y);
    expect(moved).toBeGreaterThan(0);

    // 오브젝트가 창 뒤로 흘러 사라지지 않았고(고정), 지금도 걸어가면 닿는다.
    const obj = encounterObject(world, rt);
    expect(obj).toBeDefined();
    const r = approach(world, rt, pilot);
    expect(r.reached, `창 전진 후 최근접 ${Math.round(r.closest)} (${r.ticks}틱)`).toBe(true);
  });
});
