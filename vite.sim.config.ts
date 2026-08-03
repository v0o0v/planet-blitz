import { defineConfig } from 'vitest/config';
import { SIM_LANE_FILES } from './vite.config.js';

/**
 * **sim 레인** 전용 vitest 설정 — `pnpm test:sim`.
 *
 * 기본 스위트({@link file://./vite.config.ts})가 빼둔 계측·골든 파일만 돌린다. 목록의 근거와
 * "왜 뺐는가"는 {@link SIM_LANE_FILES} 주석에 있다. 여기서는 **그 목록을 import 해서** 쓴다 —
 * 두 곳에 손으로 적으면 한쪽만 고쳐져 파일이 어느 레인에서도 안 도는 사태가 난다.
 *
 * 언제 도는가: sim(`src/sim/**`)·밸런스 수치·`src/bench/**` 를 건드렸을 때. 단위 테스트가 아니라
 * **계측**이라 코드 한 줄마다 돌 이유가 없다.
 */
export default defineConfig(({ mode }) => ({
  /**
   * 기본 설정과 **같은 이유로** 테스트 때 env 디렉터리를 옮긴다 — 리포 루트의 gitignore 된
   * `.env.local` 을 vitest 가 집어 가면 `readSupabaseConfig()` 가 non-null 이 되어 재화 소비가
   * 온라인 RPC 경로로 빠진다. 근거 전문은 `vite.config.ts` 의 같은 자리에 있다.
   */
  ...(mode === 'test' ? { envDir: 'tests' } : {}),
  test: {
    globals: true,
    environment: 'node',
    /** 기본 스위트가 `exclude` 한 바로 그 목록이 여기서는 `include` 다. */
    include: [...SIM_LANE_FILES],
    /** 근거는 `vite.config.ts` 의 `pool` 주석(collect 지배 → 프로세스 격리가 비싸다). */
    pool: 'threads',
    /**
     * 이 레인은 8개 파일뿐이라 워커(코어 수)에 전부 즉시 배치된다 — 순서 조정은 의미가 없고,
     * 벽시계는 가장 긴 `commissionBandMeasure.test.ts`(약 719초, 전부 collect)가 정한다.
     * 나머지 7개를 합쳐도 577초라 그 그늘에 들어간다.
     */
  },
}));
