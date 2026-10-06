/**
 * Story 11.4 on a real core with fake ports: the webhooks (their URLs only in
 * the keychain, listed back masked), what is sent for a blocked run and a run
 * ready for review, and nothing for a project with builds off.
 */
import { SecretsUnavailableError, ValidationError, maskedHost, type NotifierPort, type SecretStorePort } from '../src/index.js';
import { WebhookPayload, type WebhookTestResult } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { harness, type Harness } from './builds-harness.js';

const URL_A = 'https://hooks.example.com/services/T0K3N-A';
const URL_B = 'https://other.example.org/notify/T0K3N-B';

function ports(options: { keychain?: boolean } = {}) {
  const store = new Map<string, string>();
  const secrets: SecretStorePort = {
    backend: 'memory',
    get: async (name) => store.get(name),
    set: async (name, value) => {
      if (options.keychain === false) throw new SecretsUnavailableError();
      store.set(name, value);
    },
    delete: async (name) => {
      store.delete(name);
    },
  };
  const sent: Array<{ url: string; payload: WebhookPayload }> = [];
  const answers = new Map<string, WebhookTestResult>();
  const notifier: NotifierPort = {
    send: async (url, payload) => {
      sent.push({ url, payload });
      return answers.get(url) ?? { ok: true, status: 204, failure: null, message: 'The webhook answered with HTTP 204.' };
    },
  };
  const records: unknown[] = [];
  return { store, secrets, notifier, sent, answers, records, onSent: (record: unknown) => records.push(record) };
}

async function setup(options: { keychain?: boolean } = {}) {
  const h = await harness();
  const p = ports(options);
  const notifications = h.core.createNotifications({ secrets: p.secrets, notifier: p.notifier, titleOf: async (_ws, ref) => `Title of ${ref}`, onSent: p.onSent });
  return { h, p, notifications };
}

/** Ends the ticket's build with its plan `status` (`built` verifies it, `blocked` blocks it). */
async function finish(h: Harness, status: 'built' | 'blocked') {
  const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
  h.tickets.set(run.worktreePath!, '1.1', status, status === 'blocked' ? 'unclear intent' : undefined);
  await h.endTurn(session.id);
  return run.id;
}

describe('the masked host', () => {
  it('shows only the registrable domain, and says what an address or this computer is', () => {
    expect(maskedHost('hooks.slack.com')).toBe('slack.com');
    expect(maskedHost('abc123.token.example.co.uk')).toBe('example.co.uk');
    // A short label that is not a known second level may be a token: not shown.
    expect(maskedHost('T0K.me.io')).toBe('me.io');
    expect(maskedHost('example.com')).toBe('example.com');
    expect(maskedHost('localhost')).toBe('this computer');
    expect(maskedHost('127.0.0.1')).toBe('this computer');
    expect(maskedHost('[::1]')).toBe('this computer');
    expect(maskedHost('10.0.0.5')).toBe('an IP address');
  });
});

describe('the webhooks (story 11.4)', () => {
  it('keeps the URL only in the keychain; lists back its masked host and events; edits and removes it', async () => {
    const { p, notifications } = await setup();
    const added = await notifications.addWebhook({ url: URL_A, events: ['blocked'] });
    expect(added.webhooks).toHaveLength(1);
    expect(added.webhooks[0]).toMatchObject({ host: 'example.com', events: ['blocked'] });
    expect(JSON.stringify(notifications.settings())).not.toMatch(/T0K3N|hooks\.example/);
    expect([...p.store.values()]).toEqual([URL_A]);
    const id = added.webhooks[0]!.id;
    expect(notifications.updateWebhook(id, { events: ['blocked', 'ready_for_review'] }).webhooks[0]!.events).toEqual(['blocked', 'ready_for_review']);
    expect(notifications.setBrowserNotifications({ browserNotifications: true }).browserNotifications).toBe(true);
    await notifications.removeWebhook(id);
    expect(notifications.settings().webhooks).toEqual([]);
    expect(p.store.size).toBe(0);
    await expect(notifications.removeWebhook(id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('with no keychain nothing is stored and the reason is plain; a bad URL or no events is refused', async () => {
    const { notifications } = await setup({ keychain: false });
    await expect(notifications.addWebhook({ url: URL_A, events: ['blocked'] })).rejects.toBeInstanceOf(SecretsUnavailableError);
    expect(notifications.settings().webhooks).toEqual([]);
    const ok = (await setup()).notifications;
    await expect(ok.addWebhook({ url: 'http://hooks.example.com/x', events: ['blocked'] })).rejects.toBeInstanceOf(ValidationError);
    await expect(ok.addWebhook({ url: URL_A, events: [] })).rejects.toBeInstanceOf(ValidationError);
  });

  it('adds at most 10 webhooks even when asked at once', async () => {
    const { notifications } = await setup();
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => notifications.addWebhook({ url: `https://hooks.example.com/${index}`, events: ['blocked'] })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(10);
    expect(notifications.settings().webhooks).toHaveLength(10);
  });

  it('Send test posts a test payload to that webhook and answers its result, failures included', async () => {
    const { p, notifications } = await setup();
    const id = (await notifications.addWebhook({ url: URL_A, events: ['blocked'] })).webhooks[0]!.id;
    expect(await notifications.testWebhook(id)).toMatchObject({ ok: true, status: 204 });
    expect(p.sent).toHaveLength(1);
    expect(p.sent[0]).toMatchObject({ url: URL_A, payload: { event: 'test', workspace: null, ticket: null, run: null } });
    p.answers.set(URL_A, { ok: false, status: 500, failure: 'http', message: 'The webhook answered with HTTP 500.' });
    expect(await notifications.testWebhook(id)).toMatchObject({ ok: false, status: 500 });
    // The record of a send holds codes and the status, never the URL.
    expect(JSON.stringify(p.records)).not.toMatch(/T0K3N|hooks\.example/);
  });
});

describe('what is sent (story 11.4)', () => {
  it('a blocked run and a run ready for review each send one payload to a webhook subscribed to it, none to one that is not', async () => {
    const { h, p, notifications } = await setup();
    await notifications.addWebhook({ url: URL_A, events: ['blocked'] });
    await notifications.addWebhook({ url: URL_B, events: ['ready_for_review'] });
    const blockedRun = await finish(h, 'blocked');
    await notifications.settled();
    expect(p.sent.map((entry) => [entry.url, entry.payload.event])).toEqual([[URL_A, 'blocked']]);
    const blocked = p.sent[0]!.payload;
    expect(blocked).toMatchObject({ ticket: { ref: '1.1', title: 'Title of 1.1' }, run: { id: blockedRun, phase: 'needs_you' } });
    expect(blocked.text).toContain('Build 1.1 is blocked.');
    // Rejecting discards it; the next build verifies.
    await h.builds.reject(h.wsId, '1.1', {});
    p.sent.length = 0;
    await finish(h, 'built');
    await notifications.settled();
    expect(p.sent.map((entry) => [entry.url, entry.payload.event])).toEqual([[URL_B, 'ready_for_review']]);
    expect(p.sent[0]!.payload.text).toBe('Build 1.1 is ready for review.');
    // A payload carries no code, diff, path or secret: exactly the contract's fields.
    expect(Object.keys(p.sent[0]!.payload).sort()).toEqual(['event', 'run', 'sentAt', 'text', 'ticket', 'version', 'workspace']);
    expect(JSON.stringify(p.sent[0]!.payload)).not.toMatch(/T0K3N|\/tmp|\/Users|worktree/);
  });

  it('nothing is sent for a project with builds off, nor for a run interrupted by a quit', async () => {
    const { h, p, notifications } = await setup();
    await notifications.addWebhook({ url: URL_A, events: ['blocked', 'ready_for_review'] });
    h.core.permissions.updateSettings(h.wsId, { bmadPieces: [] });
    const { run } = await (async () => {
      h.core.permissions.updateSettings(h.wsId, { bmadPieces: ['board', 'builds'] });
      return h.builds.start(h.wsId, { ref: '1.1' });
    })();
    h.core.permissions.updateSettings(h.wsId, { bmadPieces: [] });
    h.core.entities.setRunOutcome(run.id, 'blocked', 'x', { blockedCode: 'other' });
    await notifications.settled();
    expect(p.sent).toEqual([]);
    h.core.permissions.updateSettings(h.wsId, { bmadPieces: ['board', 'builds'] });
    h.core.entities.setRunOutcome(run.id, 'running', null);
    h.core.entities.setRunOutcome(run.id, 'blocked', 'interrupted', { blockedCode: 'interrupted' });
    await notifications.settled();
    expect(p.sent).toEqual([]);
  });

  it('a send that fails or a keychain that cannot answer never throws or blocks the run', async () => {
    const { h, p, notifications } = await setup();
    await notifications.addWebhook({ url: URL_A, events: ['blocked'] });
    p.notifier.send = async () => {
      throw new Error('boom');
    };
    await finish(h, 'blocked');
    await notifications.settled();
    expect(h.core.entities.listRuns(h.wsId)[0]).toMatchObject({ outcome: 'blocked' });
  });
});
