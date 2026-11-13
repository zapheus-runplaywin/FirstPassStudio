import { defineConfig } from 'vitest/config';

// Coverage floors: they may only go up.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary'],
      thresholds: { statements: 99, branches: 88, functions: 100, lines: 99 },
    },
  },
});
