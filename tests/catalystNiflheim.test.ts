/**
 * 촉매 **니플헤임 특산**(id 36~38)의 배선 계측 — `src/sim/catalyst/niflheim.ts`.
 *
 * ## 왜 앵커를 **직접** 부르는가 (전 런 대조를 안 쓴다)
 * 이 셋은 적 이동·대피소 상태·보스 좌표를 바꾸므로 전개 자체가 갈리고, 그러면 `dropRng`/
 * `waveRng` 가 **정당하게** 달라진다 — 전 런 대조는 결함이 아니라 카드가 작동한다는 사실을
 * 잡아 빨개진다. 그래서 잰다: **앵커 하나가 자기 스트림을 소비하는가**를 호출 전후의
 * `getState()` 로 직접 본다(헌장 §공통-B 재롤 금지가 실제로 요구하는 축).
 *
 * ## 음성 대조의 형태 — `catalysts: [OTHER_CARD]`
 * `catalysts: []` 와 비교하면 `catalystOn` 게이트만 재고 **카드 소지 게이트(`carries`)는 못
 * 잰다**. 그래서 음성 대조는 **다른 카드 한 장을 실은 런**이다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import { addEntity, blankEntity } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import { readMark } from '../src/sim/catalystMarks.js';
import { PursuitSlot, readCatalystSlot } from '../src/sim/catalystSlots.js';
import { isCatalystHazard, isCatalystShadow } from '../src/sim/catalyst/shared.js';
import { countEnemies } from '../src/sim/waves.js';
import { isShelter, isShelterSecured } from '../src/sim/modes/chase.js';
import {
  CARD_NIFLHEIM_FLAGSHIP,
  CARD_NIFLHEIM_PURSUIT,
  CARD_NIFLHEIM_RIME_CRYSTAL,
  flagshipShotdowns,
  niflheimOnEnemyContact,
  niflheimOnEnemyStep,
  niflheimOnLootRoll,
  niflheimOnTick,
} from '../src/sim/catalyst/niflheim.js';

/** 다른 결의 카드 한 장만 실은 런 — `carries` 게이트의 음성 대조용. */
const OTHER_CARD = 1;

function world(cards: number[]): WorldState {
  return createWorld(0xca7a, {
    ...DEFAULT_CONFIG,
    catalysts: cards,
    planet: 2,
    planetMode: PLANET_MODE.chase,
  });
}

function player(state: WorldState): Entity {
  const p = state.entities[0];
  if (p === undefined) throw new Error('player missing');
  return p;
}

function enemy(state: WorldState, x: number, y: number): Entity {
  const e = blankEntity('enemy');
  e.x = x;
  e.y = y;
  // ⚠️ `blankEntity` 의 `enemyType` 기본값은 `-1` 이라 `enemyDefFor` 가 `undefined` 를 낸다.
  e.enemyType = 0;
  e.hp = 10;
  e.maxHp = 10;
  return addEntity(state, e);
}

/**
 * ⚠️ **추격 런은 `createWorld` 가 이미 포식자 1기 + 대피소 10곳을 깐다**(`placeChaseCourse`).
 * 테스트가 따로 세우면 `boss` kind 가 둘이 되어 "한 기만 잡아도 승리"라는 **검사 대상 결함을
 * 테스트가 스스로 만든다**. 그래서 무대의 것을 그대로 쓴다.
 */
function predatorOf(state: WorldState): Entity {
  const b = state.entities.find((e) => !e.dead && e.kind === 'boss');
  if (b === undefined) throw new Error('predator missing');
  return b;
}

/** 무대가 깐 대피소를 전부 확보 상태로 만든다(기함이 부술 대상이 있어야 한다). */
function secureAll(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) {
    if (e.dead || !isShelter(e)) continue;
    e.aux1 = 1;
    n++;
  }
  return n;
}

function shadowOf(state: WorldState): Entity | undefined {
  return state.entities.find((e) => !e.dead && e.kind === 'enemy' && readMark(e, 'shadow') !== 0);
}

function securedCount(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) if (!e.dead && isShelter(e) && isShelterSecured(e)) n++;
  return n;
}

function rngState(state: WorldState): string {
  return [
    state.dropRng.getState(),
    state.waveRng.getState(),
    state.powerupRng.getState(),
  ].join('|');
}

/** 틱을 n 번 돌린다(앵커 직접 호출 — `stepWorld` 전개를 타지 않는다). */
function runTicks(state: WorldState, n: number): void {
  for (let i = 0; i < n; i++) {
    niflheimOnTick(state, player(state));
    state.tick++;
  }
}

// ---------------------------------------------------------------------------
describe('id 36 niflheim-pursuit — 그림자', () => {
  it('음성 대조: 다른 카드만 실은 런은 그림자도 부스러기도 안 만든다', () => {
    const s = world([OTHER_CARD]);
    runTicks(s, 600);
    expect(shadowOf(s)).toBeUndefined();
    expect(s.entities.filter((e) => !e.dead && isCatalystHazard(e))).toHaveLength(0);
  });

  it('그림자는 일반 적 kind + 마커다 — `boss` kind 가 늘지 않는다', () => {
    const s = world([CARD_NIFLHEIM_PURSUIT]);
    runTicks(s, 600);
    const sh = shadowOf(s);
    expect(sh).toBeDefined();
    expect(sh?.kind).toBe('enemy');
    // ⭐ boss kind 하나가 죽으면 그 자리에서 런 승리다 — 둘이 되면 한 기만 잡아도 끝난다.
    expect(s.entities.filter((e) => !e.dead && e.kind === 'boss')).toHaveLength(1);
  });

  it('제외 3목록 ① 피해 — 그림자는 아군탄·촉매 해저드에 안 맞는다', () => {
    const s = world([CARD_NIFLHEIM_PURSUIT]);
    runTicks(s, 600);
    const sh = shadowOf(s);
    expect(sh).toBeDefined();
    // 두 자리 모두 이 술어 하나를 본다(`world.ts` 아군탄 루프 · `stepCatalystHazards`).
    expect(isCatalystShadow(sh as Entity)).toBe(true);
  });

  it('제외 3목록 ② 조준 — `isPlayerTargetable` 이 그림자를 거른다', () => {
    // `isPlayerTargetable` 은 비수출이라 소스에서 쌍 유지를 확인한다. 이 단언이 빠지면
    // 자동조준이 **죽일 수 없는 그림자를 물어** 니플헤임 런이 통째로 망가진다.
    const src: string = readFileSync(fileURLToPath(new URL('../src/sim/world.ts', import.meta.url)), 'utf8');
    const fn: string = src.slice(src.indexOf('function isPlayerTargetable'));
    expect(fn.slice(0, fn.indexOf('\n}')).includes('isCatalystShadow(e)')).toBe(true);
  });

  it('제외 3목록 ③ 적 수 — `countEnemies` 가 그림자를 안 센다', () => {
    const s = world([CARD_NIFLHEIM_PURSUIT]);
    runTicks(s, 600);
    const sh = shadowOf(s);
    expect(sh).toBeDefined();
    const withShadow = countEnemies(s);
    (sh as Entity).aux0 = 0; // 마커만 지운다(엔티티는 그대로).
    expect(countEnemies(s)).toBe(withShadow + 1);
  });

  it('이득과 대가: 확보 반경이 넓어지고, 따돌린 확보만 적립된다', () => {
    // ── 대가 없이 확보(그림자 없음) → 적립 ──
    const s = world([CARD_NIFLHEIM_PURSUIT]);
    const sh0 = blankEntity('shelter');
    sh0.x = 250; // 기본 반경 140 + 플레이어 반경 밖. 2배 반경이라야 닿는다.
    sh0.y = 0;
    sh0.radius = 140;
    addEntity(s, sh0);
    const before = s.resources;
    niflheimOnTick(s, player(s));
    expect(sh0.aux1).toBe(1);
    expect(s.resources).toBeGreaterThan(before);
    expect(s.catalystLedger?.find((r) => r.id === CARD_NIFLHEIM_PURSUIT)?.earned ?? 0).toBeGreaterThan(0);
  });

  it('그림자가 반경 안이면 적립이 없고 **놓침**이 적힌다', () => {
    const s = world([CARD_NIFLHEIM_PURSUIT]);
    runTicks(s, 600);
    const sh = shadowOf(s);
    expect(sh).toBeDefined();
    const target = blankEntity('shelter');
    target.x = (sh as Entity).x;
    target.y = (sh as Entity).y;
    target.radius = 140;
    addEntity(s, target);
    // 대피소를 그림자 자리에 두고 플레이어를 그 위로 옮긴다.
    player(s).x = target.x;
    player(s).y = target.y;
    const before = s.resources;
    niflheimOnTick(s, player(s));
    expect(target.aux1).toBe(1);
    expect(s.resources).toBe(before);
    expect(s.catalystLedger?.find((r) => r.id === CARD_NIFLHEIM_PURSUIT)?.missed ?? 0).toBeGreaterThan(0);
  });

  it('그림자 접촉은 즉사다', () => {
    const s = world([CARD_NIFLHEIM_PURSUIT]);
    runTicks(s, 600);
    const sh = shadowOf(s);
    expect(sh).toBeDefined();
    const p = player(s);
    p.hp = 500;
    niflheimOnEnemyContact(s, p, sh as Entity);
    expect(p.hp).toBe(0);
  });

  it('경로 큐가 실제로 차고(달리는 동안) 소비된다(멈추면)', () => {
    const s = world([CARD_NIFLHEIM_PURSUIT]);
    // 달리는 동안은 부스러기가 쌓인다 — 그림자가 못 따라잡는다(속도가 더 느리다).
    const p = player(s);
    for (let i = 0; i < 600; i++) {
      p.x += 12; // 플레이어 기본 720 u/s = 12 u/tick.
      niflheimOnTick(s, p);
      s.tick++;
    }
    expect(readCatalystSlot(s.catalystSlots, PursuitSlot.PathCount)).toBeGreaterThan(0);
    expect(shadowOf(s)).toBeDefined();
    // 멈추면 그림자가 궤적을 따라와 큐를 소비한다.
    runTicks(s, 600);
    expect(readCatalystSlot(s.catalystSlots, PursuitSlot.PathHead)).toBeGreaterThan(0);
  });

  it('RNG 스트림을 한 칸도 안 민다', () => {
    const s = world([CARD_NIFLHEIM_PURSUIT]);
    const before = rngState(s);
    runTicks(s, 900);
    expect(rngState(s)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
describe('id 37 niflheim-rime-crystal — 서리 궤적', () => {
  it('음성 대조: 다른 카드만 실은 런은 서리를 안 깐다', () => {
    const s = world([OTHER_CARD]);
    runTicks(s, 60);
    expect(s.entities.filter((e) => !e.dead && isCatalystHazard(e))).toHaveLength(0);
  });

  it('스폰만이 아니라 **적이 실제로 느려진다**', () => {
    const s = world([CARD_NIFLHEIM_RIME_CRYSTAL]);
    niflheimOnTick(s, player(s));
    const rime = s.entities.find((e) => !e.dead && isCatalystHazard(e));
    expect(rime).toBeDefined();
    const onIce = enemy(s, (rime as Entity).x, (rime as Entity).y);
    const offIce = enemy(s, 99999, 99999);
    expect(niflheimOnEnemyStep(s, onIce)).toBeLessThan(1);
    expect(niflheimOnEnemyStep(s, offIce)).toBe(1);
  });

  it('포식자는 **반대 방향**이다 — 얼음 위에서 가속한다', () => {
    const s = world([CARD_NIFLHEIM_RIME_CRYSTAL]);
    const p = player(s);
    niflheimOnTick(s, p); // 플레이어 자리에 서리(반경 150).
    const b = predatorOf(s);
    // ── 얼음 밖: 이 앵커는 포식자를 한 유닛도 안 옮긴다(기본 추격은 `chase.ts` 소관) ──
    b.x = p.x + 4000;
    b.y = p.y;
    const offBefore = b.x;
    niflheimOnTick(s, p);
    expect(b.x).toBe(offBefore);
    // ── 얼음 위: **가속분만큼** 플레이어 쪽으로 더 간다(잡몹 감속과 방향이 반대다) ──
    b.x = p.x + 100; // 서리 반경 안.
    b.y = p.y;
    const d0 = Math.hypot(b.x - p.x, b.y - p.y);
    niflheimOnTick(s, p);
    const d1 = Math.hypot(b.x - p.x, b.y - p.y);
    expect(d1).toBeLessThan(d0);
  });

  it('서리 위에서 죽으면 등급이 오른다(상한 축 = 희귀도)', () => {
    const s = world([CARD_NIFLHEIM_RIME_CRYSTAL]);
    const p = player(s);
    niflheimOnTick(s, p);
    expect(niflheimOnLootRoll(s, p.x, p.y, true).rarity).toBeGreaterThan(1);
    expect(niflheimOnLootRoll(s, 99999, 99999, true).rarity).toBe(1);
  });

  it('궤적이 폭증하지 않는다 — 제자리에서는 한 장뿐', () => {
    const s = world([CARD_NIFLHEIM_RIME_CRYSTAL]);
    runTicks(s, 300);
    expect(s.entities.filter((e) => !e.dead && isCatalystHazard(e))).toHaveLength(1);
  });

  it('RNG 스트림을 한 칸도 안 민다', () => {
    const s = world([CARD_NIFLHEIM_RIME_CRYSTAL]);
    const before = rngState(s);
    runTicks(s, 600);
    expect(rngState(s)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
describe('id 38 niflheim-flagship — 기함', () => {
  it('음성 대조: 다른 카드만 실은 런은 기함을 안 띄우고 대피소도 안 부순다', () => {
    const s = world([OTHER_CARD]);
    const total = secureAll(s);
    runTicks(s, 3000);
    expect(securedCount(s)).toBe(total);
  });

  it('기함은 일반 적 kind + 마커다 — 포식자가 남는다', () => {
    const s = world([CARD_NIFLHEIM_FLAGSHIP]);
    secureAll(s);
    const predator = predatorOf(s);
    runTicks(s, 2000);
    const flag = s.entities.find((e) => !e.dead && e.kind === 'enemy' && readMark(e, 'flagship') !== 0);
    expect(flag).toBeDefined();
    // ⭐ 포식자를 기함으로 **대체하지 않는다**(초판이 추격 모드의 정체성을 교체한 지점).
    expect(predator.dead).toBe(false);
    expect(s.entities.filter((e) => !e.dead && e.kind === 'boss')).toHaveLength(1);
  });

  it('⭐ 교착 없음 — **자원이 0 이어도** 대피소가 전량으로 돌아온다', () => {
    const s = world([CARD_NIFLHEIM_FLAGSHIP]);
    const total = secureAll(s);
    s.resources = 0;
    let brokenPeak = 0;
    let breaks = 0;
    let run = 0;
    let longestBrokenRun = 0;
    let fullAfterFirstBreak = 0;
    for (let i = 0; i < 20000; i++) {
      niflheimOnTick(s, player(s));
      s.tick++;
      s.resources = 0; // ⭐ 자원을 매 틱 0 으로 되돌린다(재건 자금이 영영 없는 최악).
      const broken = s.entities.filter((e) => !e.dead && isShelter(e) && e.aux1 === 2).length;
      if (broken > brokenPeak) brokenPeak = broken;
      if (broken > 0) {
        if (run === 0) breaks++;
        run++;
        if (run > longestBrokenRun) longestBrokenRun = run;
      } else {
        run = 0;
        if (breaks > 0 && securedCount(s) === total) fullAfterFirstBreak++;
      }
    }
    expect(breaks).toBeGreaterThan(1); // 대가가 반복해서 일어났다(1회성이 아니다).
    expect(brokenPeak).toBe(1); // 동시에 부서지는 것은 **최대 하나**.
    // ⭐ 교착 없음의 실증 셋:
    //  ① 부서진 상태가 유한하다(자원 0 인데도 복구가 반드시 끝난다).
    expect(longestBrokenRun).toBeLessThanOrEqual(400);
    //  ② 부서진 뒤에도 **전량 확보 상태로 되돌아온 틱이 압도적으로 많다** — 마지막 일반
    //     세그먼트(전량 요구)에 도달할 창이 계속 열려 있다.
    expect(fullAfterFirstBreak).toBeGreaterThan(10000);
    //  ③ 마지막 파괴 뒤 복구 시간을 주면 전량으로 돌아온다.
    runTicks(s, 400);
    expect(securedCount(s)).toBe(total);
  });

  it('격추하면 포식자가 취약해지고 격추 수가 기록된다(드랍 배율의 유일 근거)', () => {
    const s = world([CARD_NIFLHEIM_FLAGSHIP]);
    secureAll(s);
    const predator = predatorOf(s);
    runTicks(s, 1900);
    const flag = s.entities.find((e) => !e.dead && e.kind === 'enemy' && readMark(e, 'flagship') !== 0);
    expect(flag).toBeDefined();
    expect(predator.aux0).toBe(0); // 아직 무적.
    (flag as Entity).dead = true; // 격추.
    runTicks(s, 2);
    expect(flagshipShotdowns(s)).toBe(1);
    expect(predator.aux0).toBe(1); // 즉시 취약.
  });

  it('RNG 스트림을 한 칸도 안 민다', () => {
    const s = world([CARD_NIFLHEIM_FLAGSHIP]);
    secureAll(s);
    const before = rngState(s);
    runTicks(s, 3000);
    expect(rngState(s)).toBe(before);
  });
});
