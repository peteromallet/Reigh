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

function renderBrowser(initialEntry = '/tools/travel-between-images?localProject=demo&localTimeline=timeline-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
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

  it('renders the overview and keeps unrelated clips out of each mini timeline', async () => {
    renderBrowser();

    expect(await screen.findByRole('button', { name: 'Select shot Opening' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Opening visual timeline: 1 visual clip/i })).toBeInTheDocument();
    expect(screen.queryByText('9.0s')).not.toBeInTheDocument();
    expect(screen.getByText('1 visual clip · 2.0s')).toBeInTheDocument();
  });

  it('opens a focused shot timeline from the overview without dropping local scope', async () => {
    renderBrowser();
    const shot = await screen.findByRole('button', { name: 'Select shot Opening' });
    fireEvent.click(shot);

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/tools/travel-between-images?localProject=demo&localTimeline=timeline-1#shot-a',
      );
      expect(screen.getByRole('heading', { name: 'Opening' })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: /Opening focused visual timeline: 1 visual clip/i })).toBeInTheDocument();
      expect(screen.getByLabelText('clip-a: 2.0s')).toBeInTheDocument();
      expect(screen.queryByLabelText('clip-other: 9.0s')).not.toBeInTheDocument();
    });
  });

  it('opens a valid deep link directly in shot detail after refresh', async () => {
    renderBrowser('/tools/travel-between-images?localProject=demo&localTimeline=timeline-1#shot-a');

    expect(await screen.findByRole('heading', { name: 'Opening' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to all shots/i })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/tools/travel-between-images?localProject=demo&localTimeline=timeline-1#shot-a',
    );
  });

  it.each([
    ['malformed', '/tools/travel-between-images?localProject=demo&localTimeline=timeline-1#%E0%A4%A'],
    ['unknown', '/tools/travel-between-images?localProject=demo&localTimeline=timeline-1#not-a-shot'],
  ])('falls back to the overview for a %s hash', async (_kind, initialEntry) => {
    renderBrowser(initialEntry);

    expect(await screen.findByRole('button', { name: 'Select shot Opening' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/tools/travel-between-images?localProject=demo&localTimeline=timeline-1',
      );
    });
    expect(screen.queryByRole('button', { name: /Back to all shots/i })).not.toBeInTheDocument();
  });

  it('returns from shot detail to the complete overview while preserving local scope', async () => {
    renderBrowser();
    fireEvent.click(await screen.findByRole('button', { name: 'Select shot Opening' }));

    const back = await screen.findByRole('button', { name: /Back to all shots/i });
    fireEvent.click(back);

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/tools/travel-between-images?localProject=demo&localTimeline=timeline-1',
      );
      expect(screen.getByRole('button', { name: 'Select shot Opening' })).toBeInTheDocument();
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
