/**
 * 장비 요구 레벨 게이트(ADR-0030) 회귀 스위트 — Lane E.
 *
 * 이 저장소에서 8번 재발한 결함은 "단위 테스트는 전부 그린인데 배선이 통째로 없다" 이다.
 * 순수 산식 검증만으로는 그 유형을 못 잡는다. 그래서 이 파일은 세 층으로 방어한다.
 *  ① 순수 모듈 테스트(requiredLevel/canEquip) — 산식·경계·리롤 불변·유니크 loud-fail.
 *  ② grep 게이트 — 프로덕션 장착 UI(`src/ui/pixi/hangar.ts`)의 소스를 fs 로 읽어
 *     equip 진입부가 실제로 `canEquip` 을 부르고, 인벤토리 그리드가 잠김 셀의 onClick 을
 *     끊는지 정규식으로 정적 단언한다(`tests/shipIntegration.test.ts` 의 §10-2 양식 미러).
 *  ③ 프로덕션 경로 통합 — 하네스 `'gearLocked'` 프리셋(앱이 쓰는 바로 그 프리셋 빌더)으로
 *     Profile 을 만들어, 저레벨 기체가 고 reqLevel 장비를 실제로 못 착용하는지 관측한다.
 *
 * ⚠️ 유니크의 reqLevel 은 `UNIQUE_REGISTRY` 가 채워져 있어야 조회된다 — 그러지 않으면
 *    `requiredLevel` 이 LOUD-FAIL(throw) 한다. 아래 side-effect import 로 15종을 등록한다.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import '../data/uniques.js'; // side-effect: UNIQUE_REGISTRY 에 유니크 15종 등록

import { requiredLevel, canEquip, stageLevelCap } from '../src/items/requiredLevel.js';
import { LEVEL_PER_STAGE, MAX_STANDARD_STAGE } from '../src/save/progressionPath.js';
import { LEVEL_CAP } from '../data/waves.js';
import { rollItem, rerollAffixes, reforgeAffixes } from '../src/items/roll.js';
import { AFFIX_BY_ID } from '../data/affixes.js';
import { UNIQUE_REGISTRY, registerUnique } from '../src/items/uniques.js';
import { M2_UNIQUES, M3_UNIQUES } from '../data/uniques.js';
import { buildPreset } from '../src/harness/presets.js';
import { activeShip, defaultProfile } from '../src/save/profile.js';
import { settleRun } from '../src/save/settlement.js';
import type { LootRecord } from '../src/sim/world.js';
import type { AffixRoll, Item, Rarity, SlotKind, StatKey } from '../src/items/types.js';

// ---------------------------------------------------------------------------
// 공통 헬퍼
// ---------------------------------------------------------------------------

/**
 * 등급 산식을 그대로 보게 하는 드랍처. 요구 레벨은 **드랍처 상한**(밴드 시작 레벨 =
 * `5×(단계-1)+1`, 만렙 클램프)으로 낮아지므로, 등급 산식 자체를 보려면 상한이 **안 무는**
 * 단계를 써야 한다. 2026-07-27 개정으로 상한 기준이 밴드 끝 → 밴드 시작으로 내려가면서
 * 20단계 상한이 100 → 96 이 됐으므로, 무효 단계도 20 → **21**(상한 101 → 만렙 클램프 100)로
 * 함께 내린다. 상한이 무는 쪽은 아래 별도 describe 에서 본다.
 */
const SOURCE = { planet: 0, stage: 21 } as const;

/**
 * 어픽스 개수를 정확히 통제한 최소 Item 리터럴. reqLevel 산식은 `affixes.length` 와
 * `source.stage` 만 읽으므로(값·stat 무관) 둘만 맞추면 결정론으로 검증할 수 있다.
 */
function litItem(
  rarity: Rarity,
  affixCount: number,
  opts?: { slot?: SlotKind; uniqueId?: string; stage?: number },
): Item {
  const affixes: AffixRoll[] = Array.from({ length: affixCount }, (_, i) => ({
    id: `affix-${i}`,
    stat: 'damagePct' as StatKey,
    value: 1,
  }));
  const base: Item = {
    id: `lit-${rarity}-${affixCount}`,
    slot: opts?.slot ?? 'armor',
    rarity,
    affixes,
    source: opts?.stage !== undefined ? { planet: 0, stage: opts.stage } : SOURCE,
  };
  return opts?.uniqueId !== undefined ? { ...base, uniqueId: opts.uniqueId } : base;
}

/** 저장소 상대 경로의 소스를 읽는다(`tests/node-shims.d.ts` 의 readFileSync 는 인코딩 인자 없음). */
function readSrc(rel: string): string {
  const url = new URL(`../${rel}`, import.meta.url);
  return new TextDecoder().decode(readFileSync(url.pathname.replace(/^\/([A-Za-z]:)/, '$1')));
}

// ---------------------------------------------------------------------------
// AC1 — 순수·결정론: 등급별 산식
// ---------------------------------------------------------------------------

describe('AC1 requiredLevel 순수·결정론 (등급별 산식)', () => {
  it('normal 은 어픽스와 무관하게 항상 1 (floor 1, per 0)', () => {
    expect(requiredLevel(litItem('normal', 0))).toBe(1);
    expect(requiredLevel(litItem('normal', 3))).toBe(1);
  });

  it('magic 은 10 + 2·어픽스 (floor 10, per 2)', () => {
    expect(requiredLevel(litItem('magic', 1))).toBe(12);
    expect(requiredLevel(litItem('magic', 2))).toBe(14);
  });

  it('rare 는 32 + 3·어픽스 (floor 32, per 3)', () => {
    expect(requiredLevel(litItem('rare', 3))).toBe(41);
    expect(requiredLevel(litItem('rare', 5))).toBe(47);
    expect(requiredLevel(litItem('rare', 6))).toBe(50);
  });

  it('unique 는 UniqueDef.reqLevel 저작값을 그대로 낸다 (어픽스 무관)', () => {
    const def = M2_UNIQUES[0]; // overheat-drum, reqLevel 66
    expect(def).toBeDefined();
    expect(requiredLevel(litItem('unique', 4, { slot: def!.slot, uniqueId: def!.id }))).toBe(
      def!.reqLevel,
    );
    // 어픽스 개수를 바꿔도 유니크는 저작값 고정.
    expect(requiredLevel(litItem('unique', 6, { slot: def!.slot, uniqueId: def!.id }))).toBe(
      def!.reqLevel,
    );
  });

  it('같은 아이템은 항상 같은 값을 낸다 (결정론 — 반복 호출 불변)', () => {
    const item = litItem('rare', 5);
    const first = requiredLevel(item);
    for (let i = 0; i < 5; i++) expect(requiredLevel(item)).toBe(first);
    expect(first).toBe(47);
  });
});

// ---------------------------------------------------------------------------
// 드랍처 상한 — 그 단계를 도는 조종사가 영영 못 입는 전리품이 나오지 않는다
// (사용자 신고 2026-07-27: "기체 레벨보다 높은 아이템이 획득됨")
// ---------------------------------------------------------------------------

describe('드랍처(침략 단계) 상한', () => {
  it('상한 = 그 단계 밴드의 **시작** 레벨, [1,100] 클램프', () => {
    // 2026-07-27 개정: 밴드 끝(5×stage) → 밴드 시작(5×(stage-1)+1). 리터럴이 아니라
    // LEVEL_PER_STAGE 에서 파생해 못박는다 — 대응 축이 바뀌면 함께 움직여야 한다.
    for (let stage = 1; stage <= MAX_STANDARD_STAGE; stage++) {
      expect(stageLevelCap({ planet: 0, stage }), `stage ${stage}`).toBe(
        Math.min(LEVEL_PER_STAGE * (stage - 1) + 1, LEVEL_CAP),
      );
    }
    expect(stageLevelCap({ planet: 0, stage: 1 })).toBe(1);
    expect(stageLevelCap({ planet: 0, stage: 11 })).toBe(51);
    expect(stageLevelCap({ planet: 0, stage: 999 })).toBe(100); // 단계 축은 1..∞
  });

  it('불변식: 밴드에 **들어서는 순간** 그 단계 전리품을 입을 수 있다 (ADR-0030 개정 취지)', () => {
    // 상한을 둔 이유가 "그 단계를 도는 동안 입게 된다"이므로, 밴드 첫 레벨에서 이미 참이어야
    // 한다. 구식(밴드 끝 기준)은 이 단언을 단계1 에서 깼다 — Lv1~4 가 전량 착용 불가였다.
    for (let stage = 1; stage <= MAX_STANDARD_STAGE; stage++) {
      const bandFirstLevel = LEVEL_PER_STAGE * (stage - 1) + 1;
      for (const rarity of ['normal', 'magic', 'rare'] as const) {
        for (let a = 0; a <= 6; a++) {
          const item = litItem(rarity, a, { stage });
          expect(
            canEquip(bandFirstLevel, item),
            `stage ${stage} 밴드 첫 레벨 Lv${bandFirstLevel} / ${rarity}/${a}어픽스 (요구 ${requiredLevel(item)})`,
          ).toBe(true);
        }
      }
    }
  });

  it('출처 미상(source 없음·비유한 단계)은 상한을 걸지 않는다 — 구 거동 보존', () => {
    expect(stageLevelCap(undefined)).toBe(100);
    expect(stageLevelCap({ planet: 0, stage: Number.NaN })).toBe(100);
  });

  it('1단계 레어(등급 산식 41~50)는 상한 1 로 낮아진다 = 첫 런 드랍부터 바로 입는다', () => {
    expect(requiredLevel(litItem('rare', 3, { stage: 1 }))).toBe(1);
    expect(requiredLevel(litItem('rare', 6, { stage: 1 }))).toBe(1);
    // 등급 산식이 상한보다 낮으면 그대로다 — 노말은 어디서 나와도 1.
    expect(requiredLevel(litItem('normal', 0, { stage: 1 }))).toBe(1);
  });

  it('상한이 등급 산식을 넘어서면 등급 서열이 그대로 산다 (11단계 상한 51)', () => {
    expect(requiredLevel(litItem('magic', 2, { stage: 11 }))).toBe(14);
    expect(requiredLevel(litItem('rare', 3, { stage: 11 }))).toBe(41);
    expect(requiredLevel(litItem('rare', 6, { stage: 11 }))).toBe(50);
  });

  it('유니크 저작값도 드랍처 상한으로 낮아진다 (저작값이 상한 이하면 그대로)', () => {
    const high = M2_UNIQUES[0]; // overheat-drum, reqLevel 66
    expect(high?.reqLevel).toBe(66);
    // 6단계 상한 26(= 5×5+1) → 66 이 아니라 26.
    expect(requiredLevel(litItem('unique', 4, { slot: high!.slot, uniqueId: high!.id, stage: 6 }))).toBe(26);
    // 20단계 상한 96 → 저작값 66 은 그 아래라 그대로.
    expect(
      requiredLevel(litItem('unique', 4, { slot: high!.slot, uniqueId: high!.id, stage: 20 })),
    ).toBe(66);
  });

  it('불변식: 어떤 등급·어픽스 조합도 드랍 단계 상한을 넘지 않는다', () => {
    for (const stage of [1, 2, 5, 9, 13, 21, 40]) {
      const cap = stageLevelCap({ planet: 0, stage });
      for (const rarity of ['normal', 'magic', 'rare'] as const) {
        for (let a = 0; a <= 6; a++) {
          expect(requiredLevel(litItem(rarity, a, { stage })), `${rarity}/${a}/${stage}`).toBeLessThanOrEqual(cap);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 소유자 상한(드랍 당시 기체 레벨) — 사용자 지시 2026-08-05
// ---------------------------------------------------------------------------

describe('소유자 상한(ItemSource.levelCap) — "주운 즉시 입는다"', () => {
  /** `levelCap` 이 붙은 리터럴 아이템(단계 상한이 안 무는 무효 단계 21 로 고정). */
  function ownedItem(rarity: Exclude<Rarity, 'unique'>, affixCount: number, levelCap: number): Item {
    const base = litItem(rarity, affixCount, { stage: 21 });
    return { ...base, source: { ...base.source, levelCap } };
  }

  it('부재하면 구 거동 그대로다(상한 없음) — 기존 세이브·시작 지급 장비의 경로', () => {
    // 이 단언이 깨지면 마이그레이션 없이 필드를 추가한 것이 기존 아이템을 조용히 잠근 것이다.
    const rare6 = litItem('rare', 6, { stage: 21 });
    expect(rare6.source.levelCap).toBeUndefined();
    expect(requiredLevel(rare6)).toBe(32 + 6 * 3); // 등급 산식 그대로
  });

  it('핵심 계약: 어떤 등급·어픽스 조합도 **드랍 당시 기체 레벨을 넘지 않는다**', () => {
    for (const level of [1, 2, 5, 17, 50, 99, 100]) {
      for (const rarity of ['normal', 'magic', 'rare'] as const) {
        for (let a = 0; a <= 6; a++) {
          const it = ownedItem(rarity, a, level);
          expect(requiredLevel(it), `${rarity}/${a}/Lv${level}`).toBeLessThanOrEqual(level);
          // 곧 이것이 사용자가 본 결과다 — 주운 즉시 입는다.
          expect(canEquip(level, it), `${rarity}/${a}/Lv${level}`).toBe(true);
        }
      }
    }
  });

  it('두 상한 중 낮은 쪽이 이긴다(단계 상한이 더 낮으면 그쪽이 남는다)', () => {
    // 단계 1 의 드랍처 상한은 1 이다. 기체가 Lv50 이어도 요구 레벨은 1 이어야 한다 —
    // 소유자 상한이 하한처럼 작동해 요구 레벨을 **끌어올리면** 저단계 온보딩이 무너진다.
    const lowStage = litItem('rare', 6, { stage: 1 });
    const withOwner: Item = { ...lowStage, source: { ...lowStage.source, levelCap: 50 } };
    expect(stageLevelCap(withOwner.source)).toBe(1);
    expect(requiredLevel(withOwner)).toBe(1);
  });

  it('유효하지 않은 값은 상한을 걸지 않는다(손상 세이브를 과도하게 잠그지 않는다)', () => {
    const base = litItem('rare', 6, { stage: 21 });
    const expected = requiredLevel(base);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      const it: Item = { ...base, source: { ...base.source, levelCap: bad as unknown as number } };
      expect(requiredLevel(it)).toBe(expected);
    }
  });

  it('배선 실도달: `settleRun` 이 떨군 장비는 그 기체가 전부 입을 수 있다', () => {
    // ⚠️ 이 저장소의 지배적 실패 모드는 "순수 함수는 맞는데 호출부가 안 넘긴다"이다.
    //    산식이 아니라 **실제 정산 경로**로 확인한다.
    const profile = defaultProfile();
    const ship = activeShip(profile);
    ship.level = 3; // 저레벨 기체가 고단계를 도는, 가장 어긋나기 쉬운 상황.
    const loot: LootRecord[] = Array.from({ length: 24 }, (_, i) => ({
      seed: (0x1234_5678 + i * 0x9e37_79b9) >>> 0,
      rarity: i % 4, // normal·magic·rare·unique 전수
      planet: 2,
      stage: 12,
      elite: 1,
    }));
    const out = settleRun(profile, {
      victory: true,
      loot,
      xpTotal: 0,
      resources: 0,
      planet: 2,
      stage: 12,
    });
    expect(out.itemsGained.length).toBe(loot.length);
    for (const it of out.itemsGained) {
      expect(it.source.levelCap, `${it.id} 에 소유자 상한이 안 실렸다`).toBe(3);
      expect(canEquip(3, it), `${it.rarity} ${it.id} 를 Lv3 이 못 입는다`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// AC5 — 경계: normal=1, clamp[1,100], 반올림
// ---------------------------------------------------------------------------

describe('AC5 경계 (normal 하한 · clamp[1,100] · 반올림)', () => {
  const TMP_HIGH = '__test_clamp_high__';
  const TMP_LOW = '__test_clamp_low__';
  const TMP_ROUND = '__test_round__';

  afterAll(() => {
    // 임시 등록 유니크를 제거해 다른 스위트로 오염이 새지 않게 한다.
    UNIQUE_REGISTRY.delete(TMP_HIGH);
    UNIQUE_REGISTRY.delete(TMP_LOW);
    UNIQUE_REGISTRY.delete(TMP_ROUND);
  });

  it('normal 은 어픽스가 많아도 1 (하한이자 등급 고정값)', () => {
    expect(requiredLevel(litItem('normal', 8))).toBe(1);
  });

  it('rare 가 100 을 넘는 어픽스 수여도 상한 100 으로 clamp 된다', () => {
    // 32 + 3·23 = 101 → 100. 어픽스가 더 많아도 100 을 넘지 않는다.
    expect(requiredLevel(litItem('rare', 23))).toBe(100);
    expect(requiredLevel(litItem('rare', 40))).toBe(100);
  });

  it('유니크 저작값이 [1,100] 밖이면 clamp 되고, 소수는 반올림된다', () => {
    // 등록 15종은 전부 [1,100] 정수라 clamp/반올림이 no-op 이다. 그 동작 자체를 검증하려면
    // 범위 밖·소수 reqLevel 을 가진 임시 유니크를 등록해 clampInt 경로를 태워야 한다.
    registerUnique({ id: TMP_HIGH, name: '테스트-상한', slot: 'core', bit: 0, reqLevel: 250 });
    registerUnique({ id: TMP_LOW, name: '테스트-하한', slot: 'core', bit: 0, reqLevel: 0.2 });
    registerUnique({ id: TMP_ROUND, name: '테스트-반올림', slot: 'core', bit: 0, reqLevel: 49.6 });

    expect(requiredLevel(litItem('unique', 3, { slot: 'core', uniqueId: TMP_HIGH }))).toBe(100);
    expect(requiredLevel(litItem('unique', 3, { slot: 'core', uniqueId: TMP_LOW }))).toBe(1);
    expect(requiredLevel(litItem('unique', 3, { slot: 'core', uniqueId: TMP_ROUND }))).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// AC6 — 리롤 불변: rerollAffixes 는 어픽스 개수를 보존하므로 req 불변
// ---------------------------------------------------------------------------

describe('AC6 rerollAffixes 후 requiredLevel 불변 (어픽스 개수 보존)', () => {
  it('rare 아이템을 리롤해도 req 가 바뀌지 않는다', () => {
    const rare = rollItem(1234, 'rare', SOURCE);
    expect(rare.rarity).toBe('rare');
    const before = requiredLevel(rare);

    const rerolled = rerollAffixes(rare, 9999);
    expect(rerolled.affixes.length).toBe(rare.affixes.length);
    expect(requiredLevel(rerolled)).toBe(before);
  });

  it('lockedIndex 를 준 리롤도 개수 보존이라 req 불변', () => {
    const rare = rollItem(4321, 'rare', SOURCE);
    const before = requiredLevel(rare);
    const rerolled = rerollAffixes(rare, 5555, 0);
    expect(rerolled.affixes.length).toBe(rare.affixes.length);
    expect(requiredLevel(rerolled)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// AC6-확장 — 정련 공정(ADR-0040) 재단조 후에도 requiredLevel 불변
//
// ADR-0040 이 "어픽스 칸 추가"를 금지 구역으로 둔 이유가 여기 있다. `requiredLevel` 은
// 등급 + 어픽스 **개수** + 드랍 단계에서만 파생하고 **어픽스 값은 읽지 않는다**. 정련은
// 값만 바꾸고 개수·등급·`source` 를 전부 보존하므로 요구 레벨이 **구조적으로** 불변이다 —
// 그래서 CONTEXT 의 "한번 착용한 장비가 부적격이 되는 일이 없다" 가 지켜진다.
//
// "우연히 같았다"가 아니라 "입력이 보존돼서 같다"를 증명하려고, 모든 케이스에서
// `affixes.length` · `rarity` · `source` 가 원본과 같음을 함께 단언한다. 그리고 값 밴드
// `band = 1`(전 어픽스가 `def.max`)에서도 req 가 안 움직이는 것으로 **값 무의존**을 못박는다.
// ---------------------------------------------------------------------------

describe('AC6-확장 reforgeAffixes(정련) 후 requiredLevel 불변 (ADR-0040 금지 구역의 근거)', () => {
  /** 드랍처 상한이 **무는** 저단계 2종 + **안 무는** 고단계 2종. 두 경로를 다 밟아야 의미가 있다. */
  const STAGES = [1, 3, 11, 21] as const;
  /** 0 = 현행 균등, 1 = 전 어픽스가 def.max. 그 사이 두 지점을 함께 훑는다. */
  const BANDS = [0, 0.25, 0.55, 1] as const;

  /**
   * 원본과 재단조본이 **개수·등급·source(=req 의 세 입력)** 를 전부 공유하는지 단언한다.
   * 이 세 가지가 같다는 것이 곧 "req 가 같아야 한다"의 전제다.
   */
  function expectReqInputsPreserved(before: Item, after: Item, label: string): void {
    expect(after.affixes.length, `${label}: 어픽스 개수 보존`).toBe(before.affixes.length);
    expect(after.rarity, `${label}: 등급 보존`).toBe(before.rarity);
    expect(after.source, `${label}: source(드랍 단계) 보존`).toEqual(before.source);
    expect(requiredLevel(after), `${label}: requiredLevel 불변`).toBe(requiredLevel(before));
  }

  /** 등급별 표본 아이템. unique 는 롤 슬롯이 유동적이라 저작 유니크를 명시 부착한다. */
  function sample(rarity: Rarity, seed: number, stage: number): Item {
    const source = { planet: 0, stage };
    if (rarity !== 'unique') return rollItem(seed, rarity, source);
    // rollItem(unique) 는 슬롯 추첨에 따라 uniqueId 가 안 붙을 수 있다(그러면 req 가 throw).
    // 레지스트리에 실재하는 저작 유니크를 붙여 결정론 표본으로 만든다 — 어픽스는 롤 그대로다.
    const def = M2_UNIQUES[0]!; // overheat-drum, reqLevel 66
    const rolled = rollItem(seed, 'rare', source);
    return { ...rolled, rarity: 'unique', slot: def.slot, uniqueId: def.id };
  }

  it('다중 고착(0개·1개·여러 개·전량) × 등급 × 단계 전 조합에서 req 불변', () => {
    for (const stage of STAGES) {
      for (const rarity of ['normal', 'magic', 'rare', 'unique'] as const) {
        const item = sample(rarity, 20260728 + stage, stage);
        const n = item.affixes.length;
        // 0개 · 1개 · 여러 개(짝수 인덱스) · 전량. n 이 작으면 자연히 중복되지만 무해하다.
        const fastenSets: readonly number[][] = [
          [],
          n > 0 ? [0] : [],
          Array.from({ length: n }, (_, i) => i).filter((i) => i % 2 === 0),
          Array.from({ length: n }, (_, i) => i),
        ];
        for (const fastened of fastenSets) {
          const out = reforgeAffixes(item, 777 + fastened.length, { fastened });
          expectReqInputsPreserved(item, out, `${rarity}/stage${stage}/고착${fastened.length}`);
          // 고착 어픽스는 값·인덱스가 그대로여야 한다(정련의 계약).
          for (const i of fastened) {
            expect(out.affixes[i], `${rarity}/stage${stage}/고착 인덱스 ${i}`).toEqual(
              item.affixes[i],
            );
          }
        }
      }
    }
  });

  it('값 밴드 0 / 0.25 / 0.55 / 1 전 구간에서 req 불변 — 값이 최대여도 요구 레벨은 그대로', () => {
    for (const stage of STAGES) {
      for (const rarity of ['normal', 'magic', 'rare', 'unique'] as const) {
        const item = sample(rarity, 555000 + stage, stage);
        for (const band of BANDS) {
          const out = reforgeAffixes(item, 31337, { band });
          expectReqInputsPreserved(item, out, `${rarity}/stage${stage}/band${band}`);
        }
      }
    }
  });

  it('band=1 이면 전 어픽스가 def.max 인데도 req 가 안 움직인다 (값 무의존의 직접 증거)', () => {
    const item = rollItem(864213, 'rare', SOURCE);
    expect(item.affixes.length).toBeGreaterThanOrEqual(3);
    const before = requiredLevel(item);

    const maxed = reforgeAffixes(item, 24680, { band: 1 }); // 고착 없음 = 전량 재추첨
    for (const roll of maxed.affixes) {
      const def = AFFIX_BY_ID.get(roll.id);
      expect(def, `어픽스 def 조회 ${roll.id}`).toBeDefined();
      expect(roll.value, `${roll.id} 는 밴드 1 에서 최댓값`).toBe(def!.max);
    }
    expectReqInputsPreserved(item, maxed, 'band=1 최대값');
    expect(requiredLevel(maxed)).toBe(before);
  });

  it('band 0 과 1 은 어픽스 값 총합이 실제로 다른데(대조) req 는 같다', () => {
    // "req 가 같은 건 결과가 안 바뀌어서"라는 반론을 차단한다 — 값은 확실히 움직였다.
    const item = rollItem(191919, 'rare', SOURCE);
    const lo = reforgeAffixes(item, 4242, { band: 0 });
    const hi = reforgeAffixes(item, 4242, { band: 1 });
    const sum = (it: Item): number => it.affixes.reduce((a, r) => a + r.value, 0);
    expect(sum(hi), '밴드 1 총합이 밴드 0 보다 커야 대조가 성립한다').toBeGreaterThan(sum(lo));
    expect(requiredLevel(lo)).toBe(requiredLevel(item));
    expect(requiredLevel(hi)).toBe(requiredLevel(item));
  });

  it('연쇄 반복: 같은 아이템을 12회 연속 재단조해도 누적 드리프트가 없다', () => {
    for (const stage of STAGES) {
      for (const rarity of ['normal', 'magic', 'rare', 'unique'] as const) {
        const origin = sample(rarity, 130000 + stage, stage);
        const req0 = requiredLevel(origin);
        let cur = origin;
        for (let step = 1; step <= 12; step++) {
          // 스텝마다 시드·밴드·고착을 바꿔가며 굴린다(실제 공정의 누적 고착을 흉내).
          const fastened = Array.from({ length: Math.min(step, cur.affixes.length) }, (_, i) => i);
          cur = reforgeAffixes(cur, 900 + step * 37, {
            fastened,
            band: BANDS[step % BANDS.length]!,
          });
          expectReqInputsPreserved(origin, cur, `${rarity}/stage${stage}/연쇄 ${step}회`);
          expect(requiredLevel(cur), `${rarity}/stage${stage}/연쇄 ${step}회 누적`).toBe(req0);
        }
      }
    }
  });

  it('상한이 무는 저단계와 안 무는 고단계 양쪽에서 정련 전후 값이 실제로 다른 구간을 밟는다', () => {
    // 두 경로가 정말 갈리는지 확인(무의미한 동어반복 방지): 1단계 rare 는 상한 1 로 눌리고,
    // 21단계 rare 는 등급 산식 그대로다. 어느 쪽이든 정련은 그 값을 건드리지 않는다.
    const low = rollItem(70707, 'rare', { planet: 0, stage: 1 });
    const high = rollItem(70707, 'rare', { planet: 0, stage: 21 });
    expect(requiredLevel(low), '1단계는 드랍처 상한 1 로 눌린다').toBe(1);
    expect(requiredLevel(high), '21단계는 상한이 안 물어 등급 산식 그대로').toBeGreaterThan(1);

    for (const band of BANDS) {
      expectReqInputsPreserved(low, reforgeAffixes(low, 1111, { band }), `저단계 band${band}`);
      expectReqInputsPreserved(high, reforgeAffixes(high, 1111, { band }), `고단계 band${band}`);
    }
  });

  it('canEquip 도 정련 전후로 뒤집히지 않는다 (착용 중 장비가 부적격이 되지 않는다)', () => {
    // ADR-0040 이 지키려는 사용자 약속을 술어 층에서 직접 단언한다.
    for (const stage of STAGES) {
      for (const rarity of ['normal', 'magic', 'rare', 'unique'] as const) {
        const item = sample(rarity, 424242 + stage, stage);
        const level = requiredLevel(item); // 딱 착용 가능한 최저 레벨
        expect(canEquip(level, item)).toBe(true);
        const out = reforgeAffixes(item, 606060, { fastened: [0], band: 1 });
        expect(canEquip(level, out), `${rarity}/stage${stage}: 정련 후에도 착용 가능`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AC7 — 유니크 저작 loud-fail: 15종 전부 유효 + 미등록은 throw(폴백 없음)
// ---------------------------------------------------------------------------

describe('AC7 유니크 15종 저작 검증 + 미등록 LOUD-FAIL', () => {
  const ALL_UNIQUES = [...M2_UNIQUES, ...M3_UNIQUES];

  it('M2 5종 + M3 10종 = 15종이 저작돼 있다', () => {
    expect(M2_UNIQUES.length).toBe(5);
    expect(M3_UNIQUES.length).toBe(10);
    expect(ALL_UNIQUES.length).toBe(15);
  });

  it('등록된 유니크 15종은 전부 requiredLevel 이 유한 정수 [1,100] 이고 저작값과 일치한다', () => {
    for (const def of ALL_UNIQUES) {
      const req = requiredLevel(litItem('unique', 4, { slot: def.slot, uniqueId: def.id }));
      expect(Number.isInteger(req), def.id).toBe(true);
      expect(req, `${def.id} 하한`).toBeGreaterThanOrEqual(1);
      expect(req, `${def.id} 상한`).toBeLessThanOrEqual(100);
      // 15종 모두 [1,100] 정수라 clamp/반올림 no-op → 저작값 그대로여야 한다.
      expect(req, `${def.id} 저작값 일치`).toBe(def.reqLevel);
    }
  });

  it('미등록 uniqueId 를 가진 unique 아이템은 requiredLevel 이 throw 한다 (rare 폴백 없음)', () => {
    expect(() =>
      requiredLevel(litItem('unique', 4, { slot: 'core', uniqueId: '__nonexistent_unique__' })),
    ).toThrow();
  });

  it('uniqueId 가 아예 없는 unique 아이템도 throw 한다 (조용히 열리지 않는다)', () => {
    expect(() => requiredLevel(litItem('unique', 4, { slot: 'core' }))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC3 — grep 게이트: 프로덕션 hangar.ts 에 실제로 배선됐는지 정적 단언
// ---------------------------------------------------------------------------

describe('AC3 프로덕션 장착 경로 grep 게이트 (src/ui/pixi/hangar.ts)', () => {
  const HANGAR = readSrc('src/ui/pixi/hangar.ts');

  it('hangar.ts 가 requiredLevel 모듈에서 canEquip 을 import 한다', () => {
    // 죽은 DOM 경로(src/ui/inventory.ts)가 아니라 프로덕션 Pixi 화면이 술어를 가져와야 한다.
    expect(/import\s*\{[^}]*\bcanEquip\b[^}]*\}\s*from\s*['"][^'"]*requiredLevel/.test(HANGAR)).toBe(
      true,
    );
  });

  it('equip() 진입부가 canEquip 게이트를 부른다 (미달이면 no-op)', () => {
    // equip 메서드 본문만 잘라 그 안에 canEquip 호출이 있는지 본다. 술어가 다른 죽은 메서드에
    // 붙고 정작 equip 은 무방비인 오배선(이 리포 시그니처 결함 R5)을 여기서 잡는다.
    const body = HANGAR.match(/private equip\(item: Item\): void \{([\s\S]*?)\n {2}\}/);
    expect(body, 'hangar.ts 에서 equip 메서드를 찾지 못했다').not.toBeNull();
    expect(/\bcanEquip\(/.test(body?.[1] ?? ''), 'equip 진입부가 canEquip 을 부르지 않는다').toBe(true);
  });

  it('인벤토리 그리드가 잠김 셀의 onClick(=equip) 을 끊는다', () => {
    // locked 는 canEquip 로 계산되고, 잠김이면 equip 배선이 빠져야 한다(클릭 무동작 — AC8).
    expect(/const locked =[^\n]*!canEquip\(/.test(HANGAR), 'locked 가 canEquip 로 계산되지 않는다').toBe(
      true,
    );
    expect(
      /onClick:[^\n]*!locked[^\n]*this\.equip\(/.test(HANGAR),
      '잠김 셀의 onClick 이 !locked 로 가드되지 않는다',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC4 — 프로덕션 경로 통합: gearLocked 프리셋에서 술어가 실측 발동
// ---------------------------------------------------------------------------

describe("AC4 프로덕션 경로 통합 ('gearLocked' 프리셋)", () => {
  it('저레벨(Lv10) 기체는 인벤토리의 고 reqLevel 장비를 착용할 수 없다', () => {
    const profile = buildPreset('gearLocked');
    const ship = activeShip(profile);
    expect(ship.level).toBe(10);

    const inventory = profile.inventory;
    // gearLocked 인벤토리: normal(req 1, 착용 가능) + rare/unique(req>10, 잠김).
    const lockedItems = inventory.filter((it) => it.rarity === 'rare' || it.rarity === 'unique');
    const equippableNormals = inventory.filter((it) => it.rarity === 'normal');
    expect(lockedItems.length, '잠김 rare/unique 가 프리셋에 있어야 한다').toBeGreaterThanOrEqual(3);
    expect(equippableNormals.length, '착용 가능 normal 대조군이 있어야 한다').toBeGreaterThanOrEqual(1);

    // 잠김 아이템: canEquip=false, req>기체 레벨.
    for (const it of lockedItems) {
      expect(canEquip(ship.level, it), `${it.rarity}/${it.id} 는 잠겨야 한다`).toBe(false);
      expect(requiredLevel(it), `${it.id} req`).toBeGreaterThan(ship.level);
    }

    // 대조군 normal: canEquip=true, req=1.
    for (const it of equippableNormals) {
      expect(canEquip(ship.level, it), `${it.id} 는 착용 가능해야 한다`).toBe(true);
      expect(requiredLevel(it)).toBe(1);
    }

    // 잠김 아이템은 인벤토리에만 있고 장착돼 있지 않다(equipped 로 새지 않았다).
    const equipped = Object.values(ship.equipped).filter((i): i is Item => i !== undefined);
    for (const it of lockedItems) {
      expect(equipped, `${it.id} 가 장착돼 있으면 안 된다`).not.toContain(it);
    }
  });
});

// ---------------------------------------------------------------------------
// AC12 — 불변식 회귀: 정상 경로에서 초과 장착이 발생하지 않는다
// ---------------------------------------------------------------------------

describe('AC12 불변식 — 정상 경로 장착 아이템은 전부 canEquip 을 만족한다', () => {
  // 전제(주석 명시): ① 레벨은 단조 증가(profile.ts `Math.max(1,…)`)라 내려가지 않는다.
  // ② 활성 기체 교체 경로는 퇴역(guardianLifecycle)뿐이고 그때 새 기체는 항상 Lv1 빈 장비다.
  // ③ 장착은 equip() 이 canEquip 게이트를 통과할 때만 일어난다(AC3 로 배선 보증).
  // ⇒ 어떤 정상 경로도 "기체 레벨 < 장착 아이템 req" 상태를 만들지 못한다.

  it('maxed 프리셋(Lv100 풀 장비)의 모든 장착 아이템이 canEquip 을 만족한다', () => {
    const profile = buildPreset('maxed');
    const ship = activeShip(profile);
    const equipped = Object.values(ship.equipped).filter((i): i is Item => i !== undefined);
    expect(equipped.length, 'maxed 는 8칸을 채운다').toBeGreaterThan(0);
    for (const it of equipped) {
      expect(canEquip(ship.level, it), `${it.rarity}/${it.id}`).toBe(true);
    }
  });

  it('fresh·gearLocked 프리셋의 장착 아이템도 (있다면) 전부 canEquip 을 만족한다', () => {
    // 잠김 장비는 inventory 에만 있고 equipped 로 새면 안 된다 — 순회로 초과 장착 부재를 확증.
    for (const kind of ['fresh', 'gearLocked'] as const) {
      const ship = activeShip(buildPreset(kind));
      for (const it of Object.values(ship.equipped)) {
        if (it !== undefined) {
          expect(canEquip(ship.level, it), `${kind}: ${it.id}`).toBe(true);
        }
      }
    }
  });
});
