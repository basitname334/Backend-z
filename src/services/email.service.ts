import nodemailer from 'nodemailer';
import { config } from '../config';

let transporter: nodemailer.Transporter | null = null;
let resolvedServiceHint = '';

function getTransporter(): nodemailer.Transporter | null {
  const user = config.mail.user;
  const pass = config.mail.pass;
  const hasAuth = Boolean(user && pass);
  const explicitService = config.mail.service;
  const host = config.mail.host;
  const inferredGmailService =
    !explicitService && !host && hasAuth && user.toLowerCase().endsWith('@gmail.com');
  const effectiveService = explicitService || (inferredGmailService ? 'gmail' : '');

  if (!hasAuth || (!effectiveService && !host)) {
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport(
      effectiveService
        ? {
            service: effectiveService,
            auth: {
              user,
              pass,
            },
          }
        : {
            host,
            port: config.mail.port,
            secure: config.mail.secure,
            auth: {
              user,
              pass,
            },
          }
    );
    resolvedServiceHint = effectiveService ? `service=${effectiveService}` : `host=${host}:${config.mail.port}`;
  }
  return transporter;
}

export async function sendInterviewScheduleEmail(input: {
  to: string;
  candidateName?: string | null;
  recruiterName?: string | null;
  role: string;
  scheduledAt: string;
  joinUrl: string;
  message?: string;
}): Promise<{ sent: boolean; error?: string }> {
  try {
    if (!config.mail.enabled) {
      console.info('[Mail] Sending disabled (MAIL_ENABLED=false). Join URL still returned.');
      return { sent: false, error: 'Email sending disabled' };
    }
    const tx = getTransporter();
    if (!tx) {
      const err =
        'Mail is not configured. Set either (MAIL_SERVICE + MAIL_USER + MAIL_PASS) or (MAIL_HOST + MAIL_PORT + MAIL_USER + MAIL_PASS).';
      console.warn(`[Mail] ${err}`);
      return { sent: false, error: err };
    }

    const scheduledAtText = new Date(input.scheduledAt).toLocaleString();
    const subject = `Your interview is scheduled (${input.role})`;
    const greeting = input.candidateName
      ? `Hi ${input.candidateName},`
      : 'Hi,';
    const recruiterLine = input.recruiterName
      ? `<p><strong>Recruiter:</strong> ${escapeHtml(input.recruiterName)}</p>`
      : '';
    const messageBlock = input.message
      ? `<p><strong>Message from recruiter:</strong></p><blockquote style="margin:0;padding:8px 12px;border-left:3px solid #6366f1;background:#f5f7ff;">${escapeHtml(input.message).replace(/\n/g, '<br/>')}</blockquote>`
      : '';

    const html = `
      <div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;line-height:1.5">
        <p>${greeting}</p>
        <p>Your interview has been scheduled. Here are your details:</p>
        <p><strong>Role:</strong> ${escapeHtml(input.role)}</p>
        <p><strong>Scheduled at:</strong> ${escapeHtml(scheduledAtText)}</p>
        ${recruiterLine}
        ${messageBlock}
        <p style="margin-top:16px">
          <a href="${input.joinUrl}" style="display:inline-block;background:#4f46e5;color:white;padding:10px 14px;border-radius:8px;text-decoration:none;font-weight:600">Join interview</a>
        </p>
        <p>If the button does not work, open this link:</p>
        <p><a href="${input.joinUrl}">${input.joinUrl}</a></p>
        <p>Best of luck,<br/>AI Interviewer Team</p>
      </div>
    `;

    await tx.sendMail({
      from: config.mail.from,
      to: input.to,
      replyTo: config.mail.replyTo || undefined,
      subject,
      text: `${greeting}\n\nYour interview has been scheduled.\nRole: ${input.role}\nScheduled at: ${scheduledAtText}\n${input.recruiterName ? `Recruiter: ${input.recruiterName}\n` : ''}${input.message ? `\nMessage from recruiter:\n${input.message}\n` : ''}\nJoin interview: ${input.joinUrl}\n`,
      html,
    });
    console.info(`[Mail] Interview email sent to ${input.to} via ${resolvedServiceHint || 'configured transport'}`);

    return { sent: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : 'Unknown mail error';
    console.error('[Mail] Failed to send interview email:', err);
    return { sent: false, error: err };
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
