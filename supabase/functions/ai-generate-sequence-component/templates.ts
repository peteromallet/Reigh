import { parseEnvelope } from '../_shared/promptEnvelope.ts';
import { validateSequenceComponentCode } from './sequence-component-validation.ts';
import { validateControlsManifestForCode } from './controls-manifest-validation.ts';
import {
  ASSET_SLOT_BINDINGS_PARAM,
  normalizeAssetSlots,
  validateAssetSlotBindings,
  type AssetSlotValidationAsset,
} from './asset-slot-validation.ts';

export interface ExistingSequenceComponent {
  code: string;
  schema: object;
  defaults: object;
  /** Prior CONTROLS manifest, surfaced to the model during edit/fix mode. */
  controls?: unknown[];
}

export interface AllowedSequenceComponentAsset {
  key: string;
  mediaType: 'image' | 'video';
  label: string;
  source?: string;
}

export interface BuildGenerateSequenceComponentMessagesInput {
  prompt: string;
  name?: string;
  themeId?: string;
  existingComponent?: ExistingSequenceComponent;
  allowedAssets: readonly AllowedSequenceComponentAsset[];
  selectedClips?: unknown;
  attachedClips?: unknown;
  theme?: unknown;
  themeOverrides?: unknown;
  /** When set, the component failed validation and needs a targeted fix. */
  validationError?: string;
}

export interface ExtractSequenceComponentCodeAndMetaOptions {
  allowedAssets?: readonly AssetSlotValidationAsset[];
}

interface ExtractedSequenceComponentMeta {
  code: string;
  name: string;
  description: string;
  schemaJson: object;
  defaultsJson: object;
  assetSlots: unknown[];
  controlsManifest: unknown[];
  message: string;
}

const SEQUENCE_COMPONENT_CONTRACT = `Sequence component contract:
- Default-export a React function component via \`exports.default = ComponentName\`.
- The component receives props: { clip, params, theme, fps }.
  - clip: a ResolvedTimelineClip describing the clip's timing, asset, and metadata.
  - params: a Record<string, unknown> populated from the SCHEMA you generate (see DEFAULTS).
  - theme: an optional RuntimeTheme. Read it via the useTheme() global, do NOT inline theme tokens.
  - fps: the composition fps (number).
- JSX is allowed (transpiled at runtime).
- Do NOT import or export anything (no import/export statements at all).
- Components must be deterministic per frame — no Date.now(), performance.now(), or crypto.getRandomValues().
- Math.random() is allowed ONLY inside React.useMemo(() => …, []) for one-time values like SVG filter IDs.`;

export const AVAILABLE_SEQUENCE_GLOBALS = `Available globals at runtime (use EXACTLY these names — no imports needed):
- React
- useCurrentFrame
- useVideoConfig
- interpolate(value, inputRange, outputRange, options?)
- spring({ frame, fps, durationInFrames?, config? })
- AbsoluteFill
- Sequence
- Series
- Img
- Video
- Audio
- Easing
- useTheme  (returns RuntimeTheme; tokens like theme.tokens.color, theme.tokens.font)
- composeAnimations`;

const OUTPUT_RULES = `Output requirements:
- Return only executable component code — no markdown fences, no prose.
- Do not include import or export statements.
- Begin with these metadata lines, in order:
  // NAME: <fun, memorable component name (2-4 words)>
  // DESCRIPTION: <one concise sentence describing the visual>
  // SCHEMA: { "type": "object", "properties": { ... }, "required": [...] }
  // DEFAULTS: { ... }
  // ASSET_SLOTS: [ { "id": "hero", "label": "Hero image", "mediaType": "image", "required": true, "minItems": 1, "maxItems": 1 } ]
  // CONTROLS: [ { "name": "...", "label": "...", "type": "...", "priority": "primary" | "secondary", "default": ..., ... } ]
  // MESSAGE: <brief note for the user>
- SCHEMA is JSON Schema (a JSON object). Every user-tunable \`params.X\` access in your code MUST appear in SCHEMA.properties.
- DEFAULTS is a JSON object with one entry per SCHEMA property; values must be valid for the schema.
- ASSET_SLOTS is a JSON array describing media picker slots. Emit [] when no allowed assets exist or no media is needed.
- CONTROLS is the user-facing controls manifest (a JSON array). See "Controls manifest contract" below.
- After the metadata, write the component definition and assign it via \`exports.default = ComponentName\`.
- The default export MUST be a function component compatible with the contract above.
- Use useVideoConfig() and the fps prop to express timing in frames; do NOT use wall-clock APIs.
- Read all user-tunable values from the params prop (e.g. params.duration, params.color), never as top-level props.
- Express spatial values as percentages of the composition width — preview is small, timeline can be 1920×1080+.`;

const CONTROLS_MANIFEST_CONTRACT = `Controls manifest contract:
- CONTROLS is a JSON array. One entry per user-tunable param the component reads from \`params.X\`.
- params.assetSlotBindings and host-injected params.assetSlots are EXCLUDED from CONTROLS — they are
  managed by the asset picker and host, not by the controls panel.
- Every entry MUST have these fields:
    { "name": "<JS identifier matching params.X>",
      "label": "<short human label>",
      "type": "number" | "boolean" | "text" | "color" | "enum" | "slider",
      "priority": "primary" | "secondary",
      "default": <value valid for the type> }
- Type-specific fields:
    number  → optional "min", "max", "step"
    slider  → REQUIRED "min", "max"; optional "step"; default is a number in [min, max]
    boolean → default is true | false
    text    → default is a string
    color   → default is a hex string like "#rrggbb"
    enum    → REQUIRED "options": string[] (non-empty); default MUST be one of options
- Priority rules — read carefully:
    Mark a control "primary" only if it is the ONE knob the user is most likely to tweak each
    time they pick this sequence. Most controls should be "secondary". A typical sequence has
    0–2 primary controls. If you find yourself marking 3+ as primary, demote the rest to secondary.
- Cross-coverage:
    Every entry's "name" MUST be referenced as \`params.<name>\` somewhere in the component code.
    Every \`params.<name>\` accessed in the code (excluding assetSlotBindings and assetSlots) MUST have a
    matching CONTROLS entry. The host rejects manifests that fail this check.
- Type allowlist is FIXED. Do not invent new widget types — pick the closest from the list above.`;

const ASSET_SLOT_CONTRACT = `Asset-slot contract:
- The host provides numbered allowed assets. Each has a key, media type, label, and optional source.
- Declare media needs with the required // ASSET_SLOTS metadata line. Each slot object MUST have:
    { "id": "<stable JS identifier>", "label": "<short picker label>", "mediaType": "image" | "video",
      "required": true | false, "minItems": <integer >= 0>, "maxItems": <integer >= 1> }
- Persist default asset key selections in DEFAULTS.assetSlotBindings, e.g.
    "assetSlotBindings": { "hero": ["asset-a"], "background": ["asset-b"] }
- Include assetSlotBindings in SCHEMA.properties as an object so the defaults are persisted.
- NEVER put params.assetSlots in SCHEMA, DEFAULTS, or CONTROLS. The host injects URL arrays into it
  at render time from assetSlotBindings.
- In component code, read host-injected URLs from params.assetSlots.<slotId>, e.g.
    const heroUrl = (params.assetSlots?.hero ?? [])[0];
    return heroUrl ? <Img src={heroUrl} /> : null;
- NEVER read params.assetSlotBindings at render time except for harmless diagnostics; render from
  params.assetSlots.<slotId> URL arrays only.
- NEVER emit params.imageAssetKeys, params.videoAssetKeys, params.images, or params.videos for a
  generated component. Those loose media params are rejected.
- NEVER inline raw URLs in params or code. The host resolves asset keys to URLs at render time.
- Match the user's requested asset cardinality with slot minItems/maxItems:
    Single-image sequence → one required image slot with maxItems 1.
    Multi-image sequence → one image slot with maxItems > 1, or multiple named image slots.
    Single-video sequence → one required video slot with maxItems 1 and render with <Video>.
    Mixed media sequence → separate image/video slots and branch by the injected URL arrays.
- **If allowed asset keys are non-empty (the user attached/selected media), the component
  MUST visually display at least one of those assets as a primary, foreground visual element
  — not merely as a faint backdrop or placeholder.** A glow / vignette / particle field on its
  own is NOT enough; the user's image (or video) must be rendered prominently and visibly.
- If no allowed assets exist or the user asks for a purely graphic/text component, emit ASSET_SLOTS: []
  and omit DEFAULTS.assetSlotBindings unless slots are declared.`;

const VALIDATION_RULES = `Validation rules (the host will reject your output if violated):
- The code must contain \`exports.default =\`.
- The code must NOT contain import or export statements.
- The code must NOT call Date.now(), performance.now(), or crypto.getRandomValues().
- Math.random() is allowed only inside React.useMemo(() => …, []).
- Every user-tunable \`params.X\` reference must be present in SCHEMA.properties AND DEFAULTS.
- params.assetSlots is host-injected and must NOT be present in SCHEMA or DEFAULTS.
- params.assetSlotBindings is persisted key data and must be present in SCHEMA and DEFAULTS when slots are declared.`;

export function buildGenerateSequenceComponentMessages(
  input: BuildGenerateSequenceComponentMessagesInput,
): { systemMsg: string; userMsg: string } {
  const {
    prompt,
    name,
    themeId,
    existingComponent,
    allowedAssets,
    selectedClips,
    attachedClips,
    theme,
    themeOverrides,
    validationError,
  } = input;
  const allowedAssetKeys = allowedAssets.map((asset) => asset.key);

  let modeInstructions: string;
  if (validationError && existingComponent?.code) {
    modeInstructions = `Fix mode:
- The previous component generation FAILED validation:

  ERROR: ${validationError}

- Fix ONLY the issue described in the error. Keep everything else the same — same SCHEMA fields,
  same DEFAULTS values, same component name.
- Re-emit the full envelope (NAME / DESCRIPTION / SCHEMA / DEFAULTS / CONTROLS / MESSAGE) followed by the fixed code.

Code that needs fixing:
\`\`\`tsx
${existingComponent.code.trim()}
\`\`\`

Existing SCHEMA: ${JSON.stringify(existingComponent.schema)}
Existing DEFAULTS: ${JSON.stringify(existingComponent.defaults)}
Existing CONTROLS: ${JSON.stringify(existingComponent.controls ?? [])}`;
  } else if (existingComponent?.code) {
    modeInstructions = `Edit mode:
- You are making a TARGETED EDIT to an existing, working sequence component.
- Start from the existing code below and modify ONLY what the user asked for.
- Preserve component name, structure, and existing SCHEMA fields unless the user's request
  requires changing them.
- Re-emit the full envelope (NAME / DESCRIPTION / SCHEMA / DEFAULTS / CONTROLS / MESSAGE) followed by the
  edited code.

Existing code:
\`\`\`tsx
${existingComponent.code.trim()}
\`\`\`

Existing SCHEMA: ${JSON.stringify(existingComponent.schema)}
Existing DEFAULTS: ${JSON.stringify(existingComponent.defaults)}
Existing CONTROLS: ${JSON.stringify(existingComponent.controls ?? [])}`;
  } else {
    modeInstructions = `Creation mode:
- Generate a new sequence component from scratch.
- Pick a clear component name that matches the visual idea.
- Define a small, opinionated SCHEMA — only the params the user is likely to tweak.`;
  }

  const assetKeysBlock = allowedAssetKeys.length > 0
    ? `Allowed assets (use these keys only in DEFAULTS.assetSlotBindings; never inline URLs):
${allowedAssets.map((asset, index) => (
  `${index + 1}. key=${asset.key}; mediaType=${asset.mediaType}; label=${asset.label}${asset.source ? `; source=${asset.source}` : ''}`
)).join('\n')}`
    : 'No allowed assets for this generation. Emit ASSET_SLOTS: [] unless the user explicitly asks for empty media slots.';

  const contextBlock = [
    selectedClips ? `Selected clips: ${JSON.stringify(selectedClips).slice(0, 2000)}` : null,
    attachedClips ? `Attached clips: ${JSON.stringify(attachedClips).slice(0, 2000)}` : null,
    theme ? `Theme: ${JSON.stringify(theme).slice(0, 1500)}` : null,
    themeOverrides ? `Theme overrides: ${JSON.stringify(themeOverrides).slice(0, 1500)}` : null,
    themeId ? `Theme id: ${themeId}` : null,
  ].filter(Boolean).join('\n');

  const systemMsg = `You are an AI assistant that generates Reigh sequence components.

A sequence component is a React component that renders inside a Remotion timeline clip. The host
compiles your code at runtime via Sucrase + new Function and renders it for the duration of the clip.

${SEQUENCE_COMPONENT_CONTRACT}

${AVAILABLE_SEQUENCE_GLOBALS}

${ASSET_SLOT_CONTRACT}

${OUTPUT_RULES}

${CONTROLS_MANIFEST_CONTRACT}

${VALIDATION_RULES}`;

  const userMsg = `User request${name ? ` for a sequence component called "${name}"` : ''}:
"${prompt}"

${assetKeysBlock}

${contextBlock || ''}

${modeInstructions}

Implementation guidance:
- Keep the component self-contained in a single function.
- Read every tunable from params; surface every params.X in SCHEMA + DEFAULTS.
- Prefer interpolate / spring for animation; avoid setInterval, requestAnimationFrame, etc.
- Use useTheme() for theme-aware tokens; do not inline theme color values.

Return only the metadata lines plus the final code.`;

  return { systemMsg, userMsg };
}

export function extractSequenceComponentCodeAndMeta(
  responseText: string,
  options: ExtractSequenceComponentCodeAndMetaOptions = {},
): ExtractedSequenceComponentMeta {
  const { values, jsonValues, codeBody } = parseEnvelope(
    responseText,
    ['NAME', 'DESCRIPTION', 'SCHEMA', 'DEFAULTS', 'ASSET_SLOTS', 'CONTROLS', 'MESSAGE'],
    { jsonObjectFields: ['SCHEMA', 'DEFAULTS'], jsonArrayFields: ['ASSET_SLOTS', 'CONTROLS'] },
  );

  const schemaJson = (jsonValues.SCHEMA && typeof jsonValues.SCHEMA === 'object'
    ? jsonValues.SCHEMA as object
    : null);
  const defaultsJson = (jsonValues.DEFAULTS && typeof jsonValues.DEFAULTS === 'object'
    ? jsonValues.DEFAULTS as object
    : null);
  const controlsManifest = Array.isArray(jsonValues.CONTROLS)
    ? jsonValues.CONTROLS as unknown[]
    : null;
  const assetSlots = Array.isArray(jsonValues.ASSET_SLOTS)
    ? jsonValues.ASSET_SLOTS as unknown[]
    : null;

  if (!schemaJson) {
    throw new Error('Generated sequence component is missing a valid // SCHEMA: { ... } block');
  }
  if (!defaultsJson) {
    throw new Error('Generated sequence component is missing a valid // DEFAULTS: { ... } block');
  }
  if (!controlsManifest) {
    throw new Error('Generated sequence component is missing a valid // CONTROLS: [ ... ] block');
  }
  if (!assetSlots) {
    throw new Error('Generated sequence component is missing a valid // ASSET_SLOTS: [ ... ] block');
  }

  const normalizedSlots = normalizeAssetSlots(assetSlots);
  if (normalizedSlots.errors.length > 0) {
    throw new Error(`Invalid ASSET_SLOTS metadata: ${normalizedSlots.errors.join('; ')}`);
  }

  validateSequenceComponentCode(codeBody, schemaJson, defaultsJson);
  validateControlsManifestForCode(controlsManifest, codeBody);

  const schemaProperties = (schemaJson as { properties?: Record<string, unknown> }).properties ?? {};
  if (normalizedSlots.slots.length > 0) {
    if (!Object.prototype.hasOwnProperty.call(schemaProperties, ASSET_SLOT_BINDINGS_PARAM)) {
      throw new Error(`Generated sequence component declares ASSET_SLOTS but SCHEMA.properties.${ASSET_SLOT_BINDINGS_PARAM} is missing`);
    }
    if (!Object.prototype.hasOwnProperty.call(defaultsJson, ASSET_SLOT_BINDINGS_PARAM)) {
      throw new Error(`Generated sequence component declares ASSET_SLOTS but DEFAULTS.${ASSET_SLOT_BINDINGS_PARAM} is missing`);
    }
  }

  const bindingErrors = validateAssetSlotBindings({
    slots: normalizedSlots.slots,
    bindings: (defaultsJson as Record<string, unknown>)[ASSET_SLOT_BINDINGS_PARAM],
    allowedAssets: options.allowedAssets ?? [],
  });
  if (bindingErrors.length > 0) {
    throw new Error(`Invalid asset slot bindings: ${bindingErrors.join('; ')}`);
  }

  return {
    code: codeBody,
    name: values.NAME ?? '',
    description: values.DESCRIPTION ?? '',
    schemaJson,
    defaultsJson,
    assetSlots: normalizedSlots.slots,
    controlsManifest,
    message: values.MESSAGE ?? '',
  };
}
