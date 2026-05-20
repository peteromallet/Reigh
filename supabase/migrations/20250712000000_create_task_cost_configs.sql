-- Create task cost configurations table
CREATE TABLE IF NOT EXISTS task_cost_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type text NOT NULL UNIQUE,
  category text NOT NULL, -- 'generation', 'processing', 'orchestration', 'utility'
  display_name text NOT NULL,
  base_cost_cents_per_second integer NOT NULL, -- Base cost per second in cents
  cost_factors jsonb DEFAULT '{}', -- Flexible cost factors configuration
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_task_cost_configs_task_type ON task_cost_configs(task_type);
CREATE INDEX IF NOT EXISTS idx_task_cost_configs_category ON task_cost_configs(category);
CREATE INDEX IF NOT EXISTS idx_task_cost_configs_active ON task_cost_configs(is_active);

-- Insert initial cost configurations based on existing hardcoded costs
INSERT INTO task_cost_configs (task_type, category, display_name, base_cost_cents_per_second, cost_factors) VALUES
  ('single_image', 'generation', 'Image Generation', 1, '{
    "resolution": {
      "512x512": 1,
      "768x768": 2,
      "1024x1024": 3,
      "1536x1536": 5,
      "2048x2048": 8
    },
    "modelType": {
      "flux-dev": 1,
      "flux-pro": 2,
      "flux-schnell": 0.5
    }
  }'),
  ('travel_stitch', 'processing', 'Video Generation', 5, '{
    "frameCount": 2,
    "resolution": {
      "512x512": 1,
      "768x768": 1.5,
      "1024x1024": 2
    }
  }'),
  ('travel_orchestrator', 'orchestration', 'Travel Between Images', 3, '{
    "frameCount": 1
  }'),
  ('image_upscale', 'processing', 'Image Upscaling', 2, '{
    "resolution": {
      "2x": 1,
      "4x": 2,
      "8x": 4
    }
  }'),
  ('image_edit', 'generation', 'Image Editing', 2, '{
    "resolution": {
      "512x512": 1,
      "768x768": 1.5,
      "1024x1024": 2,
      "1536x1536": 3
    }
  }'),
  ('lora_training', 'processing', 'LoRA Training', 50, '{
    "modelType": {
      "flux-dev": 1,
      "flux-pro": 1.5
    }
  }'),
  ('travel_segment', 'processing', 'Video Segment Generation', 4, '{}'),
  ('edit_travel_kontext', 'generation', 'Edit Travel (Kontext)', 3, '{}'),
  ('edit_travel_flux', 'generation', 'Edit Travel (Flux)', 3, '{}')
ON CONFLICT (task_type) DO NOTHING;

-- Enable RLS on task_cost_configs table
ALTER TABLE task_cost_configs ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Allow read access to all authenticated users
DROP POLICY IF EXISTS "Authenticated users can view task cost configs" ON task_cost_configs;
CREATE POLICY "Authenticated users can view task cost configs"
  ON task_cost_configs
  FOR SELECT
  TO authenticated
  USING (true);

-- RLS Policy: Only service role can modify task cost configs
DROP POLICY IF EXISTS "Service role can modify task cost configs" ON task_cost_configs;
CREATE POLICY "Service role can modify task cost configs"
  ON task_cost_configs
  FOR ALL
  TO service_role
  USING (true);
