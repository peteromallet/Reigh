import { useEffect, useState } from 'react';
import { useEditorSync } from '@/tools/video-editor/hooks/useEditorSync.ts';

/**
 * Wraps useEditorSync with the shell's user-facing feedback: the transient
 * result message beside the sync button, and the divergence dialog that opens
 * when both the local draft and the database version have advanced.
 */
export function useEditorSyncFeedback() {
  const sync = useEditorSync();
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncResultMessage, setSyncResultMessage] = useState<string | null>(null);

  // Show sync result feedback and auto-clear
  useEffect(() => {
    if (sync.syncState === 'idle' || sync.syncState === 'syncing') {
      return;
    }
    let message: string | null = null;
    switch (sync.syncState) {
      case 'up_to_date':
        message = 'Timeline is up to date';
        break;
      case 'source_only_saved':
        message = 'Local changes synced';
        break;
      case 'destination_only_reloaded':
        message = 'Loaded latest from server';
        break;
      case 'both_advanced':
        message = 'Divergence detected — both versions preserved';
        setSyncDialogOpen(true);
        break;
      case 'bookmark_incompatible':
        message = 'Sync bookmarks are incompatible';
        break;
      case 'error':
        message = sync.syncError ?? 'Sync failed';
        break;
    }
    setSyncResultMessage(message);
    if (message && sync.syncState !== 'both_advanced') {
      const timer = setTimeout(() => setSyncResultMessage(null), 4000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [sync.syncState, sync.syncError]);

  return { sync, syncDialogOpen, setSyncDialogOpen, syncResultMessage };
}
