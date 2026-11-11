import { UploadError } from "@/lib/upload-error";
import {
  enforceUploadRate,
  jsonWithQuota,
  readLimitedText,
  requireUploadUser,
  uploadErrorResponse,
} from "@/lib/upload-http";
import { completeUpload } from "@/lib/uploads";
import { uploadCompleteSchema } from "@/lib/validation";

const JSON_LIMIT = 8 * 1024;

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  let actorId: string | null = null;
  try {
    const user = await requireUploadUser(request);
    actorId = user.id;
    enforceUploadRate(user.id, "transfer");

    let claimed: string | undefined;
    const raw = await readLimitedText(request, JSON_LIMIT);
    if (raw.trim()) {
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new UploadError("VALIDATION", "Body JSON tidak valid.", 400);
      }
      const parsed = uploadCompleteSchema.safeParse(json);
      if (!parsed.success) {
        throw new UploadError("VALIDATION", parsed.error.issues[0]?.message ?? "Checksum tidak valid.", 400);
      }
      claimed = parsed.data.sha256;
    }

    const result = await completeUpload(user.id, id, claimed);
    return jsonWithQuota(user.id, result, 200);
  } catch (error) {
    return uploadErrorResponse(error, actorId, "upload.complete.denied", id);
  }
}
