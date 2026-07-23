/**
 * 하네스 종료-정산 훅 **배선** 테스트 (ADR-0008 / DEV 하네스).
 *
 * 이 저장소의 대표 반복 결함은 "단위 테스트는 전부 그린인데 배선이 통째로 없다" 이다.
 * `HarnessHost.settleIfRunOver` 가 정확히 그 사례였다 — `src/harness/core.ts` 가 optional
 * 훅을 선언하고 `ff` 가 부르는데 `src/main.ts` 의 호스트 리터럴에 키가 없어서 **조용한
 * no-op** 이었고, rAF 가 안 도는 환경(백그라운드 탭·headless)에서는 hp 0 인 런이 영영
 * `screen === 'run'` 에 머물렀다.
 *
 * 그래서 이 파일은 두 축으로 못박는다:
 *  1. **배선(소스)** — `main.ts` 의 호스트 리터럴에 훅이 실제로 있고, ticker 와 **같은
 *     함수**를 부르며(판정 복제 금지), 그 함수가 sim 을 스텝하지 않는다.
 *     `main.ts` 는 import 시 `main()` 을 즉시 실행하는 브라우저 엔트리라(Pixi/WebGL/DOM)
 *     node 에서 로드할 수 없다 — 그래서 이 축만 소스 대조다(저장소 기존 패턴:
 *     `tests/m7bIntegration.test.ts`, `tests/shipIntegration.test.ts`).
 *  2. **거동(실행)** — 실제 `createHarness` + 실제 sim(`createWorld`/`stepWorld`) + 실제
 *     `shouldEnterSettlement` 로 런을 죽여 보고, 전이·결정론·오염 격리를 확인한다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHarness } from '../src/harness/core.js';
import type { HarnessHost, HarnessInvasionResolved } from '../src/harness/core.js';
import { createWorld, DEFAULT_CONFIG, emptyInput, stepWorld } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import { normalizeInvasionLayers } from '../src/sim/invasion/index.js';
import { shouldEnterSettlement } from '../src/ui/runFlow.js';
import { defaultProfile } from '../src/save/profile.js';

/** 소스 읽기(저장소 기존 헬퍼와 동일 — Windows 드라이브 경로 보정 포함). */
function readSource(rel: string): string {
  const url = new URL(rel, import.meta.url);
  return new TextDecoder().decode(readFileSync(url.pathname.replace(/^\/([A-Za-z]:)/, '$1')));
}

const MAIN = readSource('../src/main.ts');

/** `const host: ... HarnessHost = { ... };` 리터럴 본문만 잘라낸다(중괄호 균형). */
function hostLiteral(src: string): string {
  const start = src.indexOf('HarnessHost = {');
  expect(start, 'main.ts 에서 HarnessHost 리터럴을 찾지 못했다').toBeGreaterThan(-1);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error('HarnessHost 리터럴의 닫는 중괄호를 찾지 못했다');
}

/** `function <name>(...) { ... }` 선언의 본문만 잘라낸다(중괄호 균형). */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  expect(start, `main.ts 에서 function ${name} 을 찾지 못했다`).toBeGreaterThan(-1);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`function ${name} 의 닫는 중괄호를 찾지 못했다`);
}

function countOf(src: string, needle: string): number {
  let n = 0;
  let i = src.indexOf(needle);
  while (i !== -1) {
    n++;
    i = src.indexOf(needle, i + needle.length);
  }
  return n;
}

/** 주석을 걷어낸 소스(주석 속 문자열이 배선 검사에 잡히지 않도록). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const MAIN_CODE = stripComments(MAIN);

describe('배선 — main.ts 호스트가 settleIfRunOver 를 실제로 구현한다', () => {
  it('HarnessHost 리터럴에 settleIfRunOver 키가 있다 (없으면 ff 가 조용한 no-op)', () => {
    expect(hostLiteral(MAIN_CODE)).toContain('settleIfRunOver:');
  });

  it('호스트 훅은 ticker 와 **같은 함수**를 부른다(판정 복제 금지)', () => {
    // 판정 자체(shouldEnterSettlement)와 정산 진입(endRun 호출)은 코드 전체에서 각각 1회.
    expect(countOf(MAIN_CODE, 'shouldEnterSettlement(')).toBe(1); // 판정 호출은 한 자리뿐
    expect(countOf(MAIN_CODE, 'endRun(w)')).toBe(1);
    // ticker 도, 호스트 훅도 그 공유 함수를 부른다.
    expect(countOf(MAIN_CODE, 'settleIfRunOver()')).toBeGreaterThanOrEqual(2);
    expect(hostLiteral(MAIN_CODE)).toContain('settleIfRunOver()');
  });

  it('공유 함수는 sim 을 스텝하지 않는다(ff 의 "정확히 N 틱" 결정론 계약)', () => {
    const body = functionBody(MAIN_CODE, 'settleIfRunOver');
    for (const forbidden of ['stepOnce', 'stepWorld', 'accumulator', 'ticker']) {
      expect(body, `settleIfRunOver 본문에 ${forbidden} 이 있으면 안 된다`).not.toContain(
        forbidden,
      );
    }
    expect(body).toContain('endRun(w)');
  });

  it('ADR-0008 격리면은 그대로다 — 정산·제출은 endRun 의 오염/하네스 침공 가드 안에 있다', () => {
    const endRun = functionBody(MAIN_CODE, 'endRun');
    const guard = endRun.indexOf('if (!w.tainted && !harnessInvasionRun)');
    expect(guard).toBeGreaterThan(-1);
    // ADR-0026: recordPveRun(리플레이 업로드)은 폐기됐다 — 재화 서버 권위 이관으로 사후 샘플링
    // 재검증이 불필요. 재화 지급(settlePveRunCurrency)·설계도·세이브 동기화가 격리 가드 뒤에 남는다.
    for (const gated of [
      'settleRun(profile',
      'settlePveRunCurrency(',
      'grantBlueprintDrops(',
      'recordPveRunResult(',
    ]) {
      expect(endRun.indexOf(gated), `${gated} 은 격리 가드 뒤에 있어야 한다`).toBeGreaterThan(
        guard,
      );
    }
    // 공유 함수가 가드를 우회해서 정산 부수효과를 직접 부르지 않는다.
    const body = functionBody(MAIN_CODE, 'settleIfRunOver');
    expect(body).not.toContain('settleRun(');
    expect(body).not.toContain('grantBlueprintDrops(');
  });
});

/**
 * 거동 축 — `main.ts` 의 정산 전이 구조를 그대로 옮긴 호스트 더블.
 *
 * 판정은 앱과 **같은 순수 함수**(`shouldEnterSettlement`)를 쓰고, 정산 부수효과는
 * `main.ts` 의 `endRun` 과 같은 자리(`!tainted && !harnessInvasionRun` 가드 안)에서만
 * 기록한다. 위의 소스 축이 "앱이 정말 이 구조인가"를 따로 못박는다.
 */
function settleHost(): HarnessHost & {
  world: WorldState | null;
  screen: string;
  settled: boolean;
  harnessInvasionRun: boolean;
  /** 가드를 통과한 정산 건수(재화·XP 반영). */
  settlements: number;
  /** 가드를 통과한 서버 제출 건수(래더/PvE 기록·설계도 지급). */
  submissions: number;
  steps: number;
  hookCalls: number;
  /** 훅 호출 시점의 world.tick (훅이 추가 틱을 넣지 않았는지 확인용). */
  tickAtHook: number;
  withoutHook(): HarnessHost;
} {
  const h = {
    world: null as WorldState | null,
    screen: 'title',
    settled: false,
    harnessInvasionRun: false,
    settlements: 0,
    submissions: 0,
    steps: 0,
    hookCalls: 0,
    tickAtHook: -1,
    getWorld: () => h.world,
    getCurrentSeed: () => 7,
    stepOnce: (input: InputFrame) => {
      const w = h.world;
      if (w === null) return;
      h.steps++;
      stepWorld(w, input);
    },
    sampleInput: () => emptyInput(),
    renderOnce: () => undefined,
    setSpeedFactor: () => undefined,
    setPaused: () => undefined,
    isPaused: () => false,
    goto: () => undefined,
    startRun: (opts: { seed: number }) => {
      h.world = createWorld(opts.seed, DEFAULT_CONFIG);
      h.harnessInvasionRun = false; // 정식 PvE 런: 정산 경로를 탄다
      h.settled = false;
      h.screen = 'run';
    },
    // main.ts 의 startHarnessInvasionRun 대응: invasionTarget 을 세우지 않고
    // harnessInvasionRun 만 세운다 → 정산도 제출도 안 탄다(ADR-0008).
    startInvasion: (opts: HarnessInvasionResolved) => {
      const config: WorldConfig = {
        ...DEFAULT_CONFIG,
        invasion3: {
          layers: normalizeInvasionLayers(opts.layers),
          timeLimitTicks: opts.timeLimitTicks,
          maintenance: opts.maintenance,
        },
      };
      h.world = createWorld(opts.seed, config);
      h.harnessInvasionRun = true;
      h.settled = false;
      h.screen = 'run';
    },
    nextSeed: () => 4242,
    activateHarnessProfile: () => undefined,
    applyProfile: () => undefined,
    refreshScreen: () => undefined,
    getProfileSummary: () => ({ credits: 0, minerals: 0, shipLevel: 1 }),
    getProfile: () => defaultProfile(),
    markTaintedIfLive: () => {
      const w = h.world;
      if (w !== null && !w.gameOver && !w.victory) w.tainted = true;
    },
    isTainted: () => h.world?.tainted ?? false,
    currentScreen: () => h.screen,
    settleIfRunOver: () => {
      const w = h.world;
      if (w === null) return;
      if (!shouldEnterSettlement(w.gameOver || w.victory, h.settled)) return;
      h.hookCalls++;
      h.tickAtHook = w.tick;
      // === main.ts endRun 대응 ===
      h.settled = true;
      if (!w.tainted && !h.harnessInvasionRun) {
        h.settlements++;
        h.submissions++;
      }
      h.harnessInvasionRun = false;
      h.screen = 'result';
    },
    /** 훅 미구현 호스트(결함 재현용 — 배선을 지웠을 때의 동작). */
    withoutHook: (): HarnessHost => {
      const { settleIfRunOver: _drop, ...rest } = h as unknown as Record<string, unknown>;
      void _drop;
      return rest as unknown as HarnessHost;
    },
  };
  return h as unknown as ReturnType<typeof settleHost>;
}

/** 다음 스텝에서 종료되도록 플레이어 hp 를 0 으로 만든다(치트 아님 — 테스트 셋업). */
function killPlayer(w: WorldState): void {
  const p = w.entities[0];
  if (p !== undefined) p.hp = 0;
}

describe('거동 — ff 로 죽은 런이 결과 상태로 전이한다', () => {
  it('hp 0 인 런은 ff 한 번으로 result 로 넘어간다 (rAF 없이)', () => {
    const host = settleHost();
    const harness = createHarness(host);
    harness.startRun({ seed: 11 });
    killPlayer(host.world!);
    expect(harness.snapshot().screen).toBe('run');

    harness.ff(3);

    expect(host.world?.gameOver).toBe(true);
    expect(host.hookCalls).toBe(1);
    expect(harness.snapshot().screen).toBe('result');
  });

  it('훅이 없는 호스트는 run 에 갇힌다 — 이 테스트가 지키는 결함 그 자체', () => {
    const host = settleHost();
    const harness = createHarness(host.withoutHook());
    harness.startRun({ seed: 11 });
    killPlayer(host.world!);

    harness.ff(3);
    harness.ff(60);

    expect(host.world?.gameOver).toBe(true);
    expect(host.screen).toBe('run'); // 조용한 no-op
  });

  it('전이는 런당 1회다 — 추가 ff 가 정산을 다시 돌리지 않는다', () => {
    const host = settleHost();
    const harness = createHarness(host);
    harness.startRun({ seed: 11 });
    killPlayer(host.world!);

    harness.ff(3);
    harness.ff(60);
    harness.ff(60);

    expect(host.hookCalls).toBe(1);
    expect(host.settlements).toBe(1);
  });
});

describe('결정론 — 훅은 sim 을 스텝하지 않는다', () => {
  it('살아 있는 런에서 ff(N) 은 정확히 N 틱만 돈다', () => {
    const host = settleHost();
    const harness = createHarness(host);
    harness.startRun({ seed: 11 });

    harness.ff(10);

    expect(host.steps).toBe(10);
    expect(host.world?.tick).toBe(10);
    expect(host.hookCalls).toBe(0); // 안 끝난 런에서는 no-op
  });

  it('훅 유/무가 틱 수를 바꾸지 않는다(같은 시드 → 같은 tick·hash)', () => {
    const withHook = settleHost();
    const noHook = settleHost();
    const a = createHarness(withHook);
    const b = createHarness(noHook.withoutHook());
    a.startRun({ seed: 11 });
    b.startRun({ seed: 11 });
    a.ff(25);
    b.ff(25);

    expect(withHook.steps).toBe(25);
    expect(noHook.steps).toBe(25);
    expect(withHook.world?.tick).toBe(noHook.world?.tick);
    expect(a.snapshot().hash).toBe(b.snapshot().hash);
  });

  it('런이 끝난 뒤 전이해도 sim 틱은 그 자리에 멈춘다', () => {
    const host = settleHost();
    const harness = createHarness(host);
    harness.startRun({ seed: 11 });
    killPlayer(host.world!);

    harness.ff(5);
    const tickAfterDeath = host.world!.tick;

    expect(host.tickAtHook).toBe(tickAfterDeath); // 훅이 틱을 밀지 않았다
    harness.ff(60);
    expect(host.world!.tick).toBe(tickAfterDeath); // 끝난 런은 더 안 돈다
  });
});

describe('ADR-0008 — 전이는 하되 재화·제출은 계속 차단된다', () => {
  it('하네스 침공 런: result 로 넘어가지만 정산·제출 0건', () => {
    const host = settleHost();
    const harness = createHarness(host);
    harness.startInvasion({ preset: 'def3-mid', seed: 99 });
    killPlayer(host.world!);

    harness.ff(3);

    expect(harness.snapshot().screen).toBe('result'); // 화면 전이는 된다
    expect(host.settlements).toBe(0); // 재화·XP 반영 없음
    expect(host.submissions).toBe(0); // 래더 제출·설계도 지급 없음
  });

  it('오염 런(치트 개입): result 로 넘어가지만 정산·제출 0건', () => {
    const host = settleHost();
    const harness = createHarness(host);
    harness.startRun({ seed: 11 });
    harness.cheat((w) => {
      const p = w.entities[0];
      if (p !== undefined) p.hp = 0;
    });
    expect(harness.snapshot().tainted).toBe(true);

    harness.ff(3);

    expect(harness.snapshot().screen).toBe('result');
    expect(host.settlements).toBe(0);
    expect(host.submissions).toBe(0);
  });

  it('비오염 정식 런은 정상 정산된다(격리가 과잉 차단이 아님)', () => {
    const host = settleHost();
    const harness = createHarness(host);
    harness.startRun({ seed: 11 });
    killPlayer(host.world!);

    harness.ff(3);

    expect(harness.snapshot().tainted).toBe(false);
    expect(host.settlements).toBe(1);
    expect(host.submissions).toBe(1);
  });

  it('ff 자체는 오염시키지 않는다(비오염 경로)', () => {
    const host = settleHost();
    const harness = createHarness(host);
    harness.startRun({ seed: 11 });
    harness.ff(20);
    expect(harness.snapshot().tainted).toBe(false);
  });
});
