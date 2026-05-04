import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts']
  },
  resolve: {
    alias: {
      '@autochar/shared': fromRoot('./packages/shared/src/index.ts'),
      '@autochar/recorder-core': fromRoot('./packages/recorder-core/src/index.ts'),
      '@autochar/flow-converter': fromRoot('./packages/flow-converter/src/index.ts'),
      '@autochar/batch-runner': fromRoot('./apps/batch-runner/src/index.ts')
    }
  }
});
