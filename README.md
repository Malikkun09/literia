# LITERIA — Digital Library

Repositori dokumen digital komunitas. Anggota terverifikasi mengunggah dokumen edukasi,
membaca online, dan mengunduh file asli. Dibangun from-scratch untuk PSAJ Praktik
Pemrograman 2026/2027 (Proyek 2 — Website perpustakaan digital).

## Tech stack
Next.js 16 App Router + TypeScript, Tailwind, PostgreSQL + Prisma, Better Auth + Email OTP
(rencana Phase 1), Zod, next-themes, Nginx (dua hostname).

## Cara menjalankan (lokal)

```bash
cd literia
npm install
cp .env.example .env   # isi DATABASE_URL dkk
npx prisma migrate dev
npm run seed
npm run dev
```

Buka http://localhost:3000. Health check: http://localhost:3000/api/health

## Akun demo (seed)
- Admin: admin@literia.local / admin123
- Anggota: anggota@literia.local / anggota123

## Struktur
- `prisma/schema.prisma` — User, Document, Category, Favorite, DownloadEvent, Report, UploadSession, AuditLog, Setting
- `src/app/` — landing, katalog, dokumen, dashboard, upload, auth
- `src/lib/` — env (Zod), db (Prisma)
- `middleware.ts` — deteksi hostname anggota vs admin

Lihat `DOKUMENTASI.md` untuk dokumentasi PSAJ dan `../.commandcode/plans/literia-digital-library.md`
untuk rencana implementasi penuh.
