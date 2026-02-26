-- Scheduled interviews: admin creates a slot, gets a join link, candidate opens link to start.
-- Run after schema.sql: psql $DATABASE_URL -f src/db/schema-scheduled.sql

-- Scheduled interview slots (join link = /interview/join/{join_token})
CREATE TABLE IF NOT EXISTS scheduled_interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_email VARCHAR(255) NOT NULL,
  candidate_name VARCHAR(255),
  role VARCHAR(50) NOT NULL,
  preferred_difficulty VARCHAR(10),
  custom_questions JSONB DEFAULT '[]'::jsonb,
  position_id UUID REFERENCES positions(id),
  scheduled_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled', -- scheduled | in_progress | completed | cancelled
  join_token VARCHAR(64) NOT NULL UNIQUE,
  interview_id UUID REFERENCES interviews(id),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_token ON scheduled_interviews(join_token);
CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_status ON scheduled_interviews(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_scheduled_at ON scheduled_interviews(scheduled_at);

-- Ensure users table has an admin (run seed-admin.sql or insert manually)
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'recruiter';
-- For simplicity we use a single admin user; role can be added later.
-- Seed: one admin user (see seed-admin.sql)
