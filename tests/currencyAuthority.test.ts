/**
 * 재화 서버 권위 배선 통합 테스트(ADR-0026/0027).
 *
 * 이 저장소의 반복 결함은 "단위 테스트는 그린인데 배선이 통째로 없다" 이다. 재화가 서버
 * 컬럼 정본으로 이관된 뒤, 클라가 실제로 서버 RPC 를 태우고 응답 잔액으로 미러를 갱신하는지,
 * 미설정(오프라인)에서는 로컬 폴백이 살아있는지, 스펜드가 서버 거부 시 상태를 안 바꾸는지,
 * 그리고 폐기된 리플레이 업로드(recordPveRun)가 더 이상 호출되지 않는지를 정규 경로로 못박는다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  settlePveRunCurrency,
  grantCurrencyToServer,
  spendCurrencyOnServer,
  isNetConfigured,
  flushPendingSync,
} from '../src/net/index.js';
import {
  deserializeProfile,
  progressScore,
  readPendingSettlements,
  readPendingGrants,
  writePendingGrants,
  type ServerProfile,
} from '../src/net/profileSync.js';
import type {
  ServerGateway,
  PveSettleSummary,
  SettlePveResult,
  CurrencyGrantResult,
  SpendCurrencyResult,
} from '../src/net/gateway.js';
import { defaultProfile, type KeyValueStore } from '../src/save/profile.js';

/** In-memory KeyValueStore(net.test.ts 패턴). */
function memStore(seed?: Record<string, string>): KeyValueStore {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/**
 * 재화 RPC 를 기록하는 fake 게이트웨이. 서버 잔액 1쌍을 들고, 각 RPC 호출을 카운트/로그한다.
 * `failSettle`/`failGrant`/`spendOk` 로 거부·오프라인을 시뮬레이션한다.
 */
class FakeCurrencyGateway implements ServerGateway {
  uid = 'uid-cur';
  credits = 1000;
  minerals = 200;
  settleCalls: PveSettleSummary[] = [];
  grantCalls: { credits: number; minerals: number; source: string }[] = [];
  spendCalls: { credits: number; minerals: number; reason: string }[] = [];
  failSettle = false;
  failGrant = false;
  spendOk = true;
  failSpend = false;

  async getUserId(): Promise<string> {
    return this.uid;
  }
  async fetchProfile(): Promise<ServerProfile | null> {
    return null;
  }
  async upsertProfile(): Promise<void> {}

  async settlePveRun(summary: PveSettleSummary): Promise<SettlePveResult> {
    if (this.failSettle) throw new Error('offline');
    this.settleCalls.push(summary);
    // 서버가 자원→credits·광물→minerals 를 (캡 없이 그대로라 가정) 가산.
    this.credits += summary.resources;
    this.minerals += summary.minerals;
    return {
      granted_credits: summary.resources,
      granted_minerals: summary.minerals,
      credits_left: this.credits,
      minerals_left: this.minerals,
      clamped: false,
      settled: true,
    };
  }

  async grantCurrency(credits: number, minerals: number, source: string): Promise<CurrencyGrantResult> {
    if (this.failGrant) throw new Error('offline');
    this.grantCalls.push({ credits, minerals, source });
    this.credits += credits;
    this.minerals += minerals;
    return {
      granted_credits: credits,
      granted_minerals: minerals,
      credits_left: this.credits,
      minerals_left: this.minerals,
      clamped: false,
    };
  }

  async spendCurrency(credits: number, minerals: number, reason: string): Promise<SpendCurrencyResult> {
    if (this.failSpend) throw new Error('offline');
    this.spendCalls.push({ credits, minerals, reason });
    if (!this.spendOk) return { ok: false, credits_left: this.credits, minerals_left: this.minerals };
    this.credits -= credits;
    this.minerals -= minerals;
    return { ok: true, credits_left: this.credits, minerals_left: this.minerals };
  }
}

function summary(over: Partial<PveSettleSummary> = {}): PveSettleSummary {
  return { victory: true, planet: 0, stage: 1, finalTick: 600, resources: 50, minerals: 0, kills: 10, ...over };
}

// ---------------------------------------------------------------------------
// (1) 온라인 정산 → settle_pve_run 호출 + 응답 잔액으로 미러 갱신
// ---------------------------------------------------------------------------

describe('재화 권위 — 온라인 PvE 정산(settle_pve_run)', () => {
  it('settle_pve_run 을 요약과 함께 호출하고 응답 잔액으로 미러를 갱신한다', async () => {
    const gw = new FakeCurrencyGateway();
    gw.credits = 1000;
    const profile = defaultProfile();
    profile.credits = 7; // 낡은 로컬 미러
    await settlePveRunCurrency(profile, { summary: summary({ resources: 50 }), storyRewardCredits: 0 }, { gateway: gw });
    expect(gw.settleCalls).toHaveLength(1);
    expect(gw.settleCalls[0]!.resources).toBe(50);
    expect(profile.credits).toBe(1050); // 서버 잔액이 정본 — 낡은 7 을 대체
    expect(profile.minerals).toBe(200);
  });

  it('사연 보상(storyRewardCredits>0)은 grant_currency(source=story)로 별도 지급된다', async () => {
    const gw = new FakeCurrencyGateway();
    const profile = defaultProfile();
    await settlePveRunCurrency(profile, { summary: summary({ resources: 50 }), storyRewardCredits: 800 }, { gateway: gw });
    expect(gw.settleCalls).toHaveLength(1);
    expect(gw.grantCalls).toEqual([{ credits: 800, minerals: 0, source: 'story' }]);
    expect(profile.credits).toBe(1000 + 50 + 800);
  });

  it('settle 전송 실패 시 요약 전체를 대기 큐에 넣고 재화를 안 만진다', async () => {
    const gw = new FakeCurrencyGateway();
    gw.failSettle = true;
    const store = memStore();
    const profile = defaultProfile();
    profile.credits = 7;
    await settlePveRunCurrency(profile, { summary: summary({ resources: 50 }), storyRewardCredits: 800 }, { gateway: gw, store });
    expect(profile.credits).toBe(7); // 서버 확정 전엔 미러 불변
    const queued = readPendingSettlements(store);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.summary?.resources).toBe(50);
    expect(queued[0]!.storyRewardCredits).toBe(800);

    // 네트워크 회복 후 flush 가 재지급한다.
    gw.failSettle = false;
    await flushPendingSync({ gateway: gw, store });
    expect(gw.settleCalls).toHaveLength(1);
    expect(gw.grantCalls).toHaveLength(1);
    expect(readPendingSettlements(store)).toHaveLength(0);
  });

  it('settle 성공·story grant 실패 시 story-only 항목만 큐에 남는다(재settle 방지)', async () => {
    const gw = new FakeCurrencyGateway();
    gw.failGrant = true;
    const store = memStore();
    const profile = defaultProfile();
    await settlePveRunCurrency(profile, { summary: summary({ resources: 50 }), storyRewardCredits: 800 }, { gateway: gw, store });
    expect(gw.settleCalls).toHaveLength(1); // settle 은 성공
    const queued = readPendingSettlements(store);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.summary).toBeNull(); // 재settle 안 함
    expect(queued[0]!.storyRewardCredits).toBe(800);

    // flush 는 story grant 만 재시도한다.
    gw.failGrant = false;
    await flushPendingSync({ gateway: gw, store });
    expect(gw.settleCalls).toHaveLength(1); // 재settle 없음
    expect(gw.grantCalls).toEqual([{ credits: 800, minerals: 0, source: 'story' }]);
    expect(readPendingSettlements(store)).toHaveLength(0);
  });

  it('flush 재시도 중 settle 성공·story 실패면 재settle 하지 않는다(이중 지급 방지)', async () => {
    // 회귀 잠금: 큐에 {summary, story} 전체가 있을 때, flush 가 settle 을 성공시킨 뒤 story
    // grant 에서 막히면, 항목을 통째로 재큐잉하면 다음 flush 가 settle 을 재실행해 자원이
    // 이중 지급된다. flushPendingSettlements 가 settle 성공 후 summary 를 null 로 낮춰 막는다.
    const gw = new FakeCurrencyGateway();
    const store = memStore();
    const profile = defaultProfile();
    // (a) settle 실패로 {summary, story} 전체가 큐에 쌓인다.
    gw.failSettle = true;
    await settlePveRunCurrency(
      profile,
      { summary: summary({ resources: 50 }), storyRewardCredits: 800 },
      { gateway: gw, store },
    );
    expect(readPendingSettlements(store)).toHaveLength(1);
    // (b) 회복됐지만 story grant 만 실패 — flush 가 settle 을 성공시키고 story 에서 막힌다.
    gw.failSettle = false;
    gw.failGrant = true;
    await flushPendingSync({ gateway: gw, store });
    expect(gw.settleCalls).toHaveLength(1); // settle 1회
    const q = readPendingSettlements(store);
    expect(q).toHaveLength(1);
    expect(q[0]!.summary).toBeNull(); // settle 확정 후 summary 를 낮춰 재settle 을 막았다
    // (c) 다음 flush 는 story 만 재시도 — settle 은 다시 실행되지 않는다(이중 지급 없음).
    gw.failGrant = false;
    await flushPendingSync({ gateway: gw, store });
    expect(gw.settleCalls).toHaveLength(1); // 여전히 1 — 자원 이중 지급 없음
    expect(gw.grantCalls).toHaveLength(1);
    expect(readPendingSettlements(store)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (2) 미설정(오프라인)이면 로컬 폴백 신호(unconfigured)
// ---------------------------------------------------------------------------

describe('재화 권위 — 미설정(오프라인) 폴백', () => {
  it('isNetConfigured 는 config=null 이면 false, gateway 주입 시 true', () => {
    expect(isNetConfigured({ config: null })).toBe(false);
    expect(isNetConfigured({ gateway: new FakeCurrencyGateway() })).toBe(true);
  });

  it('미설정이면 spend/grant 는 unconfigured 를 돌려줘 호출부가 로컬 폴백을 태운다', async () => {
    expect(await spendCurrencyOnServer(100, 0, 'stash', { config: null })).toEqual({ status: 'unconfigured' });
    expect(await grantCurrencyToServer(10, 3, 'salvage', { config: null })).toEqual({ status: 'unconfigured' });
  });

  it('미설정이면 settlePveRunCurrency 도 서버를 안 부르지만, 큐에도 안 남긴다(스토어 없음)', async () => {
    const profile = defaultProfile();
    profile.credits = 5;
    // config=null → gateway 미해석. store 없이 호출 → 큐잉도 스킵(완전 no-op).
    await settlePveRunCurrency(profile, { summary: summary(), storyRewardCredits: 0 }, { config: null, store: null });
    expect(profile.credits).toBe(5); // 미러 불변(로컬 가산은 호출부 main.ts 의 else 분기 몫)
  });
});

// ---------------------------------------------------------------------------
// (3) 스펜드: 서버 ok=false 면 로컬 상태 불변
// ---------------------------------------------------------------------------

describe('재화 권위 — 스펜드(spend_currency) 거부 시 상태 불변', () => {
  it('ok=true 면 갱신 잔액을 돌려준다', async () => {
    const gw = new FakeCurrencyGateway();
    gw.credits = 500;
    const res = await spendCurrencyOnServer(200, 0, 'respec', { gateway: gw });
    expect(res).toEqual({ status: 'ok', creditsLeft: 300, mineralsLeft: 200 });
    expect(gw.spendCalls).toEqual([{ credits: 200, minerals: 0, reason: 'respec' }]);
  });

  it('ok=false(잔액 부족)면 rejected/insufficient + 서버 잔액 — 호출부는 효과를 적용하지 않는다', async () => {
    const gw = new FakeCurrencyGateway();
    gw.spendOk = false;
    gw.credits = 17;
    gw.minerals = 3;
    const res = await spendCurrencyOnServer(999999, 0, 'stash', { gateway: gw });
    // 사유가 갈려야 호출부가 "크레딧 부족"과 "서버 못 붙음"을 다르게 말할 수 있다.
    expect(res).toEqual({ status: 'rejected', reason: 'insufficient', creditsLeft: 17, mineralsLeft: 3 });
  });

  it('전송 실패(오프라인)는 rejected/unavailable — 잔액 부족이라고 단정하지 않는다', async () => {
    const gw = new FakeCurrencyGateway();
    gw.failSpend = true;
    const res = await spendCurrencyOnServer(10, 0, 'reroll', { gateway: gw });
    expect(res).toEqual({ status: 'rejected', reason: 'unavailable' });
  });

  it('두 거부 모두 status=rejected 라 기존 "거부면 효과 미적용" 호출부 계약이 유지된다', async () => {
    const insufficient = new FakeCurrencyGateway();
    insufficient.spendOk = false;
    const offline = new FakeCurrencyGateway();
    offline.failSpend = true;
    expect((await spendCurrencyOnServer(1, 0, 'stash', { gateway: insufficient })).status).toBe('rejected');
    expect((await spendCurrencyOnServer(1, 0, 'stash', { gateway: offline })).status).toBe('rejected');
  });
});

// ---------------------------------------------------------------------------
// (MED-1) 재화 가산(살베지) 전송 실패 → 대기 큐 재지급(유실 방지)
// ---------------------------------------------------------------------------

describe('재화 권위 — grant 전송 실패 시 대기 큐 재지급(MED-1)', () => {
  it('온라인 grant 실패면 failed 를 돌려주고 대기 큐에 남겨 flush 가 재지급한다', async () => {
    // 살베지는 아이템을 이미 로컬 제거한 뒤 재화를 서버에 얹는다. grant 가 일시 실패하면
    // 재시도 큐가 없을 때 다음 fetchProfile 이 미러를 서버값으로 되돌려 재화가 소멸했다(아이템은
    // 이미 사라진 채). 큐가 이를 막는다.
    const gw = new FakeCurrencyGateway();
    gw.failGrant = true;
    const store = memStore();
    const r = await grantCurrencyToServer(10, 3, 'salvage', { gateway: gw, store });
    expect(r).toEqual({ status: 'failed' });
    expect(readPendingGrants(store)).toEqual([{ credits: 10, minerals: 3, source: 'salvage' }]);

    // 네트워크 회복 후 flush 가 재지급하고 큐를 비운다.
    gw.failGrant = false;
    await flushPendingSync({ gateway: gw, store });
    expect(gw.grantCalls).toEqual([{ credits: 10, minerals: 3, source: 'salvage' }]);
    expect(readPendingGrants(store)).toHaveLength(0);
  });

  it('미설정(오프라인)이면 unconfigured — 큐에도 안 남긴다(서버 자체 없음)', async () => {
    const store = memStore();
    const r = await grantCurrencyToServer(10, 3, 'salvage', { config: null, store });
    expect(r).toEqual({ status: 'unconfigured' });
    expect(readPendingGrants(store)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (4) 리플레이 업로드(recordPveRun) 폐기 — main.endRun 이 더 이상 호출하지 않는다
// ---------------------------------------------------------------------------

describe('재화 권위 — recordPveRun(리플레이 업로드) 폐기(ADR-0026)', () => {
  function readSource(rel: string): string {
    const url = new URL(rel, import.meta.url);
    return new TextDecoder().decode(readFileSync(url.pathname.replace(/^\/([A-Za-z]:)/, '$1')));
  }
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  }

  it('main.ts 코드에 recordPveRun 호출이 없다(리플레이 업로드 배선 제거 확인)', () => {
    const code = stripComments(readSource('../src/main.ts'));
    expect(code).not.toContain('recordPveRun(');
  });

  it('net/index 코드에 recordPveRun/insertPveRun 이 없다(recordPveRunResult 는 유지)', () => {
    const code = stripComments(readSource('../src/net/index.ts'));
    // recordPveRunResult(세이브 동기화)는 유지되므로 open-paren 으로 리플레이 업로드 함수만 배제.
    expect(code).not.toContain('function recordPveRun(');
    expect(code).not.toContain('insertPveRun');
  });
});

// ---------------------------------------------------------------------------
// 컬럼 권위 + progressScore(item A/B)
// ---------------------------------------------------------------------------

describe('재화 권위 — fetchProfile 컬럼 권위(deserializeProfile)', () => {
  it('credits/minerals 컬럼이 있으면 save 미러를 컬럼값으로 덮어쓴다(서버 권위)', () => {
    const p = defaultProfile();
    p.credits = 5; // save 안의 낡은 미러
    p.minerals = 2;
    const back = deserializeProfile({ save: p, saveVersion: p.saveVersion, credits: 1234, minerals: 77 });
    expect(back.credits).toBe(1234); // 컬럼이 정본
    expect(back.minerals).toBe(77);
  });

  it('컬럼이 부재(구 서버)면 save 미러를 유지한다(하위호환)', () => {
    const p = defaultProfile();
    p.credits = 5;
    p.minerals = 2;
    const back = deserializeProfile({ save: p, saveVersion: p.saveVersion });
    expect(back.credits).toBe(5);
    expect(back.minerals).toBe(2);
  });
});

describe('재화 권위 — progressScore 는 재화를 제외한다(item B)', () => {
  it('credits/minerals 차이는 진행도 점수에 영향을 주지 않는다', () => {
    const poor = defaultProfile();
    const rich = defaultProfile();
    rich.credits = 1_000_000;
    rich.minerals = 1_000_000;
    expect(progressScore(rich)).toBe(progressScore(poor)); // 재화는 순위 신호가 아니다
  });
});
