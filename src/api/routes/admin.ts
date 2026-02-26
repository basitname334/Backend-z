/**
 * Admin API: login (issue JWT), schedule CRUD, question bank CRUD, optional protected routes.
 */
import { Router, Request, Response } from 'express';
import { body, param, query as q } from 'express-validator';
import jwt, { type SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { config } from '../../config';
import { query } from '../../db/client';
import { validate } from '../middleware/validate';
import { adminAuthMiddleware } from '../middleware/auth';
import * as questionTemplateService from '../../services/questionTemplate.service';

const router = Router();
const ROLES = ['technical', 'behavioral', 'sales', 'customer_success'] as const;
const PHASES = ['intro', 'technical', 'behavioral', 'wrap_up'] as const;
const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

/** POST /admin/login - Admin login, returns JWT with type 'admin' */
router.post(
  '/login',
  validate([
    body('email').isEmail(),
    body('password').isString().notEmpty(),
  ]),
  async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (email !== config.admin.email) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      if (password !== config.admin.password) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const token = jwt.sign(
        { sub: email, email, type: 'admin' },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn as SignOptions['expiresIn'] }
      );
      res.json({ token, email });
    } catch (e) {
      console.error('Admin login error', e);
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

/** GET /admin/me - Require admin JWT, return current admin info */
router.get('/me', adminAuthMiddleware, (req: Request, res: Response) => {
  const user = (req as Request & { user: { sub: string; email?: string } }).user;
  res.json({ email: user.email ?? user.sub });
});

/** POST /admin/recruiters - Admin creates recruiter account */
router.post(
  '/recruiters',
  adminAuthMiddleware,
  validate([
    body('email').isEmail(),
    body('name').optional().isString(),
    body('password').isString().isLength({ min: 6 }),
  ]),
  async (req: Request, res: Response) => {
    try {
      const email = String(req.body.email).toLowerCase();
      const name = req.body.name ? String(req.body.name) : null;
      const password = String(req.body.password);
      const passwordHash = await bcrypt.hash(password, 10);
      const { rows } = await query<{ id: string; email: string; name: string | null; role: string; is_active: boolean }>(
        `INSERT INTO users (id, email, password_hash, name, role, is_active, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'recruiter', true, NOW(), NOW())
         RETURNING id, email, name, role, is_active`,
        [email, passwordHash, name]
      );
      return res.status(201).json({ recruiter: rows[0] });
    } catch (e) {
      const err = e as Error;
      if ('code' in (e as Record<string, unknown>) && (e as { code?: string }).code === '23505') {
        return res.status(409).json({ error: 'Recruiter email already exists' });
      }
      console.error('Admin create recruiter error', err);
      return res.status(500).json({ error: 'Failed to create recruiter' });
    }
  }
);

/** GET /admin/recruiters - List all recruiters */
router.get('/recruiters', adminAuthMiddleware, async (_req: Request, res: Response) => {
  try {
    const { rows } = await query<{
      id: string;
      email: string;
      name: string | null;
      created_at: string;
      schedule_count: string;
      is_active: boolean;
      permission_level: string;
    }>(
      `SELECT u.id, u.email, u.name, u.created_at, u.is_active, COALESCE(u.permission_level, 'full') AS permission_level, COUNT(s.id)::text AS schedule_count
       FROM users u
       LEFT JOIN scheduled_interviews s ON s.created_by = u.id
       WHERE u.role = 'recruiter'
       GROUP BY u.id, u.email, u.name, u.created_at, u.is_active, u.permission_level
       ORDER BY u.created_at DESC`
    );
    return res.json({ recruiters: rows });
  } catch (e) {
    console.error('Admin list recruiters error', e);
    return res.status(500).json({ error: 'Failed to load recruiters' });
  }
});

/** PATCH /admin/recruiters/:id - Manage recruiter access/details (including password) */
router.patch(
  '/recruiters/:id',
  adminAuthMiddleware,
  validate([
    param('id').isUUID(),
    body('isActive').optional().isBoolean(),
    body('name').optional().isString(),
    body('permissionLevel').optional().isIn(['full', 'limited']),
    body('password').optional().isString().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ]),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { isActive, name, permissionLevel, password } = req.body as {
        isActive?: boolean;
        name?: string;
        permissionLevel?: 'full' | 'limited';
        password?: string;
      };
      const updates: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (typeof isActive === 'boolean') {
        updates.push(`is_active = $${i}`);
        params.push(isActive);
        i++;
      }
      if (name !== undefined) {
        updates.push(`name = $${i}`);
        params.push(name || null);
        i++;
      }
      if (permissionLevel !== undefined) {
        updates.push(`permission_level = $${i}`);
        params.push(permissionLevel);
        i++;
      }
      if (password !== undefined && password.length >= 6) {
        const passwordHash = await bcrypt.hash(password, 10);
        updates.push(`password_hash = $${i}`);
        params.push(passwordHash);
        i++;
      }
      if (updates.length === 0) {
        return res.status(400).json({ error: 'No updates provided' });
      }
      updates.push('updated_at = NOW()');
      params.push(id);
      const { rows } = await query<{ id: string; email: string; name: string | null; is_active: boolean; permission_level: string }>(
        `UPDATE users
         SET ${updates.join(', ')}
         WHERE id = $${i} AND role = 'recruiter'
         RETURNING id, email, name, is_active, COALESCE(permission_level, 'full') AS permission_level`,
        params
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Recruiter not found' });
      }
      return res.json({ recruiter: rows[0] });
    } catch (e) {
      console.error('Admin update recruiter error', e);
      return res.status(500).json({ error: 'Failed to update recruiter' });
    }
  }
);

/** DELETE /admin/recruiters/:id - Remove recruiter */
router.delete(
  '/recruiters/:id',
  adminAuthMiddleware,
  validate([param('id').isUUID()]),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { rowCount } = await query(
        `DELETE FROM users WHERE id = $1 AND role = 'recruiter'`,
        [id]
      );
      return res.json({ deleted: (rowCount ?? 0) > 0 });
    } catch (e) {
      console.error('Admin delete recruiter error', e);
      return res.status(500).json({ error: 'Failed to delete recruiter' });
    }
  }
);

/** GET /admin/candidates - List all candidates */
router.get('/candidates', adminAuthMiddleware, async (_req: Request, res: Response) => {
  try {
    const { rows } = await query<{
      id: string;
      email: string | null;
      name: string | null;
      created_at: string;
      application_count: string;
    }>(
      `SELECT c.id, c.email, c.name, c.created_at, COUNT(a.id)::text AS application_count
       FROM candidates c
       LEFT JOIN applications a ON a.candidate_id = c.id
       GROUP BY c.id, c.email, c.name, c.created_at
       ORDER BY c.created_at DESC`
    );
    return res.json({ candidates: rows });
  } catch (e) {
    console.error('Admin list candidates error', e);
    return res.status(500).json({ error: 'Failed to load candidates' });
  }
});

/** GET /admin/applications - List all applications (all recruiters' jobs) */
router.get('/applications', adminAuthMiddleware, async (_req: Request, res: Response) => {
  try {
    const { rows } = await query<{
      id: string;
      status: string;
      resume_url: string | null;
      created_at: string;
      candidate_id: string;
      position_id: string;
      candidate_email: string | null;
      candidate_name: string | null;
      position_title: string;
      position_role: string;
      recruiter_email: string | null;
      recruiter_name: string | null;
    }>(
      `SELECT a.id, a.status, a.resume_url, a.created_at, a.candidate_id, a.position_id,
              c.email AS candidate_email, c.name AS candidate_name,
              p.title AS position_title, p.role AS position_role,
              u.email AS recruiter_email, u.name AS recruiter_name
       FROM applications a
       INNER JOIN candidates c ON c.id = a.candidate_id
       INNER JOIN positions p ON p.id = a.position_id
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.is_active = true
       ORDER BY a.created_at DESC`
    );
    return res.json({ applications: rows });
  } catch (e) {
    console.error('Admin list applications error', e);
    return res.status(500).json({ error: 'Failed to load applications' });
  }
});

/** GET /admin/overview - App-wide counters and latest schedules */
router.get('/overview', adminAuthMiddleware, async (_req: Request, res: Response) => {
  try {
    const [{ rows: recruiterRows }, { rows: candidateRows }, { rows: interviewRows }, { rows: scheduleRows }] = await Promise.all([
      query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM users WHERE role = 'recruiter'`),
      query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM candidates`),
      query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM interviews`),
      query(
        `SELECT s.id, s.candidate_email, s.candidate_name, s.role, s.scheduled_at, s.status, s.join_token, s.interview_id,
                u.name AS recruiter_name, u.email AS recruiter_email
         FROM scheduled_interviews s
         LEFT JOIN users u ON u.id = s.created_by
         ORDER BY s.created_at DESC
         LIMIT 10`
      ),
    ]);
    return res.json({
      metrics: {
        recruiters: Number(recruiterRows[0]?.total ?? 0),
        candidates: Number(candidateRows[0]?.total ?? 0),
        interviews: Number(interviewRows[0]?.total ?? 0),
      },
      latestSchedules: (scheduleRows as Array<Record<string, unknown>>).map((row) => ({
        ...row,
        joinUrl: `${config.frontendUrl}/interview/join/${String(row.join_token)}`,
      })),
    });
  } catch (e) {
    console.error('Admin overview error', e);
    return res.status(500).json({ error: 'Failed to load overview' });
  }
});

/** POST /admin/schedule - Create scheduled interview, return join URL */
router.post(
  '/schedule',
  adminAuthMiddleware,
  validate([
    body('candidateEmail').isEmail(),
    body('candidateName').optional().isString(),
    body('role').isIn(ROLES),
    body('scheduledAt').isISO8601().withMessage('scheduledAt must be a valid ISO 8601 date'),
    body('positionId').optional().isUUID(),
  ]),
  async (req: Request, res: Response) => {
    try {
      const { candidateEmail, candidateName, role, scheduledAt, positionId } = req.body;
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
        `INSERT INTO scheduled_interviews (id, candidate_email, candidate_name, role, scheduled_at, join_token, position_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4::timestamptz, $5, $6, NOW(), NOW())
         RETURNING id, candidate_email, candidate_name, role, scheduled_at, status, join_token`,
        [candidateEmail, candidateName || null, role, scheduledAt, joinToken, positionId || null]
      );
      if (rows.length === 0) {
        return res.status(500).json({ error: 'Failed to create schedule' });
      }
      const row = rows[0];
      const joinUrl = `${config.frontendUrl}/interview/join/${row.join_token}`;
      res.status(201).json({
        id: row.id,
        joinToken: row.join_token,
        joinUrl,
        candidateEmail: row.candidate_email,
        candidateName: row.candidate_name,
        role: row.role,
        scheduledAt: row.scheduled_at,
        status: row.status,
      });
    } catch (e) {
      const err = e as Error;
      console.error('Admin create schedule error', err);
      const message = config.env === 'development' ? err.message : 'Failed to create schedule';
      res.status(500).json({ error: message });
    }
  }
);

/** GET /admin/schedules - List scheduled interviews (optional ?status=) */
router.get(
  '/schedules',
  adminAuthMiddleware,
  validate([q('status').optional().isIn(['scheduled', 'in_progress', 'completed', 'cancelled'])]),
  async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const sql = status
        ? `SELECT id, candidate_email, candidate_name, role, scheduled_at, status, join_token, interview_id, created_at
           FROM scheduled_interviews WHERE status = $1 ORDER BY scheduled_at DESC`
        : `SELECT id, candidate_email, candidate_name, role, scheduled_at, status, join_token, interview_id, created_at
           FROM scheduled_interviews ORDER BY scheduled_at DESC`;
      const params = status ? [status] : [];
      const { rows } = await query(sql, params);
      const baseUrl = config.frontendUrl;
      const schedules = (rows as Array<Record<string, unknown>>).map((r) => ({
        ...r,
        joinUrl: `${baseUrl}/interview/join/${r.join_token}`,
      }));
      res.json({ schedules });
    } catch (e) {
      console.error('Admin get schedules error', e);
      res.status(500).json({ error: 'Failed to load schedules' });
    }
  }
);

/** GET /admin/schedule/:id - Get one schedule with join URL */
router.get(
  '/schedule/:id',
  adminAuthMiddleware,
  validate([param('id').isUUID()]),
  async (req: Request, res: Response) => {
    try {
      const { rows } = await query(
        `SELECT id, candidate_email, candidate_name, role, scheduled_at, status, join_token, interview_id, created_at
         FROM scheduled_interviews WHERE id = $1`,
        [req.params.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Schedule not found' });
      }
      const row = rows[0] as Record<string, unknown>;
      res.json({ ...row, joinUrl: `${config.frontendUrl}/interview/join/${row.join_token}` });
    } catch (e) {
      console.error('Admin get schedule error', e);
      res.status(500).json({ error: 'Failed to load schedule' });
    }
  }
);

/** PATCH /admin/schedule/:id - Update schedule (scheduledAt, status) */
router.patch(
  '/schedule/:id',
  adminAuthMiddleware,
  validate([
    param('id').isUUID(),
    body('scheduledAt').optional().isISO8601(),
    body('status').optional().isIn(['scheduled', 'in_progress', 'completed', 'cancelled']),
  ]),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { scheduledAt, status } = req.body;
      const updates: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (scheduledAt !== undefined) {
        updates.push(`scheduled_at = $${i}::timestamptz`);
        params.push(scheduledAt);
        i++;
      }
      if (status !== undefined) {
        updates.push(`status = $${i}`);
        params.push(status);
        i++;
      }
      if (updates.length === 0) {
        return res.status(400).json({ error: 'No updates provided' });
      }
      updates.push(`updated_at = NOW()`);
      params.push(id);
      const { rowCount } = await query(
        `UPDATE scheduled_interviews SET ${updates.join(', ')} WHERE id = $${i}`,
        params
      );
      res.json({ updated: (rowCount ?? 0) > 0 });
    } catch (e) {
      console.error('Admin update schedule error', e);
      res.status(500).json({ error: 'Failed to update schedule' });
    }
  }
);

/** DELETE /admin/schedule/:id - Delete a scheduled interview */
router.delete(
  '/schedule/:id',
  adminAuthMiddleware,
  validate([param('id').isUUID()]),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { rowCount } = await query(
        `DELETE FROM scheduled_interviews WHERE id = $1`,
        [id]
      );
      res.json({ deleted: (rowCount ?? 0) > 0 });
    } catch (e) {
      console.error('Admin delete schedule error', e);
      res.status(500).json({ error: 'Failed to delete schedule' });
    }
  }
);

// ---- Question bank (interview questions; coding questions for technical) ----

/** GET /admin/questions - List question templates (optional ?role= & ?phase=) */
router.get(
  '/questions',
  adminAuthMiddleware,
  validate([
    q('role').optional().isIn(ROLES),
    q('phase').optional().isIn(PHASES),
  ]),
  async (req: Request, res: Response) => {
    try {
      const role = req.query.role as string | undefined;
      const phase = req.query.phase as string | undefined;
      const questions = await questionTemplateService.listQuestionTemplates({ role, phase });
      res.json({ questions });
    } catch (e) {
      console.error('Admin list questions error', e);
      res.status(500).json({ error: 'Failed to list questions' });
    }
  }
);

/** POST /admin/questions - Create a question template (general or coding for technical) */
router.post(
  '/questions',
  adminAuthMiddleware,
  validate([
    body('role').isIn(ROLES),
    body('phase').isIn(PHASES),
    body('difficulty').isIn(DIFFICULTIES),
    body('text').isString().notEmpty().withMessage('Question text is required'),
    body('competencyIds').optional().isArray(),
    body('followUpPrompt').optional().isString(),
    body('isCodingQuestion').optional().isBoolean(),
    body('starterCode').optional().isString(),
    body('language').optional().isString(),
    body('sortOrder').optional().isInt(),
  ]),
  async (req: Request, res: Response) => {
    try {
      const created = await questionTemplateService.createQuestionTemplate({
        role: req.body.role,
        phase: req.body.phase,
        difficulty: req.body.difficulty,
        text: req.body.text,
        competencyIds: req.body.competencyIds,
        followUpPrompt: req.body.followUpPrompt,
        isCodingQuestion: req.body.isCodingQuestion,
        starterCode: req.body.starterCode,
        language: req.body.language,
        sortOrder: req.body.sortOrder,
      });
      res.status(201).json(created);
    } catch (e) {
      const err = e as Error;
      console.error('Admin create question error', err);
      const message = process.env.NODE_ENV === 'development' ? err.message : 'Failed to create question';
      res.status(500).json({ error: message });
    }
  }
);

/** PATCH /admin/questions/:id - Update a question template */
router.patch(
  '/questions/:id',
  adminAuthMiddleware,
  validate([
    param('id').isUUID(),
    body('phase').optional().isIn(PHASES),
    body('difficulty').optional().isIn(DIFFICULTIES),
    body('text').optional().isString(),
    body('competencyIds').optional().isArray(),
    body('followUpPrompt').optional().isString(),
    body('isCodingQuestion').optional().isBoolean(),
    body('starterCode').optional().isString(),
    body('language').optional().isString(),
    body('sortOrder').optional().isInt(),
  ]),
  async (req: Request, res: Response) => {
    try {
      const updated = await questionTemplateService.updateQuestionTemplate(req.params.id, {
        phase: req.body.phase,
        difficulty: req.body.difficulty,
        text: req.body.text,
        competencyIds: req.body.competencyIds,
        followUpPrompt: req.body.followUpPrompt,
        isCodingQuestion: req.body.isCodingQuestion,
        starterCode: req.body.starterCode,
        language: req.body.language,
        sortOrder: req.body.sortOrder,
      });
      if (!updated) return res.status(400).json({ error: 'No updates provided' });
      res.json(updated);
    } catch (e) {
      console.error('Admin update question error', e);
      res.status(500).json({ error: 'Failed to update question' });
    }
  }
);

/** DELETE /admin/questions/:id */
router.delete(
  '/questions/:id',
  adminAuthMiddleware,
  validate([param('id').isUUID()]),
  async (req: Request, res: Response) => {
    try {
      const deleted = await questionTemplateService.deleteQuestionTemplate(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Question not found' });
      res.json({ deleted: true });
    } catch (e) {
      console.error('Admin delete question error', e);
      res.status(500).json({ error: 'Failed to delete question' });
    }
  }
);

export const adminRoutes = router;
