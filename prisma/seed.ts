import { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "crypto";
import { hashPassword } from "better-auth/crypto";

const db = new PrismaClient();

async function ensureUser(opts: {
  name: string;
  email: string;
  password: string;
  role: "ADMIN" | "MEMBER";
}) {
  await db.user.deleteMany({ where: { email: opts.email } });
  const user = await db.user.create({
    data: {
      name: opts.name,
      email: opts.email,
      emailVerified: true,
      role: opts.role,
      status: "ACTIVE",
    },
  });
  await db.account.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: await hashPassword(opts.password),
    },
  });
  return user;
}

async function main() {
  const categories = [
    { name: "Matematika", slug: "matematika", description: "Modul dan catatan matematika" },
    { name: "Pemrograman", slug: "pemrograman", description: "Tutorial dan modul pemrograman" },
    { name: "Sains", slug: "sains", description: "Dokumen sains dan pengetahuan umum" },
  ];
  for (const c of categories) {
    await db.category.upsert({ where: { slug: c.slug }, update: {}, create: c });
  }

  await db.setting.upsert({
    where: { key: "max_file_size" },
    update: { value: "52428800" },
    create: { key: "max_file_size", value: "52428800" },
  });
  await db.setting.upsert({
    where: { key: "default_quota" },
    update: { value: "1000000000" },
    create: { key: "default_quota", value: "1000000000" },
  });
  await db.setting.upsert({
    where: { key: "allowed_extensions" },
    update: { value: "pdf,docx,pptx,xlsx,txt,csv" },
    create: { key: "allowed_extensions", value: "pdf,docx,pptx,xlsx,txt,csv" },
  });

  await ensureUser({
    name: "Administrator",
    email: "admin@literia.local",
    password: "admin123",
    role: "ADMIN",
  });

  const member = await ensureUser({
    name: "Anggota Demo",
    email: "anggota@literia.local",
    password: "anggota123",
    role: "MEMBER",
  });

  const pemrograman = await db.category.findUnique({ where: { slug: "pemrograman" } });
  if (pemrograman) {
    await db.document.deleteMany({ where: { slug: "pengenalan-html-untuk-pemula" } });
    await db.document.create({
      data: {
        slug: "pengenalan-html-untuk-pemula",
        title: "Pengenalan HTML untuk Pemula",
        description: "Dokumen contoh: dasar-dasar HTML untuk proyek PSAJ.",
        originalFileName: "pengenalan-html.pdf",
        objectKey: `seed/${randomUUID()}.pdf`,
        extension: "pdf",
        mimeType: "application/pdf",
        sizeBytes: 102400,
        sha256: createHash("sha256").update("seed-doc").digest("hex"),
        ownerId: member.id,
        categoryId: pemrograman.id,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
  }

  console.log("Seed OK: admin + member demo (Better Auth) + kategori + 1 dokumen contoh");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
