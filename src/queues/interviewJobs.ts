/**
 * Bull queue for background interview jobs. Use cases: report generation when
 * Redis state is large, summarization of context when token limit is approached,
 * and async recording upload to object storage. Stub implementation; wire Redis
 * and Bull in production.
 */

import type { InterviewReport } from '../types';

export interface GenerateReportJobData {
  interviewId: string;
}

export async function enqueueReportGeneration(data: GenerateReportJobData): Promise<void> {
  // In production: await reportQueue.add('generate', data, { attempts: 2 });
  console.log('[Queue stub] enqueueReportGeneration', data);
}

export async function processReportJob(data: GenerateReportJobData): Promise<InterviewReport | null> {
  // Worker would load state, call scoringReportService.buildReport, persist, return
  console.log('[Queue stub] processReportJob', data);
  return null;
}
