import express, { Request, Response } from 'express';
import { db } from '@/lib/db';
import { tasks as tasksSchema, projects as projectsSchema } from '../../../db/schema/schema';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { ASPECT_RATIO_TO_RESOLUTION } from '@/shared/lib/aspectRatios';
import { broadcast } from '../services/webSocketService';

const router = express.Router() as any;

interface TravelRequestBody {
  project_id: string;
  shot_id?: string; // optional for reference
  image_urls: string[]; // ordered list of anchor image URLs (length >= 2)
  base_prompts: string[]; // list of prompts (length 1 or segments)
  negative_prompts?: string[]; // optional list of negative prompts
  segment_frames: number[]; // list length 1 or segments
  frame_overlap: number[]; // list length 1 or segments
  resolution?: string; // e.g., "700x460"
  model_name?: string;
  seed?: number;
  debug?: boolean;
  apply_reward_lora?: boolean;
  colour_match_videos?: boolean;
  apply_causvid?: boolean;
  use_lighti2x_lora?: boolean;
  fade_in_duration?: any; // JSON value (string or object)
  fade_out_duration?: any; // JSON value (string or object)
  after_first_post_generation_saturation?: number;
  after_first_post_generation_brightness?: number;
  params_json_str?: string;
  main_output_dir_for_run?: string;
  enhance_prompt?: boolean; // Whether to enhance prompts using AI
  openai_api_key?: string; // OpenAI API key for prompt enhancement
  loras?: Array<{ path: string; strength: number }>; // Optional LoRAs to apply
}

// Set a default aspect ratio key, which will be used to look up the resolution.
const DEFAULT_ASPECT_RATIO = '1:1';

/**
 * POST /api/steerable-motion/travel-between-images
 * Queues a new "travel_orchestrator" task mirroring the behaviour of the Python CLI.
 * Accepts JSON payload defined by TravelRequestBody.
 */
router.post('/travel-between-images', async (req: any, res: any) => {
  console.log('[API /steerable-motion/travel-between-images] Received POST request.'); // Log entry
  const body = req.body as TravelRequestBody;
  console.log('[API /steerable-motion/travel-between-images] Request body:', JSON.stringify(body, null, 2)); // Log body

  // Basic validation
  if (!body.project_id) {
    return res.status(400).json({ message: 'project_id is required.' });
  }
  if (!body.image_urls || body.image_urls.length < 2) {
    return res.status(400).json({ message: 'At least two image_urls are required.' });
  }
  if (!body.base_prompts || body.base_prompts.length === 0) {
    return res.status(400).json({ message: 'base_prompts is required (at least one prompt).' });
  }
  if (!body.segment_frames || body.segment_frames.length === 0) {
    return res.status(400).json({ message: 'segment_frames is required.' });
  }
  if (!body.frame_overlap || body.frame_overlap.length === 0) {
    return res.status(400).json({ message: 'frame_overlap is required.' });
  }

  try {
    // Generate IDs & run meta
    const runId = new Date().toISOString().replace(/[-:.TZ]/g, ''); // compact timestamp
    const orchestratorTaskId = `sm_travel_orchestrator_${runId.substring(2, 10)}_${randomUUID().slice(0, 6)}`;

    // Fetch project to get aspect ratio
    let finalResolution: string | undefined;
    
    // Use provided resolution if available, otherwise fall back to project aspect ratio
    if (body.resolution && body.resolution.trim()) {
      finalResolution = body.resolution.trim();
      console.log(`[API /steerable-motion/travel-between-images] Using provided resolution: ${finalResolution}`);
    } else if (body.project_id) {
      const projectsResult = await db
        .select({ aspectRatio: projectsSchema.aspectRatio })
        .from(projectsSchema)
        .where(eq(projectsSchema.id, body.project_id))
        .limit(1);

      if (projectsResult.length > 0 && projectsResult[0].aspectRatio) {
        const projectAspectRatio = projectsResult[0].aspectRatio;
        finalResolution = ASPECT_RATIO_TO_RESOLUTION[projectAspectRatio];
        console.log(`[API /steerable-motion/travel-between-images] Project ${body.project_id} has aspect ratio: ${projectAspectRatio}, using resolution: ${finalResolution}`);
        
        if (!finalResolution) {
            console.warn(`[API /steerable-motion/travel-between-images] Project aspect ratio "${projectAspectRatio}" not found in resolution map. Falling back to default.`);
            finalResolution = ASPECT_RATIO_TO_RESOLUTION[DEFAULT_ASPECT_RATIO];
        }
      } else {
        console.log(`[API /steerable-motion/travel-between-images] Project ${body.project_id} not found or has no aspect ratio. Using default resolution.`);
        finalResolution = ASPECT_RATIO_TO_RESOLUTION[DEFAULT_ASPECT_RATIO];
      }
    } else {
      console.log('[API /steerable-motion/travel-between-images] No project_id provided in body. Using default resolution for safety, though project_id is required by validation.');
      finalResolution = ASPECT_RATIO_TO_RESOLUTION[DEFAULT_ASPECT_RATIO];
    }

    const numSegments = body.image_urls ? body.image_urls.length - 1 : 0;
    if (numSegments <= 0) {
      console.warn('[API /steerable-motion/travel-between-images] No segments to generate based on image_urls length.', body.image_urls);
      return res.status(400).json({ message: 'Not enough images to create video segments (minimum 2 required).' });
    }

    // Expand arrays if they have a single element and numSegments > 1
    const expandArray = (arr: any[] | undefined, count: number) => {
      if (arr && arr.length === 1 && count > 1) {
        return Array(count).fill(arr[0]);
      }
      return arr;
    };

    const basePromptsExpanded = expandArray(body.base_prompts, numSegments) || [];
    const negativePromptsExpanded = expandArray(body.negative_prompts, numSegments) || Array(numSegments).fill('');
    const segmentFramesExpanded = expandArray(body.segment_frames, numSegments) || [];
    const frameOverlapExpanded = expandArray(body.frame_overlap, numSegments) || [];

    // Build orchestrator payload (subset of the huge Python equivalent)
    const orchestratorPayload: Record<string, any> = {
      orchestrator_task_id: orchestratorTaskId,
      run_id: runId,
      input_image_paths_resolved: body.image_urls,
      num_new_segments_to_generate: numSegments,
      base_prompts_expanded: basePromptsExpanded,
      negative_prompts_expanded: negativePromptsExpanded,
      segment_frames_expanded: segmentFramesExpanded,
      frame_overlap_expanded: frameOverlapExpanded,
      parsed_resolution_wh: finalResolution,
      model_name: body.model_name ?? 'vace_14B',
      seed_base: body.seed ?? 789,
      apply_reward_lora: body.apply_reward_lora ?? false,
      colour_match_videos: body.colour_match_videos ?? true,
      apply_causvid: body.apply_causvid ?? true,
      use_lighti2x_lora: body.use_lighti2x_lora ?? false,
      fade_in_params_json_str: typeof body.fade_in_duration === 'object' && body.fade_in_duration !== null ? JSON.stringify(body.fade_in_duration) : body.fade_in_duration ?? '{"low_point":0.0,"high_point":1.0,"curve_type":"ease_in_out","duration_factor":0.0}',
      fade_out_params_json_str: typeof body.fade_out_duration === 'object' && body.fade_out_duration !== null ? JSON.stringify(body.fade_out_duration) : body.fade_out_duration ?? '{"low_point":0.0,"high_point":1.0,"curve_type":"ease_in_out","duration_factor":0.0}',
      after_first_post_generation_saturation: body.after_first_post_generation_saturation ?? 1,
      after_first_post_generation_brightness: body.after_first_post_generation_brightness ?? 0,
      params_json_str_override: typeof body.params_json_str === 'object' && body.params_json_str !== null ? JSON.stringify(body.params_json_str) : body.params_json_str ?? '{"steps":4}',
      debug_mode_enabled: body.debug ?? true,
      shot_id: body.shot_id ?? undefined,
      main_output_dir_for_run: body.main_output_dir_for_run ?? './outputs/default_travel_output',
      enhance_prompt: body.enhance_prompt ?? false,
      openai_api_key: body.openai_api_key ?? '',
    };

    // Attach additional_loras mapping if provided
    if (body.loras && body.loras.length > 0) {
      const additionalLoras: Record<string, number> = body.loras.reduce<Record<string, number>>((acc, lora) => {
        acc[lora.path] = lora.strength;
        return acc;
      }, {});
      orchestratorPayload.additional_loras = additionalLoras;
    }

    console.log('[API /steerable-motion/travel-between-images] Constructed orchestratorPayload:', JSON.stringify(orchestratorPayload, null, 2)); // Log payload

    // Insert task into SQLite via Drizzle
    console.log('[API /steerable-motion/travel-between-images] Attempting to insert task into DB...'); // Log DB attempt
    const inserted = await db.insert(tasksSchema).values({
      projectId: body.project_id,
      taskType: 'travel_orchestrator',
      params: {
        orchestrator_details: orchestratorPayload,
        task_id: orchestratorTaskId
      },
      status: 'Queued',
      createdAt: new Date(),
      updatedAt: new Date()
    }).returning();

    if (inserted.length === 0) {
      console.error('[API /steerable-motion/travel-between-images] Failed to create orchestrator task in DB - no rows returned.');
      return res.status(500).json({ message: 'Failed to create orchestrator task.' });
    }
    console.log('[API /steerable-motion/travel-between-images] Task inserted successfully:', JSON.stringify(inserted[0], null, 2));

    // After successful insertion, broadcast an update to all clients for that project
    broadcast({
      type: 'TASK_CREATED',
      payload: {
        projectId: body.project_id,
        task: inserted[0],
      },
    });

    return res.status(201).json(inserted[0]);
  } catch (err: any) {
    console.error('[API /steerable-motion/travel-between-images] Error:', err);
    return res.status(500).json({ message: 'Internal server error', error: err?.message ?? 'unknown' });
  }
});

export default router; 