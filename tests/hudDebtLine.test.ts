/**
 * 「누적 부채」 런 중 HUD 줄(`id 18 mercantile` — 설계 명세 §신호 2) 단위 커버리지.
 *
 * 명세가 요구하는 셋 중 이 파일이 잠그는 것은 **"받을 때마다 HUD 에 부채 총액이 쌓인다"** 다:
 *  ① 미소지 런(`debt` 미지정) → 줄 자체가 서지 않는다(무촉매 런 화면 불변)
 *  ② 소지했으나 아직 안 받음(`debt: 0`) → 역시 줄이 서지 않는다
 *  ③ `debt: 40` / `80` → 그 값이 실제 문자열에 실리고, 프레임이 넘어가면 갱신된다
 *  ④ 문구가 3택 오버레이(`powerup.debt.total`)와 **같은 어휘**다
 *
 * ## 왜 이 파일이 DOM 스텁을 직접 짓나
 * vitest 환경이 node 라 jsdom/happy-dom 이 없다 — `tests/hudLootCount.test.ts` 와 같은 이유·같은
 * 관용구다(`Hud` 가 실제로 쓰는 표면만 흉내 낸다).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hud, type HudState } from '../src/ui/hud.js';
import { t, setLocale } from '../src/i18n/index.js';
import { EN, KO } from '../src/i18n/catalog.js';

interface StubElement {
  id: string;
  className: string;
  style: Record<string, string>;
  children: StubElement[];
  textContent: string;
  appendChild(child: StubElement): StubElement;
  append(...args: unknown[]): void;
  addEventListener(): void;
  removeEventListener(): void;
}

function makeStubElement(): StubElement {
  const el: StubElement = {
    id: '',
    className: '',
    style: {},
    children: [],
    textContent: '',
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    append() {
      // no-op — 텍스트 노드 삽입까지는 흉내 내지 않는다.
    },
    addEventListener() {
      // no-op
    },
    removeEventListener() {
      // no-op
    },
  };
  return el;
}

function findByClass(root: StubElement, cls: string): StubElement | null {
  if (root.className === cls) return root;
  for (const c of root.children) {
    const found = findByClass(c, cls);
    if (found !== null) return found;
  }
  return null;
}

interface DocumentStub {
  createElement: (tag: string) => StubElement;
  getElementById: (id: string) => StubElement | null;
  readonly head: StubElement;
  readonly body: StubElement;
}

let hostEl: StubElement;
let bodyEl: StubElement;
let hadDocument = false;

beforeEach(() => {
  hadDocument = 'document' in globalThis;
  hostEl = makeStubElement();
  hostEl.id = 'hud';
  bodyEl = makeStubElement();
  const docStub: DocumentStub = {
    createElement: () => makeStubElement(),
    getElementById: (id) => (id === 'hud' ? hostEl : null),
    head: makeStubElement(),
    body: bodyEl,
  };
  (globalThis as unknown as { document: DocumentStub }).document = docStub;
});

afterEach(() => {
  setLocale('en'); // 다른 테스트에 로케일 누수 방지.
  if (!hadDocument) {
    delete (globalThis as unknown as { document?: DocumentStub }).document;
  }
});

function baseState(overrides: Partial<HudState> = {}): HudState {
  return {
    hp: 10,
    maxHp: 10,
    xp: 0,
    xpNeed: 10,
    level: 1,
    timeSec: 0,
    combo: 0,
    multiplier: 1,
    lootCount: 0,
    supplyActive: false,
    ...overrides,
  };
}

/** 부채 줄 노드. 구조는 항상 있고(생성자에서 한 번만 짓는다), 표시 여부는 `style.display` 다. */
function debtLine(): StubElement {
  const el = findByClass(bodyEl, 'pb-debt');
  expect(el, '부채 줄 노드를 찾지 못했다').not.toBeNull();
  return el as StubElement;
}

describe('HUD — 누적 부채 줄 (id 18 mercantile)', () => {
  it('미소지 런(debt 미지정)에서는 줄이 서지 않는다 — 무촉매 런 화면 불변', () => {
    const hud = new Hud('hud');
    hud.update(baseState());
    const line = debtLine();
    expect(line.style.display).toBe('none');
    expect(line.textContent).toBe('');
  });

  it('소지했으나 아직 빚 카드를 안 받았으면(debt 0) 줄이 서지 않는다', () => {
    const hud = new Hud('hud');
    hud.update(baseState({ debt: 0 }));
    const line = debtLine();
    expect(line.style.display).toBe('none');
    expect(line.textContent).toBe('');
  });

  it('debt 40 이면 그 값이 실제 문자열에 실린다', () => {
    const hud = new Hud('hud');
    hud.update(baseState({ debt: 40 }));
    const line = debtLine();
    expect(line.style.display).toBe('block');
    expect(line.textContent).toBe(t('hud.debt.total', { n: 40 }));
    expect(line.textContent).toContain('40');
  });

  it('두 번째로 받아 debt 80 이 되면 줄도 80 으로 갱신된다("받을 때마다 쌓인다")', () => {
    const hud = new Hud('hud');
    hud.update(baseState({ debt: 40 }));
    hud.update(baseState({ debt: 80 }));
    const line = debtLine();
    expect(line.style.display).toBe('block');
    expect(line.textContent).toContain('80');
    expect(line.textContent).not.toContain('40');
  });

  it('부채가 0 으로 돌아가면 줄이 다시 감춰진다(값 잔상 없음)', () => {
    const hud = new Hud('hud');
    hud.update(baseState({ debt: 40 }));
    hud.update(baseState({ debt: 0 }));
    const line = debtLine();
    expect(line.style.display).toBe('none');
    expect(line.textContent).toBe('');
  });

  it('⭐ 부채 줄은 topline 밖이다 — topline flex 자식은 여전히 정확히 둘', () => {
    // 셋이 되면 `justify-content:space-between` 이 콤보를 중앙으로 민다(회수 칩이 이미 밟은 결함).
    const hud = new Hud('hud');
    hud.update(baseState({ debt: 40 }));
    const topline = findByClass(bodyEl, 'pb-topline');
    expect(topline?.children.length).toBe(2);
  });

  it('KO 로케일에서도 값이 실린다', () => {
    setLocale('ko');
    const hud = new Hud('hud');
    hud.update(baseState({ debt: 120 }));
    expect(debtLine().textContent).toBe(t('hud.debt.total', { n: 120 }));
    expect(debtLine().textContent).toContain('120');
  });

  it('i18n 키 hud.debt.total 이 EN/KO 양쪽에 있고 3택 오버레이와 같은 어휘다', () => {
    expect(EN['hud.debt.total']).toBeTruthy();
    expect(KO['hud.debt.total']).toBeTruthy();
    expect(EN['hud.debt.total']).toContain('{n}');
    expect(KO['hud.debt.total']).toContain('{n}');
    // 같은 카드가 두 화면에서 다른 말을 쓰면 안 된다(과제 §2).
    expect(EN['hud.debt.total']).toBe(EN['powerup.debt.total']);
    expect(KO['hud.debt.total']).toBe(KO['powerup.debt.total']);
  });
});
