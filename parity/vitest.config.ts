import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const sdkSrc = fileURLToPath(new URL('../src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@livefolio\/sdk$/, replacement: `${sdkSrc}/index.ts` },
      { find: /^@livefolio\/sdk\/(.*)$/, replacement: `${sdkSrc}/$1/index.ts` },
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
