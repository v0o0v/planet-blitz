/**
 * 충격파 링 필터 — 손수 짠 WebGL GLSL 반경 변위 필터 (AC-0.9 스캐폴딩 → AC-3.3 룩).
 *
 * pixi-filters 의 `ShockwaveFilter` 를 쓰지 않고 **직접** 짠다(합의 R7 — 블룸만 라이브러리,
 * 나머지 핸드 GLSL). Phase 0 에서는 **최소 stub** 이다: `uAmplitude` 기본 0 이면 오프셋 0 →
 * passthrough. `uProgress`(0..1 진행도) 유니폼 파이프라인만 미리 배선한다. 실제 룩(보스 처치·
 * 대형 폭발 순간 짧은 원형 왜곡)은 Phase 3 에서 채운다 — 진행도는 순수함수(AC-3.5)로 공급.
 *
 * **WebGL GLSL 단일 언어**(WGSL 없음) — 렌더러 WebGL 고정(ADR-0031 · R4). glProgram-only 라
 * WebGPU 로 전환돼도 자동 no-op(폴백 뒤 격리, AC-3.6). 인스턴스화는 호출 시점에만.
 */

import { Filter, GlProgram } from 'pixi.js';
import { tryCreateFilter, FILTER_VERTEX } from './index.js';

/**
 * 충격파 fragment(GLSL 300 es). `uCenter`·`uProgress`·`uAmplitude`(px)로 반경 링 변위를
 * 준다. stub 단계는 진폭 0 이라 원본을 그대로 되돌린다.
 */
const SHOCKWAVE_FRAGMENT = `precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;

uniform vec2 uCenter;     // 텍스처 좌표(0..1) 중심
uniform float uProgress;  // 링 반경 진행도(0..1)
uniform float uAmplitude; // 변위 진폭(px)

void main(void)
{
    // 최소 stub: uAmplitude 기본 0 → offset 0 → 완전 passthrough(골든 렌더 불변).
    vec2 uv = vTextureCoord;
    vec2 dir = uv - uCenter;
    float dist = length(dir);
    float ring = max(1.0 - abs(dist - uProgress) * 8.0, 0.0);
    vec2 offset = normalize(dir + vec2(1e-6)) * ring * uAmplitude / uInputSize.xy;
    finalColor = texture(uTexture, uv + offset);
}
`;

export interface ShockwaveFilterOptions {
  /** 링 중심(텍스처 좌표 0..1). 기본 중앙 [0.5, 0.5]. */
  center?: readonly [number, number];
  /** 링 반경 진행도(0..1). 기본 0. Phase 3 에서 `shockwaveProgress` 순수함수가 공급. */
  progress?: number;
  /** 변위 진폭(px). 기본 0 = passthrough. */
  amplitude?: number;
}

/**
 * 충격파 필터를 지연 생성한다(호출 시점에만 인스턴스화).
 * @returns 필터, 또는 생성/컴파일 실패 시 null(폴백).
 */
export function createShockwaveFilter(options?: ShockwaveFilterOptions): Filter | null {
  const center = options?.center ?? [0.5, 0.5];
  return tryCreateFilter(
    () =>
      new Filter({
        glProgram: GlProgram.from({
          vertex: FILTER_VERTEX,
          fragment: SHOCKWAVE_FRAGMENT,
          name: 'pb-shockwave-filter',
        }),
        resources: {
          shockwaveUniforms: {
            uCenter: { value: new Float32Array([center[0], center[1]]), type: 'vec2<f32>' },
            uProgress: { value: options?.progress ?? 0, type: 'f32' },
            uAmplitude: { value: options?.amplitude ?? 0, type: 'f32' },
          },
        },
      }),
  );
}
