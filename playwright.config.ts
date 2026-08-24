import { defineConfig, devices } from '@playwright/test';
import { DEFAULT_DEV_SUPABASE_URL } from './src/shared/dev/devSession.ts';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

// Escape hatch for sandboxes with a pre-provisioned Chromium instead of
// Playwright's downloaded one (see `npm run test:e2e:timeline`).
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const launchOptions = chromiumExecutablePath
  ? { executablePath: chromiumExecutablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] }
  : undefined;

// The timeline device specs need a live dev server plus the local-mode bridge
// stub (both booted by `webServer` below), so they are registered only for their
// opt-in script and are excluded from every default project.
// See `npm run test:e2e:timeline`.
const TIMELINE_DEVICE_SPECS = /tests[\\/]e2e[\\/]timeline[\\/].*\.spec\.ts$/;
const includeTimelineDevices = process.env.PLAYWRIGHT_TIMELINE_DEVICES === '1';
// B5: REAL_BRIDGE=1 boots `astrid serve` (the actual bridge) instead of the
// stub, and points the Vite dev proxy at it. Run:
//   npm run test:e2e:timeline:realbridge
const useRealBridge = process.env.REAL_BRIDGE === '1';
// The demo stub must not share port 17333 with the real bridge; 17334
// keeps an E2E run from squatting on the editor's live bridge.
const bridgePort = Number(process.env.ASTRID_BRIDGE_PORT ?? 17334);
const bridgeServeCommand = useRealBridge
  ? 'node tests/e2e/timeline/real-bridge-serve.mjs'
  : 'node tests/e2e/timeline/astrid-bridge-stub.mjs';

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
  // Array form: the timeline device specs also need the local-mode bridge, so
  // their opt-in flag adds it as a second managed server instead of a second
  // terminal. `reuseExistingServer` keeps a hand-started bridge/dev server valid
  // for anyone iterating against a hot process.
  webServer: [
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? DEFAULT_DEV_SUPABASE_URL,
        VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? 'test-anon-key',
        VITE_APP_ENV: process.env.VITE_APP_ENV ?? 'web',
        // Real-bridge acceptance is an offline/deterministic browser run:
        // Vite removes the declarative Google Fonts links before serving the
        // document, so the request allowlist can reject every remote-font
        // attempt without relying on browser runtime interception.
        VITE_DISABLE_REMOTE_FONTS: process.env.VITE_DISABLE_REMOTE_FONTS ?? (useRealBridge ? '1' : '0'),
        VITE_ASTRID_BRIDGE_PORT: String(bridgePort),
        ASTRID_REQUEST_TOKEN_FILE: process.env.ASTRID_REQUEST_TOKEN_FILE ?? '/tmp/astrid-real-bridge.token',
      },
    },
    ...(includeTimelineDevices
      ? [{
          command: bridgeServeCommand,
          url: `http://127.0.0.1:${bridgePort}/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 30_000,
          // The real-bridge harness owns a disposable Astrid root plus pid,
          // token, and provenance receipts. Give its SIGTERM handler time to
          // stop the Python child and remove those artifacts after every run.
          ...(useRealBridge
            ? { gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 5_000 } }
            : {}),
          env: {
            ASTRID_BRIDGE_PORT: String(bridgePort),
            ASTRID_REQUEST_TOKEN_FILE: process.env.ASTRID_REQUEST_TOKEN_FILE ?? '/tmp/astrid-real-bridge.token',
          },
        }]
      : []),
  ],
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
