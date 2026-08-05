/**
 * 세이브 v10 → v11 마이그레이션 (ADR-0049 스킬 전면 재구축).
 *
 * `skillInvest` 의 **와이어 레이아웃 자체**가 바뀌는 유일한 마이그레이션이다(v4·v9 는 값만
 * 건드렸고 길이는 그대로였다). 그래서 v9 를 베끼면 걸리는 함정이 둘 있고, 이 파일이 그 둘을
 * 잠근다:
 *
 *   ① **환급을 정규화 뒤에 세면 뒤쪽 칸이 조용히 증발한다.** 정규화는 신규 길이 30칸만 옮겨
 *      담으므로, 구 63칸 벡터의 30..62 에 있던 투자가 환급되지 않는다.
 *   ② **퇴역 수호기를 v9 처럼 "의도적 제외"로 두면 안 된다.** 길이가 바뀌므로 제외는 무해가
 *      아니라 **구 값이 신규 스킬 레벨로 재해석**되는 것이다.
 */

import { describe, it, expect } from 'vitest';
import { migrate } from '../src/save/profile.js';
import { SAVE_VERSION } from '../src/items/types.js';
import { shipNodeCount, shipTypeDef } from '../data/ships/index.js';

/** 신규 flat 길이 — 기체 7종 전부 30. */
const NEW_LEN = shipNodeCount(shipTypeDef(0));

/** 구 레이아웃 벡터를 흉내 낸다: 스트라이커 63칸 · 해츨링 78칸. */
function legacyVector(len: number, fill: (i: number) => number): number[] {
  return Array.from({ length: len }, (_, i) => fill(i));
}

/** v10 시점의 최소 세이브 블롭. 나머지는 `normalizeProfile` 이 기본값으로 채운다. */
function v10Save(ships: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { saveVersion: 10, ships, skillPoints: 0, ...extra };
}

describe('세이브 v10 → v11 — 스킬 와이어 재정의 (ADR-0049)', () => {
  it('SAVE_VERSION 이 11 이고 마이그레이션 후 벡터 길이가 30 이다', () => {
    expect(SAVE_VERSION).toBe(11);
    const p = migrate(
      v10Save([{ id: 's0', name: 'a', typeId: 0, level: 1, xp: 0, skillInvest: legacyVector(63, () => 0) }]),
    );
    expect(p.saveVersion).toBe(11);
    expect(p.ships[0]?.skillInvest.length).toBe(NEW_LEN);
    expect(p.ships[0]?.skillInvest.every((v) => v === 0)).toBe(true);
  });

  it('구 벡터의 **뒤쪽 칸까지** 환급된다 (정규화 뒤에 세면 증발하는 자리)', () => {
    // 앞 30칸에 1씩(=30), 뒤 33칸에 2씩(=66). 합 96.
    // 정규화 뒤에 셌다면 30 만 환급되고 66 이 사라진다.
    const invest = legacyVector(63, (i) => (i < NEW_LEN ? 1 : 2));
    const expected = NEW_LEN * 1 + (63 - NEW_LEN) * 2;
    const p = migrate(
      v10Save([{ id: 's0', name: 'a', typeId: 0, level: 1, xp: 0, skillInvest: invest }]),
    );
    expect(expected).toBe(96); // 표본이 실제로 뒤쪽을 덮는지 자체 점검
    expect(p.skillPoints).toBe(expected);
  });

  it('여러 기체의 환급이 합산되고 기존 보유 포인트에 더해진다', () => {
    const p = migrate(
      v10Save(
        [
          { id: 's0', name: 'a', typeId: 0, level: 1, xp: 0, skillInvest: legacyVector(63, () => 1) },
          { id: 's1', name: 'b', typeId: 4, level: 1, xp: 0, skillInvest: legacyVector(78, () => 1) },
        ],
        { skillPoints: 7 },
      ),
    );
    expect(p.skillPoints).toBe(7 + 63 + 78);
  });

  it('손상 벡터·손상 기체는 환급을 오염시키지 않는다', () => {
    const p = migrate(
      v10Save([
        { id: 's0', name: 'a', typeId: 0, level: 1, xp: 0, skillInvest: 'not-an-array' },
        { id: 's1', name: 'b', typeId: 0, level: 1, xp: 0, skillInvest: [3, -5, Number.NaN, 'x', 2] },
        null,
      ]),
    );
    // 유한 양수만 더한다 → 3 + 2 = 5.
    expect(p.skillPoints).toBe(5);
  });

  it('이미 v11 인 세이브는 다시 환급하지 않는다 (사다리 재실행 방어)', () => {
    const once = migrate(
      v10Save([{ id: 's0', name: 'a', typeId: 0, level: 1, xp: 0, skillInvest: legacyVector(63, () => 1) }]),
    );
    expect(once.skillPoints).toBe(63);
    const twice = migrate(once as unknown as Record<string, unknown>);
    expect(twice.skillPoints, '두 번 태우면 환급이 두 배가 된다면 사다리 게이트가 깨진 것이다').toBe(63);
  });
});

describe('퇴역 수호기 빌드 — 구 레이아웃 벡터 0 처리 (사용자 결정 2026-08-06)', () => {
  /**
   * `normalizeGuardianSnapshot` 이 요구하는 11개 수치 필드. 하나라도 빠지면 레코드가 통째로
   * 버려져 이 절의 단언이 전부 `undefined` 를 보게 된다(= 조용히 항진).
   */
  const SNAPSHOT = {
    preset: 0,
    radius: 32,
    hp: 100,
    contactDamage: 10,
    fireCooldown: 30,
    bulletDamage: 10,
    bulletSpeed: 1800,
    bulletRadius: 8,
    bulletLife: 60,
    range: 1650,
    moveSpeed: 300,
    standoff: 400,
  };

  /** 수호 레코드 1개를 실은 세이브. `build` 는 서버 jsonb 셰이프를 그대로 흉내 낸다. */
  function withGuardian(skillInvest: unknown, typeId = 0): Record<string, unknown> {
    return v10Save([{ id: 's0', name: 'a', typeId: 0, level: 1, xp: 0, skillInvest: [] }], {
      guardians: [
        {
          id: 'g0',
          snapshot: SNAPSHOT,
          preset: 0,
          performanceCP: 10000,
          combatScore: 100,
          retired: false,
          build: { typeId, equipped: {}, skillInvest, activeSlots: [null, null] },
        },
      ],
    });
  }

  it('전제: 표본 수호 레코드가 실제로 살아남는다 (안 그러면 아래 단언이 전부 항진이다)', () => {
    const p = migrate(withGuardian(legacyVector(NEW_LEN, () => 0)));
    expect(p.guardians.length).toBe(1);
    expect(p.guardians[0]?.build).toBeDefined();
  });

  it('구 63칸 벡터는 전부 0 이 된다 (안 찍은 스킬이 공짜 해금되던 자리)', () => {
    const p = migrate(withGuardian(legacyVector(63, () => 4)));
    const inv = p.guardians[0]?.build?.skillInvest;
    expect(inv?.length).toBe(NEW_LEN);
    expect(inv?.every((v) => v === 0), `구 벡터가 신규 스킬 레벨로 새어 들어왔다: ${inv?.join(',')}`).toBe(
      true,
    );
  });

  it('구 78칸(해츨링) 벡터도 전부 0 이 된다', () => {
    const p = migrate(withGuardian(legacyVector(78, () => 5), 4));
    expect(p.guardians[0]?.build?.skillInvest.every((v) => v === 0)).toBe(true);
  });

  it('신규 30칸 벡터는 **보존된다** (0 처리가 과확산되면 신규 수호기까지 털린다)', () => {
    const fresh = legacyVector(NEW_LEN, (i) => (i === 0 ? 7 : 0));
    const p = migrate(withGuardian(fresh));
    expect(p.guardians[0]?.build?.skillInvest[0]).toBe(7);
  });

  it('수호기 벡터는 환급 대상이 아니다 (퇴역기에는 포인트 풀이 없다)', () => {
    const p = migrate(withGuardian(legacyVector(63, () => 4)));
    expect(p.skillPoints).toBe(0);
  });
});
