/**
 * 최소 Node 앰비언트 선언 (테스트 지원 전용).
 *
 * 이 저장소는 `@types/node`를 의존성에 두지 않고 tsconfig `types`를
 * `["vitest/globals"]`로 좁혀 둔다. 테스트가 실제로 쓰는 node 빌트인 표면만
 * 여기서 선언해 `tsc --noEmit`을 통과시킨다(런타임은 실제 Node라 동작).
 * 시뮬/프로덕션 코드는 이 선언을 쓰지 않는다.
 *
 * - tests/denoFixture.test.ts: fs.writeFileSync, url.fileURLToPath, process.version.
 * - tests/assetPrepSliceSheet.test.ts: fs 읽기/쓰기·임시 디렉터리 생성, os.tmpdir,
 *   path.join (scripts/asset-prep.mjs `slice-sheet` PNG 왕복 테스트용).
 */

declare module 'node:fs' {
  export function writeFileSync(path: string, data: string | Uint8Array, encoding?: string): void;
  export function readFileSync(path: string): Uint8Array;
  export function mkdtempSync(prefix: string): string;
  export function readdirSync(path: string): string[];
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:path' {
  export function join(...segments: string[]): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

declare const process: { readonly version: string };
