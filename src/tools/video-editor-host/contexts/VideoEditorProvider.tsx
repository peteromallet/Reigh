import { useMemo } from 'react';
import {
  EditorProvider,
  createBrowserMediaPicker,
  type DataProvider as EditorDataProvider,
  type EditorPorts,
  type HostContext,
} from '@tbd/editor';

export function VideoEditorProvider({
  dataProvider,
  timelineId,
  timelineName,
  userId,
  children,
}: {
  dataProvider: EditorDataProvider;
  timelineId: string;
  timelineName?: string | null;
  userId: string;
  children: React.ReactNode;
}) {
  const ports = useMemo<EditorPorts>(() => ({
    dataProvider,
    mediaPicker: createBrowserMediaPicker(),
  }), [dataProvider]);

  const hostContext = useMemo<HostContext>(() => ({
    userId,
    brand: {
      appName: timelineName ?? 'Video editor',
    },
  }), [timelineName, userId]);

  return (
    <EditorProvider ports={ports} hostContext={hostContext} timelineId={timelineId}>
      {children}
    </EditorProvider>
  );
}
