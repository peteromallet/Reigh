-- Create task_types table with run_type support
-- This replaces task_cost_configs with enhanced metadata including run_type filtering

-- =============================================================================
-- 1. Create task_types table
-- =============================================================================

CREATE TABLE IF NOT EXISTS task_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,                    -- e.g., 'single_image', 'travel_orchestrator'
  run_type text NOT NULL DEFAULT 'gpu',         -- 'gpu' | 'api' 
  category text NOT NULL,                       -- 'generation', 'processing', 'orchestration', 'utility'
  display_name text NOT NULL,
  description text,
  base_cost_per_second decimal(10,6) NOT NULL,  -- Base cost per second in decimal cents
  cost_factors jsonb DEFAULT '{}',              -- Flexible cost factors configuration
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_task_types_name ON task_types(name);
CREATE INDEX IF NOT EXISTS idx_task_types_run_type ON task_types(run_type);
CREATE INDEX IF NOT EXISTS idx_task_types_category ON task_types(category);
CREATE INDEX IF NOT EXISTS idx_task_types_active ON task_types(is_active);

-- Add constraint for run_type values
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_run_type' AND conrelid = 'task_types'::regclass) THEN
    ALTER TABLE task_types ADD CONSTRAINT check_run_type CHECK (run_type IN ('gpu', 'api'));
  END IF;
END $$;

-- =============================================================================
-- 2. Migrate data from task_cost_configs (all as 'gpu' type)
-- =============================================================================

INSERT INTO task_types (name, run_type, category, display_name, description, base_cost_per_second, cost_factors, is_active) 
SELECT 
  tcc.task_type as name,
  'gpu' as run_type,                           -- All existing tasks default to GPU
  tcc.category,
  tcc.display_name,
  CASE 
    WHEN tcc.task_type = 'single_image' THEN 'Generate individual images using AI models'
    WHEN tcc.task_type = 'travel_stitch' THEN 'Stitch individual video segments into final output'
    WHEN tcc.task_type = 'travel_orchestrator' THEN 'Coordinate complex multi-step travel generation workflows'
    WHEN tcc.task_type = 'image_upscale' THEN 'Increase image resolution using AI upscaling'
    WHEN tcc.task_type = 'image_edit' THEN 'Edit and modify existing images using AI'
    WHEN tcc.task_type = 'lora_training' THEN 'Train custom LoRA models for personalized generation'
    WHEN tcc.task_type = 'travel_segment' THEN 'Generate individual video segments for travel sequences'
    WHEN tcc.task_type = 'edit_travel_kontext' THEN 'Edit travel sequences using Kontext model'
    WHEN tcc.task_type = 'edit_travel_flux' THEN 'Edit travel sequences using Flux model'
    ELSE 'AI processing task'
  END as description,
  tcc.base_cost_per_second,
  tcc.cost_factors,
  tcc.is_active
FROM task_cost_configs tcc
WHERE tcc.is_active = true
ON CONFLICT (name) DO UPDATE SET
  run_type = EXCLUDED.run_type,
  category = EXCLUDED.category,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  base_cost_per_second = EXCLUDED.base_cost_per_second,
  cost_factors = EXCLUDED.cost_factors,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- =============================================================================
-- 3. Add helper function to get task run_type with fallback
-- =============================================================================

CREATE OR REPLACE FUNCTION get_task_run_type(p_task_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_run_type text;
BEGIN
  -- Look up run_type for the task_type
  SELECT run_type INTO v_run_type
  FROM task_types 
  WHERE name = p_task_type AND is_active = true;
  
  -- If not found, default to 'gpu'
  IF v_run_type IS NULL THEN
    v_run_type := 'gpu';
  END IF;
  
  RETURN v_run_type;
END;
$$;

-- =============================================================================
-- 4. Add comments
-- =============================================================================

COMMENT ON TABLE task_types IS 'Registry of all task types with their execution environment (gpu/api) and metadata';
COMMENT ON COLUMN task_types.name IS 'Unique task type identifier (matches tasks.task_type)';
COMMENT ON COLUMN task_types.run_type IS 'Execution environment: gpu (local/cloud GPU) or api (external API calls)';
COMMENT ON COLUMN task_types.category IS 'Task category for organization and UI display';
COMMENT ON FUNCTION get_task_run_type IS 'Helper function to get run_type for a task with gpu fallback';
