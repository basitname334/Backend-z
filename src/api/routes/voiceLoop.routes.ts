/**
 * Voice interview loop: start → AI question → user speaks → transcribe → next question → loop.
 * Uses getLLMService() (Open Router when OPENROUTER_API_KEY set, else Ollama) for role-based questions;
 * whisper.cpp for transcription.
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getLLMService } from '../../ai/llm';
import { transcribeAudio } from '../../services/speech.service';
import { sttService } from '../../services/stt.service';
import { logger } from '../../config/logger';

const router = Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /audio\/(wav|webm|ogg|mpeg|mp4|x-wav)/i.test(file.mimetype) || file.mimetype === 'application/octet-stream';
    if (allowed) cb(null, true);
    else cb(new Error('Invalid file type'));
  },
});

function firstQuestionMessages(role: string): { role: 'system' | 'user'; content: string }[] {
  const roleContext = role ? ` The interview is for the role: ${role}.` : '';
  return [
    {
      role: 'system',
      content: `You are a professional AI interviewer. Generate exactly one short opening interview question to ask the candidate. Ask about their background or why they are interested in the role.${roleContext} Reply with only the question text, no preamble or quotes.`,
    },
    { role: 'user', content: 'Generate the first interview question.' },
  ];
}

function roleLabel(role: string): string {
  if (!role) return 'interview';
  return role.replace(/_/g, ' ');
}

function nextQuestionMessages(previousAnswer: string, role: string): { role: 'system' | 'user'; content: string }[] {
  const roleContext = role ? ` The interview is for the role: ${role}.` : '';
  return [
    {
      role: 'system',
      content: `You are a professional AI interviewer. The candidate just gave an answer. Generate exactly one follow-up or next interview question. Keep it concise and relevant.${roleContext} Reply with only the question text, no preamble or quotes.`,
    },
    {
      role: 'user',
      content: `The candidate said: "${previousAnswer}"\n\nGenerate the next interview question.`,
    },
  ];
}

/** POST /voice-loop/start-interview – get first question (optionally by role) */
router.post('/start-interview', async (req: Request, res: Response) => {
  try {
    const role = typeof req.body?.role === 'string' ? req.body.role.trim() : '';
    const llm = getLLMService();
    const out = await llm.chat(firstQuestionMessages(role));
    const question = (out.content || '').replace(/^["']|["']$/g, '').trim() || 'Tell me a bit about your background and what drew you to this role.';
    const greeting = `Hello! Welcome to this ${roleLabel(role)} interview.`;
    res.json({ question: `${greeting} ${question}`.trim() });
  } catch (e) {
    logger.error('Voice loop start-interview failed', { error: e });
    res.status(500).json({ error: 'Failed to generate first question' });
  }
});

/** POST /voice-loop/transcribe – upload audio, run whisper.cpp, return transcript */
router.post('/transcribe', upload.single('audio'), async (req: Request, res: Response) => {
  let tempPath: string | null = null;
  try {
    const file = (req as any).file;
    if (!file || !file.buffer?.length) {
      return res.status(400).json({ error: 'Audio file is required' });
    }
    const ext = (file.originalname && path.extname(file.originalname)) || '.wav';
    tempPath = path.join(os.tmpdir(), `voice_${Date.now()}${ext}`);
    fs.writeFileSync(tempPath, file.buffer);
    let transcript: string;
    try {
      transcript = await transcribeAudio(tempPath);
    } catch {
      transcript = await sttService.transcribeFile(tempPath);
    }
    res.json({ transcript: transcript || '' });
  } catch (e) {
    logger.error('Voice loop transcribe failed', { error: e });
    res.status(500).json({ error: 'Transcription failed' });
  } finally {
    if (tempPath && fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
  }
});

/** POST /voice-loop/next-question – send candidate answer, return next question (optionally by role) */
router.post('/next-question', async (req: Request, res: Response) => {
  try {
    const answer = typeof req.body?.answer === 'string' ? req.body.answer : '';
    const role = typeof req.body?.role === 'string' ? req.body.role.trim() : '';
    const llm = getLLMService();
    const out = await llm.chat(nextQuestionMessages(answer || '(No answer captured)', role));
    const question = (out.content || '').replace(/^["']|["']$/g, '').trim() || 'Could you tell me more?';
    res.json({ question });
  } catch (e) {
    logger.error('Voice loop next-question failed', { error: e });
    res.status(500).json({ error: 'Failed to generate next question' });
  }
});

export const voiceLoopRoutes = router;
