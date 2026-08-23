import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { defineExtension } from '@reigh/editor-sdk';
import type { ExtensionStateRepository } from './extensionStateRepository';
import { useExtensionLoaderWiring } from './useExtensionLoaderWiring';

describe('useExtensionLoaderWiring repository hydration', () => {
  it('keeps a stable hook order when a browser repository arrives asynchronously', async () => {
    const extension = defineExtension({
      manifest: {
        id: 'com.reigh.hydration-test' as never,
        version: '1.0.0',
        label: 'Hydration test',
        contributions: [],
      },
      activate: () => ({ dispose() {} }),
    });
    const repository = {
      getFullExtensionState: vi.fn(async () => ({
        packs: {},
        enablement: {},
        devOverrides: {},
        settings: {},
      })),
    } as unknown as ExtensionStateRepository;

    const { result, rerender } = renderHook(
      ({ activeRepository }: { activeRepository: ExtensionStateRepository | null }) =>
        useExtensionLoaderWiring({
          directExtensions: [extension],
          repository: activeRepository,
        }),
      { initialProps: { activeRepository: null } },
    );

    expect(result.current.resolvedExtensions).toEqual([extension]);
    expect(result.current.isResolving).toBe(false);

    rerender({ activeRepository: repository });

    await waitFor(() => expect(result.current.isResolving).toBe(false));
    expect(repository.getFullExtensionState).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });
});
