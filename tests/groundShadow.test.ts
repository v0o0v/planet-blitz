/**
 * 접지 그림자 **순수 단위** 테스트 — 기하가 테마 `light` 에서 파생되는지, 그림자 대상 선정이
 * "부피 있는 실체" 규율을 지키는지.
 *
 * 이 프로젝트의 반복 결함은 "단위는 초록인데 배선이 통째로 없다"라 배선 통합 테스트
 * (`tests/groundShadowWiring.test.ts`)와 **쌍으로** 존재한다. 여기서 못 박는 것은 값이 아니라
 * **관계**다:
 *
 *  1. 그림자 방향은 광원의 **반대**다(부호가 코드에 적혀 있지 않고 `light.angle` 에서 나온다).
 *  2. 그 부호가 **행성마다 실제로 갈린다** — 카르곤·톡사르는 발밑 광원이라 그림자가 위로,
 *     나머지 4행성은 위 광원이라 아래로. 이걸 상수로 되돌리면 이 테스트가 빨개진다.
 *  3. `shadowBias` 가 0 이면 오프셋이 정확히 0(순수 접지)이고, 클수록 멀어지고 옅어진다.
 *  4. 오프셋이 실루엣을 벗어나지 않는다(벗어나면 "떠 있는 물체 옆의 얼룩"이 된다).
 */

import { describe, it, expect } from 'vitest';

import {
  buildGroundShadow,
  castsGroundShadow,
  groundShadowGeometry,
  SHADOW_ALPHA_MAX,
  SHADOW_FLATTEN,
  SHADOW_OFFSET_SCALE,
} from '../src/render/groundShadow.js';
import { lightY, type EnvLightSpec } from '../src/render/env/theme.js';
import { themeFor } from '../src/render/env/themes/index.js';
import type { EntityKind } from '../src/sim/entities.js';

/** 행성 인덱스 → 테마(없으면 던진다 — 6행성은 전부 등록돼 있어야 한다). */
function theme(planet: number) {
  const t = themeFor(planet);
  if (t === undefined) throw new Error(`행성 ${planet} 테마 미등록`);
  return t;
}

describe('groundShadowGeometry — 방향은 테마 광원의 반대다', () => {
  it('그림자 오프셋은 광원 단위 벡터의 정확한 반대 방향이다', () => {
    const light: EnvLightSpec = { angle: 0.7, shadowBias: 1 };
    const g = groundShadowGeometry(light, 20, 20);
    // 정규화하면 (-cos, -sin) 와 같아야 한다.
    const len = Math.hypot(g.dx, g.dy);
    expect(len).toBeGreaterThan(0);
    expect(g.dx / len).toBeCloseTo(-Math.cos(0.7), 6);
    expect(g.dy / len).toBeCloseTo(-Math.sin(0.7), 6);
  });

  it('shadowBias 0 이면 오프셋이 정확히 0 이다(순수 접지 — 계약 문구 그대로)', () => {
    const g = groundShadowGeometry({ angle: 1.23, shadowBias: 0 }, 20, 20);
    // `-0` 도 0 이다(부호 있는 0 — `toBe` 는 Object.is 라 -0 을 구분한다).
    expect(Math.abs(g.dx)).toBe(0);
    expect(Math.abs(g.dy)).toBe(0);
    // 편향 0 = 가장 진한 접지 그림자.
    expect(g.alpha).toBeCloseTo(SHADOW_ALPHA_MAX, 6);
  });

  it('shadowBias 가 클수록 멀어지고 옅어진다(빗겨 드는 빛일수록 넓고 옅다)', () => {
    const near = groundShadowGeometry({ angle: 1, shadowBias: 0.2 }, 20, 20);
    const far = groundShadowGeometry({ angle: 1, shadowBias: 0.9 }, 20, 20);
    expect(Math.hypot(far.dx, far.dy)).toBeGreaterThan(Math.hypot(near.dx, near.dy));
    expect(far.alpha).toBeLessThan(near.alpha);
    expect(far.alpha).toBeGreaterThan(0);
  });

  it('오프셋이 실루엣을 벗어나지 않는다(bias=1 최악에서도 평균 반경 미만)', () => {
    const g = groundShadowGeometry({ angle: 0.3, shadowBias: 1 }, 30, 30);
    expect(Math.hypot(g.dx, g.dy)).toBeLessThan(30);
    expect(SHADOW_OFFSET_SCALE).toBeLessThan(1);
  });

  it('타원은 세로로 눌린다(탑다운 접지) — 정방 실체에서 ry < rx', () => {
    const g = groundShadowGeometry({ angle: 0, shadowBias: 0.5 }, 24, 24);
    expect(g.ry).toBeLessThan(g.rx);
    expect(g.ry / g.rx).toBeCloseTo(SHADOW_FLATTEN, 6);
  });

  it('비정방 실체(벽)는 x·y 반치수를 각각 따른다 — 한 축에 끌려가지 않는다', () => {
    const g = groundShadowGeometry({ angle: 0, shadowBias: 0.5 }, 80, 20);
    expect(g.rx).toBeGreaterThan(g.ry * 3);
  });

  it('0/음수 치수에도 도형이 생긴다(자식은 있는데 bounds 0 방어)', () => {
    const g = groundShadowGeometry({ angle: 0, shadowBias: 0.5 }, 0, -5);
    expect(g.rx).toBeGreaterThan(0);
    expect(g.ry).toBeGreaterThan(0);
  });
});

describe('6행성 그림자 부호 — 광원 서사가 화면에서 갈린다', () => {
  // 서사: 카르곤=발밑 용암, 톡사르=고인 독성 웅덩이 → 광원이 **아래** → 그림자는 **위로**.
  //       베르단·니플헤임·아르케·크라스 → 광원이 **위** → 그림자는 **아래로**.
  const BELOW_LIT = [
    { planet: 0, name: '카르곤' },
    { planet: 4, name: '톡사르' },
  ];
  const ABOVE_LIT = [
    { planet: 1, name: '베르단' },
    { planet: 2, name: '니플헤임' },
    { planet: 3, name: '아르케' },
    { planet: 5, name: '크라스' },
  ];

  it.each(BELOW_LIT)('$name(행성 $planet): 광원이 아래 → 그림자가 **위로**(dy < 0)', ({ planet }) => {
    const t = theme(planet);
    expect(lightY(t.light)).toBeGreaterThan(0); // 화면 좌표 +y 아래 = 광원이 아래
    const g = groundShadowGeometry(t.light, 24, 24);
    expect(g.dy).toBeLessThan(0);
  });

  it.each(ABOVE_LIT)('$name(행성 $planet): 광원이 위 → 그림자가 **아래로**(dy > 0)', ({ planet }) => {
    const t = theme(planet);
    expect(lightY(t.light)).toBeLessThan(0);
    const g = groundShadowGeometry(t.light, 24, 24);
    expect(g.dy).toBeGreaterThan(0);
  });

  it('부호가 실제로 두 갈래로 갈린다(전 행성 동일 부호 = 상수 회귀)', () => {
    const signs = new Set(
      [0, 1, 2, 3, 4, 5].map((p) => Math.sign(groundShadowGeometry(theme(p).light, 24, 24).dy)),
    );
    expect(signs).toEqual(new Set([-1, 1]));
  });

  it('침공 3레이어도 자기 테마 광원을 따른다(L3 는 아래 광원 → 그림자 위로)', () => {
    // 합성 인덱스 6·7·8. L3(=8)만 `angle = +PI/2 - 0.25` 로 아래 광원이다.
    expect(groundShadowGeometry(theme(6).light, 24, 24).dy).toBeGreaterThan(0);
    expect(groundShadowGeometry(theme(7).light, 24, 24).dy).toBeGreaterThan(0);
    expect(groundShadowGeometry(theme(8).light, 24, 24).dy).toBeLessThan(0);
  });
});

describe('castsGroundShadow — 무엇에 그릴 것인가', () => {
  const BODIES: EntityKind[] = [
    'player',
    'enemy',
    'boss',
    'defenseBoss',
    'guardian',
    'formation',
    'formationDrone',
    'spawnedDrone',
    'facilityGun',
    'facilityHazard',
    'facilitySpawner',
    'prop',
    'core',
    'decoyCore',
    'wall',
    'destructible',
    'supply',
    'magnetEmitter',
    'bombDevice',
    'turretPickup',
    'shelter',
    'encounterAltar',
  ];
  // 신호(탄·젬·전리품) · 지면 오버레이 · 비물질 현상 · 스프라이트 없는 kind.
  const NON_BODIES: EntityKind[] = [
    'bullet',
    'enemyBullet',
    'gem',
    'loot',
    'hazard',
    'boostPad',
    'echo',
    'encounterPortal',
  ];

  it.each(BODIES)('%s 는 그림자를 드리운다(부피 있는 실체)', (k) => {
    expect(castsGroundShadow(k)).toBe(true);
  });

  it.each(NON_BODIES)('%s 는 그림자가 없다(신호·오버레이·비물질)', (k) => {
    expect(castsGroundShadow(k)).toBe(false);
  });

  it('탄·젬·전리품이 빠진 것이 이 정책의 핵심이다 — 수백 개 스프라이트 폭증 방어', () => {
    for (const k of ['bullet', 'enemyBullet', 'gem', 'loot'] as EntityKind[]) {
      expect(castsGroundShadow(k)).toBe(false);
    }
  });
});

describe('buildGroundShadow — 절차적 falloff(node 안전)', () => {
  it('renderer 없이도 만들어지고 곱연산이다', () => {
    const c = buildGroundShadow(20, 14, 0.3);
    expect(c.blendMode).toBe('multiply');
    expect(c.children.length).toBe(1);
    c.destroy({ children: true });
  });

  it('알파 0·음수 치수에도 예외 없이 만들어진다(방어)', () => {
    const c = buildGroundShadow(0, -1, 0);
    expect(c.children.length).toBe(1);
    c.destroy({ children: true });
  });
});
