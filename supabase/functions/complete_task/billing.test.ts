import { describe, expect, it, vi } from 'vitest';
import { triggerCostCalculationIfNotSubTask } from './billing.ts';

describe('complete_task/billing', () => {
  it('skips trigger when task is a sub-task', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await triggerCostCalculationIfNotSubTask(
      {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  params: {
                    orchestrator_task_id_ref: '11111111-2222-3333-4444-555555555555',
                  },
                },
              }),
            }),
          }),
        }),
      },
      'https://example.supabase.co',
      'service-key',
      'task-id',
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('triggers cost calculation once for non-sub-task completion', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, cost: 3.25 }), { status: 200 }),
    );

    const result = await triggerCostCalculationIfNotSubTask(
      {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  params: {
                    prompt: 'bill this parent task',
                  },
                },
              }),
            }),
          }),
        }),
      },
      'https://example.supabase.co',
      'service-key',
      'parent-task-id',
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 200,
        cost: 3.25,
      },
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.supabase.co/functions/v1/calculate-task-cost',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ task_id: 'parent-task-id' }),
      }),
    );
    fetchSpy.mockRestore();
  });
});
