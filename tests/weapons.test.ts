import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  emptyInput,
  DEFAULT_CONFIG,
  type WorldConfig,
  type WorldState,
} from '../src/sim/world.js';
import { runReplay, idleInputs } from '../src/sim/replay.js';
import { neutralLoadout, computeLoadoutStats } from '../src/items/loadout.js';
import { blankEntity, type Entity } from '../src/sim/entities.js';
import { length } from '../src/sim/math.js';
import { POWERUPS, drawPowerupChoices, type PowerupDef } from '../src/sim/powerups.js';
import { AFFINITY_LEGACY_TREE, type TreeAffinity } from '../data/ships/index.js';
import { SKILL_TREES, NODES_PER_TREE } from '../data/skills.js';
import {
  ARMOR_MAX_STACKS,
  ARMOR_PER_STACK_BP,
  clampArmorStacks,
  armorReducedDamage,
  OVERCHARGE_STILL_TICKS,
  overchargeBp,
  overchargedDamage,
} from '../src/sim/shipSignature.js';
import { zeroSkillInvest } from '../src/save/profile.js';
import { treeRange } from '../data/skills.js';

const WEAPON_MISSILE = 3;
const WEAPON_BEAM = 4;

function weaponConfig(weaponType: number, skillInvest?: number[]): WorldConfig {
  const cfg: WorldConfig = {
    ...DEFAULT_CONFIG,
    planet: 0,
    tier: 0,
    loadout: { ...neutralLoadout(), weaponType },
  };
  if (skillInvest !== undefined) cfg.skillInvest = skillInvest;
  return cfg;
}

/** Inject a static enemy (no def → no behaviour) at an absolute position. */
function addEnemy(state: WorldState, x: number, y: number): Entity {
  const e = blankEntity('enemy');
  e.id = state.nextEntityId++;
  e.x = x;
  e.y = y;
  e.radius = 40;
  e.hp = 100000; // survive so we can observe the projectiles homing/hitting
  e.maxHp = 100000;
  e.enemyType = -1; // enemyDefFor → undefined → the enemy stays put
  state.entities.push(e);
  return e;
}

/** Only keep the player + the given entities alive (freeze the environment). */
function isolate(state: WorldState, keep: Entity[]): void {
  const keepIds = new Set(keep.map((e) => e.id));
  const player = state.entities[0]!;
  state.entities = state.entities.filter((e) => e === player || keepIds.has(e.id));
}

describe('missile weapon (type 3) — homing, limited turn (C1, OQ-M3-4)', () => {
  it('fires homing missiles that curve toward the target, preserving speed', () => {
    const state = createWorld(1, weaponConfig(WEAPON_MISSILE));
    const player = state.entities[0]!;
    addEnemy(state, player.x + 400, player.y); // seed a target so a volley launches
    stepWorld(state, emptyInput());
    const missile = state.entities.find((e) => e.kind === 'bullet');
    expect(missile).toBeDefined();

    // Place a far target well below; isolate the environment so the missile has a
    // single, fixed thing to home on (waves cannot introduce a nearer target).
    const below = addEnemy(state, missile!.x, missile!.y + 2000);
    const speed0 = length(missile!.vx, missile!.vy);
    const d0 = length(below.x - missile!.x, below.y - missile!.y);
    for (let t = 0; t < 40; t++) {
      isolate(state, [missile!, below]);
      stepWorld(state, emptyInput());
      if (missile!.dead) break;
    }
    const d1 = length(below.x - missile!.x, below.y - missile!.y);
    expect(d1).toBeLessThan(d0); // homed closer
    expect(missile!.vy).toBeGreaterThan(0); // curved toward the lower target
    // Homing re-aims the velocity, never scales it — speed is invariant (within
    // the deterministic-trig approximation's tiny per-tick drift).
    expect(Math.abs(length(missile!.vx, missile!.vy) - speed0) / speed0).toBeLessThan(0.01);
  });

  it('replays deterministically', () => {
    const replay = { seed: 7, config: weaponConfig(WEAPON_MISSILE), inputs: idleInputs(500) };
    expect(runReplay(replay).hashes).toEqual(runReplay(replay).hashes);
  });
});

describe('beam weapon (type 4) — matic short-life segments (C1, OQ-M3-3)', () => {
  it('lays a line of short-life static segments toward the target', () => {
    const state = createWorld(2, weaponConfig(WEAPON_BEAM));
    const player = state.entities[0]!;
    addEnemy(state, player.x + 220, player.y); // within the beam range
    stepWorld(state, emptyInput());
    const segs = state.entities.filter((e) => e.kind === 'bullet');
    expect(segs.length).toBeGreaterThanOrEqual(3); // a line, not one bolt
    expect(segs.length).toBeLessThanOrEqual(16); // capped
    for (const s of segs) {
      expect(s.vx).toBe(0); // static segment
      expect(s.vy).toBe(0);
      expect(s.life).toBeLessThanOrEqual(2); // short-lived, re-laid each fire
    }
  });

  it('replays deterministically', () => {
    const replay = { seed: 9, config: weaponConfig(WEAPON_BEAM), inputs: idleInputs(500) };
    expect(runReplay(replay).hashes).toEqual(runReplay(replay).hashes);
  });
});

describe('skill investment — determinism + hash inclusion (AC2, plan A2)', () => {
  function investedConfig(): WorldConfig {
    const invest = zeroSkillInvest();
    invest[0] = 4; // firepower damagePct
    invest[41] = 4; // mobility moveSpeedPct
    const cfg = weaponConfig(0, invest);
    // Fold the same investment into the loadout block (mirrors main.ts).
    const { loadout } = computeLoadoutStats([], invest);
    cfg.loadout = loadout;
    return cfg;
  }

  it('a run with skill investment replays to identical hashes', () => {
    const replay = { seed: 3, config: investedConfig(), inputs: idleInputs(400) };
    expect(runReplay(replay).hashes).toEqual(runReplay(replay).hashes);
  });

  it('skill investment changes the run (hashes diverge from a no-skill run)', () => {
    const withSkills = runReplay({ seed: 3, config: investedConfig(), inputs: idleInputs(400) });
    const without = runReplay({ seed: 3, config: weaponConfig(0), inputs: idleInputs(400) });
    expect(withSkills.finalHash).not.toBe(without.finalHash);
  });
});

describe('powerup pool — 24 tagged + build-weighted draw (C2, AC9, OQ-M3-1)', () => {
  it('has 24 entries, indices 0..7 unchanged (replay wire stability)', () => {
    expect(POWERUPS).toHaveLength(24);
    expect(POWERUPS[0]?.id).toBe('rapid-fire');
    expect(POWERUPS[7]?.id).toBe('gem-magnet');
    // Every entry carries exactly one build tag.
    for (const p of POWERUPS) {
      const tags = [p.universal === true, p.weaponType !== undefined, p.affinity !== undefined];
      expect(tags.filter(Boolean)).toHaveLength(1);
    }
  });

  it('draws `count` distinct valid indices, deterministically', () => {
    const cfg = weaponConfig(WEAPON_BEAM);
    const a = createWorld(5, cfg);
    const b = createWorld(5, cfg);
    for (let i = 0; i < 20; i++) {
      const da = drawPowerupChoices(a, 3);
      const db = drawPowerupChoices(b, 3);
      expect(da).toEqual(db); // deterministic across identical worlds
      expect(new Set(da).size).toBe(3); // distinct
      for (const idx of da) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(24);
      }
    }
  });

  it('무기 전용 강화는 장착 무기에서만 제시된다 (오프빌드 완전 배제)', () => {
    const beamIdx = POWERUPS.map((p, i) => (p.weaponType === WEAPON_BEAM ? i : -1)).filter((i) => i >= 0);
    expect(beamIdx.length).toBeGreaterThan(0);
    const count = (weaponType: number): number => {
      const state = createWorld(11, weaponConfig(weaponType));
      let hits = 0;
      for (let i = 0; i < 3000; i++) {
        const [idx] = drawPowerupChoices(state, 1);
        if (idx !== undefined && beamIdx.includes(idx)) hits++;
      }
      return hits;
    };
    // `fix/weapon-range-semantics` 이전에는 오프빌드도 낮은 가중값(2)으로 **뽑힐 수
    // 있었다.** 낮을 뿐 0 이 아니라 실제로 뽑혔고(벌컨 빌드 24시드 중 1시드가 빔 전용
    // '집속 렌즈'를 먹는 것이 7기체 전부에서 관측됐다), 당시 `0 = 무제한` 사거리
    // 의미론과 맞물려 그 시드는 사격이 통째로 멎었다. 이제는 후보 풀에서 아예 뺀다.
    const beamBuild = count(WEAPON_BEAM);
    const vulcanBuild = count(0);
    expect(beamBuild).toBeGreaterThan(0);
    expect(vulcanBuild).toBe(0);
  });

  it('soft-weights toward an invested skill tree', () => {
    // Fully invest the mobility tree; its tagged powerups should be offered more.
    const invest = zeroSkillInvest();
    const { start, end } = treeRange('mobility');
    for (let i = start; i < end; i++) invest[i] = 5;
    // M8: 태그 축이 트리 이름 → affinity 로 바뀌었다. mobility 의 역할 축은 'utility'.
    const mobilityIdx = POWERUPS.map((p, i) => (p.affinity === 'utility' ? i : -1)).filter(
      (i) => i >= 0,
    );

    const countMobility = (skillInvest?: number[]): number => {
      const state = createWorld(21, weaponConfig(0, skillInvest));
      let hits = 0;
      for (let i = 0; i < 3000; i++) {
        const [idx] = drawPowerupChoices(state, 1);
        if (idx !== undefined && mobilityIdx.includes(idx)) hits++;
      }
      return hits;
    };
    expect(countMobility(invest)).toBeGreaterThan(countMobility(zeroSkillInvest()));
  });
});

// ---------------------------------------------------------------------------
// M8 — 파워업 태그가 트리 **이름**에서 **affinity(역할 축)** 로 바뀐 리팩터의 안전망.
//
// 설계서 §1 이 경고하는 삼중 계약 중 **세 번째(sim 내부 RNG 슬라이스)** 를 겨눈다:
// 가중값이 같아도 슬라이스가 한 칸 밀리면 `powerupRng` 소비가 갈려 레벨업 틱부터 스트림이
// 발산한다. 그래서 값 비교가 아니라 **추첨 시퀀스 전체**를 레거시 구현과 대조한다.
// ---------------------------------------------------------------------------

/**
 * M8 이전의 `powerupWeight` 를 테스트 안에 독립 재현한 것. 태그를 affinity → 레거시 트리로
 * 되돌리고, 슬라이스를 `SKILL_TREES.indexOf(tree) * NODES_PER_TREE` 로 잡는다(옛 코드 그대로).
 */
function legacyPowerupWeight(def: PowerupDef, state: WorldState): number {
  if (def.universal === true) return 10; // WEIGHT_UNIVERSAL
  // 오프빌드 배제는 `fix/weapon-range-semantics` 의 **의도된** 변경이라 미러도 함께 지운다
  // (아래 legacyDrawPowerupChoices 의 skip 과 쌍). 이 미러를 옛 가중값 2 로 남겨 두면
  // 대조가 "affinity 슬라이스가 맞는가"가 아니라 "그 변경이 있었는가"를 재는 것이 된다.
  if (def.weaponType !== undefined) return 28;
  if (def.affinity !== undefined) {
    const tree = AFFINITY_LEGACY_TREE[def.affinity];
    const t = SKILL_TREES.indexOf(tree);
    if (t < 0) return 4;
    const start = t * NODES_PER_TREE;
    let sum = 0;
    for (let i = start; i < start + NODES_PER_TREE; i++) sum += state.config.skillInvest?.[i] ?? 0;
    return 4 + Math.floor(sum / 4); // WEIGHT_TREE_BASE + invested/TREE_POINTS_PER_WEIGHT
  }
  return 1;
}

/** M8 이전의 `drawPowerupChoices` 를 그대로 재현(같은 순서로 powerupRng 를 소비한다). */
function legacyDrawPowerupChoices(state: WorldState, count: number): number[] {
  const pool: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < POWERUPS.length; i++) {
    const def = POWERUPS[i];
    if (def === undefined) continue;
    if (def.weaponType !== undefined && def.weaponType !== state.weapon.weaponType) continue;
    pool.push(i);
    weights.push(legacyPowerupWeight(def, state));
  }
  const chosen: number[] = [];
  const n = Math.min(count, pool.length);
  for (let k = 0; k < n; k++) {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) break;
    let r = state.powerupRng.int(0, total - 1);
    let pick = 0;
    for (let j = 0; j < pool.length; j++) {
      r -= weights[j] as number;
      if (r < 0) {
        pick = j;
        break;
      }
    }
    const idx = pool[pick];
    if (idx !== undefined) chosen.push(idx);
    pool.splice(pick, 1);
    weights.splice(pick, 1);
  }
  return chosen;
}

describe('M8 파워업 affinity 리팩터 — 스트라이커 바이트 동일 (설계서 §2·§10-4)', () => {
  it('affinity 태그가 레거시 트리 태그와 1:1 로 대응한다 (풀 인덱스 불변)', () => {
    // 옛 배치: 4·5·7 = mobility, 6 = survival, 16·17 = firepower, 18·19 = survival,
    // 20·21 = mobility. 인덱스는 pick 입력의 wire 값이라 절대 움직이면 안 된다.
    const expected: Record<number, TreeAffinity> = {
      4: 'utility',
      5: 'utility',
      6: 'defense',
      7: 'utility',
      16: 'offense',
      17: 'offense',
      18: 'defense',
      19: 'defense',
      20: 'utility',
      21: 'utility',
    };
    for (const [i, aff] of Object.entries(expected)) {
      expect(POWERUPS[Number(i)]?.affinity, `pool[${i}]`).toBe(aff);
    }
    // 나머지는 affinity 태그가 없어야 한다(무기 태그 또는 범용).
    for (let i = 0; i < POWERUPS.length; i++) {
      if (expected[i] === undefined) expect(POWERUPS[i]?.affinity, `pool[${i}]`).toBeUndefined();
    }
  });

  it('추첨 **순서**가 레거시 구현과 전 시퀀스 일치한다 (RNG 소비까지 동일)', () => {
    // 세 계열에 서로 다른 투자량을 넣어 세 가중이 전부 갈라진 상태로 대조한다
    // (전부 0이면 가중이 같아 슬라이스 오류를 못 잡는다).
    const invest = zeroSkillInvest();
    const fill = (tree: 'firepower' | 'survival' | 'mobility', v: number): void => {
      const { start, end } = treeRange(tree);
      for (let i = start; i < end; i++) invest[i] = v;
    };
    fill('firepower', 5);
    fill('survival', 2);
    fill('mobility', 1);

    for (const weaponType of [0, 1, 2, 3, 4]) {
      const cfg = weaponConfig(weaponType, invest.slice());
      const now = createWorld(0x5eed, cfg);
      const legacy = createWorld(0x5eed, cfg);
      for (let i = 0; i < 60; i++) {
        const a = drawPowerupChoices(now, 4);
        const b = legacyDrawPowerupChoices(legacy, 4);
        expect(a, `weaponType=${weaponType} draw#${i}`).toEqual(b);
      }
      // RNG 스트림까지 같은 자리에 서 있어야 한다(소비 횟수 일치).
      expect(now.powerupRng.getState(), `weaponType=${weaponType} rng`).toBe(
        legacy.powerupRng.getState(),
      );
    }
  });

  it('shipType 미지정 · 0 명시가 같은 추첨 시퀀스를 낸다', () => {
    const invest = zeroSkillInvest();
    const { start, end } = treeRange('firepower');
    for (let i = start; i < end; i++) invest[i] = 4;
    const base = weaponConfig(0, invest.slice());
    const seqOf = (cfg: WorldConfig): number[] => {
      const s = createWorld(99, cfg);
      const out: number[] = [];
      for (let i = 0; i < 40; i++) out.push(...drawPowerupChoices(s, 4));
      return out;
    };
    expect(seqOf({ ...base, shipType: 0 })).toEqual(seqOf(base));
  });
});

describe('M8 시그니처 sim 배선 — 브루저 장갑 · 아크캐스터 과충전 (설계서 §3·§4)', () => {
  /** 시그니처가 없는 런은 aux 슬롯을 건드리지 않는다 = 조건부 꼬리 폴드 무실행. */
  it('스트라이커(shipType 미지정)는 aux0/aux1 을 영원히 0 으로 둔다', () => {
    const state = createWorld(7, weaponConfig(0));
    for (let i = 0; i < 600; i++) stepWorld(state, emptyInput());
    const p = state.entities[0] as Entity;
    expect(p.aux0).toBe(0);
    expect(p.aux1).toBe(0);
  });

  it('브루저는 피격으로 aux0(장갑 스택)이 실제로 쌓인다', () => {
    const state = createWorld(7, { ...weaponConfig(0), shipType: 1, playerHp: 100_000_000 });
    let maxStacks = 0;
    for (let i = 0; i < 3000; i++) {
      stepWorld(state, emptyInput());
      const p = state.entities[0] as Entity;
      if (p.aux0 > maxStacks) maxStacks = p.aux0;
      expect(p.aux0).toBeLessThanOrEqual(ARMOR_MAX_STACKS);
    }
    expect(maxStacks).toBeGreaterThan(0);
  });

  it('장갑 감소 산술이 정수 피해에 대해 armorReducedDamage 와 완전히 같다', () => {
    // world.ts 는 소수 피해 보존을 위해 trunc 만 뺀 동형 산술을 쓴다. 정수 입력에서
    // 두 경로가 갈리면 이 테스트가 먼저 터진다.
    for (let stacks = 0; stacks <= ARMOR_MAX_STACKS + 2; stacks++) {
      for (const d of [1, 3, 6, 8, 16, 25, 37, 100, 999]) {
        const bp = clampArmorStacks(stacks) * ARMOR_PER_STACK_BP;
        const world = bp > 0 ? d - Math.round((d * bp) / 10000) : d;
        expect(world, `stacks=${stacks} dmg=${d}`).toBe(armorReducedDamage(d, stacks));
      }
    }
  });

  it('아크캐스터는 정지 지속으로 aux0 이 램프업하고, 이동 입력에 즉시 0 으로 해제된다', () => {
    const cfg = { ...weaponConfig(0), shipType: 2, playerHp: 100_000_000 };
    const state = createWorld(7, cfg);
    for (let i = 0; i < OVERCHARGE_STILL_TICKS + 30; i++) stepWorld(state, emptyInput());
    const p = state.entities[0] as Entity;
    expect(p.aux0).toBeGreaterThanOrEqual(OVERCHARGE_STILL_TICKS);
    expect(overchargeBp(p.aux0)).toBeGreaterThan(0);
    stepWorld(state, { moveX: 1, moveY: 0, aim: 0, dash: false, special: 0 });
    expect(p.aux0).toBe(0);
    expect(overchargeBp(p.aux0)).toBe(0);
  });

  it('과충전 증폭 산술이 정수 피해에 대해 overchargedDamage 와 완전히 같다', () => {
    for (const t of [0, 40, 89, 90, 91, 150, 190, 400]) {
      for (const d of [1, 7, 12, 40, 137, 1000]) {
        const bp = overchargeBp(t);
        const world = bp === 0 ? d : d + Math.round((d * bp) / 10000);
        expect(world, `still=${t} dmg=${d}`).toBe(overchargedDamage(d, t));
      }
    }
  });

  it('과충전이 실제 발사 피해에 반영된다 (스트라이커는 절대 증폭되지 않는다)', () => {
    // 처치 수 대신 **아군 탄의 피해 배율**을 본다 — 처치 수는 과잉피해·스폰 갈림에
    // 흔들려 효과가 있어도 줄 수 있는 노이즈 지표다(실측 확인).
    const maxAmp = (shipType?: number): number => {
      const cfg: WorldConfig = { ...weaponConfig(0), playerHp: 100_000_000 };
      if (shipType !== undefined) cfg.shipType = shipType;
      const s = createWorld(0xa2c, cfg);
      let amp = 0;
      for (let i = 0; i < 1800; i++) {
        stepWorld(s, emptyInput());
        for (const e of s.entities) {
          if (e.kind !== 'bullet') continue;
          const r = e.damage / s.weapon.damage;
          if (r > 1 + 1e-9 && r > amp) amp = r;
        }
      }
      return amp;
    };
    expect(maxAmp()).toBe(0);
    expect(maxAmp(1)).toBe(0); // 브루저는 발사 경로를 건드리지 않는다
    expect(maxAmp(2)).toBeGreaterThan(1);
  });
});
