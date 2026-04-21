import { createContext, useContext } from 'react';
import type { EditorPorts, HostContext } from '../data/ports.js';

export interface EditorRuntimeContextValue {
  ports: EditorPorts;
  hostContext: HostContext;
  timelineId: string;
}

const EditorRuntimeContext = createContext<EditorRuntimeContextValue | null>(null);

export function EditorRuntimeProvider({
  value,
  children,
}: {
  value: EditorRuntimeContextValue;
  children: React.ReactNode;
}) {
  return (
    <EditorRuntimeContext.Provider value={value}>
      {children}
    </EditorRuntimeContext.Provider>
  );
}

export function useEditorRuntime(): EditorRuntimeContextValue {
  const value = useContext(EditorRuntimeContext);
  if (!value) {
    throw new Error('useEditorRuntime must be used within EditorRuntimeProvider');
  }
  return value;
}

export function useOptionalEditorRuntime(): EditorRuntimeContextValue | null {
  return useContext(EditorRuntimeContext);
}
