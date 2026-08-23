import { defineConfig, devices } from '@playwright/test';

const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR;
if (!outputDir) {
  throw new Error('PLAYWRIGHT_OUTPUT_DIR is required for the paired release gate');
}

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: './tests/e2e/release',
  testMatch: 'paired-repository.spec.ts',
  outputDir,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    acceptDownloads: true,
    baseURL: process.env.PAIRED_RELEASE_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...(chromiumExecutablePath
      ? { launchOptions: { executablePath: chromiumExecutablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] } }
      : {}),
  },
});
