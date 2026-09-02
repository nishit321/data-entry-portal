import { randomUUID } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { copyFile, mkdir, unlink, writeFile } from 'fs/promises';
import { dirname, resolve, sep } from 'path';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageConfig } from '../config/configuration';

/** The minimal shape of a Multer memory-storage upload (avoids a hard @types/multer dependency). */
export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Blob storage for attachments. A thin, swappable abstraction: today it writes to a local
 * directory (outside the webroot); an S3/object-store implementation can replace the body without
 * touching callers. The DB only ever holds the opaque `storageKey`, never a filesystem path the
 * client can influence.
 */
@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(config: ConfigService) {
    const storage = config.get<StorageConfig>('storage')!;
    this.root = resolve(process.cwd(), storage.dir);
  }

  /**
   * Persist a blob and return the opaque key used to fetch it later. `namespace` groups related
   * blobs under one folder — a submission id for return attachments, `documents/<entityId>` for the
   * licence repository — so the store stays browsable without ever using a caller-supplied name.
   */
  async save(buffer: Buffer, namespace: string, fileName: string): Promise<string> {
    const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
    const key = `${namespace}/${randomUUID()}${ext.toLowerCase()}`;
    const full = this.pathFor(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, buffer);
    return key;
  }

  /**
   * Copy an existing blob to a fresh key under a (possibly different) namespace, returning the new
   * key. Used when a rejected return is revised into a new version and its attachments carry over —
   * each version keeps its own independent blob so removing one never affects the other.
   */
  async copy(sourceKey: string, namespace: string): Promise<string> {
    const from = this.pathFor(sourceKey);
    if (!existsSync(from)) throw new NotFoundException('The stored file could not be found');
    const ext = sourceKey.includes('.') ? sourceKey.slice(sourceKey.lastIndexOf('.')) : '';
    const key = `${namespace}/${randomUUID()}${ext.toLowerCase()}`;
    const full = this.pathFor(key);
    await mkdir(dirname(full), { recursive: true });
    await copyFile(from, full);
    return key;
  }

  /** A read stream for a stored blob, or 404 if the blob is missing. */
  stream(key: string) {
    const full = this.pathFor(key);
    if (!existsSync(full)) throw new NotFoundException('The stored file could not be found');
    return createReadStream(full);
  }

  /** Physically remove a blob (used only for hard cleanup — soft-deletes keep the blob). */
  async remove(key: string): Promise<void> {
    const full = this.pathFor(key);
    if (existsSync(full)) await unlink(full);
  }

  /** Resolve a key to an absolute path, refusing anything that escapes the storage root. */
  private pathFor(key: string): string {
    const full = resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new NotFoundException("We couldn't find that file.");
    }
    return full;
  }
}
