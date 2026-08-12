import { LOCAL_MODE_URL_PARAMS } from '@/shared/dev/devSession.ts';

/**
 * Carry the local-mode URL params (`localProject`/`localTimeline`) onto a
 * destination path so the DEV sessionless session survives navigation — the
 * auth gate and the pane chrome key off their presence on ANY route, not just
 * the editor. No-op when neither param is present, so app mode is byte-
 * identical. Existing query params on the destination are preserved.
 */
export function withLocalModeParams(path: string, search: string): string {
  const source = new URLSearchParams(search);
  if (!LOCAL_MODE_URL_PARAMS.some((name) => source.has(name))) {
    return path;
  }

  const [pathname, existingQuery = ''] = path.split('?');
  const target = new URLSearchParams(existingQuery);
  for (const name of LOCAL_MODE_URL_PARAMS) {
    if (source.has(name)) {
      target.set(name, source.get(name) ?? '');
    }
  }
  const query = target.toString();
  return query ? `${pathname}?${query}` : pathname;
}
