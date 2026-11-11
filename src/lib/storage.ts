import { randomUUID } from "crypto";
import { mkdir, writeFile, readFile, unlink, stat } from "fs/promises";
import { join } from "path";
import { createReadStream } from "fs";

export interface StorageAdapter {
  put(objectKey: string, data: Buffer, mimeType: string): Promise<void>;
  get(objectKey: string): Promise<Buffer>;
  stream(objectKey: string): NodeJS.ReadableStream;
  remove(objectKey: string): Promise<void>;
  exists(objectKey: string): Promise<boolean>;
}

function storageRoot(): string {
  return process.env.LITERIA_STORAGE_DIR ?? join(process.cwd(), "storage");
}

function safeKey(objectKey: string): string {
  if (objectKey.includes("..") || objectKey.startsWith("/") || objectKey.includes("\\")) {
    throw new Error("Invalid object key");
  }
  return objectKey;
}

export class LocalStorageAdapter implements StorageAdapter {
  async put(objectKey: string, data: Buffer): Promise<void> {
    const key = safeKey(objectKey);
    const full = join(storageRoot(), key);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, data);
  }

  async get(objectKey: string): Promise<Buffer> {
    const full = join(storageRoot(), safeKey(objectKey));
    return readFile(full);
  }

  stream(objectKey: string): NodeJS.ReadableStream {
    const full = join(storageRoot(), safeKey(objectKey));
    return createReadStream(full);
  }

  async remove(objectKey: string): Promise<void> {
    const full = join(storageRoot(), safeKey(objectKey));
    await unlink(full).catch(() => undefined);
  }

  async exists(objectKey: string): Promise<boolean> {
    try {
      await stat(join(storageRoot(), safeKey(objectKey)));
      return true;
    } catch {
      return false;
    }
  }
}

export function generateObjectKey(extension: string): string {
  return `${new Date().getUTCFullYear()}/${randomUUID()}.${extension}`;
}

export function getStorage(): StorageAdapter {
  return new LocalStorageAdapter();
}
