import { defineConfig } from 'vite';

/**
 * 밸런스 하네스 번들 설정 — `src/bench/balance/index.ts` 를 node 가 바로 실행할 수 있는
 * 단일 `.mjs` 로 묶는다.
 *
 * ## 왜 번들이 필요한가
 * 이 워크트리에는 `vite-node` 가 없고(balance-impl §0.1), node 의 타입 스트리핑은 리포 전역
 * 규약인 `'./foo.js'` 형태의 확장자 import 를 `.ts` 로 되짚지 못한다. 그래서 sim 을 node 에서
 * 돌리는 방법은 **vite 로 한 번 묶는 것**뿐이다. 대안이던 "임시 vitest 파일로 측정"은 매번
 * 손으로 짜야 하고(재현 불가) vitest 가 파일 단위로만 병렬화돼 워커를 못 쓴다.
 *
 * 묶고 나면 `node:worker_threads` 로 코어 수만큼 병렬 실행할 수 있다 — 10분 예산의 실체가
 * 이 병렬화다.
 *
 * 산출물은 `.balance/bundle/` 이고 gitignore 대상이다(소스가 원본).
 */
export default defineConfig({
  build: {
    ssr: true,
    outDir: '.balance/bundle',
    emptyOutDir: true,
    target: 'node20',
    // 측정 코드라 난독화 이득이 없고, 스택 트레이스가 읽히는 편이 진단에 낫다.
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: 'src/bench/balance/index.ts',
      output: { entryFileNames: 'balance.mjs', format: 'es' },
    },
  },
});
