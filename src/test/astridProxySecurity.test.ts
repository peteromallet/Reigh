import { describe, expect, it } from 'vitest';
import { isSameOriginLoopbackRequest } from '../../config/vite/astridProxySecurity';

describe('Astrid Vite proxy origin boundary', () => {
  it.each([
    ['http://127.0.0.1:4181', '127.0.0.1:4181'],
    ['http://localhost:5173', 'localhost:5173'],
    ['http://[::1]:4173', '[::1]:4173'],
  ])('accepts the exact loopback app listener (%s)', (origin, host) => {
    expect(isSameOriginLoopbackRequest(origin, host)).toBe(true);
  });

  it.each([
    ['https://127.0.0.1:4181', '127.0.0.1:4181'],
    ['http://127.0.0.1:9999', '127.0.0.1:4181'],
    ['http://localhost:4181', '127.0.0.1:4181'],
    ['https://evil.example', '127.0.0.1:4181'],
    ['not a url', '127.0.0.1:4181'],
    [undefined, '127.0.0.1:4181'],
    ['http://127.0.0.1:4181', undefined],
  ])('rejects a non-identical or untrusted origin (%s / %s)', (origin, host) => {
    expect(isSameOriginLoopbackRequest(origin, host)).toBe(false);
  });
});
