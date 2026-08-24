import {
  isCorruptionTraceEnabled,
  isRealtimeDownFixEnabled,
} from '@/integrations/supabase/config/env';
import { captureRealtimeSnapshot } from '@/integrations/supabase/utils/snapshot';
import { normalizeAndLogError } from '@/shared/lib/errorHandling/runtimeErrorReporting';
import type { DeferredSupabaseClient } from '@/integrations/supabase/deferredRuntime';
import {
  getCorruptionTimelineSnapshot,
  recordRealtimeCorruptionEvent,
  reportRealtimeCorruption,
} from './diagnosticReporters';
import { installRealtimeReferencePatchers } from './referencePatchers';

interface RealtimeClientWithInstrumentation {
  socket: WebSocket | null;
  conn?: { transport?: { ws?: WebSocket | null } };
  __REFERENCE_TRACKING_INSTALLED__?: boolean;
}

export function installRealtimeInstrumentation(supabase: DeferredSupabaseClient) {
  if (!isCorruptionTraceEnabled() && !isRealtimeDownFixEnabled()) {
    return;
  }

  if (typeof window === 'undefined' || !supabase?.realtime) {
    return;
  }

  const realtime = supabase.realtime as unknown as RealtimeClientWithInstrumentation;

  try {
    installRealtimeReferencePatchers({
      realtime,
      captureSnapshot: captureRealtimeSnapshot,
      reportCorruption: reportRealtimeCorruption,
      recordEvent: recordRealtimeCorruptionEvent,
      getTimelineSnapshot: getCorruptionTimelineSnapshot,
    });
  } catch (error) {
    normalizeAndLogError(error, {
      context: 'RealtimeInstrumentation',
          });
  }

  // Reconnect requests are emitted from explicit realtime failure paths
  // (RealtimeConnection / auth lifecycle) rather than global console interception.
}
