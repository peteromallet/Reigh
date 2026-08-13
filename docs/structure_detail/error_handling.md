# Error Handling System

## Source of Truth

| Component | Location |
|-----------|----------|
| Error types (`AppError`, `NetworkError`, `SilentError`, etc.) | `src/shared/lib/errorHandling/errors.ts` |
| `normalizeAndPresentError()`, `normalizeAndPresentAndRethrow()` | `src/shared/lib/errorHandling/runtimeError.ts` |
| Error classification helpers | `src/shared/lib/errorHandling/errorUtils.ts` |
| App error boundary | `src/app/components/error/AppErrorBoundary.tsx` |

## Key Invariants

- **`normalizeAndPresentError`** is the main caught-exception helper. It normalizes, logs, and presents toasts in one call.
- **Validation toasts** are for user-input problems (missing file, empty prompt). These are not exceptions -- use `toast()` directly and `return`.
- **`SilentError`** and `reportRecoverableError()` cover expected failures (localStorage unavailable, autoplay blocked, optional features) that should be logged without a destructive toast.
- Empty catches must have a `// Silent: reason` comment.

## When to Use What

| Scenario | Approach |
|----------|----------|
| Catch block (event handler / async) | `normalizeAndPresentError(error, { context: '...' })` |
| Validation before API call | `toast()` directly + `return` (not an exception) |
| API returns error response | Throw typed error (`AuthError`, `ServerError`, etc.) |
| Expected failure (localStorage, optional) | `SilentError`, `reportRecoverableError()`, or empty catch with `// Silent:` comment |
| React render error | Caught by `AppErrorBoundary` automatically |

## Auto-Categorization

`normalizeAndPresentError()` maps unknown errors to typed `AppError` variants by normalizing the input first:

| Pattern | Becomes | Flags |
|---------|---------|-------|
| `"failed to fetch"` | `NetworkError` | |
| `TimeoutError` marker (or wrapped via `cause`/`context`/`originalError`) | `NetworkError` | `isTimeout: true` |
| `AbortError` without the timeout marker (lock-steal, caller cancel) | `NetworkError` | `isTimeout: false` |
| `navigator.onLine === false` | `NetworkError` | `isOffline: true` |
| `"unauthorized"` | `AuthError` | `needsLogin: true` |
| `"forbidden"` | `AuthError` | `needsLogin: false` |
| `"required"` / `"invalid"` | `ValidationError` | |

Timeout classification is **marker-based only** (see `TimeoutError` / `isTimeoutError` in `src/shared/lib/errorHandling/errors.ts`): our fetch timeout wrapper aborts with a `TimeoutError` reason, and only that marker (directly or wrapped) sets `isTimeout: true`. Generic `AbortError`s are network errors but are **not** presented as "Request timed out".

## Helper Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `normalizeAndPresentAndRethrow(error, options)` | `src/shared/lib/errorHandling/runtimeError.ts` | Normalize, show/toast if needed, then throw |
| `reportRecoverableError(error, options)` | `src/shared/lib/errorHandling/recoverableError.ts` | Log expected nonfatal failures without escalating UI |
| `getErrorMessage(error)` | `src/shared/lib/errorHandling/errorUtils.ts` | Stable string extraction for unknown errors |

## Error Boundary

Wrapped around the app in `src/app/bootstrap.tsx`. Shows recovery UI instead of a white screen on uncaught render errors. Does **not** catch event handlers or async code (use `normalizeAndPresentError` there).
