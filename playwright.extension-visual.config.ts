import { defineConfig, devices } from '@playwright/test';
import { DEFAULT_DEV_SUPABASE_URL } from './src/shared/dev/devSession.ts';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 2252);
const bridgePort = Number(process.env.ASTRID_BRIDGE_PORT ?? 17352);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

process.env.BASE_URL ??= baseURL;
process.env.ASTRID_BRIDGE_PORT ??= String(bridgePort);

/**
 * Deterministic Chromium pixel gate for the extension-composed timeline.
 * It is deliberately separate from the portable geometry/cross-browser gates:
 * the committed baselines cover one pinned browser raster at CSS-pixel scale.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /extension-visual-regression\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: 'artifacts/extension-visual/test-results',
  snapshotPathTemplate: '{testDir}/visual-snapshots/{arg}{ext}',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    locale: 'en-US',
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? DEFAULT_DEV_SUPABASE_URL,
        VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? 'test-anon-key',
        VITE_APP_ENV: process.env.VITE_APP_ENV ?? 'web',
        VITE_ASTRID_BRIDGE_PORT: String(bridgePort),
        ASTRID_BRIDGE_ALLOW_UNAUTHENTICATED_STUB: '1',
      },
    },
    {
      command: 'node tests/e2e/timeline/astrid-bridge-stub.mjs',
      url: `http://127.0.0.1:${bridgePort}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { ASTRID_BRIDGE_PORT: String(bridgePort), BASE_URL: baseURL },
    },
  ],
  projects: [{ name: 'chromium-visual', use: { ...devices['Desktop Chrome'] } }],
});
