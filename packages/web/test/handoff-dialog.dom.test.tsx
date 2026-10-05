// @vitest-environment happy-dom
/**
 * The handoff dialog (user decision 2026-10-04) in a DOM: it names the
 * provider that receives the chat before anything is sent, shows the brief to
 * edit with its limit, refuses to send one over it, and sends exactly what
 * the user confirmed. The tab's fetch is replaced; no server runs.
 */
import type { ChatAgent } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  requests: [] as Array<{ path: string; method: string; body: unknown }>,
  preview: {} as Record<string, unknown>,
}));

vi.mock('@/auth/tab-token', () => ({
  tabAuth: {
    fetch: async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      state.requests.push({ path, method, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) });
      if (method === 'GET') return new Response(JSON.stringify(state.preview), { status: 200, headers: { 'content-type': 'application/json' } });
      if (path.endsWith('/handoff/preview')) {
        const edited = { ...state.preview, brief: (JSON.parse(String(init.body)) as { brief: string }).brief, previewToken: 'e'.repeat(43) };
        return new Response(JSON.stringify(edited), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const session = { id: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3', workspaceId: 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3', kind: 'chat', state: 'working', driver: 'ui', permissionMode: 'ask', agentId: 'second-agent', title: null, adapterRefs: {}, createdAt: '2026-10-04T10:00:00.000Z', updatedAt: '2026-10-04T10:00:00.000Z' };
      return new Response(JSON.stringify({ session, messageId: 'msg_1' }), { status: 202, headers: { 'content-type': 'application/json' } });
    },
  },
}));

const { HandoffDialog } = await import('../src/chat/handoff-dialog');

const agent = (agentId: string, displayName: string, provider: string, extra: Partial<ChatAgent> = {}): ChatAgent => ({
  agentId,
  displayName,
  provider,
  signInMethods: [],
  install: 'installed',
  auth: 'signed_in',
  terminalResume: false,
  needsProjectTrust: false,
  permissionModes: ['ask'],
  ...extra,
});
const AGENTS = [
  agent('first-agent', 'First Agent', 'First Co'),
  agent('second-agent', 'Second Agent', 'Second Co'),
  agent('third-agent', 'Third Agent', 'Third Co', { unavailable: { code: 'agent_signed_out', reason: "Third Agent isn't signed in.", action: 'sign_in' } }),
];

function mount() {
  const onOpenChange = vi.fn();
  const onHandedOff = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HandoffDialog open onOpenChange={onOpenChange} wsId="ws_1" sesId="ses_1" currentAgentId="first-agent" currentAgentName="First Agent" agents={AGENTS} onHandedOff={onHandedOff} />
    </QueryClientProvider>,
  );
  return { onOpenChange, onHandedOff };
}

beforeEach(() => {
  state.requests = [];
  state.preview = {
    agent: { agentId: 'second-agent', displayName: 'Second Agent', provider: 'Second Co' },
    brief: '[Ogden Agents] Handoff: the brief',
    maxChars: 60,
    permissionMode: 'ask',
    modeNote: "Second Agent doesn't offer Auto, so this chat will be in Ask.",
    resumes: false,
    previewToken: 'p'.repeat(43),
  };
});
afterEach(cleanup);

describe('the handoff dialog', () => {
  it('offers only the other agents, an unavailable one with its reason, and names the provider before sending', async () => {
    mount();
    const options = screen.getAllByTestId('handoff-agent');
    expect(options.map((option) => option.getAttribute('data-agent'))).toEqual(['second-agent', 'third-agent']);
    expect(options[1]).toHaveProperty('disabled', true);
    expect(screen.getByText("Third Agent isn't signed in.")).toBeTruthy();
    const disclosure = await screen.findByTestId('handoff-disclosure');
    expect(disclosure.textContent).toContain("This sends this chat's conversation to Second Co (Second Agent).");
    expect(disclosure.textContent).toContain("doesn't offer Auto");
    expect((screen.getByTestId('handoff-brief') as HTMLTextAreaElement).value).toBe('[Ogden Agents] Handoff: the brief');
    expect(state.requests.every((request) => request.method === 'GET')).toBe(true);
    expect(state.requests[0]?.path).toContain('agentId=second-agent');
  });

  it('refuses a brief over the limit and says so; sends the edited brief and message once confirmed', async () => {
    const { onOpenChange, onHandedOff } = mount();
    const brief = (await screen.findByTestId('handoff-brief')) as HTMLTextAreaElement;
    fireEvent.change(brief, { target: { value: 'x'.repeat(61) } });
    expect(screen.getByTestId('handoff-brief-count').textContent).toContain('shorten it to send');
    fireEvent.click(screen.getByTestId('handoff-confirm'));
    expect(state.requests.some((request) => request.method === 'POST')).toBe(false);
    fireEvent.change(brief, { target: { value: 'My trimmed brief' } });
    fireEvent.change(screen.getByTestId('handoff-message'), { target: { value: 'Carry on, please' } });
    fireEvent.click(screen.getByTestId('handoff-confirm'));
    await waitFor(() => expect(onHandedOff).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // The edit is previewed first (its own token), then sent with that token.
    const posts = state.requests.filter((request) => request.method === 'POST');
    expect(posts[0]?.path).toMatch(/\/handoff\/preview$/);
    expect(posts[0]?.body).toEqual({ agentId: 'second-agent', brief: 'My trimmed brief' });
    expect(posts[1]?.body).toEqual({ agentId: 'second-agent', brief: 'My trimmed brief', message: 'Carry on, please', previewToken: 'e'.repeat(43) });
  });
});
