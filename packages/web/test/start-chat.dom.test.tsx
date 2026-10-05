// @vitest-environment happy-dom
/**
 * An empty project starts a chat in one click (backlog story 2): Start a
 * chat with the project's default agent, Use another agent while there is a
 * choice (an unavailable agent stays in the menu with its reason and starts
 * nothing), the reason said before trying when the default can't start a
 * chat, one start at a time, and a failure said plainly with a retry. The
 * chat API is a stub here: no server, no agent.
 */
import type { ChatAgentsResponse, Session } from '@ogden-agents/shared';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentAvailability } from '../src/chat/use-chat-agents';

const createChatSession = vi.fn<(wsId: string, auth: unknown, agentId?: string) => Promise<Session>>();
vi.mock('../src/chat/chat-api', async (original) => ({ ...(await original<object>()), createChatSession: (...args: [string, unknown, string?]) => createChatSession(...args) }));

const { StartChatActions, START_FAILED, useStartChat } = await import('../src/chat/start-chat');

afterEach(cleanup);
beforeEach(() => createChatSession.mockReset());

const READY = {
  provider: 'Test Provider',
  signInMethods: [{ kind: 'subscription' as const, label: 'Sign in with your account' }],
  install: 'installed' as const,
  auth: 'signed_in' as const,
  terminalResume: false,
  needsProjectTrust: false,
  permissionModes: ['ask' as const],
};
const SIGNED_OUT_REASON = "Third Agent isn't signed in. Sign in in Settings → Agents.";
const LIST: ChatAgentsResponse = {
  agents: [
    { ...READY, agentId: 'claude-code', displayName: 'Claude Code' },
    { ...READY, agentId: 'fake-agent', displayName: 'Fake Agent' },
    { ...READY, agentId: 'third-agent', displayName: 'Third Agent', auth: 'needs_sign_in', unavailable: { code: 'agent_signed_out', reason: SIGNED_OUT_REASON, action: 'sign_in' } },
  ],
  defaultAgentId: 'claude-code',
};

const session = (agentId: string) => ({ id: `ses_${agentId}`, workspaceId: 'ws_a', agentId }) as unknown as Session;

/** The empty project's actions wired to the real hook, in a router that knows the chat and Settings → Agents. */
function Harness({ agents, agentId, blocked }: { agents: ChatAgentsResponse['agents']; agentId: string; blocked?: AgentAvailability }) {
  const { start, starting, error, setError } = useStartChat('ws_a');
  return (
    <>
      <StartChatActions agents={agents} agentId={agentId} blocked={blocked} describedBy="why" starting={starting} onStart={start} onBlocked={setError} />
      <p id="why">{blocked?.description}</p>
      {error === undefined ? null : <p role="alert">{error}</p>}
    </>
  );
}

function renderHarness(props: Parameters<typeof Harness>[0]) {
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: '/w/$wsId', component: () => <Harness {...props} /> });
  const chat = createRoute({ getParentRoute: () => root, path: '/w/$wsId/s/$sesId', component: () => <p data-testid="chat-open">open</p> });
  const agents = createRoute({ getParentRoute: () => root, path: '/settings/agents' });
  const router = createRouter({ routeTree: root.addChildren([page, chat, agents]), history: createMemoryHistory({ initialEntries: ['/w/ws_a'] }) });
  render(<RouterProvider router={router} />);
  return router;
}

/** Opens a Radix menu the way a pointer does (happy-dom has no layout). */
function openMenu(trigger: HTMLElement) {
  act(() => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  });
}

describe('Start a chat', () => {
  it("starts a chat with the project's default agent and opens it, once however often it is clicked", async () => {
    let resolve: (value: Session) => void = () => {};
    createChatSession.mockReturnValue(new Promise((done) => (resolve = done)));
    const router = renderHarness({ agents: LIST.agents, agentId: 'fake-agent' });
    const button = await screen.findByTestId('start-chat');
    expect(button.textContent).toBe('Start a chat');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(createChatSession).toHaveBeenCalledTimes(1);
    expect(createChatSession).toHaveBeenCalledWith('ws_a', undefined, 'fake-agent');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Starting a chat');
    await act(async () => resolve(session('fake-agent')));
    expect(await screen.findByTestId('chat-open')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/w/ws_a/s/ses_fake-agent');
  });

  it('says a failure plainly and tries again on the next click', async () => {
    createChatSession.mockRejectedValueOnce(new Error('')).mockRejectedValueOnce(new Error('This project is gone.'));
    renderHarness({ agents: LIST.agents, agentId: 'claude-code' });
    fireEvent.click(await screen.findByTestId('start-chat'));
    expect((await screen.findByRole('alert')).textContent).toBe(START_FAILED);
    fireEvent.click(screen.getByTestId('start-chat'));
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This project is gone.'));
    expect(createChatSession).toHaveBeenCalledTimes(2);
  });

  it("says why before trying when the default can't start a chat, tied to the button, and starts nothing", async () => {
    const blocked = { available: false, description: SIGNED_OUT_REASON, setUp: true };
    renderHarness({ agents: LIST.agents, agentId: 'third-agent', blocked });
    const button = await screen.findByTestId('start-chat');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-describedby')).toBe('why');
    fireEvent.click(button);
    expect(screen.getByRole('alert').textContent).toBe(SIGNED_OUT_REASON);
    expect(createChatSession).not.toHaveBeenCalled();
  });
});

describe('Use another agent', () => {
  it('is not offered with one agent', async () => {
    renderHarness({ agents: LIST.agents.slice(0, 1), agentId: 'claude-code' });
    await screen.findByTestId('start-chat');
    expect(screen.queryByTestId('start-chat-other')).toBeNull();
  });

  it('lists the other agents with their readiness and starts a chat with a ready one', async () => {
    createChatSession.mockResolvedValue(session('fake-agent'));
    renderHarness({ agents: LIST.agents, agentId: 'claude-code' });
    openMenu(await screen.findByTestId('start-chat-other'));
    const options = screen.getAllByTestId('start-chat-option');
    expect(options.map((option) => option.textContent)).toEqual(['Fake AgentInstalled, signed in', `Third Agent${SIGNED_OUT_REASON}`]);
    fireEvent.click(options[0]!);
    await vi.waitFor(() => expect(createChatSession).toHaveBeenCalledWith('ws_a', undefined, 'fake-agent'));
    expect(await screen.findByTestId('chat-open')).toBeTruthy();
  });

  it("keeps an agent that can't start a chat, focusable with its reason, starts nothing with it, and links Settings → Agents", async () => {
    renderHarness({ agents: LIST.agents, agentId: 'claude-code' });
    openMenu(await screen.findByTestId('start-chat-other'));
    const third = screen.getAllByTestId('start-chat-option')[1]!;
    expect(third.getAttribute('aria-disabled')).toBe('true');
    expect(third.getAttribute('tabindex')).not.toBeNull();
    fireEvent.click(third);
    fireEvent.keyDown(third, { key: 'Enter' });
    expect(createChatSession).not.toHaveBeenCalled();
    expect(screen.getByTestId('start-chat-set-up-link').getAttribute('href')).toBe('/settings/agents');
    expect(screen.getByTestId('start-chat-set-up-link').textContent).toBe('Open Settings → Agents');
  });
});
