/**
 * Text-to-Speech abstraction for AI interviewer voice. Implement with OpenAI TTS,
 * or another provider; interface allows pluggable backends.
 */

export interface ITTSService {
  synthesize(text: string): Promise<Buffer>;
}
