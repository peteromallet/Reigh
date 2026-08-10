import { initializeLoggerRuntime, reactProfilerOnRender } from '@/shared/lib/logger';
import { registerDebugGlobals } from '@/shared/lib/debug/debugConfig';

import { createRoot } from 'react-dom/client';
import { Profiler } from 'react';
import { App } from '@/app/App';
import { AppErrorBoundary } from '@/app/components/error/AppErrorBoundary';
import { initializeSupabaseResult } from '@/integrations/supabase/client';
import { toast } from '@/shared/components/ui/runtime/sonner';
import { initializeToastManager } from '@/shared/runtime/toastRuntime';
import { installErrorNotifier } from '@/shared/lib/errorHandling/errorNotifier';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { notifyError } from '@/shared/lib/errorHandling/notifyError';
import { installRuntimeErrorPresenter } from '@/shared/lib/errorHandling/runtimeErrorPresenter';
import { initializeViewportLockRuntime } from '@/shared/runtime/viewportLockRuntime';
import { initializeProjectSelectionStore } from '@/shared/contexts/projectSelectionStore';
import { initializePreloadingService } from '@/shared/lib/preloading';
import { initializeToolSettingsWriteRuntime } from '@/shared/settings';
import { initializeNetworkStatusManager } from '@/shared/services/network/networkStatusManager';
import {
  hasLocalModeUrlParams,
  writeStoredLocalModeFlag,
} from '@/shared/dev/devSession';
import '@/index.css';

let presenterInstalled = false;
const ERROR_NOTIFIER_OWNER = 'app-bootstrap';
let environmentInitialized = false;

interface RuntimeEnvironment {
  MODE?: string;
  DEV?: boolean;
  VITEST?: unknown;
}

function isTestRuntimeEnvironment(env: RuntimeEnvironment): boolean {
  return env.MODE === 'test' || Boolean(env.VITEST);
}

export function shouldLoadAutoplayMonitor(env: RuntimeEnvironment): boolean {
  return !isTestRuntimeEnvironment(env) && Boolean(env.DEV);
}

export function shouldLoadDevDebugTools(env: RuntimeEnvironment): boolean {
  return !isTestRuntimeEnvironment(env) && Boolean(env.DEV);
}

function registerToastErrorPresenter(): void {
  if (presenterInstalled) {
    return;
  }

  installRuntimeErrorPresenter((appError, toastTitle) => notifyError(appError, toastTitle));
  installErrorNotifier(({ title, description }) => {
    toast({
      title,
      description,
      variant: 'destructive',
    });
  }, ERROR_NOTIFIER_OWNER);
  presenterInstalled = true;
}

export function initializeAppEnvironment(): void {
  if (environmentInitialized) {
    return;
  }

  initializeLoggerRuntime();
  const env = import.meta.env;
  initializeToastManager();
  registerToastErrorPresenter();
  initializeViewportLockRuntime();
  initializeProjectSelectionStore();
  initializeToolSettingsWriteRuntime();
  initializePreloadingService();
  if (typeof window !== 'undefined') {
    initializeNetworkStatusManager();
  }

  // Initialize autoplay monitoring in development (after console suppression check)
  if (shouldLoadAutoplayMonitor(env)) {
    import('@/shared/lib/debug/autoplayMonitor');
  }

  // Attach debugConfig to window for console access in dev
  if (shouldLoadDevDebugTools(env)) {
    registerDebugGlobals();
  }

  // Debug tooling is intentionally loaded only for local dev runtime, never test/prod.
  if (shouldLoadDevDebugTools(env)) {
    import('@/shared/lib/simpleCacheValidator');
    import('@/shared/lib/debug/debugPolling');
    import('@/shared/lib/debug/mobileProjectDebug');
  }

  // Dev-only: a pasted local-mode editor URL opens the editor with no sign-in.
  // The editor's local mode reads the timeline from the Astrid bridge and needs
  // no session — and crucially, no session must be created: a fake Supabase
  // login would make the app-wide providers (user settings, projects, credits)
  // fetch real data against a non-existent backend and fail. The auth gate
  // itself exempts the local-mode editor route in DEV (`Layout.tsx`), so
  // nothing here needs to write localStorage. See `dev/devSession.ts`.
  if (import.meta.env.DEV && !isTestRuntimeEnvironment(env) && typeof window !== 'undefined') {
    if (hasLocalModeUrlParams(window.location.search)) {
      try {
        writeStoredLocalModeFlag(window.localStorage);
      } catch {
        // Restricted storage — the developer just uses the full editor URL.
      }
    }
  }

  // Initialize dark mode from localStorage (prevents flash of wrong theme).
  const storedDarkMode = localStorage.getItem('dark-mode');
  if (storedDarkMode === null || storedDarkMode === 'true') {
    document.documentElement.classList.add('dark');
  }

  if (!isTestRuntimeEnvironment(env)) {
    const supabaseInitResult = initializeSupabaseResult();
    if (!supabaseInitResult.ok) {
      normalizeAndPresentError(supabaseInitResult.error, {
        context: 'initializeAppEnvironment.initializeSupabase',
        showToast: false,
      });
    }

    if (supabaseInitResult.ok && shouldLoadDevDebugTools(env)) {
      import('@/integrations/supabase/support/debug/initializeSupabaseDebugGlobals')
        .then(({ initializeSupabaseDebugGlobals }) => {
          initializeSupabaseDebugGlobals();
        })
        .catch((error) => {
          normalizeAndPresentError(error, {
            context: 'initializeAppEnvironment.initializeSupabaseDebugGlobals',
            showToast: false,
          });
          return undefined;
        });
      import('@/shared/realtime/DataFreshnessManager')
        .then(({ registerDataFreshnessManagerDebugGlobal }) => {
          registerDataFreshnessManagerDebugGlobal();
        })
        .catch((error) => {
          normalizeAndPresentError(error, {
            context: 'initializeAppEnvironment.registerDataFreshnessManagerDebugGlobal',
            showToast: false,
          });
          return undefined;
        });
    }
  }

  environmentInitialized = true;
}

export function renderApp(rootElement: HTMLElement): void {
  initializeAppEnvironment();
  createRoot(rootElement).render(
    <AppErrorBoundary>
      <Profiler id="Root" onRender={reactProfilerOnRender}>
        <App />
      </Profiler>
    </AppErrorBoundary>
  );
}
