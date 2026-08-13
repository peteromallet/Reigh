import { useCallback, useMemo } from 'react';
import { VideoEditorAssetPanelSurface } from '@/tools/video-editor/components/PropertiesPanel/VideoEditorAssetPanelSurface.tsx';
import {
  useVideoEditorAssetPanels,
  useVideoEditorDialogDescriptors,
  useVideoEditorRenderContext,
  useVideoEditorSlotRenderers,
} from '@/tools/video-editor/runtime/useVideoEditorRenderContext.ts';
import {
  HostContributionErrorBoundary,
  type ContributionErrorInfo,
} from '@/tools/video-editor/runtime/ContributionErrorBoundary.tsx';
import { useOptionalVideoEditorRuntime } from '@/tools/video-editor/contexts/VideoEditorRuntimeContext.tsx';
import type { VideoEditorSlotName, VideoEditorOutputFormatDescriptor } from '@/tools/video-editor/runtime/extensionSurface';
import {
  InertReservedPlaceholder,
  RESERVED_SLOT_NAMES,
} from './TimelineEditorShellReservedSlots.tsx';

/**
 * Resolves every extension slot the shell can host into a ready-to-render node,
 * wrapping each registered renderer in a HostContributionErrorBoundary keyed to
 * the owning extension. Reserved slots fall back to their canary (or an inert
 * placeholder); unclaimed slots resolve to null.
 *
 * Also splits the contributed output formats into the two buckets the export
 * menu presents, since both derive from the same render context.
 */
export function useVideoEditorShellSlots() {
  // Extension slots: hosts can override entire chrome regions.
  const slotRenderers = useVideoEditorSlotRenderers();
  const renderContext = useVideoEditorRenderContext();

  // M6: Derive export format categories from extension contributions
  const compileOnlyExportFormats: VideoEditorOutputFormatDescriptor[] = useMemo(() => {
    const all = renderContext.extensions?.outputFormats ?? [];
    return all.filter((f) => !f.requiresRender && !f.disabled);
  }, [renderContext.extensions?.outputFormats]);
  const renderDependentExportFormats: VideoEditorOutputFormatDescriptor[] = useMemo(() => {
    const all = renderContext.extensions?.outputFormats ?? [];
    return all.filter((f) => f.requiresRender || f.disabled);
  }, [renderContext.extensions?.outputFormats]);
  const hasAnyExportFormat = compileOnlyExportFormats.length > 0 || renderDependentExportFormats.length > 0;
  const contributedAssetPanels = useVideoEditorAssetPanels();
  const dialogDescriptors = useVideoEditorDialogDescriptors();

  const runtime = useOptionalVideoEditorRuntime();

  // M5: Normalized slot → extensionId mapping derived from contribution manifests.
  // Used by HostContributionErrorBoundary to wire host-owned recovery keys.
  const slotOwnerMap = useMemo<ReadonlyMap<string, string>>(() => {
    const map = new Map<string, string>();
    const extensions = runtime?.extensionRuntime?.extensions;
    if (!extensions) return map;
    for (const ext of extensions) {
      const extId = ext.manifest.id as string;
      const contribs = ext.manifest.contributions ?? [];
      for (const c of contribs) {
        if (c.kind === 'slot' && c.slot) {
          // First extension wins per deterministic extension order
          if (!map.has(c.slot)) {
            map.set(c.slot, extId);
          }
        }
      }
    }
    return map;
  }, [runtime?.extensionRuntime?.extensions]);

  const handleContributionError = useCallback((info: ContributionErrorInfo) => {
    // Host-owned diagnostics sink: log to console with structured data.
    // Future: aggregate into a diagnostics context shared across the shell.
    if (typeof console !== 'undefined') {
      console.warn(
        '[TimelineEditorShellCore] Contribution error captured by boundary:',
        info,
      );
    }
  }, []);

  /**
   * Resolve a surface slot renderer or return an inert placeholder for
   * reserved slots.
   * - If a renderer is registered → wrap in HostContributionErrorBoundary
   * - If the slot is reserved → render InertReservedPlaceholder
   * - Otherwise → null (slot is unclaimed)
   */
  const resolveSurfaceSlot = useCallback(
    (slotName: VideoEditorSlotName, label: string) => {
      const renderer = slotRenderers[slotName];
      if (renderer) {
        return (
          <HostContributionErrorBoundary
            key={slotName}
            contributionId={`slot:${slotName}`}
            extensionId={slotOwnerMap.get(slotName)}
            kind="slot"
            label={label}
            onError={handleContributionError}
          >
            {renderer(renderContext)}
          </HostContributionErrorBoundary>
        );
      }
      if (RESERVED_SLOT_NAMES[slotName]) {
        return <InertReservedPlaceholder key={slotName} slotName={slotName} />;
      }
      return null;
    },
    [handleContributionError, renderContext, slotRenderers, slotOwnerMap],
  );

  const headerSlot = slotRenderers.header ? (
    <HostContributionErrorBoundary
      contributionId="slot:header"
      extensionId={slotOwnerMap.get("header")}
      kind="slot"
      label="Header"
      onError={handleContributionError}
    >
      {slotRenderers.header(renderContext)}
    </HostContributionErrorBoundary>
  ) : null;
  const toolbarSlot = slotRenderers.toolbar ? (
    <HostContributionErrorBoundary
      contributionId="slot:toolbar"
      extensionId={slotOwnerMap.get("toolbar")}
      kind="slot"
      label="Toolbar"
      onError={handleContributionError}
    >
      {slotRenderers.toolbar(renderContext)}
    </HostContributionErrorBoundary>
  ) : null;
  const assetPanelSlot = slotRenderers.assetPanel
    ? (
      <HostContributionErrorBoundary
        contributionId="slot:assetPanel"
        extensionId={slotOwnerMap.get("assetPanel")}
        kind="slot"
        label="Asset panel"
        onError={handleContributionError}
      >
        {slotRenderers.assetPanel(renderContext)}
      </HostContributionErrorBoundary>
    )
    : (contributedAssetPanels.length > 0 ? <VideoEditorAssetPanelSurface includeBuiltIn={false} /> : null);
  const inspectorPanelSlot = slotRenderers.inspectorPanel
    ? (
      <HostContributionErrorBoundary
        contributionId="slot:inspectorPanel"
        extensionId={slotOwnerMap.get("inspectorPanel")}
        kind="slot"
        label="Inspector panel"
        onError={handleContributionError}
      >
        {slotRenderers.inspectorPanel(renderContext)}
      </HostContributionErrorBoundary>
    )
    : null;
  const timelineFooterSlot = slotRenderers.timelineFooter
    ? (
      <HostContributionErrorBoundary
        contributionId="slot:timelineFooter"
        extensionId={slotOwnerMap.get("timelineFooter")}
        kind="slot"
        label="Timeline footer"
        onError={handleContributionError}
      >
        {slotRenderers.timelineFooter(renderContext)}
      </HostContributionErrorBoundary>
    )
    : null;
  const statusBarSlot = slotRenderers.statusBar ? (
    <HostContributionErrorBoundary
      contributionId="slot:statusBar"
      extensionId={slotOwnerMap.get("statusBar")}
      kind="slot"
      label="Status bar"
      onError={handleContributionError}
    >
      {slotRenderers.statusBar(renderContext)}
    </HostContributionErrorBoundary>
  ) : null;

  // ---- New M2 surface slots ------------------------------------------------
  const leftPanelSlot = resolveSurfaceSlot('leftPanel', 'Left panel');
  const rightPanelSlot = resolveSurfaceSlot('rightPanel', 'Right panel');
  const codePanelSlot = resolveSurfaceSlot('codePanel', 'Code panel');
  const writingPanelSlot = resolveSurfaceSlot('writingPanel', 'Writing panel');
  const stagePanelSlot = resolveSurfaceSlot('stagePanel', 'Stage panel');

  // ---- Dialog slot: render extension-contributed dialogs --------------------
  const dialogsSlot = slotRenderers.dialogs ? (
    <HostContributionErrorBoundary
      contributionId="slot:dialogs"
      extensionId={slotOwnerMap.get("dialogs")}
      kind="slot"
      label="Dialogs"
      onError={handleContributionError}
    >
      {slotRenderers.dialogs(renderContext)}
    </HostContributionErrorBoundary>
  ) : null;

  return {
    compileOnlyExportFormats,
    renderDependentExportFormats,
    hasAnyExportFormat,
    dialogDescriptors,
    headerSlot,
    toolbarSlot,
    assetPanelSlot,
    inspectorPanelSlot,
    timelineFooterSlot,
    statusBarSlot,
    leftPanelSlot,
    rightPanelSlot,
    codePanelSlot,
    writingPanelSlot,
    stagePanelSlot,
    dialogsSlot,
  };
}
