import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export const instant = false;

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");
  if (!session.user.emailVerified) redirect(`/verify-email?email=${encodeURIComponent(session.user.email)}`);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-16">
      <h1 className="text-3xl font-bold text-navy-950">Dashboard</h1>
      <p className="text-slate-600">
        Selamat datang, {session.user.name} ({session.user.email}).
      </p>
      <p className="text-sm text-slate-600">
        <Link href="/upload" className="underline">
          Unggah dokumen
        </Link>
        {" · "}
        <Link href="/katalog" className="underline">
          Katalog
        </Link>
      </p>
    </div>
  );
}
