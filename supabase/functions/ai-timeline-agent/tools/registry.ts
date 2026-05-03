import { parseCommand, validateCommand, type ParsedCommand } from "../command-parser.ts";
import {
  loadTimelineState,
  prepareTimelineConfigForPersistence,
  saveTimelineConfigVersioned,
} from "../db.ts";
import type { AssetRegistryEntry } from "../../../../src/tools/video-editor/types/index.ts";
import type {
  SupabaseAdmin,
  TimelineState,
  ToolContext,
  ToolResult,
} from "../types.ts";
import { handlers as timelineHandlers } from "./timeline.ts";
import { createGenerationTask } from "./generation.ts";

// Map parsed command types to timeline tool names
const COMMAND_TO_TOOL: Record<string, string> = {
  view: "view_timeline",
  move: "move_clip",
  split: "split_clip",
  trim: "trim_clip",
  delete: "delete_clip",
  set: "set_clip_property",
  "set-text": "set_text_content",
  duplicate: "duplicate_clip",
  "add-media": "add_media_clip",
  swap: "swap_clip_asset",
  "add-text": "add_text_clip",
  query: "query_timeline",
  "find-issues": "find_issues",
  // "repeat" is handled specially in executeCommand, not mapped to a tool
};

function commandToToolArgs(parsed: ParsedCommand): Record<string, unknown> {
  switch (parsed.type) {
    case "view": return {};
    case "move": return { clipId: parsed.clipId, at: parsed.at };
    case "split": return { clipId: parsed.clipId, time: parsed.time };
    case "trim": return { clipId: parsed.clipId, from: parsed.from, to: parsed.to, duration: parsed.duration };
    case "delete": return { clipId: parsed.clipId };
    case "set-text": return { clipId: parsed.clipId, text: parsed.text };
    case "duplicate": return { clipId: parsed.clipId, count: parsed.count };
    case "set": return { clipId: parsed.clipId, property: parsed.property, value: parsed.value };
    case "add-text": return { track: parsed.track, at: parsed.at, duration: parsed.duration, text: parsed.text };
    case "add-media": return { track: parsed.track, at: parsed.at, mediaType: parsed.mediaType };
    case "swap": return { clipId: parsed.clipId };
    case "query": return {};
    case "find-issues": return {};
    case "generate": return { prompt: parsed.prompt, count: parsed.count };
    default: return {};
  }
}

function buildContext(state: TimelineState): ToolContext {
  return {
    config: state.config,
    registry: state.registry,
    projectId: state.projectId,
    shotNamesById: state.shotNamesById,
  };
}

export async function executeCommand(
  command: string,
  state: TimelineState,
  timelineId: string,
  supabaseAdmin: SupabaseAdmin,
): Promise<ToolResult> {
  const parsed = parseCommand(command);

  if (parsed.type === "error") {
    return { result: parsed.message };
  }

  // Validate against current timeline state
  const validationError = validateCommand(parsed, state.config, state.registry);
  if (validationError) {
    return { result: validationError };
  }

  // Handle repeat: expand template, execute all in memory, save once at end
  if (parsed.type === "repeat") {
    state.previousConfig = structuredClone(state.config);
    const errorMessages: string[] = [];
    let errors = 0;
    let succeeded = 0;

    for (let i = 0; i < parsed.count; i++) {
      const value = parsed.from + parsed.step * i;
      const roundedValue = Math.round(value * 1000) / 1000;
      const expanded = parsed.template.replace(
        new RegExp(`\\{${parsed.varName}\\}`, "g"),
        String(roundedValue),
      );

      // Parse and validate the sub-command but execute in memory only (no DB save)
      const subParsed = parseCommand(expanded);
      if (subParsed.type === "error") {
        errorMessages.push(`${i + 1}. ${subParsed.message}`);
        errors++;
        if (errors >= 3) { errorMessages.push("Stopped after 3 errors."); break; }
        continue;
      }

      const subValidation = validateCommand(subParsed, state.config, state.registry);
      if (subValidation) {
        errorMessages.push(`${i + 1}. ${subValidation}`);
        errors++;
        if (errors >= 3) { errorMessages.push("Stopped after 3 errors."); break; }
        continue;
      }

      if (subParsed.type === "add-media" || subParsed.type === "swap") {
        errorMessages.push(`${i + 1}. ${subParsed.type} is not supported inside repeat.`);
        errors++;
        if (errors >= 3) { errorMessages.push("Stopped after 3 errors."); break; }
        continue;
      }

      const toolName = COMMAND_TO_TOOL[subParsed.type];
      const handler = toolName ? timelineHandlers[toolName] : undefined;
      if (!handler) {
        errorMessages.push(`${i + 1}. No handler for "${subParsed.type}".`);
        errors++;
        continue;
      }

      const args = commandToToolArgs(subParsed);
      const ctx = buildContext(state);
      const result = await handler(args, ctx);

      if (result.config) {
        // Apply to in-memory state without saving to DB
        state.config = result.config;
      }
      succeeded++;
    }

    // Save once at the end
    if (succeeded > 0) {
      const nextVersion = await saveTimelineConfigVersioned(
        supabaseAdmin, timelineId, state.configVersion, state.config,
      );
      if (nextVersion !== null) {
        state.configVersion = nextVersion;
      } else {
        return { result: `Executed ${succeeded} commands in memory but failed to save — version conflict.` };
      }
    }

    return {
      config: succeeded > 0 ? state.config : undefined,
      result: `Repeated ${succeeded}/${parsed.count}.${errorMessages.length > 0 ? "\n" + errorMessages.join("\n") : ""}`,
    };
  }

  // Handle generation separately (async, not a timeline tool)
  if (parsed.type === "generate") {
    return await createGenerationTask({
      project_id: state.projectId,
      prompt: parsed.prompt,
      count: 1,
    });
  }

  let handlerArgs: Record<string, unknown> | null = null;
  if (parsed.type === "add-media") {
    const assetKey = `asset-${crypto.randomUUID().slice(0, 6)}`;
    const assetEntry: AssetRegistryEntry = {
      file: parsed.url,
      type: parsed.mediaType === "video" ? "video/mp4" : "image/png",
      generationId: parsed.generationId,
    };

    const { error } = await supabaseAdmin.rpc("upsert_asset_registry_entry", {
      p_timeline_id: timelineId,
      p_asset_id: assetKey,
      p_entry: assetEntry,
    }).maybeSingle();
    if (error) {
      return { result: `Failed to register asset ${assetKey}: ${error.message}` };
    }

    state.registry = {
      ...state.registry,
      assets: {
        ...state.registry.assets,
        [assetKey]: assetEntry,
      },
    };
    handlerArgs = {
      track: parsed.track,
      at: parsed.at,
      assetKey,
      mediaType: parsed.mediaType,
    };
  }

  if (parsed.type === "swap") {
    const assetKey = `asset-${crypto.randomUUID().slice(0, 6)}`;
    const assetEntry: AssetRegistryEntry = {
      file: parsed.url,
      type: parsed.mediaType === "video" ? "video/mp4" : "image/png",
      generationId: parsed.generationId,
    };

    const { error } = await supabaseAdmin.rpc("upsert_asset_registry_entry", {
      p_timeline_id: timelineId,
      p_asset_id: assetKey,
      p_entry: assetEntry,
    }).maybeSingle();
    if (error) {
      return { result: `Failed to register asset ${assetKey}: ${error.message}` };
    }

    state.registry = {
      ...state.registry,
      assets: {
        ...state.registry.assets,
        [assetKey]: assetEntry,
      },
    };
    handlerArgs = {
      clipId: parsed.clipId,
      assetKey,
      mediaType: parsed.mediaType,
    };
  }

  if (parsed.type === "undo") {
    if (!state.previousConfig) {
      return { result: "Nothing to undo." };
    }

    const nextVersion = await saveTimelineConfigVersioned(
      supabaseAdmin,
      timelineId,
      state.configVersion,
      state.previousConfig,
    );

    if (nextVersion === null) {
      return { result: "Version conflict. Please retry." };
    }

    const oldConfig = state.config;
    state.config = state.previousConfig;
    state.previousConfig = oldConfig;
    state.configVersion = nextVersion;
    return {
      config: state.config,
      result: "Undid the last timeline change.",
    };
  }

  if (parsed.type !== "view" && parsed.type !== "query" && parsed.type !== "find-issues") {
    state.previousConfig = structuredClone(state.config);
  }

  // Route to timeline tool
  const toolName = COMMAND_TO_TOOL[parsed.type];
  const handler = toolName ? timelineHandlers[toolName] : undefined;
  if (!handler) {
    return { result: `Internal error: no handler for command type "${parsed.type}".` };
  }

  const args = handlerArgs ?? commandToToolArgs(parsed);
  const ctx = buildContext(state);

  const runTool = () => handler(args, ctx);
  let result = await runTool();

  if (!result.config) {
    return result;
  }

  const configToSave = parsed.type === "add-media" || parsed.type === "swap"
    ? prepareTimelineConfigForPersistence(result.config, state.registry)
    : result.config;

  // Versioned save with retry
  let nextVersion = await saveTimelineConfigVersioned(
    supabaseAdmin,
    timelineId,
    state.configVersion,
    configToSave,
  );

  if (nextVersion !== null) {
    state.config = configToSave;
    state.configVersion = nextVersion;
    return { ...result, config: configToSave };
  }

  // Reload and retry once on version conflict
  const refreshedState = await loadTimelineState(supabaseAdmin, timelineId);
  state.config = refreshedState.config;
  state.configVersion = refreshedState.configVersion;
  state.registry = refreshedState.registry;
  state.projectId = refreshedState.projectId;

  const retryCtx = buildContext(state);
  result = await handler(args, retryCtx);
  if (!result.config) {
    return { result: `${result.result} (retried after reload.)` };
  }

  const retriedConfigToSave = parsed.type === "add-media" || parsed.type === "swap"
    ? prepareTimelineConfigForPersistence(result.config, state.registry)
    : result.config;

  nextVersion = await saveTimelineConfigVersioned(
    supabaseAdmin,
    timelineId,
    state.configVersion,
    retriedConfigToSave,
  );

  if (nextVersion === null) {
    return { result: "Version conflict. Please retry." };
  }

  state.config = retriedConfigToSave;
  state.configVersion = nextVersion;
  return {
    ...result,
    config: retriedConfigToSave,
    result: `${result.result} (retried after reload.)`,
  };
}
