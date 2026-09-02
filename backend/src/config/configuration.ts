/**
 * Strongly-typed configuration namespaces, loaded once at startup.
 * Access via ConfigService.get<AppConfig>('app'), etc.
 */
import { DEFAULT_SMS_ENDPOINT } from '../common/constants/app.constants';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  corsOrigins: string[];
  /** Proxies in front of the app; Express counts back this many hops for the caller's address. */
  trustProxyHops: number;
}

export interface JwtConfig {
  secret: string;
  expiresIn: string;
}

export interface ResetConfig {
  frontendUrl: string;
  tokenTtlMin: number;
}

/** The SMS gateway. Empty token means no gateway, and the SMS channel switches itself off. */
export interface SmsConfig {
  url: string;
  token: string;
  senderId: string;
}

export interface MailConfig {
  sendgridApiKey: string;
  from: string;
  fromName: string;
  loginUrl: string;
}

export interface ThrottleConfig {
  ttlSec: number;
  limit: number;
}

export interface StorageConfig {
  /** Directory where uploaded attachment blobs are stored (outside the webroot). */
  dir: string;
  /** Maximum accepted upload size, in bytes. */
  maxFileBytes: number;
}

export interface SchedulerConfig {
  /**
   * Whether this process runs the background jobs. Off in tests so sweeps never fire mid-suite,
   * and a lever for multi-instance deploys: run the jobs on one instance rather than all of them.
   */
  enabled: boolean;
  /** Cron expressions, overridable per environment without a code change. */
  complianceSweepCron: string;
  documentExpiryCron: string;
  notificationRetryCron: string;
  penaltyAccrualCron: string;
  scheduledReportsCron: string;
  nonceSweepCron: string;
  networkFeedsCron: string;
}

/** The machine-to-machine API (Q10, Phase 3). */
export interface MachineApiConfig {
  /**
   * Header a trusted TLS-terminating proxy uses to pass the client certificate fingerprint.
   *
   * Blank by default, and blank means the header is not read at all. Honouring it unconditionally
   * would let any caller claim any certificate simply by setting it, which would turn mutual TLS
   * from a control into a formality. Set it only when a proxy in front of the app is the thing
   * terminating TLS, and only when that proxy strips the header from inbound requests.
   */
  clientCertHeader: string;
  /** How long a spent nonce is kept before the sweep removes it. */
  nonceRetentionMinutes: number;
}

export interface SecurityConfig {
  /** When true, a login requires an OTP challenge before a token is issued. */
  mfaEnabled: boolean;
  /** Demo/static OTP code used while no SMS/email OTP provider is configured. */
  otpStaticCode: string;
  /**
   * Whether the login response echoes the OTP back to the caller. Only ever for a demo where
   * there is no delivery channel: echoing it hands the second factor to whoever asked for the
   * first, which defeats MFA entirely. Defaults to OFF, and must be turned on deliberately.
   */
  otpEchoInResponse: boolean;
  /** OTP challenge lifetime (minutes). */
  otpTtlMin: number;
  /** Consecutive failed password attempts before the account is locked. */
  maxLoginAttempts: number;
  /** How long an account stays locked (minutes). */
  lockoutMinutes: number;
}

export default () => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '4000', 10),
    trustProxyHops: Number(process.env.TRUST_PROXY_HOPS ?? 1),
    corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  } as AppConfig,
  jwt: {
    secret: process.env.JWT_SECRET as string,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '1d',
  } as JwtConfig,
  reset: {
    frontendUrl: process.env.FRONTEND_RESET_URL ?? 'http://localhost:5173/reset-password',
    tokenTtlMin: parseInt(process.env.RESET_TOKEN_TTL_MIN ?? '30', 10),
  } as ResetConfig,
  mail: {
    sendgridApiKey: process.env.SENDGRID_API_KEY ?? '',
    from: process.env.MAIL_FROM ?? 'no-reply@nca.gov.ss',
    fromName: process.env.MAIL_FROM_NAME ?? 'NCA Data Collection Portal',
    loginUrl: process.env.FRONTEND_LOGIN_URL ?? 'http://localhost:5173/login',
  } as MailConfig,
  sms: {
    url: process.env.SMS_API_URL || DEFAULT_SMS_ENDPOINT,
    token: process.env.SMS_API_TOKEN ?? '',
    senderId: process.env.SMS_SENDER_ID ?? 'NCA',
  } as SmsConfig,
  throttle: {
    ttlSec: parseInt(process.env.THROTTLE_TTL_SEC ?? '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
  } as ThrottleConfig,
  storage: {
    dir: process.env.STORAGE_DIR ?? 'storage',
    maxFileBytes: parseInt(process.env.MAX_FILE_MB ?? '25', 10) * 1024 * 1024,
  } as StorageConfig,
  scheduler: {
    // Never in tests: a sweep firing mid-suite makes assertions depend on the clock.
    enabled:
      process.env.NODE_ENV !== 'test' && (process.env.SCHEDULER_ENABLED ?? 'true') !== 'false',
    complianceSweepCron: process.env.COMPLIANCE_SWEEP_CRON ?? '0 2 * * *',
    documentExpiryCron: process.env.DOCUMENT_EXPIRY_CRON ?? '30 2 * * *',
    notificationRetryCron: process.env.NOTIFICATION_RETRY_CRON ?? '15 * * * *',
    // After the compliance sweep, so a case opened this morning is priced in the same run.
    penaltyAccrualCron: process.env.PENALTY_ACCRUAL_CRON ?? '45 2 * * *',
    // Hourly: each schedule decides for itself whether its window has come round, so an hourly
    // check catches a report whose hour was missed while the server was down.
    scheduledReportsCron: process.env.SCHEDULED_REPORTS_CRON ?? '5 * * * *',
    // Twice an hour: a spent nonce only has to outlive its own signature window.
    nonceSweepCron: process.env.NONCE_SWEEP_CRON ?? '20,50 * * * *',
    // Ten past the hour: each feed decides for itself whether its own window has come round.
    networkFeedsCron: process.env.NETWORK_FEEDS_CRON ?? '10 * * * *',
  } as SchedulerConfig,
  machineApi: {
    clientCertHeader: process.env.MACHINE_CLIENT_CERT_HEADER ?? '',
    nonceRetentionMinutes: Number(process.env.MACHINE_NONCE_RETENTION_MINUTES ?? 15),
  } as MachineApiConfig,
  security: {
    mfaEnabled: (process.env.MFA_ENABLED ?? 'true') !== 'false',
    otpStaticCode: process.env.OTP_STATIC_CODE ?? '123456',
    // Fail safe: off unless explicitly enabled. Inferring this from NODE_ENV meant an unset or
    // misspelled NODE_ENV silently returned the OTP in the login response.
    otpEchoInResponse: process.env.OTP_ECHO_IN_RESPONSE === 'true',
    otpTtlMin: parseInt(process.env.OTP_TTL_MIN ?? '5', 10),
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS ?? '5', 10),
    lockoutMinutes: parseInt(process.env.LOCKOUT_MINUTES ?? '15', 10),
  } as SecurityConfig,
});
