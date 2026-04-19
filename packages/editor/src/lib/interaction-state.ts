import type { MutableRefObject } from 'react';

export interface InteractionState {
  drag: boolean;
  resize: boolean;
  listeners: Set<() => void>;
}

export type InteractionStateRef = MutableRefObject<InteractionState>;

export function createInteractionState(): InteractionState {
  return { drag: false, resize: false, listeners: new Set() };
}

export function isInteractionActive(ref: InteractionStateRef): boolean {
  return ref.current.drag || ref.current.resize;
}

export function onInteractionEnd(
  ref: InteractionStateRef,
  cb: () => void,
): () => void {
  ref.current.listeners.add(cb);
  return () => {
    ref.current.listeners.delete(cb);
  };
}

export function notifyInteractionEndIfIdle(ref: InteractionStateRef): void {
  if (ref.current.drag || ref.current.resize) {
    return;
  }

  const listeners = [...ref.current.listeners];
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.error('[interaction-state] listener threw', error);
    }
  }
}
