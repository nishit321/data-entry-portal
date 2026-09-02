/**
 * Email layout primitives. Emails use table-based markup with inline styles,
 * because email clients (Outlook, Gmail, etc.) do not reliably support modern
 * CSS (flexbox, grid, external stylesheets).
 */

const BRAND = '#1F3A5F';
const BRAND_LIGHT = '#2E5A88';
const TEXT = '#1f2937';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const BG = '#f3f4f6';

export interface InfoRow {
  label: string;
  value: string;
}

/** Escape dynamic values before interpolating them into email HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A bulletproof, table-based call-to-action button. */
export function button(label: string, url: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td align="center" bgcolor="${BRAND}" style="border-radius:6px;">
        <a href="${url}" target="_blank"
           style="display:inline-block;padding:12px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;
}

/** A prominent one-time passcode panel, centred with generous letter spacing. */
export function codeBlock(code: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0;">
    <tr>
      <td align="center" style="padding:20px;background-color:#f8fafc;border:1px solid ${BORDER};border-radius:8px;">
        <div style="font-family:'Courier New',Courier,monospace;font-size:32px;font-weight:bold;letter-spacing:10px;padding-left:10px;color:${BRAND};">${code}</div>
      </td>
    </tr>
  </table>`;
}

/** A light key/value panel, e.g. for account credentials. */
export function infoTable(rows: InfoRow[]): string {
  const body = rows
    .map(
      (r) => `
      <tr>
        <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${MUTED};width:40%;">${r.label}</td>
        <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXT};font-weight:bold;">${r.value}</td>
      </tr>`,
    )
    .join('');
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
         style="margin:16px 0;padding:16px 20px;background-color:#f8fafc;border:1px solid ${BORDER};border-radius:6px;">
    ${body}
  </table>`;
}

export function paragraph(html: string): string {
  return `<p style="margin:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${TEXT};">${html}</p>`;
}

export function muted(html: string): string {
  return `<p style="margin:16px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:${MUTED};">${html}</p>`;
}

/**
 * Wrap body content in the branded shell (header + card + footer).
 * `preheader` is the hidden preview line shown in the inbox list.
 */
export function baseLayout(opts: {
  title: string;
  contentHtml: string;
  preheader?: string;
  year: number;
}): string {
  const { title, contentHtml, preheader = '', year } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:${BG};">
  <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${preheader}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:${BG};padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600"
               style="width:600px;max-width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid ${BORDER};">
          <!-- Header -->
          <tr>
            <td style="background-color:${BRAND};padding:24px 32px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;letter-spacing:0.3px;">
                National Communication Authority
              </div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#cbd5e1;margin-top:2px;">
                Data Collection Portal
              </div>
            </td>
          </tr>
          <!-- Accent bar -->
          <tr><td style="height:4px;background-color:${BRAND_LIGHT};font-size:0;line-height:0;">&nbsp;</td></tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:20px;color:${TEXT};">${title}</h1>
              ${contentHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background-color:#f8fafc;border-top:1px solid ${BORDER};">
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${MUTED};">
                This is an automated message from the NCA Data Collection Portal. Please do not reply to this email.
              </p>
              <p style="margin:8px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTED};">
                &copy; ${year} National Communication Authority, Republic of South Sudan. All data is treated confidentially.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
