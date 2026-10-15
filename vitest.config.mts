import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/fixtures/**',
      'src/__tests__/distribution/**',
    ],
    testTimeout: 30000,
    alias: {
      '^marked$': 'marked/lib/marked.umd.js',
    },
  },
});
