#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const enforce =
  args.has('--enforce') ||
  process.env.SLOT_FIRST_HEALTH_ENFORCE === '1' ||
  process.env.CI_SLOT_FIRST_ENFORCE === '1';
const audit = args.has('--audit');
const repoRoot = path.resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');

loadDotenv(path.join(repoRoot, '.env'));
loadDotenv(path.join(repoRoot, '.env.local'));

const envKeys = [
  'SLOT_FIRST_DATABASE_URL',
  'DATABASE_URL',
  'SUPABASE_DB_URL',
  'POSTGRES_URL',
  'PGHOST',
  'PGDATABASE',
  'PGUSER',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_REF',
];
const tools = ['psql', 'pg_dump', 'supabase'];
const ports = [54321, 54322, 54323, 54324, 5432];
const dbUrl =
  process.env.SLOT_FIRST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.POSTGRES_URL ||
  '';

const zeroInvariantCounters = [
  'primary_not_renderable',
  'primary_cross_slot_count',
  'primary_cross_project_count',
  'primary_deleted_count',
  'complete_remote_missing_storage_identity',
  'local_attempts_missing_valid_handle',
  'nonlocal_attempts_with_local_metadata',
  'self_lineage_count',
  'self_parent_count',
  'based_on_cross_project_count',
  'based_on_cross_slot_count',
  'parent_cross_project_count',
  'pair_cross_project_count',
  'superseded_boundary_violation_count',
  'slot_project_drift_count',
  'attempt_project_drift_count',
  'slot_density_gap_groups',
  'project_asset_with_shot_count',
  'no_shot_non_project_asset_count',
];

const documentedBaselineCounters = [
  'slots_without_primary',
  'shot_bound_slots_without_primary',
  'project_asset_slots_without_primary',
  'legacy_url_only_attempts_total',
  'nullable_child_attempts_total',
  'duplicate_child_order_retry_groups',
  'duplicate_pair_retry_groups',
  'shot_compositions_empty_primary_rows',
  'project_asset_compositions_empty_primary_rows',
  'task_ghost_count',
  'attempts_failed_total',
  'attempts_pending',
];

function loadDotenv(filePath) {
  if (!existsSync(filePath)) return;
  const contents = readFileSync(filePath, 'utf8');
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    const value = rawValue
      .replace(/^(['"])([\s\S]*)\1$/, '$2')
      .replace(/\\n/g, '\n');
    process.env[key] = value;
  }
}

function commandExists(command) {
  return spawnSync('sh', ['-c', `command -v ${command}`], { encoding: 'utf8' }).status === 0;
}

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port, timeout: 700 });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
}

function fail(message, details = []) {
  console.error(`[slot-first-health] FAIL: ${message}`);
  for (const detail of details) {
    console.error(`  - ${detail}`);
  }
  process.exit(1);
}

function listMigrationFiles() {
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir)
    .filter((entry) => entry.endsWith('.sql'))
    .sort()
    .map((entry) => ({
      name: entry,
      path: path.join(migrationsDir, entry),
      sql: readFileSync(path.join(migrationsDir, entry), 'utf8'),
    }));
}

function slotFirstMigrationText(files) {
  return files
    .filter((file) => /slot_first|route_backend_prerequisites|cleanup_and_capabilities|tasks_claimable_trigger/.test(file.name))
    .map((file) => `\n-- ${file.name}\n${file.sql}`)
    .join('\n');
}

function checkStaticSlotFirstContracts() {
  const files = listMigrationFiles();
  const allSql = files.map((file) => `\n-- ${file.name}\n${file.sql}`).join('\n');
  const slotSql = slotFirstMigrationText(files);
  const normalizedAll = stripSqlComments(allSql).toLowerCase();
  const normalizedSlot = stripSqlComments(slotSql).toLowerCase();
  const errors = [];

  for (const file of files.filter((entry) => /slot_first|route_backend/.test(entry.name))) {
    const normalized = stripSqlComments(file.sql);
    const functionBlocks = normalized.match(/create\s+(?:or\s+replace\s+)?function[\s\S]*?\$\$;/gim) ?? [];
    for (const block of functionBlocks) {
      if (/security\s+definer/i.test(block) && !/set\s+search_path\s*=\s*public/i.test(block)) {
        const name = /function\s+([^\s(]+)/i.exec(block)?.[1] ?? '(unknown function)';
        errors.push(`${file.name}: SECURITY DEFINER ${name} does not pin SET search_path = public.`);
      }
    }
  }

  const requirePattern = (pattern, detail) => {
    if (!pattern.test(normalizedSlot)) errors.push(detail);
  };

  requirePattern(
    /local_handle_id\s+uuid\s+references\s+public\.local_media_handles\s*\(\s*id\s*\)\s+on\s+delete\s+restrict/,
    'attempts.local_handle_id must reference public.local_media_handles(id) ON DELETE RESTRICT.',
  );
  requirePattern(
    /constraint\s+attempts_remote_completed_storage_identity[\s\S]*?output_url[\s\S]*?output_bucket[\s\S]*?output_path/,
    'completed remote attempts must require output_url, output_bucket, and output_path.',
  );
  requirePattern(
    /legacy_url_only\s+boolean\s+not\s+null\s+default\s+false/,
    'attempts.legacy_url_only audit marker is missing.',
  );
  requirePattern(
    /unique\s+nulls\s+not\s+distinct\s*\(\s*project_id\s*,\s*shot_id\s*,\s*kind\s*,\s*position_index\s*\)/,
    'shot_slots project/shot/kind/position uniqueness must use NULLS NOT DISTINCT for project_asset rows.',
  );
  requirePattern(
    /constraint\s+shot_slots_project_asset_shape[\s\S]*?kind\s*=\s*'project_asset'[\s\S]*?shot_id\s+is\s+null/,
    'shot_slots_project_asset_shape constraint is missing or no longer requires no-shot project_asset rows.',
  );
  requirePattern(
    /insert\s+into\s+public\.system_logs\s*\([\s\S]*?source_type[\s\S]*?source_id[\s\S]*?log_level[\s\S]*?message[\s\S]*?metadata/,
    'slot_first_log_primary_changed must write system_logs using source_type/source_id/log_level/message/metadata.',
  );

  if (/insert\s+into\s+(?:public\.)?system_logs\s*\(\s*source\s*[,)]/i.test(normalizedSlot)) {
    errors.push('slot-first migrations must not write a nonexistent system_logs.source column.');
  }

  if (/create\s+(?:unique\s+)?index[\s\S]*?on\s+(?:public\.)?attempts\s*\(\s*parent_attempt_id\s*,\s*child_order\s*\)/i.test(normalizedAll)) {
    errors.push('raw unique index on attempts(parent_attempt_id, child_order) is forbidden; duplicate child retry history must remain representable.');
  }
  if (/unique\s*(?:nulls\s+not\s+distinct\s*)?\(\s*parent_attempt_id\s*,\s*child_order\s*\)/i.test(normalizedAll)) {
    errors.push('raw UNIQUE(parent_attempt_id, child_order) constraint is forbidden; duplicate child retry history must remain representable.');
  }

  const triggerMigration = files.find((file) => file.name === '20260520004000_slot_first_triggers_invariants.sql');
  const backfillMigration = files.find((file) => file.name === '20260520007000_slot_first_backfill.sql');
  if (!triggerMigration) {
    errors.push('slot-first trigger migration is missing.');
  } else {
    const triggerSql = stripSqlComments(triggerMigration.sql).toLowerCase();
    if (/create\s+(?:constraint\s+)?trigger\s+shot_slots_900_enforce_density/.test(triggerSql)) {
      errors.push('density trigger must not be created in the T6 trigger migration before backfill validation.');
    }
    if (!/density enforcement trigger must not be enabled before backfill validation/.test(triggerSql)) {
      errors.push('T6 trigger migration must assert density enforcement is not prematurely attached.');
    }
  }
  if (!backfillMigration) {
    errors.push('slot-first backfill migration is missing.');
  } else {
    const backfillSql = stripSqlComments(backfillMigration.sql).toLowerCase();
    const validateIndex = backfillSql.indexOf('perform public.slot_first_validate_slot_density()');
    const createTriggerIndex = backfillSql.indexOf('create constraint trigger shot_slots_900_enforce_density');
    if (validateIndex === -1 || createTriggerIndex === -1 || createTriggerIndex < validateIndex) {
      errors.push('density trigger must be created only after full backfill density validation.');
    }
  }

  if (errors.length > 0) {
    fail('static slot-first contract checks failed.', errors);
  }

  console.log('[slot-first-health] static slot-first contract checks passed.');
}

function queryHealth(dbTarget) {
  const sql = 'select row_to_json(h)::text from public.slot_first_health h limit 1;';
  const cmdArgs = dbTarget
    ? [dbTarget, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql]
    : ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql];
  const result = spawnSync('psql', cmdArgs, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    fail('could not query public.slot_first_health.', [result.stderr.trim() || result.stdout.trim() || 'psql exited non-zero']);
  }
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) {
    fail('public.slot_first_health returned no rows.');
  }
  try {
    return JSON.parse(line);
  } catch (error) {
    fail('public.slot_first_health did not return parseable JSON.', [String(error), line.slice(0, 500)]);
  }
}

function enforceHealthCounters(row) {
  const errors = [];
  for (const counter of zeroInvariantCounters) {
    const value = Number(row[counter] ?? 0);
    if (!Number.isFinite(value)) {
      errors.push(`${counter} is not numeric: ${row[counter]}`);
      continue;
    }
    if (value !== 0) {
      errors.push(`${counter}=${value}`);
    }
  }

  if (errors.length > 0) {
    fail('slot_first_health invariant counters are non-zero.', errors);
  }

  const baselineSummary = documentedBaselineCounters
    .filter((counter) => row[counter] !== undefined)
    .map((counter) => `${counter}=${row[counter]}`)
    .join(', ');
  console.log('[slot-first-health] slot_first_health invariant counters passed.');
  if (baselineSummary) {
    console.log(`[slot-first-health] documented baselines: ${baselineSummary}`);
  }
}

const presentEnv = envKeys.filter((key) => process.env[key]);
const presentTools = tools.filter(commandExists);
const openPorts = [];
for (const port of ports) {
  if (await checkPort(port)) openPorts.push(port);
}

console.log('[slot-first-health] readiness diagnostics only; this is not DB test coverage.');
console.log(`[slot-first-health] env keys present: ${presentEnv.length > 0 ? presentEnv.join(', ') : '(none)'}`);
console.log(`[slot-first-health] tools present: ${presentTools.length > 0 ? presentTools.join(', ') : '(none)'}`);
console.log(`[slot-first-health] local postgres/supabase ports open: ${openPorts.length > 0 ? openPorts.join(', ') : '(none)'}`);

checkStaticSlotFirstContracts();

const hasDbTarget = Boolean(dbUrl || process.env.PGHOST || process.env.PGDATABASE);
const hasDbTool = presentTools.includes('psql') || presentTools.includes('supabase');

if (enforce && (!hasDbTarget || !hasDbTool)) {
  fail('enforcement requires DB connection details and psql or Supabase CLI.');
}

if (hasDbTarget && presentTools.includes('psql')) {
  const health = queryHealth(dbUrl);
  console.log(
    `[slot-first-health] sampled_at=${health.sampled_at ?? '(unknown)'} slots_total=${health.slots_total ?? '(unknown)'} attempts_total=${health.attempts_total ?? '(unknown)'}`,
  );
  if (enforce) enforceHealthCounters(health);
} else if (enforce) {
  fail('enforcement requires psql to query public.slot_first_health.');
} else if (!audit) {
  console.warn('[slot-first-health] no live DB target available; static checks passed but slot_first_health was not queried.');
}

console.log('[slot-first-health] ok');
