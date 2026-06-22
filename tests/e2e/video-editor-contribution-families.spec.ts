import { expect, test } from '@playwright/test';

const HARNESS_URL = '/dev/video-editor-family-harness';
const HARNESS = '[data-testid="video-editor-family-harness"]';
const SURFACE_CONTAINER = '[data-testid="family-surface-container"]';
const DIAGNOSTIC_ROW = '[data-testid="video-editor-diagnostic-row"]';

async function openFamilyHarness(page: import('@playwright/test').Page) {
  const response = await page.goto(HARNESS_URL, { waitUntil: 'domcontentloaded' });

  expect(response?.ok()).toBe(true);
  await expect(page.locator(HARNESS)).toBeAttached({ timeout: 15_000 });
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
}

test('supported contribution families render through stable selectors', async ({ page }) => {
  await openFamilyHarness(page);

  await expect(
    page
      .locator(SURFACE_CONTAINER)
      .filter({ has: page.locator('[data-testid="family-surface-toolbar"]') }),
  ).toHaveAttribute('data-video-editor-surface-kind', 'slot');
  await expect(page.locator('[data-testid="family-surface-toolbar"]')).toHaveAttribute(
    'data-extension-id',
    'com.example.family-surfaces',
  );
  await expect(page.locator('[data-testid="family-surface-dialog"]')).toHaveAttribute(
    'data-contribution-id',
    'family.surface.dialog',
  );
  await expect(page.locator('[data-testid="family-surface-asset-panel"]')).toHaveAttribute(
    'data-contribution-id',
    'family.surface.asset-panel',
  );
  await expect(page.locator('[data-testid="family-surface-inspector"]')).toHaveAttribute(
    'data-contribution-id',
    'family.surface.inspector',
  );

  await expect(
    page.locator(
      '[data-testid="family-command-palette-entry"][data-command-id="com.example.family-commands.inspect-selection"]',
    ),
  ).toHaveAttribute('data-extension-id', 'com.example.family-commands');
  await expect(
    page.locator(
      '[data-testid="family-command-context-entry"][data-command-id="com.example.family-commands.normalize-selection"]',
    ),
  ).toHaveAttribute('data-command-context', 'clip-context');
  await expect(
    page.locator(
      '[data-testid="family-command-keybinding-entry"][data-command-id="com.example.family-commands.inspect-selection"]',
    ),
  ).toHaveAttribute('data-keybinding', 'Ctrl+Alt+I');

  await expect(
    page.locator('[data-testid="family-settings-form"][data-extension-id="com.example.family-settings"]'),
  ).toBeAttached();
  await expect(
    page.locator(
      '[data-testid="family-settings-row"][data-extension-id="com.example.family-settings"][data-settings-key="theme"] input',
    ),
  ).toHaveValue('"light"');
  await expect(
    page.locator(
      '[data-testid="family-settings-row"][data-extension-id="com.example.family-settings"][data-settings-key="showRulers"] input',
    ),
  ).toHaveValue('false');
});

test('negative contribution fixtures surface diagnostics without duplicate registry rows', async ({ page }) => {
  await openFamilyHarness(page);

  await expect(
    page.locator(
      `${DIAGNOSTIC_ROW}[data-diagnostic-code="contribution_id_mismatch"][data-diagnostic-extension-id="com.example.family-surfaces-mismatch"]`,
    ).first(),
  ).toHaveAttribute('data-diagnostic-severity', 'error');
  await expect(
    page.locator(
      `${DIAGNOSTIC_ROW}[data-diagnostic-code="duplicate_command_id"][data-diagnostic-extension-id="com.example.family-duplicate-commands"]`,
    ),
  ).toHaveAttribute('data-diagnostic-severity', 'error');
  await expect(
    page.locator(
      `${DIAGNOSTIC_ROW}[data-diagnostic-code="duplicate_descriptor_id"][data-diagnostic-extension-id="com.example.family-runtime-duplicate"]`,
    ),
  ).toHaveAttribute('data-diagnostic-severity', 'error');

  await expect(
    page.locator(
      '[data-testid="family-command-palette-entry"][data-command-id="com.example.family-duplicate-commands.duplicate-action"]',
    ),
  ).toHaveCount(1);
  await expect(
    page.locator(
      '[data-testid="family-surface-container"][data-contribution-id="family.runtime.duplicate-panel"]',
    ),
  ).toHaveCount(1);
});
