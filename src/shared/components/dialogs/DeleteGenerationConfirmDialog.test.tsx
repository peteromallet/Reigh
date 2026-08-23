// @vitest-environment jsdom

import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeleteGenerationConfirmDialog,
  DELETE_GENERATION_SKIP_CONFIRM_KEY,
  shouldSkipDeleteGenerationConfirm,
} from './DeleteGenerationConfirmDialog';

describe('DeleteGenerationConfirmDialog', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('renders title, description, and the "don\'t show again" checkbox', () => {
    render(
      <DeleteGenerationConfirmDialog
        open
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText('Delete Generation')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Are you sure you want to delete this generation? This action cannot be undone.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /don't show this again/i })).toBeInTheDocument();
  });

  it('does not persist the skip preference when the checkbox is left unchecked', () => {
    const onConfirm = vi.fn();

    render(
      <DeleteGenerationConfirmDialog
        open
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(DELETE_GENERATION_SKIP_CONFIRM_KEY)).toBeNull();
    expect(shouldSkipDeleteGenerationConfirm()).toBe(false);
  });

  it('persists the skip preference when the checkbox is checked at confirm time', () => {
    const onConfirm = vi.fn();

    render(
      <DeleteGenerationConfirmDialog
        open
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /don't show this again/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(shouldSkipDeleteGenerationConfirm()).toBe(true);
  });
});
