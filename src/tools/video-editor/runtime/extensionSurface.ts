import type { ReactNode } from 'react';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider.ts';
import type {
  TimelineChromeContextValue,
  TimelineEditorDataContextValue,
  TimelineEditorOpsContextValue,
  TimelinePlaybackContextValue,
} from '@/tools/video-editor/hooks/useTimelineState.types.ts';
import type { ExtensionSettings } from './extensionManifest.ts';

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

function checkDuplicateDescriptorIds<T extends { id: string }>(
  descriptors: readonly T[],
  collection: string,
): void {
  const seen = new Set<string>();

  for (const descriptor of descriptors) {
    if (seen.has(descriptor.id)) {
      throw new Error(
        `Duplicate extension descriptor ID "${descriptor.id}" in collection "${collection}". Each descriptor must have a unique ID.`,
      );
    }
    seen.add(descriptor.id);
  }
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
): readonly VideoEditorDialogDescriptor[] {
  const merged: VideoEditorDialogDescriptor[] = [];

  for (const config of effectiveConfigs) {
    if (config.dialogHost?.dialogs) {
      merged.push(...config.dialogHost.dialogs);
    }
  }

  if (merged.length === 0) {
    return EMPTY_DIALOGS;
  }

  checkDuplicateDescriptorIds(merged, 'dialogs');

  return merged;
}

function mergePanels(
  effectiveConfigs: readonly VideoEditorExtensionConfig[],
): readonly VideoEditorPanelDescriptor[] {
  const merged: VideoEditorPanelDescriptor[] = [];

  for (const config of effectiveConfigs) {
    if (config.registry?.panels) {
      merged.push(...config.registry.panels);
    }
  }

  if (merged.length === 0) {
    return EMPTY_PANELS;
  }

  checkDuplicateDescriptorIds(merged, 'panels');

  return merged;
}

function mergeInspectorSections(
  effectiveConfigs: readonly VideoEditorExtensionConfig[],
): readonly VideoEditorInspectorSectionDescriptor[] {
  const merged: VideoEditorInspectorSectionDescriptor[] = [];

  for (const config of effectiveConfigs) {
    if (config.registry?.inspectorSections) {
      merged.push(...config.registry.inspectorSections);
    }
  }

  if (merged.length === 0) {
    return EMPTY_INSPECTOR_SECTIONS;
  }

  checkDuplicateDescriptorIds(merged, 'inspectorSections');

  return merged;
}

export function resolveVideoEditorExtensionRuntime(
  input?: VideoEditorExtensionInput,
): VideoEditorExtensionRuntimeConfig {
  const effectiveConfigs = normalizeExtensionInput(input);

  if (effectiveConfigs.length === 0) {
    return DEFAULT_VIDEO_EDITOR_EXTENSION_RUNTIME;
  }

  const slots = mergeSlots(effectiveConfigs);
  const dialogs = mergeDialogs(effectiveConfigs);
  const panels = mergePanels(effectiveConfigs);
  const inspectorSections = mergeInspectorSections(effectiveConfigs);

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
    slots,
    dialogHost: {
      dialogs,
    },
    registry: {
      panels,
      inspectorSections,
    },
    packages,
    settings,
  };
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
