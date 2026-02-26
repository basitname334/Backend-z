/**
 * TTS is now handled on the frontend using Web Speech API.
 * This file is kept for backward compatibility but returns a no-op service.
 */
import type { ITTSService } from './types';

class BrowserTTSService implements ITTSService {
    async synthesize(text: string, options?: any): Promise<Buffer> {
        // TTS is handled on the frontend
        throw new Error('TTS is handled on the frontend using Web Speech API');
    }
}

let instance: ITTSService | null = null;

export function getTTSService(): ITTSService {
    if (!instance) {
        instance = new BrowserTTSService();
    }
    return instance;
}

export type { ITTSService } from './types';
