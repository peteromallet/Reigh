import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

const fetchGenerationDetailByIdMock = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/repositories/generationRepository', () => ({
  fetchGenerationDetailById: (...args: unknown[]) => fetchGenerationDetailByIdMock(...args),
}));

import {
  fetchGenerationDetailQuery,
  createGenerationDetailQueryOptions,
} from './useGenerationDetail';

describe('generation detail query', () => {
  beforeEach(() => {
    fetchGenerationDetailByIdMock.mockReset();
  });

  it('shares one in-flight detail fetch between consumers', async () => {
    let resolveFetch: (value: { generation_id: string }) => void = () => {};
    fetchGenerationDetailByIdMock.mockReturnValue(new Promise((resolve) => {
      resolveFetch = resolve;
    }));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const first = fetchGenerationDetailQuery(queryClient, 'generation-1');
    const second = fetchGenerationDetailQuery(queryClient, 'generation-1');
    resolveFetch({ generation_id: 'generation-1' });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { generation_id: 'generation-1' },
      { generation_id: 'generation-1' },
    ]);
    expect(fetchGenerationDetailByIdMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(createGenerationDetailQueryOptions('generation-1').queryKey))
      .toEqual({ generation_id: 'generation-1' });
  });
});
