import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/actor";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getQuotaSnapshot } from "@/lib/uploads";
import UploadForm from "./upload-form";

export const instant = false;

export const metadata = { title: "Upload dokumen" };

export default async function UploadPage() {
  const actor = await resolveActor();
  if (!actor.ok) {
    if (actor.status === 401) redirect("/login");
    if (actor.email) redirect(`/verify-email?email=${encodeURIComponent(actor.email)}`);
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-4 px-6 py-16">
        <h1 className="text-3xl font-bold text-navy-950">Upload dokumen</h1>
        <p className="text-sm text-red-700">{actor.error}</p>
      </main>
    );
  }

  const [categories, quota] = await Promise.all([
    db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getQuotaSnapshot(actor.user.id),
  ]);

  return (
    <UploadForm
      categories={categories}
      usedBytes={Number(quota.usedBytes)}
      reservedBytes={Number(quota.reservedBytes)}
      quotaBytes={Number(quota.quotaBytes)}
      maxUploadBytes={getEnv().MAX_UPLOAD_BYTES}
    />
  );
}
