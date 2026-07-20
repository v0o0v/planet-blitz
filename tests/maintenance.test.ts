/**
 * 풍화·정비(E3) 클라 로직 테스트 (M4 Phase E3, ADR-0006/0007, AC5).
 *
 * 커버리지:
 *   1) 순수 파생: maintenanceWarningLevel·forecastMaintenance·weatheringForecastText·
 *      repairButtonState.
 *   2) net 공개 함수: fetchDefenseStatus·repairDefense no-op(config=null)·게이트웨이 미구현·
 *      fake 게이트웨이(성공/거부).
 */

import { describe, it, expect } from 'vitest';
import {
  WEATHERING_DECAY_PER_WEEK,
  maintenanceWarningLevel,
  forecastMaintenance,
  weatheringForecastText,
  repairButtonState,
  fetchDefenseStatus,
  repairDefense,
  type DefenseGateway,
  type DefenseStatus,
  type RepairResult,
} from '../src/net/defenseSync.js';
import type { InvasionLayers } from '../src/sim/invasion/types.js';
import {
  stashPendingProfile,
  readPendingProfile,
  refreshPendingProfile,
  shouldPushPending,
} from '../src/net/profileSync.js';
import { defaultProfile, type KeyValueStore } from '../src/save/profile.js';

/** In-memory KeyValueStore(net.test.ts 와 동일). */
function memStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('maintenance — 순수 파생', () => {
  it('경고 수준: >=70 ok, 40~69 warn, <40 critical', () => {
    expect(maintenanceWarningLevel(100)).toBe('ok');
    expect(maintenanceWarningLevel(70)).toBe('ok');
    expect(maintenanceWarningLevel(69)).toBe('warn');
    expect(maintenanceWarningLevel(40)).toBe('warn');
    expect(maintenanceWarningLevel(39)).toBe('critical');
    expect(maintenanceWarningLevel(0)).toBe('critical');
  });

  it('forecastMaintenance 는 주 -5%p, 0 밑으로 안 내려감', () => {
    expect(WEATHERING_DECAY_PER_WEEK).toBe(5);
    expect(forecastMaintenance(100)).toBe(95);
    expect(forecastMaintenance(3)).toBe(0);
    expect(forecastMaintenance(0)).toBe(0);
    // 100 초과·비정상은 클램프.
    expect(forecastMaintenance(200)).toBe(95);
  });

  it('weatheringForecastText 는 상황별 문구(0%·임박·정상)', () => {
    expect(weatheringForecastText(0)).toContain('50%');
    expect(weatheringForecastText(3)).toContain('임박');
    const normal = weatheringForecastText(80);
    expect(normal).toContain('75%');
    expect(normal).toContain('-5%p');
  });

  it('repairButtonState: 만점·크레딧부족·가능', () => {
    // 이미 100%.
    expect(repairButtonState(100, 999, 0)).toEqual({ canRepair: false, reason: '정비도 100% — 정비 불필요' });
    // 크레딧 부족(비용 250, 잔액 100).
    const poor = repairButtonState(50, 100, 250);
    expect(poor.canRepair).toBe(false);
    expect(poor.reason).toContain('250');
    // 가능.
    expect(repairButtonState(50, 999, 250)).toEqual({ canRepair: true, reason: '' });
  });
});

// ---------------------------------------------------------------------------
// net 공개 함수
// ---------------------------------------------------------------------------

/** 정비 메서드를 구현한 fake 방어 게이트웨이. */
class FakeDefenseGateway implements DefenseGateway {
  fail = false;
  status: DefenseStatus = { maintenance: 65, credits: 500, repairCost: 175 };
  repairResult: RepairResult = { credits: 325, maintenance: 100 };
  repairThrows = false;

  async getUserId(): Promise<string> {
    return 'me';
  }
  async fetchActiveDefenseId(): Promise<string | null> {
    return 'd-1';
  }
  async insertDefense(): Promise<void> {}
  async updateDefense(): Promise<void> {}
  async fetchDefenseStatus(): Promise<DefenseStatus> {
    if (this.fail) throw new Error('offline');
    return this.status;
  }
  async repairDefense(): Promise<RepairResult> {
    if (this.fail || this.repairThrows) throw new Error('insufficient-credits');
    return this.repairResult;
  }
}

/** 정비 메서드를 미구현한 구버전 방어 게이트웨이. */
class BareDefenseGateway implements DefenseGateway {
  async getUserId(): Promise<string> {
    return 'me';
  }
  async fetchActiveDefenseId(): Promise<string | null> {
    return null;
  }
  async insertDefense(): Promise<void> {}
  async updateDefense(_id: string, _layout: InvasionLayers): Promise<void> {}
}

describe('maintenance — net 공개 함수', () => {
  it('config=null 이면 null(no-op)', async () => {
    expect(await fetchDefenseStatus({ config: null })).toBeNull();
    expect(await repairDefense({ config: null })).toBeNull();
  });

  it('게이트웨이가 정비 메서드를 미구현하면 null', async () => {
    const gateway = new BareDefenseGateway();
    expect(await fetchDefenseStatus({ gateway })).toBeNull();
    expect(await repairDefense({ gateway })).toBeNull();
  });

  it('fake 게이트웨이로 상태 조회·정비 성공', async () => {
    const gateway = new FakeDefenseGateway();
    expect(await fetchDefenseStatus({ gateway })).toEqual({ maintenance: 65, credits: 500, repairCost: 175 });
    expect(await repairDefense({ gateway })).toEqual({ credits: 325, maintenance: 100 });
  });

  it('정비 거부(크레딧 부족 등)는 null 로 흡수', async () => {
    const gateway = new FakeDefenseGateway();
    gateway.repairThrows = true;
    expect(await repairDefense({ gateway })).toBeNull();
  });

  it('오프라인 오류는 null 로 흡수', async () => {
    const gateway = new FakeDefenseGateway();
    gateway.fail = true;
    expect(await fetchDefenseStatus({ gateway })).toBeNull();
    expect(await repairDefense({ gateway })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 정비 이중 권위 방어 (Phase E 리뷰 MED — stale-high 크레딧 되밀기 차단)
// ---------------------------------------------------------------------------
describe('maintenance — 정비 후 pending 스냅샷 교체(refreshPendingProfile)', () => {
  it('정비 전 stale-high pending 은 push 게이트를 통과한다(위험 실존 증명) → 교체로 차단', () => {
    const store = memStore();
    // 정비 전 스냅샷(크레딧 1000)이 대기 슬롯에 잔존(PvE 정산 미전송 상황).
    const preRepair = defaultProfile();
    preRepair.credits = 1000;
    stashPendingProfile(store, preRepair);
    // 서버는 정비로 차감된 상태(850).
    const serverAfterRepair = defaultProfile();
    serverAfterRepair.credits = 850;
    // progressScore 가 credits 를 포함해 stale-high 스냅샷이 게이트를 통과한다 —
    // 방치하면 다음 flush 가 서버 차감을 1000 으로 되돌린다(위험 시나리오 실존).
    expect(shouldPushPending(preRepair, serverAfterRepair)).toBe(true);

    // 방어: 정비 성공 직후 대기 슬롯을 정비 후 프로필(850)로 교체한다.
    const corrected = defaultProfile();
    corrected.credits = 850;
    expect(refreshPendingProfile(store, corrected)).toBe(true);
    expect(readPendingProfile(store)?.credits).toBe(850);
  });

  it('pending 이 없으면 교체하지 않는다(새 push 를 만들지 않음)', () => {
    const store = memStore();
    const profile = defaultProfile();
    profile.credits = 850;
    expect(refreshPendingProfile(store, profile)).toBe(false);
    expect(readPendingProfile(store)).toBeNull();
  });
});
