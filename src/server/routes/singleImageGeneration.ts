import express, { Request, Response } from 'express';
import { db } from '@/lib/db';
import { projects as projectsSchema, tasks as tasksSchema } from '../../../db/schema/schema';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { ASPECT_RATIO_TO_RESOLUTION } from '@/shared/lib/aspectRatios';
import { broadcast } from '../services/webSocketService';

const router = express.Router() as any;

interface SingleImageRequestBody {
  project_id: string;
  prompt: string;
  negative_prompt?: string;
  resolution?: string; // e.g., "512x512"
  model_name?: string; // default to wan 14b
  seed?: number;
  loras?: Array<{ path: string; strength: number }>; // 0-1 range
}

// Default aspect ratio key for fallback
const DEFAULT_ASPECT_RATIO = '1:1';

/**
 * POST /api/single-image/generate
 * Queues a new "single_image" task which will be picked up by the Python headless worker.
 */
router.post('/generate', async (req: Request, res: Response) => {
  console.log('[API /single-image/generate] Received POST request.');
  const body = req.body as SingleImageRequestBody;
  console.log('[API /single-image/generate] Request body:', JSON.stringify(body, null, 2));

  // Basic validation
  if (!body.project_id) {
    return res.status(400).json({ message: 'project_id is required.' });
  }
  if (!body.prompt || body.prompt.trim() === '') {
    return res.status(400).json({ message: 'prompt is required.' });
  }

  try {
    // Determine final resolution
    let finalResolution: string | undefined;
    if (body.resolution && body.resolution.trim()) {
      finalResolution = body.resolution.trim();
      console.log(`[API /single-image/generate] Using provided resolution: ${finalResolution}`);
    } else {
      // Attempt to read project aspect ratio
      const projectsResult = await db
        .select({ aspectRatio: projectsSchema.aspectRatio })
        .from(projectsSchema)
        .where(eq(projectsSchema.id, body.project_id))
        .limit(1);

      if (projectsResult.length > 0 && projectsResult[0].aspectRatio) {
        const projectAspectRatio = projectsResult[0].aspectRatio;
        finalResolution = ASPECT_RATIO_TO_RESOLUTION[projectAspectRatio];
        console.log(`[API /single-image/generate] Project ${body.project_id} aspect ratio: ${projectAspectRatio}, resolution: ${finalResolution}`);
        if (!finalResolution) {
          console.warn(`[API /single-image/generate] Aspect ratio "${projectAspectRatio}" not found. Falling back to default.`);
          finalResolution = ASPECT_RATIO_TO_RESOLUTION[DEFAULT_ASPECT_RATIO];
        }
      } else {
        console.log(`[API /single-image/generate] Project ${body.project_id} not found or missing aspect ratio. Using default resolution.`);
        finalResolution = ASPECT_RATIO_TO_RESOLUTION[DEFAULT_ASPECT_RATIO];
      }
    }

    // Build orchestrator payload
    const runId = new Date().toISOString().replace(/[-:.TZ]/g, '');
    const taskId = `single_image_${runId.substring(2, 10)}_${randomUUID().slice(0, 6)}`;

    // Convert loras array to mapping expected by headless worker
    const additionalLoras: Record<string, number> | undefined = body.loras && body.loras.length > 0
      ? body.loras.reduce<Record<string, number>>((acc, lora) => {
          acc[lora.path] = lora.strength;
          return acc;
        }, {})
      : undefined;

    const orchestratorPayload: Record<string, any> = {
      run_id: runId,
      prompt: body.prompt,
      model: body.model_name ?? 't2v',
      resolution: finalResolution,
      seed: body.seed ?? 11111,
      negative_prompt: body.negative_prompt ?? '',
      use_causvid_lora: true,
    };

    if (additionalLoras) {
      orchestratorPayload.additional_loras = additionalLoras;
    }

    console.log('[API /single-image/generate] Constructed orchestratorPayload:', JSON.stringify(orchestratorPayload, null, 2));

    // Insert task into DB
    const inserted = await db.insert(tasksSchema).values({
      projectId: body.project_id,
      taskType: 'single_image',
      params: {
        orchestrator_details: orchestratorPayload,
        task_id: taskId,
      },
      status: 'Queued',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    if (inserted.length === 0) {
      console.error('[API /single-image/generate] Failed to create single_image task in DB.');
      return res.status(500).json({ message: 'Failed to create single_image task.' });
    }

    console.log('[API /single-image/generate] Task inserted successfully:', JSON.stringify(inserted[0], null, 2));

    // Broadcast to clients
    broadcast({
      type: 'TASK_CREATED',
      payload: {
        projectId: body.project_id,
        task: inserted[0],
      },
    });

    return res.status(201).json(inserted[0]);
  } catch (err: any) {
    console.error('[API /single-image/generate] Error:', err);
    return res.status(500).json({ message: 'Internal server error', error: err?.message ?? 'unknown' });
  }
});

export default router; 