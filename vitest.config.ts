import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const sdkSrc = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  // Aliases mirror parity/vitest.config.ts so `npm test` from the sdk root
  // can run parity workspace tests, which import `@livefolio/sdk/<subpath>`.
  resolve: {
    alias: [
      { find: /^@livefolio\/sdk$/, replacement: `${sdkSrc}/index.ts` },
      { find: /^@livefolio\/sdk\/(.*)$/, replacement: `${sdkSrc}/$1/index.ts` },
    ],
  },
});
