/**
 * 표준 빌드(표준 장비 세트 + 표준 투자) 계약 테스트 — ADR-0035 2026-07-27 개정 · L1.
 *
 * 이 테스트가 지키는 것은 **측정 인프라의 신뢰성**이다. 표준 세트가 결정론이 아니거나
 * 착용 불가 장비를 섞으면, 그 위에서 잰 절대 난이도 곡선(ADR-0037 Lane D 입력) 전체가 무효다.
 */

import { describe, it, expect } from 'vitest';
import {
  BAND_LEVELS,
  standardGearSet,
  standardGearEntries,
  standardGearSetForBand,
  standardEquipped,
  standardGearTable,
  standardBand,
  standardStage,
  gearDropStage,
  bandGearDesign,
  standardSkillBudget,
  standardPerTree,
  standardSkillInvest,
  standardAffixCount,
  gearInflowSummary,
  STANDARD_BAND_COUNT,
  STANDARD_BAND_RUNS,
  LEVEL_PER_STAGE,
} from '../src/bench/standardBuild.js';
import { readFileSync } from 'node:fs';
import { MAX_STANDARD_STAGE, STANDARD_PROGRESSION_PATH } from '../src/save/progressionPath.js';
import { UNIQUE_REGISTRY } from '../src/items/uniques.js';
// side-effect: 유니크 15종을 레지스트리에 등록(저작 종수 대조에 필요).
import '../data/uniques.js';
import { canEquip, requiredLevel } from '../src/items/requiredLevel.js';
import { EQUIP_SLOTS } from '../src/items/types.js';
import type { Rarity } from '../src/items/types.js';
import { SHIP_TYPES, shipTypeDef, shipTreeRange } from '../data/ships/index.js';

/** 테스트용 고정 시드(난수 금지 — 벤치 시드 목록 앞부분과 동일 계열의 소수). */
const SEEDS = [1, 5, 11, 17, 23, 191, 631] as const;

/** 등급 서열 점수(단조성 판정용). */
const RARITY_SCORE: Record<Rarity, number> = { normal: 0, magic: 1, rare: 2, unique: 3 };

describe('표준 레벨 ↔ 단계 대응', () => {
  it('표준 단계 = ceil(Lv/5), 밴드 대표 레벨은 5의 배수다', () => {
    expect(standardStage(1)).toBe(1);
    expect(standardStage(5)).toBe(1);
    expect(standardStage(6)).toBe(2);
    expect(standardStage(100)).toBe(20);
    expect(BAND_LEVELS).toHaveLength(STANDARD_BAND_COUNT);
    for (let s = 1; s <= STANDARD_BAND_COUNT; s++) {
      expect(BAND_LEVELS[s - 1]).toBe(s * LEVEL_PER_STAGE);
      expect(standardBand(s * LEVEL_PER_STAGE)).toBe(s);
    }
  });

  it('드랍처 단계 상한(5 × stage)은 레벨을 절대 넘지 않는다 — 자기검증의 구조적 근거', () => {
    for (let lv = LEVEL_PER_STAGE; lv <= 100; lv++) {
      expect(LEVEL_PER_STAGE * gearDropStage(lv)).toBeLessThanOrEqual(lv);
    }
  });

  it('단계1 드랍은 등급 무관 요구 레벨 1 이고 표준 레벨 Lv5 에서 전량 착용 가능하다', () => {
    // 드랍처 상한이 **밴드 시작** 레벨이므로(ADR-0030 개정 2, 2026-07-27)
    // stageLevelCap({stage:1}) = 5×(1-1)+1 = 1 이다. 단계1 드랍은 등급·어픽스와 무관하게
    // 전부 requiredLevel = 1 로 수렴한다 — 즉 **Lv1 부터** 입는다(구식은 5 였고 Lv1~4 가
    // 전량 착용 불가라 온보딩이 무너졌다). 밴드 1 표준 레벨 Lv5 에서는 당연히 전량 착용 가능.
    const bandStart = LEVEL_PER_STAGE * (1 - 1) + 1;
    for (const seed of SEEDS) {
      for (const item of standardGearSet(LEVEL_PER_STAGE, seed)) {
        expect(requiredLevel(item), `${item.slot}/${item.rarity}`).toBe(bandStart);
        expect(canEquip(LEVEL_PER_STAGE, item)).toBe(true);
        // 밴드에 들어서는 순간부터 입는다 — 이 개정의 핵심 불변식.
        expect(canEquip(bandStart, item)).toBe(true);
      }
    }
    expect(bandGearDesign(1).fill).toBe(EQUIP_SLOTS.length);
    expect(standardGearSet(LEVEL_PER_STAGE, 1)).toHaveLength(EQUIP_SLOTS.length);
  });

  it('Lv5 미만만 빈 세트다 — 요구 레벨 5 에 못 미치는 유일한 구간', () => {
    for (const lv of [1, 2, 3, 4]) expect(standardGearSet(lv, 1)).toHaveLength(0);
    expect(standardGearSet(LEVEL_PER_STAGE, 1).length).toBeGreaterThan(0);
  });

  it('"Lv 5s 이전엔 못 입는다"는 저단계 전용이다 — 상한이 등급 산식을 넘으면 밴드 중간에 열린다', () => {
    // 일반화 금지 근거. 단계 3 의 상한은 밴드 시작 11(= 5×2+1)이라 매직 2어픽스 산식
    // 10 + 2×2 = 14 가 11 로 눌린다 — 밴드 3 의 끝(Lv15)을 기다리지 않는다.
    const magicAtStage3 = requiredLevel({
      id: 'probe',
      slot: 'core',
      rarity: 'magic',
      source: { planet: 0, stage: 3 },
      affixes: [
        { id: 'sharp', stat: 'damagePct', value: 1 },
        { id: 'of-vitality', stat: 'maxHpFlat', value: 1 },
      ],
    });
    expect(magicAtStage3).toBe(11);
    // 불변식은 그대로다 — 밴드 3 의 **끝**(Lv15)보다 먼저 열린다.
    expect(magicAtStage3).toBeLessThan(LEVEL_PER_STAGE * 3);
  });

  it('노말 등급은 설계표 전체에서 0 이다 — PvE 드랍의 등급 바닥은 매직이다', () => {
    for (const d of standardGearTable()) expect(d.normal).toBe(0);
  });

  it('밴드 대표 레벨에서는 표준 단계 == 드랍처 단계다', () => {
    for (const lv of BAND_LEVELS) expect(gearDropStage(lv)).toBe(standardStage(lv));
  });
});

describe('표준 장비 세트 — 결정론', () => {
  it('같은 (level, seed) 는 항상 바이트 동일한 세트를 낸다', () => {
    for (const lv of BAND_LEVELS) {
      for (const seed of SEEDS) {
        const a = standardGearSet(lv, seed);
        const b = standardGearSet(lv, seed);
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      }
    }
  });

  it('시드가 다르면 세트도 달라진다(시드가 실제로 먹는다)', () => {
    const a = JSON.stringify(standardGearSet(100, 1));
    const b = JSON.stringify(standardGearSet(100, 5));
    expect(b).not.toBe(a);
  });

  it('레벨이 다르면 세트도 달라진다', () => {
    const a = JSON.stringify(standardGearSet(50, 1));
    const b = JSON.stringify(standardGearSet(100, 1));
    expect(b).not.toBe(a);
  });

  it('시드가 달라도 등급 구성은 설계값 그대로다(운은 어픽스 값에만 실린다)', () => {
    const shape = (lv: number, seed: number): string =>
      standardGearSet(lv, seed)
        .map((i) => i.rarity)
        .join(',');
    for (const lv of BAND_LEVELS) {
      const ref = shape(lv, SEEDS[0] ?? 1);
      for (const seed of SEEDS) expect(shape(lv, seed)).toBe(ref);
    }
  });
});

describe('표준 장비 세트 — 자기검증(canEquip)', () => {
  it('밴드 대표 레벨 전 20개 × 시드 7개에서 전 슬롯이 착용 가능하다', () => {
    for (const lv of BAND_LEVELS) {
      for (const seed of SEEDS) {
        for (const item of standardGearSet(lv, seed)) {
          expect(
            canEquip(lv, item),
            `Lv${lv} seed${seed} ${item.slot}/${item.rarity}: 요구 ${requiredLevel(item)}`,
          ).toBe(true);
        }
      }
    }
  });

  it('밴드 대표가 아닌 레벨에서도 전 슬롯이 착용 가능하다', () => {
    for (const lv of [1, 2, 3, 4, 7, 11, 23, 37, 63, 78, 99]) {
      for (const seed of SEEDS) {
        for (const item of standardGearSet(lv, seed)) {
          expect(canEquip(lv, item), `Lv${lv} seed${seed} 요구 ${requiredLevel(item)}`).toBe(true);
        }
      }
    }
  });
});

describe('표준 장비 세트 — 설계표 준수', () => {
  it('설계표의 등급 합은 항상 채움 수와 같다', () => {
    for (const d of standardGearTable()) {
      expect(d.normal + d.magic + d.rare + d.unique).toBe(d.fill);
      expect(d.fill).toBeLessThanOrEqual(EQUIP_SLOTS.length);
    }
  });

  it('조립 결과의 채움 수·등급 분포·어픽스 개수가 설계값과 일치한다', () => {
    for (const lv of BAND_LEVELS) {
      const d = bandGearDesign(standardBand(lv));
      for (const seed of SEEDS) {
        const items = standardGearSet(lv, seed);
        expect(items).toHaveLength(d.fill);
        const byRarity: Record<Rarity, number> = { normal: 0, magic: 0, rare: 0, unique: 0 };
        for (const it of items) byRarity[it.rarity]++;
        expect(byRarity).toEqual({
          normal: d.normal,
          magic: d.magic,
          rare: d.rare,
          unique: d.unique,
        });
        // 어픽스 개수는 **등급이 정한다** — 밴드가 올려 주는 축이 아니다(사용자 결정 2).
        for (const it of items) {
          expect(it.affixes.length, `Lv${lv} ${it.rarity}`).toBe(standardAffixCount(it.rarity));
        }
      }
    }
  });

  it('EQUIP_SLOTS 순서 계약을 지킨다 — 앞칸부터 채우고 module 2칸은 kind=module', () => {
    for (const lv of BAND_LEVELS) {
      const entries = standardGearEntries(lv, 11);
      const slots = entries.map((e) => e.slot);
      expect(slots).toEqual(EQUIP_SLOTS.slice(0, entries.length));
      for (const e of entries) {
        const wantKind = e.slot === 'module0' || e.slot === 'module1' ? 'module' : e.slot;
        expect(e.item.slot).toBe(wantKind);
      }
    }
  });

  it('standardEquipped 는 같은 아이템을 칸 id 로 색인한 형태다', () => {
    const entries = standardGearEntries(100, 23);
    const rec = standardEquipped(100, 23);
    expect(Object.keys(rec)).toHaveLength(entries.length);
    for (const e of entries) expect(rec[e.slot]).toEqual(e.item);
  });

  it('main 슬롯 유니크는 주무기 타입과 페어링된다(요구 레벨 파생이 throw 하지 않는다)', () => {
    for (const lv of BAND_LEVELS) {
      for (const seed of SEEDS) {
        for (const it of standardGearSet(lv, seed)) {
          if (it.rarity !== 'unique') continue;
          expect(it.uniqueId).toBeDefined();
          expect(() => requiredLevel(it)).not.toThrow();
        }
      }
    }
  });
});

/**
 * ⚠️ 기대는 **"밴드마다 오른다"가 아니라 "밴드마다 약해지지 않는다"(비감소)** 다.
 *
 * 사용자 결정 1(2026-07-27): 표준 세트 기준을 ADR-0035 개정의 완만한 램프에서 **실제 파밍 산출
 * 근사**로 바꿨다. 실제 파밍은 보스 드랍이 **항상 레어 이상**이라 밴드 2 에서 8칸이 곧바로
 * 차고 이후 거의 평평하다 — **그 평평함이 의도된 설계다.** 여기서 엄격 증가를 기대하면
 * 존재하지 않는 램프를 되살리라는 압력이 되므로, 비감소만 계약으로 못박는다.
 */
describe('표준 장비 세트 — 밴드 비감소(평평함은 의도다)', () => {
  it('채움 수 · 등급 총점 · 어픽스 총합이 밴드가 오를수록 줄지 않는다', () => {
    let prevFill = -1;
    let prevScore = -1;
    let prevAffix = -1;
    for (const lv of BAND_LEVELS) {
      const items = standardGearSet(lv, 1);
      const fill = items.length;
      let score = 0;
      let affix = 0;
      for (const it of items) {
        score += RARITY_SCORE[it.rarity];
        affix += it.affixes.length;
      }
      expect(fill, `Lv${lv} 채움 수 역행`).toBeGreaterThanOrEqual(prevFill);
      expect(score, `Lv${lv} 등급 총점 역행`).toBeGreaterThanOrEqual(prevScore);
      expect(affix, `Lv${lv} 어픽스 총합 역행`).toBeGreaterThanOrEqual(prevAffix);
      prevFill = fill;
      prevScore = score;
      prevAffix = affix;
    }
  });

  it('전 밴드가 8칸으로 평평하다 — 채움 축은 밴드 1 에서 이미 끝나 있다', () => {
    // 2차 정정 결과: 밴드 1 부터 8칸이다. 0칸 → 8칸 절벽은 존재하지 않는다(적 곡선으로 못 메울
    // 불연속이었으므로 이게 설계적으로도 옳다).
    for (const lv of BAND_LEVELS) {
      expect(standardGearSet(lv, 1), `Lv${lv}`).toHaveLength(EQUIP_SLOTS.length);
    }
  });

  it('어픽스 총합은 밴드 2 부터 상한(8칸 × 6)에서 평평하다', () => {
    for (const lv of BAND_LEVELS) {
      if (lv <= LEVEL_PER_STAGE) continue;
      const total = standardGearSet(lv, 1).reduce((a, it) => a + it.affixes.length, 0);
      expect(total, `Lv${lv}`).toBe(EQUIP_SLOTS.length * standardAffixCount('rare'));
    }
  });

  it('유니크 칸은 밴드가 오를수록 줄지 않고 설계표와 일치한다', () => {
    // ⚠️ 리터럴 기대를 두지 않는다 — 유니크 칸 수는 `DEFAULT_DROP_ODDS` 와 품질 곡선에서
    // 파생되므로 드랍률이 조정될 때마다 값이 바뀐다(2026-07-27 에 elite 0.03→0.004 ·
    // boss 0.15→0.02 로 한 번 바뀌었다). 계약은 **불변식**으로만 표현한다.
    const uniques = BAND_LEVELS.map(
      (lv) => standardGearSet(lv, 1).filter((it) => it.rarity === 'unique').length,
    );
    for (let i = 0; i < uniques.length; i++) {
      // 조립 결과가 설계표와 어긋나지 않는다(리터럴이 아니라 파생 대조).
      expect(uniques[i], `밴드 ${i + 1}`).toBe(bandGearDesign(i + 1).unique);
      if (i > 0) {
        expect(uniques[i], `밴드 ${i + 1} 유니크 역행`).toBeGreaterThanOrEqual(uniques[i - 1] ?? 0);
      }
    }
    // 첫 밴드는 유니크 없이 시작한다(유효 유니크가 아직 1칸에 못 미치는 구간).
    expect(uniques[0]).toBe(0);
  });

  it('⚠️ 유니크가 8칸을 포화시키지 않는다 — 드랍률 과잉 회귀 감시', () => {
    // 이 단언이 원래 잡아낸 결함: 구 드랍률(elite 0.03 · boss 0.15)에서는 만렙 표준 빌드가
    // **8칸 전부 유니크**였고 측정이 유니크 효과에 지배당했다. 상한 기대를 통째로 없애면
    // 드랍률이 다시 올라가도 아무도 모르므로, 리터럴 대신 **포화 금지**를 계약으로 남긴다.
    for (const [i, d] of standardGearTable().entries()) {
      expect(d.unique, `밴드 ${i + 1} 유니크 포화(레어가 한 칸도 안 남는다)`).toBeLessThan(
        EQUIP_SLOTS.length,
      );
    }
  });

  it('⚠️ career 기대 유니크가 저작 종수를 크게 넘지 않는다 — 경제 ↔ 콘텐츠 정합', () => {
    // 드랍 경제(`src/sim/drops.ts`)와 저작 콘텐츠(`data/uniques.ts`)의 교차 불변식이다.
    // 구 드랍률에서는 career 83.5개 vs 저작 15종 = **5.6배**(같은 유니크를 대여섯 벌씩 먹는다).
    const { uniques, runs, items } = gearInflowSummary();
    expect(runs).toBeGreaterThan(0);
    expect(items).toBeGreaterThan(0);
    const authored = UNIQUE_REGISTRY.size;
    expect(authored).toBeGreaterThan(0);
    // 상한 3배 — "전 종류를 한 번씩 보고 여유분이 조금" 까지는 허용하고 대여섯 벌은 막는다.
    expect(
      uniques / authored,
      `career 기대 유니크 ${uniques.toFixed(1)}개 / 저작 ${authored}종 = ${(uniques / authored).toFixed(2)}배 — 드랍률 과잉`,
    ).toBeLessThanOrEqual(3);
  });

  it('유니크는 같은 id 를 두 칸에 꽂지 않는다 — uniqueMask OR 이라 사본은 칸 낭비다', () => {
    for (const lv of BAND_LEVELS) {
      for (const seed of SEEDS) {
        const ids = standardGearSet(lv, seed)
          .map((it) => it.uniqueId)
          .filter((v): v is string => v !== undefined);
        expect(new Set(ids).size, `Lv${lv} seed${seed} 유니크 중복`).toBe(ids.length);
      }
    }
  });
});

describe('감도 분석용 밴드 오버라이드', () => {
  it('자기 밴드를 주면 정규 경로와 동일하다', () => {
    for (const lv of BAND_LEVELS) {
      const a = standardGearEntries(lv, 17);
      const b = standardGearSetForBand(lv, 17, standardBand(lv)).entries;
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });

  // "밴드 1 무장비" 가정이 곡선을 얼마나 움직이는지 상한을 재는 경로다(Lane D 감도 분석).
  it('Lv5 에 만렙 설계를 얹어도 전 슬롯이 착용 가능하다(단계1 드랍은 요구 레벨 1 로 수렴)', () => {
    const { entries } = standardGearSetForBand(5, 23, STANDARD_BAND_COUNT);
    expect(entries).toHaveLength(EQUIP_SLOTS.length);
    // 드랍처 단계는 gearDropStage(5) = 1 이고, 그 상한이 밴드 시작 = 1 이다(ADR-0030 개정 2).
    const stage1Cap = LEVEL_PER_STAGE * (1 - 1) + 1;
    for (const e of entries) {
      expect(canEquip(5, e.item)).toBe(true);
      expect(requiredLevel(e.item)).toBe(stage1Cap);
    }
  });
});

describe('표준 투자', () => {
  it('예산 = 레벨 - 1 (레벨업 1회당 1점), 캡 99', () => {
    expect(standardSkillBudget(1)).toBe(0);
    expect(standardSkillBudget(2)).toBe(1);
    expect(standardSkillBudget(50)).toBe(49);
    expect(standardSkillBudget(100)).toBe(99);
    expect(standardSkillBudget(120)).toBe(99);
  });

  it('배분 총합은 항상 예산과 같고, 만렙은 P2(45/27/27)와 정확히 일치한다', () => {
    for (let lv = 1; lv <= 100; lv++) {
      const t = standardPerTree(lv);
      expect(t[0] + t[1] + t[2]).toBe(standardSkillBudget(lv));
      expect(t.every((v) => v >= 0)).toBe(true);
    }
    expect(standardPerTree(100)).toEqual([45, 27, 27]);
  });

  it('공격 계열 비중이 가장 크다(공격 우선 배분)', () => {
    for (let lv = 5; lv <= 100; lv++) {
      const t = standardPerTree(lv);
      expect(t[0]).toBeGreaterThanOrEqual(t[1]);
      expect(t[0]).toBeGreaterThanOrEqual(t[2]);
    }
  });

  it('전 기체에서 벡터 길이·트리별 합이 배분과 일치하고 만렙은 공격 축만 상위 액티브 게이트를 넘는다', () => {
    for (let typeId = 0; typeId < SHIP_TYPES.length; typeId++) {
      const def = shipTypeDef(typeId);
      const v = standardSkillInvest(typeId, 100);
      const perTree = standardPerTree(100);
      for (let t = 0; t < def.trees.length; t++) {
        const { start, end } = shipTreeRange(def, t);
        let sum = 0;
        for (let i = start; i < end; i++) sum += v[i] ?? 0;
        // 트리 용량이 배분보다 작으면 잘린다 — 잘리면 측정이 설계와 어긋나므로 계약으로 못박는다.
        expect(sum, `${def.slug} 트리${t}`).toBe(perTree[t]);
      }
      // 공격 45pt 는 activeHiGate(ADR-0049: 전 기체 40 균일, 구 이름 capstoneGate)를 넘기고
      // 방어·유틸(27pt 씩)은 못 넘는다 — ADR-0049 는 캡스톤을 폐기했으므로 여기서 지키는 것은
      // "축 하나만 상위 액티브를 해금한다"는 배분 성격이지, 더 이상 캡스톤 칸의 값이 아니다.
      expect(perTree[0], `${def.slug} 공격 배분`).toBeGreaterThanOrEqual(def.activeHiGate);
      expect(perTree[1], `${def.slug} 방어 배분`).toBeLessThan(def.activeHiGate);
      expect(perTree[2], `${def.slug} 유틸 배분`).toBeLessThan(def.activeHiGate);
    }
  });

  it('결정론 — 같은 (typeId, level) 은 항상 같은 벡터', () => {
    for (const lv of BAND_LEVELS) {
      expect(standardSkillInvest(3, lv)).toEqual(standardSkillInvest(3, lv));
    }
  });
});

// ---------------------------------------------------------------------------
// 순환 결합 차단 — 측정 기준자(STANDARD_BAND_RUNS)와 튜닝 대상(경제 상수)의 드리프트 가드
// ---------------------------------------------------------------------------

/**
 * 표준 장비표는 **밴드당 런 수**에서 유도되는데, 그 런 수는 예전에
 * `STANDARD_PROGRESSION_PATH[].runs` 를 **런타임으로** 읽었다. 그래서 경제 상수를 고치면
 * 측정 기준자가 조용히 함께 움직였다 — 2026-07-27 재보정에서 실제로 터져서, 상수 갱신만으로
 * 밴드1 장비가 `M2/R6` → `R8` 이 되고 단계1 클리어율이 **58.3% → 68.8%** 로 뛰었다.
 * 지금은 {@link STANDARD_BAND_RUNS} 로 **고정**했고, 이 가드가 "고정값이 낡았는지"를 잡는다.
 *
 * 이 리포에서 같은 형태의 사고가 반복됐다(밴드표 교체 · killGoal · gearSeed 규약 · 이번 결합).
 * 넷 다 단위 테스트는 전부 초록이었다. 그래서 **구조로** 막는다.
 */
describe('측정 기준자 드리프트 가드 (표준 런 수 ↔ 경제 상수)', () => {
  it('밴드 수가 맞다', () => {
    expect(STANDARD_BAND_RUNS).toHaveLength(MAX_STANDARD_STAGE);
    expect(STANDARD_PROGRESSION_PATH).toHaveLength(MAX_STANDARD_STAGE);
  });

  it('고정 런 수가 현행 경제 상수와 ±15% 안에서 일치한다', () => {
    for (let i = 0; i < MAX_STANDARD_STAGE; i++) {
      const frozen = STANDARD_BAND_RUNS[i]!;
      const derived = STANDARD_PROGRESSION_PATH[i]!.runs;
      const ratio = frozen / derived;
      expect(
        ratio,
        `밴드 ${i + 1}: 고정 ${frozen.toFixed(2)}런 vs 경제 상수 파생 ${derived.toFixed(2)}런 (비 ${ratio.toFixed(3)}). ` +
          'src/save/progressionPath.ts 의 경제 상수를 바꿨다면 표준 장비표가 낡은 것이다 — ' +
          '밴드 1~20 곡선을 96시드로 재측정한 뒤 src/bench/standardBuild.ts 의 ' +
          'STANDARD_BAND_RUNS 를 새 값으로 갱신하고 그 주석의 출처도 함께 고쳐라 ' +
          '(절차: .omc/research/economy-recalibrated-2026-07-27.md §재현).',
      ).toBeGreaterThan(0.85);
      expect(ratio).toBeLessThan(1.15);
    }
  });

  it('장비표가 고정 런 수에서만 유도된다 — 경제 상수는 표를 움직이지 못한다', () => {
    // 회귀 방어: 누가 다시 STANDARD_PROGRESSION_PATH 를 읽도록 되돌리면, 이 단언은 통과하지만
    // 위 ±15% 가드가 언젠가 조용히 넓어질 수 있다. 그래서 소스에 import 가 없음을 직접 본다.
    // 저장소 규약: `tests/node-shims.d.ts` 의 readFileSync 는 인코딩 인자가 없다(다른 테스트들과 동일 형태).
    const url = new URL('../src/bench/standardBuild.ts', import.meta.url);
    const src = new TextDecoder().decode(
      readFileSync(url.pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    );
    // 주석이 아니라 **import 문 자체**만 본다(주석에는 결합 금지 근거로 이름이 등장한다).
    const importStmts = src.match(/^import\s[\s\S]*?from\s+'[^']+';$/gm) ?? [];
    expect(importStmts.length, 'import 문을 하나도 못 찾았다 — 정규식이 낡았다').toBeGreaterThan(0);
    const offenders = importStmts.filter((s) => s.includes('STANDARD_PROGRESSION_PATH'));
    expect(
      offenders,
      'standardBuild.ts 가 STANDARD_PROGRESSION_PATH 를 다시 import 한다 — 순환 결합이 되살아났다. ' +
        '밴드 런 수는 STANDARD_BAND_RUNS 고정 상수에서만 와야 한다.',
    ).toEqual([]);
  });
});
