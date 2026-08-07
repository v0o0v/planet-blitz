/**
 * 「회수 N점」 HUD 연출(PR#366 서버 권위 드랍 후속) 단위 커버리지.
 *
 * `WorldState.loot.length` 를 그대로 받는 `HudState.lootCount` 가 콤보와 같은 관용구로
 * DOM 에 반영되는지를 본다 — ① 0 이면 칩이 감춰지고 ② N>0 이면 그 수가 실제 문자열에
 * 실리고 ③ i18n 키가 EN/KO 양쪽에 존재한다.
 *
 * ## 왜 이 파일이 DOM 스텁을 직접 짓나
 * vitest 환경은 node 라 jsdom/happy-dom 이 없다(`vite.config.ts` `test.environment: 'node'`,
 * 리포에 jsdom 의존성 미설치). `Hud` 생성자는 `document.createElement`/`getElementById`/
 * `head`/`body` 만 쓰므로(`tests/activeSkillInput.test.ts` 의 `stubElement` 관용구와 같은
 * 폭) 최소 표면만 흉내 낸 스텁으로 충분하다 — 실제 렌더 정확도는 이 파일의 관심사가 아니다.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hud, type HudState } from '../src/ui/hud.js';
import { t } from '../src/i18n/index.js';
import { EN, KO } from '../src/i18n/catalog.js';

// ---------------------------------------------------------------------------
// 최소 DOM 스텁 — Hud 생성자/update() 가 실제로 쓰는 표면(createElement/appendChild/
// style/className/textContent/addEventListener)만 흉내 낸다.
// ---------------------------------------------------------------------------

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
      // no-op — 텍스트 노드 삽입까지는 흉내 내지 않는다(이 파일은 pb-loot 칩만 본다).
    },
    addEventListener() {
      // no-op — 이 파일은 클릭 배선(이탈 버튼 등)을 보지 않는다.
    },
    removeEventListener() {
      // no-op
    },
  };
  return el;
}

/** className 으로 트리를 훑어 첫 매치를 돌려준다(콤보/회수 칩 검증용). */
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

describe('HUD — 회수 개수 칩', () => {
  it('lootCount 0 이면 칩이 감춰진다(빈 문자열 — 콤보와 같은 관용구)', () => {
    const hud = new Hud('hud');
    hud.update(baseState({ lootCount: 0 }));
    const chip = findByClass(bodyEl, 'pb-loot');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe('');
  });

  it('lootCount > 0 이면 그 수가 실제로 문자열에 실린다', () => {
    const hud = new Hud('hud');
    hud.update(baseState({ lootCount: 7 }));
    const chip = findByClass(bodyEl, 'pb-loot');
    expect(chip?.textContent).toBe(t('hud.lootCount', { n: 7 }));
    expect(chip?.textContent).toContain('7');
  });

  it('lootCount 가 갱신되면 칩 문구도 같이 갱신된다', () => {
    const hud = new Hud('hud');
    hud.update(baseState({ lootCount: 3 }));
    hud.update(baseState({ lootCount: 0 }));
    const chip = findByClass(bodyEl, 'pb-loot');
    expect(chip?.textContent).toBe('');
  });

  it('i18n 키 hud.lootCount 가 EN/KO 양쪽에 존재한다', () => {
    expect(EN['hud.lootCount']).toBeTruthy();
    expect(KO['hud.lootCount']).toBeTruthy();
    expect(EN['hud.lootCount']).toContain('{n}');
    expect(KO['hud.lootCount']).toContain('{n}');
  });
});
