/**
 * Single database bootstrap: creates all tables in dependency order and runs seed.
 * Each step runs in try/catch so one failure (e.g. existing FK) doesn't leave the DB half-initialized.
 * Run this once at startup before any other ensure* logic.
 */
import { query } from './client';
import { logger } from '../config/logger';

async function runStep(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    logger.info(`Bootstrap: ${name} ok`);
  } catch (e) {
    logger.warn(`Bootstrap: ${name} failed:`, (e as Error).message);
  }
}

export async function bootstrapDatabase(): Promise<void> {
  logger.info('Database bootstrap starting...');

  // 1. Users (no deps)
  await runStep('users', async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'recruiter';`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS permission_level VARCHAR(20) NOT NULL DEFAULT 'full';`);
    await query(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);`);
  });

  // 1b. Recruiter password resets (for forgot-password flow)
  await runStep('recruiter_password_resets', async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS recruiter_password_resets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL,
        code VARCHAR(10) NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_recruiter_password_resets_email ON recruiter_password_resets(email);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_recruiter_password_resets_expires ON recruiter_password_resets(expires_at);`);
  });

  // 2. Candidates (no deps)
  await runStep('candidates', async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS candidates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255),
        name VARCHAR(255),
        external_id VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS phone VARCHAR(50);`);
    await query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS location VARCHAR(255);`);
    await query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS linkedin_url VARCHAR(255);`);
    await query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS portfolio_url VARCHAR(255);`);
  });

  // 3. Candidate accounts (depends: candidates)
  await runStep('candidate_accounts', async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS candidate_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        candidate_id UUID NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_candidate_accounts_candidate_id ON candidate_accounts(candidate_id);`);
  });

  // 3b. Candidate password resets (for forgot-password flow)
  await runStep('candidate_password_resets', async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS candidate_password_resets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL,
        code VARCHAR(10) NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_candidate_password_resets_email ON candidate_password_resets(email);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_candidate_password_resets_expires ON candidate_password_resets(expires_at);`);
  });

  // 3c. Candidate career preferences (for auto-apply and career page)
  await runStep('candidate_career_preferences', async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS candidate_career_preferences (
        candidate_id UUID PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
        preferred_roles TEXT[] DEFAULT '{}',
        preferred_locations TEXT[] DEFAULT '{}',
        career_goals TEXT,
        auto_apply_enabled BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  });

  // 3d. Tenants (SaaS: multi-org)
  await runStep('tenants', async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  });

  await runStep('users_org', async () => {
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;`);
    await query(`CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);`);
  });

  // 4. Positions (depends: users for created_by)
  await runStep('positions', async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS positions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(255) NOT NULL,
        company_name VARCHAR(255),
        description TEXT,
        requirements TEXT,
        location VARCHAR(255),
        salary_range VARCHAR(100),
        role VARCHAR(50) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await query(`
      ALTER TABLE positions
      ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
    `);
    await query(`ALTER TABLE positions ADD COLUMN IF NOT EXISTS description TEXT;`);
    await query(`ALTER TABLE positions ADD COLUMN IF NOT EXISTS requirements TEXT;`);
    await query(`ALTER TABLE positions ADD COLUMN IF NOT EXISTS location VARCHAR(255);`);
    await query(`ALTER TABLE positions ADD COLUMN IF NOT EXISTS salary_range VARCHAR(100);`);
    await query(`ALTER TABLE positions ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);`);
    await query(`ALTER TABLE positions ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;`);
    await query(`ALTER TABLE positions ADD COLUMN IF NOT EXISTS auto_schedule_enabled BOOLEAN NOT NULL DEFAULT false;`);
    await query(`CREATE INDEX IF NOT EXISTS idx_positions_created_by ON positions(created_by);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_positions_is_active ON positions(is_active);`);
  });

  await runStep('positions_org', async () => {
    await query(`ALTER TABLE positions ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;`);
    await query(`CREATE INDEX IF NOT EXISTS idx_positions_tenant_id ON positions(tenant_id);`);
  });

  // 5. Interviews (depends: candidates, positions)
  await runStep('interviews', async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS interviews (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        candidate_id UUID NOT NULL REFERENCES candidates(id),
        position_id UUID REFERENCES positions(id),
        role VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
        started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_interviews_candidate ON interviews(candidate_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews(status);`);
  });

  // 6. Reports (depends: interviews)
  await runStep('reports', async () => {
    await query(`
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
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_reports_interview ON reports(interview_id);`);
  });

  // 7. Competencies (no deps)
  await runStep('competencies', async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS competencies (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  });

  // 8. Question templates (depends: positions)
  await runStep('question_templates', async () => {
    await query(`
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
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_question_templates_role_phase ON question_templates(role, phase);`);
    await query(`ALTER TABLE question_templates ADD COLUMN IF NOT EXISTS is_coding_question boolean DEFAULT false;`);
    await query(`ALTER TABLE question_templates ADD COLUMN IF NOT EXISTS starter_code text;`);
    await query(`ALTER TABLE question_templates ADD COLUMN IF NOT EXISTS language varchar(20);`);
    await query(`ALTER TABLE question_templates ADD COLUMN IF NOT EXISTS sort_order int DEFAULT 0;`);
  });

  // 9. Applications (depends: candidates, positions)
  await runStep('applications', async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS applications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        candidate_id UUID NOT NULL REFERENCES candidates(id),
        position_id UUID NOT NULL REFERENCES positions(id),
        resume_url VARCHAR(255),
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS cover_letter TEXT;`);
    await query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS match_score INT;`);
    await query(`CREATE INDEX IF NOT EXISTS idx_applications_position_id ON applications(position_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_applications_candidate_id ON applications(candidate_id);`);
  });

  // 10. Scheduled interviews – create table without FKs first so it always exists even if deps failed
  await runStep('scheduled_interviews', async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS scheduled_interviews (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        candidate_email VARCHAR(255) NOT NULL,
        candidate_name VARCHAR(255),
        role VARCHAR(50) NOT NULL,
        preferred_difficulty VARCHAR(10),
        custom_questions JSONB DEFAULT '[]'::jsonb,
        position_id UUID,
        scheduled_at TIMESTAMPTZ NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
        join_token VARCHAR(64) NOT NULL UNIQUE,
        interview_id UUID,
        created_by UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await runStep('scheduled_interviews_indexes', async () => {
      await query(`CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_token ON scheduled_interviews(join_token);`);
      await query(`CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_status ON scheduled_interviews(status);`);
      await query(`CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_scheduled_at ON scheduled_interviews(scheduled_at);`);
    });
    await runStep('scheduled_interviews_fks', async () => {
      await query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_interviews_position_id_fkey') THEN
            ALTER TABLE scheduled_interviews ADD CONSTRAINT scheduled_interviews_position_id_fkey
              FOREIGN KEY (position_id) REFERENCES positions(id);
          END IF;
        END $$;
      `);
      await query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_interviews_interview_id_fkey') THEN
            ALTER TABLE scheduled_interviews ADD CONSTRAINT scheduled_interviews_interview_id_fkey
              FOREIGN KEY (interview_id) REFERENCES interviews(id);
          END IF;
        END $$;
      `);
      await query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_interviews_created_by_fkey') THEN
            ALTER TABLE scheduled_interviews ADD CONSTRAINT scheduled_interviews_created_by_fkey
              FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
          END IF;
        END $$;
      `);
    });
    await runStep('scheduled_interviews_columns', async () => {
      await query(`
        ALTER TABLE scheduled_interviews ADD COLUMN IF NOT EXISTS application_id UUID;
      `);
      await query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_interviews_application_id_fkey') AND to_regclass('public.applications') IS NOT NULL THEN
            ALTER TABLE scheduled_interviews ADD CONSTRAINT scheduled_interviews_application_id_fkey
              FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL;
          END IF;
        END $$;
      `);
      await query(`ALTER TABLE scheduled_interviews ADD COLUMN IF NOT EXISTS email_sent BOOLEAN;`);
      await query(`ALTER TABLE scheduled_interviews ADD COLUMN IF NOT EXISTS email_error TEXT;`);
      await query(`ALTER TABLE scheduled_interviews ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ;`);
      await query(`ALTER TABLE scheduled_interviews ADD COLUMN IF NOT EXISTS preferred_difficulty VARCHAR(10);`);
      await query(`ALTER TABLE scheduled_interviews ADD COLUMN IF NOT EXISTS custom_questions JSONB DEFAULT '[]'::jsonb;`);
      await query(`ALTER TABLE scheduled_interviews ADD COLUMN IF NOT EXISTS focus_areas TEXT;`);
      await query(`ALTER TABLE scheduled_interviews ADD COLUMN IF NOT EXISTS duration_minutes INT;`);
      await query(`ALTER TABLE scheduled_interviews ADD COLUMN IF NOT EXISTS resume_url VARCHAR(512);`);
      await query(`CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_application_id ON scheduled_interviews(application_id);`);
    });
  });

  // Community (LinkedIn-style feed: posts, likes, comments) — no FK to users/candidates to allow soft refs
  await runStep('community_posts', async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS community_posts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        author_id UUID NOT NULL,
        author_type VARCHAR(20) NOT NULL CHECK (author_type IN ('admin', 'recruiter', 'candidate')),
        author_name VARCHAR(255),
        author_email VARCHAR(255),
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_community_posts_author ON community_posts(author_id, author_type);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_community_posts_created_at ON community_posts(created_at DESC);`);
  });

  await runStep('community_post_likes', async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS community_post_likes (
        post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
        author_id UUID NOT NULL,
        author_type VARCHAR(20) NOT NULL CHECK (author_type IN ('admin', 'recruiter', 'candidate')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (post_id, author_id, author_type)
      );
    `);
  });

  await runStep('community_comments', async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS community_comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
        author_id UUID NOT NULL,
        author_type VARCHAR(20) NOT NULL CHECK (author_type IN ('admin', 'recruiter', 'candidate')),
        author_name VARCHAR(255),
        author_email VARCHAR(255),
        content TEXT NOT NULL,
        parent_id UUID REFERENCES community_comments(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_community_comments_post ON community_comments(post_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_community_comments_created_at ON community_comments(created_at);`);
  });

  await runStep('community_posts_rich', async () => {
    await query(`ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS post_type VARCHAR(20) NOT NULL DEFAULT 'post' CHECK (post_type IN ('post', 'article'));`);
    await query(`ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS title VARCHAR(500);`);
    await query(`ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;`);
    await query(`ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS hashtags JSONB DEFAULT '[]'::jsonb;`);
    await query(`ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS link_url VARCHAR(2048);`);
    await query(`ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS link_title VARCHAR(500);`);
    await query(`ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS link_image VARCHAR(2048);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_community_posts_post_type ON community_posts(post_type);`);
  });

  // 11. Seed data (idempotent)
  await runStep('seed', async () => {
    await query(`
      INSERT INTO candidates (id, email, name) VALUES
        ('00000000-0000-0000-0000-000000000001', 'candidate@example.com', 'Test Candidate')
      ON CONFLICT (id) DO NOTHING;
    `);
    await query(`
      INSERT INTO competencies (id, name, description) VALUES
        ('communication', 'Communication', 'Clarity and effectiveness of expression'),
        ('problem_solving', 'Problem Solving', 'Analytical and solution-oriented thinking'),
        ('technical_depth', 'Technical Depth', 'Depth of technical knowledge and practice'),
        ('judgment', 'Judgment', 'Quality of decisions and trade-offs'),
        ('collaboration', 'Collaboration', 'Working with others and stakeholders'),
        ('engagement', 'Engagement', 'Interest and questions about the role')
      ON CONFLICT (id) DO NOTHING;
    `);
  });

  logger.info('Database bootstrap finished.');
}
