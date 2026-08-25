import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export function decodeBase64Upload(dataUrl: string, expectedType: 'image' | 'audio', maxBytes: number): Buffer {
  const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/);
  if (!match || !match[1].toLowerCase().startsWith(`${expectedType}/`)) {
    throw new Error(`INVALID_${expectedType.toUpperCase()}_DATA`);
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0 || buffer.length > maxBytes) {
    throw new Error(`${expectedType.toUpperCase()}_SIZE_INVALID`);
  }
  return buffer;
}

export function readImageDimensions(buffer: Buffer): { width: number; height: number } {
  if (buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
  }

  throw new Error('UNSUPPORTED_IMAGE_FORMAT');
}

export async function readAudioDurationSeconds(filePath: string): Promise<number> {
  const ffprobePath = process.env.FFPROBE_PATH || 'C:\\Program Files\\FFMPEG\\bin\\ffprobe.exe';
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
  ]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('INVALID_AUDIO_DURATION');
  return duration;
}
