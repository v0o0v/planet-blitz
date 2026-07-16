/**
 * 기체 facing 계산 테스트 (src/render/shipFacing.ts — 렌더 전용 순수 함수).
 *
 * 기체가 마우스(e.angle)가 아니라 실제 사격 방향(최근접 적/보스/보급 = autoAttack
 * 대상군)을 향하는지, 대상이 없을 때 이동 방향/직전 각도 폴백이 맞는지 검증한다.
 */

import { describe, it, expect } from 'vitest';
import { nearestHostileAngle, shipFacing } from '../src/render/shipFacing.js';
import { atan2 } from '../src/sim/math.js';
import type { EntitySnapshot } from '../src/sim/snapshot.js';
import type { EntityKind } from '../src/sim/entities.js';

/** 최소 스냅샷 엔티티 팩토리(필수 필드 기본값 채움). */
function ent(kind: EntityKind, x: number, y: number, id = 1): EntitySnapshot {
  return {
    id, kind, x, y, angle: 0, radius: 16, aabbH: 0, enemyType: 0,
    hp: 10, maxHp: 10, active: false, flash: false, elite: -1,
  };
}

describe('nearestHostileAngle', () => {
  it('적/보스/보급 중 최근접 방향을 반환한다', () => {
    const ents = [
      ent('player', 0, 0, 0),
      ent('enemy', 300, 0, 1), // 오른쪽 멀리
      ent('enemy', 0, 100, 2), // 아래 가까움 ← 최근접
      ent('boss', -400, 0, 3),
    ];
    const a = nearestHostileAngle(0, 0, ents);
    expect(a).toBeCloseTo(atan2(100, 0), 5); // 아래(+y) 방향
  });

  it('보급 습격선도 대상에 포함된다(sim nearestTarget과 동일 대상군)', () => {
    const a = nearestHostileAngle(0, 0, [ent('supply', 0, -50, 1)]);
    expect(a).toBeCloseTo(atan2(-50, 0), 5); // 위(-y)
  });

  it('비대상(플레이어/젬/탄/벽/루트)은 무시하고, 대상 없으면 null', () => {
    const ents = [
      ent('player', 0, 0, 0),
      ent('gem', 10, 0, 1),
      ent('bullet', 20, 0, 2),
      ent('wall', 30, 0, 3),
      ent('loot', 40, 0, 4),
    ];
    expect(nearestHostileAngle(0, 0, ents)).toBeNull();
  });
});

describe('shipFacing — 우선순위(대상 > 이동 > 유지)', () => {
  it('대상이 있으면 그 방향(실제 사격 방향)을 향한다', () => {
    const ents = [ent('enemy', 100, 100, 1)];
    // 이동 벡터가 반대라도 대상 방향이 우선.
    const a = shipFacing(0, 0, ents, -1, -1, 3.0);
    expect(a).toBeCloseTo(atan2(100, 100), 5);
  });

  it('대상이 없고 이동 중이면 이동 방향을 향한다(마우스 미의존)', () => {
    const a = shipFacing(0, 0, [], 5, 0, 1.234);
    expect(a).toBeCloseTo(atan2(0, 5), 5); // +x
  });

  it('대상이 없고 정지 상태면 직전 각도를 유지한다', () => {
    const held = 2.5;
    expect(shipFacing(0, 0, [], 0, 0, held)).toBe(held);
    // 미세 이동(임계 미만)도 정지로 간주해 유지.
    expect(shipFacing(0, 0, [], 0.1, 0.1, held)).toBe(held);
  });

  it('플레이어 위치 기준으로 대상 각을 계산한다(원점 아님)', () => {
    const ents = [ent('enemy', 200, 100, 1)];
    const a = shipFacing(200, 0, ents, 0, 0, 0); // 플레이어 (200,0) → 적 (200,100)
    expect(a).toBeCloseTo(atan2(100, 0), 5); // 아래(+y)
  });
});
