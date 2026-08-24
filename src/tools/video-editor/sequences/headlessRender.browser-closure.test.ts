import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * This is a source-level guard for the browser editor's import boundary.
 * Vite resolves `react-dom/server`'s default condition to the Node renderer
 * in its dependency optimizer, which externalizes `stream`/`util` and can
 * prevent the editor root from mounting. The smoke gate is intentionally
 * client-side and must use React's explicit browser renderer entry.
 */
describe('headless render browser import boundary', () => {
  it('never regresses to React DOM’s Node server entry', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/tools/video-editor/sequences/headlessRender.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/from\s+['"]react-dom\/server['"]/);
    expect(source).toMatch(/from\s+['"]react-dom\/server\.browser['"]/);
  });
});
