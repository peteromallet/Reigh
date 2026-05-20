-- Add billing type support to task_types table
-- Supports both per-second and per-unit billing models

-- =============================================================================
-- 1. Add billing_type and unit_cost columns
-- =============================================================================

-- Add billing type column with constraint
ALTER TABLE task_types 
ADD COLUMN IF NOT EXISTS billing_type text NOT NULL DEFAULT 'per_second';

-- Add constraint for billing_type values
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_billing_type' AND conrelid = 'task_types'::regclass) THEN
    ALTER TABLE task_types ADD CONSTRAINT check_billing_type CHECK (billing_type IN ('per_second', 'per_unit'));
  END IF;
END $$;

-- Add unit_cost column for per-unit billing (nullable for per-second tasks)
ALTER TABLE task_types 
ADD COLUMN IF NOT EXISTS unit_cost decimal(10,6) DEFAULT NULL;

-- Create index for billing type lookups
CREATE INDEX IF NOT EXISTS idx_task_types_billing_type ON task_types(billing_type);

-- =============================================================================
-- 2. Update existing task types with appropriate billing models
-- =============================================================================

-- Most existing tasks are time-based (per-second)
UPDATE task_types 
SET billing_type = 'per_second', 
    unit_cost = NULL
WHERE billing_type = 'per_second'; -- This is already the default, but being explicit

-- Update specific tasks that make more sense as per-unit billing
-- Image generation and editing tasks are typically billed per image
UPDATE task_types 
SET billing_type = 'per_unit',
    unit_cost = CASE 
      WHEN name = 'single_image' THEN 0.025  -- $0.025 per image
      WHEN name = 'image_edit' THEN 0.030    -- $0.030 per edit
      WHEN name = 'image_upscale' THEN 0.020 -- $0.020 per upscale
      WHEN name = 'edit_travel_kontext' THEN 0.050  -- $0.050 per edit
      WHEN name = 'edit_travel_flux' THEN 0.050     -- $0.050 per edit
      ELSE 0.025  -- Default per-unit cost
    END
WHERE name IN ('single_image', 'image_edit', 'image_upscale', 'edit_travel_kontext', 'edit_travel_flux');

-- LoRA training could be per-unit (per model trained)
UPDATE task_types 
SET billing_type = 'per_unit',
    unit_cost = 2.50  -- $2.50 per model training
WHERE name = 'lora_training';

-- =============================================================================
-- 3. Add helper function to get task cost
-- =============================================================================

CREATE OR REPLACE FUNCTION get_task_cost(
  p_task_type text,
  p_duration_seconds integer DEFAULT NULL,
  p_unit_count integer DEFAULT 1
)
RETURNS decimal(10,6)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_billing_type text;
  v_base_cost_per_second decimal(10,6);
  v_unit_cost decimal(10,6);
  v_total_cost decimal(10,6);
BEGIN
  -- Get task type configuration
  SELECT 
    billing_type, 
    base_cost_per_second, 
    unit_cost
  INTO v_billing_type, v_base_cost_per_second, v_unit_cost
  FROM task_types 
  WHERE name = p_task_type AND is_active = true;
  
  -- If task type not found, use default per-second billing
  IF v_billing_type IS NULL THEN
    v_billing_type := 'per_second';
    v_base_cost_per_second := 0.0278; -- Default cost
    v_unit_cost := NULL;
  END IF;
  
  -- Calculate cost based on billing type
  IF v_billing_type = 'per_unit' THEN
    -- Per-unit billing: unit_cost * number of units
    v_total_cost := COALESCE(v_unit_cost, 0.025) * p_unit_count;
  ELSE
    -- Per-second billing: base_cost_per_second * duration
    IF p_duration_seconds IS NULL THEN
      -- If no duration provided for per-second billing, return base rate
      v_total_cost := v_base_cost_per_second;
    ELSE
      v_total_cost := v_base_cost_per_second * p_duration_seconds;
    END IF;
  END IF;
  
  RETURN v_total_cost;
END;
$$;

-- =============================================================================
-- 4. Add comments and documentation
-- =============================================================================

COMMENT ON COLUMN task_types.billing_type IS 'Billing model: per_second (time-based) or per_unit (fixed cost per task)';
COMMENT ON COLUMN task_types.unit_cost IS 'Fixed cost per unit for per_unit billing type (NULL for per_second tasks)';
COMMENT ON FUNCTION get_task_cost IS 'Calculate task cost based on billing type - supports both per-second and per-unit billing';

-- =============================================================================
-- 5. Create view for easy cost calculation
-- =============================================================================

CREATE OR REPLACE VIEW task_types_with_billing AS
SELECT 
  id,
  name,
  run_type,
  category,
  display_name,
  description,
  billing_type,
  CASE 
    WHEN billing_type = 'per_second' THEN base_cost_per_second
    WHEN billing_type = 'per_unit' THEN unit_cost
    ELSE base_cost_per_second
  END as primary_cost,
  base_cost_per_second,
  unit_cost,
  cost_factors,
  is_active,
  created_at,
  updated_at
FROM task_types
WHERE is_active = true;

COMMENT ON VIEW task_types_with_billing IS 'Convenient view showing task types with their primary billing cost based on billing_type';
