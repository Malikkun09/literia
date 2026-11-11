import { crc32, inflateRawSync } from "zlib";
import { inspectPdfBytes } from "@/lib/pdf-inspect";
import type { AllowedExtension } from "@/lib/validation";

export type FileVerdict =
  | { ok: true }
  | { ok: false; status: "REJECTED" | "QUARANTINED"; message: string };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_ENTRIES = 2000;
const MAX_TOTAL_UNCOMPRESSED = 128 * 1024 * 1024;
const MAX_ENTRY_UNCOMPRESSED = 32 * 1024 * 1024;

type ZipEntry = {
  name: string;
  method: number;
  flag: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
};

const OOXML_MAIN: Record<"docx" | "pptx" | "xlsx", { part: string; contentType: string; root: RegExp }> = {
  docx: {
    part: "word/document.xml",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    root: /<w:document[\s>/]/,
  },
  pptx: {
    part: "ppt/presentation.xml",
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    root: /<p:presentation[\s>/]/,
  },
  xlsx: {
    part: "xl/workbook.xml",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    root: /<workbook[\s>/]/,
  },
};

function rejected(message: string): FileVerdict {
  return { ok: false, status: "REJECTED", message };
}

function startsWith(buffer: Buffer, text: string): boolean {
  return buffer.length >= text.length && buffer.subarray(0, text.length).toString("latin1") === text;
}

type Magic =
  | "pdf"
  | "zip"
  | "exe"
  | "elf"
  | "ole"
  | "png"
  | "jpeg"
  | "gif"
  | "webp"
  | "bmp"
  | "wav"
  | "avi"
  | "mp3"
  | "ogg"
  | "flac"
  | "mp4"
  | "webm"
  | "gzip"
  | "rar"
  | "7z"
  | "wasm"
  | "html"
  | "text"
  | "binary";

function sniff(buffer: Buffer): Magic {
  if (startsWith(buffer, "%PDF-")) return "pdf";
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
  ) {
    return "zip";
  }
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) return "exe";
  if (buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
    return "elf";
  }
  if (buffer.length >= 4 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) {
    return "ole";
  }
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (startsWith(buffer, "GIF87a") || startsWith(buffer, "GIF89a")) return "gif";
  if (startsWith(buffer, "RIFF") && buffer.length >= 12 && buffer.subarray(8, 12).toString("latin1") === "WEBP") {
    return "webp";
  }
  if (startsWith(buffer, "RIFF") && buffer.length >= 12 && buffer.subarray(8, 12).toString("latin1") === "WAVE") {
    return "wav";
  }
  if (startsWith(buffer, "RIFF") && buffer.length >= 12 && buffer.subarray(8, 12).toString("latin1") === "AVI ") {
    return "avi";
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return "bmp";
  if (startsWith(buffer, "ID3")) return "mp3";
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return "mp3";
  if (startsWith(buffer, "OggS")) return "ogg";
  if (startsWith(buffer, "fLaC")) return "flac";
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("latin1") === "ftyp") return "mp4";
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return "webm";
  }
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) return "gzip";
  if (startsWith(buffer, "Rar!")) return "rar";
  if (buffer.length >= 4 && buffer[0] === 0x37 && buffer[1] === 0x7a && buffer[2] === 0xbc && buffer[3] === 0xaf) {
    return "7z";
  }
  if (startsWith(buffer, "\0asm")) return "wasm";

  const head = buffer
    .subarray(0, Math.min(buffer.length, 512))
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart()
    .slice(0, 64)
    .toLowerCase();
  if (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.startsWith("<script") ||
    head.startsWith("<svg") ||
    head.startsWith("<?php") ||
    head.startsWith("<iframe")
  ) {
    return "html";
  }
  return looksBinary(buffer) ? "binary" : "text";
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

function forbiddenKindMessage(kind: Magic): string | null {
  switch (kind) {
    case "exe":
    case "elf":
    case "wasm":
      return "File program ditolak.";
    case "ole":
      return "File Office lama atau makro (format OLE) ditolak.";
    case "png":
    case "jpeg":
    case "gif":
    case "webp":
    case "bmp":
      return "File gambar ditolak.";
    case "wav":
    case "mp3":
    case "ogg":
    case "flac":
      return "File audio ditolak.";
    case "avi":
    case "mp4":
    case "webm":
      return "File video ditolak.";
    case "gzip":
    case "rar":
    case "7z":
      return "Arsip terkompresi ditolak.";
    case "html":
      return "File HTML atau skrip ditolak.";
    case "zip":
      return "Arsip ZIP ditolak.";
    default:
      return null;
  }
}

function unsafeZipName(name: string): boolean {
  if (name.includes("\\") || name.startsWith("/") || name.includes("\0")) return true;
  return name.split("/").some((part) => part === "..");
}

function listZip(buffer: Buffer): ZipEntry[] {
  const min = Math.max(0, buffer.length - 22 - 65535);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) !== EOCD) continue;
    const commentLen = buffer.readUInt16LE(i + 20);
    if (i + 22 + commentLen === buffer.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Bukan arsip ZIP yang valid.");

  const count = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw new Error("Paket berisi terlalu banyak berkas.");
  if (cdOffset > buffer.length || cdSize > buffer.length || cdOffset + cdSize > buffer.length) {
    throw new Error("Direktori paket rusak.");
  }

  const entries: ZipEntry[] = [];
  let cursor = cdOffset;
  let totalUncompressed = 0;
  for (let n = 0; n < count; n++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL) {
      throw new Error("Direktori paket rusak.");
    }
    const flag = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error("Paket ZIP64 tidak didukung.");
    }
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > buffer.length) throw new Error("Direktori paket rusak.");
    const name = buffer.subarray(nameStart, nameEnd).toString("utf8");
    if (unsafeZipName(name)) throw new Error("Nama berkas di dalam paket tidak aman.");
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) throw new Error("Paket terlalu besar saat dibuka.");
    entries.push({ name, method, flag, crc, compressedSize, uncompressedSize, localOffset });
    cursor = nameEnd + extraLen + commentLen;
  }
  return entries;
}

function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  if (entry.flag & 0x1) throw new Error("Paket terenkripsi ditolak.");
  if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED) throw new Error("Berkas di dalam paket terlalu besar.");
  if (entry.localOffset + 30 > buffer.length || buffer.readUInt32LE(entry.localOffset) !== LOCAL) {
    throw new Error("Header paket rusak.");
  }
  const nameLen = buffer.readUInt16LE(entry.localOffset + 26);
  const extraLen = buffer.readUInt16LE(entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) throw new Error("Data paket terpotong.");
  const compressed = buffer.subarray(dataStart, dataEnd);
  let out: Buffer;
  if (entry.method === 0) {
    if (compressed.length !== entry.uncompressedSize) throw new Error("Ukuran berkas di dalam paket tidak konsisten.");
    out = Buffer.from(compressed);
  } else if (entry.method === 8) {
    try {
      out = inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize });
    } catch {
      throw new Error("Paket rusak dan tidak bisa dibuka.");
    }
  } else {
    throw new Error("Metode kompresi paket tidak didukung.");
  }
  if (out.length !== entry.uncompressedSize) throw new Error("Ukuran berkas di dalam paket tidak konsisten.");
  if ((crc32(out) >>> 0) !== entry.crc) throw new Error("Checksum di dalam paket tidak cocok.");
  return out;
}

function findEntry(entries: ZipEntry[], name: string): ZipEntry | undefined {
  const wanted = name.toLowerCase();
  return entries.find((entry) => entry.name.toLowerCase() === wanted);
}

function dangerousEntry(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith("/")) return false;
  if (lower.includes("vbaproject") || lower.includes("vbaData".toLowerCase())) return true;
  if (lower.includes("oleobject") || lower.includes("embeddings/") || lower.includes("activex")) return true;
  return /\.(exe|dll|js|mjs|cjs|html?|hta|bat|cmd|ps1|scr|docm|xlsm|pptm)$/.test(lower);
}

function inspectOoxml(buffer: Buffer, extension: "docx" | "pptx" | "xlsx"): FileVerdict {
  let entries: ZipEntry[];
  try {
    entries = listZip(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Paket dokumen rusak.";
    return rejected(message);
  }

  for (const entry of entries) {
    if (dangerousEntry(entry.name)) {
      return rejected("Paket berisi macro, skrip, atau objek aktif dan ditolak.");
    }
  }

  const spec = OOXML_MAIN[extension];
  const contentTypes = findEntry(entries, "[Content_Types].xml");
  const relationships = findEntry(entries, "_rels/.rels");
  const main = findEntry(entries, spec.part);
  if (!contentTypes || !relationships || !main) return rejected("Struktur paket Office tidak lengkap.");

  let typesXml = "";
  let relsXml = "";
  let mainXml = "";
  try {
    typesXml = readZipEntry(buffer, contentTypes).toString("utf8");
    relsXml = readZipEntry(buffer, relationships).toString("utf8");
    mainXml = readZipEntry(buffer, main).toString("utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Paket dokumen rusak.";
    return rejected(message);
  }

  const typesLower = typesXml.toLowerCase();
  if (
    typesLower.includes("macroenabled") ||
    typesLower.includes("vbaproject") ||
    typesLower.includes("activex") ||
    typesLower.includes("text/html") ||
    typesLower.includes("javascript")
  ) {
    return rejected("Paket Office berisi macro, HTML, atau skrip dan ditolak.");
  }
  if (!typesLower.includes("<types") || !typesLower.includes(spec.contentType.toLowerCase())) {
    return rejected("Jenis paket Office tidak sesuai dengan ekstensi file.");
  }
  if (!relsXml.includes("<Relationships") || !relsXml.includes(spec.part)) {
    return rejected("Struktur paket Office tidak lengkap.");
  }
  const mainHead = mainXml.trimStart().slice(0, 4000);
  if (!spec.root.test(mainHead)) return rejected("Isi dokumen Office rusak.");
  if (/<script[\s>]/i.test(mainXml)) return rejected("Dokumen berisi skrip dan ditolak.");
  return { ok: true };
}

function decodePlainText(buffer: Buffer): { text: string } | FileVerdict {
  if (buffer.includes(0)) return rejected("File teks berisi data biner dan ditolak.");
  for (const byte of buffer) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte < 32 || byte === 127) return rejected("File teks berisi data biner dan ditolak.");
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
    return { text };
  } catch {
    return rejected("File teks harus UTF-8 yang valid.");
  }
}

function inspectText(buffer: Buffer): FileVerdict {
  const decoded = decodePlainText(buffer);
  if (!("text" in decoded)) return decoded;
  return inspectDecodedText(decoded.text);
}

function inspectDecodedText(text: string): FileVerdict {
  const trimmed = text.trimStart();
  const head = trimmed.slice(0, 200).toLowerCase();
  if (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.startsWith("<script") ||
    head.startsWith("<svg") ||
    head.startsWith("<?php") ||
    head.startsWith("<iframe") ||
    /<script[\s>]/i.test(trimmed.slice(0, 4000))
  ) {
    return rejected("File HTML atau skrip ditolak.");
  }
  if (/^#!/.test(trimmed) || /^(import\s|export\s|['"]use strict['"])/.test(trimmed)) {
    return rejected("File JavaScript atau skrip ditolak.");
  }
  return { ok: true };
}

function formulaCell(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  const first = value[0];
  if (first === "=" || first === "@" || first === "\t") return true;
  if (first === "+") return !/^\+\d[\d\s().-]*$/.test(value);
  if (first === "-") return !/^-(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value);
  return false;
}

function csvHasFormula(text: string): boolean {
  let field = "";
  let inQuotes = false;
  const flush = (): boolean => {
    const dangerous = formulaCell(field);
    field = "";
    return dangerous;
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === "," || char === ";" || char === "\t" || char === "\n" || char === "\r") {
      if (flush()) return true;
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      continue;
    }
    field += char;
  }
  return flush();
}

function inspectCsv(buffer: Buffer): FileVerdict {
  const decoded = decodePlainText(buffer);
  if (!("text" in decoded)) return decoded;
  const verdict = inspectDecodedText(decoded.text);
  if (!verdict.ok) return verdict;
  if (csvHasFormula(decoded.text)) return rejected("CSV berisi rumus spreadsheet dan ditolak.");
  return { ok: true };
}

export function inspectUpload(buffer: Buffer, extension: AllowedExtension): FileVerdict {
  if (buffer.length === 0) return rejected("File kosong ditolak.");
  const kind = sniff(buffer);

  if (extension === "pdf") {
    if (kind !== "pdf") return rejected(forbiddenKindMessage(kind) ?? "Isi file tidak sesuai ekstensi PDF.");
    return inspectPdfBytes(buffer);
  }

  if (extension === "docx" || extension === "pptx" || extension === "xlsx") {
    if (kind !== "zip") return rejected(forbiddenKindMessage(kind) ?? "Isi file bukan paket Office yang valid.");
    return inspectOoxml(buffer, extension);
  }

  const blocked = forbiddenKindMessage(kind);
  if (blocked || kind === "binary" || kind === "pdf" || kind === "zip") {
    return rejected(blocked ?? "Isi file tidak sesuai dokumen teks.");
  }
  if (extension === "csv") return inspectCsv(buffer);
  return inspectText(buffer);
}
