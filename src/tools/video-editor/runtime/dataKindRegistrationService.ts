/**
 * Shared host-owned service factory for trusted component data-kind
 * registration (dataKind V1, single bind model — clipType analog).
 *
 * One instance per extension, created by the host during context assembly.
 * `register()` gates on the extension's *declared* `DataKindContribution`s
 * by `kindId`; undeclared kindIds emit `dataKinds/undeclared-kind` and
 * return a no-op handle. Declared kindIds copy the contribution fields onto
 * a `DataKindRegistryRecord` (the renderer lives on the record) and store it
 * in the shared {@link DataKindRegistry}.
 */

import type {
  DataCoordinateDomain,
  DataItemInspectorProps,
  DataKindContribution,
  DataKindRegistrationOptions,
  DataKindRegistrationService,
  DataLaneRendererProps,
  DataShape,
  DisposeHandle,
  ExtensionDiagnostic,
  ExtensionDiagnosticsService,
  ReighExtension,
} from '@reigh/editor-sdk';
import { KNOWN_DATA_SHAPES, KNOWN_DATA_DOMAINS } from '@/sdk/video/families/dataKind';
import type { DataKindRegistry } from '@/tools/video-editor/data-kinds/DataKindRegistry.ts';
import type {
  DataKindProvenance,
  DataKindRegistryRecord,
} from '@/tools/video-editor/data-kinds/DataKindRegistry.ts';
import type {
  ContributionRenderability,
  RenderCapability,
  DeterminismStatus,
} from '@/tools/video-editor/runtime/renderability.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a {@link ContributionRenderability} from a `DataKindContribution`.
 *
 * V1 data kinds are preview-only: no export routes exist for lanes, so
 * browser-export and worker-export are always blocked (no `allowExport`
 * fields on the contribution — export roles wait for V3).
 */
function buildDataKindRenderability(): ContributionRenderability {
  const capabilities: RenderCapability[] = [
    {
      route: 'preview',
      status: 'supported',
      determinism: 'preview-only',
    },
    {
      route: 'browser-export',
      status: 'blocked',
      determinism: 'preview-only',
      blockerReason: 'route-unsupported',
      message: 'Browser export is not supported for data kinds in V1.',
    },
    {
      route: 'worker-export',
      status: 'blocked',
      determinism: 'preview-only',
      blockerReason: 'route-unsupported',
      message: 'Worker export is not supported for data kinds in V1.',
    },
  ];

  const determinism: DeterminismStatus = 'preview-only';

  return {
    capabilities: Object.freeze(capabilities.map((c) => Object.freeze(c))),
    defaultRoute: 'preview',
    determinism,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateDataKindRegistrationServiceParams {
  /** The activating extension (manifest supplies the declared contributions). */
  readonly extension: ReighExtension;
  /** Shared provider-scoped data-kind registry. */
  readonly dataKindRegistry: DataKindRegistry;
  /** Per-extension diagnostics service for gate/validation diagnostics. */
  readonly diagnosticsService: ExtensionDiagnosticsService;
}

/**
 * Create a {@link DataKindRegistrationService} for a single extension.
 *
 * The returned service is typically passed as the `dataKinds` argument to
 * {@link createExtensionContext} so extensions can imperatively bind lane
 * renderers during `activate()` via `ctx.dataKinds.register(kindId, ...)`.
 */
export function createDataKindRegistrationService(
  params: CreateDataKindRegistrationServiceParams,
): DataKindRegistrationService {
  const { extension, dataKindRegistry, diagnosticsService } = params;
  const extensionId = extension.manifest.id as string;

  // Index declared dataKind contributions by kindId for O(1) gate lookup.
  const contributionsByKindId = new Map<string, DataKindContribution>();
  for (const contrib of extension.manifest.contributions ?? []) {
    // Manifest-side contribution types widen kindId to `string | undefined`;
    // validateManifest already rejects blank dataKind kindIds, so this guard
    // only satisfies the narrowed registry key.
    if (contrib.kind === 'dataKind' && typeof contrib.kindId === 'string' && contrib.kindId.length > 0) {
      contributionsByKindId.set(contrib.kindId, contrib as DataKindContribution);
    }
  }

  /** Emit a structured diagnostic into the extension's diagnostics service. */
  function emit(
    severity: ExtensionDiagnostic['severity'],
    code: string,
    message: string,
    detail?: Record<string, unknown>,
  ): void {
    diagnosticsService.report({ severity, code, message, detail });
  }

  function register(
    kindId: string,
    laneRenderer: (props: DataLaneRendererProps) => unknown,
    inspector?: (props: DataItemInspectorProps) => unknown,
    options?: DataKindRegistrationOptions,
  ): DisposeHandle {
    // ---- Gate on the declared contribution ---------------------------------
    const contrib = contributionsByKindId.get(kindId);
    if (!contrib) {
      emit(
        'error',
        'dataKinds/undeclared-kind',
        `Data kind "${kindId}" is not declared as a DataKindContribution in extension "${extensionId}". ` +
          `Declared data kind IDs: [${[...contributionsByKindId.keys()].join(', ') || '(none)'}].`,
        { kindId, extensionId },
      );
      return { dispose() {} };
    }

    // ---- Host-validate open-string shape/domain ([CONVERGE-WITH-M1]) -------
    // Manifest validation rejects unknown values; this re-check also catches
    // absent fields, which the public schema permits but the registry record
    // requires (closed vocabularies feed lane painting).
    const declaredShape = KNOWN_DATA_SHAPES.includes(contrib.shape as DataShape)
      ? (contrib.shape as DataShape)
      : undefined;
    const declaredDomain = KNOWN_DATA_DOMAINS.includes(contrib.domain as DataCoordinateDomain)
      ? (contrib.domain as DataCoordinateDomain)
      : undefined;

    if (!declaredShape) {
      emit(
        'error',
        'dataKinds/invalid-shape',
        `Data kind "${kindId}" must declare a known shape; got ${JSON.stringify(contrib.shape ?? null)}. ` +
          `Known shapes: ${KNOWN_DATA_SHAPES.join(', ')}.`,
        { kindId, extensionId, shape: contrib.shape ?? null },
      );
    }
    if (!declaredDomain) {
      emit(
        'error',
        'dataKinds/invalid-domain',
        `Data kind "${kindId}" must declare a known coordinate domain; got ${JSON.stringify(contrib.domain ?? null)}. ` +
          `Known domains: ${KNOWN_DATA_DOMAINS.join(', ')}.`,
        { kindId, extensionId, domain: contrib.domain ?? null },
      );
    }
    if (!declaredShape || !declaredDomain) {
      return { dispose() {} };
    }

    // ---- Build the DataKindRegistryRecord ----------------------------------
    const label = options?.label ?? contrib.label ?? kindId;
    const order = options?.order ?? contrib.order;
    const provenance: DataKindProvenance = 'bundled-extension';
    const record: DataKindRegistryRecord = {
      kindId,
      contributionId: contrib.id,
      schemaRef: contrib.schemaRef,
      shape: declaredShape,
      domain: declaredDomain,
      laneRenderer,
      ...(inspector ? { inspector } : {}),
      ownerExtensionId: extensionId,
      provenance,
      renderability: buildDataKindRenderability(),
      status: 'active',
      ...(label !== undefined ? { label } : {}),
      ...(order !== undefined ? { order } : {}),
    };

    // ---- Register with the provider-scoped DataKindRegistry ----------------
    // DataKindRegistry.register() handles replacement: if an existing record
    // with the same kindId exists, it is safely disposed first and a
    // `data-kind-registry/duplicate-kind` warning is emitted.
    const handle = dataKindRegistry.register(record);

    emit(
      'info',
      'dataKinds/registered',
      `Data kind "${kindId}" registered for extension "${extensionId}".`,
      { kindId, extensionId, contributionId: contrib.id, status: record.status },
    );

    // ---- Return a DisposeHandle that disposes exactly once ----------------
    let disposed = false;

    return {
      dispose(): void {
        if (disposed) return;
        disposed = true;

        try {
          handle.dispose();
        } catch (err) {
          emit(
            'error',
            'dataKinds/dispose-error',
            `Error disposing data kind "${kindId}": ${String(err)}`,
            { kindId, extensionId, contributionId: contrib.id },
          );
        }
      },
    };
  }

  return {
    register,
  };
}
