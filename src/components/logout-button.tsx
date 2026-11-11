"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export default function LogoutButton() {
  const router = useRouter();

  async function onClick() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={onClick}
      className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
    >
      Keluar
    </button>
  );
}
