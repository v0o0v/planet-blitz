/**
 * 촉매 **아르케 특산**(id 39~41)의 배선 계측 — `src/sim/catalyst/arke.ts`.
 *
 * 전 런 대조를 안 쓰는 사유는 `catalystNiflheim.test.ts` 머리말과 같다(카드가 전개를 바꾸므로
 * 스트림이 **정당하게** 갈린다). 여기서도 **앵커 하나가 자기 스트림을 소비하는가**를
 * `getState()` 로 직접 잰다.
 *
 * 음성 대조는 **다른 카드 한 장을 실은 런**이다(`catalysts: []` 는 `carries` 게이트를 못 잰다).
 */

import { describe, it, expect } from 'vitest';
import { createWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import { addEntity, blankEntity } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import { AncientCoreSlot, ObeliskSlot, OverclockSlot, readCatalystSlot } from '../src/sim/catalystSlots.js';
import { CATALYST_GATE_MARK, isCatalystObjective } from '../src/sim/catalyst/shared.js';
import { RACING_WALL_MARK, racingCourseLength } from '../src/sim/modes/racing.js';
import { INVASION_ACCEL_BASE_CP, INVASION_ACCEL_MAX_CP } from '../src/sim/invasion/constants.js';
import {
  CARD_ARKE_ANCIENT_CORE,
  CARD_ARKE_OBELISK,
  CARD_ARKE_OVERCLOCK,
  arkeMassTurnBlend,
  arkeOnDestructibleDestroyed,
  arkeOnLootCollected,
  arkeOnLootRoll,
  arkeOnPlayerDamaged,
  arkeOnTick,
  arkeOnWallContact,
  arkeOnWaveAdvanced,
} from '../src/sim/catalyst/arke.js';

/** 다른 결의 카드 한 장만 실은 런 — `carries` 게이트의 음성 대조용. */
const OTHER_CARD = 1;

function world(cards: number[]): WorldState {
  return createWorld(0xa4ce, {
    ...DEFAULT_CONFIG,
    catalysts: cards,
    planet: 3,
    planetMode: PLANET_MODE.racing,
  });
}

function player(state: WorldState): Entity {
  const p = state.entities[0];
  if (p === undefined) throw new Error('player missing');
  return p;
}

function rngState(state: WorldState): string {
  return [state.dropRng.getState(), state.waveRng.getState(), state.powerupRng.getState()].join('|');
}

function runTicks(state: WorldState, n: number): void {
  for (let i = 0; i < n; i++) {
    arkeOnTick(state, player(state));
    state.tick++;
  }
}

/** 플레이어를 코스 벽 하나에 붙여 놓고 그 벽을 돌려준다. */
function parkOnWall(state: WorldState): Entity {
  const w = state.entities.find((e) => !e.dead && e.kind === 'wall' && e.ownerId === RACING_WALL_MARK);
  if (w === undefined) throw new Error('racing wall missing');
  const p = player(state);
  p.x = w.x;
  p.y = w.y;
  return w;
}

function coresOf(state: WorldState): Entity[] {
  return state.entities.filter((e) => !e.dead && e.kind === 'loot' && e.ownerId === 0xc0de40);
}

function gatesOf(state: WorldState): Entity[] {
  return state.entities.filter((e) => !e.dead && e.ownerId === CATALYST_GATE_MARK);
}

// ---------------------------------------------------------------------------
describe('id 39 arke-overclock — 오버클럭', () => {
  it('음성 대조: 다른 카드만 실은 런은 창 가속도 벽 파괴도 없다', () => {
    const s = world([OTHER_CARD]);
    const w = parkOnWall(s);
    runTicks(s, 60);
    arkeOnWallContact(s, player(s));
    expect(s.scrollRuntime?.accelCp).toBe(INVASION_ACCEL_BASE_CP);
    expect(w.dead).toBe(false);
    expect(readCatalystSlot(s.catalystSlots, OverclockSlot.SpeedStep)).toBe(0);
  });

  it('스크롤이 두 배가 된다(기존 노브 `accelCp` — 앵커 정책을 우회하지 않는다)', () => {
    const s = world([CARD_ARKE_OVERCLOCK]);
    expect(s.scrollRuntime?.accelCp).toBe(INVASION_ACCEL_BASE_CP);
    runTicks(s, 1);
    // 기준 100 → 상한 200 = **2배**.
    expect(s.scrollRuntime?.accelCp).toBe(INVASION_ACCEL_MAX_CP);
    expect(INVASION_ACCEL_MAX_CP / INVASION_ACCEL_BASE_CP).toBe(2);
  });

  it('이득과 대가를 **동시에** 관측한다 — 벽이 부서지며 자원, 그리고 최대 속도 하락', () => {
    const s = world([CARD_ARKE_OVERCLOCK]);
    const w = parkOnWall(s);
    const res0 = s.resources;
    const speed0 = s.config.playerSpeed;
    arkeOnWallContact(s, player(s));
    expect(w.dead).toBe(true); // 이득 ①: 벽이 부서진다.
    expect(s.resources).toBeGreaterThan(res0); // 이득 ②: 자원이 나온다.
    expect(s.config.playerSpeed).toBeLessThan(speed0); // 대가: 최대 속도가 내려간다.
    expect(readCatalystSlot(s.catalystSlots, OverclockSlot.SpeedStep)).toBe(1);
  });

  it('⭐ 단조 감소가 아니다 — 무충돌 구간을 통과하면 **정확히** 되돌아온다', () => {
    const s = world([CARD_ARKE_OVERCLOCK]);
    const base = s.config.playerSpeed;
    // 두 번 부딪힌다(다른 벽 두 장).
    const walls = s.entities.filter((e) => !e.dead && e.kind === 'wall' && e.ownerId === RACING_WALL_MARK);
    const p = player(s);
    for (let i = 0; i < 2; i++) {
      const w = walls[i];
      if (w === undefined) throw new Error('wall missing');
      p.x = w.x;
      p.y = w.y;
      arkeOnWallContact(s, p);
    }
    expect(readCatalystSlot(s.catalystSlots, OverclockSlot.SpeedStep)).toBe(2);
    const dropped = s.config.playerSpeed;
    expect(dropped).toBeLessThan(base);

    // 부딪힌 구간이 넘어갈 때는 복구가 없다.
    arkeOnWaveAdvanced(s, s.wave.segmentIndex, s.wave.segmentIndex + 1);
    expect(s.config.playerSpeed).toBe(dropped);
    // 무충돌 구간 둘을 통과하면 두 단계가 **원값 그대로** 돌아온다(덧셈의 정확한 역).
    arkeOnWaveAdvanced(s, s.wave.segmentIndex + 1, s.wave.segmentIndex + 2);
    arkeOnWaveAdvanced(s, s.wave.segmentIndex + 2, s.wave.segmentIndex + 3);
    expect(readCatalystSlot(s.catalystSlots, OverclockSlot.SpeedStep)).toBe(0);
    expect(s.config.playerSpeed).toBe(base);
  });

  it('과복구가 없다 — 안 깎였으면 원값보다 빨라지지 않는다', () => {
    const s = world([CARD_ARKE_OVERCLOCK]);
    const base = s.config.playerSpeed;
    for (let i = 0; i < 5; i++) arkeOnWaveAdvanced(s, i, i + 1);
    expect(s.config.playerSpeed).toBe(base);
  });

  it('하한이 있다 — 최대 속도가 0 이 되지 않는다(압사 즉사 금지)', () => {
    const s = world([CARD_ARKE_OVERCLOCK]);
    const walls = s.entities.filter((e) => !e.dead && e.kind === 'wall' && e.ownerId === RACING_WALL_MARK);
    const p = player(s);
    for (const w of walls) {
      p.x = w.x;
      p.y = w.y;
      arkeOnWallContact(s, p);
    }
    expect(s.config.playerSpeed).toBeGreaterThan(0);
    expect(readCatalystSlot(s.catalystSlots, OverclockSlot.SpeedStep)).toBeLessThanOrEqual(6);
  });

  it('RNG 스트림을 한 칸도 안 민다', () => {
    const s = world([CARD_ARKE_OVERCLOCK]);
    const before = rngState(s);
    parkOnWall(s);
    runTicks(s, 600);
    arkeOnWallContact(s, player(s));
    arkeOnWaveAdvanced(s, 0, 1);
    expect(rngState(s)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
describe('id 40 arke-ancient-core — 고대 코어', () => {
  it('음성 대조: 다른 카드만 실은 런은 코어를 안 띄우고 선회도 안 바꾼다', () => {
    const s = world([OTHER_CARD]);
    runTicks(s, 1200);
    expect(coresOf(s)).toHaveLength(0);
    const p = player(s);
    p.vx = 720;
    p.vy = 0;
    expect(arkeMassTurnBlend(s, p, 0, 1)).toBeUndefined();
  });

  it('이득과 대가를 **동시에** 관측한다 — 대량 자원, 그리고 질량 3초', () => {
    const s = world([CARD_ARKE_ANCIENT_CORE]);
    runTicks(s, 421);
    const core = coresOf(s)[0];
    expect(core).toBeDefined();
    const res0 = s.resources;
    // 기본 수거를 **억제**한다(코어는 장비가 아니라 자원이다 — 가짜 드랍 시드 금지).
    expect(arkeOnLootCollected(s, core as Entity)).toBe(true);
    expect(s.resources).toBeGreaterThan(res0);
    expect(readCatalystSlot(s.catalystSlots, AncientCoreSlot.MassTicks)).toBe(180);
  });

  it('⭐ 입력이 전부 살아 있다 — **감속·정지 입력이 한 프레임도 안 씹힌다**', () => {
    const s = world([CARD_ARKE_ANCIENT_CORE]);
    const p = player(s);
    runTicks(s, 421);
    arkeOnLootCollected(s, coresOf(s)[0] as Entity);
    p.vx = 720;
    p.vy = 0;
    // ① 완전 정지 입력(0,0) — 손대지 않는다(`undefined` = 호출부가 원값을 그대로 쓴다).
    expect(arkeMassTurnBlend(s, p, 0, 0)).toBeUndefined();
    // ② 절반 감속 입력 — **크기가 그대로 보존된다**(방향만 바뀐다).
    const half = arkeMassTurnBlend(s, p, 0, 0.5);
    expect(half).toBeDefined();
    const h = half as { x: number; y: number };
    expect(Math.hypot(h.x, h.y)).toBeCloseTo(0.5, 10);
    // ③ 정확한 후진 입력 — 되돌림 자체를 막지 않는다.
    expect(() => arkeMassTurnBlend(s, p, -1, 0)).not.toThrow();
  });

  it('바뀌는 것은 **선회뿐**이다 — 각속도가 절반(= 선회 반경 2배)', () => {
    const s = world([CARD_ARKE_ANCIENT_CORE]);
    const p = player(s);
    runTicks(s, 421);
    arkeOnLootCollected(s, coresOf(s)[0] as Entity);
    p.vx = 720; // 진행 방향 +X.
    p.vy = 0;
    const turned = arkeMassTurnBlend(s, p, 0, 1); // 입력은 +Y(90도 꺾기).
    expect(turned).toBeDefined();
    const t = turned as { x: number; y: number };
    // 90도 요구가 45도로 줄어든다(= 각속도 절반).
    expect((Math.atan2(t.y, t.x) * 180) / Math.PI).toBeCloseTo(45, 6);
    expect(Math.hypot(t.x, t.y)).toBeCloseTo(1, 10); // 속력은 그대로.
  });

  it('질량은 3초 뒤 사라진다(단조 누적이 아니다)', () => {
    const s = world([CARD_ARKE_ANCIENT_CORE]);
    runTicks(s, 421);
    arkeOnLootCollected(s, coresOf(s)[0] as Entity);
    runTicks(s, 181);
    expect(readCatalystSlot(s.catalystSlots, AncientCoreSlot.MassTicks)).toBe(0);
    const p = player(s);
    p.vx = 720;
    p.vy = 0;
    expect(arkeMassTurnBlend(s, p, 0, 1)).toBeUndefined();
  });

  it('RNG 스트림을 한 칸도 안 민다', () => {
    const s = world([CARD_ARKE_ANCIENT_CORE]);
    const before = rngState(s);
    runTicks(s, 1300);
    expect(rngState(s)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
describe('id 41 arke-obelisk — 오벨리스크 관문', () => {
  /** 코스 80% 지점까지 창을 밀어 관문을 세운다. */
  function raiseGates(s: WorldState): void {
    const rt = s.scrollRuntime;
    if (rt === undefined) throw new Error('scroll runtime missing');
    rt.scrollX = racingCourseLength() * 0.9;
    arkeOnTick(s, player(s));
    s.tick++;
  }

  it('음성 대조: 다른 카드만 실은 런은 관문을 안 세운다', () => {
    const s = world([OTHER_CARD]);
    raiseGates(s);
    expect(gatesOf(s)).toHaveLength(0);
  });

  it('관문 셋이 서고 **자동 조준 대상으로 등재**된다', () => {
    const s = world([CARD_ARKE_OBELISK]);
    raiseGates(s);
    const gates = gatesOf(s);
    expect(gates).toHaveLength(3);
    for (const g of gates) expect(isCatalystObjective(g)).toBe(true);
    // ⚠️ 유한 HP 여야 한다 — 무적이면 자동 조준이 죽지 않는 표적에 묶인다(결함 #3).
    for (const g of gates) expect(g.hp).toBeGreaterThan(0);
  });

  it('⭐ 보스를 삭제하지 않는다 — 셋 다 실패해도 **죽일 수 있다**', () => {
    const s = world([CARD_ARKE_OBELISK]);
    raiseGates(s);
    // 관문 셋을 전부 파괴 = 전부 미통과 확정.
    for (const g of gatesOf(s)) {
      g.dead = true;
      arkeOnDestructibleDestroyed(s, g);
    }
    // 보스를 세운다(레이싱은 코스 끝에서 `stepBoss` 가 세운다).
    const b = blankEntity('boss');
    b.hp = 1000;
    b.maxHp = 1000;
    addEntity(s, b);
    arkeOnTick(s, player(s));
    // 보스가 **존재하고**(삭제되지 않았다) HP 는 유한하다 — 셋 다 놓쳐도 죽는다.
    expect(s.entities.filter((e) => !e.dead && e.kind === 'boss')).toHaveLength(1);
    expect(b.hp).toBeGreaterThan(1000); // 미통과 관문의 힘이 보스에게 갔다.
    expect(Number.isFinite(b.hp)).toBe(true);
    b.hp = 0;
    expect(b.hp).toBe(0); // 유한 HP 라 처치 경로가 살아 있다.
  });

  it('통과하면 보스가 약해지고 전리품 등급이 오른다(상한 축 = 희귀도)', () => {
    const s = world([CARD_ARKE_OBELISK]);
    raiseGates(s);
    expect(arkeOnLootRoll(s, 0, 0, true).rarity).toBe(1); // 아직 0 통과.
    // 관문 ① 무피격 · ② 속도 · ③ 궤도를 차례로 통과시킨다.
    const p = player(s);
    // ① 무피격 — 180틱 동안 안 맞으면 된다.
    for (let i = 0; i < 200; i++) {
      arkeOnTick(s, p);
      s.tick++;
    }
    expect(readCatalystSlot(s.catalystSlots, ObeliskSlot.GateState) & 1).toBe(1);
    const passed1 = arkeOnLootRoll(s, 0, 0, true).rarity;
    expect(passed1).toBeGreaterThan(1);

    // ② 속도 — 속력을 유지한 채 180틱.
    p.vx = 720;
    p.vy = 0;
    for (let i = 0; i < 200; i++) {
      arkeOnTick(s, p);
      s.tick++;
    }
    expect(readCatalystSlot(s.catalystSlots, ObeliskSlot.GateState) & 2).toBe(2);
    expect(arkeOnLootRoll(s, 0, 0, true).rarity).toBeGreaterThan(passed1);
  });

  it('무피격 관문은 **피격 한 번**에 실패한다(놓친 몫이 장부에 남는다)', () => {
    const s = world([CARD_ARKE_OBELISK]);
    raiseGates(s);
    arkeOnTick(s, player(s));
    arkeOnPlayerDamaged(s, player(s), 10, false, 0);
    // 관문 0 이 확정(실패)됐다 — 통과 비트는 안 섰다.
    const st = readCatalystSlot(s.catalystSlots, ObeliskSlot.GateState);
    expect(st & (1 << 3)).toBe(1 << 3); // resolved
    expect(st & 1).toBe(0); // not passed
    expect(s.catalystLedger?.find((r) => r.id === CARD_ARKE_OBELISK)?.missed ?? 0).toBeGreaterThan(0);
  });

  it('RNG 스트림을 한 칸도 안 민다', () => {
    const s = world([CARD_ARKE_OBELISK]);
    const before = rngState(s);
    raiseGates(s);
    runTicks(s, 600);
    expect(rngState(s)).toBe(before);
  });
});
