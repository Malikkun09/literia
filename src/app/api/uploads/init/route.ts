import { UploadError } from "@/lib/upload-error";
import {
  enforceUploadRate,
  jsonWithQuota,
  readLimitedText,
  requireUploadUser,
  uploadErrorResponse,
} from "@/lib/upload-http";
import { initUpload } from "@/lib/uploads";

const JSON_LIMIT = 32 * 1024;

export async function POST(request: Request) {
  let actorId: string | null = null;
  try {
    const user = await requireUploadUser(request);
    actorId = user.id;
    enforceUploadRate(user.id, "init");

    let body: unknown;
    try {
      body = JSON.parse(await readLimitedText(request, JSON_LIMIT));
    } catch (error) {
      if (error instanceof UploadError) throw error;
      throw new UploadError("VALIDATION", "Body JSON tidak valid.", 400);
    }

    const created = await initUpload(user.id, body);
    return jsonWithQuota(user.id, created, 201);
  } catch (error) {
    return uploadErrorResponse(error, actorId, "upload.init.denied");
  }
}
