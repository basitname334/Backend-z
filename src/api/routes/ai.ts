import { Router, Request, Response } from 'express';
import { getTTSService } from '../../ai/tts';
import { getSTTService } from '../../ai/stt';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import multer from 'multer';

const router = Router();
const upload = multer();

/** POST /ai/tts - Generate speech from text */
router.post(
    '/tts',
    validate([
        body('text').isString().notEmpty().withMessage('Text is required'),
    ]),
    async (req: Request, res: Response) => {
        try {
            const { text } = req.body;
            const tts = getTTSService();
            const audioBuffer = await tts.synthesize(text);

            res.set({
                'Content-Type': 'audio/mpeg',
                'Content-Length': audioBuffer.length,
            });
            res.send(audioBuffer);
        } catch (e: any) {
            console.error('TTS Route Error:', e);
            if (e.code === 'insufficient_quota') {
                return res.status(429).json({ error: 'OpenAI quota exceeded' });
            }
            res.status(500).json({ error: 'Failed to generate speech' });
        }
    }
);

/** POST /ai/stt - Transcribe speech from audio file */
router.post(
    '/stt',
    upload.single('audio'),
    async (req: Request, res: Response) => {
        try {
            const file = (req as any).file;
            if (!file) {
                return res.status(400).json({ error: 'Audio file is required' });
            }

            const stt = getSTTService();
            const text = await stt.transcribe(file.buffer);

            res.json({ text });
        } catch (e: any) {
            console.error('STT Route Error:', e);
            const message = String(e?.message ?? '');
            const backendUnavailable =
                /whisper/i.test(message) ||
                /transcription failed/i.test(message) ||
                /enoent/i.test(message);
            if (backendUnavailable) {
                // Fail-soft so frontend can continue with browser STT fallback
                return res.json({
                    text: '',
                    warning: 'Local STT backend unavailable; using fallback',
                });
            }
            res.status(500).json({ error: 'Failed to transcribe audio' });
        }
    }
);

export const aiRoutes = router;
