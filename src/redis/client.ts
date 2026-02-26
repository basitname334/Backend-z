/**
 * Redis client for session state and context. Used by InterviewSessionService
 * to store live interview state. When REDIS_URL is empty or "memory", uses
 * in-memory store so the app runs without Redis (e.g. local dev).
 */
import Redis from 'ioredis';
import { config } from '../config';

const KEY_PREFIX = 'ai_interview:';

/** Minimal interface used by InterviewSessionService */
export type RedisLike = {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<string>;
  expire(key: string, seconds: number): Promise<number>;
};

function createMemoryStore(): RedisLike {
  const store = new Map<string, { value: string; expiryTs: number }>();
  return {
    async get(key: string): Promise<string | null> {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiryTs) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async setex(key: string, seconds: number, value: string): Promise<string> {
      store.set(key, { value, expiryTs: Date.now() + seconds * 1000 });
      return 'OK';
    },
    async expire(key: string, seconds: number): Promise<number> {
      const entry = store.get(key);
      if (entry) entry.expiryTs = Date.now() + seconds * 1000;
      return 1;
    },
  };
}

let client: RedisLike | null = null;

const LOCALHOST_REDIS = 'redis://localhost:6379';

export function getRedis(): RedisLike {
  if (!client) {
    const url = (config.redis.url || '').trim();
    const urlLower = url.toLowerCase();
    // Use in-memory when Redis is disabled or when using default localhost URL (Redis often not running in dev).
    if (urlLower === '' || urlLower === 'memory' || url === LOCALHOST_REDIS || urlLower === LOCALHOST_REDIS) {
      console.log('Using in-memory store for session state (no Redis). Set REDIS_URL to a running Redis to use it.');
      client = createMemoryStore();
    } else {
      const r = new Redis(config.redis.url, {
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          return Math.min(times * 100, 3000);
        },
      });
      r.on('error', (err) => {
        console.error('Redis error', err);
      });
      client = r as unknown as RedisLike;
    }
  }
  return client;
}

export function sessionKey(interviewId: string): string {
  return `${KEY_PREFIX}session:${interviewId}`;
}

export function contextKey(interviewId: string): string {
  return `${KEY_PREFIX}context:${interviewId}`;
}

/** TTL for session keys (e.g. 4 hours for a long interview) */
export const SESSION_TTL_SECONDS = 4 * 60 * 60;

export async function closeRedis(): Promise<void> {
  if (client && 'quit' in client && typeof (client as Redis).quit === 'function') {
    await (client as Redis).quit();
  }
  client = null;
}
