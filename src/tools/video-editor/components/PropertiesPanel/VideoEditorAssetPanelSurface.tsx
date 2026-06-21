import { memo, type ReactNode } from 'react';
import AssetPanel from '@/tools/video-editor/components/PropertiesPanel/AssetPanel.tsx';
import {
  useTimelineEditorData,
  useTimelineEditorOps,
} from '@/tools/video-editor/hooks/timelineStore.ts';
import {
  useVideoEditorAssetPanels,
  useVideoEditorRenderContext,
} from '@/tools/video-editor/runtime/useVideoEditorRenderContext.ts';
import type {
  VideoEditorRenderContext,
  VideoEditorSlotRenderer,
} from '@/tools/video-editor/runtime/extensionSurface.ts';
import { ExtensionRenderBoundary } from '@/tools/video-editor/runtime/ExtensionRenderBoundary.tsx';

// ---------------------------------------------------------------------------
// Deferred descriptor renderer — defers renderer invocation into the child
// render phase so that React error boundaries can catch throws.
// ---------------------------------------------------------------------------

function DescriptorRenderer({
  renderer,
  context,
}: {
  renderer: VideoEditorSlotRenderer;
  context: VideoEditorRenderContext;
}): ReactNode {
  return renderer(context);
}

export interface VideoEditorAssetPanelSurfaceProps {
  includeBuiltIn?: boolean;
}

function VideoEditorAssetPanelSurfaceComponent({
  includeBuiltIn = true,
}: VideoEditorAssetPanelSurfaceProps) {
  const renderContext = useVideoEditorRenderContext();
  const assetPanels = useVideoEditorAssetPanels();
  const { data, preferences } = useTimelineEditorData();
  const { setAssetPanelState, uploadFiles } = useTimelineEditorOps();

  const builtInPanel = includeBuiltIn && data ? (
    <div className="rounded-xl border border-border bg-card/80 p-3">
      <AssetPanel
        assetMap={data.assetMap}
        rows={data.rows}
        meta={data.meta}
        backgroundAsset={data.output.background ?? undefined}
        showAll={preferences.assetPanel.showAll}
        showHidden={preferences.assetPanel.showHidden}
        hidden={preferences.assetPanel.hidden}
        setPanelState={setAssetPanelState}
        onUploadFiles={uploadFiles}
        registry={data.registry.assets}
      />
    </div>
  ) : null;

  if (!builtInPanel && assetPanels.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      {builtInPanel}
      {assetPanels.map((panel) => (
        <div key={panel.id} data-video-editor-panel-id={panel.id}>
          <ExtensionRenderBoundary
            metadata={{
              descriptorId: panel.id,
              descriptorType: 'panel',
            }}
          >
            <DescriptorRenderer renderer={panel.render} context={renderContext} />
          </ExtensionRenderBoundary>
        </div>
      ))}
    </div>
  );
}

export const VideoEditorAssetPanelSurface = memo(VideoEditorAssetPanelSurfaceComponent);
