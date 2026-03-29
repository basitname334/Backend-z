/**
 * Professional HTML email templates. Inline styles only for email client compatibility.
 * Brand: AI Interviewer — accent #7c3aed (violet).
 */
const BRAND = {
  name: 'AI Interviewer',
  tagline: 'Smart, bias-aware interviews',
  accent: '#7c3aed',
  accentHover: '#6d28d9',
  text: '#1e1b4b',
  textMuted: '#4c4866',
  bg: '#f8f7fc',
  cardBg: '#ffffff',
  border: '#e5e2f0',
  radius: '12px',
  fontFamily: '-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, \'Helvetica Neue\', Arial, sans-serif',
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Wrapper: 600px max-width, centered, professional card */
function wrapBody(innerHtml: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${BRAND.name}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:${BRAND.fontFamily};color:${BRAND.text};line-height:1.6;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${BRAND.cardBg};border-radius:${BRAND.radius};box-shadow:0 4px 24px rgba(30,27,75,0.08);overflow:hidden;">
          ${innerHtml}
        </table>
        <p style="margin:24px 0 0;font-size:12px;color:${BRAND.textMuted};">
          You received this email because you use ${BRAND.name}. If you didn't request this, you can safely ignore it.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Header block: logo area + optional icon */
function headerBlock(icon: string, title: string, subtitle?: string): string {
  return `
  <tr>
    <td style="padding:32px 32px 24px;text-align:center;background:linear-gradient(135deg, ${BRAND.accent} 0%, #5b21b6 100%);">
      <div style="width:56px;height:56px;margin:0 auto 16px;background:rgba(255,255,255,0.2);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;font-size:28px;">${icon}</div>
      <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">${escapeHtml(title)}</h1>
      ${subtitle ? `<p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,0.9);">${escapeHtml(subtitle)}</p>` : ''}
    </td>
  </tr>`;
}

/** Primary CTA button */
function ctaButton(href: string, label: string): string {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 0;">
    <tr>
      <td align="center" style="padding:8px 0;">
        <a href="${href}" style="display:inline-block;background:${BRAND.accent};color:#ffffff !important;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;box-shadow:0 2px 8px rgba(124,58,237,0.35);">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

/** Footer with brand */
function footerBlock(): string {
  return `
  <tr>
    <td style="padding:24px 32px 32px;border-top:1px solid ${BRAND.border};text-align:center;">
      <p style="margin:0;font-size:13px;color:${BRAND.textMuted};">
        <strong style="color:${BRAND.text};">${BRAND.name}</strong> — ${BRAND.tagline}
      </p>
      <p style="margin:8px 0 0;font-size:12px;color:${BRAND.textMuted};">
        Professional AI-powered interviews and hiring.
      </p>
    </td>
  </tr>`;
}

/** Info cell content: label + value (use inside <td>) */
function infoCell(label: string, value: string): string {
  return `
      <span style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:${BRAND.textMuted};">${escapeHtml(label)}</span><br/>
      <span style="font-size:16px;font-weight:600;color:${BRAND.text};">${escapeHtml(value)}</span>`;
}

export function passwordResetHtml(code: string, resetLink?: string): string {
  const content = `
  ${headerBlock('🔐', 'Password reset', 'Use the code below to set a new password')}
  <tr>
    <td style="padding:32px;">
      <p style="margin:0 0 20px;font-size:15px;color:${BRAND.text};">
        You requested a password reset. Enter this code on the reset page. It expires in <strong>15 minutes</strong>.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:10px;margin:16px 0;">
        <tr>
          <td align="center" style="padding:20px;">
            <span style="font-size:28px;font-weight:700;letter-spacing:8px;color:${BRAND.accent};font-family:ui-monospace, monospace;">${escapeHtml(code)}</span>
          </td>
        </tr>
      </table>
      ${resetLink ? ctaButton(resetLink, 'Reset password') : ''}
      <p style="margin:24px 0 0;font-size:13px;color:${BRAND.textMuted};">
        If you didn't request this, you can safely ignore this email. Your password will not be changed.
      </p>
    </td>
  </tr>
  ${footerBlock()}`;
  return wrapBody(content);
}

export function interviewScheduleHtml(params: {
  candidateName?: string | null;
  recruiterName?: string | null;
  role: string;
  scheduledAt: string;
  joinUrl: string;
  message?: string;
}): string {
  const greeting = params.candidateName ? `Hi ${escapeHtml(params.candidateName)},` : 'Hi,';
  const recruiterRow = params.recruiterName
    ? `<tr><td style="padding:8px 0;">${infoCell('Recruiter', params.recruiterName)}</td></tr>`
    : '';
  const messageBlock = params.message
    ? `
  <tr>
    <td style="padding:16px 0 0;">
      <span style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:${BRAND.textMuted};">Message from recruiter</span>
      <div style="margin:8px 0 0;padding:16px;background:${BRAND.bg};border-left:4px solid ${BRAND.accent};border-radius:8px;font-size:15px;color:${BRAND.text};">
        ${escapeHtml(params.message).replace(/\n/g, '<br/>')}
      </div>
    </td>
  </tr>`
    : '';

  const content = `
  ${headerBlock('📅', 'Interview scheduled', `Your ${escapeHtml(params.role)} interview`)}
  <tr>
    <td style="padding:32px;">
      <p style="margin:0 0 24px;font-size:15px;color:${BRAND.text};">
        ${greeting}
      </p>
      <p style="margin:0 0 20px;font-size:15px;color:${BRAND.text};">
        Your interview has been scheduled. Here are your details:
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:10px;padding:20px;margin:0 0 20px;">
        <tr><td style="padding:8px 0;">${infoCell('Role', params.role)}</td></tr>
        <tr><td style="padding:8px 0;">${infoCell('Date & time', params.scheduledAt)}</td></tr>
        ${recruiterRow}
      </table>
      ${messageBlock}
      ${ctaButton(params.joinUrl, 'Join interview')}
      <p style="margin:20px 0 0;font-size:13px;color:${BRAND.textMuted};">
        If the button doesn't work, copy and paste this link into your browser:<br/>
        <a href="${params.joinUrl}" style="color:${BRAND.accent};word-break:break-all;">${params.joinUrl}</a>
      </p>
      <p style="margin:24px 0 0;font-size:15px;color:${BRAND.text};">
        Good luck — we look forward to speaking with you.
      </p>
    </td>
  </tr>
  ${footerBlock()}`;
  return wrapBody(content);
}
