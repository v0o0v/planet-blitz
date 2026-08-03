import { describe, it, expect } from 'vitest';
import {
  serializeProfile,
  deserializeProfile,
  progressScore,
  chooseProfile,
  shouldPushPending,
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
  pullServerProfileInto,
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
  p.inventory.push(rollItem(1, 'rare', { planet: 0, stage: 11 }));
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

describe('profileSync — shouldPushPending(다기기 회귀 방지, 코드리뷰 MED-6)', () => {
  it('서버가 없으면 항상 push', () => {
    expect(shouldPushPending(richProfile(), null)).toBe(true);
  });

  it('대기 프로필이 서버보다 진행 높거나 같으면 push', () => {
    const pending = richProfile();
    const server = defaultProfile();
    expect(shouldPushPending(pending, server)).toBe(true);
    expect(shouldPushPending(pending, pending)).toBe(true); // 동점
  });

  it('대기 프로필이 서버보다 뒤처지면 push 거부(회귀 방지)', () => {
    const pending = defaultProfile();
    const server = richProfile(); // 다른 기기가 그 사이 더 진행시킴
    expect(shouldPushPending(pending, server)).toBe(false);
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

  it('flushPendingSync 는 그 사이 서버가 더 진행됐으면 낡은 대기 스냅샷으로 덮어쓰지 않는다(다기기 회귀 방지, 코드리뷰 MED-6)', async () => {
    // 대기 슬롯에는 낮은 진행도의 스냅샷이 남아있는데(전송 실패로 재시도 대기),
    // 그 사이 다른 기기가 더 진행된 상태를 서버에 이미 올렸다고 가정.
    const staleP = defaultProfile();
    const gw = new FakeGateway('uid-1', null);
    gw.failUpsert = true;
    const store = memStore();
    await recordPveRunResult(staleP, { gateway: gw, store });
    expect(readPendingProfile(store)).toEqual(staleP);

    // 다른 기기가 더 진행된 프로필을 서버에 올림 + 이 기기의 네트워크도 회복.
    const advanced = richProfile();
    gw.row = { save: advanced, saveVersion: advanced.saveVersion };
    gw.failUpsert = false;

    await flushPendingSync({ gateway: gw, store });

    expect(gw.upserts).toBe(0); // 낡은 스냅샷 업로드 안 함
    expect(gw.row?.save).toEqual(advanced); // 서버는 그대로 진행된 상태 유지
    expect(readPendingProfile(store)).toBeNull(); // 해소됨 — 재시도 큐에서 제거
  });

  it('flushPendingSync 는 대기 스냅샷이 서버와 동점 이상이면 정상 업로드', async () => {
    const p = richProfile();
    const gw = new FakeGateway('uid-1', { save: p, saveVersion: p.saveVersion });
    const store = memStore();
    stashPendingProfile(store, p);
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

/**
 * 서버 → 로컬 pull.
 *
 * **이 경로는 로그인 레인 전까지 아예 없었다.** `migrateLocalProfileToServer` 는 올리기만 하고,
 * 서버가 더 진행됐어도 로컬 객체에는 아무것도 안 남긴다. 익명 로그인 시절엔 기기마다 uid 가
 * 달라 "같은 계정을 새 기기에서 연다"가 성립하지 않아 드러나지 않았다. 구글 로그인이 붙으면
 * 그게 주 사용 사례가 되므로, 없으면 새 기기에서 진행도가 영영 안 보인다.
 */
describe('pullServerProfileInto', () => {
  it('서버가 더 진행됐으면 로컬 객체를 제자리에서 갈아 끼운다', async () => {
    const serverRich = richProfile();
    const gw = new FakeGateway('uid-1', {
      save: serverRich,
      saveVersion: serverRich.saveVersion,
    });
    // main.ts 의 `profile` 은 const 라 재대입이 불가능하다 — 참조가 유지되는지까지 확인한다.
    const local = defaultProfile();
    const ref = local;

    expect(await pullServerProfileInto(local, { gateway: gw })).toBe('applied');
    expect(local).toBe(ref);
    expect(local.ships[0]?.level).toBe(12);
    expect(local.credits).toBe(500);
  });

  it('로컬이 더 진행됐으면 건드리지 않는다(오프라인 플레이 보존)', async () => {
    const gw = new FakeGateway('uid-1', {
      save: defaultProfile(),
      saveVersion: defaultProfile().saveVersion,
    });
    const local = richProfile();

    expect(await pullServerProfileInto(local, { gateway: gw })).toBe('kept-local');
    expect(local.ships[0]?.level).toBe(12);
  });

  it('신규 계정(서버 행 없음)이면 로컬을 그대로 출발점으로 쓴다', async () => {
    const gw = new FakeGateway('uid-1', null);
    const local = defaultProfile();
    expect(await pullServerProfileInto(local, { gateway: gw })).toBe('kept-local');
  });

  it('미로그인/오프라인이면 unavailable — 로컬을 지우지도 덮지도 않는다', async () => {
    const gw = new FakeGateway('uid-1', {
      save: defaultProfile(),
      saveVersion: defaultProfile().saveVersion,
    });
    gw.failAll = true;
    const local = richProfile();

    expect(await pullServerProfileInto(local, { gateway: gw })).toBe('unavailable');
    expect(local.ships[0]?.level).toBe(12);
  });

  it('미설정이면 SDK 를 건드리지 않고 unavailable', async () => {
    expect(await pullServerProfileInto(defaultProfile(), { config: null })).toBe('unavailable');
  });
});
