import {
  isCorruptionTraceEnabled,
  isWsInstrumentationEnabled,
} from '@/integrations/supabase/config/env';
import { captureRealtimeSnapshot } from '@/integrations/supabase/utils/snapshot';
import { __CORRUPTION_TIMELINE__, addCorruptionEvent } from '@/integrations/supabase/utils/timeline';
import { normalizeAndLogError } from '@/shared/lib/errorHandling/runtimeErrorReporting';
import {
  collectUnhandledRejectionInfo,
  collectWindowErrorInfo,
  isKnownSupabaseSourceLine,
  isSupabaseRealtimeRelated,
  parsePhoenixMessage,
} from './eventCollectors';
import {
  installGlobalErrorPatchers,
  installWebSocketProbe,
  type InstrumentedWindow,
} from './globalPatchers';

function installCorruptionTracePatchers(instrumentedWindow: InstrumentedWindow): void {
  installGlobalErrorPatchers({
    instrumentedWindow,
    onWindowError: (message, source, lineno, colno, error) => {
      const errorInfo = collectWindowErrorInfo({
        message,
        source,
        lineno,
        colno,
        error: error ?? null,
      });

      if (isKnownSupabaseSourceLine(source, lineno)) {
        normalizeAndLogError(new Error('[RealtimeCorruptionTrace] Supabase error captured'), {
          context: 'WindowInstrumentation',
                    logData: {
            ...errorInfo,
            realtimeSnapshot: captureRealtimeSnapshot(),
            corruptionTimeline: [...__CORRUPTION_TIMELINE__],
          },
        });
        addCorruptionEvent('SUPABASE_ERROR_2372', { ...errorInfo });
      } else if (isSupabaseRealtimeRelated(message)) {
        addCorruptionEvent('RELATED_ERROR', { ...errorInfo });
      }
    },
    onUnhandledRejection: (event) => {
      const rejectionInfo = collectUnhandledRejectionInfo(event);
      if (isSupabaseRealtimeRelated(event.reason)) {
        addCorruptionEvent('UNHANDLED_REJECTION', { ...rejectionInfo });
      }
    },
  });
}

function installWebSocketInstrumentation(instrumentedWindow: InstrumentedWindow): void {
  installWebSocketProbe({
    instrumentedWindow,
    onTrackedSocketMessage: ({ event }) => {
      try {
        const parsed = parsePhoenixMessage(event.data);
        if (parsed) {
          addCorruptionEvent('PHOENIX_MESSAGE', { ...parsed });
        }

        const snapshot = instrumentedWindow.__REALTIME_SNAPSHOT__ || {};
        instrumentedWindow.__REALTIME_SNAPSHOT__ = {
          ...snapshot,
          lastPhoenixMsgAt: Date.now(),
        };
      } catch {
        // Ignore instrumentation parse failures so realtime flow remains unaffected.
      }
    },
  });
}

export function installWindowOnlyInstrumentation() {
  if (typeof window === 'undefined') {
    return;
  }

  const instrumentedWindow = window as InstrumentedWindow;

  if (isCorruptionTraceEnabled()) {
    installCorruptionTracePatchers(instrumentedWindow);
  }

  if (isWsInstrumentationEnabled()) {
    installWebSocketInstrumentation(instrumentedWindow);
  }
}
