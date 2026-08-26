# B8-2 — Static gates green (T1 + T2) evidence

Date: 2026-08-26 · Executor: stealth/ox-alpha · Repo HEAD at run: `7754f090c127b356bf242ddda4986393d93d0945` (branch `codex/phase-c-megado`, clean tree)

Toolchain: pinned Node v20.19.4 / npm 10.8.2 (`/workspace/pinned-runtimes/node-v20.19.4-linux-x64`), Python 3.11.11.

## T1 — Grep gates (verbatim)

```
$ node scripts/c5-grep-gates.mjs && ./scripts/c5-grep-gates.sh
[c5-grep-gates] 151 inventory roots; 1804 statically reachable files; 5 removed roots
[c5-grep-gates] removed: src/app/hooks/useAuthGuard.test.ts
[c5-grep-gates] removed: src/app/hooks/useAuthGuard.ts
[c5-grep-gates] removed: src/shared/hooks/projects/__tests__/useProjectGenerations.test.ts
[c5-grep-gates] removed: src/shared/hooks/tasks/__tests__/useTaskCancellation.test.ts
[c5-grep-gates] removed: src/shared/hooks/tasks/__tests__/useTaskType.test.ts
[c5-grep-gates] PASS: no Supabase SDK/runtime calls in the transitive bridge-mode graph
```
(both invocations printed identical PASS output)

## T2 — Build / typecheck / lint / arch (verbatim, tails)

```
$ npm run build
dist/assets/BlogPostPage-BwuX7CxX.js                      159.49 kB │ gzip:    48.26 kB │ map:    960.44 kB
dist/assets/vendor-supabase-30wnyOyk.js                   206.05 kB │ gzip:    53.27 kB │ map:  1,112.43 kB
...
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 34.92s
```

```
$ npx tsc --noEmit
tsc: exit 0
```

```
$ npm run lint
> vite_react_shadcn_ts@0.0.0 lint
> eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0
lint-exit: 0
```

```
$ npm run test:arch
> node scripts/quality/check-contract-governance.mjs
[contracts] Governance check passed for 18 contract(s).
> vite_react_shadcn_ts@0.0.0 check:contract-surface-map
> node scripts/quality/check-contract-surface-map.mjs
[check-contract-surface-map] ok
(exit 0)
```

## Suppression audit

Lint ran with `--report-unused-disable-directives --max-warnings 0`: zero warnings/errors emitted ⇒ no unused or newly added suppression directives at HEAD.
