import { useMutation } from '@tanstack/react-query';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import {
  resolveGenerationTaskMapping,
  type GenerationTaskMapping,
} from '@/shared/lib/tasks/generationTaskRepository';

/**
 * Canonical on-demand generation -> task mapping resolver.
 * Preserves repository status semantics (`ok`, `not_loaded`, `missing_generation`, `scope_mismatch`,
 * `invalid_tasks_shape`, `query_failed`) so callers can branch explicitly.
 */
export function useResolveGenerationTaskMapping() {
  return useMutation<GenerationTaskMapping, Error, string>({
    mutationFn: (generationId) => resolveGenerationTaskMapping(generationId),
    onError: (error: Error) => {
      normalizeAndPresentError(error, { context: 'GenerationTaskMapping', showToast: false });
    },
  });
}
