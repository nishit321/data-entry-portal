/* eslint-disable no-console -- a command-line tool reports by printing */
/**
 * Send one real text message through the configured gateway, and print exactly what came back.
 *
 *   npm run sms:test -- --to +211920000000
 *
 * Two things this is for. The first is the ordinary one: proving, on the day it matters, that the
 * token still works and the sender ID is still registered, without waiting for a real notification
 * to be the test. The second is specific to this vendor: their documentation describes the success
 * payload only as "sms reports with all details" and never says what is in it, so the shape of a
 * real reply is genuinely unknown until one arrives. This prints it whole.
 *
 * `--to` is required and has no default. **This sends a real message to a real handset and spends
 * real credit**, and a script that could do that with no argument would eventually do it by
 * accident.
 */
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { maskPhone, normalisePhone } from '../src/common/utils/phone.util';
import { DEFAULT_SMS_ENDPOINT } from '../src/common/constants/app.constants';
import { XTechnologiesSmsProvider } from '../src/notifications/sms/x-technologies.provider';
import { SmsSendError } from '../src/notifications/sms/sms-provider';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const to = arg('to');
  if (!to) {
    console.error('Usage: npm run sms:test -- --to +211920000000 [--message "..."]');
    console.error('The number is required. This sends a real message and spends real credit.');
    process.exit(1);
  }

  const phone = normalisePhone(to);
  if (!phone) {
    console.error(`"${to}" is not a phone number this portal would store.`);
    console.error('Include the country code, or start with 0 for a South Sudanese number.');
    process.exit(1);
  }

  const config = {
    url: (process.env.SMS_API_URL ?? '').trim() || DEFAULT_SMS_ENDPOINT,
    token: (process.env.SMS_API_TOKEN ?? '').trim(),
    senderId: (process.env.SMS_SENDER_ID ?? '').trim(),
  };

  const provider = new XTechnologiesSmsProvider({ get: () => config } as unknown as ConfigService);
  if (!provider.isConfigured()) {
    console.error('The SMS gateway is not configured. Set SMS_API_TOKEN and SMS_SENDER_ID.');
    process.exit(1);
  }

  const message =
    arg('message') ?? `NCA Portal test message, sent ${new Date().toISOString().slice(0, 16)}Z.`;

  console.log('');
  console.log(`  endpoint  ${config.url}`);
  console.log(`  sender    ${config.senderId}`);
  console.log(
    `  to        ${maskPhone(phone)}  (as ${XTechnologiesSmsProvider.toGatewayNumber(phone)})`,
  );
  console.log(`  message   ${message}`);
  console.log('');

  try {
    const result = await provider.send(phone, message);
    console.log('  The gateway accepted it.');
    console.log('');
    console.log('  Reference it gave us:', result.providerRef ?? '(none — see the payload below)');
    console.log('  Raw `data` payload, whole:');
    console.log(JSON.stringify(result.raw, null, 2).replace(/^/gm, '    '));
    console.log('');
    console.log('  Whether a handset actually rang is the only part this cannot tell you.');
  } catch (error) {
    const why = error instanceof SmsSendError ? error.message : String(error);
    console.error(`  The gateway refused it: ${why}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
