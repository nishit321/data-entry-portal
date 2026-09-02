import { baseLayout, button, codeBlock, escapeHtml, infoTable, paragraph, muted } from './layout';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Full name (first + last) if we have any part, otherwise a neutral fallback. */
function greetingName(firstName?: string, lastName?: string): string {
  const full = [firstName, lastName]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part)
    .join(' ');
  return full.length > 0 ? full : 'there';
}

/** One-time verification code sent during login when MFA is enabled. */
export function otpEmail(opts: {
  firstName?: string;
  lastName?: string;
  email: string;
  code: string;
  expiresInMinutes: number;
  year: number;
}): RenderedEmail {
  const { firstName, lastName, email, code, expiresInMinutes, year } = opts;
  const name = greetingName(firstName, lastName);
  const subject = 'Your NCA Portal verification code';

  const content =
    paragraph(`Hi ${escapeHtml(name)},`) +
    paragraph(
      `We received a request to sign in to the NCA Data Collection Portal with <strong>${escapeHtml(email)}</strong>. Enter the verification code below to finish signing in.`,
    ) +
    codeBlock(code) +
    muted(
      `This code expires in ${expiresInMinutes} minutes. Keep it to yourself. NCA staff will never ask you for it.`,
    ) +
    muted(
      'If you did not try to sign in, your password may no longer be secure. Please contact your portal administrator.',
    );

  const text = [
    `Hi ${name},`,
    '',
    `We received a request to sign in to the NCA Data Collection Portal with ${email}.`,
    'Enter the verification code below to finish signing in.',
    '',
    `Verification code: ${code}`,
    '',
    `This code expires in ${expiresInMinutes} minutes. Keep it to yourself. NCA staff will never ask you for it.`,
    'If you did not try to sign in, please contact your portal administrator.',
  ].join('\n');

  return {
    subject,
    html: baseLayout({
      title: 'Verify your sign-in',
      contentHtml: content,
      preheader: 'Use the verification code inside to finish signing in.',
      year,
    }),
    text,
  };
}

/** Password reset email. */
export function passwordResetEmail(opts: {
  resetUrl: string;
  expiresInMinutes: number;
  year: number;
}): RenderedEmail {
  const { resetUrl, expiresInMinutes, year } = opts;
  const subject = 'Reset your password';

  const content =
    paragraph('We received a request to reset the password for your account.') +
    paragraph('Click the button below to choose a new password.') +
    button('Reset password', resetUrl) +
    muted(
      `This link expires in ${expiresInMinutes} minutes. If you did not request a password reset, you can safely ignore this email. Your password will not change.`,
    ) +
    muted(
      `If the button does not work, copy and paste this link into your browser:<br/><span style="color:#2E5A88;word-break:break-all;">${resetUrl}</span>`,
    );

  const text = [
    'Reset your password',
    '',
    'We received a request to reset the password for your account.',
    'Open the link below to choose a new password:',
    resetUrl,
    '',
    `This link expires in ${expiresInMinutes} minutes.`,
    'If you did not request this, you can ignore this email.',
  ].join('\n');

  return {
    subject,
    html: baseLayout({
      title: 'Reset your password',
      contentHtml: content,
      preheader: 'Use the link inside to set a new password.',
      year,
    }),
    text,
  };
}

/** Welcome email sent when an admin creates an account. */
export function welcomeEmail(opts: {
  email: string;
  temporaryPassword: string;
  loginUrl: string;
  year: number;
}): RenderedEmail {
  const { email, temporaryPassword, loginUrl, year } = opts;
  const subject = 'Your NCA Portal account has been created';

  const content =
    paragraph(
      'An account has been created for you on the NCA Data Collection Portal. You can sign in with the credentials below.',
    ) +
    infoTable([
      { label: 'Email', value: email },
      { label: 'Temporary password', value: temporaryPassword },
    ]) +
    button('Sign in', loginUrl) +
    muted(
      'For your security, please sign in and change this temporary password as soon as possible.',
    );

  const text = [
    'Your NCA Portal account has been created',
    '',
    'An account has been created for you on the NCA Data Collection Portal.',
    '',
    `Email: ${email}`,
    `Temporary password: ${temporaryPassword}`,
    '',
    `Sign in: ${loginUrl}`,
    '',
    'Please sign in and change this temporary password as soon as possible.',
  ].join('\n');

  return {
    subject,
    html: baseLayout({
      title: 'Welcome to the NCA Data Collection Portal',
      contentHtml: content,
      preheader: 'Your account is ready. Sign in with the details inside.',
      year,
    }),
    text,
  };
}

/**
 * A generic portal notification email — the email face of an in-app notification.
 * The title and body come from the notification itself; an optional action button
 * deep-links back into the portal.
 */
export function notificationEmail(opts: {
  firstName?: string;
  lastName?: string;
  title: string;
  body: string;
  actionUrl?: string;
  actionLabel?: string;
  year: number;
}): RenderedEmail {
  const { firstName, lastName, title, body, actionUrl, actionLabel, year } = opts;
  const name = greetingName(firstName, lastName);

  const content =
    paragraph(`Hi ${escapeHtml(name)},`) +
    paragraph(escapeHtml(body)) +
    (actionUrl ? button(actionLabel ?? 'Open the portal', actionUrl) : '') +
    muted('You are receiving this because you have an account on the NCA Data Collection Portal.');

  const text = [
    `Hi ${name},`,
    '',
    body,
    ...(actionUrl ? ['', `${actionLabel ?? 'Open the portal'}: ${actionUrl}`] : []),
  ].join('\n');

  return {
    subject: title,
    html: baseLayout({
      title,
      contentHtml: content,
      preheader: body.slice(0, 120),
      year,
    }),
    text,
  };
}
