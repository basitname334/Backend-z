import { Router } from 'express';
import { logger } from '../../config/logger';
import { interviewEngineService } from '../../services/interview-engine.service';

const router = Router();

/**
 * Get interview session status
 */
router.get('/session/:sessionId/status', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = interviewEngineService.getSession(sessionId);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        res.json({
            sessionId: session.id,
            category: session.category,
            status: session.status,
            questionCount: session.questions.length,
            answerCount: session.answers.length,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
        });
    } catch (error) {
        logger.error('Failed to get session status', { error, sessionId: req.params.sessionId });
        res.status(500).json({ error: 'Failed to get session status' });
    }
});

/**
 * Get interview transcript
 */
router.get('/session/:sessionId/transcript', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = interviewEngineService.getSession(sessionId);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const transcript = session.questions.map((q, i) => {
            const answer = session.answers.find((a) => a.questionId === q.id);
            return {
                question: {
                    id: q.id,
                    text: q.text,
                    difficulty: q.difficulty,
                    askedAt: q.askedAt,
                },
                answer: answer
                    ? {
                        text: answer.text,
                        answeredAt: answer.answeredAt,
                        duration: answer.duration,
                    }
                    : null,
            };
        });

        res.json({
            sessionId,
            category: session.category,
            transcript,
        });
    } catch (error) {
        logger.error('Failed to get transcript', { error, sessionId: req.params.sessionId });
        res.status(500).json({ error: 'Failed to get transcript' });
    }
});

/**
 * End interview session manually
 */
router.post('/session/:sessionId/end', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const feedback = await interviewEngineService.endInterview(sessionId);

        res.json({
            success: true,
            sessionId,
            feedback,
        });
    } catch (error) {
        logger.error('Failed to end interview', { error, sessionId: req.params.sessionId });
        res.status(500).json({ error: 'Failed to end interview' });
    }
});

export const voiceInterviewRoutes = router;
