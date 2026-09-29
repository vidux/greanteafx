import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path in tsconfig.json.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // One process per test file: node-web-audio-api is not safe to run alongside other busy
    // threads in its process, so test files must never run as worker threads.
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
  },
});
