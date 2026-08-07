/**
 * 런 중 **촉매 3칸 스트립 + 번쩍임** — `src/ui/hud.ts` (ADR-0052 헌장 §귀속 규율 1).
 *
 * 헌장이 요구하는 것은 "촉매가 발동할 때마다 HUD 슬롯의 **그 촉매 아이콘이** 번쩍인다(3칸 고정
 * 배치)" 다. 그 요구가 화면에서 성립하려면 셋이 참이어야 하고, 이 파일이 그 셋만 본다.
 *
 *  1. **칸 수가 주입 수에 따라 흔들리지 않는다** — 한 장만 걸어도 칸은 셋이다. 칸 자리가
 *     주입 수마다 바뀌면 "몇 번째 칸이 번쩍였나"가 카드를 지목하지 못한다.
 *  2. **번쩍임이 그 카드의 칸에만 붙는다** — 아무 칸이나 번쩍이면 귀속이 아니라 소음이다.
 *  3. **주입 안 된 id 는 조용히 무시된다** — 런마다 슬롯이 다르고, 배선 레인이 쏘는 이벤트가
 *     이 런에 없는 촉매를 가리킬 수 있다(예외를 던지면 그 프레임이 죽는다).
 *
 * ## 왜 DOM 스텁을 직접 짓나
 * vitest 환경이 node 라 jsdom 이 없다(`tests/hudLootCount.test.ts` 와 같은 사정). `Hud` 가 이
 * 경로에서 실제로 쓰는 표면만 흉내 낸다 — `classList`·`replaceChildren`·`title` 이 추가로 필요하다.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CATALYST_SLOT_CELLS, Hud, type RunInfoState } from '../src/ui/hud.js';
import { SLOT_CAP } from '../src/data/catalysts.js';

interface StubElement {
  id: string;
  className: string;
  title: string;
  src: string;
  alt: string;
  style: Record<string, string>;
  children: StubElement[];
  textContent: string;
  classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean };
  appendChild(child: StubElement): StubElement;
  append(...args: unknown[]): void;
  replaceChildren(): void;
  addEventListener(): void;
  removeEventListener(): void;
}

function makeStubElement(): StubElement {
  const classes = new Set<string>();
  const el: StubElement = {
    id: '',
    className: '',
    title: '',
    src: '',
    alt: '',
    style: {},
    children: [],
    textContent: '',
    classList: {
      add: (c) => void classes.add(c),
      remove: (c) => void classes.delete(c),
      contains: (c) => classes.has(c),
    },
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    append() {
      // no-op — 텍스트 노드까지는 흉내 내지 않는다.
    },
    replaceChildren() {
      el.children.length = 0;
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

/** className 이 `cls` 로 시작하는 노드를 전부 모은다(`pb-ri-slot` 과 `pb-ri-slot empty` 둘 다). */
function collectByClassPrefix(root: StubElement, cls: string, out: StubElement[] = []): StubElement[] {
  if (root.className === cls || root.className.startsWith(`${cls} `)) out.push(root);
  for (const c of root.children) collectByClassPrefix(c, cls, out);
  return out;
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
  if (!hadDocument) delete (globalThis as unknown as { document?: DocumentStub }).document;
});

function runInfo(catalysts: RunInfoState['catalysts']): RunInfoState {
  return {
    planetName: '카르곤',
    stageLabel: '3단계',
    catalystLabel: `촉매 ${catalysts.length}장`,
    resonanceHead: '공명',
    resonanceLabel: '아직 공명 없음',
    catalysts,
  };
}

describe('HUD 촉매 슬롯 — 3칸 고정', () => {
  it('⚠️ 칸 수가 `SLOT_CAP` 과 같다(둘이 갈리면 픽커 배치와 런 배치가 어긋난다)', () => {
    expect(CATALYST_SLOT_CELLS).toBe(SLOT_CAP);
  });

  it('주입이 하나뿐이어도 칸은 셋이고 나머지는 빈 칸이다', () => {
    const hud = new Hud('hud');
    hud.setRunInfo(runInfo([{ id: 0, name: '풍요' }]));
    const cells = collectByClassPrefix(bodyEl, 'pb-ri-slot');
    expect(cells).toHaveLength(CATALYST_SLOT_CELLS);
    expect(cells.filter((c) => c.className.includes('empty'))).toHaveLength(CATALYST_SLOT_CELLS - 1);
  });

  it('주입이 없어도 빈 칸 셋을 그린다("아무것도 안 걸었다"와 "표시가 안 된다"는 다르다)', () => {
    const hud = new Hud('hud');
    hud.setRunInfo(runInfo([]));
    const cells = collectByClassPrefix(bodyEl, 'pb-ri-slot');
    expect(cells).toHaveLength(CATALYST_SLOT_CELLS);
    for (const c of cells) expect(c.className).toContain('empty');
  });

  it('아이콘이 없으면 이름 앞 두 글자로 접는다(칸이 비어 보이면 안 된다)', () => {
    const hud = new Hud('hud');
    hud.setRunInfo(runInfo([{ id: 0, name: '풍요' }]));
    const names = collectByClassPrefix(bodyEl, 'pb-ri-slotname');
    expect(names).toHaveLength(1);
    expect(names[0]?.textContent).toBe('풍요');
  });
});

describe('HUD 촉매 슬롯 — flashCatalystSlot(귀속 규율)', () => {
  it('발동한 촉매의 칸에만 flash 가 붙는다', () => {
    const hud = new Hud('hud');
    hud.setRunInfo(
      runInfo([
        { id: 0, name: '풍요' },
        { id: 1, name: '약탈' },
      ]),
    );
    const cells = collectByClassPrefix(bodyEl, 'pb-ri-slot');
    hud.flashCatalystSlot(1);
    // 둘째 칸(= id 1)만 번쩍인다 — 아무 칸이나 번쩍이면 귀속이 아니라 소음이다.
    expect(cells[0]?.classList.contains('flash')).toBe(false);
    expect(cells[1]?.classList.contains('flash')).toBe(true);
    expect(cells[2]?.classList.contains('flash')).toBe(false);
  });

  it('이 런에 없는 id 는 조용히 무시된다(던지면 그 프레임이 죽는다)', () => {
    const hud = new Hud('hud');
    hud.setRunInfo(runInfo([{ id: 0, name: '풍요' }]));
    expect(() => hud.flashCatalystSlot(47)).not.toThrow();
    const cells = collectByClassPrefix(bodyEl, 'pb-ri-slot');
    for (const c of cells) expect(c.classList.contains('flash')).toBe(false);
  });

  it('정보판을 다시 세우면 옛 칸을 붙잡지 않는다(죽은 노드 참조 = 누수)', () => {
    const hud = new Hud('hud');
    hud.setRunInfo(runInfo([{ id: 0, name: '풍요' }]));
    const stale = collectByClassPrefix(bodyEl, 'pb-ri-slot')[0];
    hud.setRunInfo(null);
    hud.flashCatalystSlot(0);
    expect(stale?.classList.contains('flash')).toBe(false);
  });
});
