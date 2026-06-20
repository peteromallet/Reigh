/**
 * Injectable extension settings service factory (T8).
 *
 * Extracted from `createExtensionContext` so the settings service can be
 * created independently for testing, provider-backed storage integration,
 * and future settings snapshot persistence through ExtensionStateRepository.
 *
 * The factory preserves the existing synchronous ExtensionSettingsService
 * contract (get/set/delete/keys) and manifest-defaults fallback behavior.
 * The returned dispose function cleans up localStorage keys written by
 * this service instance.
 */

import type { ExtensionSettingsService } from '@/sdk/index';
import type { ExtensionManifest } from '@/sdk/index';

// ---------------------------------------------------------------------------
// Settings prefix
// ---------------------------------------------------------------------------

/** Build the localStorage key prefix for an extension's settings. */
export function getSettingsPrefix(extensionId: string): string {
  return `reigh.ext.${extensionId}.`;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Result of creating an extension settings service.
 *
 * - `service` — the synchronous settings service for the extension author.
 * - `dispose` — cleans up localStorage keys written by this service.
 *   Safe to call multiple times; idempotent.
 */
export interface ExtensionSettingsServiceFactoryResult {
  readonly service: ExtensionSettingsService;
  dispose(): void;
}

/**
 * Create an injectable settings service for an extension.
 *
 * The returned service is synchronous and localStorage-backed, with
 * manifest `settingsDefaults` as fallback values.
 *
 * @param extensionId  The extension's unique identifier.
 * @param manifest     The extension manifest (for settingsDefaults).
 * @returns A disposable settings service.
 */
export function createExtensionSettingsService(
  extensionId: string,
  manifest: ExtensionManifest,
): ExtensionSettingsServiceFactoryResult {
  const settingsPrefix = getSettingsPrefix(extensionId);
  const settingsDefaults: Record<string, unknown> =
    (manifest.settingsDefaults as Record<string, unknown> | undefined) ?? {};

  /** Track keys set via this service so they can be cleaned up on dispose. */
  const writtenKeys = new Set<string>();

  const service: ExtensionSettingsService = {
    get<T = unknown>(key: string): T | undefined {
      try {
        const raw = localStorage.getItem(settingsPrefix + key);
        if (raw !== null) return JSON.parse(raw) as T;
        // Fall back to manifest defaults
        if (key in settingsDefaults) return settingsDefaults[key] as T;
        return undefined;
      } catch {
        // Fall back to manifest defaults on parse error
        if (key in settingsDefaults) return settingsDefaults[key] as T;
        return undefined;
      }
    },
    set<T = unknown>(key: string, value: T): void {
      try {
        localStorage.setItem(settingsPrefix + key, JSON.stringify(value));
        writtenKeys.add(key);
      } catch {
        // localStorage quota exceeded or unavailable — silently no-op
      }
    },
    delete(key: string): void {
      try {
        localStorage.removeItem(settingsPrefix + key);
        writtenKeys.delete(key);
      } catch {
        // localStorage unavailable — silently no-op
      }
    },
    keys(): readonly string[] {
      try {
        const result: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const lsKey = localStorage.key(i);
          if (lsKey && lsKey.startsWith(settingsPrefix)) {
            result.push(lsKey.slice(settingsPrefix.length));
          }
        }
        // Also include manifest default keys not yet written
        for (const dk of Object.keys(settingsDefaults)) {
          if (!result.includes(dk)) result.push(dk);
        }
        return result;
      } catch {
        return Object.keys(settingsDefaults);
      }
    },
  };

  function dispose(): void {
    try {
      writtenKeys.forEach((key) => {
        localStorage.removeItem(settingsPrefix + key);
      });
      writtenKeys.clear();
    } catch {
      // localStorage unavailable — silently no-op
    }
  }

  return { service, dispose };
}
