-- AI Interviewer Platform - PostgreSQL schema
-- Run this to bootstrap the primary database. Migrations can be added later for production.

-- Users (recruiters / admins)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Candidates (interviewees)
CREATE TABLE IF NOT EXISTS candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255),
  name VARCHAR(255),
  external_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Positions / job roles for question banks
CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL, -- technical | behavioral | sales | customer_success
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Interview sessions (persisted after creation; live state in Redis)
CREATE TABLE IF NOT EXISTS interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id),
  position_id UUID REFERENCES positions(id),
  role VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled', -- scheduled | in_progress | completed | cancelled
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interviews_candidate ON interviews(candidate_id);
CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews(status);

-- Reports (generated after interview ends)
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID NOT NULL UNIQUE REFERENCES interviews(id),
  overall_score NUMERIC(5,2),
  max_score NUMERIC(5,2),
  recommendation VARCHAR(20),
  summary TEXT,
  red_flags JSONB DEFAULT '[]',
  strengths JSONB DEFAULT '[]',
  improvements JSONB DEFAULT '[]',
  competencies JSONB DEFAULT '[]',
  question_answer_summary JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_interview ON reports(interview_id);

-- Competencies (for scoring and reporting)
CREATE TABLE IF NOT EXISTS competencies (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Question bank (templates for question strategy engine)
CREATE TABLE IF NOT EXISTS question_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id UUID REFERENCES positions(id),
  role VARCHAR(50) NOT NULL,
  phase VARCHAR(20) NOT NULL,
  difficulty VARCHAR(20) NOT NULL,
  text TEXT NOT NULL,
  competency_ids TEXT[] DEFAULT '{}',
  follow_up_prompt TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_question_templates_role_phase ON question_templates(role, phase);
