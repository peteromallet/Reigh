import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');

const explicitUserOwnedTables = new Map([
  ['projects', 'core project container owned by users'],
  ['shots', 'project-owned child records'],
  ['shot_generations', 'project-owned join records'],
  ['shot_slots', 'project-owned slot identity'],
  ['attempts', 'project-owned attempt history'],
]);

function normalizeSql(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
}

function fail(message, details) {
  console.error(`[check-supabase-rls] ${message}`);
  for (const detail of details) {
    console.error(`  - ${detail}`);
  }
  process.exit(1);
}

const migrationFiles = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith('.sql'))
  .sort();

const tableOrigins = new Map();
const rlsEnabledTables = new Set();
const policyTables = new Set();

for (const file of migrationFiles) {
  const filePath = path.join(migrationsDir, file);
  const normalizedSql = normalizeSql(readFileSync(filePath, 'utf8'));

  const createTablePattern =
    /create table\s+(?:if not exists\s+)?(?:"?public"?\.)?"?([a-z0-9_]+)"?\s*\(([\s\S]*?)\);/gim;
  for (const match of normalizedSql.matchAll(createTablePattern)) {
    const tableName = match[1].toLowerCase();
    const createBody = match[2].toLowerCase();
    const isDirectUserOwned =
      explicitUserOwnedTables.has(tableName)
      || /\buser_id\b/.test(createBody)
      || /references\s+(?:"?public"?\.)?"?users"?\s*\(/.test(createBody);

    if (isDirectUserOwned && !tableOrigins.has(tableName)) {
      tableOrigins.set(tableName, {
        file,
        reason: explicitUserOwnedTables.get(tableName) ?? 'table stores direct user ownership',
      });
    }
  }

  const enableRlsPattern =
    /alter table\s+(?:if exists\s+)?(?:"?public"?\.)?"?([a-z0-9_]+)"?\s+enable row level security\b/gim;
  for (const match of normalizedSql.matchAll(enableRlsPattern)) {
    rlsEnabledTables.add(match[1].toLowerCase());
  }

  const createPolicyPattern =
    /create policy\s+.+?\s+on\s+(?:"?public"?\.)?"?([a-z0-9_]+)"?\b/gim;
  for (const match of normalizedSql.matchAll(createPolicyPattern)) {
    policyTables.add(match[1].toLowerCase());
  }
}

const errors = [];

for (const [tableName, origin] of tableOrigins.entries()) {
  if (!rlsEnabledTables.has(tableName)) {
    errors.push(
      `${tableName} (${origin.reason}) was introduced in ${origin.file} without any ENABLE ROW LEVEL SECURITY coverage in migrations.`,
    );
  }

  if (!policyTables.has(tableName)) {
    errors.push(
      `${tableName} (${origin.reason}) was introduced in ${origin.file} without any CREATE POLICY coverage in migrations.`,
    );
  }
}

if (errors.length > 0) {
  fail('Missing RLS coverage for user-owned Supabase tables.', errors);
}

console.log(
  `[check-supabase-rls] ok (${tableOrigins.size} user-owned table(s) covered by RLS and policies)`,
);
