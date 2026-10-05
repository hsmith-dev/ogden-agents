// @vitest-environment happy-dom
/** Story 11.4: Settings, Notifications, webhooks: add (the URL typed once, never shown back), events, Send test with the result inline, Remove, and the refusals. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'https://hooks.example.com/services/T0K3N';
const state = vi.hoisted(() => ({
  webhooks: [] as Array<{ id: string; host: string; events: string[]; createdAt: string }>,
  calls: [] as string[],
  addStatus: 201,
  test: { ok: true, status: 204, failure: null, message: 'The webhook answered with HTTP 204.' } as unknown,
}));
const json = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status }));
vi.mock('@/auth/tab-token', () => ({
  tabAuth: {
    fetch: async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      state.calls.push(`${method} ${path}`);
      const settings = () => ({ settings: { webhooks: state.webhooks, browserNotifications: false } });
      if (path.endsWith('/test')) return json(state.test);
      if (path.endsWith('/webhooks') && method === 'POST') {
        if (state.addStatus !== 201) return json({ error: { code: 'secrets_unavailable', message: "Ogden Agents can't keep a webhook address safely here: this computer has no usable keychain, so nothing was saved." } }, state.addStatus);
        const body = JSON.parse(String(init.body)) as { events: string[] };
        state.webhooks.push({ id: 'hook_01J9Z3K4M5N6P7Q8R9S0T1V2W3', host: 'example.com', events: body.events, createdAt: '2026-10-05T00:00:00.000Z' });
        return json(settings(), 201);
      }
      if (method === 'PATCH') {
        state.webhooks[0]!.events = (JSON.parse(String(init.body)) as { events: string[] }).events;
        return json(settings());
      }
      if (method === 'DELETE') {
        state.webhooks.length = 0;
        return new Response(null, { status: 204 });
      }
      return json(settings());
    },
  },
}));

const { WebhookSettings } = await import('../src/notifications/webhook-settings');
const { TooltipProvider } = await import('../src/ui/tooltip');

const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
const mount = async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <WebhookSettings />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await settle();
};

beforeEach(() => {
  state.webhooks = [];
  state.calls = [];
  state.addStatus = 201;
  state.test = { ok: true, status: 204, failure: null, message: 'The webhook answered with HTTP 204.' };
});
afterEach(() => cleanup());

describe('webhooks in Settings, Notifications (story 11.4)', () => {
  it('starts with none, adds one (both events on), shows only its domain and never the address, and clears the field', async () => {
    await mount();
    expect(screen.getByTestId('webhooks-none')).toBeTruthy();
    fireEvent.change(screen.getByTestId('webhook-url'), { target: { value: SECRET } });
    fireEvent.click(screen.getByTestId('webhook-add'));
    await settle();
    expect(state.calls).toContain('POST /api/v1/settings/notifications/webhooks');
    expect(screen.getByTestId('webhook-host').textContent).toBe('Sends to example.com');
    expect((screen.getByTestId('webhook-url') as HTMLInputElement).value).toBe('');
    expect(document.body.innerHTML).not.toMatch(/T0K3N|hooks\.example/);
    expect(screen.getByTestId('webhook-list').textContent).toContain('kept in your keychain');
  });

  it('changing an event saves it, and the last event cannot be turned off', async () => {
    state.webhooks.push({ id: 'hook_01J9Z3K4M5N6P7Q8R9S0T1V2W3', host: 'example.com', events: ['blocked', 'ready_for_review'], createdAt: '2026-10-05T00:00:00.000Z' });
    await mount();
    fireEvent.click(screen.getByTestId('webhook-hook_01J9Z3K4M5N6P7Q8R9S0T1V2W3-ready_for_review'));
    await settle();
    expect(state.webhooks[0]!.events).toEqual(['blocked']);
    state.calls.length = 0;
    fireEvent.click(screen.getByTestId('webhook-hook_01J9Z3K4M5N6P7Q8R9S0T1V2W3-blocked'));
    await settle();
    expect(state.calls.filter((call) => call.startsWith('PATCH'))).toEqual([]);
  });

  it('Send test shows its HTTP result inline, success or failure in plain words', async () => {
    state.webhooks.push({ id: 'hook_01J9Z3K4M5N6P7Q8R9S0T1V2W3', host: 'example.com', events: ['blocked'], createdAt: '2026-10-05T00:00:00.000Z' });
    await mount();
    fireEvent.click(screen.getByTestId('webhook-test'));
    await settle();
    expect(screen.getByTestId('webhook-test-result').textContent).toBe('Test sent. The webhook answered with HTTP 204. (HTTP 204)');
    state.test = { ok: false, status: 500, failure: 'http', message: 'The webhook answered with HTTP 500.' };
    fireEvent.click(screen.getByTestId('webhook-test'));
    await settle();
    expect(screen.getByTestId('webhook-test-result').getAttribute('data-ok')).toBe('false');
    expect(screen.getByTestId('webhook-test-result').textContent).toContain('The test failed. The webhook answered with HTTP 500.');
    state.test = { ok: false, status: null, failure: 'timeout', message: "The webhook didn't answer in time." };
    fireEvent.click(screen.getByTestId('webhook-test'));
    await settle();
    expect(screen.getByTestId('webhook-test-result').textContent).toBe("The test failed. The webhook didn't answer in time.");
  });

  it('Remove takes it away; with no keychain the add says why and nothing is listed', async () => {
    state.webhooks.push({ id: 'hook_01J9Z3K4M5N6P7Q8R9S0T1V2W3', host: 'example.com', events: ['blocked'], createdAt: '2026-10-05T00:00:00.000Z' });
    await mount();
    fireEvent.click(screen.getByTestId('webhook-remove'));
    await settle();
    expect(screen.queryByTestId('webhook')).toBeNull();
    state.addStatus = 503;
    fireEvent.change(screen.getByTestId('webhook-url'), { target: { value: SECRET } });
    fireEvent.click(screen.getByTestId('webhook-add'));
    await settle();
    expect(screen.getByTestId('webhook-add-error').textContent).toContain('no usable keychain');
    expect(screen.queryByTestId('webhook')).toBeNull();
  });
});
