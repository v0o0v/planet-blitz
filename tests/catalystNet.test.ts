/**
 * 촉매 net 게이트웨이 + 정규경로 배선 — (ADR-0029, Lane 4).
 *
 * 이 저장소의 대표 반복 결함은 "단위 테스트는 그린인데 배선이 통째로 없다" 이다. 촉매의 경제
 * 정합은 **소모 영수증 runId 가 정산(settle_pve_run) summary 까지 실제로 도달**하는가에 달려
 * 있으므로(서버가 그 id 로 자원 배율 캡을 관통 상향), 여기서 두 축으로 못박는다:
 *  ① **거동** — net 래퍼(consume/salvage/grant/fetch)를 fake gateway 로 검증하고,
 *     buildRunConfig 가 스탬프한 runId 가 settlePveRunCurrency 를 통해 gateway 로 흐르는 것을 단언.
 *  ② **배선(소스)** — main.ts 가 consume 성공 runId 를 startRun→buildRunConfig 로 넘기고,
 *     endRun 이 summary 에 `w.config.runId` 를 싣는 것을 소스 대조(main.ts 는 node 로 로드 불가).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  consumeCatalystsOnServer,
  salvageCatalystOnServer,
  grantCatalystDrops,
  fetchCatalystInventoryOnline,
  settlePveRunCurrency,
} from '../src/net/index.js';
import type {
  ServerGateway,
  PveSettleSummary,
  CatalystConsumeResult,
  CatalystSalvageResult,
  CatalystGrantResult,
  CatalystInventoryRow,
  SettlePveResult,
} from '../src/net/gateway.js';
import type { ServerProfile } from '../src/net/profileSync.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, type Profile } from '../src/save/profile.js';
import type { CatalystDrop } from '../src/data/catalystDrops.js';

/**
 * 촉매 RPC 를 기록/시뮬레이션하는 fake gateway. 실패는 flag 로. 필수 3메서드는 스텁이고,
 * 촉매 4종 + settlePveRun 은 호출 인자를 남긴다.
 */
class FakeGateway implements ServerGateway {
  failConsume = false;
  failSalvage = false;
  salvageOk = true;
  failGrant = false;
  failFetch = false;
  consumeArgs: { ids: number[]; planet: number } | null = null;
  grantCalls: { id: number; qty: number }[] = [];
  settleSummaries: PveSettleSummary[] = [];
  inventoryRows: CatalystInventoryRow[] = [];

  async getUserId(): Promise<string> {
    return 'uid-1';
  }
  async fetchProfile(): Promise<ServerProfile | null> {
    return null;
  }
  async upsertProfile(): Promise<void> {
    /* no-op */
  }
  async settlePveRun(summary: PveSettleSummary): Promise<SettlePveResult> {
    this.settleSummaries.push(summary);
    return {
      granted_credits: 0,
      granted_minerals: 0,
      credits_left: 0,
      minerals_left: 0,
      clamped: false,
      settled: true,
    };
  }
  async consumeCatalysts(catalystIds: number[], planet: number): Promise<CatalystConsumeResult> {
    if (this.failConsume) throw new Error('rejected');
    this.consumeArgs = { ids: catalystIds, planet };
    return { run_id: 'run-abc-uuid', resource_mult: 1.3 };
  }
  async salvageCatalyst(_catalystId: number, qty: number): Promise<CatalystSalvageResult> {
    if (this.failSalvage) throw new Error('offline');
    // ADR-0042: 분해 보상은 크레딧이 아니라 **촉매 잔재**다(grant_currency 미경유).
    return {
      ok: this.salvageOk,
      salvaged: this.salvageOk ? qty : 0,
      residue: this.salvageOk ? 150 : 0,
      gained: this.salvageOk ? 10 * qty : 0,
      ...(this.salvageOk ? {} : { note: 'not-owned' }),
    };
  }
  async grantCatalyst(catalystId: number, qty: number): Promise<CatalystGrantResult> {
    if (this.failGrant) throw new Error('offline');
    this.grantCalls.push({ id: catalystId, qty });
    return { catalyst_id: catalystId, qty_after: qty };
  }
  async fetchCatalystInventory(): Promise<CatalystInventoryRow[]> {
    if (this.failFetch) throw new Error('offline');
    return this.inventoryRows;
  }
}

// ---------------------------------------------------------------------------
// ① consume — 성공/실패/미설정
// ---------------------------------------------------------------------------

describe('consumeCatalystsOnServer', () => {
  it('성공: runId·resourceMult 를 실어 ok 를 낸다(정규화된 ids 로 호출)', async () => {
    const gw = new FakeGateway();
    const out = await consumeCatalystsOnServer([15, 2, 15], 0, { gateway: gw });
    expect(out).toEqual({ status: 'ok', runId: 'run-abc-uuid', resourceMult: 1.3 });
    // 정규화(오름차순·중복 보존·미지 제거)로 서버에 넘어간다.
    expect(gw.consumeArgs).toEqual({ ids: [2, 15, 15], planet: 0 });
  });

  it('RPC 거부/오프라인이면 failed(아이템 미차감 — 서버 롤백)', async () => {
    const gw = new FakeGateway();
    gw.failConsume = true;
    const out = await consumeCatalystsOnServer([15], 0, { gateway: gw });
    expect(out).toEqual({ status: 'failed' });
  });

  it('미설정(config null)이면 unconfigured(무촉매 폴백)', async () => {
    const out = await consumeCatalystsOnServer([15], 0, { config: null });
    expect(out).toEqual({ status: 'unconfigured' });
  });

  it('빈/미지 id 만이면 unconfigured(소모할 게 없음)', async () => {
    const gw = new FakeGateway();
    const out = await consumeCatalystsOnServer([9999], 0, { gateway: gw });
    expect(out).toEqual({ status: 'unconfigured' });
    expect(gw.consumeArgs).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ② salvage — 왕복
// ---------------------------------------------------------------------------

describe('salvageCatalystOnServer — 분해 왕복', () => {
  it('성공: 갱신 잔재 + 획득 잔재 + 분해 수량', async () => {
    const gw = new FakeGateway();
    const out = await salvageCatalystOnServer(15, 2, { gateway: gw });
    expect(out).toEqual({ status: 'ok', salvaged: 2, residue: 150, gained: 20 });
  });

  it('보유 부족(ok=false)이면 rejected(미차감) — 서버 note 를 그대로 실어 낸다', async () => {
    const gw = new FakeGateway();
    gw.salvageOk = false;
    const out = await salvageCatalystOnServer(15, 2, { gateway: gw });
    expect(out).toEqual({ status: 'rejected', note: 'not-owned' });
  });

  it('오프라인/오류면 rejected', async () => {
    const gw = new FakeGateway();
    gw.failSalvage = true;
    const out = await salvageCatalystOnServer(15, 1, { gateway: gw });
    expect(out).toEqual({ status: 'rejected' });
  });

  it('미설정이면 unconfigured', async () => {
    const out = await salvageCatalystOnServer(15, 1, { config: null });
    expect(out).toEqual({ status: 'unconfigured' });
  });
});

// ---------------------------------------------------------------------------
// ③ grant drops — 적립 총량
// ---------------------------------------------------------------------------

describe('grantCatalystDrops — 드랍 적립(fire-and-forget)', () => {
  it('각 드랍을 grant_catalyst 로 적립하고 총량을 낸다', async () => {
    const gw = new FakeGateway();
    const drops: CatalystDrop[] = [
      { id: 0, qty: 2 },
      { id: 20, qty: 1 },
    ];
    const n = await grantCatalystDrops(drops, { gateway: gw });
    expect(n).toBe(3);
    expect(gw.grantCalls).toEqual([
      { id: 0, qty: 2 },
      { id: 20, qty: 1 },
    ]);
  });

  it('빈 목록이면 0(서버 미접촉)', async () => {
    const gw = new FakeGateway();
    expect(await grantCatalystDrops([], { gateway: gw })).toBe(0);
    expect(gw.grantCalls).toEqual([]);
  });

  it('미설정이면 0(no-op)', async () => {
    expect(await grantCatalystDrops([{ id: 0, qty: 1 }], { config: null })).toBe(0);
  });

  it('개별 실패는 삼키고 나머지는 적립(throw 안 함)', async () => {
    const gw = new FakeGateway();
    gw.failGrant = true;
    // 전부 실패해도 throw 하지 않고 0.
    expect(await grantCatalystDrops([{ id: 0, qty: 1 }], { gateway: gw })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ④ fetch inventory
// ---------------------------------------------------------------------------

describe('fetchCatalystInventoryOnline', () => {
  it('행을 catalyst_id→qty 맵으로(0 이하 제외)', async () => {
    const gw = new FakeGateway();
    gw.inventoryRows = [
      { catalyst_id: 0, qty: 3 },
      { catalyst_id: 5, qty: 0 },
      { catalyst_id: 20, qty: 1 },
    ];
    const inv = await fetchCatalystInventoryOnline({ gateway: gw });
    expect(inv).not.toBeNull();
    expect(inv!.get(0)).toBe(3);
    expect(inv!.has(5)).toBe(false); // qty 0 제외
    expect(inv!.get(20)).toBe(1);
  });

  it('미설정이면 null(빈 보유 취급)', async () => {
    expect(await fetchCatalystInventoryOnline({ config: null })).toBeNull();
  });

  it('오프라인/오류면 null', async () => {
    const gw = new FakeGateway();
    gw.failFetch = true;
    expect(await fetchCatalystInventoryOnline({ gateway: gw })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ⑤ 정규경로 통합 — runId 가 buildRunConfig → settle summary 까지 도달한다
// ---------------------------------------------------------------------------

/** endRun 이 summary 를 만드는 방식 그대로(핵심: config.runId 를 실을 때만 실린다). */
function summaryFromConfig(cfg: ReturnType<typeof buildRunConfig>, profile: Profile): {
  summary: PveSettleSummary;
  storyRewardCredits: number;
} {
  void profile;
  return {
    summary: {
      victory: true,
      planet: cfg.planet ?? 0,
      stage: cfg.stage ?? 1,
      finalTick: 1000,
      resources: 500,
      minerals: 0,
      kills: 42,
      shipType: cfg.shipType ?? 0,
      playerLevel: 1,
      xpTotal: 0,
      dropCount: 0,
      ...(cfg.runId !== undefined ? { runId: cfg.runId } : {}),
    },
    storyRewardCredits: 0,
  };
}

describe('정규경로 — 촉매 소모 runId 가 settle_pve_run summary 까지 도달', () => {
  it('촉매 런: buildRunConfig(runId) → config.runId → summary.runId → gateway', async () => {
    const profile = defaultProfile();
    // consume 성공이 준 runId 를 buildRunConfig 로 스탬프(startRun 이 하는 일).
    const cfg = buildRunConfig(profile, {
      planet: 0,
      stage: 3,
      catalysts: [15, 15],
      runId: 'run-abc-uuid',
    });
    expect(cfg.runId).toBe('run-abc-uuid');
    expect(cfg.catalysts).toEqual([15, 15]);

    const gw = new FakeGateway();
    await settlePveRunCurrency(profile, summaryFromConfig(cfg, profile), { gateway: gw });
    // 서버가 이 runId 로 pending 영수증(자원 배율)을 관통 조회한다 — 배선이 있어야 여기 실린다.
    expect(gw.settleSummaries).toHaveLength(1);
    expect(gw.settleSummaries[0]!.runId).toBe('run-abc-uuid');
    expect(gw.settleSummaries[0]!.stage).toBe(3);
  });

  it('무촉매 런: runId 없음 → summary 에 runId 미포함(기존 base 경로 보존)', async () => {
    const profile = defaultProfile();
    const cfg = buildRunConfig(profile, { planet: 0, stage: 1 });
    expect(cfg.runId).toBeUndefined();
    expect(cfg.catalysts).toEqual([]);

    const gw = new FakeGateway();
    await settlePveRunCurrency(profile, summaryFromConfig(cfg, profile), { gateway: gw });
    expect(gw.settleSummaries[0]!.runId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ⑥ 배선(소스) — main.ts 가 실제로 이 배선을 갖는가 (node 로 로드 불가라 소스 대조)
// ---------------------------------------------------------------------------

function readSource(rel: string): string {
  const url = new URL(rel, import.meta.url);
  return new TextDecoder().decode(readFileSync(url.pathname.replace(/^\/([A-Za-z]:)/, '$1')));
}
/** 주석을 걷어낸 소스(주석 속 서술이 배선 검사에 잡히지 않도록). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const MAIN = stripComments(readSource('../src/main.ts'));

describe('배선 — main.ts 출격/정산이 촉매 runId 를 관통시킨다', () => {
  it('출격 진입이 consume 를 부르고, 성공 runId 를 startRun 으로 넘긴다', () => {
    expect(MAIN).toContain('consumeCatalystsOnServer(');
    expect(MAIN).toContain('catalysts: cats');
    expect(MAIN).toContain('runId: outcome.runId');
  });

  it('startRun 이 sel.catalysts·sel.runId 를 buildRunConfig 로 넘긴다', () => {
    expect(MAIN).toContain('catalysts: sel.catalysts');
    expect(MAIN).toContain('sel.runId');
  });

  it('endRun 이 정산 summary 에 config.runId 를 싣는다(무촉매면 미포함)', () => {
    expect(MAIN).toContain('runId: w.config.runId');
  });

  it('endRun 이 촉매 드랍을 파생·적립한다(격리 가드 안)', () => {
    expect(MAIN).toContain('catalystDropsFromRun(');
    expect(MAIN).toContain('grantCatalystDrops(');
  });

  it('폴백 모달이 [촉매 빼고 출격] 을 무촉매로 시작한다', () => {
    expect(MAIN).toContain('catalystSortieModal.show(');
    expect(MAIN).toContain('onSkip:');
  });
});
