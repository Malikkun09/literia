import { z } from "zod";

export const ALLOWED_EXTENSIONS = ["pdf", "docx", "pptx", "xlsx", "txt", "csv"] as const;
export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(255).toLowerCase(),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(255).toLowerCase(),
  password: z.string().min(1).max(128),
});

export const otpSchema = z.object({
  email: z.string().trim().email().max(255).toLowerCase(),
  code: z.string().regex(/^\d{6}$/, "OTP harus 6 digit"),
});

export const documentMetadataSchema = z.object({
  title: z.string().trim().min(3).max(255),
  description: z.string().trim().max(5000).optional(),
  categoryId: z.string().cuid().optional(),
  extension: z.enum(ALLOWED_EXTENSIONS),
});

const emptyToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value);

export const uploadInitSchema = z.object({
  title: z.string().trim().min(3, "Judul minimal 3 karakter.").max(255, "Judul maksimal 255 karakter."),
  description: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(5000, "Deskripsi maksimal 5000 karakter.").optional(),
  ),
  categoryId: z.preprocess(emptyToUndefined, z.string().cuid("Kategori tidak valid.").optional()),
  fileName: z.string().trim().min(1, "Nama file wajib diisi.").max(255, "Nama file terlalu panjang."),
  sizeBytes: z.number().int("Ukuran file tidak valid.").positive("Ukuran file harus lebih dari 0."),
  sha256: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-f0-9]{64}$/, "Checksum SHA-256 tidak valid."),
});

export const uploadCompleteSchema = z.object({
  sha256: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-f0-9]{64}$/, "Checksum SHA-256 tidak valid.")
    .optional(),
});

export const reportSchema = z.object({
  reason: z.string().trim().min(3).max(120),
  details: z.string().trim().max(2000).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type OtpInput = z.infer<typeof otpSchema>;
