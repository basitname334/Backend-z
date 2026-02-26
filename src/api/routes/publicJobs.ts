import { Router, Request, Response } from 'express';
import { body, param } from 'express-validator';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { validate } from '../middleware/validate';
import { query } from '../../db/client';
import { optionalAuth } from '../middleware/auth';

const router = Router();
const resumeUploadDir = path.resolve(process.cwd(), 'uploads', 'resumes');
fs.mkdirSync(resumeUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, resumeUploadDir);
  },
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Only PDF/DOC/DOCX files are allowed'));
  },
});

const ROLES = ['technical', 'behavioral', 'sales', 'customer_success'] as const;

router.get('/', async (_req: Request, res: Response) => {
  try {
    const { rows } = await query<{
      id: string;
      title: string;
      company_name: string | null;
      description: string | null;
      requirements: string | null;
      location: string | null;
      salary_range: string | null;
      role: string;
      created_at: string;
    }>(
      `SELECT id, title, company_name, description, requirements, location, salary_range, role, created_at
       FROM positions
       WHERE is_active = true
       ORDER BY created_at DESC`
    );
    return res.json({ jobs: rows });
  } catch (e) {
    console.error('Public jobs list error', e);
    return res.status(500).json({ error: 'Failed to load jobs' });
  }
});

router.get(
  '/:positionId',
  validate([param('positionId').isUUID()]),
  async (req: Request, res: Response) => {
    try {
      const { rows } = await query<{
        id: string;
        title: string;
        company_name: string | null;
        description: string | null;
        requirements: string | null;
        location: string | null;
        salary_range: string | null;
        role: string;
        created_at: string;
      }>(
        `SELECT id, title, company_name, description, requirements, location, salary_range, role, created_at
         FROM positions
         WHERE id = $1 AND is_active = true
         LIMIT 1`,
        [req.params.positionId]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Job not found' });
      }
      return res.json({ job: rows[0] });
    } catch (e) {
      console.error('Public job detail error', e);
      return res.status(500).json({ error: 'Failed to load job' });
    }
  }
);

router.post('/resume-upload', upload.single('resume'), (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Resume file is required' });
  }
  const host = `${req.protocol}://${req.get('host')}`;
  const resumeUrl = `${host}/uploads/resumes/${req.file.filename}`;
  return res.status(201).json({
    resumeUrl,
    fileName: req.file.originalname,
  });
});

router.post(
  '/:positionId/apply',
  optionalAuth,
  validate([
    param('positionId').isUUID(),
    body('name').isString().notEmpty(),
    body('email').isEmail(),
    body('resumeUrl')
      .optional({ values: 'falsy' })
      .isURL({ require_protocol: true, require_tld: false }),
    body('coverLetter').optional().isString(),
    body('phone').optional().isString(),
    body('location').optional().isString(),
    body('linkedinUrl').optional({ values: 'falsy' }).isURL({ require_protocol: true, require_tld: false }),
    body('portfolioUrl').optional({ values: 'falsy' }).isURL({ require_protocol: true, require_tld: false }),
  ]),
  async (req: Request, res: Response) => {
    try {
      const { positionId } = req.params;
      const { name, email, resumeUrl, coverLetter, phone, location, linkedinUrl, portfolioUrl } = req.body as {
        name: string;
        email: string;
        resumeUrl?: string;
        coverLetter?: string;
        phone?: string;
        location?: string;
        linkedinUrl?: string;
        portfolioUrl?: string;
      };

      const { rows: positionRows } = await query<{ id: string; role: string; is_active: boolean }>(
        `SELECT id, role, is_active FROM positions WHERE id = $1 LIMIT 1`,
        [positionId]
      );
      if (positionRows.length === 0) {
        return res.status(404).json({ error: 'Job not found' });
      }
      if (!positionRows[0].is_active) {
        return res.status(410).json({ error: 'This job is no longer accepting applications' });
      }
      if (!ROLES.includes(positionRows[0].role as (typeof ROLES)[number])) {
        return res.status(400).json({ error: 'Invalid job role configured' });
      }

      let candidateId: string;
      const user = (req as Request & { user?: { type?: string; candidateId?: string } }).user;
      const normalizedEmail = email.toLowerCase();
      const authCandidateId = user?.type === 'candidate' ? user.candidateId : null;
      if (authCandidateId) {
        const { rows: authCandidateRows } = await query<{ id: string; email: string | null }>(
          `SELECT id, email FROM candidates WHERE id = $1 LIMIT 1`,
          [authCandidateId]
        );
        if (authCandidateRows.length === 0) {
          return res.status(401).json({ error: 'Candidate account not found' });
        }
        candidateId = authCandidateRows[0].id;
        await query(
          `UPDATE candidates
           SET name = COALESCE($2, name),
               email = COALESCE($3, email),
               phone = COALESCE($4, phone),
               location = COALESCE($5, location),
               linkedin_url = COALESCE($6, linkedin_url),
               portfolio_url = COALESCE($7, portfolio_url),
               updated_at = NOW()
           WHERE id = $1`,
          [candidateId, name, normalizedEmail, phone ?? null, location ?? null, linkedinUrl ?? null, portfolioUrl ?? null]
        );
      } else {
      const { rows: candidateRows } = await query<{ id: string }>(
        `SELECT id FROM candidates WHERE email = $1 LIMIT 1`,
        [normalizedEmail]
      );
      if (candidateRows.length > 0) {
        candidateId = candidateRows[0].id;
        await query(
          `UPDATE candidates SET name = COALESCE($2, name), updated_at = NOW() WHERE id = $1`,
          [candidateId, name]
        );
      } else {
        const { rows: insertCandidateRows } = await query<{ id: string }>(
          `INSERT INTO candidates (id, email, name, phone, location, linkedin_url, portfolio_url, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), NOW())
           RETURNING id`,
          [normalizedEmail, name, phone ?? null, location ?? null, linkedinUrl ?? null, portfolioUrl ?? null]
        );
        candidateId = insertCandidateRows[0].id;
      }
      }

      const { rows: applicationRows } = await query<{
        id: string;
        candidate_id: string;
        position_id: string;
        resume_url: string | null;
        cover_letter: string | null;
        status: string;
        created_at: string;
      }>(
        `INSERT INTO applications (id, candidate_id, position_id, resume_url, cover_letter, status, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'pending', NOW(), NOW())
         RETURNING id, candidate_id, position_id, resume_url, cover_letter, status, created_at`,
        [candidateId, positionId, resumeUrl?.trim() ? resumeUrl.trim() : null, coverLetter ?? null]
      );

      return res.status(201).json({ application: applicationRows[0] });
    } catch (e) {
      console.error('Public apply to job error', e);
      return res.status(500).json({ error: 'Failed to submit application' });
    }
  }
);

export const publicJobsRoutes = router;
