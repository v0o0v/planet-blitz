import { defineConfig } from 'vitest/config';

export default defineConfig({
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
});
