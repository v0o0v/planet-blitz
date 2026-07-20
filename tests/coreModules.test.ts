/**
 * 코어 모듈 데이터·롤러·효력·경제 테스트 (M7b-core-modules · ADR-0018).
 *
 * 커버리지:
 *   - **wire 계약 고정**: ModuleInstance/ModuleAffixRoll/AttackerMatchup 의 직렬화 키가
 *     개명되지 않았는지 전수 대조(개명이 wire 에 새면 서버 재실행 바이트 일치가 깨진다).
 *   - rollModule 결정론(같은 시드 → 바이트 동일), 등급별 어픽스 수·사용 횟수 범위·distinct.
 *   - 3레이어 stat 어휘: 모든 어픽스의 stat 이 MODULE_STAT_KEYS 안에 있고, 구 단일 아레나
 *     어휘(turretDamagePct·coreHpFlat 등)가 남아 있지 않은지.
 *   - 모듈 어픽스 id 전역 유일 + 접두/접미 규약(mc-/mt-).
 *   - 합성·상점 로테이션·분해·가격 결정론.
 *   - **방어 성공 드랍 폐지**: 크레딧 정액 상수만 있고 드랍 확률 API 가 없는지.
 *   - moduleEffects: 정적 카운터 조건 판정, 트리거 배율, 슬롯 2 합산, 코어 HP·기물 내구 스폰
 *     효과, 신기루 코어 스폰, 미장착 시 완전 no-op(조건부 접기).
 *   - modulesCore(EF): 상점 슬롯 재현·합성 입력 검증.
 *   - net 슬롯 정규화: 고정 길이 2 + null 허용 + 밀집화 금지 + 중복 제거.
 */

import { describe, it, expect } from 'vitest';
import {
  MODULE_PREFIXES,
  MODULE_SUFFIXES,
  MODULE_AFFIXES,
  MODULE_AFFIX_BY_ID,
  MODULE_STAT_KEYS,
  MODULE_BASE_EFFECT,
  MODULE_CHARGE_RANGE,
  MODULE_UNIQUE_AFFIX_COUNT,
  MODULE_STORAGE_CAP,
  MODULE_EQUIP_SLOTS,
  MODULE_FUSION_INPUT_COUNT,
  MODULE_FUSION_CHANCE,
  MODULE_SHOP_NORMAL_RANGE,
  MODULE_SHOP_MAGIC_RANGE,
  CORE_MODULE_UNIQUES,
  CORE_MODULE_UNIQUE_BY_ID,
  DEFENSE_SUCCESS_CREDITS,
  rollModule,
  attemptModuleFusion,
  dailyModuleShopRotation,
  rollModuleShopRotation,
  shopDateSeedFromMs,
  shopUserSeed,
  nextRarityUp,
  moduleBuyPrice,
  moduleSalvageValue,
  moduleRarityRank,
  moduleUniqueNameKey,
  moduleUniqueDescKey,
  moduleAffixNameKey,
  moduleAffixDescKey,
} from '../data/coreModules.js';
import { DEFENSE_UNIT_AFFIXES } from '../data/defenseUnits.js';
import type { ModuleInstance, ModuleStatKey } from '../data/coreModules.js';
import { INVASION_CORE_MODULE_SLOTS } from '../src/sim/invasion/constants.js';
import {
  initModuleRuntime,
  stepModuleRuntime,
  MODULE_CORE_PROXIMITY_MARGIN,
  MODULE_MAX_DMG_REDUCTION_PCT,
} from '../src/sim/moduleEffects.js';
import type { AttackerMatchup, CoreModuleConfig } from '../src/sim/moduleEffects.js';
import { blankEntity, addEntity, type Entity, type EntitySink } from '../src/sim/entities.js';
import {
  planModuleShopPurchase,
  validateModuleFusion,
  planModuleFusion,
} from '../supabase/functions/modules/modulesCore.js';
import { normalizeEquippedModules } from '../src/net/modules.js';
import type { Rarity } from '../src/items/types.js';

const RARITIES: readonly Rarity[] = ['normal', 'magic', 'rare', 'unique'];

/** 전부 false/0 인 매치업(정적 카운터 미발동 기준선). */
const NO_MATCH: AttackerMatchup = {
  fire: false,
  cold: false,
  lightning: false,
  beam: false,
  attackerCp: 0,
  defenderCp: 0,
  revenge: false,
  reinvasion: false,
  subweaponHeavy: false,
};

function sink(entities: Entity[] = []): EntitySink {
  return { entities, nextEntityId: 1 };
}

function makeCore(hp: number): Entity {
  const e = blankEntity('core');
  e.x = 0;
  e.y = 0;
  e.radius = 90;
  e.hp = hp;
  e.maxHp = hp;
  return e;
}

// ---------------------------------------------------------------------------
// wire 계약 — 개명이 직렬화 키에 새지 않았는가 (ADR-0005)
// ---------------------------------------------------------------------------

describe('wire 계약(개명 금지 필드)', () => {
  it('ModuleInstance 의 jsonb 키는 구 CardInstance 와 동일하다', () => {
    const mod = rollModule(12345, 'rare');
    // 이 목록이 곧 DB jsonb·스냅샷 계약이다. 개명은 TypeScript 심볼·표시 문자열에만 적용된다.
    expect(Object.keys(mod).sort()).toEqual(
      ['chargesLeft', 'chargesMax', 'id', 'prefixes', 'rarity', 'seed', 'suffixes'].sort(),
    );
  });

  it('unique 모듈은 uniqueId 키를 추가로 갖는다(그 외 필드는 동일)', () => {
    const mod = rollModule(999, 'unique');
    expect(Object.keys(mod).sort()).toEqual(
      ['chargesLeft', 'chargesMax', 'id', 'prefixes', 'rarity', 'seed', 'suffixes', 'uniqueId'].sort(),
    );
  });

  it('ModuleAffixRoll 의 키는 id·stat·value 뿐이다', () => {
    const mod = rollModule(777, 'rare');
    const rolls = [...mod.prefixes, ...mod.suffixes];
    expect(rolls.length).toBeGreaterThan(0);
    for (const roll of rolls) {
      expect(Object.keys(roll).sort()).toEqual(['id', 'stat', 'value']);
    }
  });

  it('AttackerMatchup 키는 SQL build_attacker_matchup 계약과 동일하다', () => {
    expect(Object.keys(NO_MATCH).sort()).toEqual(
      [
        'attackerCp',
        'beam',
        'cold',
        'defenderCp',
        'fire',
        'lightning',
        'reinvasion',
        'revenge',
        'subweaponHeavy',
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// 3레이어 stat 어휘 재정의
// ---------------------------------------------------------------------------

describe('3레이어 stat 어휘', () => {
  it('모든 모듈 어픽스의 stat 이 MODULE_STAT_KEYS 안에 있다', () => {
    const known = new Set<string>(MODULE_STAT_KEYS);
    for (const a of MODULE_AFFIXES) expect(known.has(a.stat)).toBe(true);
  });

  it('구 단일 아레나 어휘(turret*)가 남아 있지 않다', () => {
    for (const key of MODULE_STAT_KEYS) expect(key.startsWith('turret')).toBe(false);
    for (const a of MODULE_AFFIXES) expect(a.stat.startsWith('turret')).toBe(false);
  });

  it('편대·설비·기물·보스·코어 축이 모두 stat 어휘에 존재한다', () => {
    const expected: readonly ModuleStatKey[] = [
      'formationDamagePct',
      'facilityDamagePct',
      'facilityFireRatePct',
      'propDurabilityPct',
      'bossDamagePct',
      'coreShieldFlat',
    ];
    for (const k of expected) expect(MODULE_STAT_KEYS).toContain(k);
  });

  it('stat 키 목록에 중복이 없다', () => {
    expect(new Set(MODULE_STAT_KEYS).size).toBe(MODULE_STAT_KEYS.length);
  });
});

// ---------------------------------------------------------------------------
// 모듈 어픽스 정의 규약
// ---------------------------------------------------------------------------

describe('모듈 어픽스 정의', () => {
  it('접두 8 · 접미 8 이고 id 가 전역 유일하다', () => {
    expect(MODULE_PREFIXES.length).toBe(8);
    expect(MODULE_SUFFIXES.length).toBe(8);
    expect(MODULE_AFFIXES.length).toBe(16);
    expect(new Set(MODULE_AFFIXES.map((a) => a.id)).size).toBe(16);
    expect(MODULE_AFFIX_BY_ID.size).toBe(16);
  });

  it('접두는 mc- 접두사 + condition, 접미는 mt- 접두사 + trigger 를 갖는다', () => {
    for (const a of MODULE_PREFIXES) {
      expect(a.kind).toBe('prefix');
      expect(a.id.startsWith('mc-')).toBe(true);
      expect(a.condition).toBeDefined();
      expect(a.trigger).toBeUndefined();
    }
    for (const a of MODULE_SUFFIXES) {
      expect(a.kind).toBe('suffix');
      expect(a.id.startsWith('mt-')).toBe(true);
      expect(a.trigger).toBeDefined();
      expect(a.condition).toBeUndefined();
    }
  });

  it('롤 범위는 min<=max 인 정수다', () => {
    for (const a of MODULE_AFFIXES) {
      expect(Number.isInteger(a.min)).toBe(true);
      expect(Number.isInteger(a.max)).toBe(true);
      expect(a.min).toBeLessThanOrEqual(a.max);
    }
  });

  it('정의에 표시명 필드가 없다(표기는 i18n 키로만 — 한글 리터럴 재유입 차단)', () => {
    // 구 정의는 `name: '소화의'` 처럼 한글 리터럴을 들고 있어 EN 로케일에서도 한글이 샜고
    // i18n 검증 밖에 남았다. 필드를 없애 두면 다음 사람이 되돌리려 해도 타입이 막는다.
    for (const a of MODULE_AFFIXES) {
      expect(Object.prototype.hasOwnProperty.call(a, 'name')).toBe(false);
    }
  });

  it('유니크 표시명에 컬러 이모지가 없다(Pixi 두부 방지)', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const u of CORE_MODULE_UNIQUES) expect(emoji.test(u.name)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rollModule — 결정론 + 등급별 규칙
// ---------------------------------------------------------------------------

describe('rollModule', () => {
  it('같은 (seed, rarity) 는 바이트 동일 모듈을 낸다', () => {
    for (const rarity of RARITIES) {
      const a = rollModule(0xabcdef, rarity);
      const b = rollModule(0xabcdef, rarity);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('등급별 어픽스 수 규칙(normal 0 / magic 1~2 / rare 3~6 / unique 고정)', () => {
    for (let s = 1; s <= 40; s++) {
      expect(rollModule(s, 'normal').prefixes.length + rollModule(s, 'normal').suffixes.length).toBe(0);
      const m = rollModule(s, 'magic');
      const mc = m.prefixes.length + m.suffixes.length;
      expect(mc).toBeGreaterThanOrEqual(1);
      expect(mc).toBeLessThanOrEqual(2);
      const r = rollModule(s, 'rare');
      const rc = r.prefixes.length + r.suffixes.length;
      expect(rc).toBeGreaterThanOrEqual(3);
      expect(rc).toBeLessThanOrEqual(6);
      const u = rollModule(s, 'unique');
      expect(u.prefixes.length + u.suffixes.length).toBe(MODULE_UNIQUE_AFFIX_COUNT);
    }
  });

  it('어픽스는 중복 없이 뽑히고 값이 정의 범위 안이다', () => {
    for (let s = 1; s <= 40; s++) {
      const mod = rollModule(s, 'rare');
      const rolls = [...mod.prefixes, ...mod.suffixes];
      expect(new Set(rolls.map((r) => r.id)).size).toBe(rolls.length);
      for (const roll of rolls) {
        const def = MODULE_AFFIX_BY_ID.get(roll.id);
        expect(def).toBeDefined();
        expect(roll.stat).toBe(def?.stat);
        expect(roll.value).toBeGreaterThanOrEqual(def?.min ?? 0);
        expect(roll.value).toBeLessThanOrEqual(def?.max ?? 0);
      }
    }
  });

  it('사용 횟수는 등급 범위 안이고 chargesLeft = chargesMax 로 시작한다', () => {
    for (const rarity of RARITIES) {
      const [lo, hi] = MODULE_CHARGE_RANGE[rarity];
      for (let s = 1; s <= 20; s++) {
        const mod = rollModule(s, rarity);
        expect(mod.chargesMax).toBeGreaterThanOrEqual(lo);
        expect(mod.chargesMax).toBeLessThanOrEqual(hi);
        expect(mod.chargesLeft).toBe(mod.chargesMax);
      }
    }
  });

  it('unique 는 등록된 uniqueId 를, 그 외 등급은 uniqueId 를 갖지 않는다', () => {
    for (let s = 1; s <= 20; s++) {
      const u = rollModule(s, 'unique');
      expect(u.uniqueId).toBeDefined();
      expect(CORE_MODULE_UNIQUE_BY_ID.has(u.uniqueId ?? '')).toBe(true);
      expect(rollModule(s, 'rare').uniqueId).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 합성 · 상점 · 가격 · 분해
// ---------------------------------------------------------------------------

describe('모듈 경제', () => {
  it('합성은 결정론이고 승급 시 상위 등급을 낸다', () => {
    for (let s = 1; s <= 50; s++) {
      const a = attemptModuleFusion(s, 'normal');
      const b = attemptModuleFusion(s, 'normal');
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a.module.rarity).toBe(a.promoted ? 'magic' : 'normal');
    }
  });

  it('unique 합성은 승급하지 않는다(상위 없음)', () => {
    for (let s = 1; s <= 20; s++) {
      const r = attemptModuleFusion(s, 'unique');
      expect(r.promoted).toBe(false);
      expect(r.module.rarity).toBe('unique');
    }
  });

  it('등급 사다리와 합성 확률 테이블이 정합한다', () => {
    expect(nextRarityUp('normal')).toBe('magic');
    expect(nextRarityUp('magic')).toBe('rare');
    expect(nextRarityUp('rare')).toBe('unique');
    expect(nextRarityUp('unique')).toBeUndefined();
    expect(MODULE_FUSION_CHANCE.unique).toBeUndefined();
    expect(MODULE_FUSION_INPUT_COUNT).toBe(3);
  });

  it('상점 로테이션은 (날짜,유저) 결정론이고 normal·magic 만 낸다', () => {
    const dateSeed = shopDateSeedFromMs(Date.UTC(2026, 6, 21));
    const userSeed = shopUserSeed('user-abc');
    const a = rollModuleShopRotation(dateSeed, userSeed);
    const b = rollModuleShopRotation(dateSeed, userSeed);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const mod of a) expect(['normal', 'magic']).toContain(mod.rarity);

    const plan = dailyModuleShopRotation(dateSeed, userSeed);
    const normals = plan.filter((s) => s.rarity === 'normal').length;
    const magics = plan.filter((s) => s.rarity === 'magic').length;
    expect(normals).toBeGreaterThanOrEqual(MODULE_SHOP_NORMAL_RANGE[0]);
    expect(normals).toBeLessThanOrEqual(MODULE_SHOP_NORMAL_RANGE[1]);
    expect(magics).toBeGreaterThanOrEqual(MODULE_SHOP_MAGIC_RANGE[0]);
    expect(magics).toBeLessThanOrEqual(MODULE_SHOP_MAGIC_RANGE[1]);
  });

  it('다른 유저는 다른 재고를 받는다', () => {
    const dateSeed = shopDateSeedFromMs(Date.UTC(2026, 6, 21));
    const a = rollModuleShopRotation(dateSeed, shopUserSeed('user-a'));
    const b = rollModuleShopRotation(dateSeed, shopUserSeed('user-b'));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('구매 가격은 등급에 단조 증가하는 정수다', () => {
    let prev = -1;
    for (const rarity of RARITIES) {
      const p = moduleBuyPrice(rarity);
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBeGreaterThan(prev);
      prev = p;
      expect(moduleRarityRank(rarity)).toBeGreaterThanOrEqual(0);
    }
  });

  it('분해 환급은 어픽스 수에 단조 증가한다', () => {
    const bare: ModuleInstance = {
      id: 'm', rarity: 'rare', prefixes: [], suffixes: [], chargesMax: 3, chargesLeft: 3, seed: 1,
    };
    const rich = rollModule(4242, 'rare');
    expect(moduleSalvageValue(rich)).toBeGreaterThan(moduleSalvageValue(bare));
  });

  it('보관 상한·장착 슬롯 상수가 sim 상수와 정합한다', () => {
    expect(MODULE_STORAGE_CAP).toBe(20);
    expect(MODULE_EQUIP_SLOTS).toBe(INVASION_CORE_MODULE_SLOTS);
  });
});

// ---------------------------------------------------------------------------
// 방어 성공 보조 보상 — 드랍 폐지, 크레딧 정액
// ---------------------------------------------------------------------------

describe('방어 성공 보조 보상(드랍 폐지)', () => {
  it('크레딧 정액 상수가 양의 정수다', () => {
    expect(Number.isInteger(DEFENSE_SUCCESS_CREDITS)).toBe(true);
    expect(DEFENSE_SUCCESS_CREDITS).toBeGreaterThan(0);
  });

  it('드랍 확률 API 가 코어 모듈 모듈에 존재하지 않는다', async () => {
    const mod = (await import('../data/coreModules.js')) as unknown as Record<string, unknown>;
    expect(mod.defenseSuccessDropChance).toBeUndefined();
    expect(mod.DEFENSE_DROP_BASE_CHANCE).toBeUndefined();
    expect(mod.rollDropRarity).toBeUndefined();
    expect(mod.DROP_CP_DIFF_CAP).toBeUndefined();
  });

  it('EF 계획 코어에도 드랍 계획 함수가 없다', async () => {
    const core = (await import('../supabase/functions/modules/modulesCore.js')) as unknown as Record<string, unknown>;
    expect(core.planDefenseDrop).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// moduleEffects — 정적 카운터 · 동적 트리거 · 스폰 효과
// ---------------------------------------------------------------------------

/** 특정 어픽스 하나만 가진 합성 모듈(테스트 전용 — 롤러를 우회해 효력만 격리 검증). */
function moduleWith(
  rarity: Rarity,
  prefixIds: readonly string[],
  suffixIds: readonly string[],
): ModuleInstance {
  const mk = (id: string) => {
    const def = MODULE_AFFIX_BY_ID.get(id);
    if (def === undefined) throw new Error(`unknown affix ${id}`);
    return { id: def.id, stat: def.stat, value: def.min };
  };
  return {
    id: `test-${prefixIds.join('+')}-${suffixIds.join('+')}`,
    rarity,
    prefixes: prefixIds.map(mk),
    suffixes: suffixIds.map(mk),
    chargesMax: 3,
    chargesLeft: 3,
    seed: 1,
  };
}

function cfg(modules: readonly ModuleInstance[], matchup: AttackerMatchup = NO_MATCH): CoreModuleConfig {
  return { modules, matchup };
}

describe('moduleEffects — 정적 카운터', () => {
  it('조건 불일치면 접두 효과가 실리지 않는다', () => {
    const rt = initModuleRuntime(cfg([moduleWith('normal', ['mc-quench'], [])]), sink());
    expect(rt.staticIncomingReductionPct).toBe(0);
  });

  it('조건 일치면 접두 효과가 실린다', () => {
    const rt = initModuleRuntime(
      cfg([moduleWith('normal', ['mc-quench'], [])], { ...NO_MATCH, fire: true }),
      sink(),
    );
    const def = MODULE_AFFIX_BY_ID.get('mc-quench');
    expect(rt.staticIncomingReductionPct).toBe(def?.min);
  });

  it('powerSuperiority 는 전투력 차 임계를 넘어야 발동한다', () => {
    const below = initModuleRuntime(
      cfg([moduleWith('normal', ['mc-armorbreak'], [])], { ...NO_MATCH, attackerCp: 400, defenderCp: 0 }),
      sink(),
    );
    const above = initModuleRuntime(
      cfg([moduleWith('normal', ['mc-armorbreak'], [])], { ...NO_MATCH, attackerCp: 900, defenderCp: 0 }),
      sink(),
    );
    // 기저 효과(normal allDamagePct=3)는 항상 실리므로 그 차이만 본다.
    expect(above.staticFacilityDamagePct).toBeGreaterThan(below.staticFacilityDamagePct);
  });

  it('슬롯 2개의 효과는 합산된다', () => {
    const one = initModuleRuntime(cfg([moduleWith('normal', [], [])]), sink());
    const two = initModuleRuntime(
      cfg([moduleWith('normal', [], []), moduleWith('normal', [], [])]),
      sink(),
    );
    expect(two.staticFormationDamagePct).toBe(one.staticFormationDamagePct * 2);
    expect(two.coreHpPct).toBe(one.coreHpPct * 2);
  });

  it('기저 효과는 등급에 단조 증가한다', () => {
    let prev = -1;
    for (const rarity of RARITIES) {
      const rt = initModuleRuntime(cfg([moduleWith(rarity, [], [])]), sink());
      expect(rt.staticBossDamagePct).toBe(MODULE_BASE_EFFECT[rarity].allDamagePct);
      expect(rt.staticBossDamagePct).toBeGreaterThan(prev);
      prev = rt.staticBossDamagePct;
    }
  });
});

describe('moduleEffects — 스폰 시점 효과', () => {
  it('코어 HP 가 기저 %만큼 증가한다(정수)', () => {
    const core = makeCore(8000);
    const s = sink([core]);
    initModuleRuntime(cfg([moduleWith('rare', [], [])]), s);
    expect(core.maxHp).toBe(Math.round(8000 * 1.1)); // rare coreHpPct = 10
    expect(core.hp).toBe(core.maxHp);
    expect(Number.isInteger(core.maxHp)).toBe(true);
  });

  it('propDurabilityPct 는 기물 내구만 올린다', () => {
    const core = makeCore(8000);
    const prop = blankEntity('prop');
    prop.hp = 900;
    prop.maxHp = 900;
    const s = sink([core, prop]);
    initModuleRuntime(
      cfg([moduleWith('normal', ['mc-blockade'], [])], { ...NO_MATCH, reinvasion: true }),
      s,
    );
    const pct = MODULE_AFFIX_BY_ID.get('mc-blockade')?.min ?? 0;
    expect(prop.maxHp).toBe(Math.round(900 * (1 + pct / 100)));
  });

  it('신기루 코어 유니크가 decoyCore 를 스폰한다', () => {
    const core = makeCore(8000);
    const s = sink([core]);
    const mirage: ModuleInstance = { ...moduleWith('unique', [], []), uniqueId: 'uq-mirage-core' };
    initModuleRuntime(cfg([mirage]), s);
    const decoys = s.entities.filter((e) => e.kind === 'decoyCore');
    expect(decoys.length).toBe(1);
    expect(decoys[0]?.hp).toBe(Math.round(core.maxHp * 0.5));
    expect(decoys[0]?.id).toBeGreaterThan(0);
  });

  it('유니크 미보유면 decoyCore 가 없다', () => {
    const s = sink([makeCore(8000)]);
    initModuleRuntime(cfg([moduleWith('rare', [], [])]), s);
    expect(s.entities.some((e) => e.kind === 'decoyCore')).toBe(false);
  });
});

describe('moduleEffects — 동적 트리거', () => {
  function player(x: number, y: number): Entity {
    const p = blankEntity('player');
    p.x = x;
    p.y = y;
    return p;
  }

  it('미장착이면 stepModuleRuntime 은 완전 no-op 이다(조건부 접기)', () => {
    const state = { tick: 0, entities: [] as Entity[] };
    expect(() => stepModuleRuntime(state, player(0, 0))).not.toThrow();
    expect(state.entities.length).toBe(0);
  });

  it('mt-forcefield 는 코어 근접 시 1회만 보호막을 준다', () => {
    const core = makeCore(8000);
    const s = sink([core]);
    const rt = initModuleRuntime(cfg([moduleWith('normal', [], ['mt-forcefield'])]), s);
    const shield = MODULE_AFFIX_BY_ID.get('mt-forcefield')?.min ?? 0;
    const state = { tick: 0, entities: s.entities, moduleRuntime: rt };

    // 반경 밖 — 미발동.
    stepModuleRuntime(state, player(core.radius + MODULE_CORE_PROXIMITY_MARGIN + 50, 0));
    expect(rt.coreProximityFired).toBe(false);
    expect(core.targetY).toBe(0);

    // 반경 안 — 1회 발동.
    stepModuleRuntime(state, player(0, 0));
    expect(rt.coreProximityFired).toBe(true);
    expect(core.targetY).toBe(shield);

    // 재진입해도 중복 부여 없음.
    stepModuleRuntime(state, player(0, 0));
    expect(core.targetY).toBe(shield);
  });

  it('mt-fury 는 설비 파괴 수가 임계에 도달해야 연사 배율을 올린다', () => {
    const s = sink([makeCore(8000)]);
    for (let i = 0; i < 4; i++) addEntity(s, blankEntity('facilityGun'));
    const rt = initModuleRuntime(cfg([moduleWith('normal', [], ['mt-fury'])]), s);
    expect(rt.initialFacilityCount).toBe(4);

    const state = { tick: 0, entities: s.entities, moduleRuntime: rt };
    stepModuleRuntime(state, player(9999, 9999));
    expect(rt.facilityFireRateMult).toBe(1);

    // 설비 3기 파괴(임계 3).
    let killed = 0;
    for (const e of s.entities) {
      if (e.kind === 'facilityGun' && killed < 3) {
        e.dead = true;
        killed++;
      }
    }
    stepModuleRuntime(state, player(9999, 9999));
    expect(rt.facilityFireRateMult).toBeGreaterThan(1);
  });

  it('mt-vanguard 는 초반 구간에만 편대 화력을 올린다', () => {
    const s = sink([makeCore(8000)]);
    const rt = initModuleRuntime(cfg([moduleWith('normal', [], ['mt-vanguard'])]), s);
    const state = { tick: 0, entities: s.entities, moduleRuntime: rt };
    stepModuleRuntime(state, player(9999, 9999));
    const early = rt.formationDamageMult;
    state.tick = rt.vanguardTicks;
    stepModuleRuntime(state, player(9999, 9999));
    expect(early).toBeGreaterThan(rt.formationDamageMult);
  });

  it('mt-bulwark 는 L3(phase 2) 진입 후에만 피해 감소를 준다', () => {
    const s = sink([makeCore(8000)]);
    const rt = initModuleRuntime(cfg([moduleWith('normal', [], ['mt-bulwark'])]), s);
    const state = { tick: 0, entities: s.entities, moduleRuntime: rt, invasion3: { phase: 0 } };
    stepModuleRuntime(state, player(9999, 9999));
    expect(rt.defenseDmgMult).toBe(1);
    state.invasion3.phase = 2;
    stepModuleRuntime(state, player(9999, 9999));
    expect(rt.defenseDmgMult).toBeLessThan(1);
  });

  it('mt-laststand 는 코어 저HP 에서만 보스 화력을 올린다', () => {
    const core = makeCore(1000);
    const s = sink([core]);
    const rt = initModuleRuntime(cfg([moduleWith('normal', [], ['mt-laststand'])]), s);
    const state = { tick: 0, entities: s.entities, moduleRuntime: rt };
    stepModuleRuntime(state, player(9999, 9999));
    const full = rt.bossDamageMult;
    core.hp = Math.floor(core.maxHp * 0.2); // 임계 30% 아래
    stepModuleRuntime(state, player(9999, 9999));
    expect(rt.bossDamageMult).toBeGreaterThan(full);
  });

  it('피해 감소 합산은 상한으로 클램프된다(무적 방어 방지)', () => {
    const s = sink([makeCore(8000)]);
    // 감소 stat 접두 3종을 전부 발동시키고 값을 최대로 조작해 상한 초과를 유도한다.
    const over: ModuleInstance = {
      id: 'over',
      rarity: 'normal',
      prefixes: [{ id: 'mc-quench', stat: 'incomingDmgReductionPct', value: 999 }],
      suffixes: [],
      chargesMax: 1,
      chargesLeft: 1,
      seed: 1,
    };
    const rt = initModuleRuntime(cfg([over], { ...NO_MATCH, fire: true }), s);
    const state = { tick: 0, entities: s.entities, moduleRuntime: rt };
    stepModuleRuntime(state, player(9999, 9999));
    expect(rt.defenseDmgMult).toBeCloseTo(1 - MODULE_MAX_DMG_REDUCTION_PCT / 100, 10);
  });

  it('같은 입력으로 두 번 돌리면 배율이 바이트 동일하다(결정론)', () => {
    const run = () => {
      const s = sink([makeCore(8000)]);
      addEntity(s, blankEntity('facilityGun'));
      const rt = initModuleRuntime(cfg([rollModule(31337, 'rare')], { ...NO_MATCH, fire: true }), s);
      const state = { tick: 120, entities: s.entities, moduleRuntime: rt, invasion3: { phase: 1 } };
      stepModuleRuntime(state, player(10, 10));
      return JSON.stringify(rt);
    };
    expect(run()).toBe(run());
  });
});

// ---------------------------------------------------------------------------
// modulesCore (EF 계획 순수 함수)
// ---------------------------------------------------------------------------

describe('modulesCore — EF 계획', () => {
  const dateSeed = shopDateSeedFromMs(Date.UTC(2026, 6, 21));
  const userSeed = shopUserSeed('user-abc');

  it('상점 슬롯을 로테이션과 동일하게 재현하고 가격을 매긴다', () => {
    const rotation = rollModuleShopRotation(dateSeed, userSeed);
    const res = planModuleShopPurchase(dateSeed, userSeed, 0);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(JSON.stringify(res.plan.module)).toBe(JSON.stringify(rotation[0]));
      expect(res.plan.price).toBe(moduleBuyPrice(res.plan.rarity));
    }
  });

  it('범위 밖·비정수 슬롯은 bad-slot 이다', () => {
    const rotation = rollModuleShopRotation(dateSeed, userSeed);
    expect(planModuleShopPurchase(dateSeed, userSeed, -1).ok).toBe(false);
    expect(planModuleShopPurchase(dateSeed, userSeed, rotation.length).ok).toBe(false);
    expect(planModuleShopPurchase(dateSeed, userSeed, 1.5).ok).toBe(false);
  });

  it('합성 입력 검증: 개수·중복·등급', () => {
    expect(validateModuleFusion([{ id: 'a', rarity: 'rare' }]).ok).toBe(false);
    expect(
      validateModuleFusion([
        { id: 'a', rarity: 'rare' },
        { id: 'a', rarity: 'rare' },
        { id: 'a', rarity: 'rare' },
      ]),
    ).toEqual({ ok: false, code: 'dup-ids' });
    expect(
      validateModuleFusion([
        { id: 'a', rarity: 'rare' },
        { id: 'b', rarity: 'magic' },
        { id: 'c', rarity: 'rare' },
      ]),
    ).toEqual({ ok: false, code: 'rarity-mismatch' });
    expect(
      validateModuleFusion([
        { id: 'a', rarity: 'rare' },
        { id: 'b', rarity: 'rare' },
        { id: 'c', rarity: 'rare' },
      ]),
    ).toEqual({ ok: true, rarity: 'rare' });
  });

  it('합성 계획은 결과 모듈의 등급과 일치한다', () => {
    const plan = planModuleFusion('magic', 4242);
    expect(plan.rarity).toBe(plan.module.rarity);
    expect(['magic', 'rare']).toContain(plan.rarity);
  });
});

// ---------------------------------------------------------------------------
// net 슬롯 정규화 — 고정 길이 + null 허용, 밀집화 금지
// ---------------------------------------------------------------------------

describe('normalizeEquippedModules', () => {
  it('항상 고정 길이 슬롯 배열을 낸다', () => {
    expect(normalizeEquippedModules(null).length).toBe(MODULE_EQUIP_SLOTS);
    expect(normalizeEquippedModules([]).length).toBe(MODULE_EQUIP_SLOTS);
    expect(normalizeEquippedModules(['a', 'b', 'c']).length).toBe(MODULE_EQUIP_SLOTS);
  });

  it('빈 슬롯을 밀집화하지 않는다(슬롯 i 의미 보존)', () => {
    expect(normalizeEquippedModules([null, 'b'])).toEqual([null, 'b']);
  });

  it('초과분은 절단하고 중복은 비운다', () => {
    expect(normalizeEquippedModules(['a', 'b', 'c'])).toEqual(['a', 'b']);
    expect(normalizeEquippedModules(['a', 'a'])).toEqual(['a', null]);
  });

  it('멱등이다', () => {
    const once = normalizeEquippedModules(['a', 'a', 'b']);
    expect(normalizeEquippedModules(once)).toEqual(once);
  });
});

// ---------------------------------------------------------------------------
// i18n 키 규약
// ---------------------------------------------------------------------------

describe('i18n 키 규약', () => {
  it('유니크 모듈 키가 def3.module.* 규약을 따른다', () => {
    for (const u of CORE_MODULE_UNIQUES) {
      expect(moduleUniqueNameKey(u.id)).toBe(`def3.module.${u.id}.name`);
      expect(moduleUniqueDescKey(u.id)).toBe(`def3.module.${u.id}.desc`);
    }
  });

  it('유니크 id 가 전역 유일하다', () => {
    expect(new Set(CORE_MODULE_UNIQUES.map((u) => u.id)).size).toBe(CORE_MODULE_UNIQUES.length);
  });

  it('모듈 어픽스 키가 방어체 어픽스와 같은 def3.affix.* 규약을 따른다', () => {
    for (const a of MODULE_AFFIXES) {
      expect(moduleAffixNameKey(a.id)).toBe(`def3.affix.${a.id}.name`);
      expect(moduleAffixDescKey(a.id)).toBe(`def3.affix.${a.id}.desc`);
    }
  });

  it('모듈 어픽스 id 가 방어체 어픽스 id 와 겹치지 않는다(같은 네임스페이스 공유)', () => {
    // 두 축이 `def3.affix.*` 를 함께 쓰므로 id 가 겹치면 한쪽 문구가 다른 쪽을 덮어쓴다.
    const unitIds = new Set(DEFENSE_UNIT_AFFIXES.map((a) => a.id));
    for (const a of MODULE_AFFIXES) expect(unitIds.has(a.id)).toBe(false);
  });
});
