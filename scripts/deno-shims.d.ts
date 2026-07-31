/**
 * 최소 Deno 앰비언트 선언 (`scripts/` 타입체크 지원 전용 — `tsconfig.scripts.json` 이 읽는다).
 *
 * 이 저장소는 `@types/deno` 를 의존성에 두지 않는다. `scripts/deno-verify/*.ts` 는 Deno 런타임
 * 에서 도는 검증 하네스라 `Deno.*` 전역을 쓰는데, 그 파일들이 **`src/sim` 을 소스 그대로
 * import** 하므로 타입체크를 포기하면 sim 시그니처 변경이 여기서만 런타임에 깨진다.
 * 그래서 실제로 쓰는 표면만 좁게 선언한다(`tests/node-shims.d.ts` 와 같은 규율).
 *
 * ⚠️ 여기 없는 API 를 쓰면 `pnpm exec tsc -p tsconfig.scripts.json --noEmit` 만 깨진다
 * (Deno 런타임은 잘 돈다). 새 API 를 쓸 때 이 선언을 먼저 넓혀라.
 */

declare const Deno: {
  readonly version: { readonly deno: string; readonly v8: string; readonly typescript: string };
  readTextFileSync(path: string | URL): string;
  exit(code?: number): never;
};
