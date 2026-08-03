import { defineConfig, configDefaults } from 'vitest/config';

/**
 * **sim 레인** — 기본 스위트에서 빼고 필요할 때만 도는 계측·골든 파일 목록.
 *
 * 실행: `pnpm test:sim` (설정은 {@link file://./vite.sim.config.ts}).
 *
 * ## 왜 뺐는가 — 실측 (2026-08-03, 16코어)
 * 전체 275파일의 작업량 1591초 중 **이 8개가 1296초(81%)** 다. 특히
 * `commissionBandMeasure.test.ts` 는 **모듈 스코프에서 계측을 9번**(계급 4 × typical/max +
 * elite, 각 96시드) 돌리는데, 그 비용이 전부 **collect(모듈 평가)** 단계라 `duration` 에 안
 * 잡힌다 — 리포터도 JSON 도 이 파일을 `0ms` 로 보고한다. vitest 기본 시퀀서는 duration(없으면
 * 파일 크기)으로 정렬하므로 이 파일을 **275개 중 맨 마지막**에 배치했고, 나머지 274개가 모두
 * 끝난 뒤(threads 기준 +373초) **혼자 719초**를 돌았다. 즉 벽시계의 3분의 2가 마지막 한 파일이었다.
 *
 * ## 왜 "파일 분할"이 아니라 "레인 분리"인가
 * 계측 파일을 계급별로 쪼개는 안을 먼저 검토했으나 이득이 없다 — 단언 3개가 9개 밴드를
 * **전부** 필요로 한다(니플헤임 격차 검사는 밴드 9개를 일부러 전수 나열해 두었다. 과거 리뷰
 * MAJOR-3 에서 "밴드가 조용히 빠지는" 결함을 잡아 굳힌 방어다). 그래서 어떻게 쪼개도 그 3개를
 * 담는 파일은 9개를 다 계측해야 하고, 나머지 파일은 중복 계측만 늘린다.
 *
 * ## 왜 딱 이 여덟 개인가 — 넓히면 값을 못 한다
 * "sim 을 구동하는 파일을 전부"라는 더 넓은 경계(계측 7 + 결정론 골든 7 + 완주 e2e 8 = 22개)도
 * 재봤다. **기본 레인 벽시계가 55초에서 약 50초로, 5초밖에 안 줄었다.** 추가되는 14개는 다
 * 합쳐야 108초짜리라 워커 15개에 흩어지면 사라지고, 벽시계는 남은 최장 파일(`envAtmosphere`
 * 22.6초)과 고정 오버헤드(약 29초)가 정한다. 반면 잃는 것은 분명하다 — `rng`·`chunkDeterminism`·
 * `standardBuild`·`autopilot`·`verifyInvasion`(237건) 같은 **사실상 공짜인 순수 단위 테스트**가
 * 기본 스위트에서 사라진다. 그래서 경계를 넓히지 않고 **비싼 여덟 개만** 뺀다.
 *
 * 이 여덟 개는 두 기준을 동시에 만족한다: ①작업량의 81% 를 차지한다 ②main 기준 **기존 실패
 * 58건이 전부 여기 있다**(골든 해시 발산). 그래서 레인을 가르면 기본 스위트가 빨라지는 동시에
 * 초록이 된다.
 *
 * 남은 파일들은 sim 을 **호출**하더라도 단언이 순수 계약이라(탄 거동 tick 함수, 침공 스키마,
 * 조우 매트릭스 등) 다 합쳐도 수십 초다 — 뺄 이유가 없다.
 */
export const SIM_LANE_FILES: readonly string[] = [
  // 계측 — 수치를 잰다.
  'tests/commissionBandMeasure.test.ts',
  'tests/planetPopularity.test.ts',
  'tests/invasionBalance.test.ts',

  // 결정론·골든 해시 — 재현성을 잰다.
  'tests/denoFixture.test.ts',
  'tests/shipHashBaseline.test.ts',
  'tests/encounterHashInvariance.test.ts',

  // 완주 e2e — 런 전체를 돌린다.
  'tests/fullRun.test.ts',
  'tests/planetTierCompletion.test.ts',
];

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
    /**
     * 계측·골든 레인은 기본 스위트에서 뺀다({@link SIM_LANE_FILES} 에 근거).
     * `configDefaults.exclude` 를 반드시 펼쳐 넣어야 한다 — 통째로 덮으면 `node_modules`
     * 와 `dist` 가 다시 수집 대상이 된다.
     */
    exclude: [...configDefaults.exclude, ...SIM_LANE_FILES],
    /**
     * `forks`(기본) 대신 `threads`.
     *
     * 이 스위트의 비용은 테스트 실행이 아니라 **collect** 다 — 275개 중 80개가 `src/render` 를,
     * 53개가 `src/ui/pixi/*` 를, 33개가 `pixi.js` 를 직접 끌어온다. `forks` 는 파일마다 프로세스가
     * 격리돼 그 무거운 모듈 그래프를 매번 새로 평가한다. 실측(2026-08-03, 16코어)에서 같은
     * 5957통과/58실패를 유지한 채 벽시계 1548초 → 1095초였고, 파일별로도 일관되게 줄었다
     * (예: `denoFixture` 646초 → 339초).
     */
    pool: 'threads',
  },
}));
