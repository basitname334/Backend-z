/**
 * Speech-to-Text abstraction for streaming. Implement with OpenAI Whisper API,
 * or another provider; interface allows pluggable backends.
 */

export interface STTStreamResult {
  text: string;
  isFinal?: boolean;
}

export interface ISTTService {
  /** Process a stream chunk (e.g. WebRTC audio). Return incremental or final text. */
  processChunk?(chunk: Buffer): Promise<STTStreamResult>;
  /** One-shot transcription (e.g. for uploaded file). */
  transcribe(audioBuffer: Buffer): Promise<string>;
}
