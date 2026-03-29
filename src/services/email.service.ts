import nodemailer from 'nodemailer';
import { config } from '../config';
import { passwordResetHtml, interviewScheduleHtml } from './emailTemplates';

/** Build transporter from current config so updated MAIL_* in .env are used after restart (no stale cache). */
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

  return nodemailer.createTransport(
    effectiveService
      ? {
          service: effectiveService,
          auth: { user, pass },
        }
      : {
          host,
          port: config.mail.port,
          secure: config.mail.secure,
          auth: { user, pass },
        }
  );
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
    const tx = getTransporter();
    if (!tx) {
      const err =
        'Mail is not configured. Set either (MAIL_SERVICE + MAIL_USER + MAIL_PASS) or (MAIL_HOST + MAIL_PORT + MAIL_USER + MAIL_PASS).';
      console.warn(`[Mail] ${err}`);
      return { sent: false, error: err };
    }

    const scheduledAtText = new Date(input.scheduledAt).toLocaleString();
    const subject = `Your interview is scheduled — ${input.role}`;
    const html = interviewScheduleHtml({
      candidateName: input.candidateName,
      recruiterName: input.recruiterName,
      role: input.role,
      scheduledAt: scheduledAtText,
      joinUrl: input.joinUrl,
      message: input.message,
    });

    await tx.sendMail({
      from: config.mail.from,
      to: input.to,
      replyTo: config.mail.replyTo || undefined,
      subject,
      text: `Your interview is scheduled.\n\nRole: ${input.role}\nScheduled at: ${scheduledAtText}\n${input.recruiterName ? `Recruiter: ${input.recruiterName}\n` : ''}${input.message ? `\nMessage from recruiter:\n${input.message}\n` : ''}\nJoin interview: ${input.joinUrl}\n`,
      html,
    });
    console.info(`[Mail] Interview email sent to ${input.to} from ${config.mail.from}`);

    return { sent: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : 'Unknown mail error';
    console.error('[Mail] Failed to send interview email:', err);
    return { sent: false, error: err };
  }
}

/**
 * Send password reset code to the user (candidate or recruiter).
 * Who sends: The backend sends this email using your .env mail config (MAIL_FROM, MAIL_USER, MAIL_PASS).
 * Who receives: The user who requested the reset — the address they entered on "Forgot password?" (input.to).
 * Who triggers: The user themselves (self-service from candidate or recruiter login page). No admin sends it.
 */
export async function sendPasswordResetEmail(input: {
  to: string;
  code: string;
  resetLink?: string;
}): Promise<{ sent: boolean; error?: string }> {
  try {
    const tx = getTransporter();
    if (!tx) {
      const err =
        'Mail is not configured. Set either (MAIL_SERVICE + MAIL_USER + MAIL_PASS) or (MAIL_HOST + MAIL_PORT + MAIL_USER + MAIL_PASS).';
      console.warn(`[Mail] ${err}`);
      return { sent: false, error: err };
    }

    const subject = 'Your password reset code — AI Interviewer';
    const html = passwordResetHtml(input.code, input.resetLink);

    await tx.sendMail({
      from: config.mail.from,
      to: input.to,
      replyTo: config.mail.replyTo || undefined,
      subject,
      text: `Your password reset code: ${input.code}\n\nEnter it on the reset password page. The code expires in 15 minutes.\n${input.resetLink ? `Reset link: ${input.resetLink}\n` : ''}\nIf you did not request this, ignore this email.`,
      html,
    });
    console.info(`[Mail] Password reset email sent to ${input.to} from ${config.mail.from}`);
    return { sent: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : 'Unknown mail error';
    console.error('[Mail] Failed to send password reset email:', err);
    return { sent: false, error: err };
  }
}
