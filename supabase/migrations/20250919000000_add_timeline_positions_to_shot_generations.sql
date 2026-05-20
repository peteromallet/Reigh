-- Add timeline frame support to shot_generations table
-- This enables unified position storage for both batch and timeline modes

-- Add new columns
ALTER TABLE shot_generations 
ADD COLUMN IF NOT EXISTS timeline_frame integer,
ADD COLUMN IF NOT EXISTS metadata jsonb;

-- Add unique constraint for timeline frames (no two items at same frame in same shot)
-- Note: PostgreSQL partial unique constraints require a separate CREATE UNIQUE INDEX statement
CREATE UNIQUE INDEX IF NOT EXISTS unique_timeline_frame_per_shot
ON shot_generations(shot_id, timeline_frame) 
WHERE timeline_frame IS NOT NULL;

-- Add constraint to ensure timeline_frame is non-negative when present
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timeline_frame_non_negative' AND conrelid = 'shot_generations'::regclass) THEN
    ALTER TABLE shot_generations
    ADD CONSTRAINT timeline_frame_non_negative
    CHECK (timeline_frame IS NULL OR timeline_frame >= 0);
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_shot_generations_timeline_frame
ON shot_generations(shot_id, timeline_frame) 
WHERE timeline_frame IS NOT NULL;

-- Add comment to document the new columns
COMMENT ON COLUMN shot_generations.timeline_frame IS 'Frame position for timeline view (e.g., 60, 120, 180). NULL means not positioned on timeline yet.';
COMMENT ON COLUMN shot_generations.metadata IS 'Additional position metadata like frame_spacing, user_positioned flags, etc.';

-- Create RPC function for atomic position exchanges
CREATE OR REPLACE FUNCTION exchange_shot_positions(
  p_shot_id uuid,
  p_generation_id_a uuid,
  p_generation_id_b uuid
)
RETURNS void AS $$
DECLARE
  item_a_position integer;
  item_a_timeline_frame integer;
  item_b_position integer;
  item_b_timeline_frame integer;
BEGIN
  -- Get current positions for both items
  SELECT position, timeline_frame 
  INTO item_a_position, item_a_timeline_frame
  FROM shot_generations 
  WHERE shot_id = p_shot_id AND generation_id = p_generation_id_a;
  
  SELECT position, timeline_frame 
  INTO item_b_position, item_b_timeline_frame
  FROM shot_generations 
  WHERE shot_id = p_shot_id AND generation_id = p_generation_id_b;
  
  -- Verify both items exist
  IF item_a_position IS NULL OR item_b_position IS NULL THEN
    RAISE EXCEPTION 'One or both items not found in shot %', p_shot_id;
  END IF;
  
  -- Perform atomic swap of all positions
  UPDATE shot_generations SET 
    position = CASE 
      WHEN generation_id = p_generation_id_a THEN item_b_position
      WHEN generation_id = p_generation_id_b THEN item_a_position
    END,
    timeline_frame = CASE
      WHEN generation_id = p_generation_id_a THEN item_b_timeline_frame
      WHEN generation_id = p_generation_id_b THEN item_a_timeline_frame
    END,
    updated_at = NOW()
  WHERE shot_id = p_shot_id 
    AND generation_id IN (p_generation_id_a, p_generation_id_b);
    
  -- Log the exchange for debugging
  RAISE LOG 'Exchanged positions: % (pos % -> %) and % (pos % -> %)', 
    p_generation_id_a, item_a_position, item_b_position,
    p_generation_id_b, item_b_position, item_a_position;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create RPC function to initialize timeline frames for existing records
CREATE OR REPLACE FUNCTION initialize_timeline_frames_for_shot(
  p_shot_id uuid,
  p_frame_spacing integer DEFAULT 60
)
RETURNS integer AS $$
DECLARE
  record_count integer := 0;
BEGIN
  -- Update existing records that don't have timeline_frame set
  UPDATE shot_generations 
  SET 
    timeline_frame = position * p_frame_spacing,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('frame_spacing', p_frame_spacing, 'auto_initialized', true),
    updated_at = NOW()
  WHERE shot_id = p_shot_id 
    AND timeline_frame IS NULL;
  
  GET DIAGNOSTICS record_count = ROW_COUNT;
  
  RAISE LOG 'Initialized timeline frames for % records in shot %', record_count, p_shot_id;
  RETURN record_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION exchange_shot_positions(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION initialize_timeline_frames_for_shot(uuid, integer) TO authenticated;

-- Verify the migration
SELECT 'Timeline position columns added to shot_generations table' as status;
