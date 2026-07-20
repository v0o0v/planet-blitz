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
