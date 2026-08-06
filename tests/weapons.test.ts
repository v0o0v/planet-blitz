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
import { neutralLoadout } from '../src/items/loadout.js';
import { blankEntity, type Entity } from '../src/sim/entities.js';
import { length } from '../src/sim/math.js';
import { POWERUPS, drawPowerupChoices } from '../src/sim/powerups.js';
import { shipTypeDef, shipTreeRange } from '../data/ships/index.js';
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

const WEAPON_MISSILE = 3;
const WEAPON_BEAM = 4;

function weaponConfig(weaponType: number, skillInvest?: number[]): WorldConfig {
  const cfg: WorldConfig = {
    ...DEFAULT_CONFIG,
    planet: 0,
    stage: 1,
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
  // ⚠️ ADR-0049: `computeLoadoutStats` 는 더 이상 `invest` 를 받지 않는다(스킬이 스탯에서
  // 메커닉으로 옮겨갔다 — `src/items/loadout.ts` 헤더 참조). `main.ts` 도 이제 loadout 을
  // 접지 않고 `skillInvest` 를 config 에 그대로 싣기만 한다. 그런데도 이 벡터는 여전히
  // 리플레이 해시에 직접 폴드되고(`src/sim/replay.ts`) 파워업 추첨 가중(`investedInAffinity`)
  // 을 흔들므로, 투자 유무가 hashes 를 갈라놓는다는 계약은 그대로 유효하다.
  function investedConfig(): WorldConfig {
    const invest = zeroSkillInvest();
    invest[0] = 4; // 축0(offense) 스킬
    invest[20] = 3; // 축2(utility) 스킬
    return weaponConfig(0, invest);
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
    expect(POWERUPS).toHaveLength(26); // 24 + 액티브 강화 2종(ADR-0041, append-only)
    expect(POWERUPS[0]?.id).toBe('rapid-fire');
    expect(POWERUPS[7]?.id).toBe('gem-magnet');
    // Every entry carries exactly one build tag.
    for (const p of POWERUPS) {
      const tags = [
        p.universal === true,
        p.weaponType !== undefined,
        p.affinity !== undefined,
        // 액티브 슬롯 전용(ADR-0041)도 배타 태그 축 하나다 — 미장착이면 pool 진입 자체가 없다.
        p.activeSlot !== undefined,
      ];
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
    // Fully invest the mobility(utility) axis; its tagged powerups should be offered more.
    const invest = zeroSkillInvest();
    const striker = shipTypeDef(0);
    const utilityAxis = striker.trees.findIndex((t) => t.affinity === 'utility');
    const { start, end } = shipTreeRange(striker, utilityAxis);
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
// 파워업 affinity 태그 — 풀 인덱스 wire 안정성 (설계서 §2·§10-4).
//
// ⚠️ (ADR-0049 정리) 이 describe 는 원래 M8 리팩터 전후 구현을 **레거시 구현 재현체와 전체
// 추첨 시퀀스 대조**로 등가 증명했다. 그 대조는 옛 60노드/트리당 20칸 슬라이스
// (`SKILL_TREES.indexOf(tree) * NODES_PER_TREE`)를 가정했는데, ADR-0049 의 flat 30칸(축당
// 10) 레이아웃이 그 가정 자체를 깼다 — 지금 대조하면 "같은 자리에 다른 값이 있다"가 아니라
// "슬라이스 상수 자체가 다른 세대"라 항상 실패하고, 실패해도 아무 결함도 가리키지 않는다.
// 그래서 레거시 재현체와 그 대조 테스트는 지웠다(더 지킬 것이 없다). 남기는 것은 둘 —
// **풀 인덱스의 affinity 태그가 여전히 안정적인가**(wire 계약, 노드 개수와 무관)와
// **shipType 미지정 = 0 명시 등가**(현재 API 로 재작성)다. 투자량에 따라 가중이 실제로
// 움직이는지는 위 'soft-weights toward an invested skill tree' 가 새 레이아웃으로 지킨다.
// ---------------------------------------------------------------------------

describe('파워업 풀 — affinity 태그 wire 안정성 (설계서 §2·§10-4)', () => {
  it('affinity 태그가 레거시 트리 태그와 1:1 로 대응한다 (풀 인덱스 불변)', () => {
    // 옛 배치: 4·5·7 = mobility, 6 = survival, 16·17 = firepower, 18·19 = survival,
    // 20·21 = mobility. 인덱스는 pick 입력의 wire 값이라 절대 움직이면 안 된다.
    const expected: Record<number, 'offense' | 'defense' | 'utility'> = {
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

  it('shipType 미지정 · 0 명시가 같은 추첨 시퀀스를 낸다', () => {
    const invest = zeroSkillInvest();
    const { start, end } = shipTreeRange(shipTypeDef(0), 0); // 축0 = offense(firepower)
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
  /**
   * ⚠️ 2026-08-06 — 구 계약("시그니처가 없는 런은 aux 슬롯을 건드리지 않는다 = 조건부 꼬리 폴드
   * 무실행")은 ADR-0049 가 스트라이커에 정조준 사이클(aux0 0..11)을 부여하며 폐기됐다(실측:
   * 이 무대·시드에서 600틱에 aux0 최대 4 — 구 단언 `aux0 === 0` 은 발사가 한 번이라도 일어나면
   * 거짓이 된다). 이 describe(브루저/아크캐스터 대조)의 취지를 지키려면 스트라이커의 정조준
   * 트리거만 매 틱 굶긴다(`tests/shipSignatureWiring.test.ts` `starveTrigger` 와 같은 패턴 —
   * 기체를 바꾸지 않으므로 baseBp 오염이 없다). 굶긴 트리거는 `marksmanTriggered(aux0)` 가
   * 항상 0 을 보게 하므로 정조준은 영영 발동하지 않지만, 발사 자체는 그 틱에 일어날 수 있어
   * aux0 은 최대 1(이번 틱 발사분)까지는 오를 수 있다 — 그래서 상한은 `<=1` 이지 `===0` 이 아니다.
   */
  it('스트라이커(shipType 미지정)의 정조준 트리거를 굶기면 aux0 은 0~1 을 벗어나지 않고 aux1 은 끝까지 0 이다', () => {
    const state = createWorld(7, weaponConfig(0));
    const p = state.entities[0] as Entity;
    let sawFire = false;
    for (let i = 0; i < 600; i++) {
      p.aux0 = 0; // 정조준 카운터가 임계(11)에 영영 못 닿게 매 틱 되돌린다.
      stepWorld(state, emptyInput());
      if (p.aux0 > 0) sawFire = true;
      expect(p.aux0, `tick ${i}`).toBeLessThanOrEqual(1);
    }
    expect(sawFire, '공허 런 — 이 무대에서 한 번도 발사되지 않아 굶기기 계량이 vacuous 하다').toBe(
      true,
    );
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

  it('과충전이 실제 발사 피해에 반영된다 (스트라이커는 정조준 트리거를 굶긴 대조군에서 증폭되지 않는다)', () => {
    // 처치 수 대신 **아군 탄의 피해 배율**을 본다 — 처치 수는 과잉피해·스폰 갈림에
    // 흔들려 효과가 있어도 줄 수 있는 노이즈 지표다(실측 확인).
    //
    // ⚠️ 2026-08-06 — `maxAmp()`(shipType 미지정 = 스트라이커)는 ADR-0049 이후 더 이상
    // "증폭 경로 무실행" 이 아니다 — 정조준 볼리가 그 자체로 +50% 증폭이라 그대로 두면 1.5 가
    // 나온다. `starveMarksmanTrigger` 로 스트라이커의 정조준 트리거만 굶긴다(위 테스트와 같은
    // 패턴) — 굶기면 marksmanFire 가 영원히 false 라 amp 는 정확히 0 을 유지한다(값을 완화한
    // 것이 아니라 대조군을 오염 없이 다시 만든 것).
    const maxAmp = (shipType?: number, starveMarksmanTrigger = false): number => {
      const cfg: WorldConfig = { ...weaponConfig(0), playerHp: 100_000_000 };
      if (shipType !== undefined) cfg.shipType = shipType;
      const s = createWorld(0xa2c, cfg);
      const p = s.entities[0] as Entity;
      let amp = 0;
      for (let i = 0; i < 1800; i++) {
        if (starveMarksmanTrigger) p.aux0 = 0;
        stepWorld(s, emptyInput());
        for (const e of s.entities) {
          if (e.kind !== 'bullet') continue;
          const r = e.damage / s.weapon.damage;
          if (r > 1 + 1e-9 && r > amp) amp = r;
        }
      }
      return amp;
    };
    expect(maxAmp(undefined, true)).toBe(0); // 스트라이커: 정조준 트리거 굶김(대조군)
    expect(maxAmp(1)).toBe(0); // 브루저는 발사 경로를 건드리지 않는다
    expect(maxAmp(2)).toBeGreaterThan(1);
  });
});
