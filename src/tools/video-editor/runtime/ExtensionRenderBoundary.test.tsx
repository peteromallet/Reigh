/**
 * Unit tests for ExtensionRenderBoundary.
 *
 * Covers:
 *  - Error catching and fallback rendering
 *  - Diagnostic reporting for render exceptions
 *  - Diagnostic reporting for visibility predicate exceptions
 *  - buildExtensionRenderExceptionDiagnostic shape
 *  - wrapVisibilityPredicate fail-closed behavior
 *  - No-op when diagnostics store is unavailable
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Component, type ReactNode } from 'react';

import {
  ExtensionRenderBoundary,
  buildExtensionRenderExceptionDiagnostic,
  reportExtensionRenderDiagnostic,
  wrapVisibilityPredicate,
  type ExtensionRenderBoundaryMetadata,
} from './ExtensionRenderBoundary.tsx';
import { createVideoEditorDiagnosticsStore } from './diagnostics.ts';
import type { VideoEditorDiagnosticsStore } from './diagnostics.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Component that always throws. */
function ThrowingComponent({ message = 'test error' }: { message?: string }): ReactNode {
  throw new Error(message);
}

/** Component that renders normally. */
function StableComponent({ label = 'stable' }: { label?: string }): ReactNode {
  return <span data-testid="stable-content">{label}</span>;
}

function metadata(
  overrides: Partial<ExtensionRenderBoundaryMetadata> = {},
): ExtensionRenderBoundaryMetadata {
  return {
    descriptorId: 'test-descriptor',
    descriptorType: 'panel',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExtensionRenderBoundary', () => {
  // Note: These tests mock useVideoEditorRuntime to supply a diagnostics store.
  // We use vi.hoisted + dynamic import for a clean setup.

  it('renders children normally when no error occurs', () => {
    // Test without runtime context — boundary should still render children
    render(
      <ExtensionRenderBoundary metadata={metadata()}>
        <StableComponent label="hello" />
      </ExtensionRenderBoundary>,
    );

    expect(screen.getByTestId('stable-content')).toHaveTextContent('hello');
  });

  it('renders default fallback when a child throws', () => {
    // Suppress React's error boundary log in test output
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ExtensionRenderBoundary metadata={metadata({ descriptorId: 'failing-panel' })}>
        <ThrowingComponent message="panel render failed" />
      </ExtensionRenderBoundary>,
    );

    expect(screen.getByTestId('extension-render-fallback')).toBeInTheDocument();
    expect(screen.getByTestId('extension-render-fallback')).toHaveTextContent(
      'Extension content unavailable',
    );

    spy.mockRestore();
  });

  it('renders custom fallback when provided', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ExtensionRenderBoundary
        metadata={metadata()}
        fallback={<div data-testid="custom-fallback">Custom error UI</div>}
      >
        <ThrowingComponent />
      </ExtensionRenderBoundary>,
    );

    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
    expect(screen.getByTestId('custom-fallback')).toHaveTextContent('Custom error UI');

    spy.mockRestore();
  });

  it('does not catch errors outside the boundary', () => {
    // Errors in sibling components should not be caught
    expect(() => {
      render(
        <div>
          <ThrowingComponent />
        </div>,
      );
    }).toThrow('test error');
  });
});

// ---------------------------------------------------------------------------
// buildExtensionRenderExceptionDiagnostic
// ---------------------------------------------------------------------------

describe('buildExtensionRenderExceptionDiagnostic', () => {
  it('builds a render exception diagnostic with all fields', () => {
    const error = new Error('Something went wrong');
    const meta = metadata({
      descriptorId: 'my-dialog',
      descriptorType: 'dialog',
      extensionId: 'com.example.ext',
    });

    const result = buildExtensionRenderExceptionDiagnostic(error, meta, 'render');

    expect(result.severity).toBe('error');
    expect(result.source).toBe('extension-render');
    expect(result.code).toBe('extension_render_exception');
    expect(result.message).toContain('my-dialog');
    expect(result.message).toContain('dialog');
    expect(result.message).toContain('Something went wrong');
    expect(result.extensionId).toBe('com.example.ext');
    expect(result.detail).toEqual({
      descriptorId: 'my-dialog',
      descriptorType: 'dialog',
      errorMessage: 'Something went wrong',
      errorName: 'Error',
      extensionId: 'com.example.ext',
    });
  });

  it('builds a visibility exception diagnostic', () => {
    const error = new Error('when predicate crashed');
    const meta = metadata({
      descriptorId: 'hidden-panel',
      descriptorType: 'panel',
      slotName: 'leftPanel',
    });

    const result = buildExtensionRenderExceptionDiagnostic(error, meta, 'visibility');

    expect(result.code).toBe('extension_visibility_exception');
    expect(result.message).toContain('visibility predicate');
    expect(result.message).toContain('hidden-panel');
    expect(result.detail).toEqual({
      descriptorId: 'hidden-panel',
      descriptorType: 'panel',
      errorMessage: 'when predicate crashed',
      errorName: 'Error',
      slotName: 'leftPanel',
    });
    expect(result.extensionId).toBeUndefined();
  });

  it('omits optional fields when not provided', () => {
    const error = new Error('simple error');
    const meta = metadata({ descriptorId: 'simple', descriptorType: 'slot' });

    const result = buildExtensionRenderExceptionDiagnostic(error, meta, 'render');

    expect(result.extensionId).toBeUndefined();
    expect(result.detail).not.toHaveProperty('slotName');
    expect(result.detail).not.toHaveProperty('extensionId');
  });
});

// ---------------------------------------------------------------------------
// reportExtensionRenderDiagnostic
// ---------------------------------------------------------------------------

describe('reportExtensionRenderDiagnostic', () => {
  it('reports a diagnostic to the store', () => {
    const store = createVideoEditorDiagnosticsStore();
    const error = new Error('render crash');
    const meta = metadata({
      descriptorId: 'crash-panel',
      descriptorType: 'panel',
      extensionId: 'ext-1',
    });

    reportExtensionRenderDiagnostic(store, error, meta, 'render');

    const snapshot = store.getSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].code).toBe('extension_render_exception');
    expect(snapshot[0].source).toBe('extension-render');
    expect(snapshot[0].severity).toBe('error');
    expect(snapshot[0].extensionId).toBe('ext-1');
    expect(snapshot[0].detail).toMatchObject({
      descriptorId: 'crash-panel',
      descriptorType: 'panel',
      errorMessage: 'render crash',
    });
  });

  it('is a no-op when store is null', () => {
    const error = new Error('no store');
    const meta = metadata();

    expect(() =>
      reportExtensionRenderDiagnostic(null, error, meta, 'render'),
    ).not.toThrow();
  });

  it('is a no-op when store is undefined', () => {
    const error = new Error('undefined store');
    const meta = metadata();

    expect(() =>
      reportExtensionRenderDiagnostic(undefined, error, meta, 'render'),
    ).not.toThrow();
  });

  it('deduplicates: same error reported twice only creates one diagnostic', () => {
    const store = createVideoEditorDiagnosticsStore();
    const error = new Error('duplicate');
    const meta = metadata({ descriptorId: 'dup', descriptorType: 'dialog' });

    reportExtensionRenderDiagnostic(store, error, meta, 'render');
    reportExtensionRenderDiagnostic(store, error, meta, 'render');

    expect(store.getSnapshot()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// wrapVisibilityPredicate
// ---------------------------------------------------------------------------

describe('wrapVisibilityPredicate', () => {
  it('returns true when the predicate returns true', () => {
    const store = createVideoEditorDiagnosticsStore();
    const meta = metadata({ descriptorId: 'visible', descriptorType: 'panel' });
    const wrapped = wrapVisibilityPredicate(store, meta, () => true);

    expect(wrapped({})).toBe(true);
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it('returns false when the predicate returns false', () => {
    const store = createVideoEditorDiagnosticsStore();
    const meta = metadata({ descriptorId: 'hidden', descriptorType: 'panel' });
    const wrapped = wrapVisibilityPredicate(store, meta, () => false);

    expect(wrapped({})).toBe(false);
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it('returns false (fail-closed) and reports diagnostic when predicate throws', () => {
    const store = createVideoEditorDiagnosticsStore();
    const meta = metadata({
      descriptorId: 'crashing-predicate',
      descriptorType: 'panel',
      extensionId: 'ext-b',
    });

    const wrapped = wrapVisibilityPredicate(store, meta, () => {
      throw new Error('predicate explosion');
    });

    expect(wrapped({})).toBe(false);

    const snapshot = store.getSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].code).toBe('extension_visibility_exception');
    expect(snapshot[0].source).toBe('extension-render');
    expect(snapshot[0].severity).toBe('error');
    expect(snapshot[0].extensionId).toBe('ext-b');
    expect(snapshot[0].detail).toMatchObject({
      descriptorId: 'crashing-predicate',
      descriptorType: 'panel',
      errorMessage: 'predicate explosion',
    });
  });

  it('handles non-Error throws (e.g. string throws)', () => {
    const store = createVideoEditorDiagnosticsStore();
    const meta = metadata({ descriptorId: 'string-throw', descriptorType: 'dialog' });

    const wrapped = wrapVisibilityPredicate(store, meta, () => {
      throw 'raw string error';
    });

    expect(wrapped({})).toBe(false);

    const snapshot = store.getSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].detail).toMatchObject({
      descriptorId: 'string-throw',
      errorMessage: 'raw string error',
    });
  });

  it('is a no-op wrapper (passes through result) when store is null', () => {
    const meta = metadata({ descriptorId: 'no-store', descriptorType: 'panel' });
    const wrapped = wrapVisibilityPredicate(null, meta, () => true);

    // Should not throw, should return the predicate result
    expect(wrapped({})).toBe(true);
  });

  it('passes context argument through to the predicate', () => {
    const store = createVideoEditorDiagnosticsStore();
    const meta = metadata({ descriptorId: 'ctx-test', descriptorType: 'panel' });
    const predicate = vi.fn((ctx: any) => ctx.foo === 'bar');

    const wrapped = wrapVisibilityPredicate(store, meta, predicate);

    expect(wrapped({ foo: 'bar' })).toBe(true);
    expect(predicate).toHaveBeenCalledWith({ foo: 'bar' });
  });
});
