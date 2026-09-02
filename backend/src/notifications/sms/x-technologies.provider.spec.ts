import { ConfigService } from '@nestjs/config';
import { SmsSendError } from './sms-provider';
import { XTechnologiesSmsProvider } from './x-technologies.provider';

/**
 * The gateway adapter, against the shapes its documentation describes.
 *
 * `fetch` is replaced rather than called: these assert what the portal *sends* and how it reads
 * what comes back, which is where the mistakes live. Whether the vendor's server is up is not
 * something a unit test can or should answer.
 */

function provider(over: Partial<{ url: string; token: string; senderId: string }> = {}) {
  const config = {
    url: 'https://sms.example.ss/api/http/sms/send',
    token: 'test-token',
    senderId: 'NCA',
    ...over,
  };
  return new XTechnologiesSmsProvider({ get: () => config } as unknown as ConfigService);
}

function answers(body: unknown, status = 200) {
  const spy = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

describe('XTechnologiesSmsProvider', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('what it sends', () => {
    it('strips the plus, because every example in the API is a bare international number', async () => {
      const spy = answers({ status: 'success', data: { uid: 'abc123' } });

      await provider().send('+211920000000', 'Hello');

      const body = JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.recipient).toBe('211920000000');
    });

    it('sends the documented parameters, under their documented names', async () => {
      const spy = answers({ status: 'success', data: {} });

      await provider({ token: 'tok', senderId: 'NCA' }).send('+211920000000', 'Your return is due');

      const [url, init] = spy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://sms.example.ss/api/http/sms/send');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({
        api_token: 'tok',
        recipient: '211920000000',
        sender_id: 'NCA',
        type: 'plain',
        message: 'Your return is due',
      });
    });

    it('puts the token in the body, never in the URL', async () => {
      // The API accepts a GET with the token in the query string. A URL is written to the web
      // server's access log, to every proxy in between, and to anything keeping request history.
      const spy = answers({ status: 'success', data: {} });

      await provider({ token: 'secret-token' }).send('+211920000000', 'Hello');

      const [url, init] = spy.mock.calls[0] as [string, RequestInit];
      expect(url).not.toContain('secret-token');
      expect(init.body as string).toContain('secret-token');
    });

    it('refuses to follow a redirect, which would forward the token', async () => {
      const spy = answers({ status: 'success', data: {} });

      await provider().send('+211920000000', 'Hello');

      expect((spy.mock.calls[0]![1] as RequestInit).redirect).toBe('error');
    });
  });

  describe('what it makes of the answer', () => {
    it('treats a 200 carrying an error as a failure, because the gateway does', async () => {
      // The documented failure shape comes back with an ordinary 200. Reading the status line
      // alone would record every rejected message as delivered.
      answers({ status: 'error', message: 'Insufficient balance.' });

      await expect(provider().send('+211920000000', 'Hello')).rejects.toThrow(
        'Insufficient balance.',
      );
    });

    it('keeps the gateway own wording, which is the only diagnosis it offers', async () => {
      answers({ status: 'error', message: 'Sender ID not registered.' });

      const failure = await provider()
        .send('+211920000000', 'Hello')
        .catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(SmsSendError);
      expect(failure).toMatchObject({
        message: 'Sender ID not registered.',
        provider: 'x-technologies',
      });
    });

    it('fails clearly when the answer is not JSON at all', async () => {
      // A gateway behind a captive portal or an outage page answers HTML with a 200.
      answers('<html>Gateway timeout</html>');

      await expect(provider().send('+211920000000', 'Hello')).rejects.toThrow(/not JSON/);
    });

    it('picks up a message reference when one is there', async () => {
      answers({ status: 'success', data: { uid: '606812e63f78b' } });

      const result = await provider().send('+211920000000', 'Hello');

      expect(result.providerRef).toBe('606812e63f78b');
      expect(result.raw).toEqual({ uid: '606812e63f78b' });
    });

    it('sends happily when there is no reference to find', async () => {
      // The documentation describes the success payload only as "sms reports with all details".
      // Whatever it turns out to be, a missing reference is not a reason to fail a sent message.
      answers({ status: 'success', data: 'queued' });

      const result = await provider().send('+211920000000', 'Hello');

      expect(result.providerRef).toBeUndefined();
      expect(result.raw).toBe('queued');
    });

    it('does not mistake a network failure for a delivery', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ETIMEDOUT')) as unknown as typeof fetch;

      await expect(provider().send('+211920000000', 'Hello')).rejects.toThrow(
        /Could not reach the SMS gateway/,
      );
    });
  });

  describe('when there is no gateway', () => {
    it('reports itself unconfigured rather than half-configured', () => {
      expect(provider().isConfigured()).toBe(true);
      expect(provider({ token: '' }).isConfigured()).toBe(false);
      expect(provider({ senderId: '' }).isConfigured()).toBe(false);
      expect(provider({ url: '' }).isConfigured()).toBe(false);
    });

    it('refuses to send instead of pretending to', async () => {
      const spy = answers({ status: 'success', data: {} });

      await expect(provider({ token: '' }).send('+211920000000', 'Hello')).rejects.toThrow(
        /not configured/,
      );
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
