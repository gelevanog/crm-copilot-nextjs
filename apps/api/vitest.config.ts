import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is used instead of esbuild so that `emitDecoratorMetadata` works,
// which NestJS dependency injection relies on.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    setupFiles: ['test/setup-env.ts'],
    // DB-backed suites share one database; run files sequentially.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
