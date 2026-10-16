import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/distribution/*.test.ts'],
    fileParallelism: false,
    testTimeout: 180000,
  },
});
