/**
 * 방어체 어픽스 sim 반영 테스트 (M7b · 방어체 어픽스 sim 레인).
 *
 * 이 파일이 지키는 계약은 넷이다:
 *   ① **미장착 = 비트 동일.** 어픽스 0개(normal 등급·빈 슬롯) 배치는 이 레인 이전과 스탯·해시가
 *      한 톨도 다르지 않다. 이게 깨지면 PvE·기존 침공 리플레이가 통째로 갈린다.
 *   ② **리롤이 전투에 닿는다.** `affixSeed` 만 바꾸면 편대·설비·기물·보스의 실제 스탯이 바뀐다.
 *      (이 레인이 존재하는 이유 — 이전에는 리롤이 광물만 태우고 아무 일도 하지 않았다.)
 *   ③ **8종 stat 전부에 훅이 있다.** 어휘에만 있고 sim 에 닿지 않는 어픽스는 결함이다.
 *   ④ **결정론.** 같은 ref → 같은 보정, 매 틱 재롤 없음, 월드 RNG 미소비, 전 결과 정수.
 */

import { NEUTRAL_DEFENSE_POWER } from '../src/sim/invasion/defenseBonus.js';
import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import {
  AFFIX_BP_ONE,
  AFFIX_MAX_REDUCTION_BP,
  AFFIX_NO_CORE_HP_PCT,
  NEUTRAL_AFFIX_MODS,
  affixCooldown,
  affixDamage,
  affixEntryTick,
  affixHp,
  affixMaintenance,
  affixOverheatTicks,
  affixPowerBp,
  affixSpawnCap,
  coreHpPctOf,
  defenseAffixSet,
  isConditionalActive,
  isNeutralAffixMods,
  raiseMaxHp,
  resolveDefenseMods,
} from '../src/sim/invasion/affix.js';
import type { DefenseTriggerState } from '../src/sim/invasion/affix.js';
import {
  enterCoreRoom,
  stepCoreRoom,
  DEFENSE_BOSS_KIND,
  L3_PROP_KIND,
} from '../src/sim/invasion/coreRoom.js';
import { enterFacilityLayer, isFacility } from '../src/sim/invasion/facility.js';
import {
  formationMemberSpawnTick,
  formationSlotTriggerTick,
  stepInvasionFormation,
} from '../src/sim/invasion/formation.js';
import { normalizeInvasionLayers } from '../src/sim/invasion/normalize.js';
import { PHASE_L1, PHASE_L2, PHASE_L3 } from '../src/sim/invasion/constants.js';
import type { InvasionLayers, InvasionRef, InvasionStepContext } from '../src/sim/invasion/types.js';
import { MAINTENANCE_FULL } from '../src/sim/invasion/guardian.js';
import {
  CATALOG_BOSS,
  CATALOG_FACILITY,
  CATALOG_FORMATION,
  CATALOG_PROP,
} from '../data/invasion/catalog.js';
import {
  DEFENSE_UNIT_AFFIXES,
  DEFENSE_UNIT_PREFIXES,
  DEFENSE_UNIT_SUFFIXES,
  defenseUnitAffixPool,
} from '../data/defenseUnits.js';
import type { DefenseUnitStatKey } from '../data/defenseUnits.js';
import { defenseUnitFromRef } from '../src/items/rollDefenseUnit.js';
import { INVASION_DENSITY_LEGACY } from '../src/sim/invasion/density.js';

// ---------------------------------------------------------------------------
// 하네스
// ---------------------------------------------------------------------------

const ref = (over: Partial<InvasionRef> = {}): InvasionRef => ({
  catalogId: 0,
  level: 1,
  ascension: 0,
  affixSeed: 0,
  rarity: 0,
  ...over,
});

function ctxOf(layers: InvasionLayers, phase: 0 | 1 | 2): InvasionStepContext {
  // 밀도 축을 구값으로 고정한다 — 이 파일의 단언은 구 스케줄(720틱·1회 순회) 전제라,
  // 여기서 LEGACY 를 쓰는 것이 곧 "밀도를 끄면 예전과 같은가"를 지키는 가드가 된다.
  return {
    layers,
    runtime: { phase, phaseEnterTick: 0, scrollX: 0, scrollY: 0, accelCp: 100 },
    maintenance: MAINTENANCE_FULL,
    density: INVASION_DENSITY_LEGACY,
    power: NEUTRAL_DEFENSE_POWER,
    // 기본 수비대도 중립 레벨(=100cp, ×1.00)로 고정 — 위 LEGACY 밀도와 같은 이유다.
    garrisonLevel: 1,
  };
}

function live(w: WorldState, kind: string): Entity[] {
  return w.entities.filter((e) => e.kind === kind && !e.dead);
}

const TRIGGER_IDLE: DefenseTriggerState = {
  elapsedTicks: 0,
  coreHpPct: AFFIX_NO_CORE_HP_PCT,
  alliesDestroyed: 0,
  playerX: 100000,
  playerY: 100000,
};

/**
 * 지정한 종류에서 실제로 어픽스가 붙는 시드를 찾는다. 등급별 어픽스 수·풀이 데이터라
 * "특정 시드는 반드시 특정 어픽스" 를 못 박으면 밸런스 조정마다 테스트가 깨진다 — 성질만 본다.
 */
function seedWithStat(kind: number, rarity: number, stat: DefenseUnitStatKey): number | null {
  for (let seed = 1; seed < 400; seed++) {
    const unit = defenseUnitFromRef(kind, ref({ rarity, affixSeed: seed }));
    if (unit.prefixes.some((r) => r.stat === stat)) return seed;
  }
  return null;
}

// ---------------------------------------------------------------------------
// ① 미장착 = 비트 동일
// ---------------------------------------------------------------------------

describe('방어체 어픽스 — 미장착이면 배율 1(비트 동일)', () => {
  it('normal 등급은 어픽스가 0개이고 집합이 neutral 이다', () => {
    for (const kind of [CATALOG_FORMATION, CATALOG_FACILITY, CATALOG_PROP, CATALOG_BOSS]) {
      for (let seed = 0; seed < 32; seed++) {
        const set = defenseAffixSet(kind, ref({ rarity: 0, affixSeed: seed }));
        expect(set.neutral).toBe(true);
        expect(set.conditional).toHaveLength(0);
        expect(isNeutralAffixMods(set.always)).toBe(true);
      }
    }
  });

  it('빈 슬롯(null/undefined)도 neutral 집합으로 접힌다', () => {
    expect(defenseAffixSet(CATALOG_PROP, null).neutral).toBe(true);
    expect(defenseAffixSet(CATALOG_PROP, undefined).neutral).toBe(true);
  });

  it('무보정 적용 함수는 입력을 그대로 돌려준다(반올림조차 끼지 않는다)', () => {
    const m = NEUTRAL_AFFIX_MODS;
    for (const v of [0, 1, 7, 333, 8000, 12345]) {
      expect(affixHp(v, m)).toBe(v);
      expect(affixDamage(v, m)).toBe(v);
      expect(affixPowerBp(v, m)).toBe(v);
      expect(affixCooldown(v, m)).toBe(v);
      expect(affixMaintenance(v, m)).toBe(v);
      expect(affixSpawnCap(v, m)).toBe(v);
      expect(affixOverheatTicks(v, m)).toBe(v);
      expect(affixEntryTick(v, m)).toBe(v);
    }
  });

  it('normal 배치의 코어방 스폰 결과가 어픽스 도입 이전 산식과 동일하다', () => {
    // 어픽스 경로를 완전히 우회한 값(강화 3축만)과 실제 스폰값이 같아야 한다.
    const layers = normalizeInvasionLayers({
      l3: { boss: ref({ level: 9, ascension: 1, rarity: 0 }), props: [ref(), null, null, null, null, null] },
    });
    const w = createWorld(1);
    enterCoreRoom(w, ctxOf(layers, PHASE_L3));
    const boss = live(w, DEFENSE_BOSS_KIND as string)[0]!;
    const bossSet = defenseAffixSet(CATALOG_BOSS, layers.l3.boss);
    expect(bossSet.neutral).toBe(true);
    expect(affixHp(boss.maxHp, bossSet.always)).toBe(boss.maxHp);
    expect(live(w, L3_PROP_KIND as string)).toHaveLength(1);
  });

  it('어픽스 미보유 편대는 aux0 표식을 남기지 않는다(해시 폴드 불변)', () => {
    const layers = normalizeInvasionLayers({ l1: { waveSlots: [ref({ rarity: 0 })] } });
    const w = createWorld(1);
    stepInvasionFormation(w, ctxOf(layers, PHASE_L1));
    const spawned = live(w, 'enemy');
    expect(spawned.length).toBeGreaterThan(0);
    for (const e of spawned) {
      expect(e.aux0).toBe(0);
      expect(e.aux1).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// ② 리롤이 전투에 닿는다
// ---------------------------------------------------------------------------

describe('방어체 어픽스 — affixSeed 가 실제 전투 스탯을 바꾼다', () => {
  it('보스: 시드를 바꾸면 내구도/피해가 갈린다', () => {
    const stats = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const layers = normalizeInvasionLayers({
        l3: { boss: ref({ level: 20, rarity: 3, affixSeed: seed }) },
      });
      const w = createWorld(1);
      enterCoreRoom(w, ctxOf(layers, PHASE_L3));
      const b = live(w, DEFENSE_BOSS_KIND as string)[0]!;
      stats.add(`${b.maxHp}/${b.damage}/${b.cooldown}`);
    }
    expect(stats.size).toBeGreaterThan(1);
  });

  it('설비: 시드를 바꾸면 내구도/피해가 갈린다', () => {
    const stats = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const layers = normalizeInvasionLayers({
        l2: { templateId: 0, sockets: [ref({ level: 20, rarity: 3, affixSeed: seed })] },
      });
      const w = createWorld(1);
      enterFacilityLayer(w, ctxOf(layers, PHASE_L2));
      const f = w.entities.find((e) => isFacility(e))!;
      stats.add(`${f.maxHp}/${f.damage}/${f.timer}/${f.aux1}`);
    }
    expect(stats.size).toBeGreaterThan(1);
  });

  it('편대: 시드를 바꾸면 내구도/피해가 갈린다', () => {
    const stats = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const layers = normalizeInvasionLayers({
        l1: { waveSlots: [ref({ level: 20, rarity: 3, affixSeed: seed })] },
      });
      const w = createWorld(1);
      stepInvasionFormation(w, ctxOf(layers, PHASE_L1));
      const e = live(w, 'enemy')[0]!;
      stats.add(`${e.maxHp}/${e.damage}/${e.cooldown}`);
    }
    expect(stats.size).toBeGreaterThan(1);
  });

  it('기물: 시드를 바꾸면 내구도가 갈린다', () => {
    const stats = new Set<number>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const layers = normalizeInvasionLayers({
        l3: { props: [ref({ level: 20, rarity: 3, affixSeed: seed }), null, null, null, null, null] },
      });
      const w = createWorld(1);
      enterCoreRoom(w, ctxOf(layers, PHASE_L3));
      stats.add(live(w, L3_PROP_KIND as string)[0]!.maxHp);
    }
    expect(stats.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// ③ 8종 stat 전부에 훅이 있다
// ---------------------------------------------------------------------------

describe('방어체 어픽스 — 어휘 8종 전부가 sim 보정으로 접힌다', () => {
  const STATS: readonly DefenseUnitStatKey[] = [
    'defHpPct',
    'defDamagePct',
    'defFireRatePct',
    'defShieldFlat',
    'defWeatherResistPct',
    'defSpawnCapFlat',
    'defOverheatResistPct',
    'defEntryHastePct',
  ];

  it('정의된 어픽스의 stat 이 전부 8종 어휘 안에 있다(미지의 stat = 조용한 무효과)', () => {
    for (const a of DEFENSE_UNIT_AFFIXES) expect(STATS).toContain(a.stat);
  });

  it('8종 stat 각각이 무보정 아닌 보정을 만든다', () => {
    for (const stat of STATS) {
      // 그 stat 을 낼 수 있는 종류 하나를 정의에서 찾아 접어 본다.
      const def = DEFENSE_UNIT_AFFIXES.find((a) => a.stat === stat)!;
      const kind = def.kinds[0]!;
      const seed = seedWithStat(kind, 3, stat);
      expect(seed, `stat ${stat} 을 내는 시드를 찾지 못했다`).not.toBeNull();
      const set = defenseAffixSet(kind, ref({ rarity: 3, affixSeed: seed! }));
      expect(isNeutralAffixMods(set.always)).toBe(false);
    }
  });

  it('defWeatherResistPct 는 풍화된 실효 정비도를 완전 정비 쪽으로 되돌린다', () => {
    const mods = { ...NEUTRAL_AFFIX_MODS, weatherResistBp: 5000 };
    // 정비도 0%(완전 방치) → 저항 50% 면 실효 5000cp.
    expect(affixMaintenance(0, mods)).toBe(5000);
    // 이미 완전 정비면 되돌릴 간극이 없다.
    expect(affixMaintenance(MAINTENANCE_FULL, mods)).toBe(MAINTENANCE_FULL);
  });

  it('defFireRatePct 는 간격을 줄이되 1틱 아래로 내려가지 않는다', () => {
    const mods = { ...NEUTRAL_AFFIX_MODS, fireRateBp: AFFIX_BP_ONE + 5000 };
    expect(affixCooldown(150, mods)).toBe(100);
    expect(affixCooldown(1, { ...NEUTRAL_AFFIX_MODS, fireRateBp: AFFIX_BP_ONE * 100 })).toBe(1);
  });

  it('defOverheatResistPct 는 과열 창을 줄이되 없애지는 못한다', () => {
    expect(affixOverheatTicks(300, { ...NEUTRAL_AFFIX_MODS, overheatResistBp: 5000 })).toBe(150);
    expect(
      affixOverheatTicks(300, { ...NEUTRAL_AFFIX_MODS, overheatResistBp: AFFIX_MAX_REDUCTION_BP }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('defSpawnCapFlat 은 동시 생존 상한을 절대량으로 올린다', () => {
    expect(affixSpawnCap(4, { ...NEUTRAL_AFFIX_MODS, spawnCapFlat: 3 })).toBe(7);
  });

  it('defShieldFlat 은 내구도 위에 절대 가산된다', () => {
    expect(affixHp(1000, { ...NEUTRAL_AFFIX_MODS, shieldFlat: 250 })).toBe(1250);
    // 배율과 함께 오면 배율 먼저, 보호막은 그 위에.
    expect(affixHp(1000, { ...NEUTRAL_AFFIX_MODS, hpBp: 12000, shieldFlat: 250 })).toBe(1450);
  });

  it('defEntryHastePct 는 편대 등장 틱을 앞당긴다', () => {
    const mods = { ...NEUTRAL_AFFIX_MODS, entryHasteBp: 2500 };
    expect(formationMemberSpawnTick(2, 0, NEUTRAL_AFFIX_MODS)).toBe(formationSlotTriggerTick(2));
    expect(formationMemberSpawnTick(2, 0, mods)).toBeLessThan(formationSlotTriggerTick(2));
    expect(Number.isInteger(formationMemberSpawnTick(3, 41, mods))).toBe(true);
  });

  it('감쇠형 어픽스는 100% 로 쌓여도 상한에서 멈춘다(규칙이 통째로 사라지지 않는다)', () => {
    const set = defenseAffixSet(CATALOG_BOSS, ref({ rarity: 3, affixSeed: 12 }));
    expect(set.always.weatherResistBp).toBeLessThanOrEqual(AFFIX_MAX_REDUCTION_BP);
    expect(set.always.overheatResistBp).toBeLessThanOrEqual(AFFIX_MAX_REDUCTION_BP);
    expect(set.always.entryHasteBp).toBeLessThanOrEqual(AFFIX_MAX_REDUCTION_BP);
  });
});

// ---------------------------------------------------------------------------
// 접미(조건부) 계기
// ---------------------------------------------------------------------------

describe('방어체 어픽스 — 접미 계기 판정', () => {
  it('layerEnter 는 상시(스폰 시점이 곧 레이어 진입 후)', () => {
    const c = { trigger: 'layerEnter' as const, threshold: 0, stat: 'defDamagePct' as const, value: 10 };
    expect(isConditionalActive(c, TRIGGER_IDLE, 0, 0)).toBe(true);
  });

  it('coreHpLow 는 코어가 없는 레이어에서 발동하지 않는다', () => {
    const c = { trigger: 'coreHpLow' as const, threshold: 30, stat: 'defHpPct' as const, value: 20 };
    expect(isConditionalActive(c, TRIGGER_IDLE, 0, 0)).toBe(false);
    expect(isConditionalActive(c, { ...TRIGGER_IDLE, coreHpPct: 30 }, 0, 0)).toBe(true);
    expect(isConditionalActive(c, { ...TRIGGER_IDLE, coreHpPct: 31 }, 0, 0)).toBe(false);
  });

  it('timeElapsed 임계는 초 단위이며 틱으로 환산된다', () => {
    const c = { trigger: 'timeElapsed' as const, threshold: 60, stat: 'defFireRatePct' as const, value: 10 };
    expect(isConditionalActive(c, { ...TRIGGER_IDLE, elapsedTicks: 3599 }, 0, 0)).toBe(false);
    expect(isConditionalActive(c, { ...TRIGGER_IDLE, elapsedTicks: 3600 }, 0, 0)).toBe(true);
  });

  it('allyDestroyed 는 파괴 수 임계 이상에서 발동한다', () => {
    const c = { trigger: 'allyDestroyed' as const, threshold: 2, stat: 'defDamagePct' as const, value: 12 };
    expect(isConditionalActive(c, { ...TRIGGER_IDLE, alliesDestroyed: 1 }, 0, 0)).toBe(false);
    expect(isConditionalActive(c, { ...TRIGGER_IDLE, alliesDestroyed: 2 }, 0, 0)).toBe(true);
  });

  it('playerClose 는 자기 좌표 기준 반경 판정이다(경계 포함)', () => {
    const c = { trigger: 'playerClose' as const, threshold: 320, stat: 'defDamagePct' as const, value: 18 };
    const st = { ...TRIGGER_IDLE, playerX: 320, playerY: 0 };
    expect(isConditionalActive(c, st, 0, 0)).toBe(true);
    expect(isConditionalActive(c, { ...st, playerX: 321 }, 0, 0)).toBe(false);
  });

  it('접미가 하나도 발동하지 않으면 접두 보정 객체를 그대로 돌려준다', () => {
    const set = defenseAffixSet(CATALOG_BOSS, ref({ rarity: 3, affixSeed: 3 }));
    const mods = resolveDefenseMods(set, TRIGGER_IDLE, 0, 0);
    if (set.conditional.every((c) => !isConditionalActive(c, TRIGGER_IDLE, 0, 0))) {
      expect(mods).toBe(set.always);
    }
  });

  it('접두 + 발동 접미는 퍼센트 합산으로 접힌다(bp 선형)', () => {
    const set = {
      always: { ...NEUTRAL_AFFIX_MODS, damageBp: AFFIX_BP_ONE + 1000 }, // +10%
      conditional: [
        { trigger: 'layerEnter' as const, threshold: 0, stat: 'defDamagePct' as const, value: 25 },
      ],
      neutral: false,
    };
    const mods = resolveDefenseMods(set, TRIGGER_IDLE, 0, 0);
    expect(mods.damageBp).toBe(AFFIX_BP_ONE + 3500); // +35%
  });

  it('내구도 접미는 단조 트리거(coreHpLow)에만 붙는다 — 반복 회복 경로가 없다', () => {
    for (const a of DEFENSE_UNIT_SUFFIXES) {
      if (a.stat !== 'defHpPct' && a.stat !== 'defShieldFlat') continue;
      expect(a.trigger).toBe('coreHpLow');
    }
  });

  it('접두는 계기를 갖지 않는다(상시 보정)', () => {
    for (const a of DEFENSE_UNIT_PREFIXES) expect(a.trigger).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 접미가 실제 런에서 발동한다 (순수 함수 그린 + 배선 누락을 가르는 자리)
// ---------------------------------------------------------------------------

/** 지정 종류에서 주어진 계기·stat 의 접미가 붙는 시드를 찾는다. */
function seedWithSuffix(
  kind: number,
  trigger: string,
  stat: DefenseUnitStatKey,
): number | null {
  for (let seed = 1; seed < 600; seed++) {
    const set = defenseAffixSet(kind, ref({ rarity: 3, affixSeed: seed }));
    if (set.conditional.some((c) => c.trigger === trigger && c.stat === stat)) return seed;
  }
  return null;
}

describe('방어체 어픽스 — 접미가 런 중에 발동한다', () => {
  it('보스: 코어 HP 가 임계 아래로 떨어지면 내구도가 재장갑된다(dt-lastwall)', () => {
    const seed = seedWithSuffix(CATALOG_BOSS, 'coreHpLow', 'defHpPct');
    expect(seed, 'coreHpLow/defHpPct 접미 시드를 찾지 못했다').not.toBeNull();
    const layers = normalizeInvasionLayers({
      l3: { boss: ref({ level: 20, rarity: 3, affixSeed: seed! }) },
    });
    const w = createWorld(1);
    const ctx = ctxOf(layers, PHASE_L3);
    enterCoreRoom(w, ctx);
    const boss = live(w, DEFENSE_BOSS_KIND as string)[0]!;
    stepCoreRoom(w, ctx);
    const before = boss.maxHp;

    const core = live(w, 'core')[0]!;
    core.hp = Math.floor(core.maxHp / 100); // 코어 1% — 어떤 임계보다 낮다
    stepCoreRoom(w, ctx);
    expect(boss.maxHp).toBeGreaterThan(before);
    expect(Number.isInteger(boss.maxHp)).toBe(true);

    // 단조: 같은 상태로 한 틱 더 돌려도 다시 올라가지 않는다(반복 회복 없음).
    const latched = boss.maxHp;
    stepCoreRoom(w, ctx);
    expect(boss.maxHp).toBe(latched);
  });

  it('편대: 접미를 가진 편대만 슬롯 표식(aux0)을 달고 피해가 계기에 반응한다', () => {
    const seed = seedWithSuffix(CATALOG_FORMATION, 'playerClose', 'defDamagePct');
    expect(seed, 'playerClose/defDamagePct 접미 시드를 찾지 못했다').not.toBeNull();
    const layers = normalizeInvasionLayers({
      l1: { waveSlots: [ref({ level: 20, rarity: 3, affixSeed: seed! })] },
    });
    const w = createWorld(1);
    const ctx = ctxOf(layers, PHASE_L1);
    stepInvasionFormation(w, ctx);
    const e = live(w, 'enemy')[0]!;
    expect(e.aux0).toBe(1); // 슬롯 0 → 표식 1
    const far = e.damage;

    // 공격자를 편대원 위로 옮기면 근접 계기가 발동해 접촉 피해가 오른다.
    const player = w.entities.find((x) => x.kind === 'player')!;
    player.x = e.x;
    player.y = e.y;
    w.tick++;
    stepInvasionFormation(w, ctx);
    expect(e.damage).toBeGreaterThan(far);

    // 멀어지면 되돌아온다(피해는 단조가 아니라 매 틱 재계산 축이다).
    player.x = e.x + 100000;
    w.tick++;
    stepInvasionFormation(w, ctx);
    expect(e.damage).toBe(far);
  });
});

// ---------------------------------------------------------------------------
// 단조 상향 동기화
// ---------------------------------------------------------------------------

describe('방어체 어픽스 — 내구도 단조 상향', () => {
  it('목표가 더 클 때만 올리고 증가분을 hp 에도 더한다', () => {
    const e = { hp: 400, maxHp: 1000 };
    expect(raiseMaxHp(e, 1200)).toBe(200);
    expect(e).toEqual({ hp: 600, maxHp: 1200 });
  });

  it('목표가 같거나 작으면 아무것도 하지 않는다(이미 입은 피해가 사라지지 않는다)', () => {
    const e = { hp: 400, maxHp: 1000 };
    expect(raiseMaxHp(e, 1000)).toBe(0);
    expect(raiseMaxHp(e, 500)).toBe(0);
    expect(e).toEqual({ hp: 400, maxHp: 1000 });
  });

  it('코어 HP 백분율은 정수 내림이고 코어가 없으면 판정 불가값이다', () => {
    expect(coreHpPctOf(1234, 8000)).toBe(15);
    expect(coreHpPctOf(0, 0)).toBe(AFFIX_NO_CORE_HP_PCT);
    expect(coreHpPctOf(-50, 8000)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ④ 결정론
// ---------------------------------------------------------------------------

describe('방어체 어픽스 — 결정론', () => {
  it('같은 ref 를 두 번 해석하면 같은 객체(메모이즈 — 매 틱 재롤 없음)', () => {
    const r = ref({ rarity: 3, affixSeed: 77 });
    expect(defenseAffixSet(CATALOG_BOSS, r)).toBe(defenseAffixSet(CATALOG_BOSS, r));
  });

  it('내용이 같은 별개 ref 도 값이 동일하다(캐시 적중 여부가 결과를 바꾸지 않는다)', () => {
    const a = defenseAffixSet(CATALOG_BOSS, ref({ rarity: 3, affixSeed: 77 }));
    const b = defenseAffixSet(CATALOG_BOSS, ref({ rarity: 3, affixSeed: 77 }));
    expect(a).toEqual(b);
  });

  it('같은 ref 라도 종류가 다르면 다른 풀에서 롤된다', () => {
    const r = ref({ rarity: 3, affixSeed: 5 });
    const asFormation = defenseAffixSet(CATALOG_FORMATION, r);
    const asFacility = defenseAffixSet(CATALOG_FACILITY, r);
    // 종류별 풀이 다르므로(defenseUnitAffixPool) 같은 시드라도 결과가 갈릴 수 있어야 한다.
    expect(defenseUnitAffixPool(CATALOG_FORMATION)).not.toEqual(defenseUnitAffixPool(CATALOG_FACILITY));
    expect(asFormation).not.toBe(asFacility);
  });

  it('모든 보정이 정수다(f64 누적 금지)', () => {
    for (const kind of [CATALOG_FORMATION, CATALOG_FACILITY, CATALOG_PROP, CATALOG_BOSS]) {
      for (let seed = 0; seed < 64; seed++) {
        const set = defenseAffixSet(kind, ref({ rarity: 3, affixSeed: seed }));
        for (const v of Object.values(set.always)) expect(Number.isInteger(v)).toBe(true);
        const mods = resolveDefenseMods(
          set,
          { ...TRIGGER_IDLE, coreHpPct: 5, alliesDestroyed: 9, elapsedTicks: 99999 },
          0,
          0,
        );
        for (const v of Object.values(mods)) expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  it('어픽스 해석이 월드 RNG 를 소비하지 않는다(스트림 커서 불변)', () => {
    const layers = normalizeInvasionLayers({
      l3: {
        boss: ref({ level: 30, rarity: 3, affixSeed: 4242 }),
        props: [ref({ rarity: 3, affixSeed: 9 }), null, null, null, null, null],
      },
    });
    const w = createWorld(11);
    const before = JSON.stringify([w.rng, w.waveRng, w.dropRng, w.eliteRng]);
    enterCoreRoom(w, ctxOf(layers, PHASE_L3));
    expect(JSON.stringify([w.rng, w.waveRng, w.dropRng, w.eliteRng])).toBe(before);
  });

  it('어픽스가 실린 코어방을 두 번 돌리면 엔티티 상태가 바이트 동일하다', () => {
    const layers = normalizeInvasionLayers({
      l3: {
        boss: ref({ level: 30, rarity: 3, affixSeed: 4242 }),
        props: [ref({ rarity: 3, affixSeed: 9 }), ref({ catalogId: 1, rarity: 2, affixSeed: 3 }), null, null, null, null],
      },
    });
    const run = (): string => {
      const w = createWorld(7);
      const ctx = ctxOf(layers, PHASE_L3);
      enterCoreRoom(w, ctx);
      return JSON.stringify(w.entities);
    };
    expect(run()).toBe(run());
  });
});
