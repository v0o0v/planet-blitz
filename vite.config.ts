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
/**
 * ## 재측정 (2026-08-04, 같은 16코어) — 꼬리 파일이 재발했다
 *
 * 위 분리 이후 스위트가 280파일 6099건으로 자랐고, 벽시계는 57초가 아니라 **241초**였다.
 * 분해는 collect 1183초 · tests 907초 · prepare 215초 · transform 123초(16워커 합산 작업량).
 *
 * 파일별로는 **`balanceHarness.test.ts` 혼자 202.5초**로, tests 907초의 22% 다. 2위
 * `progressionPath`(59.2초)의 3.4배이므로 이 파일이 벽시계 꼬리를 혼자 정한다 — 8월 3일에
 * `commissionBandMeasure` 를 뺐을 때와 **똑같은 병리**다. 그래서 같은 기준으로 sim 레인에
 * 넘긴다: 이 파일은 단위 계약이 아니라 **밸런스 하네스 예산제 자체를 계측**하는 파일이라
 * 코드 한 줄마다 돌 이유가 없다.
 *
 * 3~5위(`progressionPath` 59초 · `planetDrops` 54초 · `verifyRun` 52초)는 **남긴다**. 셋 다
 * 합쳐도 165초라 16워커에 흩어지면 벽시계에 안 나타나고, 반대로 회귀 면적(진행 곡선·드롭
 * 테이블·리플레이 검증)은 매 편집에 지키고 싶은 축이다.
 */
export const SIM_LANE_FILES: readonly string[] = [
  // 계측 — 수치를 잰다.
  'tests/commissionBandMeasure.test.ts',
  'tests/planetPopularity.test.ts',
  'tests/invasionBalance.test.ts',
  'tests/balanceHarness.test.ts',

  // 결정론·골든 해시 — 재현성을 잰다.
  'tests/denoFixture.test.ts',
  'tests/shipHashBaseline.test.ts',
  'tests/encounterHashInvariance.test.ts',

  // 완주 e2e — 런 전체를 돌린다.
  'tests/fullRun.test.ts',
  'tests/planetTierCompletion.test.ts',
];

export default defineConfig(({ command, mode }) => ({
  /**
   * GitHub Pages **프로젝트 페이지**는 리포 이름이 경로 접두사가 된다
   * (`https://v0o0v.github.io/planet-blitz/`). 번들이 참조하는 자산 URL 이 `/assets/...`
   * 로 나가면 전부 404 이므로 빌드 산출물의 base 를 `/planet-blitz/` 로 고정한다.
   *
   * **build 일 때만** 바꾼다 — dev 서버까지 접두사가 붙으면 `localhost:5180/` 이 빈
   * 화면이 되고 하네스 절차(포트 루트 접속)가 통째로 깨진다.
   *
   * 소스에 `/assets/...` 같은 절대 경로 리터럴은 없다(전부 `import` 또는
   * `import.meta.glob`) — 그래서 base 만 바꾸면 자산 경로는 vite 가 알아서 다시 쓴다.
   * 커스텀 도메인으로 옮기면 이 값을 `'/'` 로 되돌려야 한다.
   */
  base: command === 'build' ? '/planet-blitz/' : '/',
  /**
   * `.glb` 를 **자산으로 선언**한다 — 이게 없으면 `vitest run --changed` 가 죽는다.
   *
   * 평소 실행은 멀쩡하다. `bossActor.ts` 의 `import.meta.glob('*.glb', { query: '?url' })` 이
   * 지연 로딩이라 `.glb` 는 아무도 transform 하지 않기 때문이다. 그런데 `--changed` 는 "무엇이
   * 무엇을 임포트하는가"를 알아야 하므로 **전체 모듈 그래프를 미리 만든다** — 그 과정에서 글롭
   * 대상을 전부 훑고, `?url` 쿼리가 떨어진 채 `.glb` 를 JS 로 파싱하려다 `Collect Error` 로
   * 터진다(실측: 선택 결과 0개 + import-analysis 오류). 자산으로 선언해 두면 그래프 빌드가
   * 이 파일들을 URL 로 취급하고 지나간다.
   *
   * 빌드 거동은 안 바뀐다 — `?url` 경로는 원래도 해시된 URL 문자열만 번들에 넣는다.
   */
  assetsInclude: ['**/*.glb'],
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
    /**
     * 소스맵은 **로컬 빌드에서만** 켠다.
     *
     * Pages 사이트는 리포가 private 이어도 공개로 뜬다. 소스맵을 같이 올리면 `.ts` 원본이
     * 통째로 복원되므로(밸런스 수치·치트 패널 구조·주석 전부) CI 배포에서는 끈다. 로컬
     * `pnpm build`(CI env 없음)에서는 그대로 남아 디버깅에 쓴다.
     */
    sourcemap: process.env.CI !== 'true',
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
    /**
     * `poolOptions.threads.isolate: false` 는 **재봤고 안 쓴다**(2026-08-04 A/B, 16코어).
     *
     * 효과는 확실하다 — 워커가 모듈 레지스트리를 공유하므로 collect 671초 → 171초,
     * prepare 175초 → 10초. 하지만 벽시계는 113초 → 95.6초로 **18초(16%)밖에** 안 줄었다.
     * 이 시점의 벽시계는 이미 collect 가 아니라 가장 긴 테스트 파일이 정하기 때문이다.
     *
     * 대가가 그 18초보다 크다. 같은 실행에서 `spriteAnimation.test.ts` 가 깨졌다 —
     * `enemyVisual.ts` 의 모듈 스코프 `debris` 배열이 파일 경계를 넘어 살아남아, 앞선 파일이
     * destroy 한 pixi 노드를 굴리다 `Cannot read properties of null` 로 터진다.
     * `resetEnemyVisualState()` 를 `beforeEach` 에 넣으면 닫히는 1건이지만, 요점은 그 한 건이
     * 아니라 **파일 실행 순서가 바뀔 때마다 다른 모듈 전역이 같은 식으로 튀어나온다**는 것이다.
     * 결정론·골든을 다루는 리포에서 순서 의존 플래키를 상시로 안고 가는 값이 18초보다 비싸다.
     */
  },
}));
