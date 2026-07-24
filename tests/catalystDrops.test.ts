/**
 * 촉매 드랍 파생 순수성 — src/data/catalystDrops.ts (ADR-0029, Lane 4).
 *
 * 핵심 계약은 "정산 드랍 파생이 RNG 커서·sim 해시를 건드리지 않는다" 이다(결정론 동결).
 * 이 파일은 그 순수성을 세 축으로 못박는다: ① 결정론(같은 시드 → 같은 드랍), ② 입력 불변,
 * ③ catalystDrop 배율이 드랍 빈도를 스케일한다, ④ 특산은 출신 행성에서만, ⑤ 풀 가중치.
 */

import { describe, it, expect } from 'vitest';
import {
  catalystDropPool,
  catalystDropsFromRun,
  type CatalystLootLike,
} from '../src/data/catalystDrops.js';
import { CATALYSTS, catalystById } from '../src/data/catalysts.js';

/** seed 목록 → loot 형태(정산이 넘기는 부분집합). */
function loot(seeds: number[]): CatalystLootLike[] {
  return seeds.map((seed) => ({ seed }));
}

/** 결정성 있는 시드 다발(고정 값 — 난수 아님). */
function seedRange(n: number): number[] {
  const out: number[] = [];
  let x = 0x1234abcd;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out.push(x);
  }
  return out;
}

describe('catalystDropPool — 공용 전체 + 그 행성 특산', () => {
  it('공용 30종은 어느 행성 풀에도 들어간다', () => {
    const pool = new Set(catalystDropPool(0));
    for (const def of CATALYSTS) {
      if (def.kind === 'common') expect(pool.has(def.id), def.slug).toBe(true);
    }
  });

  it('특산은 출신 행성 풀에만 들어간다(다른 행성 특산은 제외)', () => {
    const pool0 = new Set(catalystDropPool(0));
    for (const def of CATALYSTS) {
      if (def.kind !== 'signature') continue;
      expect(pool0.has(def.id), `${def.slug} on planet 0`).toBe(def.planet === 0);
    }
  });

  it('가중치만큼 펼쳐진다(dropWeight 반복)', () => {
    const pool = catalystDropPool(0);
    const kargonSwarmcall = CATALYSTS.find((c) => c.slug === 'kargon-swarmcall')!;
    const count = pool.filter((id) => id === kargonSwarmcall.id).length;
    expect(count).toBe(kargonSwarmcall.dropWeight);
  });
});

describe('catalystDropsFromRun — 순수성(RNG/해시 무영향)', () => {
  it('같은 입력이면 같은 드랍(결정론 — 재확정 가능)', () => {
    const input = { loot: loot(seedRange(200)), planet: 0, catalysts: [] as number[] };
    const a = catalystDropsFromRun(input);
    const b = catalystDropsFromRun(input);
    expect(a).toEqual(b);
  });

  it('입력 배열을 변형하지 않는다(부작용 없음)', () => {
    const seeds = seedRange(50);
    const loots = loot(seeds);
    const cats = [20, 20]; // catalystDrop 촉매(resonance) 2스택
    const before = JSON.stringify({ loots, cats });
    catalystDropsFromRun({ loot: loots, planet: 0, catalysts: cats });
    expect(JSON.stringify({ loots, cats })).toBe(before);
  });

  it('빈 전리품이면 드랍 없음', () => {
    expect(catalystDropsFromRun({ loot: [], planet: 0, catalysts: [] })).toEqual([]);
  });

  it('반환 드랍은 id 오름차순 + qty 합산(같은 id 중복 없음)', () => {
    const out = catalystDropsFromRun({ loot: loot(seedRange(400)), planet: 0, catalysts: [] });
    const ids = out.map((d) => d.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids); // 이미 정렬됨
    expect(new Set(ids).size).toBe(ids.length); // 중복 없음
    for (const d of out) expect(d.qty).toBeGreaterThan(0);
  });

  it('모든 드랍 id 가 그 행성 풀 안에 있다(특산 오출 없음)', () => {
    const pool = new Set(catalystDropPool(0));
    const out = catalystDropsFromRun({ loot: loot(seedRange(400)), planet: 0, catalysts: [] });
    for (const d of out) expect(pool.has(d.id), String(d.id)).toBe(true);
  });

  it('catalystDrop 보상 촉매를 부으면 드랍 총량이 늘어난다(배율이 게이트를 스케일)', () => {
    const seeds = loot(seedRange(600));
    const base = catalystDropsFromRun({ loot: seeds, planet: 0, catalysts: [] });
    // resonance(id 20) = catalystDrop 축. 여러 스택으로 배율↑ → 게이트 확률↑ → 드랍↑.
    const boosted = catalystDropsFromRun({ loot: seeds, planet: 0, catalysts: [20, 20, 20, 20] });
    const sum = (arr: { qty: number }[]): number => arr.reduce((n, d) => n + d.qty, 0);
    expect(sum(boosted)).toBeGreaterThan(sum(base));
  });

  it('무주입 런도 base 확률로 드랍은 난다(1단계 런 촉매 획득 경로)', () => {
    const out = catalystDropsFromRun({ loot: loot(seedRange(1000)), planet: 0, catalysts: [] });
    const total = out.reduce((n, d) => n + d.qty, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('드랍 id 는 전부 유효 촉매다(카탈로그 정합)', () => {
    const out = catalystDropsFromRun({ loot: loot(seedRange(400)), planet: 2, catalysts: [] });
    for (const d of out) expect(catalystById(d.id), String(d.id)).toBeDefined();
  });
});
