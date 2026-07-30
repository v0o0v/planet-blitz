/**
 * 액티브 스킬 입력 배선 게이트(ADR-0041 · 계획 0a-11/0b-5 · AC-6/AC-7).
 *
 * `encounterInputWiring.test.ts` 와 같은 규율을 따른다 — 합성 `special` 을 sim 에 직접
 * 먹이는 단언은 두지 않고, `InputController.sample()` 이 돌려준 실물 프레임과 실물
 * `EncounterOverlay.onKeyDown`(window keydown 리스너 경유) 만 본다.
 *
 * ## AC-6 — z/x → 비트 9·10
 * `KeyZ`/`KeyX` 키다운이 `sample()` 의 `special` 에 `SPECIAL_ACTIVE_SLOT1`/`SLOT2` 를 싣고,
 * 파워업 픽 대기 중에는 (조우 비트와 달리) **버려진다**(ADR-0041 "프리즈 중 입력은 버린다").
 *
 * ## AC-7 — detour 이탈 키 이설, 양방향
 * `KeyX` 가 액티브 슬롯 2 와 충돌해 detour 이탈이 `KeyQ` 로 옮겨갔다. 이설이 **완결**됐는지는
 * 새 키가 되는 것만으론 증명되지 않는다 — 옛 키가 더 이상 안 되는 것까지 확인해야
 * "부분 이설"(양쪽 다 먹는 상태)을 걸러낸다.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { InputController } from '../src/input/controller.js';
import { SPECIAL_POWERUP_PICK } from '../src/sim/world.js';
import { SPECIAL_ACTIVE_SLOT1, SPECIAL_ACTIVE_SLOT2 } from '../data/inputBits.js';
import { EncounterOverlay, type EncounterPromptView } from '../src/ui/encounterOverlay.js';
import { ENCOUNTER_TYPE } from '../data/encounters.js';
import type { GameApp } from '../src/render/app.js';

// ---------------------------------------------------------------------------
// 최소 DOM/BOM 스텁 — `encounterInputWiring.test.ts` 의 window 스텁 규율을 그대로 따르되,
// 이 파일은 EncounterOverlay 도 실물로 구성해야 하므로 keydown 리스너를 실제로 붙잡아
// 디스패치할 수 있게 하고, `document` 도 최소한으로 스텁한다(둘 다 프로덕션 경로를 우회하지
// 않는 범위 — `onKeyDown` 자체는 절대 감싸지 않는다).
// ---------------------------------------------------------------------------

type Listener = (e: { code: string; preventDefault: () => void }) => void;

interface WindowStub {
  addEventListener: (type: string, fn: Listener) => void;
  removeEventListener: (type: string, fn: Listener) => void;
  dispatchKeydown: (code: string) => void;
}

function makeWindowStub(): WindowStub {
  const listeners: Record<string, Listener[]> = {};
  return {
    addEventListener: (type, fn) => {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener: (type, fn) => {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
    },
    dispatchKeydown: (code) => {
      for (const fn of listeners.keydown ?? []) fn({ code, preventDefault: () => undefined });
    },
  };
}

/** `EncounterOverlay` 생성자가 부르는 최소 DOM 표면(createElement/head/body 만). */
function stubElement(): HTMLElement {
  const el = {
    style: {} as Record<string, string>,
    children: [] as unknown[],
    appendChild(child: unknown) {
      el.children.push(child);
      return child;
    },
    append(...args: unknown[]) {
      el.children.push(...args);
    },
    setAttribute() {
      // no-op
    },
    addEventListener() {
      // no-op — 이 스텁 트리 안 요소에는 클릭 핸들러가 안 걸려도 이 파일의 관심사와 무관하다.
    },
    removeEventListener() {
      // no-op
    },
    get textContent(): string {
      return (el as unknown as { _text: string })._text ?? '';
    },
    set textContent(v: string) {
      (el as unknown as { _text: string })._text = v;
    },
    get innerHTML(): string {
      return '';
    },
    set innerHTML(_v: string) {
      el.children = [];
    },
  };
  return el as unknown as HTMLElement;
}

interface DocumentStub {
  createElement: () => HTMLElement;
  readonly head: HTMLElement;
  readonly body: HTMLElement;
}

let windowStub: WindowStub;
let hadWindow = false;
let hadDocument = false;

beforeAll(() => {
  hadWindow = 'window' in globalThis;
  windowStub = makeWindowStub();
  if (!hadWindow) {
    (globalThis as unknown as { window: WindowStub }).window = windowStub;
  } else {
    // 이미 window 가 있으면(다른 vitest 워커 셋업) 그 window 에 우리 스텁 리스너 캡처를 못
    // 얹으므로, 이 파일의 window 참조를 독립적으로 우리 스텁으로 덮어써 격리한다.
    (globalThis as unknown as { window: WindowStub }).window = windowStub;
  }
  hadDocument = 'document' in globalThis;
  if (!hadDocument) {
    const docStub: DocumentStub = {
      createElement: () => stubElement(),
      head: stubElement(),
      body: stubElement(),
    };
    (globalThis as unknown as { document: DocumentStub }).document = docStub;
  }
});

afterAll(() => {
  if (!hadWindow) {
    delete (globalThis as unknown as { window?: WindowStub }).window;
  }
  if (!hadDocument) {
    delete (globalThis as unknown as { document?: DocumentStub }).document;
  }
});

function stubGameApp(): GameApp {
  return {
    clientToDesign: () => ({ x: 960, y: 540 }),
  } as unknown as GameApp;
}

function makeController(): InputController {
  return new InputController(stubGameApp());
}

/** `sample()` 실물 호출 — 플레이어 좌표는 원점 고정(조준각 무관심). */
function sampleSpecial(c: InputController): number {
  return c.sample(0, 0).special;
}

// ---------------------------------------------------------------------------
// AC-6 ① 키다운 → 비트 생성
// ---------------------------------------------------------------------------

describe('InputController — z/x 키다운이 액티브 슬롯 비트를 만든다', () => {
  it('KeyZ 키다운 → sample().special 에 SPECIAL_ACTIVE_SLOT1(비트 9)이 실린다', () => {
    const c = makeController();
    windowStub.dispatchKeydown('KeyZ');
    expect(sampleSpecial(c) & SPECIAL_ACTIVE_SLOT1).not.toBe(0);
  });

  it('KeyX 키다운 → sample().special 에 SPECIAL_ACTIVE_SLOT2(비트 10)가 실린다', () => {
    const c = makeController();
    windowStub.dispatchKeydown('KeyX');
    expect(sampleSpecial(c) & SPECIAL_ACTIVE_SLOT2).not.toBe(0);
  });

  it('아무 키도 안 누르면 액티브 비트가 안 실린다', () => {
    const c = makeController();
    expect(sampleSpecial(c) & (SPECIAL_ACTIVE_SLOT1 | SPECIAL_ACTIVE_SLOT2)).toBe(0);
  });

  it('한 번 누르면 다음 sample 에서는 사라진다(1회성 소비)', () => {
    const c = makeController();
    windowStub.dispatchKeydown('KeyZ');
    expect(sampleSpecial(c) & SPECIAL_ACTIVE_SLOT1).not.toBe(0);
    expect(sampleSpecial(c) & SPECIAL_ACTIVE_SLOT1).toBe(0);
  });

  it('z·x 동시 입력이면 두 비트가 함께 실린다', () => {
    const c = makeController();
    windowStub.dispatchKeydown('KeyZ');
    windowStub.dispatchKeydown('KeyX');
    const special = sampleSpecial(c);
    expect(special & SPECIAL_ACTIVE_SLOT1).not.toBe(0);
    expect(special & SPECIAL_ACTIVE_SLOT2).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-6 ② 파워업 픽 대기 중에는 액티브 비트가 실리지 않는다(ADR-0041 프리즈 규율)
// ---------------------------------------------------------------------------

describe('파워업 픽 대기 중에는 액티브 비트를 버린다(조우 비트와 반대 규율)', () => {
  it('같은 프레임에 파워업 픽과 z 를 같이 누르면 파워업만 실린다', () => {
    const c = makeController();
    c.queuePowerupPick(1);
    windowStub.dispatchKeydown('KeyZ');
    const first = sampleSpecial(c);
    expect(first & SPECIAL_POWERUP_PICK).not.toBe(0);
    expect(first & SPECIAL_ACTIVE_SLOT1).toBe(0);
  });

  it('조우 비트와 달리, 프리즈가 풀린 다음 프레임에도 이월되지 않는다(버려짐)', () => {
    const c = makeController();
    c.queuePowerupPick(0);
    windowStub.dispatchKeydown('KeyZ');
    sampleSpecial(c); // 프리즈 프레임(파워업만).
    const second = sampleSpecial(c);
    expect(second & SPECIAL_ACTIVE_SLOT1).toBe(0);
  });

  it('z·x 둘 다 대기 중이어도 파워업 프레임엔 둘 다 안 실린다', () => {
    const c = makeController();
    c.queuePowerupPick(2);
    windowStub.dispatchKeydown('KeyZ');
    windowStub.dispatchKeydown('KeyX');
    const special = sampleSpecial(c);
    expect(special & SPECIAL_ACTIVE_SLOT1).toBe(0);
    expect(special & SPECIAL_ACTIVE_SLOT2).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-6 ③ 리플레이 라운드트립 — InputFrame 이 JSON 왕복 후에도 비트를 보존한다
// ---------------------------------------------------------------------------

describe('special 값이 리플레이 InputFrame 라운드트립을 통과한다', () => {
  it('z 로 만든 프레임을 JSON.stringify → parse 해도 SPECIAL_ACTIVE_SLOT1 이 그대로 남는다', () => {
    const c = makeController();
    windowStub.dispatchKeydown('KeyZ');
    const frame = c.sample(0, 0);
    const roundtripped = JSON.parse(JSON.stringify(frame)) as typeof frame;
    expect(roundtripped).toEqual(frame);
    expect(roundtripped.special & SPECIAL_ACTIVE_SLOT1).not.toBe(0);
  });

  it('x 로 만든 프레임도 동일하게 라운드트립을 통과한다', () => {
    const c = makeController();
    windowStub.dispatchKeydown('KeyX');
    const frame = c.sample(0, 0);
    const roundtripped = JSON.parse(JSON.stringify(frame)) as typeof frame;
    expect(roundtripped).toEqual(frame);
    expect(roundtripped.special & SPECIAL_ACTIVE_SLOT2).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-7 — detour 이탈 KeyX → KeyQ 이설, 양방향
// ---------------------------------------------------------------------------

function detourView(): EncounterPromptView {
  return { kind: 'detour', type: ENCOUNTER_TYPE.treasureVault, detourTimer: 600 };
}

describe('EncounterOverlay — detour 이탈 키 이설(AC-7, 양방향)', () => {
  it('KeyQ 가 detour 를 이탈시킨다(새 키가 동작한다)', () => {
    let exited = false;
    const overlay = new EncounterOverlay({
      onEnter: () => undefined,
      onDecline: () => undefined,
      onAltarPick: () => undefined,
      onExit: () => {
        exited = true;
      },
    });
    overlay.update(detourView());
    windowStub.dispatchKeydown('KeyQ');
    expect(exited).toBe(true);
    overlay.destroy();
  });

  it('KeyX 는 더 이상 detour 를 이탈시키지 않는다(옛 키가 죽었다)', () => {
    let exited = false;
    const overlay = new EncounterOverlay({
      onEnter: () => undefined,
      onDecline: () => undefined,
      onAltarPick: () => undefined,
      onExit: () => {
        exited = true;
      },
    });
    overlay.update(detourView());
    windowStub.dispatchKeydown('KeyX');
    expect(exited).toBe(false);
    overlay.destroy();
  });

  it('오버레이가 보이지 않을 때는 KeyQ 도 먹지 않는다(가시성 게이트 유지 확인)', () => {
    let exited = false;
    const overlay = new EncounterOverlay({
      onEnter: () => undefined,
      onDecline: () => undefined,
      onAltarPick: () => undefined,
      onExit: () => {
        exited = true;
      },
    });
    // update() 를 한 번도 안 불러 숨김 상태 유지.
    windowStub.dispatchKeydown('KeyQ');
    expect(exited).toBe(false);
    overlay.destroy();
  });
});
