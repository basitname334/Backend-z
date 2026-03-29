/**
 * POST /avatar/generate - Generate talking-head video from text using
 * Coqui TTS + SadTalker + Wav2Lip pipeline. Returns video URL or error.
 */
import { Router, Request, Response } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import { avatarService } from '../../services/avatar/avatar.service';
import { config } from '../../config';
import { logger } from '../../config/logger';

const router = Router();

router.post(
  '/generate',
  validate([
    body('text').isString().notEmpty().trim().withMessage('text is required'),
    body('avatarImage').optional().isString().trim(),
  ]),
  async (req: Request, res: Response) => {
    try {
      if (!config.avatar.enabled) {
        return res.status(503).json({
          error: 'Avatar generation is disabled. Set AVATAR_ENABLED=true to enable.',
        });
      }
      const text = String(req.body.text).trim();
      const avatarImage = req.body.avatarImage ? String(req.body.avatarImage).trim() : undefined;
      const result = await avatarService.generateAvatar({ text, avatarImage });
      if (result.error) {
        logger.warn('Avatar generate failed', { error: result.error });
        return res.status(500).json({
          error: 'Avatar generation failed',
          details: result.error,
        });
      }
      if (!result.videoUrl) {
        return res.status(500).json({ error: 'No video produced' });
      }
      res.json({ videoUrl: result.videoUrl });
    } catch (e) {
      logger.error('Avatar generate error', { error: e });
      res.status(500).json({ error: 'Failed to generate avatar' });
    }
  }
);

export const avatarRoutes = router;
