/**
 * 촉매 **자원 결**(`id 15~19`)의 계약 (ADR-0052 배선 레인).
 *
 * ## 이 파일이 재는 것 — 카드마다 넷
 *  1. **음성 대조** — 안 실으면 무촉매와 거동이 같다(앵커를 불러도 아무 일도 안 난다).
 *  2. **이득과 대가가 둘 다 관측된다** — 한쪽만 서면 카드가 순수 상향이거나 순수 벌칙이다.
 *  3. **RNG 스트림 불변** — `dropRng`/`waveRng`/`powerupRng` 의 `getState()` 를 촉매 유무로
 *     대조한다. 이 그룹 최대 위험은 `id 17` 의 소환이라 그 지점을 따로 못 박는다.
 *  4. **그룹 고유 함정** — `id 15` 의 `state.loot` 오염 · `id 19` 의 조준 등재 · `id 16` 의
 *     기믹 예산.
 *
 * ## 왜 앵커를 직접 부르는가
 * 이 카드들의 발동 조건(보급 습격 격추 · 엘리트 처치 · 3택 수락)은 시드에 따라 수천 틱을
 * 돌려야 한 번 나올 수도 있다. 그것을 기다리면 테스트가 **시드에 의존**하고 실패했을 때
 * "안 났는지 안 도는지"를 못 가른다. 그래서 사건은 디스패처(`catalystHooks.ts`)를 통해
 * 직접 주입하고 — 그러면 **팬아웃 배선까지 같이 증명된다** — 조준·자동사격처럼 엔진 전체가
 * 걸린 축만 `stepWorld` 로 실측한다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, DEFAULT_CONFIG, stepWorld, catalystContributionsOf } from '../src/sim/world.js';
import type { WorldState, InputFrame } from '../src/sim/world.js';
import {
  onResourceGrantedCatalyst,
  onEnemyDamagedCatalyst,
  onEnemyDeathCatalyst,
  onLootCollectedCatalyst,
  onDestructibleDestroyedCatalyst,
  onEnemyStepCatalyst,
  onPowerupPickedCatalyst,
  onKillsDeltaCatalyst,
  onLootRollCatalyst,
  onTickCatalyst,
} from '../src/sim/catalystHooks.js';
import { bonusLootSeeds } from '../src/sim/drops.js';
import { readCatalystSlot } from '../src/sim/catalystSlots.js';
import { readMark } from '../src/sim/catalystMarks.js';
import {
  CATALYST_FOUNDRY_MARK,
  CATALYST_ORE_MARK,
  isCatalystObjective,
} from '../src/sim/catalyst/shared.js';
import { resourceOnLootRoll, resourceOnVolleyParams } from '../src/sim/catalyst/resource.js';
import type { VolleyParams } from '../src/sim/skillHooks.js';
import { isObjectiveDestructible } from '../src/sim/modes/objective.js';
import { summonEnemy } from '../src/sim/waves.js';
import { spawnDestructible } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { ENEMY_BY_TYPE } from '../data/enemies.js';

const IDLE: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };

const CARD_EXTRACTION = 15;
const CARD_FOUNDRY = 16;
/** 다른 결의 카드 한 장 — `carries` 게이트의 음성 대조용(빈 배열은 `catalystOn` 만 잰다). */
const OTHER_CARD = 1;
const CARD_GREED = 17;
const CARD_MERCANTILE = 18;
const CARD_MOTHERLODE = 19;

/** `GreedSlot.Pending`. 숫자로 적는 이유: `const enum` 은 런타임 값이 없다. 배정표가 정본이다. */
const SLOT_GREED_PENDING = 22;
/** `MercantileSlot.Debt`. 위와 같은 사유. */
const SLOT_MERCANTILE_DEBT = 6;

function w(catalysts?: number[]): WorldState {
  // `exactOptionalPropertyTypes` — `catalysts: undefined` 를 그냥 실으면 타입이 갈린다.
  // 무촉매 런은 **키 자체를 빼야** 한다(빈 배열도 `catalystOn` 은 거짓이지만 의미가 다르다).
  return catalysts === undefined
    ? createWorld(0xca7a, { ...DEFAULT_CONFIG })
    : createWorld(0xca7a, { ...DEFAULT_CONFIG, catalysts });
}

function player(s: WorldState): Entity {
  const p = s.entities[0];
  if (p === undefined) throw new Error('player missing');
  return p;
}

/** 지금 서 있는 `id 16` 포탑들. */
function turrets(s: WorldState): Entity[] {
  return s.entities.filter(
    (e) => !e.dead && e.kind === 'turretPickup' && e.ownerId === CATALYST_FOUNDRY_MARK,
  );
}

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
    cooldownQ: 20,
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

/** 플레이어 근처에 잡몹 `n` 마리를 세운다. `summonEnemy` 는 RNG 를 소비하지 않는다. */
function mobs(s: WorldState, n: number): Entity[] {
  const def = ENEMY_BY_TYPE[0];
  if (def === undefined) throw new Error('enemy def missing');
  const p = player(s);
  const out: Entity[] = [];
  for (let i = 0; i < n; i++) out.push(summonEnemy(s, def, p.x + 100 + i * 30, p.y));
  return out;
}

/** 적 하나를 격추 판정까지 몰고 간다(피해 확정 앵커 → 사망 통지 앵커). */
function kill(s: WorldState, e: Entity): void {
  e.hp = 0;
  onEnemyDamagedCatalyst(s, e, 1, undefined);
  e.dead = true;
  onEnemyDeathCatalyst(s, e.x, e.y, false);
}

function rngStates(s: WorldState): [number, number, number] {
  return [s.dropRng.getState(), s.waveRng.getState(), s.powerupRng.getState()];
}

function contribution(s: WorldState, id: number): { fired: number; earned: number; missed: number } {
  const rows = catalystContributionsOf(s) ?? [];
  const row = rows.find((r) => r.id === id);
  return { fired: row?.fired ?? 0, earned: row?.earned ?? 0, missed: row?.missed ?? 0 };
}

// ---------------------------------------------------------------------------
// ⓪ 음성 대조 — 안 실으면 앵커를 불러도 아무 일도 안 난다
// ---------------------------------------------------------------------------

describe('자원 결 · 음성 대조 (카드를 안 실으면 거동이 무촉매와 같다)', () => {
  it('무촉매 런: 적립 앵커가 자원·마크·엔티티 수를 한 톨도 안 바꾼다', () => {
    const s = w();
    const before = s.resources;
    const targets = mobs(s, 3);
    const n = s.entities.length;
    onResourceGrantedCatalyst(s, 25, 0, 0);
    expect(s.resources).toBe(before);
    expect(s.entities.length).toBe(n);
    for (const e of targets) {
      expect(readMark(e, 'extractionAmount')).toBe(0);
      expect(readMark(e, 'greedAmount')).toBe(0);
    }
  });

  it('**다른 촉매**를 실은 런도 이 그룹은 안 깨어난다 (카드 소지 게이트가 실제로 좁다)', () => {
    // `state.catalystOn` 만으로 켜면 아무 촉매 한 장에 그룹 전체가 발동한다 — 그 결함을 잡는다.
    const s = w([1]);
    const before = s.resources;
    mobs(s, 3);
    onResourceGrantedCatalyst(s, 25, 0, 0);
    expect(s.resources).toBe(before);
    expect(readCatalystSlot(s.catalystSlots, SLOT_GREED_PENDING)).toBe(0);
  });

  it('무촉매 런: 전리품 수거·파괴물 파괴 앵커가 억제를 걸지 않는다', () => {
    const s = w();
    const loot = spawnDestructible(s, 0, 0, 10, 1, 0); // ownerId = 0 (절차 지형과 같은 값)
    expect(onDestructibleDestroyedCatalyst(s, loot)).toBe(false);
    expect(onLootCollectedCatalyst(s, loot)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ① id 15 extraction — 자원이 적에게 실리고, 죽이면 결정으로 굳는다
// ---------------------------------------------------------------------------

describe('id 15 extraction', () => {
  it('이득·대가 ①: 적립이 **즉시 안 들어오고** 화면의 적들에게 실린다', () => {
    const s = w([CARD_EXTRACTION]);
    const targets = mobs(s, 3);
    s.resources = 100;
    onResourceGrantedCatalyst(s, 12, player(s).x, player(s).y);
    // 대가 — 자원은 되돌아갔다(적립이 취소됐다).
    expect(s.resources).toBe(88);
    // 이득의 씨앗 — 액수가 적들에게 실렸고 **합이 보존된다**.
    const loaded = targets.reduce((a, e) => a + readMark(e, 'extractionAmount'), 0);
    expect(loaded).toBe(12);
    expect(contribution(s, CARD_EXTRACTION).fired).toBeGreaterThan(0);
  });

  it('이득 ②: 죽이면 그 자리에 결정이 떨어지고, 주우면 자원이 **실제로** 들어온다', () => {
    const s = w([CARD_EXTRACTION]);
    const [target] = mobs(s, 1);
    if (target === undefined) throw new Error('no target');
    s.resources = 100;
    onResourceGrantedCatalyst(s, 12, target.x, target.y);
    expect(s.resources).toBe(88);

    kill(s, target);
    const crystal = s.entities.find((e) => e.kind === 'loot' && !e.dead);
    expect(crystal, '죽였는데 결정이 안 떨어졌다').toBeDefined();
    if (crystal === undefined) return;

    const lootBefore = s.loot.length;
    expect(onLootCollectedCatalyst(s, crystal)).toBe(true);
    // ⭐⭐ 이 그룹 최대 함정 — 결정을 주워도 `state.loot` 가 **한 칸도 안 는다**.
    // 늘면 가짜 장비가 생기고, `catalystDropsFromRun` 이 그 시드마다 게이트를 굴려 촉매까지
    // 공짜로 늘어난다(경제 축 붕괴).
    expect(s.loot.length, '결정이 진짜 전리품으로 새어 들어갔다').toBe(lootBefore);
    // 자원은 **실제 자원 경로**로 들어왔다(장부 적립만으로는 자원이 오르지 않는다).
    expect(s.resources).toBe(100);
    expect(contribution(s, CARD_EXTRACTION).earned).toBe(12);
  });

  it('대가 ②: 자원을 진 적이 화면을 벗어나면 증발하고 **놓친 액수**가 장부에 남는다', () => {
    const s = w([CARD_EXTRACTION]);
    const [target] = mobs(s, 1);
    if (target === undefined) throw new Error('no target');
    s.resources = 100;
    onResourceGrantedCatalyst(s, 12, target.x, target.y);

    // 아직 화면 안이면 아무 일도 없다(경계가 실제로 거리로 갈리는지).
    onEnemyStepCatalyst(s, target, 1);
    expect(readMark(target, 'extractionAmount')).toBe(12);

    target.x = player(s).x + 5000;
    expect(onEnemyStepCatalyst(s, target, 1), '이동 배율은 중립이어야 한다').toBe(1);
    expect(readMark(target, 'extractionAmount')).toBe(0);
    expect(s.resources, '증발했는데 자원이 돌아왔다').toBe(88);
    expect(contribution(s, CARD_EXTRACTION).missed).toBe(12);
  });

  it('축소 작동: 실을 적이 하나도 없으면 자원은 그냥 들어온다 (이득 없이 대가만 물지 않는다)', () => {
    const s = w([CARD_EXTRACTION]);
    s.resources = 100;
    onResourceGrantedCatalyst(s, 12, 0, 0);
    expect(s.resources).toBe(100);
  });

  it('RNG 미소비: 적립·격추·수거 어느 단계도 스트림을 밀지 않는다', () => {
    const s = w([CARD_EXTRACTION]);
    const [target] = mobs(s, 1);
    if (target === undefined) throw new Error('no target');
    const before = rngStates(s);
    onResourceGrantedCatalyst(s, 12, target.x, target.y);
    kill(s, target);
    const crystal = s.entities.find((e) => e.kind === 'loot' && !e.dead);
    if (crystal !== undefined) onLootCollectedCatalyst(s, crystal);
    expect(rngStates(s)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// ② id 17 greed — 자원이 적이 되어 나타난다
// ---------------------------------------------------------------------------

describe('id 17 greed', () => {
  it('이득·대가 ①: 적립이 가로채여 **대기 액수**가 되고, 다음 틱에 금빛 적이 솟는다', () => {
    const s = w([CARD_GREED]);
    s.resources = 100;
    onResourceGrantedCatalyst(s, 20, 0, 0);
    expect(s.resources, '가로채지 않았다').toBe(80);
    expect(readCatalystSlot(s.catalystSlots, SLOT_GREED_PENDING)).toBe(20);

    const enemiesBefore = s.entities.filter((e) => e.kind === 'enemy').length;
    onTickCatalyst(s, player(s));
    const gold = s.entities.filter((e) => e.kind === 'enemy' && readMark(e, 'greedAmount') > 0);
    expect(s.entities.filter((e) => e.kind === 'enemy').length).toBe(enemiesBefore + 1);
    expect(gold).toHaveLength(1);
    expect(readMark(gold[0] as Entity, 'greedAmount')).toBe(20);
    expect(readCatalystSlot(s.catalystSlots, SLOT_GREED_PENDING)).toBe(0);
  });

  it('⚠️ 이 그룹 최대 위험 — **소환이 `waveRng` 를 한 칸도 안 민다** (`summonEnemy` 정본)', () => {
    const s = w([CARD_GREED]);
    onResourceGrantedCatalyst(s, 20, 0, 0);
    const before = rngStates(s);
    onTickCatalyst(s, player(s));
    expect(rngStates(s), '`spawnEnemy` 를 썼다 — 같은 시드의 웨이브·드랍이 통째로 밀린다').toEqual(
      before,
    );
  });

  it('이득 ②: 금빛 적을 죽이면 **세 배**를 받는다', () => {
    const s = w([CARD_GREED]);
    s.resources = 100;
    onResourceGrantedCatalyst(s, 20, 0, 0);
    onTickCatalyst(s, player(s));
    const gold = s.entities.find((e) => e.kind === 'enemy' && readMark(e, 'greedAmount') > 0);
    expect(gold).toBeDefined();
    if (gold === undefined) return;
    kill(s, gold);
    expect(s.resources).toBe(80 + 60);
    expect(contribution(s, CARD_GREED).earned).toBe(60);
  });

  it('대가 ②: **못 죽이면 자원이 실제로 증발**하고 `missCatalyst` 가 그 액수를 잡는다', () => {
    const s = w([CARD_GREED]);
    s.resources = 100;
    onResourceGrantedCatalyst(s, 20, 0, 0);
    onTickCatalyst(s, player(s));
    const gold = s.entities.find((e) => e.kind === 'enemy' && readMark(e, 'greedAmount') > 0);
    expect(gold).toBeDefined();
    if (gold === undefined) return;

    gold.x = player(s).x + 5000;
    onEnemyStepCatalyst(s, gold, 1);
    expect(readMark(gold, 'greedAmount')).toBe(0);
    expect(s.resources, '증발이 아니라 되돌아왔다 — 대가가 없다').toBe(80);
    expect(contribution(s, CARD_GREED).missed).toBe(20);
  });

  it('8비트 눈금을 넘는 액수는 **버리지 않고** 여러 틱에 걸쳐 나눠 솟는다', () => {
    const s = w([CARD_GREED]);
    onResourceGrantedCatalyst(s, 300, 0, 0);
    onTickCatalyst(s, player(s));
    expect(readCatalystSlot(s.catalystSlots, SLOT_GREED_PENDING)).toBe(45);
    onTickCatalyst(s, player(s));
    expect(readCatalystSlot(s.catalystSlots, SLOT_GREED_PENDING)).toBe(0);
    const carried = s.entities
      .filter((e) => e.kind === 'enemy')
      .reduce((a, e) => a + readMark(e, 'greedAmount'), 0);
    expect(carried, '절삭돼 사라진 몫이 있다').toBe(300);
  });

  it('`id 15` 와 같이 실려도 자원을 **두 번 빼지 않는다** (음수 자원 방지)', () => {
    const s = w([CARD_EXTRACTION, CARD_GREED]);
    mobs(s, 2);
    s.resources = 100;
    onResourceGrantedCatalyst(s, 20, player(s).x, player(s).y);
    expect(s.resources).toBe(80);
    // 먼저 성립한 쪽(id 오름차순 = extraction)이 가져갔으므로 greed 대기는 0 이다.
    expect(readCatalystSlot(s.catalystSlots, SLOT_GREED_PENDING)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ③ id 18 mercantile — 빚 카드
// ---------------------------------------------------------------------------

describe('id 18 mercantile', () => {
  it('이득·대가: 빚 칸을 받으면 **중첩이 하나 더** 들어오고 부채가 쌓인다', () => {
    const s = w([CARD_MERCANTILE]);
    const hpBefore = player(s).maxHp;
    // 3택의 마지막 칸(index 2)이 빚 칸이다. poolIndex 6 = `reinforced-hull`(최대 HP +10, POWERUPS 정본)
    // — **바닥 클램프가 없는 축**을 골랐다. `rapid-fire` 처럼 `Math.max` 바닥이 있는 축을 고르면
    // 추가 중첩이 삼켜져 이 단언이 배선이 아니라 상한을 재게 된다.
    onPowerupPickedCatalyst(s, 6, 2);
    expect(readCatalystSlot(s.catalystSlots, SLOT_MERCANTILE_DEBT)).toBeGreaterThan(0);
    expect(player(s).maxHp, '추가 중첩이 안 들어갔다').toBeGreaterThan(hpBefore);
    expect(contribution(s, CARD_MERCANTILE).fired).toBe(1);
  });

  it('빚 칸이 **아닌** 칸은 무연산이다 (한 칸만 빚 카드다)', () => {
    const s = w([CARD_MERCANTILE]);
    const hpBefore = player(s).maxHp;
    onPowerupPickedCatalyst(s, 6, 0);
    onPowerupPickedCatalyst(s, 6, 1);
    expect(readCatalystSlot(s.catalystSlots, SLOT_MERCANTILE_DEBT)).toBe(0);
    expect(player(s).maxHp).toBe(hpBefore);
  });

  it('부채는 **런 안에서 닫힌다** — 정산 채널(슬롯 6)로만 나간다', () => {
    const s = w([CARD_MERCANTILE]);
    onPowerupPickedCatalyst(s, 0, 2);
    onPowerupPickedCatalyst(s, 0, 2);
    const debt = readCatalystSlot(s.catalystSlots, SLOT_MERCANTILE_DEBT);
    expect(debt).toBe(80);
    // 같은 값이 정산 채널로 그대로 나간다(짝이 서 있는지의 sim 쪽 절반).
    expect(s.catalystSlots[SLOT_MERCANTILE_DEBT]).toBe(debt);
  });

  it('RNG 미소비: `applyPowerup` 은 난수를 안 쓴다', () => {
    const s = w([CARD_MERCANTILE]);
    const before = rngStates(s);
    onPowerupPickedCatalyst(s, 0, 2);
    expect(rngStates(s)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// ④ id 19 motherlode — 적이 광맥이 된다
// ---------------------------------------------------------------------------

describe('id 19 motherlode', () => {
  it('이득: 엘리트를 처치하면 광석 덩어리가 남고, 부수면 자원이 된다', () => {
    const s = w([CARD_MOTHERLODE]);
    const before = s.resources;
    onEnemyDeathCatalyst(s, 300, 400, true);
    const ore = s.entities.find((e) => e.kind === 'destructible' && e.ownerId === CATALYST_ORE_MARK);
    expect(ore, '광맥이 안 생겼다').toBeDefined();
    if (ore === undefined) return;
    expect(ore.hp).toBeGreaterThan(0); // 즉사면 "부수는 동안" 이라는 대가가 없다

    // 기본 젬 억제 — 광석은 젬이 아니라 자원을 낸다.
    expect(onDestructibleDestroyedCatalyst(s, ore)).toBe(true);
    expect(s.resources).toBeGreaterThan(before);
    expect(contribution(s, CARD_MOTHERLODE).earned).toBeGreaterThan(0);
  });

  it('⭐ 광석은 **조준 대상이다** — 등재를 빠뜨리면 사람이 의도적으로 못 부순다', () => {
    const s = w([CARD_MOTHERLODE]);
    onEnemyDeathCatalyst(s, 300, 400, true);
    const ore = s.entities.find((e) => e.kind === 'destructible' && e.ownerId === CATALYST_ORE_MARK);
    expect(ore).toBeDefined();
    if (ore === undefined) return;
    expect(isCatalystObjective(ore)).toBe(true);
    // 정본은 `modes/objective.ts` 한 곳이다 — `isPlayerTargetable` 이 그 술어를 통해 본다.
    expect(isObjectiveDestructible(ore)).toBe(true);
    // 절차 청크 지형(ownerId=0)은 여전히 거짓이어야 한다 — 배경 바위가 조준을 훔치면
    // 모든 무대의 거동이 바뀐다.
    const terrain = spawnDestructible(s, 0, 0, 20, 100, 5);
    expect(isCatalystObjective(terrain)).toBe(false);
  });

  it('⭐ 자동 조준이 실제로 광석에 묶인다 (술어만 참이고 사격이 안 가는 결함을 잡는다)', () => {
    const s = w([CARD_MOTHERLODE]);
    const p = player(s);
    // 적을 하나도 두지 않고 광석만 세운다 — 총구가 갈 곳은 여기뿐이다.
    const ore = spawnDestructible(s, p.x + 200, p.y, 34, 120, 0);
    ore.ownerId = CATALYST_ORE_MARK;
    const hp0 = ore.hp;
    for (let t = 0; t < 60; t++) stepWorld(s, IDLE);
    expect(ore.hp, '조준이 광석으로 안 갔다 — 사람이 의도적으로 부술 수단이 없다').toBeLessThan(hp0);
  });

  it('대가·상한: 잡몹은 광맥이 안 되고, 동시 생존 수에 상한이 있다', () => {
    const s = w([CARD_MOTHERLODE]);
    onEnemyDeathCatalyst(s, 0, 0, false);
    expect(
      s.entities.some((e) => e.kind === 'destructible' && e.ownerId === CATALYST_ORE_MARK),
    ).toBe(false);
    for (let i = 0; i < 40; i++) onEnemyDeathCatalyst(s, i * 50, 0, true);
    const live = s.entities.filter(
      (e) => e.kind === 'destructible' && e.ownerId === CATALYST_ORE_MARK && !e.dead,
    ).length;
    expect(live).toBeLessThanOrEqual(12);
  });

  it('RNG 미소비: 광맥 생성·파괴가 스트림을 안 민다', () => {
    const s = w([CARD_MOTHERLODE]);
    const before = rngStates(s);
    onEnemyDeathCatalyst(s, 300, 400, true);
    const ore = s.entities.find((e) => e.kind === 'destructible' && e.ownerId === CATALYST_ORE_MARK);
    if (ore !== undefined) onDestructibleDestroyedCatalyst(s, ore);
    expect(rngStates(s)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// ⑤ id 16 foundry — 이득과 대가가 **한 쌍으로** 배선됐다
// ---------------------------------------------------------------------------
//
// ⚠️ 종전 이 절은 «처치 델타 앵커가 아직 포탑을 세우지 않는다» 로 **미배선을 못 박고** 있었다.
//    그 단언의 목적은 *"이득만 먼저 얹지 마라"* 였고, 막고 있던 것은 대가를 걸 앵커의 부재였다.
//    이제 그 앵커(`onVolleyParamsCatalyst`)가 서서 대가가 실제로 걸리므로, 단언을 **이득·대가가
//    같이 있는가**로 바꾼다. 아래 «대가» 테스트가 그 자리를 지킨다 — 대가 쪽이 지워지면 빨개진다.

describe('id 16 foundry — 적 셋마다 포탑, 대신 화력이 나뉜다', () => {
  it('안 실으면 포탑이 안 선다 (음성 대조 — 카드 소지 게이트)', () => {
    const s = w([OTHER_CARD]);
    for (let i = 0; i < 9; i++) onKillsDeltaCatalyst(s, 1);
    expect(s.entities.some((e) => e.kind === 'turretPickup')).toBe(false);
  });

  it('이득 — 처치 셋마다 포탑이 하나 서고 수명은 20초다', () => {
    const s = w([CARD_FOUNDRY]);
    for (let i = 0; i < 2; i++) onKillsDeltaCatalyst(s, 1);
    expect(turrets(s), '셋을 못 채웠는데 포탑이 섰다').toHaveLength(0);
    onKillsDeltaCatalyst(s, 1); // 셋째 처치
    const built = turrets(s);
    expect(built).toHaveLength(1);
    // ⚠️ `activateTurret` 기본값(600 = 10초)이 아니라 **카드 정본의 20초**여야 한다.
    expect(built[0]?.life).toBe(1200);
  });

  it('한 틱에 여럿 죽어도 초과분이 안 버려진다 (while 이지 if 가 아니다)', () => {
    // `if` 로 두면 광역기·연쇄로 `delta` 가 클 때 "셋마다"가 실제로는 더 느려진다.
    const s = w([CARD_FOUNDRY]);
    onKillsDeltaCatalyst(s, 9);
    expect(turrets(s)).toHaveLength(3);
  });

  // ⚠️ 2026-08-08 사용자 판정 — 정본 초안의 *"포탑이 처치한 적은 자원을 두 배 뱉는다"* 는
  //    내려갔고(포탑 탄 귀속이 `ownerId` 해시 폴드를 요구 · `id 16` 단독 런에는 두 배로 만들
  //    자원 사건 자체가 없음) 상한 축이 자원 → **드랍**으로 옮겨갔다. 판정 술어는 대가 쪽과
  //    같은 `foundryTurretCount` 하나라 새 칸도 새 귀속도 없다.
  it('⭐ 이득 — 포탑이 서 있는 동안 쓰러진 적은 전리품을 더 뱉는다', () => {
    const s = w([CARD_FOUNDRY]);
    // 포탑 0기 — 배율이 **정확히 1** 이라 추가 전리품이 없다.
    expect(onLootRollCatalyst(s, 1, 1, 0, 0, true).count).toBe(1);

    onKillsDeltaCatalyst(s, 3); // 포탑 1기
    expect(turrets(s)).toHaveLength(1);
    const lr = onLootRollCatalyst(s, 1, 1, 0, 0, true);
    expect(lr.count).toBeCloseTo(1.8, 6);
    expect(lr.rarity).toBe(1); // 등급 축은 이 카드 소관이 아니다

    // ⭐⭐ 배율이 **실제 전리품 수에 도달**하는지 본다 — 적립 액수만 재면 반쪽이다.
    //     `bonusLootSeeds` 가 개수 배율을 추가 드랍 시드로 바꾸는 유일한 자리이고
    //     (`world.ts` 의 엘리트·보스 두 호출부가 그 배열을 그대로 민다), ×1.8 은 정수부가 0 이고
    //     소수부 0.8 이 시드 파생 게이트라 시드마다 갈린다. 그래서 열 시드를 훑어 «한 번도 안
    //     나오는» 퇴화를 막고, 중립 배율은 **전 시드에서 0** 임을 같이 못 박는다.
    const hit = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((k) => bonusLootSeeds(k, lr.count).length > 0);
    expect(hit.length, '배율 1.8 이 추가 전리품에 한 번도 도달하지 않는다').toBeGreaterThan(0);
    for (let k = 0; k < 10; k++) expect(bonusLootSeeds(k, 1)).toEqual([]);

    // 귀속 장부에 이 카드 몫이 적힌다.
    expect((s.catalystLedger ?? []).find((r) => r.id === CARD_FOUNDRY)?.earned).toBeGreaterThan(0);
  });

  it('안 실으면 전리품 배율도 중립이다 (음성 대조)', () => {
    // ⚠️ 여기서는 **그룹 함수를 직접** 부른다. `OTHER_CARD`(= `id 1 plunder`)도 같은 앵커에서
    //    개수 배율을 곱하므로 디스패처로 재면 다른 카드의 배율을 이 카드 것으로 오독한다.
    const s = w([OTHER_CARD]);
    onKillsDeltaCatalyst(s, 9);
    expect(resourceOnLootRoll(s, 0, 0, true).count).toBe(1);
  });

  it('⭐ 대가 — 포탑이 서 있는 동안 주무기 피해가 1기당 15% 나뉜다', () => {
    const s = w([CARD_FOUNDRY]);
    const p = player(s);

    // 포탑 0기 — 배율이 정확히 1 이라 레코드가 안 바뀐다.
    const none = volleyOf(100);
    resourceOnVolleyParams(s, p, none);
    expect(none.damage).toBe(100);

    onKillsDeltaCatalyst(s, 3); // 포탑 1기
    expect(turrets(s)).toHaveLength(1);
    const one = volleyOf(100);
    resourceOnVolleyParams(s, p, one);
    expect(one.damage).toBeCloseTo(85, 6);

    onKillsDeltaCatalyst(s, 3); // 포탑 2기
    const two = volleyOf(100);
    resourceOnVolleyParams(s, p, two);
    expect(two.damage).toBeCloseTo(72.25, 6);
  });

  it('⭐ 대가는 되돌아온다 — 포탑이 만료되면 화력이 원래대로다', () => {
    // 헌장 §페널티 규율 3(되돌릴 수단 동봉). 곱셈이라 클램프가 필요 없고, 그래서 되돌아온다.
    const s = w([CARD_FOUNDRY]);
    const p = player(s);
    onKillsDeltaCatalyst(s, 3);
    const t = turrets(s)[0];
    if (t === undefined) throw new Error('포탑 부재');
    t.dead = true; // 수명 만료와 같은 상태
    const after = volleyOf(100);
    resourceOnVolleyParams(s, p, after);
    expect(after.damage).toBe(100);
  });

  it('포탑이 동시 상한을 넘지 않는다 (상한은 이득과 대가를 같이 묶는다)', () => {
    const s = w([CARD_FOUNDRY]);
    onKillsDeltaCatalyst(s, 3 * 20);
    expect(turrets(s).length).toBeLessThanOrEqual(6);
  });

  it('포탑은 청크 기믹이 아니다 — MAX_ACTIVE_GIMMICKS 를 잠식하지 않는다', () => {
    // 잠식하면 청크 생성이 원자적이라 뒤쪽 청크가 통째로 보류되고 **경로 독립성이 깨진다**
    // (`DRONE_MARK`·`BROOD_MARK` 가 같은 줄에서 같은 사유로 빠져 있다).
    const s = w([CARD_FOUNDRY]);
    onKillsDeltaCatalyst(s, 3);
    const t = turrets(s)[0];
    if (t === undefined) throw new Error('포탑 부재');
    expect(t.ownerId).toBe(CATALYST_FOUNDRY_MARK);
  });
});

// ---------------------------------------------------------------------------
// ⑥ 그룹 전체 — 스트림 불변과 무촉매 바이트 불변
// ---------------------------------------------------------------------------

describe('자원 결 · 스트림 불변', () => {
  it('`id 15`+`id 19` 를 실은 런과 무촉매 런의 세 스트림이 600틱 뒤에도 같다', () => {
    // 두 카드는 **이미 뽑힌 결과에 곱하거나 뒤에 붙기만** 하고 새 난수를 굴리지 않는다.
    // (`id 17` 은 소환이 적 수를 바꿔 웨이브 유입에 간접 영향을 줄 수 있어 이 절에서 뺀다 —
    //  그쪽의 직접 미소비는 위 §id 17 절이 따로 못 박는다.)
    const a = w();
    const b = w([CARD_EXTRACTION, CARD_MOTHERLODE]);
    for (let t = 0; t < 600; t++) {
      stepWorld(a, IDLE);
      stepWorld(b, IDLE);
    }
    expect(rngStates(b)).toEqual(rngStates(a));
  });

  it('무촉매 런은 이 그룹의 슬롯·마크를 한 칸도 안 건드린다', () => {
    const s = w();
    for (let t = 0; t < 600; t++) stepWorld(s, IDLE);
    expect(readCatalystSlot(s.catalystSlots, SLOT_GREED_PENDING)).toBe(0);
    expect(readCatalystSlot(s.catalystSlots, SLOT_MERCANTILE_DEBT)).toBe(0);
    for (const e of s.entities) {
      if (e.kind !== 'enemy') continue;
      expect(readMark(e, 'extractionAmount')).toBe(0);
      expect(readMark(e, 'greedAmount')).toBe(0);
    }
  });
});
