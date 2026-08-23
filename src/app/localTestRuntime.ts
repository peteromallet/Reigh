import type { ExtensionDiagnostic } from '@reigh/editor-sdk';

export const LOCAL_TEST_QUERY_PARAM = 'localTest';

export interface LocalTestRuntimeSnapshot {
  readonly enabled: true;
  readonly diagnostics: Readonly<{
    loader: readonly ExtensionDiagnostic[];
    runtime: readonly ExtensionDiagnostic[];
  }>;
}

declare global {
  interface Window {
    __REIGH_LOCAL_TEST__?: LocalTestRuntimeSnapshot;
  }
}

interface LocalTestEnvironment {
  DEV?: boolean;
}

/** DEV-only, URL-explicit switch used by real-browser tests. */
export function isLocalTestMode(
  env: LocalTestEnvironment = import.meta.env,
  search = typeof window === 'undefined' ? '' : window.location.search,
): boolean {
  return Boolean(env.DEV)
    && new URLSearchParams(search).get(LOCAL_TEST_QUERY_PARAM) === '1';
}

function emptySnapshot(): LocalTestRuntimeSnapshot {
  return Object.freeze({
    enabled: true,
    diagnostics: Object.freeze({
      loader: Object.freeze([]),
      runtime: Object.freeze([]),
    }),
  });
}

/** Install the stable browser contract before React starts mounting. */
export function initializeLocalTestRuntime(): void {
  if (typeof window === 'undefined' || !isLocalTestMode()) return;
  window.__REIGH_LOCAL_TEST__ ??= emptySnapshot();
}

/** Publish deterministic, structured diagnostics for Playwright assertions. */
export function publishLocalTestExtensionDiagnostics(
  channel: 'loader' | 'runtime',
  diagnostics: readonly ExtensionDiagnostic[],
): void {
  if (typeof window === 'undefined' || !isLocalTestMode()) return;
  const current = window.__REIGH_LOCAL_TEST__ ?? emptySnapshot();
  const normalized = Object.freeze([...diagnostics].sort((left, right) => (
    `${left.extensionId ?? ''}\u0000${left.code}\u0000${left.message}`
      .localeCompare(`${right.extensionId ?? ''}\u0000${right.code}\u0000${right.message}`)
  )));
  window.__REIGH_LOCAL_TEST__ = Object.freeze({
    enabled: true,
    diagnostics: Object.freeze({
      ...current.diagnostics,
      [channel]: normalized,
    }),
  });
}

