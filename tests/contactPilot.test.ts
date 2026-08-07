/**
 * **접촉 조향 파일럿**(`bench/contactPilot.ts`) — 계약 전수.
 *
 * ## 이 파일이 잠그는 것
 * | # | 계약 | 절 |
 * |---|---|---|
 * | 1 | `id 1` 이 없는 런은 프레임이 `measurePilotInput` 과 **비트 동일** | ① |
 * | 2 | 표적 선택: 잡몹은 **표식**, 보스는 **kind** (보스 `aux0` 오독 없음) | ② |
 * | 3 | 표식이 선 적에게 **실제로 접촉한다**(0회가 아니다) | ③ |
 * | 4 | 같은 시드 두 번 → 같은 프레임 열(RNG 미소비) | ④ |
 * | 5 | HP 하한 아래에서는 접촉 조향이 꺼진다(자살 방지) | ⑤ |
 *
 * ① 이 이 레인의 실질이다 — 이 파일은 **다른 모든 계측을 오염시키지 않는다**는 것이 존재 조건이고,
 * "게이트를 바깥에 뒀다"는 주장이 아니라 프레임 대조가 증거다.
 *
 * ⚠️ ③·④ 의 rig 는 `plunder` 표식을 **테스트가 직접 세운다**. 표식을 세우는 sim 배선은 다른
 * 레인이 지금 만들고 있으므로, 거기에 의존하면 두 레인이 엮여 어느 쪽 결함인지 못 가린다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import type { Entity, EntityKind } from '../src/sim/entities.js';
import { blankEntity } from '../src/sim/entities.js';
import { measurePilotInput, beginMeasureRun } from '../src/sim/measurePilot.js';
import { writeMark } from '../src/sim/catalystMarks.js';
import { contactPilotInput, CONTACT_HP_FLOOR, PLUNDER_CATALYST_ID } from '../bench/contactPilot.js';

function playerOf(s: WorldState): Entity {
  const p = s.entities[0];
  if (p === undefined) throw new Error('player entity missing');
  return p;
}

/** `id 1` 이 실린 런 설정. */
function plunderConfig(): WorldConfig {
  return { ...DEFAULT_CONFIG, catalysts: [PLUNDER_CATALYST_ID] };
}

// ---------------------------------------------------------------------------
// ① 게이트 바깥 — `id 1` 이 없으면 측정 파일럿과 프레임이 비트 동일하다
// ---------------------------------------------------------------------------

describe('① `id 1` 미주입 런은 종전과 비트 동일하다', () => {
  /**
   * 같은 월드에 두 파일럿을 **같은 틱에** 물어 프레임을 비교한다. 월드를 둘 만들어 각각 돌리면
   * 상태가 갈릴 여지가 남지만, 여기서는 관측 대상이 하나뿐이라 갈릴 곳이 없다.
   */
  function assertIdenticalFrames(seed: number, cfg: WorldConfig, ticks: number): number {
    const state = createWorld(seed, cfg);
    beginMeasureRun(state);
    let compared = 0;
    for (let i = 0; i < ticks; i++) {
      const m = measurePilotInput(state);
      const c = contactPilotInput(state);
      expect(c).toEqual(m);
      compared++;
      stepWorld(state, m);
      if (state.victory || state.gameOver) break;
    }
    return compared;
  }

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
});

// ---------------------------------------------------------------------------
// ② 표적 선택 — 잡몹은 표식, 보스는 kind
// ---------------------------------------------------------------------------

/**
 * 표적 후보가 **하나도 없는** 상태의 월드를 만든다: `id 1` 을 실은 채 몇 틱 굴린 뒤,
 * (a) 보스가 아직 없고 (b) 표식은 세우는 코드가 없으니 전 비트 0 임을 확인한다.
 * 그 위에 후보를 직접 심어 조향 방향만 읽는다(월드를 더 굴리지 않으므로 주입이 sim 을 깨지 않는다).
 */
function riggedWorld(seed: number): WorldState {
  const state = createWorld(seed, plunderConfig());
  beginMeasureRun(state);
  for (let i = 0; i < 30; i++) stepWorld(state, measurePilotInput(state));
  expect(state.pendingLevelUp).toBeFalsy();
  expect(
    state.entities.some((e) => !e.dead && (e.kind === 'boss' || e.kind === 'defenseBoss')),
  ).toBe(false);
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
  it('표식 없는 잡몹은 표적이 아니다 (조향이 정본 그대로)', () => {
    const state = riggedWorld(21);
    inject(state, 'enemy', 500, 0, 0);
    expect(contactPilotInput(state)).toEqual(measurePilotInput(state));
  });

  it('`plunder` 표식이 선 잡몹으로 직진한다', () => {
    const state = riggedWorld(21);
    const e = inject(state, 'enemy', 500, 0, 0);
    writeMark(e, 'plunder', 1);
    expectMoveToward(contactPilotInput(state), 1, 0);
  });

  it('보스는 표식이 **없어도** 표적이다 (kind 로 잡는다)', () => {
    const state = riggedWorld(22);
    // aux0 = 0 이므로 `readMark(e,'plunder')` 는 0 이다 — 그래도 표적이어야 kind 판정이다.
    inject(state, 'boss', 0, 600, 0);
    expectMoveToward(contactPilotInput(state), 0, 1);
  });

  it('보스 `aux0` 비트 0(추격 취약화)을 표식으로 오독하지 않는다', () => {
    // 보스는 멀고(1200) 표식 잡몹은 가깝다(300). 보스의 aux0 비트 0 이 서 있지만 그것은
    // 추격 모드 플래그다 — 거리 규칙만 적용되면 가까운 잡몹이 뽑힌다.
    const state = riggedWorld(23);
    inject(state, 'boss', 1200, 0, 1);
    const near = inject(state, 'enemy', 0, -300, 0);
    writeMark(near, 'plunder', 1);
    expectMoveToward(contactPilotInput(state), 0, -1);

    // 반대 배치에서는 보스가 뽑힌다 — 거리만 갈렸는데 결과가 뒤집히므로 규칙이 거리다.
    const state2 = riggedWorld(23);
    inject(state2, 'boss', 300, 0, 1);
    const far = inject(state2, 'enemy', 0, -1200, 0);
    writeMark(far, 'plunder', 1);
    expectMoveToward(contactPilotInput(state2), 1, 0);
  });

  it('조준·대시·액티브 비트는 측정 파일럿 정본 그대로다 (이동 성분만 교체)', () => {
    const state = riggedWorld(24);
    const e = inject(state, 'enemy', 500, 0, 0);
    writeMark(e, 'plunder', 1);
    const base = measurePilotInput(state);
    const c = contactPilotInput(state);
    expect(c.aim).toBe(base.aim);
    expect(c.dash).toBe(base.dash);
    expect(c.special).toBe(base.special);
  });
});

// ---------------------------------------------------------------------------
// ③ 접촉이 실제로 일어난다 · ④ 결정론
// ---------------------------------------------------------------------------

/**
 * `id 1` 런을 굴리면서 **매 틱 최근접 잡몹에 `plunder` 표식을 세우고**, 접촉 틱 수와 프레임 열을
 * 함께 모은다.
 *
 * ⚠️ 표식을 매 틱 다시 세우는 이유: 표적이 죽으면 다음 표적으로 넘어가야 하고, 세우는 sim 배선이
 * 아직 없기 때문이다(헤더 참조). 최근접 선택은 동률을 id 로 깨므로 결정론이다 — ④ 가 그것을 잰다.
 */
function runContactRig(seed: number, ticks: number): { contacts: number; frames: InputFrame[] } {
  const state = createWorld(seed, plunderConfig());
  beginMeasureRun(state);
  const frames: InputFrame[] = [];
  let contacts = 0;
  for (let i = 0; i < ticks; i++) {
    const p = playerOf(state);
    let mark: Entity | undefined;
    let bestD = Infinity;
    for (const e of state.entities) {
      if (e.dead || e.kind !== 'enemy') continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d = dx * dx + dy * dy;
      if (d < bestD || (d === bestD && mark !== undefined && e.id < mark.id)) {
        bestD = d;
        mark = e;
      }
    }
    if (mark !== undefined) {
      writeMark(mark, 'plunder', 1);
      const rr = p.radius + mark.radius;
      if (bestD <= rr * rr) contacts++;
    }
    const f = contactPilotInput(state);
    frames.push(f);
    stepWorld(state, f);
    if (state.victory || state.gameOver) break;
  }
  return { contacts, frames };
}

describe('③ 접촉이 원리적으로 0회가 아니다', () => {
  it('표식이 선 적에게 실제로 몸이 닿는다', () => {
    // 실측(2026-08-08, 900틱): 접촉 55회 vs 카이팅 0회(아래 대조군).
    const r = runContactRig(31337, 900);
    // 공허 방어 — 프레임이 안 나왔으면 접촉 0 이 당연하다.
    expect(r.frames.length).toBeGreaterThan(200);
    expect(r.contacts).toBeGreaterThan(0);
  });

  it('같은 rig 를 카이팅 정본(`measurePilotInput`)으로 돌리면 대조군이 된다', () => {
    // 대조 없는 "접촉했다"는 증거가 아니다 — 접촉 조향을 끄면(= 촉매 미주입) 같은 시드에서
    // 접촉이 훨씬 적어야 한다. 카이팅은 `KITE_DISTANCE` 를 유지하므로 구조적으로 붙지 않는다.
    const withContact = runContactRig(31337, 900).contacts;
    const state = createWorld(31337, { ...DEFAULT_CONFIG });
    beginMeasureRun(state);
    let kiteContacts = 0;
    for (let i = 0; i < 900; i++) {
      const p = playerOf(state);
      for (const e of state.entities) {
        if (e.dead || e.kind !== 'enemy') continue;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const rr = p.radius + e.radius;
        if (dx * dx + dy * dy <= rr * rr) {
          kiteContacts++;
          break;
        }
      }
      stepWorld(state, measurePilotInput(state));
      if (state.victory || state.gameOver) break;
    }
    expect(withContact).toBeGreaterThan(kiteContacts);
  });
});

describe('④ 결정론 — 같은 시드 두 번이면 같은 경로', () => {
  it('프레임 열이 완전히 같다 (RNG 미소비)', () => {
    const a = runContactRig(31337, 600);
    const b = runContactRig(31337, 600);
    expect(a.frames).toEqual(b.frames);
    expect(a.contacts).toBe(b.contacts);
  });

  it('같은 월드에 두 번 물으면 같은 프레임이다', () => {
    const state = riggedWorld(99);
    const e = inject(state, 'enemy', 400, 300, 0);
    writeMark(e, 'plunder', 1);
    expect(contactPilotInput(state)).toEqual(contactPilotInput(state));
  });
});

// ---------------------------------------------------------------------------
// ⑤ 이탈 규율
// ---------------------------------------------------------------------------

describe('⑤ HP 하한 아래에서는 접촉 조향이 꺼진다', () => {
  it('HP 가 하한 이하면 카이팅 정본으로 돌아간다', () => {
    const state = riggedWorld(55);
    const e = inject(state, 'enemy', 500, 0, 0);
    writeMark(e, 'plunder', 1);
    const p = playerOf(state);

    p.hp = p.maxHp * CONTACT_HP_FLOOR; // 경계값(이하)은 꺼진다
    expect(contactPilotInput(state)).toEqual(measurePilotInput(state));

    p.hp = p.maxHp * CONTACT_HP_FLOOR + 1; // 경계 바로 위는 켜진다
    expectMoveToward(contactPilotInput(state), 1, 0);
  });
});
