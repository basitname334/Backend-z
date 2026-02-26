/**
 * STT is now handled using Whisper.cpp for local speech-to-text.
 */
import type { ISTTService } from './types';
import { transcribeAudio } from '../../services/speech.service';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

class WhisperSTTServiceWrapper implements ISTTService {
    async transcribe(audioBuffer: Buffer, options?: any): Promise<string> {
        let tempPath: string | null = null;
        try {
            const ext = typeof options?.ext === 'string' ? options.ext : '.webm';
            tempPath = path.join(os.tmpdir(), `stt_${Date.now()}${ext}`);
            fs.writeFileSync(tempPath, audioBuffer);
            return await transcribeAudio(tempPath);
        } finally {
            if (tempPath && fs.existsSync(tempPath)) {
                try {
                    fs.unlinkSync(tempPath);
                } catch {
                    // ignore cleanup errors
                }
            }
        }
    }
}

let instance: ISTTService | null = null;

export function getSTTService(): ISTTService {
    if (!instance) {
        instance = new WhisperSTTServiceWrapper();
    }
    return instance;
}

export type { ISTTService } from './types';
