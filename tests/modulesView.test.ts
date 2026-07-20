/**
 * 코어 모듈 화면 계약 테스트 (src/ui/modulesView.ts + src/net/modules.ts — M7b-core-modules).
 *
 * 삭제된 카드 레인의 테스트에서 **코어 모듈에도 유효한 계약만 이식**했다:
 *   - 구 tests/cardsView.test.ts → 등급 색·라벨·어픽스 요약·잔여 경고·보관 게이지·합성 사전
 *     검증·구매 오류 문구·가격(여기, 순수 함수).
 *   - 구 tests/netCards.test.ts → net 계층 no-op 모드·게이트웨이 위임·예외 흡수·상점 재현
 *     (여기, fake 게이트웨이 주입).
 * 버려진 것은 폐지된 개념뿐이다(카드 드랍 확률 = ADR-0018 에서 폐지, tests/coreModules.test.ts
 * 가 "드랍 API 부재"로 반대 방향에서 지킨다).
 *
 * 여기에 더해 **슬롯 2개**라는 M7b 신규 계약을 본다 — 어느 슬롯에 꽂을지 고르는 규칙
 * ({@link pickEquipSlot})이 없으면 두 번째 장착이 첫 슬롯을 조용히 덮어쓴다.
 *
 * Pixi 화면(`src/ui/pixi/modulesView.ts`)은 이 순수 함수들과 공용 부품(scrollArea/listRow)에
 * 위임만 하므로 여기서 캔버스를 띄우지 않는다.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { setLocale } from '../src/i18n/index.js';
import type { ModuleInstance } from '../data/coreModules.js';
import type {
  ModuleOwned,
  ModuleEquipState,
  ModuleBuyResult,
  ModuleFuseResult,
  ModuleSalvageResult,
  ModulesGateway,
} from '../src/net/modules.js';
import {
  getModulesUserId,
  buyShopModule,
  fuseModules,
  salvageModule,
  listModuleInventory,
  fetchModuleEquip,
  equipModules,
  listModuleShopPurchases,
  rollCurrentModuleShop,
  computeShopSeeds,
} from '../src/net/modules.js';
import {
  moduleRarityColor,
  moduleRarityLabel,
  moduleAffixSummary,
  moduleAffixOneLine,
  isLowCharge,
  isDepleted,
  storageGauge,
  checkFusionSelection,
  fusionCheckText,
  buyErrorText,
  shopSlotPrice,
  pickEquipSlot,
} from '../src/ui/modulesView.js';

afterEach(() => setLocale('en'));

function mod(partial: Partial<ModuleInstance> = {}): ModuleInstance {
  return {
    id: 'module-1',
    rarity: 'rare',
    prefixes: [],
    suffixes: [],
    chargesMax: 5,
    chargesLeft: 5,
    seed: 1,
    ...partial,
  };
}

function owned(id: string, rarity: string, chargesLeft = 3): ModuleOwned {
  return { id, rarity, chargesLeft, module: mod({ id, rarity: rarity as ModuleInstance['rarity'] }) };
}

// ---------------------------------------------------------------------------
// 표시 헬퍼(순수)
// ---------------------------------------------------------------------------

describe('modulesView — 등급 색·라벨', () => {
  it('moduleRarityColor 는 등급별 색, 미지 등급은 normal 색', () => {
    expect(moduleRarityColor('unique')).toBe('#ff8a3c');
    expect(moduleRarityColor('rare')).toBe('#ffd24c');
    expect(moduleRarityColor('bogus')).toBe(moduleRarityColor('normal'));
  });

  it('moduleRarityLabel 은 i18n 등급 라벨(로케일 반영)', () => {
    setLocale('en');
    expect(moduleRarityLabel('unique')).toBe('Unique');
    setLocale('ko');
    expect(moduleRarityLabel('unique')).toBe('유니크');
  });
});

describe('modulesView — 모듈 어픽스 요약', () => {
  it('접두·접미 표기명은 i18n 카탈로그에서 온다(데이터의 한글 리터럴 아님)', () => {
    const m = mod({
      rarity: 'unique',
      uniqueId: 'uq-blackout',
      prefixes: [{ id: 'mc-quench', stat: 'incomingDmgReductionPct', value: 12 }],
      suffixes: [{ id: 'mt-fury', stat: 'facilityFireRatePct', value: 20 }],
    });

    setLocale('en');
    const en = moduleAffixSummary(m);
    expect(en.prefixes).toEqual(['Quenching +12']);
    expect(en.suffixes).toEqual(['of Fury +20']);
    expect(en.unique).toBe('Blackout');

    // 같은 인스턴스가 로케일에 따라 다른 표기를 낸다 = 표기가 데이터에 박혀 있지 않다는 증거.
    setLocale('ko');
    const ko = moduleAffixSummary(m);
    expect(ko.prefixes).toEqual(['소화의 +12']);
    expect(ko.unique).toBe('블랙아웃');
  });

  it('normal(어픽스 0) 은 요약 비고 oneLine 은 기저 안내', () => {
    setLocale('en');
    const m = mod({ rarity: 'normal' });
    const s = moduleAffixSummary(m);
    expect(s.prefixes).toEqual([]);
    expect(s.suffixes).toEqual([]);
    expect(s.unique).toBeNull();
    expect(moduleAffixOneLine(m)).toBe('Base effect only');
  });

  it('oneLine 은 유니크 → 접두 → 접미 순으로 잇는다', () => {
    setLocale('en');
    const m = mod({
      rarity: 'unique',
      uniqueId: 'uq-mirror-gate',
      prefixes: [{ id: 'mc-avenger', stat: 'bossDamagePct', value: 50 }],
      suffixes: [{ id: 'mt-bulwark', stat: 'incomingDmgReductionPct', value: 10 }],
    });
    expect(moduleAffixOneLine(m)).toBe('Mirror Gate · Avenging +50 · of the Final Bulwark +10');
  });
});

describe('modulesView — 잔여/보관', () => {
  it('isLowCharge 는 정확히 1회일 때만', () => {
    expect(isLowCharge(1)).toBe(true);
    expect(isLowCharge(2)).toBe(false);
    expect(isLowCharge(0)).toBe(false);
  });

  it('isDepleted 는 0 이하', () => {
    expect(isDepleted(0)).toBe(true);
    expect(isDepleted(1)).toBe(false);
  });

  it('storageGauge 백분율·만석 판정(기본 상한 20)', () => {
    expect(storageGauge(0)).toEqual({ count: 0, cap: 20, pct: 0, full: false });
    expect(storageGauge(10)).toEqual({ count: 10, cap: 20, pct: 50, full: false });
    expect(storageGauge(20)).toEqual({ count: 20, cap: 20, pct: 100, full: true });
    expect(storageGauge(25).full).toBe(true); // 초과도 만석
  });
});

describe('modulesView — 합성 사전 검증(EF 코드 정합)', () => {
  it('정확히 3개·동급·중복없음 → ok', () => {
    const sel = [owned('a', 'rare'), owned('b', 'rare'), owned('c', 'rare')];
    expect(checkFusionSelection(sel)).toEqual({ ok: true, code: 'ok' });
  });

  it('3개 미만/초과 → need-three', () => {
    expect(checkFusionSelection([owned('a', 'rare')]).code).toBe('need-three');
    expect(
      checkFusionSelection([owned('a', 'rare'), owned('b', 'rare'), owned('c', 'rare'), owned('d', 'rare')]).code,
    ).toBe('need-three');
  });

  it('같은 행 중복 → dup-ids', () => {
    const sel = [owned('a', 'rare'), owned('a', 'rare'), owned('c', 'rare')];
    expect(checkFusionSelection(sel).code).toBe('dup-ids');
  });

  it('등급 불일치 → rarity-mismatch', () => {
    const sel = [owned('a', 'rare'), owned('b', 'magic'), owned('c', 'rare')];
    expect(checkFusionSelection(sel).code).toBe('rarity-mismatch');
  });

  it('fusionCheckText: ok 는 빈 문자열, 나머지는 안내', () => {
    setLocale('en');
    expect(fusionCheckText('ok')).toBe('');
    expect(fusionCheckText('need-three')).toContain('3');
    expect(fusionCheckText('rarity-mismatch').length).toBeGreaterThan(0);
  });
});

describe('modulesView — 구매 오류·가격', () => {
  it('buyErrorText 코드별 문구(미지 코드는 일반 실패)', () => {
    setLocale('en');
    expect(buyErrorText('storage-full')).toContain('Storage');
    expect(buyErrorText('insufficient-credits')).toContain('credits');
    expect(buyErrorText('already-bought').length).toBeGreaterThan(0);
    expect(buyErrorText(undefined)).toBe(buyErrorText('weird-unknown-code'));
  });

  it('shopSlotPrice 는 서버 moduleBuyPrice 와 동일(등급 단조)', () => {
    expect(shopSlotPrice('normal')).toBe(40);
    expect(shopSlotPrice('magic')).toBe(100);
    expect(shopSlotPrice('rare')).toBe(160);
    expect(shopSlotPrice('unique')).toBe(220);
  });
});

describe('modulesView — 장착 슬롯 선택(슬롯 2 신규 계약)', () => {
  it('사용자가 고른 슬롯이 최우선(비어 있지 않아도 교체 대상)', () => {
    expect(pickEquipSlot([null, 'm2'], 1)).toBe(1);
    expect(pickEquipSlot(['m1', 'm2'], 0)).toBe(0);
  });

  it('선택이 없으면 첫 빈 슬롯', () => {
    expect(pickEquipSlot([null, null], null)).toBe(0);
    expect(pickEquipSlot(['m1', null], null)).toBe(1);
  });

  it('선택이 없고 두 슬롯이 다 차 있으면 null(임의 덮어쓰기 금지)', () => {
    expect(pickEquipSlot(['m1', 'm2'], null)).toBeNull();
  });

  it('범위 밖 선택은 무시하고 빈 슬롯 규칙으로 접힌다', () => {
    expect(pickEquipSlot(['m1', null], 5)).toBe(1);
    expect(pickEquipSlot(['m1', null], -1)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// net/modules — 구 tests/netCards.test.ts 이식분
// ---------------------------------------------------------------------------

/** 위임·실패 시뮬레이션용 fake 게이트웨이. */
class FakeModulesGateway implements ModulesGateway {
  fail = false;
  uid = 'me-1';
  inventory: ModuleOwned[] = [];
  equip: ModuleEquipState = { defenseId: 'def-1', equipped: [null, null] };
  purchases: number[] = [];
  equipCalls: { defenseId: string; moduleIds: readonly (string | null)[] }[] = [];
  buyResult: ModuleBuyResult = { ok: true, moduleId: 'm9', rarity: 'magic', credits: 500, price: 100 };
  fuseResult: ModuleFuseResult = { ok: true, moduleId: 'm10', rarity: 'rare', promoted: true };
  salvageResult: ModuleSalvageResult = { ok: true, salvaged: 40, credits: 540, rarity: 'rare' };

  async getUserId(): Promise<string> {
    if (this.fail) throw new Error('offline');
    return this.uid;
  }
  async buyShopModule(): Promise<ModuleBuyResult> {
    if (this.fail) throw new Error('offline');
    return this.buyResult;
  }
  async fuseModules(): Promise<ModuleFuseResult> {
    if (this.fail) throw new Error('offline');
    return this.fuseResult;
  }
  async salvageModule(): Promise<ModuleSalvageResult> {
    if (this.fail) throw new Error('offline');
    return this.salvageResult;
  }
  async listInventory(): Promise<ModuleOwned[]> {
    if (this.fail) throw new Error('offline');
    return this.inventory;
  }
  async fetchEquip(): Promise<ModuleEquipState> {
    if (this.fail) throw new Error('offline');
    return this.equip;
  }
  async setEquippedModules(defenseId: string, moduleIds: readonly (string | null)[]): Promise<void> {
    if (this.fail) throw new Error('rejected');
    this.equipCalls.push({ defenseId, moduleIds });
  }
  async listShopPurchases(): Promise<number[]> {
    if (this.fail) throw new Error('offline');
    return this.purchases;
  }
}

describe('net/modules — no-op 모드(미설정)', () => {
  const cfg = { config: null } as const;
  it('공개 함수가 SDK 없이 안전값을 돌려준다', async () => {
    expect(await getModulesUserId(cfg)).toBeNull();
    expect(await buyShopModule(0, cfg)).toBeNull();
    expect(await fuseModules(['a', 'b', 'c'], cfg)).toBeNull();
    expect(await salvageModule('x', cfg)).toBeNull();
    expect(await listModuleInventory(cfg)).toBeNull();
    expect(await fetchModuleEquip(cfg)).toBeNull();
    expect(await equipModules('d', ['c', null], cfg)).toBe(false);
    expect(await listModuleShopPurchases(0, cfg)).toBeNull();
  });
});

describe('net/modules — fake 게이트웨이 위임', () => {
  it('정상 경로: 각 함수가 게이트웨이 결과를 그대로 전달', async () => {
    const g = new FakeModulesGateway();
    const deps = { gateway: g };
    expect(await getModulesUserId(deps)).toBe('me-1');
    expect(await buyShopModule(2, deps)).toEqual(g.buyResult);
    expect(await fuseModules(['a', 'b', 'c'], deps)).toEqual(g.fuseResult);
    expect(await salvageModule('x', deps)).toEqual(g.salvageResult);
    g.inventory = [owned('m1', 'rare')];
    expect(await listModuleInventory(deps)).toBe(g.inventory);
    expect(await fetchModuleEquip(deps)).toEqual(g.equip);
    expect(await equipModules('def-1', ['m1', null], deps)).toBe(true);
    expect(g.equipCalls).toEqual([{ defenseId: 'def-1', moduleIds: ['m1', null] }]);
    g.purchases = [0, 3];
    expect(await listModuleShopPurchases(123, deps)).toEqual([0, 3]);
  });

  it('장착 배열은 고정 길이 2 로 정규화돼 나간다(밀집화·초과 금지)', async () => {
    const g = new FakeModulesGateway();
    // 초과분 절단 + 부족분 null 채움 — 슬롯 i 의미가 왕복에서 보존된다.
    expect(await equipModules('def-1', ['m1', 'm2', 'm3'], { gateway: g })).toBe(true);
    expect(await equipModules('def-1', [], { gateway: g })).toBe(true);
    expect(g.equipCalls.map((c) => c.moduleIds)).toEqual([
      ['m1', 'm2'],
      [null, null],
    ]);
  });

  it('전체 해제(null 배열)도 위임된다', async () => {
    const g = new FakeModulesGateway();
    expect(await equipModules('def-1', [null, null], { gateway: g })).toBe(true);
    expect(g.equipCalls).toEqual([{ defenseId: 'def-1', moduleIds: [null, null] }]);
  });

  it('게이트웨이 예외는 삼키고 안전값 반환(throw 안 함)', async () => {
    const g = new FakeModulesGateway();
    g.fail = true;
    const deps = { gateway: g };
    expect(await buyShopModule(0, deps)).toBeNull();
    expect(await fuseModules(['a', 'b', 'c'], deps)).toBeNull();
    expect(await salvageModule('x', deps)).toBeNull();
    expect(await listModuleInventory(deps)).toBeNull();
    expect(await fetchModuleEquip(deps)).toBeNull();
    expect(await equipModules('d', ['c', null], deps)).toBe(false);
    expect(await listModuleShopPurchases(0, deps)).toBeNull();
  });
});

describe('net/modules — 상점 로테이션 재현(순수·결정론)', () => {
  it('같은 uid+nowMs 는 동일 재고(서버 호출 없음)', () => {
    const now = 1_760_000_000_000;
    const a = rollCurrentModuleShop('user-abc', now);
    const b = rollCurrentModuleShop('user-abc', now);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    // 재고는 normal·magic 만(레어 이상은 상점에 없다).
    for (const m of a) expect(['normal', 'magic']).toContain(m.rarity);
  });

  it('다른 uid 는 (대개) 다른 재고 시드, computeShopSeeds 는 순수', () => {
    const now = 1_760_000_000_000;
    const s1 = computeShopSeeds('user-abc', now);
    const s2 = computeShopSeeds('user-xyz', now);
    expect(s1.dateSeed).toBe(s2.dateSeed); // 같은 날
    expect(s1.userSeed).not.toBe(s2.userSeed); // 다른 유저
  });
});
