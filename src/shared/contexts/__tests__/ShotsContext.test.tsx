/**
 * ShotsContext Tests
 *
 * Tests for shots data context.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Use vi.hoisted for variables referenced in vi.mock factories
const { mockRefetch } = vi.hoisted(() => ({
  mockRefetch: vi.fn(),
}));

vi.mock('@/shared/contexts/ProjectContext', () => ({
  useProjectSelectionContext: vi.fn().mockReturnValue({
    selectedProjectId: 'proj-1',
  }),
}));

vi.mock('@/shared/hooks/shots', () => ({
  useListShots: vi.fn().mockReturnValue({
    data: [
      { id: 'shot-1', name: 'Shot 1' },
      { id: 'shot-2', name: 'Shot 2' },
    ],
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: mockRefetch,
  }),
  useProjectImageStats: vi.fn().mockReturnValue({
    data: { allCount: 10, noShotCount: 3 },
    isLoading: false,
  }),
}));

import { AstridShotsProvider, useShots } from '../ShotsContext';
import { DeferredCloudShotsProvider } from '../DeferredCloudShotsProvider';

// Test consumer component
function ShotsConsumer() {
  const ctx = useShots();
  return (
    <div>
      <span data-testid="shotCount">{ctx.shots?.length ?? 'undefined'}</span>
      <span data-testid="isLoading">{String(ctx.isLoading)}</span>
      <span data-testid="allImagesCount">{ctx.allImagesCount ?? 'undefined'}</span>
      <span data-testid="noShotImagesCount">{ctx.noShotImagesCount ?? 'undefined'}</span>
    </div>
  );
}

describe('ShotsContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useShots hook', () => {
    it('throws when used outside ShotsProvider', () => {
      function BadConsumer() {
        useShots();
        return null;
      }

      expect(() => {
        render(<BadConsumer />);
      }).toThrow('useShots must be used within a shots context provider');
    });
  });

  describe('DeferredCloudShotsProvider', () => {
    it('renders children', () => {
      render(
        <DeferredCloudShotsProvider>
          <div data-testid="child">Hello</div>
        </DeferredCloudShotsProvider>
      );

      expect(screen.getByTestId('child')).toHaveTextContent('Hello');
    });

    it('provides shots data from hooks', () => {
      render(
        <DeferredCloudShotsProvider>
          <ShotsConsumer />
        </DeferredCloudShotsProvider>
      );

      expect(screen.getByTestId('shotCount')).toHaveTextContent('2');
      expect(screen.getByTestId('isLoading')).toHaveTextContent('false');
      expect(screen.getByTestId('allImagesCount')).toHaveTextContent('10');
      expect(screen.getByTestId('noShotImagesCount')).toHaveTextContent('3');
    });

    it('exposes refetchShots function', () => {
      function RefetchConsumer() {
        const { refetchShots } = useShots();
        return (
          <button data-testid="refetch" onClick={() => refetchShots()}>
            Refetch
          </button>
        );
      }

      render(
        <DeferredCloudShotsProvider>
          <RefetchConsumer />
        </DeferredCloudShotsProvider>
      );

      screen.getByTestId('refetch').click();
      expect(mockRefetch).toHaveBeenCalled();
    });
  });

  describe('AstridShotsProvider', () => {
    it('provides an empty compatibility view without executing cloud hooks', () => {
      render(
        <AstridShotsProvider>
          <ShotsConsumer />
        </AstridShotsProvider>,
      );

      expect(screen.getByTestId('shotCount')).toHaveTextContent('0');
      expect(screen.getByTestId('isLoading')).toHaveTextContent('false');
      expect(screen.getByTestId('allImagesCount')).toHaveTextContent('0');
    });
  });
});
