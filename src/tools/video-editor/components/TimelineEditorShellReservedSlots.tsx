import type { ReactNode } from 'react';
import { CodePanelCanary } from '@/tools/video-editor/components/Canary/CodePanelCanary';
import { WritingPanelCanary } from '@/tools/video-editor/components/Canary/WritingPanelCanary';
import { StagePanelCanary } from '@/tools/video-editor/components/Canary/StagePanelCanary';
import type { VideoEditorSlotName, VideoEditorRenderContext } from '@/tools/video-editor/runtime/extensionSurface';

/** Slots reserved for future milestones — rendered as canaries. */
export const RESERVED_SLOT_NAMES: ReadonlySet<VideoEditorSlotName> = new Set([
  'codePanel',
  'writingPanel',
  'stagePanel',
]);

/** Milestone labels for reserved slots. */
const RESERVED_SLOT_MILESTONE: Readonly<Partial<Record<VideoEditorSlotName, string>>> = {
  codePanel: 'M4',
  writingPanel: 'M4',
  stagePanel: 'M3',
};

/** Canary component for each reserved slot. */
export const RESERVED_SLOT_CANARY: Partial<Record<VideoEditorSlotName, (props: { context: VideoEditorRenderContext }) => ReactNode>> = {
  codePanel: CodePanelCanary,
  writingPanel: WritingPanelCanary,
  stagePanel: StagePanelCanary,
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
