"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<"request" | "reset">("request");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await authClient.emailOtp.requestPasswordReset({ email });
    setLoading(false);
    if (error) setError(error.message ?? "Gagal mengirim OTP reset.");
    else setStep("reset");
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await authClient.emailOtp.resetPassword({ email, otp, password });
    setLoading(false);
    if (error) setError(error.message ?? "Reset gagal. Periksa OTP dan kata sandi baru.");
    else router.push("/login");
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <h1 className="text-3xl font-bold text-navy-950">Lupa kata sandi</h1>
      <p className="mt-1 text-sm text-slate-600">Reset dengan kode OTP 6 digit yang dikirim ke email.</p>
      {step === "request" ? (
        <form onSubmit={requestOtp} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="rounded-md border border-slate-300 px-3 py-2" />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button disabled={loading} className="rounded-md bg-navy-900 px-4 py-2 font-semibold text-white disabled:opacity-50">
            {loading ? "Mengirim…" : "Kirim kode reset"}
          </button>
        </form>
      ) : (
        <form onSubmit={resetPassword} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Kode OTP
            <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} required inputMode="numeric" placeholder="123456" className="rounded-md border border-slate-300 px-3 py-2 text-center text-2xl tracking-widest" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Kata sandi baru (min 8 karakter)
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="rounded-md border border-slate-300 px-3 py-2" />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button disabled={loading} className="rounded-md bg-navy-900 px-4 py-2 font-semibold text-white disabled:opacity-50">
            {loading ? "Menyimpan…" : "Simpan kata sandi baru"}
          </button>
        </form>
      )}
      <p className="mt-4 text-sm text-slate-600">
        <Link href="/login" className="underline">Kembali ke halaman masuk</Link>
      </p>
    </div>
  );
}
