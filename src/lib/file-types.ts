import { ALLOWED_EXTENSIONS, type AllowedExtension } from "@/lib/validation";

export const MIME_BY_EXTENSION: Record<AllowedExtension, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

const BLOCKED_EXTENSION_MESSAGES: Record<string, string> = {
  docm: "File macro Word (.docm) ditolak.",
  xlsm: "File macro Excel (.xlsm) ditolak.",
  pptm: "File macro PowerPoint (.pptm) ditolak.",
  zip: "Arsip .zip ditolak. Unggah PDF, DOCX, PPTX, XLSX, TXT, atau CSV.",
  rar: "Arsip .rar ditolak.",
  "7z": "Arsip .7z ditolak.",
  exe: "File program (.exe) ditolak.",
  dll: "File program (.dll) ditolak.",
  js: "File JavaScript (.js) ditolak.",
  mjs: "File JavaScript (.mjs) ditolak.",
  cjs: "File JavaScript (.cjs) ditolak.",
  html: "File HTML (.html) ditolak.",
  htm: "File HTML (.htm) ditolak.",
  png: "Gambar .png ditolak.",
  jpg: "Gambar .jpg ditolak.",
  jpeg: "Gambar .jpeg ditolak.",
  gif: "Gambar .gif ditolak.",
  webp: "Gambar .webp ditolak.",
  mp3: "Audio .mp3 ditolak.",
  wav: "Audio .wav ditolak.",
  ogg: "Audio .ogg ditolak.",
  mp4: "Video .mp4 ditolak.",
  mov: "Video .mov ditolak.",
  avi: "Video .avi ditolak.",
  mkv: "Video .mkv ditolak.",
  webm: "Video .webm ditolak.",
};

const DISGUISED_SUFFIX =
  /\.(html?|js|mjs|cjs|exe|dll|bat|cmd|ps1|sh|zip|rar|7z|docm|xlsm|pptm|png|jpe?g|gif|webp|mp3|wav|ogg|mp4|mov|avi|mkv|webm)$/i;

export function isAllowedExtension(ext: string): ext is AllowedExtension {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
}

export function sanitizeFileName(fileName: string): string {
  const base = (fileName.split(/[/\\]/).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 255);
  return base || "dokumen";
}

export function fileExtension(fileName: string): string | null {
  const base = sanitizeFileName(fileName);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

export function contentDisposition(kind: "inline" | "attachment", fileName: string): string {
  const safe = sanitizeFileName(fileName);
  const ascii = safe.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export function extensionError(fileName: string): string | null {
  const ext = fileExtension(fileName);
  if (!ext) {
    return "Nama file harus ber-ekstensi pdf, docx, pptx, xlsx, txt, atau csv.";
  }
  const blocked = BLOCKED_EXTENSION_MESSAGES[ext];
  if (blocked) return blocked;
  if (!isAllowedExtension(ext)) {
    return `Ekstensi .${ext} tidak diizinkan. Yang diterima: pdf, docx, pptx, xlsx, txt, csv.`;
  }
  const stem = sanitizeFileName(fileName).slice(0, -(ext.length + 1));
  if (DISGUISED_SUFFIX.test(stem)) {
    return "Nama file menyembunyikan jenis berkas yang tidak diizinkan.";
  }
  return null;
}
