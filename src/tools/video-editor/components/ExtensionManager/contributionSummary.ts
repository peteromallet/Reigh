import type { ContributionKind } from '@reigh/editor-sdk';

// ---------------------------------------------------------------------------
// Contribution summary helpers
// ---------------------------------------------------------------------------

/** Short human-readable label for each contribution kind. */
const CONTRIBUTION_KIND_LABEL: Partial<Record<ContributionKind, string>> = {
  slot: 'Slot',
  dialog: 'Dialog',
  panel: 'Panel',
  inspectorSection: 'Inspector section',
  timelineOverlay: 'Timeline overlay',
  parser: 'Parser',
  outputFormat: 'Output format',
  searchProvider: 'Search provider',
  metadataFacet: 'Metadata facet',
  assetDetailSection: 'Asset detail',
  effect: 'Effect',
  transition: 'Transition',
  shader: 'Shader',
  agentTool: 'Agent tool',
  process: 'Process',
};

export interface ContributionSummary {
  /** Total contributions declared in the extension manifest. */
  readonly declared: number;
  /** Number of contributions currently active (bridged) in the runtime. */
  readonly active: number;
  /** Number of contributions reserved but not yet bridged. */
  readonly inactive: number;
  /** Sorted, deduplicated list of contribution kind labels for the summary. */
  readonly kinds: readonly string[];
}

export function deriveContributionSummary(
  extensionId: string,
  extensionRuntime: import('@/tools/video-editor/runtime/extensionSurface').ExtensionRuntime,
): ContributionSummary | null {
  // Find the matching active extension
  const ext = extensionRuntime.extensions.find(
    (e) => (e.manifest.id as string) === extensionId,
  );
  if (!ext) {
    // Non-active package — no contribution data available from active extensions
    return null;
  }

  const declared = ext.manifest.contributions?.length ?? 0;

  // Count active contributions: those whose ID appears in the normalized config
  const activeIds = new Set<string>();
  for (const slotKey of Object.keys(extensionRuntime.config.slots)) {
    activeIds.add(slotKey);
  }
  for (const d of extensionRuntime.config.dialogHost.dialogs) {
    activeIds.add(d.id);
  }
  for (const p of extensionRuntime.config.registry.panels) {
    activeIds.add(p.id);
  }
  for (const s of extensionRuntime.config.registry.inspectorSections) {
    activeIds.add(s.id);
  }
  for (const o of extensionRuntime.config.overlays) {
    activeIds.add(o.id);
  }

  // Also count pipeline descriptor contributions as active
  for (const ap of extensionRuntime.config.assetParsers) {
    activeIds.add(ap.id);
  }
  for (const of_ of extensionRuntime.config.outputFormats) {
    activeIds.add(of_.id);
  }
  for (const sp of extensionRuntime.config.searchProviders) {
    activeIds.add(sp.id);
  }
  for (const mf of extensionRuntime.config.metadataFacets) {
    activeIds.add(mf.id);
  }
  for (const ads of extensionRuntime.config.assetDetailSections) {
    activeIds.add(ads.id);
  }
  for (const eff of extensionRuntime.config.effects) {
    activeIds.add(eff.id);
  }
  for (const tr of extensionRuntime.config.transitions) {
    activeIds.add(tr.id);
  }
  for (const sh of extensionRuntime.config.shaders) {
    activeIds.add(sh.id);
  }
  for (const at of extensionRuntime.config.agentTools) {
    activeIds.add(at.id);
  }
  for (const pr of extensionRuntime.config.processes) {
    activeIds.add(pr.id);
  }

  // Determine which declared contributions are active
  let active = 0;
  const kindSet = new Set<string>();
  for (const contrib of ext.manifest.contributions ?? []) {
    const contribId = contrib.id as string;
    if (activeIds.has(contribId)) {
      active++;
    }
    const kindLabel = CONTRIBUTION_KIND_LABEL[contrib.kind] ?? contrib.kind;
    kindSet.add(kindLabel);
  }

  const inactive = extensionRuntime.inactiveReserved.filter(
    (r) => r.extensionId === extensionId,
  ).length;

  return {
    declared,
    active,
    inactive,
    kinds: [...kindSet].sort(),
  };
}
