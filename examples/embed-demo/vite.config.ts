import path from 'node:path';
import { existsSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

const repoRoot = path.resolve(__dirname, '../..');

// Prefer the installed timeline-composition package's own modules; fall back
// to the committed stubs only when the package is absent (CI, fresh checkout).
const realThemeApi = path.resolve(
  repoRoot,
  'node_modules/@banodoco/timeline-composition/typescript/src/theme-api.ts',
);
const realRegistry = path.resolve(
  repoRoot,
  'node_modules/@banodoco/timeline-composition/typescript/src/registry.generated.ts',
);

export default defineConfig({
  root: __dirname,
  publicDir: path.resolve(repoRoot, 'public'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(repoRoot, 'src'),
      react: path.resolve(repoRoot, 'node_modules/react'),
      'react-dom': path.resolve(repoRoot, 'node_modules/react-dom'),
      remotion: path.resolve(repoRoot, 'node_modules/remotion'),
      '@remotion/layout-utils': path.resolve(repoRoot, 'node_modules/@remotion/layout-utils'),
      '@banodoco/timeline-composition/registry.generated': existsSync(realRegistry)
        ? realRegistry
        : path.resolve(__dirname, 'stubs/timeline-composition/registry.generated.ts'),
      '@banodoco/timeline-composition/theme-api': existsSync(realThemeApi)
        ? realThemeApi
        : path.resolve(__dirname, 'stubs/timeline-composition/theme-api.tsx'),
      '@banodoco/timeline-composition': path.resolve(repoRoot, 'node_modules/@banodoco/timeline-composition'),
      '@reigh/editor-sdk': path.resolve(repoRoot, 'src/sdk/index.ts'),
      '@workspace-effects': path.resolve(repoRoot, '../../banodoco-workspace/effects'),
      '@workspace-animations': path.resolve(repoRoot, '../../banodoco-workspace/animations'),
      '@workspace-transitions': path.resolve(repoRoot, '../../banodoco-workspace/transitions'),
    },
    dedupe: [
      'react',
      'react-dom',
      'react-reconciler',
      'remotion',
      '@banodoco/timeline-composition',
      '@banodoco/timeline-theme-2rp',
    ],
  },
  server: {
    fs: {
      allow: [path.resolve(repoRoot, '..', '..')],
    },
  },
  build: {
    outDir: path.resolve(repoRoot, 'dist/examples/embed-demo'),
    emptyOutDir: true,
  },
});
