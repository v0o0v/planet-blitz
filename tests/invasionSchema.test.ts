/**
 * 침공 3레이어 배치 스키마 — 정규화·위조 대조 테스트 (M7a · L0-schema).
 *
 * 커버리지(레인 문서 L0 검증 항목):
 *   ① normalize 멱등성
 *   ② 슬롯 상한 초과 절단
 *   ③ 미지정 필드 기본값 주입
 *   ④ layersEqual 필드 전수 변조 테이블(스키마에서 **파생** — 하드코딩 목록 금지)
 *   ⑤ 정수 전용 불변식
 *   ⑥ eslint 설정에 data/** 포함
 */

import { describe, it, expect } from 'vitest';
import {
  INVASION_ASCENSION_MAX,
  INVASION_CORE_HP,
  INVASION_CORE_MODULE_SLOTS,
  INVASION_GUARDIAN_SLOTS,
  INVASION_LAYER_TICKS,
  INVASION_LEVEL_MAX,
  INVASION_LEVEL_MIN,
  INVASION_PROP_SLOTS,
  INVASION_RARITY_COUNT,
  INVASION_SOCKET_COUNTS,
  INVASION_TOTAL_TICKS,
  INVASION_WAVE_SLOTS,
  MAP_TEMPLATE_CHOKE,
  MAP_TEMPLATE_CURVED,
  MAP_TEMPLATE_STRAIGHT,
} from '../src/sim/invasion/constants.js';
import {
  SAMPLE_GUARDIAN,
  SAMPLE_REF,
  emptyInvasionLayers,
  enumerateLayerFields,
  layersEqual,
  mutateLayerField,
  normalizeInvasionLayers,
} from '../src/sim/invasion/normalize.js';
import type { InvasionLayers } from '../src/sim/invasion/types.js';
import { MAX_GUARDIAN_SLOTS } from '../data/guardian.js';

/** 모든 슬롯이 채워진 배치(필드 전수 열거를 위해 필요 — 빈 슬롯은 내부 리프가 없다). */
function fullLayers(): InvasionLayers {
  const ref = (n: number) => ({
    catalogId: n,
    level: 3 + n,
    ascension: 1,
    affixSeed: 1000 + n,
    rarity: 1,
  });
  return normalizeInvasionLayers({
    l1: { waveSlots: Array.from({ length: INVASION_WAVE_SLOTS }, (_, i) => ref(i)) },
    l2: {
      templateId: MAP_TEMPLATE_STRAIGHT,
      sockets: Array.from({ length: INVASION_SOCKET_COUNTS[MAP_TEMPLATE_STRAIGHT]! }, (_, i) =>
        ref(i + 10),
      ),
    },
    l3: {
      boss: ref(50),
      guardians: Array.from({ length: INVASION_GUARDIAN_SLOTS }, (_, i) => ({
        ...SAMPLE_GUARDIAN,
        x: 100 + i,
        y: 200 + i,
      })),
      props: Array.from({ length: INVASION_PROP_SLOTS }, (_, i) => ref(i + 30)),
      core: { hp: 8000, x: 0, y: -1200 },
      modules: Array.from({ length: INVASION_CORE_MODULE_SLOTS }, (_, i) => ref(i + 60)),
    },
  });
}

describe('침공 3레이어 스키마 — 상수 계약', () => {
  it('레이어 예산 합이 총 예산과 일치한다', () => {
    const sum = INVASION_LAYER_TICKS.reduce((a, b) => a + b, 0);
    expect(sum).toBe(INVASION_TOTAL_TICKS);
    expect(INVASION_LAYER_TICKS).toEqual([5400, 5400, 7200]);
    expect(INVASION_TOTAL_TICKS).toBe(18000);
  });

  it('슬롯 수 채택 결정값', () => {
    expect(INVASION_WAVE_SLOTS).toBe(6);
    expect(INVASION_SOCKET_COUNTS[MAP_TEMPLATE_STRAIGHT]).toBe(12);
    expect(INVASION_SOCKET_COUNTS[MAP_TEMPLATE_CURVED]).toBe(10);
    expect(INVASION_SOCKET_COUNTS[MAP_TEMPLATE_CHOKE]).toBe(8);
    expect(INVASION_PROP_SLOTS).toBe(6);
    expect(INVASION_GUARDIAN_SLOTS).toBe(2);
    expect(INVASION_CORE_MODULE_SLOTS).toBe(2);
    expect(INVASION_CORE_HP).toBe(8000);
  });

  it('수호 슬롯 상수가 data/guardian.ts 정본과 일치한다(SQL limit 2 · EF 3자 매핑 계약)', () => {
    expect(INVASION_GUARDIAN_SLOTS).toBe(MAX_GUARDIAN_SLOTS);
  });
});

describe('침공 3레이어 스키마 — 정규화', () => {
  it('① 멱등: normalize(normalize(x)) === normalize(x)', () => {
    const inputs: unknown[] = [
      undefined,
      null,
      42,
      {},
      { l1: { waveSlots: [SAMPLE_REF] } },
      fullLayers(),
      { l2: { templateId: 2, sockets: [null, SAMPLE_REF] } },
    ];
    for (const raw of inputs) {
      const once = normalizeInvasionLayers(raw);
      const twice = normalizeInvasionLayers(once);
      expect(layersEqual(once, twice)).toBe(true);
      expect(twice).toEqual(once);
    }
  });

  it('② 슬롯 상한 초과분 절단 (웨이브 7→6, 기물 8→6, 모듈 3→2, 수호 3→2)', () => {
    const n = normalizeInvasionLayers({
      l1: { waveSlots: Array.from({ length: 7 }, () => SAMPLE_REF) },
      l3: {
        props: Array.from({ length: 8 }, () => SAMPLE_REF),
        modules: Array.from({ length: 3 }, () => SAMPLE_REF),
        guardians: Array.from({ length: 3 }, () => SAMPLE_GUARDIAN),
      },
    });
    expect(n.l1.waveSlots.length).toBe(INVASION_WAVE_SLOTS);
    expect(n.l3.props.length).toBe(INVASION_PROP_SLOTS);
    expect(n.l3.modules.length).toBe(INVASION_CORE_MODULE_SLOTS);
    expect(n.l3.guardians.length).toBe(INVASION_GUARDIAN_SLOTS);
  });

  it('② 템플릿별 소켓 길이가 강제된다(초과 절단·부족 패딩)', () => {
    for (let t = 0; t < INVASION_SOCKET_COUNTS.length; t++) {
      const want = INVASION_SOCKET_COUNTS[t]!;
      const over = normalizeInvasionLayers({
        l2: { templateId: t, sockets: Array.from({ length: 20 }, () => SAMPLE_REF) },
      });
      expect(over.l2.sockets.length).toBe(want);
      expect(over.l2.sockets.every((s) => s !== null)).toBe(true);

      const under = normalizeInvasionLayers({ l2: { templateId: t, sockets: [SAMPLE_REF] } });
      expect(under.l2.sockets.length).toBe(want);
      expect(under.l2.sockets[0]).not.toBeNull();
      expect(under.l2.sockets[want - 1]).toBeNull();
    }
  });

  it('③ 미지정 필드 기본값 주입 + null 슬롯 유지', () => {
    const empty = emptyInvasionLayers();
    expect(empty.l1.waveSlots).toEqual(new Array(INVASION_WAVE_SLOTS).fill(null));
    expect(empty.l2.templateId).toBe(MAP_TEMPLATE_STRAIGHT);
    expect(empty.l3.boss).toBeNull();
    expect(empty.l3.core).toEqual({ hp: INVASION_CORE_HP, x: 0, y: 0 });

    // level 미지정 → 1, ascension/affixSeed/rarity 미지정 → 0
    const n = normalizeInvasionLayers({ l1: { waveSlots: [{ catalogId: 4 }] } });
    expect(n.l1.waveSlots[0]).toEqual({
      catalogId: 4,
      level: INVASION_LEVEL_MIN,
      ascension: 0,
      affixSeed: 0,
      rarity: 0,
    });
  });

  it('③ null 슬롯은 자리를 지킨다(밀집화 금지 — 슬롯 인덱스가 계약)', () => {
    const n = normalizeInvasionLayers({
      l1: { waveSlots: [null, SAMPLE_REF, null, SAMPLE_REF] },
    });
    expect(n.l1.waveSlots[0]).toBeNull();
    expect(n.l1.waveSlots[1]?.catalogId).toBe(SAMPLE_REF.catalogId);
    expect(n.l1.waveSlots[2]).toBeNull();
    expect(n.l1.waveSlots[3]?.catalogId).toBe(SAMPLE_REF.catalogId);
  });

  it('③ 손상 슬롯은 통째로 비워진다(catalogId 없음/음수/비객체, 스냅샷 손상 수호)', () => {
    const n = normalizeInvasionLayers({
      l1: { waveSlots: [{ level: 5 }, { catalogId: -1 }, 'x', { catalogId: Number.NaN }] },
      l3: {
        guardians: [
          { ...SAMPLE_GUARDIAN, snapshot: { ...SAMPLE_GUARDIAN.snapshot, hp: Number.NaN } },
          { x: 1, y: 2 },
        ],
      },
    });
    expect(n.l1.waveSlots.slice(0, 4)).toEqual([null, null, null, null]);
    expect(n.l3.guardians).toEqual([null, null]);
  });

  it('③ 범위 밖 값은 클램프된다', () => {
    const n = normalizeInvasionLayers({
      l1: {
        waveSlots: [
          { catalogId: 0, level: 9999, ascension: 99, rarity: 99 },
          { catalogId: 0, level: -5, ascension: -5, rarity: -5 },
        ],
      },
      l2: { templateId: 77 },
      l3: { core: { hp: -10 } },
    });
    expect(n.l1.waveSlots[0]).toMatchObject({
      level: INVASION_LEVEL_MAX,
      ascension: INVASION_ASCENSION_MAX,
      rarity: INVASION_RARITY_COUNT - 1,
    });
    expect(n.l1.waveSlots[1]).toMatchObject({ level: INVASION_LEVEL_MIN, ascension: 0, rarity: 0 });
    expect(n.l2.templateId).toBe(INVASION_SOCKET_COUNTS.length - 1);
    expect(n.l3.core.hp).toBe(1);
  });

  it('⑤ 정수 전용 불변식 — 정규형의 모든 수치 리프가 정수(그리고 -0 없음)', () => {
    const n = normalizeInvasionLayers({
      l1: { waveSlots: [{ catalogId: 2.9, level: 4.7, ascension: 1.2, affixSeed: 7.9, rarity: 2.6 }] },
      l2: { templateId: 1.9, sockets: [{ catalogId: 3.3 }] },
      l3: {
        core: { hp: 1234.9, x: -0.5, y: 55.9 },
        guardians: [{ ...SAMPLE_GUARDIAN, x: 10.9, y: -0.4, performanceCP: 9000.7 }],
        props: [{ catalogId: 1.1 }],
        modules: [{ catalogId: 2.2 }],
        boss: { catalogId: 5.5 },
      },
    });
    const leaves = enumerateLayerFields(n).filter((f) => f.kind === 'number');
    expect(leaves.length).toBeGreaterThan(30);
    const walk = (v: unknown): void => {
      if (v === null) return;
      if (typeof v === 'number') {
        expect(Number.isInteger(v)).toBe(true);
        expect(Object.is(v, -0)).toBe(false);
        return;
      }
      if (Array.isArray(v)) {
        v.forEach(walk);
        return;
      }
      Object.values(v as Record<string, unknown>).forEach(walk);
    };
    walk(n);
    // 절삭은 0 방향(trunc): -0.5 → 0, 1234.9 → 1234
    expect(n.l3.core.x).toBe(0);
    expect(n.l3.core.hp).toBe(1234);
  });
});

describe('침공 3레이어 스키마 — layersEqual 위조 대조', () => {
  it('④ 동일 배치는 같다(정규화 전/후 무관)', () => {
    const a = fullLayers();
    expect(layersEqual(a, a)).toBe(true);
    expect(layersEqual(a, normalizeInvasionLayers(a))).toBe(true);
    // 미지정 필드가 기본값으로 채워지는 두 표현은 같은 배치다
    expect(layersEqual({ l1: { waveSlots: [{ catalogId: 1 }] } }, {
      l1: { waveSlots: [{ catalogId: 1, level: 1, ascension: 0, affixSeed: 0, rarity: 0 }] },
    })).toBe(true);
  });

  it('④ 빈 배치 ≠ 채운 배치', () => {
    expect(layersEqual(emptyInvasionLayers(), fullLayers())).toBe(false);
  });

  it('④ 필드 전수 변조 테이블 — 스키마에서 파생한 모든 지점이 reject 된다', () => {
    const base = fullLayers();
    const fields = enumerateLayerFields(base);
    // 수치 리프 + 슬롯이 모두 열거돼야 한다(회귀 가드: 스키마가 줄면 즉시 실패).
    const numbers = fields.filter((f) => f.kind === 'number');
    const slots = fields.filter((f) => f.kind === 'slot');
    expect(slots.length).toBe(
      1 + INVASION_WAVE_SLOTS + INVASION_SOCKET_COUNTS[MAP_TEMPLATE_STRAIGHT]! +
        INVASION_GUARDIAN_SLOTS + INVASION_PROP_SLOTS + INVASION_CORE_MODULE_SLOTS,
    );
    // Ref 5필드 × (6웨이브 + 12소켓 + 6기물 + 2모듈 + 1보스) + 수호 2×(x,y,perf,lineage,milestones
    // + 스냅샷 15[12 스탯 + 발사 서술자 weaponType·bulletCount·spread, ADR-0025]) + templateId + core 3
    expect(numbers.length).toBe(5 * (6 + 12 + 6 + 2 + 1) + 2 * (5 + 15) + 1 + 3);

    const failures: string[] = [];
    for (const f of fields) {
      const mutated = mutateLayerField(base, f);
      if (mutated === null) {
        failures.push(`${f.path} (변조 불가)`);
        continue;
      }
      if (layersEqual(base, mutated)) failures.push(`${f.path} (대조 누락 = 위조 프리패스)`);
      // 대칭성도 확인
      if (layersEqual(mutated, base)) failures.push(`${f.path} (역방향 대조 누락)`);
    }
    expect(failures).toEqual([]);
  });

  it('④ 슬롯 위치를 옮긴 배치는 다르다(밀집화가 아니라 인덱스가 계약)', () => {
    const a = normalizeInvasionLayers({ l1: { waveSlots: [SAMPLE_REF, null] } });
    const b = normalizeInvasionLayers({ l1: { waveSlots: [null, SAMPLE_REF] } });
    expect(layersEqual(a, b)).toBe(false);
  });

  it('④ 알 수 없는 잉여 필드는 대조에 영향을 주지 않는다(정규화가 드롭)', () => {
    const a = fullLayers();
    const b = { ...normalizeInvasionLayers(a), bogus: 1, l4: { x: 2 } };
    expect(layersEqual(a, b)).toBe(true);
  });
});

describe('침공 3레이어 스키마 — lint 규율', () => {
  it('⑥ eslint 설정의 sim 결정론 규칙이 data/** 에도 적용된다', async () => {
    // eslint.config.js 는 타입 선언이 없는 순수 JS 설정 파일이다(런타임 import 로 형태 검증).
    // @ts-expect-error — 선언 파일 없음(TS7016). 의도된 무타입 import.
    const mod = await import('../eslint.config.js');
    const config = mod.default as { files?: string[]; rules?: Record<string, unknown> }[];
    const simBlocks = config.filter(
      (c) => c.rules !== undefined && 'no-restricted-properties' in c.rules,
    );
    expect(simBlocks.length).toBeGreaterThan(0);
    const covered = simBlocks.flatMap((c) => c.files ?? []);
    expect(covered).toContain('src/sim/**/*.ts');
    expect(covered).toContain('data/**/*.ts');
  });
});
