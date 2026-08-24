import type { RenderExportDestination } from '@/tools/video-editor/lib/renderRouter.ts';

export interface RenderRuntime {
  projectId: string;
  /** Same-origin Astrid bridge base. */
  bridgeBaseUrl?: string;
  destination?: RenderExportDestination;
}

export const FALLBACK_RENDER_RUNTIME: RenderRuntime = {
  projectId: '',
};

export function createRenderRuntime(input: {
  projectId: string;
  bridgeBaseUrl?: string;
  destination?: RenderExportDestination;
}): RenderRuntime {
  return {
    projectId: input.projectId,
    bridgeBaseUrl: input.bridgeBaseUrl,
    destination: input.destination ?? 'download',
  };
}
