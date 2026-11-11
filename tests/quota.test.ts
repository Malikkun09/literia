import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { db } from "../src/lib/db";
import { getStorage, readVerifiedObject } from "../src/lib/storage";
import { UploadError } from "../src/lib/upload-error";
import { completeUpload, getQuotaSnapshot, initUpload, saveUploadContent } from "../src/lib/uploads";
import { officePackage } from "./zip-fixture";

const createdUsers: string[] = [];

function sha(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function makeUser(quota: bigint) {
  const user = await db.user.create({
    data: {
      name: "Penguji Kuota",
      email: `phase2-${randomUUID()}@literia.test`,
      emailVerified: true,
      status: "ACTIVE",
      storageQuotaBytes: quota,
    },
  });
  createdUsers.push(user.id);
  return user;
}

async function publish(userId: string, fileName: string, body: Buffer, title = "Catatan uji kuota") {
  const opened = await initUpload(userId, {
    title,
    fileName,
    sizeBytes: body.length,
    sha256: sha(body),
  });
  await saveUploadContent(userId, opened.id, body);
  const done = await completeUpload(userId, opened.id, sha(body));
  return { opened, done };
}

after(async () => {
  if (createdUsers.length > 0) {
    await db.user.deleteMany({ where: { id: { in: createdUsers } } });
  }
  await db.$disconnect();
});

describe("kuota atomik", () => {
  it("menerbitkan file valid dan menolak file terlarang tanpa menahan kuota", async () => {
    const user = await makeUser(BigInt(10000));
    const note = Buffer.from("Catatan komunitas LITERIA untuk diuji.\n");
    const published = await publish(user.id, "catatan-komunitas.txt", note, "Catatan komunitas");
    assert.equal(published.done.status, "PUBLISHED");

    const document = await db.document.findUniqueOrThrow({ where: { id: published.opened.documentId } });
    assert.equal(document.status, "PUBLISHED");
    assert.equal(document.originalFileName, "catatan-komunitas.txt");
    assert.match(document.objectKey, /^\d{4}\/[0-9a-f-]{36}\.txt$/);
    assert.equal(document.objectKey.includes("catatan"), false);
    assert.equal(await getStorage().exists(document.objectKey), true);

    const fresh = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(fresh.storageUsedBytes, BigInt(note.length));

    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32, 1),
    ]);
    const bad = await initUpload(user.id, {
      title: "Gambar menyamar",
      fileName: "gambar.pdf",
      sizeBytes: png.length,
      sha256: sha(png),
    });
    await saveUploadContent(user.id, bad.id, png);
    await assert.rejects(() => completeUpload(user.id, bad.id, sha(png)), (error: unknown) => {
      assert.ok(error instanceof UploadError);
      assert.equal(error.code, "REJECTED");
      return true;
    });

    const rejected = await db.document.findUniqueOrThrow({ where: { id: bad.documentId } });
    assert.equal(rejected.status, "REJECTED");
    assert.equal(await getStorage().exists(rejected.objectKey), false);
    const afterReject = await getQuotaSnapshot(user.id);
    assert.equal(afterReject.usedBytes, BigInt(note.length));
    assert.equal(afterReject.reservedBytes, BigInt(0));

    const docx = officePackage("docx");
    const office = await publish(user.id, "modul.docx", docx, "Modul pemrograman");
    assert.equal(office.done.status, "PUBLISHED");
  });

  it("melepas reservasi kalau checksum atau ukuran gagal", async () => {
    const user = await makeUser(BigInt(5000));
    const body = Buffer.from("teks yang sah untuk checksum\n");
    const opened = await initUpload(user.id, {
      title: "Checksum gagal",
      fileName: "catatan.txt",
      sizeBytes: body.length,
      sha256: sha(body),
    });
    const tampered = Buffer.from("teks yang beda panjangnya");
    assert.notEqual(tampered.length, body.length);
    await assert.rejects(() => saveUploadContent(user.id, opened.id, tampered), (error: unknown) => {
      assert.ok(error instanceof UploadError);
      assert.equal(error.code, "REJECTED");
      return true;
    });
    let quota = await getQuotaSnapshot(user.id);
    assert.equal(quota.reservedBytes, BigInt(0));
    assert.equal(quota.usedBytes, BigInt(0));

    const again = await initUpload(user.id, {
      title: "Checksum beda isi",
      fileName: "catatan.txt",
      sizeBytes: body.length,
      sha256: sha(body),
    });
    const sameSize = Buffer.from("x".repeat(body.length));
    await saveUploadContent(user.id, again.id, sameSize);
    await assert.rejects(() => completeUpload(user.id, again.id), (error: unknown) => {
      assert.ok(error instanceof UploadError);
      assert.equal(error.code, "REJECTED");
      return true;
    });
    quota = await getQuotaSnapshot(user.id);
    assert.equal(quota.reservedBytes, BigInt(0));
    assert.equal(quota.usedBytes, BigInt(0));

    const retry = await publish(user.id, "catatan.txt", body, "Berhasil setelah gagal");
    assert.equal(retry.done.status, "PUBLISHED");
  });

  it("menolak unggahan di atas sisa kuota dan dua unggahan bersamaan", async () => {
    const user = await makeUser(BigInt(1000));
    await assert.rejects(
      () =>
        initUpload(user.id, {
          title: "Terlalu besar",
          fileName: "besar.txt",
          sizeBytes: 1001,
          sha256: sha(Buffer.from("x")),
        }),
      (error: unknown) => {
        assert.ok(error instanceof UploadError);
        assert.equal(error.code, "QUOTA");
        return true;
      },
    );

    for (let round = 0; round < 12; round++) {
      const racer = await makeUser(BigInt(1000));
      const attempts = await Promise.allSettled([
        initUpload(racer.id, {
          title: `Serentak satu ${round}`,
          fileName: "a.txt",
          sizeBytes: 800,
          sha256: "a".repeat(64),
        }),
        initUpload(racer.id, {
          title: `Serentak dua ${round}`,
          fileName: "b.txt",
          sizeBytes: 800,
          sha256: "b".repeat(64),
        }),
      ]);
      const fulfilled = attempts.filter((item) => item.status === "fulfilled");
      const rejected = attempts.filter((item) => item.status === "rejected");
      assert.equal(fulfilled.length, 1, `ronde ${round} harus satu yang lolos`);
      assert.equal(rejected.length, 1, `ronde ${round} harus satu yang ditolak`);
      const reason = rejected[0];
      assert.equal(reason.status, "rejected");
      assert.ok(reason.reason instanceof UploadError);
      assert.equal(reason.reason.code, "QUOTA");
      const quota = await getQuotaSnapshot(racer.id);
      assert.equal(quota.usedBytes, BigInt(0));
      assert.equal(quota.reservedBytes, BigInt(800));
      const sessions = await db.uploadSession.count({ where: { userId: racer.id, status: "RESERVED" } });
      assert.equal(sessions, 1);
    }
  });

  it("karantina tetap dihitung ke kuota", async () => {
    const active = Buffer.from("%PDF-1.4\n1 0 obj<</JavaScript (alert)>>endobj\n%%EOF\n");
    const user = await makeUser(BigInt(active.length * 2));
    const opened = await initUpload(user.id, {
      title: "PDF aktif",
      fileName: "aktif.pdf",
      sizeBytes: active.length,
      sha256: sha(active),
    });
    await saveUploadContent(user.id, opened.id, active);
    await assert.rejects(() => completeUpload(user.id, opened.id), (error: unknown) => {
      assert.ok(error instanceof UploadError);
      assert.equal(error.code, "QUARANTINED");
      assert.match(error.message, /dihitung ke kuota/);
      assert.doesNotMatch(error.message, /dikembalikan/);
      return true;
    });
    const document = await db.document.findUniqueOrThrow({ where: { id: opened.documentId } });
    assert.equal(document.status, "QUARANTINED");
    assert.equal(await getStorage().exists(document.objectKey), true);
    const quota = await getQuotaSnapshot(user.id);
    assert.equal(quota.usedBytes, BigInt(active.length));
    assert.equal(quota.reservedBytes, BigInt(0));

    const note = Buffer.from("x".repeat(active.length));
    const published = await publish(user.id, "catatan.txt", note, "Setelah karantina");
    assert.equal(published.done.status, "PUBLISHED");
    const full = await getQuotaSnapshot(user.id);
    assert.equal(full.usedBytes, BigInt(active.length * 2));
    assert.equal(full.reservedBytes, BigInt(0));
    await assert.rejects(
      () =>
        initUpload(user.id, {
          title: "Melebihi sisa",
          fileName: "lagi.txt",
          sizeBytes: 1,
          sha256: sha(Buffer.from("x")),
        }),
      (error: unknown) => {
        assert.ok(error instanceof UploadError);
        assert.equal(error.code, "QUOTA");
        return true;
      },
    );
  });

  it("penulisan setelah terbit tidak menimpa berkas yang sudah diperiksa", async () => {
    const user = await makeUser(BigInt(10000));
    const good = Buffer.from("teks asli yang sudah diperiksa\n");
    const published = await publish(user.id, "catatan.txt", good, "Sudah diperiksa");
    const document = await db.document.findUniqueOrThrow({ where: { id: published.opened.documentId } });
    const sameLength = Buffer.from("Y".repeat(good.length));
    await assert.rejects(() => saveUploadContent(user.id, published.opened.id, sameLength), (error: unknown) => {
      assert.ok(error instanceof UploadError);
      assert.equal(error.code, "CONFLICT");
      return true;
    });
    await assert.rejects(() => saveUploadContent(user.id, published.opened.id, Buffer.from("pendek")), (error: unknown) => {
      assert.ok(error instanceof UploadError);
      assert.equal(error.code, "CONFLICT");
      return true;
    });
    const stored = await getStorage().get(document.objectKey);
    assert.equal(sha(stored), sha(good));
    assert.ok(Buffer.isBuffer(await readVerifiedObject(document.objectKey, document.sha256)));
    await getStorage().put(document.objectKey, sameLength, document.mimeType);
    assert.equal(await readVerifiedObject(document.objectKey, document.sha256), "mismatch");
  });

  it("dua penulisan bersamaan tidak menerbitkan byte yang tidak diperiksa", async () => {
    const user = await makeUser(BigInt(100000));
    const good = Buffer.from("teks yang lolos pemeriksaan kuota\n");
    const bad = Buffer.from("Z".repeat(good.length));
    for (let round = 0; round < 8; round += 1) {
      const opened = await initUpload(user.id, {
        title: `Balapan isi ${round}`,
        fileName: "catatan.txt",
        sizeBytes: good.length,
        sha256: sha(good),
      });
      await saveUploadContent(user.id, opened.id, good);
      await Promise.allSettled([
        saveUploadContent(user.id, opened.id, bad),
        completeUpload(user.id, opened.id, sha(good)),
      ]);
      const document = await db.document.findUniqueOrThrow({ where: { id: opened.documentId } });
      if (document.status === "PUBLISHED") {
        const stored = await getStorage().get(document.objectKey);
        assert.equal(sha(stored), sha(good));
        assert.equal(document.sha256, sha(good));
        continue;
      }
      assert.equal(document.status, "REJECTED");
      assert.equal(await getStorage().exists(document.objectKey), false);
      const quota = await getQuotaSnapshot(user.id);
      assert.equal(quota.reservedBytes, BigInt(0));
    }
  });
});
