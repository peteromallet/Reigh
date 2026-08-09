import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/shared/components/ui/alert-dialog.tsx';
import type { useEditorSync } from '@/tools/video-editor/hooks/useEditorSync.ts';

/**
 * Shown when both the local draft and the database version advanced since the
 * last sync. The local edits are already preserved in a keep-both artifact;
 * this only asks which version to keep editing against.
 */
export function TimelineSyncDivergenceDialog({
  open,
  onOpenChange,
  lastSyncResult,
  onLoadLatestFromDb,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lastSyncResult: ReturnType<typeof useEditorSync>['lastSyncResult'];
  onLoadLatestFromDb: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Timeline divergence detected</AlertDialogTitle>
          <AlertDialogDescription className="space-y-3 text-sm">
            <p>
              Both your local draft and the database version have advanced since the last sync.
              Your local edits have been preserved in a keep-both artifact.
            </p>
            {lastSyncResult?.keepBothArtifact && (
              <div className="rounded-md border border-border bg-muted/50 p-3">
                <div className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Local artifact (IndexedDB)
                </div>
                <div className="font-mono text-[11px] text-foreground">
                  ID: {lastSyncResult.keepBothArtifact.id}
                </div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  Created: {lastSyncResult.keepBothArtifact.created_at}
                </div>
                {lastSyncResult.keepBothArtifact.remote_entry_id && (
                  <>
                    <div className="mt-2 mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Database divergence record
                    </div>
                    <div className="font-mono text-[11px] text-foreground">
                      Entry ID: {lastSyncResult.keepBothArtifact.remote_entry_id}
                    </div>
                  </>
                )}
              </div>
            )}
            {lastSyncResult?.dbHead && (
              <div className="text-[11px] text-muted-foreground">
                DB head: version {lastSyncResult.dbHead.version}
                {lastSyncResult.dbHead.hash && (
                  <span className="font-mono"> — {lastSyncResult.dbHead.hash.slice(0, 12)}&hellip;</span>
                )}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              To resolve, load the latest from the database and reapply your changes, or continue editing
              with your local version. Both versions are safely stored.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onOpenChange(false)}>Continue editing</AlertDialogCancel>
          <AlertDialogAction onClick={onLoadLatestFromDb}>
            Load latest from DB
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
