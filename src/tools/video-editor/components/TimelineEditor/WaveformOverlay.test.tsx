import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WaveformOverlay } from './WaveformOverlay';

describe('WaveformOverlay', () => {
  it('renders a mirrored non-interactive svg overlay', () => {
    const { container } = render(<WaveformOverlay waveform={[0.1, 0.9, 0.4]} />);
    const overlay = container.firstElementChild;
    const svg = container.querySelector('svg');
    const path = container.querySelector('path');

    expect(overlay).toHaveClass('pointer-events-none', 'absolute', 'inset-0', 'opacity-25');
    expect(overlay).toHaveAttribute('data-testid', 'timeline-audio-waveform');
    expect(svg).toHaveAttribute('preserveAspectRatio', 'none');
    expect(svg).toHaveAttribute('fill', 'currentColor');
    expect(path?.getAttribute('d')).toContain('Z');
  });

  it('returns null for an empty waveform', () => {
    const { container } = render(<WaveformOverlay waveform={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
