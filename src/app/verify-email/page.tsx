"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    searchParams.then((p) => {
      if (p.email) setEmail(p.email);
    });
  }, [searchParams]);

  async function resend() {
    setError("");
    setInfo("");
    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "email-verification",
    });
    if (error) setError(error.message ?? "Gagal mengirim OTP.");
    else setInfo("Kode OTP dikirim ulang. Berlaku 5 menit.");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await authClient.emailOtp.verifyEmail({ email, otp });
    setLoading(false);
    if (error) setError(error.message ?? "Verifikasi gagal. Periksa kode OTP.");
    else router.push("/dashboard");
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <h1 className="text-3xl font-bold text-navy-950">Verifikasi email</h1>
      <p className="mt-1 text-sm text-slate-600">Masukkan 6 digit kode OTP yang dikirim ke email Anda.</p>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Kode OTP
          <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} required inputMode="numeric" placeholder="123456" className="rounded-md border border-slate-300 px-3 py-2 text-center text-2xl tracking-widest" />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {info && <p className="text-sm text-green-700">{info}</p>}
        <button disabled={loading} className="rounded-md bg-navy-900 px-4 py-2 font-semibold text-white disabled:opacity-50">
          {loading ? "Memverifikasi…" : "Verifikasi"}
        </button>
        <button type="button" onClick={resend} className="text-sm text-navy-800 underline">
          Kirim ulang kode
        </button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        <Link href="/login" className="underline">Kembali ke halaman masuk</Link>
      </p>
    </div>
  );
}
