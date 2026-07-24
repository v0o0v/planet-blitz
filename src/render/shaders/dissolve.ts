/**
 * 사망 디졸브 필터 — 손수 짠 WebGL GLSL 디더 알파 필터 (AC-0.9 스캐폴딩 → AC-3.4 룩).
 *
 * 디더 알파는 정수배율·nearest 픽셀아트와 친화적이라 채택됐다(ADR-0031). Phase 0 에서는
 * **최소 stub** 이다: `uProgress` 기본 0 이면 threshold 0 → 아무 픽셀도 안 지워짐(passthrough).
 * `uProgress`(0 온전 → 1 완전 소멸) 유니폼 파이프라인만 미리 배선한다. 실제 룩(디더 방식/방향)은
 * Phase 3 에서 채우고, 진행도는 순수함수(AC-3.5)로 공급한다. 기존 소멸 감지에 연동(AC-3.4).
 *
 * **WebGL GLSL 단일 언어**(WGSL 없음) — 렌더러 WebGL 고정(ADR-0031 · R4). glProgram-only 라
 * WebGPU 로 전환돼도 자동 no-op(폴백 뒤 격리, AC-3.6). 인스턴스화는 호출 시점에만.
 */

import { Filter, GlProgram } from 'pixi.js';
import { tryCreateFilter, FILTER_VERTEX } from './index.js';

/**
 * 디졸브 fragment(GLSL 300 es). 픽셀별 해시 노이즈 < `uProgress` 이면 지운다(디더 알파).
 * stub 단계는 uProgress 0 이라 `step(0.0, n)==1` → 전 픽셀 보존(passthrough).
 */
const DISSOLVE_FRAGMENT = `precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;

uniform float uProgress; // 0 = 온전, 1 = 완전 소멸

float hash(vec2 p)
{
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main(void)
{
    vec4 color = texture(uTexture, vTextureCoord);
    // 픽셀 격자 기준 해시(디더). uProgress 0 → step(0, n)=1 → 완전 passthrough(골든 렌더 불변).
    float n = hash(floor(vTextureCoord * uInputSize.xy));
    float keep = step(uProgress, n);
    finalColor = color * keep;
}
`;

export interface DissolveFilterOptions {
  /** 소멸 진행도(0 온전 → 1 완전 소멸). 기본 0. Phase 3 에서 소멸 감지 진행도 순수함수가 공급. */
  progress?: number;
}

/**
 * 디졸브 필터를 지연 생성한다(호출 시점에만 인스턴스화).
 * @returns 필터, 또는 생성/컴파일 실패 시 null(폴백).
 */
export function createDissolveFilter(options?: DissolveFilterOptions): Filter | null {
  return tryCreateFilter(
    () =>
      new Filter({
        glProgram: GlProgram.from({
          vertex: FILTER_VERTEX,
          fragment: DISSOLVE_FRAGMENT,
          name: 'pb-dissolve-filter',
        }),
        resources: {
          dissolveUniforms: {
            uProgress: { value: options?.progress ?? 0, type: 'f32' },
          },
        },
      }),
  );
}
