import { NextResponse } from "next/server";
import { enforceUploadRate, requireUploadUser, uploadErrorResponse } from "@/lib/upload-http";
import { cancelUpload } from "@/lib/uploads";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  let actorId: string | null = null;
  try {
    const user = await requireUploadUser(request);
    actorId = user.id;
    enforceUploadRate(user.id, "transfer");
    await cancelUpload(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return uploadErrorResponse(error, actorId, "upload.cancel.denied", id);
  }
}
