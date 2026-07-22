/**
 * M2 파밍 루프 통합 검증 (Lane 4 Phase G — plan §4 G1/G2, AC2·AC3·AC4·AC8).
 *
 * 세 레인(아이템·드랍·무기 / 세이브·정산·UI / 베르단·유니크)이 병렬로 만든 접합부가
 * 실제로 하나의 사이클로 이어지는지 end-to-end로 확인한다:
 *   베르단 교전 런 → (엘리트·보스) 드랍 → 정산(settleRun/rollItem) → 장착 →
 *   재런에서 로드아웃 스탯 반영.
 * 개별 유닛(rollItem 순수성·정산 왕복·유니크 훅·베르단 스폰)은 각 레인 테스트가 이미
 * 커버한다. 여기서는 그 조각들이 실제 데이터 흐름으로 연결되는지를 본다.
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
import { runReplay } from '../src/sim/replay.js';
import { atan2, length } from '../src/sim/math.js';
import { blankEntity, addEntity } from '../src/sim/entities.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { settleRun } from '../src/save/settlement.js';
import { EQUIP_SLOTS } from '../src/items/types.js';
import type { Item } from '../src/items/types.js';
import {
  computeLoadoutStats,
  neutralLoadout,
  WEAPON_SPREAD,
  WEAPON_VULCAN,
} from '../src/items/loadout.js';
import { RARITY_RARE, RARITY_UNIQUE } from '../src/sim/drops.js';

// 베르단 교전 티어 + 유니크 로드아웃(과열 드럼 bit0) — 베르단·티어·로드아웃·유니크를 한
// config에 모아 드랍 시퀀스 결정론을 종합 게이트한다. 불멸 파일럿으로 보스까지 완주 보장.
const BERDAN_ENGAGE: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 1,
  stage: 11,
  playerHp: 100_000_000,
  loadout: { ...neutralLoadout(), weaponType: WEAPON_VULCAN, uniqueMask: 1 << 0 },
};

/**
 * 보스까지 완주하고, 승리 후 바닥 loot(보스 확정 드랍 등)를 실제로 주워 담을 때까지
 * 조종한다. 프레임은 상태에서 계산해 기록하므로 runReplay가 그대로 재현한다.
 */
function playAndLoot(seed: number, config: WorldConfig): {
  state: WorldState;
  inputs: InputFrame[];
} {
  const state = createWorld(seed, config);
  const inputs: InputFrame[] = [];
  const maxTicks = 60 * 700;
  let grace = 0;
  for (let t = 0; t < maxTicks; t++) {
    const player = state.entities[0]!;
    const boss = state.entities.find((e) => e.kind === 'boss');
    const lootE = state.entities.find((e) => e.kind === 'loot');
    let frame: InputFrame;
    if (state.pendingLevelUp) {
      frame = { ...emptyInput(), special: packPowerupPick(0) };
    } else if (boss !== undefined) {
      // 보스가 있으면 보스에 붙는다(완주 우선).
      const dx = boss.x - player.x;
      const dy = boss.y - player.y;
      const len = length(dx, dy) || 1;
      frame = { moveX: dx / len, moveY: dy / len, aim: atan2(dy, dx), dash: false, special: 0 };
    } else if (state.victory && lootE !== undefined) {
      // 승리 후: 남은 바닥 loot로 이동해 접촉 수거.
      const dx = lootE.x - player.x;
      const dy = lootE.y - player.y;
      const len = length(dx, dy) || 1;
      frame = { moveX: dx / len, moveY: dy / len, aim: atan2(dy, dx), dash: false, special: 0 };
    } else {
      frame = emptyInput();
    }
    inputs.push(frame);
    stepWorld(state, frame);
    if (state.gameOver) break;
    // 승리 + 바닥 loot 모두 수거되면 종료(짧은 유예로 픽업 확정).
    if (state.victory && state.entities.every((e) => e.kind !== 'loot')) {
      if (++grace > 20) break;
    } else {
      grace = 0;
    }
  }
  return { state, inputs };
}

describe('파밍 루프 end-to-end (G1, AC8/AC3)', () => {
  const { state } = playAndLoot(0xfa11, BERDAN_ENGAGE);

  it('베르단 교전 런이 완주하고 실제 드랍이 정산 큐에 쌓인다', () => {
    expect(state.victory).toBe(true);
    expect(state.bossSpawned).toBe(true);
    // 보스 확정 드랍이 최소 1건은 수거돼야 한다.
    expect(state.loot.length).toBeGreaterThan(0);
    // 모든 드랍이 베르단(planet=1)·단계11(구 교전)으로 스탬프된다(행성 소스 정합).
    for (const rec of state.loot) {
      expect(rec.planet).toBe(1);
      expect(rec.stage).toBe(11);
    }
    // 보스 드랍은 레어 이상 확정(GDD §3) — 최소 한 건은 rare+ 여야 한다.
    expect(state.loot.some((r) => r.rarity === RARITY_RARE || r.rarity === RARITY_UNIQUE)).toBe(true);
  });

  it('정산이 드랍을 아이템으로 확정해 인벤에 적재한다(rollItem 연결)', () => {
    const profile = defaultProfile();
    const out = settleRun(profile, {
      victory: state.victory,
      loot: state.loot,
      xpTotal: state.xpTotal,
      resources: state.resources,
    });
    expect(out.itemsGained.length).toBe(state.loot.length);
    expect(profile.inventory.length).toBe(state.loot.length);
    // 레어+ 드랍이 하나라도 있으면 그 소스가 베르단으로 보존된다.
    const rarePlus = out.itemsGained.find((it) => it.rarity === 'rare' || it.rarity === 'unique');
    expect(rarePlus).toBeDefined();
    expect(rarePlus!.source.planet).toBe(1);
  });
});

describe('드랍 시드 시퀀스 결정론 (G2, AC2)', () => {
  it('동일 [시드+입력+로드아웃+베르단] 2회 실행이 해시·드랍 시퀀스 모두 일치한다', () => {
    const { state, inputs } = playAndLoot(0xd0e5, BERDAN_ENGAGE);
    expect(state.loot.length).toBeGreaterThan(0);
    const a = runReplay({ seed: 0xd0e5, config: BERDAN_ENGAGE, inputs });
    const b = runReplay({ seed: 0xd0e5, config: BERDAN_ENGAGE, inputs });
    // 틱별 해시 100% 일치.
    expect(a.hashes).toEqual(b.hashes);
    // 드랍 시드 시퀀스(정산 입력)도 bit-identical — 서버 재현이 같은 아이템을 낳는 근거.
    expect(a.finalState.loot).toEqual(b.finalState.loot);
    // 라이브 시뮬 경로와 리플레이 경로도 동일 드랍 시퀀스.
    expect(a.finalState.loot).toEqual(state.loot);
  });
});

/** 플레이어 옆에 정지 표적을 두어 autoAttack이 물게 한다. */
function addTarget(state: WorldState): void {
  const player = state.entities[0]!;
  const e = blankEntity('enemy');
  e.x = player.x + 200;
  e.y = player.y;
  e.radius = 30;
  e.hp = 100_000;
  e.maxHp = 100_000;
  e.enemyType = 0;
  addEntity(state, e);
}

describe('장착 → 재런 스탯 반영 (G1, AC4)', () => {
  it('스프레드 주무기를 장착하면 재런 발사 궤적이 실제로 바뀐다', () => {
    // main.ts startRun과 동일 경로: ship.equipped → EQUIP_SLOTS 수집 → computeLoadoutStats.
    const profile = defaultProfile();
    const spread: Item = {
      id: 'it-spread',
      slot: 'main',
      rarity: 'rare',
      affixes: [],
      source: { planet: 1, stage: 11 },
      weaponType: WEAPON_SPREAD,
    };
    activeShip(profile).equipped.main = spread;

    const equipped: Item[] = [];
    for (const id of EQUIP_SLOTS) {
      const it = activeShip(profile).equipped[id];
      if (it !== undefined) equipped.push(it);
    }
    const { loadout } = computeLoadoutStats(equipped);
    const equippedWorld = createWorld(1, { ...DEFAULT_CONFIG, loadout });
    addTarget(equippedWorld);
    stepWorld(equippedWorld, emptyInput());
    const spreadBullets = equippedWorld.entities.filter((e) => e.kind === 'bullet').length;

    // 미장착(중립 발칸) 기준선.
    const neutralWorld = createWorld(1, { ...DEFAULT_CONFIG, loadout: neutralLoadout() });
    addTarget(neutralWorld);
    stepWorld(neutralWorld, emptyInput());
    const neutralBullets = neutralWorld.entities.filter((e) => e.kind === 'bullet').length;

    // 스프레드는 부채꼴 다탄(3발), 중립 발칸 단발(1발) — 장착이 재런 거동을 바꾼다.
    expect(spreadBullets).toBeGreaterThan(neutralBullets);
    expect(spreadBullets).toBe(3);
    expect(neutralBullets).toBe(1);
  });
});
