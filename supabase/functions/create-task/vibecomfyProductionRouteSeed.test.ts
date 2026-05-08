import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "supabase/migrations/20260508003000_seed_vibecomfy_vace_mode_and_qwen_routes.sql",
);

function loadMigration(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("VibeComfy production route seed", () => {
  it("promotes newly validated Qwen and VACE mode routes with selector and capability metadata", () => {
    const migrationSql = loadMigration();
    const promotedRoutes = [
      "qwen_image",
      "travel_segment__model-wan22_vace__guidance-vace_raw__continuity-video_source__profile-default",
      "travel_segment__model-wan22_vace__guidance-vace_flow__continuity-video_source__profile-default",
      "travel_segment__model-wan22_vace__guidance-vace_canny__continuity-video_source__profile-default",
      "travel_segment__model-wan22_vace__guidance-vace_depth__continuity-video_source__profile-default",
      "individual_travel_segment__model-wan22_vace__guidance-vace_flow__continuity-first_last__profile-default",
      "individual_travel_segment__model-wan22_vace__guidance-vace_canny__continuity-first_last__profile-default",
      "individual_travel_segment__model-wan22_vace__guidance-vace_depth__continuity-first_last__profile-default",
    ];

    for (const routeKey of promotedRoutes) {
      expect(migrationSql).toContain(routeKey);
    }

    expect(migrationSql).toContain("INSERT INTO public.route_backend_capabilities");
    expect(migrationSql).toContain("INSERT INTO public.route_backend_selectors");
    expect(migrationSql).toContain("'vibecomfy'");
    expect(migrationSql).toContain("'production'");
    expect(migrationSql).toContain("'support_state', 'vibecomfy_supported'");
    expect(migrationSql).toContain("'template_id', template_id");
    expect(migrationSql).toContain("selector_version,");
    expect(migrationSql).toContain("capability_version,");
  });
});
