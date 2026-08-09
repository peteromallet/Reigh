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
import { Zap } from 'lucide-react';
import { useVideoEditorRuntime } from '@/tools/video-editor/contexts/VideoEditorRuntimeContext';
import type { PackageStateInventoryEntry } from '@/tools/video-editor/runtime/extensionSurface';
import type { Diagnostic, ExtensionManifest } from '@reigh/editor-sdk';
import { ExtensionTrustWarningBanner } from './ExtensionTrustWarningBanner';
import { deriveContributionSummary, type ContributionSummary } from './contributionSummary';
import { ManagerSummaryBar } from './ManagerSummaryBar';
import { PackageCard } from './PackageCard';
import type { PackageDiagnosticSummary } from './PackageDiagnostics';

export type { ContributionSummary } from './contributionSummary';
export type { PackageDiagnosticSummary } from './PackageDiagnostics';

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

/** Stable frozen reference for empty diagnostics — required by useSyncExternalStore. */
const EMPTY_DIAGNOSTIC_SNAPSHOT: readonly Diagnostic[] = Object.freeze([]);
const EMPTY_PACKAGE_STATE_INVENTORY: readonly PackageStateInventoryEntry[] = Object.freeze([]);

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

  if (packageStateInventory.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <ExtensionTrustWarningBanner />
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
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ExtensionTrustWarningBanner />
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
    </div>
  );
}
