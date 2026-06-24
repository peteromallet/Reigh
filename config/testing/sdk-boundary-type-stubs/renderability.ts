export const DETERMINISM_STATUSES = [] as const;
export const RENDER_BLOCKER_REASONS = [] as const;
export const RENDER_ROUTES = [] as const;

export function shaderMissingMaterializerBlockerMessage(
  shaderId: string,
  scope: ShaderMaterializerRequirementScope,
  clipId?: string,
): string {
  void shaderId;
  void scope;
  void clipId;
  return '';
}

export type ArtifactBoundary = unknown;
export type BakeContract = unknown;
export type CapabilityFinding = unknown;
export type CapabilityFindingSeverity = unknown;
export type ContributionRenderability = unknown;
export type DeterminismStatus = string;
export type RenderArtifact = unknown;
export type RenderBlocker = unknown;
export type RenderBlockerReason = string;
export type RenderCapability = unknown;
export type RenderCapabilityStatus = string;
export type RenderLocatorKind = string;
export type RenderMaterial = {
  readonly mediaKind?: string;
};
export type RenderMaterialMediaKind = string;
export type RenderMaterialRef = {
  readonly mediaKind?: string;
};
export type RenderRoute = string;
export type RenderStorageLocator = unknown;
export type ShaderMaterializerRequirementScope = string;
