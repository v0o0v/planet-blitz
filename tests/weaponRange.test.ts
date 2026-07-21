/**
 * 무기 사거리 의미론 회귀 (`fix/weapon-range-semantics`).
 *
 * ## 이 파일이 막는 것
 * `weapon.range` 는 오래도록 **`0 = 무제한` 센티널**이었다. 기본값이 0 이라 무투자가
 * 무제한 조준이었고, 사거리에 1점이라도 투자하면 조준 상한이 무한에서 유한값으로
 * **좁아졌다** — 데이터 문안 9곳이 전부 "사거리 +N/pt" 로 이득을 약속하는데 실제 부호는
 * 반대였다. 오토파일럿 카이팅 거리(`KITE_DISTANCE` 460)보다 짧아지면 `autoAttack` 이 매 틱
 * 표적 없음으로 조기 반환해 **한 발도 쏘지 않았다**: 만렙 99pt 투자 시 파생 사거리가
 * 스트라이커 170 · 브루저 106 · 팬텀 135 · 말로우 22 로 7기체 중 4기체가 사격 불능이었다.
 *
 * 단위 테스트는 전부 그린이었다. 사거리 축을 밟는 테스트가 하나도 없었기 때문이다
 * (`tests/invasionBalance.test.ts` 하네스조차 `rangeAdd: 0` 고정). 그래서 여기서는 **사거리
 * 투자를 실제로 실은 상태로** 정규 경로(`createWorld` → `stepWorld`)를 굴려 탄이 나가는지를
 * 직접 본다.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  emptyInput,
  DEFAULT_CONFIG,
  DEFAULT_WEAPON,
  BASE_WEAPON_RANGE,
  DT,
} from '../src/sim/world.js';
import type { WorldConfig, LoadoutConfig } from '../src/sim/world.js';
import { blankEntity, addEntity } from '../src/sim/entities.js';
import { autopilotInput, KITE_DISTANCE } from '../src/sim/autopilot.js';
import { computeLoadoutStats, WEAPON_BEAM } from '../src/items/loadout.js';
import { POWERUPS, drawPowerupChoices } from '../src/sim/powerups.js';

// ---------------------------------------------------------------------------
// 하네스
// ---------------------------------------------------------------------------

/** 사거리 축만 건드리는 중립 장비 블록(다른 스탯은 전부 항등원). */
function neutralGear(over: Partial<LoadoutConfig> = {}): LoadoutConfig {
  return {
    weaponType: 0,
    subWeaponType: -1,
    damageMult: 1,
    fireRateMult: 1,
    bulletCountAdd: 0,
    pierceAdd: 0,
    bulletSpeedMult: 1,
    spreadAdd: 0,
    rangeAdd: 0,
    moveSpeedMult: 1,
    maxHpAdd: 0,
    dashCdMult: 1,
    magnetMult: 1,
    xpMult: 1,
    uniqueMask: 0,
    fireDmg: 0,
    coldSlow: 0,
    lightning: 0,
    ...over,
  };
}

function worldWith(loadout: LoadoutConfig, seed = 1): ReturnType<typeof createWorld> {
  const cfg: WorldConfig = { ...DEFAULT_CONFIG, loadout };
  return createWorld(seed, cfg);
}

function bullets(state: ReturnType<typeof createWorld>): { life: number }[] {
  return state.entities.filter((e) => e.kind === 'bullet' && !e.dead);
}

/**
 * **표적 하나만 있는 판**을 만들어 한 틱 굴린다.
 *
 * 사거리를 재려면 "이 거리의 표적을 잡았는가"가 다른 표적에 오염되지 않아야 하는데,
 * 정규 런은 첫 틱부터 적을 700~1100 거리에 스폰한다(자동 조준은 **최근접**을 고르므로
 * 그쪽이 먼저 뽑힌다). 그래서 ①한 틱 굴려 첫 파도를 다 스폰시키고 ②플레이어와 표적만
 * 남긴 뒤 ③다시 한 틱 굴린다. 벽은 시야 차폐로 조준을 가로막으므로 함께 비운다.
 */
function fireOnce(loadout: LoadoutConfig, dist: number): ReturnType<typeof createWorld> {
  const state = worldWith(loadout);
  stepWorld(state, emptyInput());
  const player = state.entities[0]!;
  const target = blankEntity('enemy');
  target.x = player.x + dist;
  target.y = player.y;
  target.radius = 30;
  target.hp = 1_000_000; // 한 방에 죽어 표적이 사라지는 일이 없게
  target.maxHp = 1_000_000;
  target.enemyType = 0;
  addEntity(state, target);
  for (const e of state.entities) {
    if (e !== player && e !== target) e.dead = true;
  }
  state.activeWalls.length = 0;
  player.cooldown = 0;
  stepWorld(state, emptyInput());
  return state;
}

/** `dist` 에 놓인 표적을 상대로 발사가 일어나는지. */
function firesAt(loadout: LoadoutConfig, dist: number): boolean {
  return bullets(fireOnce(loadout, dist)).length > 0;
}

/**
 * 첫 발이 **스폰될 때** 받은 수명(틱). 관측 시점은 발사한 틱의 끝이라 이미 1 감소한
 * 뒤이므로 되돌려 준다(`stepProjectiles` 가 같은 틱에 한 번 깎는다).
 */
function spawnedLife(loadout: LoadoutConfig): number {
  return bullets(fireOnce(loadout, 300))[0]!.life + 1;
}

// ---------------------------------------------------------------------------
// ① 기준 사거리 상수 계약
// ---------------------------------------------------------------------------

describe('사거리 의미론 — 기준값 계약', () => {
  it('기본 사거리가 유한하다(0 = 무제한 센티널 폐기)', () => {
    expect(DEFAULT_WEAPON.range).toBe(BASE_WEAPON_RANGE);
    expect(BASE_WEAPON_RANGE).toBeGreaterThan(0);
  });

  it('기준 사거리가 오토파일럿 카이팅 거리보다 충분히 멀다', () => {
    // 이 부등식이 깨지면 봇이 붙박이는 거리에서 사격이 멎는다 — 결함의 발화 조건 그 자체다.
    // 여유를 3배로 잡는 이유는 사거리가 **더해지기만** 하므로 어떤 투자 조합에서도
    // 기준값이 하한이기 때문이다.
    expect(BASE_WEAPON_RANGE).toBeGreaterThan(KITE_DISTANCE * 3);
  });

  it('기준 사거리가 탄의 자연 도달거리와 같다(무투자 탄 거동 불변)', () => {
    // 사거리를 "닿는 거리"로 정의한 이상 무투자 기준값은 탄이 실제로 날아가는 거리와
    // 같아야 한다 — 짧으면 닿는데 안 쏘고, 길면 조준만 하고 탄이 죽는다.
    const natural = DEFAULT_WEAPON.bulletSpeed * DT * DEFAULT_WEAPON.bulletLife;
    expect(BASE_WEAPON_RANGE).toBe(natural);
    expect(spawnedLife(neutralGear())).toBe(DEFAULT_WEAPON.bulletLife);
  });
});

// ---------------------------------------------------------------------------
// ② 조준 상한이 실제 사거리와 같다
// ---------------------------------------------------------------------------

describe('사거리 의미론 — 조준 상한', () => {
  it('사거리 안 표적은 쏘고, 밖 표적은 쏘지 않는다', () => {
    const gear = neutralGear(); // 기준 1650
    expect(firesAt(gear, 1500)).toBe(true);
    expect(firesAt(gear, 1800)).toBe(false);
  });

  it('사거리 투자가 조준 획득 거리를 실제로 넓힌다', () => {
    // 결함 시절에는 **정확히 반대**였다: 투자하면 무한이던 상한이 좁아졌다.
    const far = 2000;
    expect(firesAt(neutralGear(), far)).toBe(false); // 기준 1650 < 2000
    expect(firesAt(neutralGear({ rangeAdd: 800 }), far)).toBe(true); // 2450 > 2000
    expect(firesAt(neutralGear({ rangeAdd: 800 }), 2600)).toBe(false); // 상한도 유한하다
  });
});

// ---------------------------------------------------------------------------
// ③ 사거리 투자가 전 구간 단조 이득
// ---------------------------------------------------------------------------

describe('사거리 의미론 — 투자 단조성', () => {
  it.each([0, 22, 106, 135, 170, 400, 1200])(
    'rangeAdd %d 프로필이 오토파일럿 런에서 실제로 사격한다',
    (rangeAdd) => {
      // 목록의 22 · 106 · 135 · 170 은 결함 시절 만렙 투자 시 실제로 붙던 파생 사거리다
      // (말로우 22.56 · 브루저 106.4 · 팬텀 135.36 · 스트라이커 170.24). 전부
      // KITE_DISTANCE(460) 미만이라 그 기체들은 한 발도 쏘지 못했다.
      const state = worldWith(neutralGear({ rangeAdd }));
      let firedTicks = 0;
      for (let t = 0; t < 900; t++) {
        stepWorld(state, autopilotInput(state));
        if (bullets(state).length > 0) firedTicks++;
        if (state.gameOver) break;
      }
      expect(firedTicks, `rangeAdd ${rangeAdd} 이 한 발도 쏘지 못했다`).toBeGreaterThan(0);
    },
  );

  it('탄 수명이 늘어난 사거리를 끝까지 덮는다', () => {
    // 사거리는 "닿는 거리"라는 계약이다. 조준만 넓히고 탄이 중간에 죽으면 계약 위반.
    const rangeAdd = 1200;
    const reach = BASE_WEAPON_RANGE + rangeAdd;
    const perTick = DEFAULT_WEAPON.bulletSpeed * DT;
    const life = spawnedLife(neutralGear({ rangeAdd }));
    expect(life).toBe(Math.ceil(reach / perTick));
    expect(life * perTick).toBeGreaterThanOrEqual(reach);
    expect(life).toBeGreaterThan(DEFAULT_WEAPON.bulletLife);
  });
});

// ---------------------------------------------------------------------------
// ④ 빔 — 타격선이 조준 사거리와 같다
// ---------------------------------------------------------------------------

/** 빔 주무기 하나만 장착한 파생 장비 블록(아키타입 기준 보정이 실제로 실린다). */
function beamLoadout(): LoadoutConfig {
  const { loadout } = computeLoadoutStats([
    {
      id: 'beam',
      slot: 'main',
      rarity: 'rare',
      affixes: [],
      source: { planet: 0, tier: 0 },
      weaponType: WEAPON_BEAM,
    },
  ]);
  return loadout;
}

describe('사거리 의미론 — 빔 아키타입', () => {
  it('빔 기준 사거리가 800 이다(loadout 의 음수 보정과 sim 기준값이 갈라지지 않았다)', () => {
    // `src/items/loadout.ts` 는 sim 런타임을 값으로 import 하지 않는 규율이라 1650 을
    // 직접 참조하지 못하고 -850 이라는 델타만 들고 있다. 두 상수가 조용히 갈라지면
    // 빔이 세그먼트 상한(16 × 90 = 1440)에 처음부터 붙어 사거리 투자가 통째로 무효가
    // 되므로, 합성 결과를 여기서 못 박는다.
    const state = worldWith(beamLoadout());
    expect(state.weapon.range).toBe(800);
  });

  it('세그먼트 개수가 사거리를 정확히 덮는다', () => {
    // 예전에는 조준 상한(w.range)과 세그먼트 커버리지가 따로 굴러, 사거리 투자가
    // 세그먼트에는 이득이고 조준에는 손해인 **부호가 엇갈린** 상태였다.
    expect(bullets(fireOnce(beamLoadout(), 300)).length).toBe(Math.floor(800 / 90)); // 8
  });

  it('사거리 투자가 빔 세그먼트를 늘린다', () => {
    const base = beamLoadout();
    const invested = { ...base, rangeAdd: base.rangeAdd + 320 };
    expect(bullets(fireOnce(invested, 300)).length).toBe(Math.floor(1120 / 90)); // 12
  });
});

// ---------------------------------------------------------------------------
// ⑤ 무기 전용 강화는 오프빌드에 제시되지 않는다
// ---------------------------------------------------------------------------

describe('강화 제시 — 오프빌드 무기 전용 배제', () => {
  it('벌컨 빌드는 다른 무기 전용 강화를 한 번도 제시하지 않는다', () => {
    // 예전에는 가중값을 2 로 낮췄을 뿐 배제하지 않아 **실제로 뽑혔다** — 벌컨 빌드
    // 24시드 중 1시드가 빔 전용 '집속 렌즈'를 먹는 것이 7기체 전부에서 관측됐다.
    const state = worldWith(neutralGear());
    for (let i = 0; i < 500; i++) {
      for (const idx of drawPowerupChoices(state, 3)) {
        const def = POWERUPS[idx]!;
        expect(
          def.weaponType === undefined || def.weaponType === state.weapon.weaponType,
          `벌컨 빌드에 ${def.id}(weaponType ${String(def.weaponType)}) 가 제시됐다`,
        ).toBe(true);
      }
    }
  });

  it('빔 빌드는 빔 전용 강화를 제시한다(배제가 과하지 않다)', () => {
    const state = worldWith(beamLoadout());
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      for (const idx of drawPowerupChoices(state, 3)) seen.add(POWERUPS[idx]!.id);
    }
    expect(seen.has('beam-focuser')).toBe(true);
  });
});
