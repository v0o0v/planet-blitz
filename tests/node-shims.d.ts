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
 * - tests/uiAssetPresence.test.ts · tests/catalystIconAssets.test.ts:
 *   path.dirname/resolve (테스트 파일 위치 기준으로 `assets/` 절대경로 유도).
 *
 * ⚠️ 여기 없는 API 를 테스트에서 쓰면 **vitest 는 통과하는데 `tsc --noEmit` 만 깨진다**
 * (런타임은 실제 Node 라 잘 돈다). `pnpm build` 가 `tsc --noEmit && vite build` 라
 * 빌드가 통째로 막히므로, 새 node 빌트인을 쓸 때는 이 선언을 먼저 넓혀라.
 */

declare module 'node:fs' {
  export function writeFileSync(path: string, data: string | Uint8Array, encoding?: string): void;
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: string): string;
  export function mkdtempSync(prefix: string): string;
  export function readdirSync(path: string): string[];
  /**
   * 디렉터리 재귀 순회(tests/renderWiring.test.ts) + 자산 실물·크기 대조
   * (tests/modelManifest.test.ts — 커밋된 GLB 가 웹 예산 안인지 잰다).
   */
  export function statSync(path: string): {
    isDirectory(): boolean;
    isFile(): boolean;
    size: number;
  };
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:path' {
  export function join(...segments: string[]): string;
  export function resolve(...segments: string[]): string;
  export function dirname(path: string): string;
  /** `src/render/` 기준 상대 경로 산출용(tests/renderWiring.test.ts 의 하위 디렉터리 재귀 스캔). */
  export function relative(from: string, to: string): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

declare const process: {
  readonly version: string;
  readonly env: Record<string, string | undefined>;
};
