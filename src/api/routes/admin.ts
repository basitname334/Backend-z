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

/** Super admin = the single account from env (ADMIN_EMAIL). Only super admin can add other admins. */
function isSuperAdminEmail(email: string): boolean {
  return email?.toLowerCase() === config.admin.email?.toLowerCase();
}

/** Only super admin can manage admins, access (roles), and recruiters. Other admins with permission_level 'limited' get 403. */
async function requireSuperAdminOrFullAdmin(req: Request): Promise<{ allowed: boolean; email: string }> {
  const email = ((req as Request & { user: { email?: string; sub: string } }).user?.email ?? (req as Request & { user: { sub: string } }).user?.sub) as string;
  if (isSuperAdminEmail(email)) return { allowed: true, email };
  const { rows } = await query<{ permission_level: string | null }>(
    `SELECT COALESCE(permission_level, 'full') AS permission_level FROM users WHERE email = $1 AND role = 'admin' LIMIT 1`,
    [email.toLowerCase()]
  );
  const level = rows[0]?.permission_level ?? 'full';
  return { allowed: level === 'full', email };
}

/** POST /admin/login - Admin login: env admin or any user with role='admin'. Returns JWT + isSuperAdmin. */
router.post(
  '/login',
  validate([
    body('email').isEmail(),
    body('password').isString().notEmpty(),
  ]),
  async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body as { email: string; password: string };
      const normalizedEmail = email.toLowerCase();

      // 1) Env super admin
      if (isSuperAdminEmail(normalizedEmail)) {
        if (password !== config.admin.password) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }
        const token = jwt.sign(
          { sub: normalizedEmail, email: normalizedEmail, type: 'admin' },
          config.jwt.secret,
          { expiresIn: config.jwt.expiresIn as SignOptions['expiresIn'] }
        );
        return res.json({ token, email: normalizedEmail, isSuperAdmin: true });
      }

      // 2) DB admin (role='admin')
      const { rows } = await query<{ id: string; email: string; password_hash: string }>(
        `SELECT id, email, password_hash FROM users WHERE email = $1 AND role = 'admin' LIMIT 1`,
        [normalizedEmail]
      );
      if (rows.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const user = rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const token = jwt.sign(
        { sub: user.email, email: user.email, type: 'admin' },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn as SignOptions['expiresIn'] }
      );
      return res.json({ token, email: user.email, isSuperAdmin: false });
    } catch (e) {
      console.error('Admin login error', e);
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

/** GET /admin/me - Require admin JWT, return current admin info, super admin flag, and permission level */
router.get('/me', adminAuthMiddleware, async (req: Request, res: Response) => {
  const user = (req as Request & { user: { sub: string; email?: string } }).user;
  const email = (user.email ?? user.sub) as string;
  const isSuper = isSuperAdminEmail(email);
  if (isSuper) return res.json({ email, isSuperAdmin: true, permissionLevel: 'full' as const });
  const { rows } = await query<{ permission_level: string | null }>(
    `SELECT COALESCE(permission_level, 'full') AS permission_level FROM users WHERE email = $1 AND role = 'admin' LIMIT 1`,
    [email.toLowerCase()]
  );
  const permissionLevel = (rows[0]?.permission_level === 'limited' ? 'limited' : 'full') as 'full' | 'limited';
  res.json({ email, isSuperAdmin: false, permissionLevel });
});

/** GET /admin/admins - List all admins (only super admin) */
router.get('/admins', adminAuthMiddleware, async (req: Request, res: Response) => {
  const currentEmail = (req as Request & { user: { email?: string; sub: string } }).user?.email ?? (req as Request & { user: { sub: string } }).user?.sub;
  if (!isSuperAdminEmail(currentEmail)) {
    return res.status(403).json({ error: 'Only the super admin can manage admins' });
  }
  const { rows } = await query<{ id: string; email: string; name: string | null; created_at: string; permission_level: string | null }>(
    `SELECT id, email, name, created_at, COALESCE(permission_level, 'full') AS permission_level FROM users WHERE role = 'admin' ORDER BY created_at DESC`
  );
  const list = rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    createdAt: r.created_at,
    isSuperAdmin: isSuperAdminEmail(r.email),
    permissionLevel: (r.permission_level === 'limited' ? 'limited' : 'full') as 'full' | 'limited',
  }));
  if (!list.some((a) => a.isSuperAdmin)) {
    list.unshift({
      id: 'super-admin',
      email: config.admin.email,
      name: 'Super Admin',
      createdAt: '',
      isSuperAdmin: true,
      permissionLevel: 'full' as const,
    });
  }
  return res.json({ admins: list });
});

/** PATCH /admin/admins/:id - Update admin name/password/access (only super admin; cannot edit env super admin) */
router.patch(
  '/admins/:id',
  adminAuthMiddleware,
  validate([
    param('id').isUUID().withMessage('Admin id must be UUID'),
    body('name').optional().isString(),
    body('password').optional().isString().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('permissionLevel').optional().isIn(['full', 'limited']),
  ]),
  async (req: Request, res: Response) => {
    const currentEmail = (req as Request & { user: { email?: string; sub: string } }).user?.email ?? (req as Request & { user: { sub: string } }).user?.sub;
    if (!isSuperAdminEmail(currentEmail)) {
      return res.status(403).json({ error: 'Only the super admin can edit admins' });
    }
    const { id } = req.params;
    if (id === 'super-admin') {
      return res.status(400).json({ error: 'Cannot edit the super admin (env account)' });
    }
    const { name, password, permissionLevel } = req.body as { name?: string; password?: string; permissionLevel?: 'full' | 'limited' };
    const updates: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (name !== undefined) {
      updates.push(`name = $${i}`);
      params.push(name || null);
      i++;
    }
    if (password !== undefined && password.length >= 6) {
      const passwordHash = await bcrypt.hash(password, 10);
      updates.push(`password_hash = $${i}`);
      params.push(passwordHash);
      i++;
    }
    if (permissionLevel !== undefined) {
      updates.push(`permission_level = $${i}`);
      params.push(permissionLevel);
      i++;
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }
    updates.push('updated_at = NOW()');
    params.push(id);
    const { rows } = await query<{ id: string; email: string; name: string | null; role: string; permission_level: string }>(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${i} AND role = 'admin' RETURNING id, email, name, role, COALESCE(permission_level, 'full') AS permission_level`,
      params
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found' });
    }
    return res.json({ admin: { ...rows[0], permissionLevel: rows[0].permission_level === 'limited' ? 'limited' : 'full' } });
  }
);

/** DELETE /admin/admins/:id - Remove admin (only super admin; cannot delete env super admin) */
router.delete(
  '/admins/:id',
  adminAuthMiddleware,
  validate([param('id').isUUID().withMessage('Admin id must be UUID')]),
  async (req: Request, res: Response) => {
    const currentEmail = (req as Request & { user: { email?: string; sub: string } }).user?.email ?? (req as Request & { user: { sub: string } }).user?.sub;
    if (!isSuperAdminEmail(currentEmail)) {
      return res.status(403).json({ error: 'Only the super admin can delete admins' });
    }
    const { id } = req.params;
    if (id === 'super-admin') {
      return res.status(400).json({ error: 'Cannot delete the super admin (env account)' });
    }
    const { rowCount } = await query(`DELETE FROM users WHERE id = $1 AND role = 'admin'`, [id]);
    return res.json({ deleted: (rowCount ?? 0) > 0 });
  }
);

/** POST /admin/admins - Create new admin (only super admin). Optional permissionLevel: full (default) or limited. */
router.post(
  '/admins',
  adminAuthMiddleware,
  validate([
    body('email').isEmail(),
    body('password').isString().isLength({ min: 6 }),
    body('name').optional().isString(),
    body('permissionLevel').optional().isIn(['full', 'limited']),
  ]),
  async (req: Request, res: Response) => {
    const currentEmail = (req as Request & { user: { email?: string; sub: string } }).user?.email ?? (req as Request & { user: { sub: string } }).user?.sub;
    if (!isSuperAdminEmail(currentEmail)) {
      return res.status(403).json({ error: 'Only the super admin can add admins' });
    }
    try {
      const email = String(req.body.email).toLowerCase();
      const name = req.body.name ? String(req.body.name) : null;
      const password = String(req.body.password);
      const permissionLevel = req.body.permissionLevel === 'limited' ? 'limited' : 'full';
      const passwordHash = await bcrypt.hash(password, 10);
      const { rows } = await query<{ id: string; email: string; name: string | null; role: string; permission_level: string }>(
        `INSERT INTO users (id, email, password_hash, name, role, is_active, permission_level, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'admin', true, $4, NOW(), NOW())
         RETURNING id, email, name, role, COALESCE(permission_level, 'full') AS permission_level`,
        [email, passwordHash, name, permissionLevel]
      );
      return res.status(201).json({
        admin: {
          id: rows[0].id,
          email: rows[0].email,
          name: rows[0].name,
          role: rows[0].role,
          permissionLevel: rows[0].permission_level === 'limited' ? 'limited' : 'full',
        },
      });
    } catch (e) {
      const err = e as Error;
      if ('code' in (e as Record<string, unknown>) && (e as { code?: string }).code === '23505') {
        return res.status(409).json({ error: 'An admin with this email already exists' });
      }
      console.error('Admin create admin error', err);
      return res.status(500).json({ error: 'Failed to create admin' });
    }
  }
);

/** GET /admin/access - Roles & permissions: admins + recruiters (super admin only) */
router.get('/access', adminAuthMiddleware, async (req: Request, res: Response) => {
  const currentEmail = (req as Request & { user: { email?: string; sub: string } }).user?.email ?? (req as Request & { user: { sub: string } }).user?.sub;
  if (!isSuperAdminEmail(currentEmail)) {
    return res.status(403).json({ error: 'Only the super admin can view roles and permissions' });
  }
  try {
    const [adminRows, recruiterRows] = await Promise.all([
      query<{ id: string; email: string; name: string | null; created_at: string; permission_level: string | null }>(
        `SELECT id, email, name, created_at, COALESCE(permission_level, 'full') AS permission_level FROM users WHERE role = 'admin' ORDER BY created_at DESC`
      ),
      query<{
        id: string;
        email: string;
        name: string | null;
        created_at: string;
        is_active: boolean;
        permission_level: string;
        schedule_count: string;
      }>(
        `SELECT u.id, u.email, u.name, u.created_at, u.is_active, COALESCE(u.permission_level, 'full') AS permission_level, COUNT(s.id)::text AS schedule_count
         FROM users u LEFT JOIN scheduled_interviews s ON s.created_by = u.id
         WHERE u.role = 'recruiter'
         GROUP BY u.id, u.email, u.name, u.created_at, u.is_active, u.permission_level
         ORDER BY u.created_at DESC`
      ),
    ]);
    const admins = adminRows.rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      createdAt: r.created_at,
      isSuperAdmin: isSuperAdminEmail(r.email),
      permissionLevel: (r.permission_level === 'limited' ? 'limited' : 'full') as 'full' | 'limited',
      role: 'admin' as const,
    }));
    if (!admins.some((a) => a.isSuperAdmin)) {
      admins.unshift({
        id: 'super-admin',
        email: config.admin.email,
        name: 'Super Admin',
        createdAt: '',
        isSuperAdmin: true,
        permissionLevel: 'full' as const,
        role: 'admin' as const,
      });
    }
    const recruiters = recruiterRows.rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      createdAt: r.created_at,
      isActive: r.is_active,
      permissionLevel: r.permission_level as 'full' | 'limited',
      scheduleCount: r.schedule_count,
      role: 'recruiter' as const,
    }));
    return res.json({ admins, recruiters });
  } catch (e) {
    console.error('Admin access error', e);
    return res.status(500).json({ error: 'Failed to load access' });
  }
});

/** Require super admin or full-access admin for recruiter management */
async function requireCanManageRecruiters(req: Request): Promise<boolean> {
  const { allowed } = await requireSuperAdminOrFullAdmin(req);
  return allowed;
}

/** POST /admin/recruiters - Admin creates recruiter account (super admin or full-access admin) */
router.post(
  '/recruiters',
  adminAuthMiddleware,
  validate([
    body('email').isEmail(),
    body('name').optional().isString(),
    body('password').isString().isLength({ min: 6 }),
  ]),
  async (req: Request, res: Response) => {
    if (!(await requireCanManageRecruiters(req))) {
      return res.status(403).json({ error: 'Only super admin or full-access admin can manage recruiters' });
    }
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

/** GET /admin/recruiters - List all recruiters (super admin or full-access admin) */
router.get('/recruiters', adminAuthMiddleware, async (req: Request, res: Response) => {
  if (!(await requireCanManageRecruiters(req))) {
    return res.status(403).json({ error: 'Only super admin or full-access admin can view recruiters' });
  }
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

/** PATCH /admin/recruiters/:id - Manage recruiter access/details (including password) (super or full admin) */
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
    if (!(await requireCanManageRecruiters(req))) {
      return res.status(403).json({ error: 'Only super admin or full-access admin can edit recruiters' });
    }
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

/** DELETE /admin/recruiters/:id - Remove recruiter (super or full admin) */
router.delete(
  '/recruiters/:id',
  adminAuthMiddleware,
  validate([param('id').isUUID()]),
  async (req: Request, res: Response) => {
    if (!(await requireCanManageRecruiters(req))) {
      return res.status(403).json({ error: 'Only super admin or full-access admin can delete recruiters' });
    }
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

/** PATCH /admin/candidates/:id - Update candidate name and/or set password (super admin only). Creates candidate_accounts if needed. */
router.patch(
  '/candidates/:id',
  adminAuthMiddleware,
  validate([
    param('id').isUUID(),
    body('name').optional().isString(),
    body('password').optional().isString().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ]),
  async (req: Request, res: Response) => {
    const currentEmail = (req as Request & { user: { email?: string; sub: string } }).user?.email ?? (req as Request & { user: { sub: string } }).user?.sub;
    if (!isSuperAdminEmail(currentEmail)) {
      return res.status(403).json({ error: 'Only the super admin can edit candidates' });
    }
    const { id } = req.params;
    const { name, password } = req.body as { name?: string; password?: string };
    const updates: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (name !== undefined) {
      updates.push(`name = $${i}`);
      params.push(name || null);
      i++;
    }
    if (updates.length === 0 && !password) {
      return res.status(400).json({ error: 'Provide name and/or password (min 6 characters)' });
    }
    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      params.push(id);
      await query(`UPDATE candidates SET ${updates.join(', ')} WHERE id = $${i}`, params);
    }
    if (password) {
      const { rows: candRows } = await query<{ id: string; email: string | null }>(
        `SELECT id, email FROM candidates WHERE id = $1 LIMIT 1`,
        [id]
      );
      if (candRows.length === 0) return res.status(404).json({ error: 'Candidate not found' });
      const candidateEmail = candRows[0].email || '';
      if (!candidateEmail) return res.status(400).json({ error: 'Candidate has no email; cannot set password' });
      const passwordHash = await bcrypt.hash(password, 10);
      await query(
        `INSERT INTO candidate_accounts (id, candidate_id, email, password_hash, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW())
         ON CONFLICT (candidate_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = NOW()`,
        [id, candidateEmail, passwordHash]
      );
    }
    return res.json({ updated: true });
  }
);

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
