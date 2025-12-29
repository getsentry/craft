import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.eval.ts'],
    // Evals may take longer due to model inference
    testTimeout: 60000,
    // Run evals sequentially to avoid model conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
