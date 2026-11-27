import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

export const MAX_IMAGE_BYTES = 150 * 1024;      // every stored photo ends up at or below 150 KB
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // what a phone camera may send us before compression

// Real file type from the first bytes - the browser-supplied type cannot be trusted.
function looksLikeImage(buf: Buffer) {
  if (buf.length < 12) return false;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP';
  return jpeg || png || webp;
}

/**
 * Photo -> JPEG of at most 150 KB. Straightens phone photos (EXIF rotation), drops metadata (location etc.),
 * then tries smaller sizes / lower quality until it fits.
 */
export async function compressImage(input: Buffer): Promise<{ buffer: Buffer; width: number; height: number; originalBytes: number }> {
  if (!looksLikeImage(input)) throw new BadRequestException('Only JPG, PNG or WebP photos can be attached');
  const sizes = [1600, 1280, 1024, 800, 640, 480];
  const qualities = [80, 70, 60, 50, 40, 30];
  try {
    for (const edge of sizes) {
      const resized = await sharp(input, { failOn: 'none' }).rotate().resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).toBuffer();
      for (const q of qualities) {
        const out = await sharp(resized).jpeg({ quality: q, mozjpeg: true }).toBuffer({ resolveWithObject: true });
        if (out.data.length <= MAX_IMAGE_BYTES) return { buffer: out.data, width: out.info.width, height: out.info.height, originalBytes: input.length };
      }
    }
  } catch {
    throw new BadRequestException('That file could not be read as a photo. Try another one.');
  }
  throw new BadRequestException('The photo could not be reduced enough. Please try a different photo.');
}
