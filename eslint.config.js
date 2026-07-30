// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Restrictions enforced on the deterministic simulation core (src/sim/**).
 *
 * ADR-0005: the sim core must run identically on the browser client and on the
 * server (Edge Function) that re-verifies replays. Any source of ambient
 * non-determinism therefore has to be banned at lint time — it cannot be
 * retrofitted later.
 *
 *   - `pixi.js` (and any render/DOM lib) must never be imported: the sim core is
 *     platform independent.
 *   - `Math.random`  — non-seeded randomness. Use the seeded RNG (src/sim/rng.ts).
 *   - `Date.now`     — wall-clock time. Sim time is the fixed-timestep tick count.
 *   - `performance.now` — wall-clock time.
 */
const simCoreRestrictions = {
  'no-restricted-imports': [
    'error',
    {
      paths: [
        {
          name: 'pixi.js',
          message:
            'The sim core (src/sim) must stay platform independent — no PixiJS. See ADR-0005.',
        },
      ],
      patterns: [
        {
          group: ['pixi.js', 'pixi.js/*', '@pixi/*'],
          message:
            'The sim core (src/sim) must stay platform independent — no PixiJS. See ADR-0005.',
        },
        {
          group: ['*/render/*', '*/render', '*/ui/*', '*/ui', '*/input/*', '*/input'],
          message:
            'The sim core (src/sim) must not depend on render/ui/input layers. See ADR-0005.',
        },
      ],
    },
  ],
  'no-restricted-properties': [
    'error',
    {
      object: 'Math',
      property: 'random',
      message: 'Math.random is banned in the sim core — use the seeded RNG (src/sim/rng.ts). ADR-0005.',
    },
    {
      object: 'Date',
      property: 'now',
      message: 'Date.now is banned in the sim core — sim time is the tick count. ADR-0005.',
    },
    {
      object: 'performance',
      property: 'now',
      message: 'performance.now is banned in the sim core — sim time is the tick count. ADR-0005.',
    },
  ],
  'no-restricted-globals': [
    'error',
    {
      name: 'performance',
      message: 'performance.now is banned in the sim core — sim time is the tick count. ADR-0005.',
    },
  ],
};

export default tseslint.config(
  {
    // `.omc/**` 은 세션 산출물 보관소다(연구 노트·캡처 컷·비평가가 남긴 일회용 계측 스크립트).
    // 프로덕션 그래프 밖이고 git 에도 대부분 안 들어가는데, lint 가 그 안의 `.mjs` 프로브를 잡아
    // **소스가 멀쩡한데 `pnpm lint` 가 빨개졌다**(실제 발생: 비평가가 남긴 `tools/sat.mjs` 의 미사용
    // 변수 1건). 검증 게이트가 검증 부산물 때문에 실패하는 것은 게이트를 무의미하게 만든다.
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.omc/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Deterministic simulation core — strictest restrictions (ADR-0005).
    //
    // `data/**` 도 같은 규율 대상이다: sim 이 data/guardian.ts·lineage.ts·defenseCards.ts 등을
    // **런타임 import** 하므로, 데이터 모듈에 Math.random/Date.now 가 들어가면 sim 결정론이
    // 그대로 깨진다. 그런데 lint 대상은 src/sim/** 뿐이라 규율 밖이었다. 3레이어 데이터
    // (data/invasion/**)가 대량 유입되기 전에 막는다(M7a L0-schema).
    files: ['src/sim/**/*.ts', 'data/**/*.ts'],
    rules: simCoreRestrictions,
  },
  {
    // Build-time Node scripts (asset prep, tileset synthesis) run on Node, not in the browser.
    // `.omc/research/**` 의 오프라인 검수 스크립트도 같은 환경이다 — `eslint .` 이 dot-디렉터리를
    // 실제로 훑으므로 여기 넣지 않으면 `pnpm lint` 가 무관한 이유로 빨개진다.
    files: ['scripts/**/*.mjs', '.omc/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { Buffer: 'readonly', process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
  {
    // `scripts/env-verify/page-capture.js` 는 Node 가 아니라 **브라우저 콘솔에 붙여 넣는**
    // 스니펫이다(배경 회귀 캡처용). 리포에 파일로 두는 이유는 캡처 규율 — 품질 티어 고정,
    // rAF await 금지, 캔버스·프로필 고정 — 이 전부 실측으로 얻은 것이라 재현 가능해야 하기
    // 때문이다. 실행 환경이 다르므로 전역도 다르다.
    files: ['scripts/env-verify/page-capture.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        performance: 'readonly',
        fetch: 'readonly',
        Event: 'readonly',
        localStorage: 'readonly',
        // 스니펫이 스스로 `window` 에 심는 진입점들. 서로를 호출한다.
        __pinCanvas: 'readonly',
        __shot: 'readonly',
        __pb: 'readonly',
      },
    },
  },
);
