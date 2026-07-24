/**
 * 히트 시머 필터 — 손수 짠 WebGL GLSL 변위 필터 (AC-0.9 스캐폴딩 → AC-3.2 룩).
 *
 * Phase 0 에서는 **최소 변위 stub** 이다: `uStrength` 기본 0 이면 완전 passthrough 라
 * 기존/골든 렌더가 불변이다. `uTime` 유니폼 파이프라인만 미리 배선해 둔다. 실제 룩(용암 해저드·
 * 보스 과열 창 위 국소 변위)은 Phase 3 에서 채운다.
 *
 * **WebGL GLSL 단일 언어**(WGSL 없음) — 렌더러 WebGL 고정(ADR-0031 · R4). glProgram-only 라
 * WebGPU 로 전환돼도 자동 no-op(폴백 뒤 격리, AC-3.6). 인스턴스화는 호출 시점에만.
 */

import { Filter, GlProgram } from 'pixi.js';
import { tryCreateFilter, FILTER_VERTEX } from './index.js';

/**
 * 시머 fragment(GLSL 300 es — Pixi 가 `#version`·precision 을 주입/보정).
 * `uTexture`/`vTextureCoord`/`uInputSize` 는 Pixi 필터 규약이 제공한다(shockwave2 GLSL 선례).
 */
const SHIMMER_FRAGMENT = `precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;

uniform float uTime;
uniform float uStrength;

void main(void)
{
    // 최소 변위 stub: uStrength 기본 0 → 오프셋 0 → 완전 passthrough(골든 렌더 불변).
    vec2 uv = vTextureCoord;
    uv.x += sin(uv.y * 24.0 + uTime) * uStrength / uInputSize.x;
    finalColor = texture(uTexture, uv);
}
`;

export interface ShimmerFilterOptions {
  /** 애니메이션 위상(render-only 시간 — 초·틱 등). 기본 0. */
  time?: number;
  /** 수평 변위 세기(px). 기본 0 = passthrough. Phase 3 에서 해저드/과열 룩 값으로 채운다. */
  strength?: number;
}

/**
 * 시머 필터를 지연 생성한다(호출 시점에만 인스턴스화).
 * @returns 필터, 또는 생성/컴파일 실패 시 null(폴백).
 */
export function createShimmerFilter(options?: ShimmerFilterOptions): Filter | null {
  return tryCreateFilter(
    () =>
      new Filter({
        glProgram: GlProgram.from({
          vertex: FILTER_VERTEX,
          fragment: SHIMMER_FRAGMENT,
          name: 'pb-shimmer-filter',
        }),
        resources: {
          shimmerUniforms: {
            uTime: { value: options?.time ?? 0, type: 'f32' },
            uStrength: { value: options?.strength ?? 0, type: 'f32' },
          },
        },
      }),
  );
}
