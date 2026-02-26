import OpenAI from 'openai';
import type { ILLMService, LLMMessage, LLMOptions, LLMResponse } from './types';
import { config } from '../../config';

export class OpenAILLMService implements ILLMService {
  private openai: OpenAI | null = null;

  constructor() {
    if (config.ai.openaiApiKey) {
      this.openai = new OpenAI({
        apiKey: config.ai.openaiApiKey,
      });
    }
  }

  async chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const temperature = options?.temperature ?? config.ai.defaultTemperature;
    const model = 'gpt-4o'; // High quality default

    if (!this.openai) {
      return this.stubResponse(messages, temperature);
    }

    try {
      const completion = await this.openai.chat.completions.create({
        model,
        messages: messages.map((m) => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        })),
        temperature,
        max_tokens: options?.maxTokens ?? 1024,
        response_format: { type: 'json_object' }, // Ensure structured output
      });

      const content = completion.choices[0]?.message?.content ?? '';
      return {
        content,
        usage: {
          promptTokens: completion.usage?.prompt_tokens ?? 0,
          completionTokens: completion.usage?.completion_tokens ?? 0,
        },
      };
    } catch (error) {
      console.error('OpenAI LLM Error:', error);
      return this.stubResponse(messages, temperature);
    }
  }

  private stubResponse(messages: LLMMessage[], temperature: number): LLMResponse {
    return {
      content: JSON.stringify({
        reply: 'Thank you for that. Could you elaborate a bit more on your experience in that situation?',
        intent: 'follow_up',
        suggestedNextPhase: null,
      }),
      usage: { promptTokens: 100, completionTokens: 30 },
    };
  }
}
