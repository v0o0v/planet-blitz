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
import { setLineageGatewayOverride } from '../src/net/lineage.js';
import { HarnessLineageGateway } from '../src/harness/lineageMock.js';
import { ResearchLabScreen } from '../src/ui/pixi/researchLab.js';
import { RefineryScreen, refineryDetailLayout } from '../src/ui/pixi/refinery.js';
import type { ChainState } from '../src/items/refiningChain.js';
import {
  defaultProfile,
  loadProfile,
  activeShip,
  totalInvested,
  type Profile,
  type KeyValueStore,
} from '../src/save/profile.js';
import { rollItem, reforgeAffixes } from '../src/items/roll.js';
import type { Item } from '../src/items/types.js';
import { stashExpansionCost, rollCost, HEAT, type Heat } from '../data/economy.js';
import { LEVEL_CAP } from '../data/waves.js';
import * as net from '../src/net/index.js';

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
  vi.restoreAllMocks();
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
    // 요구 레벨 게이트(ADR-0030): rare engine 은 req≥32 라 Lv1 신규 기체로는 잠긴다.
    // 이 테스트는 게이트가 아니라 persist 경로를 검증하므로 기체 레벨을 올려 착용을 통과시킨다.
    activeShip(profile).level = 100;

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

  /**
   * ⚠️ 계약이 바뀌었다(ADR-0007 서버 권위 배선, 2026-08-03): 퇴역은 `retire_ship` RPC 가
   * 성공한 뒤에만 로컬을 변형한다. 그래서 이 테스트는 **모의 게이트웨이를 끼우고 await** 해야
   * 한다 — 예전처럼 동기 호출로 두면 오프라인 잠금에 걸려 아무 일도 일어나지 않는다.
   *
   * 여기서 보려는 것은 여전히 **저장 배선**(store 없이 만든 화면이 기본 store 로 저장하는가)이다.
   */
  it('챔피언 선택: 확정(퇴역 + 세대 교체)이 저장된다', async () => {
    const profile = defaultProfile();
    // 확정(퇴역)에는 만렙 게이트가 있다 — 여기서 보려는 것은 게이트가 아니라 **저장 배선**이다.
    activeShip(profile).level = LEVEL_CAP;
    const before = profile.ships.length;
    const stage = new Container();
    // main.ts → HangarScreen 이 store 없이 만들고, 격납고가 그대로 물려준다.
    const champ = new ChampionSelectScreen(profile, stage);
    champ.show(profile, { onClose: () => {} });

    setLineageGatewayOverride(new HarnessLineageGateway());
    try {
      (champ as unknown as { select(id: number): void }).select(1);
      await (champ as unknown as { confirm(): Promise<void> | void }).confirm();
      // confirm 은 void 를 돌려주고 내부에서 서버 왕복을 이어간다 — 한 틱 더 흘려 완료를 기다린다.
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      setLineageGatewayOverride(null);
    }

    expect(profile.ships.length).toBe(before + 1);
    const saved = persisted();
    expect(saved.ships.length).toBe(before + 1);
    expect(activeShip(saved).typeId).toBe(1);
  });

  /**
   * 같은 화면의 **반대쪽 계약**: 서버가 없으면 확정이 아무것도 하지 않는다. 위 테스트만 있으면
   * 오프라인에서 로컬만 퇴역시키는 회귀(= 서버에 행이 없는 수호기 생성)를 아무도 못 잡는다.
   */
  it('챔피언 선택: 오프라인이면 확정이 아무것도 바꾸지 않는다(서버 권위)', async () => {
    const profile = defaultProfile();
    activeShip(profile).level = LEVEL_CAP;
    const snapshot = JSON.stringify(profile);
    const champ = new ChampionSelectScreen(profile, new Container());
    champ.show(profile, { onClose: () => {} });

    (champ as unknown as { select(id: number): void }).select(1);
    (champ as unknown as { confirm(): void }).confirm();
    await new Promise((r) => setTimeout(r, 0));

    expect(JSON.stringify(profile)).toBe(snapshot);
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

// ---------------------------------------------------------------------------
// 동시(재진입) 클릭 가드 — 코드리뷰 LOW-1 후속.
//
// async 재화 스펜드 핸들러는 `spend_currency` 서버 왕복(await) 동안 두 번째 클릭이 끼면 두 번째
// 차감을 일으킨다(사전검사가 첫 await 해소 전이라 둘 다 통과). 각 화면의 `busy` 플래그가 그
// 네트워크 창을 잠가 이중 차감을 막는지, 첫 호출이 await 에서 정지한 사이 두 번째를 쏘아 검증한다.
// ---------------------------------------------------------------------------

describe('동시(재진입) 클릭이 재화를 이중 차감하지 않는다 (LOW-1)', () => {
  it('격납고: 창고 확장 동시 클릭 → 1회만 과금·확장', async () => {
    const profile = defaultProfile();
    profile.credits = 1_000_000;
    const cost = stashExpansionCost(profile.stashExpansions); // 0차 확장 가격
    const stage = new Container();
    const hangar = new HangarScreen(profile, stage);
    hangar.show(profile, () => {});

    // 첫 호출이 spend await 에서 정지한 사이 두 번째를 쏜다 — 가드가 없으면 둘 다 통과해
    // 같은(싼) 가격으로 stashExpansions 를 2 로 밀어 올린다(2차 확장 언더페이).
    const h = hangar as unknown as { expandStash(): Promise<void> };
    const p1 = h.expandStash();
    const p2 = h.expandStash();
    await Promise.all([p1, p2]);

    expect(profile.stashExpansions, '두 번째 클릭이 2차 확장을 언더페이로 밀어넣었다').toBe(1);
    expect(profile.credits, '크레딧이 이중 차감됐다').toBe(1_000_000 - cost);
    expect(persisted().stashExpansions).toBe(1);
  });

  it('정제소: 리롤 동시 클릭 → 광물 1회만 차감', async () => {
    vi.useFakeTimers();
    const profile = defaultProfile();
    profile.minerals = 1_000_000;
    const item = itemOfSlot(31, 'main');
    expect(item.affixes.length).toBeGreaterThan(0);
    profile.inventory.push(item);
    // 중불(mid)이 비용 배수 ×1 앵커라 구 단발 리롤과 같은 값이 나온다 — 기대값 산술이 그대로 성립한다.
    const cost = rollCost(item.rarity, item.affixes.length, 'mid');

    const stage = new Container();
    const refinery = new RefineryScreen(profile, stage);
    refinery.show(profile, () => {});
    const r = refinery as unknown as { select(i: Item): void; reroll(): Promise<void> };
    r.select(item);

    // `spinning` 은 spend await **뒤에야** 세워지므로, 두 번째 클릭은 `busy` 만이 막을 수 있다.
    const p1 = r.reroll();
    const p2 = r.reroll();
    await Promise.all([p1, p2]);

    expect(profile.minerals, '광물이 이중 차감됐다').toBe(1_000_000 - cost);
    expect(persisted().minerals).toBe(profile.minerals);
  });

  it('연구소: 리스펙 동시 클릭 → 서버 차감 1회만 (온라인 ok 경로)', async () => {
    const profile = defaultProfile();
    profile.skillPoints = 5;
    profile.credits = 1_000_000;
    const stage = new Container();
    const lab = new ResearchLabScreen(profile, stage);
    lab.show(profile, () => {});

    // 리스펙 사전검사(투자 有)를 통과시키려면 실제로 한 포인트 투자해 둔다.
    (lab as unknown as { investNode(i: number): void }).investNode(0);
    expect(totalInvested(profile), '투자가 성립하지 않아 테스트 전제 실패').toBeGreaterThan(0);

    // 온라인 ok 경로를 강제한다 — 미설정(오프라인)에서는 두 번째 respecSkills 가 스스로 false 라
    // 이중 차감이 재현되지 않는다(서버만 매 spend 호출마다 차감). spend 호출 횟수를 센다.
    let spendCalls = 0;
    vi.spyOn(net, 'spendCurrencyOnServer').mockImplementation(
      async (credits: number, minerals: number): Promise<net.SpendOutcome> => {
        spendCalls++;
        return {
          status: 'ok',
          creditsLeft: profile.credits - credits,
          mineralsLeft: profile.minerals - minerals,
        };
      },
    );

    const r = lab as unknown as { respec(): Promise<void> };
    const p1 = r.respec();
    const p2 = r.respec();
    await Promise.all([p1, p2]);

    expect(spendCalls, '리스펙 서버 차감이 두 번 일어났다(재진입 가드 부재)').toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 정련 공정(ADR-0040) — 레이아웃 넘침 · 하위 호환 · 서버 거부.
// ---------------------------------------------------------------------------

/** 정제소 상세 패널의 private 표면(회귀 테스트가 실제 클릭 경로를 직접 찌른다). */
interface RefineryProbe {
  select(i: Item): void;
  reroll(): Promise<void>;
  fasten(index: number): void;
  chain: ChainState | null;
  /** 서버 왕복 창 재현용 — 진입점 가드를 우회하는 외부 경로(main.ts 의 직접 `hide()` 등)를 흉내낸다. */
  selectedId: string | null;
  heat: Heat;
  spinning: boolean;
}

function makeRefinery(profile: Profile): { screen: RefineryScreen; probe: RefineryProbe } {
  const stage = new Container();
  const screen = new RefineryScreen(profile, stage);
  screen.show(profile, () => {});
  return { screen, probe: screen as unknown as RefineryProbe };
}

describe('정련 공정: 상세 패널이 어떤 어픽스 수에서도 나무 테두리를 넘지 않는다', () => {
  // 레어는 어픽스 3~6개라 6은 흔한 경우지 예외가 아니다. 정련 공정이 노 출력 3버튼 · 위험 표시 ·
  // 공정 멈추기 버튼을 새로 얹으면서 구 레이아웃(어픽스 행 60px 간격)은 6어픽스에서 실제로 넘쳤다.
  // 좌표를 하드코딩하지 않고 `refineryDetailLayout` 이 파생하므로, 여기서는 그 부등식만 잠근다.
  for (const n of [1, 2, 3, 6]) {
    it(`어픽스 ${n}개: 마지막 요소 bottom <= 콘텐츠 상자 bottom`, () => {
      const L = refineryDetailLayout(n);
      expect(
        L.lastBottom,
        `어픽스 ${n}개에서 버튼 행(${L.lastBottom})이 콘텐츠 상자 바닥(${L.boxBottom})을 뚫었다`,
      ).toBeLessThanOrEqual(L.boxBottom);
    });

    it(`어픽스 ${n}개: 노 출력 행이 어픽스 목록과 겹치지 않는다`, () => {
      const L = refineryDetailLayout(n);
      // 바닥 클램프가 뭉치를 위로 밀어 올려 어픽스 행 위에 겹쳐 그리면, 넘침은 사라지고
      // 겹침이 생긴다 — 부등식 하나만 보면 그 교환을 놓친다.
      expect(L.heatY, `어픽스 ${n}개에서 노 출력 행이 어픽스 목록 위로 겹쳤다`).toBeGreaterThanOrEqual(L.rowsEnd);
    });
  }

  it('세 요소의 세로 순서가 항상 보존된다(노 출력 → 비용·위험 → 버튼)', () => {
    for (const n of [1, 2, 3, 6]) {
      const L = refineryDetailLayout(n);
      expect(L.heatY).toBeLessThan(L.costY);
      expect(L.costY).toBeLessThan(L.actionY);
    }
  });
});

describe('정련 공정: UI 경로 규칙', () => {
  it('고착 0개면 최악의 주사위(0)로 굴려도 용해하지 않는다 — 하위 호환', async () => {
    vi.useFakeTimers();
    // riskRoll = 0 은 용해 판정의 최악값이다. 고착이 0개면 meltRisk 가 정확히 0 이라
    // `0 < 0` 이 false → 절대 용해하지 않는다. 그것이 정확히 구 단발 리롤이다.
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const profile = defaultProfile();
    profile.minerals = 1_000_000;
    const item = itemOfSlot(31, 'main');
    expect(item.affixes.length).toBeGreaterThan(0);
    profile.inventory.push(item);

    const { probe } = makeRefinery(profile);
    probe.select(item);
    await probe.reroll();

    const chain = probe.chain;
    expect(chain, '공정이 열리지 않았다 — 테스트 전제 실패').not.toBeNull();
    expect(chain?.fastened.length, '고착이 없는데 무언가 풀렸다').toBe(0);
    // 용해면 `current === baseline`(참조 동일) + `canFasten === false` 다. 성공 굴림은 그 반대.
    expect(chain?.canFasten, '굴림이 성공했는데 고착 창이 열리지 않았다(= 용해로 처리됐다)').toBe(true);
    expect(chain?.current, '용해해서 시작 상태로 되돌아갔다').not.toBe(chain?.baseline);
    expect(chain?.current.affixes.length).toBe(item.affixes.length);
  });

  it('서버가 거부하면(insufficient) 굴림도 용해도 고착 변화도 없다', async () => {
    vi.useFakeTimers();
    const profile = defaultProfile();
    profile.minerals = 1_000_000;
    const item = itemOfSlot(31, 'main');
    profile.inventory.push(item);

    // ADR-0050 §3 단계 1 둘째 축: 정련은 차감과 **굴림 값**을 한 RPC 로 받는다(`roll_refine`).
    // 시드를 클라가 고르면 대가를 한 번만 치르고 원하는 어픽스가 나올 때까지 로컬에서 굴릴 수 있다.
    vi.spyOn(net, 'rollRefineOnServer').mockResolvedValue({
      status: 'rejected',
      creditsLeft: 0,
      mineralsLeft: 3,
    });

    const { probe } = makeRefinery(profile);
    probe.select(item);
    const before = probe.chain;
    await probe.reroll();

    expect(profile.minerals, '거부됐는데 광물이 빠졌다').toBe(1_000_000);
    expect(profile.inventory.find((it) => it.id === item.id), '거부됐는데 어픽스가 굴려졌다').toBe(item);
    expect(probe.chain, '거부됐는데 공정 상태가 움직였다').toBe(before);
    expect(probe.chain?.fastened.length).toBe(0);
    expect(probe.chain?.canFasten, '거부됐는데 고착 창이 열렸다').toBe(false);
  });

  it('굴리기 전에는 고착할 수 없고, 굴린 뒤에는 굴림당 1개만 고착된다', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const profile = defaultProfile();
    profile.minerals = 1_000_000;
    const item = itemOfSlot(31, 'main');
    expect(item.affixes.length).toBeGreaterThanOrEqual(2);
    profile.inventory.push(item);

    const { probe } = makeRefinery(profile);
    probe.select(item);

    probe.fasten(0);
    expect(probe.chain?.fastened.length, '굴리지도 않았는데 고착됐다').toBe(0);

    await probe.reroll();
    // 굴림 연출이 도는 동안에는 고착이 잠긴다(결과가 화면에 안착하기 전 클릭 차단) —
    // 연출을 끝까지 돌려야 고착 창이 열린다. setInterval 프레임을 전부 소진시킨다.
    vi.advanceTimersByTime(2000);
    probe.fasten(0);
    expect(probe.chain?.fastened).toEqual([0]);
    probe.fasten(1);
    expect(probe.chain?.fastened, '한 굴림에서 두 개가 고착됐다').toEqual([0]);
  });

  it('오프라인(unavailable)이면 굴림도 용해도 차감도 없다 (AC12)', async () => {
    // `insufficient` 와 **다른 return** 이라 한쪽만 덮으면 나머지 분기는 커버리지 0 이다.
    vi.useFakeTimers();
    const profile = defaultProfile();
    profile.minerals = 1_000_000;
    const item = itemOfSlot(31, 'main');
    profile.inventory.push(item);

    // 판정 자체를 못 받은 경우. ⛔ 여기서 로컬 굴림으로 강등하면 "차감됐는지 모르는 채
    // 굴리는" 경로가 생겨 공짜 굴림의 문이 다시 열린다 — 그래서 `failed` 는 굴리지 않는다.
    vi.spyOn(net, 'rollRefineOnServer').mockResolvedValue({ status: 'failed' });

    const { probe } = makeRefinery(profile);
    probe.select(item);
    const before = probe.chain;
    await probe.reroll();

    expect(profile.minerals, '판정을 못 받았는데 광물이 빠졌다').toBe(1_000_000);
    expect(profile.inventory.find((it) => it.id === item.id), '판정을 못 받았는데 어픽스가 굴려졌다').toBe(item);
    expect(probe.chain, '판정을 못 받았는데 공정 상태가 움직였다').toBe(before);
    expect(probe.chain?.canFasten, '판정을 못 받았는데 고착 창이 열렸다').toBe(false);
    expect(store.getItem(STORAGE_KEY), '판정을 못 받았는데 저장이 일어났다').toBeNull();
  });

  it('용해가 인벤토리를 baseline 으로 되돌리고 저장한다 (UI 배선)', async () => {
    // 상태기계의 용해는 촘촘히 덮여 있지만 "그 결과가 인벤토리·저장까지 갔는가"는 별개다
    // (이 리포에 "단위 테스트 그린인데 배선이 통째로 없다"가 8건 누적돼 있다).
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0); // seed=0 · riskRoll=0 → 위험>0 이면 확정 용해.
    const profile = defaultProfile();
    profile.minerals = 1_000_000;
    const item = itemOfSlot(31, 'main');
    expect(item.affixes.length).toBeGreaterThanOrEqual(2);
    profile.inventory.push(item);

    const { probe } = makeRefinery(profile);
    probe.select(item);

    await probe.reroll(); // 1굴림(고착 0 → 무위험)
    vi.advanceTimersByTime(2000);
    probe.fasten(0); // 고착 1 → 다음 굴림은 위험 > 0
    expect(probe.chain?.fastened, '고착이 성립하지 않아 테스트 전제 실패').toEqual([0]);
    const rolled = profile.inventory.find((it) => it.id === item.id);
    expect(rolled, '1굴림 결과가 인벤토리에 없다').toBeDefined();

    await probe.reroll(); // 2굴림 → 용해

    expect(probe.chain?.fastened, '용해했는데 고착이 남았다').toEqual([]);
    const after = profile.inventory.find((it) => it.id === item.id);
    expect(after, '용해했는데 인벤토리가 baseline 으로 되돌아가지 않았다').toBe(item);
    expect(persisted().inventory.find((it) => it.id === item.id)?.affixes).toEqual(item.affixes);
  });

  it('저장이 연출보다 먼저다 — persist() → startFx() 순서 (AC11)', async () => {
    // 누가 startFx 를 persist 위로 올려도 지금까지는 어떤 테스트도 빨개지지 않았다.
    // 새로고침으로 나쁜 롤을 무를 수 없는 근거가 이 순서 하나다(ADR-0040 §결과 확정과 연출의 순서).
    const profile = defaultProfile();
    profile.minerals = 1_000_000;
    const item = itemOfSlot(31, 'main');
    profile.inventory.push(item);

    const order: string[] = [];
    const realSetItem = store.setItem.bind(store);
    store.setItem = (k: string, v: string): void => {
      order.push('persist');
      realSetItem(k, v);
    };
    // 실제 타이머를 돌리지 않고 **호출 시점만** 기록한다(스핀 프레임은 이 테스트의 관심사가 아니다).
    vi.spyOn(globalThis, 'setInterval').mockImplementation(
      (() => {
        order.push('fx');
        return 0;
      }) as unknown as typeof setInterval,
    );

    const { probe } = makeRefinery(profile);
    probe.select(item);
    await probe.reroll();

    expect(order, '저장도 연출도 일어나지 않았다 — 테스트 전제 실패').toEqual(['persist', 'fx']);
  });

  it('나갔다 돌아와도 마지막 굴림 결과가 인벤토리에 남는다 (AC10)', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const profile = defaultProfile();
    profile.minerals = 1_000_000;
    const item = itemOfSlot(31, 'main');
    profile.inventory.push(item);

    const { screen, probe } = makeRefinery(profile);
    probe.select(item);
    await probe.reroll();
    vi.advanceTimersByTime(2000);

    const rolled = profile.inventory.find((it) => it.id === item.id);
    expect(rolled, '굴림 결과가 인벤토리에 없다').toBeDefined();

    // 공정 상태만 버리고 인벤토리는 이미 최신이다(ADR-0040 — 이탈 = 암묵적 멈추기).
    screen.hide();
    expect(probe.chain, '나갔는데 공정 상태가 남았다').toBeNull();
    screen.show(profile, () => {});

    expect(profile.inventory.find((it) => it.id === item.id), '왕복 후 굴림 결과가 사라졌다').toBe(rolled);
    expect(persisted().inventory.find((it) => it.id === item.id)?.affixes).toEqual(rolled?.affixes);
  });
});

// ---------------------------------------------------------------------------
// [CRITICAL 재현] 서버 왕복(await) 창 동안 외부가 상태를 바꾼다.
//
// 순차 단위 테스트로는 이 창이 열리지 않아 3,715개가 전부 그린이었다. `spend` 를 **수동 resolve**
// 로 세워 창을 인위적으로 열어 두고, 그 안에서 ① 다른 장비 선택 ② 노 출력 변경 ③ 화면 나가기를
// 수행한다. 진입점 가드는 창을 좁힐 뿐 없애지 못한다 — `main.ts` 가 `close()` 를 거치지 않고
// `refinery.hide()` 를 직접 부르는 곳만 5군데다. 그래서 `await` 복귀 후 재검증이 본체다.
// ---------------------------------------------------------------------------

describe('정련 공정: 서버 왕복 창 동안 상태가 바뀌어도 장비가 소실되지 않는다 (CRITICAL)', () => {
  interface Fixture {
    profile: Profile;
    screen: RefineryScreen;
    probe: RefineryProbe;
    itemA: Item;
    itemB: Item;
    idsBefore: string[];
    /** 아직 resolve 되지 않은 정련 굴림 왕복들(호출 순서대로). */
    pending: ((out: net.RollRefineOutcome) => void)[];
  }

  function setup(): Fixture {
    const profile = defaultProfile();
    profile.minerals = 1_000_000;
    const itemA = itemOfSlot(31, 'main');
    const itemB = itemOfSlot(931, 'armor');
    expect(itemA.id, '두 장비의 id 가 같아 테스트 전제 실패').not.toBe(itemB.id);
    expect(itemA.affixes.length).toBeGreaterThan(0);
    expect(itemB.affixes.length).toBeGreaterThan(0);
    profile.inventory.push(itemA, itemB);
    const idsBefore = profile.inventory.map((it) => it.id);

    const pending: ((out: net.RollRefineOutcome) => void)[] = [];
    vi.spyOn(net, 'rollRefineOnServer').mockImplementation(
      () => new Promise<net.RollRefineOutcome>((res) => pending.push(res)),
    );

    const { screen, probe } = makeRefinery(profile);
    return { profile, screen, probe, itemA, itemB, idsBefore, pending };
  }

  /** id 중복 없음 + 개수 보존 + 원래 장비 전부 생존. */
  function expectInventorySane(f: Fixture): void {
    const got = f.profile.inventory.map((it) => it.id);
    expect(new Set(got).size, `인벤토리에 id 가 중복됐다: ${got.join(',')}`).toBe(got.length);
    expect(got.length, '장비 개수가 보존되지 않았다').toBe(f.idsBefore.length);
    for (const id of f.idsBefore) expect(got, `장비 ${id} 가 소실됐다`).toContain(id);
  }

  it('① 왕복 중 다른 장비 선택 → id 중복도 소실도 없다', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const f = setup();
    f.probe.select(f.itemA);

    const p1 = f.probe.reroll(); // await spend 에서 정지
    f.probe.select(f.itemB); // ← 왕복 중 목록에서 B 클릭
    f.pending[0]?.({ status: 'unconfigured' });
    await p1;
    vi.advanceTimersByTime(2000);

    // 결정적 순간은 **다음 굴림**이다. selectedId 와 chain 이 갈리면 A 의 결과가 B 의 슬롯에 쓰인다.
    const p2 = f.probe.reroll();
    f.pending[f.pending.length - 1]?.({ status: 'unconfigured' });
    await p2;
    vi.advanceTimersByTime(2000);

    expectInventorySane(f);
  });

  it('①-b 가드를 우회해 selectedId 가 바뀌어도 chain 이 남의 슬롯을 덮지 않는다', async () => {
    // `main.ts` 처럼 진입점을 거치지 않는 외부 경로를 흉내낸다 — 가드가 아니라 **복귀 후 재검증**이
    // 이 경우를 막는 유일한 장치다.
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const f = setup();
    f.probe.select(f.itemA);

    const p1 = f.probe.reroll();
    f.probe.selectedId = f.itemB.id; // 가드 우회
    f.pending[0]?.({ status: 'unconfigured' });
    await p1;

    // A 는 값을 치렀으므로 결과가 반영돼야 하고, B 의 chain 을 A 의 chain 으로 덮으면 안 된다.
    expect(f.profile.inventory.find((it) => it.id === f.itemA.id), 'A 가 값을 치렀는데 결과가 삼켜졌다').not.toBe(
      f.itemA,
    );
    expect(f.profile.inventory.find((it) => it.id === f.itemB.id), 'B 가 굴리지도 않았는데 바뀌었다').toBe(f.itemB);

    // 다음 굴림이 결정적이다 — `selectedId`(B)와 `chain`(A 소유)이 갈린 채 굴리면 A 의 결과가
    // B 의 슬롯에 쓰여 B 가 사라지고 A 의 id 가 둘이 된다.
    vi.advanceTimersByTime(2000);
    const p2 = f.probe.reroll();
    f.pending[f.pending.length - 1]?.({ status: 'unconfigured' });
    await p2;
    vi.advanceTimersByTime(2000);
    expectInventorySane(f);
  });

  it('② 왕복 중 노 출력 변경 → 지불한 열과 적용된 열이 같다', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0); // seed = 0 · riskRoll = 0
    const f = setup();
    f.probe.select(f.itemA); // 기본 mid
    const paid = rollCost(f.itemA.rarity, f.itemA.affixes.length, 'mid');

    const p1 = f.probe.reroll();
    f.probe.heat = 'high'; // 가드 우회 — 구조가 고쳐졌는지를 본다(스냅샷 vs 재조회)
    f.pending[0]?.({ status: 'unconfigured' });
    await p1;

    expect(f.profile.minerals, 'mid 비용으로 결제되지 않았다 — 테스트 전제 실패').toBe(1_000_000 - paid);
    const after = f.profile.inventory.find((it) => it.id === f.itemA.id);
    // 고착 0 · riskRoll 0 → 용해 없음. 결과는 mid 밴드로 재단조된 것이어야 한다.
    expect(after?.affixes, '약불로 결제하고 강불 밴드를 샀다(지불한 열 ≠ 적용된 열)').toEqual(
      reforgeAffixes(f.itemA, 0, { fastened: [], band: HEAT.mid.band }).affixes,
    );
    expectInventorySane(f);
  });

  it('③ 왕복 중 화면 나가기 → 결과는 반영되고 연출은 시작되지 않는다', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const f = setup();
    f.probe.select(f.itemA);

    const p1 = f.probe.reroll();
    f.screen.hide(); // main.ts 가 close() 를 거치지 않고 직접 부르는 경로
    f.pending[0]?.({ status: 'unconfigured' });
    await p1;

    // 플레이어는 이미 값을 치렀다 — 결과를 삼키면 안 된다.
    expect(f.profile.inventory.find((it) => it.id === f.itemA.id), '값을 치렀는데 결과가 삼켜졌다').not.toBe(f.itemA);
    expect(persisted().minerals).toBe(f.profile.minerals);
    // 숨겨진 화면에서 연출을 돌리면 Ticker·setInterval 이 샌다.
    expect(f.probe.spinning, '숨겨진 화면에서 연출이 시작됐다').toBe(false);
    expectInventorySane(f);
  });
});
