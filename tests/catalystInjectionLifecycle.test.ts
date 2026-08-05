/**
 * 주입 촉매의 **수명** — 출격이 떠나면 선택이 비워진다 (사용자 신고 2026-08-05
 * "전 런에 주입한 촉매가 다음 런에도 주입된 상태로 남아있다").
 *
 * ## 결함의 자리
 * `PlanetSelectScreen` 은 `main.ts` 가 **한 번 만들어 런 사이에 계속 재사용**한다. `launch()` 는
 * 주입 배열을 `sel` 로 복사해 넘길 뿐 자기 상태를 비우지 않았고, 비워 주는 곳도 없었다. 그래서
 * 다음 성계 지도에 지난 주입이 그대로 살아 있었고, 그대로 출격하면 **고르지도 않은 촉매가 한 번
 * 더 소모된다**(consume 은 보유분이 남아 있으면 그냥 성공한다).
 *
 * ## 왜 화면이 스스로 못 비우는가 — 이 파일이 고정하는 설계
 * 출격은 `consume_catalysts` 를 거치는데 거부·오프라인이면 **런이 시작되지 않고 성계 지도로
 * 되돌아온다**. 그 경로에서 아이템은 미소모라 주입이 남아 있어야 재시도가 된다. 즉 "비워도 되는
 * 시점"은 화면이 알 수 없고 출격 오케스트레이터만 안다. 그래서:
 *  - 화면은 `clearInjectedCatalysts()` 만 제공하고 `launch()` 에서는 **비우지 않는다**(아래 §2).
 *  - 실제로 부르는 책임은 `main.ts` 에 있다 — 단위 테스트가 못 닿는 자리라 소스 게이트로 잠근다(§3).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Container, Text, DOMAdapter } from 'pixi.js';

import { PlanetSelectScreen } from '../src/ui/pixi/planetSelect.js';
import { CATALYSTS } from '../src/data/catalysts.js';
import { planetById } from '../data/planets.js';
import { t } from '../src/i18n/index.js';

/** node 환경 스텁(`tests/planetSelectStage.test.ts` 선례와 동일 — 측정만 되는 최소 어댑터). */
beforeAll(() => {
  if (typeof globalThis.document === 'undefined') {
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
  }
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
});

/** 어느 행성에서도 잠기지 않는 공용 촉매 두 종(특산은 행성이 바뀌면 pruned 된다). */
const COMMON_IDS = CATALYSTS.filter((c) => c.kind === 'common')
  .slice(0, 2)
  .map((c) => c.id);

const TAP_EVENT = {} as never;

function labelsOf(node: Container): string[] {
  const out: string[] = [];
  const walk = (n: Container): void => {
    if (n instanceof Text) out.push(n.text);
    for (const c of n.children) if (c instanceof Container) walk(c);
  };
  walk(node);
  return out;
}

/** 라벨이 정확히 `label` 인 클릭 가능 대상(후위 순회 — 가장 안쪽 우선). */
function findButton(root: Container, label: string): Container | null {
  const walk = (node: Container): Container | null => {
    for (const child of node.children) {
      if (child instanceof Container) {
        const hit = walk(child);
        if (hit !== null) return hit;
      }
    }
    if (node.eventMode === 'static' && node.cursor === 'pointer' && labelsOf(node).includes(label)) {
      return node;
    }
    return null;
  };
  return walk(root);
}

function openScreen(): {
  stage: Container;
  screen: PlanetSelectScreen;
  launched: { catalysts?: readonly number[] }[];
} {
  const stage = new Container();
  const screen = new PlanetSelectScreen(stage);
  const launched: { catalysts?: readonly number[] }[] = [];
  screen.show({
    meta: '',
    bestStageCleared: () => 0,
    onLaunch: (sel) => launched.push(sel),
    onInventory: () => {},
  });
  return { stage, screen, launched };
}

describe('§1 clearInjectedCatalysts — 선택을 비운다', () => {
  it('주입을 비우고, 두 번 불러도 안전하다', () => {
    const { screen } = openScreen();
    screen.setInjectedCatalysts(COMMON_IDS);
    expect(screen.getInjectedCatalysts()).toHaveLength(COMMON_IDS.length);
    screen.clearInjectedCatalysts();
    expect(screen.getInjectedCatalysts()).toEqual([]);
    screen.clearInjectedCatalysts(); // 빈 상태 재호출 — 던지지 않는다.
    expect(screen.getInjectedCatalysts()).toEqual([]);
  });

  it('화면이 숨어 있어도 상태는 비워진다 — 출격 직후엔 이미 hide 된 뒤다', () => {
    const { screen } = openScreen();
    screen.setInjectedCatalysts(COMMON_IDS);
    screen.hide();
    screen.clearInjectedCatalysts();
    expect(
      screen.getInjectedCatalysts(),
      '숨은 화면에서 비우기가 무시되면 출격 직후 호출이 전부 헛돈다',
    ).toEqual([]);
  });
});

describe('§2 launch — 주입을 실어 보내되 **스스로 비우지는 않는다**', () => {
  it('출격 선택에 주입 촉매가 실린다', () => {
    const { stage, screen, launched } = openScreen();
    screen.setInjectedCatalysts(COMMON_IDS);
    const label = t('planet.launch', { name: planetById(0).name });
    const btn = findButton(stage, label);
    expect(btn, `출격 버튼(${label})을 찾지 못했다`).not.toBeNull();
    btn?.emit('pointertap', TAP_EVENT);
    expect(launched).toHaveLength(1);
    expect(launched[0]?.catalysts).toEqual(COMMON_IDS);
  });

  it('출격했다고 화면이 스스로 비우지 않는다 — 소모 거부 시 재시도할 것이 남아야 한다', () => {
    // ⚠️ 여기를 "고쳐서" launch 안에서 비우면 consume 실패·오프라인 폴백에서 재시도할 선택이
    //    사라진다(`consumeAndLaunch` 의 onRetry/onCancel 계약). 비우는 책임은 §3 의 호출부다.
    const { stage, screen } = openScreen();
    screen.setInjectedCatalysts(COMMON_IDS);
    findButton(stage, t('planet.launch', { name: planetById(0).name }))?.emit(
      'pointertap',
      TAP_EVENT,
    );
    expect(screen.getInjectedCatalysts()).toEqual(COMMON_IDS);
  });
});

/**
 * §3 호출부 게이트 — **이 결함의 진짜 자리**다.
 *
 * §1·§2 는 화면만 본다. 화면 API 가 완벽해도 `main.ts` 가 안 부르면 증상은 그대로이고, 신고
 * 당시가 정확히 그 상태였다(부르는 곳이 아예 없었다). 출격 오케스트레이션은 렌더·네트워크가
 * 얽혀 단위 테스트로 도달할 수 없으므로 소스 게이트로 잠근다
 * (`tests/commissionWorldRebind.test.ts`·`tests/bossWarn.test.ts` 와 같은 방식).
 */
describe('§3 main.ts 배선 — 런이 떠난 경로에서만 비운다', () => {
  const CLEAR = 'planetSelect.clearInjectedCatalysts()';

  function src(rel: string): string {
    return readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
  }
  /** 주석 제거 — 주석 속 문구가 게이트를 통과시키면 그건 게이트가 아니다. */
  function stripComments(text: string): string {
    return text
      .split('\n')
      .map((l) => {
        const i = l.indexOf('//');
        return i < 0 ? l : l.slice(0, i);
      })
      .join('\n');
  }
  /** `from` 다음부터 `to` 직전까지. 앵커가 없으면 던진다(앵커 드리프트 = 실패). */
  function between(text: string, from: string, to: string): string {
    const a = text.indexOf(from);
    if (a < 0) throw new Error(`앵커를 찾지 못했다: ${from}`);
    const b = text.indexOf(to, a + from.length);
    if (b < 0) throw new Error(`앵커를 찾지 못했다: ${to}`);
    return text.slice(a + from.length, b);
  }

  const main = stripComments(src('src/main.ts'));

  it('소모 성공 경로에서 비운다 — 여기를 놓치면 신고된 증상 그대로다', () => {
    const ok = between(main, 'consumeCatalystsOnServer(', 'catalystSortieModal.show({');
    expect(ok, '소모가 확정됐는데 주입 선택을 안 비운다').toContain(CLEAR);
  });

  it('[촉매 빼고 출격]도 비운다 — 미소모지만 런은 실제로 떠났다', () => {
    const skip = between(main, 'onSkip:', 'onCancel:');
    expect(skip, '무촉매 출격 후에도 지난 선택이 남아 다음 런에 소모된다').toContain(CLEAR);
  });

  it('재시도·취소에서는 비우지 않는다 — 재시도할 선택이 사라지면 안 된다', () => {
    const retry = between(main, 'onRetry:', 'onSkip:');
    expect(retry, '재시도 경로가 선택을 비운다').not.toContain(CLEAR);
    const cancel = between(main, 'onCancel:', '}');
    expect(cancel, '취소 경로가 선택을 비운다').not.toContain(CLEAR);
  });
});
