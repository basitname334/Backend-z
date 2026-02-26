import OpenAI from 'openai';
import { config } from '../../config';
import type { ITTSService } from './types';

export class OpenAITTSService implements ITTSService {
    private openai: OpenAI | null = null;

    constructor() {
        if (config.ai.openaiApiKey) {
            this.openai = new OpenAI({
                apiKey: config.ai.openaiApiKey,
            });
        }
    }

    async synthesize(text: string): Promise<Buffer> {
        if (!this.openai) {
            throw new Error('OpenAI API key missing for TTS');
        }

        try {
            const mp3 = await this.openai.audio.speech.create({
                // Higher-quality model/voice for a less robotic interviewer tone.
                model: 'tts-1-hd',
                voice: 'nova',
                input: text,
            });

            const buffer = Buffer.from(await mp3.arrayBuffer());
            return buffer;
        } catch (error) {
            console.error('OpenAI TTS Error:', error);
            throw new Error('Failed to synthesize speech');
        }
    }
}
