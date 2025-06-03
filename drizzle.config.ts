import type { Config } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

export default {
  schema: './db/schema/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.SUPABASE_DATABASE_URL!,
  },
  breakpoints: true,
  // Config for SQLite (can be managed via CLI flags or a separate config file)
  // To generate for SQLite, you might use a command like:
  // npx drizzle-kit generate:sqlite --config path/to/sqlite.config.ts
  // or temporarily change this config.
  // Example for SQLite driver config (if using a separate file or switching this one):
  /*
  dialect: 'sqlite',
  driver: 'better-sqlite', // driver is used for specific sqlite variants if needed
  dbCredentials: {
    url: './local.db',
  },
  */
} satisfies Config; 