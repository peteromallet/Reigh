/**
 * @publicContract
 * Public support matrix for video editor extension contribution families.
 *
 * This is declarative only. A family marked `supported` has a public runtime
 * contract today; `loader-runtime-only` is reserved for diagnostics produced
 * by the loader/runtime rather than extension-authored reports.
 */

export type ExtensionContributionFamilyStatus =
  | 'supported'
  | 'loader-runtime-only'
  | 'trusted-only'
  | 'deferred';

export type ExtensionContributionFamilyId =
  | 'surfaces'
  | 'commands'
  | 'settings'
  | 'diagnostics'
  | 'effects'
  | 'transitions'
  | 'clip-types'
  | 'agent-tools'
  | 'data-live-providers'
  | 'render-materials-capabilities'
  | 'keyframes';

export interface ExtensionContributionFamily {
  readonly id: ExtensionContributionFamilyId;
  readonly label: string;
  readonly status: ExtensionContributionFamilyStatus;
  readonly publicContract: string;
  readonly manifestContract?: string;
  readonly notes: string;
}

export const EXTENSION_CONTRIBUTION_FAMILIES: readonly ExtensionContributionFamily[] = Object.freeze([
  Object.freeze({
    id: 'surfaces',
    label: 'Surfaces',
    status: 'supported',
    publicContract: 'slots, dialogs, panels, and inspector sections',
    manifestContract: 'contributions.slots/dialogs/panels/inspectorSections',
    notes: 'Public surface descriptors are loader-validated and registered into the extension runtime.',
  }),
  Object.freeze({
    id: 'commands',
    label: 'Commands',
    status: 'supported',
    publicContract: 'extension command descriptors',
    manifestContract: 'contributions.commands',
    notes: 'Public command declarations are namespaced by extension ID and resolved into the editor command registry.',
  }),
  Object.freeze({
    id: 'settings',
    label: 'Settings',
    status: 'supported',
    publicContract: 'top-level extension settings schema and resolved settings',
    manifestContract: 'settingsSchema',
    notes: 'Settings are exposed through the existing top-level settingsSchema contract; there is no contributions.settings wrapper.',
  }),
  Object.freeze({
    id: 'diagnostics',
    label: 'Diagnostics',
    status: 'loader-runtime-only',
    publicContract: 'loader and runtime diagnostics stream',
    notes: 'Loader/runtime diagnostics are supported. Extension-authored diagnostic reporting is deferred until a scoped public reporter API and lifecycle tests exist.',
  }),
  Object.freeze({
    id: 'effects',
    label: 'Effects',
    status: 'trusted-only',
    publicContract: 'internal trusted effect registry',
    notes: 'Effects remain internal/trusted in M5; third-party effect contributions are not a public extension family.',
  }),
  Object.freeze({
    id: 'transitions',
    label: 'Transitions',
    status: 'trusted-only',
    publicContract: 'internal trusted transition map',
    notes: 'Transitions remain static/trusted in M5; third-party transition contributions are deferred.',
  }),
  Object.freeze({
    id: 'clip-types',
    label: 'Clip Types',
    status: 'trusted-only',
    publicContract: 'trusted clip type and sequence metadata registry',
    notes: 'Clip types depend on trusted component availability and are not arbitrary third-party extension contributions in M5.',
  }),
  Object.freeze({
    id: 'agent-tools',
    label: 'Agent Tools',
    status: 'deferred',
    publicContract: 'not public in M5',
    notes: 'Agent tool contributions need proposal/review, lifecycle, and runtime safety design before becoming public.',
  }),
  Object.freeze({
    id: 'data-live-providers',
    label: 'Data/Live Providers',
    status: 'deferred',
    publicContract: 'not public in M5',
    notes: 'Data and live provider contributions need ownership, lifecycle, and safety contracts before becoming public.',
  }),
  Object.freeze({
    id: 'render-materials-capabilities',
    label: 'Render Materials/Capabilities',
    status: 'deferred',
    publicContract: 'not public in M5',
    notes: 'Render material and capability contributions are deferred; no shader, WebGL, or render sidecar public API ships in M5.',
  }),
  Object.freeze({
    id: 'keyframes',
    label: 'Keyframes',
    status: 'deferred',
    publicContract: 'not public in M5',
    notes: 'Keyframes require authoring, serialization, render interpolation, and tests before becoming a public contribution family.',
  }),
] satisfies readonly ExtensionContributionFamily[]);

export const EXTENSION_CONTRIBUTION_FAMILY_BY_ID: Readonly<
  Record<ExtensionContributionFamilyId, ExtensionContributionFamily>
> = Object.freeze(
  Object.fromEntries(
    EXTENSION_CONTRIBUTION_FAMILIES.map((family) => [family.id, family]),
  ) as Record<ExtensionContributionFamilyId, ExtensionContributionFamily>,
);
