/**
 * Express app: CORS, JSON body, mount interview and report routes.
 * Auth middleware can be applied per-route for recruiter endpoints.
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from '../config';
import { interviewRoutes } from './routes/interview';
import { reportRoutes } from './routes/report';
import { adminRoutes } from './routes/admin';
import { publicJoinRoutes } from './routes/publicJoin';
import { aiRoutes } from './routes/ai';
import { llmRoutes } from './routes/llm.routes';
import { voiceInterviewRoutes } from './routes/voice-interview.routes';
import { voiceLoopRoutes } from './routes/voiceLoop.routes';
import { recruiterRoutes } from './routes/recruiter';
import { transcribeRoutes } from './routes/transcribe.routes';
import { publicJobsRoutes } from './routes/publicJobs';
import { candidateAuthRoutes } from './routes/candidateAuth';

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

app.use(`${config.apiPrefix}/interview`, interviewRoutes);
app.use(`${config.apiPrefix}/report`, reportRoutes);
app.use(`${config.apiPrefix}/admin`, adminRoutes);
app.use(`${config.apiPrefix}/recruiter`, recruiterRoutes);
app.use(`${config.apiPrefix}/public/join`, publicJoinRoutes);
app.use(`${config.apiPrefix}/public/jobs`, publicJobsRoutes);
app.use(`${config.apiPrefix}/candidate`, candidateAuthRoutes);
app.use(`${config.apiPrefix}/ai`, aiRoutes);
app.use(`${config.apiPrefix}/llm`, llmRoutes);
app.use(`${config.apiPrefix}/voice-interview`, voiceInterviewRoutes);
app.use(`${config.apiPrefix}/voice-loop`, voiceLoopRoutes);
// Voice STT (multipart upload)
app.use(`${config.apiPrefix}/transcribe`, transcribeRoutes);
// Alias to satisfy clients expecting POST /api/transcribe
app.use('/api/transcribe', transcribeRoutes);

export default app;
