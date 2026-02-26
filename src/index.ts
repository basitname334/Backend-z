/**
 * Backend entry point: start HTTP server with Socket.io for real-time voice interviews.
 */
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import app from './api/app';
import { config } from './config';
import { ensureScheduledTable } from './db/ensure-scheduled';
import { ensureQuestionTemplatesTable } from './db/ensure-questions';
import { ensureUsersTable } from './db/ensure-users';
import { ensureHiringFlowTables } from './db/ensure-hiring-flow';
import { SignalingService } from './services/signaling.service';
import { llmService } from './services/llm.service';
import { sttService } from './services/stt.service';
import { logger } from './config/logger';

async function start() {
  try {
    await ensureUsersTable();
    logger.info('Users table ready');
  } catch (e) {
    logger.warn('Could not ensure users table:', (e as Error).message);
  }
  try {
    await ensureScheduledTable();
    logger.info('Scheduled interviews table ready');
  } catch (e) {
    logger.warn('Could not ensure scheduled_interviews table (run schema.sql and schema-scheduled.sql if needed):', (e as Error).message);
  }
  try {
    await ensureHiringFlowTables();
    logger.info('Hiring flow tables ready');
  } catch (e) {
    logger.warn('Could not ensure hiring flow tables:', (e as Error).message);
  }
  try {
    await ensureQuestionTemplatesTable();
    logger.info('Question templates table ready');
  } catch (e) {
    logger.warn('Could not ensure question_templates table:', (e as Error).message);
  }

  // Create HTTP server
  const httpServer = createServer(app);

  // Initialize Socket.io
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    maxHttpBufferSize: 1e8, // 100 MB for audio chunks
  });

  // Initialize services
  logger.info('Initializing services...');

  // Check Ollama only when OpenRouter is not configured.
  if (!config.ai.openRouterApiKey) {
    const ollamaHealthy = await llmService.healthCheck();
    if (!ollamaHealthy) {
      logger.warn('Ollama is not accessible. Please ensure Ollama is running: ollama serve');
    }
  } else {
    logger.info('OpenRouter configured; skipping Ollama health check');
  }

  // Initialize STT service
  const sttInitialized = await sttService.initialize();
  if (!sttInitialized) {
    logger.warn('STT service initialization failed. Voice transcription may not work properly.');
  }

  // Initialize WebRTC signaling service
  const signalingService = new SignalingService(io);
  signalingService.startCleanupInterval();

  logger.info('All services initialized');

  // Start server
  const host = process.env.HOST || '0.0.0.0';
  const server = httpServer.listen(config.port, host, () => {
    logger.info(`Server listening on ${host}:${config.port} (env: ${config.env})`);
    logger.info(`WebRTC signaling ready`);
    logger.info(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
  });

  return server;
}

const serverPromise = start().catch((e) => {
  logger.error('Startup failed:', e);
  process.exit(1);
});

export default serverPromise;
