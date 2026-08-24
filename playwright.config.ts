import { defineConfig, devices } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { DEFAULT_DEV_SUPABASE_URL } from './src/shared/dev/devSession.ts';
import {
  allocateIsolatedPort,
  readCanonicalBaseUrl,
  resolveCanonicalBaseUrl,
} from './tests/e2e/timeline/isolated-port.mjs';

const allocatedPorts = new Set<number>();
// Timeline gates are intentionally isolated even when invoked from a shell
// that has no CI marker.  Explicit ports are validated by the allocator;
// omitted ports are fresh per run.
const inheritedRunPorts = process.env.REIGH_TIMELINE_PORTS_ALLOCATED === '1';
const configuredBaseURL = readCanonicalBaseUrl();
if (configuredBaseURL && !process.env.PLAYWRIGHT_PORT) process.env.PLAYWRIGHT_PORT = String(configuredBaseURL.port);
const readInheritedPort = (envName: string): number => {
  const value = Number(process.env[envName]);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${envName} was marked run-allocated but is invalid: ${process.env[envName] ?? ''}`);
  }
  return value;
};
const port = inheritedRunPorts
  ? readInheritedPort('PLAYWRIGHT_PORT')
  : allocateIsolatedPort('PLAYWRIGHT_PORT', allocatedPorts);
const baseURL = resolveCanonicalBaseUrl(port);
process.env.BASE_URL = baseURL;
process.env.PLAYWRIGHT_BASE_URL = baseURL;
// Concurrent acceptance lanes must not clean or overwrite each other's traces.
const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR ?? 'test-results';

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
const realBridgeToken = useRealBridge
  ? process.env.ASTRID_BRIDGE_TOKEN?.trim() || randomBytes(32).toString('base64url')
  : null;
// Playwright workers inherit the config process environment, not the separate
// webServer.env objects. Direct Astrid auth-boundary assertions need the same
// ephemeral token that is passed to both managed servers.
if (realBridgeToken) process.env.ASTRID_BRIDGE_TOKEN = realBridgeToken;
// The bridge port is run-isolated too, so a stale bridge from another
// checkout cannot answer this run's requests.
const bridgePort = inheritedRunPorts
  ? readInheritedPort('ASTRID_BRIDGE_PORT')
  : allocateIsolatedPort('ASTRID_BRIDGE_PORT', allocatedPorts);
// Playwright reloads this config in worker processes after webServer starts;
// carry the values across those reloads without probing our own live servers
// as though they were stale external processes.
process.env.REIGH_TIMELINE_PORTS_ALLOCATED = '1';
const bridgeServeCommand = useRealBridge
  ? 'node tests/e2e/timeline/real-bridge-serve.mjs'
  : 'node tests/e2e/timeline/astrid-bridge-stub.mjs';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir,
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
      // Never adopt a hand-started process for deterministic timeline/local
      // gates.  The allocated port is ours for this run, and a collision was
      // already rejected above.
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? DEFAULT_DEV_SUPABASE_URL,
        VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? 'test-anon-key',
        VITE_APP_ENV: process.env.VITE_APP_ENV ?? 'web',
        // Real-bridge acceptance is an offline/deterministic browser run:
        // Vite removes the declarative Google Fonts links before serving the
        // document, so the request allowlist can reject every remote-font
        // attempt without relying on browser runtime interception.
        // Every Playwright server is a deterministic localTest surface. Strip
        // remote-font links before the browser sees HTML; production preview
        // keeps its normal font policy because this env is dev-server-only.
        VITE_DISABLE_REMOTE_FONTS: process.env.VITE_DISABLE_REMOTE_FONTS ?? '1',
        VITE_ASTRID_BRIDGE_PORT: String(bridgePort),
        ASTRID_BRIDGE_ALLOW_UNAUTHENTICATED_STUB: useRealBridge ? '0' : '1',
        ...(realBridgeToken
          ? { ASTRID_BRIDGE_TOKEN: realBridgeToken }
          : {}),
        ASTRID_REQUEST_TOKEN_FILE: process.env.ASTRID_REQUEST_TOKEN_FILE ?? '/tmp/astrid-real-bridge.token',
      },
    },
    ...(includeTimelineDevices
      ? [{
          command: bridgeServeCommand,
          url: `http://127.0.0.1:${bridgePort}/health`,
          reuseExistingServer: false,
          timeout: 30_000,
          // The real-bridge harness owns a disposable Astrid root plus pid,
          // token, and provenance receipts. Give its SIGTERM handler time to
          // stop the Python child and remove those artifacts after every run.
          ...(useRealBridge
            ? { gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 5_000 } }
            : {}),
          env: {
            ASTRID_BRIDGE_PORT: String(bridgePort),
            // The stub's media URLs must follow the run-isolated editor
            // origin; otherwise its default 2222 base yields browser 404s.
            BASE_URL: baseURL,
            ...(realBridgeToken
              ? { ASTRID_BRIDGE_TOKEN: realBridgeToken }
              : {}),
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
