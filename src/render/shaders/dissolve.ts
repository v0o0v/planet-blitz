/**
 * 사망 디졸브 필터 — 손수 짠 WebGL GLSL 디더 알파 필터 (AC-0.9 스캐폴딩 → AC-3.4 룩).
 *
 * 디더 알파는 정수배율·nearest 픽셀아트와 친화적이라 채택됐다(ADR-0031). Phase 1 갤러리(AC-1.3)
 * 에서 실 프로덕션 코드로 렌더하기 위해 **실 디더-알파 룩**을 채웠다: 셀 격자 해시 디더 + 스윕
 * 그라디언트(방향/방사)로 소멸 순서를 준다. `uProgress`(0 온전 → 1 완전 소멸) 유니폼이 소멸을
 * 몰고, 진행도는 순수함수(AC-3.5)로 공급한다. 기존 소멸 감지에 연동(AC-3.4).
 *
 * **passthrough 불변(골든 렌더·shaderInfra 계약):** 모든 스윕 마스크를 [0,1] 로 클램프하므로
 * `uProgress == 0` 이면 `step(0.0, mask>=0) == 1` → 전 픽셀 보존(항등). uProgress 를 0→1 로 올릴
 * 때만 디더 소멸이 진행된다. 기본 유니폼값(방향 [0,-1]·비방사·셀 4px)도 progress 0 이면 항등.
 *
 * **WebGL GLSL 단일 언어**(WGSL 없음) — 렌더러 WebGL 고정(ADR-0031 · R4). glProgram-only 라
 * WebGPU 로 전환돼도 자동 no-op(폴백 뒤 격리, AC-3.6). 인스턴스화는 호출 시점에만.
 */

import { Filter, GlProgram } from 'pixi.js';
import { tryCreateFilter, FILTER_VERTEX } from './index.js';

/**
 * 디졸브 fragment(GLSL 300 es). 셀 격자 해시 디더로 픽셀아트 친화 알파 컷을 낸다.
 *
 *  - `uCell` px 단위로 양자화한 좌표에 해시 → 정수배율·nearest 와 어긋나지 않는 블록 디더.
 *  - 스윕 그라디언트 `grad`(0=먼저 소멸, 1=마지막): `uMode` 0 이면 방향(`uDir`), 1 이면 방사
 *    (중심→바깥). 여기에 해시 지터(`uBand`)를 더해 디더 마스크를 만든다.
 *  - 마스크를 [0,1] 로 클램프해 `uProgress 0 → step(0, mask)=1` → 완전 passthrough(골든 불변).
 *    `uProgress` 가 마스크를 넘어서는 픽셀부터 지워져 소멸 경계가 스윕 방향으로 전진한다.
 */
const DISSOLVE_FRAGMENT = `precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;

uniform float uProgress; // 0 = 온전, 1 = 완전 소멸
uniform vec2  uDir;      // 방향 모드 스윕 방향(단위 벡터). 방사 모드에선 무시.
uniform float uMode;     // 0 = 방향 그라디언트, 1 = 방사(중심→바깥)
uniform float uCell;     // 디더 셀 크기(px). 클수록 큰 픽셀 조각.
uniform float uBand;     // 디더 지터 대역(그라디언트에 더해지는 해시 폭).

float hash(vec2 p)
{
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main(void)
{
    vec4 color = texture(uTexture, vTextureCoord);

    // 픽셀아트 친화 셀 격자 해시(디더). uCell px 단위로 양자화한 셀에 해시.
    vec2 cell = floor(vTextureCoord * uInputSize.xy / max(uCell, 1.0));
    float n = hash(cell);

    // 스윕 그라디언트: 방향(mode 0) 또는 방사(mode 1). 0=먼저 소멸, 1=마지막.
    float grad;
    if (uMode > 0.5) {
        // 중심(0.5,0.5)에서의 정규화 거리. 대각선 반길이 0.7071 로 나눠 [0,1] 정규화.
        grad = clamp(length(vTextureCoord - vec2(0.5)) / 0.70710678, 0.0, 1.0);
    } else {
        grad = clamp(0.5 + dot(vTextureCoord - vec2(0.5), uDir), 0.0, 1.0);
    }

    // 디더 마스크: 그라디언트 + 해시 지터. [0,1] 클램프로 uProgress==0 → 전 픽셀 보존(passthrough).
    float mask = clamp(grad + (n - 0.5) * uBand, 0.0, 1.0);

    // uProgress 가 마스크를 넘어서면 픽셀 제거. progress 0 → step(0, mask>=0)=1 → 항등.
    float keep = step(uProgress, mask);
    finalColor = color * keep;
}
`;

export interface DissolveFilterOptions {
  /** 소멸 진행도(0 온전 → 1 완전 소멸). 기본 0. 소멸 감지 진행도 순수함수가 공급. */
  progress?: number;
  /** 방향 모드 스윕 방향(단위 벡터). 기본 [0,-1] = 아래→위 소멸. 방사 모드에선 무시. */
  direction?: readonly [number, number];
  /** true 면 중심→바깥 방사 디졸브. 기본 false(방향 모드). */
  radial?: boolean;
  /** 디더 셀 크기(px). 클수록 큰 픽셀 조각으로 흩어진다. 기본 4. */
  cell?: number;
  /** 디더 지터 대역(그라디언트에 더해지는 해시 폭). 클수록 소멸 경계가 거칠다. 기본 0.35. */
  band?: number;
}

/**
 * 디졸브 필터를 지연 생성한다(호출 시점에만 인스턴스화).
 * @returns 필터, 또는 생성/컴파일 실패 시 null(폴백).
 */
export function createDissolveFilter(options?: DissolveFilterOptions): Filter | null {
  const dir = options?.direction ?? [0, -1];
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
            uDir: { value: new Float32Array([dir[0], dir[1]]), type: 'vec2<f32>' },
            uMode: { value: options?.radial ? 1 : 0, type: 'f32' },
            uCell: { value: options?.cell ?? 4, type: 'f32' },
            uBand: { value: options?.band ?? 0.35, type: 'f32' },
          },
        },
      }),
  );
}
