/**
 * 하네스 방어체 강화 모의 게이트웨이 테스트 (`src/harness/defenseMock.ts`).
 *
 * 검증 축:
 *   ① 결정론(같은 seed → 같은 보관함)
 *   ② 비용이 `data/defenseUnits.ts` 산식과 **바이트 일치**(모의가 값을 지어내지 않는다)
 *   ③ 실패 코드가 서버 계약 문자열과 같고, 실패 시 **재화가 차감되지 않는다**
 *   ④ 상한(레벨·승급·등급)에서 올바른 코드가 나온다
 */

import { describe, it, expect } from 'vitest';
import { createDefenseMock, type DefenseMockControl } from '../src/harness/defenseMock.js';
import {
  defenseUnitAscendCost,
  defenseUnitLevelUpCost,
  defenseUnitRerollCost,
  DEFENSE_UNIT_STORAGE_CAP,
} from '../data/defenseUnits.js';
import { CATALOG_BOSS, CATALOG_FORMATION } from '../data/invasion/catalog.js';
import { craftMineralCost } from '../data/planets/blueprints.js';
import { INVASION_ASCENSION_MAX } from '../src/sim/invasion/constants.js';

async function firstUnitId(mock: DefenseMockControl): Promise<string> {
  const units = await mock.gateway.listUnits();
  const id = units[0]?.id;
  if (id === undefined) throw new Error('테스트 전제 위반: 시드된 유닛이 없다');
  return id;
}

describe('결정론', () => {
  it('같은 seed 는 같은 보관함을 만든다', async () => {
    const a = createDefenseMock(1234);
    const b = createDefenseMock(1234);
    a.seedUnits(8);
    b.seedUnits(8);
    expect(await a.gateway.listUnits()).toEqual(await b.gateway.listUnits());
  });

  it('다른 seed 는 다른 보관함을 만든다', async () => {
    const a = createDefenseMock(1);
    const b = createDefenseMock(2);
    a.seedUnits(8);
    b.seedUnits(8);
    expect(await a.gateway.listUnits()).not.toEqual(await b.gateway.listUnits());
  });

  it('reset 후 다시 시드하면 원래와 같다', async () => {
    const m = createDefenseMock(99);
    m.seedUnits(5);
    const before = await m.gateway.listUnits();
    m.reset();
    m.seedUnits(5);
    expect(await m.gateway.listUnits()).toEqual(before);
    expect(m.state()).toEqual(createDefenseMock(99).state());
  });

  it('시드된 유닛의 catalogId 는 항상 등록 범위 안이다', async () => {
    const m = createDefenseMock(7);
    m.seedUnits(30);
    for (const u of await m.gateway.listUnits()) {
      expect(u.catalogId).toBeGreaterThanOrEqual(0);
      expect(u.unit.kind).toBe(u.kind);
    }
  });

  it('보관 상한을 넘겨 시드하지 않는다', async () => {
    const m = createDefenseMock(3);
    m.seedUnits(DEFENSE_UNIT_STORAGE_CAP + 40);
    expect((await m.gateway.listUnits()).length).toBe(DEFENSE_UNIT_STORAGE_CAP);
  });
});

describe('레벨업 — 비용은 서버 산식 그대로', () => {
  it('성공 시 산식과 같은 액수만 차감된다', async () => {
    const m = createDefenseMock(11);
    m.seedUnits(1);
    const id = await firstUnitId(m);
    const units = await m.gateway.listUnits();
    const unit = units[0]!.unit;
    const cost = defenseUnitLevelUpCost(unit.rarity, unit.level)!;
    const before = m.state();
    const res = await m.gateway.levelUp(id);
    expect(res.ok).toBe(true);
    expect(res.unit?.level).toBe(unit.level + 1);
    expect(m.state().credits).toBe(before.credits - cost.credits);
    expect(m.state().minerals).toBe(before.minerals - cost.minerals);
    // 잔여 재화는 **일부러 안 싣는다**. 서버 계약에는 있지만, 사령부의 `pullServerCurrency`
    // 가 그 값을 프로필에 대입·저장해서 모의 잔액이 계정 재화 표시를 덮고 하네스 프로필
    // push 를 타고 서버로 샐 수 있다(보안 리뷰 LOW-1). 필드가 없으면 그쪽 `!== undefined`
    // 가드가 걸려 프로필을 건드리지 않는다 — 차감 자체는 위 두 줄이 이미 확인한다.
    expect(res.credits).toBeUndefined();
    expect(res.minerals).toBeUndefined();
  });

  it('없는 유닛은 not-owned', async () => {
    const m = createDefenseMock(11);
    expect(await m.gateway.levelUp('없는-id')).toEqual({ ok: false, code: 'not-owned' });
  });

  it('크레딧이 모자라면 insufficient-credits 이고 차감이 없다', async () => {
    const m = createDefenseMock(12);
    m.seedUnits(1);
    m.setCurrency({ credits: 0 });
    const before = m.state();
    const res = await m.gateway.levelUp(await firstUnitId(m));
    expect(res).toEqual({ ok: false, code: 'insufficient-credits' });
    expect(m.state()).toEqual(before);
  });

  it('광물만 모자라면 insufficient-minerals', async () => {
    const m = createDefenseMock(13);
    m.seedUnits(1);
    const unit = (await m.gateway.listUnits())[0]!.unit;
    // 광물이 요구되는 레벨까지 올린 뒤 광물만 비운다.
    let id = await firstUnitId(m);
    for (let i = unit.level; i < 25; i++) await m.gateway.levelUp(id);
    id = await firstUnitId(m);
    const cur = (await m.gateway.listUnits())[0]!.unit;
    expect(defenseUnitLevelUpCost(cur.rarity, cur.level)!.minerals).toBeGreaterThan(0);
    m.setCurrency({ minerals: 0 });
    const before = m.state();
    expect(await m.gateway.levelUp(id)).toEqual({ ok: false, code: 'insufficient-minerals' });
    expect(m.state()).toEqual(before);
  });
});

describe('승급 · 리롤 · 등급 승급', () => {
  it('승급은 설계도+크레딧을 산식대로 차감한다', async () => {
    const m = createDefenseMock(21);
    m.seedUnits(1);
    const id = await firstUnitId(m);
    const unit = (await m.gateway.listUnits())[0]!.unit;
    const cost = defenseUnitAscendCost(unit.ascension)!;
    const before = m.state();
    const res = await m.gateway.ascend(id);
    expect(res.ok).toBe(true);
    expect(res.unit?.ascension).toBe(unit.ascension + 1);
    expect(m.state().blueprints).toBe(before.blueprints - cost.blueprints);
    expect(m.state().credits).toBe(before.credits - cost.credits);
  });

  it('승급 상한에서 max-ascension', async () => {
    const m = createDefenseMock(22);
    m.seedUnits(1);
    const id = await firstUnitId(m);
    for (let i = 0; i <= INVASION_ASCENSION_MAX; i++) await m.gateway.ascend(id);
    expect((await m.gateway.listUnits())[0]!.unit.ascension).toBe(INVASION_ASCENSION_MAX);
    expect(await m.gateway.ascend(id)).toEqual({ ok: false, code: 'max-ascension' });
  });

  it('설계도가 모자라면 insufficient-blueprints 이고 차감이 없다', async () => {
    const m = createDefenseMock(23);
    m.seedUnits(1);
    m.setCurrency({ blueprints: 0 });
    const before = m.state();
    expect(await m.gateway.ascend(await firstUnitId(m))).toEqual({
      ok: false,
      code: 'insufficient-blueprints',
    });
    expect(m.state()).toEqual(before);
  });

  it('normal 등급 리롤은 no-affix-slots', async () => {
    const m = createDefenseMock(24);
    const craft = await m.gateway.craftFromBlueprint(CATALOG_FORMATION, 0);
    expect(craft.ok).toBe(true);
    expect(craft.unit?.rarity).toBe('normal');
    const id = await firstUnitId(m);
    expect(await m.gateway.rerollAffixes(id)).toEqual({ ok: false, code: 'no-affix-slots' });
  });

  it('리롤은 광물을 산식대로 쓰고 어픽스 시드를 바꾼다', async () => {
    const m = createDefenseMock(25);
    m.seedUnits(20);
    const units = await m.gateway.listUnits();
    const target = units.find((u) => u.unit.rarity !== 'normal');
    expect(target).toBeDefined();
    const cost = defenseUnitRerollCost(target!.unit.rarity);
    const before = m.state();
    const res = await m.gateway.rerollAffixes(target!.id);
    expect(res.ok).toBe(true);
    expect(res.unit?.affixSeed).not.toBe(target!.unit.affixSeed);
    expect(res.unit?.rarity).toBe(target!.unit.rarity);
    expect(m.state().minerals).toBe(before.minerals - cost.minerals);
  });

  it('등급 승급은 사다리를 한 칸 올리고 unique 에서 max-rarity 를 낸다', async () => {
    const m = createDefenseMock(26);
    const craft = await m.gateway.craftFromBlueprint(CATALOG_FORMATION, 0);
    expect(craft.ok).toBe(true);
    const id = await firstUnitId(m);
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await m.gateway.promoteRarity(id);
      expect(res.ok).toBe(true);
      seen.push(res.unit!.rarity);
    }
    expect(seen).toEqual(['magic', 'rare', 'unique']);
    expect(await m.gateway.promoteRarity(id)).toEqual({ ok: false, code: 'max-rarity' });
  });
});

describe('제작', () => {
  it('미등록 카탈로그는 bad-catalog', async () => {
    const m = createDefenseMock(31);
    expect(await m.gateway.craftFromBlueprint(CATALOG_FORMATION, 9999)).toEqual({
      ok: false,
      code: 'bad-catalog',
    });
    expect(await m.gateway.craftFromBlueprint(4, 0)).toEqual({ ok: false, code: 'bad-catalog' });
  });

  it('보스 제작은 광물 40, 그 외는 12 를 쓴다(서버 미러)', async () => {
    const m = createDefenseMock(32);
    const before = m.state();
    expect((await m.gateway.craftFromBlueprint(CATALOG_BOSS, 0)).ok).toBe(true);
    expect(m.state().minerals).toBe(before.minerals - craftMineralCost(CATALOG_BOSS));
    const mid = m.state();
    expect((await m.gateway.craftFromBlueprint(CATALOG_FORMATION, 0)).ok).toBe(true);
    expect(m.state().minerals).toBe(mid.minerals - craftMineralCost(CATALOG_FORMATION));
  });

  it('광물이 모자라면 insufficient-funds 이고 설계도가 줄지 않는다', async () => {
    const m = createDefenseMock(33);
    m.setCurrency({ minerals: 0 });
    const before = m.state();
    expect(await m.gateway.craftFromBlueprint(CATALOG_FORMATION, 0)).toEqual({
      ok: false,
      code: 'insufficient-funds',
    });
    expect(m.state()).toEqual(before);
    expect((await m.gateway.listUnits()).length).toBe(0);
  });

  it('설계도가 모자라면 insufficient-blueprints 이고 광물이 줄지 않는다', async () => {
    const m = createDefenseMock(34);
    m.setCurrency({ blueprints: 0 });
    const before = m.state();
    expect(await m.gateway.craftFromBlueprint(CATALOG_FORMATION, 0)).toEqual({
      ok: false,
      code: 'insufficient-blueprints',
    });
    expect(m.state()).toEqual(before);
  });

  it('보관함이 가득 차면 storage-full', async () => {
    const m = createDefenseMock(35);
    m.seedUnits(DEFENSE_UNIT_STORAGE_CAP);
    expect(await m.gateway.craftFromBlueprint(CATALOG_FORMATION, 0)).toEqual({
      ok: false,
      code: 'storage-full',
    });
  });
});

describe('제어 표면', () => {
  it('setCurrency 는 지정한 항목만 바꾸고 음수는 0 으로 접는다', () => {
    const m = createDefenseMock(41);
    const before = m.state();
    m.setCurrency({ credits: 500 });
    expect(m.state()).toEqual({ ...before, credits: 500 });
    m.setCurrency({ minerals: -9 });
    expect(m.state().minerals).toBe(0);
  });

  it('getUserId 는 하네스 고정 uid 를 낸다', async () => {
    await expect(createDefenseMock(42).gateway.getUserId()).resolves.toBe('harness-defense-uid');
  });

  it('listBlueprints 는 풀이 비면 빈 목록이다', async () => {
    const m = createDefenseMock(43);
    m.seedUnits(3);
    expect((await m.gateway.listBlueprints()).length).toBeGreaterThan(0);
    m.setCurrency({ blueprints: 0 });
    expect(await m.gateway.listBlueprints()).toEqual([]);
  });
});
