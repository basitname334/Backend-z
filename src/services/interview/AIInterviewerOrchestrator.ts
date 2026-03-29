/**
 * AI Interviewer Orchestrator: ties together session, conversation, question
 * strategy, LLM, and evaluation. One entry point for "get next AI reply" and
 * "submit candidate answer". Ensures turn-based flow, evaluates answers, and
 * selects next question (or follow-up). Designed so the API and Socket.io
 * handlers only need to call this instead of each service separately.
 */

import { getLLMService } from '../../ai/llm';
import { SYSTEM_PROMPT_INTERVIEWER, buildInterviewerContext } from '../../ai/prompts';
import { interviewSessionService } from './InterviewSessionService';
import { conversationManager } from './ConversationManager';
import { questionStrategyEngine } from './QuestionStrategyEngine';
import { evaluationEngine } from './EvaluationEngine';
import { scoringReportService } from './ScoringReportService';
import { avatarService } from '../avatar/avatar.service';
import type { InterviewState, InterviewReport } from '../../types';

export interface SubmitAnswerInput {
  interviewId: string;
  answerText: string;
}

export type SubmitAnswerFailureReason = 'session_not_found' | 'no_pending_question';

export interface SubmitAnswerResult {
  success: boolean;
  state: InterviewState | null;
  nextReply?: string;
  /** Talking-head video URL for nextReply when avatar pipeline is enabled and succeeds. */
  avatarVideo?: string;
  evaluation?: { score: number; maxScore: number };
  report?: InterviewReport;
  /** Set when success is false: why the submission was rejected */
  failureReason?: SubmitAnswerFailureReason;
}

export interface GetNextReplyInput {
  interviewId: string;
  /** Optional: force move to next phase (e.g. after wrap_up question) */
  forceNextPhase?: boolean;
}

export interface GetNextReplyResult {
  success: boolean;
  state: InterviewState | null;
  reply: string;
  /** Talking-head video URL for this reply when avatar pipeline is enabled and succeeds. */
  avatarVideo?: string;
  questionId?: string;
  phase?: string;
}

export class AIInterviewerOrchestrator {
  private roleLabel(role: string): string {
    switch (role) {
      case 'customer_success':
        return 'customer success';
      default:
        return role.replace(/_/g, ' ');
    }
  }

  /** Intervion AI interviewer names: Ethan for technical, ZaraAlex for other roles. */
  private interviewerName(role: string): string {
    return role === 'technical' ? 'Ethan' : 'ZaraAlex';
  }

  private withGreetingIfFirstTurn(state: InterviewState, reply: string): string {
    const trimmed = (reply || '').trim();
    if (state.turns.length > 0) return trimmed;
    const name = this.interviewerName(state.role);
    const intro = `Hi, I'm ${name} from Intervion AI. Welcome to this ${this.roleLabel(state.role)} interview.`;
    if (!trimmed) {
      return `${intro} Let's get started.`;
    }
    const alreadyGreeting = /^(hi|hello|welcome|i'?m)\b/i.test(trimmed);
    if (alreadyGreeting) return trimmed;
    return `${intro} ${trimmed}`;
  }

  /**
   * Submit candidate answer: evaluate it, append turns, decide follow-up vs next
   * question, and return next AI reply. If interview is at end, generate report.
   */
  async submitAnswer(input: SubmitAnswerInput): Promise<SubmitAnswerResult> {
    const state = await interviewSessionService.getState(input.interviewId);
    if (!state) {
      return { success: false, state: null, failureReason: 'session_not_found' };
    }

    const lastTurn = state.turns.length > 0 ? state.turns[state.turns.length - 1] : null;
    if (!lastTurn || lastTurn.role !== 'ai') {
      return { success: false, state: null, failureReason: 'no_pending_question' };
    }

    const lastAiTurn = [...state.turns].reverse().find((t) => t.role === 'ai');
    const lastQuestionText = lastAiTurn?.content ?? '';
    const lastQuestionId = lastAiTurn?.questionId;
    const competencyIds = lastQuestionId
      ? questionStrategyEngine.getCompetencyIdsForQuestionId(lastQuestionId)
      : ['communication'];

    const evaluation = await evaluationEngine.evaluate({
      question: lastQuestionText,
      answer: input.answerText,
      competencyIds: competencyIds.length ? competencyIds : ['communication'],
    });

    const candidateTurn = conversationManager.createTurn('candidate', input.answerText, {
      evaluation,
    });
    await interviewSessionService.appendTurn(input.interviewId, candidateTurn, {
      topicCoverage: lastQuestionId ? { [lastQuestionId]: true } : undefined,
    });

    const updatedState = await interviewSessionService.getState(input.interviewId);
    if (!updatedState) return { success: true, state: null, evaluation: { score: evaluation.score, maxScore: evaluation.maxScore } };

    const requestFollowUp = evaluation.normalizedScore < 0.5 || input.answerText.length < 50;
    const next = await questionStrategyEngine.getNextQuestion({
      state: updatedState,
      requestFollowUp,
    });

    if (!next) {
      const report = scoringReportService.buildReport({ ...updatedState, endedAt: new Date().toISOString() });
      await interviewSessionService.end(input.interviewId, report);
      return {
        success: true,
        state: updatedState,
        nextReply: 'Thank you for your time today. That concludes our interview. You will receive feedback shortly.',
        evaluation: { score: evaluation.score, maxScore: evaluation.maxScore },
        report,
      };
    }

    let aiReply: string;
    try {
      aiReply = await this.getNextReplyInternal(updatedState, next.questionText, next.questionId, next.phase, lastQuestionText, input.answerText);
    } catch (err) {
      console.error('getNextReplyInternal failed (using fallback):', err);
      aiReply = next.questionText || 'Thank you for that. Can you tell me a bit more?';
    }
    let avatarVideo: string | undefined;
    try {
      if (avatarService.isEnabled()) {
        const avatarResult = await avatarService.generateAvatarWithTimeout({ text: aiReply });
        avatarVideo = avatarResult.videoUrl;
      }
    } catch (err) {
      console.error('Avatar generation failed (non-blocking):', err);
    }
    const aiTurn = conversationManager.createTurn('ai', aiReply, {
      questionId: next.questionId,
      codingStarterCode: next.starterCode ?? undefined,
      codingLanguage: next.language ?? undefined,
      isCodingQuestion: next.isCodingQuestion ?? false,
      avatarVideo,
    });
    await interviewSessionService.appendTurn(input.interviewId, aiTurn, {
      phase: next.phase,
      currentDifficulty: next.difficulty,
    });

    const finalState = await interviewSessionService.getState(input.interviewId);
    return {
      success: true,
      state: finalState ?? updatedState,
      nextReply: aiReply,
      avatarVideo,
      evaluation: { score: evaluation.score, maxScore: evaluation.maxScore },
    };
  }

  /**
   * Get the next AI reply (e.g. first greeting or after phase change). Does not
   * append a candidate turn; use this for "start interview" or when advancing phase.
   */
  async getNextReply(input: GetNextReplyInput): Promise<GetNextReplyResult> {
    const state = await interviewSessionService.getState(input.interviewId);
    if (!state) {
      return { success: false, state: null, reply: '' };
    }

    const next =
      state.turns.length === 0
        ? await questionStrategyEngine.getFirstQuestion(state.role)
        : await questionStrategyEngine.getNextQuestion({
            state,
            forceNextPhase: input.forceNextPhase,
          });

    if (!next) {
      return { success: false, state, reply: '' };
    }

    const isFirstQuestion = state.turns.length === 0;
    let rawReply: string;
    if (isFirstQuestion && state.resumeContext?.trim()) {
      rawReply = await this.getFirstQuestionFromResume(state);
      if (!rawReply?.trim()) rawReply = next.questionText;
    } else if (isFirstQuestion) {
      rawReply = next.questionText;
    } else {
      rawReply = await this.getNextReplyInternal(state, next.questionText, next.questionId, next.phase);
    }
    const reply = this.withGreetingIfFirstTurn(state, rawReply);
    let avatarVideo: string | undefined;
    try {
      if (avatarService.isEnabled()) {
        const avatarResult = await avatarService.generateAvatarWithTimeout({ text: reply });
        avatarVideo = avatarResult.videoUrl;
      }
    } catch (err) {
      console.error('Avatar generation failed (non-blocking):', err);
    }
    const aiTurn = conversationManager.createTurn('ai', reply, {
      questionId: next.questionId,
      codingStarterCode: next.starterCode ?? undefined,
      codingLanguage: next.language ?? undefined,
      isCodingQuestion: next.isCodingQuestion ?? false,
      avatarVideo,
    });
    await interviewSessionService.appendTurn(input.interviewId, aiTurn, {
      phase: next.phase,
      currentDifficulty: next.difficulty,
    });

    const updatedState = await interviewSessionService.getState(input.interviewId);
    return {
      success: true,
      state: updatedState ?? state,
      reply,
      avatarVideo,
      questionId: next.questionId,
      phase: next.phase,
    };
  }

  /** When resume is available, generate the first question by reading the resume thoroughly. */
  private async getFirstQuestionFromResume(state: InterviewState): Promise<string> {
    const resumeContextBlock = state.resumeContext
      ? `\nCandidate resume/profile context (read this thoroughly before deciding your first question):\n${state.resumeContext}\n\nYou MUST base your first question on something specific from this resume.`
      : '';
    const systemContent =
      SYSTEM_PROMPT_INTERVIEWER.replace('{{phase}}', state.phase)
        .replace('{{role}}', state.role) +
      resumeContextBlock;
    const userInstruction = `Read the candidate's resume above thoroughly. Your task is to ask the very first interview question. Decide on ONE opening question that references something specific from their resume (e.g. a project, role, skill, or experience). Be conversational and natural. Respond only with valid JSON: {"reply": "<your first question>", "intent": "next_question", "suggestedNextPhase": null}`;
    const messages = [
      { role: 'system' as const, content: systemContent },
      { role: 'user' as const, content: userInstruction },
    ];
    const llm = getLLMService();
    try {
      const response = await llm.chat(messages, { temperature: 0.4, maxTokens: 320, timeoutMs: 10000 });
      const raw = (response.content || '').replace(/```json?\s*/g, '').trim();
      const parsed = JSON.parse(raw);
      if (typeof parsed.reply === 'string' && parsed.reply.length > 0) return parsed.reply.trim();
      if (raw.length > 15 && !raw.startsWith('{')) return raw;
    } catch {
      // fallback to template question
    }
    return '';
  }

  private async getNextReplyInternal(
    state: InterviewState,
    questionText: string,
    questionId: string | undefined,
    phase: string | undefined,
    lastQuestionAsked?: string,
    lastCandidateAnswer?: string
  ): Promise<string> {
    const context = conversationManager.buildContext(state);
    const resumeContextBlock = state.resumeContext
      ? `\nCandidate resume/profile context (use thoroughly when deciding each question):\n${state.resumeContext}\n\nUse this context to personalize every question: reference their background, probe deeper into resume claims, and keep questions relevant to the candidate.`
      : '';
    const focusAreasBlock = state.focusAreas
      ? `\nInterview focus areas / subject (set by recruiter): ${state.focusAreas}. Prioritize questions and topics related to these areas when relevant.`
      : '';
    const durationBlock = state.durationMinutes
      ? `\nInterview duration: ${state.durationMinutes} minutes. Keep questions focused and allow time for wrap-up.`
      : '';
    const systemContent =
      SYSTEM_PROMPT_INTERVIEWER.replace('{{phase}}', state.phase)
        .replace('{{role}}', state.role) +
      resumeContextBlock +
      focusAreasBlock +
      durationBlock +
      (context.priorSummary ? '\n' + buildInterviewerContext(context.priorSummary) : '');

    const answerSnippet = lastCandidateAnswer ? lastCandidateAnswer.slice(0, 800).trim() : '';
    const questionSnippet = lastQuestionAsked ? lastQuestionAsked.slice(0, 300).trim() : '';
    let userInstruction: string;
    if (answerSnippet && questionSnippet) {
      userInstruction = `The interviewer asked: "${questionSnippet}"

The candidate answered: "${answerSnippet}"

Analyze the candidate's answer. Your reply must: (1) Show you understood by referencing or reflecting something specific they said. (2) Then ask the next question; you may rephrase it to connect to their answer. Next question to ask (topic/intent): ${questionText}`;
    } else if (answerSnippet) {
      userInstruction = `The candidate just said: "${answerSnippet}". Analyze their answer. Reference something specific they said, then ask the next question. Next question to ask: ${questionText}`;
    } else {
      userInstruction = `Next question to ask: ${questionText}`;
    }

    const messages = [
      { role: 'system' as const, content: systemContent },
      ...context.messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: userInstruction },
    ];

    const llm = getLLMService();
    const response = await llm.chat(messages, { temperature: 0.4, maxTokens: 320, timeoutMs: 10000 });
    const raw = (response.content || '').replace(/```json?\s*/g, '').trim();
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.reply === 'string' && parsed.reply.length > 0) return parsed.reply;
    } catch {
      // LLM returned plain text instead of JSON; use it as the reply if it looks like speech
      if (raw.length > 15 && !raw.startsWith('{')) return raw;
    }
    return questionText;
  }

  /**
   * Generate report for a completed interview (e.g. from GET /report/:id).
   */
  async getReport(interviewId: string): Promise<InterviewReport | null> {
    const state = await interviewSessionService.getState(interviewId);
    if (!state) return null;
    return scoringReportService.buildReport({
      ...state,
      endedAt: state.endedAt ?? new Date().toISOString(),
    });
  }
}

export const aiInterviewerOrchestrator = new AIInterviewerOrchestrator();
