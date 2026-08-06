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
 * ## 삭제된 가드 — "런당 장비 유입 2~3개" 통합 가드 (2026-08-06, ADR-0051)
 *
 * 여기에 표준 빌드 16시드를 **완주까지** 돌려 런당 장비 드랍 평균이 2~3개인지 보는 가드가
 * 있었다. 그 가드는 `filter((r) => r.victory)` 로 표본을 만들고 `승리 4건 이상`을 공허 가드로
 * 걸었으므로, 단언이 통째로 **"봇이 이길 수 있는가"에 의존**했다 — ADR-0051 §1 의 판정 규칙에
 * 정확히 걸린다. 실제로 2026-08-05 피격 피해 2배 이후 승리가 2건으로 떨어져 main 상시 실패였다.
 *
 * **최소 틱으로 다시 쓰지 못했다.** 이 가드가 지키던 것은 {@link EXPECTED_CARDS_PER_RUN} 이
 * 낡는 것인데, 카드 수는 `cardInterval` · `killGoal` · 급행 램프가 함께 만드는 **런 길이 종속
 * 창발값**이라 `SEGMENTS` 에서 산술로 파생시킬 수가 없다. 수백 틱으로는 잴 수 없고, 재려면
 * 완주가 필요하다.
 *
 * ## 그래서 지금 못 잡는 것
 * `SEGMENTS.killGoal` **합계**를 바꿔 카드 수가 달라져도 스위트는 초록이다(2026-07-27 에
 * 80 → 240 으로 올라 런당 장비가 2.5 → 5.4개가 됐던 그 사고). `src/sim/drops.ts` 의
 * `EXPECTED_CARDS_PER_RUN` 주석이 "이 가드가 어긋나면 큰 소리로 실패한다"고 적고 있으나
 * **그 문장은 이제 사실이 아니다.** 재측정은 출시 직전 밸런스 패스의 1회성 봇 계측
 * (ADR-0051 §3)에서 한다.
 */

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
