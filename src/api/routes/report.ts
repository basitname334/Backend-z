/**
 * GET /report/:interviewId - Fetch recruiter report. Tries Redis-backed state
 * first for live report, then falls back to persisted reports table.
 */

import { Router, Request, Response } from 'express';
import { param } from 'express-validator';
import type { InterviewReport } from '../../types';
import { aiInterviewerOrchestrator } from '../../services/interview/AIInterviewerOrchestrator';
import { query } from '../../db/client';
import { validate } from '../middleware/validate';

const router = Router();

interface ReportRow {
  interview_id: string;
  overall_score: string;
  max_score: string;
  recommendation: string;
  summary: string;
  red_flags: unknown;
  strengths: unknown;
  improvements: unknown;
  competencies: unknown;
  question_answer_summary: unknown;
}

router.get('/:interviewId', validate([param('interviewId').isUUID()]), async (req: Request, res: Response) => {
  try {
    const interviewId = req.params.interviewId;
    let report = await aiInterviewerOrchestrator.getReport(interviewId);
    if (!report) {
      const { rows } = await query<ReportRow>(
        `SELECT interview_id, overall_score, max_score, recommendation, summary,
                red_flags, strengths, improvements, competencies, question_answer_summary
         FROM reports WHERE interview_id = $1`,
        [interviewId]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Report not found for this interview' });
      }
      const r = rows[0];
      report = {
        interviewId: r.interview_id,
        candidateId: '', // not stored in reports; join with interviews if needed
        role: 'technical',
        startedAt: '',
        endedAt: '',
        overallScore: Number(r.overall_score),
        maxScore: Number(r.max_score),
        recommendation: r.recommendation as InterviewReport['recommendation'],
        summary: r.summary,
        competencies: (r.competencies as InterviewReport['competencies']) ?? [],
        redFlags: (r.red_flags as string[]) ?? [],
        strengths: (r.strengths as string[]) ?? [],
        improvements: (r.improvements as string[]) ?? [],
        questionAnswerSummary: (r.question_answer_summary as InterviewReport['questionAnswerSummary']) ?? [],
      };
    }
    res.json(report);
  } catch (e) {
    console.error('Get report error', e);
    res.status(500).json({ error: 'Failed to get report' });
  }
});

export const reportRoutes = router;
