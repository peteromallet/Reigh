/**
 * ExtensionManager — Manager host for the Extensions tab in PropertiesPanel.
 *
 * Displays the package state inventory from the extension runtime, with
 * status badges, metadata, state reasons, and per-package enable/disable
 * controls backed by ExtensionStateRepository.putEnablementState.
 *
 * Scope boundary (SD2): Only manages packages already loaded/supplied by
 * the host; does not add external package resolution, install, update,
 * delete, discovery, or marketplace flows.
 *
 * Visibility principle (SD3): Disabled packages remain visible and
 * inspectable; invalid, incompatible, and duplicate packages are never
 * hidden.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { Code2, ToggleLeft, ToggleRight, Zap } from 'lucide-react';
import { useVideoEditorRuntime } from '@/tools/video-editor/contexts/VideoEditorRuntimeContext';
import type {
  ExtensionRuntime,
  PackageStateInventoryEntry,
} from '@/tools/video-editor/runtime/extensionSurface';
import type { Diagnostic, ExtensionManifest } from '@reigh/editor-sdk';
import { ExtensionTrustWarningBanner } from './ExtensionTrustWarningBanner';
import { deriveContributionSummary, type ContributionSummary } from './contributionSummary';
import { ManagerSummaryBar } from './ManagerSummaryBar';
import { PackageCard } from './PackageCard';
import type { PackageDiagnosticSummary } from './PackageDiagnostics';
import { devLocalExtensions } from '@/tools/video-editor/dev/localExtensions';
import {
  getSnapshot as getDevDisabledSnapshot,
  setDevExtensionEnabled,
  subscribe as subscribeDevEnablement,
} from '@/tools/video-editor/dev/devExtensionEnablement';

export type { ContributionSummary } from './contributionSummary';
export type { PackageDiagnosticSummary } from './PackageDiagnostics';

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

/** Stable frozen reference for empty diagnostics — required by useSyncExternalStore. */
const EMPTY_DIAGNOSTIC_SNAPSHOT: readonly Diagnostic[] = Object.freeze([]);
const EMPTY_PACKAGE_STATE_INVENTORY: readonly PackageStateInventoryEntry[] = Object.freeze([]);

// ---------------------------------------------------------------------------
// DEV-only: local (workspace) extensions
// ---------------------------------------------------------------------------

interface DevLocalExtensionRow {
  readonly id: string;
  readonly label: string;
  readonly version: string | null;
  readonly description: string | null;
  readonly disabled: boolean;
  readonly active: boolean;
  readonly summary: ContributionSummary | null;
}

/**
 * DEV-only “Local extensions” section.
 *
 * Direct (dev-local) extensions are not packages — they never enter the
 * installed-package repository or the loader's package-state inventory, so
 * they are not routed through PackageCard. Inventory comes strictly from
 * `devLocalExtensions`; the runtime's enabled extension list only determines
 * active state and contribution summaries. This keeps a disabled local
 * extension visible (and re-enableable) even though the runtime omits it
 * after teardown.
 *
 * The whole section is gated on `import.meta.env.DEV` at the call site (a
 * literal, so production builds drop it).
 */
function DevLocalExtensionsSection({
  extensionRuntime,
}: {
  extensionRuntime: ExtensionRuntime | null;
}) {
  // Same external store the page subscribes to: toggling here notifies the
  // page, which re-filters `devLocalExtensions` through the memo — no refresh
  // key is needed for the direct-extension fast path.
  const devDisabledIds = useSyncExternalStore(
    subscribeDevEnablement,
    getDevDisabledSnapshot,
    getDevDisabledSnapshot,
  );

  const activeDevExtensionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const ext of extensionRuntime?.extensions ?? []) {
      const id = ext.manifest.id;
      if (typeof id === 'string' && id.length > 0) {
        ids.add(id);
      }
    }
    return ids;
  }, [extensionRuntime]);

  const rows = useMemo<DevLocalExtensionRow[]>(() => {
    return devLocalExtensions.map((ext) => {
      const id = ext.manifest.id as string;
      const disabled = devDisabledIds.has(id);
      // Active state derives from the runtime's enabled extension list; a
      // disabled local is omitted from that list but must stay listed here.
      const active = !disabled && activeDevExtensionIds.has(id);
      const summary =
        active && extensionRuntime
          ? deriveContributionSummary(id, extensionRuntime)
          : null;
      return {
        id,
        label: ext.manifest.label ?? id,
        version: ext.manifest.version ?? null,
        description: ext.manifest.description ?? null,
        disabled,
        active,
        summary,
      };
    });
  }, [activeDevExtensionIds, devDisabledIds, extensionRuntime]);

  const summaryLine = (row: DevLocalExtensionRow): string => {
    if (row.active && row.summary) {
      const parts: string[] = [];
      if (row.summary.declared > 0) {
        parts.push(
          `${row.summary.declared} contribution${row.summary.declared !== 1 ? 's' : ''}`,
        );
      }
      if (row.summary.active > 0) {
        parts.push(`${row.summary.active} active`);
      }
      if (row.summary.inactive > 0) {
        parts.push(`${row.summary.inactive} inactive`);
      }
      return parts.length > 0 ? parts.join(' · ') : 'Active';
    }
    return row.disabled ? 'Inactive (disabled)' : 'Inactive';
  };

  return (
    <section
      aria-label="Local extensions"
      data-testid="dev-local-extensions"
      className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-card/30 p-3"
    >
      <div className="flex items-center gap-2">
        <Code2 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Local extensions
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          dev
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="px-1 text-xs text-muted-foreground/70">
          No local extensions in this workspace.
        </div>
      ) : (
        rows.map((row) => (
          <div
            key={row.id}
            className="rounded-lg border border-border bg-card/40 p-3"
            data-video-editor-dev-local-extension={row.id}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {row.label}
                  </span>
                  {row.version && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      v{row.version}
                    </span>
                  )}
                  <span className="shrink-0 rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
                    Direct
                  </span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/80">
                  {row.id}
                </div>
                {row.description && (
                  <div className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">
                    {row.description}
                  </div>
                )}
                <div className="mt-1.5 text-[11px] text-muted-foreground/70">
                  {summaryLine(row)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDevExtensionEnabled(row.id, row.disabled)}
                className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-muted/60"
                aria-label={`${row.disabled ? 'Enable' : 'Disable'} ${row.id}`}
                data-video-editor-dev-local-toggle={row.id}
              >
                {/* The toggle reflects the store state; runtime activeness is
                    reported by the summary line below. */}
                {row.disabled ? (
                  <>
                    <ToggleLeft className="h-3 w-3 text-zinc-400" />
                    <span className="text-zinc-400">Disabled</span>
                  </>
                ) : (
                  <>
                    <ToggleRight className="h-3 w-3 text-emerald-400" />
                    <span className="text-emerald-400">Enabled</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ))
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ExtensionManager() {
  const { extensionRuntime, extensionStateRepository, triggerExtensionRefresh, diagnosticCollection, settingsNotificationRegistry } = useVideoEditorRuntime();
  const packageStateInventory = extensionRuntime?.packageStateInventory ?? EMPTY_PACKAGE_STATE_INVENTORY;

  // Subscribe to live diagnostic updates from the provider-scoped DiagnosticCollection.
  const allDiagnostics = useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        if (!diagnosticCollection) return () => {};
        const handle = diagnosticCollection.subscribe(listener);
        return () => handle.dispose();
      },
      [diagnosticCollection],
    ),
    useCallback(
      () => diagnosticCollection?.getSnapshot() ?? EMPTY_DIAGNOSTIC_SNAPSHOT,
      [diagnosticCollection],
    ),
    () => EMPTY_DIAGNOSTIC_SNAPSHOT,
  );

  // Derive contribution summaries per package from the runtime.
  // Prefer the precomputed PackageContributionSummary from normalizeExtensionRuntime,
  // falling back to the live deriveContributionSummary for backward compatibility.
  const contributionSummaries = useMemo(() => {
    if (!extensionRuntime) return new Map<string, ContributionSummary | null>();
    const map = new Map<string, ContributionSummary | null>();
    for (const entry of packageStateInventory) {
      const precomputed = entry.contributionSummary;
      if (precomputed) {
        // Convert PackageContributionSummary → ContributionSummary (subset used by UI)
        map.set(entry.extensionId, {
          declared: precomputed.declared,
          active: precomputed.active >= 0 ? precomputed.active : 0,
          inactive: precomputed.inactive >= 0 ? precomputed.inactive : 0,
          kinds: precomputed.kinds,
        });
      } else {
        // Fallback: derive from active runtime descriptors
        map.set(
          entry.extensionId,
          deriveContributionSummary(entry.extensionId, extensionRuntime),
        );
      }
    }
    return map;
  }, [extensionRuntime, packageStateInventory]);

  // Manifest lookup: extensionId → ExtensionManifest
  const manifestLookup = useMemo(() => {
    const map = new Map<string, ExtensionManifest>();
    if (extensionRuntime) {
      for (const ext of extensionRuntime.extensions) {
        map.set(ext.manifest.id as string, ext.manifest as ExtensionManifest);
      }
    }
    return map;
  }, [extensionRuntime]);

  // Derive per-package diagnostic summaries from the live diagnostic snapshot
  const packageDiagnostics = useMemo(() => {
    const map = new Map<string, PackageDiagnosticSummary>();
    for (const entry of packageStateInventory) {
      const extDiags = allDiagnostics.filter(
        (d) => (d.extensionId ?? '') === entry.extensionId,
      );
      map.set(entry.extensionId, {
        errorCount: extDiags.filter((d) => d.severity === 'error').length,
        warningCount: extDiags.filter((d) => d.severity === 'warning').length,
        infoCount: extDiags.filter((d) => d.severity === 'info').length,
        diagnostics: extDiags,
      });
    }
    return map;
  }, [allDiagnostics, packageStateInventory]);

  // The Local extensions section is DEV-only (literal guard, dropped in
  // production builds) and must render even when the package inventory is
  // empty — dev-local extensions are not packages and do not populate it.
  const hasPackages = packageStateInventory.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <ExtensionTrustWarningBanner />
      {import.meta.env.DEV && (
        <DevLocalExtensionsSection extensionRuntime={extensionRuntime ?? null} />
      )}
      {hasPackages ? (
        <>
          <ManagerSummaryBar entries={packageStateInventory} />
          <div className="flex flex-col gap-2">
            {packageStateInventory.map((entry) => (
              <PackageCard
                key={entry.extensionId}
                entry={entry}
                contributionSummary={
                  contributionSummaries.get(entry.extensionId) ?? null
                }
                repository={extensionStateRepository ?? null}
                onToggleRequest={triggerExtensionRefresh ?? (() => {})}
                manifest={manifestLookup.get(entry.extensionId) ?? null}
                diagnosticSummary={packageDiagnostics.get(entry.extensionId)}
                settingsNotificationRegistry={settingsNotificationRegistry ?? null}
              />
            ))}
          </div>
        </>
      ) : (
        <div
          className="flex flex-col items-center justify-center gap-3 py-8 text-muted-foreground"
          role="status"
          aria-label="No packages in inventory"
        >
          <Zap className="h-8 w-8 opacity-40" />
          <span className="text-sm">No packages in inventory.</span>
          <span className="text-xs text-muted-foreground/60">
            Extensions supplied by the host will appear here.
          </span>
        </div>
      )}
    </div>
  );
}
