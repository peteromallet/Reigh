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
    window.history.replaceState({}, '', '/');
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

  it('probes the URL-selected bridge project when it matches the project list', async () => {
    window.history.replaceState({}, '', '/tools/video-editor?localProject=selected-project');
    const router = createFakeBridgeRouter();
    const requests: string[] = [];
    installFetch(async (request) => {
      const url = new URL(request.url);
      requests.push(url.pathname);
      if (url.pathname.endsWith('/projects')) {
        return Response.json({
          projects: [
            { slug: 'first-project', name: 'First Project' },
            { slug: 'selected-project', name: 'Selected Project' },
          ],
        });
      }
      return router.handle(request);
    });

    const result = await inspectAstridCapabilities();

    expect(result.projectSlug).toBe('selected-project');
    expect(requests).toEqual(expect.arrayContaining([
      '/api/astrid/projects/selected-project/tasks',
      '/api/astrid/projects/selected-project/generations',
      '/api/astrid/projects/selected-project/media/__reigh_capability_probe__/content',
    ]));
    expect(requests).not.toContain('/api/astrid/projects/first-project/tasks');
    expect(requests).not.toContain('/api/astrid/projects/first-project/generations');
  });

  it.each([
    ['', 'no localProject'],
    ['?localProject=missing-project', 'an unmatched localProject'],
  ])('falls back to the first bridge project with %s', async (search) => {
    window.history.replaceState({}, '', `/tools/video-editor${search}`);
    const router = createFakeBridgeRouter();
    installFetch(async (request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/projects')) {
        return Response.json({
          projects: [
            { slug: 'first-project', name: 'First Project' },
            { slug: 'second-project', name: 'Second Project' },
          ],
        });
      }
      return router.handle(request);
    });

    const result = await inspectAstridCapabilities();

    expect(result.projectSlug).toBe('first-project');
  });

  it('falls back safely when localProject is malformed', async () => {
    window.history.replaceState({}, '', '/tools/video-editor?localProject=%E0%A4%A');
    const router = createFakeBridgeRouter();
    installFetch(async (request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/projects')) {
        return Response.json({
          projects: [
            { slug: 'first-project', name: 'First Project' },
            { slug: 'second-project', name: 'Second Project' },
          ],
        });
      }
      return router.handle(request);
    });

    await expect(inspectAstridCapabilities()).resolves.toMatchObject({
      projectSlug: 'first-project',
    });
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
