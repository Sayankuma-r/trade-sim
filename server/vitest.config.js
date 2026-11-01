import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/globalSetup.js'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: { BOTS_ENABLED: 'false', NODE_ENV: 'test', ORDER_RATE_LIMIT_PER_MIN: '100000' },
  },
});
