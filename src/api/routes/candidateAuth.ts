import { Router, Request, Response } from 'express';
import { body } from 'express-validator';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { query } from '../../db/client';
import { validate } from '../middleware/validate';
import { candidateAuthMiddleware } from '../middleware/auth';
import { config } from '../../config';

const router = Router();

router.post(
  '/signup',
  validate([
    body('name').isString().notEmpty(),
    body('email').isEmail(),
    body('password').isString().isLength({ min: 6 }),
    body('phone').optional().isString(),
    body('location').optional().isString(),
    body('linkedinUrl').optional().isURL({ require_protocol: true, require_tld: false }),
    body('portfolioUrl').optional().isURL({ require_protocol: true, require_tld: false }),
  ]),
  async (req: Request, res: Response) => {
    try {
      const { name, email, password, phone, location, linkedinUrl, portfolioUrl } = req.body as {
        name: string;
        email: string;
        password: string;
        phone?: string;
        location?: string;
        linkedinUrl?: string;
        portfolioUrl?: string;
      };
      const normalizedEmail = email.toLowerCase();
      const { rows: existsRows } = await query<{ id: string }>(
        `SELECT id FROM candidate_accounts WHERE email = $1 LIMIT 1`,
        [normalizedEmail]
      );
      if (existsRows.length > 0) {
        return res.status(409).json({ error: 'Email already registered. Please log in.' });
      }
      const { rows: candidateRows } = await query<{
        id: string;
        name: string | null;
        email: string | null;
        phone: string | null;
        location: string | null;
        linkedin_url: string | null;
        portfolio_url: string | null;
      }>(
        `INSERT INTO candidates (id, email, name, phone, location, linkedin_url, portfolio_url, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), NOW())
         RETURNING id, name, email, phone, location, linkedin_url, portfolio_url`,
        [normalizedEmail, name, phone ?? null, location ?? null, linkedinUrl ?? null, portfolioUrl ?? null]
      );
      const candidate = candidateRows[0];
      const passwordHash = await bcrypt.hash(password, 10);
      await query(
        `INSERT INTO candidate_accounts (id, candidate_id, email, password_hash, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW())`,
        [candidate.id, normalizedEmail, passwordHash]
      );
      const token = jwt.sign(
        { sub: normalizedEmail, email: normalizedEmail, type: 'candidate', candidateId: candidate.id },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn as SignOptions['expiresIn'] }
      );
      return res.status(201).json({
        token,
        candidate: {
          id: candidate.id,
          name: candidate.name,
          email: candidate.email,
          phone: candidate.phone,
          location: candidate.location,
          linkedinUrl: candidate.linkedin_url,
          portfolioUrl: candidate.portfolio_url,
        },
      });
    } catch (e) {
      console.error('Candidate signup error', e);
      return res.status(500).json({ error: 'Failed to sign up' });
    }
  }
);

router.post(
  '/login',
  validate([body('email').isEmail(), body('password').isString().notEmpty()]),
  async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body as { email: string; password: string };
      const normalizedEmail = email.toLowerCase();
      const { rows } = await query<{
        candidate_id: string;
        email: string;
        password_hash: string;
        name: string | null;
        phone: string | null;
        location: string | null;
        linkedin_url: string | null;
        portfolio_url: string | null;
      }>(
        `SELECT ca.candidate_id, ca.email, ca.password_hash, c.name, c.phone, c.location, c.linkedin_url, c.portfolio_url
         FROM candidate_accounts ca
         INNER JOIN candidates c ON c.id = ca.candidate_id
         WHERE ca.email = $1
         LIMIT 1`,
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
        { sub: user.email, email: user.email, type: 'candidate', candidateId: user.candidate_id },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn as SignOptions['expiresIn'] }
      );
      return res.json({
        token,
        candidate: {
          id: user.candidate_id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          location: user.location,
          linkedinUrl: user.linkedin_url,
          portfolioUrl: user.portfolio_url,
        },
      });
    } catch (e) {
      console.error('Candidate login error', e);
      return res.status(500).json({ error: 'Failed to log in' });
    }
  }
);

router.get('/me', candidateAuthMiddleware, async (req: Request, res: Response) => {
  const user = (req as Request & { user: { candidateId?: string } }).user;
  if (!user.candidateId) {
    return res.status(401).json({ error: 'Invalid token payload' });
  }
  const { rows } = await query<{
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    location: string | null;
    linkedin_url: string | null;
    portfolio_url: string | null;
  }>(
    `SELECT id, name, email, phone, location, linkedin_url, portfolio_url
     FROM candidates
     WHERE id = $1
     LIMIT 1`,
    [user.candidateId]
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Candidate not found' });
  }
  const candidate = rows[0];
  return res.json({
    candidate: {
      id: candidate.id,
      name: candidate.name,
      email: candidate.email,
      phone: candidate.phone,
      location: candidate.location,
      linkedinUrl: candidate.linkedin_url,
      portfolioUrl: candidate.portfolio_url,
    },
  });
});

router.get('/applications', candidateAuthMiddleware, async (req: Request, res: Response) => {
  const user = (req as Request & { user: { candidateId?: string } }).user;
  if (!user.candidateId) {
    return res.status(401).json({ error: 'Invalid token payload' });
  }
  const { rows } = await query<{
    id: string;
    position_id: string;
    status: string;
    created_at: string;
  }>(
    `SELECT id, position_id, status, created_at
     FROM applications
     WHERE candidate_id = $1
     ORDER BY created_at DESC`,
    [user.candidateId]
  );
  return res.json({ applications: rows });
});

router.get('/dashboard', candidateAuthMiddleware, async (req: Request, res: Response) => {
  const user = (req as Request & { user: { candidateId?: string } }).user;
  if (!user.candidateId) {
    return res.status(401).json({ error: 'Invalid token payload' });
  }
  const { rows: profileRows } = await query<{
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    location: string | null;
    linkedin_url: string | null;
    portfolio_url: string | null;
  }>(
    `SELECT id, name, email, phone, location, linkedin_url, portfolio_url
     FROM candidates
     WHERE id = $1
     LIMIT 1`,
    [user.candidateId]
  );
  if (profileRows.length === 0) {
    return res.status(404).json({ error: 'Candidate not found' });
  }
  const profile = profileRows[0];

  const { rows: applicationRows } = await query<{
    application_id: string;
    application_status: string;
    applied_at: string;
    resume_url: string | null;
    position_id: string;
    position_title: string;
    company_name: string | null;
    position_role: string;
    schedule_id: string | null;
    scheduled_at: string | null;
    schedule_status: string | null;
    join_token: string | null;
    interview_id: string | null;
  }>(
    `SELECT a.id AS application_id, a.status AS application_status, a.created_at AS applied_at, a.resume_url,
            p.id AS position_id, p.title AS position_title, p.company_name, p.role AS position_role,
            si.id AS schedule_id, si.scheduled_at, si.status AS schedule_status, si.join_token, si.interview_id
     FROM applications a
     INNER JOIN positions p ON p.id = a.position_id
     LEFT JOIN scheduled_interviews si ON si.application_id = a.id
     WHERE a.candidate_id = $1
     ORDER BY a.created_at DESC`,
    [user.candidateId]
  );

  const applications = applicationRows.map((row) => ({
    id: row.application_id,
    status: row.application_status,
    appliedAt: row.applied_at,
    resumeUrl: row.resume_url,
    position: {
      id: row.position_id,
      title: row.position_title,
      companyName: row.company_name,
      role: row.position_role,
    },
    schedule: row.schedule_id
      ? {
          id: row.schedule_id,
          scheduledAt: row.scheduled_at,
          status: row.schedule_status,
          joinUrl: row.join_token ? `${config.frontendUrl}/interview/join/${row.join_token}` : null,
          interviewId: row.interview_id,
          reportUrl: row.interview_id ? `${config.frontendUrl}/report/${row.interview_id}` : null,
        }
      : null,
  }));

  return res.json({
    profile: {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      phone: profile.phone,
      location: profile.location,
      linkedinUrl: profile.linkedin_url,
      portfolioUrl: profile.portfolio_url,
    },
    applications,
  });
});

export const candidateAuthRoutes = router;
