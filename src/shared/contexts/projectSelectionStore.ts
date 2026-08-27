/**
 * Runtime project selection snapshot for non-React consumers.
 *
 * This replaces ad-hoc window globals with an explicit typed access layer.
 */
const PROJECT_SELECTION_STORAGE_KEY = 'lastSelectedProjectId';

function readLocalProjectFromUrl(): string | null {
  if (typeof window === 'undefined') return null;

  const slug = new URLSearchParams(window.location.search).get('localProject')?.trim();
  return slug || null;
}

function isLocalModeUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.has('localProject') || params.has('localTimeline');
}

interface ProjectSelectionSnapshot {
  selectedProjectId: string | null;
}

type ProjectSelectionListener = (snapshot: ProjectSelectionSnapshot) => void;

function readPersistedProjectSelection(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const persisted = window.localStorage.getItem(PROJECT_SELECTION_STORAGE_KEY);
    return persisted && persisted.trim().length > 0 ? persisted : null;
  } catch {
    return null;
  }
}

function normalizeSelectedProjectId(selectedProjectId: string | null | undefined): string | null {
  return selectedProjectId && selectedProjectId.trim().length > 0 ? selectedProjectId : null;
}

let snapshot: ProjectSelectionSnapshot = { selectedProjectId: null };
let initialized = false;
const listeners = new Set<ProjectSelectionListener>();

export function initializeProjectSelectionStore(
  initialSelectedProjectId: string | null = isLocalModeUrl()
    ? readLocalProjectFromUrl()
    : readPersistedProjectSelection(),
): ProjectSelectionSnapshot {
  const normalized: ProjectSelectionSnapshot = {
    selectedProjectId: normalizeSelectedProjectId(initialSelectedProjectId),
  };
  const shouldNotify = initialized && snapshot.selectedProjectId !== normalized.selectedProjectId;
  snapshot = normalized;
  initialized = true;

  if (shouldNotify) {
    for (const listener of listeners) {
      listener(normalized);
    }
  }

  return getProjectSelectionSnapshot();
}

export function setProjectSelectionSnapshot(next: ProjectSelectionSnapshot): void {
  initializeProjectSelectionStore(next.selectedProjectId ?? null);
}

/** Update the fallback used by non-React bridge consumers. */
export function setProjectSelectionFallbackId(selectedProjectId: string | null): void {
  setProjectSelectionSnapshot({ selectedProjectId });
}

export function getProjectSelectionSnapshot(): ProjectSelectionSnapshot {
  return { ...snapshot };
}

export function getProjectSelectionFallbackId(): string | null {
  // The URL remains authoritative during local navigation, including for
  // consumers that render before ProjectProvider's synchronization effect.
  return isLocalModeUrl() ? readLocalProjectFromUrl() : snapshot.selectedProjectId;
}

/** @internal Only for test isolation — do not call in production code. */
export function resetProjectSelectionStoreForTests(): void {
  snapshot = { selectedProjectId: null };
  initialized = false;
  listeners.clear();
}
