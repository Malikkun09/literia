import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { UploadError } from "@/lib/upload-error";
import {
  enforceUploadRate,
  readLimitedBody,
  requireUploadUser,
  uploadErrorResponse,
} from "@/lib/upload-http";
import { saveUploadContent } from "@/lib/uploads";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  let actorId: string | null = null;
  try {
    const user = await requireUploadUser(request);
    actorId = user.id;
    enforceUploadRate(user.id, "transfer");

    const session = await db.uploadSession.findUnique({
      where: { id },
      select: { userId: true, expectedSizeBytes: true },
    });
    if (!session || session.userId !== user.id) {
      throw new UploadError("NOT_FOUND", "Sesi unggah tidak ditemukan.", 404);
    }

    const cap = Math.min(getEnv().MAX_UPLOAD_BYTES, Number(session.expectedSizeBytes)) + 1;
    let data: Buffer;
    try {
      data = await readLimitedBody(request, cap);
    } catch (error) {
      if (error instanceof UploadError && (error.code === "TOO_LARGE" || error.code === "VALIDATION")) {
        await saveUploadContent(user.id, id, Buffer.alloc(0)).catch(() => undefined);
      }
      throw error;
    }

    const saved = await saveUploadContent(user.id, id, data);
    return NextResponse.json({ ok: true, sizeBytes: saved.sizeBytes });
  } catch (error) {
    return uploadErrorResponse(error, actorId, "upload.content.denied", id);
  }
}
