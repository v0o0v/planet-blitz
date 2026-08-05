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
