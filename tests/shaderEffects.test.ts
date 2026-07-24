/**
 * 이벤트 셰이더 이펙트 컨트롤러 단위 테스트 (Phase 3 — plan §AC-3.2/3.3/3.4/3.6).
 *
 * `ShockwaveEffect`·`DissolveEffect`·`ShimmerEffect`([src/render/effects/shaderEffects.ts])는
 * Phase 0 필터 팩토리를 정규 렌더 경로에 배선하는 수명 컨트롤러다. 여기서는 그 소비 계약을 헤드리스로
 * 못박는다:
 *
 *  1. **filters 배열 비훼손**: 대상의 기존 필터를 보존하며 자기 것만 넣고 뺀다(누수 0·이중 detach 안전).
 *  2. **진행/수명 결정론**: `update` 가 진행도로 유니폼(또는 폴백)을 구동하고, 원샷은 duration 종료 시
 *     `false` 로 전환, 지속형(시머)은 uTime 을 단조 누적한다. 같은 입력 → 같은 진행.
 *  3. **graceful 폴백**: 필터 null(GL 부재·컴파일 실패) 강제 시 충격파=팽창 링·디졸브=alpha 페이드·
 *     시머=no-op 로 낮추고 throw 없이 정리(AC-3.6).
 *
 * ── node-env 필터 프라임 특성 ── vite.config.ts `environment: 'node'` 라 GL 이 없다. 실증상 이
 * 환경의 **프로세스 첫 `new Filter` 인스턴스화만 throw**(tryCreateFilter 가 삼켜 null)하고 이후
 * 호출은 성공한다. 그래서 "실 필터 경로" 검증엔 재시도 헬퍼로 non-null 필터를 확보하고(첫 null 이
 * 프라임 역할), "폴백 경로" 검증엔 `createFilter: () => null` 을 주입해 결정적으로 폴백을 태운다.
 * PixiJS 는 렌더러 없이 import 만 하므로 node 에서 그대로 돈다(tests/galleryWiring.test.ts 선례).
 */

import { describe, it, expect } from 'vitest';
import { Container, Filter } from 'pixi.js';
import {
  ShockwaveEffect,
  DissolveEffect,
  ShimmerEffect,
  attachFilter,
  detachFilter,
} from '../src/render/effects/shaderEffects.js';
import {
  createShockwaveFilter,
  createDissolveFilter,
  createShimmerFilter,
} from '../src/render/shaders/index.js';

// ---------------------------------------------------------------------------
// 헬퍼 — 실 필터 확보(node 첫 new Filter 프라임 흡수) · filters 배열 정규화 읽기.
// ---------------------------------------------------------------------------

type FilterKind = 'shockwave' | 'dissolve' | 'shimmer';

/**
 * non-null 실 Filter 를 확보한다. node-env 는 프로세스 첫 인스턴스화만 null(프라임)이라 재시도하면
 * 곧 실 인스턴스를 얻는다. 끝내 못 얻으면(환경상 GL 완전 부재) 명확히 실패시킨다.
 */
function makeRealFilter(kind: FilterKind): Filter {
  const factory =
    kind === 'shockwave'
      ? () => createShockwaveFilter()
      : kind === 'dissolve'
        ? () => createDissolveFilter()
        : () => createShimmerFilter();
  for (let i = 0; i < 12; i++) {
    const f = factory();
    if (f) return f;
  }
  throw new Error(`makeRealFilter: ${kind} 필터를 이 환경에서 확보하지 못함`);
}

/** target.filters 를 배열로 정규화해 읽는다(테스트 관측용 — 모듈 내부 readFilters 와 동형). */
function filtersOf(target: Container): Filter[] {
  const f = target.filters as Filter | readonly Filter[] | null | undefined;
  if (f == null) return [];
  return Array.isArray(f) ? [...f] : [f as Filter];
}

/** 유니폼 그룹 값 읽기(관측용). destroy 된 필터는 resources 가 null 이라 undefined 로 흡수. */
function uniformOf(filter: Filter, group: string, name: string): number | undefined {
  const res = filter.resources as Record<string, { uniforms?: Record<string, number> } | undefined> | null;
  if (!res) return undefined;
  return res[group]?.uniforms?.[name];
}

// ===========================================================================
// 1. filters 배열 비훼손 — attachFilter / detachFilter 직접 검증.
// ===========================================================================

describe('filters 배열 비훼손 (attach/detach)', () => {
  it('빈 대상에 attach → 그 필터 하나. detach → 빈 배열', () => {
    const target = new Container();
    expect(filtersOf(target)).toHaveLength(0); // 사전: 미설정(getter undefined)

    const f = makeRealFilter('shimmer');
    attachFilter(target, f);
    expect(filtersOf(target)).toEqual([f]);

    detachFilter(target, f);
    expect(filtersOf(target)).toHaveLength(0);
  });

  it('기존 필터를 보존하며 뒤에 덧붙인다(다른 이펙트 필터와 공존)', () => {
    const target = new Container();
    const existing = makeRealFilter('shimmer');
    const mine = makeRealFilter('dissolve');

    // 외부(다른 이펙트)가 먼저 건 필터.
    target.filters = [existing];
    expect(filtersOf(target)).toEqual([existing]);

    attachFilter(target, mine);
    const after = filtersOf(target);
    expect(after).toHaveLength(2);
    expect(after).toContain(existing); // ★ 기존 보존
    expect(after).toContain(mine);

    // 내 것만 제거 — 기존은 그대로 남는다.
    detachFilter(target, mine);
    expect(filtersOf(target)).toEqual([existing]);
  });

  it('중복 attach 는 멱등(같은 필터 두 번 넣어도 하나)', () => {
    const target = new Container();
    const f = makeRealFilter('shimmer');
    attachFilter(target, f);
    attachFilter(target, f);
    expect(filtersOf(target)).toEqual([f]);
  });

  it('미부착 필터 detach·이중 detach 는 무해(no-op)', () => {
    const target = new Container();
    const a = makeRealFilter('shimmer');
    const b = makeRealFilter('dissolve');
    attachFilter(target, a);

    expect(() => detachFilter(target, b)).not.toThrow(); // 미부착
    expect(filtersOf(target)).toEqual([a]); // 오염 없음

    detachFilter(target, a);
    expect(() => detachFilter(target, a)).not.toThrow(); // 이중 detach
    expect(filtersOf(target)).toHaveLength(0);
  });
});

// ===========================================================================
// 2. ShockwaveEffect — 원샷, 필터 경로 + 폴백 링 경로.
// ===========================================================================

describe('ShockwaveEffect (원샷 충격파 링)', () => {
  it('폴백(필터 null): 팽창 링 child 를 붙이고 update 후 destroy 로 정리한다', () => {
    const target = new Container();
    const fx = new ShockwaveEffect(target, { createFilter: () => null, durationS: 1.15 });

    // 폴백 링이 동기 추가됨(children>0). 필터는 없다.
    expect(target.children.length).toBe(1);
    expect(filtersOf(target)).toHaveLength(0);

    // update 반복 — throw 없이 진행하고, 결국 원샷 false 로 전환.
    let alive = true;
    let frames = 0;
    while (alive && frames < 200) {
      alive = fx.update(0.05);
      frames += 1;
    }
    expect(alive, '원샷은 결국 false 로 종료').toBe(false);
    expect(frames).toBeLessThan(200);

    fx.destroy();
    expect(target.children.length, 'destroy 후 폴백 링 잔여(누수)').toBe(0);
  });

  it('필터 경로: 기존 필터 보존하며 부착, update 가 uProgress·uAmplitude 를 구동, destroy 로 자기 것만 제거', () => {
    const target = new Container();
    const existing = makeRealFilter('shimmer');
    target.filters = [existing];

    const swFilter = makeRealFilter('shockwave');
    const fx = new ShockwaveEffect(target, {
      createFilter: () => swFilter,
      durationS: 1.0,
      amplitude: 16,
    });

    // 기존 보존 + 내 필터 추가.
    expect(filtersOf(target)).toHaveLength(2);
    expect(filtersOf(target)).toContain(existing);
    expect(filtersOf(target)).toContain(swFilter);

    // 초기 uProgress 0.
    expect(uniformOf(swFilter, 'shockwaveUniforms', 'uProgress')).toBe(0);

    // 한 프레임 진행 → uProgress 상승, uAmplitude >= 0.
    fx.update(0.05);
    const p1 = uniformOf(swFilter, 'shockwaveUniforms', 'uProgress');
    expect(p1).toBeGreaterThan(0);
    expect(uniformOf(swFilter, 'shockwaveUniforms', 'uAmplitude')).toBeGreaterThanOrEqual(0);

    // 계속 진행 → 종료 시 uProgress == 1.
    let alive = true;
    for (let i = 0; i < 100 && alive; i++) alive = fx.update(0.05);
    expect(alive).toBe(false);
    expect(uniformOf(swFilter, 'shockwaveUniforms', 'uProgress')).toBe(1);

    // destroy → 내 필터만 제거, 기존은 그대로.
    fx.destroy();
    expect(filtersOf(target)).toEqual([existing]);
  });

  it('종료·destroy 후 update 는 false(재발화 없음), 이중 destroy 안전', () => {
    const target = new Container();
    const fx = new ShockwaveEffect(target, { createFilter: () => null, durationS: 0.5 });
    for (let i = 0; i < 50; i++) fx.update(0.05); // 충분히 종료
    expect(fx.update(0.05)).toBe(false);
    expect(() => fx.destroy()).not.toThrow();
    expect(fx.update(0.05)).toBe(false); // destroy 후에도 안전
    expect(() => fx.destroy()).not.toThrow(); // 이중 destroy
  });

  it('진행 결정론: 같은 duration·프레임열 → 같은 uProgress 수열', () => {
    const seq = (): number[] => {
      const target = new Container();
      const f = makeRealFilter('shockwave');
      const fx = new ShockwaveEffect(target, { createFilter: () => f, durationS: 1.0 });
      const out: number[] = [];
      for (let i = 0; i < 6; i++) {
        fx.update(0.05);
        out.push(uniformOf(f, 'shockwaveUniforms', 'uProgress') ?? -1);
      }
      fx.destroy();
      return out;
    };
    expect(seq()).toEqual(seq());
  });
});

// ===========================================================================
// 3. DissolveEffect — 원샷, 필터 경로 + alpha 페이드 폴백.
// ===========================================================================

describe('DissolveEffect (원샷 사망 디졸브)', () => {
  it('폴백(필터 null): 컨테이너 alpha 를 1→0 으로 페이드하고 원샷 종료', () => {
    const target = new Container();
    expect(target.alpha).toBe(1);
    const fx = new DissolveEffect(target, { createFilter: () => null, durationS: 1.1 });

    // 필터 미부착(폴백은 표시 객체 추가 없이 alpha 만 구동).
    expect(filtersOf(target)).toHaveLength(0);

    fx.update(0.05);
    expect(target.alpha).toBeLessThan(1); // 페이드 시작
    expect(target.alpha).toBeGreaterThan(0);

    let alive = true;
    for (let i = 0; i < 100 && alive; i++) alive = fx.update(0.05);
    expect(alive, '원샷 종료').toBe(false);
    expect(target.alpha).toBeCloseTo(0, 5); // 완전 소멸

    expect(() => fx.destroy()).not.toThrow();
  });

  it('필터 경로: 필터 부착, uProgress 0→1 구동, alpha 는 1 유지, destroy 로 제거', () => {
    const target = new Container();
    const dsFilter = makeRealFilter('dissolve');
    const fx = new DissolveEffect(target, { createFilter: () => dsFilter, durationS: 1.0 });

    expect(filtersOf(target)).toContain(dsFilter);
    expect(uniformOf(dsFilter, 'dissolveUniforms', 'uProgress')).toBe(0);

    fx.update(0.05);
    expect(uniformOf(dsFilter, 'dissolveUniforms', 'uProgress')).toBeGreaterThan(0);
    expect(target.alpha, '필터 경로는 컨테이너 alpha 온전 유지(디더가 픽셀 지움)').toBe(1);

    let alive = true;
    for (let i = 0; i < 100 && alive; i++) alive = fx.update(0.05);
    expect(alive).toBe(false);
    expect(uniformOf(dsFilter, 'dissolveUniforms', 'uProgress')).toBe(1);

    fx.destroy();
    expect(filtersOf(target)).toHaveLength(0);
  });

  it('종료·destroy 후 update 는 false, 이중 destroy 안전', () => {
    const target = new Container();
    const fx = new DissolveEffect(target, { createFilter: () => null, durationS: 0.4 });
    for (let i = 0; i < 40; i++) fx.update(0.05);
    expect(fx.update(0.05)).toBe(false);
    expect(() => fx.destroy()).not.toThrow();
    expect(() => fx.destroy()).not.toThrow();
  });
});

// ===========================================================================
// 4. ShimmerEffect — 지속형, 필터 경로 + no-op 폴백.
// ===========================================================================

describe('ShimmerEffect (지속형 히트 시머)', () => {
  it('필터 경로: 부착, uTime 단조 누적, detach 로 제거(기존 보존)', () => {
    const target = new Container();
    const existing = makeRealFilter('dissolve');
    target.filters = [existing];

    const shFilter = makeRealFilter('shimmer');
    const fx = new ShimmerEffect(target, { createFilter: () => shFilter, strength: 3, speed: 6 });

    expect(filtersOf(target)).toHaveLength(2);
    expect(filtersOf(target)).toContain(existing);
    expect(uniformOf(shFilter, 'shimmerUniforms', 'uTime')).toBe(0);

    // 연속 구동 — uTime 단조 증가(원샷 아님, 종료 신호 없음).
    let prev = uniformOf(shFilter, 'shimmerUniforms', 'uTime') ?? 0;
    for (let i = 0; i < 5; i++) {
      fx.update(0.05);
      const now = uniformOf(shFilter, 'shimmerUniforms', 'uTime') ?? -1;
      expect(now).toBeGreaterThan(prev);
      prev = now;
    }

    // detach → 내 필터만 제거, 기존 보존.
    fx.detach();
    expect(filtersOf(target)).toEqual([existing]);
  });

  it('폴백(필터 null): update no-op, detach 안전, 필터 미부착', () => {
    const target = new Container();
    const fx = new ShimmerEffect(target, { createFilter: () => null });
    expect(filtersOf(target)).toHaveLength(0);
    expect(() => {
      for (let i = 0; i < 10; i++) fx.update(0.05);
    }).not.toThrow();
    expect(() => fx.detach()).not.toThrow();
  });

  it('detach 후 update 는 no-op, 이중 detach·destroy 별칭 안전', () => {
    const target = new Container();
    const shFilter = makeRealFilter('shimmer');
    const fx = new ShimmerEffect(target, { createFilter: () => shFilter });
    fx.update(0.05);
    const tAtDetach = uniformOf(shFilter, 'shimmerUniforms', 'uTime') ?? -1;

    fx.detach();
    // detach 후 update 는 uTime 을 더 안 올린다(no-op).
    fx.update(0.05);
    // 필터는 destroy 됐을 수 있으나, 관측은 detach 시점 값에서 멈춰야 한다(컨트롤러가 write 안 함).
    // destroy 된 필터의 resources 접근이 throw 하지 않는 한도에서만 확인.
    const after = uniformOf(shFilter, 'shimmerUniforms', 'uTime');
    if (after !== undefined) expect(after).toBe(tAtDetach);

    expect(() => fx.detach()).not.toThrow(); // 이중 detach
    expect(() => fx.destroy()).not.toThrow(); // destroy 별칭
  });

  it('speed 가 uTime 누적 속도를 가른다(더 빠르면 더 큰 uTime)', () => {
    const slowF = makeRealFilter('shimmer');
    const fastF = makeRealFilter('shimmer');
    const slow = new ShimmerEffect(new Container(), { createFilter: () => slowF, speed: 2 });
    const fast = new ShimmerEffect(new Container(), { createFilter: () => fastF, speed: 10 });
    for (let i = 0; i < 4; i++) {
      slow.update(0.05);
      fast.update(0.05);
    }
    expect(uniformOf(fastF, 'shimmerUniforms', 'uTime') ?? 0).toBeGreaterThan(
      uniformOf(slowF, 'shimmerUniforms', 'uTime') ?? 0,
    );
    slow.detach();
    fast.detach();
  });
});
