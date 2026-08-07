/**
 * 성장 결 촉매 배선 — **`id 10 insight` · `id 11 tutelage` · `id 12 ascension` ·
 * `id 13 enlightenment`** (ADR-0052).
 *
 * `id 14 mastery` 는 `tests/catalystProgress.test.ts` 가 이미 잠근다(3택 덮어쓰기·중첩·스트림).
 * 이 파일은 그 넷만 본다.
 *
 * ## ⚠️ 이 파일의 안전선 셋
 *  1. **음성 대조** — 안 실으면 무촉매와 거동이 같다. 카드마다 하나씩 있다.
 *  2. **이득과 대가가 둘 다 관측된다** — 이득만 재면 "대가를 안 물리는 배선"이 통과한다.
 *  3. **RNG 스트림 불변** — 재롤 금지. `id 11` 은 3택을 만지므로 이것이 핵심이다.
 *
 * ## ⚠️ 항진 방지
 * 비교 단언 앞에 **"관측 대상이 실제로 생겼다"** 를 먼저 세운다(예고선이 0개면 "밖에서는
 * 배율이 1" 이 공짜로 성립한다).
 */

import { describe, it, expect } from 'vitest';

import {
  createWorld,
  stepWorld,
  emptyInput,
  DEFAULT_CONFIG,
  DEFAULT_WEAPON,
  SPECIAL_POWERUP_PICK,
} from '../src/sim/world.js';
import type { WorldState, InputFrame } from '../src/sim/world.js';
import { blankEntity, addEntity } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { readCatalystSlot, InsightSlot } from '../src/sim/catalystSlots.js';
import { isCatalystHazard } from '../src/sim/catalyst/shared.js';
import {
  growthOnTick,
  growthOnWaveAdvanced,
  growthOnDashPierce,
  growthOnLootRoll,
  enlightenmentRushStepMult,
  tutelageAutoPickIndex,
} from '../src/sim/catalyst/growth.js';

const idle: InputFrame = emptyInput();
const pick: InputFrame = { ...emptyInput(), special: SPECIAL_POWERUP_PICK };

const INSIGHT = 10;
const TUTELAGE = 11;
const ASCENSION = 12;
const ENLIGHTENMENT = 13;
/** 이 레인이 배선하지 않은 카드 — 음성 대조의 "다른 촉매" 축. */
const UNRELATED = 1;

/** 예고선이 서는 선행 틱. `growth.ts` 의 `TELEGRAPH_LEAD` 와 짝이다. */
const TELEGRAPH_LEAD = 30;
/** 예고선이 적에서 떨어지는 거리. `growth.ts` 의 `TELEGRAPH_OFFSET` 과 짝이다. */
const TELEGRAPH_OFFSET = 220;

function world(catalysts?: number[]): WorldState {
  const cfg = catalysts === undefined ? { ...DEFAULT_CONFIG } : { ...DEFAULT_CONFIG, catalysts };
  return createWorld(0x9101, cfg);
}

function player(s: WorldState): Entity {
  const p = s.entities[0];
  if (p === undefined || p.kind !== 'player') throw new Error('player missing');
  return p;
}

/**
 * 적 하나를 심는다. ⚠️ `enemyType` 을 반드시 세운다 — `blankEntity` 기본값 `-1` 이면
 * `enemyDefFor` 가 `undefined` 라 이동 단계도 앵커도 조용히 건너뛴다(앞 레인 실측).
 */
function seedEnemy(s: WorldState, x: number, y: number, cooldown = 0): Entity {
  const e = blankEntity('enemy');
  e.x = x;
  e.y = y;
  e.enemyType = 0;
  e.hp = 100;
  e.radius = 32;
  e.cooldown = cooldown;
  return addEntity(s, e);
}

/** 이 카드가 세운 예고선(촉매 해저드 중 피해 0)만 센다. */
function telegraphs(s: WorldState): Entity[] {
  return s.entities.filter((e) => !e.dead && isCatalystHazard(e) && e.damage === 0);
}

// ---------------------------------------------------------------------------
// ① 계측기 건전성 — 상수 사본이 정본과 같은가
// ---------------------------------------------------------------------------

describe('계측기', () => {
  it('`id 13` 이 쓰는 기준 탄 반경 5 는 `DEFAULT_WEAPON` 정본과 같다', () => {
    // ⚠️ `growth.ts` 는 순환 때문에 `world.js` 를 값으로 못 끈다 — 사본이 어긋나면 이 줄이
    //    즉시 빨개진다(그 파일 §주석의 계약).
    expect(DEFAULT_WEAPON.bulletRadius).toBe(5);
  });

  it('무촉매 런은 촉매 슬롯이 전 칸 0 이다', () => {
    const s = world();
    expect(s.catalystSlots.every((v) => v === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ② id 10 insight — 예고선 · 그 위에서만 XP 3배
// ---------------------------------------------------------------------------

describe('id 10 insight', () => {
  /** 적을 하나 심고 예고 시점(`cooldown === LEAD`)에 맞춰 한 틱 돌린다. */
  function armed(catalysts?: number[]): WorldState {
    const s = world(catalysts);
    // 적을 플레이어(0,0) 기준 +x 로 `TELEGRAPH_OFFSET` 만큼 두면 예고선 중심이 정확히
    // 플레이어 자리(0,0)에 선다 — "궤적 위" 판정을 좌표로 못 박기 위한 배치다.
    seedEnemy(s, TELEGRAPH_OFFSET, 0, TELEGRAPH_LEAD);
    growthOnTick(s, player(s));
    return s;
  }

  it('음성 대조: 안 실으면 예고선이 하나도 안 서고 XP 배율이 1 그대로다', () => {
    const s = armed();
    expect(telegraphs(s).length).toBe(0);
    expect(s.catalystMods.xp).toBe(1);
    expect(readCatalystSlot(s.catalystSlots, InsightSlot.TelegraphCount)).toBe(0);
  });

  it('음성 대조: 내가 배선하지 않은 촉매(id 1)도 예고선을 안 세운다', () => {
    const s = armed([UNRELATED]);
    expect(telegraphs(s).length).toBe(0);
    expect(s.catalystMods.xp).toBe(1);
  });

  it('실으면 예고선이 실제로 서고 슬롯이 살아 있는 수를 든다', () => {
    const s = armed([INSIGHT]);
    const tg = telegraphs(s);
    expect(tg.length).toBe(1); // ⚠️ 하한 — 아래 단언들이 항진이 아니다
    const t = tg[0] as Entity;
    // 대가 축: 예고선은 **적과 플레이어 사이**에 선다 — 이득을 받으려면 위험한 자리로 간다.
    expect(t.x).toBeCloseTo(0, 6);
    expect(t.y).toBeCloseTo(0, 6);
    expect(t.damage).toBe(0); // 예고선 자체는 피해를 주지 않는다(순수 표식)
    expect(t.timer).toBe(TELEGRAPH_LEAD); // 발사까지 남은 시간이 곧 예고 시간이다
    // 슬롯은 **다음 틱**에 갱신된다(센 뒤에 낳으므로) — 그것까지 잠근다.
    growthOnTick(s, player(s));
    expect(readCatalystSlot(s.catalystSlots, InsightSlot.TelegraphCount)).toBe(1);
    expect(readCatalystSlot(s.catalystSlots, InsightSlot.TelegraphHead)).toBeGreaterThan(0);
  });

  it('이득: 예고선 위에 서 있는 동안만 XP 가 3배이고, 벗어나면 즉시 1 로 돌아온다', () => {
    const s = armed([INSIGHT]);
    expect(telegraphs(s).length).toBe(1); // 하한

    // 예고선 중심(0,0)에 서 있다.
    growthOnTick(s, player(s));
    expect(s.catalystMods.xp).toBe(3);

    // 벗어난다 — 배율이 즉시 꺼진다(단조가 아니다).
    player(s).x = 5000;
    growthOnTick(s, player(s));
    expect(s.catalystMods.xp).toBe(1);

    // 다시 들어온다 — 되돌아온다.
    player(s).x = 0;
    growthOnTick(s, player(s));
    expect(s.catalystMods.xp).toBe(3);
  });

  it('귀속: 밟으면 적립되고, 안 밟은 채 터지는 예고선은 **놓침**으로 잡힌다', () => {
    const s = armed([INSIGHT]);
    growthOnTick(s, player(s));
    const earned = s.catalystLedger?.find((r) => r.id === INSIGHT);
    expect(earned?.earned).toBeGreaterThan(0);

    // 예고선을 터지기 직전으로 밀고 플레이어를 치운다.
    const t = telegraphs(s)[0] as Entity;
    t.timer = 1;
    player(s).x = 5000;
    growthOnTick(s, player(s));
    expect(s.catalystLedger?.find((r) => r.id === INSIGHT)?.missed).toBeGreaterThan(0);
  });

  it('RNG 스트림 불변 — 예고선은 난수를 한 칸도 안 쓴다', () => {
    const base = world();
    const cat = world([INSIGHT]);
    for (const s of [base, cat]) {
      seedEnemy(s, TELEGRAPH_OFFSET, 0, TELEGRAPH_LEAD);
      for (let i = 0; i < 5; i++) growthOnTick(s, player(s));
    }
    expect(telegraphs(cat).length).toBeGreaterThan(0); // 하한 — 실제로 뭔가 했다
    expect(cat.waveRng.getState()).toBe(base.waveRng.getState());
    expect(cat.dropRng.getState()).toBe(base.dropRng.getState());
    expect(cat.powerupRng.getState()).toBe(base.powerupRng.getState());
  });
});

// ---------------------------------------------------------------------------
// ③ id 11 tutelage — 레벨 5 시작 · 3택 자동 확정
// ---------------------------------------------------------------------------

describe('id 11 tutelage', () => {
  /** idle 입력만으로 `n` 틱 굴린다(자동 픽이 실제로 프리즈를 푸는지 본다). */
  function driveIdle(s: WorldState, n: number): void {
    for (let i = 0; i < n; i++) stepWorld(s, idle);
  }

  it('음성 대조: 안 실으면 레벨 1 에서 시작하고 idle 로는 레벨업이 안 일어난다', () => {
    const s = world();
    driveIdle(s, 40);
    expect(s.level).toBe(1);
    expect(s.pendingLevelUp).toBe(false);
  });

  it('음성 대조: 무촉매 런은 픽 입력이 없으면 프리즈가 안 풀린다(자동 픽이 안 샌다)', () => {
    const s = world();
    s.xp = 1_000_000;
    stepWorld(s, idle);
    expect(s.pendingLevelUp).toBe(true);
    driveIdle(s, 10);
    expect(s.pendingLevelUp).toBe(true); // idle 로는 영영 안 풀린다
  });

  it('이득: 레벨 5 에서 시작하고 **레벨업이 다섯 번 실제로** 일어난다', () => {
    const s = world([TUTELAGE]);
    driveIdle(s, 40);
    expect(s.level).toBe(5);
    // 명세 `신호:` 칸 — 연출이 다섯 번 터져야 한다. 발동 횟수가 그 물증이다.
    expect(s.catalystLedger?.find((r) => r.id === TUTELAGE)?.fired).toBe(4);
    // 남은 XP 가 청소돼 6레벨이 공짜로 딸려 오지 않는다.
    expect(s.xp).toBeLessThan(1000);
    expect(s.pendingLevelUp).toBe(false);
  });

  it('대가: 3택이 자동 확정된다 — 프리즈가 픽 입력 없이 풀린다', () => {
    const s = world([TUTELAGE]);
    stepWorld(s, idle); // 레벨 2 + 3택 제시
    expect(s.level).toBe(2);
    expect(s.pendingLevelUp).toBe(true);
    const offered = [...s.powerupChoices];
    expect(offered.length).toBeGreaterThan(0); // 하한
    stepWorld(s, idle); // ⚠️ 픽 입력 없이도 소비된다
    expect(s.pendingLevelUp).toBe(false);
    expect(s.powerupChoices.length).toBe(0);
    // 고른 것은 **이미 뽑힌 결과의 첫 칸**이다(임의 상수가 아니다).
    expect(tutelageAutoPickIndex(world([TUTELAGE]))).toBe(-1); // 3택이 없으면 -1
    expect(offered[0]).toBeDefined();
  });

  it('⚠️⚠️ RNG 스트림 불변 — 같은 레벨업 수라면 3택도 스트림 위치도 무촉매와 동일하다', () => {
    /** 레벨업 → 픽 을 `n` 회 반복하고 3택 첫 칸 시퀀스와 스트림 위치를 돌려준다. */
    function drive(n: number, catalysts?: number[]): { firsts: number[]; rng: number } {
      const s = world(catalysts);
      const auto = catalysts !== undefined && catalysts.includes(TUTELAGE);
      const firsts: number[] = [];
      for (let k = 0; k < n; k++) {
        s.xp = 10_000_000;
        stepWorld(s, idle);
        expect(s.pendingLevelUp).toBe(true); // 하한 — 실제로 올랐다
        firsts.push(s.powerupChoices[0] as number);
        stepWorld(s, auto ? idle : pick); // 자동 픽 런은 idle 로도 소비된다
        expect(s.pendingLevelUp).toBe(false);
      }
      return { firsts, rng: s.powerupRng.getState() };
    }
    const base = drive(5);
    const cat = drive(5, [TUTELAGE]);
    expect(base.firsts.length).toBe(5);
    expect(cat.firsts).toEqual(base.firsts); // 재추첨이 없다
    expect(cat.rng).toBe(base.rng); // 스트림 위치가 한 칸도 안 밀렸다
  });
});

// ---------------------------------------------------------------------------
// ④ id 12 ascension — 웨이브 전환 대가 · 대시 관통 되돌림 · 등급 이득
// ---------------------------------------------------------------------------

describe('id 12 ascension', () => {
  it('음성 대조: 안 실으면 웨이브 전환도 대시 관통도 아무것도 안 바꾼다', () => {
    for (const cats of [undefined, [UNRELATED]]) {
      const s = world(cats);
      const p = player(s);
      const hp0 = p.maxHp;
      const dmg0 = s.weapon.damage;
      growthOnWaveAdvanced(s, 0, 1);
      const e = seedEnemy(s, 40, 0);
      growthOnDashPierce(s, p, e);
      expect(p.maxHp).toBe(hp0);
      expect(s.weapon.damage).toBe(dmg0);
      expect(growthOnLootRoll(s, 0, 0, true)).toEqual({ rarity: 1, count: 1 });
    }
  });

  it('대가: 웨이브를 넘기면 최대 HP 가 10% 깎이고 공격력이 10% 오른다', () => {
    const s = world([ASCENSION]);
    const p = player(s);
    const hp0 = p.maxHp;
    const dmg0 = s.weapon.damage;
    expect(hp0).toBeGreaterThan(0); // 하한
    growthOnWaveAdvanced(s, 0, 1);
    expect(p.maxHp).toBe(Math.round(hp0 * 0.9));
    expect(s.weapon.damage).toBeCloseTo(dmg0 * 1.1, 6);
    expect(p.hp).toBeLessThanOrEqual(p.maxHp); // 상한 밖으로 삐져나오지 않는다
  });

  it('⚠️ 되돌림: 대시 관통이 최대 HP 를 되돌리되 **적 hp 는 한 칸도 안 깎는다**', () => {
    const s = world([ASCENSION]);
    const p = player(s);
    growthOnWaveAdvanced(s, 0, 1);
    const cut = p.maxHp;
    expect(cut).toBeLessThan(s.config.playerHp); // 하한 — 실제로 깎였다

    const e = seedEnemy(s, 40, 0);
    const enemyHp = e.hp;
    growthOnDashPierce(s, p, e);
    // ⭐ 조작 코어 불변(사용자 판정 2026-08-08) — 대시는 피해를 주지 않는다.
    expect(e.hp).toBe(enemyHp);
    expect(e.dead).toBe(false);
    expect(p.maxHp).toBe(cut + 1);
  });

  it('단조 감소가 아니다 — 깎였다가 돌아오고, 기준선을 넘어서지는 않는다', () => {
    const s = world([ASCENSION]);
    const p = player(s);
    const base = s.config.playerHp;
    growthOnWaveAdvanced(s, 0, 1);
    growthOnWaveAdvanced(s, 1, 2);
    const low = p.maxHp;
    expect(low).toBeLessThan(base);
    const e = seedEnemy(s, 40, 0);
    for (let i = 0; i < 10_000; i++) growthOnDashPierce(s, p, e);
    expect(p.maxHp).toBeGreaterThan(low); // 되돌아왔다
    expect(p.maxHp).toBe(base); // 기준선에서 멈춘다(순이득이 되지 않는다)
    expect(e.hp).toBe(100); // 1만 번 통과해도 적은 멀쩡하다
  });

  it('이득: 넘긴 웨이브 수만큼 전리품 등급 배율이 오르고 2.0 에서 멈춘다', () => {
    const s = world([ASCENSION]);
    s.wave.segmentIndex = 0;
    expect(growthOnLootRoll(s, 0, 0, false).rarity).toBe(1);
    s.wave.segmentIndex = 4;
    expect(growthOnLootRoll(s, 0, 0, false).rarity).toBe(1.5);
    s.wave.segmentIndex = 99;
    expect(growthOnLootRoll(s, 0, 0, false).rarity).toBe(2);
    // 개수 축은 이 카드의 몫이 아니다(중립 유지).
    expect(growthOnLootRoll(s, 0, 0, false).count).toBe(1);
  });

  it('RNG 스트림 불변 — 세 축 다 난수를 안 쓴다', () => {
    const s = world([ASCENSION]);
    const w0 = s.waveRng.getState();
    const d0 = s.dropRng.getState();
    const p0 = s.powerupRng.getState();
    const e = seedEnemy(s, 40, 0);
    growthOnWaveAdvanced(s, 0, 1);
    growthOnDashPierce(s, player(s), e);
    growthOnLootRoll(s, 0, 0, true);
    expect(s.waveRng.getState()).toBe(w0);
    expect(s.dropRng.getState()).toBe(d0);
    expect(s.powerupRng.getState()).toBe(p0);
  });
});

// ---------------------------------------------------------------------------
// ⑤ id 13 enlightenment — 적이 적을수록 탄이 커진다 · 급행 소환 두 배
// ---------------------------------------------------------------------------

describe('id 13 enlightenment', () => {
  /** 적을 `n` 마리로 맞추고 한 틱 돌린 뒤 탄 반경을 돌려준다. */
  function radiusWith(s: WorldState, n: number): number {
    for (const e of s.entities) if (e.kind === 'enemy') e.dead = true;
    s.entities = s.entities.filter((e) => e.kind !== 'enemy' || !e.dead);
    for (let i = 0; i < n; i++) seedEnemy(s, 400 + i * 10, 0);
    growthOnTick(s, player(s));
    return s.weapon.bulletRadius;
  }

  it('음성 대조: 안 실으면 탄 반경도 급행 계단도 그대로다', () => {
    for (const cats of [undefined, [UNRELATED]]) {
      const s = world(cats);
      expect(radiusWith(s, 0)).toBe(DEFAULT_WEAPON.bulletRadius);
      expect(radiusWith(s, 30)).toBe(DEFAULT_WEAPON.bulletRadius);
      expect(enlightenmentRushStepMult(s)).toBe(1);
    }
  });

  it('이득: 화면이 비면 탄이 3배, 가득 차면 1배다', () => {
    const s = world([ENLIGHTENMENT]);
    expect(radiusWith(s, 0)).toBe(DEFAULT_WEAPON.bulletRadius * 3);
    expect(radiusWith(s, 24)).toBe(DEFAULT_WEAPON.bulletRadius);
    expect(radiusWith(s, 100)).toBe(DEFAULT_WEAPON.bulletRadius); // 문턱 위는 안 작아진다
  });

  it('⚠️ 단조가 아니다 — 적이 다시 차면 탄이 도로 가늘어지고, 비면 또 굵어진다', () => {
    const s = world([ENLIGHTENMENT]);
    const empty = radiusWith(s, 0);
    const full = radiusWith(s, 24);
    const again = radiusWith(s, 0);
    const mid = radiusWith(s, 12);
    expect(empty).toBeGreaterThan(full); // 하한
    expect(again).toBe(empty); // 되돌아온다
    expect(mid).toBeGreaterThan(full);
    expect(mid).toBeLessThan(empty); // 연속 함수다
  });

  it('대가: 급행 소환 계단이 두 배다', () => {
    expect(enlightenmentRushStepMult(world([ENLIGHTENMENT]))).toBe(2);
  });

  it('RNG 스트림 불변 — 크기 파생은 난수를 안 쓴다', () => {
    const s = world([ENLIGHTENMENT]);
    const w0 = s.waveRng.getState();
    const d0 = s.dropRng.getState();
    const p0 = s.powerupRng.getState();
    radiusWith(s, 3);
    radiusWith(s, 0);
    expect(s.weapon.bulletRadius).toBeGreaterThan(DEFAULT_WEAPON.bulletRadius); // 하한
    expect(s.waveRng.getState()).toBe(w0);
    expect(s.dropRng.getState()).toBe(d0);
    expect(s.powerupRng.getState()).toBe(p0);
  });

  it('슬롯을 한 칸도 안 쓴다(틱의 순수 파생이라 저장하면 §B 가 된다)', () => {
    const s = world([ENLIGHTENMENT]);
    radiusWith(s, 5);
    expect(s.catalystSlots.every((v) => v === 0)).toBe(true);
  });
});
