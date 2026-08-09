import { AlertTriangle, Download } from 'lucide-react';
import { Button } from '@/shared/components/ui/button.tsx';
import { cn } from '@/shared/components/ui/contracts/cn.ts';
import { useTimelineChromeContext } from '@/tools/video-editor/hooks/timelineStore.ts';

/** Render button, render blocker message, and the finished-render download link. */
export function TimelineRenderControls({
  previewActionButtonClass,
  touchChrome,
}: {
  previewActionButtonClass: string;
  touchChrome: boolean;
}) {
  const chrome = useTimelineChromeContext();

  return (
    <>
      <Button
        type="button"
        size="sm"
        className={`gap-1.5 ${previewActionButtonClass}`}
        onClick={() => void chrome.startRender()}
        disabled={chrome.renderStatus === 'rendering'}
      >
        <Download className="h-3.5 w-3.5" />
        {chrome.renderStatus === 'rendering' && chrome.renderProgress
          ? `Render ${chrome.renderProgress.percent}%`
          : 'Render'}
      </Button>
      {chrome.renderStatus === 'error' && chrome.renderLog && (
        <div
          className="absolute right-0 top-full mt-1 w-72 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-300 backdrop-blur-sm"
          data-video-editor-render-blocker="true"
        >
          <div className="flex items-start gap-1">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="line-clamp-3">{chrome.renderLog.split('\n')[0]}</span>
          </div>
        </div>
      )}
      {chrome.renderResultUrl && chrome.renderStatus === 'done' && !chrome.renderDirty && (
        <a
          href={chrome.renderResultUrl}
          download={chrome.renderResultFilename ?? undefined}
          className={cn(
            'rounded-md border border-border/70 bg-background/80 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none',
            touchChrome ? 'min-h-11 px-3 py-2' : 'px-2 py-1',
          )}
        >
          Download
        </a>
      )}
    </>
  );
}
