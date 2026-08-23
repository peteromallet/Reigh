import type { ReighExtension } from '@reigh/editor-sdk';
import { branchingCutExtension } from './branching-cut';
import { captionSafeZoneOrchestraExtension } from './caption-safe-zone-orchestra';
import { chromaticConstellationExtension } from './chromatic-constellation';
import { emotionalWeatherMapExtension } from './emotional-weather-map';
import { foleyConstellationExtension } from './foley-constellation';
import { locklineInspectorExtension } from './lockline-inspector';
import { pulseMapExtension } from './pulse-map';
import { recallPulseExtension } from './recall-pulse';
import { soundtrackCartographerExtension } from './soundtrack-cartographer';
import { timelineFaultlineExtension } from './timeline-faultline';

/** The ten DEV-local extensions selected from the Luna persona ideation pass. */
export const creativeLabExtensions: readonly ReighExtension[] = Object.freeze([
  pulseMapExtension,
  soundtrackCartographerExtension,
  captionSafeZoneOrchestraExtension,
  emotionalWeatherMapExtension,
  timelineFaultlineExtension,
  foleyConstellationExtension,
  branchingCutExtension,
  chromaticConstellationExtension,
  recallPulseExtension,
  locklineInspectorExtension,
]);
