/**
 * Public join by token: candidate opens link, sees schedule info, starts interview.
 * No auth required. Start creates/finds candidate and starts session.
 */

import { Router, Request, Response } from 'express';
import { param } from 'express-validator';
import { query } from '../../db/client';
import { interviewSessionService } from '../../services/interview/InterviewSessionService';
import { aiInterviewerOrchestrator } from '../../services/interview/AIInterviewerOrchestrator';
import { validate } from '../middleware/validate';
import { buildResumeContext } from '../../services/interview/ResumeContextService';
import type { DifficultyLevel, ScheduledCustomQuestion } from '../../types';

const router = Router();

/** GET /public/join/:token - Get schedule info for join page (no auth) */
router.get(
  '/:token',
  validate([param('token').isString().notEmpty().isLength({ min: 10 })]),
  async (req: Request, res: Response) => {
    const token = req.params.token;
    const { rows } = await query(
      `SELECT id, candidate_email, candidate_name, role, scheduled_at, status, interview_id
       FROM scheduled_interviews WHERE join_token = $1`,
      [token]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or expired link' });
    }
    const row = rows[0] as {
      id: string;
      candidate_email: string;
      candidate_name: string | null;
      role: string;
      scheduled_at: string;
      status: string;
      interview_id: string | null;
    };
    if (row.status === 'cancelled') {
      return res.status(410).json({ error: 'This interview was cancelled' });
    }
    if (row.interview_id && row.status === 'completed') {
      return res.json({
        ...row,
        alreadyCompleted: true,
        interviewId: row.interview_id,
      });
    }
    res.json({
      id: row.id,
      candidateEmail: row.candidate_email,
      candidateName: row.candidate_name,
      role: row.role,
      scheduledAt: row.scheduled_at,
      status: row.status,
      alreadyCompleted: false,
      interviewId: row.interview_id,
    });
  }
);

/** POST /public/join/:token/start - Start interview (create candidate if needed, return interviewId + firstReply) */
router.post(
  '/:token/start',
  validate([param('token').isString().notEmpty().isLength({ min: 10 })]),
  async (req: Request, res: Response) => {
    const token = req.params.token;
    const { rows } = await query(
      `SELECT id, candidate_email, candidate_name, role, preferred_difficulty, custom_questions, focus_areas, duration_minutes, position_id, application_id, resume_url, status, interview_id
       FROM scheduled_interviews WHERE join_token = $1`,
      [token]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or expired link' });
    }
    const row = rows[0] as {
      id: string;
      candidate_email: string;
      candidate_name: string | null;
      role: string;
      preferred_difficulty: DifficultyLevel | null;
      custom_questions: unknown;
      focus_areas: string | null;
      duration_minutes: number | null;
      position_id: string | null;
      application_id: string | null;
      resume_url: string | null;
      status: string;
      interview_id: string | null;
    };
    let customQuestions: ScheduledCustomQuestion[] = [];
    if (Array.isArray(row.custom_questions)) {
      customQuestions = row.custom_questions as ScheduledCustomQuestion[];
    } else if (typeof row.custom_questions === 'string') {
      try {
        const parsed = JSON.parse(row.custom_questions);
        if (Array.isArray(parsed)) customQuestions = parsed as ScheduledCustomQuestion[];
      } catch {
        customQuestions = [];
      }
    }
    if (row.status === 'cancelled') {
      return res.status(410).json({ error: 'This interview was cancelled' });
    }
    if (row.interview_id && row.status === 'in_progress') {
      const state = await interviewSessionService.getState(row.interview_id);
      if (state) {
        const hasAiTurn = state.turns.some((t) => t.role === 'ai');
        if (!hasAiTurn) {
          const firstReplyResult = await aiInterviewerOrchestrator.getNextReply({ interviewId: row.interview_id });
          if (firstReplyResult.success) {
            return res.json({
              interviewId: row.interview_id,
              alreadyStarted: true,
              firstReply: firstReplyResult.reply,
              state: firstReplyResult.state ?? state,
            });
          }
        }
        const lastTurn = state.turns[state.turns.length - 1];
        return res.json({
          interviewId: row.interview_id,
          alreadyStarted: true,
          firstReply: lastTurn?.role === 'ai' ? lastTurn.content : null,
          state,
        });
      }
    }
    let candidateId: string;
    const { rows: candRows } = await query<{ id: string }>(
      `SELECT id FROM candidates WHERE email = $1 LIMIT 1`,
      [row.candidate_email]
    );
    if (candRows.length > 0) {
      candidateId = candRows[0].id;
    } else {
      const { rows: insertRows } = await query<{ id: string }>(
        `INSERT INTO candidates (id, email, name, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, NOW(), NOW()) RETURNING id`,
        [row.candidate_email, row.candidate_name ?? row.candidate_email]
      );
      candidateId = insertRows[0].id;
    }
    let resumeContext: string | undefined;
    if (row.application_id) {
      const { rows: appRows } = await query<{
        resume_url: string | null;
        cover_letter: string | null;
        position_title: string | null;
      }>(
        `SELECT a.resume_url, a.cover_letter, p.title AS position_title
         FROM applications a
         LEFT JOIN positions p ON p.id = a.position_id
         WHERE a.id = $1
         LIMIT 1`,
        [row.application_id]
      );
      const app = appRows[0];
      if (app) {
        resumeContext = await buildResumeContext({
          resumeUrl: app.resume_url,
          coverLetter: app.cover_letter,
          candidateName: row.candidate_name ?? row.candidate_email,
          positionTitle: app.position_title,
        });
      }
    } else if (row.resume_url) {
      resumeContext = await buildResumeContext({
        resumeUrl: row.resume_url,
        candidateName: row.candidate_name ?? row.candidate_email,
      });
    }

    const hasCodingQuestions = customQuestions.some((q) => q.isCodingQuestion);
    if (row.role === 'technical' && !hasCodingQuestions) {
      const defaultCoding: ScheduledCustomQuestion[] = [
        { text: 'Implement a function that reverses a string. Handle empty and single-character strings.', difficulty: 'easy', isCodingQuestion: true, language: 'javascript', starterCode: 'function reverseString(str) {\n  // your code here\n  return str;\n}' },
        { text: 'Write a function that checks if a string is a palindrome. Ignore case and non-alphanumeric characters.', difficulty: 'medium', isCodingQuestion: true, language: 'javascript', starterCode: 'function isPalindrome(str) {\n  // your code here\n  return false;\n}' },
        { text: 'Given an array of numbers, return the two indices whose values sum to a target. Assume exactly one solution exists.', difficulty: 'medium', isCodingQuestion: true, language: 'javascript', starterCode: 'function twoSum(nums, target) {\n  // your code here\n  return [];\n}' },
      ];
      customQuestions = [...customQuestions, ...defaultCoding].slice(0, 30);
    }

    const { interviewId, state } = await interviewSessionService.start({
      candidateId,
      role: row.role as 'technical' | 'behavioral' | 'sales' | 'customer_success',
      positionId: row.position_id ?? undefined,
      resumeContext,
      preferredDifficulty: row.preferred_difficulty ?? undefined,
      customQuestions,
      focusAreas: row.focus_areas?.trim() || undefined,
      durationMinutes: row.duration_minutes ?? undefined,
    });
    const firstReplyResult = await aiInterviewerOrchestrator.getNextReply({ interviewId });
    if (!firstReplyResult.success) {
      return res.status(500).json({ error: 'Failed to generate first interview question' });
    }
    await query(
      `UPDATE scheduled_interviews SET interview_id = $2, status = 'in_progress', updated_at = NOW() WHERE id = $1`,
      [row.id, interviewId]
    );
    res.status(201).json({
      interviewId,
      firstReply: firstReplyResult.reply,
      state: firstReplyResult.state ?? state,
    });
  }
);

export const publicJoinRoutes = router;
