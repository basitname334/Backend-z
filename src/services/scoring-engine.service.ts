import { logger } from '../config/logger';
import { llmService } from './llm.service';

interface QuestionScore {
    questionId: string;
    question: string;
    answer: string;
    communicationScore: number;
    technicalScore: number;
    relevanceScore: number;
    confidenceScore: number;
    structuredThinkingScore: number;
    feedback: string;
    strengths: string[];
    improvements: string[];
}

interface OverallScore {
    communicationScore: number;
    technicalScore: number;
    relevanceScore: number;
    confidenceScore: number;
    structuredThinkingScore: number;
    overallScore: number;
    feedback: string;
    questionScores: QuestionScore[];
}

/**
 * Scoring Engine Service
 * Evaluates candidate responses and provides detailed feedback
 */
export class ScoringEngineService {
    /**
     * Score a single answer
     */
    async scoreAnswer(
        question: string,
        answer: string
    ): Promise<QuestionScore> {
        try {
            // Use LLM to evaluate the answer
            const evaluation = await llmService.evaluateAnswer(question, answer);

            // Calculate individual scores based on evaluation
            const communicationScore = this.evaluateCommunication(answer);
            const technicalScore = evaluation.score;
            const relevanceScore = this.evaluateRelevance(question, answer);
            const confidenceScore = this.evaluateConfidence(answer);
            const structuredThinkingScore = this.evaluateStructure(answer);

            return {
                questionId: `q_${Date.now()}`,
                question,
                answer,
                communicationScore,
                technicalScore,
                relevanceScore,
                confidenceScore,
                structuredThinkingScore,
                feedback: evaluation.feedback,
                strengths: evaluation.strengths,
                improvements: evaluation.improvements,
            };
        } catch (error) {
            logger.error('Failed to score answer', { error, question });
            throw error;
        }
    }

    /**
     * Calculate overall interview score
     */
    async calculateOverallScore(
        questionScores: QuestionScore[],
        transcript: Array<{ speaker: string; text: string }>
    ): Promise<OverallScore> {
        try {
            // Calculate average scores
            const avgCommunication = this.average(
                questionScores.map((s) => s.communicationScore)
            );
            const avgTechnical = this.average(
                questionScores.map((s) => s.technicalScore)
            );
            const avgRelevance = this.average(
                questionScores.map((s) => s.relevanceScore)
            );
            const avgConfidence = this.average(
                questionScores.map((s) => s.confidenceScore)
            );
            const avgStructuredThinking = this.average(
                questionScores.map((s) => s.structuredThinkingScore)
            );

            // Calculate weighted overall score
            const overallScore = Math.round(
                avgCommunication * 0.2 +
                avgTechnical * 0.3 +
                avgRelevance * 0.2 +
                avgConfidence * 0.15 +
                avgStructuredThinking * 0.15
            );

            // Generate comprehensive feedback using LLM
            const feedback = await llmService.generateInterviewSummary(
                transcript,
                {
                    communicationScore: avgCommunication,
                    technicalScore: avgTechnical,
                    relevanceScore: avgRelevance,
                    confidenceScore: avgConfidence,
                    structuredThinkingScore: avgStructuredThinking,
                    overallScore,
                }
            );

            return {
                communicationScore: avgCommunication,
                technicalScore: avgTechnical,
                relevanceScore: avgRelevance,
                confidenceScore: avgConfidence,
                structuredThinkingScore: avgStructuredThinking,
                overallScore,
                feedback,
                questionScores,
            };
        } catch (error) {
            logger.error('Failed to calculate overall score', { error });
            throw error;
        }
    }

    /**
     * Evaluate communication clarity (0-100)
     */
    private evaluateCommunication(answer: string): number {
        let score = 50; // Base score

        // Check for filler words
        const fillerWords = ['um', 'uh', 'like', 'you know', 'basically', 'actually'];
        const fillerCount = fillerWords.reduce((count, word) => {
            const regex = new RegExp(`\\b${word}\\b`, 'gi');
            return count + (answer.match(regex) || []).length;
        }, 0);

        // Penalize excessive fillers
        score -= Math.min(fillerCount * 5, 30);

        // Check sentence structure (presence of periods/proper sentences)
        const sentences = answer.split(/[.!?]+/).filter(s => s.trim().length > 0);
        if (sentences.length > 0) {
            score += Math.min(sentences.length * 5, 20);
        }

        // Check word count (not too short, not too verbose)
        const wordCount = answer.split(/\s+/).length;
        if (wordCount >= 20 && wordCount <= 200) {
            score += 20;
        } else if (wordCount < 10) {
            score -= 20;
        }

        // Check for complete thoughts (presence of conjunctions)
        const conjunctions = ['and', 'but', 'because', 'however', 'therefore'];
        const hasConjunctions = conjunctions.some(word =>
            answer.toLowerCase().includes(word)
        );
        if (hasConjunctions) {
            score += 10;
        }

        return Math.max(0, Math.min(100, score));
    }

    /**
     * Evaluate answer relevance to question (0-100)
     */
    private evaluateRelevance(question: string, answer: string): number {
        let score = 50; // Base score

        // Extract key terms from question
        const questionWords = question
            .toLowerCase()
            .split(/\s+/)
            .filter(word => word.length > 4); // Focus on meaningful words

        // Check how many question terms appear in answer
        const answerLower = answer.toLowerCase();
        const matchedTerms = questionWords.filter(word =>
            answerLower.includes(word)
        );

        const relevanceRatio = matchedTerms.length / Math.max(questionWords.length, 1);
        score += relevanceRatio * 30;

        // Check if answer is too short (likely not relevant)
        const wordCount = answer.split(/\s+/).length;
        if (wordCount < 10) {
            score -= 30;
        }

        // Check if answer directly addresses the question
        const directIndicators = ['yes', 'no', 'i think', 'in my opinion', 'i believe'];
        const hasDirectResponse = directIndicators.some(phrase =>
            answerLower.includes(phrase)
        );
        if (hasDirectResponse) {
            score += 20;
        }

        return Math.max(0, Math.min(100, score));
    }

    /**
     * Evaluate confidence level (0-100)
     * Based on text-based sentiment analysis
     */
    private evaluateConfidence(answer: string): number {
        let score = 50; // Base score

        const answerLower = answer.toLowerCase();

        // Confident phrases
        const confidentPhrases = [
            'i am confident',
            'definitely',
            'certainly',
            'absolutely',
            'i know',
            'i have experience',
            'i successfully',
        ];

        // Uncertain phrases
        const uncertainPhrases = [
            'i think',
            'maybe',
            'perhaps',
            'i guess',
            'not sure',
            'i don\'t know',
            'probably',
            'might',
        ];

        // Count confident phrases
        const confidentCount = confidentPhrases.reduce((count, phrase) => {
            return count + (answerLower.includes(phrase) ? 1 : 0);
        }, 0);

        // Count uncertain phrases
        const uncertainCount = uncertainPhrases.reduce((count, phrase) => {
            return count + (answerLower.includes(phrase) ? 1 : 0);
        }, 0);

        score += confidentCount * 15;
        score -= uncertainCount * 10;

        // Check for specific examples (indicates confidence)
        const hasExamples = /for example|for instance|such as|like when/i.test(answer);
        if (hasExamples) {
            score += 15;
        }

        // Check for hedging language
        const hedgingWords = ['kind of', 'sort of', 'somewhat', 'a bit'];
        const hedgingCount = hedgingWords.reduce((count, word) => {
            return count + (answerLower.includes(word) ? 1 : 0);
        }, 0);
        score -= hedgingCount * 5;

        return Math.max(0, Math.min(100, score));
    }

    /**
     * Evaluate structured thinking (0-100)
     */
    private evaluateStructure(answer: string): number {
        let score = 50; // Base score

        const answerLower = answer.toLowerCase();

        // Check for structured approach indicators
        const structureIndicators = [
            'first',
            'second',
            'third',
            'finally',
            'to begin with',
            'next',
            'then',
            'in conclusion',
            'step 1',
            'step 2',
        ];

        const structureCount = structureIndicators.reduce((count, indicator) => {
            return count + (answerLower.includes(indicator) ? 1 : 0);
        }, 0);

        score += Math.min(structureCount * 15, 30);

        // Check for logical connectors
        const logicalConnectors = [
            'because',
            'therefore',
            'however',
            'although',
            'consequently',
            'as a result',
            'due to',
        ];

        const connectorCount = logicalConnectors.reduce((count, connector) => {
            return count + (answerLower.includes(connector) ? 1 : 0);
        }, 0);

        score += Math.min(connectorCount * 10, 20);

        // Check for problem-solution structure
        const hasProblemSolution =
            (answerLower.includes('problem') || answerLower.includes('challenge')) &&
            (answerLower.includes('solution') || answerLower.includes('solved'));

        if (hasProblemSolution) {
            score += 15;
        }

        // Check for clear paragraphs/sections (multiple sentences)
        const sentences = answer.split(/[.!?]+/).filter(s => s.trim().length > 0);
        if (sentences.length >= 3) {
            score += 15;
        }

        return Math.max(0, Math.min(100, score));
    }

    /**
     * Calculate average of an array of numbers
     */
    private average(numbers: number[]): number {
        if (numbers.length === 0) return 0;
        const sum = numbers.reduce((acc, num) => acc + num, 0);
        return Math.round(sum / numbers.length);
    }
}

export const scoringEngineService = new ScoringEngineService();
