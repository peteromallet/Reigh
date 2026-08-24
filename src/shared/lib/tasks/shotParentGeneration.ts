import { bridgeCapabilityUnavailable } from '@/integrations/astrid/capability';

interface EnsureShotParentGenerationInput {
  projectId: string;
  shotId?: string;
  parentGenerationId?: string;
  context: string;
}

/**
 * Returns the existing parent generation ID for a shot, or creates one if missing.
 * Never replaces an existing parent generation.
 */
export async function ensureShotParentGenerationId({
  projectId,
  shotId,
  parentGenerationId,
  context,
}: EnsureShotParentGenerationInput): Promise<string> {
  if (parentGenerationId) {
    return parentGenerationId;
  }

  if (!shotId) {
    throw new Error('parent_generation_id is required when shot_id is missing');
  }

  void projectId;
  void context;
  throw bridgeCapabilityUnavailable(
    `ensure parent generation for shot ${shotId}`,
    'Use document-native timeline placement; the dormant shots pack has no parent-generation route.',
  );
}
