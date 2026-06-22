import React from 'react';
import type {
  ExtensionPackage,
  ExtensionState,
  VideoEditorExtensionConfig,
} from '@/tools/video-editor/extension';

export const FAMILY_FIXTURE_IDS = {
  surface: 'com.example.family-surfaces',
  surfaceMismatch: 'com.example.family-surfaces-mismatch',
  commands: 'com.example.family-commands',
  duplicateCommands: 'com.example.family-duplicate-commands',
  settings: 'com.example.family-settings',
  runtimeDuplicate: 'com.example.family-runtime-duplicate',
} as const;

export const familySurfacePackage: ExtensionPackage = {
  manifest: {
    id: FAMILY_FIXTURE_IDS.surface,
    name: 'Family Surface Fixtures',
    version: '1.0.0',
    apiVersion: '1.0.0',
    description: 'Deterministic positive surface contribution fixture package.',
    permissions: ['read:timeline', 'read:assets'],
    contributions: {
      slots: [
        { slot: 'toolbar', id: 'family.surface.toolbar', order: 10 },
        { slot: 'statusBar', id: 'family.surface.status', order: 20 },
      ],
      dialogs: [
        { id: 'family.surface.dialog', layer: 'modal', order: 10 },
      ],
      panels: [
        { id: 'family.surface.asset-panel', placement: 'asset-panel', order: 10 },
      ],
      inspectorSections: [
        { id: 'family.surface.inspector', placement: 'before-default', order: 10 },
      ],
    },
  },
  config: {
    slots: {
      toolbar: () => (
        <div
          data-testid="family-surface-toolbar"
          data-contribution-family="surfaces"
          data-contribution-id="family.surface.toolbar"
          data-extension-id={FAMILY_FIXTURE_IDS.surface}
        >
          Family Toolbar
        </div>
      ),
      statusBar: () => (
        <div
          data-testid="family-surface-status"
          data-contribution-family="surfaces"
          data-contribution-id="family.surface.status"
          data-extension-id={FAMILY_FIXTURE_IDS.surface}
        >
          Family Status
        </div>
      ),
    },
    dialogHost: {
      dialogs: [
        {
          id: 'family.surface.dialog',
          layer: 'modal' as const,
          render: () => (
            <div
              data-testid="family-surface-dialog"
              data-contribution-family="surfaces"
              data-contribution-id="family.surface.dialog"
              data-extension-id={FAMILY_FIXTURE_IDS.surface}
            >
              Family Dialog
            </div>
          ),
        },
      ],
    },
    registry: {
      panels: [
        {
          id: 'family.surface.asset-panel',
          placement: 'asset-panel' as const,
          order: 10,
          render: () => (
            <div
              data-testid="family-surface-asset-panel"
              data-contribution-family="surfaces"
              data-contribution-id="family.surface.asset-panel"
              data-extension-id={FAMILY_FIXTURE_IDS.surface}
            >
              Family Asset Panel
            </div>
          ),
        },
      ],
      inspectorSections: [
        {
          id: 'family.surface.inspector',
          placement: 'before-default' as const,
          order: 10,
          render: () => (
            <div
              data-testid="family-surface-inspector"
              data-contribution-family="surfaces"
              data-contribution-id="family.surface.inspector"
              data-extension-id={FAMILY_FIXTURE_IDS.surface}
            >
              Family Inspector
            </div>
          ),
        },
      ],
    },
  },
};

export const familySurfaceMismatchPackage: ExtensionPackage = {
  manifest: {
    id: FAMILY_FIXTURE_IDS.surfaceMismatch,
    name: 'Family Surface Mismatch Fixture',
    version: '1.0.0',
    apiVersion: '1.0.0',
    description: 'Negative surface fixture that produces loader contribution mismatch diagnostics.',
    permissions: ['read:timeline'],
    contributions: {
      slots: [
        { slot: 'toolbar', id: 'family.surface-mismatch.toolbar', order: 10 },
      ],
      dialogs: [
        { id: 'family.surface-mismatch.dialog', layer: 'overlay', order: 10 },
      ],
    },
  },
  config: {
    slots: {
      statusBar: () => (
        <div
          data-testid="family-surface-mismatch-status"
          data-contribution-family="surfaces"
          data-contribution-id="family.surface-mismatch.status"
          data-extension-id={FAMILY_FIXTURE_IDS.surfaceMismatch}
        >
          Mismatched Status
        </div>
      ),
    },
    dialogHost: {
      dialogs: [
        {
          id: 'family.surface-mismatch.orphan-dialog',
          layer: 'overlay' as const,
          render: () => (
            <div
              data-testid="family-surface-mismatch-dialog"
              data-contribution-family="surfaces"
              data-contribution-id="family.surface-mismatch.orphan-dialog"
              data-extension-id={FAMILY_FIXTURE_IDS.surfaceMismatch}
            >
              Mismatched Dialog
            </div>
          ),
        },
      ],
    },
  },
};

export const familyCommandsPackage: ExtensionPackage = {
  manifest: {
    id: FAMILY_FIXTURE_IDS.commands,
    name: 'Family Command Fixtures',
    version: '1.0.0',
    apiVersion: '1.0.0',
    description: 'Deterministic positive command contribution fixture package.',
    permissions: ['read:timeline', 'write:timeline'],
    contributions: {
      commands: [
        {
          id: 'inspect-selection',
          title: 'Inspect Family Selection',
          description: 'Open a deterministic inspection command for E2E command selectors.',
          proposal: false,
          keybinding: { key: 'Ctrl+Alt+I', mac: 'Cmd+Alt+I' },
        },
        {
          id: 'normalize-selection',
          title: 'Normalize Family Selection',
          description: 'Queue a deterministic proposal command from the clip context menu.',
          proposal: true,
          menu: { context: 'clip-context', group: 'family', order: 10 },
        },
      ],
    },
  },
  config: {},
};

export const familyDuplicateCommandsPackage: ExtensionPackage = {
  manifest: {
    id: FAMILY_FIXTURE_IDS.duplicateCommands,
    name: 'Family Duplicate Command Fixture',
    version: '1.0.0',
    apiVersion: '1.0.0',
    description: 'Negative command fixture that produces duplicate_command_id diagnostics.',
    permissions: ['read:timeline', 'write:timeline'],
    contributions: {
      commands: [
        { id: 'duplicate-action', title: 'Duplicate Family Action A', proposal: false },
        { id: 'duplicate-action', title: 'Duplicate Family Action B', proposal: true },
      ],
    },
  },
  config: {},
};

export const familySettingsPackage: ExtensionPackage = {
  manifest: {
    id: FAMILY_FIXTURE_IDS.settings,
    name: 'Family Settings Fixture',
    version: '1.0.0',
    apiVersion: '1.0.0',
    description: 'Deterministic settingsSchema fixture package.',
    permissions: ['read:timeline', 'storage:local'],
    settingsSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        theme: { type: 'string', enum: ['light', 'dark'], default: 'dark' },
        showRulers: { type: 'boolean', default: true },
      },
    },
  },
  config: {},
};

export const familySettingsValidState: ExtensionState = {
  enabled: true,
  settingsOverrides: {
    theme: 'light',
    showRulers: false,
  },
};

export const familySettingsInvalidOverrideState: ExtensionState = {
  enabled: true,
  settingsOverrides: {
    theme: 'sepia',
    showRulers: 'yes',
  },
};

export const familyRuntimeDuplicatePanelA: VideoEditorExtensionConfig = {
  extensionId: FAMILY_FIXTURE_IDS.runtimeDuplicate,
  registry: {
    panels: [
      {
        id: 'family.runtime.duplicate-panel',
        placement: 'asset-panel' as const,
        render: () => (
          <div
            data-testid="family-runtime-duplicate-panel-a"
            data-contribution-family="surfaces"
            data-contribution-id="family.runtime.duplicate-panel"
            data-extension-id={FAMILY_FIXTURE_IDS.runtimeDuplicate}
          >
            Runtime Panel A
          </div>
        ),
      },
    ],
  },
};

export const familyRuntimeDuplicatePanelB: VideoEditorExtensionConfig = {
  extensionId: FAMILY_FIXTURE_IDS.runtimeDuplicate,
  registry: {
    panels: [
      {
        id: 'family.runtime.duplicate-panel',
        placement: 'asset-panel' as const,
        render: () => (
          <div
            data-testid="family-runtime-duplicate-panel-b"
            data-contribution-family="surfaces"
            data-contribution-id="family.runtime.duplicate-panel"
            data-extension-id={FAMILY_FIXTURE_IDS.runtimeDuplicate}
          >
            Runtime Panel B
          </div>
        ),
      },
    ],
  },
};

export const familyPositivePackages = [
  familySurfacePackage,
  familyCommandsPackage,
  familySettingsPackage,
] as const;

export const familyLoaderDiagnosticPackages = [
  familySurfaceMismatchPackage,
  familyDuplicateCommandsPackage,
] as const;

export const familyRuntimeDiagnosticConfigs = [
  familyRuntimeDuplicatePanelA,
  familyRuntimeDuplicatePanelB,
] as const;
