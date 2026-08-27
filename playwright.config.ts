import { defineConfig, devices } from '@playwright/test';
import { delimiter, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DEFAULT_DEV_SUPABASE_URL } from './src/shared/dev/devSession.ts';
import { resolvePinnedNodeExecutable } from './scripts/release/pinned-node-runtime.mjs';
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

// Browser-level network blocking for real-bridge acceptance: Chromium resolves
// every provider/Supabase host to a closed loopback port so a stray remote
// fetch fails fast inside the browser (the local dev Supabase is the raw IP
// 127.0.0.1:54321, which resolver MAP cannot cover — the network-audit
// assertion "zero requests to 127.0.0.1:54321" covers that leg). Applied on
// EVERY launchOptions branch so no executable path skips the blackhole.
const BROWSER_DNS_BLACKHOLE_ARGS = [
  '--no-sandbox',
  // NOTE: no shell-style quotes around the value — Playwright passes argv
  // verbatim (no shell), and Chromium rejects every rule if the value carries
  // literal quote characters (proven: quoted form leaves supabase.co reachable,
  // unquoted form fails fast at 127.0.0.1:1).
  '--host-resolver-rules=MAP supabase.co 127.0.0.1:1, MAP *.supabase.co 127.0.0.1:1, '
    + 'MAP *.supabase.in 127.0.0.1:1, MAP openrouter.ai 127.0.0.1:1, MAP *.openrouter.ai 127.0.0.1:1, '
    + 'MAP api.openai.com 127.0.0.1:1, MAP api.anthropic.com 127.0.0.1:1, '
    + 'MAP huggingface.co 127.0.0.1:1, MAP *.huggingface.co 127.0.0.1:1',
] as const;
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const launchOptions = chromiumExecutablePath
  ? { executablePath: chromiumExecutablePath, args: [...BROWSER_DNS_BLACKHOLE_ARGS] }
  : { args: [...BROWSER_DNS_BLACKHOLE_ARGS] };

// Timeline device specs and the extension harness need a live dev server plus
// the local-mode bridge stub (both booted by `webServer` below). They are
// registered only for their opt-in scripts and are excluded from every default
// project.
// See `npm run test:e2e:timeline`.
const TIMELINE_DEVICE_SPECS = /tests[\\/]e2e[\\/]timeline[\\/].*\.spec\.ts$/;
// These specs exercise the authenticated Astrid task/render authority. The
// generic timeline project owns only the deterministic local stub, which must
// not silently turn those checks into 404s or run the release bridge against
// an unauthenticated fixture.
const REAL_BRIDGE_SPEC = /real-bridge(?:-hardening|-rate-limit)?\.spec\.ts$/;
const RENDERER_OWNED_TIMELINE_SPECS = /(?:caption-render-export|caption-render-matrix)\.spec\.ts$/;
const includeTimelineDevices = process.env.PLAYWRIGHT_TIMELINE_DEVICES === '1';
const includeExtensionHarness = process.env.PLAYWRIGHT_EXTENSION_HARNESS === '1';
const EXTENSION_HARNESS_SETUP_SPEC = /extension-harness\.setup\.ts$/;
const includeHardening = process.env.PLAYWRIGHT_HARDENING === '1';
// B5: REAL_BRIDGE=1 boots `astrid serve` (the actual bridge) instead of the
// stub, and points the Vite dev proxy at it. Run:
//   npm run test:e2e:timeline:realbridge
const useRealBridge = process.env.REAL_BRIDGE === '1';
const realBridgeNodeExecutable = useRealBridge ? resolvePinnedNodeExecutable() : null;
const shellQuote = (value: string): string => process.platform === 'win32'
  ? `"${value.replaceAll('"', '\\"')}"`
  : `'${value.replaceAll("'", "'\\''")}'`;
const realBridgeToken = useRealBridge
  ? process.env.ASTRID_BRIDGE_TOKEN?.trim() || randomBytes(32).toString('base64url')
  : null;
const hardeningBridgeToken = useRealBridge && includeHardening
  ? process.env.ASTRID_HARDENING_BRIDGE_TOKEN?.trim() || randomBytes(32).toString('base64url')
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
const bridgeReadyPort = useRealBridge
  ? (inheritedRunPorts
    ? readInheritedPort('ASTRID_BRIDGE_READY_PORT')
    : allocateIsolatedPort('ASTRID_BRIDGE_READY_PORT', allocatedPorts))
  : null;
const hardeningBridgePort = useRealBridge && includeHardening
  ? (inheritedRunPorts
    ? readInheritedPort('ASTRID_HARDENING_BRIDGE_PORT')
    : allocateIsolatedPort('ASTRID_HARDENING_BRIDGE_PORT', allocatedPorts))
  : null;
const hardeningBridgeReadyPort = useRealBridge && includeHardening
  ? (inheritedRunPorts
    ? readInheritedPort('ASTRID_HARDENING_BRIDGE_READY_PORT')
    : allocateIsolatedPort('ASTRID_HARDENING_BRIDGE_READY_PORT', allocatedPorts))
  : null;
if (hardeningBridgeToken) process.env.ASTRID_HARDENING_BRIDGE_TOKEN = hardeningBridgeToken;
if (hardeningBridgePort) process.env.ASTRID_HARDENING_BRIDGE_PORT = String(hardeningBridgePort);
if (hardeningBridgeReadyPort) {
  process.env.ASTRID_HARDENING_BRIDGE_READY_PORT = String(hardeningBridgeReadyPort);
}
if (hardeningBridgeToken) {
  process.env.ASTRID_HARDENING_REQUEST_TOKEN_FILE = '/tmp/astrid-real-bridge-hardening.token';
}
// Playwright reloads this config in worker processes after webServer starts;
// carry the values across those reloads without probing our own live servers
// as though they were stale external processes.
process.env.REIGH_TIMELINE_PORTS_ALLOCATED = '1';
const bridgeServeCommand = useRealBridge
  ? `${shellQuote(realBridgeNodeExecutable!)} tests/e2e/timeline/real-bridge-serve.mjs`
  : 'node tests/e2e/timeline/astrid-bridge-stub.mjs';
const includeBridgeServer = includeTimelineDevices || includeExtensionHarness;
const extensionHarnessDependencies = includeExtensionHarness
  ? ['extension-harness-setup']
  : [];
const defaultProjectIgnores = [TIMELINE_DEVICE_SPECS, EXTENSION_HARNESS_SETUP_SPEC];

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
    ...(includeBridgeServer
      ? [{
          command: bridgeServeCommand,
          url: useRealBridge
            ? `http://127.0.0.1:${bridgeReadyPort}/ready`
            : `http://127.0.0.1:${bridgePort}/health`,
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
            ...(useRealBridge
              ? { ASTRID_BRIDGE_READY_PORT: String(bridgeReadyPort) }
              : {}),
            // The stub's media URLs must follow the run-isolated editor
            // origin; otherwise its default 2222 base yields browser 404s.
            BASE_URL: baseURL,
            ...(realBridgeToken
              ? { ASTRID_BRIDGE_TOKEN: realBridgeToken }
              : {}),
            ASTRID_REQUEST_TOKEN_FILE: process.env.ASTRID_REQUEST_TOKEN_FILE ?? '/tmp/astrid-real-bridge.token',
            ...(useRealBridge
              ? {
                ASTRID_NODE_EXECUTABLE: realBridgeNodeExecutable!,
                PATH: `${dirname(realBridgeNodeExecutable!)}${delimiter}${process.env.PATH ?? ''}`,
              }
              : {}),
          },
        },
        ...(useRealBridge && includeHardening
          ? [{
              command: bridgeServeCommand,
              url: `http://127.0.0.1:${hardeningBridgeReadyPort}/ready`,
              reuseExistingServer: false,
              timeout: 30_000,
              gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 5_000 },
              env: {
                ASTRID_BRIDGE_PORT: String(hardeningBridgePort),
                ASTRID_BRIDGE_READY_PORT: String(hardeningBridgeReadyPort),
                ASTRID_BRIDGE_TOKEN: hardeningBridgeToken!,
                ASTRID_REQUEST_TOKEN_FILE: '/tmp/astrid-real-bridge-hardening.token',
                ASTRID_BRIDGE_PID_FILE: '/tmp/astrid-real-bridge-hardening.pid',
                ASTRID_BRIDGE_METADATA_FILE: '/tmp/astrid-real-bridge-hardening.metadata.json',
                ASTRID_NODE_EXECUTABLE: realBridgeNodeExecutable!,
                PATH: `${dirname(realBridgeNodeExecutable!)}${delimiter}${process.env.PATH ?? ''}`,
              },
            }]
          : []),
        ]
      : []),
  ],
  projects: [
    ...(includeExtensionHarness
      ? [{
          name: 'extension-harness-setup',
          testMatch: EXTENSION_HARNESS_SETUP_SPEC,
          use: { ...devices['Desktop Chrome'] },
        }]
      : []),
    {
      name: 'chromium-desktop',
      testIgnore: defaultProjectIgnores,
      dependencies: extensionHarnessDependencies,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-condensed',
      testIgnore: defaultProjectIgnores,
      dependencies: extensionHarnessDependencies,
      use: { ...devices['iPad Mini'] },
    },
    {
      name: 'chromium-mobile',
      testIgnore: defaultProjectIgnores,
      dependencies: extensionHarnessDependencies,
      use: { ...devices['iPhone 13'] },
    },
    ...(includeTimelineDevices
      ? [{
          name: 'timeline-devices',
          testMatch: useRealBridge ? REAL_BRIDGE_SPEC : TIMELINE_DEVICE_SPECS,
          // The authenticated project owns the bridge contract only. Caption
          // export/matrix specs require a producing render worker plus managed
          // media fixtures and therefore remain renderer-owned until their
          // dedicated command provisions that topology.
          testIgnore: useRealBridge
            ? RENDERER_OWNED_TIMELINE_SPECS
            : new RegExp(`${REAL_BRIDGE_SPEC.source}|${RENDERER_OWNED_TIMELINE_SPECS.source}`),
          // Each spec sets its own viewport/touch profile via test.use().
          use: { ...devices['Desktop Chrome'] },
        }]
      : []),
  ],
});
