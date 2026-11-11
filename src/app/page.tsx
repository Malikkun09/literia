import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="bg-navy-950 text-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-xl font-bold tracking-wide">
            LITERIA <span className="text-gold-400">· Digital Library</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/katalog" className="hover:text-gold-400">
              Katalog
            </Link>
            <Link href="/login" className="hover:text-gold-400">
              Masuk
            </Link>
            <Link
              href="/register"
              className="rounded-md bg-gold-500 px-4 py-2 font-semibold text-navy-950 hover:bg-gold-400"
            >
              Daftar
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 py-12">
        <section className="rounded-2xl bg-navy-900 p-10 text-white">
          <p className="text-sm uppercase tracking-widest text-gold-400">Repositori Dokumen Digital</p>
          <h1 className="mt-2 text-4xl font-bold leading-tight">
            Unggah, temukan, baca, dan unduh dokumen edukasi.
          </h1>
          <p className="mt-3 max-w-2xl text-white/80">
            LITERIA adalah perpustakaan dokumen komunitas untuk PSAJ Pemrograman 2026/2027.
            Anggota terverifikasi dapat mengunggah dokumen, membaca online, dan mengunduh file
            asli setelah masuk.
          </p>
          <form action="/katalog" method="get" className="mt-6 flex max-w-xl gap-2">
            <input
              name="q"
              type="search"
              placeholder="Cari judul, deskripsi, atau kategori…"
              className="w-full rounded-md px-4 py-3 text-navy-950"
            />
            <button
              type="submit"
              className="rounded-md bg-gold-500 px-6 py-3 font-semibold text-navy-950 hover:bg-gold-400"
            >
              Cari
            </button>
          </form>
        </section>
        <section className="grid gap-4 sm:grid-cols-3">
          {[
            { title: "Katalog komunitas", desc: "Jelajahi dokumen yang dibagikan anggota lain." },
            { title: "Baca online", desc: "Buka viewer dokumen setelah masuk dan terverifikasi." },
            { title: "Unduh asli", desc: "Unduh file asli untuk dibaca offline." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-200 p-6">
              <h2 className="font-semibold text-navy-900">{f.title}</h2>
              <p className="mt-1 text-sm text-slate-600">{f.desc}</p>
            </div>
          ))}
        </section>
      </main>
      <footer className="border-t border-slate-200 py-6 text-center text-sm text-slate-500">
        LITERIA — Digital Library · PSAJ Pemrograman 2026/2027
      </footer>
    </div>
  );
}
