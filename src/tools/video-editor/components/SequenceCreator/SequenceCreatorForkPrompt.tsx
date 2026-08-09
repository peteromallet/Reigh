import { Button } from '@/shared/components/ui/button.tsx';
import type { ForkPending } from '@/tools/video-editor/state/sequenceCreatorStore.ts';

/**
 * Fork-to-DB confirmation card (T13). Shown when the classifier routed a
 * theme-bundled clip to the code path and the user must deliberately copy it
 * into a per-user DB resource before editing.
 */
export function SequenceCreatorForkPrompt({
  forkPending,
  isGenerating,
  onConfirmFork,
  onCancelFork,
}: {
  forkPending: ForkPending;
  isGenerating: boolean;
  onConfirmFork: () => void;
  onCancelFork: () => void;
}) {
  return (
    <div
      data-testid="sequence-creator-fork-prompt"
      className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-foreground"
    >
      <div className="font-medium">Customize this sequence for yourself</div>
      <p className="text-muted-foreground">
        This change requires a custom component. Forking copies "{forkPending.selectedClipType}"
        into a per-user DB resource you can edit. The result renders in browser only —
        worker-side render isn't supported for custom components yet.
      </p>
      <p className="text-muted-foreground italic">{forkPending.reason}</p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={onConfirmFork}
          disabled={
            isGenerating || forkPending.bundledSource.status !== 'available'
          }
        >
          Customize
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancelFork}>
          Cancel
        </Button>
      </div>
      {forkPending.bundledSource.status === 'cannot-fork' && (
        <div className="text-destructive">{forkPending.bundledSource.reason}</div>
      )}
    </div>
  );
}
