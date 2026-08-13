import { useEffect, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover.tsx';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/shared/components/ui/command.tsx';
import { ChevronsUpDown, FolderKanban, HardDrive } from 'lucide-react';
import { cn } from '@/shared/components/ui/contracts/cn.ts';
import type { Project } from '@/types/project';
import type { UseAstridBridgeDiscoveryResult } from '@/tools/video-editor/hooks/useAstridBridgeDiscovery.ts';

export type EditorMode = 'app' | 'local';

/** Project selector value namespace: `app:<id>` / `local:<slug>`. */
export const APP_PROJECT_VALUE_PREFIX = 'app:';
export const LOCAL_PROJECT_VALUE_PREFIX = 'local:';

interface EditorProjectTimelineSelectorsProps {
  mode: EditorMode;
  /** Cloud (Supabase) projects from the app-shell project list. */
  appProjects: Project[];
  appProjectsLoading: boolean;
  selectedAppProjectId: string | null;
  localProjectSlug: string | null;
  localTimelineId: string | null;
  localTimelineName: string | null;
  /** Result of `useAstridBridgeDiscovery` (owned by the page). */
  discovery: UseAstridBridgeDiscoveryResult;
  /** Called with a namespaced project value (`app:<id>` / `local:<slug>`). */
  onSelectProject: (value: string) => void;
  /** Called with a local timeline id. App-mode timelines are handled by the
   *  existing app timeline restore/first/create flow, so the timeline dropdown
   *  is local-only (see the implementation report). */
  onSelectTimeline: (timelineId: string) => void;
  /** Disables the triggers while a save is in flight. */
  disabled?: boolean;
  /** Reports whether any dropdown is open (drives discovery refetch/polling). */
  onOpenChange?: (open: boolean) => void;
}

const triggerClass = cn(
  'flex h-7 items-center gap-1.5 rounded-md border border-border/70 bg-card/80 px-2 text-xs',
  'text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  'disabled:pointer-events-none disabled:opacity-50',
);

export function EditorProjectTimelineSelectors({
  mode,
  appProjects,
  appProjectsLoading,
  selectedAppProjectId,
  localProjectSlug,
  localTimelineId,
  localTimelineName,
  discovery,
  onSelectProject,
  onSelectTimeline,
  disabled = false,
  onOpenChange,
}: EditorProjectTimelineSelectorsProps) {
  const [projectOpen, setProjectOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);

  useEffect(() => {
    onOpenChange?.(projectOpen || timelineOpen);
  }, [projectOpen, timelineOpen, onOpenChange]);

  const localProjects = discovery.projectsQuery.data?.projects ?? [];
  const localTimelines = discovery.timelinesQuery.data?.timelines ?? [];

  const selectedAppProject = appProjects.find((project) => project.id === selectedAppProjectId);
  const projectTriggerLabel = mode === 'local'
    ? (localProjectSlug ?? 'Select project')
    : (selectedAppProject?.name ?? 'Select project');
  const timelineTriggerLabel = localTimelineName ?? localTimelineId ?? 'Timeline';

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="editor-project-timeline-selectors">
      <Popover open={projectOpen} onOpenChange={setProjectOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={projectOpen}
            aria-label="Select project"
            disabled={disabled}
            className={cn(triggerClass, 'max-w-56')}
          >
            {mode === 'local' ? (
              <HardDrive className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <FolderKanban className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">{projectTriggerLabel}</span>
            <ChevronsUpDown className="ml-auto h-3.5 w-3.5 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search projects..." className="h-8" />
            <CommandList>
              <CommandEmpty>No projects found.</CommandEmpty>
              <CommandGroup heading="Reigh projects">
                {appProjects.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-muted-foreground" data-testid="app-projects-empty">
                    {appProjectsLoading ? 'Loading projects…' : 'No Reigh projects available.'}
                  </div>
                ) : (
                  appProjects.map((project) => (
                    <CommandItem
                      key={`${APP_PROJECT_VALUE_PREFIX}${project.id}`}
                      value={`${APP_PROJECT_VALUE_PREFIX}${project.id}`}
                      keywords={[project.name, project.id]}
                      onSelect={() => {
                        onSelectProject(`${APP_PROJECT_VALUE_PREFIX}${project.id}`);
                        setProjectOpen(false);
                      }}
                    >
                      <FolderKanban className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{project.name}</span>
                    </CommandItem>
                  ))
                )}
              </CommandGroup>
              <CommandGroup heading="Local (Astrid)">
                {localProjects.length === 0 ? (
                  <div className="space-y-1.5 px-2 py-3 text-xs text-muted-foreground" data-testid="local-projects-empty">
                    {discovery.healthQuery.isLoading ? (
                      <p>Checking local bridge…</p>
                    ) : discovery.projectsQuery.isLoading ? (
                      <p>Loading local projects…</p>
                    ) : discovery.bridgeDown ? (
                      <>
                        <p className="font-medium text-foreground">No local Astrid projects found</p>
                        <p>
                          Launch the bridge:{' '}
                          <code className="rounded bg-muted px-1 py-0.5">cd ../Astrid &amp;&amp; astrid serve --port 17333</code>
                        </p>
                        <p>
                          Or run <code className="rounded bg-muted px-1 py-0.5">npm run dev:editor:bridge</code>
                        </p>
                      </>
                    ) : (
                      <p>Start astrid serve with a projects root that contains project.json files.</p>
                    )}
                  </div>
                ) : (
                  localProjects.map((project) => (
                    <CommandItem
                      key={`${LOCAL_PROJECT_VALUE_PREFIX}${project.slug}`}
                      value={`${LOCAL_PROJECT_VALUE_PREFIX}${project.slug}`}
                      keywords={[project.name, project.slug]}
                      onSelect={() => {
                        onSelectProject(`${LOCAL_PROJECT_VALUE_PREFIX}${project.slug}`);
                        setProjectOpen(false);
                      }}
                    >
                      <HardDrive className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{project.name}</span>
                      <span className="ml-auto shrink-0 pl-2 font-mono text-[10px] text-muted-foreground">
                        {project.slug}
                      </span>
                    </CommandItem>
                  ))
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* App-mode timelines flow through the existing app restore/first/create
          logic (see VideoEditorPage), so the timeline dropdown is local-only. */}
      {mode === 'local' && (
        <Popover open={timelineOpen} onOpenChange={setTimelineOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              role="combobox"
              aria-expanded={timelineOpen}
              aria-label="Select timeline"
              disabled={disabled}
              className={cn(triggerClass, 'max-w-48')}
            >
              <span className="truncate">{timelineTriggerLabel}</span>
              <ChevronsUpDown className="ml-auto h-3.5 w-3.5 shrink-0 opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search timelines..." className="h-8" />
              <CommandList>
                <CommandEmpty>No timelines found.</CommandEmpty>
                <CommandGroup heading="Timelines">
                  {localTimelines.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground" data-testid="local-timelines-empty">
                      {discovery.timelinesQuery.isLoading ? 'Loading timelines…' : 'No timelines for this project yet.'}
                    </div>
                  ) : (
                    localTimelines.map((timeline) => (
                      <CommandItem
                        key={timeline.timeline_id}
                        value={timeline.timeline_id}
                        keywords={[timeline.name, timeline.timeline_id, timeline.slug ?? '']}
                        onSelect={() => {
                          // The ULID is the routable address for bridge
                          // requests; the canonical timeline_id is identity.
                          onSelectTimeline(timeline.timeline_ulid ?? timeline.timeline_id);
                          setTimelineOpen(false);
                        }}
                      >
                        <span className="truncate">{timeline.name}</span>
                        {timeline.is_default && (
                          <span className="ml-auto shrink-0 pl-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                            Default
                          </span>
                        )}
                      </CommandItem>
                    ))
                  )}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
