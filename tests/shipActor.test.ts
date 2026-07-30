/**
 * 플레이어 기체 3D 액터(`src/render/three3d/shipActor.ts`)의 **순수 계약** 검증.
 *
 * ## 여기서 재는 것과 재지 않는 것
 * 노드 환경에는 WebGL 이 없어 `Stage3D.create()` 가 null 이고 액터는 아예 만들어지지 않는다.
 * 그래서 이 스위트는 **화면을 재지 않는다** — 화면은 `/ship3d.html` 뷰어 + Chrome 스크린샷으로
 * 재고(잘림은 슬롯 테두리 접촉 화소 수로), 여기서는 그 화면이 성립하기 위한 **불변식**만 잠근다:
 *
 *  - 각도 미분이 ±π 경계에서 폭발하지 않는다 → 표적이 뒤로 넘어갈 때 기체가 뒤집히지 않는다
 *  - 뱅크 스프링이 **저감쇠**다 → 계약이 요구하는 "2차 운동"(오버슈트)이 실제로 일어난다
 *  - 모델 원장(`manifest.json`)과 코드의 파일명이 일치한다 → 조용한 2D 폴백을 막는다
 *
 * 마지막 항목이 특히 중요하다: 모델 로드 실패는 **예외가 아니라 조용한 폴백**이라 화면에 아무
 * 신호가 없다(기존 PNG 가 그대로 보인다). 파일명 오타 하나가 "3D 를 켰다고 문서에 적혀 있는데
 * 화면에는 2D" 인 상태를 만들 수 있고, 그건 이 리포가 여러 번 밟은 유형이다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { angleDelta, springStep, hasShipModel } from '../src/render/three3d/shipActor.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('angleDelta — 기수 미분의 경계 처리', () => {
  it('작은 차이는 그대로 돌려준다', () => {
    expect(angleDelta(0.3, 0.1)).toBeCloseTo(0.2, 12);
    expect(angleDelta(0.1, 0.3)).toBeCloseTo(-0.2, 12);
  });

  it('±π 를 넘는 회전을 짧은 쪽으로 접는다 — 접지 않으면 표적 전환 한 번에 기체가 뒤집힌다', () => {
    // 0.1 rad 를 시계 반대로 돈 것뿐인데 생각 없이 빼면 −6.18(≈ −354°)이 나온다.
    expect(angleDelta(-Math.PI + 0.05, Math.PI - 0.05)).toBeCloseTo(0.1, 12);
    expect(angleDelta(Math.PI - 0.05, -Math.PI + 0.05)).toBeCloseTo(-0.1, 12);
  });

  it('어떤 입력에서도 결과가 [-π, π] 안이다', () => {
    for (let i = 0; i < 200; i++) {
      const a = (i * 0.97) % (Math.PI * 6) - Math.PI * 3;
      const b = (i * 2.31) % (Math.PI * 6) - Math.PI * 3;
      const d = angleDelta(a, b);
      expect(Math.abs(d)).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });
});

describe('뱅크 스프링 — 2차 운동(오버슈트)이 실제로 일어난다', () => {
  /** 액터가 쓰는 값과 **같은** 강성·감쇠. 여기가 갈라지면 이 테스트는 아무것도 안 잠근다. */
  const K = 120;
  const C = 10;

  /** 목표까지 적분해 최대 도달값을 돌려준다. */
  function peak(stiffness: number, damping: number): number {
    let v = 0;
    let vel = 0;
    let max = 0;
    for (let i = 0; i < 240; i++) {
      const s = springStep(v, vel, 1, stiffness, damping, 1 / 60);
      v = s.value;
      vel = s.vel;
      if (v > max) max = v;
    }
    return max;
  }

  it('감쇠가 임계(2√k)보다 낮다 — 그래야 지연된 1차 운동이 아니라 2차 운동이다', () => {
    expect(C).toBeLessThan(2 * Math.sqrt(K));
  });

  it('목표를 넘어선다(오버슈트 ≥ 5%)', () => {
    // ⚠️ 이 게이트가 5% 인 이유: 2D 레인에서 **이론상 3.4% 오버슈트가 화면에서는 지연과 구분되지
    // 않았다**(반음함 오일러의 수치 감쇠까지 겹쳤다). "코드에는 2차 운동이 있는데 화면에는 없다"를
    // 막는 하한이다.
    expect(peak(K, C)).toBeGreaterThan(1.05);
  });

  it('뮤테이션 방어 — 감쇠를 임계 위로 올리면 오버슈트가 사라진다', () => {
    expect(peak(K, 2 * Math.sqrt(K) * 1.2)).toBeLessThanOrEqual(1.0001);
  });

  it('발산하지 않는다(목표에 수렴)', () => {
    let v = 0;
    let vel = 0;
    for (let i = 0; i < 600; i++) {
      const s = springStep(v, vel, 1, K, C, 1 / 60);
      v = s.value;
      vel = s.vel;
    }
    expect(v).toBeCloseTo(1, 3);
  });
});

describe('기체 모델 등록 ↔ 원장', () => {
  interface Entry {
    id: string;
    file: string;
  }
  const manifest = JSON.parse(
    readFileSync(join(ROOT, 'assets', 'models', 'manifest.json'), 'utf8'),
  ) as { models: Entry[] };

  it('스트라이커(typeId 0)에 3D 모델이 등록돼 있다', () => {
    expect(hasShipModel(0)).toBe(true);
  });

  it('아직 모델이 없는 타입은 false — 조용한 2D 폴백이 정상 경로다', () => {
    // ⚠️ 이 단언은 "6종이 영원히 없다"가 아니라 **코드와 자산이 갈라지지 않았다**를 잠근다.
    // 새 기체 GLB 를 넣으면서 `SHIP_MODELS` 등록을 빠뜨리면(또는 반대) 여기가 빨개진다.
    const listed = new Set(manifest.models.map((m) => m.file));
    for (let t = 1; t <= 6; t++) {
      expect(hasShipModel(t), `typeId ${t}`).toBe(false);
    }
    // 원장에 기체 GLB 가 스트라이커 하나뿐인 것과 위 등록이 정합한다.
    expect([...listed].filter((f) => f.startsWith('ship_'))).toEqual(['ship_striker.glb']);
  });

  it('범위 밖 typeId 에도 던지지 않는다 — 손상 세이브가 화면을 막으면 안 된다', () => {
    expect(hasShipModel(-1)).toBe(false);
    expect(hasShipModel(99)).toBe(false);
  });
});
