import type { VideoEditorSlotName } from '@/tools/video-editor/runtime/extensionSurface';

/** Slots reserved for future milestones — rendered as inert placeholders. */
export const RESERVED_SLOT_NAMES: Readonly<Partial<Record<VideoEditorSlotName, true>>> = {
  codePanel: true,
  writingPanel: true,
  stagePanel: true,
};

/** Milestone labels for reserved slots. */
const RESERVED_SLOT_MILESTONE: Readonly<Partial<Record<VideoEditorSlotName, string>>> = {
  codePanel: 'M4',
  writingPanel: 'M4',
  stagePanel: 'M3',
};

/**
 * Inert reserved placeholder rendered when a slot has no registered renderer.
 * Displays the slot name and target milestone — non-interactive, keyboard-inert.
 */
export function InertReservedPlaceholder({ slotName }: { slotName: VideoEditorSlotName }) {
  const milestone = RESERVED_SLOT_MILESTONE[slotName] ?? 'future';
  return (
    <div
      data-video-editor-slot={slotName}
      data-video-editor-slot-inert="true"
      data-video-editor-slot-milestone={milestone}
      className="flex items-center justify-center rounded-md border border-dashed border-border/50 bg-muted/30 px-3 py-2 text-[10px] text-muted-foreground/60"
      aria-hidden="true"
      role="presentation"
      tabIndex={-1}
    >
      <span className="select-none uppercase tracking-[0.14em]">
        {slotName} — {milestone}
      </span>
    </div>
  );
}
