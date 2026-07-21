/**
 * 방어체 인벤토리·강화 3축·방어체 어픽스 엔진 테스트 (M7b · M7b-inventory).
 *
 * 중점 4가지:
 *   ① 같은 시드 → 바이트 동일 롤(ADR-0005 결정론)
 *   ② 방어체 어픽스 id 전역 유일 · 종류 필터 준수
 *   ③ **sim 산식 정합** — 메타가 보여주는 배율이 sim 실제 스탯과 같은가. 특히 설비는
 *      `resolveFacilityStats`(sim 정본) 실제 출력과 전 구간 대조한다(상수 드리프트 자동 검출).
 *   ④ 강화 비용이 전부 정수 · 사다리 상한 준수 · net 계층 no-op 규율
 */

import { describe, it, expect } from 'vitest';

import {
  DEFENSE_UNIT_AFFIXES,
  DEFENSE_UNIT_PREFIXES,
  DEFENSE_UNIT_SUFFIXES,
  DEFENSE_UNIT_AFFIX_BY_ID,
  DEFENSE_UNIT_AFFIX_RANGE,
  DEFENSE_UNIT_KINDS,
  defenseUnitAffixPool,
  defenseUnitAffixNameKey,
  defenseUnitAffixDescKey,
  defenseUnitScaleStat,
  defenseUnitPowerBp,
  defenseUnitLevelUpCost,
  defenseUnitLevelUpTotalCost,
  defenseUnitAscendCost,
  defenseUnitRerollCost,
  defenseUnitRarityUpCost,
  defenseUnitRarityRank,
  canAscend,
  ascensionVisualTier,
  rarityFromCode,
  addCost,
  nextRarityUp,
  DEFENSE_UNIT_STORAGE_CAP,
} from '../data/defenseUnits.js';
import type { Rarity } from '../src/items/types.js';
import { RARITY_BY_CODE } from '../src/items/types.js';
import {
  rollDefenseUnit,
  rerollDefenseUnitAffixes,
  promoteDefenseUnitRarity,
  nextAffixSeed,
  toInvasionRef,
  defenseUnitFromRef,
  affixTotals,
  affixCount,
} from '../src/items/rollDefenseUnit.js';
import {
  CATALOG_FORMATION,
  CATALOG_FACILITY,
  CATALOG_PROP,
  CATALOG_BOSS,
} from '../data/invasion/catalog.js';
import { formationPowerCp } from '../data/invasion/formations.js';
import { propPowerBp } from '../data/invasion/props.js';
import { defenseBossPowerBp, scaleByBp } from '../data/invasion/defenseBosses.js';
import { INVASION_FACILITIES } from '../data/invasion/facilities.js';
import { resolveFacilityStats } from '../src/sim/invasion/facility.js';
import { MAINTENANCE_FULL } from '../src/sim/invasion/guardianBridge.js';
import {
  DEFENSE_UNIQUES,
  DEFENSE_UNIQUE_BY_ID,
  DEFENSE_UNIQUE_MESSAGE_KEYS,
  DEFENSE_UNIT_UNIQUE_AFFIX_COUNT,
  defenseUniquePool,
  defenseUniqueNameKey,
  defenseUniqueDescKey,
  uniqueParam,
} from '../data/defenseUnits.js';
import type { DefenseUniqueDef } from '../data/defenseUnits.js';
import { defenseUnitUnique } from '../src/items/rollDefenseUnit.js';
import { SeededRng } from '../src/sim/rng.js';
import {
  AFFIX_BP_ONE,
  AFFIX_MAX_REDUCTION_BP,
  AFFIX_NO_CORE_HP_PCT,
  defenseAffixSet,
  resolveDefenseMods,
} from '../src/sim/invasion/affix.js';
import type { DefenseAffixMods, DefenseTriggerState } from '../src/sim/invasion/affix.js';
import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { InputFrame, WorldConfig } from '../src/sim/world.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { hashWorld } from '../src/sim/replay.js';
import { normalizeInvasionLayers } from '../src/sim/invasion/normalize.js';
import {
  INVASION_TOTAL_TICKS,
  PHASE_L1,
  PHASE_L2,
  PHASE_L3,
} from '../src/sim/invasion/constants.js';
import type { InvasionLayers, InvasionRef } from '../src/sim/invasion/types.js';
import {
  listDefenseUnits,
  levelUpDefenseUnit,
  ascendDefenseUnit,
  rerollDefenseUnitAffixes as netRerollAffixes,
  listBlueprints,
  craftDefenseUnit,
  promoteDefenseUnitRarity as netPromoteRarity,
  getDefenseUnitsUserId,
  resetDefenseUnitsGateway,
  type DefenseUnitsGateway,
} from '../src/net/defenseUnits.js';

const RARITIES: readonly Rarity[] = RARITY_BY_CODE;

// ---------------------------------------------------------------------------
// ① 결정론 롤
// ---------------------------------------------------------------------------

describe('방어체 롤 결정론', () => {
  it('같은 시드는 바이트 동일 방어체를 낸다', () => {
    for (const kind of DEFENSE_UNIT_KINDS) {
      for (const rarity of RARITIES) {
        const a = rollDefenseUnit({ kind, catalogId: 0, rarity, affixSeed: 0x1234abcd });
        const b = rollDefenseUnit({ kind, catalogId: 0, rarity, affixSeed: 0x1234abcd });
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      }
    }
  });

  it('레벨·승급은 어픽스 롤을 흔들지 않는다(성장이 옵션을 갈아엎지 않는다)', () => {
    const base = rollDefenseUnit({
      kind: CATALOG_FACILITY,
      catalogId: 1,
      rarity: 'rare',
      affixSeed: 77,
    });
    const grown = rollDefenseUnit({
      kind: CATALOG_FACILITY,
      catalogId: 1,
      rarity: 'rare',
      affixSeed: 77,
      level: 42,
      ascension: 3,
    });
    expect(grown.prefixes).toEqual(base.prefixes);
    expect(grown.suffixes).toEqual(base.suffixes);
    expect(grown.level).toBe(42);
    expect(grown.ascension).toBe(3);
  });

  it('레벨·승급은 도메인으로 클램프된다', () => {
    const u = rollDefenseUnit({
      kind: CATALOG_PROP,
      catalogId: 0,
      rarity: 'magic',
      affixSeed: 1,
      level: 999,
      ascension: 99,
    });
    expect(u.level).toBe(99);
    expect(u.ascension).toBe(5);
    const lo = rollDefenseUnit({
      kind: CATALOG_PROP,
      catalogId: 0,
      rarity: 'magic',
      affixSeed: 1,
      level: -5,
      ascension: -5,
    });
    expect(lo.level).toBe(1);
    expect(lo.ascension).toBe(0);
  });

  it('리롤은 시드만 바꾸고 나머지를 보존한다(순수 — 원본 무변형)', () => {
    const u = rollDefenseUnit({
      kind: CATALOG_BOSS,
      catalogId: 0,
      rarity: 'unique',
      affixSeed: 5,
      level: 10,
      ascension: 2,
    });
    const snapshot = JSON.stringify(u);
    const r = rerollDefenseUnitAffixes(u, nextAffixSeed(u.affixSeed));
    expect(JSON.stringify(u)).toBe(snapshot);
    expect(r.affixSeed).not.toBe(u.affixSeed);
    expect(r.kind).toBe(u.kind);
    expect(r.catalogId).toBe(u.catalogId);
    expect(r.rarity).toBe(u.rarity);
    expect(r.level).toBe(u.level);
    expect(r.ascension).toBe(u.ascension);
  });

  it('nextAffixSeed 는 결정론이고 uint32 범위다', () => {
    for (const s of [0, 1, 42, 0xffffffff]) {
      const a = nextAffixSeed(s);
      expect(nextAffixSeed(s)).toBe(a);
      expect(Number.isInteger(a)).toBe(true);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('등급 승급은 새 시드로 재롤하고 레벨·승급을 보존한다', () => {
    const u = rollDefenseUnit({
      kind: CATALOG_FORMATION,
      catalogId: 0,
      rarity: 'magic',
      affixSeed: 9,
      level: 7,
      ascension: 1,
    });
    const up = nextRarityUp(u.rarity);
    expect(up).toBe('rare');
    const p = promoteDefenseUnitRarity(u, up!, 12345);
    expect(p.rarity).toBe('rare');
    expect(p.affixSeed).toBe(12345);
    expect(p.level).toBe(7);
    expect(p.ascension).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ② 방어체 어픽스 정의 무결성
// ---------------------------------------------------------------------------

describe('방어체 어픽스 정의', () => {
  it('id 가 전역 유일하다', () => {
    const ids = DEFENSE_UNIT_AFFIXES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DEFENSE_UNIT_AFFIX_BY_ID.size).toBe(ids.length);
  });

  it('접두/접미 분류와 trigger 유무가 일치한다', () => {
    for (const a of DEFENSE_UNIT_PREFIXES) {
      expect(a.kind).toBe('prefix');
      expect(a.trigger).toBeUndefined();
    }
    for (const a of DEFENSE_UNIT_SUFFIXES) {
      expect(a.kind).toBe('suffix');
      expect(a.trigger).toBeDefined();
      expect(Number.isInteger(a.threshold)).toBe(true);
    }
  });

  it('롤 범위가 정수이고 min ≤ max, kinds 가 비어 있지 않다', () => {
    for (const a of DEFENSE_UNIT_AFFIXES) {
      expect(Number.isInteger(a.min)).toBe(true);
      expect(Number.isInteger(a.max)).toBe(true);
      expect(a.min).toBeLessThanOrEqual(a.max);
      expect(a.kinds.length).toBeGreaterThan(0);
      for (const k of a.kinds) expect(DEFENSE_UNIT_KINDS).toContain(k);
    }
  });

  it('종류별 풀이 등급 상한만큼 뽑을 만큼 크다(추첨이 잘리지 않는다)', () => {
    const cap = Math.max(...RARITIES.map((r) => DEFENSE_UNIT_AFFIX_RANGE[r][1]));
    for (const kind of DEFENSE_UNIT_KINDS) {
      expect(defenseUnitAffixPool(kind).length).toBeGreaterThanOrEqual(cap);
    }
  });

  it('i18n 키만 노출하고 표시 문자열을 데이터에 두지 않는다', () => {
    for (const a of DEFENSE_UNIT_AFFIXES) {
      expect(defenseUnitAffixNameKey(a.id)).toBe(`def3.affix.${a.id}.name`);
      expect(defenseUnitAffixDescKey(a.id)).toBe(`def3.affix.${a.id}.desc`);
      // 정의 객체에 한글 표시명 필드를 두지 않는다(카탈로그 i18n 규약).
      expect(Object.prototype.hasOwnProperty.call(a, 'name')).toBe(false);
    }
  });

  it('롤 결과는 종류 필터와 등급 개수 범위를 지킨다', () => {
    for (const kind of DEFENSE_UNIT_KINDS) {
      const allowed = new Set(defenseUnitAffixPool(kind).map((a) => a.id));
      for (const rarity of RARITIES) {
        const [lo, hi] = DEFENSE_UNIT_AFFIX_RANGE[rarity];
        for (let seed = 1; seed <= 40; seed++) {
          const u = rollDefenseUnit({ kind, catalogId: 0, rarity, affixSeed: seed * 7919 });
          const n = affixCount(u);
          expect(n).toBeGreaterThanOrEqual(Math.min(lo, allowed.size));
          expect(n).toBeLessThanOrEqual(Math.min(hi, allowed.size));
          const ids = [...u.prefixes, ...u.suffixes].map((r) => r.id);
          expect(new Set(ids).size).toBe(ids.length); // 중복 없음
          for (const r of [...u.prefixes, ...u.suffixes]) {
            expect(allowed.has(r.id)).toBe(true);
            const def = DEFENSE_UNIT_AFFIX_BY_ID.get(r.id);
            expect(def).toBeDefined();
            expect(r.stat).toBe(def!.stat);
            expect(r.value).toBeGreaterThanOrEqual(def!.min);
            expect(r.value).toBeLessThanOrEqual(def!.max);
            expect(Number.isInteger(r.value)).toBe(true);
          }
        }
      }
    }
  });

  it('affixTotals 가 상시/조건부를 분리 집계한다', () => {
    const u = rollDefenseUnit({
      kind: CATALOG_FACILITY,
      catalogId: 0,
      rarity: 'rare',
      affixSeed: 31337,
    });
    const dmg = affixTotals(u, 'defDamagePct');
    const expectAlways = u.prefixes
      .filter((r) => r.stat === 'defDamagePct')
      .reduce((s, r) => s + r.value, 0);
    const expectCond = u.suffixes
      .filter((r) => r.stat === 'defDamagePct')
      .reduce((s, r) => s + r.value, 0);
    expect(dmg.always).toBe(expectAlways);
    expect(dmg.conditional).toBe(expectCond);
  });
});

// ---------------------------------------------------------------------------
// ③ sim 산식 정합 — 메타 표기 == 실제 전투
// ---------------------------------------------------------------------------

describe('강화 3축 → 스탯 스케일이 sim 정본과 일치', () => {
  const LEVELS = [1, 2, 7, 25, 50, 98, 99];
  const ASCS = [0, 1, 3, 5];
  const RARS = [0, 1, 2, 3];

  it('편대는 formationPowerCp 1단 반올림과 같다', () => {
    for (const lv of LEVELS)
      for (const asc of ASCS)
        for (const rar of RARS) {
          const base = 137;
          expect(defenseUnitScaleStat(CATALOG_FORMATION, base, lv, asc, rar)).toBe(
            Math.round((base * formationPowerCp(lv, asc, rar)) / 100),
          );
        }
  });

  it('설비는 resolveFacilityStats(sim 정본) 실제 출력과 전 구간 일치', () => {
    for (const spec of INVASION_FACILITIES) {
      for (const lv of LEVELS)
        for (const asc of ASCS)
          for (const rar of RARS) {
            const ref = { catalogId: 0, level: lv, ascension: asc, affixSeed: 0, rarity: rar };
            const sim = resolveFacilityStats(spec, ref, MAINTENANCE_FULL);
            expect(defenseUnitScaleStat(CATALOG_FACILITY, spec.hp, lv, asc, rar)).toBe(sim.hp);
          }
    }
  });

  it('기물·보스는 각자의 powerBp + scaleByBp 와 같다', () => {
    for (const lv of LEVELS)
      for (const asc of ASCS)
        for (const rar of RARS) {
          const base = 512;
          expect(defenseUnitScaleStat(CATALOG_PROP, base, lv, asc, rar)).toBe(
            scaleByBp(base, propPowerBp(lv, asc, rar)),
          );
          expect(defenseUnitScaleStat(CATALOG_BOSS, base, lv, asc, rar)).toBe(
            scaleByBp(base, defenseBossPowerBp(lv, asc, rar)),
          );
        }
  });

  it('배율은 항상 정수이고 lv1·승급0·노말은 ×1.00(10000bp)', () => {
    for (const kind of DEFENSE_UNIT_KINDS) {
      expect(defenseUnitPowerBp(kind, 1, 0, 0)).toBe(10000);
      for (const lv of LEVELS)
        for (const asc of ASCS)
          for (const rar of RARS) {
            const bp = defenseUnitPowerBp(kind, lv, asc, rar);
            expect(Number.isInteger(bp)).toBe(true);
            expect(bp).toBeGreaterThanOrEqual(10000);
          }
    }
  });

  it('배율은 각 축에 대해 단조 증가한다', () => {
    for (const kind of DEFENSE_UNIT_KINDS) {
      for (let lv = 1; lv < 99; lv++) {
        expect(defenseUnitPowerBp(kind, lv + 1, 0, 0)).toBeGreaterThan(
          defenseUnitPowerBp(kind, lv, 0, 0),
        );
      }
      for (let asc = 0; asc < 5; asc++) {
        expect(defenseUnitPowerBp(kind, 1, asc + 1, 0)).toBeGreaterThan(
          defenseUnitPowerBp(kind, 1, asc, 0),
        );
      }
      for (let rar = 0; rar < 3; rar++) {
        expect(defenseUnitPowerBp(kind, 1, 0, rar + 1)).toBeGreaterThan(
          defenseUnitPowerBp(kind, 1, 0, rar),
        );
      }
    }
  });

  it('알 수 없는 종류는 배율을 지어내지 않는다(무보정)', () => {
    expect(defenseUnitScaleStat(99, 250, 50, 5, 3)).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// ④ 강화 비용 · 사다리 상한
// ---------------------------------------------------------------------------

describe('강화 비용', () => {
  it('레벨업 비용은 정수이고 레벨에 단조 증가하며 99 에서 끝난다', () => {
    for (const rarity of RARITIES) {
      let prev = -1;
      for (let lv = 1; lv < 99; lv++) {
        const c = defenseUnitLevelUpCost(rarity, lv);
        expect(c).not.toBeNull();
        expect(Number.isInteger(c!.credits)).toBe(true);
        expect(Number.isInteger(c!.minerals)).toBe(true);
        expect(c!.blueprints).toBe(0);
        expect(c!.credits).toBeGreaterThan(prev);
        prev = c!.credits;
      }
      expect(defenseUnitLevelUpCost(rarity, 99)).toBeNull();
      expect(defenseUnitLevelUpCost(rarity, 0)).toBeNull();
    }
  });

  it('희귀 광물은 20레벨부터 10레벨 구간마다 1씩 는다', () => {
    expect(defenseUnitLevelUpCost('normal', 19)!.minerals).toBe(0);
    expect(defenseUnitLevelUpCost('normal', 20)!.minerals).toBe(1);
    expect(defenseUnitLevelUpCost('normal', 29)!.minerals).toBe(1);
    expect(defenseUnitLevelUpCost('normal', 30)!.minerals).toBe(2);
    expect(defenseUnitLevelUpCost('normal', 90)!.minerals).toBe(8);
  });

  it('등급이 높을수록 레벨업 크레딧이 비싸다', () => {
    for (let i = 0; i + 1 < RARITIES.length; i++) {
      const lo = defenseUnitLevelUpCost(RARITIES[i]!, 30)!;
      const hi = defenseUnitLevelUpCost(RARITIES[i + 1]!, 30)!;
      expect(hi.credits).toBeGreaterThan(lo.credits);
    }
  });

  it('누적 비용 = 단계 비용의 합(정수 누적)', () => {
    const total = defenseUnitLevelUpTotalCost('rare', 1, 25);
    let credits = 0;
    let minerals = 0;
    for (let lv = 1; lv < 25; lv++) {
      const c = defenseUnitLevelUpCost('rare', lv)!;
      credits += c.credits;
      minerals += c.minerals;
    }
    expect(total.credits).toBe(credits);
    expect(total.minerals).toBe(minerals);
    // 역방향·동일 구간은 0 비용.
    expect(defenseUnitLevelUpTotalCost('rare', 25, 25)).toEqual({
      credits: 0,
      minerals: 0,
      blueprints: 0,
    });
    expect(defenseUnitLevelUpTotalCost('rare', 30, 10).credits).toBe(0);
  });

  it('승급 사다리는 0..5 이고 상한에서 null', () => {
    for (let asc = 0; asc < 5; asc++) {
      const c = defenseUnitAscendCost(asc);
      expect(c).not.toBeNull();
      expect(c!.blueprints).toBeGreaterThan(0);
      expect(Number.isInteger(c!.credits)).toBe(true);
      expect(canAscend(asc)).toBe(true);
    }
    expect(defenseUnitAscendCost(5)).toBeNull();
    expect(canAscend(5)).toBe(false);
    // 설계도 요구가 단조 증가한다.
    for (let asc = 0; asc + 1 < 5; asc++) {
      expect(defenseUnitAscendCost(asc + 1)!.blueprints).toBeGreaterThan(
        defenseUnitAscendCost(asc)!.blueprints,
      );
    }
  });

  it('승급 외형 티어는 0..3 이고 단조 비감소', () => {
    const tiers = [0, 1, 2, 3, 4, 5].map(ascensionVisualTier);
    expect(tiers[0]).toBe(0);
    expect(tiers[5]).toBe(3);
    for (let i = 1; i < tiers.length; i++) expect(tiers[i]!).toBeGreaterThanOrEqual(tiers[i - 1]!);
  });

  it('리롤 비용은 등급만의 함수이고 정수·단조 증가', () => {
    let prev = -1;
    for (const rarity of RARITIES) {
      const c = defenseUnitRerollCost(rarity);
      expect(Number.isInteger(c.minerals)).toBe(true);
      expect(c.credits).toBe(0);
      expect(c.blueprints).toBe(0);
      expect(c.minerals).toBeGreaterThan(prev);
      prev = c.minerals;
    }
  });

  it('등급 승급 비용은 사다리 상한(unique)에서 null', () => {
    expect(defenseUnitRarityUpCost('normal')!.blueprints).toBe(4);
    expect(defenseUnitRarityUpCost('magic')!.blueprints).toBe(8);
    expect(defenseUnitRarityUpCost('rare')!.blueprints).toBe(16);
    expect(defenseUnitRarityUpCost('unique')).toBeNull();
    expect(nextRarityUp('unique')).toBeUndefined();
  });

  it('보조 함수 — 등급 랭크·코드 변환·비용 합산', () => {
    expect(RARITIES.map(defenseUnitRarityRank)).toEqual([0, 1, 2, 3]);
    expect(rarityFromCode(0)).toBe('normal');
    expect(rarityFromCode(3)).toBe('unique');
    expect(rarityFromCode(99)).toBe('normal'); // 범위 밖은 안전 폴백
    expect(
      addCost({ credits: 1, minerals: 2, blueprints: 3 }, { credits: 10, minerals: 20, blueprints: 30 }),
    ).toEqual({ credits: 11, minerals: 22, blueprints: 33 });
    expect(DEFENSE_UNIT_STORAGE_CAP).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 배치 참조 왕복
// ---------------------------------------------------------------------------

describe('InvasionRef 왕복', () => {
  it('toInvasionRef 는 정수 5필드만 낸다', () => {
    const u = rollDefenseUnit({
      kind: CATALOG_PROP,
      catalogId: 2,
      rarity: 'unique',
      affixSeed: 0xdeadbeef,
      level: 33,
      ascension: 4,
    });
    const ref = toInvasionRef(u);
    expect(Object.keys(ref).sort()).toEqual(
      ['ascension', 'affixSeed', 'catalogId', 'level', 'rarity'].sort(),
    );
    for (const v of Object.values(ref)) expect(Number.isInteger(v)).toBe(true);
    expect(ref.rarity).toBe(3);
    expect(ref.level).toBe(33);
    expect(ref.ascension).toBe(4);
  });

  it('ref → 인스턴스 재구성이 원본과 바이트 동일(시드만 저장하는 설계의 회수 지점)', () => {
    for (const kind of DEFENSE_UNIT_KINDS) {
      for (const rarity of RARITIES) {
        const u = rollDefenseUnit({
          kind,
          catalogId: 1,
          rarity,
          affixSeed: 0x515151,
          level: 12,
          ascension: 2,
        });
        const back = defenseUnitFromRef(kind, toInvasionRef(u));
        expect(JSON.stringify(back)).toBe(JSON.stringify(u));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// net 계층 — no-op 규율
// ---------------------------------------------------------------------------

function fakeGateway(overrides: Partial<DefenseUnitsGateway> = {}): DefenseUnitsGateway {
  const okResult = { ok: true, credits: 100, minerals: 10 };
  return {
    getUserId: async () => 'uid-1',
    listUnits: async () => [],
    listBlueprints: async () => [{ kind: CATALOG_FORMATION, catalogId: 0, count: 3 }],
    levelUp: async () => okResult,
    ascend: async () => okResult,
    rerollAffixes: async () => okResult,
    promoteRarity: async () => okResult,
    craftFromBlueprint: async () => okResult,
    ...overrides,
  };
}

describe('src/net/defenseUnits — Supabase 미설정 시 no-op', () => {
  it('설정이 없으면 null 을 돌려주고 throw 하지 않는다', async () => {
    resetDefenseUnitsGateway();
    const deps = { config: null };
    await expect(getDefenseUnitsUserId(deps)).resolves.toBeNull();
    await expect(listDefenseUnits(deps)).resolves.toBeNull();
    await expect(listBlueprints(deps)).resolves.toBeNull();
    await expect(levelUpDefenseUnit('u', deps)).resolves.toBeNull();
    await expect(ascendDefenseUnit('u', deps)).resolves.toBeNull();
    await expect(netRerollAffixes('u', deps)).resolves.toBeNull();
    await expect(netPromoteRarity('u', deps)).resolves.toBeNull();
    await expect(craftDefenseUnit(0, 0, deps)).resolves.toBeNull();
  });

  it('설정이 있어도 게이트웨이 팩토리 미등록이면 no-op(존재하지 않는 SDK 를 부르지 않는다)', async () => {
    resetDefenseUnitsGateway();
    const deps = { config: { url: 'https://example.supabase.co', anonKey: 'k' } };
    await expect(listDefenseUnits(deps)).resolves.toBeNull();
    await expect(levelUpDefenseUnit('u', deps)).resolves.toBeNull();
  });

  it('게이트웨이 주입 시 결과를 그대로 전달한다', async () => {
    const deps = { gateway: fakeGateway() };
    await expect(getDefenseUnitsUserId(deps)).resolves.toBe('uid-1');
    await expect(listDefenseUnits(deps)).resolves.toEqual([]);
    await expect(listBlueprints(deps)).resolves.toEqual([
      { kind: CATALOG_FORMATION, catalogId: 0, count: 3 },
    ]);
    await expect(levelUpDefenseUnit('u', deps)).resolves.toMatchObject({ ok: true });
    await expect(craftDefenseUnit(0, 0, deps)).resolves.toMatchObject({ ok: true });
  });

  it('게이트웨이가 throw 해도 삼키고 null 을 돌려준다', async () => {
    const deps = {
      gateway: fakeGateway({
        listUnits: async () => {
          throw new Error('network');
        },
        levelUp: async () => {
          throw new Error('rpc');
        },
      }),
    };
    await expect(listDefenseUnits(deps)).resolves.toBeNull();
    await expect(levelUpDefenseUnit('u', deps)).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ⑤ 유니크 방어체 고유 효과 (M7c)
// ---------------------------------------------------------------------------

/** 유니크 등급 코드(InvasionRef.rarity). 하드코딩이 아니라 사다리에서 파생한다. */
const UNIQUE_CODE = RARITY_BY_CODE.indexOf('unique');

/** 종류별 유니크 롤을 만들 시드를 결정론 탐색한다(풀이 작아 즉시 찾힌다). */
function findUniqueSeed(kind: number, uniqueId: string): number {
  for (let s = 1; s < 50000; s++) {
    const rolled = rollDefenseUnit({ kind, catalogId: 0, rarity: 'unique', affixSeed: s });
    if (rolled.uniqueId === uniqueId) return s;
  }
  throw new Error(`유니크 롤 시드를 못 찾음: kind=${kind} id=${uniqueId}`);
}

/** 정의를 반드시 찾는다(테스트마다 옵셔널 분기를 반복하지 않으려고). */
function uniqueDef(id: string): DefenseUniqueDef {
  const def = DEFENSE_UNIQUE_BY_ID.get(id);
  if (def === undefined) throw new Error(`정의 없음: ${id}`);
  return def;
}

/** 유니크 1종을 실제로 낼 수 있는 (kind, ref) 표본. */
function uniqueSample(uniqueId: string): { kind: number; ref: InvasionRef } {
  const kind = uniqueDef(uniqueId).kinds[0];
  if (kind === undefined) throw new Error(`kinds 가 비었다: ${uniqueId}`);
  return {
    kind,
    ref: {
      catalogId: 0,
      level: 1,
      ascension: 0,
      affixSeed: findUniqueSeed(kind, uniqueId),
      rarity: UNIQUE_CODE,
    },
  };
}

/** 기본 계기 상태(어떤 동적 항도 발동하지 않는 지점). */
function baseTrigger(): DefenseTriggerState {
  return {
    elapsedTicks: 0,
    coreHpPct: AFFIX_NO_CORE_HP_PCT,
    alliesDestroyed: 0,
    playerX: 100000,
    playerY: 100000,
  };
}

/** 감쇠축 상한 반영 기대값. */
function expectReduction(pct: number): number {
  const bp = pct * 100;
  return bp > AFFIX_MAX_REDUCTION_BP ? AFFIX_MAX_REDUCTION_BP : bp;
}

/**
 * 유니크 **동적항만** 떼어낸 델타. 같은 계기 상태에서 `unique` 만 지운 통제군과 대조하므로
 * 접미(조건부) 어픽스의 기여가 양쪽에서 상쇄된다 — 즉 이 델타는 고유 효과의 순수 기여다.
 */
function dynamicDelta(
  kind: number,
  ref: InvasionRef,
  st: DefenseTriggerState,
  selfX = 0,
  selfY = 0,
): DefenseAffixMods {
  const set = defenseAffixSet(kind, ref);
  const control = { ...set, unique: null };
  const withU = resolveDefenseMods(set, st, selfX, selfY);
  const without = resolveDefenseMods(control, st, selfX, selfY);
  return {
    hpBp: withU.hpBp - without.hpBp,
    damageBp: withU.damageBp - without.damageBp,
    fireRateBp: withU.fireRateBp - without.fireRateBp,
    shieldFlat: withU.shieldFlat - without.shieldFlat,
    weatherResistBp: withU.weatherResistBp - without.weatherResistBp,
    spawnCapFlat: withU.spawnCapFlat - without.spawnCapFlat,
    overheatResistBp: withU.overheatResistBp - without.overheatResistBp,
    entryHasteBp: withU.entryHasteBp - without.entryHasteBp,
  };
}

describe('유니크 방어체 — 정의 계약', () => {
  it('id 가 전역 유일하고 방어체 어픽스 id 와도 겹치지 않는다', () => {
    const ids = DEFENSE_UNIQUES.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(DEFENSE_UNIT_AFFIX_BY_ID.has(id)).toBe(false);
  });

  it('effect 판별자가 유니크마다 유일하다(같은 효과 두 벌 금지)', () => {
    const effects = DEFENSE_UNIQUES.map((u) => u.effect);
    expect(new Set(effects).size).toBe(effects.length);
  });

  it('kinds 가 비어 있지 않고 전부 방어체 종류다(맵 템플릿 제외)', () => {
    for (const u of DEFENSE_UNIQUES) {
      expect(u.kinds.length).toBeGreaterThan(0);
      for (const k of u.kinds) expect(DEFENSE_UNIT_KINDS).toContain(k);
    }
  });

  it('params 값이 전부 유한 정수다(f64 유입 차단)', () => {
    for (const u of DEFENSE_UNIQUES) {
      for (const v of Object.values(u.params)) {
        expect(Number.isInteger(v)).toBe(true);
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('네 종류 전부 유니크 풀이 비지 않는다(배열 파생 — catalogId 하드코딩 없음)', () => {
    for (const kind of DEFENSE_UNIT_KINDS) {
      const pool = defenseUniquePool(kind);
      expect(pool.length).toBeGreaterThan(0);
      expect(pool.length).toBeLessThanOrEqual(DEFENSE_UNIQUES.length);
      for (const u of pool) expect(u.kinds).toContain(kind);
    }
  });

  it('풀 합계가 정의별 kinds 개수 합과 같다(필터가 실제로 걸린다)', () => {
    const viaPool = DEFENSE_UNIT_KINDS.reduce((n, k) => n + defenseUniquePool(k).length, 0);
    const viaDefs = DEFENSE_UNIQUES.reduce((n, u) => n + u.kinds.length, 0);
    expect(viaPool).toBe(viaDefs);
  });

  it('i18n 키가 정의 배열에서 파생된다(하드코딩 표 금지)', () => {
    expect(DEFENSE_UNIQUE_MESSAGE_KEYS.length).toBe(DEFENSE_UNIQUES.length * 2);
    for (const u of DEFENSE_UNIQUES) {
      expect(DEFENSE_UNIQUE_MESSAGE_KEYS).toContain(defenseUniqueNameKey(u.id));
      expect(DEFENSE_UNIQUE_MESSAGE_KEYS).toContain(defenseUniqueDescKey(u.id));
    }
    expect(new Set(DEFENSE_UNIQUE_MESSAGE_KEYS).size).toBe(DEFENSE_UNIQUE_MESSAGE_KEYS.length);
  });

  it('uniqueParam 은 미정의 키에 fallback 을 준다(NaN 유입 차단)', () => {
    expect(uniqueParam(uniqueDef(DEFENSE_UNIQUES[0]!.id), 'no-such-key', 77)).toBe(77);
  });

  it('편대 접두 풀이 유니크 어픽스 수보다 작다 — 편대 유니크는 항상 접미를 하나 이상 갖는다', () => {
    // 편대의 매 틱 재계산(`refreshFormationAffixes`)은 접미 보유 개체에만 표식(aux0)을 남긴다.
    // 접두만으로 5개가 채워질 수 있게 되면 편대 유니크의 동적 항이 조용히 죽는다.
    const prefixPool = DEFENSE_UNIT_PREFIXES.filter((a) => a.kinds.includes(CATALOG_FORMATION));
    expect(prefixPool.length).toBeLessThan(DEFENSE_UNIT_UNIQUE_AFFIX_COUNT);
  });
});

describe('유니크 방어체 — 롤 결정론', () => {
  it('unique 등급만 uniqueId 를 갖는다', () => {
    for (const rarity of RARITIES) {
      const u = rollDefenseUnit({ kind: CATALOG_FACILITY, catalogId: 0, rarity, affixSeed: 4242 });
      if (rarity === 'unique') expect(typeof u.uniqueId).toBe('string');
      else expect(u.uniqueId).toBeUndefined();
    }
  });

  it('같은 시드 → 같은 유니크(바이트 동일 롤)', () => {
    for (const kind of DEFENSE_UNIT_KINDS) {
      for (const seed of [1, 99, 123456, 4294967295]) {
        const a = rollDefenseUnit({ kind, catalogId: 2, rarity: 'unique', affixSeed: seed });
        const b = rollDefenseUnit({ kind, catalogId: 2, rarity: 'unique', affixSeed: seed });
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
        expect(a.uniqueId).toBe(b.uniqueId);
      }
    }
  });

  it('뽑힌 유니크는 항상 그 종류의 풀 안에 있다', () => {
    for (const kind of DEFENSE_UNIT_KINDS) {
      const allowed = new Set(defenseUniquePool(kind).map((u) => u.id));
      for (let seed = 1; seed <= 200; seed++) {
        const u = rollDefenseUnit({ kind, catalogId: 0, rarity: 'unique', affixSeed: seed });
        expect(u.uniqueId).toBeDefined();
        expect(allowed.has(u.uniqueId ?? '')).toBe(true);
      }
    }
  });

  it('유니크 추첨은 드로우 순서의 맨 끝이다 — 어픽스 롤이 밀리지 않는다', () => {
    // M7b 알고리즘(어픽스 수 → 어픽스 → 값)을 그대로 재현해 대조한다. 유니크 추첨이 앞이나
    // 중간에 끼면 이 재현이 그 자리에서 어긋난다(= 저장된 방어체가 통째로 바뀌는 회귀).
    for (const kind of DEFENSE_UNIT_KINDS) {
      const seed = 20260721;
      const rng = new SeededRng(seed);
      const [lo, hi] = DEFENSE_UNIT_AFFIX_RANGE.unique;
      const count = rng.int(lo, hi);
      const pool = [...defenseUnitAffixPool(kind)];
      const expected: string[] = [];
      const n = count < pool.length ? count : pool.length;
      for (let k = 0; k < n; k++) {
        const j = rng.int(0, pool.length - 1);
        const def = pool[j];
        pool.splice(j, 1);
        if (def === undefined) continue;
        expected.push(`${def.id}:${rng.int(def.min, def.max)}`);
      }
      const u = rollDefenseUnit({ kind, catalogId: 0, rarity: 'unique', affixSeed: seed });
      const got = [...u.prefixes, ...u.suffixes].map((r) => `${r.id}:${r.value}`);
      // 접두/접미 분류로 순서만 갈리므로 집합으로 대조한다.
      expect(new Set(got)).toEqual(new Set(expected));
      // 그리고 유니크 id 는 그 **뒤** 드로우로 확정된다.
      const uniquePool = defenseUniquePool(kind);
      expect(u.uniqueId).toBe(uniquePool[rng.int(0, uniquePool.length - 1)]?.id);
    }
  });

  it('리롤·등급 승급이 유니크를 다시 굴린다(시드 교체 = 유니크 교체 가능)', () => {
    const kind = CATALOG_BOSS;
    const a = rollDefenseUnit({ kind, catalogId: 0, rarity: 'unique', affixSeed: 11 });
    const b = rerollDefenseUnitAffixes(a, nextAffixSeed(a.affixSeed));
    expect(b.uniqueId).toBeDefined();
    expect(defenseUnitUnique(b)).not.toBeNull();
    const rare = rollDefenseUnit({ kind, catalogId: 0, rarity: 'rare', affixSeed: 5 });
    expect(defenseUnitUnique(rare)).toBeNull();
    expect(promoteDefenseUnitRarity(rare, 'unique', 777).uniqueId).toBeDefined();
  });

  it('레벨·승급 상한이 유니크 롤에서도 유지되고 유니크 id 는 배치에 실리지 않는다', () => {
    const u = rollDefenseUnit({
      kind: CATALOG_PROP,
      catalogId: 0,
      rarity: 'unique',
      affixSeed: 3,
      level: 9999,
      ascension: 9999,
    });
    expect(u.level).toBe(99);
    expect(u.ascension).toBe(5);
    const ref = toInvasionRef(u);
    expect(ref.rarity).toBe(UNIQUE_CODE);
    // 배치 jsonb 는 여전히 정수 5필드뿐 — 유니크는 시드에서 재구성된다(위조 표면 0).
    expect(Object.keys(ref).sort()).toEqual([
      'affixSeed',
      'ascension',
      'catalogId',
      'level',
      'rarity',
    ]);
    expect(defenseUnitFromRef(u.kind, ref).uniqueId).toBe(u.uniqueId);
  });
});

describe('유니크 방어체 — 고유 효과가 sim 보정으로 관측된다(효과별 전수)', () => {
  it('유니크 ref 는 sim 해석에서 절대 neutral 이 아니다', () => {
    for (const u of DEFENSE_UNIQUES) {
      const { kind, ref } = uniqueSample(u.id);
      const set = defenseAffixSet(kind, ref);
      expect(set.unique?.id).toBe(u.id);
      expect(set.neutral).toBe(false);
    }
  });

  it('비유니크 ref 는 unique 가 null 이고 무보정 경로가 그대로다', () => {
    const ref: InvasionRef = { catalogId: 0, level: 1, ascension: 0, affixSeed: 0, rarity: 0 };
    const set = defenseAffixSet(CATALOG_FACILITY, ref);
    expect(set.unique ?? null).toBeNull();
    expect(set.neutral).toBe(true);
    // 무보정 경로는 새 객체를 만들지 않고 always 를 그대로 돌려준다(추가 산술 0 = 비트 동일).
    expect(resolveDefenseMods(set, baseTrigger(), 0, 0)).toBe(set.always);
  });

  it('과부하 노심 — 경과 시간에 비례해 연사가 오르고 상수 대가로 내구도가 준다', () => {
    const { kind, ref } = uniqueSample('duq-overclock-core');
    const def = uniqueDef('duq-overclock-core');
    const unit = defenseUnitFromRef(kind, ref);
    const set = defenseAffixSet(kind, ref);
    const hpPct = affixTotals(unit, 'defHpPct').always - uniqueParam(def, 'hpPenaltyPct', 0);
    expect(set.always.hpBp).toBe(AFFIX_BP_ONE + hpPct * 100);
    const d = dynamicDelta(kind, ref, { ...baseTrigger(), elapsedTicks: 600 });
    expect(d.fireRateBp).toBe(Math.floor((600 * uniqueParam(def, 'rateBpPerSec', 0)) / 60));
    expect(d.damageBp).toBe(0);
    expect(dynamicDelta(kind, ref, { ...baseTrigger(), elapsedTicks: 1000000 }).fireRateBp).toBe(
      uniqueParam(def, 'rateCapBp', 0),
    );
  });

  it('복수 기관 — 파괴된 아군 수에 비례해 피해가 오른다', () => {
    const { kind, ref } = uniqueSample('duq-vengeance-engine');
    const def = uniqueDef('duq-vengeance-engine');
    const per = uniqueParam(def, 'damageBpPerAlly', 0);
    expect(dynamicDelta(kind, ref, { ...baseTrigger(), alliesDestroyed: 0 }).damageBp).toBe(0);
    expect(dynamicDelta(kind, ref, { ...baseTrigger(), alliesDestroyed: 3 }).damageBp).toBe(3 * per);
    expect(dynamicDelta(kind, ref, { ...baseTrigger(), alliesDestroyed: 9999 }).damageBp).toBe(
      uniqueParam(def, 'damageCapBp', 0),
    );
  });

  it('최후의 요새 — 코어 HP 가 낮을수록 내구도가 오른다(코어 없으면 무발동)', () => {
    const { kind, ref } = uniqueSample('duq-deathgrip-bastion');
    const def = uniqueDef('duq-deathgrip-bastion');
    const pivot = uniqueParam(def, 'pivotPct', 0);
    const atZero = uniqueParam(def, 'hpBpAtZero', 0);
    expect(dynamicDelta(kind, ref, { ...baseTrigger(), coreHpPct: 100 }).hpBp).toBe(0);
    expect(dynamicDelta(kind, ref, baseTrigger()).hpBp).toBe(0); // 코어 없음 표식
    expect(dynamicDelta(kind, ref, { ...baseTrigger(), coreHpPct: 0 }).hpBp).toBe(atZero);
    const half = Math.floor(pivot / 2);
    expect(dynamicDelta(kind, ref, { ...baseTrigger(), coreHpPct: half }).hpBp).toBe(
      Math.floor((atZero * (pivot - half)) / pivot),
    );
  });

  it('근접 반응로 — 공격자가 가까울수록 피해가 오른다(거리 밴드 계단)', () => {
    const { kind, ref } = uniqueSample('duq-proximity-reactor');
    const def = uniqueDef('duq-proximity-reactor');
    const radius = uniqueParam(def, 'radius', 0);
    const near = uniqueParam(def, 'damageBpNear', 0);
    const far = { ...baseTrigger(), playerX: radius + 1, playerY: 0 };
    const on = { ...baseTrigger(), playerX: 0, playerY: 0 };
    expect(dynamicDelta(kind, ref, far).damageBp).toBe(0);
    expect(dynamicDelta(kind, ref, on).damageBp).toBe(near);
    const mid = { ...baseTrigger(), playerX: Math.floor(radius * 0.7), playerY: 0 };
    const midBp = dynamicDelta(kind, ref, mid).damageBp;
    expect(midBp).toBeGreaterThan(0);
    expect(midBp).toBeLessThan(near);
  });

  it('군체 중추 — 동시 생존 상한이 오르고 연사가 준다(설비 전용)', () => {
    const { kind, ref } = uniqueSample('duq-swarm-nexus');
    const def = uniqueDef('duq-swarm-nexus');
    expect(kind).toBe(CATALOG_FACILITY);
    const unit = defenseUnitFromRef(kind, ref);
    const set = defenseAffixSet(kind, ref);
    expect(set.always.spawnCapFlat).toBe(
      affixTotals(unit, 'defSpawnCapFlat').always + uniqueParam(def, 'spawnCapFlat', 0),
    );
    const ratePct =
      affixTotals(unit, 'defFireRatePct').always - uniqueParam(def, 'fireRatePenaltyPct', 0);
    expect(set.always.fireRateBp).toBe(AFFIX_BP_ONE + ratePct * 100);
  });

  it('수호 격자 — 보호막·풍화 저항을 얻고 피해를 잃는다', () => {
    const { kind, ref } = uniqueSample('duq-aegis-lattice');
    const def = uniqueDef('duq-aegis-lattice');
    const unit = defenseUnitFromRef(kind, ref);
    const set = defenseAffixSet(kind, ref);
    expect(set.always.shieldFlat).toBe(
      affixTotals(unit, 'defShieldFlat').always + uniqueParam(def, 'shieldFlat', 0),
    );
    expect(set.always.weatherResistBp).toBe(
      expectReduction(
        affixTotals(unit, 'defWeatherResistPct').always + uniqueParam(def, 'weatherResistPct', 0),
      ),
    );
    const dmgPct =
      affixTotals(unit, 'defDamagePct').always - uniqueParam(def, 'damagePenaltyPct', 0);
    expect(set.always.damageBp).toBe(AFFIX_BP_ONE + dmgPct * 100);
  });

  it('열 금고 — 과열 창이 짧아지고 내구도가 오른다(보스 전용)', () => {
    const { kind, ref } = uniqueSample('duq-thermal-vault');
    const def = uniqueDef('duq-thermal-vault');
    expect(kind).toBe(CATALOG_BOSS);
    const unit = defenseUnitFromRef(kind, ref);
    const set = defenseAffixSet(kind, ref);
    expect(set.always.overheatResistBp).toBe(
      expectReduction(
        affixTotals(unit, 'defOverheatResistPct').always + uniqueParam(def, 'overheatResistPct', 0),
      ),
    );
    const hpPct = affixTotals(unit, 'defHpPct').always + uniqueParam(def, 'hpBonusPct', 0);
    expect(set.always.hpBp).toBe(AFFIX_BP_ONE + hpPct * 100);
  });

  it('선봉 조류 — 진입이 빨라지고 피해가 오르며 내구도가 준다(편대 전용)', () => {
    const { kind, ref } = uniqueSample('duq-vanguard-tide');
    const def = uniqueDef('duq-vanguard-tide');
    expect(kind).toBe(CATALOG_FORMATION);
    const unit = defenseUnitFromRef(kind, ref);
    const set = defenseAffixSet(kind, ref);
    expect(set.always.entryHasteBp).toBe(
      expectReduction(
        affixTotals(unit, 'defEntryHastePct').always + uniqueParam(def, 'entryHastePct', 0),
      ),
    );
    const hpPct = affixTotals(unit, 'defHpPct').always - uniqueParam(def, 'hpPenaltyPct', 0);
    expect(set.always.hpBp).toBe(AFFIX_BP_ONE + hpPct * 100);
    const dmgPct = affixTotals(unit, 'defDamagePct').always + uniqueParam(def, 'damageBonusPct', 0);
    expect(set.always.damageBp).toBe(AFFIX_BP_ONE + dmgPct * 100);
  });

  it('모든 보정 결과가 정수다(f64 유입 0)', () => {
    const states: DefenseTriggerState[] = [
      baseTrigger(),
      { ...baseTrigger(), elapsedTicks: 3777, alliesDestroyed: 5, coreHpPct: 17 },
      { ...baseTrigger(), playerX: 33.7, playerY: -12.25, coreHpPct: 0 },
    ];
    for (const u of DEFENSE_UNIQUES) {
      const { kind, ref } = uniqueSample(u.id);
      const set = defenseAffixSet(kind, ref);
      for (const st of states) {
        const m = resolveDefenseMods(set, st, 12.5, -7.5);
        for (const v of Object.values(m)) expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  it('같은 입력 → 같은 보정(캐시 우회 2회 호출 바이트 동일)', () => {
    const st = { ...baseTrigger(), elapsedTicks: 900, alliesDestroyed: 2, coreHpPct: 25 };
    for (const u of DEFENSE_UNIQUES) {
      const { kind, ref } = uniqueSample(u.id);
      const a = resolveDefenseMods(defenseAffixSet(kind, { ...ref }), st, 5, 5);
      const b = resolveDefenseMods(defenseAffixSet(kind, { ...ref }), st, 5, 5);
      expect(a).toEqual(b);
    }
  });
});

// ---------------------------------------------------------------------------
// ⑥ 정규 경로 통합 — createWorld → stepWorld
// ---------------------------------------------------------------------------

const IDLE: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };

function invasionConfig(layers: InvasionLayers): WorldConfig {
  const config = { ...DEFAULT_CONFIG } as WorldConfig;
  config.invasion3 = { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: MAINTENANCE_FULL };
  return config;
}

/** L1 웨이브 슬롯 0 에만 편대 1기를 세운 배치. */
function singleFormationLayers(ref: InvasionRef): InvasionLayers {
  return normalizeInvasionLayers({ l1: { waveSlots: [ref] } });
}

/**
 * 실제 런의 틱별 생존 적 수열. 빈 슬롯은 기본 수비대가 자동 충원하므로 "첫 적 등장 틱"은
 * 두 배치가 똑같이 0 이다 — 슬롯 0 의 차이를 보려면 수열을 통째로 비교해야 한다.
 */
function enemyCountSeq(seed: number, layers: InvasionLayers, ticks: number): number[] {
  const state = createWorld(seed, invasionConfig(layers));
  const out: number[] = [];
  for (let t = 0; t < ticks; t++) {
    stepWorld(state, IDLE);
    out.push(state.entities.filter((e) => e.kind === 'enemy' && !e.dead).length);
    if (state.gameOver || state.victory) break;
  }
  return out;
}

describe('유니크 방어체 — 정규 경로(createWorld→stepWorld) 통합', () => {
  it('선봉 조류 유니크를 배치하면 편대가 실제 런에서 더 빨리 등장한다', () => {
    // 모듈 직접 호출이 아니라 실제 스텝 루프에서 관측한다 — 배선이 통째로 빠지면 두 값이 같다.
    const { ref } = uniqueSample('duq-vanguard-tide');
    const control: InvasionRef = { ...ref, rarity: 0 };
    const uniqueSeq = enemyCountSeq(1, singleFormationLayers(ref), 2400);
    const controlSeq = enemyCountSeq(1, singleFormationLayers(control), 2400);
    // 배선이 통째로 빠지면 두 수열이 완전히 같다.
    expect(uniqueSeq).not.toEqual(controlSeq);
    const n = Math.min(uniqueSeq.length, controlSeq.length);
    let firstDiff = -1;
    for (let t = 0; t < n; t++) {
      if (uniqueSeq[t] !== controlSeq[t]) {
        firstDiff = t;
        break;
      }
    }
    expect(firstDiff).toBeGreaterThanOrEqual(0);
    // 첫 갈림은 "유니크 쪽이 먼저 밀려 들어왔다"여야 한다(진입 가속의 방향).
    expect(uniqueSeq[firstDiff]).toBeGreaterThan(controlSeq[firstDiff]!);
  });

  it('유니크 배치 런을 두 번 돌리면 해시 스트림이 바이트 동일하다', () => {
    const { ref } = uniqueSample('duq-vanguard-tide');
    const layers = singleFormationLayers(ref);
    const run = (): number[] => {
      const state = createWorld(9, invasionConfig(layers));
      const out: number[] = [];
      for (let t = 0; t < 1200; t++) {
        stepWorld(state, IDLE);
        out.push(hashWorld(state));
        if (state.gameOver || state.victory) break;
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('네 종류 유니크를 전부 실은 배치가 세 레이어를 통과하고 재실행이 바이트 동일하다', () => {
    const uniqueRef = (): InvasionRef => ({
      catalogId: 0,
      level: 1,
      ascension: 0,
      affixSeed: 20260722,
      rarity: UNIQUE_CODE,
    });
    const layers = normalizeInvasionLayers({
      l1: { waveSlots: [uniqueRef(), null, null, null, null, null] },
      l2: { templateId: 0, sockets: [uniqueRef(), uniqueRef()] },
      l3: { boss: uniqueRef(), props: [uniqueRef()] },
    });
    // 네 종류 전부가 sim 해석에서 유니크로 펼쳐진다(펼침이 없으면 아래 런은 노말과 같다).
    for (const kind of DEFENSE_UNIT_KINDS) {
      expect(defenseAffixSet(kind, uniqueRef()).unique ?? null).not.toBeNull();
    }
    const play = (): { hashes: number[]; phases: Set<number> } => {
      const state = createWorld(7, invasionConfig(layers));
      const hashes: number[] = [];
      const phases = new Set<number>();
      for (let t = 0; t < INVASION_TOTAL_TICKS; t++) {
        stepWorld(state, autopilotInput(state));
        hashes.push(hashWorld(state));
        const p = state.invasion3?.phase;
        if (p !== undefined) phases.add(p);
        if (state.gameOver || state.victory) break;
      }
      return { hashes, phases };
    };
    const a = play();
    const b = play();
    expect(a.hashes).toEqual(b.hashes);
    expect(a.phases.has(PHASE_L1)).toBe(true);
    expect(a.phases.has(PHASE_L2)).toBe(true);
    expect(a.phases.has(PHASE_L3)).toBe(true);
  });

  it('유니크 미장착(노말) 배치는 유니크 해석 경로에 아예 닿지 않는다', () => {
    // 회귀 가드: M7b 시점 런과 산술이 한 톨도 달라지지 않는다는 것의 구조적 근거.
    const normalRef: InvasionRef = { catalogId: 0, level: 1, ascension: 0, affixSeed: 5, rarity: 0 };
    for (const kind of DEFENSE_UNIT_KINDS) {
      const set = defenseAffixSet(kind, { ...normalRef });
      expect(set.unique ?? null).toBeNull();
      expect(set.neutral).toBe(true);
    }
    const layers = singleFormationLayers(normalRef);
    const run = (): number[] => {
      const state = createWorld(3, invasionConfig(layers));
      const out: number[] = [];
      for (let t = 0; t < 600; t++) {
        stepWorld(state, IDLE);
        out.push(hashWorld(state));
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});
