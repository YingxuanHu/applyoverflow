import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT ?? "587");
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFrom = process.env.SMTP_FROM;
const SMTP_TIMEOUT_MS = 15_000;
const SMTP_SLOW_SEND_MS = 3_000;

let cachedTransporter: Transporter | null = null;

export function isEmailDeliveryConfigured() {
  return Boolean(smtpHost && smtpUser && smtpPass && smtpFrom && !Number.isNaN(smtpPort));
}

function getTransporter() {
  if (!isEmailDeliveryConfigured()) {
    return null;
  }

  if (cachedTransporter) {
    return cachedTransporter;
  }

  cachedTransporter = nodemailer.createTransport({
    pool: true,
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
    maxConnections: 2,
    maxMessages: 100,
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });

  return cachedTransporter;
}

export async function sendEmail(input: SendEmailInput) {
  const transporter = getTransporter();

  if (!transporter || !smtpFrom) {
    console.log(`[email] SMTP not configured. Email to ${input.to} was not sent.`);
    console.log(`[email] Subject: ${input.subject}`);
    console.log(`[email] Text: ${input.text}`);
    return false;
  }

  const startedAt = Date.now();

  try {
    await transporter.sendMail({
      from: smtpFrom,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
  } catch (error) {
    cachedTransporter?.close();
    cachedTransporter = null;
    throw error;
  }

  const durationMs = Date.now() - startedAt;
  if (durationMs >= SMTP_SLOW_SEND_MS) {
    console.warn(`[email] SMTP send accepted slowly in ${durationMs}ms.`);
  }

  return true;
}
