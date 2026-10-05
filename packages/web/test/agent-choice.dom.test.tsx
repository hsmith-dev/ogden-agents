// @vitest-environment happy-dom
/**
 * Epic 6, entry 2 (the tracer), in the web: a chat's agent by its product
 * name, the bare agent picker for new chats (shown only when there is a
 * choice), and the status sidebar naming each chat's agent.
 */
import { projectNotTrustedReason, type ChatAgentsResponse, type CoreEvent, type Session, type Workspace } from '@ogden-agents/shared';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentPicker } from '../src/chat/agent-picker';
import { agentNameOf } from '../src/chat/chat-api';
import { agentAvailability, projectDefaultAgent } from '../src/chat/use-chat-agents';
import { applyEvent, emptyStore } from '../src/events/event-store';
import { buildSidebar } from '../src/shell/sidebar-model';

afterEach(cleanup);

/** Renders `node` in a router that knows Settings → Agents, so its link gets its href. */
function renderInRouter(node: ReactNode) {
  const root = createRootRoute({ component: () => <>{node}</> });
  const agents = createRoute({ getParentRoute: () => root, path: '/settings/agents' });
  const router = createRouter({ routeTree: root.addChildren([agents]), history: createMemoryHistory({ initialEntries: ['/'] }) });
  return render(<RouterProvider router={router} />);
}

/** Opens a Radix menu the way a pointer does (happy-dom has no layout). */
function openMenu(trigger: HTMLElement) {
  act(() => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  });
}

/** What every listed agent has besides its id, name and modes (6.3). */
const READY = {
  provider: 'Test Provider',
  signInMethods: [{ kind: 'subscription' as const, label: 'Sign in with your account' }],
  install: 'installed' as const,
  auth: 'signed_in' as const,
  terminalResume: false,
  needsProjectTrust: false,
};

const LIST: ChatAgentsResponse = {
  agents: [
    { ...READY, agentId: 'claude-code', displayName: 'Claude Code', permissionModes: ['ask', 'auto', 'skip_all'] },
    { ...READY, agentId: 'fake-agent', displayName: 'Fake Agent', permissionModes: ['ask', 'skip_all'] },
  ],
  defaultAgentId: 'claude-code',
};

describe('agentNameOf', () => {
  it("names a chat's agent from the list, a session from before agents could be chosen as Claude Code, and an unlisted one plainly", () => {
    expect(agentNameOf(LIST, 'fake-agent')).toBe('Fake Agent');
    expect(agentNameOf(LIST, 'claude-code')).toBe('Claude Code');
    expect(agentNameOf(LIST, undefined)).toBe('Claude Code');
    // Before the list loads no agent is guessed (entry 6: no AGENT_NAME constant in the web).
    expect(agentNameOf(undefined, 'claude-code')).toBe('The agent');
    expect(agentNameOf(LIST, 'gone-agent')).toBe('The agent');
    expect(agentNameOf(undefined, 'fake-agent')).toBe('The agent');
  });
});

describe('AgentPicker', () => {
  it('is not shown while the install has one agent', () => {
    render(<AgentPicker agents={LIST.agents.slice(0, 1)} value="claude-code" onChange={() => {}} />);
    expect(screen.queryByTestId('agent-picker')).toBeNull();
  });

  it('offers each agent by its product name and readiness, the chosen one checked, and reports a new choice only', async () => {
    const onChange = vi.fn();
    renderInRouter(<AgentPicker agents={LIST.agents} value="claude-code" onChange={onChange} />);
    const trigger = await screen.findByTestId('agent-picker');
    expect(trigger.getAttribute('aria-label')).toBe('Agent for new chats: Claude Code');
    openMenu(trigger);
    const options = screen.getAllByTestId('agent-option');
    expect(options.map((option) => option.textContent)).toEqual(['Claude CodeInstalled, signed in', 'Fake AgentInstalled, signed in']);
    expect(options[0]!.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(options[1]!);
    expect(onChange).toHaveBeenCalledWith('fake-agent');
    onChange.mockClear();
    // Choosing the chosen agent again keeps it: a chat always has an agent.
    openMenu(screen.getByTestId('agent-picker'));
    fireEvent.click(screen.getAllByTestId('agent-option')[0]!);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps an agent that can\'t start a chat in the menu, unavailable but focusable, with its reason and a link to Settings → Agents', async () => {
    const onChange = vi.fn();
    const signedOut = { ...LIST.agents[1]!, auth: 'needs_sign_in' as const, unavailable: { code: 'agent_signed_out' as const, reason: "Fake Agent isn't signed in. Sign in in Settings → Agents.", action: 'sign_in' as const } };
    // Read for a project that isn't trusted for it (epic 12, 12.3): choosing it shows the trust prompt, so it is not disabled.
    const trusting = {
      ...LIST.agents[1]!,
      agentId: 'trust-agent',
      displayName: 'Trust Agent',
      needsProjectTrust: true,
      unavailable: { code: 'project_not_trusted' as const, reason: projectNotTrustedReason('Trust Agent'), action: 'trust_project' as const },
    };
    renderInRouter(<AgentPicker agents={[LIST.agents[0]!, signedOut, trusting]} value="claude-code" onChange={onChange} />);
    openMenu(await screen.findByTestId('agent-picker'));
    const [, out, trust] = screen.getAllByTestId('agent-option');
    expect(out!.getAttribute('aria-disabled')).toBe('true');
    expect(out!.hasAttribute('data-disabled')).toBe(true);
    expect(out!.textContent).toContain("Fake Agent isn't signed in.");
    expect(trust!.getAttribute('aria-disabled')).toBeNull();
    expect(trust!.textContent).toContain(projectNotTrustedReason('Trust Agent'));
    // Reachable by keyboard: a disabled menu item would be skipped, and its reason never read.
    expect(out!.getAttribute('tabindex')).not.toBeNull();
    fireEvent.click(out!);
    fireEvent.keyDown(out!, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('agent-set-up-link').getAttribute('href')).toBe('/settings/agents');
    // The trust agent is offered a Trust item, which chooses it (the page then shows the trust prompt).
    const item = screen.getByTestId('agent-trust-project');
    expect(item.textContent).toBe('Trust this project for Trust Agent');
    fireEvent.click(item);
    expect(onChange).toHaveBeenCalledWith('trust-agent');
  });
});

describe('agentAvailability and projectDefaultAgent (entry 6)', () => {
  it('reads readiness from the list; trust is fixed by the trust prompt, not by Settings', () => {
    expect(agentAvailability(LIST.agents[0]!)).toEqual({ available: true, description: 'Installed, signed in', setUp: false, trust: false });
    const notInstalled = { ...LIST.agents[1]!, install: 'not_installed' as const, unavailable: { code: 'agent_not_installed' as const, reason: 'Not here.', action: 'install' as const } };
    expect(agentAvailability(notInstalled)).toEqual({ available: false, description: 'Not here.', setUp: true, trust: false });
    // Read for a project: it says it needs that project trusted; the trust prompt fixes it.
    const untrusted = { ...LIST.agents[1]!, needsProjectTrust: true, unavailable: { code: 'project_not_trusted' as const, reason: projectNotTrustedReason('Fake Agent'), action: 'trust_project' as const } };
    expect(agentAvailability(untrusted)).toEqual({ available: false, description: projectNotTrustedReason('Fake Agent'), setUp: false, trust: true });
    // Read for no project: each project asks for its own trust, so the agent can be the default.
    expect(agentAvailability({ ...LIST.agents[1]!, needsProjectTrust: true })).toEqual({ available: true, description: 'Installed, signed in. Asks you to trust each project first.', setUp: false, trust: false });
  });

  it("preselects the project's default while the install has it, else the install's", () => {
    expect(projectDefaultAgent(LIST, 'fake-agent')).toBe('fake-agent');
    expect(projectDefaultAgent(LIST, undefined)).toBe('claude-code');
    expect(projectDefaultAgent(LIST, 'gone-agent')).toBe('claude-code');
  });
});

describe('the status sidebar names each chat by its agent (E6-R1)', () => {
  const workspace = { id: 'ws_a', path: '/repo', realPath: '/repo', createdAt: '2026-10-01T00:00:00.000Z' } as Workspace;
  const at = '2026-10-03T11:59:00.000Z';
  const session = (id: string, agentId: string | undefined, state: Session['state']) =>
    ({ id, workspaceId: 'ws_a', kind: 'chat', state, driver: 'ui', title: null, adapterRefs: {}, createdAt: at, updatedAt: at, ...(agentId === undefined ? {} : { agentId }) }) as unknown as Session;

  it("gives each row its chat's agent, and Needs you names the agent that asks", () => {
    const requested = {
      id: 'evt_1',
      seq: 1,
      at,
      workspaceId: 'ws_a',
      streamId: 'ses_fake',
      type: 'permission.requested',
      payload: {
        sessionId: 'ses_fake',
        requestId: 'req_1',
        toolCall: { toolCallId: 't1', title: 'Run npm test', kind: 'execute', command: 'npm test' },
        alwaysAllowScope: null,
        cautionLevel: 'ask_every_time',
      },
    } as unknown as CoreEvent;
    const model = buildSidebar(
      [workspace],
      [session('ses_claude', 'claude-code', 'working'), session('ses_fake', 'fake-agent', 'waiting'), session('ses_old', undefined, 'idle')],
      applyEvent(emptyStore(), requested),
      Date.parse('2026-10-03T12:00:00.000Z'),
      (agentId) => agentNameOf(LIST, agentId),
    );
    const names = Object.fromEntries(model.groups[0]!.rows.map((row) => [row.sesId, row.agentName]));
    expect(names).toEqual({ ses_claude: 'Claude Code', ses_fake: 'Fake Agent', ses_old: 'Claude Code' });
    expect(model.needsYou.map((entry) => entry.text)).toEqual(['Fake Agent wants to run npm test']);
  });
});
