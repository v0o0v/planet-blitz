/**
 * 하네스 리플레이 API **배선 + 거동** 테스트 (DEV 하네스 · ADR-0008).
 *
 * 이 저장소의 대표 반복 결함은 "단위 테스트는 전부 그린인데 배선이 통째로 없다" 이다
 * (`tests/harnessSettleWiring.test.ts` 머리말 참조). 리플레이 API 도 정확히 같은 모양의
 * 함정을 갖는다 — `src/harness/core.ts` 가 `getLiveReplay`/`getLastReplay`/`playReplay` 를
 * **optional** 훅으로 선언하므로, `src/main.ts` 의 호스트 리터럴에 키가 없어도 타입 검사가
 * 통과하고 API 는 조용히 `null`/`false` 만 돌려준다. 그래서 이 파일은 두 축으로 못박는다:
 *
 *  1. **배선(소스)** — main.ts 호스트 리터럴에 세 훅이 실제로 있고, 재생은 기존 관전 경로
 *     (`beginSpectate`)를 재사용하며, 런 종료 시 마지막 리플레이를 보관한다.
 *     (main.ts 는 import 시 즉시 실행되는 브라우저 엔트리라 node 에서 로드할 수 없어 소스 대조다.)
 *  2. **거동(실행)** — 실제 `createHarness` + 실제 sim 으로 리플레이를 뽑아 재생·검증한다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHarness } from '../src/harness/core.js';
import type { HarnessHost } from '../src/harness/core.js';
import { createWorld, DEFAULT_CONFIG, emptyInput, stepWorld } from '../src/sim/world.js';
import type { InputFrame, WorldState } from '../src/sim/world.js';
import { ReplayRecorder, hashWorld, runReplay } from '../src/sim/replay.js';
import type { Replay } from '../src/sim/replay.js';
import { defaultProfile } from '../src/save/profile.js';

/** 소스 읽기(저장소 기존 헬퍼와 동일 — Windows 드라이브 경로 보정 포함). */
function readSource(rel: string): string {
  const url = new URL(rel, import.meta.url);
  return new TextDecoder().decode(readFileSync(url.pathname.replace(/^\/([A-Za-z]:)/, '$1')));
}

/** 주석을 걷어낸 소스(주석 속 문자열이 배선 검사에 잡히지 않도록). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const MAIN_CODE = stripComments(readSource('../src/main.ts'));

/** 월드 해시 표기(hex 8자리) — 하네스가 쓰는 것과 같은 포맷. */
function hex(hash: number): string {
  return (hash >>> 0).toString(16).padStart(8, '0');
}

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

describe('배선 — main.ts 호스트가 리플레이 훅을 실제로 구현한다', () => {
  const literal = hostLiteral(MAIN_CODE);

  it('세 훅이 호스트 리터럴에 있다 (없으면 하네스 리플레이 API 가 조용한 no-op)', () => {
    for (const key of ['getLiveRun:', 'getLastRun:', 'playReplay:']) {
      expect(literal, `호스트 리터럴에 ${key} 이 없다`).toContain(key);
    }
  });

  it('재생은 기존 관전 경로를 재사용한다(재생 루프 복제 금지)', () => {
    // beginSpectate 하나가 관전 월드 셋업·오버레이·오염 표시를 전부 소유한다.
    expect(literal).toContain('beginSpectate(');
  });

  it('라이브 리플레이는 recorder 에서, 마지막 리플레이는 보관 변수에서 나온다', () => {
    expect(literal).toContain('recorder');
    expect(MAIN_CODE, '런 종료 시 마지막 리플레이를 보관해야 한다').toContain('lastFinishedReplay');
  });

  it('리플레이와 기준선 해시를 **한 훅에서 함께** 낸다(ticker 가 사이에 끼면 오탐)', () => {
    expect(MAIN_CODE, '런 종료 시 최종 해시를 보관해야 한다').toContain('lastFinishedHash');
    // getLiveRun 본문 안에 hashWorld 가 있어야 원자적이다 — 해시를 별도 훅으로 빼면
    // 그 사이에 ticker 가 sim 을 밀어 멀쩡한 런이 불일치로 뜬다.
    const start = literal.indexOf('getLiveRun:');
    expect(start).toBeGreaterThan(-1);
    const body = literal.slice(start, literal.indexOf('getLastRun:'));
    expect(body, 'getLiveRun 이 리플레이와 해시를 함께 내야 한다').toContain('hashWorld(');
    expect(body).toContain('toReplay()');
  });
});

/**
 * 방어체 모의 배선도 같은 함정을 갖는다 — `CheatPanelHost.defense` 는 **optional** 이라
 * `main.ts` 에서 한 줄만 지워도 타입 검사가 통과하고, 패널은 "배선이 없는 호스트입니다"
 * 안내만 조용히 띄운다(InvasionBackdrop 미배선과 같은 모양의 실패).
 */
describe('배선 — main.ts 가 방어체 모의를 실제로 끼운다', () => {
  const literal = hostLiteral(MAIN_CODE);

  it('모의 게이트웨이를 만들고 override 로 주입한다', () => {
    for (const token of ['createDefenseMock(', 'setDefenseUnitsGatewayOverride(']) {
      expect(MAIN_CODE, `main.ts 에 ${token} 이 없다`).toContain(token);
    }
  });

  it('치트 패널 호스트에 defense 제어가 넘어간다', () => {
    expect(MAIN_CODE, 'createCheatPanel 에 defense 제어를 넘겨야 한다').toContain(
      'defense: defenseControl',
    );
  });

  it('배치 슬롯 편집이 하네스 예약에 실제로 반영된다', () => {
    const panel = readSource('../src/harness/cheatPanel.ts');
    expect(panel, '슬롯 편집기가 setInvasionLayers 를 불러야 예약에 반영된다').toContain(
      'harness.setInvasionLayers(',
    );
  });

  it('침공 런 시작은 프리셋이 아니라 **예약 배치**를 쓴다(슬롯 편집이 되돌려지지 않도록)', () => {
    const panel = stripComments(readSource('../src/harness/cheatPanel.ts'));
    const start = panel.indexOf('harness.startInvasion({');
    expect(start).toBeGreaterThan(-1);
    const call = panel.slice(start, panel.indexOf('});', start));
    expect(call, 'startInvasion 에 preset 을 넘기면 매 시작마다 슬롯 편집이 덮인다').not.toContain(
      'preset:',
    );
  });

  // 위 리터럴 참조는 이 describe 가 호스트 리터럴을 실제로 파싱했음을 보장한다(파싱 실패 시
  // hostLiteral 이 먼저 터진다).
  it('호스트 리터럴 파싱이 성립한다', () => {
    expect(literal.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 거동 — 실제 하네스 + 실제 sim
// ---------------------------------------------------------------------------

/**
 * 리플레이 훅을 갖춘 호스트 더블. main.ts 와 같은 자리에서 recorder 를 붙이고, 런이
 * 끝나면 마지막 리플레이를 보관한다.
 */
function replayHost(): HarnessHost & {
  world: WorldState | null;
  recorder: ReplayRecorder | null;
  last: Replay | null;
  lastHash: string | null;
  played: { replay: Replay; name: string } | null;
  withoutHooks(): HarnessHost;
} {
  const h = {
    world: null as WorldState | null,
    recorder: null as ReplayRecorder | null,
    last: null as Replay | null,
    lastHash: null as string | null,
    played: null as { replay: Replay; name: string } | null,
    getWorld: () => h.world,
    getCurrentSeed: () => 7,
    stepOnce: (input: InputFrame) => {
      const w = h.world;
      if (w === null) return;
      h.recorder?.record(input);
      stepWorld(w, input);
      // main.ts endRun 대응: 런이 끝난 순간의 리플레이 + **그 시점 해시**를 짝으로 보관한다.
      if ((w.gameOver || w.victory) && h.last === null) {
        h.last = h.recorder?.toReplay() ?? null;
        h.lastHash = hex(hashWorld(w));
      }
    },
    sampleInput: () => emptyInput(),
    renderOnce: () => undefined,
    setSpeedFactor: () => undefined,
    setPaused: () => undefined,
    isPaused: () => false,
    goto: () => undefined,
    startRun: (opts: { seed: number }) => {
      h.world = createWorld(opts.seed, DEFAULT_CONFIG);
      h.recorder = new ReplayRecorder(opts.seed, h.world.config);
      h.last = null;
      h.lastHash = null;
    },
    startInvasion: () => undefined,
    nextSeed: () => 4242,
    activateHarnessProfile: () => undefined,
    applyProfile: () => undefined,
    refreshScreen: () => undefined,
    getProfileSummary: () => ({ credits: 0, minerals: 0, shipLevel: 1 }),
    getProfile: () => defaultProfile(),
    markTaintedIfLive: () => undefined,
    isTainted: () => false,
    currentScreen: () => 'run',
    // 리플레이와 해시를 한 호출에서 함께 낸다(main.ts 와 같은 원자성 계약).
    getLiveRun: () =>
      h.recorder === null || h.world === null
        ? null
        : { replay: h.recorder.toReplay(), hash: hex(hashWorld(h.world)) },
    getLastRun: () =>
      h.last === null || h.lastHash === null ? null : { replay: h.last, hash: h.lastHash },
    playReplay: (replay: Replay, name: string) => {
      if (!Array.isArray(replay.inputs) || replay.inputs.length === 0) return false;
      h.played = { replay, name };
      return true;
    },
    /** 훅 미구현 호스트(배선을 지웠을 때의 동작 재현용). */
    withoutHooks: (): HarnessHost => {
      const rest = { ...(h as unknown as Record<string, unknown>) };
      delete rest.getLiveRun;
      delete rest.getLastRun;
      delete rest.playReplay;
      return rest as unknown as HarnessHost;
    },
  };
  return h as unknown as ReturnType<typeof replayHost>;
}

describe('거동 — 리플레이 조회', () => {
  it('런이 없으면 replay()/lastReplay() 는 null 이다', () => {
    const host = replayHost();
    const harness = createHarness(host);
    expect(harness.replay()).toBeNull();
    expect(harness.lastReplay()).toBeNull();
  });

  it('ff 로 돈 만큼 라이브 리플레이의 입력이 쌓인다', () => {
    const host = replayHost();
    const harness = createHarness(host);
    harness.startRun({ seed: 11 });
    harness.ff(30);
    expect(harness.replay()?.inputs.length).toBe(30);
  });

  it('훅이 없는 호스트에서는 조용히 null/false 다 — 이 테스트가 지키는 결함 그 자체', () => {
    const host = replayHost();
    const harness = createHarness(host.withoutHooks());
    harness.startRun({ seed: 11 });
    harness.ff(10);
    expect(harness.replay()).toBeNull();
    expect(harness.playReplay()).toBe(false);
  });
});

describe('거동 — 재생', () => {
  it('playReplay() 는 인자 없이도 라이브 리플레이를 골라 재생한다', () => {
    const host = replayHost();
    const harness = createHarness(host);
    harness.startRun({ seed: 11 });
    harness.ff(30);

    expect(harness.playReplay()).toBe(true);
    expect(host.played?.replay.inputs.length).toBe(30);
  });

  it('끝난 런이 있으면 그쪽을 먼저 고른다', () => {
    const host = replayHost();
    const harness = createHarness(host);
    harness.startRun({ seed: 11 });
    harness.ff(20);
    // 런을 죽여 마지막 리플레이를 확정시킨다(테스트 셋업 — 치트 아님).
    const p = host.world!.entities[0];
    if (p !== undefined) p.hp = 0;
    harness.ff(2);
    const finishedTicks = host.last!.inputs.length;

    // 새 런을 시작해 라이브 리플레이를 다른 것으로 갈아 둔다.
    const kept = host.last;
    const keptHash = host.lastHash;
    harness.startRun({ seed: 99 });
    host.last = kept;
    host.lastHash = keptHash;
    harness.ff(5);

    harness.playReplay();
    expect(host.played?.replay.inputs.length).toBe(finishedTicks);
  });

  it('빈 리플레이는 재생하지 않는다', () => {
    const host = replayHost();
    const harness = createHarness(host);
    expect(harness.playReplay({ seed: 1, inputs: [] })).toBe(false);
  });
});

describe('거동 — 결정론 검증', () => {
  it('라이브 런: 재실행 해시를 **월드 해시 기준선**과 대조해 통과한다', () => {
    const host = replayHost();
    const harness = createHarness(host);
    harness.startRun({ seed: 11 });
    harness.ff(120);

    const verdict = harness.verifyReplay();

    expect(verdict.compared).toBe(true);
    expect(verdict.ok).toBe(true);
    expect(verdict.ticks).toBe(120);
    // 기준선은 라이브 월드의 현재 해시다 — ff 가 record 경로를 그대로 탔다는 뜻이기도 하다.
    expect(verdict.expectedHash).toBe(hex(hashWorld(host.world!)));
    expect(verdict.finalHash).toBe(verdict.expectedHash);
  });

  it('입력 로그로 재현되지 않는 상태 변형은 ok=false 로 잡힌다 — 대조가 실제로 일어난다는 증거', () => {
    const host = replayHost();
    const harness = createHarness(host);
    harness.startRun({ seed: 11 });
    harness.ff(60);
    expect(harness.verifyReplay().ok).toBe(true); // 변형 전에는 통과

    // 입력이 아닌 **직접 변형**(치트가 하는 일). 기록된 입력만 재실행하면 이 상태는 나오지
    // 않으므로 재현이 깨진다. 예전 구현은 여기서도 ok:true 를 냈다 — 그게 항진의 실체다.
    harness.cheat((w) => {
      const p = w.entities[0];
      if (p !== undefined) p.hp -= 7;
    });

    const verdict = harness.verifyReplay();

    expect(verdict.compared).toBe(true);
    expect(verdict.ok).toBe(false);
    expect(verdict.expectedHash).toBe(hex(hashWorld(host.world!)));
    expect(verdict.finalHash).not.toBe(verdict.expectedHash);
    expect(verdict.reason).toContain('해시 불일치');
  });

  it('밖에서 온 리플레이는 기준선이 없어 **대조하지 않는다**(해시 출력만)', () => {
    const host = replayHost();
    const harness = createHarness(host);
    harness.startRun({ seed: 11 });
    harness.ff(30);
    const foreign = harness.replay()!;

    const verdict = harness.verifyReplay(foreign);

    // 예전에는 여기서 ok:true 가 나왔다 — "throw 안 함"과 동치라 어떤 발산도 못 잡는 항진.
    expect(verdict.compared).toBe(false);
    expect(verdict.ok).toBe(false);
    expect(verdict.expectedHash).toBe('');
    // 해시 자체는 sim 정본 재실행 값으로 나온다(출력은 유효하다).
    expect(verdict.finalHash).toBe(hex(runReplay(foreign).finalHash));
    expect(verdict.reason).toContain('기준선');
  });

  it('리플레이가 없으면 ok=false 와 사유를 돌려준다(throw 금지)', () => {
    const host = replayHost();
    const harness = createHarness(host);
    const verdict = harness.verifyReplay();
    expect(verdict.ok).toBe(false);
    expect(verdict.compared).toBe(false);
    expect(verdict.reason.length).toBeGreaterThan(0);
  });
});
