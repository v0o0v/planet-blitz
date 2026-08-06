/**
 * flat 스킬 레이아웃의 **구조 계약** (ADR-0049).
 *
 * `skillInvest` 인덱스는 삼중 해시 계약이다 — ①리플레이 폴드(길이 프리픽스 + 값) ②파생
 * ③파워업 RNG 슬라이스. 그래서 "축당 10개"가 한 기체에서만 9개여도 그 기체의 전 런이
 * 조용히 갈린다. 그 실수는 전부 같은 타입이라 `tsc` 가 못 잡는다.
 *
 * {@link buildShipAxis} 가 조립 시점에 던지는 것이 1차 방벽이고, 이 파일이 2차다 — 조립
 * 헬퍼를 우회해 리터럴로 `ShipTreeDef` 를 만드는 경로가 생겨도 여기서 걸린다.
 *
 * ## 무엇을 일부러 검사하지 않는가
 * 스킬의 **효과**는 여기서 안 본다(sim 배선 레인 소관). 여기는 레이아웃과 식별자만 본다 —
 * 두 축을 한 파일에서 검사하면 배선이 안 된 시점에 이 파일이 통째로 빨개져서, 레이아웃
 * 회귀와 배선 미완이 구분되지 않는다.
 */

import { describe, it, expect } from 'vitest';
import {
  SHIP_TYPES,
  SKILLS_PER_AXIS,
  SKILL_MAX_LEVEL,
  TREES_PER_SHIP,
  TREE_AFFINITIES,
  flattenShipNodes,
  shipAxisIndexOf,
  shipNodeCount,
  shipTreeRange,
  zeroSkillInvest,
} from '../data/ships/index.js';
import { axisOfIndex } from '../src/items/skills.js';
import { createWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';

/** ADR-0049 의 총량 — 기체 7종 × 3축 × 10스킬. */
const EXPECTED_TOTAL = 210;

describe('flat 스킬 레이아웃 — 구조 계약 (ADR-0049)', () => {
  it('기체 7종 전부 축 3개 × 스킬 10개 = 30칸이다', () => {
    expect(SHIP_TYPES.length).toBe(7);
    for (const def of SHIP_TYPES) {
      expect(def.trees.length, `${def.slug}: 축 수`).toBe(TREES_PER_SHIP);
      for (const tree of def.trees) {
        expect(tree.nodes.length, `${def.slug}/${tree.slug}: 축당 스킬 수`).toBe(SKILLS_PER_AXIS);
      }
      expect(shipNodeCount(def), `${def.slug}: flat 길이`).toBe(TREES_PER_SHIP * SKILLS_PER_AXIS);
      expect(flattenShipNodes(def).length, `${def.slug}: flatten 길이`).toBe(shipNodeCount(def));
      expect(zeroSkillInvest(def.id).length, `${def.slug}: 무투자 벡터 길이`).toBe(30);
    }
  });

  it('총 210종이고 스킬 id 가 전역 유니크다', () => {
    const ids = SHIP_TYPES.flatMap((d) => flattenShipNodes(d).map((n) => n.id));
    expect(ids.length).toBe(EXPECTED_TOTAL);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes, `중복 id: ${[...new Set(dupes)].join(', ')}`).toEqual([]);
  });

  it('스킬 id 는 자기 기체 slug 로 시작한다 (다른 기체 파일에서 복사해 온 흔적 검출)', () => {
    for (const def of SHIP_TYPES) {
      for (const n of flattenShipNodes(def)) {
        expect(n.id.startsWith(`${def.slug}-`), `${def.slug}: ${n.id}`).toBe(true);
      }
    }
  });

  it('축 code 접두가 축 안에서 일관되고 번호가 1..10 이다', () => {
    for (const def of SHIP_TYPES) {
      for (const tree of def.trees) {
        const nums = tree.nodes.map((n) => {
          const m = /^([A-Z]+)(\d+)$/.exec(n.code);
          expect(m, `${def.slug}/${tree.slug}: code 형식 위반 ${n.code}`).not.toBeNull();
          return { prefix: m?.[1] ?? '', num: Number(m?.[2] ?? 0) };
        });
        const prefixes = [...new Set(nums.map((x) => x.prefix))];
        expect(prefixes, `${def.slug}/${tree.slug}: 축 안에서 code 접두가 섞였다`).toHaveLength(1);
        expect(nums.map((x) => x.num), `${def.slug}/${tree.slug}: code 번호`).toEqual([
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
        ]);
      }
    }
  });

  it('스킬의 axis 가 소속 축의 affinity 와 일치한다 (저작 시 축을 옮겨 붙인 실수 검출)', () => {
    for (const def of SHIP_TYPES) {
      for (const tree of def.trees) {
        for (const n of tree.nodes) {
          expect(n.axis, `${def.slug}/${tree.slug}: ${n.id}`).toBe(tree.affinity);
        }
      }
    }
  });

  it('기체마다 affinity 3종이 정확히 한 번씩 쓰인다', () => {
    for (const def of SHIP_TYPES) {
      const got = def.trees.map((t) => t.affinity).sort();
      expect(got, `${def.slug}: affinity 구성`).toEqual([...TREE_AFFINITIES].sort());
    }
  });

  it('전 스킬의 투자 상한이 SKILL_MAX_LEVEL 이다', () => {
    for (const def of SHIP_TYPES) {
      for (const n of flattenShipNodes(def)) {
        expect(n.maxPoints, `${def.slug}: ${n.id}`).toBe(SKILL_MAX_LEVEL);
      }
    }
  });

  it('표시 문구(name·desc)가 비어 있지 않다', () => {
    for (const def of SHIP_TYPES) {
      for (const n of flattenShipNodes(def)) {
        expect(n.name.trim().length, `${def.slug}: ${n.id} name`).toBeGreaterThan(0);
        expect(n.desc.trim().length, `${def.slug}: ${n.id} desc`).toBeGreaterThan(0);
      }
    }
  });

  it('shipTreeRange 와 flattenShipNodes 의 순서가 일치한다 (슬라이스가 밀리면 RNG 스트림이 갈린다)', () => {
    for (const def of SHIP_TYPES) {
      const flat = flattenShipNodes(def);
      for (let ti = 0; ti < def.trees.length; ti++) {
        const { start, end } = shipTreeRange(def, ti);
        expect(end - start).toBe(SKILLS_PER_AXIS);
        const sliced = flat.slice(start, end).map((n) => n.id);
        expect(sliced, `${def.slug}/축 ${ti}`).toEqual(def.trees[ti]?.nodes.map((n) => n.id));
      }
    }
  });

  it('축 조회 정본 2종이 전 인덱스에서 일치하고 범위 밖을 흘리지 않는다', () => {
    for (const def of SHIP_TYPES) {
      for (let i = 0; i < shipNodeCount(def); i++) {
        const ti = shipAxisIndexOf(def, i);
        expect(ti, `${def.slug}[${i}]: 축 인덱스`).toBe(Math.floor(i / SKILLS_PER_AXIS));
        expect(axisOfIndex(i, def.id), `${def.slug}[${i}]: affinity`).toBe(def.trees[ti]?.affinity);
      }
      // 범위 밖·손상 입력은 조용히 축 0 으로 흐르지 않고 undefined/-1 이어야 한다.
      for (const bad of [-1, 30, 63, 1.5, Number.NaN]) {
        expect(shipAxisIndexOf(def, bad), `${def.slug}: 범위 밖 ${bad}`).toBe(-1);
        expect(axisOfIndex(bad, def.id), `${def.slug}: 범위 밖 ${bad}`).toBeUndefined();
      }
    }
  });
});

/**
 * 리플레이 해시의 **길이 프리픽스 폴드** 가드.
 *
 * `src/sim/replay.ts` 는 `skillInvest` 를 접기 전에 `hashU32(h, invest.length)` 로 길이를 먼저
 * 접는다 — 값이 전부 같아도 길이가 다르면 첫 틱부터 해시가 갈려야 한다는 계약이다.
 *
 * ## 왜 여기로 옮겼나
 * 이 축을 지키던 유일한 자리는 `tests/denoFixture.test.ts` 의 해츨링 시나리오였다(구 레이아웃에서
 * 해츨링만 78칸이라 "길이가 다른 벡터"를 태우는 유일한 런이었다). ADR-0049 가 전 기체를 30 으로
 * 통일하면서 **길이가 다른 유효 config 자체가 존재하지 않게** 됐고, 그 커버리지는 구조적으로
 * 사라졌다. 폴드 자체는 살아 있고 앞으로도 기체별 길이 분화·손상 벡터를 막아야 하므로,
 * 300초짜리 시나리오 파일 대신 여기서 직접 만든 두 벡터로 값싸게 잠근다.
 *
 * ⚠️ 여기 쓰는 짧은/긴 벡터는 **제품이 만들 수 없는 상태**다 — 저장 경로는 `normalizeSkillInvest`
 * 가 항상 30칸으로 맞춘다. 이 단언은 "그 정규화가 뚫렸을 때 해시가 침묵하지 않는다"는 2차 방어다.
 */
describe('리플레이 길이 프리픽스 폴드 (ADR-0049 로 deno 시나리오에서 이관)', () => {
  const cfgWith = (invest: number[]): WorldConfig =>
    ({ ...DEFAULT_CONFIG, skillInvest: invest }) as WorldConfig;

  it('값이 전부 0 이어도 길이가 다르면 해시가 갈린다', () => {
    const a = hashWorld(createWorld(0x1e46, cfgWith(new Array<number>(30).fill(0))));
    const b = hashWorld(createWorld(0x1e46, cfgWith(new Array<number>(29).fill(0))));
    expect(a, '길이 30 vs 29 가 같은 해시를 냈다 — 길이 프리픽스 폴드가 사라졌다').not.toBe(b);
  });

  /**
   * ⚠️ **`replay.ts` 의 주석이 틀렸다는 것을 이 단언이 밝혔다(2026-08-06).**
   * 그 주석은 "길이 프리픽스로 **미존재/빈 벡터를 구분**한다" 고 적었지만, 실제 폴드는
   * `hashU32(h, invest?.length ?? 0)` 이라 `undefined` 와 `[]` 가 **둘 다 0** 을 접는다 —
   * 구분되지 않는다.
   *
   * 그리고 **구분되지 않는 것이 옳다.** 둘 다 "투자 없음"이라는 같은 상태를 뜻하므로 다른
   * 해시를 내면 오히려 같은 런이 두 바이트열을 갖게 된다. 고칠 것은 코드가 아니라 주석이었고,
   * 주석은 정정했다. 이 단언은 그 사실을 **못 박아** 다음 사람이 주석만 읽고 "구분되겠지" 하고
   * 배선을 바꾸는 것을 막는다.
   */
  it('벡터 미존재와 길이 0 벡터는 같은 해시다 (둘 다 "투자 없음")', () => {
    const none = hashWorld(createWorld(0x1e46, { ...DEFAULT_CONFIG } as WorldConfig));
    const empty = hashWorld(createWorld(0x1e46, cfgWith([])));
    expect(none, 'undefined 와 [] 가 갈렸다 — 같은 상태가 두 바이트열을 갖는다').toBe(empty);
  });
});
