import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Global, Injectable, Module, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createReadStream, promises as fs } from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

// File storage. Production -> S3 (S3_BUCKET). Development -> local folder (UPLOAD_DIR, default ./uploads).
// Containers have throw-away disks, so local storage is refused in production unless ALLOW_LOCAL_STORAGE=true (persistent volume).
@Injectable()
export class StorageService {
  private bucket = process.env.S3_BUCKET;
  private s3 = this.bucket ? new S3Client({ region: process.env.S3_REGION || process.env.AWS_REGION || 'ap-south-1' }) : null;
  private dir = path.resolve(process.env.UPLOAD_DIR || './uploads');

  private assertAvailable() {
    // ALLOW_LOCAL_STORAGE=true is for a single server whose UPLOAD_DIR is a persistent Docker volume (docker-compose.yml).
    if (!this.s3 && process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_STORAGE !== 'true') {
      throw new ServiceUnavailableException('File storage is not configured (S3_BUCKET is not set)');
    }
  }

  private localPath(key: string) {
    const p = path.resolve(this.dir, key);
    if (!p.startsWith(this.dir + path.sep)) throw new NotFoundException('Invalid file key'); // no path traversal
    return p;
  }

  async put(key: string, body: Buffer, contentType: string) {
    this.assertAvailable();
    if (this.s3) {
      await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'AES256' }));
      return;
    }
    const p = this.localPath(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body);
  }

  async get(key: string): Promise<Readable> {
    this.assertAvailable();
    if (this.s3) {
      try {
        const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
        return r.Body as Readable;
      } catch {
        throw new NotFoundException('File not found');
      }
    }
    const p = this.localPath(key);
    try { await fs.access(p); } catch { throw new NotFoundException('File not found'); }
    return createReadStream(p);
  }

  async remove(key: string) {
    try {
      if (this.s3) await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      else await fs.rm(this.localPath(key), { force: true });
    } catch { /* best effort: an orphaned file is harmless, a failed request is not */ }
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
