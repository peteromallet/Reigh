/**
 * Entry-import smoke test.
 *
 * Context (timeline dev-surface review §6.3): the browser bundle crashed at
 * import time this week because `ProcessManager.ts` statically imported
 * `node:child_process` and `jsonRpcStdioTransport.ts` imported `TextDecoder`
 * from `node:util`. Both modules are reachable from this app's real entry
 * point: `bootstrap.tsx` -> `App.tsx` -> `routes.tsx` -> `VideoEditorPage`
 * (imported eagerly, see the "Main tools: eagerly loaded" comment in
 * routes.tsx) -> `VideoEditorProvider` -> `createProcessManager`.
 *
 * This test `await import()`s the real entry composition root,
 * `@/app/bootstrap` (which statically imports the real `@/app/App`, with
 * nothing in the video-editor import chain mocked away), and asserts the
 * import resolves without throwing. It does not call `renderApp()` — a
 * module-evaluation-time throw would surface on the bare `import()` itself,
 * so no #root element or DOM render is needed.
 *
 * Scope / known gap: Vitest resolves `node:*` specifiers through Node.js
 * itself, so — unlike an actual Vite browser build, which externalizes Node
 * builtins into stubs that throw — a reintroduced static `import ... from
 * 'node:child_process'` would resolve fine here and NOT fail this test (verified
 * empirically while authoring it). This test's job is the broader net: catch
 * *any* module reachable from the entry root that throws when evaluated
 * under a DOM-shaped runtime (e.g. a top-level access on a browser API jsdom
 * doesn't provide, an eagerly-imported module whose evaluation assumes
 * something not true in this environment). The Node-builtin-import class
 * specifically is guarded by the `no-restricted-imports` ESLint rule in
 * `eslint.config.js` (see the "Node builtin boundary" block) — that rule is
 * the one proven, in the PR, to reject a reintroduced `node:child_process`
 * import.
 *
 * No mocks are used: `src/test/setup.ts` already stubs the browser APIs
 * (matchMedia, IntersectionObserver, ResizeObserver) that jsdom lacks and
 * that components in this graph rely on, and the pattern of importing
 * `@/app/App` / `@/app/routes` unmocked under jsdom is already proven safe by
 * `src/moduleImportCoverage.test.ts`.
 */
import { describe, expect, it } from 'vitest';

describe('entry composition root import smoke', () => {
  it('imports bootstrap -> App -> routes -> VideoEditorPage without throwing at module-load time', async () => {
    const bootstrapModule = await import('@/app/bootstrap');

    expect(bootstrapModule).toBeTruthy();
    expect(typeof bootstrapModule.renderApp).toBe('function');
  }, 60_000);
});
