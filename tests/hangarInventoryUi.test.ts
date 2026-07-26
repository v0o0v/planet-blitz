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
import { defaultProfile, activeShip, type Profile } from '../src/save/profile.js';
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
    // (배치는 132,18 이고 bounds 는 폴백 Graphics 테두리 2px 만큼 바깥으로 1px 넓다.)
    expect({ x: Math.round(cat.x), y: Math.round(cat.y) }).toEqual({ x: 131, y: 17 });
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
    if (child.x > 900) found = content.children.length;
  }
  if (found < 0) throw new Error('인벤토리 그리드 클립을 찾지 못했다');
  return found;
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

