/**
 * 성장 축 촉매 배선 — **`id 9 epiphany` · `id 14 mastery`** (ADR-0052).
 *
 * 두 카드 다 앵커 ⑬(`onPowerupOfferCatalyst`) 에서 **이미 뽑힌 3택을 자리째 덮고**,
 * 앵커 ⑭(`onPowerupPickedCatalyst`) 에서 **중첩분을 얹는다**.
 *
 * ## ⚠️ 이 파일의 안전선은 §3 이다 — RNG 소비량 불변
 * 파워업 3택은 `powerupRng` 스트림에 걸려 있어(`powerups.ts:517`), 촉매가 한 칸이라도
 * 더 굴리면 **같은 시드의 이후 전개가 통째로 밀린다**. §3 은 `getState()` 로 스트림 위치를
 * 직접 재고, 여러 레벨업에 걸친 3택 첫 칸 시퀀스가 갈리지 않는 것을 함께 잠근다.
 *
 * ## ⚠️ 항진 방지
 * 비례·단조 단언 앞에 **"레벨업이 실제로 일어났다"** 를 먼저 세운다. 배선이 끊기면 양변이
 * 모두 0 이 되어 성립하는 형태가 이 저장소에 실제로 있었다.
 */

import { describe, it, expect } from 'vitest';

import {
  createWorld,
  stepWorld,
  emptyInput,
  DEFAULT_CONFIG,
  SPECIAL_POWERUP_PICK,
} from '../src/sim/world.js';
import { POWERUPS } from '../src/sim/powerups.js';
import type { WorldState, InputFrame } from '../src/sim/world.js';

const idle: InputFrame = emptyInput();
const pick: InputFrame = { ...emptyInput(), special: SPECIAL_POWERUP_PICK };

/** id 9 epiphany · id 14 mastery. `data/catalysts.ts` 의 slug 와 짝이다. */
const EPIPHANY = 9;
const MASTERY = 14;

/**
 * 중첩 실효 계측에 쓰는 파워업. `playerHp` 를 **바닥 없이 +10 가산**하므로 ⭐`min`/`clamp`
 * 삼킴이 없다 — 삼키는 축(`dashCooldownTicks` 의 `Math.max(12, ·)`)으로 재면 계측기 자체가
 * 고장난다.
 */
const HULL_INDEX = POWERUPS.findIndex((d) => d.id === 'reinforced-hull');

function world(catalysts?: number[]): WorldState {
  const cfg = catalysts === undefined ? { ...DEFAULT_CONFIG } : { ...DEFAULT_CONFIG, catalysts };
  return createWorld(0xca17, cfg);
}

/** 한 번 레벨업시키고 3택이 선 상태로 돌려준다. */
function levelUpOnce(catalysts?: number[]): WorldState {
  const s = world(catalysts);
  s.xp = 1_000_000;
  stepWorld(s, idle);
  // ⚠️ 하한 — 레벨업이 **실제로 일어났다**. 이것이 거짓이면 아래 단언은 전부 항진이다.
  expect(s.level).toBe(2);
  expect(s.pendingLevelUp).toBe(true);
  expect(s.powerupChoices.length).toBeGreaterThan(0);
  return s;
}

// ---------------------------------------------------------------------------
// ① 계측기 건전성
// ---------------------------------------------------------------------------

describe('계측기', () => {
  it('`reinforced-hull` 이 풀에 있고 `playerHp` 를 바닥 없이 올린다', () => {
    expect(HULL_INDEX).toBeGreaterThanOrEqual(0);
    const s = world();
    const before = s.config.playerHp;
    // 같은 파워업을 두 번 넣으면 두 배로 오른다 = 이 축은 삼키지 않는다.
    POWERUPS[HULL_INDEX]?.apply(s);
    const one = s.config.playerHp - before;
    POWERUPS[HULL_INDEX]?.apply(s);
    expect(s.config.playerHp - before).toBe(one * 2);
    expect(one).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ② 3택 덮어쓰기 — 카드별 효과 + 무촉매 음성 대조
// ---------------------------------------------------------------------------

describe('앵커 ⑬ — 3택 자리 덮어쓰기', () => {
  it('무촉매 음성 대조: 3택은 서로 다른 셋 그대로다(내 훅이 아무것도 안 한다)', () => {
    const s = levelUpOnce();
    expect(s.powerupChoices.length).toBe(3);
    expect(new Set(s.powerupChoices).size).toBe(3);
  });

  it('id 14 mastery: 세 자리가 전부 첫 칸과 같아진다', () => {
    const s = levelUpOnce([MASTERY]);
    expect(s.powerupChoices.length).toBe(3);
    expect(new Set(s.powerupChoices).size).toBe(1);
    // 긍정 짝 — 덮인 값이 **뽑힌 첫 칸 그대로**다(임의의 상수로 바뀐 게 아니다).
    expect(s.powerupChoices[0]).toBe(levelUpOnce().powerupChoices[0]);
  });

  it('id 9 epiphany: 3택이 1택으로 접히고 남는 것은 첫 칸이다', () => {
    const s = levelUpOnce([EPIPHANY]);
    expect(s.powerupChoices.length).toBe(1);
    expect(s.powerupChoices[0]).toBe(levelUpOnce().powerupChoices[0]);
  });

  it('둘 다 실리면 mastery → epiphany 순으로 접혀 1택이 된다', () => {
    const s = levelUpOnce([EPIPHANY, MASTERY]);
    expect(s.powerupChoices.length).toBe(1);
    expect(s.powerupChoices[0]).toBe(levelUpOnce().powerupChoices[0]);
  });

  it('음성 대조: 내가 배선하지 않은 촉매(id 1)는 3택을 건드리지 않는다', () => {
    const s = levelUpOnce([1]);
    expect(s.powerupChoices.length).toBe(3);
    expect(new Set(s.powerupChoices).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// ③ ⚠️⚠️ 안전선 — RNG 소비량 불변
// ---------------------------------------------------------------------------

describe('RNG 소비량 불변 — 촉매가 `powerupRng` 를 밀지 않는다', () => {
  /** 레벨업 → 픽 을 `n` 회 반복하고, 3택 첫 칸 시퀀스와 스트림 위치를 돌려준다. */
  function drive(n: number, catalysts?: number[]): { firsts: number[]; rng: number } {
    const s = world(catalysts);
    s.xp = 10_000_000;
    const firsts: number[] = [];
    for (let k = 0; k < n; k++) {
      stepWorld(s, idle); // 레벨업 + 3택 제시
      expect(s.pendingLevelUp).toBe(true); // 하한 — 실제로 레벨이 올랐다
      firsts.push(s.powerupChoices[0] as number);
      stepWorld(s, pick); // 픽 소비
      expect(s.pendingLevelUp).toBe(false);
    }
    return { firsts, rng: s.powerupRng.getState() };
  }

  const LEVELS = 5;

  it('하한: 무촉매 대조가 실제로 5회 레벨업하고 3택이 매번 갈린다', () => {
    const base = drive(LEVELS);
    expect(base.firsts.length).toBe(LEVELS);
    expect(base.firsts.every((v) => Number.isInteger(v))).toBe(true);
    // 스트림이 실제로 돌았다 — 시작 상태에 머물러 있지 않다.
    expect(base.rng).not.toBe(createWorld(0xca17, { ...DEFAULT_CONFIG }).powerupRng.getState());
  });

  it('mastery 를 켠 런도 스트림 위치와 3택 첫 칸 시퀀스가 무촉매와 **동일**하다', () => {
    const base = drive(LEVELS);
    const cat = drive(LEVELS, [MASTERY]);
    expect(cat.firsts).toEqual(base.firsts);
    expect(cat.rng).toBe(base.rng);
  });

  it('epiphany 를 켠 런도 — 3택이 1택으로 접혀도 스트림은 그대로다', () => {
    const base = drive(LEVELS);
    const cat = drive(LEVELS, [EPIPHANY]);
    expect(cat.firsts).toEqual(base.firsts);
    expect(cat.rng).toBe(base.rng);
  });

  it('둘 다 켠 런도 동일하다', () => {
    const base = drive(LEVELS);
    const cat = drive(LEVELS, [EPIPHANY, MASTERY]);
    expect(cat.firsts).toEqual(base.firsts);
    expect(cat.rng).toBe(base.rng);
  });
});

// ---------------------------------------------------------------------------
// ④ 앵커 ⑭ — 중첩분이 **실제로** 들어간다
// ---------------------------------------------------------------------------

describe('앵커 ⑭ — 중첩 적용', () => {
  /** 3택을 `reinforced-hull` 로 고정해 픽하고, `playerHp` 증가분을 돌려준다. */
  function hullGain(catalysts?: number[]): number {
    const s = levelUpOnce(catalysts);
    const before = s.config.playerHp;
    // ⚠️ 손으로 고정하는 것은 **뽑기 결과**뿐이다 — RNG 는 이미 굴러 끝났고 여기서 다시
    //    굴리지 않는다(§3 이 그 불변을 따로 잠근다).
    s.powerupChoices = [HULL_INDEX];
    stepWorld(s, pick);
    expect(s.pendingLevelUp).toBe(false); // 하한 — 픽이 실제로 소비됐다
    return s.config.playerHp - before;
  }

  it('무촉매 음성 대조: 1중첩만 들어간다', () => {
    expect(hullGain()).toBe(10);
  });

  it('id 9 epiphany: 2중첩', () => {
    expect(hullGain([EPIPHANY])).toBe(20);
  });

  it('id 14 mastery: 3중첩', () => {
    expect(hullGain([MASTERY])).toBe(30);
  });

  it('둘 다: 가산으로 4중첩(1 + 1 + 2)', () => {
    expect(hullGain([EPIPHANY, MASTERY])).toBe(40);
  });

  it('음성 대조: 배선하지 않은 촉매(id 1)는 중첩을 안 얹는다', () => {
    expect(hullGain([1])).toBe(10);
  });
});
