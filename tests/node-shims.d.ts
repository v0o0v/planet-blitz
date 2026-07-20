/**
 * 최소 Node 앰비언트 선언 (테스트 지원 전용).
 *
 * 이 저장소는 `@types/node`를 의존성에 두지 않고 tsconfig `types`를
 * `["vitest/globals"]`로 좁혀 둔다. Deno 교차 검증 픽스처 생성기
 * (tests/denoFixture.test.ts)와 프레임 텍스처 기하 검증
 * (tests/panelFrameGeometry.test.ts)만 node 빌트인을 쓰므로, 여기서 그 표면만 선언해
 * `tsc --noEmit`을 통과시킨다(런타임은 실제 Node라 동작).
 * 시뮬/프로덕션 코드는 이 선언을 쓰지 않는다.
 */

declare module 'node:fs' {
  export function writeFileSync(path: string, data: string, encoding: string): void;
  export function readFileSync(path: string): Uint8Array;
}

declare module 'node:zlib' {
  export function inflateSync(data: Uint8Array): Uint8Array;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

declare const process: { readonly version: string };
