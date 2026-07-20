/**
 * 배치전(AC4) 클라 로직 테스트 (M4 Phase E1).
 *
 * 커버리지:
 *   1) net/invasion 배치전 순수 파생(normalizePlacementStatus·placementPhase·remaining·label).
 *   2) net 공개 함수 no-op(config=null)·게이트웨이 미구현·fake 게이트웨이 경로.
 *   3) controlTower 배치전 순수 표시(computePlacementInvadeState·placementTargetName).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setLocale } from '../src/i18n/index.js';
import {
  maintenanceToCenti,
  normalizePlacementStatus,
  placementPhase,
  placementRemaining,
  placementProgressLabel,
  fetchPlacementTargets,
  fetchPlacementStatus,
  applyPlacementResult,
  PLACEMENT_TOTAL,
  type InvasionGateway,
  type InvasionTarget,
  type PlacementStatus,
  type PlacementResult,
} from '../src/net/invasion.js';
import {
  computePlacementInvadeState,
  placementTargetName,
} from '../src/ui/controlTower.js';
import { SEED_BASES } from '../data/seedBases.js';
import { emptyInvasionLayers, SAMPLE_REF } from '../src/sim/invasion/normalize.js';
import type { InvasionLayers } from '../src/sim/invasion/types.js';

// computePlacementInvadeState 등이 한국어 표시 문자열을 돌려주므로 로케일을 ko 로 고정한다.
beforeEach(() => setLocale('ko'));
afterEach(() => setLocale('en'));

/** 유효한 3레이어 배치(웨이브 슬롯 1칸만 채운 최소 정규형). */
function validLayers(): InvasionLayers {
  const l = emptyInvasionLayers();
  l.l1.waveSlots[0] = { ...SAMPLE_REF };
  return l;
}
const VALID_LAYOUT: InvasionLayers = validLayers();

function pt(over: Partial<InvasionTarget> = {}): InvasionTarget {
  return {
    profileId: SEED_BASES[0]!.profileId,
    rank: 20,
    displayName: '무명 파일럿',
    shipSummary: { name: '표적기', level: 4 },
    defenseId: 'd-1',
    layout: VALID_LAYOUT,
    maintenance: 100,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 순수 파생
// ---------------------------------------------------------------------------
describe('placement — 순수 파생', () => {
  it('normalizePlacementStatus 는 음수·초과·비정수를 클램프', () => {
    expect(normalizePlacementStatus({ completed: -3, won: -1, total: 5, placed: false })).toEqual({
      completed: 0,
      won: 0,
      total: 5,
      placed: false,
    });
    expect(normalizePlacementStatus({ completed: 99, won: 99, total: 5, placed: false })).toEqual({
      completed: 5,
      won: 5,
      total: 5,
      placed: false,
    });
    // won 은 completed 를 넘지 못한다.
    expect(normalizePlacementStatus({ completed: 3, won: 9, total: 5, placed: false }).won).toBe(3);
    // total 이 비정상이면 기본값 5.
    expect(normalizePlacementStatus({ completed: 2, won: 1, total: 0, placed: false }).total).toBe(PLACEMENT_TOTAL);
  });

  it('placementPhase 는 placement/completing/ranked 구분', () => {
    expect(placementPhase({ completed: 0, won: 0, total: 5, placed: false })).toBe('placement');
    expect(placementPhase({ completed: 3, won: 2, total: 5, placed: false })).toBe('placement');
    expect(placementPhase({ completed: 5, won: 3, total: 5, placed: false })).toBe('completing');
    expect(placementPhase({ completed: 5, won: 3, total: 5, placed: true })).toBe('ranked');
    // placed 면 completed 와 무관하게 ranked.
    expect(placementPhase({ completed: 1, won: 0, total: 5, placed: true })).toBe('ranked');
  });

  it('placementRemaining 은 0 밑으로 안 내려감', () => {
    expect(placementRemaining({ completed: 2, won: 1, total: 5, placed: false })).toBe(3);
    expect(placementRemaining({ completed: 5, won: 5, total: 5, placed: false })).toBe(0);
    expect(placementRemaining({ completed: 9, won: 0, total: 5, placed: false })).toBe(0);
  });

  it('placementProgressLabel 은 "배치전 N / M"', () => {
    expect(placementProgressLabel({ completed: 3, won: 2, total: 5, placed: false })).toBe('배치전 3 / 5');
  });
});

// ---------------------------------------------------------------------------
// 정비도 → 침공 config 변환 (서버 EF 와 공식 일치 계약)
// ---------------------------------------------------------------------------
describe('maintenanceToCenti — DB 0~100 → sim centi-percent', () => {
  it('공식 Math.round(db*100) — 서버 EF 와 동일해야 해시 발산 없음', () => {
    expect(maintenanceToCenti(100)).toBe(10000);
    expect(maintenanceToCenti(0)).toBe(0);
    expect(maintenanceToCenti(65)).toBe(6500);
    // numeric(5,2) 소수 — 반올림 정합(65.55 → 6555, 65.554 → 6555).
    expect(maintenanceToCenti(65.55)).toBe(Math.round(65.55 * 100));
    expect(maintenanceToCenti(99.99)).toBe(9999);
  });

  it('미지정/비유한은 undefined(→ sim 이 완전 정비로 정규화, 기존 런 해시 불변)', () => {
    expect(maintenanceToCenti(undefined)).toBeUndefined();
    expect(maintenanceToCenti(Number.NaN)).toBeUndefined();
    expect(maintenanceToCenti(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// net 공개 함수 — no-op / 미구현 / fake
// ---------------------------------------------------------------------------

/** 배치전 메서드를 구현한 fake 게이트웨이(선택 메서드 포함). */
class FakePlacementGateway implements InvasionGateway {
  fail = false;
  targets: InvasionTarget[] = [pt()];
  status: PlacementStatus = { completed: 2, won: 1, total: 5, placed: false };
  result: PlacementResult = { placed: true, rank: 18, matchesWon: 3, note: 'ok' };

  async getUserId(): Promise<string> {
    return 'attacker';
  }
  async getInvasionTargets(): Promise<InvasionTarget[]> {
    return [];
  }
  async fetchLadder(): Promise<never[]> {
    return [];
  }
  async submitInvasion(): Promise<never> {
    throw new Error('unused');
  }
  async getPlacementTargets(): Promise<InvasionTarget[]> {
    if (this.fail) throw new Error('offline');
    return this.targets;
  }
  async getPlacementStatus(): Promise<PlacementStatus> {
    if (this.fail) throw new Error('offline');
    return this.status;
  }
  async applyPlacementResult(): Promise<PlacementResult> {
    if (this.fail) throw new Error('offline');
    return this.result;
  }
}

/** 배치전 선택 메서드를 구현하지 않은 구버전 게이트웨이. */
class BareGateway implements InvasionGateway {
  async getUserId(): Promise<string> {
    return 'x';
  }
  async getInvasionTargets(): Promise<never[]> {
    return [];
  }
  async fetchLadder(): Promise<never[]> {
    return [];
  }
  async submitInvasion(): Promise<never> {
    throw new Error('unused');
  }
}

describe('placement — net 공개 함수', () => {
  it('config=null 이면 모두 null(no-op)', async () => {
    expect(await fetchPlacementTargets({ config: null })).toBeNull();
    expect(await fetchPlacementStatus({ config: null })).toBeNull();
    expect(await applyPlacementResult({ config: null })).toBeNull();
  });

  it('게이트웨이가 배치전 메서드를 미구현하면 null', async () => {
    const gateway = new BareGateway();
    expect(await fetchPlacementTargets({ gateway })).toBeNull();
    expect(await fetchPlacementStatus({ gateway })).toBeNull();
    expect(await applyPlacementResult({ gateway })).toBeNull();
  });

  it('fake 게이트웨이로 타깃/상태/결과 조회', async () => {
    const gateway = new FakePlacementGateway();
    const targets = await fetchPlacementTargets({ gateway });
    expect(targets).toHaveLength(1);
    const status = await fetchPlacementStatus({ gateway });
    expect(status).toEqual({ completed: 2, won: 1, total: 5, placed: false });
    const result = await applyPlacementResult({ gateway });
    expect(result).toEqual({ placed: true, rank: 18, matchesWon: 3, note: 'ok' });
  });

  it('상태 조회는 서버 값을 정규화한다(초과 클램프)', async () => {
    const gateway = new FakePlacementGateway();
    gateway.status = { completed: 8, won: 20, total: 5, placed: false };
    const status = await fetchPlacementStatus({ gateway });
    expect(status).toEqual({ completed: 5, won: 5, total: 5, placed: false });
  });

  it('오류는 null 로 흡수(throw 안 함)', async () => {
    const gateway = new FakePlacementGateway();
    gateway.fail = true;
    expect(await fetchPlacementTargets({ gateway })).toBeNull();
    expect(await fetchPlacementStatus({ gateway })).toBeNull();
    expect(await applyPlacementResult({ gateway })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// controlTower 배치전 표시 순수
// ---------------------------------------------------------------------------
describe('placement — controlTower 표시 순수', () => {
  it('computePlacementInvadeState 는 쿨다운 무시(layout 만 검사)', () => {
    const st = computePlacementInvadeState(pt());
    expect(st.canInvade).toBe(true);
    expect(st.layout).not.toBeNull();
  });

  it('layout 이 손상이면 침공 불가', () => {
    const st = computePlacementInvadeState(pt({ layout: { nope: true } }));
    expect(st.canInvade).toBe(false);
    expect(st.reason).toBe('방어 기지 없음');
    expect(st.layout).toBeNull();
  });

  it('placementTargetName 은 서버 이름 우선, 없으면 시드 메타 이름', () => {
    // 서버가 실이름을 주면 그대로.
    expect(placementTargetName(pt({ displayName: '적기지 X' }))).toBe('적기지 X');
    // 서버 이름이 없거나 '무명 파일럿'이면 seedBases 메타 이름으로 대체.
    const meta = SEED_BASES[0]!;
    expect(placementTargetName(pt({ displayName: '무명 파일럿', profileId: meta.profileId }))).toBe(meta.name);
    expect(placementTargetName(pt({ displayName: '', profileId: meta.profileId }))).toBe(meta.name);
  });
});
