#!/usr/bin/env node
/** Applies scripts/schema.sql to DATABASE_URL. Safe to run repeatedly. */
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Put it in .env.local and run with:\n' +
    '  node --env-file=.env.local scripts/db-init.mjs');
  process.exit(1);
}

const sql = neon(url);
const statements = readFileSync('scripts/schema.sql', 'utf8')
  .split(/;\s*$/m)
  .map((s) => s.trim())
  .filter((s) => s && !s.split('\n').every((l) => l.startsWith('--')));

for (const statement of statements) {
  await sql.query(statement);
  console.log(`  ok  ${statement.split('\n').filter((l) => !l.startsWith('--'))[0]}`);
}
console.log(`\n${statements.length} statements applied.`);
