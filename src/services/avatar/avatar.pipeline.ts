/**
 * Avatar pipeline: text → Coqui TTS → audio → SadTalker → Wav2Lip → final video.
 * Uses child_process to invoke the Python script in ai-avatar/.
 */
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { logger } from '../../config/logger';
import { config } from '../../config';

const backendRoot = path.resolve(__dirname, '../..');

export interface AvatarPipelineInput {
  text: string;
  /** Path to source image for talking head (e.g. /avatars/interviewer.png or absolute path). */
  avatarImage: string;
}

export interface AvatarPipelineResult {
  success: boolean;
  videoPath?: string;
  /** Public URL path for the video (e.g. /uploads/avatars/xxx.mp4). */
  videoUrl?: string;
  error?: string;
}

/**
 * Resolve avatar image path. avatarImage can be relative (e.g. /avatars/interviewer.png)
 * or absolute. We pass an absolute path to the Python script.
 */
function resolveAvatarImagePath(avatarImage: string): string {
  if (path.isAbsolute(avatarImage)) return avatarImage;
  const trimmed = avatarImage.replace(/^\//, '');
  return path.join(backendRoot, '..', trimmed);
}

/**
 * Ensure output directory exists and return absolute path for the output file.
 */
function ensureOutputDirAndPath(): { dir: string; absolutePath: string } {
  const outputPath = config.avatar.outputPath;
  const dir = path.isAbsolute(outputPath) ? outputPath : path.join(process.cwd(), outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filename = `avatar_${Date.now()}.mp4`;
  const absolutePath = path.join(dir, filename);
  return { dir, absolutePath };
}

/**
 * Run the Python avatar generation script.
 * Script is expected to accept: --text "..." --image /path/to/image.png --output /path/to/output.mp4
 * and produce the video at --output.
 */
export function runAvatarPipeline(input: AvatarPipelineInput): Promise<AvatarPipelineResult> {
  const { text, avatarImage } = input;
  const imagePath = resolveAvatarImagePath(avatarImage);
  const { dir, absolutePath } = ensureOutputDirAndPath();
  const outputPath = absolutePath;

  if (!text || text.trim().length === 0) {
    return Promise.resolve({
      success: false,
      error: 'Text is required for avatar generation',
    });
  }

  if (!fs.existsSync(imagePath)) {
    logger.warn('Avatar pipeline: image not found', { imagePath });
    return Promise.resolve({
      success: false,
      error: `Avatar image not found: ${imagePath}`,
    });
  }

  const scriptPath = path.isAbsolute(config.avatar.pythonScriptPath)
    ? config.avatar.pythonScriptPath
    : path.join(process.cwd(), config.avatar.pythonScriptPath);

  if (!fs.existsSync(scriptPath)) {
    logger.warn('Avatar pipeline: Python script not found', { scriptPath });
    return Promise.resolve({
      success: false,
      error: `Avatar script not found: ${scriptPath}`,
    });
  }

  return new Promise((resolve) => {
    const args = [
      scriptPath,
      '--text', text.trim(),
      '--image', imagePath,
      '--output', outputPath,
    ];
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  const proc = spawn(pythonCmd, args, {
      cwd: path.dirname(scriptPath),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    proc.stdout?.on('data', (chunk) => {
      logger.debug('Avatar pipeline stdout', { line: String(chunk).trim() });
    });

    proc.on('error', (err) => {
      logger.error('Avatar pipeline spawn error', { error: err.message });
      resolve({
        success: false,
        error: err.message,
      });
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        logger.warn('Avatar pipeline exited with non-zero code', { code, stderr: stderr.slice(0, 500) });
        resolve({
          success: false,
          error: stderr || `Process exited with code ${code}`,
        });
        return;
      }
      if (!fs.existsSync(outputPath)) {
        resolve({
          success: false,
          error: 'Pipeline completed but output file was not created',
        });
        return;
      }
      const videoUrl = `/${config.avatar.outputPath.replace(/\\/g, '/').replace(/^\/+/, '')}/${path.basename(outputPath)}`;
      logger.info('Avatar pipeline completed', { videoPath: outputPath, videoUrl });
      resolve({
        success: true,
        videoPath: outputPath,
        videoUrl,
      });
    });
  });
}
