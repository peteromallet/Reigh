import type { SequenceComponentResource } from '@/tools/video-editor/hooks/useSequenceResources.ts';

/** Library tab: saved sequence-component resources, newest first. */
export function SequenceCreatorLibraryList({
  libraryComponents,
  isLoading,
  onLoadLibraryComponent,
}: {
  libraryComponents: SequenceComponentResource[];
  isLoading: boolean;
  onLoadLibraryComponent: (resource: SequenceComponentResource) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">Your saved sequences</div>
        <div className="text-xs text-muted-foreground">{libraryComponents.length}</div>
      </div>
      {isLoading && libraryComponents.length === 0 ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : libraryComponents.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          No saved sequences yet. Generate one and Insert it to save.
        </div>
      ) : (
        <div className="space-y-2">
          {libraryComponents.map((resource) => (
            <button
              key={resource.id}
              type="button"
              onClick={() => onLoadLibraryComponent(resource)}
              className="w-full rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="truncate text-sm font-medium text-foreground">
                    {resource.name || 'Untitled component'}
                  </div>
                  {resource.description && (
                    <div className="line-clamp-2 text-xs text-muted-foreground">
                      {resource.description}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-2 truncate text-right text-xs text-muted-foreground">
                {resource.clipType}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
