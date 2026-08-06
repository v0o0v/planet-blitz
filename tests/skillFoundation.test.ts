/**
 * 210스킬 **공유 기반**의 계약 (S0 · ADR-0049) — `skillLv()` · 슬롯 접근자 · 통과 판정 ·
 * `hashWorld` 조건부 꼬리 폴드.
 *
 * ## S0 의 합격 조건이 특수하다
 * 이 커밋은 **소비자가 0인 배선**을 만든다. 그래서 "효과가 있다"를 잴 것이 없고, 대신
 * **거동·해시 불변**과 **규약이 실제로 강제되는가**를 잰다.
 *
 * ⚠️ **"16칸 전부 0이면 무폴드"의 절대적 증명은 여기가 아니라 골든 픽스처**(`pnpm test:sim` 의
 * `denoFixture`·`shipHashBaseline`)다 — 이 파일이 쓸 수 있는 것은 상대 비교뿐이라, 폴드를
 * 무조건 실행하는 구현도 아래 단언을 전부 통과한다. 그래서 아래 마지막 절이 그 사각지대를
 * 명시하고, 실제 판정은 sim 레인이 진다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { skillLv, axisOfIndex } from '../src/items/skills.js';
import { SKILL_SLOT_COUNT, createSkillSlots, readSlot, writeSlot } from '../src/sim/skillSlots.js';
import { crossed, cloakEntryCrossed } from '../src/sim/cloak.js';
import { CLOAK_UNHIT_TICKS } from '../src/sim/shipSignature.js';
import { TREE_AFFINITIES } from '../data/ships/index.js';
import type { TreeAffinity } from '../data/ships/index.js';

// ---------------------------------------------------------------------------
// ① skillLv() — 정본 4조
// ---------------------------------------------------------------------------

/** 축별 **첫 flat 인덱스**를 코드에서 찾는다 — 레이아웃 상수를 테스트에 베끼지 않는다. */
function firstIndexOf(axis: TreeAffinity): number {
  for (let i = 0; i < 200; i++) {
    if (axisOfIndex(i) === axis) return i;
  }
  throw new Error(`축 ${axis} 의 인덱스를 못 찾았다 — 레이아웃이 바뀌었다`);
}

/** 길이 `n` 의 0 벡터에 `i` 칸만 `v` 로 세운 투자 벡터. */
function investAt(i: number, v: number, n = 60): number[] {
  const out = new Array<number>(Math.max(n, i + 1)).fill(0);
  out[i] = v;
  return out;
}

describe('skillLv() — 투자 + 축 어픽스', () => {
  const OFF = firstIndexOf('offense');
  const DEF = firstIndexOf('defense');
  const UTL = firstIndexOf('utility');

  it('정본 1: 투자 0 이면 어픽스가 아무리 커도 0 이다 (해금은 포인트로만)', () => {
    expect(skillLv(investAt(OFF, 0), OFF, [4, 4, 4])).toBe(0);
    // 벡터 자체가 없어도 같다.
    expect(skillLv(undefined, OFF, [4, 4, 4])).toBe(0);
  });

  it('정본 1 대우: 투자 ≥ 1 이면 그 축의 어픽스가 가산된다', () => {
    expect(skillLv(investAt(OFF, 3), OFF, [4, 0, 0])).toBe(7);
  });

  it('축이 `TREE_AFFINITIES` 순서로 매핑된다 (offense=0 · defense=1 · utility=2)', () => {
    expect([...TREE_AFFINITIES]).toEqual(['offense', 'defense', 'utility']);
    // 각 축이 **자기 칸만** 읽는다 — 한 칸이라도 어긋나면 세 단언 중 둘이 깨진다.
    expect(skillLv(investAt(OFF, 1), OFF, [2, 3, 4])).toBe(3);
    expect(skillLv(investAt(DEF, 1), DEF, [2, 3, 4])).toBe(4);
    expect(skillLv(investAt(UTL, 1), UTL, [2, 3, 4])).toBe(5);
  });

  it('정본 2: 20 을 초과한다 — clamp 하지 않는다 (실효 상한 24 는 입력 쪽이 보장)', () => {
    expect(skillLv(investAt(OFF, 20), OFF, [4, 0, 0])).toBe(24);
    // 상한을 여기서 잘랐다면 20 이 나온다.
    expect(skillLv(investAt(OFF, 20), OFF, [4, 0, 0])).not.toBe(20);
  });

  it('⚠️ `axisOfIndex` 가 `undefined` 면 어픽스 없이 base 를 돌려준다 (offense 로 흘리지 않는다)', () => {
    const stray = 999;
    expect(axisOfIndex(stray)).toBeUndefined();
    // 스니펫대로 `skillAffixLv[undefined]` 를 쓰면 NaN, 기본값 0 으로 흘리면 5+2=7 이 된다.
    expect(skillLv(investAt(stray, 5, 1000), stray, [2, 3, 4])).toBe(5);
  });

  it('어픽스 벡터가 없는 런(조건부 스탬프 미실행)은 base 그대로다', () => {
    expect(skillLv(investAt(OFF, 6), OFF)).toBe(6);
    expect(skillLv(investAt(OFF, 6), OFF, [])).toBe(6);
  });

  it('손상 입력(소수·음수·NaN)을 조용히 삼키지 않는다 — 정수 비음으로 접힌다', () => {
    expect(skillLv(investAt(OFF, 3.9), OFF)).toBe(3);
    expect(skillLv(investAt(OFF, -5), OFF, [4, 0, 0])).toBe(0);
    expect(skillLv(investAt(OFF, 3), OFF, [Number.NaN, 0, 0])).toBe(3);
    expect(skillLv(investAt(OFF, 3), OFF, [2.9, 0, 0])).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// ② 슬롯 접근자
// ---------------------------------------------------------------------------

describe('슬롯 접근자 — 정수·비음 강제와 범위 방어', () => {
  it('새 배열은 고정폭이고 전 슬롯 0 이다 (무폴드의 전제)', () => {
    const s = createSkillSlots();
    expect(s.length).toBe(SKILL_SLOT_COUNT);
    expect(s.every((v) => v === 0)).toBe(true);
  });

  it('writeSlot 은 `Math.trunc` + `max(0, ·)` 를 강제한다', () => {
    const s = createSkillSlots();
    writeSlot(s, 0, 3.9);
    writeSlot(s, 1, -7);
    writeSlot(s, 2, 0);
    expect(readSlot(s, 0)).toBe(3);
    expect(readSlot(s, 1)).toBe(0);
    expect(readSlot(s, 2)).toBe(0);
  });

  it('⚠️ 범위 밖 인덱스는 **던진다** — 조용한 무연산을 만들지 않는다', () => {
    const s = createSkillSlots();
    expect(() => writeSlot(s, SKILL_SLOT_COUNT, 1)).toThrow();
    expect(() => readSlot(s, -1)).toThrow();
    expect(() => writeSlot(s, 1.5, 1)).toThrow();
    // 던지지 않고 통과했다면 배열이 늘어나 고정폭 폴드가 깨진다.
    expect(s.length).toBe(SKILL_SLOT_COUNT);
  });
});

// ---------------------------------------------------------------------------
// ③ 통과 판정 (`crossed`)
// ---------------------------------------------------------------------------

describe('crossed() — 임계 통과 판정의 일반형', () => {
  it('임계를 **건너뛴** 점프도 발화한다 (`=== 임계` 였다면 조용히 죽는다)', () => {
    expect(crossed(0, 10, 5)).toBe(true);
    expect(crossed(4, 5, 5)).toBe(true);
    expect(crossed(5, 6, 5)).toBe(false); // 이미 넘은 뒤에는 재발화하지 않는다
    expect(crossed(0, 4, 5)).toBe(false);
  });

  it('양쪽 입력을 `Math.trunc` 한다 (판정과 저장이 갈리지 않게)', () => {
    expect(crossed(4.9, 5.1, 5)).toBe(true);
    expect(crossed(5.9, 6.1, 5)).toBe(false);
  });

  it('`cloakEntryCrossed` 는 이것으로 구현된다 — 정본이 하나다', () => {
    for (const [p, n] of [
      [0, 1],
      [CLOAK_UNHIT_TICKS - 1, CLOAK_UNHIT_TICKS],
      [CLOAK_UNHIT_TICKS - 5, CLOAK_UNHIT_TICKS + 5],
      [CLOAK_UNHIT_TICKS, CLOAK_UNHIT_TICKS + 1],
    ] as const) {
      expect(cloakEntryCrossed(p, n)).toBe(crossed(p, n, CLOAK_UNHIT_TICKS));
    }
  });
});

// ---------------------------------------------------------------------------
// ④ 파생 필드 — createWorld 1회 확정
// ---------------------------------------------------------------------------

describe('skillsOn · skillDerived — config 파생, 런 중 불변', () => {
  it('투자가 하나라도 있으면 `skillsOn` 이 참이다', () => {
    expect(createWorld(1, { ...DEFAULT_CONFIG, skillInvest: investAt(0, 1) }).skillsOn).toBe(true);
    expect(createWorld(1, { ...DEFAULT_CONFIG, skillInvest: investAt(0, 0) }).skillsOn).toBe(false);
    expect(createWorld(1, { ...DEFAULT_CONFIG }).skillsOn).toBe(false);
  });

  it('`skillDerived` 는 기체 타입을 실어 다른 기체의 파생값 오독을 막는다', () => {
    expect(createWorld(1, { ...DEFAULT_CONFIG }).skillDerived.shipType).toBe(0);
    expect(createWorld(1, { ...DEFAULT_CONFIG, shipType: 3 }).skillDerived.shipType).toBe(3);
  });

  it('두 슬롯 배열은 서로 다른 객체다 (한 배열을 두 번 싣는 오타를 잡는다)', () => {
    const w = createWorld(1, { ...DEFAULT_CONFIG });
    expect(w.skillCarry).not.toBe(w.skillStage);
    expect(w.skillCarry.length).toBe(SKILL_SLOT_COUNT);
    expect(w.skillStage.length).toBe(SKILL_SLOT_COUNT);
  });
});

// ---------------------------------------------------------------------------
// ⑤ hashWorld 꼬리 폴드 — 조건부성과 **충돌 부재**
// ---------------------------------------------------------------------------

describe('hashWorld 스킬 슬롯 폴드', () => {
  function w(): WorldState {
    return createWorld(0x5107, { ...DEFAULT_CONFIG });
  }

  it('전 슬롯 0 인 두 월드의 해시는 같다', () => {
    expect(hashWorld(w())).toBe(hashWorld(w()));
  });

  it('슬롯이 서면 해시가 갈리고, 0 으로 되돌리면 정확히 복원된다 (조건부 · 값 의존)', () => {
    const a = w();
    const base = hashWorld(a);
    for (let i = 0; i < SKILL_SLOT_COUNT; i++) {
      writeSlot(a.skillCarry, i, 7);
      expect(hashWorld(a)).not.toBe(base);
      writeSlot(a.skillCarry, i, 0);
      expect(hashWorld(a)).toBe(base);

      writeSlot(a.skillStage, i, 7);
      expect(hashWorld(a)).not.toBe(base);
      writeSlot(a.skillStage, i, 0);
      expect(hashWorld(a)).toBe(base);
    }
  });

  it('⚠️ **배열별 독립 조건이었다면 충돌한다** — carry 만 vs stage 만 이 서로 다른 해시다', () => {
    // 배열마다 조건을 나누면 두 경우가 **똑같이 8칸**만 접혀 같은 바이트열을 낳는다.
    // 16칸을 하나의 OR 조건으로 묶었기 때문에 여기가 갈린다.
    const onlyCarry = w();
    writeSlot(onlyCarry.skillCarry, 0, 1);
    const onlyStage = w();
    writeSlot(onlyStage.skillStage, 0, 1);
    expect(hashWorld(onlyCarry)).not.toBe(hashWorld(onlyStage));
  });

  it('⚠️ **부분 폴드였다면 충돌한다** — 같은 값이 다른 슬롯에 있으면 다른 해시다', () => {
    const at0 = w();
    writeSlot(at0.skillCarry, 0, 3);
    const at1 = w();
    writeSlot(at1.skillCarry, 1, 3);
    expect(hashWorld(at0)).not.toBe(hashWorld(at1));
  });

  it('길이 프리픽스를 접지 않는다 — 배열 길이는 상수라 정보량 0 이다', () => {
    // 폭이 상수이므로 길이를 접었는지 여부는 값으로 관측할 수 없다. 대신 **폭 자체가 고정**임을
    // 잠가, 훗날 폭을 늘리면 이 단언과 골든이 함께 빨개지게 한다.
    expect(SKILL_SLOT_COUNT).toBe(8);
    expect(w().skillCarry.length).toBe(SKILL_SLOT_COUNT);
  });

  it('⚠️ 이 절이 못 잡는 것: "전부 0이면 **한 폴드도 실행하지 않는다**"', () => {
    // 위 단언들은 전부 상대 비교라, 16칸을 **무조건** 접는 구현도 통과한다. 그 구현은 기존
    // 골든을 전량 갈아엎는데 기본 스위트는 초록이다. 실제 판정은 `pnpm test:sim` 의 골든
    // 픽스처(`denoFixture`·`shipHashBaseline`)가 진다 — S0 를 올리기 전에 반드시 돌려라.
    expect(createSkillSlots().every((v) => v === 0)).toBe(true);
  });
});
