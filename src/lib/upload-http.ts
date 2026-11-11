import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/actor";
import { writeAudit } from "@/lib/audit";
import { getEnv } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import type { CurrentUser } from "@/lib/session";
import { UploadError } from "@/lib/upload-error";
import { getQuotaSnapshot, type QuotaSnapshot } from "@/lib/uploads";
import { bigintToNumber } from "@/lib/format";

const WINDOW_MS = 10 * 60 * 1000;

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const { APP_URL, ADMIN_APP_URL } = getEnv();
  if (origin !== APP_URL && origin !== ADMIN_APP_URL) {
    throw new UploadError("FORBIDDEN", "Asal permintaan tidak diizinkan.", 403);
  }
}

function rateError(retryAfterSec: number): UploadError {
  return new UploadError(
    "RATE_LIMIT",
    `Terlalu banyak percobaan unggah. Coba lagi dalam ${retryAfterSec} detik.`,
    429,
    retryAfterSec,
  );
}

export async function requireUploadUser(request: Request): Promise<CurrentUser> {
  assertSameOrigin(request);
  const ipHit = rateLimit(`upload:ip:${clientIp(request)}`, 40, WINDOW_MS);
  if (!ipHit.ok) throw rateError(ipHit.retryAfterSec);
  const actor = await resolveActor();
  if (!actor.ok) {
    throw new UploadError(actor.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", actor.error, actor.status);
  }
  return actor.user;
}

export function enforceUploadRate(userId: string, scope: "init" | "transfer"): void {
  const limit = scope === "init" ? 12 : 30;
  const hit = rateLimit(`upload:${scope}:${userId}`, limit, WINDOW_MS);
  if (!hit.ok) throw rateError(hit.retryAfterSec);
}

export function quotaJson(quota: QuotaSnapshot) {
  return {
    usedBytes: bigintToNumber(quota.usedBytes),
    reservedBytes: bigintToNumber(quota.reservedBytes),
    quotaBytes: bigintToNumber(quota.quotaBytes),
  };
}

export async function uploadErrorResponse(
  error: unknown,
  actorId: string | null,
  action: string,
  targetId?: string,
): Promise<NextResponse> {
  if (error instanceof UploadError) {
    if (actorId && error.code !== "UNAUTHENTICATED" && error.code !== "NOT_FOUND") {
      await writeAudit({
        actorId,
        action,
        targetType: "UploadSession",
        targetId,
        metadata: { code: error.code, message: error.message },
      }).catch((auditError) => {
        console.error("audit log gagal", auditError);
      });
    }
    const headers = new Headers();
    if (error.retryAfter) headers.set("Retry-After", String(error.retryAfter));
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers });
  }
  console.error(error);
  return NextResponse.json({ error: "Terjadi kesalahan pada server." }, { status: 500 });
}

export async function withQuota<T extends Record<string, unknown>>(userId: string, body: T) {
  const quota = await getQuotaSnapshot(userId);
  return { ...body, quota: quotaJson(quota) };
}

export async function readLimitedBody(request: Request, maxBytes: number): Promise<Buffer> {
  const declared = request.headers.get("content-length");
  if (declared && Number.isFinite(Number(declared)) && Number(declared) > maxBytes) {
    throw new UploadError("TOO_LARGE", "Ukuran berkas melebihi yang dicadangkan. Kuota dikembalikan.", 413);
  }
  if (!request.body) throw new UploadError("VALIDATION", "Berkas kosong. Kuota dikembalikan.", 400);
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new UploadError("TOO_LARGE", "Ukuran berkas melebihi yang dicadangkan. Kuota dikembalikan.", 413);
    }
    chunks.push(Buffer.from(value));
  }
  if (total === 0) throw new UploadError("VALIDATION", "Berkas kosong. Kuota dikembalikan.", 400);
  return Buffer.concat(chunks);
}
