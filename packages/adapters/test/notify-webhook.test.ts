/** Story 11.4: the webhook notifier with a fake resolver and a fake transport. Nothing here touches the network. */
import { WEBHOOK_TIMEOUT_MS, type WebhookPayload } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createWebhookNotifier, isBlockedAddress, MAX_WEBHOOK_RESPONSE_BYTES, nodeTransport, type WebhookRequest } from '../src/notify-webhook/index.js';

const payload: WebhookPayload = {
  version: 1,
  event: 'test',
  workspace: null,
  ticket: null,
  run: null,
  text: 'This is a test from Ogden Agents.',
  sentAt: '2026-10-05T00:00:00.000Z',
};

function fakes(options: { addresses?: Array<{ address: string; family: 4 | 6 }>; status?: number; fail?: 'timeout' | 'network' } = {}) {
  const requests: WebhookRequest[] = [];
  const looked: string[] = [];
  const notifier = createWebhookNotifier({
    lookup: async (host) => {
      looked.push(host);
      return options.addresses ?? [{ address: '93.184.216.34', family: 4 }];
    },
    transport: async (request) => {
      requests.push(request);
      if (options.fail === 'timeout') throw Object.assign(new Error('x'), { code: 'timeout' });
      if (options.fail === 'network') throw new Error('ECONNRESET with the secret https://hooks.example.com/T0K3N');
      return { status: options.status ?? 204 };
    },
  });
  return { notifier, requests, looked };
}

describe('the blocked addresses', () => {
  it('refuses link-local, metadata, this-network, multicast and reserved ranges, and the same inside an IPv6 mapping', () => {
    for (const address of ['169.254.169.254', '169.254.0.1', '0.0.0.0', '0.1.2.3', '224.0.0.1', '255.255.255.255', '240.0.0.1', '100.100.100.200', 'fe80::1', 'febf::1', '64:ff9b::a9fe:a9fe', '2002:a9fe:a9fe::', '::ffff:0:a9fe:a9fe', '64:ff9b:1::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', 'ff02::1', 'fd00:ec2::254', '::', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', 'not an address']) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it('allows public, private and loopback addresses', () => {
    for (const address of ['93.184.216.34', '10.0.0.5', '192.168.1.20', '172.16.0.9', '127.0.0.1', '::1', '2606:4700:4700::1111', '::ffff:93.184.216.34', '100.64.0.1', '64:ff9b::5db8:d822', '2002:5db8:d822::']) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });
});

describe('sending a webhook', () => {
  it('POSTs the payload as JSON to the checked address with the 5 second limit and a capped answer; a 2xx is ok', async () => {
    const { notifier, requests, looked } = fakes({ status: 204 });
    const result = await notifier.send('https://hooks.example.com/T0K3N', payload);
    expect(result).toEqual({ ok: true, status: 204, failure: null, message: 'The webhook answered with HTTP 204.' });
    expect(looked).toEqual(['hooks.example.com']);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ address: { address: '93.184.216.34', family: 4 }, maxResponseBytes: MAX_WEBHOOK_RESPONSE_BYTES });
    // One deadline for the lookup and the send: what is left of the 5 seconds.
    expect(requests[0]!.timeoutMs).toBeGreaterThan(WEBHOOK_TIMEOUT_MS - 1000);
    expect(requests[0]!.timeoutMs).toBeLessThanOrEqual(WEBHOOK_TIMEOUT_MS);
    expect(requests[0]!.url.href).toBe('https://hooks.example.com/T0K3N');
    expect(JSON.parse(requests[0]!.body)).toEqual(payload);
  });

  it('a redirect or an error status is a failure with its status, and no redirect is followed', async () => {
    const redirect = await fakes({ status: 302 }).notifier.send('https://hooks.example.com/x', payload);
    expect(redirect).toMatchObject({ ok: false, status: 302, failure: 'http', message: 'The webhook answered with HTTP 302.' });
    const broken = await fakes({ status: 500 }).notifier.send('https://hooks.example.com/x', payload);
    expect(broken).toMatchObject({ ok: false, status: 500, failure: 'http' });
  });

  it('a timeout or a network failure says so in plain words and never carries the URL or the error text', async () => {
    const slow = await fakes({ fail: 'timeout' }).notifier.send('https://hooks.example.com/T0K3N', payload);
    expect(slow).toEqual({ ok: false, status: null, failure: 'timeout', message: "The webhook didn't answer in time." });
    const down = await fakes({ fail: 'network' }).notifier.send('https://hooks.example.com/T0K3N', payload);
    expect(down).toEqual({ ok: false, status: null, failure: 'network', message: "Ogden Agents couldn't reach the webhook." });
    expect(JSON.stringify([slow, down])).not.toMatch(/T0K3N|hooks\.example/);
  });

  it('refuses a name with any blocked address, and a literal blocked address, without sending', async () => {
    const mixed = fakes({ addresses: [{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }] });
    expect(await mixed.notifier.send('https://rebind.example.com/x', payload)).toMatchObject({ ok: false, failure: 'refused' });
    const metadata = fakes();
    expect(await metadata.notifier.send('https://169.254.169.254/latest/meta-data', payload)).toMatchObject({ ok: false, failure: 'refused', message: "Ogden Agents won't send to that address." });
    expect(await metadata.notifier.send('https://[fe80::1]/x', payload)).toMatchObject({ failure: 'refused' });
    expect(mixed.requests).toEqual([]);
    expect(metadata.requests).toEqual([]);
    expect(metadata.looked).toEqual([]);
    expect(await fakes({ addresses: [] }).notifier.send('https://nowhere.example.com/x', payload)).toMatchObject({ failure: 'refused' });
  });

  it('refuses a plain http URL off this computer, a URL with credentials and a bad payload; allows http to loopback', async () => {
    const f = fakes({ addresses: [{ address: '127.0.0.1', family: 4 }] });
    expect(await f.notifier.send('http://hooks.example.com/x', payload)).toMatchObject({ failure: 'refused' });
    expect(await f.notifier.send('https://user:pass@hooks.example.com/x', payload)).toMatchObject({ failure: 'refused' });
    expect(await f.notifier.send('https://hooks.example.com/x', { ...payload, extra: 1 } as never)).toMatchObject({ failure: 'refused' });
    expect(await f.notifier.send('not a url', payload)).toMatchObject({ failure: 'refused' });
    expect(f.requests).toEqual([]);
    expect(await f.notifier.send('http://localhost:8080/hook', payload)).toMatchObject({ ok: true });
    expect(await f.notifier.send('http://127.0.0.1:8080/hook', payload)).toMatchObject({ ok: true });
    expect(f.requests).toHaveLength(2);
  });

  it('a resolver that fails or hangs is a network failure or a timeout', async () => {
    const failing = createWebhookNotifier({ lookup: async () => Promise.reject(new Error('ENOTFOUND')), transport: async () => ({ status: 204 }) });
    expect(await failing.send('https://hooks.example.com/x', payload)).toMatchObject({ failure: 'network' });
    const hanging = createWebhookNotifier({ lookup: () => new Promise(() => undefined), transport: async () => ({ status: 204 }) });
    expect(await hanging.send('https://hooks.example.com/x', payload, { timeoutMs: 20 })).toMatchObject({ failure: 'timeout' });
  });
});

describe('plain http and the real transport', () => {
  it('http is only for a name that resolves to this computer', async () => {
    const f = fakes({ addresses: [{ address: '10.0.0.5', family: 4 }] });
    expect(await f.notifier.send('http://localhost:8080/hook', payload)).toMatchObject({ failure: 'refused' });
    expect(f.requests).toEqual([]);
  });

  // The one test of the built-in transport: a listener on this computer's loopback only, reached through a host name so the pinned lookup is used the way Node 20 and later calls it (with `all`). Nothing leaves the machine.
  it('the built-in transport reaches the pinned address by host name, reads the status and follows no redirect', async () => {
    const seen: Array<{ method: string; url: string; body: string; host: string | undefined }> = [];
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        seen.push({ method: request.method ?? '', url: request.url ?? '', body, host: request.headers.host });
        if (request.url === '/redirect') {
          response.writeHead(302, { location: 'http://127.0.0.1:1/never' });
          response.end();
        } else {
          response.writeHead(204);
          response.end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const base = { address: { address: '127.0.0.1', family: 4 as const }, body: '{"a":1}', timeoutMs: 3000, maxResponseBytes: 1024 };
      const ok = await nodeTransport({ ...base, url: new URL(`http://localhost:${port}/hook?x=1`) });
      expect(ok.status).toBe(204);
      expect(seen[0]).toMatchObject({ method: 'POST', url: '/hook?x=1', body: '{"a":1}', host: `localhost:${port}` });
      const redirected = await nodeTransport({ ...base, url: new URL(`http://localhost:${port}/redirect`) });
      expect(redirected.status).toBe(302);
      expect(seen).toHaveLength(2);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
