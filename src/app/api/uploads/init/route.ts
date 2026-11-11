import { NextResponse } from "next/server";
import { UploadError } from "@/lib/upload-error";
import {
  enforceUploadRate,
  requireUploadUser,
  uploadErrorResponse,
  withQuota,
} from "@/lib/upload-http";
import { initUpload } from "@/lib/uploads";

export async function POST(request: Request) {
  let actorId: string | null = null;
  try {
    const user = await requireUploadUser(request);
    actorId = user.id;
    enforceUploadRate(user.id, "init");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new UploadError("VALIDATION", "Body JSON tidak valid.", 400);
    }

    const created = await initUpload(user.id, body);
    return NextResponse.json(await withQuota(user.id, created), { status: 201 });
  } catch (error) {
    return uploadErrorResponse(error, actorId, "upload.init.denied");
  }
}
