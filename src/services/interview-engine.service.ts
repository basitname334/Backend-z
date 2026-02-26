import { logger } from '../config/logger';
import { llmService } from './llm.service';

interface Question {
    id: string;
    text: string;
    category: string;
    difficulty: 'easy' | 'medium' | 'hard';
    askedAt: Date;
}

interface Answer {
    questionId: string;
    text: string;
    answeredAt: Date;
    duration: number;
}

interface InterviewSession {
    id: string;
    category: string;
    currentQuestion: Question | null;
    questions: Question[];
    answers: Answer[];
    startedAt: Date;
    endedAt?: Date;
    status: 'active' | 'completed' | 'timeout';
    context?: number[];
}

/**
 * Interview Engine Service
 * Manages interview flow, question progression, and session state
 */
export class InterviewEngineService {
    private sessions: Map<string, InterviewSession> = new Map();
    private minQuestions: number;
    private maxQuestions: number;
    private maxDuration: number;
    private maxSilence: number;

    constructor() {
        this.minQuestions = parseInt(process.env.INTERVIEW_MIN_QUESTIONS || '5');
        this.maxQuestions = parseInt(process.env.INTERVIEW_MAX_QUESTIONS || '15');
        this.maxDuration = parseInt(process.env.INTERVIEW_MAX_DURATION || '1800'); // 30 minutes
        this.maxSilence = parseInt(process.env.INTERVIEW_MAX_SILENCE || '30'); // 30 seconds
    }

    /**
     * Start a new interview session
     */
    async startInterview(
        sessionId: string,
        category: string = 'Technical'
    ): Promise<{ greeting: string; firstQuestion: string }> {
        try {
            const session: InterviewSession = {
                id: sessionId,
                category,
                currentQuestion: null,
                questions: [],
                answers: [],
                startedAt: new Date(),
                status: 'active',
            };

            this.sessions.set(sessionId, session);

            // Generate greeting
            const greeting = this.generateGreeting(category);

            // Generate first question (easy difficulty)
            const firstQuestion = await this.getNextQuestion(sessionId, 'easy');

            logger.info('Interview started', { sessionId, category });

            return { greeting, firstQuestion };
        } catch (error) {
            logger.error('Failed to start interview', { error, sessionId });
            throw error;
        }
    }

    /**
     * Get next question based on interview progression
     */
    async getNextQuestion(
        sessionId: string,
        forceDifficulty?: 'easy' | 'medium' | 'hard'
    ): Promise<string> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('Interview session not found');
        }

        // Determine difficulty based on progression
        const difficulty = forceDifficulty || this.determineDifficulty(session);

        // Get previous answers for context
        const previousAnswers = session.answers.map((a) => a.text);

        // Generate question using LLM
        const questionText = await llmService.generateInterviewQuestion(
            session.category,
            difficulty,
            previousAnswers,
            session.context
        );

        // Create question object
        const question: Question = {
            id: `q_${Date.now()}`,
            text: questionText,
            category: session.category,
            difficulty,
            askedAt: new Date(),
        };

        session.currentQuestion = question;
        session.questions.push(question);

        logger.info('Generated question', {
            sessionId,
            difficulty,
            questionNumber: session.questions.length,
        });

        return questionText;
    }

    /**
     * Process candidate's answer
     */
    async processAnswer(
        sessionId: string,
        answerText: string,
        duration: number
    ): Promise<{
        feedback?: string;
        nextQuestion?: string;
        followUp?: string;
        shouldEnd: boolean;
    }> {
        const session = this.sessions.get(sessionId);
        if (!session || !session.currentQuestion) {
            throw new Error('No active question for this session');
        }

        // Store the answer
        const answer: Answer = {
            questionId: session.currentQuestion.id,
            text: answerText,
            answeredAt: new Date(),
            duration,
        };

        session.answers.push(answer);

        // Check if we should end the interview
        const shouldEnd = this.shouldEndInterview(session);

        if (shouldEnd) {
            session.status = 'completed';
            session.endedAt = new Date();

            const feedback = await this.generateFinalFeedback(session);

            logger.info('Interview completed', {
                sessionId,
                totalQuestions: session.questions.length,
                duration: (session.endedAt.getTime() - session.startedAt.getTime()) / 1000,
            });

            return { feedback, shouldEnd: true };
        }

        // Decide: follow-up or next question
        const shouldFollowUp = this.shouldAskFollowUp(answerText, session);

        if (shouldFollowUp) {
            const followUp = await llmService.generateFollowUpQuestion(
                session.currentQuestion.text,
                answerText,
                session.context
            );

            return { followUp, shouldEnd: false };
        } else {
            const nextQuestion = await this.getNextQuestion(sessionId);
            return { nextQuestion, shouldEnd: false };
        }
    }

    /**
     * Handle silence timeout
     */
    handleSilenceTimeout(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.status = 'timeout';
            session.endedAt = new Date();
            logger.warn('Interview timed out due to silence', { sessionId });
        }
    }

    /**
     * Get interview session
     */
    getSession(sessionId: string): InterviewSession | undefined {
        return this.sessions.get(sessionId);
    }

    /**
     * End interview manually
     */
    async endInterview(sessionId: string): Promise<string> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('Interview session not found');
        }

        session.status = 'completed';
        session.endedAt = new Date();

        const feedback = await this.generateFinalFeedback(session);

        logger.info('Interview ended manually', { sessionId });

        return feedback;
    }

    /**
     * Determine difficulty based on progression
     */
    private determineDifficulty(
        session: InterviewSession
    ): 'easy' | 'medium' | 'hard' {
        const questionCount = session.questions.length;

        if (questionCount < 2) {
            return 'easy';
        } else if (questionCount < 5) {
            return 'medium';
        } else {
            return 'hard';
        }
    }

    /**
     * Decide if we should ask a follow-up question
     */
    private shouldAskFollowUp(answerText: string, session: InterviewSession): boolean {
        // Simple heuristic: ask follow-up if answer is short or vague
        const wordCount = answerText.split(/\s+/).length;

        // Don't ask follow-up if we've asked too many questions
        if (session.questions.length >= this.maxQuestions - 1) {
            return false;
        }

        // Ask follow-up if answer is too short (< 20 words)
        if (wordCount < 20) {
            return true;
        }

        // 30% chance of follow-up for medium-length answers
        if (wordCount < 50 && Math.random() < 0.3) {
            return true;
        }

        return false;
    }

    /**
     * Check if interview should end
     */
    private shouldEndInterview(session: InterviewSession): boolean {
        const questionCount = session.questions.length;
        const duration = (Date.now() - session.startedAt.getTime()) / 1000;

        // End if max questions reached
        if (questionCount >= this.maxQuestions) {
            return true;
        }

        // End if max duration exceeded and min questions met
        if (duration >= this.maxDuration && questionCount >= this.minQuestions) {
            return true;
        }

        return false;
    }

    /**
     * Generate greeting message
     */
    private generateGreeting(category: string): string {
        return `Hello! Welcome to your ${category} interview. I'm your AI interviewer today. I'll be asking you a series of questions to assess your skills and experience. Please answer naturally and take your time. Let's begin!`;
    }

    /**
     * Generate final feedback
     */
    private async generateFinalFeedback(session: InterviewSession): Promise<string> {
        const transcript = session.questions.map((q, i) => {
            const answer = session.answers.find((a) => a.questionId === q.id);
            return {
                speaker: 'AI',
                text: q.text,
            };
        });

        // Add answers to transcript
        session.answers.forEach((a) => {
            transcript.push({
                speaker: 'Candidate',
                text: a.text,
            });
        });

        // For now, return a simple feedback message
        // In production, this would use the scoring engine
        return `Thank you for completing the interview! You answered ${session.questions.length} questions. Your responses will be evaluated and you'll receive detailed feedback shortly.`;
    }

    /**
     * Cleanup old sessions
     */
    cleanupOldSessions(maxAge: number = 3600000): void {
        const now = Date.now();
        for (const [sessionId, session] of this.sessions.entries()) {
            const age = now - session.startedAt.getTime();
            if (age > maxAge) {
                this.sessions.delete(sessionId);
                logger.info('Cleaned up old session', { sessionId, age });
            }
        }
    }
}

export const interviewEngineService = new InterviewEngineService();
