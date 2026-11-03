import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";
import { prisma } from "../db.js";

let transporter: Transporter | null = null;

export const emailMode = () => (config.SMTP_HOST ? "smtp" : "log");

function getTransporter(): Transporter | null {
  if (!config.SMTP_HOST) return null;
  transporter ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
  });
  return transporter;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  eventType: string;
  taskId?: string | null;
}

/**
 * Sends (SMTP mode) or records (log mode) an email. Every attempt is written
 * to EmailLog, which doubles as an audit trail and as testing evidence.
 */
export async function sendEmail(mail: OutgoingEmail): Promise<void> {
  const t = getTransporter();
  let status = "LOGGED";
  let error: string | null = null;
  if (t) {
    try {
      await t.sendMail({ from: config.EMAIL_FROM, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text });
      status = "SENT";
    } catch (e) {
      status = "FAILED";
      error = e instanceof Error ? e.message : String(e);
      console.error(`[email] failed to send "${mail.subject}" to ${mail.to}: ${error}`);
    }
  }
  await prisma.emailLog.create({
    data: {
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      status,
      error,
      eventType: mail.eventType,
      taskId: mail.taskId ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface TemplateInput {
  heading: string;
  intro: string;
  rows?: [string, string][];
  ctaLabel?: string;
  ctaPath?: string;
  footer?: string;
}

export function renderEmail(t: TemplateInput): { html: string; text: string } {
  const url = t.ctaPath ? `${config.APP_URL.replace(/\/$/, "")}${t.ctaPath}` : null;
  const rows = (t.rows ?? [])
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:6px 0;color:#0f172a">${escapeHtml(v)}</td></tr>`,
    )
    .join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0f766e;padding:18px 24px;color:#fff;font-size:16px;font-weight:600">Nesma Tasks</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:20px;color:#0f172a">${escapeHtml(t.heading)}</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#334155">${escapeHtml(t.intro)}</p>
${rows ? `<table role="presentation" style="font-size:14px;margin-bottom:16px">${rows}</table>` : ""}
${url ? `<a href="${escapeHtml(url)}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">${escapeHtml(t.ctaLabel ?? "Open")}</a>` : ""}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8">${escapeHtml(t.footer ?? "You receive this because email notifications are on. Turn them off in your profile settings.")}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    t.heading,
    "",
    t.intro,
    "",
    ...(t.rows ?? []).map(([k, v]) => `${k}: ${v}`),
    url ? `\n${t.ctaLabel ?? "Open"}: ${url}` : "",
  ].join("\n");
  return { html, text };
}
