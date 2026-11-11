import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import { hashPassword } from "better-auth/crypto";
import { PrismaClient } from "@prisma/client";
import { officePackage } from "./zip-fixture";

const base = process.env.APP_URL ?? "http://localhost:3000";
const db = new PrismaClient();
const password = "anggota12345";
const email = `phase2-http-${randomUUID()}@literia.test`;

function sha(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function signIn(userId: string): Promise<string> {
  await db.account.create({
    data: {
      userId,
      accountId: userId,
      providerId: "credential",
      password: await hashPassword(password),
    },
  });
  const response = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ email, password }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`sign-in ${response.status}: ${text}`);
  const cookies = response.headers.getSetCookie?.() ?? [];
  assert(cookies.length > 0, "sign-in tidak mengirim cookie");
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

async function main() {
  const user = await db.user.create({
    data: { name: "Penguji HTTP", email, emailVerified: true, status: "ACTIVE", storageQuotaBytes: BigInt(30 * 1024 * 1024) },
  });

  try {
    const health = await fetch(`${base}/api/health`);
    assert(health.status === 200, `health ${health.status}`);
    const healthBody = (await health.json()) as { status?: string };
    assert(healthBody.status === "ok", "health bukan ok");

    const dashboard = await new Promise<{ status: number; location: string }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: 3000,
          path: "/dashboard",
          method: "GET",
          headers: { Host: "perpustakaan.malikfajar.my.id" },
        },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode ?? 0, location: String(res.headers.location ?? "") });
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert(dashboard.status === 307, `dashboard tanpa sesi ${dashboard.status}, diharapkan 307`);
    assert(dashboard.location.includes("/login"), "dashboard tidak mengarah ke login");

    const guestInit = await fetch(`${base}/api/uploads/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Tamu", fileName: "a.txt", sizeBytes: 1, sha256: "a".repeat(64) }),
    });
    assert(guestInit.status === 401, `tamu init ${guestInit.status}`);
    const missing = randomUUID();
    const guestPreview = await fetch(`${base}/api/documents/${missing}/preview`);
    const guestDownload = await fetch(`${base}/api/documents/${missing}/download`);
    assert(guestPreview.status === 401, `tamu preview ${guestPreview.status}`);
    assert(guestDownload.status === 401, `tamu download ${guestDownload.status}`);

    const cookie = await signIn(user.id);
    const authHeaders = { Cookie: cookie, Origin: base };

    const note = Buffer.from("Catatan HTTP LITERIA\n");
    const opened = await fetch(`${base}/api/uploads/init`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Catatan HTTP",
        fileName: "catatan http.txt",
        sizeBytes: note.length,
        sha256: sha(note),
      }),
    });
    const openedBody = (await opened.json()) as { id?: string; documentId?: string; error?: string };
    assert(opened.status === 201, `init ${opened.status} ${openedBody.error ?? ""}`);
    assert(openedBody.id, "init tanpa id");

    const stored = await fetch(`${base}/api/uploads/${openedBody.id}/content`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/octet-stream" },
      body: new Uint8Array(note),
    });
    assert(stored.status === 200, `content ${stored.status} ${await stored.text()}`);

    const done = await fetch(`${base}/api/uploads/${openedBody.id}/complete`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ sha256: sha(note) }),
    });
    const doneBody = (await done.json()) as { status?: string; error?: string; documentId?: string };
    assert(done.status === 200 && doneBody.status === "PUBLISHED", `complete ${done.status} ${doneBody.error ?? doneBody.status}`);

    const doc = await db.document.findUniqueOrThrow({ where: { id: doneBody.documentId } });
    assert(doc.status === "PUBLISHED", "status DB bukan PUBLISHED");
    assert(!doc.objectKey.includes("catatan"), "object key memakai nama file pengguna");

    const download = await fetch(`${base}/api/documents/${doc.id}/download`, { headers: authHeaders });
    assert(download.status === 200, `download ${download.status}`);
    assert(Buffer.from(await download.arrayBuffer()).equals(note), "isi unduhan berbeda");
    const previewGuest = await fetch(`${base}/api/documents/${doc.id}/preview`);
    const downloadGuest = await fetch(`${base}/api/documents/${doc.id}/download`);
    assert(previewGuest.status === 401 && downloadGuest.status === 401, "tamu masih bisa mengunduh");

    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 7)]);
    const badInit = await fetch(`${base}/api/uploads/init`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Gambar ditolak", fileName: "foto.pdf", sizeBytes: png.length, sha256: sha(png) }),
    });
    const badInitBody = (await badInit.json()) as { id?: string; error?: string };
    assert(badInit.status === 201 && badInitBody.id, `init gambar ${badInit.status}`);
    const badSend = await fetch(`${base}/api/uploads/${badInitBody.id}/content`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/octet-stream" },
      body: new Uint8Array(png),
    });
    assert(badSend.status === 200, `kirim gambar ${badSend.status}`);
    const badDone = await fetch(`${base}/api/uploads/${badInitBody.id}/complete`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ sha256: sha(png) }),
    });
    const badDoneBody = (await badDone.json()) as { error?: string; code?: string };
    assert(badDone.status === 422 && badDoneBody.code === "REJECTED", `gambar harus ditolak, dapat ${badDone.status}`);
    const audits = await db.auditLog.count({ where: { actorId: user.id, action: "upload.complete.denied" } });
    assert(audits >= 1, "kegagalan tidak masuk audit log");

    const docx = officePackage("docx", [], 8);
    const docxInit = await fetch(`${base}/api/uploads/init`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Modul Office", fileName: "modul.docx", sizeBytes: docx.length, sha256: sha(docx) }),
    });
    const docxInitBody = (await docxInit.json()) as { id?: string; error?: string };
    assert(docxInit.status === 201 && docxInitBody.id, `init docx ${docxInit.status} ${docxInitBody.error ?? ""}`);
    const docxSend = await fetch(`${base}/api/uploads/${docxInitBody.id}/content`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/octet-stream" },
      body: new Uint8Array(docx),
    });
    assert(docxSend.status === 200, `kirim docx ${docxSend.status}`);
    const docxDone = await fetch(`${base}/api/uploads/${docxInitBody.id}/complete`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ sha256: sha(docx) }),
    });
    const docxDoneBody = (await docxDone.json()) as { status?: string; error?: string };
    assert(docxDone.status === 200 && docxDoneBody.status === "PUBLISHED", `docx ${docxDoneBody.error ?? docxDone.status}`);

    const big = Buffer.alloc(11 * 1024 * 1024, 0x61);
    big[0] = 0x43;
    const bigInit = await fetch(`${base}/api/uploads/init`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Berkas sebelas MB", fileName: "besar.txt", sizeBytes: big.length, sha256: sha(big) }),
    });
    const bigInitBody = (await bigInit.json()) as { id?: string; error?: string };
    assert(bigInit.status === 201 && bigInitBody.id, `init 11MB ${bigInit.status} ${bigInitBody.error ?? ""}`);
    const bigSend = await fetch(`${base}/api/uploads/${bigInitBody.id}/content`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/octet-stream" },
      body: new Uint8Array(big),
    });
    assert(bigSend.status === 200, `kirim 11MB ${bigSend.status} ${await bigSend.text()}`);
    const bigDone = await fetch(`${base}/api/uploads/${bigInitBody.id}/complete`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ sha256: sha(big) }),
    });
    const bigDoneBody = (await bigDone.json()) as { status?: string; error?: string };
    assert(bigDone.status === 200 && bigDoneBody.status === "PUBLISHED", `11MB ${bigDoneBody.error ?? bigDone.status}`);

    await db.user.update({ where: { id: user.id }, data: { emailVerified: false } });
    const unverified = await fetch(`${base}/api/uploads/init`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Belum verifikasi", fileName: "a.txt", sizeBytes: 4, sha256: "ab".repeat(32) }),
    });
    assert(unverified.status === 403, `belum verifikasi ${unverified.status}`);

    console.log("HTTP acceptance OK");
  } finally {
    await db.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
