/**
 * 셰이더 인프라 — graceful 팩토리 허브 (Phase 0 · AC-0.9).
 *
 * 렌더러는 WebGL 고정(ADR-0031 · R4)이라 여기 손수 짠 필터는 **WebGL GLSL 단일 언어**로만
 * 작성한다(WGSL 없음). 훗날 WebGPU 로 전환하면 glProgram-only 필터는 자동으로 no-op 이 되고
 * (Pixi 는 해당 렌더러용 프로그램이 없으면 필터를 건너뛴다 — Filter.d.ts 주석), 이 폴백 뒤에서
 * 스택 전체가 살아남는다(AC-3.6).
 *
 * **핵심 계약(결정론·불사망):**
 *  - 이 모듈들은 render-only 다 — sim 상태·`hashWorld`/`hashEntity` 에 절대 접히지 않는다.
 *  - 필터 인스턴스화는 전부 **지연(lazy)·guard** 다: 모듈 import 만으로는 아무 필터도
 *    만들어지지 않는다(node-env vitest 에서 GL 없이 import 해도 throw 하면 안 되므로).
 *  - 실제 인스턴스화(GL 렌더러 필요)만 실패할 수 있고, `tryCreateFilter` 가 그 throw 를
 *    삼켜 null 을 돌려준다 — src/render/textures.ts 의 `tryLoad` 폴백 정신 그대로.
 *
 * 이 파일은 배럴이다: 공용 헬퍼(`tryCreateFilter`)·공용 필터 vertex(`FILTER_VERTEX`)를 먼저
 * 선언한 뒤 하위 필터 팩토리를 re-export 한다. 하위 모듈이 이 배럴에서 두 심볼을 import 하지만,
 * 둘은 재-export 문보다 **먼저** 초기화되고 하위 모듈은 **함수 본문(런타임)에서만** 참조하므로
 * 순환 import 가 안전하다.
 */

import type { Filter } from 'pixi.js';

/**
 * Pixi v8 필터 공용 vertex(WebGL GLSL 300 es). pixi.js 코어의 defaultFilter.vert 및
 * pixi-filters 의 default2 와 **동일**하다 — 손수 짠 fragment 는 이 vertex 를 재사용해
 * `vTextureCoord`·`uInputSize`·`uOutputFrame`·`uOutputTexture` 규약을 그대로 받는다.
 * `#version`·precision 은 Pixi 가 주입/보정하므로 여기 두지 않는다(GlProgram.d.ts 주석).
 */
export const FILTER_VERTEX = `in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;

    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

/**
 * 필터 생성 graceful 래퍼. 팩토리가 던지면(셰이더 컴파일·GL 접근 실패 등) 예외를 삼키고 null.
 * 호출부는 null 이면 **그 이펙트만 생략**하고 게임은 계속 돈다(AC-3.6).
 *
 * textures.ts `tryLoad` 와 같은 관용구 — "실패는 예외가 아니라 폴백"이다.
 */
export function tryCreateFilter<T extends Filter>(factory: () => T | null): T | null {
  try {
    return factory();
  } catch {
    return null;
  }
}

export { createBloomFilter, type BloomFilterOptions } from './bloom.js';
export { createShimmerFilter, type ShimmerFilterOptions } from './shimmer.js';
export { createShockwaveFilter, type ShockwaveFilterOptions } from './shockwave.js';
export { createDissolveFilter, type DissolveFilterOptions } from './dissolve.js';
