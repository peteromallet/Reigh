import { useState, type FC } from 'react';
import { AlertTriangle, Info, XCircle } from 'lucide-react';
import { Button } from '@/shared/components/ui/button.tsx';
import { Badge } from '@/shared/components/ui/badge.tsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog.tsx';
import { cn } from '@/shared/components/ui/contracts/cn.ts';
import { useVideoEditorDiagnostics } from '@/tools/video-editor/hooks/useVideoEditorDiagnostics.ts';
import type { VideoEditorDiagnostic, VideoEditorDiagnosticSeverity } from '@/tools/video-editor/runtime/diagnostics.ts';

// ---------------------------------------------------------------------------
// Severity colours and icons
// ---------------------------------------------------------------------------

const SEVERITY_STYLES: Record<VideoEditorDiagnosticSeverity, { icon: FC<{ className?: string }>; badgeVariant: 'destructive' | 'secondary' | 'outline'; rowClass: string }> = {
  error: { icon: XCircle, badgeVariant: 'destructive', rowClass: 'border-l-2 border-l-red-500/60 bg-red-500/5' },
  warning: { icon: AlertTriangle, badgeVariant: 'secondary', rowClass: 'border-l-2 border-l-amber-500/60 bg-amber-500/5' },
  info: { icon: Info, badgeVariant: 'outline', rowClass: 'border-l-2 border-l-sky-500/60 bg-sky-500/5' },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SeverityIcon({ severity }: { severity: VideoEditorDiagnosticSeverity }) {
  const { icon: Icon } = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.info;
  return <Icon className="h-3.5 w-3.5 shrink-0" />;
}

function DiagnosticRow({ diagnostic }: { diagnostic: VideoEditorDiagnostic }) {
  const styles = SEVERITY_STYLES[diagnostic.severity] ?? SEVERITY_STYLES.info;
  const [expanded, setExpanded] = useState(false);
  const hasDetail = diagnostic.detail && Object.keys(diagnostic.detail).length > 0;

  return (
    <div
      className={cn('rounded-md px-3 py-2 text-xs', styles.rowClass)}
      data-testid="video-editor-diagnostic-row"
      data-diagnostic-code={diagnostic.code}
      data-diagnostic-severity={diagnostic.severity}
      data-diagnostic-source={diagnostic.source}
      {...(diagnostic.extensionId ? { 'data-diagnostic-extension-id': diagnostic.extensionId } : {})}
    >
      <div className="flex items-start gap-2">
        <SeverityIcon severity={diagnostic.severity} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={styles.badgeVariant} className="h-4 px-1 text-[9px] capitalize">
              {diagnostic.severity}
            </Badge>
            <span className="font-mono text-[10px] text-muted-foreground">{diagnostic.code}</span>
            {diagnostic.source && (
              <span className="text-[10px] text-muted-foreground/70">{diagnostic.source}</span>
            )}
            {diagnostic.extensionId && (
              <span className="font-mono text-[10px] text-muted-foreground/70 truncate max-w-[120px]">
                {diagnostic.extensionId}
              </span>
            )}
          </div>
          <p className="mt-1 text-foreground/90 leading-relaxed">{diagnostic.message}</p>
          {diagnostic.timestamp && (
            <p className="mt-0.5 text-[10px] text-muted-foreground/60">
              {new Date(diagnostic.timestamp).toLocaleString()}
            </p>
          )}
        </div>
      </div>
      {hasDetail && (
        <button
          type="button"
          className="mt-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      )}
      {expanded && hasDetail && (
        <pre className="mt-1.5 max-h-24 overflow-auto rounded bg-muted/50 p-2 font-mono text-[10px] text-muted-foreground">
          {JSON.stringify(diagnostic.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiagnosticsPanel
// ---------------------------------------------------------------------------

export function DiagnosticsPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { diagnostics, errorCount, warningCount, infoCount, totalCount } = useVideoEditorDiagnostics();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[80vh] w-[calc(100vw-2rem)] max-w-lg overflow-hidden p-0"
        data-testid="video-editor-diagnostics-panel"
      >
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            Diagnostics
            {totalCount > 0 && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                {totalCount}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {totalCount === 0
              ? 'No diagnostics reported.'
              : `Showing ${totalCount} diagnostic${totalCount === 1 ? '' : 's'}: ${errorCount} error${errorCount === 1 ? '' : 's'}, ${warningCount} warning${warningCount === 1 ? '' : 's'}, ${infoCount} info.`}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(80vh-7rem)] overflow-y-auto p-4">
          {diagnostics.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
              <Info className="h-8 w-8 opacity-40" />
              <p className="text-sm">No diagnostics to display.</p>
              <p className="text-xs">All systems are operating normally.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {diagnostics.map((d) => (
                <DiagnosticRow key={d.id} diagnostic={d} />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
