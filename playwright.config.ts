import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

// Escape hatch for sandboxes with a pre-provisioned Chromium instead of
// Playwright's downloaded one (see `npm run test:e2e:timeline`).
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const launchOptions = chromiumExecutablePath
  ? { executablePath: chromiumExecutablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] }
  : undefined;

// The timeline device specs need a live dev server plus the local-mode bridge
// stub, so they are registered only for their opt-in script and are excluded
// from every default project. See `npm run test:e2e:timeline`.
const TIMELINE_DEVICE_SPECS = /tests[\\/]e2e[\\/]timeline[\\/].*\.spec\.ts$/;
const includeTimelineDevices = process.env.PLAYWRIGHT_TIMELINE_DEVICES === '1';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    ...(launchOptions ? { launchOptions } : {}),
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? 'test-anon-key',
      VITE_APP_ENV: process.env.VITE_APP_ENV ?? 'web',
    },
  },
  projects: [
    { name: 'chromium-desktop', testIgnore: TIMELINE_DEVICE_SPECS, use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-condensed', testIgnore: TIMELINE_DEVICE_SPECS, use: { ...devices['iPad Mini'] } },
    { name: 'chromium-mobile', testIgnore: TIMELINE_DEVICE_SPECS, use: { ...devices['iPhone 13'] } },
    ...(includeTimelineDevices
      ? [{
          name: 'timeline-devices',
          testMatch: TIMELINE_DEVICE_SPECS,
          // Each spec sets its own viewport/touch profile via test.use().
          use: { ...devices['Desktop Chrome'] },
        }]
      : []),
  ],
});
