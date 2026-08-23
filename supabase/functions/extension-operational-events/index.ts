// deno-lint-ignore-file
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { bootstrapEdgeHandler, NO_SESSION_RUNTIME_OPTIONS } from "../_shared/edgeHandler.ts";
import { jsonResponse } from "../_shared/http.ts";
import {
  MAX_EVENTS_PER_BATCH,
  MAX_REQUEST_BYTES,
  validateOperationalBatch,
} from "./validator.ts";

const MAX_REQUESTS_PER_WINDOW = 120;
const WINDOW_MS = 60_000;
let windowStartedAt = 0;
let windowRequestCount = 0;

function allowRequest(now: number): boolean {
  if (now - windowStartedAt >= WINDOW_MS) {
    windowStartedAt = now;
    windowRequestCount = 0;
  }
  windowRequestCount += 1;
  return windowRequestCount <= MAX_REQUESTS_PER_WINDOW;
}

/**
 * Authenticated browser ingress. User identity is checked at the boundary but
 * is intentionally not persisted: the endpoint accepts no user/project
 * identity and writes via the service-role client to a table whose client
 * roles have no privileges.
 */
serve(async (req) => {
  const bootstrap = await bootstrapEdgeHandler(req, {
    functionName: "extension-operational-events",
    logPrefix: "[EXTENSION-OPERATIONAL-EVENTS]",
    parseBody: "strict",
    auth: { required: true, options: { allowJwtUserAuth: true } },
    ...NO_SESSION_RUNTIME_OPTIONS,
  });
  if (!bootstrap.ok) return bootstrap.response;
  const { supabaseAdmin, logger, body } = bootstrap.value;

  try {
    const contentLength = Number(req.headers.get('content-length') ?? '0');
    if (contentLength > MAX_REQUEST_BYTES || !allowRequest(Date.now())) {
      await logger.flush();
      return jsonResponse({ error: 'Telemetry rate or size limit exceeded' }, 429);
    }
    const events = validateOperationalBatch(body);
    if (!events) {
      await logger.flush();
      return jsonResponse({ error: `Invalid bounded telemetry batch (maximum ${MAX_EVENTS_PER_BATCH} events)` }, 400);
    }
    const { error } = await supabaseAdmin.from('extension_operational_events').insert(events);
    if (error) {
      logger.error('Operational telemetry insert failed');
      await logger.flush();
      return jsonResponse({ error: 'Telemetry unavailable' }, 503);
    }
    await logger.flush();
    return jsonResponse({ accepted: events.length });
  } catch {
    logger.error('Operational telemetry request failed');
    await logger.flush();
    return jsonResponse({ error: 'Telemetry unavailable' }, 503);
  }
});
