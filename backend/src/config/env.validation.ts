import * as Joi from 'joi';

/**
 * Environment variable schema. The application refuses to start if required
 * variables are missing or malformed, surfacing misconfiguration immediately
 * instead of at first request.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),

  PORT: Joi.number().port().default(4000),
  CORS_ORIGIN: Joi.string().default('http://localhost:5173'),
  // How many proxies sit in front. Express counts back this many hops to find the caller's real
  // address, which is what rate limiting and the audit log record. Too few and everyone shares one
  // proxy's address; too many and a caller can spoof their own by sending an X-Forwarded-For.
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(5).default(1),
  // The date a restore was last rehearsed, ISO. Read by `npm run preflight`; nothing else uses it.
  BACKUP_VERIFIED_AT: Joi.string().allow('').default(''),

  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),

  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().default('1d'),

  FRONTEND_RESET_URL: Joi.string().uri().default('http://localhost:5173/reset-password'),
  RESET_TOKEN_TTL_MIN: Joi.number().integer().positive().default(30),

  SENDGRID_API_KEY: Joi.string().allow('').default(''),
  MAIL_FROM: Joi.string().email().default('no-reply@nca.gov.ss'),
  MAIL_FROM_NAME: Joi.string().default('NCA Data Collection Portal'),
  FRONTEND_LOGIN_URL: Joi.string().uri().default('http://localhost:5173/login'),

  // --- SMS gateway (Q8) ---
  // Leave SMS_API_TOKEN empty and the SMS channel reports itself disabled, exactly as it did
  // before a vendor existed. Nothing else changes.
  SMS_API_URL: Joi.string()
    .uri({ scheme: ['https'] })
    .allow('')
    .default('https://sms.xtechnologies.com.ss/api/http/sms/send'),
  SMS_API_TOKEN: Joi.string().allow('').default(''),
  // Alphanumeric senders are capped at eleven characters by the gateway.
  SMS_SENDER_ID: Joi.string().max(11).allow('').default('NCA'),

  THROTTLE_TTL_SEC: Joi.number().integer().positive().default(60),
  THROTTLE_LIMIT: Joi.number().integer().positive().default(100),

  // --- Attachment storage ---
  STORAGE_DIR: Joi.string().default('storage'),
  MAX_FILE_MB: Joi.number().integer().positive().default(25),

  // Background jobs. Cron expressions are standard five-field (minute hour day month weekday).
  SCHEDULER_ENABLED: Joi.string().valid('true', 'false').default('true'),
  COMPLIANCE_SWEEP_CRON: Joi.string().default('0 2 * * *'),
  DOCUMENT_EXPIRY_CRON: Joi.string().default('30 2 * * *'),
  NOTIFICATION_RETRY_CRON: Joi.string().default('15 * * * *'),
  PENALTY_ACCRUAL_CRON: Joi.string().default('45 2 * * *'),
  SCHEDULED_REPORTS_CRON: Joi.string().default('5 * * * *'),
  NONCE_SWEEP_CRON: Joi.string().default('20,50 * * * *'),
  NETWORK_FEEDS_CRON: Joi.string().default('10 * * * *'),
  MACHINE_CLIENT_CERT_HEADER: Joi.string().allow('').default(''),
  MACHINE_NONCE_RETENTION_MINUTES: Joi.number().min(5).max(1440).default(15),

  // --- MFA / OTP / account lockout ---
  MFA_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  OTP_STATIC_CODE: Joi.string().default('123456'),
  // Echoes the OTP in the login response. Demo only; never enable where MFA is relied on.
  OTP_ECHO_IN_RESPONSE: Joi.string().valid('true', 'false').default('false'),
  OTP_TTL_MIN: Joi.number().integer().positive().default(5),
  MAX_LOGIN_ATTEMPTS: Joi.number().integer().positive().default(5),
  LOCKOUT_MINUTES: Joi.number().integer().positive().default(15),

  SEED_ADMIN_EMAIL: Joi.string().email().default('admin@nca.gov.ss'),
  SEED_ADMIN_PASSWORD: Joi.string().min(8).default('Admin@12345'),
});
