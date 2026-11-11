import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/session";

export type ActorResult =
  | { ok: true; user: CurrentUser }
  | { ok: false; status: 401 | 403; error: string; email?: string };

export async function resolveActor(): Promise<ActorResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { ok: false, status: 401, error: "Masuk diperlukan untuk mengakses berkas ini." };
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true, status: true, emailVerified: true },
  });
  if (!user) {
    return { ok: false, status: 401, error: "Masuk diperlukan untuk mengakses berkas ini." };
  }
  if (user.status !== "ACTIVE") {
    return { ok: false, status: 403, error: "Akun ditangguhkan. Unggah dan unduh tidak tersedia." };
  }
  if (!user.emailVerified) {
    return {
      ok: false,
      status: 403,
      error: "Email belum diverifikasi.",
      email: user.email,
    };
  }
  return { ok: true, user };
}
