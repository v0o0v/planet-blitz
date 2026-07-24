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
 * 충격파 fragment(GLSL 300 es). `uCenter`·`uProgress`·`uAmplitude`(px)·`uWidth`(링 반두께)로
 * 중심에서 바깥으로 퍼지는 **원형** 반경 링 변위를 준다.
 *
 * **항등 불변(반드시 보존):** `uAmplitude` 기본 0 → `offset` 이 항상 0 → `texture(uTexture, uv)` 로
 * 원본을 그대로 되돌린다(shaderInfra.test·골든 렌더 불변). progress 0→1 로 링이 중심→가장자리로
 * 퍼지고, uWidth 로 링 두께를, uAmplitude 로 왜곡 세기를 조절한다. 셀 종횡비를 보정해 링이
 * 타원이 아니라 원이 되게 한다.
 */
const SHOCKWAVE_FRAGMENT = `precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;

uniform vec2 uCenter;     // 텍스처 좌표(0..1) 중심
uniform float uProgress;  // 링 반경 진행도(0..1)
uniform float uAmplitude; // 변위 진폭(px). 기본 0 → 항등(passthrough)
uniform float uWidth;     // 링 반두께(진행도 0..1 단위). 작을수록 얇고 날카로운 링

void main(void)
{
    vec2 uv = vTextureCoord;
    vec2 dir = uv - uCenter;

    // 셀 종횡비 보정 — 왜곡 링이 타원이 아니라 원이 되도록 x 축을 종횡비만큼 늘려 거리 계산.
    float aspect = uInputSize.x / max(uInputSize.y, 1.0);
    vec2 radial = vec2(dir.x * aspect, dir.y);
    float dist = length(radial);

    // 반경 uProgress 근방에서 1, uWidth 밖으로 부드럽게 0 이 되는 링 프로파일.
    float w = max(uWidth, 1e-4);
    float ring = 1.0 - smoothstep(0.0, w, abs(dist - uProgress));

    // uAmplitude 기본 0 → offset 0 → 완전 passthrough(항등 불변, 골든 렌더 불변).
    vec2 offset = normalize(dir + vec2(1e-6)) * ring * uAmplitude / uInputSize.xy;
    finalColor = texture(uTexture, uv + offset);
}
`;

export interface ShockwaveFilterOptions {
  /** 링 중심(텍스처 좌표 0..1). 기본 중앙 [0.5, 0.5]. */
  center?: readonly [number, number];
  /** 링 반경 진행도(0..1). 기본 0. Phase 3 에서 `shockwaveProgress` 순수함수가 공급. */
  progress?: number;
  /** 변위 진폭(px). 기본 0 = passthrough(항등). */
  amplitude?: number;
  /** 링 반두께(진행도 0..1 단위). 기본 0.08. 작을수록 얇은 링. */
  width?: number;
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
            uWidth: { value: options?.width ?? 0.08, type: 'f32' },
          },
        },
      }),
  );
}
