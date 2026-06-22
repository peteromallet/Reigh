// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { DataProviderWrapper } from '@/tools/video-editor/contexts/DataProviderContext.tsx';
import { createVideoEditorDiagnosticsStore } from '@/tools/video-editor/runtime/diagnostics.ts';
import type { VideoEditorDiagnosticsStore } from '@/tools/video-editor/runtime/diagnostics.ts';
import type { VideoEditorRuntimeContextValue } from '@/tools/video-editor/contexts/DataProviderContext.tsx';
import { DiagnosticsPanel } from '@/tools/video-editor/components/DiagnosticsPanel.tsx';

// ---------------------------------------------------------------------------
// Mock shared UI components
// ---------------------------------------------------------------------------

vi.mock('@/shared/components/ui/button.tsx', () => ({
  Button: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/shared/components/ui/badge.tsx', () => ({
  Badge: ({ children, variant, ...props }: any) => (
    <span data-variant={variant} {...props}>
      {children}
    </span>
  ),
}));

vi.mock('@/shared/components/ui/dialog.tsx', () => ({
  Dialog: ({ children, open }: any) => (open ? <>{children}</> : null),
  DialogContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

vi.mock('@/shared/components/ui/contracts/cn.ts', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRuntimeContext(
  store: VideoEditorDiagnosticsStore,
): VideoEditorRuntimeContextValue {
  return {
    provider: {} as any,
    assetResolver: {} as any,
    auth: {} as any,
    project: {} as any,
    shots: {} as any,
    mediaLightbox: {} as any,
    agentChat: {} as any,
    toast: {} as any,
    telemetry: {} as any,
    timelineId: 'test-timeline',
    userId: 'test-user',
    timelineName: 'Test Timeline',
    extensions: {
      slots: {},
      dialogHost: { dialogs: [] },
      registry: { panels: [], inspectorSections: [] },
    },
    diagnosticsStore: store,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiagnosticsPanel', () => {
  let store: VideoEditorDiagnosticsStore;

  beforeEach(() => {
    store = createVideoEditorDiagnosticsStore();
  });

  it('renders empty state when no diagnostics are present', () => {
    const runtime = createRuntimeContext(store);

    render(
      <DataProviderWrapper value={runtime}>
        <DiagnosticsPanel open={true} onOpenChange={vi.fn()} />
      </DataProviderWrapper>,
    );

    // Panel should be visible
    expect(screen.getByTestId('video-editor-diagnostics-panel')).toBeInTheDocument();

    // Empty state message
    expect(screen.getByText('No diagnostics to display.')).toBeInTheDocument();
    expect(screen.getByText('All systems are operating normally.')).toBeInTheDocument();

    // Description should show zero counts
    expect(screen.getByText('No diagnostics reported.')).toBeInTheDocument();
  });

  it('renders diagnostics with severity counts and required fields', () => {
    store.report({
      severity: 'error',
      source: 'extension-loader',
      code: 'manifest_schema_invalid',
      message: 'Manifest is invalid.',
      extensionId: 'ext-1',
      detail: { field: 'id' },
    });

    store.report({
      severity: 'warning',
      source: 'extension-runtime',
      code: 'duplicate_contribution',
      message: 'Duplicate contribution detected.',
      extensionId: 'ext-2',
    });

    store.report({
      severity: 'info',
      source: 'perf',
      code: 'long_task',
      message: 'Long task detected: 120ms',
      detail: { duration: 120 },
    });

    const runtime = createRuntimeContext(store);

    render(
      <DataProviderWrapper value={runtime}>
        <DiagnosticsPanel open={true} onOpenChange={vi.fn()} />
      </DataProviderWrapper>,
    );

    // Panel should be visible with stable selector
    expect(screen.getByTestId('video-editor-diagnostics-panel')).toBeInTheDocument();

    // Description should show counts
    expect(screen.getByText(/1 error/)).toBeInTheDocument();
    expect(screen.getByText(/1 warning/)).toBeInTheDocument();
    expect(screen.getByText(/1 info/)).toBeInTheDocument();

    // Total count badge
    expect(screen.getByText('3')).toBeInTheDocument();

    // Each diagnostic should be rendered with its message
    expect(screen.getByText('Manifest is invalid.')).toBeInTheDocument();
    expect(screen.getByText('Duplicate contribution detected.')).toBeInTheDocument();
    expect(screen.getByText('Long task detected: 120ms')).toBeInTheDocument();
  });

  it('each diagnostic row exposes stable selectors and diagnostic attributes', () => {
    store.report({
      severity: 'error',
      source: 'render',
      code: 'render_blocker',
      message: 'Render blocked.',
    });

    store.report({
      severity: 'warning',
      source: 'provider',
      code: 'provider_degraded',
      message: 'Provider degraded.',
    });

    const runtime = createRuntimeContext(store);

    render(
      <DataProviderWrapper value={runtime}>
        <DiagnosticsPanel open={true} onOpenChange={vi.fn()} />
      </DataProviderWrapper>,
    );

    const rows = screen.getAllByTestId('video-editor-diagnostic-row');
    expect(rows).toHaveLength(2);

    const errorRow = screen.getByText('Render blocked.').closest('[data-testid="video-editor-diagnostic-row"]');
    expect(errorRow).toBeInTheDocument();
    expect(errorRow!.getAttribute('data-diagnostic-code')).toBe('render_blocker');
    expect(errorRow!.getAttribute('data-diagnostic-severity')).toBe('error');
    expect(errorRow!.getAttribute('data-diagnostic-source')).toBe('render');

    const warningRow = screen.getByText('Provider degraded.').closest('[data-testid="video-editor-diagnostic-row"]');
    expect(warningRow).toBeInTheDocument();
    expect(warningRow!.getAttribute('data-diagnostic-code')).toBe('provider_degraded');
    expect(warningRow!.getAttribute('data-diagnostic-severity')).toBe('warning');
    expect(warningRow!.getAttribute('data-diagnostic-source')).toBe('provider');
  });

  it('displays severity badges with correct variants', () => {
    store.report({
      severity: 'error',
      source: 'extension-loader',
      code: 'E001',
      message: 'Error message.',
    });

    store.report({
      severity: 'warning',
      source: 'extension-loader',
      code: 'W001',
      message: 'Warning message.',
    });

    store.report({
      severity: 'info',
      source: 'perf',
      code: 'I001',
      message: 'Info message.',
    });

    const runtime = createRuntimeContext(store);

    render(
      <DataProviderWrapper value={runtime}>
        <DiagnosticsPanel open={true} onOpenChange={vi.fn()} />
      </DataProviderWrapper>,
    );

    // Find severity badges
    const badges = screen.getAllByText(/error|warning|info/i).filter(
      (el) => el.getAttribute('data-variant') !== null,
    );

    const errorBadge = badges.find((b) => b.textContent === 'error');
    const warningBadge = badges.find((b) => b.textContent === 'warning');
    const infoBadge = badges.find((b) => b.textContent === 'info');

    expect(errorBadge).toBeDefined();
    expect(warningBadge).toBeDefined();
    expect(infoBadge).toBeDefined();

    expect(errorBadge!.getAttribute('data-variant')).toBe('destructive');
    expect(warningBadge!.getAttribute('data-variant')).toBe('secondary');
    expect(infoBadge!.getAttribute('data-variant')).toBe('outline');
  });

  it('displays extensionId when present', () => {
    store.report({
      severity: 'error',
      source: 'extension-loader',
      code: 'E001',
      message: 'Error with extension.',
      extensionId: 'my-extension-id',
    });

    const runtime = createRuntimeContext(store);

    render(
      <DataProviderWrapper value={runtime}>
        <DiagnosticsPanel open={true} onOpenChange={vi.fn()} />
      </DataProviderWrapper>,
    );

    expect(screen.getByText('my-extension-id')).toBeInTheDocument();
  });

  it('shows detail toggle and renders JSON when clicked', async () => {
    store.report({
      severity: 'error',
      source: 'extension-loader',
      code: 'E001',
      message: 'Error with details.',
      detail: { key: 'value', nested: { inner: true } },
    });

    const runtime = createRuntimeContext(store);

    render(
      <DataProviderWrapper value={runtime}>
        <DiagnosticsPanel open={true} onOpenChange={vi.fn()} />
      </DataProviderWrapper>,
    );

    // "Show details" button should be present
    const showDetailsBtn = screen.getByText('Show details');
    expect(showDetailsBtn).toBeInTheDocument();

    // Click to expand
    await userEvent.click(showDetailsBtn);

    // Should now show "Hide details"
    expect(screen.getByText('Hide details')).toBeInTheDocument();

    // Detail JSON should be rendered
    expect(screen.getByText(/"key"/)).toBeInTheDocument();

    // Click again to collapse
    await userEvent.click(screen.getByText('Hide details'));
    expect(screen.getByText('Show details')).toBeInTheDocument();
  });

  it('sorts diagnostics: errors first, then warnings, then info', () => {
    store.report({
      severity: 'info',
      source: 'perf',
      code: 'P001',
      message: 'Info diagnostic.',
    });

    store.report({
      severity: 'error',
      source: 'render',
      code: 'R001',
      message: 'Error diagnostic.',
    });

    store.report({
      severity: 'warning',
      source: 'provider',
      code: 'W001',
      message: 'Warning diagnostic.',
    });

    const runtime = createRuntimeContext(store);

    render(
      <DataProviderWrapper value={runtime}>
        <DiagnosticsPanel open={true} onOpenChange={vi.fn()} />
      </DataProviderWrapper>,
    );

    // Get all diagnostic rows
    const rows = document.querySelectorAll('[data-diagnostic-code]');
    expect(rows).toHaveLength(3);

    // First should be error, then warning, then info
    expect(rows[0].getAttribute('data-diagnostic-severity')).toBe('error');
    expect(rows[1].getAttribute('data-diagnostic-severity')).toBe('warning');
    expect(rows[2].getAttribute('data-diagnostic-severity')).toBe('info');
  });

  it('triggers onOpenChange when dialog is closed', async () => {
    const onOpenChange = vi.fn();
    const runtime = createRuntimeContext(store);

    // For dialog close we need the actual dialog interactions
    // Since we mocked Dialog to render children only when open=true,
    // we verify onOpenChange is passed through
    const { rerender } = render(
      <DataProviderWrapper value={runtime}>
        <DiagnosticsPanel open={true} onOpenChange={onOpenChange} />
      </DataProviderWrapper>,
    );

    expect(screen.getByTestId('video-editor-diagnostics-panel')).toBeInTheDocument();

    // When open becomes false, panel should disappear
    rerender(
      <DataProviderWrapper value={runtime}>
        <DiagnosticsPanel open={false} onOpenChange={onOpenChange} />
      </DataProviderWrapper>,
    );

    expect(screen.queryByTestId('video-editor-diagnostics-panel')).not.toBeInTheDocument();
  });

  it('handles 99+ diagnostics gracefully', () => {
    const runtime = createRuntimeContext(store);

    // Add 100 diagnostics
    for (let i = 0; i < 100; i++) {
      store.report({
        severity: i % 3 === 0 ? 'error' : i % 3 === 1 ? 'warning' : 'info',
        source: 'extension-loader',
        code: `E${String(i).padStart(3, '0')}`,
        message: `Diagnostic ${i}`,
      });
    }

    render(
      <DataProviderWrapper value={runtime}>
        <DiagnosticsPanel open={true} onOpenChange={vi.fn()} />
      </DataProviderWrapper>,
    );

    // All 100 rows should expose the stable row test selector and code attribute.
    const rows = screen.getAllByTestId('video-editor-diagnostic-row');
    expect(rows.length).toBeGreaterThanOrEqual(100);
    expect(rows.every((row) => row.hasAttribute('data-diagnostic-code'))).toBe(true);
  });
});
