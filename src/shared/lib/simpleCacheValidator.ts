import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import {
  debugChannelEnabled,
  debugLog,
  disableDebugChannel,
  enableDebugChannel,
} from '@/shared/lib/debug/debugConsole';

type CacheDebugApi = {
  enable: () => void;
  disable: () => void;
  validate: () => Promise<void>;
  startWatch: () => void;
  stopWatch: () => void;
  stats: () => void;
  help: () => void;
};

type CacheDebugWindow = Window & {
  cacheDebug?: CacheDebugApi;
  validateImageCache?: () => Promise<void>;
  startCacheWatch?: () => void;
  stopCacheWatch?: () => void;
  showCacheStats?: () => void;
  showCacheHelp?: () => void;
};

const isDev = Boolean(
  (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.DEV,
);

const CACHE_CHANNEL = 'cache' as const;

const getMediaStats = () => {
  // Storage-host DOM probes were removed with the signed/public-URL cut;
  // the debug stats now count rendered media generically.
  const images = document.querySelectorAll('img');
  const videos = document.querySelectorAll('video');
  return {
    visibleImages: images.length,
    visibleVideos: videos.length,
    totalVisibleMedia: images.length + videos.length,
    timestamp: new Date().toISOString(),
  };
};

const getPageInfo = () => {
  const paginationText = document
    .querySelector('[class*="text-sm"][class*="muted-foreground"]')
    ?.textContent;
  const pageMatch = paginationText?.match(/(\d+)-(\d+) of (\d+)/);

  if (!pageMatch) {
    return null;
  }

  const [, start, end, total] = pageMatch;
  return {
    currentPage: Math.ceil(parseInt(start, 10) / 25),
    itemRange: `${start}-${end}`,
    totalItems: total,
    estimatedTotalPages: Math.ceil(parseInt(total, 10) / 25),
  };
};

const getStorageInfo = async () => {
  if (!('storage' in navigator) || !('estimate' in navigator.storage)) {
    return null;
  }

  const estimate = await navigator.storage.estimate();
  return {
    usageInMB: Math.round((estimate.usage || 0) / 1024 / 1024),
    quotaInMB: Math.round((estimate.quota || 0) / 1024 / 1024),
    usagePercent: Math.round(((estimate.usage || 0) / (estimate.quota || 1)) * 100),
  };
};

if (typeof window !== 'undefined' && isDev) {
  const debugWindow = window as CacheDebugWindow;
  let watchIntervalId: number | null = null;

  const stopWatch = () => {
    if (watchIntervalId === null) {
      return;
    }

    clearInterval(watchIntervalId);
    watchIntervalId = null;
    disableDebugChannel(CACHE_CHANNEL);
    debugLog(CACHE_CHANNEL, 'Cache watch stopped.', undefined, true);
  };

  const cacheDebug: CacheDebugApi = {
    enable: () => {
      enableDebugChannel(CACHE_CHANNEL);
      debugLog(CACHE_CHANNEL, 'Cache debug channel enabled.', undefined, true);
    },
    disable: () => {
      stopWatch();
      disableDebugChannel(CACHE_CHANNEL);
      debugLog(CACHE_CHANNEL, 'Cache debug channel disabled.', undefined, true);
    },
    validate: async () => {
      try {
        const [storage, media] = await Promise.all([
          getStorageInfo(),
          Promise.resolve(getMediaStats()),
        ]);

        debugLog(
          CACHE_CHANNEL,
          'Validation snapshot',
          {
            media,
            page: getPageInfo(),
            storage,
          },
          true,
        );
      } catch (error) {
        normalizeAndPresentError(error, { context: 'SimpleCacheValidator.validate', showToast: false });
      }
    },
    startWatch: () => {
      if (watchIntervalId !== null) {
        return;
      }

      enableDebugChannel(CACHE_CHANNEL);
      let lastMediaCount = -1;
      watchIntervalId = window.setInterval(() => {
        try {
          const stats = getMediaStats();
          if (stats.totalVisibleMedia !== lastMediaCount) {
            lastMediaCount = stats.totalVisibleMedia;
            debugLog(CACHE_CHANNEL, 'Media changed', stats);
          }
        } catch {
          // Ignore transient DOM read errors while polling.
        }
      }, 1000);

      debugLog(CACHE_CHANNEL, 'Cache watch started (1s).');
    },
    stopWatch: () => {
      stopWatch();
    },
    stats: () => {
      debugLog(CACHE_CHANNEL, 'Cache stats', getMediaStats(), true);
    },
    help: () => {
      debugLog(
        CACHE_CHANNEL,
        'cacheDebug.{enable,disable,validate,startWatch,stopWatch,stats}',
        { channelEnabled: debugChannelEnabled(CACHE_CHANNEL) },
        true,
      );
    },
  };

  debugWindow.cacheDebug = cacheDebug;

  // Backward-compatible aliases for existing console workflows.
  debugWindow.validateImageCache = cacheDebug.validate;
  debugWindow.startCacheWatch = cacheDebug.startWatch;
  debugWindow.stopCacheWatch = cacheDebug.stopWatch;
  debugWindow.showCacheStats = cacheDebug.stats;
  debugWindow.showCacheHelp = cacheDebug.help;
}
