import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import { logger } from '../config/logger';
import * as fs from 'fs';
import * as path from 'path';

interface TranscriptionResult {
    text: string;
    confidence: number;
    isFinal: boolean;
}

/**
 * Speech-to-Text Service using Whisper
 * Supports real-time streaming transcription
 */
export class STTService extends EventEmitter {
    private whisperProcess: ChildProcessWithoutNullStreams | null = null;
    private model: string;
    private language: string;
    private device: string;
    private isProcessing: boolean = false;
    private audioBuffer: Buffer[] = [];
    private tempAudioFile: string;

    constructor() {
        super();
        this.model = process.env.WHISPER_MODEL || 'base.en';
        this.language = process.env.WHISPER_LANGUAGE || 'en';
        this.device = process.env.WHISPER_DEVICE || 'cpu';
        this.tempAudioFile = path.join('/tmp', `whisper_${Date.now()}.wav`);
    }

    /**
     * Initialize Whisper process
     */
    async initialize(): Promise<boolean> {
        try {
            // Check if whisper.cpp is available
            // For now, we'll use a simpler approach with node-whisper or direct API calls
            logger.info('STT Service initialized', {
                model: this.model,
                language: this.language,
                device: this.device,
            });
            return true;
        } catch (error) {
            logger.error('Failed to initialize STT service', { error });
            return false;
        }
    }

    /**
     * Transcribe audio buffer (streaming mode)
     * This processes audio chunks in real-time
     */
    async transcribeStream(audioChunk: Buffer): Promise<TranscriptionResult | null> {
        try {
            this.audioBuffer.push(audioChunk);

            // Only process if we have enough audio (e.g., 1 second worth)
            const totalSize = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);

            // Assuming 16kHz, 16-bit, mono: 1 second = 32000 bytes
            const minBufferSize = 32000; // 1 second of audio

            if (totalSize < minBufferSize) {
                return null; // Not enough audio yet
            }

            // Combine buffers
            const combinedBuffer = Buffer.concat(this.audioBuffer);
            this.audioBuffer = []; // Clear buffer

            // Write to temporary WAV file
            await this.writeWavFile(combinedBuffer);

            // Transcribe using Whisper
            const text = await this.transcribeFile(this.tempAudioFile);

            return {
                text,
                confidence: 0.9, // Whisper doesn't provide confidence scores
                isFinal: false,
            };
        } catch (error) {
            logger.error('Stream transcription failed', { error });
            return null;
        }
    }

    /**
     * Transcribe a complete audio file
     */
    async transcribeFile(filePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            try {
                // Using whisper.cpp command line
                // Adjust the path to your whisper.cpp installation
                const whisperPath = process.env.WHISPER_CPP_PATH || 'whisper';
                const modelPath = process.env.WHISPER_MODEL_PATH || `./models/ggml-${this.model}.bin`;

                const args = [
                    '-m', modelPath,
                    '-f', filePath,
                    '-l', this.language,
                    '--no-timestamps',
                    '--output-txt',
                ];

                const whisper = spawn(whisperPath, args);
                let output = '';
                let errorOutput = '';

                whisper.stdout.on('data', (data) => {
                    output += data.toString();
                });

                whisper.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });

                whisper.on('close', (code) => {
                    if (code === 0) {
                        // Extract transcription from output
                        const lines = output.split('\n');
                        const transcription = lines
                            .filter(line => !line.startsWith('[') && line.trim())
                            .join(' ')
                            .trim();

                        resolve(transcription);
                    } else {
                        logger.error('Whisper process failed', { code, errorOutput });
                        reject(new Error('Whisper transcription failed'));
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Detect silence in audio buffer
     * Returns true if silence detected (useful for sentence boundary detection)
     */
    detectSilence(audioBuffer: Buffer, threshold: number = 500): boolean {
        // Simple silence detection based on audio amplitude
        const samples = new Int16Array(
            audioBuffer.buffer,
            audioBuffer.byteOffset,
            audioBuffer.length / 2
        );

        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            sum += Math.abs(samples[i]);
        }

        const average = sum / samples.length;
        return average < threshold;
    }

    /**
     * Detect sentence boundary
     * Returns true if we should process the accumulated audio
     */
    shouldProcessBuffer(silenceDuration: number): boolean {
        // Process if silence > 1.2 seconds
        return silenceDuration > 1200;
    }

    /**
     * Write WAV file from PCM buffer
     */
    private async writeWavFile(pcmBuffer: Buffer): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const sampleRate = 16000;
                const numChannels = 1;
                const bitsPerSample = 16;

                // WAV header
                const wavHeader = Buffer.alloc(44);

                // RIFF header
                wavHeader.write('RIFF', 0);
                wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4);
                wavHeader.write('WAVE', 8);

                // fmt chunk
                wavHeader.write('fmt ', 12);
                wavHeader.writeUInt32LE(16, 16); // fmt chunk size
                wavHeader.writeUInt16LE(1, 20); // audio format (1 = PCM)
                wavHeader.writeUInt16LE(numChannels, 22);
                wavHeader.writeUInt32LE(sampleRate, 24);
                wavHeader.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, 28); // byte rate
                wavHeader.writeUInt16LE(numChannels * bitsPerSample / 8, 32); // block align
                wavHeader.writeUInt16LE(bitsPerSample, 34);

                // data chunk
                wavHeader.write('data', 36);
                wavHeader.writeUInt32LE(pcmBuffer.length, 40);

                const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);

                fs.writeFileSync(this.tempAudioFile, wavBuffer);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Cleanup temporary files
     */
    cleanup(): void {
        try {
            if (fs.existsSync(this.tempAudioFile)) {
                fs.unlinkSync(this.tempAudioFile);
            }
        } catch (error) {
            logger.error('Failed to cleanup temp files', { error });
        }
    }

    /**
     * Stop the STT service
     */
    stop(): void {
        if (this.whisperProcess) {
            this.whisperProcess.kill();
            this.whisperProcess = null;
        }
        this.cleanup();
        this.audioBuffer = [];
    }
}

export const sttService = new STTService();
