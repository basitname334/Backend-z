/**
 * Ensure question_templates table and extended columns exist.
 * Called on server startup so admin question CRUD works without manual migrations.
 */
import { query } from './client';

export async function ensureQuestionTemplatesTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS question_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      position_id UUID,
      role VARCHAR(50) NOT NULL,
      phase VARCHAR(20) NOT NULL,
      difficulty VARCHAR(20) NOT NULL,
      text TEXT NOT NULL,
      competency_ids TEXT[] DEFAULT '{}',
      follow_up_prompt TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_question_templates_role_phase ON question_templates(role, phase);
  `);
  await query(`
    ALTER TABLE question_templates ADD COLUMN IF NOT EXISTS is_coding_question boolean DEFAULT false;
  `);
  await query(`
    ALTER TABLE question_templates ADD COLUMN IF NOT EXISTS starter_code text;
  `);
  await query(`
    ALTER TABLE question_templates ADD COLUMN IF NOT EXISTS language varchar(20);
  `);
  await query(`
    ALTER TABLE question_templates ADD COLUMN IF NOT EXISTS sort_order int DEFAULT 0;
  `);
}
