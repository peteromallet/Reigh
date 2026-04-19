import { defineConfig } from 'vitest/config';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  root: projectRoot,
  resolve: {
    alias: {
      '@': path.resolve(projectRoot, 'src'),
      '@tbd/editor': path.resolve(projectRoot, 'packages/editor/src/index.ts'),
      '@tbd/schema': path.resolve(projectRoot, 'packages/schema/src/index.ts'),
      '@tbd/engine': path.resolve(projectRoot, 'packages/engine/src/index.ts'),
    },
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['supabase/functions/**'],
    setupFiles: [path.resolve(projectRoot, 'src/test/setup.ts')],
  },
});
