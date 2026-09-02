/** DI token for whichever SMS gateway is configured. */
export const SMS_PROVIDER = 'SMS_PROVIDER';

/** What the gateway said, once the vendor's envelope has been taken off. */
export interface SmsSendResult {
  /**
   * The gateway's own reference for the message, when it gives one.
   *
   * Optional because not every vendor returns one, and X Technologies' documentation describes the
   * success payload only as "sms reports with all details" without saying what is in it. Anything
   * that turns out to be there is kept in `raw`.
   */
  providerRef?: string;
  /** The parsed body, unaltered, so a delivery question can be answered after the fact. */
  raw: unknown;
}

/**
 * One SMS gateway.
 *
 * The portal is deliberately not tied to a vendor (Q8). The notification channel talks to this,
 * and swapping providers is a new file rather than a change to anything that calls it — which
 * matters here more than usual, because the gateway is a single small regional supplier and the
 * Authority may well change it.
 *
 * `send` throws on failure. The dispatcher records the failure against the notification and retries
 * it, so swallowing an error here would turn an undelivered reminder into a delivered one as far as
 * the record is concerned.
 */
export interface SmsProvider {
  /** Named in logs and in the delivery record, so it is clear who was asked. */
  readonly name: string;

  /** False when the gateway has not been configured; the channel then reports itself disabled. */
  isConfigured(): boolean;

  /**
   * Send one message to one number.
   *
   * `to` is E.164 (`+211920000000`). Reshaping it for the vendor is the provider's job.
   */
  send(to: string, message: string): Promise<SmsSendResult>;
}

/** Raised when the gateway refuses a message, carrying whatever it said about why. */
export class SmsSendError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SmsSendError';
  }
}
