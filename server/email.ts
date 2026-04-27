// Thin wrapper around the Resend HTTP API for sending invite emails.
//
// We use Node's native `fetch()` (Node 20+) so we don't have to add an npm
// dependency just for one API call. All failures surface as thrown errors so
// the caller can log them without blocking invite creation.

import { getResendApiKey, getResendFromAddress } from './config'

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildInviteEmailHtml(inviteUrl: string): string {
  const safeUrl = escapeHtml(inviteUrl)
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f5fa; margin: 0; padding: 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 32px;">
      <tr><td>
        <h1 style="margin: 0 0 12px; font-size: 20px; color: #1f2937;">You've been invited to Quail Ultra Live</h1>
        <p style="margin: 0 0 16px; color: #374151; line-height: 1.5;">
          Click the button below to accept your invite and create your account.
          The link is tied to this email address — keep it private.
        </p>
        <p style="margin: 24px 0;">
          <a href="${safeUrl}" style="display: inline-block; background: #3b5998; color: #ffffff; padding: 12px 22px; border-radius: 6px; text-decoration: none; font-weight: 600;">Accept Invite</a>
        </p>
        <p style="margin: 24px 0 0; color: #6b7280; font-size: 12px;">
          If the button doesn't work, copy and paste this URL into your browser:<br />
          <a href="${safeUrl}" style="color: #3b5998; word-break: break-all;">${safeUrl}</a>
        </p>
      </td></tr>
    </table>
  </body>
</html>`
}

export function isEmailConfigured(): boolean {
  return getResendApiKey() !== null
}

/**
 * Send an invite email via Resend. Returns `true` when an email was sent,
 * `false` when email delivery is not configured (so the caller can fall back
 * to copying the URL). Throws on API errors — callers should wrap in try/catch
 * and log without blocking the invite creation response.
 */
function buildSupportEmailHtml(subject: string, category: string, message: string, username: string): string {
  const safeSubject = escapeHtml(subject)
  const safeCategory = escapeHtml(category)
  const safeMessage = escapeHtml(message).replace(/\n/g, '<br />')
  const safeUsername = escapeHtml(username)
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f5fa; margin: 0; padding: 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 32px;">
      <tr><td>
        <h1 style="margin: 0 0 12px; font-size: 20px; color: #1f2937;">Support Ticket from ${safeUsername}</h1>
        <p style="margin: 0 0 8px;"><strong>Category:</strong> <span style="background:#e5e7eb;padding:2px 8px;border-radius:4px;">${safeCategory}</span></p>
        <p style="margin: 0 0 8px;"><strong>Subject:</strong> ${safeSubject}</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
        <p style="color:#374151;line-height:1.6;white-space:pre-wrap;">${safeMessage}</p>
      </td></tr>
    </table>
  </body>
</html>`
}

export async function sendSupportEmail(to: string, subject: string, category: string, message: string, username: string): Promise<boolean> {
  const apiKey = getResendApiKey()
  if (!apiKey) {
    return false
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      from: getResendFromAddress(),
      to: [to],
      subject: `[Support] ${subject}`,
      html: buildSupportEmailHtml(subject, category, message, username)
    })
  })
  if (!response.ok) {
    let detail = ''
    try {
      detail = await response.text()
    } catch {
      // ignore
    }
    throw new Error(`Resend request failed: ${response.status} ${response.statusText} ${detail}`.trim())
  }
  return true
}

function buildQuestionReportEmailHtml(packId: string, questionId: string, category: string, message: string, username: string): string {
  const safePackId = escapeHtml(packId)
  const safeQid = escapeHtml(questionId)
  const safeCategory = escapeHtml(category)
  const safeMessage = escapeHtml(message).replace(/\n/g, '<br />')
  const safeUsername = escapeHtml(username)
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f5fa; margin: 0; padding: 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 32px;">
      <tr><td>
        <h1 style="margin: 0 0 12px; font-size: 20px; color: #1f2937;">Question Report from ${safeUsername}</h1>
        <p style="margin: 0 0 8px;"><strong>Category:</strong> <span style="background:#fee2e2;padding:2px 8px;border-radius:4px;">${safeCategory}</span></p>
        <p style="margin: 0 0 4px;"><strong>Pack ID:</strong> <code style="background:#f3f4f6;padding:2px 4px;border-radius:3px;">${safePackId}</code></p>
        <p style="margin: 0 0 8px;"><strong>Question ID:</strong> <code style="background:#f3f4f6;padding:2px 4px;border-radius:3px;">${safeQid}</code></p>
        ${message ? `<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" /><p style="color:#374151;line-height:1.6;">${safeMessage}</p>` : ''}
      </td></tr>
    </table>
  </body>
</html>`
}

export async function sendQuestionReportEmail(to: string, packId: string, questionId: string, category: string, message: string, username: string): Promise<boolean> {
  const apiKey = getResendApiKey()
  if (!apiKey) {
    return false
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      from: getResendFromAddress(),
      to: [to],
      subject: `[Question Report] ${category} — ${questionId}`,
      html: buildQuestionReportEmailHtml(packId, questionId, category, message, username)
    })
  })
  if (!response.ok) {
    let detail = ''
    try {
      detail = await response.text()
    } catch {
      // ignore
    }
    throw new Error(`Resend request failed: ${response.status} ${response.statusText} ${detail}`.trim())
  }
  return true
}

export async function sendInviteEmail(to: string, inviteUrl: string): Promise<boolean> {
  const apiKey = getResendApiKey()
  if (!apiKey) {
    return false
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      from: getResendFromAddress(),
      to: [to],
      subject: "You've been invited to Quail Ultra Live",
      html: buildInviteEmailHtml(inviteUrl)
    })
  })
  if (!response.ok) {
    let detail = ''
    try {
      detail = await response.text()
    } catch {
      // ignore parsing errors
    }
    throw new Error(`Resend request failed: ${response.status} ${response.statusText} ${detail}`.trim())
  }
  return true
}
