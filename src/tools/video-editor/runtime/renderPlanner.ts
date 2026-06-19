import {
  collectBuiltInKnownIds,
  collectExtensionDeclaredIds,
  scanExportConfig,
  type ExportGuardResult,
  type InactiveKnownIds,
  type KnownIdCollection,
} from '@/tools/video-editor/runtime/exportGuard.ts';
import type { EffectRegistrySnapshot } from '@/tools/video-editor/effects/registry/types.ts';
import type { ExtensionRuntime } from '@/tools/video-editor/runtime/extensionSurface.ts';
import type { ResolvedTimelineConfig } from '@/tools/video-editor/types/index.ts';
import type {
  CapabilityFinding,
  RenderBlocker,
  RenderRoute,
} from '@/tools/video-editor/runtime/renderability.ts';
import type { ExtensionContribution } from '@reigh/editor-sdk';

export interface RenderPlannerInput {
  readonly config: ResolvedTimelineConfig | null;
  readonly effectRegistrySnapshot?: EffectRegistrySnapshot;
  readonly extensionRuntime?: ExtensionRuntime;
  readonly builtInKnownIds?: KnownIdCollection;
  readonly inactiveKnownIds?: InactiveKnownIds;
}

export interface RenderRouteSummary {
  readonly route: RenderRoute;
  readonly blockerCount: number;
  readonly findingCount: number;
  readonly blocked: boolean;
}

export interface RenderPlannerResult {
  readonly guard: ExportGuardResult;
  readonly findings: readonly CapabilityFinding[];
  readonly blockers: readonly RenderBlocker[];
  readonly routes: readonly RenderRouteSummary[];
  readonly canBrowserExport: boolean;
}

function extensionContributions(extensionRuntime: ExtensionRuntime | undefined): ExtensionContribution[] {
  if (!extensionRuntime) return [];
  return extensionRuntime.extensions.flatMap((extension) => extension.manifest.contributions ?? []);
}

export function planRender(input: RenderPlannerInput): RenderPlannerResult {
  const builtIn = input.builtInKnownIds ?? collectBuiltInKnownIds();
  const inactiveIds = input.inactiveKnownIds
    ?? collectExtensionDeclaredIds(extensionContributions(input.extensionRuntime));
  const guard = scanExportConfig(
    input.config,
    builtIn,
    inactiveIds,
    input.effectRegistrySnapshot,
  );
  const findings = Object.freeze([...guard.findings]);
  const blockers = Object.freeze([...guard.blockers]);
  const browserBlockers = blockers.filter((blocker) => blocker.route === 'browser-export');
  const browserFindings = findings.filter((finding) => !finding.route || finding.route === 'browser-export');

  const routes: readonly RenderRouteSummary[] = Object.freeze([
    Object.freeze({
      route: 'browser-export',
      blockerCount: browserBlockers.length,
      findingCount: browserFindings.length,
      blocked: browserBlockers.length > 0,
    }),
  ]);

  return Object.freeze({
    guard,
    findings,
    blockers,
    routes,
    canBrowserExport: browserBlockers.length === 0,
  });
}
