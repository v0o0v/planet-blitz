import { describe, it, expect } from 'vitest';
import {
  serializeProfile,
  deserializeProfile,
  progressScore,
  chooseProfile,
  planServerMigration,
  isMigrated,
  markMigrated,
  stashPendingProfile,
  readPendingProfile,
  clearPendingProfile,
  type ServerProfile,
} from '../src/net/profileSync.js';
import {
  migrateLocalProfileToServer,
  recordPveRunResult,
  flushPendingSync,
} from '../src/net/index.js';
import type { ServerGateway } from '../src/net/gateway.js';
import { defaultProfile, type KeyValueStore, type Profile } from '../src/save/profile.js';
import { rollItem } from '../src/items/roll.js';
import { SAVE_VERSION } from '../src/items/types.js';

/** In-memory KeyValueStore (node vitest 환경, DOM 없이). */
function memStore(seed?: Record<string, string>): KeyValueStore {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** 진행도가 서로 다른 두 프로필. */
function richProfile(): Profile {
  const p = defaultProfile();
  p.ships[0]!.level = 12;
  p.credits = 500;
  p.minerals = 40;
  p.inventory.push(rollItem(1, 'rare', { planet: 0, tier: 1 }));
  return p;
}

/**
 * 이관/동기화 검증용 fake 게이트웨이. 서버 프로필 1개를 메모리에 들고, 호출 횟수를
 * 기록한다. `failUpsert`/`failAll` 로 오프라인/오류를 시뮬레이션한다.
 */
class FakeGateway implements ServerGateway {
  row: ServerProfile | null;
  uid: string;
  upserts = 0;
  fetches = 0;
  failUpsert = false;
  failAll = false;
  constructor(uid = 'uid-1', row: ServerProfile | null = null) {
    this.uid = uid;
    this.row = row;
  }
  async getUserId(): Promise<string> {
    if (this.failAll) throw new Error('offline');
    return this.uid;
  }
  async fetchProfile(): Promise<ServerProfile | null> {
    if (this.failAll) throw new Error('offline');
    this.fetches++;
    return this.row;
  }
  async upsertProfile(
    _uid: string,
    payload: { save: Profile; save_version: number },
  ): Promise<void> {
    if (this.failAll || this.failUpsert) throw new Error('offline');
    this.upserts++;
    this.row = { save: payload.save, saveVersion: payload.save_version };
  }
}

// ---------------------------------------------------------------------------
// 순수: 직렬화
// ---------------------------------------------------------------------------

describe('profileSync — 직렬화(AC8)', () => {
  it('serialize→deserialize 라운드트립이 무손실', () => {
    const p = richProfile();
    const payload = serializeProfile(p);
    expect(payload.save_version).toBe(p.saveVersion);
    const back = deserializeProfile({ save: payload.save, saveVersion: payload.save_version });
    expect(back).toEqual(p);
  });

  it('손상/구버전 서버 blob 도 유효 Profile 로 복원(migrate 경유)', () => {
    const back = deserializeProfile({ save: { saveVersion: 0, gold: 99 }, saveVersion: 0 });
    expect(back.saveVersion).toBe(SAVE_VERSION);
    expect(back.credits).toBe(99); // v0 gold → credits
  });

  it('완전 쓰레기 blob 도 기본 프로필로 회복', () => {
    const back = deserializeProfile({ save: 'not-an-object', saveVersion: 0 });
    expect(back).toEqual(defaultProfile());
  });
});

// ---------------------------------------------------------------------------
// 순수: 진행도·통짜 선택
// ---------------------------------------------------------------------------

describe('profileSync — 진행도 비교', () => {
  it('진행 많은 프로필의 점수가 더 높다', () => {
    expect(progressScore(richProfile())).toBeGreaterThan(progressScore(defaultProfile()));
  });

  it('chooseProfile 은 진행 높은 쪽을 통째로 고른다', () => {
    const rich = richProfile();
    const poor = defaultProfile();
    expect(chooseProfile(poor, rich)).toBe(rich);
    expect(chooseProfile(rich, poor)).toBe(rich);
  });

  it('동점이면 로컬 우선(오프라인 우선)', () => {
    const a = defaultProfile();
    const b = defaultProfile();
    expect(chooseProfile(a, b)).toBe(a);
  });

  it('멱등: 자기 자신과 비교하면 자신', () => {
    const p = richProfile();
    expect(chooseProfile(p, p)).toBe(p);
  });
});

// ---------------------------------------------------------------------------
// 순수: 이관 계획 분기(버전 분기·멱등·병합)
// ---------------------------------------------------------------------------

describe('profileSync — planServerMigration 분기', () => {
  it('서버 없음 → 로컬 업로드(최초 임포트)', () => {
    const local = richProfile();
    const plan = planServerMigration(local, null, false);
    expect(plan).toEqual({ action: 'upload', profile: local });
  });

  it('이미 이관됨 + 서버 존재 → skip(멱등)', () => {
    const local = richProfile();
    const server = defaultProfile();
    const plan = planServerMigration(local, server, true);
    expect(plan.action).toBe('skip');
    expect(plan.profile).toBe(server);
  });

  it('서버 존재 + 미이관 → 진행 높은 쪽 병합 업로드', () => {
    const local = defaultProfile(); // 진행 낮음
    const server = richProfile(); // 진행 높음
    const plan = planServerMigration(local, server, false);
    expect(plan.action).toBe('upload');
    expect(plan.profile).toBe(server);
  });

  it('마커 없어도 서버가 비었으면 로컬 재업로드(복구 임포트)', () => {
    const local = richProfile();
    const plan = planServerMigration(local, null, true);
    expect(plan).toEqual({ action: 'upload', profile: local });
  });
});

// ---------------------------------------------------------------------------
// 순수: 로컬 동기화 스토어(마커·대기 슬롯)
// ---------------------------------------------------------------------------

describe('profileSync — 로컬 스토어', () => {
  it('마커는 uid 별로 판정', () => {
    const store = memStore();
    expect(isMigrated(store, 'uid-1')).toBe(false);
    markMigrated(store, 'uid-1');
    expect(isMigrated(store, 'uid-1')).toBe(true);
    expect(isMigrated(store, 'uid-2')).toBe(false); // 다른 익명 uid → 재이관
  });

  it('대기 슬롯 stash→read 라운드트립 + last-write-wins', () => {
    const store = memStore();
    expect(readPendingProfile(store)).toBeNull();
    const a = richProfile();
    stashPendingProfile(store, a);
    expect(readPendingProfile(store)).toEqual(a);
    const b = defaultProfile();
    stashPendingProfile(store, b); // 덮어씀
    expect(readPendingProfile(store)).toEqual(b);
    clearPendingProfile(store);
    expect(readPendingProfile(store)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 오케스트레이션(fake gateway 주입 — 네트워크 없음)
// ---------------------------------------------------------------------------

describe('net/index — 이관 오케스트레이션(AC8)', () => {
  it('미설정(gateway·config 없음)이면 완전 no-op', async () => {
    const store = memStore();
    // config 명시적으로 null → SDK 로드/네트워크 없음.
    await migrateLocalProfileToServer(richProfile(), { config: null, store });
    // 마커도 안 남고 대기 슬롯도 안 생긴다.
    expect(isMigrated(store, 'uid-1')).toBe(false);
    expect(readPendingProfile(store)).toBeNull();
  });

  it('최초 이관: 서버에 업로드하고 마커를 남긴다', async () => {
    const gw = new FakeGateway('uid-1', null);
    const store = memStore();
    const local = richProfile();
    await migrateLocalProfileToServer(local, { gateway: gw, store });
    expect(gw.upserts).toBe(1);
    expect(gw.row?.save).toEqual(local);
    expect(isMigrated(store, 'uid-1')).toBe(true);
  });

  it('멱등: 두 번째 호출은 업로드하지 않는다', async () => {
    const gw = new FakeGateway('uid-1', null);
    const store = memStore();
    await migrateLocalProfileToServer(richProfile(), { gateway: gw, store });
    await migrateLocalProfileToServer(richProfile(), { gateway: gw, store });
    expect(gw.upserts).toBe(1); // 두 번째는 skip
  });

  it('서버에 더 진행된 프로필이 있으면 그걸 유지(무손실 병합)', async () => {
    const serverRich = richProfile();
    const gw = new FakeGateway('uid-1', {
      save: serverRich,
      saveVersion: serverRich.saveVersion,
    });
    const store = memStore();
    // 로컬은 빈 프로필, 미이관 상태.
    await migrateLocalProfileToServer(defaultProfile(), { gateway: gw, store });
    expect(gw.row?.save).toEqual(serverRich); // 서버 진행도 보존
  });

  it('오프라인이면 마커를 남기지 않아 다음에 재시도', async () => {
    const gw = new FakeGateway('uid-1', null);
    gw.failAll = true;
    const store = memStore();
    await migrateLocalProfileToServer(richProfile(), { gateway: gw, store });
    expect(isMigrated(store, 'uid-1')).toBe(false);
  });
});

describe('net/index — PvE 런 기록·재시도 큐(AC8)', () => {
  it('recordPveRunResult 는 정산 프로필을 서버에 올린다', async () => {
    const gw = new FakeGateway('uid-1', null);
    const store = memStore();
    const p = richProfile();
    await recordPveRunResult(p, { gateway: gw, store });
    expect(gw.upserts).toBe(1);
    expect(gw.row?.save).toEqual(p);
    expect(readPendingProfile(store)).toBeNull(); // 성공 시 대기 슬롯 비움
  });

  it('전송 실패 시 대기 슬롯에 남아 flush 로 재전송', async () => {
    const gw = new FakeGateway('uid-1', null);
    gw.failUpsert = true;
    const store = memStore();
    const p = richProfile();
    await recordPveRunResult(p, { gateway: gw, store });
    expect(gw.upserts).toBe(0);
    expect(readPendingProfile(store)).toEqual(p); // 재시도 대기

    // 네트워크 회복 후 flush.
    gw.failUpsert = false;
    await flushPendingSync({ gateway: gw, store });
    expect(gw.upserts).toBe(1);
    expect(readPendingProfile(store)).toBeNull();
  });

  it('미설정이면 recordPveRunResult 는 대기 슬롯도 만들지 않는다(no-op)', async () => {
    const store = memStore();
    await recordPveRunResult(richProfile(), { config: null, store });
    expect(readPendingProfile(store)).toBeNull();
  });
});
