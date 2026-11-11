import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/actor";
import { db } from "@/lib/db";
import { contentDisposition, sanitizeFileName } from "@/lib/file-types";
import { getStorage } from "@/lib/storage";

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
    select: { objectKey: true, mimeType: true, originalFileName: true },
  });
  if (!document) {
    return NextResponse.json({ error: "Dokumen tidak ditemukan." }, { status: 404 });
  }

  let data: Buffer;
  try {
    data = await getStorage().get(document.objectKey);
  } catch {
    return NextResponse.json({ error: "Berkas tidak tersedia di penyimpanan." }, { status: 404 });
  }

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
