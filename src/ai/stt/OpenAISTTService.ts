import OpenAI, { toFile } from 'openai';
import { config } from '../../config';
import type { ISTTService } from './types';

export class OpenAISTTService implements ISTTService {
    private openai: OpenAI | null = null;

    constructor() {
        if (config.ai.openaiApiKey) {
            this.openai = new OpenAI({
                apiKey: config.ai.openaiApiKey,
            });
        }
    }

    async transcribe(audioBuffer: Buffer): Promise<string> {
        if (!this.openai) {
            throw new Error('OpenAI API key missing for STT');
        }

        try {
            const transcription = await this.openai.audio.transcriptions.create({
                file: await toFile(audioBuffer, 'audio.webm'),
                model: 'whisper-1',
            });

            return transcription.text;
        } catch (error) {
            console.error('OpenAI STT Error:', error);
            throw new Error('Failed to transcribe audio');
        }
    }
}
