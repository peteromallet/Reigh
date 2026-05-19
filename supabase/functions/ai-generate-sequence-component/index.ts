// deno-lint-ignore-file
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  enforceRateLimit,
  RATE_LIMITS,
} from "../_shared/rateLimit.ts";
import { bootstrapEdgeHandler, NO_SESSION_RUNTIME_OPTIONS } from "../_shared/edgeHandler.ts";
import { jsonResponse } from "../_shared/http.ts";
import { toErrorMessage } from "../_shared/errorMessage.ts";
import {
  buildGenerateSequenceComponentMessages,
  extractSequenceComponentCodeAndMeta,
  type AllowedSequenceComponentAsset,
  type ExistingSequenceComponent,
} from "./templates.ts";

const ANTHROPIC_MODEL = "claude-opus-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_TIMEOUT_MS = 150_000;

interface LLMResponse {
  content: string;
  model: string;
}

const asStringArray = (value: unknown): string[] => {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
};

const trimString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const inferMediaTypeFromUrl = (value: unknown): AllowedSequenceComponentAsset["mediaType"] | null => {
  const url = trimString(value);
  if (!url) return null;
  const normalized = url.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  if (/\.(png|jpe?g|webp|gif|avif|bmp|svg)$/.test(normalized)) return "image";
  if (/\.(mp4|mov|webm|m4v|avi|mkv)$/.test(normalized)) return "video";
  return null;
};

const normalizeMediaType = (value: unknown): AllowedSequenceComponentAsset["mediaType"] | null => {
  const raw = trimString(value)?.toLowerCase();
  if (!raw) return null;
  if (raw === "image" || raw.startsWith("image/")) return "image";
  if (raw === "video" || raw.startsWith("video/")) return "video";
  return null;
};

const readAssetKey = (record: Record<string, unknown>): string | null => {
  for (const field of ["key", "assetKey", "asset_key", "asset", "id"]) {
    const value = trimString(record[field]);
    if (value) return value;
  }
  return null;
};

const normalizeAllowedAssets = (...sources: unknown[]): AllowedSequenceComponentAsset[] => {
  const assets = new Map<string, AllowedSequenceComponentAsset>();
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const item of source) {
      if (typeof item === "string") {
        const key = trimString(item);
        if (key && !assets.has(key)) {
          assets.set(key, { key, mediaType: "image", label: key });
        }
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const key = readAssetKey(record);
      if (!key || assets.has(key)) continue;
      const mediaType = normalizeMediaType(record.mediaType)
        ?? normalizeMediaType(record.media_type)
        ?? normalizeMediaType(record.type)
        ?? inferMediaTypeFromUrl(record.url)
        ?? inferMediaTypeFromUrl(record.src)
        ?? inferMediaTypeFromUrl(record.file)
        ?? "image";
      const label = trimString(record.label)
        ?? trimString(record.shotName)
        ?? trimString(record.shot_name)
        ?? trimString(record.name)
        ?? key;
      assets.set(key, {
        key,
        mediaType,
        label,
        ...(trimString(record.source) ? { source: trimString(record.source) as string } : {}),
      });
    }
  }
  return [...assets.values()];
};

function isExistingComponent(value: unknown): value is ExistingSequenceComponent {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.code !== "string" ||
    record.schema === null || typeof record.schema !== "object" ||
    record.defaults === null || typeof record.defaults !== "object"
  ) {
    return false;
  }
  // controls is optional and only used to surface prior manifest to the model.
  if (record.controls !== undefined && !Array.isArray(record.controls)) {
    return false;
  }
  return true;
}

async function callAnthropic(
  messages: Array<{ role: string; content: string }>,
  logger: { info: (msg: string) => void },
): Promise<LLMResponse> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("[ai-generate-sequence-component] Missing ANTHROPIC_API_KEY");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);

  const systemContent = messages.find((m) => m.role === "system")?.content;
  const chatMessages = messages.filter((m) => m.role !== "system");

  try {
    const startedAt = Date.now();
    logger.info(`[AI-GENERATE-SEQUENCE-COMPONENT] Anthropic streaming request: model=${ANTHROPIC_MODEL}`);
    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 16384,
        temperature: 0.4,
        ...(systemContent ? { system: systemContent } : {}),
        messages: chatMessages,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Anthropic ${response.status}: ${text.slice(0, 500)}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let content = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        try {
          const chunk = JSON.parse(data);
          if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
            content += chunk.delta.text;
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    content = content.trim();
    logger.info(
      `[AI-GENERATE-SEQUENCE-COMPONENT] Anthropic response in ${Date.now() - startedAt}ms, model=${ANTHROPIC_MODEL}, length=${content.length}`,
    );
    return { content, model: ANTHROPIC_MODEL };
  } finally {
    clearTimeout(timeout);
  }
}

serve(async (req) => {
  const bootstrap = await bootstrapEdgeHandler(req, {
    functionName: "ai-generate-sequence-component",
    logPrefix: "[AI-GENERATE-SEQUENCE-COMPONENT]",
    parseBody: "strict",
    auth: {
      required: true,
      options: { allowJwtUserAuth: true },
    },
    ...NO_SESSION_RUNTIME_OPTIONS,
  });
  if (!bootstrap.ok) {
    return bootstrap.response;
  }

  const { supabaseAdmin, logger, auth, body } = bootstrap.value;
  if (!auth?.userId) {
    return jsonResponse({ error: "Authentication failed" }, 401);
  }

  const rateLimitDenied = await enforceRateLimit({
    supabaseAdmin,
    functionName: "ai-generate-sequence-component",
    userId: auth.userId,
    config: RATE_LIMITS.expensive,
    logger,
    logPrefix: "[AI-GENERATE-SEQUENCE-COMPONENT]",
    responses: {
      serviceUnavailable: () => jsonResponse({ error: "Rate limit service unavailable" }, 503),
    },
  });
  if (rateLimitDenied) {
    return rateLimitDenied;
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const componentName = typeof body.name === "string" ? body.name.trim() : "";
  const themeId = typeof body.themeId === "string" ? body.themeId.trim() : "";
  const existingComponent = isExistingComponent(body.existingComponent)
    ? body.existingComponent
    : undefined;

  if (!prompt) {
    return jsonResponse({ error: "prompt is required" }, 400);
  }

  // Allowed assets are normalized to the slot contract shape for prompts.
  // allowedAssetKeys remains only a convenience list for logs/fallbacks.
  const explicitAssetKeys = asStringArray(body.allowed_asset_keys);
  const allowedAssets = normalizeAllowedAssets(body.allowed_assets, body.selected_clips, body.attached_clips);
  for (const key of explicitAssetKeys) {
    if (!allowedAssets.some((asset) => asset.key === key)) {
      allowedAssets.push({ key, mediaType: "image", label: key });
    }
  }
  const allowedAssetKeys = allowedAssets.map((asset) => asset.key);

  const retryDepth = typeof body._retryDepth === "number" ? body._retryDepth : 0;
  const retryError = typeof body._retryError === "string" ? body._retryError : undefined;
  const retryFailedCode = typeof body._retryFailedCode === "string" ? body._retryFailedCode : undefined;

  try {
    let messages: Array<{ role: string; content: string }>;

    if (retryDepth > 0 && retryFailedCode && retryError) {
      logger.info(`[AI-GENERATE-SEQUENCE-COMPONENT] retry depth=${retryDepth} — fixing: ${retryError}`);
      // For retries, fold the failed code into existingComponent so the model has the
      // fence to fix without re-sending the original existingComponent payload.
      const retryExisting: ExistingSequenceComponent = existingComponent ?? {
        code: retryFailedCode,
        schema: {},
        defaults: {},
      };
      const retryInput = buildGenerateSequenceComponentMessages({
        prompt,
        name: componentName || undefined,
        themeId: themeId || undefined,
        existingComponent: { ...retryExisting, code: retryFailedCode },
        allowedAssets,
        selectedClips: body.selected_clips,
        attachedClips: body.attached_clips,
        theme: body.theme,
        themeOverrides: body.theme_overrides,
        validationError: retryError,
      });
      messages = [
        { role: "system", content: retryInput.systemMsg },
        { role: "user", content: retryInput.userMsg },
      ];
    } else {
      const { systemMsg, userMsg } = buildGenerateSequenceComponentMessages({
        prompt,
        name: componentName || undefined,
        themeId: themeId || undefined,
        existingComponent,
        allowedAssets,
        selectedClips: body.selected_clips,
        attachedClips: body.attached_clips,
        theme: body.theme,
        themeOverrides: body.theme_overrides,
      });
      messages = [
        { role: "system", content: systemMsg },
        { role: "user", content: userMsg },
      ];
    }

    const isEditMode = Boolean(existingComponent);
    logger.info(
      `[AI-GENERATE-SEQUENCE-COMPONENT] ${retryDepth > 0 ? `retry(${retryDepth})` : isEditMode ? "edit" : "create"} → ${ANTHROPIC_MODEL} (Anthropic), allowedAssets=${allowedAssetKeys.length}`,
    );
    await logger.flush();
    const llmResponse = await callAnthropic(messages, logger);

    logger.info(
      `[AI-GENERATE-SEQUENCE-COMPONENT] raw output length=${llmResponse.content.length}, first 200 chars: ${llmResponse.content.slice(0, 200)}`,
    );

    let extracted;
    try {
      extracted = extractSequenceComponentCodeAndMeta(llmResponse.content, { allowedAssets });
    } catch (parseErr: unknown) {
      const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      logger.info(`[AI-GENERATE-SEQUENCE-COMPONENT] extraction/validation failed: ${parseMsg}`);
      logger.info(`[AI-GENERATE-SEQUENCE-COMPONENT] final output: ${llmResponse.content.slice(0, 1000)}`);
      await logger.flush();
      return jsonResponse({ error: parseMsg, rawOutput: llmResponse.content.slice(0, 500) }, 422);
    }

    const { code, name: generatedName, description, schemaJson, defaultsJson, assetSlots, controlsManifest, message } = extracted;

    if (retryDepth > 0) {
      logger.info(`[AI-GENERATE-SEQUENCE-COMPONENT] retry succeeded at depth ${retryDepth}`);
    }
    await logger.flush();
    return jsonResponse({
      code,
      name: generatedName,
      description,
      schemaJson,
      defaultsJson,
      assetSlots,
      controlsManifest,
      message: message || undefined,
      model: llmResponse.model,
    });
  } catch (err: unknown) {
    const message = toErrorMessage(err);
    console.error("[ai-generate-sequence-component] Error generating sequence component:", message);
    logger.info(`[AI-GENERATE-SEQUENCE-COMPONENT] error: ${message}`);
    await logger.flush();
    return jsonResponse({ error: "Internal server error", details: message }, 500);
  }
});
