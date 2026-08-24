import { defineConfig, devices } from '@playwright/test';
import { DEFAULT_DEV_SUPABASE_URL } from './src/shared/dev/devSession.ts';
import {
  allocateIsolatedPort,
  readCanonicalBaseUrl,
  readPublishedPort,
  resolveCanonicalBaseUrl,
} from './tests/e2e/timeline/isolated-port.mjs';

const allocatedPorts = new Set<number>();
const inheritedRunPorts = process.env.REIGH_EXTENSION_PORTS_ALLOCATED === '1';
const configuredBaseURL = readCanonicalBaseUrl();
if (configuredBaseURL && !process.env.PLAYWRIGHT_PORT) process.env.PLAYWRIGHT_PORT = String(configuredBaseURL.port);
const port = inheritedRunPorts
  ? readPublishedPort('PLAYWRIGHT_PORT')
  : allocateIsolatedPort('PLAYWRIGHT_PORT', allocatedPorts);
const bridgePort = inheritedRunPorts
  ? readPublishedPort('ASTRID_BRIDGE_PORT')
  : allocateIsolatedPort('ASTRID_BRIDGE_PORT', allocatedPorts);
const baseURL = resolveCanonicalBaseUrl(port);

process.env.BASE_URL = baseURL;
process.env.PLAYWRIGHT_BASE_URL = baseURL;
process.env.ASTRID_BRIDGE_PORT = String(bridgePort);
process.env.REIGH_EXTENSION_PORTS_ALLOCATED = '1';

/**
 * Accessibility and responsive release gate for the bundled editor extensions.
 *
 * This lane intentionally uses only Playwright-downloaded engines. It never
 * selects the user's installed Chrome/Edge channels or a persistent profile.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /extension-accessibility\.spec\.ts$/,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? 'test-results/extension-accessibility',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
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
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
