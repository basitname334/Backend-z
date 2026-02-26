/**
 * Speech service for the voice interview loop.
 * Transcribes audio files using whisper.cpp CLI (child_process).
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { logger } from '../config/logger';
import { spawnSync } from 'child_process';

const execFileAsync = promisify(execFile);

const WHISPER_BIN = process.env.WHISPER_CPP_PATH || 'whisper';
const WHISPER_MODEL = process.env.WHISPER_MODEL_PATH || path.join(process.cwd(), 'models', 'ggml-base.en.bin');
let whisperAvailabilityChecked = false;
let whisperAvailable = true;
let whisperUnavailableWarned = false;

function ensureWhisperAvailable(): boolean {
  if (whisperAvailabilityChecked) return whisperAvailable;
  whisperAvailabilityChecked = true;
  try {
    const check = spawnSync('which', [WHISPER_BIN], { stdio: 'ignore' });
    whisperAvailable = check.status === 0;
  } catch {
    whisperAvailable = false;
  }
  if (!whisperAvailable && !whisperUnavailableWarned) {
    whisperUnavailableWarned = true;
    logger.warn('Whisper binary not found; local STT is disabled', {
      whisperBin: WHISPER_BIN,
      hint: 'Install whisper.cpp CLI or set WHISPER_CPP_PATH to the executable.',
    });
  }
  return whisperAvailable;
}

/**
 * Transcribe an audio file using whisper.cpp.
 * Expects a path to a WAV (or format supported by whisper.cpp).
 * Returns the transcribed text; strips timestamps and normalizes whitespace.
 */
export async function transcribeAudio(filePath: string): Promise<string> {
  if (!ensureWhisperAvailable()) return '';
  try {
    const args = [
      '-m', WHISPER_MODEL,
      '-f', filePath,
      '-l', 'en',
      '--no-timestamps',
      '--output-txt',
    ];
    const { stdout, stderr } = await execFileAsync(WHISPER_BIN, args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120000,
    });
    if (stderr) logger.debug('Whisper stderr', { stderr: stderr.slice(0, 200) });
    const lines = (stdout || '').split('\n');
    const text = lines
      .filter((line) => !line.startsWith('[') && line.trim())
      .join(' ')
      .trim();
    return text || '';
  } catch (err: any) {
    if (err?.code === 'ENOENT' || /ENOENT/i.test(String(err?.message ?? ''))) {
      whisperAvailable = false;
      if (!whisperUnavailableWarned) {
        whisperUnavailableWarned = true;
        logger.warn('Whisper binary not available at runtime; local STT is disabled', {
          whisperBin: WHISPER_BIN,
        });
      }
      return '';
    }
    logger.error('Whisper transcription failed', { filePath, error: err.message });
    throw new Error('Transcription failed');
  }
}
