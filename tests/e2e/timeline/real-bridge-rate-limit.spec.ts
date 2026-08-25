import { expect, test } from '@playwright/test';

/**
 * Rate-limit admission runs in its own Playwright invocation so its
 * process-wide token bucket cannot poison the serial browser scenarios.
 */
test.skip(process.env.REAL_BRIDGE !== '1', 'real-bridge scenarios require REAL_BRIDGE=1');

const bridgePortValue = process.env.ASTRID_BRIDGE_PORT;
if (!bridgePortValue) throw new Error('ASTRID_BRIDGE_PORT is required');
const bridgePort = Number(bridgePortValue);
if (!Number.isInteger(bridgePort) || bridgePort < 1 || bridgePort > 65_535) {
  throw new Error(`Invalid ASTRID_BRIDGE_PORT: ${bridgePortValue}`);
}
const bridgeOrigin = `http://127.0.0.1:${bridgePort}`;

function bridgeHeaders(): Record<string, string> {
  const token = process.env.ASTRID_BRIDGE_TOKEN?.trim();
  if (!token) throw new Error('ASTRID_BRIDGE_TOKEN is required');
  return {
    Authorization: `Bearer ${token}`,
    'X-Astrid-Bridge-Version': 'v1',
  };
}

test('real bridge rate limit returns typed 429 with Retry-After', async ({ request }) => {
  const headers = bridgeHeaders();
  const responses = [];
  // Astrid's fresh server starts with a 32-token bucket. Keep this isolated
  // invocation bounded below refill so the result is deterministic.
  for (let index = 0; index < 40; index += 1) {
    responses.push(await request.get(`${bridgeOrigin}/health`, { headers }));
  }
  const limited = responses.filter((response) => response.status() === 429);
  expect(limited.length).toBeGreaterThan(0);
  expect(limited[0]?.headers()['retry-after']).toMatch(/^\d+$/);
  const payload = await limited[0]!.json();
  expect(payload).toMatchObject({ error: 'rate_limited' });
});
