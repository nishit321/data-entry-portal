import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { baseLayout } from './templates/layout';

/**
 * The letterhead.
 *
 * Email is the only part of the portal that leaves it, and the one piece most likely to be
 * printed, forwarded or attached to something. It is also the hardest to look at: nobody opens
 * four mail clients to check a change, which is why the seal is held here instead.
 */
describe('the email letterhead', () => {
  const render = (logoUrl?: string) =>
    baseLayout({ title: 'A title', contentHtml: '<p>Body</p>', year: 2026, logoUrl });

  it('carries the seal as an address a mail client can fetch', () => {
    const html = render('https://data.nca.gov.ss/brand/nca-logo-email.png');
    expect(html).toContain('src="https://data.nca.gov.ss/brand/nca-logo-email.png"');
    // Sized in the attributes, not only in CSS: Outlook ignores the stylesheet and would
    // otherwise lay the image out at its full width.
    expect(html).toContain('width="48"');
  });

  it('leaves the seal out rather than sending a broken image', () => {
    const html = render(undefined);
    expect(html).not.toContain('<img');
    // The header still says who sent it.
    expect(html).toContain('National Communication Authority');
  });

  it('treats the seal as decoration, because the name is written beside it', () => {
    // A screen reader that announces the seal and then reads the same name is noise, and a client
    // with images off should show nothing rather than a filename.
    expect(render('https://x.test/l.png')).toContain('alt=""');
  });

  it('names the Authority the way its own seal does', () => {
    const html = render(undefined);
    expect(html).toContain('Republic of South Sudan');
    // Not "Communications". The seal reads NATIONAL COMMUNICATION AUTHORITY.
    expect(html).not.toMatch(/National Communications Authority/);
  });
});

describe('where the seal is served from', () => {
  function service(loginUrl: string) {
    const config = {
      get: () => ({
        from: 'no-reply@nca.gov.ss',
        fromName: 'NCA',
        loginUrl,
        sendgridApiKey: '',
      }),
    } as unknown as ConfigService;
    return new MailService(config);
  }

  /** Reach the private getter the way the templates do, without exporting it for the test. */
  const logoUrl = (s: MailService) => (s as unknown as { logoUrl: string | undefined }).logoUrl;

  it('takes the origin from the sign-in URL the server already has', () => {
    /*
     * No separate variable for this. A server that can send people to a working sign-in page can
     * serve an image from the same host, and one more thing to set is one more thing to be wrong
     * on exactly the deployment nobody checked.
     */
    expect(logoUrl(service('https://data.nca.gov.ss/login'))).toBe(
      'https://data.nca.gov.ss/brand/nca-logo-email.png',
    );
  });

  it('keeps the port and scheme of wherever it is actually running', () => {
    expect(logoUrl(service('http://localhost:5173/login'))).toBe(
      'http://localhost:5173/brand/nca-logo-email.png',
    );
  });

  it('says nothing rather than guessing when the sign-in URL is unusable', () => {
    expect(logoUrl(service('not-a-url'))).toBeUndefined();
  });
});
