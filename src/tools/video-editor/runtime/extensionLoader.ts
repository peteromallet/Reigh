/**
 * @publicContract
 * Extension loader that validates packages, manages state, resolves settings,
 * and produces enabled {@link VideoEditorExtensionConfig} arrays for the runtime.
 *
 * The loader composes validation ({@link validateExtensionPackage}),
 * repository state ({@link ExtensionStateRepository}), settings resolution
 * ({@link resolveExtensionSettings}), duplicate-ID handling, and runtime
 * adaptation.  Invalid or disabled packages are excluded from the enabled
 * config set but remain inspectable via {@link ExtensionLoadResult.installedPackages}.
 */

import type {
  ExtensionPackage,
  ExtensionManifest,
  ExtensionState,
  ExtensionDiagnostic,
  ExtensionDiagnosticCode,
} from './extensionManifest.ts';
import { validateExtensionPackage } from './extensionManifest.ts';
import type { ExtensionStateRepository } from './extensionStateRepository.ts';
import { resolveExtensionSettings } from './extensionSettings.ts';
import type { VideoEditorExtensionConfig } from './extensionSurface.ts';

// ---------------------------------------------------------------------------
// Load result types
// ---------------------------------------------------------------------------

/**
 * Per-package state after loading.
 *
 * Consumers can inspect this to show installation status, enable/disable
 * controls, and validation results without parsing diagnostics.
 */
export interface InstalledPackageState {
  /** The validated manifest. */
  manifest: ExtensionManifest;
  /** Repository state (enabled flag + settings overrides). */
  state: ExtensionState;
  /** Diagnostics produced during validation and settings resolution. */
  diagnostics: ExtensionDiagnostic[];
  /** Whether this package was successfully loaded (valid, enabled, not a duplicate). */
  loaded: boolean;
}

/**
 * Result returned by {@link ExtensionLoader.load}.
 */
export interface ExtensionLoadResult {
  /** All diagnostics produced during load (validation, state, settings, duplicates). */
  diagnostics: ExtensionDiagnostic[];
  /**
   * Enabled extension configs ready to pass to
   * {@link resolveVideoEditorExtensionRuntime}.
   *
   * Only configs from valid, enabled, non-duplicate packages are included.
   * Each config carries `extensionId` and resolved `settings`.
   */
  configs: VideoEditorExtensionConfig[];
  /**
   * Per-package state for every package presented to the loader.
   *
   * Includes both loaded and rejected packages so consumers can render
   * installation management UIs.
   */
  installedPackages: InstalledPackageState[];
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Loads, validates, and adapts extension packages into runtime configs.
 *
 * ## Loading algorithm
 *
 * 1. Call {@link ExtensionStateRepository.load} to hydrate persisted state.
 * 2. For each package (in definition order):
 *    a. Run {@link validateExtensionPackage} — invalid packages are excluded
 *       from configs but recorded in `installedPackages` with diagnostics.
 *    b. Check for duplicate `manifest.id` across already-loaded packages.
 *       The **first** package for a given ID wins; later packages with the
 *       same ID receive a `duplicate_package_id` diagnostic and are excluded.
 *       Duplicate-ID handling is fail-closed and runs before state/settings
 *       resolution to prevent colliding keys.
 *    c. Check repository state: if the extension is disabled
 *       (`state.enabled === false`), skip it **without** emitting a
 *       diagnostic and exclude it from enabled configs.
 *    d. Resolve settings via {@link resolveExtensionSettings} using the
 *       manifest's `settingsSchema` and the persisted `settingsOverrides`.
 *    e. Adapt the package into a {@link VideoEditorExtensionConfig} carrying
 *       `extensionId` and resolved `settings`.
 * 3. Return the aggregated {@link ExtensionLoadResult}.
 */
export class ExtensionLoader {
  private _packages: readonly ExtensionPackage[];
  private _repository: ExtensionStateRepository;

  constructor(
    packages: readonly ExtensionPackage[],
    repository: ExtensionStateRepository,
  ) {
    this._packages = packages;
    this._repository = repository;
  }

  /**
   * Execute the full load pipeline and return the aggregated result.
   *
   * This method is idempotent with respect to the repository — it calls
   * `repository.load()` on every invocation so callers can re-load after
   * mutating state externally.
   */
  load(): ExtensionLoadResult {
    const diagnostics: ExtensionDiagnostic[] = [];
    const configs: VideoEditorExtensionConfig[] = [];
    const installedPackages: InstalledPackageState[] = [];

    // 1. Hydrate persisted state.
    const repoDiagnostics = this._repository.load();
    diagnostics.push(...repoDiagnostics);

    // Track seen manifest IDs for duplicate detection.
    const seenIds = new Set<string>();

    // 2. Process each package in definition order.
    for (const pkg of this._packages) {
      const manifest = pkg.manifest;
      const pkgDiagnostics: ExtensionDiagnostic[] = [];
      let loaded = false;

      // (a) Validate the package.
      const validationDiags = validateExtensionPackage(pkg);
      pkgDiagnostics.push(...validationDiags);

      if (validationDiags.length === 0) {
        // (b) Duplicate manifest.id check (fail-closed — before state/settings).
        if (seenIds.has(manifest.id)) {
          const dupDiag: ExtensionDiagnostic = {
            kind: 'error',
            code: 'duplicate_package_id' as ExtensionDiagnosticCode,
            message: `Duplicate extension package ID "${manifest.id}". The first package with this ID has already been loaded; this package is rejected.`,
            extensionId: manifest.id,
            detail: { duplicateId: manifest.id },
          };
          pkgDiagnostics.push(dupDiag);
        } else {
          // (c) Check repository state for disabled packages.
          const state = this._repository.getState(manifest.id);

          if (state.enabled === false) {
            // Disabled — skip without diagnostic.  Record in installed packages
            // so consumers can still show management UI.
            installedPackages.push({
              manifest,
              state,
              diagnostics: [],
              loaded: false,
            });
            continue;
          }

          // (d) Resolve settings.
          const resolved = resolveExtensionSettings(manifest, state);
          if (resolved.diagnostics.length > 0) {
            pkgDiagnostics.push(...resolved.diagnostics);
            diagnostics.push(...resolved.diagnostics);
          }

          // (e) Adapt into VideoEditorExtensionConfig.
          const adaptedConfig: VideoEditorExtensionConfig = {
            ...pkg.config,
            extensionId: manifest.id,
            settings: resolved.settings,
          } as VideoEditorExtensionConfig;

          configs.push(adaptedConfig);
          seenIds.add(manifest.id);
          loaded = true;

          installedPackages.push({
            manifest,
            state,
            diagnostics: resolved.diagnostics,
            loaded: true,
          });

          continue;
        }
      }

      // Package failed validation or was a duplicate — still record in
      // installed packages but exclude from enabled configs.
      const state = this._repository.getState(manifest.id);
      installedPackages.push({
        manifest,
        state,
        diagnostics: pkgDiagnostics,
        loaded,
      });

      diagnostics.push(...pkgDiagnostics);
    }

    return { diagnostics, configs, installedPackages };
  }
}
