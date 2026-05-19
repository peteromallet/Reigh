import { toErrorMessage } from "../_shared/errorMessage.ts";
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { bootstrapEdgeHandler } from '../_shared/edgeHandler.ts';
import { ensureTaskActor } from '../_shared/requestGuards.ts';
import { authorizeTaskActor } from '../_shared/taskActorPolicy.ts';

import { handleCascadingTaskFailure } from './cascade.ts';
import { handleOrchestratorCancellationBilling } from './cancellationBilling.ts';
import { buildTaskUpdatePayload } from './payload.ts';
import { parseAndValidateRequest } from './request.ts';
import { validateStatusTransition } from './statusValidation.ts';
import { fetchCurrentTaskStatus, updateTaskByRole } from './taskUpdates.ts';

declare const Deno: { env: { get: (key: string) => string | undefined } };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: corsHeaders,
  });
}

function jsonCorsResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

serve(async (req) => {
  const bootstrap = await bootstrapEdgeHandler(req, {
    functionName: 'update-task-status',
    logPrefix: '[UPDATE-TASK-STATUS]',
    method: 'POST',
    parseBody: 'none',
    auth: {
      required: true,
      options: { allowJwtUserAuth: true },
    },
  });
  if (!bootstrap.ok) {
    return withCors(bootstrap.response);
  }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');

  if (!serviceKey || !supabaseUrl) {
    console.error('[UPDATE-TASK-STATUS] Missing required environment variables');
    return textResponse('Server configuration error', 500);
  }

  const { supabaseAdmin, logger, auth } = bootstrap.value;

  const parseResult = await parseAndValidateRequest(req, logger);
  if (!parseResult.ok) {
    return withCors(parseResult.response);
  }

  const requestBody = parseResult.data;
  logger.setDefaultTaskId(requestBody.task_id);
  logger.info('Processing status update', {
    task_id: requestBody.task_id,
    status: requestBody.status,
  });

  const authResult = ensureTaskActor(auth, logger);
  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    const actor = await authorizeTaskActor({
      supabaseAdmin,
      taskId: requestBody.task_id,
      auth: auth!,
      logPrefix: '[UPDATE-TASK-STATUS]',
    });
    if (!actor.ok) {
      logger.error('Task access denied', {
        task_id: requestBody.task_id,
        error: actor.error,
        status_code: actor.statusCode,
      });
      await logger.flush();
      return textResponse(actor.error, actor.statusCode);
    }

    const { isServiceRole, callerId } = actor.value;
    const currentTaskResult = await fetchCurrentTaskStatus(supabaseAdmin, requestBody.task_id);
    if (currentTaskResult.error) {
      logger.error('Error checking current task status', { error: currentTaskResult.error.message });
      await logger.flush();
      return textResponse(`Failed to check current task status: ${currentTaskResult.error.message}`, 500);
    }

    if (!currentTaskResult.data) {
      logger.warn('Task not found while checking current status', { task_id: requestBody.task_id });
      await logger.flush();
      return textResponse('Task not found or not accessible', 404);
    }

    const isTimestampResetOnly =
      requestBody.reset_generation_started_at === true
      && currentTaskResult.data.status === 'In Progress'
      && requestBody.status === 'In Progress'
      && requestBody.output_location === undefined
      && requestBody.error_details === undefined
      && requestBody.clear_worker === undefined
      && requestBody.attempts === undefined;

    if (!isTimestampResetOnly) {
      const transitionResponse = validateStatusTransition(
        logger,
        requestBody.task_id,
        currentTaskResult.data.status,
        requestBody.status,
      );

      if (transitionResponse) {
        await logger.flush();
        return withCors(transitionResponse);
      }
    }

    const updatePayload = buildTaskUpdatePayload(requestBody);
    const updateResult = await updateTaskByRole(
      supabaseAdmin,
      requestBody.task_id,
      updatePayload,
      isServiceRole,
      callerId,
    );

    if (updateResult.error) {
      if (updateResult.error.message === 'User has no projects') {
        logger.error('User has no projects', { user_id: callerId ?? undefined });
        await logger.flush();
        return textResponse('User has no projects', 403);
      }

      if (updateResult.error.code === 'PGRST116') {
        logger.warn('Task not found or not accessible', { task_id: requestBody.task_id });
        await logger.flush();
        return textResponse('Task not found or not accessible', 404);
      }

      logger.error('Database update error', {
        task_id: requestBody.task_id,
        error: updateResult.error.message,
        code: updateResult.error.code,
      });
      await logger.flush();
      return textResponse(`Database error: ${updateResult.error.message}`, 500);
    }

    if (!updateResult.data) {
      logger.warn('Task not found or not accessible (no data)', { task_id: requestBody.task_id });
      await logger.flush();
      return textResponse('Task not found or not accessible', 404);
    }

    logger.info('Task status updated successfully', {
      task_id: requestBody.task_id,
      old_status: currentTaskResult.data.status,
      new_status: requestBody.status,
    });

    if (requestBody.status === 'Failed' || requestBody.status === 'Cancelled') {
      await handleCascadingTaskFailure(
        supabaseAdmin,
        logger,
        requestBody.task_id,
        requestBody.status,
        updateResult.data,
      );

      if (requestBody.status === 'Cancelled') {
        await handleOrchestratorCancellationBilling(
          supabaseAdmin,
          supabaseUrl,
          serviceKey,
          logger,
          requestBody.task_id,
          updateResult.data,
        );
      }
    }

    await logger.flush();
    return jsonCorsResponse({
      success: true,
      task_id: requestBody.task_id,
      status: requestBody.status,
      message: `Task status updated to '${requestBody.status}'`,
    });
  } catch (error: unknown) {
    const message = toErrorMessage(error);
    logger.critical('Unexpected error', { task_id: requestBody.task_id, error: message });
    await logger.flush();
    return textResponse(`Internal server error: ${message}`, 500);
  }
});
