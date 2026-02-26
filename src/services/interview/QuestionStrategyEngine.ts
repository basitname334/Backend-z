/**
 * Question Strategy Engine: role-based question selection, difficulty scaling,
 * follow-up logic, and topic coverage. Loads from question_templates (admin-added)
 * with fallback to in-memory demo bank.
 */

import type { InterviewState, InterviewPhase, InterviewRole, DifficultyLevel, QuestionTemplate, ScheduledCustomQuestion } from '../../types';
import { getQuestionTemplatesForStrategy } from '../questionTemplate.service';

export interface NextQuestionInput {
  state: InterviewState;
  requestFollowUp?: boolean;
  forceNextPhase?: boolean;
}

export interface NextQuestionResult {
  questionText: string;
  questionId: string;
  phase: InterviewPhase;
  difficulty: DifficultyLevel;
  competencyIds: string[];
  isFollowUp: boolean;
  /** When true, interviewer should show coding prompt / starter code */
  isCodingQuestion?: boolean;
  starterCode?: string | null;
  language?: string | null;
}

/** Fallback when no questions in DB. Exposed for evaluation engine. */
export const DEMO_QUESTIONS: QuestionTemplate[] = [
  { id: 'intro-1', role: 'technical', phase: 'intro', difficulty: 'easy', text: 'Hello! Thank you for joining today. Can you tell me a bit about your background and what drew you to this role?', competencyIds: ['communication'] },
  { id: 'tech-1', role: 'technical', phase: 'technical', difficulty: 'medium', text: 'Describe a technical challenge you recently solved. What was your approach and outcome?', competencyIds: ['problem_solving', 'technical_depth'] },
  { id: 'tech-2', role: 'technical', phase: 'technical', difficulty: 'medium', text: 'How do you balance shipping quickly with maintaining code quality?', competencyIds: ['technical_depth', 'judgment'] },
  { id: 'tech-follow', role: 'technical', phase: 'technical', difficulty: 'medium', text: 'Could you go into more detail about the trade-offs you considered?', competencyIds: ['technical_depth'], followUpPrompt: 'When answer is vague on trade-offs' },
  { id: 'beh-1', role: 'technical', phase: 'behavioral', difficulty: 'medium', text: 'Tell me about a time you had to collaborate with a difficult stakeholder. How did you handle it?', competencyIds: ['collaboration', 'communication'] },
  { id: 'wrap-1', role: 'technical', phase: 'wrap_up', difficulty: 'easy', text: 'Do you have any questions for us about the role or the team?', competencyIds: ['engagement'] },
];

function rowToTemplate(row: { id: string; role: string; phase: string; difficulty: string; text: string; competency_ids: string[]; follow_up_prompt?: string | null; is_coding_question?: boolean; starter_code?: string | null; language?: string | null }): QuestionTemplate {
  return {
    id: row.id,
    role: row.role as InterviewRole,
    phase: row.phase as InterviewPhase,
    difficulty: row.difficulty as DifficultyLevel,
    text: row.text,
    competencyIds: row.competency_ids ?? [],
    followUpPrompt: row.follow_up_prompt ?? undefined,
  };
}

export class QuestionStrategyEngine {
  private fallbackQuestionFor(role: InterviewRole, phase: InterviewPhase): NextQuestionResult {
    const roleLabel = role.replace(/_/g, ' ');
    const textByPhase: Record<InterviewPhase, string> = {
      intro: `Tell me a bit about your background and what interests you about this ${roleLabel} role.`,
      technical: 'Walk me through a recent challenge you faced and how you solved it.',
      behavioral: 'Tell me about a time you handled a difficult situation with a teammate or stakeholder.',
      wrap_up: 'Do you have any questions for me about the role or team?',
      coding: 'Please solve the following coding problem.',
    };
    return {
      questionText: textByPhase[phase],
      questionId: `fallback-${role}-${phase}`,
      phase,
      difficulty: phase === 'intro' || phase === 'wrap_up' ? 'easy' : 'medium',
      competencyIds: ['communication'],
      isFollowUp: false,
      isCodingQuestion: false,
      starterCode: null,
      language: null,
    };
  }

  private getPhaseOrder(): InterviewPhase[] {
    return ['intro', 'technical', 'behavioral', 'wrap_up', 'coding'];
  }

  private nextPhase(current: InterviewPhase): InterviewPhase | null {
    const order = this.getPhaseOrder();
    const i = order.indexOf(current);
    return i >= 0 && i < order.length - 1 ? order[i + 1] : null;
  }

  /** Load questions for role/phase from DB; fallback to DEMO_QUESTIONS. */
  private async getQuestionsForRoleAndPhase(role: InterviewRole, phase: InterviewPhase): Promise<QuestionTemplate[]> {
    try {
      const rows = await getQuestionTemplatesForStrategy(role, phase);
      if (rows.length > 0) return rows.map((r) => rowToTemplate(r));
    } catch (_) {}
    return DEMO_QUESTIONS.filter((q) => q.role === role && q.phase === phase);
  }

  async getNextQuestion(input: NextQuestionInput): Promise<NextQuestionResult | null> {
    const { state, requestFollowUp, forceNextPhase } = input;
    let phase = state.phase;
    const lastTurn = state.turns.length > 0 ? state.turns[state.turns.length - 1] : null;
    const lastQuestionId = lastTurn?.role === 'ai' ? lastTurn.questionId : null;

    if (phase === 'coding' && state.role !== 'technical') return null;

    if (forceNextPhase) {
      const next = this.nextPhase(phase);
      if (next) phase = next;
    }

    if (phase === 'technical' && state.customQuestions && state.customQuestions.length > 0) {
      const verbalOnly = state.customQuestions
        .filter((q) => !q.isCodingQuestion)
        .map((q, idx) => ({ id: `custom-${idx}`, ...q }))
        .filter((q) => !state.topicCoverage[q.id]);
      if (verbalOnly.length > 0) {
        const byDifficulty = verbalOnly.filter((q) => q.difficulty === state.currentDifficulty);
        const custom = (byDifficulty.length > 0 ? byDifficulty : verbalOnly)[0];
        return {
          questionText: custom.text,
          questionId: custom.id,
          phase,
          difficulty: custom.difficulty,
          competencyIds: ['communication', 'technical_depth'],
          isFollowUp: false,
          isCodingQuestion: false,
          starterCode: null,
          language: null,
        };
      }
    }

    if (phase === 'coding' && state.role === 'technical') {
      const codingQuestions = (state.customQuestions ?? []).filter((q) => q.isCodingQuestion);
      const defaultCoding: ScheduledCustomQuestion[] = [
        { text: 'Implement a function that reverses a string. Handle empty and single-character strings.', difficulty: 'easy', isCodingQuestion: true, language: 'javascript', starterCode: 'function reverseString(str) {\n  // your code here\n  return str;\n}' },
        { text: 'Write a function that checks if a string is a palindrome. Ignore case and non-alphanumeric characters.', difficulty: 'medium', isCodingQuestion: true, language: 'javascript', starterCode: 'function isPalindrome(str) {\n  // your code here\n  return false;\n}' },
        { text: 'Given an array of numbers, return the two indices whose values sum to a target. Assume exactly one solution exists.', difficulty: 'medium', isCodingQuestion: true, language: 'javascript', starterCode: 'function twoSum(nums, target) {\n  // your code here\n  return [];\n}' },
      ];
      const pool = codingQuestions.length >= 3 ? codingQuestions.slice(0, 3) : defaultCoding;
      const CODE_FOLLOW_UPS = [
        'What is the time complexity of your solution? Can you explain your approach?',
        'How would you test this solution? What edge cases did you consider?',
        'How would you improve or refactor this code for production?',
      ];
      const slotOrder = ['coding-0', 'coding-0-follow', 'coding-1', 'coding-1-follow', 'coding-2', 'coding-2-follow'];
      for (let i = 0; i < slotOrder.length; i++) {
        const slot = slotOrder[i];
        if (state.topicCoverage[slot]) continue;
        const isFollowUp = slot.endsWith('-follow');
        const problemIndex = isFollowUp ? parseInt(slot.replace('coding-', '').replace('-follow', ''), 10) : parseInt(slot.replace('coding-', ''), 10);
        if (isFollowUp) {
          return {
            questionText: CODE_FOLLOW_UPS[problemIndex] ?? CODE_FOLLOW_UPS[0],
            questionId: slot,
            phase: 'coding',
            difficulty: state.currentDifficulty,
            competencyIds: ['technical_depth', 'problem_solving'],
            isFollowUp: true,
            isCodingQuestion: false,
            starterCode: null,
            language: null,
          };
        }
        const problem = pool[problemIndex];
        if (!problem) continue;
        const isFirstCoding = problemIndex === 0 && !state.topicCoverage['coding-0'];
        const questionText = isFirstCoding
          ? `Great, we're done with the verbal part. Please switch to the **Code** tab—you'll have 3 problems to solve. Here's the first one:\n\n${problem.text}`
          : problem.text;
        return {
          questionText,
          questionId: slot,
          phase: 'coding',
          difficulty: problem.difficulty,
          competencyIds: ['technical_depth', 'problem_solving'],
          isFollowUp: false,
          isCodingQuestion: true,
          starterCode: problem.starterCode ?? null,
          language: problem.language ?? null,
        };
      }
    }

    const candidates = await this.getQuestionsForRoleAndPhase(state.role, phase);
    if (candidates.length === 0) {
      return this.fallbackQuestionFor(state.role, phase);
    }
    const allForFollowUp = [...candidates, ...DEMO_QUESTIONS.filter((q) => q.role === state.role)];

    if (requestFollowUp && lastQuestionId) {
      const lastQ = allForFollowUp.find((q) => q.id === lastQuestionId || lastQuestionId === q.id + '-follow');
      if (lastQ?.followUpPrompt) {
        return {
          questionText: lastQ.text,
          questionId: (lastQ.id.replace(/-follow$/, '') || lastQ.id) + '-follow',
          phase,
          difficulty: lastQ.difficulty,
          competencyIds: lastQ.competencyIds,
          isFollowUp: true,
        };
      }
    }

    const uncovered = candidates.filter((q) => !state.topicCoverage[q.id]);
    const pool = uncovered.length > 0 ? uncovered : candidates;
    const byDifficulty = pool.filter((q) => q.difficulty === state.currentDifficulty);
    const choice = (byDifficulty.length > 0 ? byDifficulty : pool)[0];
    if (!choice) {
      const nextPh = this.nextPhase(phase);
      if (nextPh) return this.getNextQuestion({ ...input, state: { ...state, phase: nextPh }, forceNextPhase: false });
      return this.fallbackQuestionFor(state.role, phase);
    }

    const row = await getQuestionTemplatesForStrategy(state.role, phase).then((rows) => rows.find((r) => r.id === choice.id)).catch(() => null);
    return {
      questionText: choice.text,
      questionId: choice.id,
      phase,
      difficulty: choice.difficulty,
      competencyIds: choice.competencyIds,
      isFollowUp: false,
      isCodingQuestion: row?.is_coding_question ?? false,
      starterCode: row?.starter_code ?? null,
      language: row?.language ?? null,
    };
  }

  getCompetencyIdsForQuestionId(questionId: string, role?: InterviewRole): string[] {
    if (questionId.startsWith('coding-')) return ['technical_depth', 'problem_solving'];
    const baseId = questionId.replace(/-follow$/, '');
    const q = DEMO_QUESTIONS.find((x) => x.id === baseId);
    if (q) return q.competencyIds;
    return ['communication'];
  }

  async getFirstQuestion(role: InterviewRole): Promise<NextQuestionResult | null> {
    const introList = await this.getQuestionsForRoleAndPhase(role, 'intro');
    const intro = introList[0];
    if (!intro) return this.fallbackQuestionFor(role, 'intro');
    const rows = await getQuestionTemplatesForStrategy(role, 'intro').catch(() => []);
    const row = rows.find((r) => r.id === intro.id);
    return {
      questionText: intro.text,
      questionId: intro.id,
      phase: 'intro',
      difficulty: 'easy',
      competencyIds: intro.competencyIds,
      isFollowUp: false,
      isCodingQuestion: row?.is_coding_question ?? false,
      starterCode: row?.starter_code ?? null,
      language: row?.language ?? null,
    };
  }
}

export const questionStrategyEngine = new QuestionStrategyEngine();
