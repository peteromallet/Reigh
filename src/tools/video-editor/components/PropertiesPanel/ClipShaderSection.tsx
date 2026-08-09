import { useMemo, useState } from 'react';
import { AlertTriangle, Globe, Monitor, Server, Trash2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/button.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select.tsx';
import { BlockerActionCard } from '@/tools/video-editor/components/BlockerActionCard.tsx';
import type { ClipMeta } from '@/tools/video-editor/lib/timeline-data.ts';
import type {
  ResolvedTimelineClip,
  TimelineClipShaderMetadata,
} from '@/tools/video-editor/types/index.ts';
import {
  useOptionalShaderEffectRegistryContext,
  type ShaderEffectRegistryRecord,
} from '@/tools/video-editor/shaders/registry/index.ts';
import {
  NO_SHADER,
  createTimelineClipShaderMetadata,
  getShaderPassLabel,
  listClipShaderPickerEntries,
} from '@/tools/video-editor/lib/shader-catalog.ts';
import {
  sameTimelineShaderIdentity,
  timelineShaderScopeOccupiedMessage,
} from '@/tools/video-editor/lib/timeline-domain.ts';
import { FieldLabel } from './clip-panel-primitives.tsx';

function ShaderSelectValue({
  shader,
  record,
}: {
  shader: TimelineClipShaderMetadata | undefined;
  record: ShaderEffectRegistryRecord | undefined;
}) {
  if (!shader) {
    return <SelectValue placeholder="None">None</SelectValue>;
  }

  const label = record?.label ?? shader.label ?? shader.shaderId;
  const passLabel = record ? getShaderPassLabel(record) : 'missing';
  return <SelectValue placeholder="None">{`${label} · Shader · ${passLabel}`}</SelectValue>;
}

function getShaderPickerValue(record: ShaderEffectRegistryRecord): string {
  return [
    record.ownerExtensionId ?? '',
    record.contributionId,
    record.shaderId,
  ].map(encodeURIComponent).join('|');
}

function getMissingShaderPickerValue(shader: TimelineClipShaderMetadata): string {
  return `missing|${encodeURIComponent(shader.extensionId)}|${encodeURIComponent(shader.contributionId)}|${encodeURIComponent(shader.shaderId)}`;
}

function removeClipShaderAppMetadata(app: ResolvedTimelineClip['app'] | undefined): ResolvedTimelineClip['app'] {
  const nextApp = { ...(app ?? {}) };
  delete nextApp.shader;
  return nextApp;
}

/**
 * M13: Clip-local shader picker. Postprocess shaders are timeline-scoped and
 * intentionally excluded from ClipPanel until a render graph exists.
 */
export function ClipShaderSection({
  clip,
  onChange,
}: {
  clip: ResolvedTimelineClip;
  onChange: (patch: Partial<ClipMeta> & { at?: number }) => void;
}) {
  const [shaderDiagnostic, setShaderDiagnostic] = useState<string | null>(null);
  const shaderRegistryContext = useOptionalShaderEffectRegistryContext();
  const shaderPickerEntries = useMemo(
    () => listClipShaderPickerEntries(shaderRegistryContext?.snapshot),
    [shaderRegistryContext?.snapshot],
  );
  const clipShader = clip?.app?.shader;
  const resolvedClipShaderRecord = useMemo(() => {
    if (!clipShader) return undefined;
    return shaderRegistryContext?.snapshot.get(clipShader.shaderId, clipShader.extensionId);
  }, [clipShader, shaderRegistryContext?.snapshot]);
  const selectedShaderValue = clipShader
    ? resolvedClipShaderRecord
      ? getShaderPickerValue(resolvedClipShaderRecord)
      : getMissingShaderPickerValue(clipShader)
    : NO_SHADER;

  return (
    <div className="space-y-2 md:col-span-2" data-testid="clip-panel-shader-section">
      <FieldLabel>Shader</FieldLabel>
      <Select
        value={selectedShaderValue}
        onValueChange={(value) => {
          if (value === NO_SHADER) {
            setShaderDiagnostic(null);
            onChange({ app: removeClipShaderAppMetadata(clip.app) });
            return;
          }

          const entry = shaderPickerEntries.find((candidate) => (
            getShaderPickerValue(candidate.record) === value
          ));
          if (!entry || entry.disabled) {
            return;
          }

          const nextShader = createTimelineClipShaderMetadata(entry.record);
          if (clipShader && !sameTimelineShaderIdentity(clipShader, nextShader)) {
            setShaderDiagnostic(timelineShaderScopeOccupiedMessage(
              'clip',
              clipShader.shaderId,
              nextShader.shaderId,
              clip.id,
            ));
            return;
          }

          setShaderDiagnostic(null);
          onChange({
            app: {
              ...(clip.app ?? {}),
              shader: nextShader,
            },
          });
        }}
      >
        <SelectTrigger>
          <ShaderSelectValue shader={clipShader} record={resolvedClipShaderRecord} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_SHADER}>None</SelectItem>
          {shaderPickerEntries.length > 0 && (
            <>
              <div className="my-1 h-px bg-border" />
              {shaderPickerEntries.map((entry) => {
                const record = entry.record;
                const passLabel = getShaderPassLabel(record);
                const nextShader = createTimelineClipShaderMetadata(record);
                return (
                  <SelectItem
                    key={`${record.ownerExtensionId ?? ''}:${record.contributionId}:${record.shaderId}`}
                    value={getShaderPickerValue(record)}
                    disabled={entry.disabled}
                    onPointerDown={(event) => {
                      if (!clipShader || sameTimelineShaderIdentity(clipShader, nextShader)) {
                        return;
                      }
                      event.preventDefault();
                      setShaderDiagnostic(timelineShaderScopeOccupiedMessage(
                        'clip',
                        clipShader.shaderId,
                        nextShader.shaderId,
                        clip.id,
                      ));
                    }}
                  >
                    <span className="flex items-center gap-1.5">
                      {entry.disabled && <AlertTriangle className="h-3 w-3 shrink-0 text-destructive" />}
                      {record.label}
                      <span className="ml-0.5 rounded-sm bg-blue-500/15 px-1 text-[9px] font-medium text-blue-300">
                        Shader
                      </span>
                      <span className="rounded-sm bg-cyan-500/15 px-1 text-[9px] font-medium text-cyan-300">
                        {passLabel}
                      </span>
                      {entry.previewOnly && (
                        <span className="rounded-sm bg-emerald-500/15 px-1 text-[9px] font-medium text-emerald-300">
                          Preview only
                        </span>
                      )}
                      {entry.blockedRoutes.length > 0 && !entry.previewOnly && (
                        <span className="rounded-sm bg-amber-500/15 px-1 text-[9px] font-medium text-amber-300">
                          {entry.blockedRoutes.map((route) => route === 'browser-export' ? 'No B' : route === 'worker-export' ? 'No W' : route).join(', ')}
                        </span>
                      )}
                      {record.status === 'inactive' && <span className="ml-1 text-[10px] text-muted-foreground">(inactive)</span>}
                      {record.status === 'error' && <span className="ml-1 text-[10px] text-destructive">(invalid)</span>}
                    </span>
                  </SelectItem>
                );
              })}
            </>
          )}
          {clipShader && !resolvedClipShaderRecord && (
            <>
              <div className="my-1 h-px bg-border" />
              <SelectItem value={getMissingShaderPickerValue(clipShader)} disabled>
                <span className="text-muted-foreground">
                  {clipShader.label ?? clipShader.shaderId} (missing)
                </span>
              </SelectItem>
            </>
          )}
        </SelectContent>
      </Select>

      {shaderDiagnostic && (
        <div data-testid="clip-panel-shader-diagnostic">
          <BlockerActionCard
            severity="error"
            code="shader/clip-scope-occupied"
            message={shaderDiagnostic}
          />
        </div>
      )}

      {resolvedClipShaderRecord && (() => {
        const entry = shaderPickerEntries.find((candidate) => (
          candidate.record === resolvedClipShaderRecord
        ));
        if (!entry) return null;
        if (entry.blockedRoutes.length === 0 && !entry.previewOnly) return null;
        return (
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/8 px-2 py-1 text-[11px] text-amber-200">
            {entry.previewOnly && (
              <span className="inline-flex items-center gap-1"><Monitor className="h-3 w-3" />Preview only</span>
            )}
            {entry.blockedRoutes.includes('browser-export') && !entry.previewOnly && (
              <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" />No browser export</span>
            )}
            {entry.blockedRoutes.includes('worker-export') && !entry.previewOnly && (
              <span className="inline-flex items-center gap-1"><Server className="h-3 w-3" />No worker export</span>
            )}
          </div>
        );
      })()}

      {clipShader && !resolvedClipShaderRecord && (
        <BlockerActionCard
          severity="error"
          code="shader/missing-ref"
          message={`Shader "${clipShader.shaderId}" is not available. The extension may have been removed.`}
        />
      )}

      {clipShader && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 text-xs text-destructive hover:text-destructive"
          onClick={() => {
            setShaderDiagnostic(null);
            onChange({ app: removeClipShaderAppMetadata(clip.app) });
          }}
        >
          <Trash2 className="h-3 w-3" /> Remove
        </Button>
      )}
    </div>
  );
}
