import { Download, FileOutput } from 'lucide-react';
import { Button } from '@/shared/components/ui/button.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu.tsx';
import type { VideoEditorOutputFormatDescriptor } from '@/tools/video-editor/runtime/extensionSurface';
import { useTimelineChromeContext } from '@/tools/video-editor/hooks/timelineStore.ts';

/**
 * M6: Export dropdown — compile-only formats near render controls.
 * Collapsed to a chip: this sits in the preview overlay bar, and at its
 * natural width it laid a 320px card across the video on every device.
 */
export function TimelineExportMenu({
  compileOnlyExportFormats,
  renderDependentExportFormats,
  previewActionButtonClass,
}: {
  compileOnlyExportFormats: VideoEditorOutputFormatDescriptor[];
  renderDependentExportFormats: VideoEditorOutputFormatDescriptor[];
  previewActionButtonClass: string;
}) {
  const chrome = useTimelineChromeContext();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={`gap-1.5 ${previewActionButtonClass}`}
        >
          <FileOutput className="h-3.5 w-3.5" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          Export Formats
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {compileOnlyExportFormats.length > 0 && (
          <>
            {compileOnlyExportFormats.map((fmt) => (
              <DropdownMenuItem
                key={fmt.id}
                onClick={() => {
                  // Compile-only export: dispatch via chrome or local handler
                  console.log(`[Export] Compile-only format: ${fmt.id} (${fmt.label})`);
                }}
                className="gap-2 text-[11px]"
              >
                <FileOutput className="h-3 w-3 text-emerald-400" />
                <span className="flex-1">{fmt.label}</span>
                <span className="text-[10px] text-muted-foreground uppercase">.{fmt.outputExtension}</span>
              </DropdownMenuItem>
            ))}
            {renderDependentExportFormats.length > 0 && <DropdownMenuSeparator />}
          </>
        )}
        {renderDependentExportFormats.length > 0 && (
          <>
            <DropdownMenuLabel className="text-[10px] text-muted-foreground/60">
              Render via Astrid
            </DropdownMenuLabel>
            {renderDependentExportFormats.map((fmt) => (
              <DropdownMenuItem
                key={fmt.id}
                disabled={Boolean(fmt.disabled) || chrome.renderStatus === 'rendering'}
                onClick={() => {
                  if (!fmt.disabled) void chrome.startRender();
                }}
                className="gap-2 text-[11px] text-muted-foreground/50"
                title={fmt.disabledReason ?? `Render "${fmt.label}" as an Astrid task to the selected destination.`}
              >
                <Download className="h-3 w-3" />
                <span className="flex-1">{fmt.label}</span>
                <span className="text-[10px] text-muted-foreground/40 uppercase">.{fmt.outputExtension}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}
        {compileOnlyExportFormats.length === 0 && renderDependentExportFormats.length === 0 && (
          <DropdownMenuItem disabled className="text-[11px] text-muted-foreground/50">
            No export formats registered
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
