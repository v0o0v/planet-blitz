/**
 * 블룸 필터 — pixi-filters `AdvancedBloomFilter` 의 tree-shaken 래퍼 (AC-0.9 · AC-3.1).
 *
 * 발광은 발광체(발광 렌더타깃·glowLayer)에만, High 티어에서만 1패스 건다(ADR-0031 ③).
 * **named import** 라 번들러가 나머지 pixi-filters 필터를 트리셰이킹으로 제거한다(R7 — 번들 증가 방어).
 * `AdvancedBloomFilter` 는 듀얼 백엔드(WebGL/WebGPU) 라이브러리라 WebGL 고정과 충돌이 없다(R9).
 *
 * 생성은 `tryCreateFilter` 로 감싸 실패 시 null — 폴백(효과 생략)으로 게임 불사망(AC-3.6).
 * 인스턴스화는 **호출 시점에만** 한다(모듈 로드 시 아님) — node-env import 안전.
 */

import { AdvancedBloomFilter, type AdvancedBloomFilterOptions } from 'pixi-filters';
import type { Filter } from 'pixi.js';
import { tryCreateFilter } from './index.js';

/** 블룸 옵션(pixi-filters 재-export). threshold·bloomScale·brightness·blur·kernels·quality 등. */
export type BloomFilterOptions = AdvancedBloomFilterOptions;

/**
 * 블룸 필터를 지연 생성한다(호출 시점에만 인스턴스화).
 *
 * 파라미터(발광 세기·threshold·반경 등)는 전부 밸런스 대상이라, Phase 1 갤러리에서 선택된
 * 글로우 룩으로 Phase 3(AC-3.1)에서 채운다. 지금은 옵션 그대로 통과시키는 스캐폴딩이다.
 *
 * @returns 필터, 또는 생성 실패 시 null(폴백 — 효과 생략, 게임 계속).
 */
export function createBloomFilter(options?: BloomFilterOptions): Filter | null {
  return tryCreateFilter(() => new AdvancedBloomFilter(options));
}
