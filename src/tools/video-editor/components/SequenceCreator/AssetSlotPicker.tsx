import { Checkbox } from '@/shared/components/ui/checkbox.tsx';
import { cn } from '@/shared/components/ui/contracts/cn.ts';
import type { AllowedSequenceAsset } from '@/tools/video-editor/sequences/generation.ts';
import type {
  AssetSlotBindings,
  AssetSlotDefinition,
  AssetSlotValidationError,
} from '@/tools/video-editor/sequences/assetSlots.ts';

export interface AssetSlotPickerProps {
  slots: readonly AssetSlotDefinition[];
  bindings: AssetSlotBindings;
  allowedAssets: readonly AllowedSequenceAsset[];
  errors: readonly AssetSlotValidationError[];
  onChangeSlot: (slotId: string, assetKeys: string[]) => void;
}

const formatSlotCardinality = (slot: AssetSlotDefinition): string => {
  if (slot.minItems === slot.maxItems) return `${slot.minItems}`;
  return `${slot.minItems}-${slot.maxItems}`;
};

export function AssetSlotPicker({
  slots,
  bindings,
  allowedAssets,
  errors,
  onChangeSlot,
}: AssetSlotPickerProps) {
  if (slots.length === 0) return null;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card/60 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Asset slots
      </div>
      {slots.map((slot) => {
        const selectedKeys = bindings[slot.id] ?? [];
        const selected = new Set(selectedKeys);
        const candidates = allowedAssets.filter((asset) => asset.mediaType === slot.mediaType);
        const slotErrors = errors.filter((error) => error.slotId === slot.id);
        const setSingle = (assetKey: string) => {
          onChangeSlot(slot.id, selected.has(assetKey) ? [] : [assetKey]);
        };
        const toggleMulti = (assetKey: string, checked: boolean) => {
          const next = new Set(selected);
          if (checked) next.add(assetKey);
          else next.delete(assetKey);
          onChangeSlot(
            slot.id,
            allowedAssets
              .map((asset) => asset.key)
              .filter((key) => next.has(key)),
          );
        };

        return (
          <div key={slot.id} className="space-y-2 rounded-md border border-border bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{slot.label}</div>
                {slot.description && (
                  <div className="text-xs text-muted-foreground">{slot.description}</div>
                )}
              </div>
              <div className="shrink-0 text-xs text-muted-foreground">
                {slot.mediaType} {formatSlotCardinality(slot)}
              </div>
            </div>

            {candidates.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                No {slot.mediaType} assets available.
              </div>
            ) : slot.maxItems === 1 ? (
              <div className="flex flex-wrap gap-1.5">
                {candidates.map((asset) => {
                  const isSelected = selected.has(asset.key);
                  return (
                    <button
                      key={asset.key}
                      type="button"
                      onClick={() => setSingle(asset.key)}
                      className={cn(
                        'rounded-md border px-2 py-1 text-xs transition-colors',
                        isSelected
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {asset.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="grid gap-2">
                {candidates.map((asset) => {
                  const isSelected = selected.has(asset.key);
                  return (
                    <label
                      key={asset.key}
                      className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs text-foreground"
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => toggleMulti(asset.key, checked)}
                      />
                      <span className="min-w-0 flex-1 truncate">{asset.label}</span>
                    </label>
                  );
                })}
              </div>
            )}

            {slotErrors.length > 0 && (
              <div className="space-y-1 text-xs text-destructive">
                {slotErrors.map((error) => (
                  <div key={`${error.code}:${error.path}:${error.assetKey ?? ''}`}>
                    {error.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
