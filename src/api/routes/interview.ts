/**
 * Interview lifecycle API: start, submit answer, get state, end, and report.
 * POST /interview/start, POST /interview/:id/answer, GET /interview/:id/state,
 * POST /interview/:id/end, GET /report/:interviewId
 */

import { Router, Request, Response } from 'express';
import { body, param } from 'express-validator';
import { interviewSessionService } from '../../services/interview/InterviewSessionService';
import { aiInterviewerOrchestrator } from '../../services/interview/AIInterviewerOrchestrator';
import { query } from '../../db/client';
import { validate } from '../middleware/validate';

const router = Router();

/** POST /interview/start - Create and start a new interview session */
router.post(
  '/start',
  validate([
    body('candidateId').isUUID().withMessage('candidateId must be a UUID'),
    body('role').isIn(['technical', 'behavioral', 'sales', 'customer_success']).withMessage('Invalid role'),
    body('positionId').optional().isUUID(),
  ]),
  async (req: Request, res: Response) => {
    try {
      const { candidateId, role, positionId } = req.body;
      let ensuredCandidateId = candidateId as string;
      const existing = await query<{ id: string }>(
        `SELECT id FROM candidates WHERE id = $1 LIMIT 1`,
        [candidateId]
      );
      if (existing.rows.length === 0) {
        const inserted = await query<{ id: string }>(
          `INSERT INTO candidates (id, email, name, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           RETURNING id`,
          [
            candidateId,
            `candidate+${String(candidateId).replace(/-/g, '')}@example.local`,
            'Interview Candidate',
          ]
        );
        ensuredCandidateId = inserted.rows[0].id;
      }

      const result = await interviewSessionService.start({ candidateId: ensuredCandidateId, role, positionId });
      const firstReply = await aiInterviewerOrchestrator.getNextReply({
        interviewId: result.interviewId,
      });
      if (!firstReply.success) {
        return res.status(500).json({ error: 'Failed to generate first interview question' });
      }
      res.status(201).json({
        interviewId: result.interviewId,
        state: firstReply.state ?? result.state,
        firstReply: firstReply.reply,
      });
    } catch (e) {
      console.error('Interview start error', e);
      res.status(500).json({ error: 'Failed to start interview' });
    }
  }
);

/** POST /interview/:id/answer - Submit candidate answer and get next AI reply */
router.post(
  '/:id/answer',
  validate([param('id').isUUID(), body('answerText').isString().notEmpty().trim()]),
  async (req: Request, res: Response) => {
    try {
      const interviewId = req.params.id;
      const { answerText } = req.body;
      const result = await aiInterviewerOrchestrator.submitAnswer({
        interviewId,
        answerText: String(answerText).trim(),
      });
      if (!result.success) {
        if (result.failureReason === 'session_not_found') {
          return res.status(404).json({
            error: 'Interview session not found or expired. Please refresh the page or use your original link to start again.',
            code: 'SESSION_NOT_FOUND',
          });
        }
        return res.status(400).json({
          error: 'No question is currently waiting for an answer. You may have already submitted, or the session is out of sync. Try refreshing the page.',
          code: 'NO_PENDING_QUESTION',
        });
      }
      res.json({
        state: result.state,
        nextReply: result.nextReply,
        evaluation: result.evaluation,
        report: result.report,
      });
    } catch (e) {
      console.error('Submit answer error', e);
      res.status(500).json({ error: 'Failed to submit answer' });
    }
  }
);

/** GET /interview/:id/state - Get current interview state (Redis) */
router.get('/:id/state', validate([param('id').isUUID()]), async (req: Request, res: Response) => {
  try {
    const state = await interviewSessionService.getState(req.params.id);
    if (!state) {
      return res.status(404).json({ error: 'Interview not found or session expired' });
    }
    res.json(state);
  } catch (e) {
    console.error('Get state error', e);
    res.status(500).json({ error: 'Failed to get state' });
  }
});

/** POST /interview/:id/end - End interview and optionally generate report */
router.post('/:id/end', validate([param('id').isUUID()]), async (req: Request, res: Response) => {
  try {
    const interviewId = req.params.id;
    const state = await interviewSessionService.getState(interviewId);
    let report = null;
    if (state) {
      report = (await aiInterviewerOrchestrator.getReport(interviewId)) ?? undefined;
    }
    await interviewSessionService.end(interviewId, report ?? undefined);
    await query(
      `UPDATE scheduled_interviews SET status = 'completed', updated_at = NOW() WHERE interview_id = $1`,
      [interviewId]
    );
    res.json({ ended: true, report });
  } catch (e) {
    console.error('End interview error', e);
    res.status(500).json({ error: 'Failed to end interview' });
  }
});

export const interviewRoutes = router;
