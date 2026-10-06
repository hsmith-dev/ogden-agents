/**
 * `notify-webhook` (story 11.4): the real `NotifierPort`. It POSTs one
 * payload as JSON to the URL the user saved and says what came back, and it
 * is built so a webhook URL can never be used to reach what the user did not
 * mean (AD-16):
 *
 * - `https:` to any host, or `http:` to this computer only (the shared
 *   `WebhookUrl` rules, checked again here); no credentials in the URL.
 * - The host is resolved once, every address is checked, and the request goes
 *   to the address that was checked (no second lookup to rebind): link-local
 *   (`169.254.0.0/16`, `fe80::/10`), the cloud metadata addresses, "this
 *   network" (`0.0.0.0/8`), multicast and the reserved and broadcast ranges
 *   are refused. Private and loopback addresses are allowed: a notification
 *   app on the user's own network is the point.
 * - 5 seconds for everything, no redirect is followed (a 3xx is a failure),
 *   and at most 64 KiB of the answer is read.
 * - A result never holds the URL, its host or the answer's body.
 *
 * The network is reached only through the injectable `lookup` and
 * `transport`, so every test runs with fakes and nothing leaves the machine.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { NotifierPort, NotifierSendOptions } from '@ogden-agents/core';
import {
  WEBHOOK_NETWORK_MESSAGE,
  WEBHOOK_REFUSED_MESSAGE,
  WEBHOOK_TIMEOUT_MESSAGE,
  WEBHOOK_TIMEOUT_MS,
  WebhookPayload,
  WebhookUrl,
  webhookHttpMessage,
  type WebhookTestResult,
} from '@ogden-agents/shared';

/** The most of an answer that is read before the connection is closed. */
export const MAX_WEBHOOK_RESPONSE_BYTES = 64 * 1024;

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface WebhookRequest {
  url: URL;
  /** The address that was checked; the connection goes here, with the URL's own host for the certificate and the `Host` header. */
  address: ResolvedAddress;
  body: string;
  timeoutMs: number;
  maxResponseBytes: number;
}

/** Sends the request and answers the HTTP status. Rejects with `{ code: 'timeout' }` or any other error for a network failure. */
export type WebhookTransport = (request: WebhookRequest) => Promise<{ status: number }>;

export interface WebhookNotifierOptions {
  /** Resolves a host name to every address it has. Default: the OS resolver. */
  lookup?: (host: string) => Promise<ResolvedAddress[]>;
  transport?: WebhookTransport;
}

function ipv4Parts(address: string): number[] | undefined {
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : undefined;
}

/** The IPv6 address as eight 16-bit groups, or `undefined`. */
function ipv6Groups(address: string): number[] | undefined {
  let text = address.toLowerCase().split('%')[0]!;
  // A trailing dotted IPv4 (::ffff:1.2.3.4) is two groups.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1];
  if (dotted !== undefined) {
    const v4 = ipv4Parts(dotted);
    if (v4 === undefined) return undefined;
    text = `${text.slice(0, -dotted.length)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] === '' ? [] : halves[0]!.split(':');
  const tail = halves.length === 2 ? (halves[1] === '' ? [] : halves[1]!.split(':')) : [];
  if (halves.length === 1 && head.length !== 8) return undefined;
  const fill = 8 - head.length - tail.length;
  if (fill < 0 || (halves.length === 2 && fill < 1)) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...tail].map((group) => parseInt(group, 16));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : undefined;
}

/** Whether a webhook may never be sent to `address` (see the header). An address that can't be read is refused. */
export function isBlockedAddress(address: string): boolean {
  const v4 = isIP(address) === 4 ? ipv4Parts(address) : undefined;
  if (v4 !== undefined) {
    const [a, b, c, d] = v4 as [number, number, number, number];
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a >= 224) return true;
    // Alibaba Cloud's metadata address sits inside the shared address space.
    if (a === 100 && b === 100 && c === 100 && d === 200) return true;
    return false;
  }
  if (isIP(address) !== 6) return true;
  const groups = ipv6Groups(address);
  if (groups === undefined) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [number, number, number, number, number, number, number, number];
  // `::` itself, and the IPv4 mapped and compatible forms, judged by the address inside.
  if (groups.every((group) => group === 0)) return true;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0) && !(g5 === 0 && g6 === 0 && g7 <= 1)) {
    return isBlockedAddress(`${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`);
  }
  const embedded = (hi: number, lo: number) => isBlockedAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  // NAT64 (`64:ff9b::/96`), 6to4 (`2002:v4::`) and SIIT (`::ffff:0:v4`) carry an IPv4 address: judged by it. Teredo (`2001::/32`) and the local NAT64 range are refused whole.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return embedded(g6, g7);
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return true;
  if (g0 === 0x2002) return embedded(g1, g2);
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0xffff && g5 === 0) return embedded(g6, g7);
  if (g0 === 0x2001 && g1 === 0) return true;
  if ((g0 & 0xffc0) === 0xfe80) return true;
  if ((g0 & 0xff00) === 0xff00) return true;
  // AWS's IPv6 metadata address.
  if (g0 === 0xfd00 && g1 === 0x0ec2 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 0x0254) return true;
  return false;
}

const refused = (): WebhookTestResult => ({ ok: false, status: null, failure: 'refused', message: WEBHOOK_REFUSED_MESSAGE });

/** The built-in transport: `node:https` (or `node:http` to this computer), the checked address, no redirect, a capped answer. */
export const nodeTransport: WebhookTransport = ({ url, address, body, timeoutMs, maxResponseBytes }) =>
  new Promise((resolve, reject) => {
    const secure = url.protocol === 'https:';
    const send = secure ? httpsRequest : httpRequest;
    const request = send(
      {
        method: 'POST',
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port === '' ? undefined : Number(url.port),
        path: `${url.pathname}${url.search}`,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'user-agent': 'ogden-agents-webhook' },
        // The one lookup there is: the address that was checked.
        // Node 20 and later asks with `all: true` (it tries each family) and expects a list; older callers expect one address.
        lookup: (_host, lookupOptions, callback) => {
          const answer = callback as unknown as (error: Error | null, address: unknown, family?: number) => void;
          if ((lookupOptions as { all?: boolean } | undefined)?.all === true) answer(null, [{ address: address.address, family: address.family }]);
          else answer(null, address.address, address.family);
        },
        agent: false,
        timeout: timeoutMs,
      },
      (response) => {
        let read = 0;
        response.on('data', (chunk: Buffer) => {
          read += chunk.length;
          if (read > maxResponseBytes) response.destroy();
        });
        response.on('error', () => undefined);
        // The status is all that is used: no wait for the body.
        resolve({ status: response.statusCode ?? 0 });
        response.resume();
      },
    );
    request.on('timeout', () => request.destroy(Object.assign(new Error('timeout'), { code: 'timeout' })));
    request.on('error', reject);
    // A whole-request limit, not only an idle one.
    const timer = setTimeout(() => request.destroy(Object.assign(new Error('timeout'), { code: 'timeout' })), timeoutMs);
    request.on('close', () => clearTimeout(timer));
    request.end(body);
  });

export function createWebhookNotifier(options: WebhookNotifierOptions = {}): NotifierPort {
  const lookup =
    options.lookup ??
    (async (host: string) => (await dnsLookup(host, { all: true })).map((entry) => ({ address: entry.address, family: entry.family === 6 ? (6 as const) : (4 as const) })));
  const transport = options.transport ?? nodeTransport;
  return {
    async send(rawUrl: string, payload, sendOptions: NotifierSendOptions = {}) {
      const parsedUrl = WebhookUrl.safeParse(rawUrl);
      const parsedPayload = WebhookPayload.safeParse(payload);
      if (!parsedUrl.success || !parsedPayload.success) return refused();
      let url: URL;
      try {
        url = new URL(parsedUrl.data);
      } catch {
        return refused();
      }
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const startedAt = Date.now();
      const limitMs = sendOptions.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
      const timeoutMs = limitMs;
      let addresses: ResolvedAddress[];
      try {
        addresses = isIP(host) === 0 ? await withTimeout(lookup(host), limitMs) : [{ address: host, family: isIP(host) === 6 ? 6 : 4 }];
      } catch (error) {
        return (error as { code?: string }).code === 'timeout' ? { ok: false, status: null, failure: 'timeout', message: WEBHOOK_TIMEOUT_MESSAGE } : { ok: false, status: null, failure: 'network', message: WEBHOOK_NETWORK_MESSAGE };
      }
      // Every address it has, so a name with one good and one bad address is refused, never half trusted.
      if (addresses.length === 0 || addresses.some((entry) => isBlockedAddress(entry.address))) return refused();
      // Plain `http:` only ever reaches this computer, whatever the name resolves to.
      if (url.protocol === 'http:' && !addresses.every((entry) => entry.address === '::1' || entry.address.startsWith('127.'))) return refused();
      try {
        const answer = await transport({ url, address: addresses[0]!, body: JSON.stringify(parsedPayload.data), timeoutMs: Math.max(1, limitMs - (Date.now() - startedAt)), maxResponseBytes: MAX_WEBHOOK_RESPONSE_BYTES });
        // A redirect is a failure: the URL the user saved is the only one ever sent to.
        if (answer.status >= 200 && answer.status < 300) return { ok: true, status: answer.status, failure: null, message: webhookHttpMessage(answer.status) };
        return { ok: false, status: answer.status >= 100 && answer.status <= 599 ? answer.status : null, failure: 'http', message: webhookHttpMessage(answer.status) };
      } catch (error) {
        return (error as { code?: string }).code === 'timeout' ? { ok: false, status: null, failure: 'timeout', message: WEBHOOK_TIMEOUT_MESSAGE } : { ok: false, status: null, failure: 'network', message: WEBHOOK_NETWORK_MESSAGE };
      }
    },
  };
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
