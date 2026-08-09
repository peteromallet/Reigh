import { Button } from '@/shared/components/ui/button.tsx';
import type { ClipTab } from '@/tools/video-editor/hooks/useEditorPreferences.ts';
import type { TimelineInteractionMode } from '@/tools/video-editor/lib/mobile-interaction-model.ts';

/**
 * Inspector-first action grid. Shown on non-desktop device classes, where
 * direct manipulation is unreliable and the explicit controls are the
 * supported path for trim, move, track changes, split, mute, and delete.
 */
export function ClipInspectorActions({
  interactionMode,
  precisionEnabled,
  canMoveTrack,
  canSplit,
  canToggleMute,
  setActiveTab,
  onSetInteractionMode,
  onSetPrecisionEnabled,
  onMoveTrackUp,
  onMoveTrackDown,
  onSplitAtPlayhead,
  onToggleMute,
  onDelete,
}: {
  interactionMode: TimelineInteractionMode;
  precisionEnabled: boolean;
  canMoveTrack: boolean;
  canSplit: boolean;
  canToggleMute: boolean;
  setActiveTab: (tab: ClipTab) => void;
  onSetInteractionMode: (mode: 'move' | 'trim') => void;
  onSetPrecisionEnabled: (enabled: boolean) => void;
  onMoveTrackUp: () => void;
  onMoveTrackDown: () => void;
  onSplitAtPlayhead: () => void;
  onToggleMute: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="rounded-xl border border-sky-400/40 bg-sky-500/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">Inspector-first actions</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Use explicit controls for trim, move, track changes, split, mute, and delete when touch editing needs to stay stable.
          </div>
        </div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-sky-100">
          {interactionMode}
          {precisionEnabled ? ' + precision' : ''}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" size="sm" className="justify-start" onClick={() => { onSetInteractionMode('trim'); setActiveTab('timing'); }}>
          Trim in inspector
        </Button>
        <Button type="button" variant="secondary" size="sm" className="justify-start" onClick={() => { onSetInteractionMode('move'); setActiveTab('timing'); }}>
          Move in inspector
        </Button>
        <Button type="button" variant="outline" size="sm" className="justify-start" onClick={onMoveTrackUp} disabled={!canMoveTrack}>
          Track up
        </Button>
        <Button type="button" variant="outline" size="sm" className="justify-start" onClick={onMoveTrackDown} disabled={!canMoveTrack}>
          Track down
        </Button>
        <Button type="button" variant="outline" size="sm" className="justify-start" onClick={onSplitAtPlayhead} disabled={!canSplit}>
          Split at playhead
        </Button>
        <Button type="button" variant="outline" size="sm" className="justify-start" onClick={onToggleMute} disabled={!canToggleMute}>
          Mute or unmute
        </Button>
        <Button type="button" variant={precisionEnabled ? 'secondary' : 'outline'} size="sm" className="justify-start" onClick={() => onSetPrecisionEnabled(!precisionEnabled)}>
          {precisionEnabled ? 'Disable precision' : 'Enable precision'}
        </Button>
        {onDelete && (
          <Button type="button" variant="destructive" size="sm" className="justify-start" onClick={onDelete}>
            Delete clip
          </Button>
        )}
      </div>
    </div>
  );
}
