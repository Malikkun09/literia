import nodemailer from "nodemailer";

interface SendOtpParams {
  email: string;
  otp: string;
  type: string;
}

function subjectFor(type: string): string {
  if (type === "forget-password") return "LITERIA — Reset kata sandi";
  if (type === "sign-in") return "LITERIA — Kode masuk";
  return "LITERIA — Kode verifikasi email";
}

export async function sendOtpEmail({ email, otp, type }: SendOtpParams): Promise<void> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
    console.log(`[LITERIA-OTP] to=${email} type=${type} otp=${otp}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 587),
    secure: Number(SMTP_PORT ?? 587) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });

  await transporter.sendMail({
    from: EMAIL_FROM || "LITERIA <otp@malikfajar.my.id>",
    to: email,
    subject: subjectFor(type),
    text: `Kode OTP LITERIA Anda: ${otp}\nBerlaku 5 menit. Jangan bagikan kode ini.`,
    html: `<p>Kode OTP LITERIA Anda: <strong>${otp}</strong></p><p>Berlaku 5 menit. Jangan bagikan kode ini.</p>`,
  });
}
