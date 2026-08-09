import type { ClipMeta } from '@/tools/video-editor/lib/timeline-data.ts';
import type { ResolvedTimelineClip } from '@/tools/video-editor/types/index.ts';
import type { ClipTypeRegistryRecord } from '@/tools/video-editor/clip-types/ClipTypeRegistry.ts';
import {
  HostContributionErrorBoundary,
  type ContributionErrorInfo,
} from '@/tools/video-editor/runtime/ContributionErrorBoundary.tsx';

/** M9 T9: Extension-provided clip inspector section, rendered after host controls. */
export function ClipExtensionInspectorSection({
  clip,
  onChange,
  clipTypeRegistryRecord,
}: {
  clip: ResolvedTimelineClip;
  onChange: (patch: Partial<ClipMeta> & { at?: number }) => void;
  clipTypeRegistryRecord: ClipTypeRegistryRecord;
}) {
  const InspectorRenderer = clipTypeRegistryRecord.inspector as (props: {
    clipId: string;
    clipTypeId: string;
    params: Record<string, unknown>;
    onParamsChange: (params: Record<string, unknown>) => void;
  }) => React.ReactNode;

  const handleContributionError = (info: ContributionErrorInfo) => {
    if (typeof console !== 'undefined') {
      console.warn(
        '[ClipPanel] Extension clip inspector error captured by boundary:',
        info,
      );
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-border bg-card/70 p-3">
      <HostContributionErrorBoundary
        contributionId={
          clipTypeRegistryRecord.contributionId ??
          `clip-inspector:${clip.clipType}`
        }
        extensionId={clipTypeRegistryRecord.ownerExtensionId}
        kind="inspectorSection"
        label={
          clipTypeRegistryRecord.contributionId
            ? `${clipTypeRegistryRecord.clipTypeId} inspector`
            : `Clip inspector: ${clipTypeRegistryRecord.clipTypeId}`
        }
        onError={handleContributionError}
      >
        <InspectorRenderer
          clipId={clip.id}
          clipTypeId={clip.clipType ?? 'unknown'}
          params={clip.params ?? {}}
          onParamsChange={(params: Record<string, unknown>) =>
            onChange({ params })
          }
        />
      </HostContributionErrorBoundary>
    </div>
  );
}
