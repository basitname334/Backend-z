/**
 * Conversation Manager: stores full Q&A history, summarizes older context when
 * token limit approaches, and enforces turn-based flow. All context passed to
 * the LLM goes through this so we stay within token budgets at scale.
 */

import { v4 as uuidv4 } from 'uuid';
import type { InterviewState, Turn } from '../../types';
import { config } from '../../config';

const CHARS_PER_TOKEN_ESTIMATE = 4;
const MAX_TOKENS = config.ai.maxContextTokens;
const SUMMARIZE_THRESHOLD = Math.floor(MAX_TOKENS * 0.75);

export interface ConversationContext {
  /** Recent turns (and optionally a summary of older turns) for the LLM */
  messages: { role: 'assistant' | 'user'; content: string }[];
  /** If set, prepend this to system/context so model knows what was summarized */
  priorSummary?: string;
  approximateTokens: number;
}

export class ConversationManager {
  /**
   * Estimate token count from string length (conservative).
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
  }

  /**
   * Build context for the next LLM call: recent turns + optional summary of older.
   * When approximateTokens from state exceeds SUMMARIZE_THRESHOLD, we would
   * call a summarizer and set priorSummary; here we stub that and just trim
   * to last N turns to stay under budget.
   */
  buildContext(state: InterviewState): ConversationContext {
    const turns = state.turns;
    let totalTokens = state.approximateTokens || 0;
    const messages: { role: 'assistant' | 'user'; content: string }[] = [];
    let priorSummary: string | undefined;

    if (totalTokens > SUMMARIZE_THRESHOLD && turns.length > 10) {
      priorSummary = 'Earlier in the interview, the candidate answered several questions. The following is a brief summary: [Summarization would be inserted here by a background job or inline summarizer].';
      totalTokens = this.estimateTokens(priorSummary);
      const recentTurns = turns.slice(-12);
      for (const t of recentTurns) {
        const role = t.role === 'ai' ? 'assistant' : 'user';
        messages.push({ role, content: t.content });
        totalTokens += this.estimateTokens(t.content);
      }
    } else {
      for (const t of turns) {
        const role = t.role === 'ai' ? 'assistant' : 'user';
        messages.push({ role, content: t.content });
        totalTokens += this.estimateTokens(t.content);
      }
    }

    return { messages, priorSummary, approximateTokens: totalTokens };
  }

  /**
   * Create a new turn object. Used by the interviewer flow when recording Q&A.
   */
  createTurn(
    role: 'ai' | 'candidate',
    content: string,
    meta?: {
      questionId?: string;
      evaluation?: Turn['evaluation'];
      codingStarterCode?: string | null;
      codingLanguage?: string | null;
      isCodingQuestion?: boolean;
    }
  ): Turn {
    return {
      id: uuidv4(),
      role,
      content,
      timestamp: new Date().toISOString(),
      questionId: meta?.questionId,
      evaluation: meta?.evaluation,
      codingStarterCode: meta?.codingStarterCode,
      codingLanguage: meta?.codingLanguage,
      isCodingQuestion: meta?.isCodingQuestion,
    };
  }

  /**
   * Enforce turn order: next speaker must be the opposite of last turn.
   * Returns true if it's the candidate's turn (to speak), false if AI's.
   */
  nextSpeaker(turns: Turn[]): 'ai' | 'candidate' {
    if (turns.length === 0) return 'ai';
    const last = turns[turns.length - 1];
    return last.role === 'ai' ? 'candidate' : 'ai';
  }

  /**
   * Check if the last turn was from the candidate (so we can evaluate and then ask next question).
   */
  lastTurnWasCandidate(turns: Turn[]): boolean {
    return turns.length > 0 && turns[turns.length - 1].role === 'candidate';
  }
}

export const conversationManager = new ConversationManager();
