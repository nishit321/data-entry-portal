import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { maskPhone } from '../../common/utils/phone.util';
import { SmsProvider, SmsSendError, SmsSendResult } from './sms-provider';

/** How long to wait for the gateway before giving up and letting the dispatcher retry. */
const TIMEOUT_MS = 15_000;

/**
 * The one message type the API defines for ordinary text. Documented as: "For text message you
 * have to insert `plain` as sms type."
 */
const MESSAGE_TYPE = 'plain';

/** An alphanumeric sender is capped by the API at eleven characters. */
export const MAX_SENDER_ID_LENGTH = 11;

/** The gateway's envelope. `data` is undocumented beyond "sms reports with all details". */
interface XTechnologiesResponse {
  status?: string;
  message?: string;
  data?: unknown;
}

export interface XTechnologiesConfig {
  /** Full URL of the send endpoint, e.g. https://sms.xtechnologies.com.ss/api/http/sms/send */
  url: string;
  token: string;
  senderId: string;
}

/**
 * X Technologies (sms.xtechnologies.com.ss), the Authority's SMS gateway.
 *
 * Written from the vendor's HTTP API documentation. Three things in that documentation shape this
 * file, and each of them is the sort of detail that fails silently if it is got wrong:
 *
 * 1. **Numbers go without the `+`.** Every example is a bare international number
 *    (`31612345678`, `8801721970168`) — country code, no plus. The portal stores E.164, so the
 *    plus is stripped on the way out and nowhere else.
 * 2. **The token travels in the request body.** The API also accepts everything as a GET query
 *    string, and the documented example puts the token in the URL. That is not used here: a URL is
 *    written to the web server's access log, to every proxy in between, and to anything that keeps
 *    request history. A POST body is not.
 * 3. **HTTP 200 does not mean sent.** The gateway answers `{"status":"error","message":"…"}` with
 *    a perfectly ordinary 200, so the body decides, not the status code.
 *
 * Redirects are refused rather than followed. A redirect on a request whose body carries the API
 * token would hand that token to wherever the redirect pointed.
 */
@Injectable()
export class XTechnologiesSmsProvider implements SmsProvider {
  readonly name = 'x-technologies';
  private readonly logger = new Logger(XTechnologiesSmsProvider.name);
  private readonly config: XTechnologiesConfig;

  constructor(config: ConfigService) {
    this.config = config.get<XTechnologiesConfig>('sms') ?? { url: '', token: '', senderId: '' };
  }

  isConfigured(): boolean {
    return Boolean(this.config.url && this.config.token && this.config.senderId);
  }

  /** E.164 as the portal stores it, to the bare international number the gateway expects. */
  static toGatewayNumber(e164: string): string {
    return e164.replace(/^\+/, '');
  }

  async send(to: string, message: string): Promise<SmsSendResult> {
    if (!this.isConfigured()) {
      throw new SmsSendError('The SMS gateway is not configured.', this.name);
    }

    const body = {
      api_token: this.config.token,
      recipient: XTechnologiesSmsProvider.toGatewayNumber(to),
      sender_id: this.config.senderId,
      type: MESSAGE_TYPE,
      message,
    };

    let response: Response;
    try {
      response = await fetch(this.config.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        // Never followed: the body carries the API token, and a redirect would forward it.
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // Network, DNS, timeout, or a redirect that was refused. None of them mean "delivered".
      throw new SmsSendError(
        `Could not reach the SMS gateway: ${error instanceof Error ? error.message : 'unknown'}`,
        this.name,
      );
    }

    const text = await response.text();
    let parsed: XTechnologiesResponse;
    try {
      parsed = JSON.parse(text) as XTechnologiesResponse;
    } catch {
      throw new SmsSendError(
        `The SMS gateway answered ${response.status} with something that is not JSON.`,
        this.name,
        response.status,
      );
    }

    // The body decides. A 200 carrying `status: "error"` is a refusal, whatever the status line says.
    if (!response.ok || parsed.status !== 'success') {
      throw new SmsSendError(
        parsed.message?.trim() || `The SMS gateway refused the message (HTTP ${response.status}).`,
        this.name,
        response.status,
      );
    }

    // Masked. A phone number identifies a person, and a log file has a different set of readers
    // and a different retention policy from the database.
    this.logger.log(`Sent an SMS to ${maskPhone(to)} via ${this.name}.`);

    return { providerRef: referenceIn(parsed.data), raw: parsed.data };
  }
}

/**
 * Dig a message reference out of the success payload, if there is one.
 *
 * The documentation does not say what `data` contains, so this looks for the shapes such platforms
 * usually use and gives up quietly otherwise. A reference is useful for chasing a delivery later;
 * it is not worth failing a sent message over.
 */
function referenceIn(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  for (const key of ['uid', 'id', 'message_id', 'messageId']) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}
