/**
 * Bull queue for async avatar generation. When used, the interview API can return
 * the text reply immediately and the worker attaches the video URL to the turn
 * when generation completes. Requires Redis (not in-memory).
 */
import Queue from 'bull';
import { config } from '../config';
import { logger } from '../config/logger';
import { avatarService } from '../services/avatar/avatar.service';
import { interviewSessionService } from '../services/interview/InterviewSessionService';

export const AVATAR_QUEUE_NAME = 'avatar-generation';

export interface AvatarJobData {
  interviewId: string;
  turnId: string;
  text: string;
  avatarImage?: string;
}

let avatarQueue: Queue.Queue<AvatarJobData> | null = null;

/** Debounce repeated queue errors (e.g. Redis down) to avoid log spam. */
let lastAvatarQueueErrorLog = 0;
const AVATAR_QUEUE_ERROR_LOG_INTERVAL_MS = 60_000;

function getRedisUrl(): string | null {
  const url = (config.redis.url || '').trim().toLowerCase();
  if (!url || url === 'memory') return null;
  return config.redis.url;
}

/**
 * Get or create the avatar queue. Returns null if Redis is not configured.
 */
export function getAvatarQueue(): Queue.Queue<AvatarJobData> | null {
  if (avatarQueue) return avatarQueue;
  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    logger.debug('Avatar queue: Redis not configured, queue disabled');
    return null;
  }
  try {
    avatarQueue = new Queue<AvatarJobData>(AVATAR_QUEUE_NAME, redisUrl, {
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
      },
    });
    avatarQueue.on('error', (err: unknown) => {
      const now = Date.now();
      if (now - lastAvatarQueueErrorLog < AVATAR_QUEUE_ERROR_LOG_INTERVAL_MS) return;
      lastAvatarQueueErrorLog = now;
      const msg = err instanceof Error ? err.message : String(err);
      const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
      logger.warn('Avatar queue error (Redis/Bull). Further errors suppressed for 1 min.', { error: msg || 'Unknown', code });
    });
    return avatarQueue;
  } catch (err) {
    logger.warn('Avatar queue creation failed', { error: (err as Error).message });
    return null;
  }
}

/**
 * Enqueue avatar generation. When the job runs, it will generate the video and
 * call interviewSessionService.updateTurnAvatarVideo(interviewId, turnId, videoUrl).
 */
export async function enqueueAvatarGeneration(data: AvatarJobData): Promise<void> {
  const queue = getAvatarQueue();
  if (!queue) return;
  try {
    await queue.add(data);
    logger.debug('Avatar job enqueued', { interviewId: data.interviewId, turnId: data.turnId });
  } catch (err) {
    logger.error('Failed to enqueue avatar job', { error: (err as Error).message, data });
  }
}

/**
 * Process a single avatar job. Called by the worker.
 */
export async function processAvatarJob(data: AvatarJobData): Promise<void> {
  const result = await avatarService.generateAvatar({
    text: data.text,
    avatarImage: data.avatarImage,
  });
  if (result.error || !result.videoUrl) {
    logger.warn('Avatar job produced no video', { interviewId: data.interviewId, error: result.error });
    return;
  }
  const updated = await interviewSessionService.updateTurnAvatarVideo(
    data.interviewId,
    data.turnId,
    result.videoUrl
  );
  if (updated) logger.info('Avatar attached to turn', { interviewId: data.interviewId, turnId: data.turnId });
}

/**
 * Start the avatar queue worker. Call once at app startup when Redis is available.
 */
export function startAvatarWorker(): void {
  const queue = getAvatarQueue();
  if (!queue) return;
  queue.process(async (job) => {
    await processAvatarJob(job.data);
  });
  logger.info('Avatar queue worker started');
}
