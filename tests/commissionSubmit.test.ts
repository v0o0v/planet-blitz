/**
 * 의뢰 리플레이 **제출 계층** 테스트 (의뢰서 시스템 Phase E · 서버 계약 §5-4·§7).
 *
 * ## 왜 이 파일이 필요한가
 * 이 리포가 8번 넘게 겪은 실패 모드는 **"단위 테스트는 그린인데 배선이 통째로 없다"** 이고,
 * 제출 경로는 그중에서도 최악이다 — 끊겨도 예외가 안 나고 화면도 멀쩡하며 증상이
 * **"보상이 안 들어온다"** 하나뿐이다. 실제로 이 레인의 첫 판은 `submitCommissionReplay` 가
 * 주석에만 있고 정의·호출이 둘 다 없는 채로 전 게이트가 초록이었다.
 *
 * 기존 게이트 둘은 이 축을 **증명하지 않는다**: `replayConfigAliasing.test.ts` 는
 * `new ReplayRecorder(` 개수만, `shipIntegration.test.ts` 는 `buildRunConfig(` 개수만 센다 —
 * 둘 다 런 **시작** 쪽이다.
 *
 * ## 단언 규율
 * 단언마다 **"이게 통과하면서도 참일 수 있는 나쁜 상태"** 를 주석으로 적는다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { submitCommissionRun, flushPendingCommissionSubmissions } from '../src/net/index.js';
import type {
  CommissionGateway,
  CommissionRunSubmission,
  VerifyCommissionResult,
} from '../src/net/commissionGateway.js';
import {
  readPendingCommissionSubmissions,
  PENDING_COMMISSION_QUEUE_MAX,
} from '../src/net/profileSync.js';
import { type KeyValueStore } from '../src/save/profile.js';
import { DEFAULT_CONFIG } from '../src/sim/world.js';
import type { Replay } from '../src/sim/replay.js';

function memStore(seed?: Record<string, string>): KeyValueStore {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** 쓰기가 항상 실패하는 저장소(localStorage 쿼터 초과 재현). */
function quotaFullStore(): KeyValueStore {
  return {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => undefined,
  };
}

interface FakeCall {
  runId: string;
  submission: CommissionRunSubmission;
}

/** 응답을 시나리오로 지정하는 가짜 게이트웨이. 호출 이력을 남긴다. */
function fakeGateway(
  respond: (call: FakeCall, n: number) => VerifyCommissionResult | Error,
): CommissionGateway & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const g = {
    calls,
    async getUserId() {
      return 'user-1';
    },
    async consumeCommission() {
      throw new Error('이 테스트는 소비 경로를 쓰지 않는다');
    },
    async markCommissionActive() {
      throw new Error('이 테스트는 활성 신호 경로를 쓰지 않는다');
    },
    async verifyCommission(runId: string, submission: CommissionRunSubmission) {
      calls.push({ runId, submission });
      const r = respond({ runId, submission }, calls.length);
      if (r instanceof Error) throw r;
      return r;
    },
    async fetchCommissionInventory() {
      return [];
    },
    async fetchCommissionRuns() {
      return [];
    },
    async fetchCommissionGrants() {
      return [];
    },
  };
  return g as unknown as CommissionGateway & { calls: FakeCall[] };
}

/** 2틱짜리 최소 리플레이(결정론 — `runReplay` 가 실제로 돈다). */
function tinyReplay(seed = 7): Replay {
  return {
    seed,
    config: { ...DEFAULT_CONFIG },
    inputs: [
      { moveX: 0, moveY: 0, aim: 0, fire: false, dash: false, pick: 0 },
      { moveX: 0, moveY: 0, aim: 0, fire: false, dash: false, pick: 0 },
    ],
  } as unknown as Replay;
}

const OK: VerifyCommissionResult = {
  status: 'verified',
  accepted: true,
  grantedCredits: 100,
  grantedMinerals: 50,
  creditsLeft: 1100,
  mineralsLeft: 550,
  grants: [],
};

const NET_DOWN = (): Error => new Error('network down');

describe('제출 — 성공 경로', () => {
  it('게이트웨이를 정확히 1회 부르고 지급 결과를 그대로 돌려준다', async () => {
    const gw = fakeGateway(() => OK);
    const store = memStore();
    const res = await submitCommissionRun('run-1', tinyReplay(), { gateway: gw, store });
    expect(res.status).toBe('verified');
    if (res.status !== 'verified') return;
    expect(res.grantedCredits).toBe(100);
    expect(res.creditsLeft).toBe(1100);
    // 통과하면서도 참일 수 있는 나쁜 상태: 게이트웨이를 아예 안 부르고 기본값을 돌려주는 것.
    expect(gw.calls.length).toBe(1);
    expect(gw.calls[0]?.runId).toBe('run-1');
  });

  it('성공하면 대기 큐에 아무것도 안 남는다', async () => {
    const store = memStore();
    await submitCommissionRun('run-1', tinyReplay(), { gateway: fakeGateway(() => OK), store });
    expect(readPendingCommissionSubmissions(store)).toEqual([]);
  });

  it('제출 본문이 실제 리플레이를 싣는다(seed·config·inputs 가 그대로)', async () => {
    // 이 리포는 제출이 파생 사본(`world.config`)을 실어 '실제 플레이가 아닌 런'을 판정하던
    // 결함을 겪었다(PR#191). 넘긴 리플레이와 전송 본문이 같은지 직접 본다.
    const gw = fakeGateway(() => OK);
    const rep = tinyReplay(1234);
    await submitCommissionRun('run-1', rep, { gateway: gw, store: memStore() });
    const sent = gw.calls[0]?.submission;
    expect(sent?.seed).toBe(1234);
    expect(sent?.config).toBe(rep.config);
    expect(sent?.inputs).toBe(rep.inputs);
    // claim 은 재계산분이라 동일 객체가 아니지만 결정론이라 값이 있어야 한다.
    expect((sent?.claim as { finalHash?: number } | undefined)?.finalHash).toBeTypeOf('number');
  });
});

describe('제출 — 거부는 최종 판정이라 재시도하지 않는다', () => {
  it('accepted:false 면 rejected 이고 큐에 안 남는다', async () => {
    const store = memStore();
    const res = await submitCommissionRun('run-1', tinyReplay(), {
      gateway: fakeGateway(() => ({
        status: 'rejected',
        accepted: false,
        reason: 'outcome-mismatch',
      })),
      store,
    });
    expect(res.status).toBe('rejected');
    // 통과하면서도 참일 수 있는 나쁜 상태: 거부인데 큐에 남겨 영원히 재시도하는 것.
    expect(readPendingCommissionSubmissions(store)).toEqual([]);
  });
});

describe('제출 — 전송 실패는 큐에 남아 다음 기회에 재시도된다 (계약 §5-4)', () => {
  it('throw 하면 queued 이고 큐에 1건이 남는다', async () => {
    const store = memStore();
    const res = await submitCommissionRun('run-1', tinyReplay(), {
      gateway: fakeGateway(NET_DOWN),
      store,
    });
    expect(res.status).toBe('queued');
    const q = readPendingCommissionSubmissions(store);
    expect(q.length).toBe(1);
    expect(q[0]?.runId).toBe('run-1');
  });

  it('큐 저장분은 hashStream 을 들고 있지 않다 (쿼터 절약 — EF 에서 optional)', async () => {
    const store = memStore();
    await submitCommissionRun('run-1', tinyReplay(), { gateway: fakeGateway(NET_DOWN), store });
    const e = readPendingCommissionSubmissions(store)[0];
    expect(e).toBeDefined();
    expect((e?.claim as unknown as Record<string, unknown>)['hashStream']).toBeUndefined();
    // 통과하면서도 참일 수 있는 나쁜 상태: claim 자체가 통째로 비어 전송이 400 나는 것.
    expect(e?.claim.finalHash).toBeTypeOf('number');
  });

  it('다음 flush 에서 같은 run_id 로 재전송되고, 성공하면 큐가 비워진다', async () => {
    const store = memStore();
    await submitCommissionRun('run-1', tinyReplay(), { gateway: fakeGateway(NET_DOWN), store });
    expect(readPendingCommissionSubmissions(store).length).toBe(1);

    const gw2 = fakeGateway(() => OK);
    await flushPendingCommissionSubmissions({ gateway: gw2, store });
    expect(gw2.calls.length).toBe(1);
    expect(gw2.calls[0]?.runId).toBe('run-1');
    expect(readPendingCommissionSubmissions(store)).toEqual([]);
  });

  it('같은 run_id 를 두 번 큐잉해도 항목은 1건이다 (CAP_VERIFY_ATTEMPTS 낭비 방지)', async () => {
    const store = memStore();
    const gw = fakeGateway(NET_DOWN);
    await submitCommissionRun('run-1', tinyReplay(), { gateway: gw, store });
    await submitCommissionRun('run-1', tinyReplay(), { gateway: gw, store });
    expect(readPendingCommissionSubmissions(store).length).toBe(1);
  });

  it('큐 길이가 상한을 넘지 않고, 넘치면 오래된 것부터 버린다', async () => {
    const store = memStore();
    const gw = fakeGateway(NET_DOWN);
    const last = PENDING_COMMISSION_QUEUE_MAX + 1;
    for (let i = 0; i <= last; i++) {
      await submitCommissionRun(`run-${i}`, tinyReplay(i), { gateway: gw, store });
    }
    const q = readPendingCommissionSubmissions(store);
    expect(q.length).toBe(PENDING_COMMISSION_QUEUE_MAX);
    // 가장 최근 런이 반드시 살아 있어야 한다 — 그쪽이 확정 지급물을 들고 있다.
    expect(q[q.length - 1]?.runId).toBe(`run-${last}`);
    expect(q.some((e) => e.runId === 'run-0')).toBe(false);
  });
});

describe('제출 — 큐 저장까지 실패하면 lost 로 갈린다 (queued 와 같은 말을 하면 거짓말이다)', () => {
  it('쿼터가 꽉 차면 queued 가 아니라 lost 다', async () => {
    const res = await submitCommissionRun('run-1', tinyReplay(), {
      gateway: fakeGateway(NET_DOWN),
      store: quotaFullStore(),
    });
    // 이 구분이 없으면 화면은 '나중에 다시 시도됨'이라 말하는데 재시도 기회가 영영 없다.
    expect(res.status).toBe('lost');
  });
});

describe('제출 — 서버 미설정이면 unconfigured (오프라인은 제출 자체가 불가)', () => {
  it('gateway 미해석이면 unconfigured 이고 큐를 건드리지 않는다', async () => {
    const store = memStore();
    const res = await submitCommissionRun('run-1', tinyReplay(), { config: null, store });
    expect(res.status).toBe('unconfigured');
    expect(readPendingCommissionSubmissions(store)).toEqual([]);
  });
});

describe('배선 게이트 — endRun 이 제출을 실제로 부른다 (소스 대조)', () => {
  // 이 파일의 다른 테스트는 전부 `submitCommissionRun` 을 직접 부른다 — 즉 `main.ts` 가 그것을
  // 안 불러도 전부 초록이다. 이 레인의 첫 판이 정확히 그 상태였다(함수가 주석에만 있었다).
  // 배선 자체는 소스 대조로 못 박는다.
  const MAIN = readFileSync('src/main.ts', 'utf8');

  it('submitCommissionReplay 가 정의되고 endRun 경로에서 호출된다', () => {
    expect(MAIN).toContain('async function submitCommissionReplay(');
    expect(MAIN).toContain('void submitCommissionReplay(w);');
  });

  it('부팅 시 대기 큐 회수가 배선돼 있다', () => {
    expect(MAIN).toContain('void flushPendingCommissionSubmissions();');
  });

  it('오염 런은 제출하지 않는다 (ADR-0008)', () => {
    expect(MAIN).toMatch(/submitCommissionReplay[\s\S]{0,1600}?w\.tainted/);
  });

  it('제출 리플레이는 recorder 산출물이지 world.config 가 아니다', () => {
    const body = /async function submitCommissionReplay\([\s\S]*?\n {2}\}/.exec(MAIN)?.[0] ?? '';
    expect(body.length).toBeGreaterThan(200);
    expect(body).toContain('lastFinishedReplay');
    expect(body).not.toContain('w.config');
  });
});
