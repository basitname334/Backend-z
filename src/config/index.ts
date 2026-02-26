/**
 * Central configuration. All env vars are read here so the rest of the app
 * stays env-agnostic and testable. For scale, consider validation (e.g. zod).
 */
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  apiPrefix: process.env.API_PREFIX || '/api/v1',

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  database: {
    url: process.env.DATABASE_URL || 'postgresql://localhost:5432/ai_interviewer',
  },

  redis: {
    // Default to in-memory so the app runs without Redis. Set REDIS_URL (e.g. redis://localhost:6379) to use Redis.
    url: process.env.REDIS_URL || 'memory',
  },

  ai: {
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    /** Open Router API key – used for interviewer (role-based questions) when set. https://openrouter.ai */
    openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
    /** AICC API key – optional, for voice/TTS or other services when set. */
    aiccApiKey: process.env.AICC_API_KEY || '',
    /** Open Router model (e.g. openai/gpt-4o, anthropic/claude-3-haiku). */
    openRouterModel: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
    defaultTemperature: 0.4,
    maxContextTokens: 12000,
  },

  storage: {
    endpoint: process.env.STORAGE_ENDPOINT,
    bucket: process.env.STORAGE_BUCKET || 'interview-recordings',
    accessKey: process.env.STORAGE_ACCESS_KEY,
    secretKey: process.env.STORAGE_SECRET_KEY,
  },

  vectorDb: {
    url: process.env.VECTOR_DB_URL,
  },

  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@example.com',
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },

  /** Base URL of the frontend (for join links). No trailing slash. */
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  mail: {
    service: process.env.MAIL_SERVICE || process.env.SMTP_SERVICE || '',
    host: process.env.MAIL_HOST || process.env.SMTP_HOST || process.env.EMAIL_HOST || '',
    port: parseInt(process.env.MAIL_PORT || process.env.SMTP_PORT || '587', 10),
    secure: String(process.env.MAIL_SECURE || process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    user: process.env.MAIL_USER || process.env.SMTP_USER || process.env.EMAIL_USER || '',
    pass: process.env.MAIL_PASS || process.env.SMTP_PASS || process.env.EMAIL_PASS || '',
    from:
      process.env.MAIL_FROM ||
      process.env.SMTP_FROM ||
      process.env.EMAIL_FROM ||
      process.env.MAIL_USER ||
      process.env.SMTP_USER ||
      'no-reply@aiinterviewer.local',
    replyTo: process.env.MAIL_REPLY_TO || '',
  },
} as const;
