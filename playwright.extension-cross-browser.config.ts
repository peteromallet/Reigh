import { defineConfig, devices } from '@playwright/test';
import { DEFAULT_DEV_SUPABASE_URL } from './src/shared/dev/devSession.ts';

// Dedicated defaults keep this opt-in gate isolated from the ordinary timeline
// suite and from hand-started acceptance servers.
const port = Number(process.env.PLAYWRIGHT_PORT ?? 2244);
const bridgePort = Number(process.env.ASTRID_BRIDGE_PORT ?? 17344);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const includeEdge = process.env.PLAYWRIGHT_INCLUDE_EDGE === '1';

process.env.BASE_URL ??= baseURL;
process.env.ASTRID_BRIDGE_PORT ??= String(bridgePort);

/**
 * Bounded, opt-in release gate for extension behavior in installed Chrome and
 * Playwright's Firefox/WebKit engines. It intentionally runs only one compact
 * spec; the ordinary Chromium timeline suite remains the fast feedback loop.
 *
 * Edge is explicit opt-in because Playwright's `msedge` channel requires an
 * installed Microsoft Edge binary:
 *   PLAYWRIGHT_INCLUDE_EDGE=1 npm run test:e2e:extension-cross-browser
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /extension-cross-browser\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: 'artifacts/extension-cross-browser/test-results',
  use: {
    baseURL,
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
      },
    },
    {
      command: 'node tests/e2e/timeline/astrid-bridge-stub.mjs',
      url: `http://127.0.0.1:${bridgePort}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { ASTRID_BRIDGE_PORT: String(bridgePort) },
    },
  ],
  projects: [
    {
      name: 'chrome-stable',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    ...(includeEdge
      ? [{
          name: 'edge-stable',
          use: { ...devices['Desktop Edge'], channel: 'msedge' as const },
        }]
      : []),
  ],
});
