/**
 * NPC 시드 기지 표시 메타 테스트 (data/seedBases.ts — M4 Phase E2, AC4).
 *
 * 정본 layout 은 서버 SQL 단독(리드 판정)이라 이 파일에는 layout 이 없다. 검증 대상은
 * 표시 메타의 무결성과 서버 조인 계약(UUID 스킴·순번·밴드·개수)이다:
 *   1) 개수 20개, id/UUID 유일성, UUID 스킴 정합(서버 시드와 조인 키 일치).
 *   2) 난이도 밴드 분포(하위 7 · 중하 7 · 중위 6, 서버 확정)와 순번↔초기 rank.
 *   3) 조회 헬퍼(seedBaseByProfileId·isSeedBase).
 */

import { describe, it, expect } from 'vitest';
import {
  SEED_BASES,
  SEED_BASE_COUNT,
  SEED_BASE_PROFILE_IDS,
  SEED_BASE_UUID_PREFIX,
  PLACEMENT_MATCH_COUNT,
  seedBaseUuid,
  bandForOrder,
  seedBaseByProfileId,
  isSeedBase,
} from '../data/seedBases.js';

describe('seedBases — 개수·유일성·UUID 스킴', () => {
  it('시드 기지는 정확히 20개', () => {
    expect(SEED_BASES.length).toBe(SEED_BASE_COUNT);
    expect(SEED_BASE_COUNT).toBe(20);
  });

  it('배치전 총 횟수는 5', () => {
    expect(PLACEMENT_MATCH_COUNT).toBe(5);
  });

  it('id 는 모두 유일', () => {
    const ids = new Set(SEED_BASES.map((b) => b.id));
    expect(ids.size).toBe(SEED_BASES.length);
  });

  it('profileId 는 모두 유일하고 UUID 스킴을 따른다', () => {
    const ids = new Set(SEED_BASES.map((b) => b.profileId));
    expect(ids.size).toBe(SEED_BASES.length);
    for (let i = 0; i < SEED_BASES.length; i++) {
      const expected = seedBaseUuid(i + 1);
      expect(SEED_BASES[i]!.profileId).toBe(expected);
      expect(expected.startsWith(SEED_BASE_UUID_PREFIX)).toBe(true);
      // RFC 4122 형태(하이픈 위치·자릿수) — 서버 auth.users 시드와 조인.
      expect(expected).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it('seedBaseUuid 는 순번을 12자리 zero-pad', () => {
    expect(seedBaseUuid(1)).toBe(`${SEED_BASE_UUID_PREFIX}000000000001`);
    expect(seedBaseUuid(20)).toBe(`${SEED_BASE_UUID_PREFIX}000000000020`);
  });

  it('SEED_BASE_PROFILE_IDS 는 메타 순서와 일치', () => {
    expect(SEED_BASE_PROFILE_IDS).toEqual(SEED_BASES.map((b) => b.profileId));
  });
});

describe('seedBases — 순번·난이도 밴드·rank', () => {
  it('order 는 1..20 오름차순, initialRank = 21-order', () => {
    SEED_BASES.forEach((b, i) => {
      expect(b.order).toBe(i + 1);
      expect(b.initialRank).toBe(21 - b.order);
    });
    // #01 → rank 20(가장 쉬움), #20 → rank 1(가장 어려움).
    expect(SEED_BASES[0]!.initialRank).toBe(20);
    expect(SEED_BASES[19]!.initialRank).toBe(1);
  });

  it('밴드 분포: 하위 7 · 중하 7 · 중위 6', () => {
    const count: Record<string, number> = { 하위: 0, 중하: 0, 중위: 0 };
    for (const b of SEED_BASES) count[b.difficultyBand] = (count[b.difficultyBand] ?? 0) + 1;
    expect(count).toEqual({ 하위: 7, 중하: 7, 중위: 6 });
  });

  it('bandForOrder 경계(7/8, 14/15)', () => {
    expect(bandForOrder(1)).toBe('하위');
    expect(bandForOrder(7)).toBe('하위');
    expect(bandForOrder(8)).toBe('중하');
    expect(bandForOrder(14)).toBe('중하');
    expect(bandForOrder(15)).toBe('중위');
    expect(bandForOrder(20)).toBe('중위');
  });

  it('각 메타의 band 는 bandForOrder(order) 와 일치', () => {
    for (const b of SEED_BASES) expect(b.difficultyBand).toBe(bandForOrder(b.order));
  });

  it('이름·설명은 비어 있지 않고 shipSummary 레벨은 양수', () => {
    for (const b of SEED_BASES) {
      expect(b.name.length).toBeGreaterThan(0);
      expect(b.description.length).toBeGreaterThan(0);
      expect(b.shipSummary.name.length).toBeGreaterThan(0);
      expect(b.shipSummary.level).toBeGreaterThan(0);
    }
  });
});

describe('seedBases — 조회 헬퍼', () => {
  it('seedBaseByProfileId 는 존재하는 UUID 를 찾고, 아니면 null', () => {
    const first = SEED_BASES[0]!;
    expect(seedBaseByProfileId(first.profileId)).toBe(first);
    expect(seedBaseByProfileId('not-a-seed')).toBeNull();
    expect(seedBaseByProfileId(`${SEED_BASE_UUID_PREFIX}000000000099`)).toBeNull();
  });

  it('isSeedBase 는 시드 UUID 에만 true', () => {
    expect(isSeedBase(SEED_BASES[5]!.profileId)).toBe(true);
    expect(isSeedBase('real-player-uuid')).toBe(false);
  });
});
