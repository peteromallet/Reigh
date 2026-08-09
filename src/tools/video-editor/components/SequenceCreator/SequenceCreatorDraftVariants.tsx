import type { ClipTypeDescriptor } from '@/tools/video-editor/clip-types/defineClipType.ts';
import type { EditableSequenceDraft } from '@/tools/video-editor/sequences/generation.ts';
import { getAvailableSequenceMetadata } from '@/tools/video-editor/sequences/registry.ts';

/** Variant picker for a generated draft group (only shown for 2+ drafts). */
export function SequenceCreatorDraftVariants({
  drafts,
  selectedDraftIndex,
  extensionClipTypeDescriptorMap,
  onSelectDraftIndex,
}: {
  drafts: EditableSequenceDraft[];
  selectedDraftIndex: number;
  extensionClipTypeDescriptorMap: Map<string, ClipTypeDescriptor>;
  onSelectDraftIndex: (index: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-foreground">Draft Variants</div>
      <div className="space-y-2">
        {drafts.map((draft, index) => {
          const metadata = getAvailableSequenceMetadata(draft.clipType);
          const extDescriptor = extensionClipTypeDescriptorMap.get(draft.clipType);
          const label = metadata?.label ?? extDescriptor?.label ?? draft.clipType;
          return (
            <button
              key={`${draft.clipType}-${index}`}
              type="button"
              className={[
                'w-full rounded-lg border p-3 text-left transition-colors',
                index === selectedDraftIndex
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-card/60 hover:bg-muted/60',
              ].join(' ')}
              onClick={() => onSelectDraftIndex(index)}
            >
              <div className="text-sm font-medium text-foreground">
                {label}
              </div>
              <div className="text-xs text-muted-foreground">{draft.hold}s</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
