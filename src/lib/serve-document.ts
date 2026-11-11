import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/actor";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { contentDisposition, sanitizeFileName } from "@/lib/file-types";
import { readVerifiedObject } from "@/lib/storage";

export async function servePublishedDocument(id: string, disposition: "inline" | "attachment") {
  const actor = await resolveActor();
  if (!actor.ok) {
    return NextResponse.json(
      { error: actor.error, code: actor.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" },
      { status: actor.status },
    );
  }

  const document = await db.document.findFirst({
    where: { id, status: "PUBLISHED" },
    select: { objectKey: true, mimeType: true, originalFileName: true, sha256: true },
  });
  if (!document) {
    return NextResponse.json({ error: "Dokumen tidak ditemukan." }, { status: 404 });
  }

  let data: Buffer | "missing" | "mismatch";
  try {
    data = await readVerifiedObject(document.objectKey, document.sha256);
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan pada penyimpanan." }, { status: 500 });
  }
  if (data === "mismatch") {
    await writeAudit({
      actorId: actor.user.id,
      action: "document.bytes_mismatch",
      targetType: "Document",
      targetId: id,
    });
    return NextResponse.json({ error: "Berkas gagal pemeriksaan integritas." }, { status: 404 });
  }
  if (data === "missing") {
    return NextResponse.json({ error: "Berkas tidak tersedia di penyimpanan." }, { status: 404 });
  }

  await recordAccess(id, actor.user.id, disposition).catch((error) => {
    console.error("gagal mencatat akses dokumen", error);
  });

  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": document.mimeType,
      "Content-Length": String(data.length),
      "Content-Disposition": contentDisposition(disposition, sanitizeFileName(document.originalFileName)),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

async function recordAccess(id: string, userId: string, disposition: "inline" | "attachment"): Promise<void> {
  if (disposition === "inline") {
    await db.document.update({ where: { id }, data: { viewCount: { increment: 1 } } });
    return;
  }
  await db.$transaction([
    db.document.update({ where: { id }, data: { downloadCount: { increment: 1 } } }),
    db.downloadEvent.create({ data: { userId, documentId: id } }),
  ]);
}
