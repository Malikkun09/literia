import assert from "node:assert/strict";
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
  });
});

describe("isi berkas", () => {
  it("menerima PDF, Office, teks, dan CSV yang valid", () => {
    assert.equal(inspectUpload(pdf, "pdf").ok, true);
    assert.equal(inspectUpload(officePackage("docx"), "docx").ok, true);
    assert.equal(inspectUpload(officePackage("pptx", [], 8), "pptx").ok, true);
    assert.equal(inspectUpload(officePackage("xlsx"), "xlsx").ok, true);
    assert.equal(inspectUpload(Buffer.from("Catatan komunitas\nBaris kedua\n"), "txt").ok, true);
    assert.equal(inspectUpload(Buffer.from("nama,nilai\nAni,90\n"), "csv").ok, true);
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
    assert.equal(inspectUpload(zip, "docx").ok, false);
    assert.equal(inspectUpload(zip, "txt").ok, false);
    const macroVerdict = inspectUpload(macro, "docx");
    assert.equal(macroVerdict.ok, false);
    if (!macroVerdict.ok) assert.equal(macroVerdict.status, "REJECTED");
  });

  it("mengarantina PDF berisi skrip", () => {
    const active = Buffer.from("%PDF-1.4\n1 0 obj<</JavaScript (alert)>>endobj\n%%EOF\n");
    const verdict = inspectUpload(active, "pdf");
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.equal(verdict.status, "QUARANTINED");
  });

  it("menolak nama berkas berbahaya di dalam paket", () => {
    const slipped = buildZip([
      { name: "../rahasia.txt", data: Buffer.from("x") },
      { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
    ]);
    const verdict = inspectUpload(slipped, "docx");
    assert.equal(verdict.ok, false);
  });
});
