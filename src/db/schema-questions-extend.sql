-- Extend question_templates for admin-added questions and coding questions (technical interviews).
-- Run: psql $DATABASE_URL -f src/db/schema-questions-extend.sql

ALTER TABLE question_templates ADD COLUMN IF NOT EXISTS is_coding_question boolean DEFAULT false;
ALTER TABLE question_templates ADD COLUMN IF NOT EXISTS starter_code text;
ALTER TABLE question_templates ADD COLUMN IF NOT EXISTS language varchar(20);
ALTER TABLE question_templates ADD COLUMN IF NOT EXISTS sort_order int DEFAULT 0;
