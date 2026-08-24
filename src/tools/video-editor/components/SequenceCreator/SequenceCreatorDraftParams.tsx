import { NumberInput } from '@/shared/components/ui/number-input.tsx';
import { SequenceParamEditor } from '@/tools/video-editor/components/PropertiesPanel/SequenceParamEditor.tsx';
import type { ClipTypeDescriptor } from '@/tools/video-editor/clip-types/defineClipType.ts';
import type { EditableSequenceDraft } from '@/tools/video-editor/sequences/generation.ts';
import type { getAvailableSequenceMetadata } from '@/tools/video-editor/sequences/registry.ts';
import type { ResolvedTimelineConfig } from '@/tools/video-editor/types/index.ts';
import { summarizeValidationErrors, type validateEditableSequenceDraft } from './sequence-creator-helpers.ts';

/**
 * JSON-path draft editor: duration plus the trusted (or extension-derived)
 * sequence params for the selected draft.
 */
export function SequenceCreatorDraftParams({
  selectedDraft,
  selectedMetadata,
  resolvedDescriptor,
  selectedValidation,
  allowedRegistry,
  updateSelectedDraft,
}: {
  selectedDraft: EditableSequenceDraft;
  selectedMetadata: ReturnType<typeof getAvailableSequenceMetadata>;
  resolvedDescriptor: ClipTypeDescriptor | undefined;
  selectedValidation: ReturnType<typeof validateEditableSequenceDraft> | null;
  allowedRegistry: ResolvedTimelineConfig['registry'];
  updateSelectedDraft: (patch: Partial<EditableSequenceDraft>) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-[1fr_140px] items-end gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">
            {resolvedDescriptor?.label ?? selectedMetadata?.label ?? selectedDraft.clipType}
          </div>
          <div className="text-xs text-muted-foreground">
            {resolvedDescriptor?.description ?? selectedMetadata?.description ?? ''}
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">Duration</div>
          <NumberInput
            value={selectedDraft.hold}
            min={selectedMetadata?.hold.minSeconds ?? resolvedDescriptor?.hold?.kind !== 'unsupported' ? (resolvedDescriptor?.hold as { defaultSeconds: number; minSeconds: number; maxSeconds: number; stepSeconds: number })?.minSeconds ?? 0.05 : 0.05}
            max={selectedMetadata?.hold.maxSeconds ?? (resolvedDescriptor?.hold?.kind !== 'unsupported' ? (resolvedDescriptor?.hold as { defaultSeconds: number; minSeconds: number; maxSeconds: number; stepSeconds: number })?.maxSeconds ?? 120 : 120)}
            step={selectedMetadata?.hold.stepSeconds ?? (resolvedDescriptor?.hold?.kind !== 'unsupported' ? (resolvedDescriptor?.hold as { defaultSeconds: number; minSeconds: number; maxSeconds: number; stepSeconds: number })?.stepSeconds ?? 0.1 : 0.1)}
            onChange={(value) => updateSelectedDraft({ hold: value ?? selectedMetadata?.hold.defaultSeconds ?? 4 })}
          />
        </div>
      </div>

      {selectedMetadata ? (
        <SequenceParamEditor
          clipType={selectedDraft.clipType}
          metadata={selectedMetadata}
          params={selectedDraft.params}
          registry={allowedRegistry}
          onChange={(params) => updateSelectedDraft({ params })}
        />
      ) : resolvedDescriptor ? (
        <SequenceParamEditor
          clipType={selectedDraft.clipType}
          metadata={{
            clipType: selectedDraft.clipType,
            label: resolvedDescriptor.label ?? selectedDraft.clipType,
            description: resolvedDescriptor.description ?? '',
            whenToUse: resolvedDescriptor.description ?? '',
            themeId: '2rp',
            hold: resolvedDescriptor.hold?.kind !== 'unsupported'
              ? {
                  defaultSeconds: (resolvedDescriptor.hold as { defaultSeconds: number }).defaultSeconds ?? 4,
                  minSeconds: (resolvedDescriptor.hold as { minSeconds: number }).minSeconds ?? 0.05,
                  maxSeconds: (resolvedDescriptor.hold as { maxSeconds: number }).maxSeconds ?? 120,
                  stepSeconds: (resolvedDescriptor.hold as { stepSeconds: number }).stepSeconds ?? 0.1,
                }
              : { defaultSeconds: 4, minSeconds: 0.05, maxSeconds: 120, stepSeconds: 0.1 },
            params: resolvedDescriptor.paramsSchema.kind === 'sequence'
              ? resolvedDescriptor.paramsSchema.params.map((p) => ({
                  key: p.key,
                  label: p.label,
                  kind: p.kind,
                  description: p.description,
                  required: p.required,
                  defaultValue: p.defaultValue,
                  options: p.options,
                  maxItems: p.maxItems,
                  componentParam: p.componentParam,
                }))
              : [],
          }}
          params={selectedDraft.params}
          registry={allowedRegistry}
          onChange={(params) => updateSelectedDraft({ params })}
        />
      ) : null}

      {selectedValidation && !selectedValidation.ok && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          {summarizeValidationErrors(selectedValidation.errors)}
        </div>
      )}
    </>
  );
}
