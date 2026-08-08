/**
 * 촉매 **파워 결**(id 25~29)의 배선 계측 — `src/sim/catalyst/power.ts`.
 *
 * ## 왜 앵커를 **직접** 부르는가 (전 런 대조를 안 쓴다)
 * 이 그룹의 다섯 장은 전부 적 hp·최대 HP·탄을 바꾸므로 전개 자체가 갈리고, 그러면
 * `dropRng`/`waveRng` 가 **정당하게** 달라진다. 즉 "런 두 개의 스트림 비교"는 결함이 아니라
 * 카드가 작동한다는 사실을 잡아 빨개진다. 그래서 잰다: **앵커 하나가 자기 스트림을 소비하는가**
 * 를 앵커 호출 전후 `getState()` 로 직접 본다(정련 결 레인과 같은 형태).
 *
 * ## 음성 대조의 형태 — `catalysts: [OTHER_CARD]`
 * `catalysts: []` 와 비교하면 `catalystOn` 게이트만 재고 **카드 소지 게이트(`carries`)는 못
 * 잰다** — 그 게이트가 빠지면 아무 촉매 한 장에 그룹 전체가 발동하는데 빈 배열 대조는 그것을
 * 통과시킨다. 그래서 음성 대조는 **다른 결의 카드 한 장을 실은 런**이다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, DEFAULT_CONFIG, FIRE_CD_Q } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import { addEntity, blankEntity } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { readMark, writeMark } from '../src/sim/catalystMarks.js';
import {
  AfterburnerSlot,
  BulwarkSlot,
  OverdriveSlot,
  RapidcoreSlot,
  readCatalystSlot,
  writeCatalystSlot,
} from '../src/sim/catalystSlots.js';
import { enemyStatusStopMult } from '../src/sim/status.js';
import {
  CARD_AFTERBURNER,
  CARD_ASCENDANT,
  CARD_BULWARK,
  CARD_OVERDRIVE,
  CARD_RAPIDCORE,
  powerOnCatalystHazards,
  powerOnDashFired,
  powerOnDashPierce,
  powerOnEnemyContact,
  powerOnEnemyDamaged,
  powerOnLootRoll,
  powerOnPlayerDamaged,
  powerOnResourceGranted,
  powerOnTick,
  powerOnVolleyFired,
  powerOnVolleyParams,
} from '../src/sim/catalyst/power.js';
import type { VolleyParams } from '../src/sim/skillHooks.js';

/** 다른 결의 카드 한 장만 실은 런 — `carries` 게이트의 음성 대조용. */
const OTHER_CARD = 1;

/**
 * 볼리 레코드 한 벌. **`damage` 만 이 테스트의 관심사**이고 나머지는 호출부가 채우는 값의
 * 자리만 맞춘 것이다(앵커가 그 칸들을 안 읽는다).
 */
function volleyOf(damage: number): VolleyParams {
  return {
    damage,
    pierce: 0,
    count: 1,
    speed: 12,
    radius: 4,
    life: 60,
    spread: 0,
    cooldownQ: FIRE_CD_Q,
    countUsed: true,
    ballisticsUsed: true,
    targetDist: 100,
    aimAngle: 0,
    inputX: 0,
    inputY: 0,
    cloakBreak: false,
    mark: 0,
    leadDamageBonus: 0,
    leadPierceBonus: 0,
    recordSpawnDamage: false,
  };
}

function world(cards: number[]): WorldState {
  return createWorld(0xca7a, { ...DEFAULT_CONFIG, catalysts: cards });
}

function playerOf(state: WorldState): Entity {
  const p = state.entities[0];
  if (p === undefined) throw new Error('entities[0] 이 플레이어가 아니다');
  return p;
}

function enemy(state: WorldState, x: number, y: number, hp = 100): Entity {
  const e = blankEntity('enemy');
  e.x = x;
  e.y = y;
  // ⚠️ `blankEntity` 의 `enemyType` 기본값은 `-1` 이라 `enemyDefFor` 가 `undefined` 를 낸다.
  // 앵커를 직접 부르는 파일이지만 실런과 같은 모양으로 세워 둔다.
  e.enemyType = 0;
  e.hp = hp;
  e.maxHp = hp;
  return addEntity(state, e);
}

function bullet(state: WorldState, kind: 'bullet' | 'enemyBullet', x: number, y: number): Entity {
  const b = blankEntity(kind);
  b.x = x;
  b.y = y;
  b.radius = 5;
  return addEntity(state, b);
}

/** 세 스트림의 위치를 한 번에 뜬다 — 앵커가 난수를 한 칸이라도 소비하면 값이 달라진다. */
function rngState(state: WorldState): string {
  return [
    state.dropRng.getState(),
    state.waveRng.getState(),
    state.powerupRng.getState(),
  ].join('/');
}

// ---------------------------------------------------------------------------
// 공통 — RNG 불변 · 음성 대조
// ---------------------------------------------------------------------------

describe('파워 결 — 공통 계약', () => {
  it('전 앵커가 dropRng·waveRng·powerupRng 를 한 칸도 소비하지 않는다', () => {
    const s = world([CARD_OVERDRIVE, CARD_RAPIDCORE, CARD_AFTERBURNER]);
    const p = playerOf(s);
    const e = enemy(s, p.x + 40, p.y);
    const before = rngState(s);
    powerOnTick(s, p);
    powerOnVolleyFired(s, p);
    powerOnDashFired(s, p);
    powerOnDashPierce(s, p, e);
    powerOnEnemyDamaged(s, e, 10, p);
    powerOnPlayerDamaged(s, p, 5, false, 0);
    powerOnResourceGranted(s, 7, p.x, p.y);
    powerOnCatalystHazards(s);
    powerOnLootRoll(s, e.x, e.y, true);
    expect(rngState(s)).toBe(before);
  });

  it('안 실으면 전 앵커가 무연산이다 — 슬롯·표식·최대 HP 가 그대로다', () => {
    const s = world([OTHER_CARD]);
    const p = playerOf(s);
    const maxHp0 = p.maxHp;
    const cd0 = p.dashCooldown;
    const e = enemy(s, p.x + 40, p.y);
    for (let i = 0; i < 200; i++) {
      powerOnTick(s, p);
      powerOnVolleyFired(s, p);
    }
    p.iframes = 10;
    powerOnDashFired(s, p);
    powerOnDashPierce(s, p, e);
    powerOnEnemyDamaged(s, e, 10, p);
    powerOnPlayerDamaged(s, p, 5, false, 0);
    powerOnResourceGranted(s, 7, p.x, p.y);
    expect(p.maxHp).toBe(maxHp0);
    expect(p.dashCooldown).toBe(cd0);
    expect(e.hp).toBe(100);
    expect(e.aux0).toBe(0);
    expect(e.life).toBe(-1);
    expect([...s.catalystSlots]).toEqual(new Array<number>(s.catalystSlots.length).fill(0));
  });
});

// ---------------------------------------------------------------------------
// id 25 overdrive
// ---------------------------------------------------------------------------

describe('id 25 overdrive — 열 → 피해 → 침묵이 한 곡선이다', () => {
  it('볼리마다 열이 오르고, 뜨거울수록 **주무기 피해**가 커진다 (볼리 앵커가 정본이다)', () => {
    // ⭐ 종전에는 이 단언이 `powerOnEnemyDamaged`(명중 직후)를 쟀다. 그 자리는 `dead` 가 이미
    //    선 뒤라 관통·과잉피해 의미가 실제 무기 강화와 갈렸다 — 이제 볼리 파라미터 앵커가
    //    정본이다. 곡선(열 → 피해 상승 → 임계 침묵)이 한 줄로 이어지는 것은 그대로 잰다.
    const s = world([CARD_OVERDRIVE]);
    const p = playerOf(s);

    // 차가운 총열 — 배율 0 이라 레코드가 **한 비트도 안 바뀐다**.
    const cold = volleyOf(10);
    powerOnVolleyParams(s, p, cold);
    expect(cold.damage).toBe(10);

    for (let i = 0; i < 30; i++) powerOnVolleyFired(s, p);
    expect(readCatalystSlot(s.catalystSlots, OverdriveSlot.Heat)).toBe(30);

    // 열 30/60 = 배율 0.5 → 피해 10 에 추가 5.
    const warm = volleyOf(10);
    powerOnVolleyParams(s, p, warm);
    expect(warm.damage).toBe(15);

    // 열 59/60 이면 추가가 더 크다(단조 증가).
    for (let i = 0; i < 29; i++) powerOnVolleyFired(s, p);
    const hot = volleyOf(10);
    powerOnVolleyParams(s, p, hot);
    expect(hot.damage).toBeGreaterThan(warm.damage);
  });

  it('명중 앵커는 더 이상 id 25 로 피해를 얹지 않는다 (이중 계상 방지)', () => {
    // 옮긴 뒤 옛 자리를 안 지우면 **같은 열이 두 번** 실려 카드가 조용히 두 배가 된다.
    const s = world([CARD_OVERDRIVE]);
    const p = playerOf(s);
    for (let i = 0; i < 30; i++) powerOnVolleyFired(s, p);
    const target = enemy(s, p.x + 40, p.y);
    powerOnEnemyDamaged(s, target, 10, p);
    expect(target.hp, 'id 25 가 명중 앵커에도 남아 있다').toBe(100);
  });

  it('임계를 넘기면 열이 0 으로 돌아가고 3초 침묵이 선다 — 침묵이 실제로 발사를 멎게 한다', () => {
    const s = world([CARD_OVERDRIVE]);
    const p = playerOf(s);
    for (let i = 0; i < 60; i++) powerOnVolleyFired(s, p);
    expect(readCatalystSlot(s.catalystSlots, OverdriveSlot.Heat)).toBe(0);
    expect(readCatalystSlot(s.catalystSlots, OverdriveSlot.SilenceTicks)).toBe(180);

    // `autoAttack` 의 첫 두 줄과 같은 산술: `cooldown -= FIRE_CD_Q` 뒤에도 양수여야 멎는다.
    p.cooldown = 0;
    powerOnTick(s, p);
    expect(p.cooldown - FIRE_CD_Q).toBeGreaterThan(0);
    expect(readCatalystSlot(s.catalystSlots, OverdriveSlot.SilenceTicks)).toBe(179);

    // 침묵은 스스로 풀린다(되돌릴 수 없는 숨은 카운트다운이 아니다).
    for (let i = 0; i < 179; i++) powerOnTick(s, p);
    expect(readCatalystSlot(s.catalystSlots, OverdriveSlot.SilenceTicks)).toBe(0);
    p.cooldown = 0;
    powerOnTick(s, p);
    expect(p.cooldown).toBe(0);
  });

  it('쏘지 않으면 식는다 — 열이 단조 증가가 아니다', () => {
    const s = world([CARD_OVERDRIVE]);
    const p = playerOf(s);
    for (let i = 0; i < 10; i++) powerOnVolleyFired(s, p);
    expect(readCatalystSlot(s.catalystSlots, OverdriveSlot.Heat)).toBe(10);
    for (let t = 0; t < 120; t++) {
      s.tick = t;
      powerOnTick(s, p);
    }
    expect(readCatalystSlot(s.catalystSlots, OverdriveSlot.Heat)).toBeLessThan(10);
  });

  it('백열에서만 자원이 두 배이고, 미달분은 놓친 액수로 적힌다', () => {
    const cool = world([CARD_OVERDRIVE]);
    const r0 = cool.resources;
    powerOnResourceGranted(cool, 20, 0, 0);
    expect(cool.resources).toBe(r0);
    expect(cool.catalystLedger?.find((r) => r.id === CARD_OVERDRIVE)?.missed).toBe(20);

    const hot = world([CARD_OVERDRIVE]);
    writeCatalystSlot(hot.catalystSlots, OverdriveSlot.Heat, 50);
    const r1 = hot.resources;
    powerOnResourceGranted(hot, 20, 0, 0);
    expect(hot.resources).toBe(r1 + 20);
    expect(hot.catalystLedger?.find((r) => r.id === CARD_OVERDRIVE)?.earned).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// id 26 rapidcore
// ---------------------------------------------------------------------------

describe('id 26 rapidcore — 입력으로 판정하고 피격이 초기화한다', () => {
  it('감속 장판 위(속도 크기가 줄어도)에서 유지 카운터가 안 끊긴다', () => {
    const s = world([CARD_RAPIDCORE]);
    const p = playerOf(s);
    // 같은 입력 방향(+x)인데 배율만 갈린 두 구간 — 방향 코드는 같아야 한다.
    p.vx = 300;
    p.vy = 0;
    // 첫 틱은 방향을 **세우는** 틱이라 카운터가 0 에서 시작한다 → 30틱에 29.
    for (let i = 0; i < 30; i++) powerOnTick(s, p);
    expect(readCatalystSlot(s.catalystSlots, RapidcoreSlot.HeldTicks)).toBe(29);
    p.vx = 12; // 감속 장판 · 이속 모듈 — 크기만 1/25 로 줄었다.
    for (let i = 0; i < 30; i++) powerOnTick(s, p);
    expect(readCatalystSlot(s.catalystSlots, RapidcoreSlot.HeldTicks)).toBe(59);
  });

  it('방향을 꺾으면 다시 세고, 유지가 길수록 볼리 피해가 커진다', () => {
    const s = world([CARD_RAPIDCORE]);
    const p = playerOf(s);
    p.vx = 300;
    p.vy = 0;
    for (let i = 0; i < 90; i++) powerOnTick(s, p);
    const half = volleyOf(10);
    powerOnVolleyParams(s, p, half);
    expect(half.damage).toBe(15); // 유지 89/180 = 배율 0.494 → 추가 5

    p.vx = 0;
    p.vy = 300;
    powerOnTick(s, p);
    expect(readCatalystSlot(s.catalystSlots, RapidcoreSlot.HeldTicks)).toBe(0);
    const cold = volleyOf(10);
    powerOnVolleyParams(s, p, cold);
    expect(cold.damage).toBe(10);
  });

  it('명중 앵커는 더 이상 id 26 으로 피해를 얹지 않는다 (이중 계상 방지)', () => {
    // 옮긴 뒤 옛 자리를 안 지우면 **같은 유지가 두 번** 실려 카드가 조용히 두 배가 된다.
    const s = world([CARD_RAPIDCORE]);
    const p = playerOf(s);
    p.vx = 300;
    p.vy = 0;
    for (let i = 0; i < 90; i++) powerOnTick(s, p);
    const target = enemy(s, p.x + 40, p.y);
    powerOnEnemyDamaged(s, target, 10, p);
    expect(target.hp, 'id 26 이 명중 앵커에도 남아 있다').toBe(100);
  });

  it('id 25 와 함께 실으면 두 배율이 한 번에 더해져 한 번만 반올림된다', () => {
    // 카드마다 따로 round 를 돌리면 낮은 피해 구간에서 절삭이 겹쳐 곡선이 갈린다.
    const s = world([CARD_OVERDRIVE, CARD_RAPIDCORE]);
    const p = playerOf(s);
    p.vx = 300;
    p.vy = 0;
    for (let i = 0; i < 45; i++) powerOnTick(s, p); // 유지 44/180
    for (let i = 0; i < 15; i++) powerOnVolleyFired(s, p); // 열 15/60
    const v = volleyOf(7);
    powerOnVolleyParams(s, p, v);
    // 0.25 + 44/180 = 0.49444… → round(7 × 0.49444) = round(3.461) = 3
    // 따로 반올림했다면 round(1.75) + round(1.711) = 2 + 2 = 4 로 갈렸다.
    expect(v.damage).toBe(10);
  });

  it('피격당하면 두 칸 모두 초기화된다', () => {
    const s = world([CARD_RAPIDCORE]);
    const p = playerOf(s);
    p.vx = 300;
    for (let i = 0; i < 100; i++) powerOnTick(s, p);
    expect(readCatalystSlot(s.catalystSlots, RapidcoreSlot.HeldTicks)).toBe(99);
    powerOnPlayerDamaged(s, p, 5, false, 0);
    expect(readCatalystSlot(s.catalystSlots, RapidcoreSlot.HeldTicks)).toBe(0);
    expect(readCatalystSlot(s.catalystSlots, RapidcoreSlot.HeldDir)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// id 27 afterburner
// ---------------------------------------------------------------------------

describe('id 27 afterburner — 대가와 되돌림이 둘 다 관측된다', () => {
  it('대시 쿨다운이 사라지고 최대 HP 가 3 깎인다', () => {
    const s = world([CARD_AFTERBURNER]);
    const p = playerOf(s);
    const maxHp0 = p.maxHp;
    p.dashCooldown = 42;
    powerOnDashFired(s, p);
    expect(p.dashCooldown).toBe(0);
    expect(p.maxHp).toBe(maxHp0 - 3);
    expect(readCatalystSlot(s.catalystSlots, AfterburnerSlot.Ledger)).toBe(3 * 16);
  });

  it('대시 관통은 적 hp 를 한 칸도 안 깎는다 (조작 코어 불변)', () => {
    const s = world([CARD_AFTERBURNER, CARD_ASCENDANT]);
    const p = playerOf(s);
    p.iframes = 10;
    const e = enemy(s, p.x + 20, p.y);
    powerOnDashPierce(s, p, e);
    expect(e.hp).toBe(100);
    expect(e.dead).toBe(false);
    expect(readMark(e, 'pierced')).toBe(1);
  });

  it('관통한 적을 잡으면 3이 돌아온다 — 단조 감소가 아니다', () => {
    const s = world([CARD_AFTERBURNER]);
    const p = playerOf(s);
    const maxHp0 = p.maxHp;
    const e = enemy(s, p.x + 20, p.y, 10);
    powerOnDashFired(s, p);
    expect(p.maxHp).toBe(maxHp0 - 3);
    powerOnDashPierce(s, p, e);
    // 관통한 적이 그 대시 중 죽는다.
    e.hp = 0;
    e.dead = true;
    powerOnEnemyDamaged(s, e, 10, bullet(s, 'bullet', e.x, e.y));
    expect(p.maxHp).toBe(maxHp0);
    // 되돌림은 **자기가 깎은 만큼만** — 두 번째 처치는 더 안 준다(순이득 방지).
    const e2 = enemy(s, p.x + 20, p.y, 10);
    writeMark(e2, 'pierced', 1);
    e2.hp = 0;
    e2.dead = true;
    powerOnEnemyDamaged(s, e2, 10, bullet(s, 'bullet', e2.x, e2.y));
    expect(p.maxHp).toBe(maxHp0);
  });

  it('관통 처치는 전리품을 뱉는다 — 대기분이 다음 틱에 스폰된다', () => {
    const s = world([CARD_AFTERBURNER]);
    const p = playerOf(s);
    const e = enemy(s, p.x + 20, p.y, 10);
    powerOnDashFired(s, p);
    powerOnDashPierce(s, p, e);
    e.hp = 0;
    e.dead = true;
    powerOnEnemyDamaged(s, e, 10, bullet(s, 'bullet', e.x, e.y));
    expect(s.entities.filter((x) => x.kind === 'loot').length).toBe(0);
    const before = rngState(s);
    powerOnTick(s, p);
    expect(s.entities.filter((x) => x.kind === 'loot').length).toBe(1);
    expect(rngState(s)).toBe(before); // 시드는 `mix32` 순수 파생이다
  });

  it('새 대시는 지난 대시의 관통 표식을 지운다 (창은 대시 하나다)', () => {
    const s = world([CARD_AFTERBURNER]);
    const p = playerOf(s);
    const e = enemy(s, p.x + 20, p.y);
    powerOnDashFired(s, p);
    powerOnDashPierce(s, p, e);
    expect(readMark(e, 'pierced')).toBe(1);
    powerOnDashFired(s, p);
    expect(readMark(e, 'pierced')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// id 28 bulwark
// ---------------------------------------------------------------------------

describe('id 28 bulwark — iframes 를 안 쓰고, 방향은 위협 쪽으로 고정된다', () => {
  it('피격이 iframes 를 한 칸도 안 만진다 (접촉 피해가 그대로 들어온다)', () => {
    const s = world([CARD_BULWARK]);
    const p = playerOf(s);
    enemy(s, p.x + 100, p.y);
    p.iframes = 0;
    powerOnPlayerDamaged(s, p, 5, false, 0);
    expect(p.iframes).toBe(0);
    // 접촉 앵커도 이 그룹에서는 무연산이다 — 접촉 피해를 막을 통로가 없다.
    const hp0 = p.hp;
    powerOnEnemyContact(s, p, enemy(s, p.x, p.y));
    expect(p.iframes).toBe(0);
    expect(p.hp).toBe(hp0);
  });

  it('방향은 위협이 온 쪽으로 고정되고 3초간 안 바뀐다', () => {
    const s = world([CARD_BULWARK]);
    const p = playerOf(s);
    bullet(s, 'enemyBullet', p.x + 200, p.y); // 위협은 +x 쪽
    powerOnPlayerDamaged(s, p, 5, false, 0);
    const dir = readCatalystSlot(s.catalystSlots, BulwarkSlot.Dir);
    expect(dir).toBe(1); // 코드 1 = 각 0(+x)
    expect(readCatalystSlot(s.catalystSlots, BulwarkSlot.Ticks)).toBe(180);

    // 반대쪽에 새 위협이 서고 3초가 지나기 전이라도 방향은 그대로다.
    bullet(s, 'enemyBullet', p.x - 10, p.y);
    for (let i = 0; i < 179; i++) powerOnTick(s, p);
    expect(readCatalystSlot(s.catalystSlots, BulwarkSlot.Dir)).toBe(dir);
    powerOnTick(s, p);
    expect(readCatalystSlot(s.catalystSlots, BulwarkSlot.Ticks)).toBe(0);
    expect(readCatalystSlot(s.catalystSlots, BulwarkSlot.Dir)).toBe(0);
  });

  it('부채꼴 안 적탄이 부서지고 그만큼 자원이 적립된다', () => {
    const s = world([CARD_BULWARK]);
    const p = playerOf(s);
    bullet(s, 'enemyBullet', p.x + 200, p.y);
    powerOnPlayerDamaged(s, p, 5, false, 0);
    const inArc = bullet(s, 'enemyBullet', p.x + 60, p.y);
    const behind = bullet(s, 'enemyBullet', p.x - 60, p.y);
    const farAway = bullet(s, 'enemyBullet', p.x + 400, p.y);
    const r0 = s.resources;
    powerOnCatalystHazards(s);
    expect(inArc.dead).toBe(true);
    expect(behind.dead).toBe(false);
    expect(farAway.dead).toBe(false);
    expect(s.resources).toBe(r0 + 1);
    expect(s.catalystLedger?.find((r) => r.id === CARD_BULWARK)?.earned).toBe(1);
  });

  it('그 방향으로는 아군탄도 안 나간다 (대가가 이득과 같은 루프다)', () => {
    const s = world([CARD_BULWARK]);
    const p = playerOf(s);
    bullet(s, 'enemyBullet', p.x + 200, p.y);
    powerOnPlayerDamaged(s, p, 5, false, 0);
    const forward = bullet(s, 'bullet', p.x + 30, p.y);
    const backward = bullet(s, 'bullet', p.x - 30, p.y);
    powerOnCatalystHazards(s);
    expect(forward.dead).toBe(true);
    expect(backward.dead).toBe(false);
  });

  it('위협이 하나도 없으면 방벽이 안 선다 (이득 없는 대가를 안 물린다)', () => {
    const s = world([CARD_BULWARK]);
    const p = playerOf(s);
    powerOnPlayerDamaged(s, p, 5, false, 0);
    expect(readCatalystSlot(s.catalystSlots, BulwarkSlot.Ticks)).toBe(0);
    const own = bullet(s, 'bullet', p.x + 30, p.y);
    powerOnCatalystHazards(s);
    expect(own.dead).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// id 29 ascendant
// ---------------------------------------------------------------------------

describe('id 29 ascendant — 절반의 HP · 두 배의 대시 무적 · 이동 불능', () => {
  it('런 시작에 최대 HP 가 절반이 되고 그 뒤로는 안 깎인다', () => {
    const s = world([CARD_ASCENDANT]);
    const p = playerOf(s);
    const maxHp0 = p.maxHp;
    s.tick = 0;
    powerOnTick(s, p);
    expect(p.maxHp).toBe(Math.floor(maxHp0 / 2));
    expect(p.hp).toBeLessThanOrEqual(p.maxHp);
    const halved = p.maxHp;
    for (let t = 1; t < 300; t++) {
      s.tick = t;
      powerOnTick(s, p);
    }
    expect(p.maxHp).toBe(halved);
  });

  it('대시 무적이 두 배가 된다', () => {
    const s = world([CARD_ASCENDANT]);
    const p = playerOf(s);
    p.iframes = s.config.dashIframes;
    powerOnDashFired(s, p);
    expect(p.iframes).toBe(s.config.dashIframes * 2);
  });

  it('이동 불능은 applyStasis 로 걸린다 — 속도를 직접 0 으로 만들지 않는다', () => {
    const s = world([CARD_ASCENDANT]);
    const p = playerOf(s);
    p.iframes = 20;
    const e = enemy(s, p.x + 20, p.y);
    e.vx = 55;
    powerOnDashPierce(s, p, e);
    // `applyStasis` 의 저장 필드는 `life` 이고 `enemyStatusStopMult` 가 배율 0 을 낸다.
    expect(e.life).toBe(120);
    expect(enemyStatusStopMult(e)).toBe(0);
    expect(e.vx).toBe(55); // 속도 자체는 안 건드린다
    expect(readMark(e, 'rooted')).toBe(1);
  });

  it('평범한 피격 무적에서는 안 걸린다 — 접촉 앵커에 배선돼 있지 않다', () => {
    const s = world([CARD_ASCENDANT]);
    const p = playerOf(s);
    p.iframes = s.config.hitIframes; // 피격 무적(0.67초)
    const e = enemy(s, p.x + 10, p.y);
    powerOnEnemyContact(s, p, e);
    expect(e.life).toBe(-1);
    expect(readMark(e, 'rooted')).toBe(0);
  });

  it('이동 불능 상태에서 죽은 적은 전리품을 두 배 뱉는다', () => {
    const s = world([CARD_ASCENDANT]);
    const p = playerOf(s);
    p.iframes = 20;
    const e = enemy(s, p.x + 20, p.y);
    powerOnDashPierce(s, p, e);
    e.hp = 0;
    e.dead = true;
    expect(powerOnLootRoll(s, e.x, e.y, true).count).toBe(2);
    // 결박되지 않은 적은 중립이다.
    const plain = enemy(s, p.x + 300, p.y);
    plain.hp = 0;
    plain.dead = true;
    expect(powerOnLootRoll(s, plain.x, plain.y, true).count).toBe(1);
  });
});
