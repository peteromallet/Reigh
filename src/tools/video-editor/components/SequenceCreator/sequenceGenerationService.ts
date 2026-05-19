import {
  invokeSupabaseEdgeFunction,
  SupabaseEdgeFunctionError,
} from '@/integrations/supabase/functions/invokeSupabaseEdgeFunction.ts';
import type { SelectedMediaClip } from '@/tools/video-editor/hooks/useSelectedMediaClips.ts';
import {
  buildAnimationIntentPayload,
  buildGenerationClipPayloads,
  createEditableDraft,
  type AllowedSequenceAsset,
  type EditableSequenceDraft,
  type GenerateSequenceResponse,
  type SequenceAnimationIntent,
  type SequenceCreatorMode,
} from '@/tools/video-editor/sequences/generation.ts';
import {
  AVAILABLE_SEQUENCE_CLIP_TYPES,
  AVAILABLE_SEQUENCE_METADATA,
} from '@/tools/video-editor/sequences/registry.ts';
import { validateSequenceDraft } from '@/tools/video-editor/sequences/validation.ts';
import {
  validateControlsManifest,
  type ControlsManifest,
} from '@/tools/video-editor/sequences/controlsManifest.ts';
import {
  ASSET_SLOT_BINDINGS_PARAM,
  ASSET_SLOTS_PARAM,
  collectLooseGeneratedMediaParamErrors,
  GENERATED_SEQUENCE_LOOSE_MEDIA_PARAM_KEYS,
  normalizeAssetSlots,
  validateAssetSlotBindings,
  type AssetSlotDefinition,
  type AssetSlotAssetRegistry,
} from '@/tools/video-editor/sequences/assetSlots.ts';
import type { ResolvedTimelineConfig } from '@/tools/video-editor/types/index.ts';

export type RunSequenceGenerationOptions = {
  prompt: string;
  mode?: SequenceCreatorMode;
  editContext?: unknown;
  resolvedConfig: ResolvedTimelineConfig;
  selectedClips: readonly SelectedMediaClip[];
  attachedClips: readonly SelectedMediaClip[];
  allowedAssets: readonly AllowedSequenceAsset[];
  allowedAssetKeys: readonly string[];
  signal: AbortSignal;
};

export type RunSequenceGenerationResult =
  | {
      status: 'aborted';
    }
  | {
      status: 'ok';
      generationPrompt: string;
      animationIntentPayload: SequenceAnimationIntent | undefined;
      validDrafts: EditableSequenceDraft[];
      invalidCount: number;
      generationNote: string | null;
      classifier?: { path: 'json' | 'code'; reason: string };
    }
  | {
      status: 'no_valid_drafts';
      generationPrompt: string;
      animationIntentPayload: SequenceAnimationIntent | undefined;
      invalidCount: number;
      generationNote: string;
      classifier?: { path: 'json' | 'code'; reason: string };
    }
  | {
      // Classifier routed the request to the code path (a custom sequence
      // component). Caller should dispatch a follow-up call via
      // runSequenceComponentGenerationRequest.
      status: 'classifier_code';
      generationPrompt: string;
      animationIntentPayload: SequenceAnimationIntent | undefined;
      classifier: { path: 'code'; reason: string };
    };

export const runSequenceGenerationRequest = async ({
  prompt,
  mode,
  editContext,
  resolvedConfig,
  selectedClips,
  attachedClips,
  allowedAssets,
  allowedAssetKeys,
  signal,
}: RunSequenceGenerationOptions): Promise<RunSequenceGenerationResult> => {
  const generationPrompt = prompt.trim();
  const animationIntentPayload = buildAnimationIntentPayload(generationPrompt);
  try {
    const response = await invokeSupabaseEdgeFunction<GenerateSequenceResponse>(
      'ai-generate-sequence',
      {
        body: {
          prompt: generationPrompt,
          mode: mode ?? 'generate',
          edit_context: editContext ?? null,
          ...(animationIntentPayload ? { animation_intent: animationIntentPayload } : {}),
          timeline: {
            output: resolvedConfig.output,
            tracks: resolvedConfig.tracks,
            clips: resolvedConfig.clips.map((clip) => ({
              id: clip.id,
              clipType: clip.clipType,
              asset: clip.asset,
              track: clip.track,
              at: clip.at,
              hold: clip.hold,
              params: clip.params,
            })),
          },
          selected_clips: buildGenerationClipPayloads(selectedClips, allowedAssets),
          attached_clips: buildGenerationClipPayloads(attachedClips, allowedAssets),
          allowed_clip_types: AVAILABLE_SEQUENCE_CLIP_TYPES,
          allowed_assets: allowedAssets.map((asset) => ({
            key: asset.key,
            assetKey: asset.key,
            url: asset.url,
            mediaType: asset.mediaType,
            label: asset.label,
            source: asset.source,
          })),
          theme: resolvedConfig.theme,
          theme_overrides: resolvedConfig.theme_overrides,
        },
        timeoutMs: 150_000,
        signal,
      },
    );
    if (signal.aborted) return { status: 'aborted' };
    if (response.error) {
      throw new Error(response.details || response.error);
    }

    // Unified-UX classifier: if the model decided this prompt requires a
    // custom sequence component (path=code), surface that to the caller so
    // the panel can confirm/fork-to-DB and dispatch the code-path follow-up
    // via runSequenceComponentGenerationRequest. We do NOT call the
    // ai-generate-sequence-component endpoint here because the panel may
    // need to gate the code path behind a "Customize this sequence for
    // yourself" confirmation (T13).
    if (response.classifier?.path === 'code') {
      return {
        status: 'classifier_code',
        generationPrompt,
        animationIntentPayload,
        classifier: { path: 'code', reason: response.classifier.reason ?? '' },
      };
    }

    const validDrafts: EditableSequenceDraft[] = [];
    const invalidCountFromClient = (response.drafts ?? []).reduce((count, rawDraft) => {
      const validation = validateSequenceDraft(rawDraft, {
        metadata: AVAILABLE_SEQUENCE_METADATA,
        allowedClipTypes: AVAILABLE_SEQUENCE_CLIP_TYPES,
        allowedAssetKeys,
      });
      if (validation.ok) {
        validDrafts.push(createEditableDraft(validation.draft));
        return count;
      }
      return count + 1;
    }, 0);
    const invalidCount = invalidCountFromClient + (response.invalid_drafts?.length ?? 0);

    const classifierVerdict = response.classifier
      ? { path: response.classifier.path, reason: response.classifier.reason ?? '' }
      : undefined;

    if (validDrafts.length === 0) {
      return {
        status: 'no_valid_drafts',
        generationPrompt,
        animationIntentPayload,
        invalidCount,
        generationNote: invalidCount > 0
          ? 'The model returned drafts, but none matched the trusted sequence schema for the current selected or attached assets.'
          : 'No sequence drafts were returned.',
        classifier: classifierVerdict,
      };
    }

    return {
      status: 'ok',
      generationPrompt,
      animationIntentPayload,
      validDrafts,
      invalidCount,
      generationNote: invalidCount > 0
        ? `${invalidCount} invalid draft${invalidCount === 1 ? '' : 's'} ${invalidCount === 1 ? 'was' : 'were'} rejected.`
        : null,
      classifier: classifierVerdict,
    };
  } catch (err) {
    if ((err as Error).name === 'AbortError') return { status: 'aborted' };
    throw err;
  }
};

// ─── Sequence component code-path generation ─────────────────────────
// Companion to runSequenceGenerationRequest above. The JSON helper handles
// param-tweakable edits (workerRender stays true); this code-path helper
// dispatches to ai-generate-sequence-component when the unified-UX
// classifier (see T12) decides the request needs a generated React
// component instead. Body shape mirrors the JSON path so the same asset
// context flows through.

export interface ExistingSequenceComponentInput {
  code: string;
  schema: object;
  defaults: object;
  controls?: unknown[];
}

export type RunSequenceComponentGenerationOptions = {
  prompt: string;
  name?: string;
  themeId?: string;
  existingComponent?: ExistingSequenceComponentInput;
  resolvedConfig: ResolvedTimelineConfig;
  selectedClips: readonly SelectedMediaClip[];
  attachedClips: readonly SelectedMediaClip[];
  allowedAssets: readonly AllowedSequenceAsset[];
  allowedAssetKeys: readonly string[];
  signal: AbortSignal;
};

export interface SequenceComponentGenerationResponse {
  code?: string;
  name?: string;
  description?: string;
  schemaJson?: object;
  defaultsJson?: object;
  assetSlots?: unknown[];
  controlsManifest?: unknown[];
  message?: string;
  model?: string;
  error?: string;
  details?: string;
  rawOutput?: string;
}

const sequenceComponentLog = (message: string, metadata?: Record<string, unknown>): void => {
  console.info('[SequenceCreator:ComponentGeneration]', message, metadata ?? {});
};

const sequenceComponentWarn = (message: string, metadata?: Record<string, unknown>): void => {
  console.error('[SequenceCreator:ComponentGeneration]', message, metadata ?? {});
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const PARAMS_REFERENCE_RE = /\bparams\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*"([^"\\]+)"\s*\]|\[\s*'([^'\\]+)'\s*\])/g;

const collectLooseCodeParamNames = (code: string): string[] => {
  const names = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = PARAMS_REFERENCE_RE.exec(code)) !== null) {
    const name = match[1] ?? match[2] ?? match[3];
    if ((GENERATED_SEQUENCE_LOOSE_MEDIA_PARAM_KEYS as readonly string[]).includes(name)) {
      names.add(name);
    }
  }
  return [...names];
};

const buildAllowedAssetSlotRegistry = (
  assets: readonly AllowedSequenceAsset[],
): AssetSlotAssetRegistry => {
  return assets.reduce<AssetSlotAssetRegistry>((registry, asset) => {
    registry[asset.key] = {
      key: asset.key,
      url: asset.url,
      mediaType: asset.mediaType,
      type: asset.mediaType === 'video' ? 'video/mp4' : 'image/png',
    };
    return registry;
  }, {});
};

export type RunSequenceComponentGenerationResult =
  | { status: 'aborted' }
  | {
      status: 'ok';
      code: string;
      name: string;
      description: string;
      schemaJson: object;
      defaultsJson: object;
      assetSlots: AssetSlotDefinition[];
      controlsManifest: ControlsManifest;
      message: string | null;
      model: string | null;
    }
  | {
      status: 'error';
      error: string;
      rawOutput?: string;
    };

export const runSequenceComponentGenerationRequest = async ({
  prompt,
  name,
  themeId,
  existingComponent,
  resolvedConfig,
  selectedClips,
  attachedClips,
  allowedAssets,
  allowedAssetKeys,
  signal,
}: RunSequenceComponentGenerationOptions): Promise<RunSequenceComponentGenerationResult> => {
  const generationPrompt = prompt.trim();
  const startedAt = Date.now();
  sequenceComponentLog('request:start', {
    promptLength: generationPrompt.length,
    hasName: Boolean(name),
    themeId: themeId ?? resolvedConfig.theme ?? null,
    existingComponent: Boolean(existingComponent),
    selectedClipCount: selectedClips.length,
    attachedClipCount: attachedClips.length,
    allowedAssetCount: allowedAssets.length,
    allowedAssetKeyCount: allowedAssetKeys.length,
  });
  try {
    const response = await invokeSupabaseEdgeFunction<SequenceComponentGenerationResponse>(
      'ai-generate-sequence-component',
      {
        body: {
          prompt: generationPrompt,
          ...(name ? { name } : {}),
          ...(themeId ? { themeId } : {}),
          ...(existingComponent ? { existingComponent } : {}),
          selected_clips: buildGenerationClipPayloads(selectedClips, allowedAssets),
          attached_clips: buildGenerationClipPayloads(attachedClips, allowedAssets),
          allowed_assets: allowedAssets.map((asset) => ({
            key: asset.key,
            assetKey: asset.key,
            url: asset.url,
            mediaType: asset.mediaType,
            label: asset.label,
            source: asset.source,
          })),
          allowed_asset_keys: allowedAssetKeys,
          theme: resolvedConfig.theme,
          theme_overrides: resolvedConfig.theme_overrides,
        },
        timeoutMs: 150_000,
        signal,
      },
    );
    const durationMs = Date.now() - startedAt;
    if (signal.aborted) {
      sequenceComponentWarn('request:aborted_after_response', { durationMs });
      return { status: 'aborted' };
    }
    sequenceComponentLog('request:response', {
      durationMs,
      hasError: Boolean(response.error),
      hasCode: Boolean(response.code),
      codeLength: response.code?.length ?? 0,
      hasSchemaJson: Boolean(response.schemaJson),
      hasDefaultsJson: Boolean(response.defaultsJson),
      assetSlotsCount: Array.isArray(response.assetSlots) ? response.assetSlots.length : null,
      controlsManifestCount: Array.isArray(response.controlsManifest) ? response.controlsManifest.length : null,
      rawOutputLength: response.rawOutput?.length ?? 0,
      name: response.name ?? null,
      model: response.model ?? null,
    });
    if (response.error || !response.code || !response.schemaJson || !response.defaultsJson || !Array.isArray(response.assetSlots)) {
      sequenceComponentWarn('request:incomplete_or_error', {
        durationMs,
        error: response.error ?? null,
        details: response.details ?? null,
        hasCode: Boolean(response.code),
        hasSchemaJson: Boolean(response.schemaJson),
        hasDefaultsJson: Boolean(response.defaultsJson),
        hasAssetSlots: Array.isArray(response.assetSlots),
        rawOutputLength: response.rawOutput?.length ?? 0,
      });
      return {
        status: 'error',
        error: response.details || response.error || 'Sequence component generation returned an incomplete response',
        rawOutput: response.rawOutput,
      };
    }
    const assetSlotsResult = normalizeAssetSlots(response.assetSlots);
    if (assetSlotsResult.errors.length > 0) {
      sequenceComponentWarn('request:asset_slots_invalid', {
        durationMs,
        errors: assetSlotsResult.errors.map((e) => e.message),
        assetSlotsCount: response.assetSlots.length,
        codeLength: response.code.length,
      });
      return {
        status: 'error',
        error: `Asset slots invalid: ${assetSlotsResult.errors.map((e) => e.message).join('; ')}`,
        rawOutput: response.rawOutput,
      };
    }
    const schemaProperties = isRecord(response.schemaJson)
      && isRecord(response.schemaJson.properties)
      ? response.schemaJson.properties
      : {};
    const defaultsJson = response.defaultsJson;
    const defaultsRecord = defaultsJson as Record<string, unknown>;
    const looseErrors = [
      ...collectLooseGeneratedMediaParamErrors(schemaProperties, 'schemaJson.properties'),
      ...collectLooseGeneratedMediaParamErrors(defaultsJson, 'defaultsJson'),
      ...collectLooseCodeParamNames(response.code).map((name) => ({
        code: 'loose_generated_media_param' as const,
        path: `params.${name}`,
        message: `Generated sequence components must use ${ASSET_SLOT_BINDINGS_PARAM} for persisted asset keys and host-injected ${ASSET_SLOTS_PARAM} for URLs, not "${name}".`,
      })),
    ];
    const assetSlotContractErrors: string[] = [];
    if (Object.prototype.hasOwnProperty.call(schemaProperties, ASSET_SLOTS_PARAM)) {
      assetSlotContractErrors.push(`Host-injected param "${ASSET_SLOTS_PARAM}" must not be declared in schemaJson.properties`);
    }
    if (Object.prototype.hasOwnProperty.call(defaultsRecord, ASSET_SLOTS_PARAM)) {
      assetSlotContractErrors.push(`Host-injected param "${ASSET_SLOTS_PARAM}" must not be declared in defaultsJson`);
    }
    if (assetSlotsResult.slots.length > 0) {
      if (!Object.prototype.hasOwnProperty.call(schemaProperties, ASSET_SLOT_BINDINGS_PARAM)) {
        assetSlotContractErrors.push(`schemaJson.properties.${ASSET_SLOT_BINDINGS_PARAM} is required when assetSlots are declared`);
      }
      if (!Object.prototype.hasOwnProperty.call(defaultsRecord, ASSET_SLOT_BINDINGS_PARAM)) {
        assetSlotContractErrors.push(`defaultsJson.${ASSET_SLOT_BINDINGS_PARAM} is required when assetSlots are declared`);
      }
    }
    const bindingValidation = validateAssetSlotBindings({
      slots: assetSlotsResult.slots,
      bindings: defaultsRecord[ASSET_SLOT_BINDINGS_PARAM],
      registry: buildAllowedAssetSlotRegistry(allowedAssets),
      path: `defaultsJson.${ASSET_SLOT_BINDINGS_PARAM}`,
    });
    const bindingMessages = bindingValidation.errors.map((error) => error.message);
    if (looseErrors.length > 0 || assetSlotContractErrors.length > 0 || bindingMessages.length > 0) {
      const errors = [
        ...looseErrors.map((error) => error.message),
        ...assetSlotContractErrors,
        ...bindingMessages,
      ];
      sequenceComponentWarn('request:asset_slot_contract_invalid', {
        durationMs,
        errors,
        assetSlotsCount: assetSlotsResult.slots.length,
        codeLength: response.code.length,
      });
      return {
        status: 'error',
        error: `Asset slot contract invalid: ${errors.join('; ')}`,
        rawOutput: response.rawOutput,
      };
    }
    // Client-side gate (mirrors the edge-function-side validator). The edge
    // function already rejects bad manifests, but we re-check here so a
    // misbehaving deployment can't bypass the contract — and so the user
    // sees a useful error even if the response shape ever drifts.
    const manifestResult = validateControlsManifest(response.controlsManifest, { code: response.code });
    if (!manifestResult.ok) {
      sequenceComponentWarn('request:controls_manifest_invalid', {
        durationMs,
        errors: manifestResult.errors.map((e) => e.message),
        controlsManifestCount: Array.isArray(response.controlsManifest) ? response.controlsManifest.length : null,
        codeLength: response.code.length,
      });
      return {
        status: 'error',
        error: `Controls manifest invalid: ${manifestResult.errors.map((e) => e.message).join('; ')}`,
        rawOutput: response.rawOutput,
      };
    }
    sequenceComponentLog('request:ok', {
      durationMs,
      codeLength: response.code.length,
      controlsManifestCount: manifestResult.manifest.length,
      assetSlotsCount: assetSlotsResult.slots.length,
      name: response.name ?? null,
      model: response.model ?? null,
    });
    return {
      status: 'ok',
      code: response.code,
      name: response.name ?? '',
      description: response.description ?? '',
      schemaJson: response.schemaJson,
      defaultsJson: response.defaultsJson,
      assetSlots: assetSlotsResult.slots,
      controlsManifest: manifestResult.manifest,
      message: response.message ?? null,
      model: response.model ?? null,
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    if ((err as Error).name === 'AbortError') {
      sequenceComponentWarn('request:aborted', { durationMs });
      return { status: 'aborted' };
    }
    if (err instanceof SupabaseEdgeFunctionError) {
      const payload = err.responseJson && typeof err.responseJson === 'object'
        ? err.responseJson as Record<string, unknown>
        : {};
      console.error('[SequenceCreator:ComponentGeneration] request:edge_error', {
        durationMs,
        status: err.status,
        message: err.message,
        error: typeof payload.error === 'string' ? payload.error : null,
        details: typeof payload.details === 'string' ? payload.details : null,
        rawOutputLength: typeof payload.rawOutput === 'string' ? payload.rawOutput.length : 0,
      });
      return {
        status: 'error',
        error: err.message,
        rawOutput: typeof payload.rawOutput === 'string' ? payload.rawOutput : undefined,
      };
    }
    console.error('[SequenceCreator:ComponentGeneration] request:exception', {
      durationMs,
      message: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : null,
    });
    throw err;
  }
};
