// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalTimelineShotBrowser } from './LocalTimelineShotBrowser';

const mocks = vi.hoisted(() => ({
  loadTimeline: vi.fn(),
  loadAssetRegistry: vi.fn(),
  onResolve: vi.fn(({ file }: { file: string }) => `https://bridge.test/${file}`),
}));

vi.mock('@/tools/video-editor/data/AstridBridgeDataProvider.ts', () => ({
  AstridBridgeDataProvider: class MockAstridBridgeDataProvider {
    loadTimeline = mocks.loadTimeline;
    loadAssetRegistry = mocks.loadAssetRegistry;
    onResolve = mocks.onResolve;
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}{location.hash}</output>;
}

function renderBrowser() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/tools/travel-between-images?localProject=demo&localTimeline=timeline-1']}>
        <LocalTimelineShotBrowser projectSlug="demo" timelineRef="timeline-1" />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LocalTimelineShotBrowser', () => {
  beforeEach(() => {
    mocks.loadTimeline.mockReset();
    mocks.loadAssetRegistry.mockReset();
    mocks.onResolve.mockClear();
    mocks.loadTimeline.mockResolvedValue({
      config: {
        output: { resolution: '1280x720', fps: 24, file: 'out.mp4' },
        tracks: [{ id: 'V1', kind: 'visual', label: 'Visual' }],
        clips: [
          { id: 'clip-a', at: 0, track: 'V1', asset: 'asset-a', from: 0, to: 2 },
          { id: 'clip-other', at: 2, track: 'V1', asset: 'asset-other', from: 0, to: 9 },
        ],
        pinnedShotGroups: [{ shotId: 'shot-a', name: 'Opening', trackId: 'V1', clipIds: ['clip-a'] }],
      },
      configVersion: 1,
    });
    mocks.loadAssetRegistry.mockResolvedValue({
      assets: {
        'asset-a': { media_id: 'media-a', type: 'image/png', duration: 2 },
        'asset-other': { media_id: 'media-other', type: 'image/png', duration: 9 },
      },
    });
  });

  it('renders document groups and keeps unrelated clips out of each mini timeline', async () => {
    renderBrowser();

    expect(await screen.findByRole('button', { name: 'Open shot Opening' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Opening visual timeline: 1 visual clip/i })).toBeInTheDocument();
    expect(screen.queryByText('9.0s')).not.toBeInTheDocument();
    expect(screen.getByText('1 visual clip · 2.0s')).toBeInTheDocument();
  });

  it('opens the existing hash-driven shot flow without dropping local scope', async () => {
    renderBrowser();
    fireEvent.click(await screen.findByRole('button', { name: 'Open shot Opening' }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/tools/travel-between-images?localProject=demo&localTimeline=timeline-1#shot-a',
      );
    });
  });

  it('reports an empty document without invoking cloud shot reads', async () => {
    mocks.loadTimeline.mockResolvedValueOnce({
      config: { output: { resolution: '1280x720', fps: 24, file: 'out.mp4' }, clips: [], pinnedShotGroups: [] },
      configVersion: 1,
    });
    renderBrowser();
    expect(await screen.findByText('This timeline has no document shot groups yet.')).toBeInTheDocument();
  });
});
