import { AgentChatAttachmentStrip } from '@/tools/video-editor/components/AgentChat/AgentChatMessage.tsx';
import type { AllowedSequenceAsset } from '@/tools/video-editor/sequences/generation.ts';

/** The asset chips a generation request is allowed to reference. */
export function SequenceCreatorAllowedAssets({
  allowedAssets,
  onRemoveAllowedAsset,
  onRemoveAllowedShot,
}: {
  allowedAssets: AllowedSequenceAsset[];
  onRemoveAllowedAsset: (asset: {
    clipId: string;
    url: string;
    mediaType: 'image' | 'video';
    generationId?: string;
  }) => void;
  onRemoveAllowedShot: (shotId: string) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-foreground">Allowed Assets</div>
        <div className="text-xs text-muted-foreground">{allowedAssets.length}</div>
      </div>
      {allowedAssets.length > 0 ? (
        <AgentChatAttachmentStrip
          attachments={allowedAssets.map((asset) => ({
            clipId: asset.clipId,
            url: asset.url,
            mediaType: asset.mediaType,
            isPlaceholder: asset.isPlaceholder,
            generationId: asset.generationId,
            assetKey: asset.key,
            shotId: asset.shotId,
            shotName: asset.shotName,
            shotSelectionClipCount: asset.shotSelectionClipCount,
          }))}
          isUser={false}
          className="mt-0"
          onRemoveAttachment={onRemoveAllowedAsset}
          onRemoveShot={onRemoveAllowedShot}
          maxPreviewCount={null}
        />
      ) : (
        <div className="text-xs text-muted-foreground">
          Select timeline media or attach asset chips before asking for asset-backed drafts.
        </div>
      )}
    </div>
  );
}
