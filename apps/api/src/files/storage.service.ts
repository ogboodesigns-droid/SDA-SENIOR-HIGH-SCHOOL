import { Injectable } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { config } from '../config';

/**
 * Object storage behind one interface: the local disk for development and
 * small installations, or any S3-compatible service (AWS S3, Cloudflare R2,
 * Backblaze B2, MinIO) in production.
 */
@Injectable()
export class StorageService {
  private s3?: S3Client;

  private get client(): S3Client {
    const c = config();
    this.s3 ??= new S3Client({
      region: c.S3_REGION,
      endpoint: c.S3_ENDPOINT,
      forcePathStyle: !!c.S3_ENDPOINT,
      credentials:
        c.S3_ACCESS_KEY_ID && c.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: c.S3_ACCESS_KEY_ID, secretAccessKey: c.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
    return this.s3;
  }

  private localPath(key: string) {
    // Keys are generated server-side (uuid-based) but resolve defensively anyway.
    const root = path.resolve(config().LOCAL_STORAGE_DIR);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (config().STORAGE_DRIVER === 's3') {
      await this.client.send(new PutObjectCommand({ Bucket: config().S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
      return;
    }
    const full = this.localPath(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body, { mode: 0o600 });
  }

  async get(key: string): Promise<Readable> {
    if (config().STORAGE_DRIVER === 's3') {
      const res = await this.client.send(new GetObjectCommand({ Bucket: config().S3_BUCKET, Key: key }));
      return res.Body as Readable;
    }
    return createReadStream(this.localPath(key));
  }

  async remove(key: string): Promise<void> {
    if (config().STORAGE_DRIVER === 's3') {
      await this.client.send(new DeleteObjectCommand({ Bucket: config().S3_BUCKET, Key: key }));
      return;
    }
    await unlink(this.localPath(key)).catch(() => undefined);
  }
}
