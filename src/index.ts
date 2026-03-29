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

/** Bind all interfaces so platform proxies (Code.run, Northflank, K8s) can reach the container. */
const LISTEN_HOST = '0.0.0.0';

async function start() {
  const httpServer = createServer(app);

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    maxHttpBufferSize: 1e8, // 100 MB for audio chunks
  });

  const port = config.port;

  // Listen immediately so edge health checks get TCP accept + /health (not "connection refused").
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, LISTEN_HOST, () => {
      httpServer.off('error', reject);
      logger.info(`Server listening on ${LISTEN_HOST}:${port} (env: ${config.env})`);
      logger.info(`WebRTC signaling ready`);
      logger.info(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
      resolve();
    });
  });

  void runDeferredStartup(io);

  return httpServer;
}

async function runDeferredStartup(io: SocketIOServer): Promise<void> {
  try {
    try {
      await bootstrapDatabase();
    } catch (e) {
      logger.warn('Database bootstrap had errors (some tables may already exist):', (e as Error).message);
    }

    if (config.mail.user && config.mail.from) {
      logger.info(`[Mail] Sender configured: ${config.mail.from} (restart backend after changing .env)`);
    } else {
      logger.warn('[Mail] Not configured. Set MAIL_USER, MAIL_PASS, MAIL_FROM in .env to send emails.');
    }

    logger.info('Initializing services...');

    if (!config.ai.openRouterApiKey) {
      const ollamaHealthy = await llmService.healthCheck();
      if (!ollamaHealthy) {
        logger.warn('Ollama is not accessible. Please ensure Ollama is running: ollama serve');
      }
    } else {
      logger.info('OpenRouter configured; skipping Ollama health check');
    }

    const sttInitialized = await sttService.initialize();
    if (!sttInitialized) {
      logger.warn('STT service initialization failed. Voice transcription may not work properly.');
    }

    const signalingService = new SignalingService(io);
    signalingService.startCleanupInterval();

    try {
      const { startAvatarWorker } = await import('./queues/avatarQueue');
      startAvatarWorker();
    } catch (_) {
      // Queue optional
    }

    logger.info('All services initialized');
  } catch (e) {
    logger.error('Deferred startup failed (HTTP server is still up)', e);
  }
}

const serverPromise = start().catch((e) => {
  logger.error('Startup failed:', e);
  process.exit(1);
});

export default serverPromise;
