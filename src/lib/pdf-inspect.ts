import { inflateSync } from "zlib";

export type PdfVerdict =
  | { ok: true }
  | { ok: false; status: "REJECTED" | "QUARANTINED"; message: string };

const MAX_STREAM_OUTPUT = 64 * 1024 * 1024;
const MAX_TOTAL_OUTPUT = 128 * 1024 * 1024;
const DICT_LOOKBACK = 64 * 1024;

const ACTIVE_NAMES = new Set([
  "JavaScript",
  "JS",
  "Launch",
  "EmbeddedFile",
  "EmbeddedFiles",
  "RichMedia",
  "XFA",
  "SubmitForm",
  "ImportData",
  "FileAttachment",
]);

const SKIP_BODY = new Set(["Image", "XRef", "FontFile", "FontFile2", "FontFile3"]);

class PdfInspectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfInspectError";
  }
}

function rejected(message: string): PdfVerdict {
  return { ok: false, status: "REJECTED", message };
}

function quarantined(): PdfVerdict {
  return {
    ok: false,
    status: "QUARANTINED",
    message: "PDF berisi skrip atau lampiran aktif dan dikarantina.",
  };
}

function isPdfSpace(byte: number): boolean {
  return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
}

function isDelimiter(byte: number | undefined): boolean {
  if (byte === undefined) return true;
  return (
    byte <= 32 ||
    byte === 0x28 ||
    byte === 0x29 ||
    byte === 0x3c ||
    byte === 0x3e ||
    byte === 0x5b ||
    byte === 0x5d ||
    byte === 0x7b ||
    byte === 0x7d ||
    byte === 0x2f ||
    byte === 0x25
  );
}

function readName(text: string, slash: number): { name: string; next: number } {
  let i = slash + 1;
  let name = "";
  while (i < text.length) {
    const char = text[i];
    if (char === "#") {
      const hex = text.slice(i + 1, i + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) break;
      name += String.fromCharCode(Number.parseInt(hex, 16));
      i += 3;
      continue;
    }
    const code = char.charCodeAt(0);
    if (code <= 32 || "()<>[]{}/%".includes(char)) break;
    name += char;
    i += 1;
  }
  return { name, next: i };
}

function skipLiteralString(text: string, start: number): number {
  let depth = 1;
  for (let i = start + 1; i < text.length; i += 1) {
    const char = text[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

function pdfNames(text: string): string[] {
  const names: string[] = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "%") {
      let j = i + 1;
      while (j < text.length && text[j] !== "\n" && text[j] !== "\r") j += 1;
      if (text[j] === "\r" && text[j + 1] === "\n") j += 1;
      i = j < text.length ? j + 1 : text.length;
      continue;
    }
    if (char === "(") {
      i = skipLiteralString(text, i);
      continue;
    }
    if (char === "<") {
      if (text[i + 1] === "<") {
        i += 2;
        continue;
      }
      let j = i + 1;
      let closed = false;
      while (j < text.length) {
        const hexChar = text[j];
        if (hexChar === ">") {
          closed = true;
          j += 1;
          break;
        }
        const code = hexChar.charCodeAt(0);
        const hexDigit =
          (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
        if (!hexDigit && code > 32) break;
        j += 1;
      }
      i = closed ? j : Math.max(j, i + 1);
      continue;
    }
    if (char === ">") {
      i += text[i + 1] === ">" ? 2 : 1;
      continue;
    }
    if (char === "/") {
      const token = readName(text, i);
      if (token.name) names.push(token.name);
      i = token.next;
      continue;
    }
    i += 1;
  }
  return names;
}

function classifyNames(text: string): "encrypt" | "active" | "clean" {
  let active = false;
  for (const name of pdfNames(text)) {
    if (name === "Encrypt") return "encrypt";
    if (ACTIVE_NAMES.has(name)) active = true;
  }
  return active ? "active" : "clean";
}

function findStream(buffer: Buffer, from: number): number {
  let pos = from;
  while (pos < buffer.length) {
    const idx = buffer.indexOf("stream", pos);
    if (idx < 0) return -1;
    const before = idx > 0 ? buffer[idx - 1] : undefined;
    const after = idx + 6;
    const crlf = buffer[after] === 0x0d && buffer[after + 1] === 0x0a;
    const eol = crlf || buffer[after] === 0x0a || buffer[after] === 0x0d;
    if (isDelimiter(before) && eol) return idx;
    pos = idx + 6;
  }
  return -1;
}

function dictCloseIndex(buffer: Buffer, streamIdx: number): number | null {
  let i = streamIdx - 1;
  while (i >= 0 && isPdfSpace(buffer[i])) i -= 1;
  if (i < 1 || buffer[i] !== 0x3e || buffer[i - 1] !== 0x3e) return null;
  return i;
}

function dictionaryBefore(buffer: Buffer, streamIdx: number): string | null {
  const close = dictCloseIndex(buffer, streamIdx);
  if (close === null) return null;
  let depth = 0;
  const limit = Math.max(0, streamIdx - DICT_LOOKBACK);
  for (let j = close; j >= limit; j -= 1) {
    if (buffer[j] === 0x3e && j > 0 && buffer[j - 1] === 0x3e) {
      depth += 1;
      j -= 1;
      continue;
    }
    if (buffer[j] === 0x3c && j > 0 && buffer[j - 1] === 0x3c) {
      depth -= 1;
      if (depth === 0) return buffer.subarray(j - 1, close + 1).toString("latin1");
      j -= 1;
    }
  }
  throw new PdfInspectError("PDF berisi stream yang tidak bisa diperiksa.");
}

function topLevelNames(dict: string): string[] {
  const names: string[] = [];
  let depth = 0;
  for (let i = 0; i < dict.length; i += 1) {
    if (dict.startsWith("<<", i)) {
      depth += 1;
      i += 1;
      continue;
    }
    if (dict.startsWith(">>", i)) {
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth === 1 && dict[i] === "/") {
      const token = readName(dict, i);
      if (token.name) names.push(token.name);
      i = token.next - 1;
    }
  }
  return names;
}

type LengthSpec = { kind: "direct"; value: number } | { kind: "indirect"; id: string; gen: string };

function topLevelLength(dict: string): LengthSpec | null {
  let depth = 0;
  let found: LengthSpec | null = null;
  for (let i = 0; i < dict.length; i += 1) {
    if (dict.startsWith("<<", i)) {
      depth += 1;
      i += 1;
      continue;
    }
    if (dict.startsWith(">>", i)) {
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth !== 1 || dict[i] !== "/") continue;
    const token = readName(dict, i);
    if (token.name !== "Length") {
      i = token.next - 1;
      continue;
    }
    let j = token.next;
    while (j < dict.length && dict.charCodeAt(j) <= 32) j += 1;
    const ref = /^(\d+)\s+(\d+)\s+R/.exec(dict.slice(j));
    if (ref) {
      found = { kind: "indirect", id: ref[1], gen: ref[2] };
      i = j + ref[0].length - 1;
      continue;
    }
    const num = /^(\d+)/.exec(dict.slice(j));
    if (!num) continue;
    const value = Number(num[1]);
    if (Number.isSafeInteger(value)) found = { kind: "direct", value };
    i = j + num[0].length - 1;
  }
  return found;
}

function readFilters(dict: string): string[] | "indirect" | "absent" {
  let depth = 0;
  for (let i = 0; i < dict.length; i += 1) {
    if (dict.startsWith("<<", i)) {
      depth += 1;
      i += 1;
      continue;
    }
    if (dict.startsWith(">>", i)) {
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth !== 1 || dict[i] !== "/") continue;
    const token = readName(dict, i);
    if (token.name !== "Filter") {
      i = token.next - 1;
      continue;
    }
    let j = token.next;
    while (j < dict.length && dict.charCodeAt(j) <= 32) j += 1;
    if (dict[j] === "/") {
      const filter = readName(dict, j);
      return filter.name ? [filter.name] : "absent";
    }
    if (dict[j] === "[") {
      const filters: string[] = [];
      j += 1;
      while (j < dict.length && dict[j] !== "]") {
        while (j < dict.length && dict.charCodeAt(j) <= 32) j += 1;
        if (dict[j] === "/") {
          const filter = readName(dict, j);
          if (filter.name) filters.push(filter.name);
          j = filter.next;
          continue;
        }
        if (dict[j] >= "0" && dict[j] <= "9") return "indirect";
        if (dict[j] === "]") break;
        return "indirect";
      }
      return filters;
    }
    if (dict[j] >= "0" && dict[j] <= "9") return "indirect";
    return "indirect";
  }
  return "absent";
}

function readPredictor(dict: string): number | "indirect" {
  let highest = 1;
  for (let i = 0; i < dict.length; i += 1) {
    if (dict[i] !== "/") continue;
    const token = readName(dict, i);
    if (token.name !== "Predictor") {
      i = token.next - 1;
      continue;
    }
    let j = token.next;
    while (j < dict.length && dict.charCodeAt(j) <= 32) j += 1;
    if (/^\d+\s+\d+\s+R/.test(dict.slice(j))) return "indirect";
    const num = /^(\d+)/.exec(dict.slice(j));
    if (!num) return "indirect";
    highest = Math.max(highest, Number(num[1]));
    i = j + num[0].length - 1;
  }
  return highest;
}

function streamDataStart(buffer: Buffer, streamIdx: number): number | null {
  const after = streamIdx + 6;
  if (buffer[after] === 0x0d && buffer[after + 1] === 0x0a) return after + 2;
  if (buffer[after] === 0x0a || buffer[after] === 0x0d) return after + 1;
  return null;
}

function matchEndstream(buffer: Buffer, dataEnd: number): number | null {
  const offsets = [0];
  if (buffer[dataEnd] === 0x0a) offsets.push(1);
  if (buffer[dataEnd] === 0x0d) offsets.push(buffer[dataEnd + 1] === 0x0a ? 2 : 1);
  for (const extra of offsets) {
    const at = dataEnd + extra;
    if (buffer.subarray(at, at + 9).toString("latin1") === "endstream") return at + 9;
  }
  return null;
}

const MAX_INDEXED_INTEGERS = 100_000;
const MAX_LENGTH_CANDIDATES = 8;

function indexIndirectIntegers(buffer: Buffer): Map<string, number[]> {
  const text = buffer.toString("latin1");
  const values = new Map<string, number[]>();
  const header = /(?:^|[\0\t\n\f\r ()<>\[\]{}/%])(\d+) (\d+) obj/g;
  let match: RegExpExecArray | null;
  while ((match = header.exec(text)) !== null) {
    const bodyAt = match.index + match[0].length;
    const num = /^\s+(\d+)\s+endobj/.exec(text.slice(bodyAt, bodyAt + 64));
    if (!num) continue;
    const value = Number(num[1]);
    if (!Number.isSafeInteger(value) || value < 0) continue;
    const key = `${match[1]} ${match[2]}`;
    const list = values.get(key);
    if (list) {
      if (list.length < MAX_LENGTH_CANDIDATES) list.push(value);
      continue;
    }
    if (values.size >= MAX_INDEXED_INTEGERS) {
      throw new PdfInspectError("PDF terlalu besar untuk diperiksa.");
    }
    values.set(key, [value]);
  }
  return values;
}

type BoundStream = { dataStart: number; length: number; end: number };

function boundStream(
  buffer: Buffer,
  streamIdx: number,
  dict: string,
  integers: Map<string, number[]>,
): BoundStream | null {
  const spec = topLevelLength(dict);
  const dataStart = streamDataStart(buffer, streamIdx);
  if (!spec || dataStart === null) return null;
  const lengths = spec.kind === "direct" ? [spec.value] : (integers.get(`${spec.id} ${spec.gen}`) ?? []);
  for (const length of lengths) {
    if (!Number.isSafeInteger(length) || length < 0) continue;
    if (dataStart + length > buffer.length) continue;
    const end = matchEndstream(buffer, dataStart + length);
    if (end !== null) return { dataStart, length, end };
  }
  return null;
}

function shouldScan(dict: string): boolean {
  const names = topLevelNames(dict);
  if (names.includes("ObjStm")) return true;
  return !names.some((name) => SKIP_BODY.has(name));
}

function decodeScannedBody(raw: Buffer, dict: string): Buffer {
  const filters = readFilters(dict);
  const predictor = readPredictor(dict);
  if (filters === "indirect" || predictor === "indirect" || predictor > 1) {
    throw new PdfInspectError("PDF berisi stream yang tidak bisa diperiksa.");
  }
  const names = filters === "absent" ? [] : filters;
  if (names.includes("Crypt")) {
    throw new PdfInspectError("PDF terenkripsi ditolak karena isinya tidak bisa diperiksa.");
  }
  if (names.length === 0) return Buffer.from(raw);
  if (names.length === 1 && names[0] === "FlateDecode") {
    if (raw.length === 0) return Buffer.alloc(0);
    try {
      return inflateSync(raw, { maxOutputLength: MAX_STREAM_OUTPUT });
    } catch {
      throw new PdfInspectError("PDF berisi stream yang tidak bisa diperiksa.");
    }
  }
  throw new PdfInspectError("PDF berisi stream yang tidak bisa diperiksa.");
}

function collectPdfText(buffer: Buffer): { clear: string; bodies: string[] } {
  const parts: Buffer[] = [];
  const bodies: string[] = [];
  const integers = indexIndirectIntegers(buffer);
  let cursor = 0;
  let decodedTotal = 0;

  while (cursor < buffer.length) {
    const idx = findStream(buffer, cursor);
    if (idx < 0) {
      parts.push(buffer.subarray(cursor));
      break;
    }
    if (dictCloseIndex(buffer, idx) === null) {
      parts.push(buffer.subarray(cursor, idx + 6));
      cursor = idx + 6;
      continue;
    }
    const dict = dictionaryBefore(buffer, idx);
    if (!dict) throw new PdfInspectError("PDF berisi stream yang tidak bisa diperiksa.");
    const bound = boundStream(buffer, idx, dict, integers);
    if (!bound) throw new PdfInspectError("PDF berisi stream yang tidak bisa diperiksa.");
    parts.push(buffer.subarray(cursor, idx));
    if (shouldScan(dict)) {
      const raw = buffer.subarray(bound.dataStart, bound.dataStart + bound.length);
      const decoded = decodeScannedBody(raw, dict);
      decodedTotal += decoded.length;
      if (decodedTotal > MAX_TOTAL_OUTPUT) throw new PdfInspectError("PDF terlalu besar untuk diperiksa.");
      bodies.push(decoded.toString("latin1"));
    }
    cursor = bound.end;
  }

  return { clear: Buffer.concat(parts).toString("latin1"), bodies };
}

export function inspectPdfBytes(buffer: Buffer): PdfVerdict {
  if (buffer.length < 8 || buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return rejected("Isi file tidak sesuai ekstensi PDF.");
  }
  const tail = buffer.subarray(Math.max(0, buffer.length - 2048)).toString("latin1");
  if (!tail.includes("%%EOF")) return rejected("PDF rusak: penanda akhir tidak ditemukan.");

  try {
    const scanned = collectPdfText(buffer);
    const regions = [scanned.clear, ...scanned.bodies];
    let active = false;
    for (const region of regions) {
      const kind = classifyNames(region);
      if (kind === "encrypt") return rejected("PDF terenkripsi ditolak karena isinya tidak bisa diperiksa.");
      if (kind === "active") active = true;
    }
    return active ? quarantined() : { ok: true };
  } catch (error) {
    if (error instanceof PdfInspectError) return rejected(error.message);
    return rejected("PDF tidak bisa diperiksa sepenuhnya dan ditolak.");
  }
}
