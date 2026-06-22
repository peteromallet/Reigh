import type { ReactNode } from 'react';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider.ts';
import type {
  TimelineChromeContextValue,
  TimelineEditorDataContextValue,
  TimelineEditorOpsContextValue,
  TimelinePlaybackContextValue,
} from '@/tools/video-editor/hooks/useTimelineState.types.ts';
import type { ExtensionSettings, ExtensionCommandContribution } from './extensionManifest.ts';
import type { VideoEditorDiagnostic } from './diagnostics.ts';

export type VideoEditorSlotName =
  | 'header'
  | 'toolbar'
  | 'leftPanel'
  | 'rightPanel'
  | 'timelineFooter'
  | 'statusBar'
  | 'dialogs'
  | 'assetPanel'
  | 'inspectorPanel';

export interface VideoEditorRuntimeSlices {
  data: TimelineEditorDataContextValue;
  ops: TimelineEditorOpsContextValue;
  chrome: TimelineChromeContextValue;
  playback: TimelinePlaybackContextValue;
}

export interface VideoEditorRenderContext extends VideoEditorRuntimeSlices {
  provider: DataProvider;
  timelineId: string;
  timelineName: string | null;
  userId: string;
  extensions: VideoEditorExtensionRuntimeConfig;
}

export type VideoEditorVisibilityPredicate = (context: VideoEditorRenderContext) => boolean;
export type VideoEditorSlotRenderer = (context: VideoEditorRenderContext) => ReactNode;

export interface VideoEditorDialogDescriptor {
  id: string;
  order?: number;
  layer?: 'modal' | 'overlay';
  when?: VideoEditorVisibilityPredicate;
  render: VideoEditorSlotRenderer;
}

export interface VideoEditorPanelDescriptor {
  id: string;
  placement: 'asset-panel';
  order?: number;
  when?: VideoEditorVisibilityPredicate;
  render: VideoEditorSlotRenderer;
}

export interface VideoEditorInspectorSectionDescriptor {
  id: string;
  placement: 'before-default' | 'after-default';
  order?: number;
  when?: VideoEditorVisibilityPredicate;
  render: VideoEditorSlotRenderer;
}

export interface VideoEditorPanelRegistryConfig {
  panels?: readonly VideoEditorPanelDescriptor[];
  inspectorSections?: readonly VideoEditorInspectorSectionDescriptor[];
}

export interface VideoEditorDialogHostConfig {
  dialogs?: readonly VideoEditorDialogDescriptor[];
}

export interface VideoEditorExtensionConfig {
  /** Extension identifier matching {@link ExtensionManifest.id}.  Only set for package-loaded configs; raw M1 configs omit it. */
  extensionId?: string;
  /** Resolved extension settings (JSON-only).  Only set for package-loaded configs after settings resolution. */
  settings?: ExtensionSettings;
  enabled?: boolean;
  slots?: Partial<Record<VideoEditorSlotName, VideoEditorSlotRenderer>>;
  dialogHost?: VideoEditorDialogHostConfig;
  registry?: VideoEditorPanelRegistryConfig;
  /** Namespaced command contributions from this extension. Only set for package-loaded configs after command resolution. */
  commands?: readonly ExtensionCommandContribution[];
}

export type VideoEditorExtensionInput =
  | VideoEditorExtensionConfig
  | readonly VideoEditorExtensionConfig[]
  | undefined;

export interface VideoEditorExtensionRuntimeConfig {
  slots: Partial<Record<VideoEditorSlotName, VideoEditorSlotRenderer>>;
  dialogHost: {
    dialogs: readonly VideoEditorDialogDescriptor[];
  };
  registry: {
    panels: readonly VideoEditorPanelDescriptor[];
    inspectorSections: readonly VideoEditorInspectorSectionDescriptor[];
  };
  /**
   * Package configs keyed by defined extension ID.
   *
   * Only package-loaded configs that carry an `extensionId` appear here.
   * Raw M1 configs without an `extensionId` are omitted — consumers can
   * safely iterate without `undefined` key checks.
   */
  packages: Record<string, VideoEditorExtensionConfig>;
  /**
   * Resolved extension settings keyed by defined extension ID.
   *
   * Only entries whose corresponding config carries both `extensionId` and
   * `settings` appear here.  Raw M1 configs are omitted.
   */
  settings: Record<string, ExtensionSettings>;
  /**
   * Resolved command contributions from all enabled extensions, namespaced
   * as `${manifest.id}.${localCommandId}`. Duplicate command IDs are
   * excluded (first-loaded wins). Duplicate keybindings are warned but
   * both commands remain registered.
   *
   * Consumers should pass this field as `extensionCommands` to
   * `createEditorCommandRegistry` (from `@/tools/video-editor/commands`)
   * to build the unified editor command registry that combines internal
   * TimelineCommands with these extension contributions.
   */
  commands: readonly ExtensionCommandContribution[];
}

export interface ResolvedVideoEditorPanelRegistry {
  assetPanels: readonly VideoEditorPanelDescriptor[];
  inspectorSections: {
    all: readonly VideoEditorInspectorSectionDescriptor[];
    beforeDefault: readonly VideoEditorInspectorSectionDescriptor[];
    afterDefault: readonly VideoEditorInspectorSectionDescriptor[];
  };
}

const EMPTY_SLOTS: Partial<Record<VideoEditorSlotName, VideoEditorSlotRenderer>> = Object.freeze({});
const EMPTY_DIALOGS: readonly VideoEditorDialogDescriptor[] = Object.freeze([]);
const EMPTY_PANELS: readonly VideoEditorPanelDescriptor[] = Object.freeze([]);
const EMPTY_INSPECTOR_SECTIONS: readonly VideoEditorInspectorSectionDescriptor[] = Object.freeze([]);
const EMPTY_PACKAGES_MAP: Record<string, VideoEditorExtensionConfig> = Object.freeze({});
const EMPTY_SETTINGS_MAP: Record<string, ExtensionSettings> = Object.freeze({});
const EMPTY_COMMANDS: readonly ExtensionCommandContribution[] = Object.freeze([]);
const EMPTY_RESOLVED_PANEL_REGISTRY: ResolvedVideoEditorPanelRegistry = Object.freeze({
  assetPanels: EMPTY_PANELS,
  inspectorSections: Object.freeze({
    all: EMPTY_INSPECTOR_SECTIONS,
    beforeDefault: EMPTY_INSPECTOR_SECTIONS,
    afterDefault: EMPTY_INSPECTOR_SECTIONS,
  }),
});

export const DEFAULT_VIDEO_EDITOR_EXTENSION_RUNTIME: VideoEditorExtensionRuntimeConfig = Object.freeze({
  slots: EMPTY_SLOTS,
  dialogHost: Object.freeze({
    dialogs: EMPTY_DIALOGS,
  }),
  registry: Object.freeze({
    panels: EMPTY_PANELS,
    inspectorSections: EMPTY_INSPECTOR_SECTIONS,
  }),
  packages: EMPTY_PACKAGES_MAP,
  settings: EMPTY_SETTINGS_MAP,
  commands: EMPTY_COMMANDS,
});

function normalizeExtensionInput(
  input?: VideoEditorExtensionInput,
): readonly VideoEditorExtensionConfig[] {
  if (input === undefined) {
    return [];
  }

  const configs: readonly VideoEditorExtensionConfig[] = Array.isArray(input) ? input : [input];

  return configs.filter((config) => config.enabled !== false);
}

/**
 * Collect duplicate descriptor IDs and return diagnostics for each duplicate.
 * The `unique` output array contains only the first occurrence of every ID
 * (fail-closed: duplicates are excluded).
 */
function collectDuplicateDescriptorDiagnostics<T extends { id: string }>(
  descriptors: readonly T[],
  collection: string,
): { unique: T[]; diagnostics: Array<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>> } {
  const seen = new Set<string>();
  const unique: T[] = [];
  const diagnostics: Array<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>> = [];

  for (const descriptor of descriptors) {
    if (seen.has(descriptor.id)) {
      diagnostics.push({
        code: 'duplicate_descriptor_id',
        severity: 'error',
        source: 'extension-runtime',
        message: `Duplicate extension descriptor ID "${descriptor.id}" in collection "${collection}". The duplicate was excluded.`,
        detail: { descriptorId: descriptor.id, collection },
      });
    } else {
      seen.add(descriptor.id);
      unique.push(descriptor);
    }
  }

  return { unique, diagnostics };
}

function mergeSlots(
  effectiveConfigs: readonly VideoEditorExtensionConfig[],
): Partial<Record<VideoEditorSlotName, VideoEditorSlotRenderer>> {
  if (effectiveConfigs.length === 0) {
    return EMPTY_SLOTS;
  }

  const merged: Partial<Record<VideoEditorSlotName, VideoEditorSlotRenderer>> = {};

  for (const config of effectiveConfigs) {
    if (config.slots) {
      Object.assign(merged, config.slots);
    }
  }

  return Object.keys(merged).length === 0 ? EMPTY_SLOTS : merged;
}

function mergeDialogs(
  effectiveConfigs: readonly VideoEditorExtensionConfig[],
): { descriptors: readonly VideoEditorDialogDescriptor[]; diagnostics: Array<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>> } {
  const merged: VideoEditorDialogDescriptor[] = [];

  for (const config of effectiveConfigs) {
    if (config.dialogHost?.dialogs) {
      merged.push(...config.dialogHost.dialogs);
    }
  }

  if (merged.length === 0) {
    return { descriptors: EMPTY_DIALOGS, diagnostics: [] };
  }

  const { unique, diagnostics } = collectDuplicateDescriptorDiagnostics(merged, 'dialogs');

  return { descriptors: unique, diagnostics };
}

function mergePanels(
  effectiveConfigs: readonly VideoEditorExtensionConfig[],
): { descriptors: readonly VideoEditorPanelDescriptor[]; diagnostics: Array<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>> } {
  const merged: VideoEditorPanelDescriptor[] = [];

  for (const config of effectiveConfigs) {
    if (config.registry?.panels) {
      merged.push(...config.registry.panels);
    }
  }

  if (merged.length === 0) {
    return { descriptors: EMPTY_PANELS, diagnostics: [] };
  }

  const { unique, diagnostics } = collectDuplicateDescriptorDiagnostics(merged, 'panels');

  return { descriptors: unique, diagnostics };
}

function mergeInspectorSections(
  effectiveConfigs: readonly VideoEditorExtensionConfig[],
): { descriptors: readonly VideoEditorInspectorSectionDescriptor[]; diagnostics: Array<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>> } {
  const merged: VideoEditorInspectorSectionDescriptor[] = [];

  for (const config of effectiveConfigs) {
    if (config.registry?.inspectorSections) {
      merged.push(...config.registry.inspectorSections);
    }
  }

  if (merged.length === 0) {
    return { descriptors: EMPTY_INSPECTOR_SECTIONS, diagnostics: [] };
  }

  const { unique, diagnostics } = collectDuplicateDescriptorDiagnostics(merged, 'inspectorSections');

  return { descriptors: unique, diagnostics };
}

/**
 * Normalize a keybinding string for duplicate detection.
 * Lowercases, collapses whitespace, and trims.
 */
function normalizeKeybinding(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Merge command contributions from all effective configs.
 *
 * Duplicate fully-qualified command IDs are excluded fail-closed (first-wins)
 * and produce `duplicate_command_id` diagnostics.
 *
 * Duplicate normalized keybindings produce `duplicate_keybinding` warnings
 * but both commands remain registered (the conflict is for the user to resolve).
 */
function mergeCommands(
  effectiveConfigs: readonly VideoEditorExtensionConfig[],
): { commands: readonly ExtensionCommandContribution[]; diagnostics: Array<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>> } {
  const diagnostics: Array<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>> = [];
  const commands: ExtensionCommandContribution[] = [];
  const seenIds = new Set<string>();

  // Track normalized keybindings for duplicate detection across all configs.
  const seenKey = new Map<string, { commandId: string; rawKey: string }>();
  const seenMac = new Map<string, { commandId: string; rawKey: string }>();

  for (const config of effectiveConfigs) {
    const configCommands = config.commands;
    if (!configCommands) continue;

    for (const cmd of configCommands) {
      // Duplicate command ID: first-wins, fail-closed.
      if (seenIds.has(cmd.id)) {
        diagnostics.push({
          code: 'duplicate_command_id',
          severity: 'error',
          source: 'extension-runtime',
          message: `Duplicate command ID "${cmd.id}". The duplicate was excluded.`,
          detail: { commandId: cmd.id },
        });
        continue;
      }

      seenIds.add(cmd.id);
      commands.push(cmd);

      // Keybinding duplicate detection (warning only).
      if (cmd.keybinding?.key) {
        const normalized = normalizeKeybinding(cmd.keybinding.key);
        const existing = seenKey.get(normalized);

        if (existing) {
          diagnostics.push({
            code: 'duplicate_keybinding',
            severity: 'warning',
            source: 'extension-runtime',
            message: `Duplicate keybinding "${cmd.keybinding.key}" (normalized: "${normalized}") ` +
              `for commands "${existing.commandId}" and "${cmd.id}".`,
            detail: {
              commandId: cmd.id,
              keybinding: cmd.keybinding.key,
              normalizedKeybinding: normalized,
              firstCommandId: existing.commandId,
              secondCommandId: cmd.id,
            },
          });
        } else {
          seenKey.set(normalized, { commandId: cmd.id, rawKey: cmd.keybinding.key });
        }
      }

      if (cmd.keybinding?.mac) {
        const normalized = normalizeKeybinding(cmd.keybinding.mac);
        const existing = seenMac.get(normalized);

        if (existing) {
          diagnostics.push({
            code: 'duplicate_keybinding',
            severity: 'warning',
            source: 'extension-runtime',
            message: `Duplicate Mac keybinding "${cmd.keybinding.mac}" (normalized: "${normalized}") ` +
              `for commands "${existing.commandId}" and "${cmd.id}".`,
            detail: {
              commandId: cmd.id,
              keybindingMac: cmd.keybinding.mac,
              normalizedKeybinding: normalized,
              firstCommandId: existing.commandId,
              secondCommandId: cmd.id,
            },
          });
        } else {
          seenMac.set(normalized, { commandId: cmd.id, rawKey: cmd.keybinding.mac });
        }
      }
    }
  }

  return { commands, diagnostics };
}

/**
 * Result of the diagnostics-aware extension runtime resolver.
 *
 * Consumers that need duplicate-descriptor diagnostics should use
 * {@link resolveVideoEditorExtensionRuntimeWithDiagnostics} and pipe
 * `diagnostics` into the central diagnostics store via
 * `store.replaceBySource('extension-runtime', diagnostics)`.
 */
export interface ResolveVideoEditorExtensionRuntimeResult {
  runtime: VideoEditorExtensionRuntimeConfig;
  diagnostics: Array<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>>;
}

/**
 * Resolve extension runtime config and collect duplicate-descriptor
 * diagnostics without throwing.
 *
 * Duplicate descriptor IDs are excluded fail-closed (first-wins).
 * Duplicate command IDs are excluded fail-closed (first-wins).
 * Duplicate keybindings produce warnings.
 * Valid and disabled config behaviour is unchanged from the legacy resolver.
 */
export function resolveVideoEditorExtensionRuntimeWithDiagnostics(
  input?: VideoEditorExtensionInput,
): ResolveVideoEditorExtensionRuntimeResult {
  const effectiveConfigs = normalizeExtensionInput(input);

  if (effectiveConfigs.length === 0) {
    return { runtime: DEFAULT_VIDEO_EDITOR_EXTENSION_RUNTIME, diagnostics: [] };
  }

  const slots = mergeSlots(effectiveConfigs);

  const dialogResult = mergeDialogs(effectiveConfigs);
  const panelResult = mergePanels(effectiveConfigs);
  const inspectorResult = mergeInspectorSections(effectiveConfigs);
  const commandResult = mergeCommands(effectiveConfigs);

  const diagnostics = [
    ...dialogResult.diagnostics,
    ...panelResult.diagnostics,
    ...inspectorResult.diagnostics,
    ...commandResult.diagnostics,
  ];

  // Build package and settings maps keyed only by defined extension IDs.
  // Raw M1 configs without extensionId are omitted — no undefined map keys.
  const packages: Record<string, VideoEditorExtensionConfig> = {};
  const settings: Record<string, ExtensionSettings> = {};

  for (const config of effectiveConfigs) {
    if (config.extensionId !== undefined) {
      packages[config.extensionId] = config;
      if (config.settings !== undefined) {
        settings[config.extensionId] = config.settings;
      }
    }
  }

  return {
    runtime: {
      slots,
      dialogHost: {
        dialogs: dialogResult.descriptors,
      },
      registry: {
        panels: panelResult.descriptors,
        inspectorSections: inspectorResult.descriptors,
      },
      packages,
      settings,
      commands: commandResult.commands,
    },
    diagnostics,
  };
}

/**
 * Legacy compatibility wrapper.
 *
 * Calls the diagnostics-aware resolver and returns only the runtime
 * config. Duplicate descriptor diagnostics are silently discarded by
 * this wrapper — callers that need diagnostics should use
 * {@link resolveVideoEditorExtensionRuntimeWithDiagnostics} directly.
 */
export function resolveVideoEditorExtensionRuntime(
  input?: VideoEditorExtensionInput,
): VideoEditorExtensionRuntimeConfig {
  return resolveVideoEditorExtensionRuntimeWithDiagnostics(input).runtime;
}

type RegistryDescriptor = {
  id: string;
  order?: number;
  when?: VideoEditorVisibilityPredicate;
};

function sortRegistryDescriptors<T extends RegistryDescriptor>(descriptors: readonly T[]) {
  // Array.prototype.sort is stable in all supported engines (V8 TimSort).
  // Removing the ID-based tiebreaker preserves insertion order for equal `order` values.
  return [...descriptors].sort((left, right) => {
    const leftOrder = left.order ?? 0;
    const rightOrder = right.order ?? 0;
    return leftOrder - rightOrder;
  });
}

function resolveVisibleRegistryDescriptors<T extends RegistryDescriptor>(
  descriptors: readonly T[],
  context: VideoEditorRenderContext,
) {
  if (descriptors.length === 0) {
    return EMPTY_PANELS as unknown as readonly T[];
  }

  return sortRegistryDescriptors(
    descriptors.filter((descriptor) => !descriptor.when || descriptor.when(context)),
  );
}

export function resolveVideoEditorPanelRegistry(
  registry: VideoEditorExtensionRuntimeConfig['registry'],
  context: VideoEditorRenderContext,
): ResolvedVideoEditorPanelRegistry {
  const assetPanels = resolveVisibleRegistryDescriptors(registry.panels, context);
  const inspectorSections = resolveVisibleRegistryDescriptors(registry.inspectorSections, context);

  if (assetPanels.length === 0 && inspectorSections.length === 0) {
    return EMPTY_RESOLVED_PANEL_REGISTRY;
  }

  const beforeDefault = inspectorSections.filter((descriptor) => descriptor.placement === 'before-default');
  const afterDefault = inspectorSections.filter((descriptor) => descriptor.placement === 'after-default');

  return {
    assetPanels,
    inspectorSections: {
      all: inspectorSections,
      beforeDefault,
      afterDefault,
    },
  };
}
