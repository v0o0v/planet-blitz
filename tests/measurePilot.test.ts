/**
 * **측정 전용 파일럿 프로파일** (ADR-0049 §0-A 결정 B) — 계약 전수.
 *
 * ## 이 파일이 잠그는 것
 * | # | 계약 | 절 |
 * |---|---|---|
 * | 1 | 조향은 오토파일럿 정본을 공유한다(복제 금지) | ① |
 * | 2 | 프로파일은 해시에 스탬프되지 않는다 — 같은 입력 로그면 같은 해시 | ② |
 * | 3 | 발동은 결정론이고 프리즈 중에는 비트를 안 싣는다 | ③ |
 * | 4 | **벽 접촉 플래그가 실제로 선다** | ④ |
 * | 5 | **액티브가 실제로 발동한다**(눌렀다가 아니라 터졌다) | ⑤ |
 * | 6 | 측정 런은 오염 런으로 표시된다 | ⑥ |
 *
 * ④·⑤ 가 이 레인의 실질이다. "벽 쪽으로 가게 했다"·"비트를 실었다"는 증거가 아니다 —
 * `state.wallContactTicks` 가 서고 `state.activeCd*`/`activeBuff*` 가 움직여야 증거다.
 * 앞 레인들이 계측기 구멍을 세 번 냈고, 셋 다 "관측 대상이 아니라 관측 행위"를 재고 있었다.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  emptyInput,
  packPowerupPick,
  DEFAULT_CONFIG,
  SPECIAL_NONE,
} from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { hashWorld, stepThrough } from '../src/sim/replay.js';
import { spawnWall } from '../src/sim/entities.js';
import { autopilotInput, pilotSteer, pilotFreezeFrame } from '../src/sim/autopilot.js';
import { measurePilotInput, beginMeasureRun } from '../src/sim/measurePilot.js';
import { SPECIAL_ACTIVE_SLOT1, SPECIAL_ACTIVE_SLOT2 } from '../data/inputBits.js';
import { ACTIVES_BY_SHIP, wireIdOf } from '../data/ships/actives/index.js';
import type { ActiveSkillDef } from '../data/ships/actives/index.js';
import { SHIP_TYPES, zeroSkillInvest, shipTreeRange } from '../data/ships/index.js';

const ACTIVE_BITS = SPECIAL_ACTIVE_SLOT1 | SPECIAL_ACTIVE_SLOT2;

function playerOf(s: WorldState): Entity {
  const p = s.entities[0];
  if (p === undefined) throw new Error('player entity missing');
  return p;
}

/**
 * 이 월드의 활성 벽을 전부 죽인다 — **"벽 없는 무대"를 만드는 유일한 방법**이다.
 * 뱀서류는 절차 청크가 매 틱 벽 20개를 유지하므로(실측), 죽이지 않으면 벽 없는 틱이 없다.
 * 죽인 자리는 청크 마커가 남아 재생성되지 않는다.
 */
function killWalls(s: WorldState): WorldState {
  for (const e of s.entities) if (e.kind === 'wall') e.dead = true;
  return s;
}

// ---------------------------------------------------------------------------
// ① 조향 공유 — 벽 없는 무대에서 두 파일럿의 이동·조준이 **비트 동일**하다
// ---------------------------------------------------------------------------

describe('① 조향 정본 공유 (복제 금지)', () => {
  it('벽이 없으면 측정 파일럿의 이동·조준이 오토파일럿과 바이트 동일하다', () => {
    // ⚠️ 뱀서류 무대는 절차 청크가 매 틱 활성 벽 20개를 유지한다(실측). 그래서 "벽 없는
    // 무대"를 만들려면 벽을 **죽여야** 한다 — 죽인 자리는 청크 마커가 남아 재생성되지 않는다
    // (`tests/wallContactFlag.test.ts` rig 와 같은 관용구). 이 단계를 빼면 아래 비교가
    // 한 틱도 안 돌아 조용히 초록이 된다.
    const state = killWalls(createWorld(1234, { ...DEFAULT_CONFIG }));
    let compared = 0;
    for (let i = 0; i < 400; i++) {
      if (state.activeWalls.length === 0 && !state.pendingLevelUp) {
        const a = autopilotInput(state);
        const m = measurePilotInput(state);
        expect(m.moveX).toBe(a.moveX);
        expect(m.moveY).toBe(a.moveY);
        expect(m.aim).toBe(a.aim);
        compared++;
      }
      killWalls(state);
      stepWorld(state, autopilotInput(state));
      if (state.victory || state.gameOver) break;
    }
    // 공허 방어 — 비교할 틱이 없었으면 이 단언 전체가 아무것도 안 잰 초록이다.
    expect(compared).toBeGreaterThan(200);
  });

  it('측정 파일럿은 월드를 변형하지 않는다 (순수 입력 생성기)', () => {
    const state = createWorld(77, { ...DEFAULT_CONFIG });
    for (let i = 0; i < 60; i++) stepWorld(state, emptyInput());
    const before = hashWorld(state);
    const tainted = state.tainted;
    for (let i = 0; i < 10; i++) measurePilotInput(state);
    expect(hashWorld(state)).toBe(before);
    // `beginMeasureRun` 을 부르지 않았으므로 오염 표시도 서지 않아야 한다(⑥ 과 짝).
    expect(state.tainted).toBe(tainted);
  });

  it('같은 월드에 두 번 물으면 같은 프레임이다 (결정론 — 시계·난수 없음)', () => {
    const state = createWorld(9, { ...DEFAULT_CONFIG });
    for (let i = 0; i < 120; i++) stepWorld(state, measurePilotInput(state));
    expect(measurePilotInput(state)).toEqual(measurePilotInput(state));
  });
});

// ---------------------------------------------------------------------------
// ② 프로파일은 해시에 스탬프되지 않는다 — 검증 경로 불변
// ---------------------------------------------------------------------------

describe('② 같은 시드 + 같은 입력 로그 = 같은 해시 (프로파일 무스탬프)', () => {
  it('측정 파일럿이 만든 프레임 열을 그대로 재생하면 틱별 해시가 전부 같다', () => {
    const cfg: WorldConfig = { ...DEFAULT_CONFIG };
    const live = createWorld(555, cfg);
    const log: InputFrame[] = [];
    const liveHashes: number[] = [];
    for (let i = 0; i < 600; i++) {
      const f = measurePilotInput(live);
      log.push(f);
      stepWorld(live, f);
      liveHashes.push(hashWorld(live));
      if (live.victory || live.gameOver) break;
    }
    expect(log.length).toBeGreaterThan(300);

    // 재생 쪽은 파일럿을 **한 번도 부르지 않는다** — 프로파일 선택이 config·해시에 남았다면
    // 여기서 갈린다.
    const replayed = createWorld(555, cfg);
    expect(stepThrough(replayed, log)).toEqual(liveHashes);
  });

  it('두 프로파일이 같은 로그를 받으면 결과 월드가 같다 (파일럿은 config 가 아니다)', () => {
    const cfg: WorldConfig = { ...DEFAULT_CONFIG };
    // 오토파일럿이 만든 로그를 측정 프로파일 쪽 월드에 그대로 먹인다. 프로파일이 sim 에
    // 심겨 있었다면 같은 로그인데도 결과가 갈릴 것이다.
    const a = createWorld(4242, cfg);
    const log: InputFrame[] = [];
    for (let i = 0; i < 300; i++) {
      const f = autopilotInput(a);
      log.push(f);
      stepWorld(a, f);
    }
    const b = createWorld(4242, cfg);
    beginMeasureRun(b);
    stepThrough(b, log);
    // `tainted` 는 hashWorld 가 접지 않는다(ADR-0008) — 오염 표시가 해시를 흔들지 않는다는
    // 것까지 여기서 함께 못 박는다.
    expect(hashWorld(b)).toBe(hashWorld(a));
  });
});

// ---------------------------------------------------------------------------
// ③ 발동 정책 — 결정론 · 프리즈 규율 · 비트 충돌
// ---------------------------------------------------------------------------

describe('③ 발동 정책', () => {
  it('레벨업 프리즈 틱에는 파워업 픽만 낸다 (발동 비트 없음)', () => {
    const state = createWorld(11, { ...DEFAULT_CONFIG });
    for (let i = 0; i < 30; i++) stepWorld(state, emptyInput());
    state.pendingLevelUp = true;
    const f = measurePilotInput(state);
    expect(f).toEqual(pilotFreezeFrame());
    expect(f.special & ACTIVE_BITS).toBe(0);
    expect(f.dash).toBe(false);
    // 프리즈 조향은 정본이 판정한다(측정 파일럿이 따로 적지 않는다).
    expect(pilotSteer(state).freeze).toBe(true);
  });

  it('파워업 픽 비트와 액티브 슬롯 비트는 겹치지 않는다 (`data/inputBits.ts` 배치 확인)', () => {
    for (let i = 0; i < 4; i++) {
      expect(packPowerupPick(i) & ACTIVE_BITS).toBe(0);
    }
    expect(SPECIAL_ACTIVE_SLOT1).toBe(1 << 9);
    expect(SPECIAL_ACTIVE_SLOT2).toBe(1 << 10);
    expect(SPECIAL_ACTIVE_SLOT1 & SPECIAL_ACTIVE_SLOT2).toBe(0);
  });

  it('쿨다운이 돌고 있으면 그 슬롯 비트를 싣지 않는다', () => {
    const state = createWorld(21, { ...DEFAULT_CONFIG });
    for (let i = 0; i < 30; i++) stepWorld(state, emptyInput());
    // 미장착 런은 쿨다운이 끝까지 0 이라 항상 누른다.
    expect(measurePilotInput(state).special & SPECIAL_ACTIVE_SLOT1).toBe(SPECIAL_ACTIVE_SLOT1);
    expect(measurePilotInput(state).special & SPECIAL_ACTIVE_SLOT2).toBe(SPECIAL_ACTIVE_SLOT2);
    state.activeCd0 = 5;
    expect(measurePilotInput(state).special & SPECIAL_ACTIVE_SLOT1).toBe(0);
    expect(measurePilotInput(state).special & SPECIAL_ACTIVE_SLOT2).toBe(SPECIAL_ACTIVE_SLOT2);
    state.activeCd1 = 1;
    expect(measurePilotInput(state).special & ACTIVE_BITS).toBe(0);
  });

  it('대시는 쿨다운이 0 일 때만 누른다', () => {
    const state = createWorld(31, { ...DEFAULT_CONFIG });
    for (let i = 0; i < 30; i++) stepWorld(state, emptyInput());
    const player = playerOf(state);
    player.dashCooldown = 0;
    expect(measurePilotInput(state).dash).toBe(true);
    player.dashCooldown = 1;
    expect(measurePilotInput(state).dash).toBe(false);
  });

  it('오토파일럿은 여전히 아무것도 누르지 않는다 (동결 대조군)', () => {
    const state = createWorld(31, { ...DEFAULT_CONFIG });
    for (let i = 0; i < 200; i++) {
      const f = autopilotInput(state);
      expect(f.dash).toBe(false);
      expect(f.special & ACTIVE_BITS).toBe(0);
      stepWorld(state, f);
    }
  });
});

// ---------------------------------------------------------------------------
// ④ 벽 접촉 플래그가 **실제로 선다** — E5 소비 실증
// ---------------------------------------------------------------------------

/**
 * 플레이어 오른쪽 `gap` 만큼 떨어진 자리에 벽 하나만 세운 판.
 * `tests/wallContactFlag.test.ts` 의 rig 와 같은 관용구다 — 절차 청크가 깔아 놓는 다른 벽·
 * 적·탄이 섞이면 재는 것이 달라진다.
 */
function wallRig(gap: number): { state: WorldState; player: Entity; tick: (f: InputFrame) => void } {
  const state = createWorld(1, { ...DEFAULT_CONFIG });
  const player = playerOf(state);
  const wall = spawnWall(state, player.x + gap, player.y, 60, 400);
  const tick = (f: InputFrame): void => {
    for (const e of state.entities) {
      if (e === player || e === wall) continue;
      e.dead = true;
    }
    stepWorld(state, f);
  };
  return { state, player, tick };
}

/**
 * 한 판을 `ticks` 만큼 굴리고 관측치를 돌려준다.
 *
 * ⚠️ **`gate` 만 보면 안 된다** — 뮤테이션이 그것을 실증했다. 벽이 가까우면(gap 260)
 * 벽 접근 정책을 통째로 지운 뮤턴트도 게이트를 통과한다: 측정 파일럿은 대시를 누르므로
 * 조향이 카이팅이어도 **대시 임펄스가 플레이어를 옆 벽에 밀어붙인다**. 즉 그 단언은
 * "벽 접근 정책"이 아니라 "대시가 벽에 부딪힌다"를 재고 있었다.
 * 그래서 **접촉 유지 비율**을 함께 본다 — 지속 추종이 아니면 높은 비율이 안 나온다.
 */
function wallStats(
  gap: number,
  pilot: (s: WorldState) => InputFrame,
  ticks = 300,
): { gate: number; ratio: number; firstContact: number } {
  const r = wallRig(gap);
  let contact = 0;
  let gate = 0;
  let firstContact = -1;
  for (let i = 0; i < ticks; i++) {
    r.tick(pilot(r.state));
    if (r.state.wallContactTicks > 0) {
      contact++;
      if (firstContact < 0) firstContact = i;
    }
    if (r.state.wallContactTicks > gate) gate = r.state.wallContactTicks;
  }
  return { gate, ratio: contact / ticks, firstContact };
}

describe('④ 벽 접근 정책 — `wallContactTicks` 가 실제로 선다', () => {
  it('먼 벽(900)에도 접근해 붙고 ME9 게이트(60틱 연속)를 넘긴다', () => {
    const s = wallStats(900, measurePilotInput);
    // "벽 쪽으로 갔다"가 아니라 **플래그가 섰다**가 증거다.
    expect(s.firstContact).toBeGreaterThan(0);
    expect(s.gate).toBeGreaterThanOrEqual(60);
    expect(s.ratio).toBeGreaterThan(0.6);
  });

  it('가까운 벽(260)에서는 **접촉을 유지**한다 (게이트만으로는 부족하다)', () => {
    const s = wallStats(260, measurePilotInput);
    expect(s.gate).toBeGreaterThanOrEqual(60);
    // 지속 추종의 서명. 대시가 우연히 부딪히는 것으로는 이 비율이 안 나온다.
    expect(s.ratio).toBeGreaterThan(0.9);
  });

  it('대조군: 같은 두 판에서 오토파일럿은 게이트를 못 연다', () => {
    for (const gap of [260, 900]) {
      const s = wallStats(gap, autopilotInput);
      // 대조군이 우연히 열면 ④ 전체가 항진이다 — 그 상태를 명시적으로 막는다.
      expect(s.gate, `gap ${gap}`).toBeLessThan(60);
    }
  });

  it('벽이 없는 무대에서는 조향이 정본 그대로다 (벽 정책이 새지 않는다)', () => {
    const state = killWalls(createWorld(1, { ...DEFAULT_CONFIG }));
    let compared = 0;
    for (let i = 0; i < 200; i++) {
      if (state.activeWalls.length === 0 && !state.pendingLevelUp) {
        const m = measurePilotInput(state);
        const a = autopilotInput(state);
        expect([m.moveX, m.moveY]).toEqual([a.moveX, a.moveY]);
        compared++;
      }
      killWalls(state);
      stepWorld(state, measurePilotInput(state));
      if (state.victory || state.gameOver) break;
    }
    expect(compared).toBeGreaterThan(100);
    expect(state.wallContactTicks).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 액티브가 **실제로 발동한다** — "눌렀다"가 아니라 "터졌다"
// ---------------------------------------------------------------------------

/** 그 스킬이 열리고도 남을 만큼 해당 계열에 투자한 벡터(`activeSkillWiring.test.ts` 와 동일 관용구). */
function investFor(def: ActiveSkillDef): number[] {
  const ship = SHIP_TYPES[def.shipTypeId];
  const v = zeroSkillInvest(def.shipTypeId);
  if (ship === undefined) return v;
  const { start, end } = shipTreeRange(ship, def.treeIndex);
  for (let i = start; i < end; i++) v[i] = 5;
  return v;
}

/**
 * 두 슬롯에 그 기체의 **`strike` 1종 + `buff` 1종**을 꽂은 런 config.
 *
 * ⚠️ 처음에는 `list[0]`·`list[1]` 을 썼는데 그건 기체마다 `strike` 두 개여서
 * **`activeBuff0/1` 이 영영 0** 이었다 — "발동했다"의 증거로 쓰려던 관측량이 원리적으로
 * 관측 불가였다. `kind` 로 골라야 두 축(쿨다운·버프 틱)이 다 선다.
 */
function twoSlotConfig(shipTypeId: number): WorldConfig {
  const list = ACTIVES_BY_SHIP[shipTypeId] ?? [];
  const a = list.find((d) => d.kind === 'strike');
  const b = list.find((d) => d.kind === 'buff');
  if (a === undefined || b === undefined) throw new Error(`strike/buff 액티브가 없다: ship ${shipTypeId}`);
  // 두 스킬이 다른 계열이면 한쪽이 안 열린다 — 두 벡터를 합쳐 둘 다 연다.
  const invest = investFor(a);
  const bv = investFor(b);
  for (let i = 0; i < invest.length; i++) invest[i] = Math.max(invest[i] ?? 0, bv[i] ?? 0);
  return {
    ...DEFAULT_CONFIG,
    shipType: shipTypeId,
    skillInvest: invest,
    activeSlots: [wireIdOf(a.id), wireIdOf(b.id)],
  };
}

describe('⑤ 액티브 발동 실증', () => {
  it('측정 파일럿 런은 두 슬롯 쿨다운을 실제로 돌린다 (기체 7종 전수)', () => {
    for (let ship = 0; ship < 7; ship++) {
      const cfg = twoSlotConfig(ship);
      const state = createWorld(0xac71e, cfg);
      beginMeasureRun(state);
      let cd0Fired = 0;
      let cd1Fired = 0;
      let prev0 = state.activeCd0;
      let prev1 = state.activeCd1;
      for (let i = 0; i < 400; i++) {
        stepWorld(state, measurePilotInput(state));
        // 쿨다운이 **올라간** 틱 = 공통 발동 코드가 핸들러를 부른 틱(`stepActives` 는 감소만 한다).
        if (state.activeCd0 > prev0) cd0Fired++;
        if (state.activeCd1 > prev1) cd1Fired++;
        prev0 = state.activeCd0;
        prev1 = state.activeCd1;
        if (state.victory || state.gameOver) break;
      }
      expect(cd0Fired, `ship ${ship} 슬롯1 미발동`).toBeGreaterThan(0);
      expect(cd1Fired, `ship ${ship} 슬롯2 미발동`).toBeGreaterThan(0);
    }
  });

  it('대조군: 오토파일럿 런은 같은 장착에서 쿨다운이 끝까지 0 이다', () => {
    for (let ship = 0; ship < 7; ship++) {
      const state = createWorld(0xac71e, twoSlotConfig(ship));
      for (let i = 0; i < 400; i++) {
        stepWorld(state, autopilotInput(state));
        expect(state.activeCd0, `ship ${ship}`).toBe(0);
        expect(state.activeCd1, `ship ${ship}`).toBe(0);
        if (state.victory || state.gameOver) break;
      }
    }
  });

  it('버프 잔여 틱도 움직인다 — 핸들러가 실제로 돌았다는 증거', () => {
    // 쿨다운은 **공통 발동 코드**가 세운다. 즉 핸들러가 텅 비어도 쿨다운은 오른다(계획 PM-1).
    // 버프 잔여 틱은 **핸들러만** 세우므로(0c 작성자 분리), 이것이 움직여야 효과가 돌았다는
    // 증거가 된다. 버프형 액티브가 하나도 없는 기체는 있을 수 있으므로 전 기체 합으로 센다.
    let buffSeen = 0;
    for (let ship = 0; ship < 7; ship++) {
      const state = createWorld(0xac71e, twoSlotConfig(ship));
      beginMeasureRun(state);
      for (let i = 0; i < 400; i++) {
        stepWorld(state, measurePilotInput(state));
        if (state.activeBuff0 > 0 || state.activeBuff1 > 0) buffSeen++;
        if (state.victory || state.gameOver) break;
      }
    }
    expect(buffSeen).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ⑥ 측정 런은 오염 런이다 — 호출부 책임의 단일 진입점
// ---------------------------------------------------------------------------

describe('⑥ 측정 런 오염 표시', () => {
  it('`beginMeasureRun` 이 오염 표시를 세운다', () => {
    const state = createWorld(5, { ...DEFAULT_CONFIG });
    expect(state.tainted).toBe(false);
    beginMeasureRun(state);
    expect(state.tainted).toBe(true);
  });

  it('오염 표시는 해시를 흔들지 않는다 (제출 경로 전용 플래그)', () => {
    const a = createWorld(6, { ...DEFAULT_CONFIG });
    const b = createWorld(6, { ...DEFAULT_CONFIG });
    beginMeasureRun(b);
    for (let i = 0; i < 40; i++) {
      stepWorld(a, emptyInput());
      stepWorld(b, emptyInput());
    }
    expect(hashWorld(b)).toBe(hashWorld(a));
  });

  it('표시는 런 끝까지 유지된다 (측정 프레임이 제출 경로로 새지 않는다)', () => {
    const state = createWorld(8, { ...DEFAULT_CONFIG });
    beginMeasureRun(state);
    for (let i = 0; i < 200; i++) {
      stepWorld(state, measurePilotInput(state));
      if (state.victory || state.gameOver) break;
    }
    expect(state.tainted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ⑦ 무연산 확인 — 측정 파일럿을 안 쓰는 경로는 한 글자도 안 바뀐다
// ---------------------------------------------------------------------------

describe('⑦ 기존 경로 불변', () => {
  it('`SPECIAL_NONE` 은 여전히 0 이고 프리즈 프레임은 픽 하나뿐이다', () => {
    expect(SPECIAL_NONE).toBe(0);
    expect(pilotFreezeFrame()).toEqual({
      moveX: 0,
      moveY: 0,
      aim: 0,
      dash: false,
      special: packPowerupPick(0),
    });
  });
});
