import { useMemo } from 'react';
import { AlertCircle, Ban, CheckCircle, Puzzle } from 'lucide-react';
import type { PackageState } from '@/tools/video-editor/runtime/extensionLoader';
import type { PackageStateInventoryEntry } from '@/tools/video-editor/runtime/extensionSurface';

// ---------------------------------------------------------------------------
// Summary bar
// ---------------------------------------------------------------------------

export function ManagerSummaryBar({
  entries,
}: {
  entries: readonly PackageStateInventoryEntry[];
}) {
  const counts = useMemo(() => {
    const result: Record<PackageState, number> = {
      loaded: 0,
      'disabled-by-user': 0,
      invalid: 0,
      incompatible: 0,
      duplicate: 0,
      'settings-error': 0,
      'runtime-error': 0,
    };
    for (const e of entries) {
      result[e.packageState]++;
    }
    return result;
  }, [entries]);

  const hasIssues =
    counts.invalid > 0 ||
    counts.incompatible > 0 ||
    counts['runtime-error'] > 0 ||
    counts['settings-error'] > 0;

  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground"
      aria-label={`Extension summary: ${entries.length} packages, ${counts.loaded} loaded`}
    >
      <span className="flex items-center gap-1">
        <Puzzle className="h-3.5 w-3.5" />
        {entries.length} package{entries.length !== 1 ? 's' : ''}
      </span>
      {counts.loaded > 0 && (
        <span className="flex items-center gap-1 text-emerald-400">
          <CheckCircle className="h-3 w-3" />
          {counts.loaded} loaded
        </span>
      )}
      {counts['disabled-by-user'] > 0 && (
        <span className="flex items-center gap-1 text-zinc-400">
          <Ban className="h-3 w-3" />
          {counts['disabled-by-user']} disabled
        </span>
      )}
      {hasIssues && (
        <span className="flex items-center gap-1 text-red-400">
          <AlertCircle className="h-3 w-3" />
          {counts.invalid + counts.incompatible + counts['runtime-error'] +
            counts['settings-error']}{' '}
          issue{(counts.invalid + counts.incompatible + counts['runtime-error'] + counts['settings-error']) !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}
