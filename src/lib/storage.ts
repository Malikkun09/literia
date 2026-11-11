import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { mkdir, writeFile, readFile, unlink, stat, rename } from "fs/promises";
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
  return process.env.LITERIA_STORAGE_DIR ?? join(/*turbopackIgnore: true*/ process.cwd(), "storage");
}

function safeKey(objectKey: string): string {
  if (objectKey.includes("..") || objectKey.startsWith("/") || objectKey.includes("\\")) {
    throw new Error("Invalid object key");
  }
  return objectKey;
}

function objectPath(objectKey: string): string {
  return join(/*turbopackIgnore: true*/ storageRoot(), safeKey(objectKey));
}

export class LocalStorageAdapter implements StorageAdapter {
  async put(objectKey: string, data: Buffer): Promise<void> {
    const full = objectPath(objectKey);
    await mkdir(/*turbopackIgnore: true*/ join(full, ".."), { recursive: true });
    const tmp = `${full}.${randomUUID()}.partial`;
    try {
      await writeFile(/*turbopackIgnore: true*/ tmp, data);
      await rename(/*turbopackIgnore: true*/ tmp, full);
    } catch (error) {
      await unlink(/*turbopackIgnore: true*/ tmp).catch(() => undefined);
      throw error;
    }
  }

  async get(objectKey: string): Promise<Buffer> {
    return readFile(/*turbopackIgnore: true*/ objectPath(objectKey));
  }

  stream(objectKey: string): NodeJS.ReadableStream {
    return createReadStream(/*turbopackIgnore: true*/ objectPath(objectKey));
  }

  async remove(objectKey: string): Promise<void> {
    await unlink(/*turbopackIgnore: true*/ objectPath(objectKey)).catch(() => undefined);
  }

  async exists(objectKey: string): Promise<boolean> {
    try {
      await stat(/*turbopackIgnore: true*/ objectPath(objectKey));
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

export async function readVerifiedObject(
  objectKey: string,
  sha256: string,
): Promise<Buffer | "missing" | "mismatch"> {
  let data: Buffer;
  try {
    data = await getStorage().get(objectKey);
  } catch {
    return "missing";
  }
  const actual = createHash("sha256").update(data).digest("hex");
  const expected = sha256.toLowerCase();
  if (actual.length !== expected.length) return "mismatch";
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected)) ? data : "mismatch";
}
