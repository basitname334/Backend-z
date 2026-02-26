/**
 * LLM abstraction: provider-agnostic interface so we can swap OpenAI/Claude
 * or add fallbacks without changing callers. All prompts request structured JSON
 * and use temperature 0.3–0.5; internal reasoning is never exposed to candidates.
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  /** Timeout in ms; provider may fall back or reject after this. */
  timeoutMs?: number;
}

export interface LLMResponse {
  content: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface ILLMService {
  chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>;
}
