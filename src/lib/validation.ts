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

export const reportSchema = z.object({
  reason: z.string().trim().min(3).max(120),
  details: z.string().trim().max(2000).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type OtpInput = z.infer<typeof otpSchema>;
