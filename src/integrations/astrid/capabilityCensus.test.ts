import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeBridgeRouter } from '@/test/fakeBridgeRouter.ts';
import {
  getAstridCapabilityCensus,
  inspectAstridCapabilities,
  refreshAstridCapabilityCensus,
  resetAstridCapabilityCensusForTesting,
} from './capabilityCensus.ts';

const ORIGIN = 'http://bridge.fake';

function installFetch(handler: (request: Request) => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = raw.startsWith(ORIGIN) ? raw : `${ORIGIN}${raw}`;
    return handler(new Request(url, init));
  }));
}

describe('Astrid boot capability census', () => {
  beforeEach(() => resetAstridCapabilityCensusForTesting());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('separates healthy bridge status from supported task, gallery, and media routes', async () => {
    const router = createFakeBridgeRouter();
    installFetch((request) => router.handle(request));

    const result = await inspectAstridCapabilities();

    expect(result).toMatchObject({
      health: 'available',
      readiness: 'ready',
      capabilities: {
        tasks: 'supported',
        generations: 'supported',
        media: 'supported',
      },
    });
  });

  it('reports a healthy older bridge as degraded and probes each absent route only once', async () => {
    const router = createFakeBridgeRouter();
    installFetch(async (request) => {
      const pathname = new URL(request.url).pathname;
      if (/\/(tasks|generations)(?:\?|$)/.test(pathname) || pathname.includes('/media/')) {
        return Response.json(
          { error: 'not_found', detail: `unknown route: ${pathname}` },
          { status: 404 },
        );
      }
      return router.handle(request);
    });

    const first = refreshAstridCapabilityCensus();
    const second = refreshAstridCapabilityCensus();
    const [result] = await Promise.all([first, second]);

    expect(result.health).toBe('available');
    expect(result.readiness).toBe('degraded');
    expect(result.capabilities).toEqual({
      tasks: 'unavailable',
      generations: 'unavailable',
      media: 'unavailable',
    });
    expect(second).toBe(first);
    expect(getAstridCapabilityCensus()).toEqual(result);
    // health + projects + tasks + generations + media HEAD + diagnostic GET
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(6);
  });

  it('does not mistake transport uncertainty for permanent capability absence', async () => {
    installFetch(async (request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname.endsWith('/health')) return Response.json({ ok: true });
      if (pathname.endsWith('/projects')) {
        return Response.json({ projects: [{ slug: 'p', name: 'P' }] });
      }
      throw new Error('socket closed');
    });

    const result = await inspectAstridCapabilities();
    expect(result.readiness).toBe('degraded');
    expect(result.capabilities).toEqual({
      tasks: 'unknown',
      generations: 'unknown',
      media: 'unknown',
    });
  });
});
