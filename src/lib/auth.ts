import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins";
import { db } from "@/lib/db";
import { sendOtpEmail } from "@/lib/email";
import { getEnv } from "@/lib/env";

const env = getEnv();

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL,
  trustedOrigins: [
    process.env.APP_URL ?? "http://localhost:3000",
    process.env.ADMIN_APP_URL ?? "http://localhost:3000",
  ],
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  rateLimit: {
    enabled: true,
    storage: "memory",
    window: 60,
    max: 10,
    customRules: {
      "/api/auth/email-otp/*": { window: 60, max: 5 },
      "/api/auth/sign-up/*": { window: 300, max: 5 },
      "/api/auth/sign-in/*": { window: 300, max: 10 },
    },
  },
  user: {
    additionalFields: {
      role: { type: "string", input: false, defaultValue: "MEMBER", required: false },
      status: { type: "string", input: false, defaultValue: "ACTIVE", required: false },
      storageUsedBytes: { type: "number", input: false, defaultValue: 0, required: false },
      storageQuotaBytes: { type: "number", input: false, defaultValue: 1000000000, required: false },
    },
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 300,
      allowedAttempts: 3,
      overrideDefaultEmailVerification: true,
      sendVerificationOnSignUp: true,
      async sendVerificationOTP({ email, otp, type }) {
        await sendOtpEmail({ email, otp, type });
      },
    }),
    nextCookies(),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
