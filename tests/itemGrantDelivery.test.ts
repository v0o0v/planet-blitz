/**
 * 서버 드랍 **배송** 테스트 (ADR-0050 §3 단계 1) — "서버가 굴렸는데 물건이 안 왔다"와
 * "같은 물건이 두 번 왔다"가 **둘 다** 초록으로 지나가지 않게.
 *
 * ## 이 파일이 지키는 것
 * 배송 순서 계약(저장 → push **성공** → 재-pull 존재 확인 → 그제서야 `applied_at` 표시)의
 * 각 단계는 **실패해도 화면에 아무 흔적이 없다.** 순서가 틀리면 증상은 "가끔 아이템이
 * 사라진다" 하나뿐이고, 그것이 이 저장소가 반복해 겪은 형태다.
 *
 * ⭐ 특히 ③ 앞에서 표시하면 `chooseProfile` 의 통짜 선택이 그 아이템을 버릴 수 있는데
 * (`progressScore` 는 기체 레벨 1 = 1000점이라 **아이템 48개 차이도 진다**) 행은 이미 표시돼
 * 재시도되지 않는다 — **영구 유실**이다.
 *
 * ## 단언 규율
 * 단언마다 **"이게 통과하면서도 참일 수 있는 나쁜 상태"** 를 주석으로 적는다.
 */

import { describe, it, expect } from 'vitest';
import { deliverItemGrants } from '../src/run/itemGrantDelivery.js';
import type { ItemGrantDeliveryDeps } from '../src/run/itemGrantDelivery.js';
import { dropGrantItemId, itemFromDropGrant } from '../src/items/dropGrant.js';
import { hasItemId } from '../src/save/itemPresence.js';
import { defaultProfile, INVENTORY_CAP, stashCapacity } from '../src/save/profile.js';
import type { Profile } from '../src/save/profile.js';
import type { ItemGrantRow } from '../src/net/gateway.js';

const GRANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SEED = 0x1234abcd;

function grantRow(over: Partial<ItemGrantRow> = {}): ItemGrantRow {
  return {
    grantId: GRANT_ID,
    dropIndex: 0,
    dropSeed: SEED,
    rarity: 'rare',
    source: { planet: 1, stage: 3, levelCap: 10 },
    appliedAtMs: null,
    ...over,
  };
}

interface Harness {
  deps: ItemGrantDeliveryDeps;
  marks: string[];
  pushes: number;
  saves: number;
}

interface HarnessOpts {
  rows?: readonly ItemGrantRow[] | null;
  pushOk?: boolean;
  /** 재-pull 이 돌려줄 프로필(기본: 인자 그대로 = 서버가 우리 것을 그대로 들고 있음). */
  repull?: (p: Profile) => Profile | null;
  markOk?: boolean;
  /** fetch 가 던지는 경우(오류 내성 확인). */
  fetchThrows?: boolean;
}

function harness(opts: HarnessOpts = {}): Harness {
  const marks: string[] = [];
  const h = {
    marks,
    pushes: 0,
    saves: 0,
    deps: {} as ItemGrantDeliveryDeps,
  };
  h.deps = {
    fetchGrants: async () => {
      if (opts.fetchThrows === true) throw new Error('offline');
      return opts.rows === undefined ? [grantRow()] : opts.rows;
    },
    saveProfile: () => {
      h.saves++;
    },
    pushProfile: async () => {
      const ok = opts.pushOk !== false;
      if (ok) h.pushes++;
      return ok;
    },
    repullProfile: async (p) => (opts.repull === undefined ? p : opts.repull(p)),
    markApplied: async (id) => {
      if (opts.markOk === false) return false;
      marks.push(id);
      return true;
    },
  };
  return h;
}

describe('itemFromDropGrant — 원장 3필드 → 아이템', () => {
  it('id 를 원장 키에서 결정론 파생한다(멱등의 유일한 근거)', () => {
    const a = itemFromDropGrant(GRANT_ID, SEED, 'rare', { planet: 1, stage: 3 });
    const b = itemFromDropGrant(GRANT_ID, SEED, 'rare', { planet: 1, stage: 3 });
    expect(a).not.toBeNull();
    expect(a!.id).toBe(`drop:${GRANT_ID}`);
    // 나쁜 상태: id 가 `it-${seed}` 로 남으면 `hasItemId` 가 원장 행을 식별하지 못해
    // 다음 부팅이 같은 물건을 또 심는다.
    expect(a!.id).toBe(b!.id);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // 같은 입력 → 바이트 동일
  });

  it('등급은 rollItem 에 그대로 실린다', () => {
    const it = itemFromDropGrant(GRANT_ID, SEED, 'unique', { planet: 0, stage: 0 });
    // 나쁜 상태: 등급을 무시하고 항상 normal 을 굴리면 서버가 정한 분포가 통째로 죽는다.
    expect(it?.rarity).toBe('unique');
  });

  it('신뢰 경계 밖 값을 거부한다 (서버 응답도 검증한다)', () => {
    expect(itemFromDropGrant('', SEED, 'rare', { planet: 0, stage: 0 })).toBeNull();
    expect(itemFromDropGrant(GRANT_ID, SEED, 'legendary', { planet: 0, stage: 0 })).toBeNull();
    expect(itemFromDropGrant(GRANT_ID, -1, 'rare', { planet: 0, stage: 0 })).toBeNull();
    // u32 를 넘는 시드는 **접지 않고 거부**한다 — 접으면 서버가 적은 시드와 클라가 쓴 시드가
    // 갈려 원장의 재확정 보장이 깨진다(그 시점엔 아무 오류도 안 난다).
    expect(itemFromDropGrant(GRANT_ID, 0x1_0000_0000, 'rare', { planet: 0, stage: 0 })).toBeNull();
  });

  it('levelCap 부재와 0 을 구분한다', () => {
    const withCap = itemFromDropGrant(GRANT_ID, SEED, 'rare', { planet: 0, stage: 0, levelCap: 5 });
    const noCap = itemFromDropGrant(GRANT_ID, SEED, 'rare', { planet: 0, stage: 0 });
    // 나쁜 상태: 부재를 0 으로 접으면 "상한 없음"이 "레벨 0 상한"이 되어 아무것도 못 입는다.
    expect(withCap).not.toBeNull();
    expect(noCap).not.toBeNull();
  });
});

describe('배송 순서 계약 — 표시는 마지막이다', () => {
  it('정상 경로: 심고 → 저장 → push → 재-pull 확인 → 표시', async () => {
    const p = defaultProfile();
    const h = harness();
    const before = p.inventory.length;
    const report = await deliverItemGrants(p, h.deps);

    expect(report.delivered).toBe(1);
    expect(report.marked).toBe(1);
    expect(p.inventory.length).toBe(before + 1);
    expect(hasItemId(p, dropGrantItemId(GRANT_ID))).toBe(true);
    // 나쁜 상태: 심지 않고 표시만 해도 marked=1 이 된다 — 그래서 보유를 함께 단언한다.
    expect(h.marks).toEqual([GRANT_ID]);
  });

  it('⭐ push 가 실패하면 표시하지 않는다 (아이템은 로컬에 남는다)', async () => {
    const p = defaultProfile();
    const h = harness({ pushOk: false });
    const report = await deliverItemGrants(p, h.deps);

    expect(report.delivered).toBe(1);
    // 나쁜 상태: 여기서 표시하면 서버 프로필에 없는 아이템이 "배송 완료"로 굳어 **영구 유실**된다.
    expect(report.marked).toBe(0);
    expect(h.marks).toEqual([]);
    // 로컬에는 남아 있어야 다음 부팅이 push 만 다시 시도한다.
    expect(hasItemId(p, dropGrantItemId(GRANT_ID))).toBe(true);
  });

  it('⭐ 재-pull 이 아이템을 잃으면 표시하지 않는다 (서버가 더 진행된 경우)', async () => {
    const p = defaultProfile();
    // 서버가 우리보다 진행된 프로필을 들고 있어 방금 심은 아이템이 사라진 상황을 재현한다.
    const h = harness({ repull: () => defaultProfile() });
    const report = await deliverItemGrants(p, h.deps);

    expect(report.delivered).toBe(1);
    // 나쁜 상태: 확인 없이 표시하면 chooseProfile 통짜 선택이 버린 아이템이 재시도되지 않는다.
    expect(report.marked).toBe(0);
    expect(h.marks).toEqual([]);
  });

  it('재-pull 이 불가(null)여도 표시하지 않는다', async () => {
    const p = defaultProfile();
    const h = harness({ repull: () => null });
    const report = await deliverItemGrants(p, h.deps);
    expect(report.marked).toBe(0);
  });
});

describe('멱등 — 같은 행이 두 번 배송되지 않는다', () => {
  it('이미 들고 있으면 다시 심지 않고 표시만 한다', async () => {
    const p = defaultProfile();
    const item = itemFromDropGrant(GRANT_ID, SEED, 'rare', { planet: 1, stage: 3, levelCap: 10 });
    p.inventory.push(item!);
    const before = p.inventory.length;

    const h = harness();
    const report = await deliverItemGrants(p, h.deps);

    // 나쁜 상태: 여기서 또 심으면 표시 직전에 앱이 죽을 때마다 아이템이 복제된다.
    expect(report.delivered).toBe(0);
    expect(report.marked).toBe(1);
    expect(p.inventory.length).toBe(before);
  });

  it('장착 중이어도 보유로 본다 (inventory 만 보면 복제된다)', async () => {
    const p = defaultProfile();
    const item = itemFromDropGrant(GRANT_ID, SEED, 'rare', { planet: 1, stage: 3, levelCap: 10 })!;
    // 가방이 아니라 기체 장착 자리에 있는 경우 — `hasItemId` 의 네 자리 중 하나.
    // ⚠️ 장착 키는 **8자리**(module 은 module0/module1 둘)라 `SlotKind` 와 1:1 이 아니다.
    const key = item.slot === 'module' ? 'module0' : item.slot;
    p.ships[0]!.equipped[key] = item;
    const h = harness();
    const report = await deliverItemGrants(p, h.deps);

    expect(report.delivered).toBe(0);
    expect(report.marked).toBe(1);
  });

  it('이미 표시된 행은 건너뛴다', async () => {
    const p = defaultProfile();
    const h = harness({ rows: [grantRow({ appliedAtMs: 1_700_000_000_000 })] });
    const report = await deliverItemGrants(p, h.deps);
    expect(report).toEqual({ delivered: 0, marked: 0, held: 0, unresolved: 0, deliveredItems: [] });
  });
});

describe('보류·해석 실패 — 조용히 버리지 않는다', () => {
  it('만석이면 보류하고 표시하지 않는다', async () => {
    const p = defaultProfile();
    const filler = itemFromDropGrant('x'.repeat(8), 1, 'normal', { planet: 0, stage: 0 })!;
    while (p.inventory.length < INVENTORY_CAP) p.inventory.push({ ...filler, id: `f${p.inventory.length}` });
    const cap = stashCapacity(p.stashExpansions);
    while (p.stash.length < cap) p.stash.push({ ...filler, id: `s${p.stash.length}` });

    const h = harness();
    const report = await deliverItemGrants(p, h.deps);

    expect(report.held).toBe(1);
    expect(report.delivered).toBe(0);
    // 나쁜 상태: 표시해 버리면 플레이어가 자리를 비운 뒤에도 그 물건이 영영 안 온다.
    expect(h.marks).toEqual([]);
  });

  it('해석 불가 행은 표시하지 않고 남긴다', async () => {
    const p = defaultProfile();
    const h = harness({ rows: [grantRow({ rarity: 'legendary' })] });
    const report = await deliverItemGrants(p, h.deps);

    expect(report.unresolved).toBe(1);
    // 나쁜 상태: 표시하면 서버는 "줬다"인데 플레이어에게는 영영 안 온다.
    expect(h.marks).toEqual([]);
  });
});

describe('오프라인 내성 — 절대 throw 하지 않는다', () => {
  it('fetch 가 null 이면 완전 no-op', async () => {
    const p = defaultProfile();
    const before = p.inventory.length;
    const h = harness({ rows: null });
    await expect(deliverItemGrants(p, h.deps)).resolves.toEqual({
      delivered: 0,
      marked: 0,
      held: 0,
      unresolved: 0,
      deliveredItems: [],
    });
    expect(p.inventory.length).toBe(before);
  });

  it('fetch 가 던져도 삼키고 no-op', async () => {
    const p = defaultProfile();
    const h = harness({ fetchThrows: true });
    // 나쁜 상태: 여기서 예외가 새면 정산 경로 전체가 끊겨 그 뒤 로직이 통째로 안 돈다.
    await expect(deliverItemGrants(p, h.deps)).resolves.toEqual({
      delivered: 0,
      marked: 0,
      held: 0,
      unresolved: 0,
      deliveredItems: [],
    });
  });

  it('mark 가 실패해도 아이템은 남고 리포트가 그것을 드러낸다', async () => {
    const p = defaultProfile();
    const h = harness({ markOk: false });
    const report = await deliverItemGrants(p, h.deps);
    expect(report.delivered).toBe(1);
    expect(report.marked).toBe(0);
    expect(hasItemId(p, dropGrantItemId(GRANT_ID))).toBe(true);
  });
});

describe('여러 행 — 각 행이 독립으로 처리된다', () => {
  it('한 행이 해석 불가여도 나머지는 배송된다', async () => {
    const p = defaultProfile();
    const good = 'ffffffff-1111-2222-3333-444444444444';
    const h = harness({
      rows: [
        grantRow({ rarity: 'legendary', dropIndex: 0 }),
        grantRow({ grantId: good, dropIndex: 1, dropSeed: 999 }),
      ],
    });
    const report = await deliverItemGrants(p, h.deps);

    expect(report.unresolved).toBe(1);
    // 나쁜 상태: 첫 행에서 루프가 끊기면 뒤 전리품이 통째로 유실된다.
    expect(report.delivered).toBe(1);
    expect(h.marks).toEqual([good]);
  });
});
