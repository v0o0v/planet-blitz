import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig } from '../src/sim/world.js';
import { blankEntity, addEntity, spawnLoot } from '../src/sim/entities.js';
import {
  computeLoadoutStats,
  neutralLoadout,
  WEAPON_VULCAN,
  WEAPON_RAILGUN,
  WEAPON_SPREAD,
} from '../src/items/loadout.js';
import {
  rollEliteDrop,
  rollEliteDropGate,
  rollBossDrop,
  eliteDropChance,
  stageRareMult,
  stageUniqueMult,
  DEFAULT_DROP_ODDS,
  TARGET_ELITE_DROPS_PER_RUN,
  EXPECTED_CARDS_PER_RUN,
  RARITY_RARE,
  RARITY_UNIQUE,
} from '../src/sim/drops.js';
import { SeededRng } from '../src/sim/rng.js';
import { isElite } from '../src/sim/elite.js';
import { stageParams } from '../data/waves.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { standardEquipped, standardSkillInvest } from '../src/bench/standardBuild.js';

function countKind(state: { entities: { kind: string }[] }, kind: string): number {
  return state.entities.filter((e) => e.kind === kind).length;
}

describe('drop rolls (AC3)', () => {
  it('rollEliteDrop is deterministic and yields a valid rarity', () => {
    const a = rollEliteDrop(new SeededRng(5), 1, 1); // rarityMult 1 = 무촉매
    const b = rollEliteDrop(new SeededRng(5), 1, 1);
    expect(a).toEqual(b);
    expect(a.rarityCode).toBeGreaterThanOrEqual(1);
    expect(a.rarityCode).toBeLessThanOrEqual(3);
  });

  it('rollBossDrop always yields rare or unique (guaranteed high-tier)', () => {
    for (let s = 1; s <= 300; s++) {
      const roll = rollBossDrop(new SeededRng(s), 1, 1); // rarityMult 1 = 무촉매
      expect([RARITY_RARE, RARITY_UNIQUE]).toContain(roll.rarityCode);
    }
  });
});

describe('loot pickup accumulation (AC3, OQ-M2-1 contact auto-collect)', () => {
  it('collects a loot drop on contact and records seed/rarity/source', () => {
    const cfg: WorldConfig = { ...DEFAULT_CONFIG, planet: 1, stage: 11 };
    const state = createWorld(123, cfg);
    const player = state.entities[0]!;
    spawnLoot(state, player.x, player.y, 0xabcdef, RARITY_RARE);
    stepWorld(state, emptyInput());
    expect(state.loot.length).toBe(1);
    // `elite: 1` = 바닥에서 주운 전리품은 엘리트 유래라는 표식(ADR-0038 — 특산 설계도 역수
    // 보정이 보스 확정 드랍과 구분하는 데 쓴다). `hashWorld` 는 이 필드를 접지 않는다.
    expect(state.loot[0]).toEqual({
      seed: 0xabcdef,
      rarity: RARITY_RARE,
      planet: 1,
      stage: 11,
      elite: 1,
    });
    expect(countKind(state, 'loot')).toBe(0); // consumed
  });
});

describe('elite spawning by 침략 단계 (AC9)', () => {
  // Elites are combatants that get killed, so count the max seen alive across
  // the run rather than the final tick.
  const maxElitesSeen = (stage: number): number => {
    const state = createWorld(0x1234, { ...DEFAULT_CONFIG, stage });
    const input = emptyInput();
    let max = 0;
    for (let t = 0; t < 400; t++) {
      stepWorld(state, input);
      const n = state.entities.filter(isElite).length;
      if (n > max) max = n;
    }
    return max;
  };

  it('전 밴드가 정예를 스폰한다(ADR-0035 — 저단계에도 드랍원이 있다)', () => {
    // 구 계약은 "밴드0(단계1~10)은 승격 없음" 이었다. ADR-0035 가 그것을 의도적으로 깼다 —
    // 엘리트가 잡몹 전리품의 유일한 드랍원인데 저단계에 0 이면 드랍원이 아예 없기 때문이다.
    expect(maxElitesSeen(1)).toBeGreaterThan(0); // 밴드0 = eliteCount 1
    expect(maxElitesSeen(11)).toBeGreaterThan(0); // 밴드1 = eliteCount 1
  });

  it('밴드2(단계21+)가 밴드0/1 보다 정예를 더 많이 승격시킨다(난이도 노브)', () => {
    // eliteCount 는 이제 순수 난이도 노브다 — 드랍 수량은 eliteDropChance 가 고정한다.
    expect(stageParams(21).eliteCount).toBeGreaterThan(stageParams(1).eliteCount);
  });
});

describe('엘리트 드랍 확률화 (ADR-0035, L3)', () => {
  it('런당 기대 드랍 수가 eliteCount 와 무관하게 고정된다(반비례 파생)', () => {
    // 기대 드랍/런 = (카드 수 × eliteCount) × p 이므로, p 가 eliteCount 에 반비례하면
    // 이 곱은 TARGET 로 상수가 된다 — 적 곡선 레인이 eliteCount 를 움직여도 유입이 불변.
    for (const stage of [1, 5, 10, 11, 20, 21, 40, 99]) {
      const eliteCount = stageParams(stage).eliteCount;
      const elites = EXPECTED_CARDS_PER_RUN * eliteCount;
      expect(elites * eliteDropChance(eliteCount)).toBeCloseTo(TARGET_ELITE_DROPS_PER_RUN, 10);
    }
  });

  it('확률은 [0,1] 이고 eliteCount 0 은 0 으로 가드된다(0 나눗셈 금지)', () => {
    for (const eliteCount of [1, 2, 3, 10, 1000]) {
      const p = eliteDropChance(eliteCount);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      expect(Number.isFinite(p)).toBe(true);
    }
    // 밴드 정의상 eliteCount 0 은 더 이상 없지만, 0 이 들어와도 Infinity 가 아니라 0 이어야 한다.
    expect(eliteDropChance(0)).toBe(0);
    expect(eliteDropChance(-1)).toBe(0);
  });

  it('게이트는 결정론이고 확률만큼만 통과시킨다', () => {
    const a = rollEliteDropGate(new SeededRng(7), 1);
    const b = rollEliteDropGate(new SeededRng(7), 1);
    expect(a).toBe(b);

    let pass = 0;
    const rng = new SeededRng(0xc0ffee);
    const N = 20000;
    for (let i = 0; i < N; i++) if (rollEliteDropGate(rng, 1)) pass++;
    // eliteCount 1 → p = 1.5 / 15 = 0.10. 표본 20k 의 SE 는 0.2pp 라 ±1pp 면 넉넉하다.
    expect(pass / N).toBeGreaterThan(eliteDropChance(1) - 0.01);
    expect(pass / N).toBeLessThan(eliteDropChance(1) + 0.01);
  });
});

/**
 * ADR-0035 "런당 장비 유입 2~3개" 를 **정규 경로 실런**으로 못박는 통합 가드.
 *
 * ## 왜 단위 테스트로는 부족한가 (이 가드가 존재하는 이유)
 * `eliteDropChance` 의 단위 테스트는 `기대 = 카드수 × eliteCount × p` 가 상수임만 확인한다.
 * 그런데 그 산식의 입력인 {@link EXPECTED_CARDS_PER_RUN} 은 **런 길이에 종속된 실측 상수**다 —
 * `data/waves.ts` 의 `SEGMENTS.killGoal` 예산이 바뀌면 조용히 낡는다. 2026-07-27 적 곡선 레인이
 * killGoal 합계를 80 → 240 으로 올리자 카드가 15 → 42장이 되어 **런당 장비가 2.5개에서 5.4개로
 * 뛰었는데, 단위 테스트는 전부 초록이었다.** 이 리포의 반복 결함("단위 테스트 그린인데 배선이
 * 통째로 어긋나 있다")과 정확히 같은 형태다.
 *
 * ## 무엇을 세는가
 * 촉매 무주입이면 `bonusLootSeeds` 가 빈 배열이므로 **그 런이 만든 장비 드랍 전량**은
 * `state.loot`(수거분 + 승리 틱 직접 기록분) + 바닥에 남은 `loot` 엔티티다. 수거율은 봇이
 * 바닥 전리품을 향해 이동하지 않는 특성에 좌우되므로(`autopilotInput` 은 loot 를 안 본다)
 * **수거분이 아니라 생성 전량**을 세야 설계값과 비교된다.
 */
describe('런당 장비 유입 통합 가드 (ADR-0035 §3.1 — 정규 경로 실런)', () => {
  /** 표준 빌드(ADR-0035 표준 진행 경로)로 한 런을 끝까지 돌린다. */
  function standardRun(stage: number, seed: number, planet = 0) {
    const p = defaultProfile();
    const s = activeShip(p);
    s.level = stage * 5;
    s.skillInvest = standardSkillInvest(s.typeId, s.level);
    s.equipped = standardEquipped(s.level, 0xbeef, planet);
    // ⚠️ **행성 인기 배율 1.0 기준으로 고정한다**(ADR-0038). `planetMult` 를 넘기지 않으므로
    // `planetMultCenti` 가 스탬프되지 않아 배율이 정확히 1 이다. 이 가드가 검증하는 것은
    // "런당 장비 유입 설계값"이지 배율 합성 결과가 아니다 — 배율 1.20 × 촉매 2.2 같은 조합의
    // 유입 재보정은 밸런스 큐(출시 전 일괄) 소관이고, 여기서 흔들리면 상수 재측정 신호가 흐려진다.
    const state = createWorld(seed, buildRunConfig(p, { planet, stage }));
    for (let i = 0; i < 60 * 400; i++) {
      stepWorld(state, autopilotInput(state));
      if (state.gameOver || state.victory) break;
    }
    // 촉매 무주입 → bonusLootSeeds 빈 배열 → 아래 합계가 곧 "그 런이 만든 장비 드랍 전량".
    return { victory: state.victory, drops: state.loot.length + countKind(state, 'loot') };
  }

  it('완주 런의 장비 드랍이 2~3개다 — 보스 확정 1 + 엘리트 기대 1.5', () => {
    const seeds = [1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007];
    const wins = seeds.map((sd) => standardRun(11, sd)).filter((r) => r.victory);
    // 표준 빌드가 대응 단계를 완주하지 못하면 이 가드는 아무것도 증명하지 못한다(공허 런 방어).
    expect(wins.length).toBeGreaterThanOrEqual(4);
    const mean = wins.reduce((a, r) => a + r.drops, 0) / wins.length;
    // 상한은 설계 3 에 표본 오차 여유를 얹은 3.5. 이 단언이 깨지면 십중팔구
    // EXPECTED_CARDS_PER_RUN 이 낡은 것이다 — 카드 수를 다시 재고 상수를 갱신하라.
    expect(mean, `런당 장비 ${mean.toFixed(2)}개 — EXPECTED_CARDS_PER_RUN 재측정 필요`).toBeGreaterThanOrEqual(2);
    expect(mean, `런당 장비 ${mean.toFixed(2)}개 — EXPECTED_CARDS_PER_RUN 재측정 필요`).toBeLessThanOrEqual(3.5);
  });
});

describe('단계 품질 곡선 (ADR-0035, L8)', () => {
  it('단계1 은 정확히 1.0 이다(단계1 불변 계약 — 부동소수 오차 금지)', () => {
    expect(stageRareMult(1)).toBe(1);
    expect(stageUniqueMult(1)).toBe(1);
    // 범위 밖(<1)도 1 로 클램프.
    expect(stageRareMult(0)).toBe(1);
    expect(stageUniqueMult(-5)).toBe(1);
  });

  it('단조 증가한다 — 계단이 아니라 매 단계 오른다(구 구현은 11+ 에서 평평했다)', () => {
    for (let s = 1; s < 200; s++) {
      expect(stageRareMult(s + 1), `rare ${s}`).toBeGreaterThan(stageRareMult(s));
      expect(stageUniqueMult(s + 1), `unique ${s}`).toBeGreaterThan(stageUniqueMult(s));
    }
  });

  it('상한에 점근하되 넘지 않는다(무한 상승 + 유계)', () => {
    // 점근 확률: rare 0.25×2.8 = 0.70 / unique 0.004×4.0 = 0.016(base 1/7.5 하향 후).
    expect(stageRareMult(1e9)).toBeLessThan(2.8);
    expect(stageRareMult(1e9)).toBeGreaterThan(2.79);
    expect(stageUniqueMult(1e9)).toBeLessThan(4.0);
    expect(stageUniqueMult(1e9)).toBeGreaterThan(3.99);
  });

  it('단계11 레어 배율이 구 계단값 1.6 과 일치한다(중간 밴드 급변 없음)', () => {
    expect(stageRareMult(11)).toBeCloseTo(1.6, 12);
  });

  it('무촉매 경로에서 unique + rare ≤ 1 이 항상 성립한다(threshold 순서 보존)', () => {
    // rollEliteDrop 은 `r < unique` → `r < unique + rare` 순서로 가른다. 합이 1 을 넘으면
    // 매직 바닥이 사라진다 — 촉매 배율 없이는 점근에서도 0.716 이라 구조적으로 안전하다.
    for (const s of [1, 11, 21, 100, 1e9]) {
      const sum = DEFAULT_DROP_ODDS.eliteUniqueBase * stageUniqueMult(s) + DEFAULT_DROP_ODDS.eliteRareBase * stageRareMult(s);
      expect(sum, `stage ${s}`).toBeLessThanOrEqual(1);
    }
  });
});

/** Spawn a stationary target enemy right next to the player so autoAttack fires. */
function addTargetEnemy(state: ReturnType<typeof createWorld>): void {
  const player = state.entities[0]!;
  const e = blankEntity('enemy');
  e.x = player.x + 200;
  e.y = player.y;
  e.radius = 30;
  e.hp = 100000; // survive the shot so we can count bullets cleanly
  e.maxHp = 100000;
  e.enemyType = 0;
  addEntity(state, e);
}

describe('weapon-type firing archetypes (AC4)', () => {
  function loadoutCfg(weaponType: number, bulletCountAdd: number): WorldConfig {
    return { ...DEFAULT_CONFIG, loadout: { ...neutralLoadout(), weaponType, bulletCountAdd } };
  }

  it('railgun fires a single shot regardless of bullet count; vulcan fans', () => {
    // Railgun with a large bulletCount add still fires ONE bullet per volley.
    const rail = createWorld(1, loadoutCfg(WEAPON_RAILGUN, 4));
    addTargetEnemy(rail);
    stepWorld(rail, emptyInput());
    expect(countKind(rail, 'bullet')).toBe(1);

    // Vulcan with the same bulletCount add fans that many pellets.
    const vulcan = createWorld(1, loadoutCfg(WEAPON_VULCAN, 4));
    addTargetEnemy(vulcan);
    stepWorld(vulcan, emptyInput());
    expect(countKind(vulcan, 'bullet')).toBe(5);
  });

  it('spread type fans multiple pellets from its computed baseline', () => {
    // A real spread loadout (via computeLoadoutStats) carries the +2 pellet
    // baseline, so it fans 3 pellets (base 1 + 2).
    const { loadout } = computeLoadoutStats([
      { id: 'm', slot: 'main', rarity: 'rare', affixes: [], source: { planet: 0, stage: 1 }, weaponType: WEAPON_SPREAD },
    ]);
    const spread = createWorld(1, { ...DEFAULT_CONFIG, loadout });
    addTargetEnemy(spread);
    stepWorld(spread, emptyInput());
    expect(countKind(spread, 'bullet')).toBe(3);
  });
});
