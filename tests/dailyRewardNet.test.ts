/**
 * 일일 보상 **배송함 반영 계층** 테스트 (ADR-0048 · 계획 §C5).
 *
 * ## 왜 이 파일이 필요한가
 *
 * 이 경로의 실패는 전부 **조용하다**. 예외가 안 나고 화면도 멀쩡하며 증상은 "물건이 두 개
 * 생겼다" 또는 "물건이 안 왔다" 하나뿐인데, 둘 다 며칠 뒤에나 드러난다. 그리고 안전망이
 * 하나뿐이다 — `items` 테이블의 `unique (profile_id, item_id)` 는 클라가 그 테이블에 한 줄도
 * 쓰지 않으므로 이 경로에 **걸리지 않는다**(`src/**` 에 `.from('items')` 0건). 즉 멱등은
 * `hasItemId` 순수 함수가 단독으로 보장하고, 이 파일이 그것을 잠근다.
 *
 * ## 단언 규율
 *
 * 단언마다 **"이게 통과하면서도 참일 수 있는 나쁜 상태"** 를 주석으로 적는다.
 */

import { describe, it, expect } from 'vitest';
import {
  dailyRewardItemId,
  planDailyRewardSlot,
  materializeDailyRewardItem,
  deliverDailyRewardRow,
  deliverPendingDailyRewards,
  type DailyRewardGateway,
  type DailyRewardClaim,
  type DailyRewardPendingRow,
} from '../src/net/dailyReward.js';
import { claimDailyRewardOnServer, flushPendingDailyRewardDeliveries } from '../src/net/index.js';
import {
  defaultProfile,
  INVENTORY_CAP,
  stashCapacity,
  type Profile,
} from '../src/save/profile.js';
import { hasItemId } from '../src/save/itemPresence.js';
import { progressScore } from '../src/net/profileSync.js';
import type { Item } from '../src/items/types.js';

const DATE_SEED = 20_308;
const ITEM_ID = dailyRewardItemId(DATE_SEED);

/** 서버가 배송함에 실어 보내는 장비 페이로드(슬라이스 2 형태를 미리 쓴다). */
const ITEM_PAYLOAD: unknown = {
  // ⚠️ 서버가 실은 id 는 **무시돼야 한다** — 멱등의 축은 `daily:{date_seed}` 파생값이다.
  id: 'server-said-something-else',
  slot: 'main',
  rarity: 'rare',
  affixes: [],
  source: { kind: 'daily', dateSeed: DATE_SEED },
};

function pendingRow(item: unknown = ITEM_PAYLOAD): DailyRewardPendingRow {
  return { dateSeed: DATE_SEED, item, holdReason: null };
}

/** 프로필 **전체**(가방·창고·기체 장착·수호기 잠김)에서 그 id 를 몇 개 들고 있는가. */
function countItem(profile: Profile, itemId: string): number {
  let n = 0;
  for (const it of profile.inventory) if (it.id === itemId) n++;
  for (const it of profile.stash) if (it.id === itemId) n++;
  for (const ship of profile.ships) {
    for (const it of Object.values(ship.equipped)) if (it !== undefined && it.id === itemId) n++;
  }
  for (const g of profile.guardians) {
    for (const it of Object.values(g.build?.equipped ?? {})) if (it !== undefined && it.id === itemId) n++;
  }
  return n;
}

function dummyItem(id: string): Item {
  return { id, slot: 'main', rarity: 'normal', affixes: [], source: { kind: 'drop', planet: 0, stage: 0 } } as Item;
}

/**
 * 인메모리 서버. `pushProfile` 이 서버 사본을 **갈아 끼우는지**가 이 fake 의 핵심 손잡이다 —
 * 통짜 선택(`chooseProfile`)에 밀린 상황을 그것으로 모의한다(케이스 ⑦).
 */
class FakeGateway implements DailyRewardGateway {
  server: Profile | null;
  rows: DailyRewardPendingRow[] = [];
  claim: DailyRewardClaim | null = null;

  applied: number[] = [];
  holds: Array<{ seed: number; reason: string }> = [];
  pushes = 0;

  failPush = false;
  /** `markApplied` 를 앞으로 몇 번 더 실패시킬 것인가. */
  failMarkTimes = 0;
  /** 참이면 push 가 성공한 척하되 **서버 사본은 그대로** 둔다(우리 스냅샷이 밀린 상황). */
  pushIgnored = false;

  constructor(server: Profile | null = defaultProfile()) {
    this.server = server;
  }

  async getUserId(): Promise<string> {
    return 'uid-test';
  }

  async claimDailyReward(): Promise<DailyRewardClaim> {
    if (this.claim === null) throw new Error('daily-reward: not-configured-in-fake');
    return this.claim;
  }

  async fetchPendingClaims(): Promise<DailyRewardPendingRow[]> {
    return this.rows.slice();
  }

  async markApplied(dateSeed: number): Promise<number> {
    if (this.failMarkTimes > 0) {
      this.failMarkTimes--;
      throw new Error('mark failed');
    }
    this.applied.push(dateSeed);
    this.rows = this.rows.filter((r) => r.dateSeed !== dateSeed);
    return 1;
  }

  async markHold(dateSeed: number, reason: 'capacity_full'): Promise<number> {
    this.holds.push({ seed: dateSeed, reason });
    return 1;
  }

  async pushProfile(profile: Profile): Promise<void> {
    this.pushes++;
    if (this.failPush) throw new Error('push failed');
    if (!this.pushIgnored) this.server = structuredClone(profile);
  }

  async pullProfile(): Promise<Profile | null> {
    return this.server === null ? null : structuredClone(this.server);
  }
}

describe('일일 보상 — 배송함 아이템 id', () => {
  it('date_seed 에서 결정론적으로 파생되고 기존 id 공간과 겹치지 않는다', () => {
    expect(dailyRewardItemId(DATE_SEED)).toBe(dailyRewardItemId(DATE_SEED));
    expect(dailyRewardItemId(DATE_SEED)).not.toBe(dailyRewardItemId(DATE_SEED + 1));
    // 나쁜 상태: 드랍(`it-{seed}`)·약탈품(`-loot-`)과 겹치면 플레이어가 이미 가진 물건 때문에
    // 배송이 영영 "이미 있다"로 판정돼 물건이 안 온다.
    expect(ITEM_ID.startsWith('it-')).toBe(false);
    expect(ITEM_ID.includes('-loot-')).toBe(false);
    expect(ITEM_ID).toBe('daily:20308');
  });

  it('서버가 실어 보낸 id 를 무시하고 파생값으로 덮어쓴다', () => {
    const item = materializeDailyRewardItem(ITEM_PAYLOAD, DATE_SEED);
    // 나쁜 상태: 서버 id 를 그대로 쓰면 서버가 매번 다른 값을 실을 때 멱등이 통째로 죽는다.
    expect(item?.id).toBe(ITEM_ID);
  });
});

describe('일일 보상 — 멱등(4곳 전수)', () => {
  it('① 장착한 뒤 재부팅해도 아이템은 정확히 1개다', async () => {
    const gw = new FakeGateway();
    const profile = defaultProfile();
    gw.rows = [pendingRow()];

    expect(await deliverDailyRewardRow(profile, pendingRow(), gw)).toBe('applied');
    expect(countItem(profile, ITEM_ID)).toBe(1);

    // 플레이어가 장착한다 — `inventory` 에서 사라진다.
    const idx = profile.inventory.findIndex((it) => it.id === ITEM_ID);
    const moved = profile.inventory.splice(idx, 1)[0] as Item;
    (profile.ships[0] as Profile['ships'][number]).equipped.main = moved;
    expect(profile.inventory.length).toBe(0);

    // 재부팅 — 같은 행이 다시 왔다(mark 유실·서버 재열람 등).
    expect(await deliverDailyRewardRow(profile, pendingRow(), gw)).toBe('applied');
    // 나쁜 상태: `inventory` 만 보는 판정이면 여기서 2가 된다(장착한 순간 안 보이므로).
    expect(countItem(profile, ITEM_ID)).toBe(1);
    expect(hasItemId(profile, ITEM_ID)).toBe(true);
  });

  it('② 창고로 옮긴 뒤 재부팅해도 아이템은 정확히 1개다', async () => {
    const gw = new FakeGateway();
    const profile = defaultProfile();

    expect(await deliverDailyRewardRow(profile, pendingRow(), gw)).toBe('applied');
    const idx = profile.inventory.findIndex((it) => it.id === ITEM_ID);
    profile.stash.push(profile.inventory.splice(idx, 1)[0] as Item);

    expect(await deliverDailyRewardRow(profile, pendingRow(), gw)).toBe('applied');
    // 나쁜 상태: 창고를 안 보면 2가 된다.
    expect(countItem(profile, ITEM_ID)).toBe(1);
  });
});

describe('일일 보상 — 만석 보류', () => {
  it('③ 가방·창고가 모두 만석이면 보류하고 mark 하지 않으며 사유를 서버에 남긴다', async () => {
    const gw = new FakeGateway();
    const profile = defaultProfile();
    for (let i = 0; i < INVENTORY_CAP; i++) profile.inventory.push(dummyItem(`inv-${i}`));
    for (let i = 0; i < stashCapacity(profile.stashExpansions); i++) profile.stash.push(dummyItem(`st-${i}`));
    expect(planDailyRewardSlot(profile)).toBe('full');

    expect(await deliverDailyRewardRow(profile, pendingRow(), gw)).toBe('held');
    // 나쁜 상태: mark 했으면 행이 닫혀 자리를 비운 뒤에도 물건이 영영 안 온다.
    expect(gw.applied).toEqual([]);
    // 나쁜 상태: hold 를 클라 로컬 상태로만 두면 관측 지표 ②가 만석 유저 때문에 상시 경보가 된다.
    expect(gw.holds).toEqual([{ seed: DATE_SEED, reason: 'capacity_full' }]);
    expect(countItem(profile, ITEM_ID)).toBe(0);
    // 보류는 push 도 하지 않는다 — 심은 것이 없으므로 밀 것이 없다.
    expect(gw.pushes).toBe(0);

    // 자리가 나면 다음 시도가 반영한다.
    profile.inventory.pop();
    expect(await deliverDailyRewardRow(profile, pendingRow(), gw)).toBe('applied');
    expect(countItem(profile, ITEM_ID)).toBe(1);
  });
});

describe('일일 보상 — 순서 계약(세이브 → push → 재-pull → mark)', () => {
  it('④ mark 가 실패하면 deferred 이고, 재시도가 중복 없이 닫는다', async () => {
    const gw = new FakeGateway();
    const profile = defaultProfile();
    gw.failMarkTimes = 1;

    expect(await deliverDailyRewardRow(profile, pendingRow(), gw)).toBe('deferred');
    expect(gw.applied).toEqual([]);
    expect(countItem(profile, ITEM_ID)).toBe(1);

    expect(await deliverDailyRewardRow(profile, pendingRow(), gw)).toBe('applied');
    expect(gw.applied).toEqual([DATE_SEED]);
    // 나쁜 상태: 재시도가 하나 더 심으면 2가 된다.
    expect(countItem(profile, ITEM_ID)).toBe(1);
  });

  it('⑤ push 가 실패하면 mark 하지 않는다', async () => {
    const gw = new FakeGateway();
    const profile = defaultProfile();
    gw.failPush = true;

    expect(await deliverDailyRewardRow(profile, pendingRow(), gw)).toBe('deferred');
    // 나쁜 상태: push 전에 mark 하면 행이 닫히고, 그 사이 통짜 선택이 아이템을 버리면 영구 유실이다.
    expect(gw.applied).toEqual([]);
    expect(gw.holds).toEqual([]);
    // 로컬에는 남는다 — 다음 부팅이 같은 id 로 재시도하고 중복은 안 생긴다.
    expect(countItem(profile, ITEM_ID)).toBe(1);
  });

  it('⑦ 재-pull 에서 아이템이 사라졌으면(서버 진행도가 더 높다) mark 하지 않는다', async () => {
    // 서버에 기체 레벨이 훨씬 높은 프로필이 있다 — `progressScore` 는 레벨 1 = 1000점이라
    // 아이템 48개 차이도 진다.
    const server = defaultProfile();
    (server.ships[0] as Profile['ships'][number]).level = 40;
    const local = defaultProfile();
    expect(progressScore(server)).toBeGreaterThan(progressScore(local) + 48);

    const gw = new FakeGateway(server);
    gw.pushIgnored = true; // 우리 스냅샷이 서버에 반영되지 않았다(통짜 선택에서 밀렸다).

    expect(await deliverDailyRewardRow(local, pendingRow(), gw)).toBe('deferred');
    // 나쁜 상태: 여기서 mark 하면 행이 닫혀 재시도가 없고, 서버 프로필에는 물건이 없으므로
    // 다음 pull 이 로컬을 덮는 순간 물건이 영구 유실된다.
    expect(gw.applied).toEqual([]);
    expect(gw.pushes).toBe(1);
  });

  it('재화 축(배송물 없음)은 심을 것 없이 행만 닫는다', async () => {
    const gw = new FakeGateway();
    const profile = defaultProfile();
    expect(await deliverDailyRewardRow(profile, pendingRow(null), gw)).toBe('applied');
    // 나쁜 상태: 행을 안 닫으면 관측 지표 ②(미반영 잔존 행)가 재화 축 때문에 영영 켜져 있다.
    expect(gw.applied).toEqual([DATE_SEED]);
    expect(gw.pushes).toBe(0);
  });
});

describe('일일 보상 — 오프라인 규약', () => {
  it('⑥ 미설정이면 no-op 이고 절대 throw 하지 않는다', async () => {
    const profile = defaultProfile();
    // `config: null` = Supabase 미설정. 게이트웨이가 아예 해석되지 않는다.
    await expect(claimDailyRewardOnServer(profile, { config: null })).resolves.toEqual({
      status: 'unconfigured',
    });
    await expect(flushPendingDailyRewardDeliveries(profile, { config: null })).resolves.toBe(false);
    // 나쁜 상태: no-op 인데 프로필을 건드렸으면 오프라인 플레이가 조용히 오염된다.
    expect(countItem(profile, ITEM_ID)).toBe(0);
    expect(profile.inventory.length).toBe(0);
  });

  it('서버 조회가 던져도 배송 루프는 삼키고 빈 결과를 낸다', async () => {
    const gw = new FakeGateway();
    gw.fetchPendingClaims = async (): Promise<DailyRewardPendingRow[]> => {
      throw new Error('offline');
    };
    await expect(deliverPendingDailyRewards(defaultProfile(), gw)).resolves.toEqual([]);
  });

  it('EF 가 거부하면 failed 를 돌려주고 던지지 않는다', async () => {
    const gw = new FakeGateway();
    const profile = defaultProfile();
    const res = await claimDailyRewardOnServer(profile, { gateway: gw });
    // `claim` 이 없는 fake 는 throw 한다 — 그 예외가 밖으로 새면 모달이 통째로 죽는다.
    expect(res.status).toBe('failed');
  });
});

describe('일일 보상 — 수령 경로 배선', () => {
  it('수령 응답의 잔액으로 미러를 맞추고 같은 호출에서 배송까지 끝낸다', async () => {
    const gw = new FakeGateway();
    const profile = defaultProfile();
    gw.claim = {
      already: false,
      dateSeed: DATE_SEED,
      streak: 3,
      budget: 4_000,
      clamped: false,
      result: {
        axis: 'currency',
        value: 1_240,
        credits: 1_240,
        minerals: 0,
        rarity: null,
        grade: null,
        count: null,
        axisGrant: null,
        goalId: 'stash:1',
        fallback: false,
        announcementMissed: false,
        step: { index: 1, total: 4 },
      },
      next: { axis: 'currency' },
      item: ITEM_PAYLOAD,
      creditsLeft: 9_999,
      mineralsLeft: 42,
    };

    gw.rows = [pendingRow()];

    const res = await claimDailyRewardOnServer(profile, { gateway: gw });
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.delivery).toBe('applied');
    // 나쁜 상태: 미러를 안 맞추면 화면이 방금 받은 크레딧을 며칠 뒤에야 보여준다(재화 정본은 서버 컬럼).
    expect(profile.credits).toBe(9_999);
    expect(profile.minerals).toBe(42);
    expect(countItem(profile, ITEM_ID)).toBe(1);
  });

  it('멱등 재응답(already)이 배송물을 안 실어 와도 열린 행을 닫지 않는다', async () => {
    const gw = new FakeGateway();
    const profile = defaultProfile();
    // 오늘 이미 받았고, 장비 배송함 행은 아직 열려 있다(이전 시도가 push 에서 실패했다).
    gw.rows = [pendingRow()];
    gw.claim = {
      already: true,
      dateSeed: DATE_SEED,
      streak: 3,
      budget: 4_000,
      clamped: false,
      result: null,
      next: null,
      item: null, // ← 재응답이 배송물을 못 실어 왔다.
      creditsLeft: null,
      mineralsLeft: null,
    };

    const res = await claimDailyRewardOnServer(profile, { gateway: gw });
    expect(res.status).toBe('ok');
    // 나쁜 상태: 응답의 `item: null` 을 믿고 "배송할 것 없음"으로 읽으면 행이 닫히고 물건이
    // 영구 유실된다. 반영의 입력은 언제나 미반영 행 목록이어야 한다.
    expect(countItem(profile, ITEM_ID)).toBe(1);
    expect(gw.applied).toEqual([DATE_SEED]);
  });

  it('부팅 flush 는 미반영 행 전부를 훑고 반영 여부를 알린다', async () => {
    const gw = new FakeGateway();
    const profile = defaultProfile();
    gw.rows = [pendingRow(), { dateSeed: DATE_SEED + 1, item: null, holdReason: null }];

    await expect(flushPendingDailyRewardDeliveries(profile, { gateway: gw })).resolves.toBe(true);
    // 나쁜 상태: 첫 행에서 멈추면 그 앞의 행이 영영 안 닫힌다.
    expect(gw.applied.slice().sort((a, b) => a - b)).toEqual([DATE_SEED, DATE_SEED + 1]);
    expect(countItem(profile, ITEM_ID)).toBe(1);
  });
});
