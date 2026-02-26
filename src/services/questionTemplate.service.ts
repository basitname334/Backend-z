/**
 * Question template CRUD and loading for the interview strategy.
 * Uses raw SQL so we can support extended columns (is_coding_question, starter_code, language) without Prisma regenerate.
 */
import { query } from '../db/client';
import type { InterviewRole, InterviewPhase, DifficultyLevel } from '../types';

export interface QuestionTemplateRow {
  id: string;
  role: string;
  phase: string;
  difficulty: string;
  text: string;
  competency_ids: string[];
  follow_up_prompt: string | null;
  is_coding_question?: boolean;
  starter_code?: string | null;
  language?: string | null;
  sort_order?: number;
}

export interface QuestionTemplateCreate {
  role: InterviewRole;
  phase: InterviewPhase;
  difficulty: DifficultyLevel;
  text: string;
  competencyIds?: string[];
  followUpPrompt?: string | null;
  isCodingQuestion?: boolean;
  starterCode?: string | null;
  language?: string | null;
  sortOrder?: number;
}

export interface QuestionTemplateUpdate {
  phase?: InterviewPhase;
  difficulty?: DifficultyLevel;
  text?: string;
  competencyIds?: string[];
  followUpPrompt?: string | null;
  isCodingQuestion?: boolean;
  starterCode?: string | null;
  language?: string | null;
  sortOrder?: number;
}

export async function listQuestionTemplates(filters?: { role?: string; phase?: string }): Promise<QuestionTemplateRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters?.role) {
    params.push(filters.role);
    conditions.push(`role = $${params.length}`);
  }
  if (filters?.phase) {
    params.push(filters.phase);
    conditions.push(`phase = $${params.length}`);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  try {
    const sql = `SELECT id, role, phase, difficulty, text, competency_ids, follow_up_prompt,
      COALESCE(is_coding_question, false) AS is_coding_question,
      starter_code, language, COALESCE(sort_order, 0) AS sort_order
      FROM question_templates${where} ORDER BY sort_order ASC, created_at ASC`;
    const { rows } = await query<QuestionTemplateRow>(sql, params.length ? params : undefined);
    return rows;
  } catch {
    const sql = `SELECT id, role, phase, difficulty, text, competency_ids, follow_up_prompt
      FROM question_templates${where} ORDER BY created_at ASC`;
    const { rows } = await query<QuestionTemplateRow>(sql, params.length ? params : undefined);
    return rows.map((r) => ({ ...r, is_coding_question: false, starter_code: null, language: null, sort_order: 0 }));
  }
}

export async function createQuestionTemplate(data: QuestionTemplateCreate): Promise<QuestionTemplateRow> {
  const competencyIds = Array.isArray(data.competencyIds) ? data.competencyIds : [];
  const baseParams: unknown[] = [data.role, data.phase, data.difficulty, data.text, competencyIds, data.followUpPrompt ?? null];

  const baseSql = `INSERT INTO question_templates (id, role, phase, difficulty, text, competency_ids, follow_up_prompt)
                   VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::text[], $6)
                   RETURNING id, role, phase, difficulty, text, competency_ids, follow_up_prompt`;

  try {
    const sqlExtended = `INSERT INTO question_templates (id, role, phase, difficulty, text, competency_ids, follow_up_prompt, is_coding_question, starter_code, language, sort_order)
                         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::text[], $6, $7, $8, $9, $10)
                         RETURNING id, role, phase, difficulty, text, competency_ids, follow_up_prompt,
                           COALESCE(is_coding_question, false) AS is_coding_question,
                           starter_code, language, COALESCE(sort_order, 0) AS sort_order`;
    const paramsExtended = [...baseParams, data.isCodingQuestion ?? false, data.starterCode ?? null, data.language ?? null, data.sortOrder ?? 0];
    const { rows } = await query<QuestionTemplateRow>(sqlExtended, paramsExtended);
    if (rows.length === 0) throw new Error('Failed to create question');
    return rows[0];
  } catch {
    const { rows } = await query<QuestionTemplateRow>(baseSql, baseParams);
    if (rows.length === 0) throw new Error('Failed to create question');
    return { ...rows[0], is_coding_question: false, starter_code: null, language: null, sort_order: 0 };
  }
}

export async function updateQuestionTemplate(id: string, data: QuestionTemplateUpdate): Promise<QuestionTemplateRow | null> {
  const updates: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (data.phase !== undefined) { updates.push(`phase = $${i}`); params.push(data.phase); i++; }
  if (data.difficulty !== undefined) { updates.push(`difficulty = $${i}`); params.push(data.difficulty); i++; }
  if (data.text !== undefined) { updates.push(`text = $${i}`); params.push(data.text); i++; }
  if (data.competencyIds !== undefined) { updates.push(`competency_ids = $${i}::text[]`); params.push(Array.isArray(data.competencyIds) ? data.competencyIds : []); i++; }
  if (data.followUpPrompt !== undefined) { updates.push(`follow_up_prompt = $${i}`); params.push(data.followUpPrompt); i++; }
  if (data.isCodingQuestion !== undefined) { updates.push(`is_coding_question = $${i}`); params.push(data.isCodingQuestion); i++; }
  if (data.starterCode !== undefined) { updates.push(`starter_code = $${i}`); params.push(data.starterCode); i++; }
  if (data.language !== undefined) { updates.push(`language = $${i}`); params.push(data.language); i++; }
  if (data.sortOrder !== undefined) { updates.push(`sort_order = $${i}`); params.push(data.sortOrder); i++; }
  if (updates.length === 0) return null;
  params.push(id);
  try {
    const sql = `UPDATE question_templates SET ${updates.join(', ')} WHERE id = $${i}
                 RETURNING id, role, phase, difficulty, text, competency_ids, follow_up_prompt,
                   COALESCE(is_coding_question, false) AS is_coding_question,
                   starter_code, language, COALESCE(sort_order, 0) AS sort_order`;
    const { rows } = await query<QuestionTemplateRow>(sql, params);
    return rows[0] ?? null;
  } catch {
    const baseUpdates: string[] = [];
    const baseParams: unknown[] = [];
    let j = 1;
    if (data.phase !== undefined) { baseUpdates.push(`phase = $${j}`); baseParams.push(data.phase); j++; }
    if (data.difficulty !== undefined) { baseUpdates.push(`difficulty = $${j}`); baseParams.push(data.difficulty); j++; }
    if (data.text !== undefined) { baseUpdates.push(`text = $${j}`); baseParams.push(data.text); j++; }
    if (data.competencyIds !== undefined) { baseUpdates.push(`competency_ids = $${j}::text[]`); baseParams.push(Array.isArray(data.competencyIds) ? data.competencyIds : []); j++; }
    if (data.followUpPrompt !== undefined) { baseUpdates.push(`follow_up_prompt = $${j}`); baseParams.push(data.followUpPrompt); j++; }
    if (baseUpdates.length === 0) return null;
    baseParams.push(id);
    const sql = `UPDATE question_templates SET ${baseUpdates.join(', ')} WHERE id = $${j}
                 RETURNING id, role, phase, difficulty, text, competency_ids, follow_up_prompt`;
    const { rows } = await query<QuestionTemplateRow>(sql, baseParams);
    const row = rows[0];
    return row ? { ...row, is_coding_question: false, starter_code: null, language: null, sort_order: 0 } : null;
  }
}

export async function deleteQuestionTemplate(id: string): Promise<boolean> {
  const { rowCount } = await query(`DELETE FROM question_templates WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

export async function getQuestionTemplatesForStrategy(role: InterviewRole, phase: InterviewPhase): Promise<QuestionTemplateRow[]> {
  return listQuestionTemplates({ role, phase });
}
