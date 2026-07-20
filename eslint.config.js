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
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
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
    // Build-time Node scripts (asset prep) run on Node, not in the browser.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { Buffer: 'readonly', process: 'readonly', console: 'readonly' },
    },
  },
);
