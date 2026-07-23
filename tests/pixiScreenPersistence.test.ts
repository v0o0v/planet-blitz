/**
 * Pixi 메타 화면 4종의 **저장 배선** 회귀 테스트 (레인 C · C-1).
 *
 * ## 왜 이 파일이 따로 있어야 하나
 * `saveProfile(profile, store)` 의 기본 인자(`= defaultStore()`)는 **명시적으로 `null` 을 넘기면
 * 적용되지 않는다** — TypeScript/JS 의 기본 인자는 `undefined` 에만 반응한다. 그리고
 * `saveProfile` 은 `store === null` 을 "저장하지 마라" 로 읽고 즉시 return 한다.
 *
 * `main.ts` 는 이 화면들을 **store 없이** 만들고(생성자 기본값 `store: KeyValueStore | null = null`),
 * 화면은 그 null 을 그대로 `saveProfile` 에 넘기고 있었다 → 장비 장착 · 스킬 투자 · 챔피언 확정 ·
 * 정제 결과가 **전부 no-op**. 정산(`main.ts` 의 `saveProfile(profile)`)이 우연히 가려 주고 있었을
 * 뿐이라, 런을 완주하지 않고 새로고침하면 전량 소실됐다.
 *
 * 2000여 단위 테스트가 전부 그린이었던 이유는 하나다: **테스트가 store 를 주입해서 돌렸다.**
 * store 를 인자로 넘기는 순간 이 결함은 원리상 재현 불가능하다. 그래서 이 파일은
 * **실제 앱과 똑같이 store 인자 없이** 화면을 만들고, 전역 `localStorage` 에 실제 write 가
 * 일어나는지를 본다. 화면 생성 방식이 이 테스트의 검사 대상 그 자체다.
 *
 * ## 캔버스 없이 어떻게 돌리나
 * vitest 환경은 node 다. Pixi 표시 객체는 렌더러 없이도 만들어지지만(tests/invasionRender.test.ts
 * 선례), 화면들은 `document.getElementById('pb-hud')` 를 부르므로 최소 DOM 스텁을 깔아 준다.
 * 텍스처 로드(`loadUiTextures`)는 비동기 fetch 라 node 에서 조용히 실패하고 폴백 Graphics 로
 * 그려진다 — 저장 배선 검증에는 영향이 없다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Container, DOMAdapter } from 'pixi.js';

import { HangarScreen } from '../src/ui/pixi/hangar.js';
import { ChampionSelectScreen } from '../src/ui/pixi/championSelect.js';
import { ResearchLabScreen } from '../src/ui/pixi/researchLab.js';
import { RefineryScreen } from '../src/ui/pixi/refinery.js';
import {
  defaultProfile,
  loadProfile,
  activeShip,
  type Profile,
  type KeyValueStore,
} from '../src/save/profile.js';
import { rollItem } from '../src/items/roll.js';
import type { Item } from '../src/items/types.js';

// ---------------------------------------------------------------------------
// 전역 환경 스텁 — **주입이 아니다.** 화면은 store 를 전혀 모른 채 만들어지고,
// `defaultStore()` 가 이 전역 localStorage 를 집어 가야만 테스트가 통과한다.
// ---------------------------------------------------------------------------

/**
 * Pixi `Text.width` 는 캔버스 텍스트 측정을 요구한다(연구소·정제소가 라벨 축소에 쓴다).
 * node 에는 캔버스가 없으므로 **측정만 되는** 최소 어댑터를 끼운다 — 폭 값의 정확도는
 * 이 테스트의 관심사가 아니다(저장 배선만 본다).
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
    // Pixi 는 letterSpacing 지원 여부를 이 클래스의 prototype 으로 판별한다 — node 에는 없다.
    getCanvasRenderingContext2D: () => class {},
    getWebGLRenderingContext: () => class {},
  } as never);
}

/** `src/save/profile.ts` 의 STORAGE_KEY(비공개)와 같은 값. 아래에서 `loadProfile` 과 교차 검증한다. */
const STORAGE_KEY = 'planet-blitz:profile';

class MemStore implements KeyValueStore {
  readonly map = new Map<string, string>();
  writes = 0;
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writes++;
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

let store: MemStore;
/** 런 전용 DOM HUD 스텁(`#pb-hud`) — 화면들이 visibility 를 만진다. */
let hud: { style: { visibility: string } };

interface GlobalStubs {
  localStorage?: unknown;
  document?: unknown;
}

const g = globalThis as unknown as GlobalStubs;
let hadLocalStorage = false;
let hadDocument = false;

beforeEach(() => {
  store = new MemStore();
  hadLocalStorage = 'localStorage' in g;
  hadDocument = 'document' in g;
  g.localStorage = store;
  hud = { style: { visibility: '' } };
  if (!hadDocument) {
    g.document = { getElementById: (id: string) => (id === 'pb-hud' ? hud : null) };
  }
  installCanvasStub();
});

afterEach(() => {
  if (!hadLocalStorage) delete g.localStorage;
  if (!hadDocument) delete g.document;
  vi.useRealTimers();
});

/** 저장이 실제로 일어났는지 — 키·JSON 파싱·`loadProfile` 왕복까지 셋 다 본다. */
function persisted(): Profile {
  const raw = store.getItem(STORAGE_KEY);
  expect(raw, '프로필이 localStorage 에 저장되지 않았다 (saveProfile 이 no-op 이었다)').not.toBeNull();
  // 키 이름이 두 곳(테스트 상수 · profile.ts)에 적혀 있으므로 정규 로더로도 교차 확인한다.
  const viaLoader = loadProfile(store);
  expect(viaLoader.saveVersion).toBe(JSON.parse(raw as string).saveVersion);
  return viaLoader;
}

function itemOfSlot(seed: number, want: Item['slot']): Item {
  for (let s = seed; s < seed + 5000; s++) {
    const it = rollItem(s, 'rare', { planet: 0, stage: 1 });
    if (it.slot === want) return it;
  }
  throw new Error(`슬롯 ${want} 아이템을 굴리지 못했다`);
}

// ---------------------------------------------------------------------------

describe('Pixi 메타 화면 — store 없이 생성해도 프로필이 저장된다 (C-1)', () => {
  it('격납고: 장비 장착이 localStorage 에 반영된다', () => {
    const profile = defaultProfile();
    const item = itemOfSlot(11, 'engine');
    profile.inventory.push(item);

    // ⚠️ main.ts:243 과 **똑같이** store 인자 없이 만든다. 여기서 store 를 넘기면
    // 이 테스트는 결함을 잡을 능력을 잃는다.
    const stage = new Container();
    const hangar = new HangarScreen(profile, stage);
    hangar.show(profile, () => {});

    // 화면이 실제 클릭에서 부르는 그 메서드.
    (hangar as unknown as { equip(i: Item): void }).equip(item);

    expect(activeShip(profile).equipped.engine?.id).toBe(item.id);
    const saved = persisted();
    expect(activeShip(saved).equipped.engine?.id).toBe(item.id);
  });

  it('격납고: 창고 확장도 저장된다(같은 persist 경로의 2차 확인)', async () => {
    const profile = defaultProfile();
    profile.credits = 1_000_000;
    const stage = new Container();
    const hangar = new HangarScreen(profile, stage);
    hangar.show(profile, () => {});

    // 재화 서버 권위(ADR-0027) 이후 확장은 async(온라인=spend_currency / 미설정=로컬 차감).
    // 테스트 env 는 Supabase 미설정이라 로컬 폴백 경로 — await 로 폴백 반영을 기다린다.
    await (hangar as unknown as { expandStash(): Promise<void> }).expandStash();

    expect(profile.stashExpansions).toBe(1);
    expect(persisted().stashExpansions).toBe(1);
  });

  it('챔피언 선택: 확정(퇴역 + 세대 교체)이 저장된다', () => {
    const profile = defaultProfile();
    const before = profile.ships.length;
    const stage = new Container();
    // main.ts → HangarScreen 이 store 없이 만들고, 격납고가 그대로 물려준다.
    const champ = new ChampionSelectScreen(profile, stage);
    champ.show(profile, { onClose: () => {} });

    (champ as unknown as { select(id: number): void }).select(1);
    (champ as unknown as { confirm(): void }).confirm();

    expect(profile.ships.length).toBe(before + 1);
    const saved = persisted();
    expect(saved.ships.length).toBe(before + 1);
    expect(activeShip(saved).typeId).toBe(1);
  });

  it('연구소: 스킬 투자가 저장된다', () => {
    const profile = defaultProfile();
    profile.skillPoints = 5;
    const stage = new Container();
    const lab = new ResearchLabScreen(profile, stage);
    lab.show(profile, () => {});

    (lab as unknown as { investNode(i: number): void }).investNode(0);

    const invested = activeShip(profile).skillInvest[0] ?? 0;
    expect(invested, '투자가 애초에 성립하지 않았다 — 테스트 전제 실패').toBeGreaterThan(0);
    expect(activeShip(persisted()).skillInvest[0]).toBe(invested);
  });

  it('정제소: 어픽스 리롤이 저장된다', async () => {
    vi.useFakeTimers();
    const profile = defaultProfile();
    profile.minerals = 1_000_000;
    const item = itemOfSlot(31, 'main');
    expect(item.affixes.length).toBeGreaterThan(0);
    profile.inventory.push(item);

    const stage = new Container();
    const refinery = new RefineryScreen(profile, stage);
    refinery.show(profile, () => {});

    // 리롤은 async(온라인=spend_currency / 미설정=로컬 광물 차감). 테스트 env 는 미설정이라
    // 로컬 폴백 — await 로 차감·교체·persist 를 기다린 뒤 검증한다(스핀 setInterval 은 fake timers).
    const r = refinery as unknown as { select(i: Item): void; reroll(): Promise<void> };
    r.select(item);
    await r.reroll();

    expect(profile.minerals).toBeLessThan(1_000_000);
    const saved = persisted();
    expect(saved.minerals).toBe(profile.minerals);
  });
});

describe('챔피언 선택을 닫아도 런 HUD 가 되살아나지 않는다 (C-4)', () => {
  it('격납고 위에서 열고 닫으면 HUD 는 감춰진 채 남는다', () => {
    const profile = defaultProfile();
    const stage = new Container();
    const champ = new ChampionSelectScreen(profile, stage);

    // 격납고가 이미 HUD 를 감춘 상태(= 캔버스 메타 화면 위에 런 HUD 가 뜨면 안 된다).
    hud.style.visibility = 'hidden';

    champ.show(profile, { onClose: () => {} });
    expect(hud.style.visibility).toBe('hidden');

    (champ as unknown as { close(): void }).close();
    // ⚠️ 예전 구현은 무조건 `visibility = ''` 로 되살려 격납고 위로 HUD 가 다시 떠올랐다.
    expect(hud.style.visibility, '격납고로 복귀했는데 런 HUD 가 되살아났다').toBe('hidden');
  });

  it('런 중(HUD 표시 상태)에서 열고 닫으면 원래대로 되살아난다', () => {
    const profile = defaultProfile();
    const stage = new Container();
    const champ = new ChampionSelectScreen(profile, stage);

    hud.style.visibility = '';
    champ.show(profile, { onClose: () => {} });
    expect(hud.style.visibility).toBe('hidden');

    (champ as unknown as { close(): void }).close();
    expect(hud.style.visibility).toBe('');
  });
});
