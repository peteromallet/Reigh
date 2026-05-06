import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __getServeHandler, __resetServeHandler } from '../_tests/mocks/denoHttpServer.ts';

const {
  authorizeTaskActorMock,
  withEdgeRequestMock,
} = vi.hoisted(() => ({
  authorizeTaskActorMock: vi.fn(),
  withEdgeRequestMock: vi.fn(),
}));

vi.mock('../_shared/taskActorPolicy.ts', () => ({
  authorizeTaskActor: authorizeTaskActorMock,
}));

vi.mock('../_shared/edgeHandler.ts', () => ({
  withEdgeRequest: withEdgeRequestMock,
}));

describe('get-orchestrator-children auth scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    __resetServeHandler();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds the authorized parent project to non-service-role child queries', async () => {
    const orderMock = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'child-1',
          task_type: 'segment',
          status: 'Queued',
          params: {
            route_contract: {
              route_key: 'travel_segment',
              selected_backend: 'wgp',
              selector_version: 12,
              selected_profile: 'production',
              route_selection_snapshot: {
                support_state: 'wgp_only',
                parent_route_key: 'travel_orchestrator',
              },
            },
          },
          output_location: null,
          project_id: 'project-1',
        },
      ],
      error: null,
    });
    const orMock = vi.fn().mockReturnValue({ order: orderMock });
    const eqProjectIdMock = vi.fn().mockReturnValue({ or: orMock });
    const singleMock = vi.fn().mockResolvedValue({
      data: { project_id: 'project-1' },
      error: null,
    });
    const eqIdMock = vi.fn().mockReturnValue({ single: singleMock });
    const selectMock = vi.fn()
      .mockReturnValueOnce({ eq: eqIdMock })
      .mockReturnValueOnce({ eq: eqProjectIdMock });
    const supabaseAdmin = {
      from: vi.fn().mockReturnValue({ select: selectMock }),
    };
    const logger = {
      setDefaultTaskId: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      critical: vi.fn(),
      flush: vi.fn(),
    };

    withEdgeRequestMock.mockImplementation(async (req, _options, handler) => {
      const bodyText = await req.text();
      return handler({
        supabaseAdmin,
        logger,
        body: JSON.parse(bodyText),
        auth: { isServiceRole: false, userId: 'user-1' },
        req,
      });
    });
    authorizeTaskActorMock.mockResolvedValue({
      ok: true,
      value: {
        isServiceRole: false,
        callerId: 'user-1',
        taskOwnerVerified: true,
      },
    });

    await import('./index.ts');
    const handler = __getServeHandler();

    const response = await handler(
      new Request('https://edge.test/get-orchestrator-children', {
        method: 'POST',
        body: JSON.stringify({ orchestrator_task_id: 'orch-1' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(supabaseAdmin.from).toHaveBeenCalledWith('tasks');
    expect(selectMock.mock.calls[1][0]).toContain('params');
    expect(eqIdMock).toHaveBeenCalledWith('id', 'orch-1');
    expect(eqProjectIdMock).toHaveBeenCalledWith('project_id', 'project-1');
    await expect(response.json()).resolves.toEqual({
      tasks: [
        {
          id: 'child-1',
          task_type: 'segment',
          status: 'Queued',
          params: {
            route_contract: {
              route_key: 'travel_segment',
              selected_backend: 'wgp',
              selector_version: 12,
              selected_profile: 'production',
              route_selection_snapshot: {
                support_state: 'wgp_only',
                parent_route_key: 'travel_orchestrator',
              },
            },
          },
          output_location: null,
        },
      ],
    });
  });
});
