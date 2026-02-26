/**
 * Ensure scheduled_interviews table exists by running schema-scheduled.sql.
 * Called on server startup so the table is created without a separate migration step.
 */
import * as fs from 'fs';
import * as path from 'path';
import { query } from './client';

export async function ensureScheduledTable(): Promise<void> {
  const sqlPath = path.join(__dirname, 'schema-scheduled.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  // node-pg does not support multiple statements in one query; run each statement.
  const blocks = sql.split(/\n\s*\n/).map((block) =>
    block
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim()
  );
  for (const block of blocks) {
    if (!block) continue;
    const statements = block.split(';').map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await query(stmt + ';');
    }
  }

  // Keep older databases compatible with recruiter ownership.
  await query(`
    ALTER TABLE scheduled_interviews
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
  `);

  await query(`
    ALTER TABLE scheduled_interviews
    ADD COLUMN IF NOT EXISTS preferred_difficulty VARCHAR(10);
  `);

  await query(`
    ALTER TABLE scheduled_interviews
    ADD COLUMN IF NOT EXISTS custom_questions JSONB DEFAULT '[]'::jsonb;
  `);

  await query(`
    ALTER TABLE scheduled_interviews
    ADD COLUMN IF NOT EXISTS resume_url VARCHAR(512);
  `);
}
