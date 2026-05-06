import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface Section3aFixture {
  rows: Array<{
    row_id: number;
    route_key_expectation: string;
    disposition: string;
    expected_backend: string;
    support_state_expectation: string;
  }>;
}

const migrationPath = path.resolve(
  process.cwd(),
  "supabase/migrations/20260506115000_seed_section3a_mode_aware_route_metadata.sql",
);

const fixturePath = path.resolve(
  process.cwd(),
  "../reigh-worker/scripts/dual_run_compare/fixtures/section3a_matrix.fixture",
);

function loadMigration(): string {
  return readFileSync(migrationPath, "utf8");
}

function loadFixture(): Section3aFixture {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Section3aFixture;
}

describe("Section 3A route metadata seed", () => {
  it("declares explicit capability metadata for every non-FALL-BACK fixture row", () => {
    const migrationSql = loadMigration();
    const fixture = loadFixture();

    expect(fixture.rows).toHaveLength(13);
    for (const row of fixture.rows) {
      expect(row.disposition).not.toBe("FALL-BACK");
      expect(migrationSql).toContain(row.route_key_expectation);
      expect(migrationSql).toContain(`'row_id', row_id`);
      expect(migrationSql).toContain(`'support_state', support_state`);
      expect(migrationSql).toContain(`'disposition', disposition`);
    }

    expect(migrationSql).toContain("INSERT INTO public.route_backend_capabilities");
    expect(migrationSql).toContain("'wgp'");
    expect(migrationSql).toContain("'vibecomfy'");
    expect(migrationSql).toContain("support_state = 'vibecomfy_supported'");
    expect(migrationSql).toContain("supports_missing_selector");
  });

  it("seeds production selectors only for canary-promoted Section 3A rows", () => {
    const migrationSql = loadMigration();
    const selectorBlock = migrationSql.slice(
      migrationSql.indexOf("WITH promoted_section3a_routes"),
    );
    const fixture = loadFixture();
    const promotedRows = fixture.rows.filter(
      (row) => row.disposition === "ADAPT" && row.expected_backend === "vibecomfy",
    );
    const nonPromotedRows = fixture.rows.filter(
      (row) => !(row.disposition === "ADAPT" && row.expected_backend === "vibecomfy"),
    );

    expect(promotedRows.map((row) => row.row_id)).toEqual([7, 8]);
    expect(selectorBlock).toContain("INSERT INTO public.route_backend_selectors");
    expect(selectorBlock).toContain("'production'");
    expect(selectorBlock).toContain("'Sprint 9 Section 3A canary-promoted route'");

    for (const row of promotedRows) {
      expect(selectorBlock).toContain(row.route_key_expectation);
      expect(selectorBlock).toContain(`(${row.row_id}, '${row.route_key_expectation}', 'vibecomfy', 9)`);
    }

    for (const row of nonPromotedRows) {
      expect(selectorBlock).not.toContain(row.route_key_expectation);
    }
  });
});
