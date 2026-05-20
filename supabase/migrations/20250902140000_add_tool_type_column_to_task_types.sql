-- Add tool_type column to task_types table and populate it based on existing task types
-- This makes generation trigger logic much cleaner by using database-driven tool_type mapping

-- Add the tool_type column
ALTER TABLE task_types ADD COLUMN IF NOT EXISTS tool_type text;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_task_types_tool_type ON task_types(tool_type);

-- Populate tool_type based on existing task types and their usage patterns
UPDATE task_types SET tool_type = CASE 
    -- Image generation tasks
    WHEN name IN ('single_image', 'wan_2_2_t2i', 'qwen_image_style') THEN 'image-generation'
    
    -- Video generation tasks  
    WHEN name = 'travel_stitch' THEN 'travel-between-images'
    WHEN name = 'travel_orchestrator' THEN 'travel-between-images'
    WHEN name = 'travel_segment' THEN 'travel-between-images'
    
    -- Image editing tasks
    WHEN name IN ('image_edit', 'qwen_image_edit', 'magic_edit') THEN 'magic-edit'
    
    -- Travel editing tasks
    WHEN name IN ('edit_travel_kontext', 'edit_travel_flux') THEN 'edit-travel'
    
    -- Training and processing tasks
    WHEN name = 'lora_training' THEN 'training'
    WHEN name = 'image_upscale' THEN 'processing'
    
    -- Default for any unmapped tasks
    ELSE 'unknown'
END;

-- Add constraint to ensure tool_type is not null for active tasks
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_tool_type_not_null' AND conrelid = 'task_types'::regclass) THEN
    ALTER TABLE task_types ADD CONSTRAINT check_tool_type_not_null
    CHECK (tool_type IS NOT NULL OR is_active = false);
  END IF;
END $$;

-- Update the generation trigger to use the tool_type from task_types table
CREATE OR REPLACE FUNCTION create_generation_on_task_complete()
RETURNS TRIGGER AS $$
DECLARE
    new_generation_id uuid;
    generation_type text;
    generation_params jsonb;
    normalized_params jsonb;
    shot_id uuid;
    output_location text;
    thumbnail_url text;
    task_category text;
    task_tool_type text;
BEGIN
    -- Get task metadata from task_types table including the new tool_type column
    SELECT category, tool_type INTO task_category, task_tool_type
    FROM task_types 
    WHERE name = NEW.task_type AND is_active = true;
    
    -- Process ANY completed task that doesn't have a generation yet AND has category = 'generation'
    IF NEW.status = 'Complete'::task_status 
       AND NEW.generation_created = FALSE
       AND task_category = 'generation' THEN
        
        RAISE LOG '[ProcessTask] Processing completed generation task % (type: %, category: %, tool_type: %)', 
            NEW.id, NEW.task_type, task_category, task_tool_type;
        
        -- Normalize image paths in params
        normalized_params := normalize_image_paths_in_jsonb(NEW.params);
        
        -- Generate a new UUID for the generation
        new_generation_id := gen_random_uuid();
        
        -- Determine generation type based on task type
        IF NEW.task_type = 'travel_stitch' THEN
            generation_type := 'video';
            
            -- SAFE: Extract shot_id from params with exception handling
            BEGIN
                shot_id := (normalized_params->'full_orchestrator_payload'->>'shot_id')::uuid;
            EXCEPTION 
                WHEN invalid_text_representation OR data_exception THEN
                    shot_id := NULL; -- Continue without shot linking
                    RAISE LOG '[ProcessTask] Invalid shot_id format in travel_stitch task %, continuing without shot link', NEW.id;
            END;
            
            output_location := NEW.output_location;
            
            -- Extract thumbnail_url from params.full_orchestrator_payload.thumbnail_url
            thumbnail_url := normalized_params->'full_orchestrator_payload'->>'thumbnail_url';
            
            -- Validate required fields
            IF output_location IS NULL OR NEW.project_id IS NULL THEN
                RAISE LOG '[ProcessTask] Missing critical data for task %: shot_id=%, output_location=%, project_id=%',
                    NEW.id, shot_id, output_location, NEW.project_id;
                RETURN NEW;
            END IF;
            
            -- Build generation params for video
            generation_params := jsonb_build_object(
                'type', 'travel_stitch',
                'projectId', NEW.project_id,
                'outputLocation', output_location,
                'originalParams', normalized_params,
                'tool_type', COALESCE(task_tool_type, 'travel-between-images')
            );
            
            -- Add shot_id only if it's valid
            IF shot_id IS NOT NULL THEN
                generation_params := generation_params || jsonb_build_object('shotId', shot_id);
            END IF;
            
            -- Add thumbnail_url to params if available
            IF thumbnail_url IS NOT NULL THEN
                generation_params := generation_params || jsonb_build_object('thumbnailUrl', thumbnail_url);
                RAISE LOG '[ProcessTask] Found thumbnail_url for travel_stitch task %: %', NEW.id, thumbnail_url;
            END IF;
            
        -- All other generation task types create image generations
        ELSE
            generation_type := 'image';
            
            -- SAFE: Extract shot_id if present with exception handling
            BEGIN
                shot_id := (normalized_params->>'shot_id')::uuid;
            EXCEPTION 
                WHEN invalid_text_representation OR data_exception THEN
                    shot_id := NULL; -- Continue without shot linking
                    RAISE LOG '[ProcessTask] Invalid shot_id format in % task %, continuing without shot link', NEW.task_type, NEW.id;
            END;
            
            output_location := NEW.output_location;
            
            -- Extract thumbnail_url from params if available
            thumbnail_url := normalized_params->>'thumbnail_url';
            
            -- Validate required fields
            IF output_location IS NULL OR NEW.project_id IS NULL THEN
                RAISE LOG '[ProcessTask] Missing critical data for % task %: output_location=%, project_id=%',
                    NEW.task_type, NEW.id, output_location, NEW.project_id;
                RETURN NEW;
            END IF;
            
            -- Build generation params for image generation tasks
            -- ✅ CLEAN: Use tool_type directly from task_types table
            generation_params := jsonb_build_object(
                'type', NEW.task_type,
                'projectId', NEW.project_id,
                'outputLocation', output_location,
                'originalParams', normalized_params,
                'tool_type', COALESCE(task_tool_type, 'image-generation')
            );
            
            -- Add shot_id if present and valid
            IF shot_id IS NOT NULL THEN
                generation_params := generation_params || jsonb_build_object('shotId', shot_id);
            END IF;
            
            -- Add thumbnail_url to params if available
            IF thumbnail_url IS NOT NULL THEN
                generation_params := generation_params || jsonb_build_object('thumbnailUrl', thumbnail_url);
                RAISE LOG '[ProcessTask] Found thumbnail_url for % task %: %', NEW.task_type, NEW.id, thumbnail_url;
            END IF;
        END IF;
        
        -- Insert the generation record with thumbnail_url
        INSERT INTO generations (
            id,
            tasks,
            params,
            location,
            type,
            project_id,
            thumbnail_url,
            created_at
        ) VALUES (
            new_generation_id,
            to_jsonb(ARRAY[NEW.id]),  -- Store as JSONB array
            generation_params,
            output_location,
            generation_type,
            NEW.project_id,
            thumbnail_url,
            NOW()
        );
        
        -- Link generation to shot if shot_id exists and is valid
        IF shot_id IS NOT NULL THEN
            -- Use the RPC function to handle positioning
            PERFORM add_generation_to_shot(shot_id, new_generation_id, true);
        END IF;
        
        -- Mark the task as having created a generation
        NEW.generation_created := TRUE;
        
        RAISE LOG '[ProcessTask] Created generation % for % task % with category: %, tool_type: %, thumbnail_url: %', 
            new_generation_id, NEW.task_type, NEW.id, task_category, task_tool_type, COALESCE(thumbnail_url, 'none');
    ELSE
        -- Log why task was skipped for debugging
        IF NEW.status = 'Complete'::task_status AND NEW.generation_created = FALSE THEN
            RAISE LOG '[ProcessTask] Skipping task % (type: %) - not a generation task (category: %)', 
                NEW.id, NEW.task_type, COALESCE(task_category, 'unknown');
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verify the updates
SELECT 
    name,
    category,
    tool_type,
    is_active
FROM task_types 
ORDER BY 
    CASE 
        WHEN category = 'generation' THEN 1
        WHEN category = 'processing' THEN 2
        WHEN category = 'orchestration' THEN 3
        ELSE 4
    END,
    name;

-- Log confirmation
SELECT 'Added tool_type column to task_types and updated generation trigger to use database-driven tool_type mapping' as status;
