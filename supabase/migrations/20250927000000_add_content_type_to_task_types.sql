-- Add content_type column to task_types table
-- This field indicates whether the task produces image or video content

-- Add the content_type column
ALTER TABLE task_types ADD COLUMN IF NOT EXISTS content_type text;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_task_types_content_type ON task_types(content_type);

-- Populate content_type based on existing task types and their output
UPDATE task_types SET content_type = CASE 
    -- Image generation tasks produce images
    WHEN name IN ('single_image', 'wan_2_2_t2i', 'qwen_image_style') THEN 'image'
    
    -- Image editing tasks produce images
    WHEN name IN ('image_edit', 'qwen_image_edit', 'magic_edit') THEN 'image'
    
    -- Travel editing tasks produce images
    WHEN name IN ('edit_travel_kontext', 'edit_travel_flux') THEN 'image'
    
    -- Video generation tasks produce videos
    WHEN name = 'travel_stitch' THEN 'video'
    WHEN name = 'travel_orchestrator' THEN 'video'
    WHEN name = 'travel_segment' THEN 'video'
    
    -- Processing tasks (upscaling) produce images
    WHEN name = 'image_upscale' THEN 'image'
    
    -- Training tasks don't produce direct content output
    WHEN name = 'lora_training' THEN NULL
    
    -- Default for any unmapped tasks
    ELSE NULL
END;

-- Add constraint to ensure content_type is either 'image', 'video', or NULL
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_content_type' AND conrelid = 'task_types'::regclass) THEN
    ALTER TABLE task_types ADD CONSTRAINT check_content_type
    CHECK (content_type IS NULL OR content_type IN ('image', 'video'));
  END IF;
END $$;

-- Add comment for the new column
COMMENT ON COLUMN task_types.content_type IS 'Type of content produced by the task: image, video, or NULL for non-content tasks';
