/**
 * 하네스 촉매 모의 게이트웨이 + net 폴백 배선 — (ADR-0029, Lane 5, DEV).
 *
 * 이 저장소의 대표 반복 결함은 "단위 테스트는 그린인데 배선이 통째로 없다" 이다. 하네스 촉매
 * 데모(무촉매 폴백이 아니라 **실제 주입 출격**)는 두 배선에 달려 있으므로 여기서 못박는다:
 *  ① **거동** — `HarnessCatalystGateway` 인메모리 원장(seed/consume/salvage/grant/fetch)이 서버
 *     계약(슬롯 상한·특산-행성·보유량·consume 실패 토글)을 그대로 흉내내는가.
 *  ② **폴백 배선** — `setHarnessCatalystGateway` 설치 시 net 촉매 함수가 **deps 없이도**(실 서버가
 *     없을 때) 모의로 라우팅되고, 해제하면 `unconfigured` 로 되돌아가는가. 실 deps 는 언제나 이긴다.
 *  ③ **소스 배선** — main.ts 가 모의를 설치하고 치트 패널에 촉매 컨트롤을 넘기는가(node 로 로드 불가).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { HarnessCatalystGateway } from '../src/harness/catalystMock.js';
import {
  setHarnessCatalystGateway,
  consumeCatalystsOnServer,
  salvageCatalystOnServer,
  grantCatalystDrops,
  fetchCatalystInventoryOnline,
} from '../src/net/index.js';

const currency = { credits: () => 100, minerals: () => 5 };

afterEach(() => {
  // 모듈 레벨 오버라이드를 반드시 해제(다른 테스트로 새지 않게 — vitest 파일 격리와 별개 안전망).
  setHarnessCatalystGateway(null);
});

// ---------------------------------------------------------------------------
// ① 모의 원장 거동
// ---------------------------------------------------------------------------

describe('HarnessCatalystGateway — 인메모리 원장', () => {
  it('seed/seedAll/clear/snapshot', () => {
    const gw = new HarnessCatalystGateway(currency);
    gw.seed([{ id: 0, qty: 3 }, { id: 20, qty: 1 }, { id: 9999, qty: 5 }]);
    // 미지 id(9999) 는 무시.
    expect(gw.snapshot().get(0)).toBe(3);
    expect(gw.snapshot().get(20)).toBe(1);
    expect(gw.snapshot().has(9999)).toBe(false);
    gw.seedAll(2); // 48종 각 +2 (0 은 3→5, 20 은 1→3).
    expect(gw.snapshot().get(0)).toBe(5);
    expect(gw.snapshot().get(20)).toBe(3);
    expect(gw.snapshot().size).toBe(48);
    gw.clear();
    expect(gw.snapshot().size).toBe(0);
  });

  it('consume: 성공 시 원장 차감 + runId 발급', async () => {
    const gw = new HarnessCatalystGateway(currency);
    gw.seed([{ id: 15, qty: 2 }]);
    const res = await gw.consumeCatalysts([15, 15], 0);
    expect(res.run_id).toMatch(/^harness-run-/);
    expect(res.resource_mult).toBeGreaterThan(1); // 자원축 촉매 2장.
    expect(gw.snapshot().has(15)).toBe(false); // 2개 전부 차감.
  });

  it('consume: 보유 부족이면 throw(미차감)', async () => {
    const gw = new HarnessCatalystGateway(currency);
    gw.seed([{ id: 15, qty: 1 }]);
    await expect(gw.consumeCatalysts([15, 15], 0)).rejects.toThrow();
    expect(gw.snapshot().get(15)).toBe(1); // 롤백 — 미차감.
  });

  it('consume: 특산-행성 불일치면 throw', async () => {
    const gw = new HarnessCatalystGateway(currency);
    // id 30 = 카르곤(planet 0) 특산. 행성 1 에 주입 시도 → 거부.
    gw.seed([{ id: 30, qty: 1 }]);
    await expect(gw.consumeCatalysts([30], 1)).rejects.toThrow();
    expect(gw.snapshot().get(30)).toBe(1);
  });

  it('consume: 강제 실패 토글이면 항상 throw', async () => {
    const gw = new HarnessCatalystGateway(currency);
    gw.seed([{ id: 0, qty: 8 }]);
    gw.setConsumeFail(true);
    expect(gw.isConsumeFail()).toBe(true);
    await expect(gw.consumeCatalysts([0], 0)).rejects.toThrow();
    gw.setConsumeFail(false);
    await expect(gw.consumeCatalysts([0], 0)).resolves.toBeTruthy();
  });

  it('salvage: 보유 충분이면 차감 + 재화(현재 크레딧 + 지급)', async () => {
    const gw = new HarnessCatalystGateway(currency);
    gw.seed([{ id: 0, qty: 2 }]);
    const res = await gw.salvageCatalyst(0, 1);
    expect(res.ok).toBe(true);
    expect(res.salvaged).toBe(1);
    expect(res.credits_left).toBeGreaterThan(100); // 현재 100 + placeholder.
    expect(gw.snapshot().get(0)).toBe(1);
  });

  it('salvage: 보유 부족이면 ok=false(미차감)', async () => {
    const gw = new HarnessCatalystGateway(currency);
    const res = await gw.salvageCatalyst(0, 1);
    expect(res.ok).toBe(false);
    expect(res.salvaged).toBe(0);
  });

  it('grant: 원장 가산 후 갱신 수량', async () => {
    const gw = new HarnessCatalystGateway(currency);
    const res = await gw.grantCatalyst(5, 3);
    expect(res.qty_after).toBe(3);
    const res2 = await gw.grantCatalyst(5, 2);
    expect(res2.qty_after).toBe(5);
  });

  it('fetch: >0 인 행만', async () => {
    const gw = new HarnessCatalystGateway(currency);
    gw.seed([{ id: 0, qty: 2 }, { id: 20, qty: 1 }]);
    const rows = await gw.fetchCatalystInventory();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.catalyst_id === 0)?.qty).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// ② net 폴백 배선 — deps 없이(실 서버 부재)도 모의로 라우팅
// ---------------------------------------------------------------------------

describe('setHarnessCatalystGateway — net 촉매 폴백', () => {
  it('설치 시 consume/fetch/grant/salvage 가 모의로 라우팅(실 서버 없을 때)', async () => {
    const gw = new HarnessCatalystGateway(currency);
    gw.seed([{ id: 15, qty: 2 }]);
    setHarnessCatalystGateway(gw);
    // config:null 로 실 서버 부재를 강제 → 폴백이 모의를 쓴다.
    const out = await consumeCatalystsOnServer([15], 0, { config: null });
    expect(out.status).toBe('ok');
    if (out.status === 'ok') expect(out.runId).toMatch(/^harness-run-/);
    const inv = await fetchCatalystInventoryOnline({ config: null });
    expect(inv).not.toBeNull();
    expect(inv!.get(15)).toBe(1); // consume 가 1개 차감.
    expect(await grantCatalystDrops([{ id: 0, qty: 2 }], { config: null })).toBe(2);
    const sal = await salvageCatalystOnServer(0, 1, { config: null });
    expect(sal.status).toBe('ok');
  });

  it('해제(null) 시 unconfigured 로 되돌아간다', async () => {
    setHarnessCatalystGateway(null);
    const out = await consumeCatalystsOnServer([15], 0, { config: null });
    expect(out).toEqual({ status: 'unconfigured' });
  });

  it('실 deps(주입 gateway)는 언제나 모의를 이긴다', async () => {
    const mock = new HarnessCatalystGateway(currency);
    mock.seed([{ id: 15, qty: 9 }]);
    setHarnessCatalystGateway(mock);
    // 명시 gateway 를 넘기면 그쪽이 이긴다(모의 무시) — 여기선 fetch 로 확인.
    const real = new HarnessCatalystGateway(currency);
    real.seed([{ id: 0, qty: 1 }]);
    const inv = await fetchCatalystInventoryOnline({ gateway: real });
    expect(inv!.has(0)).toBe(true);
    expect(inv!.has(15)).toBe(false); // 모의(id 15)가 아니라 real(id 0).
  });
});

// ---------------------------------------------------------------------------
// ③ 소스 배선 — main.ts DEV 블록 + cheatPanel 촉매 탭 (node 로 로드 불가라 소스 대조)
// ---------------------------------------------------------------------------

function readSource(rel: string): string {
  const url = new URL(rel, import.meta.url);
  return new TextDecoder().decode(readFileSync(url.pathname.replace(/^\/([A-Za-z]:)/, '$1')));
}

describe('배선(소스) — 하네스가 촉매 모의를 설치하고 픽커/컨트롤을 넘긴다', () => {
  const MAIN = readSource('../src/main.ts');
  const PANEL = readSource('../src/harness/cheatPanel.ts');

  it('main.ts 가 모의 게이트웨이를 net 에 설치한다', () => {
    expect(MAIN).toContain('HarnessCatalystGateway');
    expect(MAIN).toContain('setHarnessCatalystGateway(catalystMock)');
  });

  it('main.ts 가 치트 패널에 촉매 컨트롤을 넘기고 픽커를 연다', () => {
    expect(MAIN).toContain('catalyst: catalystControl');
    expect(MAIN).toContain('planetSelect.openCatalystPicker()');
    expect(MAIN).toContain('planetSelect.setCatalystInventory(');
  });

  it('cheatPanel 이 촉매 탭 + 컨트롤 계약을 갖는다', () => {
    expect(PANEL).toContain('HarnessCatalystControl');
    expect(PANEL).toContain("id: 'catalyst'");
    expect(PANEL).toContain('buildCatalystTab');
  });
});
