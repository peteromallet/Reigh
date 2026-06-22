import type { TimelineData } from '@/tools/video-editor/lib/timeline-data.ts';
import type {
  JsonObject,
  TimelineCommand,
  TimelineCommandExecutionResult,
  TimelineCommandInput,
  TimelineCommandMutation,
  TimelineCommandRunner,
  TimelineProposal,
  TimelineProposalCommandResult,
} from './types.ts';

let proposalCounter = 0;

const generateProposalId = (): string => {
  proposalCounter += 1;
  const timestamp = Date.now().toString(36);
  const counter = proposalCounter.toString(36).padStart(4, '0');
  const random = Math.random().toString(36).slice(2, 8);
  return `prop_${timestamp}_${counter}_${random}`;
};

/**
 * Extract affected clip IDs from a single command mutation.
 * Useful for callers that have direct access to a TimelineCommandEffect's mutation
 * (e.g., from a command descriptor's dryRun result).
 */
export const extractAffectedClipIdsFromMutation = (
  mutation: TimelineCommandMutation,
): string[] => {
  switch (mutation.type) {
    case 'rows': {
      const clipIds = new Set<string>();

      if (mutation.metaUpdates) {
        for (const clipId of Object.keys(mutation.metaUpdates)) {
          clipIds.add(clipId);
        }
      }

      if (mutation.metaDeletes) {
        for (const clipId of mutation.metaDeletes) {
          clipIds.add(clipId);
        }
      }

      for (const row of mutation.rows) {
        clipIds.add(row.id);
      }

      return Array.from(clipIds);
    }
    case 'data': {
      return Object.keys(mutation.data.meta);
    }
    case 'config': {
      return mutation.config.clips.map((clip) => clip.id);
    }
    case 'resolved-config': {
      return mutation.resolvedConfig.clips.map((clip) => clip.id);
    }
    case 'pinnedShotGroups': {
      const clipIds = new Set<string>();
      for (const group of mutation.pinnedShotGroups) {
        for (const clipId of group.clipIds) {
          clipIds.add(clipId);
        }
      }
      return Array.from(clipIds);
    }
  }
};

/**
 * Derive the full set of affected clip IDs by comparing two TimelineData snapshots.
 * Collects all clip IDs that were added, removed, or whose meta changed.
 */
const deriveAffectedClipIdsFromDataDiff = (
  before: TimelineData,
  after: TimelineData,
): string[] => {
  const clipIds = new Set<string>();

  for (const clipId of Object.keys(before.meta)) {
    clipIds.add(clipId);
  }
  for (const clipId of Object.keys(after.meta)) {
    clipIds.add(clipId);
  }

  return Array.from(clipIds).filter((clipId) => {
    const beforeMeta = before.meta[clipId];
    const afterMeta = after.meta[clipId];

    // Clip was added or removed.
    if (!beforeMeta || !afterMeta) {
      return true;
    }

    // Compare meta entries by JSON serialization.
    return JSON.stringify(beforeMeta) !== JSON.stringify(afterMeta);
  });
};

/**
 * Create a proposal from a dry-run execution result.
 *
 * The caller is responsible for running the command through
 * `runner.dryRun(data, input)` and passing the result here.
 * This is a pure conversion — it does not mutate timeline state.
 *
 * Affected clip IDs are derived from the diff between initialData and nextData.
 * Per-command affected clip IDs are best-effort: for single-command transactions
 * the full set is attributed; for multi-command transactions each successful
 * command receives the full set since intermediate snapshots are not available
 * from the execution result alone.
 */
export const createProposalFromExecutionResult = <
  TCommand extends TimelineCommand = TimelineCommand,
>(
  result: TimelineCommandExecutionResult<TCommand>,
  metadata?: JsonObject,
): TimelineProposal => {
  const totalAffectedClipIds = deriveAffectedClipIdsFromDataDiff(
    result.initialData,
    result.nextData,
  );

  const successfulCount = result.commandResults.filter(
    (step) => step.error === undefined,
  ).length;

  const commandResults: TimelineProposalCommandResult[] = result.commandResults.map(
    (stepResult) => {
      // Attribute affected clip IDs to successful commands.
      // For single-command transactions, this is exact.
      // For multi-command, each successful command gets the full set
      // since per-command diffs aren't available from the execution result.
      const isSuccessful = stepResult.error === undefined;
      const affectedClipIds = isSuccessful && successfulCount > 0
        ? totalAffectedClipIds
        : [];

      return {
        commandType: stepResult.command.type,
        commandId: stepResult.command.commandId,
        summary: stepResult.summary,
        detail: stepResult.detail,
        affectedClipIds,
      };
    },
  );

  return {
    id: generateProposalId(),
    status: 'pending',
    baseConfigVersion: result.initialData.configVersion,
    baseSignature: result.initialData.stableSignature,
    predictedSignature: result.nextData.stableSignature,
    nextData: result.nextData,
    commandResults,
    affectedClipIds: totalAffectedClipIds,
    transactionId: result.transaction.transactionId,
    commandTypes: result.history.commandTypes,
    commandIds: result.history.commandIds,
    createdAt: Date.now(),
    metadata,
  };
};

/**
 * Create a proposal by dry-running a command input against current timeline data.
 *
 * This is the primary helper for extension commands and agent tools:
 * it runs the command through `runner.dryRun`, never mutates the timeline,
 * and wraps the result in a proposal for review.
 *
 * Returns null if the dry-run fails (all commands rejected).
 */
export const createProposalFromInput = <
  TCommand extends TimelineCommand = TimelineCommand,
>(
  data: TimelineData,
  input: TimelineCommandInput<TCommand>,
  runner: TimelineCommandRunner<TCommand>,
  metadata?: JsonObject,
): TimelineProposal | null => {
  const result = runner.dryRun(data, input);

  if (result.status === 'rejected') {
    return null;
  }

  return createProposalFromExecutionResult(result, metadata);
};

/**
 * Check whether a proposal can be applied to the given timeline data.
 * Returns true only when the config version matches exactly.
 */
export const canApplyProposal = (
  proposal: TimelineProposal,
  currentData: TimelineData,
): boolean => {
  return proposal.baseConfigVersion === currentData.configVersion;
};

/**
 * Apply a proposal by re-running the command against the given current data.
 *
 * The caller must already have verified that `canApplyProposal` returns true.
 * This re-derives the apply result against the actual current data, catching
 * any intermediate state changes and leveraging the existing persistence
 * conflict path at DataProvider.saveTimeline as the final guard.
 *
 * Returns the new TimelineData after applying the proposal.
 * Throws if the config version mismatches or if the apply fails.
 */
export const applyProposal = <
  TCommand extends TimelineCommand = TimelineCommand,
>(
  proposal: TimelineProposal,
  currentData: TimelineData,
  input: TimelineCommandInput<TCommand>,
  runner: TimelineCommandRunner<TCommand>,
): TimelineData => {
  if (!canApplyProposal(proposal, currentData)) {
    throw new Error(
      `Cannot apply proposal ${proposal.id}: config version mismatch ` +
      `(proposal: ${proposal.baseConfigVersion}, current: ${currentData.configVersion})`,
    );
  }

  const result = runner.apply(currentData, input);

  if (result.status === 'rejected') {
    throw new Error(
      `Failed to apply proposal ${proposal.id}: ${result.errors.map((e) => e.message).join('; ')}`,
    );
  }

  return result.nextData;
};
