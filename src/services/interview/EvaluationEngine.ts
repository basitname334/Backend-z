/**
 * AI Evaluation Engine: score answers (relevance, structure, depth), detect red flags,
 * map answers to competencies. Returns structured JSON; used in real time per answer
 * and for final report aggregation. Bias-aware: rubric is in prompts, no demographic inference.
 */

import { getLLMService } from '../../ai/llm';
import { SYSTEM_PROMPT_EVALUATION, buildEvaluationPrompt } from '../../ai/prompts';
import type { AnswerEvaluation } from '../../types';

const MAX_SCORE = 10;

export interface EvaluateAnswerInput {
  question: string;
  answer: string;
  competencyIds: string[];
}

export class EvaluationEngine {
  async evaluate(input: EvaluateAnswerInput): Promise<AnswerEvaluation> {
    const llm = getLLMService();
    const system = SYSTEM_PROMPT_EVALUATION;
    const userContent = buildEvaluationPrompt(input.question, input.answer, input.competencyIds);

    const response = await llm.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
      { temperature: 0.3, maxTokens: 256 }
    );

    const parsed = this.parseEvaluationResponse(response.content, input.competencyIds);
    return {
      ...parsed,
      normalizedScore: parsed.score / MAX_SCORE,
    };
  }

  private parseEvaluationResponse(raw: string, competencyIds: string[]): Omit<AnswerEvaluation, 'normalizedScore'> {
    try {
      const cleaned = raw.replace(/```json?\s*/g, '').trim();
      const obj = JSON.parse(cleaned) as Record<string, unknown>;
      const score = Math.min(MAX_SCORE, Math.max(0, Number(obj.score) ?? 0));
      const relevance = Math.min(MAX_SCORE, Math.max(0, Number(obj.relevance) ?? score));
      const structure = Math.min(MAX_SCORE, Math.max(0, Number(obj.structure) ?? score));
      const depth = Math.min(MAX_SCORE, Math.max(0, Number(obj.depth) ?? score));
      const redFlags = Array.isArray(obj.redFlags) ? (obj.redFlags as string[]) : [];
      const feedbackSnippet = typeof obj.feedbackSnippet === 'string' ? obj.feedbackSnippet : '';
      const compIds = Array.isArray(obj.competencyIds) ? (obj.competencyIds as string[]) : competencyIds;
      return {
        score,
        maxScore: MAX_SCORE,
        relevance,
        structure,
        depth,
        competencyIds: compIds,
        redFlags,
        feedbackSnippet,
      };
    } catch {
      return {
        score: 0,
        maxScore: MAX_SCORE,
        relevance: 0,
        structure: 0,
        depth: 0,
        competencyIds,
        redFlags: ['Could not parse evaluation'],
        feedbackSnippet: 'Evaluation unavailable.',
      };
    }
  }
}

export const evaluationEngine = new EvaluationEngine();
