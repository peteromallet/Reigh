import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import type {
  VideoEditorDialogDescriptor,
  VideoEditorRenderContext,
  VideoEditorSlotRenderer,
} from '@/tools/video-editor/runtime/extensionSurface.ts';
import {
  useVideoEditorDialogDescriptors,
  useVideoEditorRenderContext,
} from '@/tools/video-editor/runtime/useVideoEditorRenderContext.ts';
import { useVideoEditorRuntime } from '@/tools/video-editor/contexts/DataProviderContext.tsx';
import {
  ExtensionRenderBoundary,
  reportExtensionRenderDiagnostic,
  type ExtensionRenderBoundaryMetadata,
} from '@/tools/video-editor/runtime/ExtensionRenderBoundary.tsx';

// ---------------------------------------------------------------------------
// Deferred descriptor renderer — defers renderer invocation into the child
// render phase so that React error boundaries can catch throws.
// ---------------------------------------------------------------------------

function DescriptorRenderer({
  renderer,
  context,
}: {
  renderer: VideoEditorSlotRenderer;
  context: VideoEditorRenderContext;
}): ReactNode {
  return renderer(context);
}

interface VideoEditorDialogHostRegistryValue {
  upsert: (ownerId: string, dialogs: readonly VideoEditorDialogDescriptor[]) => void;
  remove: (ownerId: string) => void;
}

const VideoEditorDialogHostRegistryContext = createContext<VideoEditorDialogHostRegistryValue | null>(null);

function sortDialogs(dialogs: readonly VideoEditorDialogDescriptor[]) {
  return [...dialogs].sort((left, right) => {
    const leftOrder = left.order ?? 0;
    const rightOrder = right.order ?? 0;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.id.localeCompare(right.id);
  });
}

export function VideoEditorDialogHost({
  dialogs = [],
  children,
}: PropsWithChildren<{
  dialogs?: readonly VideoEditorDialogDescriptor[];
}>) {
  const renderContext = useVideoEditorRenderContext();
  const extensionDialogs = useVideoEditorDialogDescriptors();
  const [registeredDialogs, setRegisteredDialogs] = useState<Record<string, readonly VideoEditorDialogDescriptor[]>>({});

  // Access diagnostics store for when-predicate error reporting.
  let store = null;
  try {
    const runtime = useVideoEditorRuntime();
    store = runtime.diagnosticsStore;
  } catch {
    // Runtime context not available — diagnostics will not be reported.
  }

  const registryValue = useMemo<VideoEditorDialogHostRegistryValue>(() => ({
    upsert: (ownerId, nextDialogs) => {
      setRegisteredDialogs((current) => {
        if (current[ownerId] === nextDialogs) {
          return current;
        }

        return {
          ...current,
          [ownerId]: nextDialogs,
        };
      });
    },
    remove: (ownerId) => {
      setRegisteredDialogs((current) => {
        if (!Object.prototype.hasOwnProperty.call(current, ownerId)) {
          return current;
        }

        const { [ownerId]: _removed, ...rest } = current;
        return rest;
      });
    },
  }), []);

  const resolvedDialogs = useMemo(() => {
    const localDialogs = Object.values(registeredDialogs).flat();
    return sortDialogs([
      ...extensionDialogs,
      ...dialogs,
      ...localDialogs,
    ]);
  }, [dialogs, extensionDialogs, registeredDialogs]);

  return (
    <VideoEditorDialogHostRegistryContext.Provider value={registryValue}>
      {children}
      {resolvedDialogs.map((dialog) => {
        // Wrap the when predicate with fail-closed error handling.
        let visible = true;
        if (dialog.when) {
          try {
            visible = dialog.when(renderContext);
          } catch (error) {
            const meta: ExtensionRenderBoundaryMetadata = {
              descriptorId: dialog.id,
              descriptorType: 'dialog',
            };
            reportExtensionRenderDiagnostic(
              store,
              error instanceof Error ? error : new Error(String(error)),
              meta,
              'visibility',
            );
            visible = false;
          }
        }

        if (!visible) {
          return null;
        }

        return (
          <div
            key={dialog.id}
            data-video-editor-dialog-id={dialog.id}
            data-video-editor-dialog-layer={dialog.layer ?? 'modal'}
          >
            <ExtensionRenderBoundary
              metadata={{
                descriptorId: dialog.id,
                descriptorType: 'dialog',
              }}
            >
              <DescriptorRenderer renderer={dialog.render} context={renderContext} />
            </ExtensionRenderBoundary>
          </div>
        );
      })}
    </VideoEditorDialogHostRegistryContext.Provider>
  );
}

export function useVideoEditorDialogRegistration(dialogs: readonly VideoEditorDialogDescriptor[]) {
  const registry = useContext(VideoEditorDialogHostRegistryContext);
  const ownerId = useId();

  useEffect(() => {
    if (!registry) {
      return;
    }

    registry.upsert(ownerId, dialogs);
    return () => {
      registry.remove(ownerId);
    };
  }, [dialogs, ownerId, registry]);
}
