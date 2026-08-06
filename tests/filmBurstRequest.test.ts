/**
 * E3 — 버블 파열 후처리 단일화의 **계약 테스트** (ADR-0049 선결, `bubble.md` ①-3).
 *
 * 파열 산술이 두 벌(`world.ts` `burstFilm` · `activeHandlers/bubble.ts` `pushBurst`)이던 것을
 * leaf 모듈 `src/sim/filmBurst.ts` 하나로 합치고, 액티브 핸들러는 **요청만 세우고** world 가
 * `stepActives` 직후 소비하도록 바꿨다. 이 파일이 지키는 것은 넷이다:
 *
 *  1. **요청 슬롯은 틱을 넘지 않는다.** 여섯 정수가 `hashWorld` 시점에 항상 0 이라는 것이
 *     "폴드하지 않는다" 는 결정의 **유일한 근거**다. 이 불변식이 깨지면 그 결정이 함께
 *     무너지므로(관측 시점에 0 이 아닌 값이 해시 밖에 남는다 = 클라/서버 재실행이 갈릴 여지),
 *     여기서 매 틱 확인한다.
 *  2. **요청이 실제로 소비된다.** 핸들러가 직접 터뜨리지 않게 됐으므로, 배선이 통째로 빠져도
 *     타입도 기존 테스트도 아무 말을 하지 않는다 — 이 저장소의 지배적 실패 모드다.
 *  3. **슬롯이 2칸이고 세 번째는 버린다**(덮어쓰지 않는다).
 *  4. **좌표는 요청 시점에 박힌다** — 소비 시점에 플레이어를 다시 읽지 않는다.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  DEFAULT_CONFIG,
  SPECIAL_ACTIVE_SLOT1,
  type InputFrame,
  type WorldConfig,
  type WorldState,
} from '../src/sim/world.js';
import {
  FILM_BURST_REQ_BURST,
  FILM_BURST_REQ_NONE,
  consumeFilmBurstRequests,
  requestFilmBurst,
} from '../src/sim/filmBurst.js';
import { FILM_BURST_RADIUS, filmBurstPush } from '../src/sim/shipSignature.js';
import { blankEntity, type Entity } from '../src/sim/entities.js';
import { ALL_ACTIVES, wireIdOf } from '../data/ships/actives/index.js';
import { SHIP_TYPES, shipTreeRange, zeroSkillInvest } from '../data/ships/index.js';

const POP_LO = (() => {
  const d = ALL_ACTIVES.find((a) => a.id === 'as_bubble_pop_lo');
  if (d === undefined) throw new Error('as_bubble_pop_lo 레지스트리 미등록');
  return d;
})();

const IDLE: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };
const FIRE: InputFrame = { ...IDLE, special: SPECIAL_ACTIVE_SLOT1 };

/** `as_bubble_pop_lo` 를 슬롯 1 에 장착하고 그 계열에 충분히 투자한 런 config. */
function popLoConfig(): WorldConfig {
  const ship = SHIP_TYPES[POP_LO.shipTypeId];
  if (ship === undefined) throw new Error('버블 기체 미등록');
  const invest = zeroSkillInvest(POP_LO.shipTypeId);
  const { start, end } = shipTreeRange(ship, POP_LO.treeIndex);
  for (let i = start; i < end; i++) invest[i] = 5;
  return {
    ...DEFAULT_CONFIG,
    shipType: POP_LO.shipTypeId,
    skillInvest: invest,
    activeSlots: [wireIdOf(POP_LO.id), -1],
  };
}

const reqSlots = (s: WorldState): number[] => [
  s.filmBurstReq0,
  s.filmBurstReqX0,
  s.filmBurstReqY0,
  s.filmBurstReq1,
  s.filmBurstReqX1,
  s.filmBurstReqY1,
];

/** 움직이지도 반격하지도 않는 표적(`enemyType = -1` → 패턴 def 미존재). */
function addDummyEnemy(state: WorldState, x: number, y: number): Entity {
  const e = blankEntity('enemy');
  e.id = state.nextEntityId++;
  e.x = x;
  e.y = y;
  e.radius = 40;
  e.hp = 100_000_000;
  e.maxHp = 100_000_000;
  e.enemyType = -1;
  state.entities.push(e);
  return e;
}

describe('E3 — 요청 슬롯은 틱을 넘지 않는다(폴드 미실행의 근거)', () => {
  it('매 틱 발동을 눌러도 틱 끝에서 여섯 칸이 항상 0 이다', () => {
    const state = createWorld(0xb0b, popLoConfig());
    let sawNonZeroDuringTick = false;
    for (let t = 0; t < 400; t++) {
      stepWorld(state, FIRE);
      const slots = reqSlots(state);
      expect(slots, `tick ${t} — 요청이 틱을 넘었다`).toEqual([0, 0, 0, 0, 0, 0]);
      // 아래 "배선 있음" 케이스가 요청이 실제로 서는 것을 따로 증명하므로 여기서는 형식만 본다.
      if (slots.some((v) => v !== 0)) sawNonZeroDuringTick = true;
    }
    expect(sawNonZeroDuringTick).toBe(false);
  });
});

describe('E3 — 요청이 실제로 소비된다(배선 있음)', () => {
  it('pop_lo 발동 틱에 반경 안 적이 밖으로 밀려난다', () => {
    const cfg = popLoConfig();
    const control = createWorld(0xb0b, cfg);
    const fired = createWorld(0xb0b, cfg);
    // 같은 시드·같은 config 라 두 월드의 플레이어 좌표가 같다. 반경(220) 안에 표적을 심는다.
    const near = FILM_BURST_RADIUS / 2;
    const dummies = [control, fired].map((w) => {
      const p = w.entities[0] as Entity;
      return addDummyEnemy(w, p.x + near, p.y);
    });
    const [dc, df] = dummies as [Entity, Entity];
    stepWorld(control, IDLE);
    stepWorld(fired, FIRE);
    const pc = control.entities[0] as Entity;
    const pf = fired.entities[0] as Entity;
    const dControl = Math.hypot(dc.x - pc.x, dc.y - pc.y);
    const dFired = Math.hypot(df.x - pf.x, df.y - pf.y);
    // 대조군은 제자리(`enemyType = -1`), 발동군은 밀어내기 변위만큼 멀어진다.
    expect(dControl).toBeCloseTo(near, 6);
    expect(dFired).toBeCloseTo(near + filmBurstPush(), 6);
    // 파열 결과가 반경 밖으로 나가야 "밀어냈다" 가 성립한다(FILM_BURST_PUSH_TICKS 주석의 계약).
    expect(dFired).toBeGreaterThan(FILM_BURST_RADIUS);
  });
});

describe('E3 — 슬롯 2칸 · 세 번째는 버린다', () => {
  it('두 요청이 각자 칸을 차지하고, 세 번째는 앞의 둘을 덮어쓰지 않는다', () => {
    const state = createWorld(1, DEFAULT_CONFIG);
    requestFilmBurst(state, 10, 20);
    requestFilmBurst(state, 30, 40);
    requestFilmBurst(state, 50, 60); // 버려진다
    expect(reqSlots(state)).toEqual([
      FILM_BURST_REQ_BURST,
      10,
      20,
      FILM_BURST_REQ_BURST,
      30,
      40,
    ]);
  });

  it('소비하면 두 요청이 모두 해소되고 여섯 칸이 0 으로 돌아간다', () => {
    const state = createWorld(1, DEFAULT_CONFIG);
    const p = state.entities[0] as Entity;
    const a = addDummyEnemy(state, p.x + 1000, p.y);
    const b = addDummyEnemy(state, p.x + 2000, p.y);
    // 두 요청의 중심을 각각 다른 적 옆에 둔다 — 한 칸만 소비되면 한쪽이 안 움직인다.
    requestFilmBurst(state, a.x - 50, a.y);
    requestFilmBurst(state, b.x - 50, b.y);
    consumeFilmBurstRequests(state);
    expect(a.x).toBeGreaterThan(p.x + 1000);
    expect(b.x).toBeGreaterThan(p.x + 2000);
    expect(reqSlots(state)).toEqual([FILM_BURST_REQ_NONE, 0, 0, FILM_BURST_REQ_NONE, 0, 0]);
  });
});

describe('E3 — 좌표는 요청 시점에 박힌다', () => {
  it('요청 뒤 플레이어가 움직여도 파열 중심은 요청 좌표다', () => {
    const state = createWorld(1, DEFAULT_CONFIG);
    const p = state.entities[0] as Entity;
    const anchorX = p.x;
    const anchorY = p.y;
    const dummy = addDummyEnemy(state, anchorX + FILM_BURST_RADIUS / 2, anchorY);
    requestFilmBurst(state, anchorX, anchorY);
    // 같은 틱에 다른 슬롯의 `blink` 가 플레이어를 옮기는 상황을 흉내낸다.
    p.x = anchorX + 100_000;
    consumeFilmBurstRequests(state);
    // 중심이 플레이어를 따라갔다면 적은 반경 밖이라 한 번도 안 밀렸을 것이다.
    expect(dummy.x - anchorX).toBeCloseTo(FILM_BURST_RADIUS / 2 + filmBurstPush(), 6);
    expect(dummy.y).toBeCloseTo(anchorY, 6);
  });
});
