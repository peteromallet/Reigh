import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/shared/components/ui/button.tsx';
import { cn } from '@/shared/components/ui/contracts/cn.ts';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/components/ui/dialog.tsx';
import { PropertiesPanel } from '@/tools/video-editor/components/PropertiesPanel/PropertiesPanel.tsx';
import { useTimelineEditorOps } from '@/tools/video-editor/hooks/timelineStore.ts';
import type { TimelineInspectorTarget } from '@/tools/video-editor/lib/mobile-interaction-model.ts';

/**
 * Phone single-pane inspector: the properties panel lives in a bottom sheet
 * because there is no room for a persistent right rail.
 */
export function TimelineMobileInspectorDialog({
  isMobilePropertiesOpen,
  setIsMobilePropertiesOpen,
  inspectorTarget,
  hasClipSelection,
  inspectorButtonLabel,
  previewActionButtonClass,
  mobilePropertiesTitle,
  mobilePropertiesDescription,
}: {
  isMobilePropertiesOpen: boolean;
  setIsMobilePropertiesOpen: (open: boolean) => void;
  inspectorTarget: TimelineInspectorTarget;
  hasClipSelection: boolean;
  inspectorButtonLabel: string;
  previewActionButtonClass: string;
  mobilePropertiesTitle: string;
  mobilePropertiesDescription: string;
}) {
  const editorOps = useTimelineEditorOps();

  return (
    <Dialog
      open={isMobilePropertiesOpen}
      onOpenChange={(open) => {
        setIsMobilePropertiesOpen(open);
        if (open) {
          editorOps.setInspectorTarget(inspectorTarget);
          editorOps.setContextTarget(inspectorTarget);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={hasClipSelection ? 'secondary' : 'outline'}
          onClick={() => {
            editorOps.setInspectorTarget(inspectorTarget);
            editorOps.setContextTarget(inspectorTarget);
          }}
          className={cn(
            `gap-1.5 ${previewActionButtonClass}`,
            hasClipSelection && 'border-sky-400/60 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20',
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {inspectorButtonLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="top-auto bottom-0 max-h-[78dvh] w-[calc(100vw-1rem)] max-w-none translate-x-[-50%] translate-y-0 gap-0 overflow-hidden rounded-t-2xl border-border bg-background p-0 data-[ending-style]:slide-out-to-top-[100%] data-[open]:slide-in-from-top-[100%] motion-reduce:animate-none motion-reduce:transition-none sm:max-w-lg sm:translate-y-[-50%] sm:rounded-lg sm:p-6 sm:data-[ending-style]:slide-out-to-top-[48%] sm:data-[open]:slide-in-from-top-[48%]">
        <DialogHeader className="border-b border-border px-4 py-3 text-left">
          <DialogTitle className="text-base">{mobilePropertiesTitle}</DialogTitle>
          <DialogDescription>{mobilePropertiesDescription}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden p-3">
          <PropertiesPanel />
        </div>
      </DialogContent>
    </Dialog>
  );
}
