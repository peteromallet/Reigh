-- Fresh-database prerequisite for early 202501 task-type migrations.
--
-- Several historical migrations insert into task_types before the original
-- 202502 task_types migration runs, and a pair of 202501 cost migrations touch
-- task_cost_configs before its original 202507 creation migration. Keep this
-- repair early and idempotent so replayed databases have the same base objects
-- that long-lived dev databases already had.

CREATE TABLE IF NOT EXISTS task_cost_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type text NOT NULL UNIQUE,
  category text NOT NULL,
  display_name text NOT NULL,
  base_cost_cents_per_second integer NOT NULL,
  cost_factors jsonb DEFAULT '{}',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_cost_configs_task_type ON task_cost_configs(task_type);
CREATE INDEX IF NOT EXISTS idx_task_cost_configs_category ON task_cost_configs(category);
CREATE INDEX IF NOT EXISTS idx_task_cost_configs_active ON task_cost_configs(is_active);

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS generation_created boolean DEFAULT false NOT NULL;

ALTER TABLE shot_generations
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS timeline_frame integer,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

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

ALTER TABLE task_cost_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view task cost configs" ON task_cost_configs;
CREATE POLICY "Authenticated users can view task cost configs"
  ON task_cost_configs
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can modify task cost configs" ON task_cost_configs;
CREATE POLICY "Service role can modify task cost configs"
  ON task_cost_configs
  FOR ALL
  TO service_role
  USING (true);

CREATE TABLE IF NOT EXISTS task_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  run_type text NOT NULL DEFAULT 'gpu',
  category text NOT NULL,
  tool_type text,
  content_type text,
  display_name text NOT NULL,
  description text,
  billing_type text NOT NULL DEFAULT 'per_second',
  unit_cost decimal(10,6) DEFAULT NULL,
  base_cost_per_second decimal(10,6) NOT NULL,
  cost_factors jsonb DEFAULT '{}',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_types_name ON task_types(name);
CREATE INDEX IF NOT EXISTS idx_task_types_run_type ON task_types(run_type);
CREATE INDEX IF NOT EXISTS idx_task_types_category ON task_types(category);
CREATE INDEX IF NOT EXISTS idx_task_types_active ON task_types(is_active);
CREATE INDEX IF NOT EXISTS idx_task_types_billing_type ON task_types(billing_type);
CREATE INDEX IF NOT EXISTS idx_task_types_tool_type ON task_types(tool_type);
CREATE INDEX IF NOT EXISTS idx_task_types_content_type ON task_types(content_type);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_run_type' AND conrelid = 'task_types'::regclass) THEN
    ALTER TABLE task_types ADD CONSTRAINT check_run_type CHECK (run_type IN ('gpu', 'api'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_billing_type' AND conrelid = 'task_types'::regclass) THEN
    ALTER TABLE task_types ADD CONSTRAINT check_billing_type CHECK (billing_type IN ('per_second', 'per_unit'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_content_type' AND conrelid = 'task_types'::regclass) THEN
    ALTER TABLE task_types ADD CONSTRAINT check_content_type CHECK (content_type IS NULL OR content_type IN ('image', 'video'));
  END IF;
END $$;
