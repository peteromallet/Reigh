-- Persist safe worker telemetry labels from heartbeat logs into worker metadata.
-- The RPC signature is intentionally unchanged so older workers keep sending
-- the same named parameters while newer workers make labels queryable through
-- both workers.metadata and system_logs.metadata.

CREATE OR REPLACE FUNCTION func_worker_heartbeat_with_logs(
    worker_id_param text,
    vram_total_mb_param int DEFAULT NULL,
    vram_used_mb_param int DEFAULT NULL,
    logs_param jsonb DEFAULT '[]'::jsonb,
    current_task_id_param uuid DEFAULT NULL,
    status_param text DEFAULT 'active'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_metadata jsonb;
    heartbeat_labels jsonb := '{}'::jsonb;
    log_entry jsonb;
    inserted_count int := 0;
    error_count int := 0;
    requeued_count int := 0;
    failed_count int := 0;
    failed_task record;
    orchestrator_task_id_text text;
    is_orchestrator_task boolean;
BEGIN
    -- 1. Update worker heartbeat, metadata, and status
    SELECT COALESCE(metadata, '{}'::jsonb) INTO current_metadata
    FROM workers WHERE id = worker_id_param;

    IF current_metadata IS NULL THEN
        current_metadata := '{}'::jsonb;
    END IF;

    IF vram_total_mb_param IS NOT NULL THEN
        current_metadata = current_metadata ||
            jsonb_build_object(
                'vram_total_mb', vram_total_mb_param,
                'vram_used_mb', COALESCE(vram_used_mb_param, 0),
                'vram_timestamp', extract(epoch from NOW())
            );
    END IF;

    IF jsonb_typeof(COALESCE(logs_param, '[]'::jsonb)) = 'array' THEN
        FOR log_entry IN SELECT * FROM jsonb_array_elements(COALESCE(logs_param, '[]'::jsonb))
        LOOP
            IF log_entry->>'message' = 'worker_health_labels' THEN
                heartbeat_labels := COALESCE(log_entry->'metadata', '{}'::jsonb);
            END IF;
        END LOOP;
    END IF;

    IF heartbeat_labels <> '{}'::jsonb THEN
        current_metadata = current_metadata ||
            jsonb_build_object(
                'heartbeat_labels', heartbeat_labels,
                'backend', COALESCE(heartbeat_labels->>'backend', current_metadata->>'backend'),
                'profile', COALESCE(heartbeat_labels->>'profile', current_metadata->>'profile'),
                'route_key', COALESCE(heartbeat_labels->>'route_key', current_metadata->>'route_key'),
                'template_id', COALESCE(heartbeat_labels->>'template_id', current_metadata->>'template_id'),
                'run_id', COALESCE(heartbeat_labels->>'run_id', current_metadata->>'run_id'),
                'selector_namespace', COALESCE(heartbeat_labels->>'selector_namespace', current_metadata->>'selector_namespace'),
                'selector_version', COALESCE(heartbeat_labels->>'selector_version', current_metadata->>'selector_version'),
                'preflight_status', COALESCE(heartbeat_labels->>'preflight_status', current_metadata->>'preflight_status'),
                'disk_status', COALESCE(heartbeat_labels->>'disk_status', current_metadata->>'disk_status'),
                'resource_pressure_status', COALESCE(heartbeat_labels->>'resource_pressure_status', current_metadata->>'resource_pressure_status'),
                'quota_alert', COALESCE(heartbeat_labels->'quota_alert', current_metadata->'quota_alert', 'false'::jsonb),
                'telemetry_labels_timestamp', extract(epoch from NOW())
            );
    END IF;

    UPDATE workers
    SET
        last_heartbeat = NOW(),
        metadata = current_metadata,
        status = status_param
    WHERE id = worker_id_param;

    IF NOT FOUND THEN
        INSERT INTO workers (id, instance_type, status, last_heartbeat, metadata, created_at)
        VALUES (
            worker_id_param,
            'external',
            status_param,
            NOW(),
            current_metadata,
            NOW()
        );
    END IF;

    -- 2. Crash recovery for tasks stranded on a dead worker
    IF status_param = 'crashed' THEN
        UPDATE tasks
        SET
            status = 'Queued'::task_status,
            worker_id = NULL,
            generation_started_at = NULL,
            attempts = COALESCE(attempts, 0) + 1,
            updated_at = NOW(),
            error_message = 'Requeued: worker crashed (attempt ' || (COALESCE(attempts, 0) + 1)::text || ')'
        WHERE worker_id = worker_id_param
          AND status = 'In Progress'::task_status
          AND COALESCE(attempts, 0) < 3;

        GET DIAGNOSTICS requeued_count = ROW_COUNT;

        FOR failed_task IN
            UPDATE tasks
            SET
                status = 'Failed'::task_status,
                worker_id = NULL,
                generation_started_at = NULL,
                updated_at = NOW(),
                error_message = 'Failed: worker crashed after exhausting retries (attempt ' || COALESCE(attempts, 0)::text || ')'
            WHERE worker_id = worker_id_param
              AND status = 'In Progress'::task_status
              AND COALESCE(attempts, 0) >= 3
            RETURNING id, params, task_type
        LOOP
            failed_count := failed_count + 1;

            is_orchestrator_task := COALESCE(failed_task.task_type, '') ILIKE '%orchestrator%';
            orchestrator_task_id_text := CASE
                WHEN is_orchestrator_task THEN failed_task.id::text
                ELSE COALESCE(
                    failed_task.params->>'orchestrator_task_id_ref',
                    failed_task.params->'orchestration_contract'->>'orchestrator_task_id',
                    failed_task.params->>'orchestrator_task_id',
                    failed_task.params->'orchestrator_details'->>'orchestrator_task_id'
                )
            END;

            IF orchestrator_task_id_text IS NOT NULL
               AND orchestrator_task_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN
                PERFORM cascade_task_failure(
                    orchestrator_task_id_text::uuid,
                    failed_task.id,
                    'Failed',
                    is_orchestrator_task
                );
            END IF;
        END LOOP;
    END IF;

    -- 3. Insert log entries in batch
    IF jsonb_typeof(COALESCE(logs_param, '[]'::jsonb)) = 'array'
       AND jsonb_array_length(COALESCE(logs_param, '[]'::jsonb)) > 0
    THEN
        FOR log_entry IN SELECT * FROM jsonb_array_elements(COALESCE(logs_param, '[]'::jsonb))
        LOOP
            BEGIN
                INSERT INTO system_logs (
                    timestamp,
                    source_type,
                    source_id,
                    log_level,
                    message,
                    task_id,
                    worker_id,
                    metadata
                ) VALUES (
                    COALESCE((log_entry->>'timestamp')::timestamptz, NOW()),
                    'worker',
                    worker_id_param,
                    COALESCE(log_entry->>'level', 'INFO'),
                    log_entry->>'message',
                    COALESCE((log_entry->>'task_id')::uuid, current_task_id_param),
                    worker_id_param,
                    COALESCE(log_entry->'metadata', '{}'::jsonb)
                );
                inserted_count := inserted_count + 1;
            EXCEPTION WHEN OTHERS THEN
                error_count := error_count + 1;
            END;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'heartbeat_updated', true,
        'logs_inserted', inserted_count,
        'log_errors', error_count,
        'crash_requeued_tasks', requeued_count,
        'crash_failed_tasks', failed_count,
        'telemetry_labels_persisted', heartbeat_labels <> '{}'::jsonb
    );
END;
$$;

GRANT EXECUTE ON FUNCTION func_worker_heartbeat_with_logs(text, int, int, jsonb, uuid, text) TO service_role;

COMMENT ON FUNCTION func_worker_heartbeat_with_logs(text, int, int, jsonb, uuid, text)
IS 'Enhanced heartbeat with logs, worker status updates, crash recovery, and queryable safe telemetry labels. Uses SECURITY DEFINER to bypass RLS on workers table. Service-role only.';

CREATE INDEX IF NOT EXISTS idx_workers_metadata_heartbeat_labels
    ON workers USING gin ((metadata->'heartbeat_labels'));

CREATE INDEX IF NOT EXISTS idx_system_logs_worker_health_metadata
    ON system_logs USING gin (metadata)
    WHERE source_type = 'worker' AND message = 'worker_health_labels';
