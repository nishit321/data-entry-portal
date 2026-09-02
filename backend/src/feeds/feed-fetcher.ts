import { Injectable, Logger } from '@nestjs/common';
import { request as httpsRequest } from 'https';
import { lookup as dnsLookup } from 'dns';
import type { LookupAddress } from 'dns';
import { checkFeedUrl, isPubliclyRoutable } from './feed-url';

/** A feed body must not be able to fill the disk. Comfortably above any real metric payload. */
const MAX_BYTES = 5 * 1024 * 1024;

/** An operator's endpoint gets this long to answer before the run is called a failure. */
const TIMEOUT_MS = 20_000;

/** One metric as it arrives on the wire. */
export interface IncomingMetric {
  key: string;
  value: number;
  unit?: string | null;
  measuredAt: string;
}

export interface FetchResult {
  ok: boolean;
  httpStatus?: number;
  metrics: IncomingMetric[];
  /** Why it failed, in words that go in front of an administrator. */
  message?: string;
}

/**
 * Fetching a feed from an operator's endpoint (Q10, Phase 3).
 *
 * The security of this class rests on one decision: the DNS lookup is *ours*, and every address it
 * returns is checked before the socket is opened. Checking the hostname and then letting Node
 * resolve it independently is the DNS-rebinding hole — the name resolves to a public address for
 * the check and to an internal one for the connection. Passing our own `lookup` to the request
 * means the address that was checked is the address that is dialled.
 *
 * Redirects are not followed at all. A redirect is a second address the operator chose after the
 * first one was approved, and there is no good reason for a metrics endpoint to need one.
 */
@Injectable()
export class FeedFetcher {
  private readonly logger = new Logger(FeedFetcher.name);

  async fetch(rawUrl: string, authToken?: string | null): Promise<FetchResult> {
    const checked = checkFeedUrl(rawUrl);
    if (!checked.ok || !checked.url) {
      return { ok: false, metrics: [], message: checked.reason };
    }
    const url = checked.url;

    let body: string;
    let status: number;
    try {
      const response = await this.get(url, authToken);
      body = response.body;
      status = response.status;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The endpoint could not be reached.';
      return { ok: false, metrics: [], message };
    }

    if (status < 200 || status >= 300) {
      return {
        ok: false,
        httpStatus: status,
        metrics: [],
        message: `The endpoint answered ${status}.`,
      };
    }

    const parsed = this.parse(body);
    if (!parsed.ok) return { ok: false, httpStatus: status, metrics: [], message: parsed.message };
    return { ok: true, httpStatus: status, metrics: parsed.metrics };
  }

  /**
   * A single GET, with our own resolver, a hard timeout and a size cap.
   *
   * Written against `https.request` rather than `fetch` for one reason: `fetch` gives no way to
   * supply a lookup function, and without that the address we validated is not necessarily the
   * address that gets dialled.
   */
  private get(url: URL, authToken?: string | null): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          protocol: url.protocol,
          hostname: url.hostname.replace(/^\[|\]$/g, ''),
          port: 443,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          timeout: TIMEOUT_MS,
          headers: {
            accept: 'application/json',
            'user-agent': 'NCA-Portal-Feed/1',
            ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
          },
          // Every address the name resolves to is checked here, and only an allowed one is
          // handed back to be dialled. This is the rebinding defence.
          lookup: (hostname, options, callback) => {
            dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
              if (err) return callback(err, '', 4);
              const list = addresses as LookupAddress[];
              const allowed = list.filter((a) => isPubliclyRoutable(a.address).ok);
              if (allowed.length === 0) {
                const first = list[0]?.address ?? hostname;
                const why = isPubliclyRoutable(first).reason ?? 'That address cannot be reached.';
                return callback(new Error(why), '', 4);
              }
              if (options && (options as { all?: boolean }).all) {
                return (callback as unknown as (e: Error | null, a: LookupAddress[]) => void)(
                  null,
                  allowed,
                );
              }
              return callback(null, allowed[0].address, allowed[0].family);
            });
          },
        },
        (res) => {
          // A redirect is a second address chosen after the first was approved.
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
            res.destroy();
            reject(new Error('The endpoint redirected. A feed address must answer directly.'));
            return;
          }

          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BYTES) {
              res.destroy();
              reject(new Error('The response was too large.'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
          );
          res.on('error', reject);
        },
      );

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('The endpoint did not answer in time.'));
      });
      req.on('error', (err) => reject(err));
      req.end();
    });
  }

  /**
   * Read the metrics out of a response.
   *
   * The shape is deliberately dull — `{ "metrics": [{ key, value, unit?, measuredAt }] }` — because
   * an operator's integrator has to implement it from a paragraph of a data-sharing agreement, and
   * anything cleverer would be got wrong.
   */
  private parse(body: string): { ok: boolean; metrics: IncomingMetric[]; message?: string } {
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return { ok: false, metrics: [], message: 'The response was not valid JSON.' };
    }

    const rows = (payload as { metrics?: unknown })?.metrics;
    if (!Array.isArray(rows)) {
      return { ok: false, metrics: [], message: 'The response did not contain a metrics list.' };
    }

    const metrics: IncomingMetric[] = [];
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      const key = typeof r.key === 'string' ? r.key.trim() : '';
      const value = Number(r.value);
      const measuredAt = typeof r.measuredAt === 'string' ? r.measuredAt : '';

      // A row that cannot be read is skipped rather than failing the whole run: one malformed
      // metric should not throw away the hundred beside it that were fine.
      if (!key || !Number.isFinite(value) || Number.isNaN(new Date(measuredAt).getTime())) {
        this.logger.warn(`Skipped an unreadable metric row: ${JSON.stringify(row).slice(0, 120)}`);
        continue;
      }
      metrics.push({
        key: key.slice(0, 120),
        value,
        unit: typeof r.unit === 'string' ? r.unit.slice(0, 40) : null,
        measuredAt,
      });
    }

    return { ok: true, metrics };
  }
}
