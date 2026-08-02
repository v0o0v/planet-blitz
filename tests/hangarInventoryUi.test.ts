/**
 * 격납고 인벤토리/창고 UI **배선** 회귀 테스트.
 *
 * ## 왜 순수 함수 테스트만으로는 부족한가
 * 이 프로젝트의 반복 결함은 "단위 테스트는 그린인데 배선이 통째로 없다" 다. `arrangeItems`·
 * `fitGridCols` 가 아무리 옳아도 격납고가 그것을 **부르지 않으면** 화면은 그대로다. 그래서 여기서는
 * 실제 `HangarScreen` 을 띄우고 **씬 그래프에 그려진 것**을 본다:
 *   ① 촉매 버튼이 설정 톱니 밴드와 겹치지 않는 좌표에 있는가(추가 임무 5),
 *   ② '기체 교체' 버튼이 만렙 미만에서 잠기는가(추가 임무 6-a),
 *   ③ 분류 탭을 실제로 누르면 그리드 셀 수가 바뀌는가(= 필터가 렌더에 연결됐는가),
 *   ④ 창고 확장 거부 사유(잔액 부족 / 서버 불통)가 **서로 다른 문구**로 나오는가.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Container, Text, DOMAdapter } from 'pixi.js';

import { HangarScreen } from '../src/ui/pixi/hangar.js';
import { makeCinematicPanel } from '../src/ui/pixi/cinematicPanel.js';
import { PixiButton } from '../src/ui/pixi/button.js';
import {
  defaultProfile,
  activeShip,
  stashCapacity,
  INVENTORY_CAP,
  type Profile,
} from '../src/save/profile.js';
import { rollItem } from '../src/items/roll.js';
import type { Item, SlotKind } from '../src/items/types.js';
import { LEVEL_CAP } from '../data/waves.js';
import { stashExpansionCost } from '../data/economy.js';
import { t } from '../src/i18n/index.js';
import * as net from '../src/net/index.js';

// ---------------------------------------------------------------------------
// 씬 그래프 조회 헬퍼
// ---------------------------------------------------------------------------

/** 이 컨테이너(자손 포함) 안에 주어진 문자열의 Text 가 있는가. */
function hasLabel(node: Container, label: string): boolean {
  if (node instanceof Text && node.text === label) return true;
  for (const c of node.children) {
    if (c instanceof Container && hasLabel(c, label)) return true;
  }
  return false;
}

/**
 * root 의 직계 자식 중 해당 라벨을 품은 것(= 버튼 컨테이너).
 *
 * ⚠️ 같은 문자열이 화면 여러 곳에 나온다('주무기' 는 스탯 행·쇼케이스 슬롯 라벨·창고 탭·인벤토리
 * 탭 넷 다). 그래서 영역(`minX`/`minY`)으로 어느 패널의 것인지를 못 박는다 — 안 그러면 클릭이
 * 엉뚱한 Text 로 가서 아무 일도 안 일어나고 테스트만 조용히 통과한다.
 */
function buttonByLabel(root: Container, label: string, region?: { minX?: number; maxX?: number; minY?: number }): Container {
  for (const child of root.children) {
    if (!(child instanceof Container) || !hasLabel(child, label)) continue;
    if (region !== undefined) {
      const b = child.getBounds();
      if (region.minX !== undefined && b.x < region.minX) continue;
      if (region.maxX !== undefined && b.x > region.maxX) continue;
      if (region.minY !== undefined && b.y < region.minY) continue;
    }
    return child;
  }
  throw new Error(`라벨 "${label}" 버튼을 씬 그래프에서 찾지 못했다`);
}

/** 인벤토리 패널(우측 하단) 안의 컨트롤만 고른다. */
const INV_PANEL = { minX: 944, minY: 620 } as const;

/** 버튼 탭(실제 리스너 호출). Pixi 의 타입드 emit 은 이벤트 인자를 요구하므로 느슨하게 부른다. */
function tap(node: Container): void {
  (node as unknown as { emit(ev: string): void }).emit('pointertap');
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectOf(node: Container): Rect {
  const b = node.getBounds();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** 슬롯 셀(makeSlotCell)만 세려면 아이템 있는 셀을 식별해야 하므로 클립 콘텐츠 자식 수를 쓴다. */
function itemOfSlot(seed: number, want: SlotKind, rarity: Item['rarity'] = 'normal'): Item {
  for (let s = seed; s < seed + 5000; s++) {
    const it = rollItem(s, rarity, { planet: 0, stage: 1 });
    if (it.slot === want) return it;
  }
  throw new Error(`슬롯 ${want} 아이템을 굴리지 못했다`);
}

/**
 * 설정 톱니가 점유하는 **디자인 스페이스** 사각형.
 * 하네스 실측은 CSS 픽셀 (16, 13, 51×51) 이고 레터박스 배율은 ≈0.6646(= CSS 85 / 디자인 128,
 * 촉매 버튼 실측으로 역산) 이므로 디자인 좌표로는 (24, 20) 77×77 이다.
 */
const GEAR_RECT: Rect = { x: 24, y: 20, w: 77, h: 77 };
/** 톱니 주변 예약 밴드(여유 포함) — 격납고 UI 는 이 안에 아무것도 두지 않는다. */
const GEAR_BAND: Rect = { x: 0, y: 0, w: 120, h: 120 };

let stage: Container;
let hangar: HangarScreen;
let profile: Profile;

function open(p: Profile = defaultProfile()): void {
  profile = p;
  stage = new Container();
  hangar = new HangarScreen(profile, stage);
  hangar.show(profile, () => {});
}

function root(): Container {
  return (hangar as unknown as { root: Container }).root;
}

// ---------------------------------------------------------------------------
// node 환경 스텁(캔버스 없이 Pixi 표시 객체만 쓴다 — pixiScreenPersistence.test.ts 선례).
// 버튼 배경은 텍스처가 없어 Graphics 폴백으로 그려지므로 bounds 는 지정한 width/height 그대로다.
// ---------------------------------------------------------------------------

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
  const makeCanvas = (width = 1, height = 1): unknown => ({
    width,
    height,
    style: {},
    getContext: () => makeContext(),
  });
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
  const map = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  if (!hadDocument) {
    const hud = { style: { visibility: '' } };
    g.document = { getElementById: (id: string) => (id === 'pb-hud' ? hud : null) };
  }
  installCanvasStub();
});

afterEach(() => {
  if (!hadLocalStorage) delete g.localStorage;
  if (!hadDocument) delete g.document;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// (5) 촉매 버튼 ↔ 설정 톱니 겹침
// ---------------------------------------------------------------------------

describe('격납고 상단 행 — 촉매 버튼이 설정 톱니를 피한다 (추가 임무 5)', () => {
  it('촉매 버튼이 톱니 실측 사각형과도, 예약 밴드와도 겹치지 않는다', () => {
    open();
    const cat = rectOf(buttonByLabel(root(), t('catalyst.manage.open')));
    // 좌표를 못 박아 둔다 — 누가 다시 좌상단으로 옮기면 여기서 먼저 걸린다.
    // (배치는 132,26 = 헤더 밴드의 컨트롤 띠이고, bounds 는 폴백 Graphics 테두리 2px 만큼
    // 바깥으로 1px 넓다. 시네마틱 전환에서 헤더 밴드가 104px 로 생기며 y 가 18 → 26 으로 갔다.)
    expect({ x: Math.round(cat.x), y: Math.round(cat.y) }).toEqual({ x: 131, y: 25 });
    expect({ w: Math.round(cat.w), h: Math.round(cat.h) }).toEqual({ w: 130, h: 54 });
    expect(intersects(cat, GEAR_RECT), `촉매 ${JSON.stringify(cat)} 가 톱니와 겹친다`).toBe(false);
    expect(intersects(cat, GEAR_BAND), `촉매 ${JSON.stringify(cat)} 가 예약 밴드 안이다`).toBe(false);
    // 밴드를 오른쪽으로 벗어나는 방식이어야 한다(아래로 내리면 스탯 패널을 침범한다).
    expect(cat.x).toBeGreaterThanOrEqual(GEAR_BAND.w);
  });

  it('상단 우측 버튼군·재화 칩 어느 것과도 겹치지 않는다', () => {
    open();
    const r = root();
    const cat = rectOf(buttonByLabel(r, t('catalyst.manage.open')));
    for (const label of [t('hangar.act.guardians'), t('hangar.act.swapShip')]) {
      expect(intersects(cat, rectOf(buttonByLabel(r, label))), `촉매 ↔ ${label}`).toBe(false);
    }
    // 크레딧 칩(재화 표시)과도 떨어져 있어야 한다.
    const chip = rectOf(buttonByLabel(r, String(profile.credits)));
    expect(intersects(cat, chip), '촉매 ↔ 크레딧 칩').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (6-a) 기체 교체 = 만렙 전용
// ---------------------------------------------------------------------------

describe('격납고 — 기체 교체는 만렙에서만 (추가 임무 6-a)', () => {
  it('만렙 미만이면 버튼이 비활성이고 이유가 화면에 남는다', () => {
    const p = defaultProfile();
    activeShip(p).level = LEVEL_CAP - 1;
    open(p);
    const swap = buttonByLabel(root(), t('hangar.act.swapShip'));
    expect(swap.eventMode, '비활성 버튼인데 이벤트를 받는다').toBe('none');
    expect(swap.alpha).toBeLessThan(1);
    const why = t('hangar.err.swapNeedMaxLevel', { n: LEVEL_CAP, lv: LEVEL_CAP - 1 });
    expect(hasLabel(root(), why), '잠긴 이유가 화면에 없다').toBe(true);
  });

  it('만렙이면 버튼이 활성이고 잠금 안내가 사라진다', () => {
    const p = defaultProfile();
    activeShip(p).level = LEVEL_CAP;
    open(p);
    const swap = buttonByLabel(root(), t('hangar.act.swapShip'));
    expect(swap.eventMode).toBe('static');
    expect(swap.alpha).toBe(1);
    expect(hasLabel(root(), t('hangar.err.swapNeedMaxLevel', { n: LEVEL_CAP, lv: LEVEL_CAP }))).toBe(false);
  });

  it('게이트가 어긋나도 진입은 막힌다(핸들러 안 2차 확인)', () => {
    const p = defaultProfile();
    activeShip(p).level = 1;
    open(p);
    const spy = vi.spyOn(
      hangar as unknown as { openChampionSelect(): void },
      'openChampionSelect',
    );
    // 비활성이라 클릭은 안 오지만, 핸들러를 직접 불러도 진입하지 않아야 한다.
    const swap = buttonByLabel(root(), t('hangar.act.swapShip'));
    tap(swap);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (2) 분류 탭이 실제 렌더에 연결됐는가
// ---------------------------------------------------------------------------

/** 인벤토리 클립 콘텐츠의 자식 수 = 그려진 셀 수(빈 칸 포함). */
function inventoryCellCount(): number {
  // 클립 Container 는 자식이 content 하나뿐이고, content 자식이 셀이다. 인벤토리 패널은 우측
  // (px=944) 이므로 x 좌표로 창고 클립과 구분한다.
  let found = -1;
  for (const child of root().children) {
    if (!(child instanceof Container)) continue;
    if (child.children.length !== 1) continue;
    const content = child.children[0];
    if (!(content instanceof Container) || content.children.length === 0) continue;
    // ⚠️ y 조건이 없으면 **헤더 버튼**(우상단, x 1560~1840)이 걸린다 — PixiButton 도 자식이
    // `inner` 하나뿐이라 이 술어를 통과하고, 루프가 마지막 매치를 취하므로 조용히 3(= inner 의
    // bg/gloss/label)을 돌려준다. 시네마틱 전환에서 헤더를 패널 **뒤에** 그리게 되면서 순서가
    // 뒤집혀 실제로 그렇게 됐다. 하단 패널 y 로 못 박는다(창고 헬퍼가 이미 쓰던 규율).
    if (child.x > 900 && child.y > 700) found = content.children.length;
  }
  if (found < 0) throw new Error('인벤토리 그리드 클립을 찾지 못했다');
  return found;
}

/** 창고 그리드 클립(좌측 px=24)의 셀 수. */
function stashCellCount(): number {
  let found = -1;
  for (const child of root().children) {
    if (!(child instanceof Container)) continue;
    if (child.children.length !== 1 || child.y < 700) continue; // 하단 패널만(스탯 스크롤 배제)
    const content = child.children[0];
    if (!(content instanceof Container) || content.children.length === 0) continue;
    if (child.x < 900) found = content.children.length;
  }
  if (found < 0) throw new Error('창고 그리드 클립을 찾지 못했다');
  return found;
}

/** 창고 패널(좌측 하단) 안의 컨트롤만 고른다. */
const STASH_PANEL = { maxX: 900, minY: 620 } as const;

/** 일괄 분해 호출(private — 출처 인자 포함). */
function salvage(
  source: 'inventory' | 'stash',
  rarities: readonly Item['rarity'][],
): Promise<void> {
  return (
    hangar as unknown as {
      salvageByRarities(s: 'inventory' | 'stash', r: readonly Item['rarity'][]): Promise<void>;
    }
  ).salvageByRarities(source, rarities);
}

/** 그리드 클립 안에서 i 번째 **아이템 있는** 셀(= 포인터 리스너가 달린 것)을 고른다. */
function gridCells(side: 'stash' | 'inventory'): Container[] {
  // ⚠️ "자식이 하나인 Container" 는 화면에 여럿이고, **스탯 패널의 스크롤 영역이 창고 그리드와
  // x 가 같다**(둘 다 좌측 px=24 → contentX=84). 자식 수가 가장 많은 것을 고르는 식으로 찾으면
  // 스탯 스크롤(41칸)이 창고 그리드(32칸)를 이겨 빈 배열이 나오고, 그러면 **테스트가 조용히
  // 아무것도 검증하지 않는다**(하네스 실측으로 드러난 함정). 하단 패널 y 로 못 박는다.
  let best: Container | null = null;
  for (const child of root().children) {
    if (!(child instanceof Container) || child.children.length !== 1) continue;
    if (child.y < 700) continue; // 하단(창고·인벤토리) 패널의 그리드 클립만
    const content = child.children[0];
    if (!(content instanceof Container) || content.children.length === 0) continue;
    const isStash = child.x < 900;
    if ((side === 'stash') !== isStash) continue;
    if (best === null || content.children.length > best.children.length) best = content;
  }
  if (best === null) throw new Error(`${side} 그리드를 찾지 못했다`);
  const cells = best.children.filter(
    (c): c is Container => c instanceof Container && c.eventMode === 'static',
  );
  if (cells.length === 0) throw new Error(`${side} 그리드에 아이템 셀이 없다`);
  return cells;
}

function rightClick(node: Container): void {
  (node as unknown as { emit(ev: string): void }).emit('rightclick');
}

describe('격납고 인벤토리 — 분류 탭이 그리드에 연결돼 있다', () => {
  it('슬롯 탭을 누르면 그려지는 셀 수가 필터 결과로 줄어든다', () => {
    const p = defaultProfile();
    p.inventory.push(itemOfSlot(11, 'main'), itemOfSlot(21, 'engine'), itemOfSlot(31, 'armor'));
    open(p);
    const all = inventoryCellCount();
    expect(all, '필터 없을 때는 용량(48칸)을 그린다').toBe(48);

    // 실제 사용자 경로: 탭 버튼을 누른다(내부 상태를 직접 만지지 않는다).
    tap(buttonByLabel(root(), t('item.slot.main'), INV_PANEL));
    expect(inventoryCellCount(), 'main 필터 후 셀 수가 그대로다 = 필터가 렌더에 안 걸렸다')
      .toBeLessThan(all);

    // 전체로 되돌리면 다시 용량 전체.
    tap(buttonByLabel(root(), t('inv.filter.all'), INV_PANEL));
    expect(inventoryCellCount()).toBe(48);
  });

  it('정렬 순환 버튼이 라벨을 바꾸며 상태를 보존한다', () => {
    open();
    tap(buttonByLabel(root(), t('inv.act.sort', { v: t('inv.sort.default') }), INV_PANEL));
    expect(hasLabel(root(), t('inv.act.sort', { v: t('inv.sort.rarity') }))).toBe(true);
  });

  it('필터 결과가 0개면 안내 문구를 낸다', () => {
    const p = defaultProfile();
    p.inventory.push(itemOfSlot(11, 'main'));
    open(p);
    tap(buttonByLabel(root(), t('item.slot.shield'), INV_PANEL));
    expect(hasLabel(root(), t('inv.filter.empty'))).toBe(true);
  });

  /**
   * 필터가 켜져 있으면 일괄 분해는 **보이는 것만** 지워야 한다.
   *
   * 분해는 되돌릴 수 없다. 등급만 걸러 인벤토리 전체를 대상으로 삼으면, `주무기` 탭을 켜서
   * 무기만 보고 있던 사용자가 화면에 없던 방어구까지 통째로 잃는다(분류 필터 도입이 만든
   * 위험 — 그 전에는 "인벤토리 전체 = 보이는 것" 이라 괴리가 없었다).
   */
  it('필터가 켜져 있으면 일괄 분해가 화면 밖 아이템을 건드리지 않는다', async () => {
    const p = defaultProfile();
    const weapon = itemOfSlot(11, 'main', 'normal');
    const armorA = itemOfSlot(31, 'armor', 'normal');
    const armorB = itemOfSlot(41, 'armor', 'normal');
    p.inventory.push(weapon, armorA, armorB);
    open(p);

    // 주무기 탭 — 화면에는 무기 1개만 보인다.
    tap(buttonByLabel(root(), t('item.slot.main'), INV_PANEL));

    await salvage('inventory', ['normal', 'magic']);

    expect(profile.inventory, '보이지 않던 방어구 2개가 함께 분해됐다').toHaveLength(2);
    expect(profile.inventory.map((it) => it.slot).sort()).toEqual(['armor', 'armor']);
    expect(profile.inventory.some((it) => it.id === weapon.id), '보이던 무기는 분해됐어야 한다')
      .toBe(false);
  });

  it('필터가 없으면 종전대로 인벤토리 전체가 대상이다', async () => {
    const p = defaultProfile();
    p.inventory.push(
      itemOfSlot(11, 'main', 'normal'),
      itemOfSlot(31, 'armor', 'normal'),
      itemOfSlot(41, 'armor', 'normal'),
    );
    open(p);

    await salvage('inventory', ['normal', 'magic']);

    expect(profile.inventory, '필터 없을 때는 전부 분해돼야 한다').toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (3) 창고 확장 거부 사유 구분
// ---------------------------------------------------------------------------

describe('창고 확장 — 서버 거부 사유가 문구로 갈린다', () => {
  async function expand(): Promise<void> {
    await (hangar as unknown as { expandStash(): Promise<void> }).expandStash();
  }

  it('잔액 부족(insufficient)이면 서버 잔액을 함께 알린다 — 확장 없음', async () => {
    const p = defaultProfile();
    p.credits = 11_201; // 하네스 치트로 부푼 로컬 미러
    open(p);
    vi.spyOn(net, 'spendCurrencyOnServer').mockResolvedValue({
      status: 'rejected',
      reason: 'insufficient',
      creditsLeft: 0,
      mineralsLeft: 0,
    });
    const cost = stashExpansionCost(0);
    await expand();
    expect(profile.stashExpansions, '거부됐는데 확장이 적용됐다(서버 권위 위반)').toBe(0);
    expect(profile.credits, '거부됐는데 로컬 크레딧이 깎였다').toBe(11_201);
    expect(hasLabel(root(), t('spend.err.rejectedCredits', { n: cost, have: 0 }))).toBe(true);
  });

  it('서버 불통(unavailable)이면 "부족" 이 아니라 통신 실패를 알린다 — 확장 없음', async () => {
    const p = defaultProfile();
    p.credits = 11_201;
    open(p);
    vi.spyOn(net, 'spendCurrencyOnServer').mockResolvedValue({
      status: 'rejected',
      reason: 'unavailable',
    });
    await expand();
    expect(profile.stashExpansions).toBe(0);
    expect(hasLabel(root(), t('spend.err.unavailable')), '통신 실패 문구가 없다').toBe(true);
    expect(
      hasLabel(root(), t('spend.err.rejectedCredits', { n: stashExpansionCost(0), have: 0 })),
      '통신 실패인데 잔액 부족이라고 말한다',
    ).toBe(false);
  });

  it('오프라인(unconfigured)은 기존 로컬 차감 경로 그대로', async () => {
    const p = defaultProfile();
    p.credits = 11_201;
    open(p);
    vi.spyOn(net, 'spendCurrencyOnServer').mockResolvedValue({ status: 'unconfigured' });
    await expand();
    expect(profile.stashExpansions).toBe(1);
    expect(profile.credits).toBe(11_201 - stashExpansionCost(0));
  });
});


// ---------------------------------------------------------------------------
// (4) 보관함 ↔ 인벤토리 이동 · 보관함 분해 · 장착 팝업 동시 표시
//     (사용자 요청 2026-07-27 — 셋 다 "배선이 없으면 화면에서 아무 일도 안 일어난다" 부류라
//      순수 함수가 아니라 실제 화면을 세워 확인한다.)
// ---------------------------------------------------------------------------

describe('보관함 ↔ 인벤토리 이동', () => {
  it('보관함 셀을 클릭하면 인벤토리로 옮겨진다', () => {
    const p = defaultProfile();
    const it = itemOfSlot(11, 'engine');
    p.stash.push(it);
    open(p);

    tap(gridCells('stash')[0] as Container);

    expect(profile.stash, '보관함에서 빠져야 한다').toHaveLength(0);
    expect(profile.inventory.map((i) => i.id)).toEqual([it.id]);
  });

  it('인벤토리 셀을 우클릭하면 보관함으로 옮겨진다', () => {
    const p = defaultProfile();
    const it = itemOfSlot(11, 'engine');
    p.inventory.push(it);
    open(p);

    rightClick(gridCells('inventory')[0] as Container);

    expect(profile.inventory, '인벤토리에서 빠져야 한다').toHaveLength(0);
    expect(profile.stash.map((i) => i.id)).toEqual([it.id]);
  });

  it('좌클릭 장착은 그대로다 — 우클릭 추가가 기존 동작을 빼앗지 않는다', () => {
    const p = defaultProfile();
    const it = itemOfSlot(11, 'engine');
    p.inventory.push(it);
    open(p);

    tap(gridCells('inventory')[0] as Container);

    expect(activeShip(profile).equipped.engine?.id).toBe(it.id);
    expect(profile.stash, '좌클릭이 보관함으로 새면 안 된다').toHaveLength(0);
  });

  it('인벤토리가 가득 차면 꺼내지 않고 이유를 알린다', () => {
    const p = defaultProfile();
    for (let i = 0; i < 48; i++) p.inventory.push(itemOfSlot(1000 + i * 7, 'engine'));
    const stashed = itemOfSlot(11, 'armor');
    p.stash.push(stashed);
    open(p);

    tap(gridCells('stash')[0] as Container);

    expect(profile.stash, '조용히 사라지면 안 된다').toHaveLength(1);
    expect(hasLabel(root(), t('inv.err.full')), '막힌 이유가 화면에 떠야 한다').toBe(true);
  });

  it('두 패널 모두 조작 방법을 화면에 적는다(발견 가능성)', () => {
    open();
    expect(hasLabel(root(), t('inv.help.stash'))).toBe(true);
    expect(hasLabel(root(), t('inv.help.inventory'))).toBe(true);
  });
});

describe('보관함 일괄 분해', () => {
  it('보관함 패널에 분해 버튼이 있고, 보관함 아이템을 지운다', async () => {
    const p = defaultProfile();
    p.stash.push(itemOfSlot(11, 'engine', 'normal'), itemOfSlot(21, 'armor', 'normal'));
    p.inventory.push(itemOfSlot(31, 'main', 'normal'));
    open(p);

    // 버튼이 **창고 패널 안에** 있어야 한다(인벤토리 것과 라벨이 다르므로 영역 확인이 이중 방어).
    const btn = buttonByLabel(root(), t('inv.act.salvageLowShort'), STASH_PANEL);
    expect(btn).toBeDefined();

    await salvage('stash', ['normal', 'magic']);

    expect(profile.stash, '보관함이 비어야 한다').toHaveLength(0);
    expect(profile.inventory, '인벤토리는 건드리면 안 된다').toHaveLength(1);
  });

  it('보관함 분해는 **보관함 필터**를 따른다(인벤토리 탭 상태를 보지 않는다)', async () => {
    const p = defaultProfile();
    const engine = itemOfSlot(11, 'engine', 'normal');
    const armor = itemOfSlot(21, 'armor', 'normal');
    p.stash.push(engine, armor);
    open(p);

    // 인벤토리 탭만 '주무기' 로 바꾼다 — 보관함 분해가 이걸 보면 대상이 0개가 된다.
    tap(buttonByLabel(root(), t('item.slot.main'), INV_PANEL));
    // 보관함 탭은 '엔진' 으로 — 보이는 것(엔진)만 분해돼야 한다.
    tap(buttonByLabel(root(), t('item.slot.engine'), STASH_PANEL));

    await salvage('stash', ['normal', 'magic']);

    expect(profile.stash.map((i) => i.id), '보이던 엔진만 분해돼야 한다').toEqual([armor.id]);
  });

  it('보관함 셀 수가 필터에 반응한다(분해 대상 = 보이는 것 규율의 렌더 측 근거)', () => {
    const p = defaultProfile();
    p.stash.push(itemOfSlot(11, 'engine'), itemOfSlot(21, 'armor'));
    open(p);
    const all = stashCellCount();
    tap(buttonByLabel(root(), t('item.slot.engine'), STASH_PANEL));
    expect(stashCellCount()).toBeLessThan(all);
  });
});

describe('장착 장비 팝업 동시 표시', () => {
  interface Tips {
    tooltip: { container: Container };
    equippedTip: { container: Container };
  }
  const tips = (): Tips => hangar as unknown as Tips;

  function hover(cell: Container, x = 900, y = 700): void {
    (cell as unknown as { emit(ev: string, e: unknown): void }).emit('pointerover', {
      global: { x, y },
    });
  }

  it('장착 중인 같은 슬롯이 있으면 팝업 두 장이 함께 뜬다', () => {
    const p = defaultProfile();
    const equipped = itemOfSlot(11, 'engine');
    const candidate = itemOfSlot(101, 'engine');
    activeShip(p).equipped.engine = equipped;
    p.inventory.push(candidate);
    open(p);

    hover(gridCells('inventory')[0] as Container);

    expect(tips().tooltip.container.visible, '후보 팝업').toBe(true);
    expect(tips().equippedTip.container.visible, '장착 팝업이 함께 떠야 한다').toBe(true);
  });

  it('두 팝업은 겹치지 않고 화면 안에 있다', () => {
    const p = defaultProfile();
    activeShip(p).equipped.engine = itemOfSlot(11, 'engine');
    p.inventory.push(itemOfSlot(101, 'engine'));
    open(p);

    hover(gridCells('inventory')[0] as Container);

    const a = rectOf(tips().tooltip.container);
    const b = rectOf(tips().equippedTip.container);
    expect(intersects(a, b), '두 장이 겹치면 아래 것을 못 읽는다').toBe(false);
    for (const r of [a, b]) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('빈 슬롯이면 장착 팝업은 뜨지 않는다', () => {
    const p = defaultProfile();
    p.inventory.push(itemOfSlot(101, 'engine')); // 엔진 미장착
    open(p);

    hover(gridCells('inventory')[0] as Container);

    expect(tips().tooltip.container.visible).toBe(true);
    expect(tips().equippedTip.container.visible).toBe(false);
  });

  it('셀에서 벗어나면 두 장 모두 사라진다', () => {
    const p = defaultProfile();
    activeShip(p).equipped.engine = itemOfSlot(11, 'engine');
    p.inventory.push(itemOfSlot(101, 'engine'));
    open(p);

    const cell = gridCells('inventory')[0] as Container;
    hover(cell);
    (cell as unknown as { emit(ev: string): void }).emit('pointerout');

    expect(tips().tooltip.container.visible).toBe(false);
    expect(tips().equippedTip.container.visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (5) 헤더 3줄 비겹침 · 버튼 라벨 넘침 (사용자 신고 2026-07-27:
//     "글자가 겹쳐서 안보임. 창고확장 글자가 버튼 크기를 넘어감.")
//
// 좌표 상수를 눈으로 맞추는 방식은 라벨 길이·폰트가 바뀔 때마다 다시 깨진다. 그래서 실제
// 씬 그래프의 **bounds 교차**로 단언한다 — 겹치면 무조건 빨간불이다.
// ---------------------------------------------------------------------------

/** 자손 중 정확히 이 문자열인 Text 노드(없으면 throw). */
function textByLabel(node: Container, label: string): Text {
  if (node instanceof Text && node.text === label) return node;
  for (const c of node.children) {
    if (c instanceof Container) {
      try {
        return textByLabel(c, label);
      } catch {
        /* 다음 형제로 */
      }
    }
  }
  throw new Error(`Text "${label}" 를 씬 그래프에서 찾지 못했다`);
}

describe('패널 헤더가 서로 겹치지 않는다', () => {
  /** 안내 한 줄이 같은 패널의 헤더 컨트롤 전부와 떨어져 있는지 본다. */
  function expectHelpClear(helpKey: string, region: { maxX?: number; minX?: number; minY?: number }, labels: string[]): void {
    const help = rectOf(textByLabel(root(), helpKey));
    for (const label of labels) {
      const btn = rectOf(buttonByLabel(root(), label, region));
      expect(intersects(help, btn), `안내 문구가 "${label}" 와 겹친다`).toBe(false);
    }
  }

  it('창고: 안내 문구가 확장·정렬·분해 버튼과 분류 탭 어디에도 겹치지 않는다', () => {
    open();
    expectHelpClear(t('inv.help.stash'), STASH_PANEL, [
      t('inv.act.expand', { n: stashExpansionCost(0) }),
      t('inv.act.sort', { v: t('inv.sort.default') }),
      t('inv.act.salvageLowShort'),
      t('inv.act.salvageHighShort'),
      t('inv.filter.all'),
      t('item.slot.module'), // 탭 줄의 오른쪽 끝 — 줄 전체를 훑는 두 번째 표본
    ]);
  });

  it('인벤토리: 같은 검사(라벨이 더 길어 겹침이 먼저 터지던 쪽)', () => {
    open();
    expectHelpClear(t('inv.help.inventory'), INV_PANEL, [
      t('inv.act.salvageHigh'),
      t('inv.act.salvageLow'),
      t('inv.act.sort', { v: t('inv.sort.default') }),
      t('inv.filter.all'),
      t('item.slot.module'),
    ]);
  });

  it('제목 줄도 안내 줄과 겹치지 않는다(두 줄은 서로 다른 띠다)', () => {
    open();
    for (const [titleKey, helpKey] of [
      [t('inv.stashHeader', { n: 0, cap: stashCapacity(0) }), t('inv.help.stash')],
      [t('inv.invHeader', { n: 0, cap: INVENTORY_CAP }), t('inv.help.inventory')],
    ] as const) {
      const title = rectOf(textByLabel(root(), titleKey));
      const help = rectOf(textByLabel(root(), helpKey));
      expect(intersects(title, help), `"${titleKey}" 제목이 안내 줄과 겹친다`).toBe(false);
    }
  });

  it('세로 띠 계산 자체가 겹치지 않는다(측정 스텁에 기대지 않는 산술 단언)', () => {
    // ⚠️ 위 bounds 단언은 node 스텁의 글자 폭·높이(문자당 8px, 높이 10px)로 재므로 **실제
    // 폰트보다 작게** 나온다 — 실화면에서 겹치던 조합이 여기서는 통과할 수 있다. 그래서 띠
    // 경계 자체를 산술로 못 박는다. 값은 패널 로컬 y(콘텐츠 상자 상단 = 프레임 46 + 여백 14).
    const C = HangarScreen as unknown as {
      ACTION_H: number;
      HELP_Y: number;
      FILTER_Y: number;
      FILTER_H: number;
      GRID_TOP: number;
      BOTTOM_PH: number;
      CONTENT_TOP: number;
      CELL: number;
      GAP: number;
    };
    const HELP_LINE_H = 20; // 폰트 14 의 실제 줄 높이(≈18)에 여유 2
    expect(C.CONTENT_TOP + C.ACTION_H, '액션 행이 안내 줄을 침범한다').toBeLessThanOrEqual(C.HELP_Y);
    expect(C.HELP_Y + HELP_LINE_H, '안내 줄이 분류 탭을 침범한다').toBeLessThanOrEqual(C.FILTER_Y);
    expect(C.FILTER_Y + C.FILTER_H, '분류 탭이 그리드를 침범한다').toBeLessThanOrEqual(C.GRID_TOP);
    // 그리드는 여전히 3행이 콘텐츠 상자 안에 들어간다(헤더에 줄을 더하느라 행을 잃지 않았다).
    //
    // ⚠️ 옛 판은 `BOTTOM_PH - CONTENT_TOP` 을 "상자 바닥 y" 로 썼는데, 그건 **상자 높이**다.
    // 나무 패널 시절엔 위아래 여백이 둘 다 60 이라 두 값이 우연히 같아 오류가 안 드러났다.
    // 시네마틱 패널은 상단 68(제목 띠 52 + 숨틈 16) · 하단 24 로 비대칭이라 그 우연이 깨진다 —
    // **상자 바닥 y 는 패널 높이에서 하단 여백만 뺀 값**이다. 실제 상자를 물어봐서 못 박는다.
    const box = makeCinematicPanel({
      width: 936,
      height: C.BOTTOM_PH,
      variant: 'slab',
      title: 'x',
    }).box;
    expect(box.y, '패널 콘텐츠 상단이 HangarScreen.CONTENT_TOP 과 갈렸다').toBe(C.CONTENT_TOP);
    const rows = Math.floor((box.bottom - C.GRID_TOP + C.GAP) / (C.CELL + C.GAP));
    expect(rows, '그리드 3행이 유지돼야 한다').toBe(3);
  });

  it('그리드 첫 행이 분류 탭 줄을 침범하지 않는다', () => {
    const p = defaultProfile();
    p.stash.push(itemOfSlot(11, 'engine'));
    p.inventory.push(itemOfSlot(31, 'main'));
    open(p);
    for (const [panel, region] of [
      ['stash', STASH_PANEL],
      ['inventory', INV_PANEL],
    ] as const) {
      const cell = rectOf(gridCells(panel)[0] as Container);
      const tab = rectOf(buttonByLabel(root(), t('inv.filter.all'), region));
      expect(intersects(cell, tab), `${panel}: 첫 셀이 분류 탭과 겹친다`).toBe(false);
    }
  });
});

describe('PixiButton 라벨은 판때기 밖으로 새지 않는다', () => {
  /** 버튼 내부의 라벨 Text(inner 의 마지막 자식). */
  function labelOf(btn: PixiButton): Text {
    const inner = btn.container.children[0] as Container;
    return inner.children[inner.children.length - 1] as Text;
  }

  it('폭을 넘치는 라벨은 줄여 맞춘다', () => {
    const long = '창고 확장 (16000 크레딧)'.repeat(2); // 확실히 넘치는 길이
    const btn = new PixiButton({ width: 180, height: 44, fontSize: 16, label: long, onClick: () => {} });
    const label = labelOf(btn);
    expect(label.scale.x, '넘치는데도 축소가 안 걸렸다').toBeLessThan(1);
    expect(label.width, '축소 후에도 버튼 폭을 넘는다').toBeLessThanOrEqual(180);
  });

  it('폭 안에 드는 라벨은 건드리지 않는다(기존 버튼 무회귀)', () => {
    const btn = new PixiButton({ width: 200, height: 44, fontSize: 16, label: '정렬', onClick: () => {} });
    expect(labelOf(btn).scale.x).toBe(1);
  });

  it('setLabel 로 길어져도 다시 맞춘다(비용 자릿수 증가 경로)', () => {
    const btn = new PixiButton({ width: 180, height: 44, fontSize: 16, label: '확장', onClick: () => {} });
    expect(labelOf(btn).scale.x).toBe(1);
    btn.setLabel('창고 확장 (16000 크레딧)'.repeat(2));
    expect(labelOf(btn).scale.x).toBeLessThan(1);
  });
});
