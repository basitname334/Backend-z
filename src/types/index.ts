/**
 * Shared domain types for the AI Interviewer platform.
 * Keeps API, services, and queues aligned on the same shapes.
 */

export type InterviewPhase = 'intro' | 'technical' | 'behavioral' | 'wrap_up' | 'coding';

export type InterviewRole = 'technical' | 'behavioral' | 'sales' | 'customer_success';

export type DifficultyLevel = 'easy' | 'medium' | 'hard';

export interface ScheduledCustomQuestion {
  text: string;
  difficulty: DifficultyLevel;
  isCodingQuestion?: boolean;
  language?: string | null;
  starterCode?: string | null;
}

export interface CandidateInfo {
  candidateId: string;
  role: InterviewRole;
  /** Optional job/position id for role-specific questions */
  positionId?: string;
}

export interface Turn {
  id: string;
  role: 'ai' | 'candidate';
  content: string;
  timestamp: string;
  /** For AI turns: question id if applicable */
  questionId?: string;
  /** For candidate turns: evaluation result when available */
  evaluation?: AnswerEvaluation;
  /** For AI turns: when question is a coding question, show code editor with this */
  codingStarterCode?: string | null;
  codingLanguage?: string | null;
  isCodingQuestion?: boolean;
}

export interface AnswerEvaluation {
  score: number;
  maxScore: number;
  relevance: number;
  structure: number;
  depth: number;
  competencyIds: string[];
  redFlags: string[];
  feedbackSnippet: string;
  /** Normalized 0-1 for aggregation */
  normalizedScore: number;
}

export interface InterviewState {
  interviewId: string;
  candidateId: string;
  /** Parsed candidate resume/profile summary to personalize interview questions */
  resumeContext?: string;
  role: InterviewRole;
  phase: InterviewPhase;
  startedAt: string;
  endedAt?: string;
  turns: Turn[];
  /** Tracks which topics have been covered for adaptive questioning */
  topicCoverage: Record<string, boolean>;
  /** Current question index / difficulty for strategy */
  currentDifficulty: DifficultyLevel;
  /** Recruiter-selected target difficulty for this scheduled interview */
  preferredDifficulty?: DifficultyLevel;
  /** Recruiter-supplied questions to prioritize during interview */
  customQuestions?: ScheduledCustomQuestion[];
  /** Recruiter-specified focus areas / subject (e.g. backend, APIs) used in interview */
  focusAreas?: string;
  /** Recruiter-specified duration in minutes */
  durationMinutes?: number;
  /** Token budget used (approximate) for context window management */
  approximateTokens: number;
}

export interface ReportCompetency {
  competencyId: string;
  name: string;
  score: number;
  maxScore: number;
  evidence: string[];
}

export interface InterviewReport {
  interviewId: string;
  candidateId: string;
  role: InterviewRole;
  startedAt: string;
  endedAt: string;
  overallScore: number;
  maxScore: number;
  recommendation: 'strong_hire' | 'hire' | 'no_hire' | 'borderline';
  summary: string;
  competencies: ReportCompetency[];
  redFlags: string[];
  strengths: string[];
  improvements: string[];
  /** Full Q&A for recruiter review */
  questionAnswerSummary: { question: string; answer: string; score: number }[];
}

export interface QuestionTemplate {
  id: string;
  role: InterviewRole;
  phase: InterviewPhase;
  difficulty: DifficultyLevel;
  text: string;
  competencyIds: string[];
  followUpPrompt?: string;
}
