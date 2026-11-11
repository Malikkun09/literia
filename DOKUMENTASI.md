# DOKUMENTASI — LITERIA Digital Library

## 1. Nama Proyek
LITERIA — Digital Library (Repositori Dokumen Digital Komunitas)

## 2. Tujuan Pembuatan
Menyediakan perpustakaan dokumen digital berbasis komunitas untuk lingkungan sekolah:
anggota terverifikasi dapat mengunggah dokumen edukasi, menemukan dokumen anggota lain,
membaca online setelah masuk, dan mengunduh file asli. Proyek ini dibuat untuk memenuhi
Penilaian Sumatif Akhir Jenjang (PSAJ) Praktik Pemrograman 2026/2027 — Proyek 2 Membuat Website.

## 3. Teknologi yang Digunakan
- Next.js 16.x App Router + TypeScript (framework, diizinkan poin 6 petunjuk PSAJ)
- Tailwind CSS (styling, setara Bootstrap yang diizinkan poin 5)
- PostgreSQL + Prisma ORM (basis data)
- Better Auth + Email OTP (autentikasi; tahap fondasi memakai skema siap-OTP)
- Zod (validasi server), next-themes (tema terang/gelap/perangkat)
- PDF.js + LibreOffice worker (preview dokumen, tahap lanjutan)
- Nginx reverse proxy (dua hostname: anggota & admin)

## 4. Fitur-Fitur yang Tersedia
- Landing + katalog metadata (bisa dibuka tamu sebagai preview)
- Registrasi, verifikasi email OTP, login/logout, lupa kata sandi
- Upload dokumen (PDF/DOCX/PPTX/XLSX/TXT/CSV) dengan validasi otomatis + kuota 1 GB
- Baca online & unduh file asli (wajib login + terverifikasi)
- Favorit, riwayat unduhan, kuota penyimpanan, lapor dokumen
- Admin: statistik, kelola user, moderasi dokumen, laporan, kategori, audit log

## 5. Cara Menjalankan
Lihat README.md. Ringkas: `npm install`, isi `.env`, `npx prisma migrate dev`, `npm run seed`, `npm run dev`.
