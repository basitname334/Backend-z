/**
 * Interview Session Engine: create, start, end sessions and maintain state in Redis.
 * State is the source of truth during the interview; PostgreSQL stores persistence
 * (interview row, report) for reporting and audit. Designed for thousands of
 * concurrent sessions via Redis and minimal DB writes during the session.
 */

import { v4 as uuidv4 } from 'uuid';
import { getRedis, sessionKey, contextKey, SESSION_TTL_SECONDS } from '../../redis/client';
import { query } from '../../db/client';
import type {
  InterviewState,
  InterviewPhase,
  InterviewReport,
  Turn,
  DifficultyLevel,
  ScheduledCustomQuestion,
} from '../../types';

const DEFAULT_PHASE_ORDER: InterviewPhase[] = ['intro', 'technical', 'behavioral', 'wrap_up', 'coding'];

export interface StartInterviewInput {
  candidateId: string;
  role: 'technical' | 'behavioral' | 'sales' | 'customer_success';
  positionId?: string;
  resumeContext?: string;
  preferredDifficulty?: DifficultyLevel;
  customQuestions?: ScheduledCustomQuestion[];
  focusAreas?: string;
  durationMinutes?: number;
}

export interface StartInterviewResult {
  interviewId: string;
  state: InterviewState;
}

export class InterviewSessionService {
  /**
   * Create a new interview and persist to DB; create Redis session with initial state.
   * Phase starts at intro. Client can then call getState and begin the conversation.
   */
  async start(input: StartInterviewInput): Promise<StartInterviewResult> {
    const interviewId = uuidv4();
    const now = new Date().toISOString();

    const state: InterviewState = {
      interviewId,
      candidateId: input.candidateId,
      resumeContext: input.resumeContext,
      role: input.role,
      phase: 'intro',
      startedAt: now,
      turns: [],
      topicCoverage: {},
      currentDifficulty: input.preferredDifficulty ?? 'medium',
      preferredDifficulty: input.preferredDifficulty,
      customQuestions: input.customQuestions ?? [],
      focusAreas: input.focusAreas,
      durationMinutes: input.durationMinutes,
      approximateTokens: 0,
    };

    const redis = getRedis();
    const key = sessionKey(interviewId);
    await redis.setex(key, SESSION_TTL_SECONDS, JSON.stringify(state));

    await query(
      `INSERT INTO interviews (id, candidate_id, position_id, role, status, started_at, updated_at)
       VALUES ($1, $2, $3, $4, 'in_progress', $5, $5)`,
      [interviewId, input.candidateId, input.positionId ?? null, input.role, now]
    );

    return { interviewId, state };
  }

  /**
   * Load session state from Redis. Returns null if session expired or not found.
   */
  async getState(interviewId: string): Promise<InterviewState | null> {
    const redis = getRedis();
    const raw = await redis.get(sessionKey(interviewId));
    if (!raw) return null;
    try {
      const state = JSON.parse(raw) as InterviewState;
      await redis.expire(sessionKey(interviewId), SESSION_TTL_SECONDS);
      return state;
    } catch {
      return null;
    }
  }

  /**
   * Update session state in Redis (e.g. after each turn). TTL is refreshed.
   */
  async setState(interviewId: string, state: InterviewState): Promise<void> {
    const redis = getRedis();
    await redis.setex(
      sessionKey(interviewId),
      SESSION_TTL_SECONDS,
      JSON.stringify(state)
    );
  }

  /**
   * Append a turn and optionally update phase/topicCoverage/difficulty.
   * Used by the conversation flow after each Q&A pair.
   */
  async appendTurn(
    interviewId: string,
    turn: Turn,
    updates: Partial<Pick<InterviewState, 'phase' | 'topicCoverage' | 'currentDifficulty' | 'approximateTokens'>> = {}
  ): Promise<InterviewState | null> {
    const state = await this.getState(interviewId);
    if (!state) return null;

    state.turns.push(turn);
    if (updates.phase !== undefined) state.phase = updates.phase;
    if (updates.topicCoverage !== undefined) {
      state.topicCoverage = { ...state.topicCoverage, ...updates.topicCoverage };
    }
    if (updates.currentDifficulty !== undefined) state.currentDifficulty = updates.currentDifficulty;
    if (updates.approximateTokens !== undefined) state.approximateTokens = updates.approximateTokens;

    await this.setState(interviewId, state);
    return state;
  }

  /**
   * End the interview: persist end time in DB, optionally store final report,
   * and clear or retain Redis state (we retain for a while for report generation).
   */
  async end(interviewId: string, report?: InterviewReport): Promise<boolean> {
    const state = await this.getState(interviewId);
    const now = new Date().toISOString();

    await query(
      `UPDATE interviews SET status = 'completed', ended_at = $2, updated_at = $2 WHERE id = $1`,
      [interviewId, now]
    );

    if (report) {
      const reportId = uuidv4();
      await query(
        `INSERT INTO reports (
          id, interview_id, overall_score, max_score, recommendation, summary,
          red_flags, strengths, improvements, competencies, question_answer_summary
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (interview_id) DO UPDATE SET
          overall_score = EXCLUDED.overall_score,
          max_score = EXCLUDED.max_score,
          recommendation = EXCLUDED.recommendation,
          summary = EXCLUDED.summary,
          red_flags = EXCLUDED.red_flags,
          strengths = EXCLUDED.strengths,
          improvements = EXCLUDED.improvements,
          competencies = EXCLUDED.competencies,
          question_answer_summary = EXCLUDED.question_answer_summary`,
        [
          reportId,
          interviewId,
          report.overallScore,
          report.maxScore,
          report.recommendation,
          report.summary,
          JSON.stringify(report.redFlags),
          JSON.stringify(report.strengths),
          JSON.stringify(report.improvements),
          JSON.stringify(report.competencies),
          JSON.stringify(report.questionAnswerSummary),
        ]
      );
    }

    return true;
  }

  /**
   * Get list of phases in order (for strategy engine).
   */
  getPhaseOrder(): InterviewPhase[] {
    return [...DEFAULT_PHASE_ORDER];
  }
}

export const interviewSessionService = new InterviewSessionService();
