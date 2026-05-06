import { describe, expect, it, vi } from 'vitest';
import { handleOrchestratorCancellationBilling } from './cancellationBilling.ts';

describe('update-task-status/cancellationBilling exports', () => {
  it('exports cancellation billing handler', () => {
    expect(handleOrchestratorCancellationBilling).toBeTypeOf('function');
  });

  it('skips child task cancellation billing and does not treat it as refund', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, cost: 1 }), { status: 200 }),
    );
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const supabaseAdmin = {
      from: vi.fn(),
    };

    await handleOrchestratorCancellationBilling(
      supabaseAdmin as never,
      'https://example.supabase.co',
      'service-key',
      logger as never,
      'child-task-id',
      {
        params: {
          orchestrator_task_id_ref: '11111111-2222-3333-4444-555555555555',
        },
      } as never,
    );

    expect(logger.debug).toHaveBeenCalledWith('Cancelled task is a child, skipping billing', {
      task_id: 'child-task-id',
    });
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('bills completed child work for a cancelled orchestrator without refund ledger writes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, cost: 4.5 }), { status: 200 }),
    );
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    const completedEq = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'segment-1',
          generation_started_at: '2026-05-01T00:00:01.000Z',
          generation_processed_at: '2026-05-01T00:00:03.000Z',
        },
      ],
      error: null,
    });
    const or = vi.fn().mockReturnValue({ eq: completedEq });
    const select = vi.fn().mockReturnValue({ or });
    const supabaseAdmin = {
      from: vi.fn((table: string) => {
        expect(table).toBe('tasks');
        return { select, update };
      }),
    };

    await handleOrchestratorCancellationBilling(
      supabaseAdmin as never,
      'https://example.supabase.co',
      'service-key',
      logger as never,
      '11111111-2222-3333-4444-555555555555',
      {
        params: {
          orchestrator_details: {
            orchestrator_task_id: '11111111-2222-3333-4444-555555555555',
          },
        },
      } as never,
    );

    expect(or).toHaveBeenCalledWith(expect.stringContaining('11111111-2222-3333-4444-555555555555'));
    expect(completedEq).toHaveBeenCalledWith('status', 'Complete');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      generation_started_at: '2026-05-01T00:00:01.000Z',
      generation_processed_at: expect.any(String),
    }));
    expect(updateEq).toHaveBeenCalledWith('id', '11111111-2222-3333-4444-555555555555');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.supabase.co/functions/v1/calculate-task-cost',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ task_id: '11111111-2222-3333-4444-555555555555' }),
      }),
    );
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith('credits_ledger');
    fetchSpy.mockRestore();
  });
});
