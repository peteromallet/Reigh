import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import type {
  TimelineProposal,
  TimelineProposalCommandResult,
} from '@/tools/video-editor/commands/types.ts';
import type {
  TimelineCommand,
  TimelineCommandInput,
  TimelineCommandRunner,
  TimelineCommandResult as TimedCommandResult,
} from '@/tools/video-editor/hooks/useTimelineCommands.ts';
import { useTimelineCommands, type TimelineCommands } from '@/tools/video-editor/hooks/useTimelineCommands.ts';

// ---------------------------------------------------------------------------
// Proposal review state shared across palette, context menu, and agent paths
// ---------------------------------------------------------------------------

export interface ProposalReviewState {
  /** The proposal currently under review, or null if no review is active. */
  activeProposal: TimelineProposal | null;
  /** The command input that produced the proposal (needed for accept). */
  activeInput: unknown | null;
  /** The command runner used to produce the proposal (needed for accept). */
  activeRunner: unknown | null;
  /** Whether the review dialog is open. */
  isOpen: boolean;
}

export interface ProposalReviewCallbacks {
  /** Open the review dialog for a given proposal. */
  openReview: <T extends TimelineCommand = TimelineCommand>(
    proposal: TimelineProposal,
    input: TimelineCommandInput<T>,
    runner: TimelineCommandRunner<T>,
  ) => void;
  /** Close the review dialog without accepting or rejecting. */
  closeReview: () => void;
  /** Accept the current proposal. Returns success or error. */
  acceptProposal: () => TimedCommandResult<{ proposalId: string }> | null;
  /** Reject the current proposal. */
  rejectProposal: () => void;
}

const ProposalReviewContext = createContext<ProposalReviewCallbacks | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface ProposalReviewProviderProps {
  children: ReactNode;
  /** Optional callback invoked after a proposal is accepted. */
  onAccept?: (proposalId: string) => void;
  /** Optional callback invoked after a proposal is rejected. */
  onReject?: (proposalId: string) => void;
  /** Optional callback invoked when the review dialog closes without decision. */
  onClose?: () => void;
}

/**
 * Provides shared proposal review state and callbacks.
 *
 * Wrap the editor shell with this provider so palette, context menu, and
 * agent paths all route accept/reject through one path.
 */
export function ProposalReviewProvider({
  children,
  onAccept,
  onReject,
  onClose,
}: PropsWithChildren<ProposalReviewProviderProps>) {
  const commands = useTimelineCommands();

  const [state, setState] = useState<ProposalReviewState>({
    activeProposal: null,
    activeInput: null,
    activeRunner: null,
    isOpen: false,
  });

  const openReview = useCallback(
    <T extends TimelineCommand = TimelineCommand>(
      proposal: TimelineProposal,
      input: TimelineCommandInput<T>,
      runner: TimelineCommandRunner<T>,
    ) => {
      setState({
        activeProposal: proposal,
        activeInput: input,
        activeRunner: runner,
        isOpen: true,
      });
    },
    [],
  );

  const closeReview = useCallback(() => {
    const proposalId = state.activeProposal?.id;
    setState({
      activeProposal: null,
      activeInput: null,
      activeRunner: null,
      isOpen: false,
    });
    if (proposalId) {
      onClose?.();
    }
  }, [state.activeProposal?.id, onClose]);

  const acceptProposal = useCallback((): TimedCommandResult<{ proposalId: string }> | null => {
    if (!commands || !state.activeProposal || !state.activeInput || !state.activeRunner) {
      return null;
    }

    const result = commands.applyTimelineProposal(
      state.activeProposal,
      state.activeInput as TimelineCommandInput,
      state.activeRunner as TimelineCommandRunner,
    );

    setState({
      activeProposal: null,
      activeInput: null,
      activeRunner: null,
      isOpen: false,
    });

    if (result.ok) {
      onAccept?.(state.activeProposal.id);
    }

    return result;
  }, [commands, state.activeProposal, state.activeInput, state.activeRunner, onAccept]);

  const rejectProposal = useCallback(() => {
    const proposalId = state.activeProposal?.id;
    if (state.activeProposal) {
      commands.rejectTimelineProposal(state.activeProposal);
    }
    setState({
      activeProposal: null,
      activeInput: null,
      activeRunner: null,
      isOpen: false,
    });
    if (proposalId) {
      onReject?.(proposalId);
    }
  }, [commands, state.activeProposal, onReject]);

  const value = useMemo<ProposalReviewCallbacks>(
    () => ({ openReview, closeReview, acceptProposal, rejectProposal }),
    [openReview, closeReview, acceptProposal, rejectProposal],
  );

  return (
    <ProposalReviewContext.Provider value={value}>
      {children}
      {state.isOpen && state.activeProposal ? (
        <ProposalReviewDialog
          proposal={state.activeProposal}
          onAccept={acceptProposal}
          onReject={rejectProposal}
          onClose={closeReview}
        />
      ) : null}
    </ProposalReviewContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Access the shared proposal review callbacks.
 *
 * Returns null when called outside a ProposalReviewProvider.
 */
export function useProposalReview(): ProposalReviewCallbacks | null {
  return useContext(ProposalReviewContext);
}

// ---------------------------------------------------------------------------
// Dialog component
// ---------------------------------------------------------------------------

interface ProposalReviewDialogProps {
  proposal: TimelineProposal;
  onAccept: () => TimedCommandResult<{ proposalId: string }> | null;
  onReject: () => void;
  onClose: () => void;
}

function formatTimestamp(unixMs: number): string {
  return new Date(unixMs).toLocaleString();
}

function commandStatusIcon(result: TimelineProposalCommandResult): string {
  if (result.error) {
    return '✗';
  }
  return '✓';
}

function affectedClipSummary(affectedClipIds: string[]): string {
  if (affectedClipIds.length === 0) {
    return 'No clips affected';
  }
  if (affectedClipIds.length === 1) {
    return `1 clip affected: ${affectedClipIds[0]}`;
  }
  return `${affectedClipIds.length} clips affected: ${affectedClipIds.slice(0, 3).join(', ')}${affectedClipIds.length > 3 ? '…' : ''}`;
}

export function ProposalReviewDialog({
  proposal,
  onAccept,
  onReject,
  onClose,
}: ProposalReviewDialogProps) {
  const [acceptResult, setAcceptResult] = useState<TimedCommandResult<{ proposalId: string }> | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);

  const handleAccept = useCallback(() => {
    setIsAccepting(true);
    const result = onAccept();
    setAcceptResult(result);
    setIsAccepting(false);
  }, [onAccept]);

  const handleReject = useCallback(() => {
    onReject();
  }, [onReject]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const metadataSource = typeof proposal.metadata?.source === 'string'
    ? proposal.metadata.source
    : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Review proposal ${proposal.id}`}
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/40"
    >
      <div className="mx-4 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Review Timeline Changes
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {metadataSource ? `Proposed by ${metadataSource}` : 'Proposal'} ·{' '}
              {formatTimestamp(proposal.createdAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
            aria-label="Close review dialog"
          >
            ✕
          </button>
        </div>

        {/* Command summaries */}
        <div className="mb-4 max-h-64 overflow-y-auto rounded border border-gray-200 p-3 dark:border-gray-700">
          <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            Commands ({proposal.commandResults.length})
          </h3>
          <ul className="space-y-1">
            {proposal.commandResults.map((result, index) => (
              <li
                key={result.commandId ?? `${result.commandType}-${index}`}
                className="flex items-start gap-2 text-sm"
              >
                <span className="mt-0.5 text-xs" aria-hidden="true">
                  {commandStatusIcon(result)}
                </span>
                <span className="text-gray-700 dark:text-gray-300">
                  <span className="font-mono text-xs text-gray-500">
                    {result.commandType}
                  </span>
                  {result.summary ? ` — ${result.summary}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Affected clips */}
        <div className="mb-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {affectedClipSummary(proposal.affectedClipIds)}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Base version: {proposal.baseConfigVersion} ·{' '}
            Predicted signature: {proposal.predictedSignature.slice(0, 12)}…
          </p>
        </div>

        {/* Accept result */}
        {acceptResult && !acceptResult.ok ? (
          <div className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {acceptResult.error.message}
          </div>
        ) : null}
        {acceptResult?.ok ? (
          <div className="mb-4 rounded bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
            Proposal applied successfully.
          </div>
        ) : null}

        {/* Actions */}
        {!acceptResult?.ok ? (
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleReject}
              disabled={isAccepting}
              className="rounded px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={isAccepting}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isAccepting ? 'Applying…' : 'Accept & Apply'}
            </button>
          </div>
        ) : (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleClose}
              className="rounded px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
