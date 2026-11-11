import Link from "next/link";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/upload", label: "Upload" },
  { href: "/katalog", label: "Katalog" },
];

export default function Placeholder({ title }: { title: string }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-16">
      <Link href="/" className="text-sm text-navy-800 hover:underline">
        ← Kembali ke beranda
      </Link>
      <h1 className="text-3xl font-bold text-navy-950">{title}</h1>
      <p className="text-slate-600">
        Halaman ini bagian dari fondasi Phase 0. Implementasi penuh menyusul di fase berikutnya.
      </p>
      <nav className="flex gap-3">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
