import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { describe, it } from "node:test";
import { extensionError } from "../src/lib/file-types";
import { inspectUpload } from "../src/lib/file-inspect";
import { buildZip, officePackage } from "./zip-fixture";

const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

describe("ekstensi", () => {
  it("menolak macro, gambar, skrip, dan nama yang menyamar", () => {
    assert.match(extensionError("makro.docm") ?? "", /macro/i);
    assert.match(extensionError("makro.xlsm") ?? "", /macro/i);
    assert.match(extensionError("makro.pptm") ?? "", /macro/i);
    assert.match(extensionError("arsip.zip") ?? "", /zip/i);
    assert.match(extensionError("app.exe") ?? "", /program/i);
    assert.match(extensionError("skrip.js") ?? "", /JavaScript/i);
    assert.match(extensionError("halaman.html") ?? "", /HTML/i);
    assert.match(extensionError("foto.png") ?? "", /Gambar/i);
    assert.match(extensionError("lagu.mp3") ?? "", /Audio/i);
    assert.match(extensionError("film.mp4") ?? "", /Video/i);
    assert.match(extensionError("rahasia.exe.pdf") ?? "", /menyembunyikan/i);
    assert.equal(extensionError("catatan.txt"), null);
    assert.equal(extensionError("modul.DOCX"), null);
    assert.match(extensionError("foo.__proto__") ?? "", /tidak diizinkan/);
    assert.match(extensionError("foo.constructor") ?? "", /tidak diizinkan/);
    assert.equal(typeof extensionError("foo.toString"), "string");
  });
});

describe("isi berkas", () => {
  it("menerima PDF, Office, teks, dan CSV yang valid", () => {
    assert.equal(inspectUpload(pdf, "pdf").ok, true);
    assert.equal(inspectUpload(officePackage("docx"), "docx").ok, true);
    assert.equal(inspectUpload(officePackage("pptx", [], 8), "pptx").ok, true);
    assert.equal(inspectUpload(officePackage("xlsx"), "xlsx").ok, true);
    assert.equal(inspectUpload(Buffer.from("Catatan komunitas\nBaris kedua\n"), "txt").ok, true);
    assert.equal(inspectUpload(Buffer.from("nama,nilai\nAni,90\nBudi,-1.5\n"), "csv").ok, true);
    assert.equal(inspectUpload(Buffer.from("telepon\n+62 812-3456-7890\n"), "csv").ok, true);
  });

  it("menolak berkas terlarang, rusak, dan macro", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(16)]);
    const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(8)]);
    const html = Buffer.from("<!DOCTYPE html><html><body>x</body></html>");
    const script = Buffer.from('import x from "y";\n');
    const zip = buildZip([{ name: "halo.txt", data: Buffer.from("halo") }]);
    const macro = officePackage("docx", [
      {
        name: "word/vbaProject.bin",
        data: Buffer.from("macro"),
      },
    ]);

    assert.equal(inspectUpload(png, "pdf").ok, false);
    assert.equal(inspectUpload(exe, "pdf").ok, false);
    assert.equal(inspectUpload(Buffer.from("%PDF-1.4\ntrailer\n"), "pdf").ok, false);
    assert.equal(inspectUpload(wav, "txt").ok, false);
    assert.equal(inspectUpload(html, "txt").ok, false);
    assert.equal(inspectUpload(script, "csv").ok, false);
    const formula = inspectUpload(Buffer.from('nama,nilai\nAni,"=cmd|\'/c calc\'!A0"\n'), "csv");
    assert.equal(formula.ok, false);
    if (!formula.ok) assert.match(formula.message, /rumus/);
    assert.equal(inspectUpload(Buffer.from("nama;rumus\nAni;@SUM(A1)\n"), "csv").ok, false);
    assert.equal(inspectUpload(zip, "docx").ok, false);
    assert.equal(inspectUpload(zip, "txt").ok, false);
    const macroVerdict = inspectUpload(macro, "docx");
    assert.equal(macroVerdict.ok, false);
    if (!macroVerdict.ok) assert.equal(macroVerdict.status, "REJECTED");

    const brokenOffice = buildZip([
      {
        name: "[Content_Types].xml",
        data: Buffer.from(
          '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        ),
      },
      {
        name: "_rels/.rels",
        data: Buffer.from('<Relationships><Relationship Target="word/document.xml"/></Relationships>'),
      },
      { name: "word/document.xml", data: Buffer.from("<bukan-dokumen/>") },
    ]);
    assert.equal(inspectUpload(brokenOffice, "docx").ok, false);
  });

  it("mengarantina PDF berisi skrip", () => {
    const active = Buffer.from("%PDF-1.4\n1 0 obj<</JavaScript (alert)>>endobj\n%%EOF\n");
    const verdict = inspectUpload(active, "pdf");
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.equal(verdict.status, "QUARANTINED");

    const crOnly = Buffer.from("%PDF-1.4\r1 0 obj<</JavaScript (alert)>>endobj\r%%EOF\r");
    const crVerdict = inspectUpload(crOnly, "pdf");
    assert.equal(crVerdict.ok, false);
    if (!crVerdict.ok) assert.equal(crVerdict.status, "QUARANTINED");

    const comment = Buffer.from("%PDF-1.4\r% /JavaScript hanya komentar\r1 0 obj<<>>endobj\r%%EOF\r");
    assert.equal(inspectUpload(comment, "pdf").ok, true);

    const attachment = Buffer.from("%PDF-1.4\n1 0 obj<</Subtype /FileAttachment /FS << /F (rahasia.pdf) >>>>endobj\n%%EOF\n");
    const attachmentVerdict = inspectUpload(attachment, "pdf");
    assert.equal(attachmentVerdict.ok, false);
    if (!attachmentVerdict.ok) assert.equal(attachmentVerdict.status, "QUARANTINED");
  });

  it("menolak nama berkas berbahaya di dalam paket", () => {
    const slipped = officePackage("docx", [{ name: "../rahasia.txt", data: Buffer.from("x") }]);
    const verdict = inspectUpload(slipped, "docx");
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.match(verdict.message, /tidak aman/);

    const activex = officePackage("docx", [{ name: "word/activeX/activeX1.xml", data: Buffer.from("<ax/>") }]);
    const active = inspectUpload(activex, "docx");
    assert.equal(active.ok, false);
    if (!active.ok) {
      assert.equal(active.status, "REJECTED");
      assert.match(active.message, /objek aktif/);
    }
  });

  it("memeriksa objek PDF yang disembunyikan di stream terkompresi", () => {
    const benign = deflateSync(Buffer.from("BT (Halo Literia) Tj ET"));
    assert.equal(inspectUpload(pdfStream("/Filter /FlateDecode", benign), "pdf").ok, true);

    const hiddenScript = deflateSync(Buffer.from("9 0 << /S /JavaScript /JS (alert) >>"));
    const scriptPdf = pdfStream("/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode", hiddenScript);
    assert.equal(scriptPdf.includes(Buffer.from("/JavaScript")), false);
    assert.equal(scriptPdf.includes(Buffer.from("/JS")), false);
    const scriptVerdict = inspectUpload(scriptPdf, "pdf");
    assert.equal(scriptVerdict.ok, false);
    if (!scriptVerdict.ok) assert.equal(scriptVerdict.status, "QUARANTINED");

    const hiddenFile = deflateSync(Buffer.from("9 0 << /Type /EmbeddedFile /F (rahasia.pdf) >>"));
    const filePdf = pdfStream("/Filter /FlateDecode", hiddenFile);
    assert.equal(filePdf.includes(Buffer.from("/EmbeddedFile")), false);
    const fileVerdict = inspectUpload(filePdf, "pdf");
    assert.equal(fileVerdict.ok, false);
    if (!fileVerdict.ok) assert.equal(fileVerdict.status, "QUARANTINED");

    const hexName = Buffer.from("%PDF-1.4\n1 0 obj<</#4A#53 (alert)>>endobj\n%%EOF\n");
    assert.equal(hexName.includes(Buffer.from("/JS")), false);
    const hexVerdict = inspectUpload(hexName, "pdf");
    assert.equal(hexVerdict.ok, false);
    if (!hexVerdict.ok) assert.equal(hexVerdict.status, "QUARANTINED");

    const resumed = Buffer.from("%PDF-1.4\n1 0 obj<< /A < /JavaScript >>endobj\n%%EOF\n");
    const resumedVerdict = inspectUpload(resumed, "pdf");
    assert.equal(resumedVerdict.ok, false);
    if (!resumedVerdict.ok) assert.equal(resumedVerdict.status, "QUARANTINED");
    assert.equal(inspectUpload(Buffer.from("%PDF-1.4\n1 0 obj<< /Hex <4A53> >>endobj\n%%EOF\n"), "pdf").ok, true);
  });

  it("menolak PDF yang stream aktifnya tidak bisa dibuka", () => {
    const opaque = pdfStream("/Filter /LZWDecode", Buffer.from("xxxx"));
    const verdict = inspectUpload(opaque, "pdf");
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.equal(verdict.status, "REJECTED");

    const encrypted = Buffer.from("%PDF-1.4\n1 0 obj<< /Encrypt 2 0 R >>endobj\n%%EOF\n");
    const locked = inspectUpload(encrypted, "pdf");
    assert.equal(locked.ok, false);
    if (!locked.ok) assert.equal(locked.status, "REJECTED");
  });

  it("tetap menerima gambar PDF dan kata stream di dalam teks", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const image = pdfStream(
      "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode",
      jpeg,
    );
    assert.equal(inspectUpload(image, "pdf").ok, true);
    const mention = Buffer.from("%PDF-1.4\n1 0 obj<<(stream\nhello)>>endobj\n%%EOF\n");
    assert.equal(inspectUpload(mention, "pdf").ok, true);

    const body = deflateSync(Buffer.from("BT (Halo) Tj ET"));
    const indirect = Buffer.concat([
      Buffer.from("%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode /Length 3 0 R >>\nstream\n"),
      body,
      Buffer.from("\nendstream\nendobj\n2 0 obj\n<< /Filter /FlateDecode /Length 4 0 R >>\nstream\n"),
      body,
      Buffer.from(`\nendstream\nendobj\n3 0 obj\n${body.length}\nendobj\n4 0 obj\n${body.length}\nendobj\n%%EOF\n`),
    ]);
    assert.equal(inspectUpload(indirect, "pdf").ok, true);

    const revisedBody = Buffer.from("BT (Revisi) Tj ET");
    const older = Array.from({ length: 8 }, (_, index) => `2 0 obj\n${index}\nendobj\n`).join("");
    const revised = Buffer.concat([
      Buffer.from("%PDF-1.4\n1 0 obj\n<< /Length 2 0 R >>\nstream\n"),
      revisedBody,
      Buffer.from(`\nendstream\nendobj\n${older}2 0 obj\n${revisedBody.length}\nendobj\n%%EOF\n`),
    ]);
    assert.equal(inspectUpload(revised, "pdf").ok, true);

    const crHidden = deflateSync(Buffer.from("9 0 << /S /JavaScript /JS (alert) >>"));
    const crStream = Buffer.concat([
      Buffer.from(`%PDF-1.4\r1 0 obj\r<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${crHidden.length} >>\rstream\r`),
      crHidden,
      Buffer.from("\rendstream\rendobj\r%%EOF\r"),
    ]);
    assert.equal(crStream.includes(Buffer.from("/JavaScript")), false);
    const crStreamVerdict = inspectUpload(crStream, "pdf");
    assert.equal(crStreamVerdict.ok, false);
    if (!crStreamVerdict.ok) assert.equal(crStreamVerdict.status, "QUARANTINED");
  });
});

function pdfStream(dictInner: string, body: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj\n<< ${dictInner} /Length ${body.length} >>\nstream\n`),
    body,
    Buffer.from("\nendstream\nendobj\n%%EOF\n"),
  ]);
}
