import { defineConfig } from 'vitest/config';

// One `npm test` runs every *.test.ts in the repo (tests sit next to the code).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts', 'tools/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
