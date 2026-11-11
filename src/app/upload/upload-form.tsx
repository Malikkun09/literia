"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import LogoutButton from "@/components/logout-button";
import { extensionError } from "@/lib/file-types";
import { formatBytes } from "@/lib/format";

type Category = { id: string; name: string };

type Props = {
  categories: Category[];
  usedBytes: number;
  reservedBytes: number;
  quotaBytes: number;
  maxUploadBytes: number;
};

type Stage = "idle" | "hash" | "init" | "upload" | "check" | "done";

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function postJson(url: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (response) => ({
    status: response.status,
    json: (await response.json().catch(() => ({}))) as Record<string, unknown>,
  }));
}

function postFile(url: string, file: File, onProgress: (ratio: number) => void): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        json = {};
      }
      resolve({ status: xhr.status, json });
    };
    xhr.onerror = () => reject(new Error("Koneksi terputus saat mengunggah berkas."));
    xhr.send(file);
  });
}

function errorText(json: Record<string, unknown>, fallback: string): string {
  return typeof json.error === "string" && json.error.trim() ? json.error : fallback;
}

export default function UploadForm({ categories, usedBytes, reservedBytes, quotaBytes, maxUploadBytes }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ slug: string; message: string } | null>(null);

  const remaining = Math.max(0, quotaBytes - usedBytes - reservedBytes);
  const usedPct = quotaBytes > 0 ? Math.min(100, ((usedBytes + reservedBytes) / quotaBytes) * 100) : 0;
  const busy = stage !== "idle" && stage !== "done";

  const stageLabel = useMemo(() => {
    if (stage === "hash") return "Menghitung checksum…";
    if (stage === "init") return "Mencadangkan kuota…";
    if (stage === "upload") return `Mengunggah berkas… ${progress}%`;
    if (stage === "check") return "Memeriksa jenis dan struktur berkas…";
    if (stage === "done") return "Selesai.";
    return "Siap mengunggah.";
  }, [stage, progress]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess(null);
    if (!file) {
      setError("Pilih berkas yang akan diunggah.");
      return;
    }
    const nameError = extensionError(file.name);
    if (nameError) {
      setError(nameError);
      return;
    }
    if (file.size <= 0) {
      setError("Berkas kosong tidak bisa diunggah.");
      return;
    }
    if (file.size > maxUploadBytes) {
      setError(`Ukuran berkas melebihi batas ${formatBytes(maxUploadBytes)} per file.`);
      return;
    }
    if (file.size > remaining) {
      setError(`Kuota tidak cukup. Sisa ${formatBytes(remaining)}, berkas ini ${formatBytes(file.size)}.`);
      return;
    }
    if (title.trim().length < 3) {
      setError("Judul minimal 3 karakter.");
      return;
    }

    try {
      setStage("hash");
      setProgress(0);
      const sha256 = await sha256Hex(file);

      setStage("init");
      const init = await postJson("/api/uploads/init", {
        title: title.trim(),
        description: description.trim(),
        categoryId,
        fileName: file.name,
        sizeBytes: file.size,
        sha256,
      });
      if (init.status !== 201 || typeof init.json.id !== "string") {
        setStage("idle");
        setError(errorText(init.json, "Gagal menyiapkan unggahan."));
        router.refresh();
        return;
      }

      setStage("upload");
      const uploaded = await postFile(`/api/uploads/${init.json.id}/content`, file, (ratio) => {
        setProgress(Math.round(ratio * 100));
      });
      if (uploaded.status < 200 || uploaded.status >= 300) {
        setStage("idle");
        setError(errorText(uploaded.json, "Gagal mengunggah berkas. Kuota dikembalikan jika reservasi sudah dibuat."));
        router.refresh();
        return;
      }

      setStage("check");
      setProgress(100);
      const done = await postJson(`/api/uploads/${init.json.id}/complete`, { sha256 });
      if (done.status < 200 || done.status >= 300 || done.json.status !== "PUBLISHED") {
        setStage("idle");
        setError(errorText(done.json, "Berkas tidak bisa diterbitkan."));
        router.refresh();
        return;
      }

      setStage("done");
      setSuccess({
        slug: String(done.json.slug ?? ""),
        message: typeof done.json.message === "string" ? done.json.message : "Dokumen sudah diterbitkan.",
      });
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
    } catch (cause) {
      setStage("idle");
      setError(cause instanceof Error ? cause.message : "Unggahan gagal.");
      router.refresh();
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <Link href="/" className="text-sm text-navy-800 hover:underline">
          ← Beranda
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-navy-800 hover:underline">
            Dashboard
          </Link>
          <LogoutButton />
        </div>
      </div>

      <div>
        <h1 className="text-3xl font-bold text-navy-950">Upload dokumen</h1>
        <p className="mt-1 text-sm text-slate-600">
          PDF, DOCX, PPTX, XLSX, TXT, atau CSV. Maksimal {formatBytes(maxUploadBytes)} per berkas. File yang lolos
          pemeriksaan langsung diterbitkan.
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-navy-900">Kuota penyimpanan</span>
          <span className="text-slate-600">
            {formatBytes(usedBytes)} terpakai
            {reservedBytes > 0 ? ` · ${formatBytes(reservedBytes)} dicadangkan` : ""} · sisa {formatBytes(remaining)} dari{" "}
            {formatBytes(quotaBytes)}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usedPct)} aria-label="Pemakaian kuota">
          <div className="h-full bg-navy-800" style={{ width: `${usedPct}%` }} />
        </div>
      </section>

      <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border border-slate-200 p-6">
        <label className="flex flex-col gap-1 text-sm">
          Judul
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            minLength={3}
            maxLength={255}
            disabled={busy}
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Deskripsi <span className="font-normal text-slate-500">(opsional)</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={5000}
            rows={3}
            disabled={busy}
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Kategori
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            disabled={busy}
            className="rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="">Tanpa kategori</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Berkas
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,.pptx,.xlsx,.txt,.csv,application/pdf,text/plain,text/csv"
            disabled={busy}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setError("");
              setSuccess(null);
            }}
            className="rounded-md border border-slate-300 px-3 py-2"
          />
          {file && <span className="text-slate-500">{file.name} · {formatBytes(file.size)}</span>}
        </label>

        {(busy || stage === "done") && (
          <div>
            <div className="mb-1 flex justify-between text-sm text-slate-600">
              <span aria-live="polite">{stageLabel}</span>
              <span>{stage === "upload" || stage === "check" || stage === "done" ? `${progress}%` : ""}</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded bg-slate-200"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={stage === "upload" ? progress : stage === "done" || stage === "check" ? 100 : 0}
              aria-label="Progres unggah"
            >
              <div
                className="h-full bg-gold-500 transition-all"
                style={{ width: `${stage === "upload" ? progress : stage === "check" || stage === "done" ? 100 : 8}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {success.message}{" "}
            {success.slug && (
              <Link href={`/dokumen/${success.slug}`} className="underline">
                Lihat dokumen
              </Link>
            )}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-navy-900 px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Mengunggah…" : "Unggah dan terbitkan"}
        </button>
      </form>
    </div>
  );
}
