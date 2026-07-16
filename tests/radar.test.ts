/**
 * 레이더 투영·필터링·테두리 클램프 테스트 (src/render/radar.ts — 렌더 전용 순수 함수).
 *
 * 레이더가 스냅샷만 읽어 표시 대상(보스·엘리트·드랍·기믹·해저드)만 골라내고, 사거리
 * 안은 축척 투영, 밖은 테두리 클램프(방향만 유지)하는지 검증한다(ADR-0009). 북 고정.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyRadar,
  projectBlip,
  projectRadar,
  DEFAULT_RADAR,
  type RadarConfig,
} from '../src/render/radar.js';
import { atan2 } from '../src/sim/math.js';
import type { EntitySnapshot } from '../src/sim/snapshot.js';
import type { EntityKind } from '../src/sim/entities.js';

/** 최소 스냅샷 엔티티 팩토리(필수 필드 기본값 채움). elite로 엘리트 지정 가능. */
function ent(kind: EntityKind, x: number, y: number, id = 1, elite = -1): EntitySnapshot {
  return {
    id, kind, x, y, angle: 0, radius: 16, aabbH: 0, enemyType: 0,
    hp: 10, maxHp: 10, active: false, flash: false, elite,
  };
}

const CFG: RadarConfig = { radius: 100, range: 1000 }; // scale 0.1

describe('classifyRadar — 표시 대상 필터링', () => {
  it('보스·엘리트·드랍·해저드·기믹만 통과시킨다', () => {
    expect(classifyRadar(ent('boss', 0, 0))).toBe('boss');
    expect(classifyRadar(ent('enemy', 0, 0, 1, 2))).toBe('elite'); // elite affix 2
    expect(classifyRadar(ent('loot', 0, 0))).toBe('loot');
    expect(classifyRadar(ent('hazard', 0, 0))).toBe('hazard');
    expect(classifyRadar(ent('magnetEmitter', 0, 0))).toBe('gimmick');
    expect(classifyRadar(ent('bombDevice', 0, 0))).toBe('gimmick');
    expect(classifyRadar(ent('turretPickup', 0, 0))).toBe('gimmick');
  });

  it('잡몹(일반 enemy)·젬·탄·벽·플레이어는 제외한다', () => {
    expect(classifyRadar(ent('enemy', 0, 0, 1, -1))).toBeNull(); // elite 아님
    expect(classifyRadar(ent('gem', 0, 0))).toBeNull();
    expect(classifyRadar(ent('bullet', 0, 0))).toBeNull();
    expect(classifyRadar(ent('enemyBullet', 0, 0))).toBeNull();
    expect(classifyRadar(ent('wall', 0, 0))).toBeNull();
    expect(classifyRadar(ent('destructible', 0, 0))).toBeNull();
    expect(classifyRadar(ent('supply', 0, 0))).toBeNull();
    expect(classifyRadar(ent('player', 0, 0))).toBeNull();
  });
});

describe('projectBlip — 축척 투영 / 테두리 클램프', () => {
  it('사거리 안이면 축척만 적용한다(북 고정, 회전 없음)', () => {
    const b = projectBlip(500, 0, CFG); // scale 0.1 → 50px, radius 100 이내
    expect(b.edge).toBe(false);
    expect(b.x).toBeCloseTo(50, 5);
    expect(b.y).toBeCloseTo(0, 5);
    expect(b.angle).toBeCloseTo(atan2(0, 500), 5);
  });

  it('사거리 밖이면 테두리에 클램프하고 방향만 유지한다', () => {
    const b = projectBlip(3000, 0, CFG); // 300px → radius 100으로 클램프
    expect(b.edge).toBe(true);
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(100, 5); // 테두리 위
    expect(b.angle).toBeCloseTo(atan2(0, 3000), 5); // +x 방향 유지
  });

  it('대각선 대상도 방향을 보존하며 테두리에 얹힌다', () => {
    const b = projectBlip(5000, 5000, CFG);
    expect(b.edge).toBe(true);
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(100, 5);
    // 45도 방향 → x==y (둘 다 양수).
    expect(b.x).toBeCloseTo(b.y, 5);
    expect(b.x).toBeGreaterThan(0);
  });

  it('정확히 사거리 경계는 테두리로 취급하지 않는다', () => {
    const b = projectBlip(1000, 0, CFG); // 100px == radius
    expect(b.edge).toBe(false);
    expect(b.x).toBeCloseTo(100, 5);
  });

  it('플레이어와 같은 위치(오프셋 0)는 중심에 찍고 edge=false', () => {
    const b = projectBlip(0, 0, CFG);
    expect(b.edge).toBe(false);
    expect(b.x).toBe(0);
    expect(b.y).toBe(0);
  });
});

describe('projectRadar — 필터 + 플레이어 상대 투영', () => {
  it('표시 대상만 골라 플레이어 기준 상대 좌표로 투영한다', () => {
    const px = 200;
    const py = 100;
    const entities = [
      ent('player', px, py, 0),
      ent('enemy', px + 500, py, 1, -1), // 잡몹 → 제외
      ent('boss', px + 500, py, 2), // 사거리 안
      ent('loot', px + 300, py, 3), // 사거리 안
      ent('hazard', px + 20000, py, 4), // 사거리 밖 → 테두리
    ];
    const blips = projectRadar(px, py, entities, CFG);
    expect(blips).toHaveLength(3); // 잡몹·플레이어 제외
    const boss = blips.find((b) => b.category === 'boss');
    expect(boss?.edge).toBe(false);
    expect(boss?.x).toBeCloseTo(50, 5); // 500 * 0.1
    const hazard = blips.find((b) => b.category === 'hazard');
    expect(hazard?.edge).toBe(true);
    expect(Math.hypot(hazard!.x, hazard!.y)).toBeCloseTo(100, 5);
  });

  it('대상이 없으면 빈 배열', () => {
    const blips = projectRadar(0, 0, [ent('player', 0, 0, 0), ent('gem', 10, 0, 1)], CFG);
    expect(blips).toEqual([]);
  });
});

describe('DEFAULT_RADAR — 기본 설정 위생', () => {
  it('반경·범위가 양수이고 화면 뷰포트보다 넓은 범위를 담는다', () => {
    expect(DEFAULT_RADAR.radius).toBeGreaterThan(0);
    expect(DEFAULT_RADAR.range).toBeGreaterThan(960); // 화면 절반 폭(1920/2)보다 넓게
  });
});
