/**
 * Community API: LinkedIn-style feed for all users (admin, recruiter, candidate).
 * Posts, likes, comments. Rich posts: images, articles, hashtags, link previews.
 */
import { Router, Request, Response } from 'express';
import { body, param, query as q } from 'express-validator';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { config } from '../../config';
import { query } from '../../db/client';
import { validate } from '../middleware/validate';
import type { JwtPayload, CommunityUser } from '../middleware/auth';

const router = Router();

const communityUploadDir = path.resolve(process.cwd(), 'uploads', 'community');
fs.mkdirSync(communityUploadDir, { recursive: true });
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, communityUploadDir),
    filename: (_req, file, cb) => {
      const ext = (file.originalname && path.extname(file.originalname)) || '.jpg';
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'image';
      cb(null, `${Date.now()}-${safe}${ext.toLowerCase().match(/\.(jpe?g|png|gif|webp)$/) ? '' : ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpe?g|png|gif|webp)$/i.test(file.mimetype);
    cb(null, !!ok);
  },
});

function getCommunityUser(req: Request): CommunityUser | null {
  return (req as Request & { communityUser?: CommunityUser }).communityUser ?? null;
}

/** Middleware: require any of admin / recruiter / candidate JWT; resolve id/name/email and set req.communityUser */
async function communityAuthMiddleware(req: Request, res: Response, next: () => void): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sign in to access the community' });
    return;
  }
  const token = header.slice(7);
  let decoded: JwtPayload;
  try {
    decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  const type = decoded.type;
  if (type === 'admin') {
    const email = (decoded.email ?? decoded.sub) as string;
    const { rows } = await query<{ id: string; name: string | null }>(
      `SELECT id, name FROM users WHERE email = $1 AND role = 'admin' LIMIT 1`,
      [email.toLowerCase()]
    );
    if (rows.length === 0) {
      res.status(401).json({ error: 'Admin not found' });
      return;
    }
    (req as Request & { communityUser: CommunityUser }).communityUser = {
      id: rows[0].id,
      type: 'admin',
      name: rows[0].name,
      email,
    };
    next();
    return;
  }
  if (type === 'recruiter') {
    const userId = (decoded as JwtPayload & { userId?: string }).userId;
    const email = (decoded.email ?? decoded.sub) as string;
    if (userId) {
      const { rows } = await query<{ id: string; name: string | null; email: string }>(
        `SELECT id, name, email FROM users WHERE id = $1 AND role = 'recruiter' LIMIT 1`,
        [userId]
      );
      if (rows.length > 0) {
        (req as Request & { communityUser: CommunityUser }).communityUser = {
          id: rows[0].id,
          type: 'recruiter',
          name: rows[0].name,
          email: rows[0].email,
        };
        next();
        return;
      }
    }
    const { rows } = await query<{ id: string; name: string | null; email: string }>(
      `SELECT id, name, email FROM users WHERE email = $1 AND role = 'recruiter' LIMIT 1`,
      [email.toLowerCase()]
    );
    if (rows.length === 0) {
      res.status(401).json({ error: 'Recruiter not found' });
      return;
    }
    (req as Request & { communityUser: CommunityUser }).communityUser = {
      id: rows[0].id,
      type: 'recruiter',
      name: rows[0].name,
      email: rows[0].email,
    };
    next();
    return;
  }
  if (type === 'candidate') {
    const candidateId = (decoded as JwtPayload & { candidateId?: string }).candidateId;
    const email = (decoded.email ?? decoded.sub) as string;
    if (candidateId) {
      const { rows } = await query<{ id: string; name: string | null }>(
        `SELECT c.id, c.name FROM candidates c
         INNER JOIN candidate_accounts ca ON ca.candidate_id = c.id
         WHERE c.id = $1 AND ca.email = $2 LIMIT 1`,
        [candidateId, email.toLowerCase()]
      );
      if (rows.length > 0) {
        (req as Request & { communityUser: CommunityUser }).communityUser = {
          id: rows[0].id,
          type: 'candidate',
          name: rows[0].name,
          email,
        };
        next();
        return;
      }
    }
    const { rows } = await query<{ id: string; name: string | null }>(
      `SELECT c.id, c.name FROM candidates c
       INNER JOIN candidate_accounts ca ON ca.candidate_id = c.id
       WHERE ca.email = $1 LIMIT 1`,
      [email.toLowerCase()]
    );
    if (rows.length === 0) {
      res.status(401).json({ error: 'Candidate not found' });
      return;
    }
    (req as Request & { communityUser: CommunityUser }).communityUser = {
      id: rows[0].id,
      type: 'candidate',
      name: rows[0].name,
      email,
    };
    next();
    return;
  }
  res.status(403).json({ error: 'Admin, recruiter, or candidate access required' });
}

/** Optional: set req.communityUser if valid token, never 401. */
async function optionalCommunityAuth(req: Request, res: Response, next: () => void): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next();
    return;
  }
  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    const type = decoded.type;
    if (type === 'admin') {
      const email = (decoded.email ?? decoded.sub) as string;
      const { rows } = await query<{ id: string; name: string | null }>(
        `SELECT id, name FROM users WHERE email = $1 AND role = 'admin' LIMIT 1`,
        [email.toLowerCase()]
      );
      if (rows.length > 0) {
        (req as Request & { communityUser: CommunityUser }).communityUser = { id: rows[0].id, type: 'admin', name: rows[0].name, email };
      }
    } else if (type === 'recruiter') {
      const userId = (decoded as JwtPayload & { userId?: string }).userId;
      const email = (decoded.email ?? decoded.sub) as string;
      const { rows } = await query<{ id: string; name: string | null; email: string }>(
        userId
          ? `SELECT id, name, email FROM users WHERE id = $1 AND role = 'recruiter' LIMIT 1`
          : `SELECT id, name, email FROM users WHERE email = $1 AND role = 'recruiter' LIMIT 1`,
        userId ? [userId] : [email.toLowerCase()]
      );
      if (rows.length > 0) {
        (req as Request & { communityUser: CommunityUser }).communityUser = { id: rows[0].id, type: 'recruiter', name: rows[0].name, email: rows[0].email };
      }
    } else if (type === 'candidate') {
      const candidateId = (decoded as JwtPayload & { candidateId?: string }).candidateId;
      const email = (decoded.email ?? decoded.sub) as string;
      const { rows } = await query<{ id: string; name: string | null }>(
        candidateId
          ? `SELECT c.id, c.name FROM candidates c INNER JOIN candidate_accounts ca ON ca.candidate_id = c.id WHERE c.id = $1 LIMIT 1`
          : `SELECT c.id, c.name FROM candidates c INNER JOIN candidate_accounts ca ON ca.candidate_id = c.id WHERE ca.email = $1 LIMIT 1`,
        candidateId ? [candidateId] : [email.toLowerCase()]
      );
      if (rows.length > 0) {
        (req as Request & { communityUser: CommunityUser }).communityUser = { id: rows[0].id, type: 'candidate', name: rows[0].name, email };
      }
    }
  } catch {
    // ignore invalid token
  }
  next();
}

/** GET /community/posts - List posts (paginated). Send Authorization to get likedByMe on each post. */
router.get(
  '/posts',
  optionalCommunityAuth,
  validate([
    q('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
    q('offset').optional().isInt({ min: 0 }).toInt(),
  ]),
  async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 20, 50);
      const offset = Number(req.query.offset) || 0;
      const user = getCommunityUser(req);
      const { rows } = await query<{
        id: string;
        author_id: string;
        author_type: string;
        author_name: string | null;
        author_email: string | null;
        content: string;
        post_type: string;
        title: string | null;
        images: string;
        hashtags: string;
        link_url: string | null;
        link_title: string | null;
        link_image: string | null;
        created_at: string;
        updated_at: string;
        like_count: string;
        comment_count: string;
      }>(
        `SELECT p.id, p.author_id, p.author_type, p.author_name, p.author_email, p.content,
                COALESCE(p.post_type, 'post') AS post_type, p.title, COALESCE(p.images, '[]'::jsonb) AS images,
                COALESCE(p.hashtags, '[]'::jsonb) AS hashtags, p.link_url, p.link_title, p.link_image,
                p.created_at, p.updated_at,
                (SELECT COUNT(*)::int FROM community_post_likes l WHERE l.post_id = p.id) AS like_count,
                (SELECT COUNT(*)::int FROM community_comments c WHERE c.post_id = p.id) AS comment_count
         FROM community_posts p
         ORDER BY p.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      let likedSet: Set<string> = new Set();
      if (user) {
        const ids = rows.map((r) => r.id);
        if (ids.length > 0) {
          const placeholders = ids.map((_, i) => `$${i + 3}::uuid`).join(',');
          const likeRows = await query<{ post_id: string }>(
            `SELECT post_id FROM community_post_likes WHERE author_id = $1 AND author_type = $2 AND post_id IN (${placeholders})`,
            [user.id, user.type, ...ids]
          );
          likedSet = new Set(likeRows.rows.map((r) => r.post_id));
        }
      }
      const parseJsonArray = (s: string): string[] => {
        try {
          const a = JSON.parse(s);
          return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [];
        } catch {
          return [];
        }
      };
      const posts = rows.map((r) => ({
        id: r.id,
        authorId: r.author_id,
        authorType: r.author_type as 'admin' | 'recruiter' | 'candidate',
        authorName: r.author_name,
        authorEmail: r.author_email,
        content: r.content,
        postType: (r.post_type || 'post') as 'post' | 'article',
        title: r.title ?? undefined,
        images: parseJsonArray(r.images),
        hashtags: parseJsonArray(r.hashtags),
        linkUrl: r.link_url ?? undefined,
        linkTitle: r.link_title ?? undefined,
        linkImage: r.link_image ?? undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        likeCount: Number(r.like_count) || 0,
        commentCount: Number(r.comment_count) || 0,
        likedByMe: likedSet.has(r.id),
      }));
      res.json({ posts });
    } catch (e) {
      console.error('Community list posts error', e);
      res.status(500).json({ error: 'Failed to load posts' });
    }
  }
);

/** POST /community/upload-image - Upload image for post (auth required). Returns { url } path for use in post.images. */
router.post(
  '/upload-image',
  communityAuthMiddleware,
  imageUpload.single('image'),
  (req: Request, res: Response) => {
    const file = (req as Request & { file?: { filename: string } }).file;
    if (!file) {
      return res.status(400).json({ error: 'Image file is required (field: image)' });
    }
    const url = `/uploads/community/${file.filename}`;
    res.status(201).json({ url });
  }
);

/** POST /community/posts - Create post (auth required). Body: content, postType?, title?, images?, hashtags?, linkUrl?, linkTitle?, linkImage? */
router.post(
  '/posts',
  communityAuthMiddleware,
  validate([
    body('content').isString().notEmpty().trim().isLength({ max: 50000 }),
    body('postType').optional().isIn(['post', 'article']),
    body('title').optional().trim().isLength({ max: 500 }),
    body('images').optional().isArray(),
    body('images.*').optional().isString().isLength({ max: 2048 }),
    body('hashtags').optional().isArray(),
    body('hashtags.*').optional().isString().trim().isLength({ max: 100 }),
    body('linkUrl').optional().trim().isURL().isLength({ max: 2048 }),
    body('linkTitle').optional().trim().isLength({ max: 500 }),
    body('linkImage').optional().trim().isLength({ max: 2048 }),
  ]),
  async (req: Request, res: Response) => {
    const user = getCommunityUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to post' });
    try {
      const content = String(req.body.content).trim();
      const postType = req.body.postType === 'article' ? 'article' : 'post';
      const title = req.body.title ? String(req.body.title).trim() : null;
      const images = Array.isArray(req.body.images) ? req.body.images.filter((x: unknown): x is string => typeof x === 'string' && x.length <= 2048).slice(0, 10) : [];
      const hashtags = Array.isArray(req.body.hashtags) ? req.body.hashtags.map((x: unknown) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).slice(0, 30) : [];
      const linkUrl = req.body.linkUrl ? String(req.body.linkUrl).trim() : null;
      const linkTitle = req.body.linkTitle ? String(req.body.linkTitle).trim() : null;
      const linkImage = req.body.linkImage ? String(req.body.linkImage).trim() : null;

      const { rows } = await query<{ id: string; created_at: string }>(
        `INSERT INTO community_posts (id, author_id, author_type, author_name, author_email, content, post_type, title, images, hashtags, link_url, link_title, link_image, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, NOW(), NOW())
         RETURNING id, created_at`,
        [user.id, user.type, user.name || null, user.email, content, postType, title, JSON.stringify(images), JSON.stringify(hashtags), linkUrl, linkTitle, linkImage]
      );
      const row = rows[0];
      res.status(201).json({
        post: {
          id: row.id,
          authorId: user.id,
          authorType: user.type,
          authorName: user.name,
          authorEmail: user.email,
          content,
          postType,
          title: title ?? undefined,
          images,
          hashtags,
          linkUrl: linkUrl ?? undefined,
          linkTitle: linkTitle ?? undefined,
          linkImage: linkImage ?? undefined,
          createdAt: row.created_at,
          updatedAt: row.created_at,
          likeCount: 0,
          commentCount: 0,
        },
      });
    } catch (e) {
      console.error('Community create post error', e);
      res.status(500).json({ error: 'Failed to create post' });
    }
  }
);

/** PATCH /community/posts/:id - Update own post. Body: content (required), postType?, title?, images?, hashtags?, linkUrl?, linkTitle?, linkImage? */
router.patch(
  '/posts/:id',
  communityAuthMiddleware,
  validate([
    param('id').isUUID(),
    body('content').isString().notEmpty().trim().isLength({ max: 50000 }),
    body('postType').optional().isIn(['post', 'article']),
    body('title').optional().trim().isLength({ max: 500 }),
    body('images').optional().isArray(),
    body('hashtags').optional().isArray(),
    body('linkUrl').optional().trim().isLength({ max: 2048 }),
    body('linkTitle').optional().trim().isLength({ max: 500 }),
    body('linkImage').optional().trim().isLength({ max: 2048 }),
  ]),
  async (req: Request, res: Response) => {
    const user = getCommunityUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to edit' });
    const { id } = req.params;
    const content = String(req.body.content).trim();
    const postType = req.body.postType === 'article' ? 'article' : undefined;
    const title = req.body.title != null ? String(req.body.title).trim() : undefined;
    const images = Array.isArray(req.body.images) ? req.body.images.filter((x: unknown): x is string => typeof x === 'string').slice(0, 10) : undefined;
    const hashtags = Array.isArray(req.body.hashtags) ? req.body.hashtags.map((x: unknown) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).slice(0, 30) : undefined;
    const linkUrl = req.body.linkUrl != null ? String(req.body.linkUrl).trim() : undefined;
    const linkTitle = req.body.linkTitle != null ? String(req.body.linkTitle).trim() : undefined;
    const linkImage = req.body.linkImage != null ? String(req.body.linkImage).trim() : undefined;

    const updates: string[] = ['content = $1', 'updated_at = NOW()'];
    const params: unknown[] = [content];
    let idx = 2;
    if (postType !== undefined) { updates.push(`post_type = $${idx}`); params.push(postType); idx++; }
    if (title !== undefined) { updates.push(`title = $${idx}`); params.push(title || null); idx++; }
    if (images !== undefined) { updates.push(`images = $${idx}::jsonb`); params.push(JSON.stringify(images)); idx++; }
    if (hashtags !== undefined) { updates.push(`hashtags = $${idx}::jsonb`); params.push(JSON.stringify(hashtags)); idx++; }
    if (linkUrl !== undefined) { updates.push(`link_url = $${idx}`); params.push(linkUrl || null); idx++; }
    if (linkTitle !== undefined) { updates.push(`link_title = $${idx}`); params.push(linkTitle || null); idx++; }
    if (linkImage !== undefined) { updates.push(`link_image = $${idx}`); params.push(linkImage || null); idx++; }
    params.push(id, user.id, user.type);
    const { rows } = await query<{ id: string; content: string; updated_at: string }>(
      `UPDATE community_posts SET ${updates.join(', ')} WHERE id = $${idx} AND author_id = $${idx + 1} AND author_type = $${idx + 2} RETURNING id, content, updated_at`,
      params
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Post not found or you can only edit your own posts' });
    }
    res.json({ post: { id: rows[0].id, content: rows[0].content, updatedAt: rows[0].updated_at } });
  }
);

/** DELETE /community/posts/:id - Delete own post (or any post if admin) */
router.delete(
  '/posts/:id',
  communityAuthMiddleware,
  validate([param('id').isUUID()]),
  async (req: Request, res: Response) => {
    const user = getCommunityUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to delete' });
    const { id } = req.params;
    const isAdmin = user.type === 'admin';
    const { rowCount } = await query(
      isAdmin
        ? `DELETE FROM community_posts WHERE id = $1`
        : `DELETE FROM community_posts WHERE id = $1 AND author_id = $2 AND author_type = $3`,
      isAdmin ? [id] : [id, user.id, user.type]
    );
    if ((rowCount ?? 0) === 0) {
      return res.status(404).json({ error: 'Post not found or you can only delete your own posts' });
    }
    res.json({ deleted: true });
  }
);

/** POST /community/posts/:id/like - Toggle like (auth required) */
router.post(
  '/posts/:id/like',
  communityAuthMiddleware,
  validate([param('id').isUUID()]),
  async (req: Request, res: Response) => {
    const user = getCommunityUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to like' });
    const { id: postId } = req.params;
    const existing = await query(
      `SELECT 1 FROM community_post_likes WHERE post_id = $1 AND author_id = $2 AND author_type = $3`,
      [postId, user.id, user.type]
    );
    if (existing.rows.length > 0) {
      await query(
        `DELETE FROM community_post_likes WHERE post_id = $1 AND author_id = $2 AND author_type = $3`,
        [postId, user.id, user.type]
      );
      return res.json({ liked: false });
    }
    await query(
      `INSERT INTO community_post_likes (post_id, author_id, author_type) VALUES ($1, $2, $3)
       ON CONFLICT (post_id, author_id, author_type) DO NOTHING`,
      [postId, user.id, user.type]
    );
    res.json({ liked: true });
  }
);

/** GET /community/posts/:id/liked - Check if current user liked (auth optional) */
router.get(
  '/posts/:id/liked',
  communityAuthMiddleware,
  validate([param('id').isUUID()]),
  async (req: Request, res: Response) => {
    const user = getCommunityUser(req);
    if (!user) return res.json({ liked: false });
    const { id: postId } = req.params;
    const { rows } = await query(
      `SELECT 1 FROM community_post_likes WHERE post_id = $1 AND author_id = $2 AND author_type = $3`,
      [postId, user.id, user.type]
    );
    res.json({ liked: rows.length > 0 });
  }
);

/** GET /community/posts/:id/comments - List comments for a post */
router.get(
  '/posts/:id/comments',
  validate([param('id').isUUID()]),
  async (req: Request, res: Response) => {
    const { id: postId } = req.params;
    const { rows } = await query<{
      id: string;
      author_id: string;
      author_type: string;
      author_name: string | null;
      author_email: string | null;
      content: string;
      parent_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, author_id, author_type, author_name, author_email, content, parent_id, created_at, updated_at
       FROM community_comments WHERE post_id = $1 ORDER BY created_at ASC`,
      [postId]
    );
    res.json({
      comments: rows.map((r) => ({
        id: r.id,
        authorId: r.author_id,
        authorType: r.author_type as 'admin' | 'recruiter' | 'candidate',
        authorName: r.author_name,
        authorEmail: r.author_email,
        content: r.content,
        parentId: r.parent_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  }
);

/** POST /community/posts/:id/comments - Add comment (auth required) */
router.post(
  '/posts/:id/comments',
  communityAuthMiddleware,
  validate([
    param('id').isUUID(),
    body('content').isString().notEmpty().trim().isLength({ max: 2000 }),
    body('parentId').optional().isUUID(),
  ]),
  async (req: Request, res: Response) => {
    const user = getCommunityUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to comment' });
    const { id: postId } = req.params;
    const content = String(req.body.content).trim();
    const parentId = req.body.parentId || null;
    const { rows } = await query<{ id: string; created_at: string }>(
      `INSERT INTO community_comments (id, post_id, author_id, author_type, author_name, author_email, content, parent_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING id, created_at`,
      [postId, user.id, user.type, user.name || null, user.email, content, parentId]
    );
    res.status(201).json({
      comment: {
        id: rows[0].id,
        authorId: user.id,
        authorType: user.type,
        authorName: user.name,
        authorEmail: user.email,
        content,
        parentId,
        createdAt: rows[0].created_at,
        updatedAt: rows[0].created_at,
      },
    });
  }
);

/** PATCH /community/comments/:id - Edit own comment */
router.patch(
  '/comments/:id',
  communityAuthMiddleware,
  validate([
    param('id').isUUID(),
    body('content').isString().notEmpty().trim().isLength({ max: 2000 }),
  ]),
  async (req: Request, res: Response) => {
    const user = getCommunityUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to edit' });
    const content = String(req.body.content).trim();
    const { id } = req.params;
    const { rows } = await query<{ id: string; content: string; updated_at: string }>(
      `UPDATE community_comments SET content = $1, updated_at = NOW()
       WHERE id = $2 AND author_id = $3 AND author_type = $4
       RETURNING id, content, updated_at`,
      [content, id, user.id, user.type]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Comment not found or you can only edit your own' });
    }
    res.json({ comment: { id: rows[0].id, content: rows[0].content, updatedAt: rows[0].updated_at } });
  }
);

/** DELETE /community/comments/:id - Delete own comment (or any if admin) */
router.delete(
  '/comments/:id',
  communityAuthMiddleware,
  validate([param('id').isUUID()]),
  async (req: Request, res: Response) => {
    const user = getCommunityUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to delete' });
    const { id } = req.params;
    const isAdmin = user.type === 'admin';
    const { rowCount } = await query(
      isAdmin
        ? `DELETE FROM community_comments WHERE id = $1`
        : `DELETE FROM community_comments WHERE id = $1 AND author_id = $2 AND author_type = $3`,
      isAdmin ? [id] : [id, user.id, user.type]
    );
    if ((rowCount ?? 0) === 0) {
      return res.status(404).json({ error: 'Comment not found or you can only delete your own' });
    }
    res.json({ deleted: true });
  }
);

/** GET /community/me - Current user info for community (auth required) */
router.get('/me', communityAuthMiddleware, (req: Request, res: Response) => {
  const user = getCommunityUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  res.json({ user: { id: user.id, type: user.type, name: user.name, email: user.email } });
});

/** GET /community/me/stats - Profile viewers and post impressions for current user (auth required) */
router.get('/me/stats', communityAuthMiddleware, async (req: Request, res: Response) => {
  const user = getCommunityUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  try {
    let profileViewers = 0;

    const { rows: impressionRows } = await query<{ total: string }>(
      `SELECT COALESCE(SUM(
        (SELECT COUNT(*) FROM community_post_likes l WHERE l.post_id = p.id) +
        (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = p.id)
      ), 0)::text AS total
       FROM community_posts p WHERE p.author_id = $1 AND p.author_type = $2`,
      [user.id, user.type]
    );
    const postImpressions = parseInt(impressionRows[0]?.total || '0', 10);

    res.json({ profileViewers, postImpressions });
  } catch (e) {
    res.json({ profileViewers: 0, postImpressions: 0 });
  }
});

export const communityRoutes = router;
