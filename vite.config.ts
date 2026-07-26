import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  /**
   * 테스트(`mode === 'test'`)일 때만 env 디렉터리를 **.env 가 없는 곳**으로 돌린다.
   *
   * `src/net/config.ts` 는 "vitest 는 VITE_* 를 정의하지 않는다"를 전제로 쓰였지만, vitest 는
   * Vite 의 env 로딩을 그대로 쓰므로 리포 루트의 **gitignore 된 `.env.local` 을 집어 간다**.
   * 그러면 `readSupabaseConfig()` 가 non-null 이 되어 재화 소비(창고 확장·리롤·리스펙)가 로컬
   * 폴백 대신 온라인 RPC 경로로 가고, 네트워크가 없으니 `rejected` 로 떨어져 "미설정이면 로컬
   * 차감"을 전제한 테스트 4건이 깨진다.
   *
   * 즉 스위트의 색이 **개발자 머신에 `.env.local` 이 있는지**에 좌우됐다 — 있으면 빨강, 없는
   * 머신·CI 는 초록이라 같은 커밋인데 결과가 갈렸다. dev/build 는 루트 env 를 그대로 써야 하므로
   * (실제 Supabase 연결) 오직 test 모드에서만 갈아 끼운다. 온라인 경로를 보려는 테스트는 지금처럼
   * `deps.gateway` 주입이나 `vi.spyOn` 으로 **명시**하면 된다.
   */
  ...(mode === 'test' ? { envDir: 'tests' } : {}),
  server: {
    port: 5180,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
