/**
 * DisposeHandle — disposal-only public contract.
 *
 * Provides the canonical {@link DisposeHandle} interface consumed by
 * lifecycle methods that require cleanup (subscriptions, registrations,
 * listeners, etc.). The interface is intentionally minimal:
 * synchronous, idempotent, and must not throw.
 *
 * @publicContract
 */

/** A handle returned by lifecycle methods that require cleanup. */
export interface DisposeHandle {
  /** Synchronous, idempotent, must not throw. */
  dispose(): void;
  /** Optional explicit resource management support. */
  readonly [Symbol.dispose]?: () => void;
}

/**
 * Combine lifecycle registrations into one idempotent cleanup handle.
 *
 * Handles are disposed in reverse registration order, matching stack-like
 * activation semantics. Nullish/void handles are ignored so an extension can
 * compose optional registrations without branching in its return value.
 */
export function combineDisposeHandles(
  ...handles: ReadonlyArray<DisposeHandle | null | undefined | void>
): DisposeHandle {
  const activeHandles = handles.filter(
    (handle): handle is DisposeHandle => handle !== null && handle !== undefined,
  );
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (let index = activeHandles.length - 1; index >= 0; index -= 1) {
      activeHandles[index].dispose();
    }
  };
  return Object.freeze({ dispose, [Symbol.dispose]: dispose });
}
