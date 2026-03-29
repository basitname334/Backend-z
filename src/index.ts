/**
 * Backend entry point: start HTTP server with Socket.io for real-time voice interviews.
 */
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import app from './api/app';
import { config } from './config';
import { bootstrapDatabase } from './db/bootstrap-db';
import { SignalingService } from './services/signaling.service';
import { llmService } from './services/llm.service';
import { sttService } from './services/stt.service';
import { logger } from './config/logger';

async function start() {
  try {
    await bootstrapDatabase();
  } catch (e) {
    logger.warn('Database bootstrap had errors (some tables may already exist):', (e as Error).message);
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

  // Mail: log which sender is used so you can confirm MAIL_FROM from .env
  if (config.mail.user && config.mail.from) {
    logger.info(`[Mail] Sender configured: ${config.mail.from} (restart backend after changing .env)`);
  } else {
    logger.warn('[Mail] Not configured. Set MAIL_USER, MAIL_PASS, MAIL_FROM in .env to send emails.');
  }

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

  // Optional: start avatar queue worker (runs when Redis is configured)
  try {
    const { startAvatarWorker } = await import('./queues/avatarQueue');
    startAvatarWorker();
  } catch (_) {
    // Queue optional
  }

  logger.info('All services initialized');

  // Start server
  const server = httpServer.listen(config.port, () => {
    logger.info(`Server listening on port ${config.port} (env: ${config.env})`);
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
