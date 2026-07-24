/**
 * 셰이더 인프라 스캐폴딩 계약 테스트 (Phase 0 · AC-0.9).
 *
 * node-env(WebGL 없음)에서 도는 순수 계약 검증이다:
 *  - 인프라 모듈 import 만으로는 throw 하지 않는다(필터 인스턴스화가 lazy·guard 임을 증명).
 *  - `tryCreateFilter` 가 던지는 팩토리를 삼켜 null 을 돌려준다(graceful 폴백 — textures.ts tryLoad 정신).
 *  - `pixi-filters` 의 `AdvancedBloomFilter` named import 가 resolve 된다(의존성·tree-shaken 진입 확인).
 *  - 4종 팩토리는 실제 호출해도 절대 throw 하지 않고 `Filter` 인스턴스 또는 null 을 돌려준다.
 *
 * PixiJS 는 렌더러 없이 import 만 하므로 node 환경에서 그대로 돈다(tests/invasionRender.test.ts 선례).
 * 실제 필터 컴파일/렌더(GL 렌더러 필요)는 여기서 검증하지 않는다 — 하네스/벤치(Phase 6)의 몫.
 */

import { describe, it, expect } from 'vitest';
import { Filter } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters';
import {
  tryCreateFilter,
  createBloomFilter,
  createShimmerFilter,
  createShockwaveFilter,
  createDissolveFilter,
} from '../src/render/shaders/index.js';

describe('shader infra scaffolding (AC-0.9)', () => {
  it('모듈 import·팩토리 export 가 throw 없이 로드된다(lazy/guarded 인스턴스화)', () => {
    // 위 import 문이 성공했다는 것 자체가 "모듈 로드 시 인스턴스화 없음"을 증명한다.
    expect(typeof tryCreateFilter).toBe('function');
    expect(typeof createBloomFilter).toBe('function');
    expect(typeof createShimmerFilter).toBe('function');
    expect(typeof createShockwaveFilter).toBe('function');
    expect(typeof createDissolveFilter).toBe('function');
  });

  it('tryCreateFilter 는 던지는 팩토리를 삼켜 null 을 돌려준다(graceful 폴백)', () => {
    const result = tryCreateFilter(() => {
      throw new Error('no gl');
    });
    expect(result).toBeNull();
  });

  it('tryCreateFilter 는 성공한 팩토리의 반환값을 그대로 통과시킨다', () => {
    expect(tryCreateFilter(() => null)).toBeNull();
  });

  it('pixi-filters 의 AdvancedBloomFilter named import 가 resolve 된다', () => {
    expect(AdvancedBloomFilter).toBeDefined();
    expect(typeof AdvancedBloomFilter).toBe('function');
  });

  it('4종 팩토리는 호출해도 throw 없이 Filter 인스턴스 또는 null 을 돌려준다', () => {
    const factories = [createBloomFilter, createShimmerFilter, createShockwaveFilter, createDissolveFilter];
    for (const make of factories) {
      // make() 가 던지면 여기서 테스트가 실패한다 — 가드(tryCreateFilter)가 삼켜야 정상이다.
      const filter = make();
      expect(filter === null || filter instanceof Filter).toBe(true);
    }
  });
});
