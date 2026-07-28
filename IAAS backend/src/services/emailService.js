import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter;

function getTransporter() {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS || !env.EMAIL_FROM) {
    throw new Error('Password reset email is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and EMAIL_FROM.');
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }

  return transporter;
}

export async function sendPasswordResetEmail({ to, resetToken, expiresAt }) {
  const resetUrl = new URL('/login', env.APP_BASE_URL);
  resetUrl.searchParams.set('resetToken', resetToken);

  await getTransporter().sendMail({
    from: env.EMAIL_FROM,
    to,
    subject: 'Reset your Infraflow password',
    text: [
      'Use this reset token in Infraflow to set a new password:',
      '',
      resetToken,
      '',
      `Or open this link: ${resetUrl.toString()}`,
      `This token expires at ${expiresAt.toISOString()}.`,
      '',
      'If you did not request this, ignore this email.',
    ].join('\n'),
    html: `
      <p>Use this reset token in Infraflow to set a new password:</p>
      <p><code>${escapeHtml(resetToken)}</code></p>
      <p><a href="${escapeHtml(resetUrl.toString())}">Open password reset</a></p>
      <p>This token expires at ${escapeHtml(expiresAt.toISOString())}.</p>
      <p>If you did not request this, ignore this email.</p>
    `,
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
