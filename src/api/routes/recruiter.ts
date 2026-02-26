import { Router, Request, Response } from 'express';
import { body, param } from 'express-validator';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { validate } from '../middleware/validate';
import { recruiterAuthMiddleware } from '../middleware/auth';
import { query } from '../../db/client';
import { config } from '../../config';
import { sendInterviewScheduleEmail } from '../../services/email.service';
import { getResumeTextForMatch, computeResumeJobMatchScore } from '../../services/interview/ResumeContextService';
import type { DifficultyLevel, ScheduledCustomQuestion } from '../../types';

const router = Router();
const ROLES = ['technical', 'behavioral', 'sales', 'customer_success'] as const;
const DIFFICULTY_LEVELS = ['easy', 'medium', 'hard'] as const;

function isDifficultyLevel(value: unknown): value is DifficultyLevel {
  return typeof value === 'string' && (DIFFICULTY_LEVELS as readonly string[]).includes(value);
}

function normalizeScheduleQuestions(input: {
  role: (typeof ROLES)[number];
  defaultDifficulty?: DifficultyLevel;
  customQuestionsRaw?: unknown;
  codingQuestionsRaw?: unknown;
}): ScheduledCustomQuestion[] {
  const toList = (
    raw: unknown,
    opts: { isCoding: boolean; defaultDifficulty: DifficultyLevel }
  ): ScheduledCustomQuestion[] => {
    if (!Array.isArray(raw)) return [];
    const out: ScheduledCustomQuestion[] = [];
    for (const item of raw) {
      const candidate =
        typeof item === 'string'
          ? { text: item }
          : item && typeof item === 'object'
            ? (item as Record<string, unknown>)
            : null;
      if (!candidate) continue;
      const text = typeof candidate.text === 'string' ? candidate.text.trim() : '';
      if (!text) continue;
      out.push({
        text,
        difficulty: isDifficultyLevel(candidate.difficulty) ? candidate.difficulty : opts.defaultDifficulty,
        isCodingQuestion: opts.isCoding,
        language: typeof candidate.language === 'string' ? candidate.language : null,
        starterCode: typeof candidate.starterCode === 'string' ? candidate.starterCode : null,
      });
    }
    return out;
  };

  const defaultDifficulty = input.defaultDifficulty ?? 'medium';
  const general = toList(input.customQuestionsRaw, { isCoding: false, defaultDifficulty });
  const coding =
    input.role === 'technical'
      ? toList(input.codingQuestionsRaw, { isCoding: true, defaultDifficulty })
      : [];
  return [...general, ...coding].slice(0, 30);
}

function toEmailSafeMessage(message?: string): string | undefined {
  if (!message) return undefined;
  const lines = message.split('\n');
  const cleaned: string[] = [];
  let suppressQuestionBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const startsQuestionBlock = /^custom questions:\s*$/i.test(trimmed) || /^coding questions:\s*$/i.test(trimmed);
    if (startsQuestionBlock) {
      suppressQuestionBlock = true;
      continue;
    }
    if (suppressQuestionBlock) {
      if (trimmed === '') {
        suppressQuestionBlock = false;
      }
      continue;
    }
    cleaned.push(line);
  }
  const finalMessage = cleaned.join('\n').trim();
  return finalMessage.length > 0 ? finalMessage : undefined;
}

router.get('/jobs', recruiterAuthMiddleware, async (req: Request, res: Response) => {
  const user = (req as Request & { user: { userId?: string } }).user;
  const userId = user.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Invalid token payload' });
  }
  const active = await ensureActiveRecruiter(userId);
  if (!active) {
    return res.status(403).json({ error: 'Recruiter access is disabled by admin' });
  }
  const { rows } = await query<{
    id: string;
    title: string;
    company_name: string | null;
    description: string | null;
    requirements: string | null;
    location: string | null;
    salary_range: string | null;
    role: string;
    is_active: boolean;
    created_at: string;
  }>(
    `SELECT id, title, company_name, description, requirements, location, salary_range, role, is_active, created_at
     FROM positions
     WHERE created_by = $1 AND is_active = true
     ORDER BY created_at DESC`,
    [userId]
  );
  return res.json({ jobs: rows });
});

router.post(
  '/jobs',
  recruiterAuthMiddleware,
  validate([
    body('title').isString().notEmpty(),
    body('companyName').optional().isString(),
    body('description').optional().isString(),
    body('requirements').optional().isString(),
    body('location').optional().isString(),
    body('salaryRange').optional().isString(),
    body('role').isIn(ROLES),
  ]),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: { userId?: string } }).user;
    const userId = user.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token payload' });
    }
    const active = await ensureActiveRecruiter(userId);
    if (!active) {
      return res.status(403).json({ error: 'Recruiter access is disabled by admin' });
    }
    const permissionLevel = await getRecruiterPermissionLevel(userId);
    if (permissionLevel !== 'full') {
      return res.status(403).json({ error: 'Limited access: you cannot create jobs. Schedule from existing applications only.' });
    }
    try {
      const { title, companyName, description, requirements, location, salaryRange, role } = req.body as {
        title: string;
        companyName?: string;
        description?: string;
        requirements?: string;
        location?: string;
        salaryRange?: string;
        role: (typeof ROLES)[number];
      };
      const { rows } = await query<{
        id: string;
        title: string;
        company_name: string | null;
        description: string | null;
        requirements: string | null;
        location: string | null;
        salary_range: string | null;
        role: string;
        is_active: boolean;
        created_at: string;
      }>(
        `INSERT INTO positions (id, title, company_name, description, requirements, location, salary_range, role, is_active, created_by, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, true, $8, NOW())
         RETURNING id, title, company_name, description, requirements, location, salary_range, role, is_active, created_at`,
        [title, companyName ?? null, description ?? null, requirements ?? null, location ?? null, salaryRange ?? null, role, userId]
      );
      return res.status(201).json({ job: rows[0] });
    } catch (e) {
      console.error('Recruiter create job error', e);
      return res.status(500).json({ error: 'Failed to create job' });
    }
  }
);

router.delete(
  '/jobs/:id',
  recruiterAuthMiddleware,
  validate([param('id').isUUID()]),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: { userId?: string } }).user;
    const userId = user.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token payload' });
    }
    const active = await ensureActiveRecruiter(userId);
    if (!active) {
      return res.status(403).json({ error: 'Recruiter access is disabled by admin' });
    }
    const { rowCount } = await query(
      `UPDATE positions
       SET is_active = false
       WHERE id = $1 AND created_by = $2 AND is_active = true`,
      [req.params.id, userId]
    );
    return res.json({ deleted: (rowCount ?? 0) > 0 });
  }
);

router.get('/applications', recruiterAuthMiddleware, async (req: Request, res: Response) => {
  const user = (req as Request & { user: { userId?: string } }).user;
  const userId = user.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Invalid token payload' });
  }
  const active = await ensureActiveRecruiter(userId);
  if (!active) {
    return res.status(403).json({ error: 'Recruiter access is disabled by admin' });
  }
  const { rows } = await query<{
    id: string;
    status: string;
    resume_url: string | null;
    cover_letter: string | null;
    created_at: string;
    candidate_id: string;
    position_id: string;
    candidate_email: string | null;
    candidate_name: string | null;
    position_title: string;
    position_role: string;
    position_requirements: string | null;
    position_description: string | null;
    interview_email_sent: boolean | null;
    interview_email_error: string | null;
  }>(
    `SELECT a.id, a.status, a.resume_url, a.cover_letter, a.created_at, a.candidate_id, a.position_id,
            c.email AS candidate_email, c.name AS candidate_name, p.title AS position_title, p.role AS position_role,
            p.requirements AS position_requirements, p.description AS position_description,
            si.email_sent AS interview_email_sent, si.email_error AS interview_email_error
     FROM applications a
     INNER JOIN positions p ON p.id = a.position_id
     INNER JOIN candidates c ON c.id = a.candidate_id
     LEFT JOIN LATERAL (
       SELECT s.email_sent, s.email_error
       FROM scheduled_interviews s
       WHERE s.application_id = a.id
       ORDER BY s.created_at DESC
       LIMIT 1
     ) si ON TRUE
     WHERE p.created_by = $1
     ORDER BY a.created_at DESC`,
    [userId]
  );

  const applications = await Promise.all(
    rows.map(async (row) => {
      const jobText = [row.position_requirements ?? '', row.position_description ?? ''].join(' ').trim();
      let match_score: number | null = null;
      if (row.resume_url && jobText) {
        try {
          const resumeText = await getResumeTextForMatch(row.resume_url);
          match_score = resumeText ? computeResumeJobMatchScore(jobText, resumeText) : null;
        } catch {
          match_score = null;
        }
      }
      const { position_requirements: _pr, position_description: _pd, ...rest } = row;
      return { ...rest, match_score };
    })
  );

  return res.json({ applications });
});

router.post(
  '/applications/:id/reject',
  recruiterAuthMiddleware,
  validate([param('id').isUUID()]),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: { userId?: string } }).user;
    const userId = user.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token payload' });
    }
    const active = await ensureActiveRecruiter(userId);
    if (!active) {
      return res.status(403).json({ error: 'Recruiter access is disabled by admin' });
    }
    const { id } = req.params;
    const { rows } = await query<{ status: string }>(
      `SELECT a.status
       FROM applications a
       INNER JOIN positions p ON p.id = a.position_id
       WHERE a.id = $1 AND p.created_by = $2
       LIMIT 1`,
      [id, userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }
    if (rows[0].status === 'interview_scheduled') {
      return res.status(400).json({ error: 'Cannot reject after interview is scheduled' });
    }
    const { rowCount } = await query(
      `UPDATE applications
       SET status = 'rejected', updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
    return res.json({ updated: (rowCount ?? 0) > 0 });
  }
);

router.post(
  '/applications/:id/schedule',
  recruiterAuthMiddleware,
  validate([
    param('id').isUUID(),
    body('scheduledAt').isISO8601().withMessage('scheduledAt must be a valid ISO 8601 date'),
    body('role').optional().isIn(ROLES),
    body('message').optional().isString(),
    body('difficulty').optional().isIn(DIFFICULTY_LEVELS),
    body('customQuestions').optional().isArray(),
    body('codingQuestions').optional().isArray(),
    body('focusAreas').optional().isString(),
    body('durationMinutes').optional().isInt({ min: 5, max: 240 }),
  ]),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: { userId?: string } }).user;
    const userId = user.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token payload' });
    }
    const active = await ensureActiveRecruiter(userId);
    if (!active) {
      return res.status(403).json({ error: 'Recruiter access is disabled by admin' });
    }
    try {
      const { id } = req.params;
      const { scheduledAt, role, message, difficulty, customQuestions, codingQuestions, focusAreas, durationMinutes } = req.body as {
        scheduledAt: string;
        role?: (typeof ROLES)[number];
        message?: string;
        difficulty?: DifficultyLevel;
        customQuestions?: unknown[];
        codingQuestions?: unknown[];
        focusAreas?: string;
        durationMinutes?: number;
      };
      const { rows: recruiterRows } = await query<{ name: string | null }>(
        `SELECT name FROM users WHERE id = $1 LIMIT 1`,
        [userId]
      );
      const recruiterName = recruiterRows[0]?.name ?? null;
      const { rows } = await query<{
        application_id: string;
        candidate_email: string | null;
        candidate_name: string | null;
        position_id: string;
        position_role: string;
      }>(
        `SELECT a.id AS application_id, c.email AS candidate_email, c.name AS candidate_name, p.id AS position_id, p.role AS position_role
         FROM applications a
         INNER JOIN positions p ON p.id = a.position_id
         INNER JOIN candidates c ON c.id = a.candidate_id
         WHERE a.id = $1 AND p.created_by = $2
         LIMIT 1`,
        [id, userId]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Application not found' });
      }
      const row = rows[0];
      if (!row.candidate_email) {
        return res.status(400).json({ error: 'Candidate email is required before scheduling' });
      }
      const scheduleRole = role ?? (row.position_role as (typeof ROLES)[number]);
      if (!ROLES.includes(scheduleRole)) {
        return res.status(400).json({ error: 'Invalid interview role' });
      }
      const normalizedQuestions = normalizeScheduleQuestions({
        role: scheduleRole,
        defaultDifficulty: difficulty,
        customQuestionsRaw: customQuestions,
        codingQuestionsRaw: codingQuestions,
      });
      const joinToken = crypto.randomBytes(32).toString('hex');
      const { rows: scheduleRows } = await query<{
        id: string;
        candidate_email: string;
        candidate_name: string | null;
        role: string;
        scheduled_at: string;
        status: string;
        join_token: string;
      }>(
        `INSERT INTO scheduled_interviews (id, candidate_email, candidate_name, role, preferred_difficulty, custom_questions, focus_areas, duration_minutes, scheduled_at, join_token, position_id, created_by, application_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, $6, $7, $8::timestamptz, $9, $10, $11, $12, NOW(), NOW())
         RETURNING id, candidate_email, candidate_name, role, scheduled_at, status, join_token`,
        [
          row.candidate_email,
          row.candidate_name,
          scheduleRole,
          difficulty ?? null,
          JSON.stringify(normalizedQuestions),
          focusAreas?.trim() || null,
          durationMinutes ?? null,
          scheduledAt,
          joinToken,
          row.position_id,
          userId,
          row.application_id,
        ]
      );
      await query(`UPDATE applications SET status = 'interview_scheduled', updated_at = NOW() WHERE id = $1`, [
        row.application_id,
      ]);
      const created = scheduleRows[0];
      const joinUrl = `${config.frontendUrl}/interview/join/${created.join_token}`;
      const mailResult = await sendInterviewScheduleEmail({
        to: created.candidate_email,
        candidateName: created.candidate_name,
        recruiterName,
        role: created.role,
        scheduledAt: created.scheduled_at,
        joinUrl,
        message: toEmailSafeMessage(message),
      });
      await query(
        `UPDATE scheduled_interviews
         SET email_sent = $2, email_error = $3, email_sent_at = CASE WHEN $2 = true THEN NOW() ELSE NULL END, updated_at = NOW()
         WHERE id = $1`,
        [created.id, mailResult.sent, mailResult.error ?? null]
      );
      return res.status(201).json({
        id: created.id,
        joinToken: created.join_token,
        joinUrl,
        candidateEmail: created.candidate_email,
        candidateName: created.candidate_name,
        role: created.role,
        scheduledAt: created.scheduled_at,
        status: created.status,
        emailSent: mailResult.sent,
        emailError: mailResult.error,
      });
    } catch (e) {
      console.error('Recruiter schedule from application error', e);
      return res.status(500).json({ error: 'Failed to schedule interview' });
    }
  }
);

router.post(
  '/login',
  validate([
    body('email').isEmail(),
    body('password').isString().notEmpty(),
  ]),
  async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body as { email: string; password: string };
      const { rows } = await query<{
        id: string;
        email: string;
        name: string | null;
        password_hash: string;
        role: string;
        is_active: boolean;
      }>(
        `SELECT id, email, name, password_hash, role, is_active
         FROM users
         WHERE email = $1
         LIMIT 1`,
        [email.toLowerCase()]
      );
      if (rows.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const user = rows[0];
      if (user.role !== 'recruiter') {
        return res.status(403).json({ error: 'Recruiter access required' });
      }
      if (!user.is_active) {
        return res.status(403).json({ error: 'Recruiter access is disabled by admin' });
      }
      const matches = await bcrypt.compare(password, user.password_hash);
      if (!matches) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const token = jwt.sign(
        {
          sub: user.email,
          email: user.email,
          type: 'recruiter',
          userId: user.id,
          role: 'recruiter',
        },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn as SignOptions['expiresIn'] }
      );
      return res.json({
        token,
        recruiter: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      });
    } catch (e) {
      console.error('Recruiter login error', e);
      return res.status(500).json({ error: 'Login failed' });
    }
  }
);

router.get('/me', recruiterAuthMiddleware, async (req: Request, res: Response) => {
  const user = (req as Request & { user: { userId?: string; email?: string } }).user;
  const userId = user.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Invalid token payload' });
  }
  const { rows } = await query<{ id: string; email: string; name: string | null; is_active: boolean }>(
    `SELECT id, email, name, is_active FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Recruiter not found' });
  }
  if (!rows[0].is_active) {
    return res.status(403).json({ error: 'Recruiter access is disabled by admin' });
  }
  return res.json({ recruiter: rows[0] });
});

router.get('/schedules', recruiterAuthMiddleware, async (req: Request, res: Response) => {
  const user = (req as Request & { user: { userId?: string } }).user;
  const userId = user.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Invalid token payload' });
  }
  const active = await ensureActiveRecruiter(userId);
  if (!active) {
    return res.status(403).json({ error: 'Recruiter access is disabled by admin' });
  }
  const { rows } = await query<{
    id: string;
    candidate_email: string;
    candidate_name: string | null;
    role: string;
    scheduled_at: string;
    status: string;
    join_token: string;
    interview_id: string | null;
    created_at: string;
  }>(
    `SELECT id, candidate_email, candidate_name, role, scheduled_at, status, join_token, interview_id, created_at
     FROM scheduled_interviews
     WHERE created_by = $1
     ORDER BY scheduled_at DESC`,
    [userId]
  );
  const schedules = rows.map((r) => ({
    ...r,
    joinUrl: `${config.frontendUrl}/interview/join/${r.join_token}`,
  }));
  return res.json({ schedules });
});

router.post(
  '/schedule',
  recruiterAuthMiddleware,
  validate([
    body('candidateEmail').isEmail(),
    body('candidateName').optional().isString(),
    body('role').isIn(ROLES),
    body('scheduledAt').isISO8601().withMessage('scheduledAt must be a valid ISO 8601 date'),
    body('positionId').optional().isUUID(),
    body('message').optional().isString(),
    body('difficulty').optional().isIn(DIFFICULTY_LEVELS),
    body('customQuestions').optional().isArray(),
    body('codingQuestions').optional().isArray(),
    body('focusAreas').optional().isString(),
    body('durationMinutes').optional().isInt({ min: 5, max: 240 }),
    body('resumeUrl').optional().isString(),
  ]),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: { userId?: string } }).user;
    const userId = user.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token payload' });
    }
    const active = await ensureActiveRecruiter(userId);
    if (!active) {
      return res.status(403).json({ error: 'Recruiter access is disabled by admin' });
    }
    const permissionLevel = await getRecruiterPermissionLevel(userId);
    if (permissionLevel !== 'full') {
      return res.status(403).json({ error: 'Limited access: you can only schedule from Applications, not create direct links.' });
    }
    try {
      const { candidateEmail, candidateName, role, scheduledAt, positionId, message, difficulty, customQuestions, codingQuestions, focusAreas, durationMinutes, resumeUrl } = req.body as {
        candidateEmail: string;
        candidateName?: string;
        role: (typeof ROLES)[number];
        scheduledAt: string;
        positionId?: string;
        message?: string;
        difficulty?: DifficultyLevel;
        customQuestions?: unknown[];
        codingQuestions?: unknown[];
        focusAreas?: string;
        durationMinutes?: number;
        resumeUrl?: string;
      };
      const normalizedQuestions = normalizeScheduleQuestions({
        role,
        defaultDifficulty: difficulty,
        customQuestionsRaw: customQuestions,
        codingQuestionsRaw: codingQuestions,
      });
      const { rows: recruiterRows } = await query<{ name: string | null }>(
        `SELECT name FROM users WHERE id = $1 LIMIT 1`,
        [userId]
      );
      const recruiterName = recruiterRows[0]?.name ?? null;
      const joinToken = crypto.randomBytes(32).toString('hex');
      const { rows } = await query<{
        id: string;
        candidate_email: string;
        candidate_name: string | null;
        role: string;
        scheduled_at: string;
        status: string;
        join_token: string;
      }>(
        `INSERT INTO scheduled_interviews (id, candidate_email, candidate_name, role, preferred_difficulty, custom_questions, focus_areas, duration_minutes, scheduled_at, join_token, position_id, created_by, resume_url, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, $6, $7, $8::timestamptz, $9, $10, $11, $12, NOW(), NOW())
         RETURNING id, candidate_email, candidate_name, role, scheduled_at, status, join_token`,
        [
          candidateEmail,
          candidateName || null,
          role,
          difficulty ?? null,
          JSON.stringify(normalizedQuestions),
          focusAreas?.trim() || null,
          durationMinutes ?? null,
          scheduledAt,
          joinToken,
          positionId || null,
          userId,
          resumeUrl?.trim() || null,
        ]
      );
      if (rows.length === 0) {
        return res.status(500).json({ error: 'Failed to create schedule' });
      }
      const row = rows[0];
      const joinUrl = `${config.frontendUrl}/interview/join/${row.join_token}`;
      const mailResult = await sendInterviewScheduleEmail({
        to: row.candidate_email,
        candidateName: row.candidate_name,
        recruiterName,
        role: row.role,
        scheduledAt: row.scheduled_at,
        joinUrl,
        message: toEmailSafeMessage(message),
      });
      await query(
        `UPDATE scheduled_interviews
         SET email_sent = $2, email_error = $3, email_sent_at = CASE WHEN $2 = true THEN NOW() ELSE NULL END, updated_at = NOW()
         WHERE id = $1`,
        [row.id, mailResult.sent, mailResult.error ?? null]
      );
      return res.status(201).json({
        id: row.id,
        joinToken: row.join_token,
        joinUrl,
        candidateEmail: row.candidate_email,
        candidateName: row.candidate_name,
        role: row.role,
        scheduledAt: row.scheduled_at,
        status: row.status,
        emailSent: mailResult.sent,
        emailError: mailResult.error,
      });
    } catch (e) {
      const err = e as Error;
      console.error('Recruiter create schedule error', err);
      const message = config.env === 'development' ? err.message : 'Failed to create schedule';
      return res.status(500).json({ error: message });
    }
  }
);

router.patch(
  '/schedule/:id',
  recruiterAuthMiddleware,
  validate([
    param('id').isUUID(),
    body('status').optional().isIn(['scheduled', 'in_progress', 'completed', 'cancelled']),
    body('scheduledAt').optional().isISO8601(),
  ]),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: { userId?: string } }).user;
    const userId = user.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token payload' });
    }
    const active = await ensureActiveRecruiter(userId);
    if (!active) {
      return res.status(403).json({ error: 'Recruiter access is disabled by admin' });
    }
    const { id } = req.params;
    const { status, scheduledAt } = req.body as { status?: string; scheduledAt?: string };
    const updates: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (status !== undefined) {
      updates.push(`status = $${i}`);
      params.push(status);
      i++;
    }
    if (scheduledAt !== undefined) {
      updates.push(`scheduled_at = $${i}::timestamptz`);
      params.push(scheduledAt);
      i++;
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }
    updates.push('updated_at = NOW()');
    params.push(id, userId);
    const { rowCount } = await query(
      `UPDATE scheduled_interviews
       SET ${updates.join(', ')}
       WHERE id = $${i} AND created_by = $${i + 1}`,
      params
    );
    return res.json({ updated: (rowCount ?? 0) > 0 });
  }
);

router.delete(
  '/schedule/:id',
  recruiterAuthMiddleware,
  validate([param('id').isUUID()]),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: { userId?: string } }).user;
    const userId = user.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token payload' });
    }
    const active = await ensureActiveRecruiter(userId);
    if (!active) {
      return res.status(403).json({ error: 'Recruiter access is disabled by admin' });
    }
    const { rowCount } = await query(
      `DELETE FROM scheduled_interviews WHERE id = $1 AND created_by = $2`,
      [req.params.id, userId]
    );
    return res.json({ deleted: (rowCount ?? 0) > 0 });
  }
);

export const recruiterRoutes = router;

async function ensureActiveRecruiter(userId: string): Promise<boolean> {
  const { rows } = await query<{ is_active: boolean; role: string }>(
    `SELECT is_active, role FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  if (rows.length === 0) return false;
  return rows[0].role === 'recruiter' && rows[0].is_active;
}

async function getRecruiterPermissionLevel(userId: string): Promise<'full' | 'limited'> {
  const { rows } = await query<{ permission_level: string | null }>(
    `SELECT COALESCE(permission_level, 'full') AS permission_level FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  if (rows.length === 0) return 'limited';
  return (rows[0].permission_level === 'full' ? 'full' : 'limited') as 'full' | 'limited';
}
