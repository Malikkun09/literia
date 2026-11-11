import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { extensionError, fileExtension, isAllowedExtension, MIME_BY_EXTENSION, sanitizeFileName } from "@/lib/file-types";
import { inspectUpload } from "@/lib/file-inspect";
import { bigintToNumber, formatBytes } from "@/lib/format";
import { slugify } from "@/lib/slug";
import { generateObjectKey, getStorage } from "@/lib/storage";
import { UploadError } from "@/lib/upload-error";
import { uploadInitSchema } from "@/lib/validation";

const SESSION_TTL_MS = 30 * 60 * 1000;

type ReservedSession = {
  id: string;
  userId: string;
  documentId: string | null;
  expectedSizeBytes: bigint;
  status: string;
  expiresAt: Date;
  document: {
    id: string;
    objectKey: string;
    extension: string;
    mimeType: string;
    sha256: string;
    slug: string;
    status: string;
    originalFileName: string;
  } | null;
};

export type QuotaSnapshot = {
  usedBytes: bigint;
  reservedBytes: bigint;
  quotaBytes: bigint;
};

function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

async function expireStaleReservations(userId: string): Promise<void> {
  const stale = await db.uploadSession.findMany({
    where: { userId, status: "RESERVED", expiresAt: { lte: new Date() } },
    include: { document: { select: { id: true, objectKey: true, status: true } } },
  });
  if (stale.length === 0) return;

  const keys: string[] = [];
  await db.$transaction(async (tx) => {
    for (const session of stale) {
      const updated = await tx.uploadSession.updateMany({
        where: { id: session.id, status: "RESERVED" },
        data: { status: "EXPIRED" },
      });
      if (updated.count !== 1) continue;
      if (session.document && session.document.status === "SCANNING") {
        await tx.document.update({
          where: { id: session.document.id },
          data: {
            status: "REJECTED",
            scanStatus: "expired",
            scanMessage: "Sesi unggah kedaluwarsa sebelum selesai.",
          },
        });
        keys.push(session.document.objectKey);
      }
    }
  });
  const storage = getStorage();
  await Promise.all(keys.map((key) => storage.remove(key)));
}

export async function getQuotaSnapshot(userId: string): Promise<QuotaSnapshot> {
  await expireStaleReservations(userId);
  const [user, reserved] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { storageUsedBytes: true, storageQuotaBytes: true },
    }),
    db.uploadSession.aggregate({
      where: { userId, status: "RESERVED", expiresAt: { gt: new Date() } },
      _sum: { reservedBytes: true },
    }),
  ]);
  if (!user) throw new UploadError("NOT_FOUND", "Pengguna tidak ditemukan.", 404);
  return {
    usedBytes: user.storageUsedBytes,
    reservedBytes: reserved._sum.reservedBytes ?? BigInt(0),
    quotaBytes: user.storageQuotaBytes,
  };
}

async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = `${base}-${randomUUID().slice(0, 8)}`;
    const existing = await db.document.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) return slug;
  }
  return `${base}-${randomUUID()}`;
}

export async function initUpload(userId: string, raw: unknown) {
  const parsed = uploadInitSchema.safeParse(raw);
  if (!parsed.success) {
    throw new UploadError("VALIDATION", parsed.error.issues[0]?.message ?? "Data unggahan tidak valid.", 400);
  }
  const input = parsed.data;
  const nameError = extensionError(input.fileName);
  if (nameError) throw new UploadError("VALIDATION", nameError, 400);
  const extension = fileExtension(input.fileName);
  if (!extension || !isAllowedExtension(extension)) {
    throw new UploadError("VALIDATION", "Ekstensi file tidak diizinkan.", 400);
  }

  const maxBytes = getEnv().MAX_UPLOAD_BYTES;
  if (input.sizeBytes > maxBytes) {
    throw new UploadError(
      "TOO_LARGE",
      `Ukuran berkas melebihi batas ${formatBytes(maxBytes)} per file.`,
      413,
    );
  }

  const size = BigInt(input.sizeBytes);
  const objectKey = generateObjectKey(extension);
  const slug = await uniqueSlug(input.title);
  const originalFileName = sanitizeFileName(input.fileName);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await expireStaleReservations(userId);

  const created = await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      Array<{ storageUsedBytes: bigint; storageQuotaBytes: bigint; status: string; emailVerified: boolean }>
    >`
      SELECT "storageUsedBytes", "storageQuotaBytes", "status"::text AS status, "emailVerified"
      FROM "User"
      WHERE "id" = ${userId}
      FOR UPDATE
    `;
    const user = locked[0];
    if (!user) throw new UploadError("NOT_FOUND", "Pengguna tidak ditemukan.", 404);
    if (user.status !== "ACTIVE") throw new UploadError("FORBIDDEN", "Akun ditangguhkan.", 403);
    if (!user.emailVerified) throw new UploadError("FORBIDDEN", "Email belum diverifikasi.", 403);

    if (input.categoryId) {
      const category = await tx.category.findUnique({ where: { id: input.categoryId }, select: { id: true } });
      if (!category) throw new UploadError("VALIDATION", "Kategori tidak ditemukan.", 400);
    }

    const reserved = await tx.uploadSession.aggregate({
      where: { userId, status: "RESERVED", expiresAt: { gt: new Date() } },
      _sum: { reservedBytes: true },
    });
    const reservedBytes = reserved._sum.reservedBytes ?? BigInt(0);
    const used = BigInt(user.storageUsedBytes) + reservedBytes;
    const quota = BigInt(user.storageQuotaBytes);
    if (used + size > quota) {
      const remaining = quota > used ? quota - used : BigInt(0);
      throw new UploadError(
        "QUOTA",
        `Kuota tidak cukup. Sisa ${formatBytes(bigintToNumber(remaining))}, berkas ini ${formatBytes(input.sizeBytes)}.`,
        409,
      );
    }

    const document = await tx.document.create({
      data: {
        slug,
        title: input.title,
        description: input.description,
        originalFileName,
        objectKey,
        extension,
        mimeType: MIME_BY_EXTENSION[extension],
        sizeBytes: size,
        sha256: input.sha256,
        ownerId: userId,
        categoryId: input.categoryId,
        status: "SCANNING",
        scanStatus: "pending",
      },
    });
    const session = await tx.uploadSession.create({
      data: {
        userId,
        documentId: document.id,
        expectedSizeBytes: size,
        reservedBytes: size,
        status: "RESERVED",
        expiresAt,
      },
    });
    return { sessionId: session.id, documentId: document.id, slug: document.slug };
  });

  return {
    id: created.sessionId,
    documentId: created.documentId,
    slug: created.slug,
    expiresAt: expiresAt.toISOString(),
  };
}

async function loadReserved(userId: string, sessionId: string): Promise<ReservedSession> {
  const session = await db.uploadSession.findUnique({
    where: { id: sessionId },
    include: {
      document: {
        select: {
          id: true,
          objectKey: true,
          extension: true,
          mimeType: true,
          sha256: true,
          slug: true,
          status: true,
          originalFileName: true,
        },
      },
    },
  });
  if (!session || session.userId !== userId) {
    throw new UploadError("NOT_FOUND", "Sesi unggah tidak ditemukan.", 404);
  }
  return session;
}

async function releaseReservation(
  session: ReservedSession,
  status: "REJECTED" | "QUARANTINED",
  message: string,
  keepFile: boolean,
): Promise<void> {
  const updated = await db.$transaction(async (tx) => {
    const result = await tx.uploadSession.updateMany({
      where: { id: session.id, status: "RESERVED" },
      data: { status: "RELEASED" },
    });
    if (result.count !== 1 || !session.documentId) return result.count;
    await tx.document.update({
      where: { id: session.documentId },
      data: {
        status,
        scanStatus: status === "QUARANTINED" ? "quarantine" : "rejected",
        scanMessage: message,
      },
    });
    return result.count;
  });
  if (updated === 1 && !keepFile && session.document) {
    await getStorage().remove(session.document.objectKey);
  }
}

export async function saveUploadContent(userId: string, sessionId: string, data: Buffer): Promise<{ sizeBytes: number }> {
  const session = await loadReserved(userId, sessionId);
  if (session.expiresAt.getTime() <= Date.now() && session.status !== "COMPLETED") {
    if (session.status === "RESERVED") {
      await releaseReservation(session, "REJECTED", "Sesi unggah kedaluwarsa.", false);
    }
    throw new UploadError("EXPIRED", "Sesi unggah kedaluwarsa. Kuota dikembalikan. Mulai unggah dari awal.", 410);
  }
  if (session.status === "COMPLETED") {
    throw new UploadError("CONFLICT", "Unggahan ini sudah selesai.", 409);
  }
  if (session.status !== "RESERVED" || !session.document) {
    throw new UploadError("CONFLICT", "Sesi unggah tidak lagi menahan kuota.", 409);
  }
  if (BigInt(data.length) !== session.expectedSizeBytes) {
    await releaseReservation(
      session,
      "REJECTED",
      "Ukuran berkas tidak sama dengan yang dicadangkan.",
      false,
    );
    throw new UploadError(
      "REJECTED",
      "Ukuran berkas tidak sama dengan yang dicadangkan. Kuota dikembalikan.",
      422,
    );
  }

  try {
    await getStorage().put(session.document.objectKey, data, session.document.mimeType);
  } catch {
    await releaseReservation(session, "REJECTED", "Gagal menyimpan berkas.", false);
    throw new UploadError("REJECTED", "Gagal menyimpan berkas. Kuota dikembalikan.", 500);
  }
  return { sizeBytes: data.length };
}

export async function completeUpload(userId: string, sessionId: string, claimedSha256?: string) {
  const session = await loadReserved(userId, sessionId);
  if (session.status === "COMPLETED" && session.document?.status === "PUBLISHED") {
    return {
      status: "PUBLISHED" as const,
      documentId: session.document.id,
      slug: session.document.slug,
      message: "Dokumen sudah diterbitkan.",
    };
  }
  if (session.expiresAt.getTime() <= Date.now() && session.status !== "COMPLETED") {
    if (session.status === "RESERVED") {
      await releaseReservation(session, "REJECTED", "Sesi unggah kedaluwarsa.", false);
    }
    throw new UploadError("EXPIRED", "Sesi unggah kedaluwarsa. Kuota dikembalikan. Mulai unggah dari awal.", 410);
  }
  if (session.status !== "RESERVED" || !session.document) {
    throw new UploadError("CONFLICT", "Sesi unggah tidak bisa diselesaikan.", 409);
  }
  if (!isAllowedExtension(session.document.extension)) {
    await releaseReservation(session, "REJECTED", "Ekstensi tidak diizinkan.", false);
    throw new UploadError("REJECTED", "Ekstensi tidak diizinkan. Kuota dikembalikan.", 422);
  }

  const extension = session.document.extension;
  let data: Buffer;
  try {
    data = await getStorage().get(session.document.objectKey);
  } catch {
    await releaseReservation(session, "REJECTED", "Berkas belum terunggah.", false);
    throw new UploadError("REJECTED", "Berkas belum terunggah. Kuota dikembalikan.", 422);
  }

  if (BigInt(data.length) !== session.expectedSizeBytes) {
    await releaseReservation(session, "REJECTED", "Ukuran berkas tidak sesuai.", false);
    throw new UploadError("REJECTED", "Ukuran berkas tidak sesuai reservasi. Kuota dikembalikan.", 422);
  }

  const actualSha = sha256Hex(data);
  const expectedSha = session.document.sha256.toLowerCase();
  if (!sameHex(actualSha, expectedSha) || (claimedSha256 && !sameHex(actualSha, claimedSha256.toLowerCase()))) {
    await releaseReservation(session, "REJECTED", "Checksum berkas tidak cocok.", false);
    throw new UploadError("REJECTED", "Checksum berkas tidak cocok. Kuota dikembalikan.", 422);
  }

  let verdict: ReturnType<typeof inspectUpload>;
  try {
    verdict = inspectUpload(data, extension);
  } catch {
    await releaseReservation(session, "REJECTED", "Berkas rusak dan tidak bisa diperiksa.", false);
    throw new UploadError("REJECTED", "Berkas rusak dan tidak bisa diperiksa. Kuota dikembalikan.", 422);
  }

  if (!verdict.ok) {
    const keepFile = verdict.status === "QUARANTINED";
    await releaseReservation(session, verdict.status, verdict.message, keepFile);
    throw new UploadError(verdict.status, `${verdict.message} Kuota dikembalikan.`, 422);
  }

  let published: { already: boolean };
  try {
    published = await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ storageUsedBytes: bigint; storageQuotaBytes: bigint }>>`
        SELECT "storageUsedBytes", "storageQuotaBytes"
        FROM "User"
        WHERE "id" = ${userId}
        FOR UPDATE
      `;
      const row = locked[0];
      if (!row) throw new UploadError("NOT_FOUND", "Pengguna tidak ditemukan.", 404);
      const reserved = await tx.uploadSession.aggregate({
        where: { userId, status: "RESERVED", expiresAt: { gt: new Date() } },
        _sum: { reservedBytes: true },
      });
      const held = BigInt(row.storageUsedBytes) + (reserved._sum.reservedBytes ?? BigInt(0));
      if (held > BigInt(row.storageQuotaBytes)) {
        throw new UploadError("QUOTA", "Kuota tidak lagi cukup untuk menyelesaikan unggahan ini.", 409);
      }

      const marked = await tx.uploadSession.updateMany({
        where: { id: session.id, status: "RESERVED" },
        data: { status: "COMPLETED" },
      });
      if (marked.count !== 1) {
        const current = await tx.uploadSession.findUnique({ where: { id: session.id } });
        if (current?.status === "COMPLETED") return { already: true };
        throw new UploadError("CONFLICT", "Sesi unggah tidak bisa diselesaikan.", 409);
      }
      await tx.document.update({
        where: { id: session.document!.id },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          scanStatus: "clean",
          scanMessage: "Lolos pemeriksaan jenis berkas dan struktur.",
          sizeBytes: BigInt(data.length),
          sha256: actualSha,
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: { storageUsedBytes: { increment: BigInt(data.length) } },
      });
      return { already: false };
    });
  } catch (error) {
    if (error instanceof UploadError && error.code === "QUOTA") {
      await releaseReservation(session, "REJECTED", "Kuota tidak lagi cukup.", false);
    }
    throw error;
  }

  return {
    status: "PUBLISHED" as const,
    documentId: session.document.id,
    slug: session.document.slug,
    message: published.already
      ? "Dokumen sudah diterbitkan."
      : "Dokumen lolos pemeriksaan dan sudah diterbitkan.",
  };
}
