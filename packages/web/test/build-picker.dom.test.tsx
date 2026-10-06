// @vitest-environment happy-dom
/**
 * The Build dialog's agent picker and the default build agent (epic 17, entry 8): with more than one agent that can build
 * here, Build opens the dialog with each agent, how it would build here and why in plain words, a choice that applies to
 * that run only and starts it with that agent; with one, Build goes straight on as before. The Workspace settings
 * choose the default build agent. No real server: the tab's fetch is a fake.
 */
import {
  API_ROUTES,
  apiPath,
  BUILD_WAY_LABELS,
  type BuildAgentsResponse,
  type SandboxStatus,
  TicketsResponse,
  type WorkspaceBuildSettings,
} from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SESSION = { id: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4', workspaceId: WS, kind: 'build', state: 'working', driver: 'ui', permissionMode: 'ask', title: null, adapterRefs: {}, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' };
const RUN = { id: 'run_01J9Z3K4M5N6P7Q8R9S0T1V2W5', workspaceId: WS, sessionId: SESSION.id, ticketRef: '1.1', worktreePath: '/data/w/abcdefgh', deadline: null, outcome: 'running', reason: null, sandbox: 'test', createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' };

const READY: SandboxStatus = { platform: 'linux', available: true, kind: 'test', summary: 'Builds run inside the test sandbox.', probes: [], choices: [], installHint: null };
const CODEX_REASON = "Codex's own sandbox hasn't been checked on this computer yet, so it builds with you watching.";
const CODEX_ONLY: SandboxStatus = { platform: 'linux', available: false, kind: null, summary: CODEX_REASON, probes: [], choices: ['attended', 'other_agent'], installHint: null };

const state = vi.hoisted(() => ({
  agents: undefined as unknown,
  calls: [] as string[],
  bodies: [] as unknown[],
  patches: [] as unknown[],
  settings: { maxConcurrentRuns: 2, testCommand: null, defaultBuildAgentId: null } as unknown,
  tickets: undefined as unknown,
}));

vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [], caughtUp: true }) }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, ...props }: { children: ReactNode; to: string; params: { wsId: string; ref?: string } }) => (
    <a href={to.replace('$wsId', params.wsId).replace('$ref', params.ref ?? '')} {...props}>
      {children}
    </a>
  ),
}));

const answer = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status }));

vi.mock('@/auth/tab-token', () => ({
  tabAuth: {
    fetch: async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      state.calls.push(`${method} ${path}`);
      if (path.endsWith('/tickets')) return answer(state.tickets);
      if (method === 'GET' && path.endsWith('/build-agents')) return answer(state.agents);
      if (method === 'GET' && path.includes('/build-sandbox')) return answer({ status: path.includes('agent=codex') ? CODEX_ONLY : READY });
      if (method === 'GET' && path.endsWith('/build-settings')) return answer({ settings: state.settings });
      if (method === 'PATCH' && path.endsWith('/build-settings')) {
        const body = JSON.parse(String(init.body)) as Partial<WorkspaceBuildSettings>;
        state.patches.push(body);
        state.settings = { ...(state.settings as object), ...body };
        return answer({ settings: state.settings });
      }
      if (method === 'POST' && path.endsWith('/builds')) {
        state.bodies.push(JSON.parse(String(init.body)));
        return answer({ run: RUN, session: SESSION }, 201);
      }
      return new Response('{}', { status: 404 });
    },
  },
}));

const { BoardTickets } = await import('../src/planning/board-tickets');
const { ProjectBuildLimit } = await import('../src/planning/build-limit-fields');
const { TooltipProvider } = await import('../src/ui/tooltip');
const { AppearanceProvider } = await import('../src/appearance/appearance-provider');

Object.assign(state, {
  tickets: TicketsResponse.parse({
    tickets: [{ ref: '1.1', id: 1, epic: 'epic-first', title: 'Build the first thing', type: 'story', status: 'ready-for-dev', state: 'backlog', blocked_reason: '' }],
    problems: [],
  }),
});

function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AppearanceProvider>
        <TooltipProvider>{node}</TooltipProvider>
      </AppearanceProvider>
    </QueryClientProvider>,
  );
}
const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

const TWO: BuildAgentsResponse = {
  defaultAgentId: 'claude-code',
  agents: [
    { agentId: 'claude-code', displayName: 'Claude Code', way: 'unattended', reason: null },
    { agentId: 'codex', displayName: 'Codex', way: 'attended_only', reason: CODEX_REASON },
    { agentId: 'grok', displayName: 'Grok', way: 'unavailable', reason: 'Grok needs a valid xAI API access token. Check it in Settings, Agents.' },
  ],
};

beforeEach(() => {
  state.calls.length = 0;
  state.bodies.length = 0;
  state.patches.length = 0;
  state.settings = { maxConcurrentRuns: 2, testCommand: null, defaultBuildAgentId: null };
  state.agents = TWO;
});
afterEach(() => cleanup());

describe('the Build picker (epic 17)', () => {
  it('opens when more than one agent can build, says how each would build and why, and starts the run with the one picked', async () => {
    const started: string[] = [];
    mount(<BoardTickets wsId={WS} builds={{ onStarted: (id) => started.push(id) }} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Build this story 1.1' }));
    await settle();
    await settle();
    // Nothing started yet: the dialog asks which agent.
    expect(state.bodies).toEqual([]);
    expect(screen.getByRole('dialog', { name: 'Build 1.1 with which agent?' })).toBeTruthy();
    const ways = screen.getAllByTestId('build-agent-way').map((node) => [node.getAttribute('data-way'), node.textContent]);
    expect(ways).toEqual([
      ['unattended', BUILD_WAY_LABELS.unattended],
      ['attended_only', `${BUILD_WAY_LABELS.attended_only}. ${CODEX_REASON}`],
      ['unavailable', `${BUILD_WAY_LABELS.unavailable}. Grok needs a valid xAI API access token. Check it in Settings, Agents.`],
    ]);
    // An agent that is not ready cannot be chosen; the default is chosen.
    expect(screen.getByTestId('build-agent-grok').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('build-agent-claude-code').getAttribute('aria-checked')).toBe('true');
    // With a sandbox ready for it, the dialog offers Build, and it starts that agent's run.
    fireEvent.click(screen.getByTestId('build-dialog-start'));
    await settle();
    expect(state.bodies).toEqual([{ ref: '1.1', agent: 'claude-code' }]);
    expect(started).toEqual([SESSION.id]);
  });

  it('an agent that builds only with you watching offers Build with me watching, and starts an attended run with that agent', async () => {
    mount(<BoardTickets wsId={WS} builds={{ onStarted: () => {} }} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Build this story 1.1' }));
    await settle();
    await settle();
    fireEvent.click(screen.getByTestId('build-agent-codex'));
    await settle();
    // The status asked about is Codex's own, and it is why Codex builds with you watching.
    expect(state.calls).toContain(`GET ${apiPath(API_ROUTES.workspaceBuildSandbox, { wsId: WS })}?agent=codex`);
    expect(screen.getByTestId('build-dialog-summary').textContent).toBe(CODEX_REASON);
    expect(screen.getByRole('dialog', { name: "Codex can't build unattended on this computer yet." })).toBeTruthy();
    expect(screen.getByText('Each command Codex wants to run asks you first, in the build session.')).toBeTruthy();
    // Use another agent is enabled now, and moves to the picker.
    expect(screen.getByRole('button', { name: 'Use another agent' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Build with me watching' }));
    await settle();
    expect(state.bodies).toEqual([{ ref: '1.1', mode: 'attended', agent: 'codex' }]);
  });

  it('with only one agent that can build, Build goes straight on with no dialog and no agent named', async () => {
    state.agents = { defaultAgentId: 'claude-code', agents: [TWO.agents[0], TWO.agents[2]] };
    mount(<BoardTickets wsId={WS} builds={{ onStarted: () => {} }} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Build this story 1.1' }));
    await settle();
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(state.bodies).toEqual([{ ref: '1.1' }]);
  });

  it('a list that cannot be read changes nothing: Build goes straight on', async () => {
    state.agents = { error: { code: 'internal_error', message: 'No.' } };
    mount(<BoardTickets wsId={WS} builds={{ onStarted: () => {} }} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Build this story 1.1' }));
    await settle();
    await settle();
    expect(state.bodies).toEqual([{ ref: '1.1' }]);
  });
});

describe('the default build agent (epic 17)', () => {
  it('Workspace settings choose it per project, Automatic clears it, and an agent that is not ready cannot be chosen', async () => {
    mount(<ProjectBuildLimit wsId={WS} />);
    await settle();
    expect(screen.getByTestId('default-build-agent-automatic').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('default-build-agent-grok').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByTestId('default-build-agent-codex'));
    await settle();
    expect(state.patches).toEqual([{ defaultBuildAgentId: 'codex' }]);
    expect(screen.getByTestId('default-build-agent-saved')).toBeTruthy();
    expect(screen.getByTestId('default-build-agent-codex').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('default-build-agent-automatic'));
    await settle();
    expect(state.patches).toEqual([{ defaultBuildAgentId: 'codex' }, { defaultBuildAgentId: null }]);
  });

  it('shows nothing to choose with one agent', async () => {
    state.agents = { defaultAgentId: 'claude-code', agents: [TWO.agents[0]] };
    mount(<ProjectBuildLimit wsId={WS} />);
    await settle();
    expect(screen.queryByTestId('default-build-agent')).toBeNull();
  });
});
