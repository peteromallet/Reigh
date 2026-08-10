import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './routes';

const {
  probeStoredSessionTokenMock,
  normalizeAndPresentErrorMock,
} = vi.hoisted(() => ({
  probeStoredSessionTokenMock: vi.fn(),
  normalizeAndPresentErrorMock: vi.fn(),
}));

vi.mock('@/pages/Home/HomePage', () => ({
  default: () => <div data-testid="home-page" />,
}));
vi.mock('@/pages/ArtPage', () => ({
  default: () => <div data-testid="art-page" />,
}));
vi.mock('@/pages/PaymentSuccessPage', () => ({
  default: () => <div data-testid="payment-success-page" />,
}));
vi.mock('@/pages/PaymentCancelPage', () => ({
  default: () => <div data-testid="payment-cancel-page" />,
}));
vi.mock('@/pages/SharePage', () => ({
  default: () => <div data-testid="share-page" />,
}));
vi.mock('@/tools/image-generation/pages/ImageGenerationToolPage', () => ({
  default: () => <div data-testid="image-generation-page" />,
}));
vi.mock('@/tools/travel-between-images/pages/VideoTravelToolPage', () => ({
  default: () => <div data-testid="video-travel-page" />,
}));
vi.mock('@/tools/character-animate/pages/CharacterAnimatePage', () => ({
  default: () => <div data-testid="character-animate-page" />,
}));
vi.mock('@/tools/join-clips/pages/JoinClipsPage', () => ({
  default: () => <div data-testid="join-clips-page" />,
}));
vi.mock('@/tools/edit-video/pages/EditVideoPage', () => ({
  default: () => <div data-testid="edit-video-page" />,
}));
vi.mock('@/tools/video-editor/pages/VideoEditorPage', () => ({
  default: () => <div data-testid="video-editor-page" />,
}));
vi.mock('@/tools/edit-images/pages/EditImagesPage', () => ({
  default: () => <div data-testid="edit-images-page" />,
}));
vi.mock('@/tools/training-data-helper/pages/TrainingDataHelperPage', () => ({
  default: () => <div data-testid="training-data-helper-page" />,
}));
vi.mock('@/pages/Blog/BlogListPage', () => ({
  default: () => <div data-testid="blog-list-page" />,
}));
vi.mock('@/pages/Blog/BlogPostPage', () => ({
  default: () => <div data-testid="blog-post-page" />,
}));
vi.mock('@/pages/NotFoundPage', () => ({
  default: () => <div data-testid="not-found-page" />,
}));
vi.mock('@/pages/ShotsPage', () => ({
  default: () => <div data-testid="shots-page" />,
}));
vi.mock('@/app/Layout', async () => {
  const { Outlet } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    Layout: () => <Outlet />,
  };
});
vi.mock('./DefaultToolRedirect', () => ({
  DefaultToolRedirect: () => <div data-testid="default-tool-redirect" />,
}));
vi.mock('@/shared/components/ReighLoading', () => ({
  ReighLoading: () => <div data-testid="reigh-loading" />,
}));
vi.mock('@/shared/components/ToolErrorBoundary', () => ({
  ToolErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/shared/lib/supabaseSession', () => ({
  probeStoredSessionToken: probeStoredSessionTokenMock,
}));
vi.mock('@/shared/lib/errorHandling/runtimeError', () => ({
  normalizeAndPresentError: normalizeAndPresentErrorMock,
}));

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('AppRoutes', () => {
  beforeEach(() => {
    probeStoredSessionTokenMock.mockReset();
    probeStoredSessionTokenMock.mockReturnValue({ ok: true, value: null });
    normalizeAndPresentErrorMock.mockReset();
  });

  it('renders the /home route inside MemoryRouter', async () => {
    renderRoute('/home');

    expect(await screen.findByTestId('home-page')).toBeInTheDocument();
  });

  it('redirects / to /tools when a stored session exists', async () => {
    probeStoredSessionTokenMock.mockReturnValue({ ok: true, value: { access_token: 'token' } });

    renderRoute('/');

    expect(await screen.findByTestId('default-tool-redirect')).toBeInTheDocument();
  });

  it('renders nested tool routes through the layout outlet', () => {
    renderRoute('/tools/video-editor');

    expect(screen.getByTestId('video-editor-page')).toBeInTheDocument();
  });

  it('renders public routes outside the layout tree', () => {
    renderRoute('/payments/success');

    expect(screen.getByTestId('payment-success-page')).toBeInTheDocument();
  });

  it('renders the catch-all route for unknown paths', () => {
    renderRoute('/does-not-exist');

    expect(screen.getByTestId('not-found-page')).toBeInTheDocument();
  });
});
