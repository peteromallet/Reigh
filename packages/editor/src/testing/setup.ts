import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

if (typeof window !== 'undefined' && !window.requestAnimationFrame) {
  window.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16);
}

if (typeof window !== 'undefined' && !window.cancelAnimationFrame) {
  window.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle);
}

if (typeof URL.createObjectURL !== 'function') {
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:editor-test'),
    revokeObjectURL: vi.fn(),
  });
}
