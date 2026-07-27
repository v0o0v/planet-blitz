/**
 * 같은 유니크 중복 장착 차단 회귀 스위트 (사용자 신고 2026-07-28).
 *
 * 네 층으로 방어한다 — 이 저장소의 시그니처 결함이 "단위 테스트는 그린인데 배선이 통째로 없다"라서
 * 순수 술어만 검증하면 게이트가 죽은 경로에 붙어도 초록불이 켜진다.
 *  ① **재현(현행 거동 확정)** — 같은 `uniqueId` 를 두 칸에 넣은 로드아웃의 파생 스탯이 한 칸만
 *     넣은 것과 **완전히 같다**(= 두 번째 사본이 통째로 낭비된다). 이 결함의 존재 자체를 못 박는다.
 *  ② 순수 술어(`duplicateUniqueSlot`·`redundantUniqueIndices`) — 경계·교체 예외.
 *  ③ grep 게이트 — 프로덕션 `src/ui/pixi/hangar.ts` 의 `equip()` 본문이 실제로 술어를 부르고
 *     **사유를 보여 주는지**(hint) 소스에서 정적 단언(`tests/requiredLevel.test.ts` AC3 양식 미러).
 *  ④ 프로덕션 경로 통합 — 실제 `HangarScreen` 을 띄우고 화면이 클릭에서 부르는 그 `equip()` 을
 *     불러, 두 번째 사본이 장착되지 않고 힌트 문구가 뜨는지 관측한다.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { Container, DOMAdapter } from 'pixi.js';
import '../data/uniques.js'; // side-effect: UNIQUE_REGISTRY 에 유니크 15종 등록

import { duplicateUniqueSlot, redundantUniqueIndices } from '../src/items/uniqueEquip.js';
import { computeLoadoutStats } from '../src/items/loadout.js';
import { HangarScreen } from '../src/ui/pixi/hangar.js';
import { defaultProfile, activeShip, type Profile } from '../src/save/profile.js';
import { t } from '../src/i18n/index.js';
import { itemDisplayName } from '../src/ui/itemNames.js';
import type { EquipSlotId, Item, Rarity, SlotKind } from '../src/items/types.js';

// ---------------------------------------------------------------------------
// 공통 헬퍼
// ---------------------------------------------------------------------------

/**
 * 최소 Item 리터럴. **어픽스를 0개로 둔다** — 유니크 사본을 두 개 꽂으면 어픽스는 정상적으로
 * 두 번 합산되므로(무효인 것은 유니크 비트뿐), 어픽스가 있으면 ① 재현 테스트에서 "스탯이 같다"가
 * 성립하지 않아 결함의 정확한 모양을 놓친다.
 *
 * `stage: 1` 이면 드랍처 상한이 밴드 시작 레벨 1 이라 요구 레벨도 1 로 눌린다 — 레벨 게이트가
 * 이 테스트를 가리지 않는다(모듈 유니크의 저작 reqLevel 은 16·20).
 */
function uniqueItem(id: string, uniqueId: string, slot: SlotKind = 'module'): Item {
  return {
    id,
    slot,
    rarity: 'unique' as Rarity,
    affixes: [],
    uniqueId,
    source: { planet: 0, stage: 1 },
  };
}

/** 유니크가 아닌 대조군(같은 슬롯). */
function plainItem(id: string, slot: SlotKind = 'module'): Item {
  return { id, slot, rarity: 'normal' as Rarity, affixes: [], source: { planet: 0, stage: 1 } };
}

/** module 슬롯에 저작된 유니크 2종(data/uniques.ts M3) — 장착 칸이 2개라 가장 쉽게 재현된다. */
const MOD_A = 'gambler-chip';
const MOD_B = 'relic-amplifier';

// ---------------------------------------------------------------------------
// ① 재현 — 두 번째 사본은 통째로 낭비된다 (현행 거동 확정)
// ---------------------------------------------------------------------------

describe('① 재현: 같은 유니크 두 칸 = 한 칸과 파생 스탯이 동일하다', () => {
  it('module 2칸에 같은 uniqueId 를 넣어도 uniqueMask 와 loadout 전체가 한 칸일 때와 같다', () => {
    const one = computeLoadoutStats([uniqueItem('m0', MOD_A)]);
    const two = computeLoadoutStats([uniqueItem('m0', MOD_A), uniqueItem('m1', MOD_A)]);

    // 비트 OR 라 같은 비트를 두 번 세워도 마스크가 안 변한다 = 두 번째 칸이 아무 일도 안 한다.
    expect(two.loadout.uniqueMask).toBe(one.loadout.uniqueMask);
    expect(two.loadout).toEqual(one.loadout);
    expect(two.worldMods).toEqual(one.worldMods);
  });

  it('대조군: 서로 다른 유니크 2종이면 마스크가 실제로 늘어난다', () => {
    const one = computeLoadoutStats([uniqueItem('m0', MOD_A)]);
    const mixed = computeLoadoutStats([uniqueItem('m0', MOD_A), uniqueItem('m1', MOD_B)]);
    expect(mixed.loadout.uniqueMask).not.toBe(one.loadout.uniqueMask);
    // 한 칸 마스크를 완전히 포함하면서 비트가 더 켜져 있다.
    expect(mixed.loadout.uniqueMask & one.loadout.uniqueMask).toBe(one.loadout.uniqueMask);
  });
});

// ---------------------------------------------------------------------------
// ② 순수 술어
// ---------------------------------------------------------------------------

describe('② duplicateUniqueSlot — 순수 술어', () => {
  it('빈 장착 표에는 충돌이 없다', () => {
    expect(duplicateUniqueSlot({}, uniqueItem('m', MOD_A), 'module0')).toBeNull();
  });

  it('다른 칸에 같은 유니크가 있으면 그 칸 id 를 돌려준다', () => {
    const equipped: Partial<Record<EquipSlotId, Item>> = { module0: uniqueItem('a', MOD_A) };
    expect(duplicateUniqueSlot(equipped, uniqueItem('b', MOD_A), 'module1')).toBe('module0');
  });

  it('다른 유니크는 충돌이 아니다', () => {
    const equipped: Partial<Record<EquipSlotId, Item>> = { module0: uniqueItem('a', MOD_A) };
    expect(duplicateUniqueSlot(equipped, uniqueItem('b', MOD_B), 'module1')).toBeNull();
  });

  it('유니크가 아닌 아이템은 항상 통과한다', () => {
    const equipped: Partial<Record<EquipSlotId, Item>> = { module0: plainItem('a') };
    expect(duplicateUniqueSlot(equipped, plainItem('b'), 'module1')).toBeNull();
  });

  it('대상 칸 자신은 판정에서 제외된다 (같은 유니크로 갈아끼우기는 허용)', () => {
    // 모듈 2칸이 다 찼을 때 격납고는 module0 을 교체 대상으로 고른다. 그 칸의 기존 아이템은
    // 밀려나므로 결과는 중복이 아니다 — 여기서 막으면 정상적인 교체까지 못 하게 된다.
    const equipped: Partial<Record<EquipSlotId, Item>> = {
      module0: uniqueItem('old', MOD_A),
      module1: uniqueItem('other', MOD_B),
    };
    expect(duplicateUniqueSlot(equipped, uniqueItem('new', MOD_A), 'module0')).toBeNull();
    // 반대로 module1 을 노리면 module0 과 충돌한다.
    expect(duplicateUniqueSlot(equipped, uniqueItem('new', MOD_A), 'module1')).toBe('module0');
  });

  it('슬롯 종류가 달라도 같은 uniqueId 면 충돌이다 (판정 기준은 슬롯이 아니라 uniqueId)', () => {
    const equipped: Partial<Record<EquipSlotId, Item>> = { core: uniqueItem('a', MOD_A, 'core') };
    expect(duplicateUniqueSlot(equipped, uniqueItem('b', MOD_A), 'module0')).toBe('core');
  });
});

describe('② redundantUniqueIndices — 무효 사본 표시용', () => {
  it('두 번째 이후 등장만 무효로 센다', () => {
    const idx = redundantUniqueIndices([
      uniqueItem('a', MOD_A),
      uniqueItem('b', MOD_B),
      uniqueItem('c', MOD_A),
      plainItem('d'),
    ]);
    expect([...idx]).toEqual([2]);
  });

  it('중복이 없으면 빈 집합', () => {
    expect(redundantUniqueIndices([uniqueItem('a', MOD_A), uniqueItem('b', MOD_B)]).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ③ grep 게이트 — 프로덕션 hangar.ts 에 실제로 배선됐는지 정적 단언
// ---------------------------------------------------------------------------

describe('③ 프로덕션 장착 경로 grep 게이트 (src/ui/pixi/hangar.ts)', () => {
  // Windows 경로(`/D:/...`) 보정은 `tests/requiredLevel.test.ts` 의 readSrc 양식과 같다.
  const HANGAR = new TextDecoder().decode(
    readFileSync(
      new URL('../src/ui/pixi/hangar.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    ),
  );

  it('hangar.ts 가 uniqueEquip 모듈에서 duplicateUniqueSlot 을 import 한다', () => {
    expect(
      /import\s*\{[^}]*\bduplicateUniqueSlot\b[^}]*\}\s*from\s*['"][^'"]*uniqueEquip/.test(HANGAR),
    ).toBe(true);
  });

  it('equip() 본문이 duplicateUniqueSlot 을 부르고 **사유를 보여 준다**', () => {
    // 술어가 다른(죽은) 메서드에 붙고 정작 equip 은 무방비인 오배선을 여기서 잡는다.
    const body = HANGAR.match(/private equip\(item: Item\): void \{([\s\S]*?)\n {2}\}/);
    expect(body, 'hangar.ts 에서 equip 메서드를 찾지 못했다').not.toBeNull();
    const src = body?.[1] ?? '';
    expect(/\bduplicateUniqueSlot\(/.test(src), 'equip 이 중복 유니크 술어를 부르지 않는다').toBe(true);
    // 무음 거부 금지 — 거부 분기가 hint 를 세워야 한다.
    expect(
      /this\.hint = t\('inv\.err\.duplicateUnique'/.test(src),
      '중복 거부가 사유(hint)를 보여 주지 않는다 — 무음 거부는 버그로 신고된다',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ④ 프로덕션 경로 통합 — 실제 HangarScreen.equip()
// ---------------------------------------------------------------------------

/**
 * Pixi `Text` 는 캔버스 텍스트 측정을 요구한다. node 에는 캔버스가 없으므로 **측정만 되는**
 * 최소 어댑터를 끼운다(`tests/pixiScreenPersistence.test.ts` 선례 — 폭 정확도는 관심사가 아니다).
 */
function installCanvasStub(): void {
  const makeContext = (): unknown => ({
    font: '',
    fillStyle: '',
    strokeStyle: '',
    textBaseline: 'alphabetic',
    letterSpacing: '0px',
    measureText: (text: string) => ({
      width: text.length * 8,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: text.length * 8,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
      fontBoundingBoxAscent: 8,
      fontBoundingBoxDescent: 2,
    }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    fillRect: () => {},
    clearRect: () => {},
    fillText: () => {},
    strokeText: () => {},
    save: () => {},
    restore: () => {},
    scale: () => {},
    translate: () => {},
    setTransform: () => {},
    drawImage: () => {},
  });
  const makeCanvas = (width = 1, height = 1): unknown => {
    const ctx = makeContext();
    return { width, height, style: {}, getContext: () => ctx };
  };
  const base = DOMAdapter.get() as unknown as Record<string, unknown>;
  DOMAdapter.set({
    ...base,
    createCanvas: (w?: number, h?: number) => makeCanvas(w, h),
    getCanvasRenderingContext2D: () => class {},
    getWebGLRenderingContext: () => class {},
  } as never);
}

interface GlobalStubs {
  localStorage?: unknown;
  document?: unknown;
}

const g = globalThis as unknown as GlobalStubs;
let hadLocalStorage = false;
let hadDocument = false;

beforeEach(() => {
  hadLocalStorage = 'localStorage' in g;
  hadDocument = 'document' in g;
  if (!hadLocalStorage) {
    const map = new Map<string, string>();
    g.localStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
  }
  if (!hadDocument) {
    const hud = { style: { visibility: '' } };
    g.document = { getElementById: (id: string) => (id === 'pb-hud' ? hud : null) };
  }
  installCanvasStub();
});

afterEach(() => {
  if (!hadLocalStorage) delete g.localStorage;
  if (!hadDocument) delete g.document;
});

describe('④ 프로덕션 경로 통합 — HangarScreen.equip() 이 두 번째 사본을 거부한다', () => {
  /** 화면이 실제 클릭에서 부르는 그 메서드 + 힌트 필드. */
  function open(profile: Profile): { equip(i: Item): void; hint: string } {
    const stage = new Container();
    const hangar = new HangarScreen(profile, stage);
    hangar.show(profile, () => {});
    return hangar as unknown as { equip(i: Item): void; hint: string };
  }

  it('module 두 칸에 같은 유니크를 넣으려 하면 두 번째는 장착되지 않고 사유가 뜬다', () => {
    const profile = defaultProfile();
    const a = uniqueItem('mod-a', MOD_A);
    const b = uniqueItem('mod-b', MOD_A); // 같은 유니크의 다른 사본
    profile.inventory.push(a, b);
    const h = open(profile);
    const ship = activeShip(profile);

    h.equip(a);
    expect(ship.equipped.module0?.id, '첫 사본은 정상 장착돼야 한다').toBe('mod-a');

    h.equip(b);
    expect(ship.equipped.module1, '두 번째 사본이 장착되면 안 된다').toBeUndefined();
    expect(profile.inventory, '거부된 아이템은 인벤토리에 남아야 한다').toContain(b);
    // 무음 거부 금지 — 왜 안 되는지 화면에 뜬다(문구는 i18n 정본과 글자 단위로 일치).
    expect(h.hint).toBe(t('inv.err.duplicateUnique', { name: itemDisplayName(b) }));
  });

  it('대조군: 다른 유니크는 두 번째 모듈 칸에 정상 장착된다', () => {
    const profile = defaultProfile();
    const a = uniqueItem('mod-a', MOD_A);
    const b = uniqueItem('mod-b', MOD_B);
    profile.inventory.push(a, b);
    const h = open(profile);
    const ship = activeShip(profile);

    h.equip(a);
    h.equip(b);
    expect(ship.equipped.module0?.id).toBe('mod-a');
    expect(ship.equipped.module1?.id).toBe('mod-b');
  });

  it('두 칸이 다 찼을 때 같은 유니크로 갈아끼우기는 허용된다 (교체 = 중복 아님)', () => {
    const profile = defaultProfile();
    const a = uniqueItem('mod-a', MOD_A);
    const b = uniqueItem('mod-b', MOD_B);
    const a2 = uniqueItem('mod-a2', MOD_A); // module0 을 밀어내고 들어간다
    profile.inventory.push(a, b, a2);
    const h = open(profile);
    const ship = activeShip(profile);

    h.equip(a);
    h.equip(b);
    h.equip(a2);
    expect(ship.equipped.module0?.id, 'module0 이 새 사본으로 교체돼야 한다').toBe('mod-a2');
    expect(ship.equipped.module1?.id).toBe('mod-b');
    expect(profile.inventory, '밀려난 사본은 인벤토리로 돌아온다').toContain(a);
    // 결과 장착 표에 같은 유니크가 둘이 아니다(불변식).
    expect(redundantUniqueIndices([ship.equipped.module0 as Item, ship.equipped.module1 as Item]).size).toBe(0);
  });
});
