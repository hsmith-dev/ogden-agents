// @vitest-environment happy-dom
/**
 * Every settings form keeps its saved answer (story 6.9): a read still on its
 * way when the save answers (the page's mount refetch, or one an event set
 * off, held up behind other requests) carries the value from before the save,
 * and must never turn the form back when it lands (4.13 New projects and 6.7
 * Developer mode, both seen on Windows runners). Each form here: loaded, a
 * read held with the old value, the change saved, then the held read
 * answers; the form and the query keep the saved value. The REST calls are
 * replaced by a small fake server; nothing reaches a network.
 * The BMad Method section's own case is in `bmad-method-section.dom.test.tsx`,
 * Developer mode's in `permission-modes.dom.test.tsx`.
 */
import { API_ROUTES, apiPath, BMAD_PIECES, type AgentSetupStatus, type ChatAgentsResponse, type NewProjectDefaults, type WorkspaceSettings } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentStep } from '../src/routes/welcome-page';
import { CautionLevelSection, DefaultAgentSection } from '../src/routes/workspace-settings-page';
import { NEW_PROJECT_DEFAULTS_QUERY_KEY, NewProjectDefaultsSection, NewProjectsAgentSection } from '../src/settings/new-project-defaults';
import { TooltipProvider } from '../src/ui/tooltip';
import { ScriptTrustPrompt } from '../src/workspaces/script-trust-prompt';
import { useWorkspaceSettings } from '../src/workspaces/workspace-settings-api';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SETTINGS_PATH = apiPath(API_ROUTES.workspaceSettings, { wsId: WS });
const SETTINGS_KEY = ['workspace-settings', WS] as const;

const server = vi.hoisted(() => ({
  settings: undefined as unknown as WorkspaceSettings,
  defaults: undefined as unknown as NewProjectDefaults,
  /** Reads of these paths are held, each answering later with what it read when it was sent. */
  holdPaths: new Set<string>(),
  held: [] as (() => void)[],
  writes: [] as string[],
}));

vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  call: async (_auth: unknown, path: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    if (method !== 'GET') {
      server.writes.push(`${method} ${path}`);
      const body = init.body === undefined ? {} : (JSON.parse(String(init.body)) as Record<string, unknown>);
      if (path === API_ROUTES.newProjectDefaults) server.defaults = { ...server.defaults, ...body } as NewProjectDefaults;
      else if (path.endsWith('/bmad/script-trust')) server.settings = { ...server.settings, bmadScriptsTrusted: true };
      else server.settings = { ...server.settings, ...body } as WorkspaceSettings;
    }
    const answer = (): unknown => {
      if (path === SETTINGS_PATH || path.endsWith('/bmad/script-trust')) return { settings: server.settings };
      if (path === API_ROUTES.newProjectDefaults) return { defaults: server.defaults };
      if (path === API_ROUTES.chatAgents) return CHAT_AGENTS;
      if (path === API_ROUTES.bmadPieces) return { pieces: BMAD_PIECES.map((piece) => ({ piece, available: true })) };
      throw new Error(`unexpected ${method} ${path}`);
    };
    const now = answer();
    if (method === 'GET' && server.holdPaths.has(path)) return new Promise((resolve) => server.held.push(() => resolve(now)));
    return now;
  },
}));
vi.mock('@/events/use-event-invalidation', () => ({ useEventInvalidation: () => undefined }));
// Welcome's agent step: the agents' setup as already read, and their cards left out (Settings → Agents has its own tests).
vi.mock('@/agents/agent-setup-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAgents: () => ({ data: SETUP_AGENTS, isError: false, error: null, refetch: () => {} }),
}));
vi.mock('@/agents/agent-card', () => ({ AgentCard: () => null }));

const READY = {
  provider: 'Test Provider',
  signInMethods: [{ kind: 'subscription' as const, label: 'Sign in with your account' }],
  install: 'installed' as const,
  auth: 'signed_in' as const,
  terminalResume: false,
  needsProjectTrust: false,
};
const CHAT_AGENTS: ChatAgentsResponse = {
  agents: [
    { ...READY, agentId: 'claude-code', displayName: 'Claude Code', permissionModes: ['ask', 'auto', 'skip_all'] },
    { ...READY, agentId: 'fake-agent', displayName: 'Fake Agent', permissionModes: ['ask', 'skip_all'] },
  ],
  defaultAgentId: 'claude-code',
};
const SETUP_AGENTS: AgentSetupStatus[] = CHAT_AGENTS.agents.map(({ agentId, displayName }) => ({ agentId, displayName, install: 'installed', version: null, auth: 'signed_in' }));

let client: QueryClient;

beforeEach(() => {
  server.settings = { cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: false };
  server.defaults = { bmadPieces: [] };
  server.holdPaths = new Set();
  server.held = [];
  server.writes = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(cleanup);

function show(node: ReactNode) {
  const root = createRootRoute({ component: () => <>{node}</> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** A read of `path` (`key`'s query) sent now and held, as the page's refetch held up behind other requests. */
async function holdARead(path: string, key: QueryKey) {
  await waitFor(() => expect(client.isFetching()).toBe(0));
  server.holdPaths.add(path);
  void client.invalidateQueries({ queryKey: key, exact: true });
  await waitFor(() => expect(server.held).toHaveLength(1));
}

/** The held read answers (with the value from before the save), and everything settles. */
async function answerTheHeldRead() {
  await act(async () => {
    for (const release of server.held.splice(0)) release();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => expect(client.isFetching()).toBe(0));
}


describe('a read on its way never turns a saved setting back (story 6.9)', () => {
  it('Workspace settings → Caution level', async () => {
    show(<CautionLevelSection wsId={WS} />);
    await screen.findByTestId('caution-level');
    await holdARead(SETTINGS_PATH, SETTINGS_KEY);
    fireEvent.click(screen.getByTestId('caution-ask_risky_only'));
    await waitFor(() => expect(screen.getByTestId('caution-status').textContent).toMatch(/^Saved/));
    await answerTheHeldRead();
    expect(client.getQueryData<WorkspaceSettings>(SETTINGS_KEY)?.cautionLevel).toBe('ask_risky_only');
    expect(screen.getByTestId('caution-ask_risky_only').getAttribute('aria-checked')).toBe('true');
  });

  it('Workspace settings → Default agent', async () => {
    show(<DefaultAgentSection wsId={WS} />);
    await screen.findByTestId('default-agent');
    await holdARead(SETTINGS_PATH, SETTINGS_KEY);
    fireEvent.click(screen.getByTestId('default-agent-fake-agent'));
    await waitFor(() => expect(screen.getByTestId('default-agent-status').textContent).toMatch(/^Saved/));
    await answerTheHeldRead();
    expect(client.getQueryData<WorkspaceSettings>(SETTINGS_KEY)?.defaultAgentId).toBe('fake-agent');
    expect(screen.getByTestId('default-agent-fake-agent').getAttribute('aria-checked')).toBe('true');
  });

  it("the Board's script trust prompt (Allow)", async () => {
    function Trusted() {
      const settings = useWorkspaceSettings(WS);
      return <span data-testid="trusted">{String(settings.data?.bmadScriptsTrusted)}</span>;
    }
    const onTrusted = vi.fn();
    show(
      <>
        <Trusted />
        <ScriptTrustPrompt wsId={WS} onTrusted={onTrusted} />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('trusted').textContent).toBe('false'));
    await holdARead(SETTINGS_PATH, SETTINGS_KEY);
    fireEvent.click(screen.getByTestId('script-trust-allow'));
    await waitFor(() => expect(onTrusted).toHaveBeenCalled());
    await answerTheHeldRead();
    expect(screen.getByTestId('trusted').textContent).toBe('true');
  });

  it('Settings → New projects (the pieces)', async () => {
    show(<NewProjectDefaultsSection />);
    await screen.findByRole('radio', { name: /^BMad Method/ });
    await holdARead(API_ROUTES.newProjectDefaults, NEW_PROJECT_DEFAULTS_QUERY_KEY);
    fireEvent.click(screen.getByRole('radio', { name: /^BMad Method/ }));
    await waitFor(() => expect(screen.getByTestId('new-projects-status').textContent).toMatch(/^Saved/));
    await answerTheHeldRead();
    expect(client.getQueryData<NewProjectDefaults>(NEW_PROJECT_DEFAULTS_QUERY_KEY)?.bmadPieces).toEqual(['planning', 'board']);
    expect(screen.getByRole('radio', { name: /^BMad Method/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('checkbox', { name: 'Planning' }).getAttribute('aria-checked')).toBe('true');
  });

  it('Settings → New projects (the default agent)', async () => {
    show(<NewProjectsAgentSection />);
    await screen.findByTestId('new-projects-agent');
    await holdARead(API_ROUTES.newProjectDefaults, NEW_PROJECT_DEFAULTS_QUERY_KEY);
    fireEvent.click(screen.getByTestId('new-projects-agent-fake-agent'));
    await waitFor(() => expect(screen.getByTestId('new-projects-agent-status').textContent).toMatch(/^Saved/));
    await answerTheHeldRead();
    expect(client.getQueryData<NewProjectDefaults>(NEW_PROJECT_DEFAULTS_QUERY_KEY)?.defaultAgentId).toBe('fake-agent');
    expect(screen.getByTestId('new-projects-agent-fake-agent').getAttribute('aria-checked')).toBe('true');
  });

  it("Welcome's agent choice (kept as the default for new projects)", async () => {
    show(<AgentStep onContinue={() => {}} skip={null} />);
    await screen.findByTestId('welcome-agent-choice');
    await holdARead(API_ROUTES.newProjectDefaults, NEW_PROJECT_DEFAULTS_QUERY_KEY);
    fireEvent.click(screen.getByTestId('welcome-agent-fake-agent'));
    await waitFor(() => expect(server.writes).toEqual([`PATCH ${API_ROUTES.newProjectDefaults}`]));
    await waitFor(() => expect(client.getQueryData<NewProjectDefaults>(NEW_PROJECT_DEFAULTS_QUERY_KEY)?.defaultAgentId).toBe('fake-agent'));
    await answerTheHeldRead();
    expect(client.getQueryData<NewProjectDefaults>(NEW_PROJECT_DEFAULTS_QUERY_KEY)?.defaultAgentId).toBe('fake-agent');
  });
});
