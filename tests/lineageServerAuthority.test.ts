/**
 * 계보 서버 권위 배선 검증 (ADR-0007 · 2026-08-03).
 *
 * ## 여기서 잠그는 것은 "순서"다
 * 계보는 리스펙이 없고(R2) 소멸은 되돌릴 수 없다. 그래서 이 레인의 계약은 값이 아니라 **순서**다:
 * 서버가 확정하기 전에는 로컬이 한 글자도 움직이지 않아야 한다. 낙관적 반영을 한 줄 넣어도
 * 화면은 멀쩡히 돌고 테스트도(값만 보면) 통과하므로, 실패 경로에서 **Profile 이 불변인지**를
 * 직접 본다.
 *
 * 게이트웨이는 fake 를 주입한다 — 이 파일은 네트워크도 SDK 도 건드리지 않는다.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  dismissGuardianOnServer,
  investLineageOnServer,
  isLineageOnline,
  pullLineageState,
  resetLineageGateway,
  retireShipOnServer,
  setLineageGatewayFactory,
  setLineageGatewayOverride,
  type LineageGateway,
} from '../src/net/lineage.js';
import {
  applyServerInvest,
  applyServerLineageState,
  serverGuardianToRecord,
  serverLineageToState,
} from '../src/net/lineageMirror.js';
import { deserializeProfile } from '../src/net/profileSync.js';
import { branchInvestedPoints, derivedSpent, emptyLineage } from '../data/lineage.js';
import { activeShip, defaultProfile, type Profile } from '../src/save/profile.js';
import { applyChampionChoiceOnline } from '../src/ui/pixi/championSelect.js';
import { LEVEL_CAP } from '../data/waves.js';
import type { GuardianSnapshot } from '../data/guardian.js';

const SNAPSHOT = {} as unknown as GuardianSnapshot;

/** 전부 성공하는 fake. 각 호출을 기록해 "몇 번 불렀는가"까지 본다. */
function okGateway(over: Partial<LineageGateway> = {}): LineageGateway & { calls: string[] } {
  const calls: string[] = [];
  const base: LineageGateway = {
    getUserId: async () => {
      calls.push('uid');
      return 'u1';
    },
    fetchGuardians: async () => {
      calls.push('guardians');
      return [];
    },
    fetchLineage: async () => {
      calls.push('lineage');
      return { available: 100, shipLevel: 2, guardianLevel: 3 };
    },
    retireShip: async () => {
      calls.push('retire');
      return { guardianId: 'srv-uuid-1', granted: 50 };
    },
    dismissGuardian: async () => {
      calls.push('dismiss');
      return 37;
    },
    investLineage: async () => {
      calls.push('invest');
      return { level: 3, points: 60 };
    },
  };
  return Object.assign(base, over, { calls });
}

/** 전부 throw 하는 fake — 오프라인·거부를 흉내낸다. */
function failingGateway(): LineageGateway {
  const boom = async (): Promise<never> => {
    throw new Error('offline');
  };
  return {
    getUserId: boom,
    fetchGuardians: boom,
    fetchLineage: boom,
    retireShip: boom,
    dismissGuardian: boom,
    investLineage: boom,
  };
}

afterEach(() => {
  resetLineageGateway();
});

describe('게이트웨이 해석 — 미설정은 no-op 이지 예외가 아니다', () => {
  it('팩토리·대체·설정이 없으면 오프라인이고 모든 호출이 null 이다', async () => {
    expect(isLineageOnline({ config: null })).toBe(false);
    expect(await investLineageOnServer('ship', { config: null })).toBeNull();
    expect(await dismissGuardianOnServer('g1', { config: null })).toBeNull();
    expect(await pullLineageState({ config: null })).toBeNull();
    expect(await retireShipOnServer(0, 1, SNAPSHOT, undefined, { config: null })).toBeNull();
  });

  it('설정이 있어도 팩토리가 없으면 오프라인이다(SDK 미탑재 안전 기본값)', () => {
    expect(isLineageOnline({ config: { url: 'https://x', anonKey: 'k' } })).toBe(false);
  });

  it('팩토리를 등록하면 온라인이 되고 설정으로 1회만 만든다(캐시)', () => {
    let made = 0;
    setLineageGatewayFactory(() => {
      made++;
      return okGateway();
    });
    const config = { url: 'https://x', anonKey: 'k' };
    expect(isLineageOnline({ config })).toBe(true);
    expect(isLineageOnline({ config })).toBe(true);
    expect(made).toBe(1);
  });

  it('override 는 설정보다 먼저 이긴다(하네스 경로)', () => {
    setLineageGatewayOverride(okGateway());
    expect(isLineageOnline({ config: null })).toBe(true);
    setLineageGatewayOverride(null);
    expect(isLineageOnline({ config: null })).toBe(false);
  });

  /** 공개 함수가 throw 하면 화면이 통째로 죽는다 — 실패는 반드시 null 로 내려와야 한다. */
  it('게이트웨이가 throw 해도 공개 함수는 throw 하지 않고 null 을 낸다', async () => {
    const gateway = failingGateway();
    await expect(investLineageOnServer('ship', { gateway })).resolves.toBeNull();
    await expect(dismissGuardianOnServer('g1', { gateway })).resolves.toBeNull();
    await expect(pullLineageState({ gateway })).resolves.toBeNull();
    await expect(retireShipOnServer(0, 1, SNAPSHOT, undefined, { gateway })).resolves.toBeNull();
  });

  /**
   * 계보 상태와 수호 목록을 **따로** 부르면 그 사이에 다른 기기의 소멸이 끼어들어 "포인트는
   * 늘었는데 목록은 그대로"인 화면이 나온다. 한 번의 uid 해석으로 둘을 함께 당기는지 본다.
   */
  it('pull 은 uid 를 한 번만 풀고 계보·수호를 함께 가져온다', async () => {
    const gateway = okGateway();
    const state = await pullLineageState({ gateway });
    expect(state).not.toBeNull();
    expect(gateway.calls.filter((c) => c === 'uid')).toHaveLength(1);
    expect(gateway.calls).toContain('lineage');
    expect(gateway.calls).toContain('guardians');
  });

  /** 한쪽만 실패해도 반쪽 미러를 만들면 안 된다 — 통째로 null 이어야 한다. */
  it('수호 조회만 실패해도 pull 전체가 null 이다(반쪽 미러 금지)', async () => {
    const gateway = okGateway({
      fetchGuardians: async () => {
        throw new Error('boom');
      },
    });
    expect(await pullLineageState({ gateway })).toBeNull();
  });
});

describe('서버 정본 → 로컬 미러', () => {
  it('spent 는 서버 컬럼이 없어 레벨에서 파생한다', () => {
    const st = serverLineageToState({ available: 10, shipLevel: 4, guardianLevel: 7 });
    expect(st.available).toBe(10);
    expect(st.shipLevel).toBe(4);
    expect(st.guardianLevel).toBe(7);
    expect(st.spent).toBe(branchInvestedPoints(4) + branchInvestedPoints(7));
    expect(st.spent).toBe(derivedSpent(4, 7));
  });

  it('음수·비유한 서버 값은 0 으로 잘라 Profile 불변식을 지킨다', () => {
    const st = serverLineageToState({ available: -5, shipLevel: Number.NaN, guardianLevel: 2.9 });
    expect(st.available).toBe(0);
    expect(st.shipLevel).toBe(0);
    expect(st.guardianLevel).toBe(2);
  });

  /**
   * **id 는 서버 uuid 여야 한다.** 로컬 id 를 쓰면 그 수호기는 소멸 RPC 가 가리킬 수 없어
   * 영영 소멸시킬 수 없는 유령이 된다 — 이번 레인이 없애려는 상태가 바로 그것이다.
   */
  it('서버 수호 행의 uuid 를 로컬 레코드 id 로 그대로 채택한다', () => {
    const rec = serverGuardianToRecord({
      id: 'uuid-abc',
      snapshot: SNAPSHOT,
      performanceCP: 8000,
      combatScore: 120,
      preset: 1,
      retired: false,
    });
    expect(rec.id).toBe('uuid-abc');
    expect(rec.build).toBeUndefined();
  });

  /** 병합이 아니라 **교체**다 — 서버에 없는 로컬 레코드가 살아남으면 안 된다(파일 헤더). */
  it('수호 목록은 병합이 아니라 통째로 교체된다', () => {
    const profile = defaultProfile();
    profile.guardians = [
      { id: 'g-local-1', snapshot: SNAPSHOT, performanceCP: 10000, combatScore: 1, preset: 0, retired: false },
    ];
    applyServerLineageState(profile, {
      lineage: { available: 5, shipLevel: 0, guardianLevel: 0 },
      guardians: [
        { id: 'uuid-1', snapshot: SNAPSHOT, performanceCP: 9000, combatScore: 2, preset: 0, retired: false },
      ],
    });
    expect(profile.guardians.map((g) => g.id)).toEqual(['uuid-1']);
  });

  /**
   * 투자 결과는 서버가 준 잔액을 **그대로** 쓴다. 클라가 자기 비용 곡선으로 다시 빼면 같은
   * 비용이 두 번 적용된다(로컬만 더 가난해진다).
   */
  it('투자 반영은 서버 잔액을 그대로 쓰고 다른 가지를 건드리지 않는다', () => {
    const profile = defaultProfile();
    profile.lineage = { ...emptyLineage(), shipLevel: 1, guardianLevel: 5, available: 500 };
    applyServerInvest(profile, 'ship', { level: 2, points: 450 });
    expect(profile.lineage.shipLevel).toBe(2);
    expect(profile.lineage.guardianLevel).toBe(5);
    expect(profile.lineage.available).toBe(450);
    expect(profile.lineage.spent).toBe(derivedSpent(2, 5));
  });
});

/**
 * 이 레인의 **핵심 계약**: 서버가 확정하기 전에는 로컬이 움직이지 않는다.
 *
 * 낙관적 반영은 값만 보는 테스트를 전부 통과하면서도 되돌릴 수 없는 손실을 만든다(수호기는
 * 사라졌는데 서버에는 행이 없는 상태). 그래서 실패 경로에서 Profile 을 **통째로 스냅샷 비교**한다.
 */
describe('퇴역 — 서버 확정 전에는 로컬이 움직이지 않는다', () => {
  function maxedProfile(): Profile {
    const p = defaultProfile();
    activeShip(p).level = LEVEL_CAP;
    return p;
  }

  it('오프라인이면 null 이고 Profile 이 한 글자도 안 바뀐다', async () => {
    const profile = maxedProfile();
    const before = JSON.stringify(profile);
    expect(await applyChampionChoiceOnline(profile, 2, null)).toBeNull();
    expect(JSON.stringify(profile)).toBe(before);
  });

  it('서버가 거부하면(RPC throw) 역시 Profile 이 그대로다', async () => {
    setLineageGatewayOverride(failingGateway());
    const profile = maxedProfile();
    const before = JSON.stringify(profile);
    expect(await applyChampionChoiceOnline(profile, 2, null)).toBeNull();
    expect(JSON.stringify(profile)).toBe(before);
  });

  it('만렙 게이트에 걸리면 서버를 부르지도 않는다(헛된 수호 행 생성 금지)', async () => {
    const gateway = okGateway();
    setLineageGatewayOverride(gateway);
    const profile = defaultProfile(); // 만렙 아님
    const before = JSON.stringify(profile);
    expect(await applyChampionChoiceOnline(profile, 1, null)).toBeNull();
    expect(JSON.stringify(profile)).toBe(before);
    expect(gateway.calls).not.toContain('retire');
  });

  /**
   * 성공 경로의 핵심은 **id 채택**이다. 로컬 생성 id 가 남으면 그 수호기는 소멸 RPC 로 가리킬 수
   * 없어 영영 소멸시킬 수 없다.
   */
  it('성공하면 서버 uuid 를 수호 레코드 id 로 채택하고 계보는 서버 정본으로 맞춘다', async () => {
    const gateway = okGateway({
      // pull 이 돌려주는 정본 — 로컬 +50 지급이 아니라 이 값이 남아야 한다.
      fetchLineage: async () => ({ available: 250, shipLevel: 0, guardianLevel: 0 }),
      fetchGuardians: async () => [
        {
          id: 'srv-uuid-1',
          snapshot: SNAPSHOT,
          performanceCP: 10000,
          combatScore: 5,
          preset: 0,
          retired: false,
        },
      ],
    });
    setLineageGatewayOverride(gateway);
    const profile = maxedProfile();
    const applied = await applyChampionChoiceOnline(profile, 2, null);
    expect(applied).toBe(2);
    expect(profile.guardians.map((g) => g.id)).toEqual(['srv-uuid-1']);
    expect(profile.lineage.available).toBe(250);
    expect(gateway.calls).toContain('retire');
  });
});

describe('프로필 pull — 계보 컬럼', () => {
  function serverRow(lineage?: { available: number; shipLevel: number; guardianLevel: number }) {
    const local: Profile = defaultProfile();
    local.lineage = { shipLevel: 9, guardianLevel: 9, available: 999, spent: 12345 };
    return { save: local, saveVersion: local.saveVersion, ...(lineage !== undefined ? { lineage } : {}) };
  }

  it('컬럼이 오면 save jsonb 의 낡은 계보를 덮고 spent 를 다시 파생한다', () => {
    const p = deserializeProfile(serverRow({ available: 7, shipLevel: 1, guardianLevel: 2 }));
    expect(p.lineage.available).toBe(7);
    expect(p.lineage.shipLevel).toBe(1);
    expect(p.lineage.guardianLevel).toBe(2);
    // 로컬에 있던 spent 12345 는 남지 않는다.
    expect(p.lineage.spent).toBe(derivedSpent(1, 2));
  });

  it('구 서버(컬럼 부재)면 save 의 계보를 그대로 둔다(하위호환)', () => {
    const p = deserializeProfile(serverRow());
    expect(p.lineage.available).toBe(999);
    expect(p.lineage.spent).toBe(12345);
  });
});
