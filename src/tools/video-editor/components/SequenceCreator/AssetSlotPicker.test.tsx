// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssetSlotPicker } from './AssetSlotPicker';
import type { AllowedSequenceAsset } from '@/tools/video-editor/sequences/generation';
import type {
  AssetSlotDefinition,
  AssetSlotValidationError,
} from '@/tools/video-editor/sequences/assetSlots';

const imageSlot: AssetSlotDefinition = {
  id: 'hero',
  label: 'Hero image',
  mediaType: 'image',
  required: true,
  minItems: 1,
  maxItems: 1,
};

const videoSlot: AssetSlotDefinition = {
  id: 'broll',
  label: 'B-roll video',
  mediaType: 'video',
  required: false,
  minItems: 0,
  maxItems: 2,
};

const allowedAssets: AllowedSequenceAsset[] = [
  { key: 'image-a', mediaType: 'image', label: 'Image A' },
  { key: 'video-a', mediaType: 'video', label: 'Video A' },
  { key: 'video-b', mediaType: 'video', label: 'Video B' },
];

describe('AssetSlotPicker', () => {
  it('filters single-select candidates by slot media type and writes replacement bindings', () => {
    const onChangeSlot = vi.fn();

    render(
      <AssetSlotPicker
        slots={[imageSlot]}
        bindings={{}}
        allowedAssets={allowedAssets}
        errors={[]}
        onChangeSlot={onChangeSlot}
      />,
    );

    expect(screen.getByText('Image A')).toBeInTheDocument();
    expect(screen.queryByText('Video A')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Image A' }));

    expect(onChangeSlot).toHaveBeenCalledWith('hero', ['image-a']);
  });

  it('clears an already-selected single item instead of duplicating it', () => {
    const onChangeSlot = vi.fn();

    render(
      <AssetSlotPicker
        slots={[imageSlot]}
        bindings={{ hero: ['image-a'] }}
        allowedAssets={allowedAssets}
        errors={[]}
        onChangeSlot={onChangeSlot}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Image A' }));

    expect(onChangeSlot).toHaveBeenCalledWith('hero', []);
  });

  it('uses multi-select checkboxes for slots that allow multiple assets', () => {
    const onChangeSlot = vi.fn();

    render(
      <AssetSlotPicker
        slots={[videoSlot]}
        bindings={{ broll: ['video-a'] }}
        allowedAssets={allowedAssets}
        errors={[]}
        onChangeSlot={onChangeSlot}
      />,
    );

    expect(screen.queryByText('Image A')).not.toBeInTheDocument();
    expect(screen.getByText('Video A')).toBeInTheDocument();
    expect(screen.getByText('Video B')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Video B'));

    expect(onChangeSlot).toHaveBeenCalledWith('broll', ['video-a', 'video-b']);
  });

  it('renders inline validation errors for the affected slot', () => {
    const errors: AssetSlotValidationError[] = [{
      code: 'missing_required_slot',
      path: 'params.assetSlotBindings.hero',
      slotId: 'hero',
      message: 'Hero image requires at least 1 asset.',
    }];

    render(
      <AssetSlotPicker
        slots={[imageSlot]}
        bindings={{}}
        allowedAssets={allowedAssets}
        errors={errors}
        onChangeSlot={vi.fn()}
      />,
    );

    expect(screen.getByText('Hero image requires at least 1 asset.')).toBeInTheDocument();
  });
});
