/**
 * Avatar service: orchestrates talking-head video generation for the AI interviewer.
 * Uses Coqui TTS + SadTalker + Wav2Lip via avatar.pipeline. Caches by text hash to avoid
 * regenerating identical replies. Does not block the interview flow on failure.
 */
import { logger } from '../../config/logger';
import { config } from '../../config';
import { runAvatarPipeline, type AvatarPipelineResult } from './avatar.pipeline';

/** In-memory cache: hash(text) -> videoUrl. Avoids re-running pipeline for identical questions. */
const replyCache = new Map<string, string>();
const MAX_CACHE_SIZE = 100;

function hashText(text: string): string {
  let h = 0;
  const s = text.trim();
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return String(h);
}

function getCachedVideoUrl(text: string): string | null {
  const key = hashText(text);
  return replyCache.get(key) ?? null;
}

function setCachedVideoUrl(text: string, videoUrl: string): void {
  const key = hashText(text);
  if (replyCache.size >= MAX_CACHE_SIZE) {
    const firstKey = replyCache.keys().next().value;
    if (firstKey !== undefined) replyCache.delete(firstKey);
  }
  replyCache.set(key, videoUrl);
}

export interface GenerateAvatarInput {
  text: string;
  avatarImage?: string;
}

export interface GenerateAvatarResult {
  videoUrl?: string;
  error?: string;
}

/**
 * Generate talking-head video for the given text. Returns video URL or undefined on failure.
 * Uses cache for identical text. Respects config.avatar.enabled.
 */
export async function generateAvatar(input: GenerateAvatarInput): Promise<GenerateAvatarResult> {
  if (!config.avatar.enabled) {
    return {};
  }
  const text = (input.text || '').trim();
  if (!text) return {};

  const cached = getCachedVideoUrl(text);
  if (cached) {
    logger.debug('Avatar cache hit', { textLength: text.length });
    return { videoUrl: cached };
  }

  const avatarImage = input.avatarImage || config.avatar.defaultImage;
  let result: AvatarPipelineResult;
  try {
    result = await runAvatarPipeline({
      text,
      avatarImage,
    });
  } catch (err) {
    logger.error('Avatar generation failed', { error: (err as Error).message });
    return { error: (err as Error).message };
  }

  if (!result.success) {
    logger.warn('Avatar pipeline returned failure', { error: result.error });
    return { error: result.error };
  }

  if (result.videoUrl) setCachedVideoUrl(text, result.videoUrl);
  return { videoUrl: result.videoUrl };
}

/**
 * Generate avatar with a timeout. Used from the interview flow so we don't block the reply.
 * If generation exceeds timeout, returns without videoUrl (interview continues with text only).
 */
export function generateAvatarWithTimeout(
  input: GenerateAvatarInput,
  timeoutMs: number = config.avatar.generationTimeoutMs
): Promise<GenerateAvatarResult> {
  return Promise.race([
    generateAvatar(input),
    new Promise<GenerateAvatarResult>((resolve) =>
      setTimeout(() => {
        logger.debug('Avatar generation timed out', { timeoutMs });
        resolve({});
      }, timeoutMs)
    ),
  ]);
}

export const avatarService = {
  generateAvatar,
  generateAvatarWithTimeout,
  isEnabled: () => config.avatar.enabled,
};
