import { afterEach, describe, expect, it } from 'vitest';
import {
  initializeLocalTestRuntime,
  isLocalTestMode,
  publishLocalTestExtensionDiagnostics,
} from './localTestRuntime';

describe('local test runtime', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    delete window.__REIGH_LOCAL_TEST__;
  });

  it('requires both DEV and the exact localTest=1 query value', () => {
    expect(isLocalTestMode({ DEV: true }, '?localTest=1')).toBe(true);
    expect(isLocalTestMode({ DEV: true }, '?localTest=0')).toBe(false);
    expect(isLocalTestMode({ DEV: false }, '?localTest=1')).toBe(false);
  });

  it('publishes stable loader and runtime diagnostic channels', () => {
    window.history.replaceState({}, '', '/tools/video-editor?localTest=1');
    initializeLocalTestRuntime();
    publishLocalTestExtensionDiagnostics('runtime', [{
      extensionId: 'com.reigh.zed',
      source: 'extension',
      severity: 'error',
      code: 'runtime/z',
      message: 'Zed failed',
    }, {
      extensionId: 'com.reigh.alpha',
      source: 'extension',
      severity: 'warning',
      code: 'runtime/a',
      message: 'Alpha warned',
    }]);

    expect(window.__REIGH_LOCAL_TEST__).toMatchObject({
      enabled: true,
      diagnostics: {
        loader: [],
        runtime: [
          { extensionId: 'com.reigh.alpha', code: 'runtime/a' },
          { extensionId: 'com.reigh.zed', code: 'runtime/z' },
        ],
      },
    });
  });
});
