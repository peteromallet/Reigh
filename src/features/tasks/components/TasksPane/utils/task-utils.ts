import { Task } from '@/types/tasks';
import { TASK_NAME_ABBREVIATIONS } from '../constants';
import { getProjectSelectionFallbackId } from '@/shared/contexts/projectSelectionStore';
import { fetchProjectPlacements } from '@/shared/lib/placement/placementService';
import {
  asRecord,
  asString,
  asStringArray,
  firstString as firstNonEmptyString,
} from '@/shared/lib/jsonNarrowing';
import { deriveInputImages } from '@/shared/lib/taskParamsUtils';

function firstString(...values: unknown[]): string | null {
  return firstNonEmptyString(...values);
}

function toNonEmptyStringArray(value: unknown): string[] {
  return (asStringArray(value) ?? []).filter((item) => item.length > 0);
}

export const deriveTaskInputImages = (task: Task | null): string[] => {
  if (!task?.params) {
    return [];
  }
  const params = asRecord(task.params) ?? {};
  return deriveInputImages(params);
};

export const getAbbreviatedTaskName = (fullName: string): string => {
  return TASK_NAME_ABBREVIATIONS[fullName] || fullName;
};

export const parseTaskParamsForDisplay = (params: unknown): { parsed: Record<string, unknown>; promptText: string } => {
  let parsed: Record<string, unknown> = {};

  try {
    const candidate = typeof params === 'string' ? JSON.parse(params) : params;
    parsed = asRecord(candidate) ?? {};
  } catch {
    parsed = {};
  }

  const orchestratorDetails = asRecord(parsed.orchestrator_details);
  const promptText = asString(orchestratorDetails?.prompt) ?? asString(parsed.prompt) ?? '';
  return { parsed, promptText };
};

export const extractShotId = (task: Task): string | null => {
  const params = asRecord(task.params) ?? {};
  const orchestratorDetails = asRecord(params.orchestrator_details);
  const orchestratorPayload = asRecord(params.full_orchestrator_payload);
  const segmentParams = asRecord(params.individual_segment_params);

  return firstString(
    orchestratorDetails?.shot_id,
    orchestratorPayload?.shot_id,
    segmentParams?.shot_id,
    params.shot_id,
  );
};

export const extractSourceGenerationId = (params: Record<string, unknown>): string | undefined => {
  return firstString(
    params.based_on,
    params.source_generation_id,
    params.generation_id,
    params.input_generation_id,
    params.parent_generation_id,
  ) ?? undefined;
};

export const extractTaskParentGenerationId = (params: Record<string, unknown>): string | undefined => {
  const orchestratorDetails = asRecord(params.orchestrator_details);
  const orchestratorPayload = asRecord(params.full_orchestrator_payload);

  return firstString(
    params.parent_generation_id,
    orchestratorDetails?.parent_generation_id,
    orchestratorPayload?.parent_generation_id,
  ) ?? undefined;
};

export const extractPairShotGenerationId = (task: Task): string | null => {
  const params = asRecord(task.params) ?? {};
  const segmentParams = asRecord(params.individual_segment_params);
  const orchestratorDetails = asRecord(params.orchestrator_details);
  const pairIds = toNonEmptyStringArray(orchestratorDetails?.pair_shot_generation_ids);
  const segmentIndex = typeof params.segment_index === 'number'
    ? params.segment_index
    : Number(params.segment_index ?? 0);
  const safeSegmentIndex = Number.isInteger(segmentIndex) && segmentIndex >= 0 ? segmentIndex : 0;

  return firstString(
    params.pair_shot_generation_id,
    segmentParams?.pair_shot_generation_id,
    pairIds[safeSegmentIndex],
  );
};

export const isSegmentVideoTask = (task: Task): boolean => {
  return task.taskType === 'individual_travel_segment';
};

type SegmentConnectionResult =
  | { ok: true; connected: boolean }
  | { ok: false; error: string };

export const checkSegmentConnection = async (
  pairShotGenerationId: string | null,
  shotId: string
): Promise<SegmentConnectionResult> => {
  if (!pairShotGenerationId) {
    return { ok: true, connected: false };
  }

  const projectSlug = getProjectSelectionFallbackId();
  if (!projectSlug) {
    return { ok: false, error: 'No project selected — cannot verify segment connection' };
  }

  try {
    const { byShot } = await fetchProjectPlacements(projectSlug);
    // Callers identify the pair either by the deterministic entry id or by a
    // bare generation id; connected = placed with a real frame (not pooled).
    const entry = (byShot.get(shotId) ?? []).find(
      (placement) =>
        placement.entryId === pairShotGenerationId
        || placement.generationId === pairShotGenerationId,
    );

    return {
      ok: true,
      connected: !!entry && (entry.timelineFrame ?? -1) >= 0,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message
          ? error.message
          : 'Failed to verify segment connection',
    };
  }
};
