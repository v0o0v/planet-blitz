/**
 * 복수전·알림·스티커 네트워크 계층 검증 (src/net/invasion.ts — M4 Phase F1/F2/F3, 계약 §F).
 *
 * 커버리지:
 *   1. 순수: 복수 잔여시간·라벨, 알림 마지막-확인 저장·미확인 카운트.
 *   2. no-op 모드(config=null): 신규 공개 함수가 전부 null/false(SDK 미접촉).
 *   3. fake 게이트웨이: 복수 목록·알림·스티커 설정·리플레이 로드 왕복 + 오류 흡수.
 *   4. setInvasionSticker 입력 가드(범위 밖/빈 id 는 서버 미접촉).
 */

import { describe, it, expect } from 'vitest';
import {
  fetchRevengeTargets,
  fetchIncomingInvasions,
  fetchInvasionReplay,
  setInvasionSticker,
  revengeRemainingMs,
  formatRevengeRemaining,
  REVENGE_WINDOW_MS,
  readInvasionsSeenAt,
  writeInvasionsSeenAt,
  countUnseenInvasions,
  type InvasionGateway,
  type RevengeTarget,
  type IncomingInvasion,
  type InvasionTarget,
  type LadderEntry,
  type InvasionVerdict,
  type InvasionSubmitInput,
} from '../src/net/invasion.js';
import type { Replay } from '../src/sim/replay.js';
import type { KeyValueStore } from '../src/save/profile.js';

function memStore(seed?: Record<string, string>): KeyValueStore {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const REVENGE: RevengeTarget = {
  profileId: 'atk-9',
  rank: 5,
  displayName: '숙적 델타',
  shipSummary: { name: '레이븐', level: 33 },
  defenseId: 'd-9',
  layout: { core: { x: 400, y: 0 }, turrets: [], obstacles: [] },
  maintenance: 72,
  revengeInvasionId: 'inv-lost-1',
  expiresAtMs: 10_000 + REVENGE_WINDOW_MS,
};

const INCOMING: IncomingInvasion = {
  invasionId: 'inv-1',
  attackerName: '침입자 감마',
  attackerWon: true,
  createdAtMs: 5000,
  sticker: 3,
  defenderSticker: null,
  isRevenge: false,
};

/** 신규 F 계약 메서드를 구현한 fake 게이트웨이(no-op 게이트웨이와 대비). */
class FakeGateway implements InvasionGateway {
  fail = false;
  revenge: RevengeTarget[] = [REVENGE];
  incoming: IncomingInvasion[] = [INCOMING];
  replay: Replay | null = { seed: 7, inputs: [] };
  lastStickerCall: { id: string; index: number } | null = null;
  lastIncomingSince = -1;

  async getUserId(): Promise<string> {
    return 'me';
  }
  async getInvasionTargets(): Promise<InvasionTarget[]> {
    return [];
  }
  async fetchLadder(): Promise<LadderEntry[]> {
    return [];
  }
  async submitInvasion(_i: InvasionSubmitInput): Promise<InvasionVerdict> {
    return { status: 'verified', attackerWon: true, ladder: null, loot: [] };
  }
  async getRevengeTargets(): Promise<RevengeTarget[]> {
    if (this.fail) throw new Error('offline');
    return this.revenge;
  }
  async getIncomingInvasions(sinceMs: number): Promise<IncomingInvasion[]> {
    if (this.fail) throw new Error('offline');
    this.lastIncomingSince = sinceMs;
    return this.incoming;
  }
  async setInvasionSticker(invasionId: string, index: number): Promise<boolean> {
    if (this.fail) throw new Error('offline');
    this.lastStickerCall = { id: invasionId, index };
    return true;
  }
  async getInvasionReplay(_invasionId: string): Promise<Replay | null> {
    if (this.fail) throw new Error('offline');
    return this.replay;
  }
}

// ---------------------------------------------------------------------------
// 순수 로직
// ---------------------------------------------------------------------------

describe('복수전 잔여시간(순수)', () => {
  it('revengeRemainingMs: 남으면 양수, 지나면 0(음수 없음)', () => {
    expect(revengeRemainingMs(1000, 0)).toBe(1000);
    expect(revengeRemainingMs(1000, 1000)).toBe(0);
    expect(revengeRemainingMs(1000, 5000)).toBe(0);
    expect(revengeRemainingMs(NaN, 0)).toBe(0);
  });

  it('formatRevengeRemaining: 시간/분/만료', () => {
    expect(formatRevengeRemaining(0)).toBe('');
    expect(formatRevengeRemaining(-100)).toBe('');
    expect(formatRevengeRemaining(30 * 60_000)).toBe('복수 가능 30분 남음');
    expect(formatRevengeRemaining(2 * 60 * 60_000)).toBe('복수 가능 2시간 남음');
  });
});

describe('알림 마지막-확인 저장 + 미확인 카운트(순수)', () => {
  it('read/write 라운드트립, 부재는 0', () => {
    const store = memStore();
    expect(readInvasionsSeenAt(store)).toBe(0);
    writeInvasionsSeenAt(store, 12345);
    expect(readInvasionsSeenAt(store)).toBe(12345);
  });

  it('손상 값은 0 으로 회복', () => {
    expect(readInvasionsSeenAt(memStore({ 'planet-blitz:net:invasionsSeenAt': 'x' }))).toBe(0);
  });

  it('countUnseenInvasions: sinceMs 초과분만 카운트', () => {
    const list: IncomingInvasion[] = [
      { ...INCOMING, invasionId: 'a', createdAtMs: 100 },
      { ...INCOMING, invasionId: 'b', createdAtMs: 200 },
      { ...INCOMING, invasionId: 'c', createdAtMs: 300 },
    ];
    expect(countUnseenInvasions(list, 0)).toBe(3);
    expect(countUnseenInvasions(list, 150)).toBe(2);
    expect(countUnseenInvasions(list, 300)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// no-op 모드
// ---------------------------------------------------------------------------

describe('net/invasion F 계약 — no-op 모드(미설정)', () => {
  it('config=null 이면 전부 null/false(SDK 미접촉)', async () => {
    expect(await fetchRevengeTargets({ config: null })).toBeNull();
    expect(await fetchIncomingInvasions(0, 10, { config: null })).toBeNull();
    expect(await fetchInvasionReplay('inv-1', { config: null })).toBeNull();
    expect(await setInvasionSticker('inv-1', 2, { config: null })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fake 게이트웨이
// ---------------------------------------------------------------------------

describe('net/invasion F 계약 — fake 게이트웨이', () => {
  it('fetchRevengeTargets: 게이트웨이 행 반환', async () => {
    const gw = new FakeGateway();
    expect(await fetchRevengeTargets({ gateway: gw })).toEqual([REVENGE]);
  });

  it('fetchIncomingInvasions: since 전달 + 행 반환', async () => {
    const gw = new FakeGateway();
    const res = await fetchIncomingInvasions(4321, 10, { gateway: gw });
    expect(res).toEqual([INCOMING]);
    expect(gw.lastIncomingSince).toBe(4321);
  });

  it('setInvasionSticker: 유효 인덱스는 서버 호출 + true', async () => {
    const gw = new FakeGateway();
    expect(await setInvasionSticker('inv-1', 5, { gateway: gw })).toBe(true);
    expect(gw.lastStickerCall).toEqual({ id: 'inv-1', index: 5 });
  });

  it('setInvasionSticker: 범위 밖/빈 id 는 서버 미접촉(false)', async () => {
    const gw = new FakeGateway();
    expect(await setInvasionSticker('inv-1', 12, { gateway: gw })).toBe(false);
    expect(await setInvasionSticker('inv-1', -1, { gateway: gw })).toBe(false);
    expect(await setInvasionSticker('', 3, { gateway: gw })).toBe(false);
    expect(gw.lastStickerCall).toBeNull();
  });

  it('fetchInvasionReplay: 리플레이 반환 / 빈 id 는 null', async () => {
    const gw = new FakeGateway();
    expect(await fetchInvasionReplay('inv-1', { gateway: gw })).toEqual({ seed: 7, inputs: [] });
    expect(await fetchInvasionReplay('', { gateway: gw })).toBeNull();
  });

  it('오류는 전부 흡수(null/false, throw 안 함)', async () => {
    const gw = new FakeGateway();
    gw.fail = true;
    expect(await fetchRevengeTargets({ gateway: gw })).toBeNull();
    expect(await fetchIncomingInvasions(0, 10, { gateway: gw })).toBeNull();
    expect(await fetchInvasionReplay('inv-1', { gateway: gw })).toBeNull();
    expect(await setInvasionSticker('inv-1', 2, { gateway: gw })).toBe(false);
  });
});
