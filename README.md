# AI Interviewer Platform – Backend

Production-ready backend for the AI Interviewer: session lifecycle, adaptive questioning, real-time scoring, and recruiter reports.

## Architecture

- **Interview Session Engine** (`services/interview/InterviewSessionService.ts`): Creates/starts/ends sessions; state lives in **Redis** with TTL; PostgreSQL stores interview and report rows for persistence.
- **Conversation Manager** (`ConversationManager.ts`): Full Q&A history; builds LLM context and summarizes when token budget is near limit; turn-based flow.
- **Question Strategy Engine** (`QuestionStrategyEngine.ts`): Role- and phase-based question selection, difficulty scaling, follow-up logic; demo question bank in-memory (swap to DB for production).
- **AI Evaluation Engine** (`EvaluationEngine.ts`): Scores answers (relevance, structure, depth), red flags, competency mapping; bias-aware prompts; structured JSON from LLM.
- **Scoring & Reporting** (`ScoringReportService.ts`): Aggregates per-answer scores, competency roll-up, final recommendation, recruiter-ready report.
- **AI Interviewer Orchestrator** (`AIInterviewerOrchestrator.ts`): Single entry point: submit answer → evaluate → next question or report; get next reply for start/phase change.

LLM, STT, TTS are behind interfaces in `ai/` so providers can be swapped. Prompts live in `ai/prompts/`.

## Setup

```bash
cp .env.example .env
# Set DATABASE_URL, REDIS_URL, optional OPENAI_API_KEY

npm install
npm run build
```

## Database (PostgreSQL + Prisma)

1. Set `DATABASE_URL` in `.env` (e.g. `postgresql://user:password@localhost:5432/ai_interviewer`).

2. **Option A – Prisma (recommended)**  
   Create/sync schema and generate client:
   ```bash
   npx prisma generate    # generate Prisma Client (no DB required)
   npx prisma db push     # create/update tables from prisma/schema.prisma
   npx prisma db seed     # optional: test candidate + competencies
   ```
   Or use migrations:
   ```bash
   npx prisma migrate dev --name init
   npx prisma db seed
   ```

3. **Option B – Raw SQL**  
   ```bash
   psql $DATABASE_URL -f src/db/schema.sql
   psql $DATABASE_URL -f src/db/schema-scheduled.sql
   psql $DATABASE_URL -f src/db/seed.sql
   ```

**Prisma commands** (from `backend/`):

| Command | Description |
|---------|-------------|
| `npm run db:generate` | Generate Prisma Client (`prisma generate`) |
| `npm run db:push` | Sync schema to DB without migrations (`prisma db push`) |
| `npm run db:migrate` | Create and run a migration (`prisma migrate dev`) |
| `npm run db:studio` | Open Prisma Studio (DB GUI) |
| `npm run db:seed` | Run seed script |

Use candidate id `00000000-0000-0000-0000-000000000001` for local testing, or create candidates via your app.

## Run

```bash
npm run dev   # ts-node-dev
# or
npm start     # node dist/index.js
```

API base: `http://localhost:4000/api/v1`

## API

| Method | Path | Description |
|--------|------|-------------|
| POST   | `/api/v1/interview/start` | Start interview (body: `candidateId`, `role`, optional `positionId`). Returns `interviewId`, `state`, `firstReply`. |
| POST   | `/api/v1/interview/:id/answer` | Submit candidate answer (body: `answerText`). Returns `state`, `nextReply`, `evaluation`, optional `report` when done. |
| GET    | `/api/v1/interview/:id/state` | Get current interview state from Redis. |
| POST   | `/api/v1/interview/:id/end` | End interview, persist report. |
| GET    | `/api/v1/report/:interviewId` | Get recruiter report (from memory or DB). |
| POST   | `/api/v1/admin/login` | Admin login (body: `email`, `password`). Returns `token`, `email`. |
| POST   | `/api/v1/admin/schedule` | Create scheduled interview (Auth: Bearer). Body: `candidateEmail`, `candidateName?`, `role`, `scheduledAt`, `positionId?`. Returns `joinUrl`, etc. |
| GET    | `/api/v1/admin/schedules` | List scheduled interviews (Auth: Bearer). |
| GET    | `/api/v1/public/join/:token` | Get schedule info for join link (no auth). |
| POST   | `/api/v1/public/join/:token/start` | Start interview from link (no auth). Creates candidate if needed, returns `interviewId`, `firstReply`. |

## Scaling

- **Thousands of interviews/day**: Keep API stateless; use Redis for all live session state; Bull + workers for report generation and summarization; connection pool and read replicas for PostgreSQL.
- **Media pipeline**: WebRTC audio → STT (streaming) → text to orchestrator; TTS for playback; recordings to object storage via queue jobs.

## Files Overview

| Path | Purpose |
|------|---------|
| `src/config/index.ts` | Env and app config. |
| `src/db/schema.sql` | PostgreSQL schema (users, candidates, interviews, reports, question_templates). |
| `src/db/client.ts` | PG pool and query helper. |
| `src/redis/client.ts` | Redis client and session/context key helpers. |
| `src/types/index.ts` | Shared domain types. |
| `src/ai/llm/` | LLM abstraction and OpenAI stub. |
| `src/ai/prompts/` | Interviewer and evaluation prompt templates. |
| `src/ai/stt/types.ts`, `src/ai/tts/types.ts` | STT/TTS interfaces (implement later). |
| `src/services/interview/*` | Session, conversation, strategy, evaluation, scoring, orchestrator. |
| `src/queues/interviewJobs.ts` | Bull job types and stubs. |
| `src/api/routes/interview.ts` | Interview lifecycle routes. |
| `src/api/routes/report.ts` | Report fetch (memory + DB fallback). |
| `src/api/app.ts` | Express app and route mounting. |
| `src/index.ts` | HTTP server and graceful shutdown. |
