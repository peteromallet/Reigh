// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeAudioReactiveColour,
  AudioReactiveColour,
  normalizeAudioReactiveColourEvents,
  normalizeAudioReactiveColourParams,
} from './AudioReactiveColour';

let currentFrame = 0;

vi.mock('remotion', () => ({
  AbsoluteFill: ({ children, ...props }: { children?: unknown; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Sequence: ({ children }: { children?: unknown }) => <div>{children}</div>,
  useCurrentFrame: () => currentFrame,
}));

beforeEach(() => {
  currentFrame = 0;
});

describe('AudioReactiveColour first-party renderer', () => {
  it('uses the safe initial colour and drops malformed parameters/events', () => {
    expect(normalizeAudioReactiveColourParams({
      initialColor: 'red',
      events: [
        { frame: 0, color: '#ffffff' },
        { frame: 1.5, color: '#ffffff' },
        { frame: 1, color: '#fff' },
        { frame: 2, color: 'rgb(16, 32, 48)' },
        null,
      ],
    })).toEqual({
      initialColor: '#000000',
      events: [],
    });
  });

  it('selects the initial colour before the first event and the event at exact boundaries', () => {
    const events = normalizeAudioReactiveColourEvents([
      { frame: 2, color: '#203040' },
      { frame: 4, color: '#405060' },
    ]);
    expect(activeAudioReactiveColour('#000000', events, 0)).toBe('#000000');
    expect(activeAudioReactiveColour('#000000', events, 1)).toBe('#000000');
    expect(activeAudioReactiveColour('#000000', events, 2)).toBe('#203040');
    expect(activeAudioReactiveColour('#000000', events, 3)).toBe('#203040');
    expect(activeAudioReactiveColour('#000000', events, 4)).toBe('#405060');
  });

  it('keeps source-order tie behavior for duplicate frames', () => {
    const events = normalizeAudioReactiveColourEvents([
      { id: 'late-source', frame: 3, color: '#303030' },
      { id: 'early-source', frame: 3, color: '#101010' },
      { id: 'before', frame: 1, color: '#010101' },
    ]);
    expect(events.map((event) => event.id)).toEqual(['before', 'late-source', 'early-source']);
    expect(activeAudioReactiveColour('#000000', events, 3)).toBe('#101010');
  });

  it('renders a 566-event fixture with bounded marker lookup and no mutation', () => {
    const source = Array.from({ length: 566 }, (_, index) => ({
      id: `transition-${index + 1}`,
      frame: index * 14 + 1,
      color: `#${((index * 0x12345) % 0xffffff).toString(16).padStart(6, '0')}`,
    }));
    const originalFirst = source[0];
    const events = normalizeAudioReactiveColourEvents(source);
    expect(events).toHaveLength(566);
    expect(source[0]).toBe(originalFirst);
    expect(activeAudioReactiveColour('#000000', events, 8085)).toBe(source.at(-1)?.color);
    expect(activeAudioReactiveColour('#000000', events, 0)).toBe('#000000');
  });

  it('looks up the current clip-relative Remotion frame', () => {
    currentFrame = 4;
    render(<AudioReactiveColour
      clipId="colour-map"
      params={{
        initialColor: '#000000',
        events: [{ frame: 4, color: '#405060' }],
      }}
    />);
    expect(screen.getByTestId('audio-reactive-colour-renderer')).toHaveStyle({
      backgroundColor: '#405060',
    });
    expect(screen.getByTestId('audio-reactive-colour-renderer')).toHaveAttribute('data-frame', '4');
  });
});
