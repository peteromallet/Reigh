import express, { Request, Response, Router } from 'express';
import { db } from '@/lib/db'; // Adjusted path assuming db is exported from here
import { tasks as tasksSchema, taskStatusEnum } from '../../../db/schema/schema'; // Adjusted path to schema
import { sql, eq, and, inArray, max } from 'drizzle-orm';
import { generations as generationsSchema, shotGenerations as shotGenerationsSchema } from '../../../db/schema/schema';
import { randomUUID } from 'crypto';
import { processCompletedStitchTask, cascadeTaskStatus } from '../services/taskProcessingService';

const router = express.Router() as any; // Changed Router to any to resolve overload errors

interface TaskRequestBody {
  project_id: string;
  task_type: string;
  params: Record<string, any>; // Or a more specific TypeBox schema
  status?: string; // Keep as string, will cast to enum type if schema requires
  dependant_on?: string[]; // Optional, snake_case from client
  output_location?: string; // Optional, snake_case from client
}

router.post('/', async (req: Request, res: Response) => {
  const {
    project_id,
    task_type,
    params,
    status = 'Queued',
    dependant_on, // snake_case from client
    output_location // snake_case from client
  } = req.body as TaskRequestBody; // Cast req.body here

  if (!project_id || !task_type || !params) {
    return res.status(400).json({ message: 'Missing required fields: project_id, task_type, params' });
  }

  try {
    // Construct data for Drizzle insert using camelCase schema field names
    const taskInsertData: any = {
      projectId: project_id,
      taskType: task_type,
      params: params, 
      status: status, // Drizzle will map to enum if column is enum
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Add optional fields if they were provided in the request body
    if (dependant_on !== undefined) {
      taskInsertData.dependantOn = dependant_on; // camelCase for Drizzle schema field
    }
    if (output_location !== undefined) {
      taskInsertData.outputLocation = output_location; // camelCase for Drizzle schema field
    }

    const insertedTasks = await db
      .insert(tasksSchema)
      .values(taskInsertData) // Drizzle should infer the type or use 'any' if structure is correct
      .returning();

    if (insertedTasks.length === 0) {
      console.error('[API /api/tasks] Task insertion failed, no data returned.');
      return res.status(500).json({ message: 'Task creation failed at database level.' });
    }

    const createdTask = insertedTasks[0];
    console.log('[API /api/tasks] Task created successfully:', createdTask);
    return res.status(201).json(createdTask);

  } catch (error: any) {
    console.error('[API /api/tasks] Error creating task:', error);
    if (error.message.includes('violates not-null constraint') || error.message.includes('CHECK constraint')) {
        return res.status(400).json({ message: `Database constraint violation: ${error.message}` });
    }
    return res.status(500).json({ message: 'Internal server error while creating task', error: error.message });
  }
});

// GET /api/tasks - List tasks for a project, with optional status filtering
router.get('/', async (req: Request, res: Response) => {
  const projectId = req.query.projectId as string;
  let typedStatusFilter: (typeof taskStatusEnum[number])[] | undefined;

  const statusQueryParam = req.query.status || req.query['status[]'];

  if (statusQueryParam) {
    const rawStatuses = Array.isArray(statusQueryParam) 
        ? statusQueryParam 
        : [statusQueryParam];
    
    const validStatuses = rawStatuses.filter(
        (s: any): s is typeof taskStatusEnum[number] => 
            typeof s === 'string' && (taskStatusEnum as readonly string[]).includes(s as any)
    );

    if (validStatuses.length > 0) {
        typedStatusFilter = validStatuses;
    }
  }  

  if (!projectId) {
    return res.status(400).json({ message: 'Missing required query parameter: projectId' });
  }

  try {
    const conditions = [eq(tasksSchema.projectId, projectId)];

    if (typedStatusFilter && typedStatusFilter.length > 0) {
        conditions.push(inArray(tasksSchema.status, typedStatusFilter));
    }

    const tasks = await db
      .select()
      .from(tasksSchema)
      .where(and(...conditions))
      .orderBy(sql`${tasksSchema.createdAt} DESC`);

    return res.status(200).json(tasks);
  } catch (error: any) {
    console.error('[API /api/tasks] Error listing tasks:', error);
    return res.status(500).json({ message: 'Internal server error while listing tasks', error: error.message });
  }
});

// PATCH /api/tasks/:taskId/cancel - Cancel a task
router.patch('/:taskId/cancel', async (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;

  if (!taskId) {
    return res.status(400).json({ message: 'Missing required path parameter: taskId' });
  }

  try {
    const updatedTasks = await db
      .update(tasksSchema)
      .set({ 
        status: 'Cancelled' as typeof taskStatusEnum[number], 
        updatedAt: new Date() 
      })
      .where(eq(tasksSchema.id, taskId))
      .returning();

    if (updatedTasks.length === 0) {
      return res.status(404).json({ message: 'Task not found or not updated' });
    }

    // Don't await, let it run in the background
    cascadeTaskStatus(taskId, 'Cancelled', 'Task cancelled by user via API');

    return res.status(200).json(updatedTasks[0]);
  } catch (error: any) {
    console.error(`[API /api/tasks/${taskId}/cancel] Error cancelling task:`, error);
    // Check for specific Drizzle/DB errors if needed, e.g., invalid enum value if 'Cancelled' wasn't in the enum
    if (error.message.includes('invalid input value for enum')) {
        return res.status(400).json({ message: `Invalid status value. Ensure 'Cancelled' is a valid task status. Error: ${error.message}` });
    }
    return res.status(500).json({ message: 'Internal server error while cancelling task', error: error.message });
  }
});

// New PATCH endpoint to update task status
router.patch('/:taskId/status', async (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const { status: newStatus, reason } = req.body;

  if (!taskId) {
    return res.status(400).json({ message: 'Missing required path parameter: taskId' });
  }
  if (!newStatus) {
    return res.status(400).json({ message: 'Missing required body parameter: status' });
  }

  if (!(taskStatusEnum as readonly string[]).includes(newStatus as any)) {
    return res.status(400).json({ message: `Invalid status value: ${newStatus}. Must be one of ${taskStatusEnum.join(', ')}` });
  }

  try {
    const updatedTasks = await db
      .update(tasksSchema)
      .set({
        status: newStatus as typeof taskStatusEnum[number],
        updatedAt: new Date(),
      })
      .where(eq(tasksSchema.id, taskId))
      .returning();

    if (updatedTasks.length === 0) {
      return res.status(404).json({ message: 'Task not found or not updated' });
    }

    const updatedTask = updatedTasks[0];

    if (updatedTask.status === 'Failed') {
      // Don't await, let it run in the background
      cascadeTaskStatus(updatedTask.id, 'Failed', reason || `Task status updated to Failed via API without a specific reason.`);
    }

    if (updatedTask.taskType === 'travel_stitch' && updatedTask.status === 'Complete') {
      // Call the refactored processing function
      // No await needed here if we don't want the API response to wait for this background processing.
      // However, if it was critical for the API response to confirm this post-processing, you might await.
      // For now, let it run in the background.
      processCompletedStitchTask(updatedTask).catch(err => {
        console.error(`[VideoStitchGenDebug] Error from processCompletedStitchTask called via API for task ${updatedTask.id}:`, err);
      });
    }

    return res.status(200).json(updatedTask);
  } catch (error: any) {
    console.error(`[VideoStitchGenDebug] Error updating task status for ${taskId}:`, error);
    if (error.message.includes('invalid input value for enum')) {
        return res.status(400).json({ message: `Invalid status value. Error: ${error.message}` });
    }
    return res.status(500).json({ message: 'Internal server error while updating task status', error: error.message });
  }
});

// POST /api/tasks/cancel-pending - Cancel all pending tasks for a project
router.post('/cancel-pending', async (req: Request, res: Response) => {
  const { projectId } = req.body;

  if (!projectId) {
    return res.status(400).json({ message: 'Missing required body parameter: projectId' });
  }

  try {
    const result = await db
      .update(tasksSchema)
      .set({ 
        status: 'Cancelled' as typeof taskStatusEnum[number], 
        updatedAt: new Date() 
      })
      .where(and(
        eq(tasksSchema.projectId, projectId),
        eq(tasksSchema.status, 'Pending' as typeof taskStatusEnum[number])
      ))
      .returning({ id: tasksSchema.id }); // Only return IDs or a count for efficiency

    // Drizzle update doesn't directly return a count of affected rows easily across all drivers.
    // The number of items in 'result' array is the count of updated (cancelled) tasks.
    const cancelledCount = result.length;

    if (cancelledCount === 0) {
      return res.status(200).json({ message: 'No pending tasks found for this project to cancel.', cancelledCount });
    }

    console.log(`[API /api/tasks/cancel-pending] Cancelled ${cancelledCount} pending tasks for project ${projectId}`);
    return res.status(200).json({ message: `Successfully cancelled ${cancelledCount} pending tasks.`, cancelledCount });

  } catch (error: any) {
    console.error(`[API /api/tasks/cancel-pending] Error cancelling all pending tasks for project ${projectId}:`, error);
    return res.status(500).json({ message: 'Internal server error while cancelling all pending tasks', error: error.message });
  }
});

// GET /api/tasks/by-task-id/:taskId - Get a single task by its string task_id
router.get('/by-task-id/:taskId', async (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;

  if (!taskId) {
    return res.status(400).json({ message: 'Missing required path parameter: taskId' });
  }

  try {
    // The task_id is stored within the 'params' JSONB column.
    // We need to use a JSON path expression to query it.
    const tasks = await db
      .select()
      .from(tasksSchema)
      .where(sql`params->>'task_id' = ${taskId}`)
      .limit(1);

    if (tasks.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }

    return res.status(200).json(tasks[0]);
  } catch (error: any) {
    console.error(`[API /api/tasks/by-task-id/${taskId}] Error fetching task:`, error);
    return res.status(500).json({ message: 'Internal server error while fetching task', error: error.message });
  }
});

export default router; 