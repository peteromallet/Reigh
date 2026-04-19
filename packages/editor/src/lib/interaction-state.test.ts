import { describe, expect, it, vi } from 'vitest';
import {
  createInteractionState,
  isInteractionActive,
  notifyInteractionEndIfIdle,
  onInteractionEnd,
  type InteractionStateRef,
} from './interaction-state';

const makeRef = (): InteractionStateRef => ({ current: createInteractionState() });

describe('interaction-state helpers', () => {
  it('reports active when either flag is set', () => {
    const ref = makeRef();
    expect(isInteractionActive(ref)).toBe(false);
    ref.current.drag = true;
    expect(isInteractionActive(ref)).toBe(true);
    ref.current.drag = false;
    ref.current.resize = true;
    expect(isInteractionActive(ref)).toBe(true);
  });

  it('fires end listeners when both flags reach false', () => {
    const ref = makeRef();
    const listener = vi.fn();
    onInteractionEnd(ref, listener);

    ref.current.drag = true;
    notifyInteractionEndIfIdle(ref);
    expect(listener).not.toHaveBeenCalled();

    ref.current.drag = false;
    notifyInteractionEndIfIdle(ref);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps firing other listeners if one throws', () => {
    const ref = makeRef();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    onInteractionEnd(ref, () => {
      throw new Error('boom');
    });
    const listener = vi.fn();
    onInteractionEnd(ref, listener);

    notifyInteractionEndIfIdle(ref);
    expect(listener).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
