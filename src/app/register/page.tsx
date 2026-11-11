"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await authClient.signUp.email(
      { name, email, password },
      {
        onSuccess: () => router.push(`/verify-email?email=${encodeURIComponent(email)}`),
      },
    );
    setLoading(false);
    if (error) setError(error.message ?? "Pendaftaran gagal. Coba lagi.");
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <h1 className="text-3xl font-bold text-navy-950">Daftar LITERIA</h1>
      <p className="mt-1 text-sm text-slate-600">Buat akun anggota, lalu verifikasi email dengan OTP.</p>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Nama
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} className="rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Kata sandi (min 8 karakter)
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="rounded-md border border-slate-300 px-3 py-2" />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={loading} className="rounded-md bg-navy-900 px-4 py-2 font-semibold text-white disabled:opacity-50">
          {loading ? "Memproses…" : "Daftar"}
        </button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        Sudah punya akun? <Link href="/login" className="text-navy-800 underline">Masuk</Link>
      </p>
    </div>
  );
}
