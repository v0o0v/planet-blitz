/**
 * 의뢰 확정 지급물 **배송** 테스트 — "이겼는데 물건이 안 왔다"가 초록으로 지나가지 않게.
 *
 * ## 왜 이 파일이 필요한가
 * 서버는 `commission_grants` 에 확정 지급물을 **발급**하고 그 목록을 EF 응답까지 실어 보냈는데
 * `main.ts` 의 `verified` 분기가 그것을 **아무 데도 쓰지 않고 버렸다**. 즉 발급은 되는데 배송이
 * 없었고, 증상은 "보상이 안 들어온다" 하나뿐이라 전 게이트가 초록이었다 — 이 리포가 반복해서
 * 겪은 형태다. 커버리지 공백이 결함을 가리고 있었던 자리가
 * `tests/commissionSubmit.test.ts` 의 `grants: []` 고정 픽스처다(그쪽도 함께 고쳤다).
 *
 * ## 단언 규율
 * 단언마다 **"이게 통과하면서도 참일 수 있는 나쁜 상태"** 를 주석으로 적는다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { deliverCommissionGrants } from '../src/run/commissionGrantDelivery.js';
import type { CommissionGrantDeliveryDeps } from '../src/run/commissionGrantDelivery.js';
import { commissionGrantItemId } from '../src/items/commissionGrant.js';
import { hasItemId } from '../src/save/itemPresence.js';
import { defaultProfile, INVENTORY_CAP, stashCapacity } from '../src/save/profile.js';
import type { Profile } from '../src/save/profile.js';
import type { Item } from '../src/items/types.js';
import type { CommissionGrantRow } from '../src/net/commissionGateway.js';

/** 레지스트리에 실재하는 유니크(슬롯 armor, 무기타입 무관). data/uniques.ts 정본. */
const UNIQ = 'phase-armor';
const GRANT_ID = '11111111-2222-3333-4444-555555555555';

function grantRow(over: Partial<CommissionGrantRow> = {}): CommissionGrantRow {
  return {
    grantId: GRANT_ID,
    profileId: 'p-1',
    commissionRunId: 'run-1',
    kind: 'unique',
    slotIndex: 0,
    itemPayload: { uniqueId: UNIQ },
    grantedAtMs: 1_700_000_000_000,
    appliedAtMs: null,
    ...over,
  };
}

interface Harness {
  deps: CommissionGrantDeliveryDeps;
  /** `markApplied` 로 실제 표시된 grant_id 목록. */
  marks: string[];
  /** 서버에 올라간 프로필 스냅샷 수(push 성공 횟수). */
  pushes: number;
}

interface HarnessOpts {
  rows?: readonly CommissionGrantRow[] | null;
  /** push 성공 여부(기본 true). */
  pushOk?: boolean;
  /** 재-pull 이 돌려줄 프로필(기본: 인자 그대로 = 서버가 우리 것을 그대로 들고 있음). */
  repull?: (p: Profile) => Profile | null;
  /** 표시 성공 여부(기본 true). */
  markOk?: boolean;
}

function harness(profile: Profile, opts: HarnessOpts = {}): Harness {
  const marks: string[] = [];
  const h: Harness = {
    marks,
    pushes: 0,
    deps: {
      fetchGrants: async () => (opts.rows === undefined ? [grantRow()] : opts.rows),
      saveProfile: () => undefined,
      pushProfile: async () => {
        if (opts.pushOk === false) return false;
        h.pushes++;
        return true;
      },
      repullProfile: async (p) => (opts.repull !== undefined ? opts.repull(p) : p),
      markApplied: async (id) => {
        if (opts.markOk === false) return false;
        marks.push(id);
        return true;
      },
    },
  };
  void profile;
  return h;
}

/** 배송된 유니크를 프로필에서 꺼낸다(가방 우선, 없으면 창고). */
function findDelivered(profile: Profile): Item | undefined {
  const id = commissionGrantItemId(GRANT_ID);
  return profile.inventory.find((i) => i.id === id) ?? profile.stash.find((i) => i.id === id);
}

/** 자리를 채우는 더미 아이템. */
function filler(n: number): Item[] {
  const out: Item[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `filler-${i}`,
      slot: 'armor',
      rarity: 'normal',
      affixes: [],
      source: { planet: 0, stage: 1 },
    });
  }
  return out;
}

describe('배송 — 유니크 축이 세이브에 실제로 들어간다', () => {
  it('① 반영 후 재부팅해도 1개다 (중복 배송 없음)', async () => {
    const p = defaultProfile();
    const h1 = harness(p);
    const r1 = await deliverCommissionGrants(p, h1.deps);
    expect(r1.delivered).toBe(1);
    expect(h1.marks).toEqual([GRANT_ID]);
    const item = findDelivered(p);
    expect(item).toBeDefined();
    expect(item?.uniqueId).toBe(UNIQ);
    expect(item?.slot).toBe('armor');
    expect(item?.rarity).toBe('unique');

    // 재부팅: 서버가 아직 applied_at 을 못 반영했다고 가정해도(최악) 다시 심으면 안 된다.
    // 통과하면서도 참일 수 있는 나쁜 상태: 두 번째 호출이 아무것도 안 읽고 조용히 끝나는 것 —
    // 그래서 `marked` 로 **행을 다시 처리했음**을 확인한다.
    const h2 = harness(p);
    const r2 = await deliverCommissionGrants(p, h2.deps);
    expect(r2.delivered).toBe(0);
    expect(r2.marked).toBe(1);
    const count = p.inventory.filter((i) => i.id === commissionGrantItemId(GRANT_ID)).length;
    expect(count).toBe(1);
  });

  it('② 장착한 뒤 재부팅해도 여전히 1개다 (inventory 만 보면 여기서 깨진다)', async () => {
    const p = defaultProfile();
    await deliverCommissionGrants(p, harness(p).deps);
    const item = findDelivered(p);
    expect(item).toBeDefined();
    // 플레이어가 장착한다 → inventory 에서 사라진다.
    p.inventory = p.inventory.filter((i) => i.id !== item?.id);
    const ship = p.ships[0];
    expect(ship).toBeDefined();
    if (ship !== undefined && item !== undefined) ship.equipped.armor = item;

    const h2 = harness(p);
    const r2 = await deliverCommissionGrants(p, h2.deps);
    // 통과하면서도 참일 수 있는 나쁜 상태: 배송이 통째로 꺼져 있어 0인 것 —
    // `marked`(행을 보고 표시했다)가 그것을 가른다.
    expect(r2.delivered).toBe(0);
    expect(r2.marked).toBe(1);
    expect(p.inventory.some((i) => i.id === item?.id)).toBe(false);
    expect(hasItemId(p, commissionGrantItemId(GRANT_ID))).toBe(true);
  });

  it('③ 창고로 옮긴 뒤 재부팅해도 1개다', async () => {
    const p = defaultProfile();
    await deliverCommissionGrants(p, harness(p).deps);
    const item = findDelivered(p);
    expect(item).toBeDefined();
    p.inventory = p.inventory.filter((i) => i.id !== item?.id);
    if (item !== undefined) p.stash.push(item);

    const r2 = await deliverCommissionGrants(p, harness(p).deps);
    expect(r2.delivered).toBe(0);
    expect(p.stash.filter((i) => i.id === item?.id).length).toBe(1);
    expect(p.inventory.length).toBe(0);
  });

  it('③′ 퇴역 수호기에 잠겨 있어도 1개다 (guardians[].build.equipped)', async () => {
    // 이 칸을 안 보면 퇴역 직후 창에서 중복 지급이 열린다 — 소멸 시 stash 로 돌아오므로
    // 그때 같은 아이템이 두 개가 된다.
    const p = defaultProfile();
    await deliverCommissionGrants(p, harness(p).deps);
    const item = findDelivered(p);
    expect(item).toBeDefined();
    p.inventory = [];
    p.guardians.push({
      id: 'g-1',
      snapshot: {} as never,
      performanceCP: 10000,
      combatScore: 0,
      preset: 0,
      retired: false,
      build: {
        typeId: 0,
        equipped: item !== undefined ? { armor: item } : {},
        skillInvest: [],
        activeSlots: [null, null],
      },
    });

    const r2 = await deliverCommissionGrants(p, harness(p).deps);
    expect(r2.delivered).toBe(0);
    expect(p.inventory.length).toBe(0);
  });
});

describe('배송 — 표시(applied_at)는 물건이 서버에 닿은 뒤에만 찍는다', () => {
  it('⑥ push 실패면 표시하지 않는다 (표시하면 영구 유실)', async () => {
    const p = defaultProfile();
    const h = harness(p, { pushOk: false });
    const r = await deliverCommissionGrants(p, h.deps);
    // 로컬에는 들어갔다 — 그것이 옳다(플레이어는 물건을 본다).
    expect(r.delivered).toBe(1);
    // 통과하면서도 참일 수 있는 나쁜 상태: 배송 자체가 안 일어나 표시할 것이 없어서 0인 것.
    expect(r.marked).toBe(0);
    expect(h.marks).toEqual([]);
  });

  it('⑦ 재-pull 확인이 실패하면(서버 프로필이 더 진행돼 아이템이 사라졌다) 표시하지 않는다', async () => {
    // `progressScore` 는 기체 레벨 1 = 1000점이라 아이템 48개 차이도 진다 — 즉 서버에
    // 더 진행된 프로필이 있으면 `chooseProfile` 이 방금 심은 아이템을 통째로 버린다.
    const p = defaultProfile();
    const h = harness(p, {
      repull: () => {
        // 서버 쪽이 이겨서 로컬이 갈아 끼워졌다 → 그 아이템은 없다.
        const server = defaultProfile();
        const s0 = server.ships[0];
        if (s0 !== undefined) s0.level = 9;
        return server;
      },
    });
    const r = await deliverCommissionGrants(p, h.deps);
    expect(r.marked).toBe(0);
    expect(h.marks).toEqual([]);
  });

  it('⑦′ 재-pull 자체가 불가(오프라인)면 표시하지 않는다', async () => {
    const p = defaultProfile();
    const h = harness(p, { repull: () => null });
    const r = await deliverCommissionGrants(p, h.deps);
    expect(r.marked).toBe(0);
  });

  it('⑤ 표시가 실패해도 아이템은 남고, 다음 부팅이 표시만 다시 시도한다', async () => {
    const p = defaultProfile();
    const r1 = await deliverCommissionGrants(p, harness(p, { markOk: false }).deps);
    expect(r1.delivered).toBe(1);
    expect(r1.marked).toBe(0);

    const h2 = harness(p);
    const r2 = await deliverCommissionGrants(p, h2.deps);
    // 이미 들고 있으므로 다시 심지 않고 **표시만** 한다.
    expect(r2.delivered).toBe(0);
    expect(r2.marked).toBe(1);
    expect(h2.pushes).toBe(0); // 심을 것이 없으면 왕복도 없다.
    expect(p.inventory.filter((i) => i.id === commissionGrantItemId(GRANT_ID)).length).toBe(1);
  });
});

describe('배송 — 받을 수 없는 상태는 보류한다 (버리지 않는다)', () => {
  it('④ 인벤·창고 만석이면 반영을 보류하고 표시하지 않는다', async () => {
    const p = defaultProfile();
    p.inventory = filler(INVENTORY_CAP);
    p.stash = filler(stashCapacity(p.stashExpansions));
    const h = harness(p);
    const r = await deliverCommissionGrants(p, h.deps);
    expect(r.held).toBe(1);
    expect(r.delivered).toBe(0);
    // 통과하면서도 참일 수 있는 나쁜 상태: 표시해 버려서 자리를 비워도 영영 안 오는 것.
    expect(h.marks).toEqual([]);
    expect(p.inventory.length).toBe(INVENTORY_CAP);
  });

  it('④′ 가방이 차면 창고로 간다', async () => {
    const p = defaultProfile();
    p.inventory = filler(INVENTORY_CAP);
    const r = await deliverCommissionGrants(p, harness(p).deps);
    expect(r.delivered).toBe(1);
    expect(p.stash.some((i) => i.id === commissionGrantItemId(GRANT_ID))).toBe(true);
  });

  it('⑧ 레지스트리에 없는 uniqueId 는 표시하지 않고 남긴다 (카탈로그가 채워지면 반영된다)', async () => {
    const p = defaultProfile();
    const h = harness(p, { rows: [grantRow({ itemPayload: { uniqueId: 'no-such-unique' } })] });
    const r = await deliverCommissionGrants(p, h.deps);
    expect(r.unresolved).toBe(1);
    expect(r.delivered).toBe(0);
    // 통과하면서도 참일 수 있는 나쁜 상태: 조용히 버리고 표시까지 해서 서버는 "줬다"인데
    // 플레이어에게는 영영 안 오는 것.
    expect(h.marks).toEqual([]);
  });

  it('⑧′ uniqueId 가 숫자면 해석하지 않는다 (새 인코딩을 발명하지 않는다)', async () => {
    // `CommissionRewards.uniqueId` 는 오늘 `number` 로 선언돼 있는데 레지스트리 키는
    // 문자열이다. 숫자를 비트·인덱스로 추측해 해석하면 그 자리에서 새 인코딩이 생긴다.
    const p = defaultProfile();
    const h = harness(p, { rows: [grantRow({ itemPayload: { uniqueId: 3 } })] });
    const r = await deliverCommissionGrants(p, h.deps);
    expect(r.unresolved).toBe(1);
    expect(h.marks).toEqual([]);
  });

  it('설계도 행은 클라가 건드리지 않는다 (서버 트리거가 배송한다)', async () => {
    const p = defaultProfile();
    const h = harness(p, {
      rows: [grantRow({ kind: 'blueprint', itemPayload: { blueprintId: { kind: 0, catalogId: 1, count: 1 } } })],
    });
    const r = await deliverCommissionGrants(p, h.deps);
    expect(r.skipped).toBe(1);
    expect(r.delivered).toBe(0);
    expect(h.marks).toEqual([]);
    expect(p.inventory.length).toBe(0);
  });
});

describe('배송 — 오프라인·빈 원장은 완전 no-op', () => {
  it('⑨ fetchGrants 가 null 이면 아무것도 하지 않는다', async () => {
    const p = defaultProfile();
    const h = harness(p, { rows: null });
    const r = await deliverCommissionGrants(p, h.deps);
    expect(r).toEqual({ delivered: 0, marked: 0, held: 0, unresolved: 0, skipped: 0 });
    expect(p.inventory.length).toBe(0);
    expect(h.marks).toEqual([]);
  });

  it('fetchGrants 가 throw 해도 던지지 않는다 (이 경로의 예외 = 물건이 영영 안 옴)', async () => {
    const p = defaultProfile();
    const r = await deliverCommissionGrants(p, {
      fetchGrants: async () => {
        throw new Error('network down');
      },
      saveProfile: () => undefined,
      pushProfile: async () => true,
      repullProfile: async (x) => x,
      markApplied: async () => true,
    });
    expect(r.delivered).toBe(0);
  });

  it('이미 applied_at 이 찍힌 행은 다시 처리하지 않는다', async () => {
    const p = defaultProfile();
    const h = harness(p, { rows: [grantRow({ appliedAtMs: 1_700_000_100_000 })] });
    const r = await deliverCommissionGrants(p, h.deps);
    expect(r).toEqual({ delivered: 0, marked: 0, held: 0, unresolved: 0, skipped: 0 });
  });
});

describe('결정론 — 같은 grant_id 는 항상 같은 아이템이다 (ADR-0005 규율)', () => {
  it('두 번 배송하면 어픽스까지 바이트 동일하다', async () => {
    const a = defaultProfile();
    await deliverCommissionGrants(a, harness(a).deps);
    const b = defaultProfile();
    await deliverCommissionGrants(b, harness(b).deps);
    // 통과하면서도 참일 수 있는 나쁜 상태: 둘 다 어픽스가 빈 배열이라 우연히 같은 것.
    const ia = findDelivered(a);
    const ib = findDelivered(b);
    expect(ia?.affixes.length).toBeGreaterThan(0);
    expect(JSON.stringify(ia)).toBe(JSON.stringify(ib));
  });

  it('아이템 id 는 다른 출처와 충돌하지 않는 네임스페이스를 쓴다', () => {
    const id = commissionGrantItemId(GRANT_ID);
    expect(id.startsWith('commission:')).toBe(true);
    // 드랍/정련은 `it-${seed}`(roll.ts:109), 약탈품은 `-loot-` 를 쓴다.
    expect(id.startsWith('it-')).toBe(false);
    expect(id).not.toContain('-loot-');
  });
});

describe('배선 게이트 — main.ts 가 실제로 배송을 부른다 (소스 대조)', () => {
  // 이 파일의 다른 테스트는 전부 `deliverCommissionGrants` 를 직접 부른다 — 즉 `main.ts` 가
  // 안 불러도 전부 초록이다. 이 결함의 원형이 정확히 그 상태였다(`res.grants` 를 받아 놓고
  // 아무 데도 안 썼다).
  const MAIN = readFileSync('src/main.ts', 'utf8');
  const VERIFIED_BODY =
    /async function submitCommissionReplay\([\s\S]*?\n {2}\}/.exec(MAIN)?.[0] ?? '';

  it('verified 분기가 res.grants 를 소비한다', () => {
    expect(VERIFIED_BODY.length).toBeGreaterThan(200);
    // ⚠️ 파일 전체에 정규식을 돌리면 주석 텍스트만으로 만족된다 — 본문 추출분에서 본다.
    expect(VERIFIED_BODY).toMatch(/res\.grants\.length > 0/);
    expect(VERIFIED_BODY).toContain('runCommissionGrantDelivery()');
  });

  it('부팅 경로에서도 미배송 회수를 부른다 (제출 직후 죽어도 유실 0)', () => {
    // 부팅 호출이 없으면 오프라인·크래시 직후의 물건이 영영 안 온다.
    const calls = MAIN.match(/void runCommissionGrantDelivery\(\);/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('배송 루틴이 표시 전에 push 와 재-pull 을 거친다 (순서 계약)', () => {
    const body =
      /async function runCommissionGrantDelivery\([\s\S]*?\n {2}\}/.exec(MAIN)?.[0] ?? '';
    expect(body.length).toBeGreaterThan(200);
    expect(body).toContain('pushProfileToServer');
    expect(body).toContain('pullServerProfileInto');
    expect(body).toContain('markCommissionGrantAppliedOnline');
  });
});
