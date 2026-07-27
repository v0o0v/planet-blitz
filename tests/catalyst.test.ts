/**
 * 촉매 시스템(ADR-0029) sim 통합 & 결정론 검증 — Lane 2.
 *
 * 구성:
 *  ① 해시 — 촉매 배열별 분기 / 정규화 순서 무관 동형 / 빈 배열·미지정 상호 동형 / 스택 분기.
 *  ② 페널티 6축 — sim 노브에 실제로 도달하는지 관측(부호 방향).
 *  ③ 보상 4축(drop·rarity·xp·resource) — 축을 격리해 부호 방향을 관측한다.
 *  ④ 파워축 — loadout 파생과 **이중 적용이 아님**(단일 적용) 증명.
 *
 * ## 관측 전략
 * 촉매 배율은 Lane 0 placeholder(작다)라, 전면 런의 창발 관측은 표본이 작고 페널티-보상 되먹임에
 * 오염된다. 그래서 **결정론적 주입 하네스**를 쓴다: 죽은 엘리트/보급을 주입하고 한 틱 sweep 을
 * 돌려 드랍/자원 경로만 정확히 자극한다(주입은 dropRng 소비가 동일하므로 촉매 vs 무촉매 비교가
 * 그 축만 격리한다). 페널티는 스폰 스탯·수동 엔티티로 직접 관측한다. 부호(방향)만 검증(수치 아님).
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  emptyInput,
  packPowerupPick,
  DEFAULT_CONFIG,
} from '../src/sim/world.js';
import type { WorldConfig, WorldState, InputFrame } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { blankEntity, addEntity } from '../src/sim/entities.js';
import { makeElite, ELITE_AFFIX_COUNT } from '../src/sim/elite.js';
import { eliteDropChance } from '../src/sim/drops.js';
import { stageParams } from '../data/waves.js';
import { catalystPowerMult } from '../src/data/catalysts.js';
import { atan2, length } from '../src/sim/math.js';

const SEED = 0x5417;
const DURABLE = 100_000_000;

/** 기본 무대: 카르곤 단계11(엘리트 발생), 사망 방지용 내구 HP. */
function base(extra: Partial<WorldConfig> = {}): WorldConfig {
  return { ...DEFAULT_CONFIG, planet: 0, stage: 11, playerHp: DURABLE, ...extra };
}

// 촉매 id 참조(src/data/catalysts.ts): 페널티축 대표 —
//  enemyHp=1(plunder)·enemyDamage=2(harvest)·enemySpeed=3(bounty)·enemyBulletSpeed=4(cornucopia)
//  enemyCount=0(abundance)·playerHpDown=8(alchemy). 보상축 대표 —
//  drop=1·rarity=5(refinement)·xp=10(insight)·resource=15(extraction)·power(damage)=25(overdrive)·
//  power(maxHp)=28(bulwark).

// ---------------------------------------------------------------------------
// ① 해시 폴드
// ---------------------------------------------------------------------------

function hashStream(catalysts: number[] | undefined, ticks = 90): number[] {
  const cfg = base(catalysts !== undefined ? { catalysts } : {});
  const state = createWorld(SEED, cfg);
  const out: number[] = [];
  for (let i = 0; i < ticks; i++) {
    stepWorld(state, emptyInput());
    out.push(hashWorld(state));
  }
  return out;
}

describe('촉매 해시 폴드(조건부 꼬리 · ADR-0029)', () => {
  it('미지정과 빈 배열은 per-tick 해시가 완전히 동형이다(촉매 무관 런 = 무폴드)', () => {
    expect(hashStream(undefined)).toEqual(hashStream([]));
  });

  it('같은 정규화 배열은 입력 순서가 달라도 동형이다', () => {
    expect(hashStream([1, 5])).toEqual(hashStream([5, 1]));
    expect(hashStream([15, 2, 25, 2])).toEqual(hashStream([2, 25, 2, 15]));
  });

  it('다른 촉매 배열은 해시가 분기한다(첫 틱부터 — 꼬리 폴드가 다르다)', () => {
    expect(hashStream([1]).at(-1)).not.toBe(hashStream([5]).at(-1));
    expect(hashStream([1]).at(-1)).not.toBe(hashStream([]).at(-1));
  });

  it('같은 종류 스택 수가 다르면 분기한다(폴드 길이 + 배율 차이)', () => {
    expect(hashStream([1]).at(-1)).not.toBe(hashStream([1, 1]).at(-1));
  });

  it('미지 id 만 든 배열은 무촉매와 동형이다(정규화가 걸러 무폴드)', () => {
    expect(hashStream([9999, -1])).toEqual(hashStream([]));
  });
});

// ---------------------------------------------------------------------------
// ② 페널티 6축 — sim 노브 부호 관측
// ---------------------------------------------------------------------------

/** 첫 웨이브 적 1기의 스폰 스탯(maxHp·damage). 촉매는 waveRng 를 소비하지 않으므로 두 런의
 *  첫 적은 같은 종류·같은 틱이라 배율 차이만 드러난다. */
function firstEnemyStats(cfg: WorldConfig): { maxHp: number; damage: number } {
  const state = createWorld(SEED, cfg);
  for (let i = 0; i < 400; i++) {
    stepWorld(state, emptyInput());
    const e = state.entities.find((x) => x.kind === 'enemy');
    if (e !== undefined) return { maxHp: e.maxHp, damage: e.damage };
  }
  throw new Error('적이 스폰되지 않았다(무대 점검 필요)');
}

/** 원점(플레이어) 방향으로 둔 수동 적 1기를 12틱 이동시켜 원점 접근량을 잰다.
 *  enemySpeed 페널티가 stepEnemies 속도 노브에 도달하는지 직접 본다. */
function manualEnemyTravel(cfg: WorldConfig): number {
  const state = createWorld(SEED, cfg);
  const e = blankEntity('enemy');
  e.x = 2600;
  e.y = 0;
  e.radius = 30;
  e.hp = 1e9;
  e.maxHp = 1e9;
  e.enemyType = 0; // 유효 로스터 def — updateEnemy 가 이동시킨다.
  e.damage = 1;
  const added = addEntity(state, e);
  const x0 = added.x;
  for (let i = 0; i < 12; i++) stepWorld(state, emptyInput());
  return x0 - added.x; // 원점으로 다가온 만큼(양수). 빠를수록 크다.
}

/** 원점에서 떨어진 수동 적탄 1발을 1틱 이동시켜 진행 거리를 잰다(BK_NONE=-1 순수 직진). */
function manualBulletTravel(cfg: WorldConfig): number {
  const state = createWorld(SEED, cfg);
  const b = blankEntity('enemyBullet');
  b.x = 700;
  b.y = 0;
  b.vx = 300;
  b.vy = 0;
  b.enemyType = -1; // BK_NONE — 거동 no-op
  b.life = 600;
  b.radius = 6;
  const added = addEntity(state, b);
  const x0 = added.x;
  stepWorld(state, emptyInput());
  return added.x - x0; // +x 진행량. 빠를수록 크다.
}

function nearestEnemy(state: WorldState): { x: number; y: number } | undefined {
  const p = state.entities[0];
  if (p === undefined) return undefined;
  let best: { x: number; y: number } | undefined;
  let bd = Infinity;
  for (const e of state.entities) {
    if (e.kind !== 'enemy') continue;
    const d = length(e.x - p.x, e.y - p.y);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/** 최근접 적에서 **달아나며**(auto-fire 는 사거리 밖이라 처치 최소) 동시 생존 적 최대 수를 잰다.
 *  enemyCount 페널티가 maxEnemies 캡을 올려 더 많은 적이 동시에 살아 있게 되는지 본다.
 *  레벨업 프리즈는 0번 파워업 선택으로 넘긴다. */
function fleeRunPeak(cfg: WorldConfig, ticks = 3000): number {
  const state = createWorld(SEED, cfg);
  let peak = 0;
  for (let i = 0; i < ticks; i++) {
    let f: InputFrame = emptyInput();
    if (state.pendingLevelUp) {
      f = { ...emptyInput(), special: packPowerupPick(0) };
    } else {
      const p = state.entities[0];
      const t = nearestEnemy(state);
      if (p !== undefined && t !== undefined) {
        const dx = p.x - t.x;
        const dy = p.y - t.y;
        const l = length(dx, dy) || 1;
        f = { moveX: dx / l, moveY: dy / l, aim: 0, dash: false, special: 0 };
      }
    }
    stepWorld(state, f);
    let n = 0;
    for (const e of state.entities) if (e.kind === 'enemy') n++;
    if (n > peak) peak = n;
  }
  return peak;
}

describe('촉매 페널티 6축 — sim 노브 부호 관측', () => {
  it('enemyHp: 적 스폰 HP 가 상승한다', () => {
    expect(firstEnemyStats(base({ catalysts: [1, 1, 1] })).maxHp).toBeGreaterThan(
      firstEnemyStats(base()).maxHp,
    );
  });

  it('enemyDamage: 적 접촉 피해가 상승한다', () => {
    expect(firstEnemyStats(base({ catalysts: [2, 2, 2] })).damage).toBeGreaterThan(
      firstEnemyStats(base()).damage,
    );
  });

  it('enemySpeed: 적 이동 속도가 상승한다(원점 접근량↑)', () => {
    expect(manualEnemyTravel(base({ catalysts: [3, 3, 3] }))).toBeGreaterThan(
      manualEnemyTravel(base()),
    );
  });

  it('enemyBulletSpeed: 적탄 배속이 상승한다(1틱 진행량↑)', () => {
    expect(manualBulletTravel(base({ catalysts: [4, 4, 4] }))).toBeGreaterThan(
      manualBulletTravel(base()),
    );
  });

  it('enemyCount: 동시 생존 적 최대 수가 상승한다', () => {
    // 슬롯 상한까지 스택(enemyCount ×8 → 캡 배율 2.6)으로 신호를 최대화한다.
    expect(fleeRunPeak(base({ catalysts: [0, 0, 0, 0, 0, 0, 0, 0] }))).toBeGreaterThan(
      fleeRunPeak(base()),
    );
  });

  it('playerHpDown: 플레이어 최대 HP 가 하락한다', () => {
    const empty = createWorld(SEED, base());
    const pen = createWorld(SEED, base({ catalysts: [8, 8, 8] }));
    expect(pen.entities[0]!.maxHp).toBeLessThan(empty.entities[0]!.maxHp);
  });
});

// ---------------------------------------------------------------------------
// ③ 보상 4축 — 결정론 주입 하네스로 축 격리
// ---------------------------------------------------------------------------

/**
 * 목표 **드랍** 표본 수. 구 구현(엘리트 처치 = 확정 드랍)에서 주입 220기가 내던 표본 크기다.
 */
const TARGET_DROP_SAMPLES = 220;

/**
 * 목표 표본을 내는 주입 엘리트 수 — **`eliteDropChance` 에서 역산한다**(하드코딩 금지).
 *
 * ADR-0035 가 엘리트 드랍을 확정 → 확률로 바꾸면서 같은 주입 수가 내는 드랍이 약 28배 줄었고,
 * rarity 축 관측이 표본 부족으로 뭉개졌다(무촉매·유촉매 평균 등급이 **둘 다 정확히 2.0** 으로
 * 나와 부호 판정 자체가 불가능해졌다). 확률에서 역산해 두면 앞으로 `eliteDropChance` 가 다시
 * 바뀌어도 표본 크기가 자동으로 따라간다 — 단언(부호 방향)은 한 글자도 약화하지 않는다.
 */
const ELITE_INJECT_COUNT = Math.ceil(
  TARGET_DROP_SAMPLES / eliteDropChance(stageParams(11).eliteCount),
);

/** 죽은 엘리트 N기를 플레이어 위치에 주입 → sweep 이 드랍 게이트(rollEliteDropGate)와 드랍 롤
 *  (rollEliteDrop + bonusLootSeeds)을 돌고, 스폰된 루팅을 몇 틱 안에 수거한다. 주입은 dropRng
 *  소비가 촉매와 무관하게 동일하므로, 무촉매 대비 차이는 촉매 drop(추가 루팅)·rarity(등급) 축만
 *  격리한다. */
function harvestElites(
  cfg: WorldConfig,
  count = ELITE_INJECT_COUNT,
): { count: number; avgRarity: number } {
  const state = createWorld(SEED, cfg);
  const p = state.entities[0]!;
  for (let k = 0; k < count; k++) {
    const e = blankEntity('enemy');
    e.x = p.x;
    e.y = p.y;
    e.radius = 18;
    e.hp = 0;
    e.maxHp = 1;
    e.enemyType = 0;
    e.damage = 0;
    e.dead = true; // sweep 이 처리하도록 사망 표시
    makeElite(e, k % ELITE_AFFIX_COUNT);
    addEntity(state, e);
  }
  stepWorld(state, emptyInput()); // sweep → spawnLoot(플레이어 위치)
  for (let i = 0; i < 6; i++) stepWorld(state, emptyInput()); // 접촉 수거 → state.loot
  let s = 0;
  for (const r of state.loot) s += r.rarity;
  return { count: state.loot.length, avgRarity: state.loot.length ? s / state.loot.length : 0 };
}

/** 죽은 보급 N기 주입 → sweep 이 자원 적립(밀리 캐리)을 돈다. */
function harvestSupply(cfg: WorldConfig, count = 30): number {
  const state = createWorld(SEED, cfg);
  const p = state.entities[0]!;
  for (let k = 0; k < count; k++) {
    const e = blankEntity('supply');
    e.x = p.x + 3000; // 플레이어에서 떨어뜨려 접촉 피해 무관
    e.y = p.y;
    e.radius = 18;
    e.hp = 0;
    e.maxHp = 1;
    e.dead = true;
    addEntity(state, e);
  }
  stepWorld(state, emptyInput());
  return state.resources;
}

describe('촉매 보상 4축 — 부호 관측', () => {
  it('drop(드랍량): 엘리트 추가 루팅으로 총 드랍 수가 늘어난다', () => {
    const withDrop = harvestElites(base({ catalysts: [1, 1, 1] })).count;
    const none = harvestElites(base()).count;
    expect(none).toBeGreaterThan(0); // 주입 하네스가 실제로 드랍을 냈는지 sanity
    expect(withDrop).toBeGreaterThan(none);
  });

  it('rarity(희귀도): 평균 드랍 등급이 올라간다', () => {
    const withRar = harvestElites(base({ catalysts: [5, 5, 5] })).avgRarity;
    const none = harvestElites(base()).avgRarity;
    expect(none).toBeGreaterThan(0);
    expect(withRar).toBeGreaterThan(none);
  });

  it('resource(자원): 보급 습격 크레딧 적립이 늘어난다', () => {
    const withRes = harvestSupply(base({ catalysts: [15, 15, 15] }));
    const none = harvestSupply(base());
    expect(none).toBeGreaterThan(0);
    expect(withRes).toBeGreaterThan(none);
  });

  it('xp(경험치): 레벨업 이전 창에서 누적 XP 가 더 빠르게 쌓인다', () => {
    // [10]=xp+enemySpeed vs [3]=drop+enemySpeed — 페널티 동일 → 첫 레벨업 전까지 처치·젬 동일.
    // xp 는 레벨업 타이밍에 되먹임하므로 lockstep 이 아니다: 첫 pendingLevelUp 직전에서 비교한다.
    const a = createWorld(SEED, base({ catalysts: [10, 10, 10] }));
    const b = createWorld(SEED, base({ catalysts: [3, 3, 3] }));
    let axp = 0;
    let bxp = 0;
    for (let i = 0; i < 4000; i++) {
      if (a.pendingLevelUp || b.pendingLevelUp) break;
      for (const state of [a, b]) {
        const p = state.entities[0];
        const t = nearestEnemy(state);
        let frame: InputFrame = emptyInput();
        if (p !== undefined && t !== undefined) {
          const dx = t.x - p.x;
          const dy = t.y - p.y;
          const l = length(dx, dy) || 1;
          frame = { moveX: dx / l, moveY: dy / l, aim: atan2(dy, dx), dash: false, special: 0 };
        }
        stepWorld(state, frame);
      }
      axp = a.xpTotal;
      bxp = b.xpTotal;
    }
    expect(axp).toBeGreaterThan(0); // 실제로 XP 를 벌었는지 sanity
    expect(axp).toBeGreaterThan(bxp);
  });
});

// ---------------------------------------------------------------------------
// ④ 파워축 — loadout 파생과 이중 적용이 아님(단일 적용)
// ---------------------------------------------------------------------------

describe('촉매 파워축 — 단일 적용(loadout 파생과 이중 아님)', () => {
  it('damage 파워 배율이 정확히 1회만 곱해진다(제곱 아님)', () => {
    const cats = [25, 25, 25]; // power damage ×3 → mult = 1 + 3*0.1 = 1.3
    const m = catalystPowerMult(cats, 'damage');
    const emptyState = createWorld(SEED, base());
    const powState = createWorld(SEED, base({ catalysts: cats }));
    const ratio = powState.weapon.damage / emptyState.weapon.damage;
    // 단일 적용이면 비율 ≈ m. 이중(제곱)이면 ≈ m² 이다.
    expect(ratio).toBeCloseTo(m, 2);
    expect(powState.weapon.damage).toBeLessThan(emptyState.weapon.damage * m * m * 0.999);
  });

  it('maxHp 파워는 상향, playerHpDown 페널티는 하향으로 서로 반대 부호다', () => {
    const up = createWorld(SEED, base({ catalysts: [28, 28, 28] })); // power maxHp
    const down = createWorld(SEED, base({ catalysts: [8, 8, 8] })); // playerHpDown penalty
    const neutral = createWorld(SEED, base());
    expect(up.entities[0]!.maxHp).toBeGreaterThan(neutral.entities[0]!.maxHp);
    expect(down.entities[0]!.maxHp).toBeLessThan(neutral.entities[0]!.maxHp);
  });
});
