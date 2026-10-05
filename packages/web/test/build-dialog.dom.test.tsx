// @vitest-environment happy-dom
/**
 * The Build dialog (story 5.6): a Build refused `sandbox_unavailable` opens
 * it (never an alert); it says in plain words what this computer can use and
 * what to install, and offers Use another agent (disabled), Install Docker
 * (a link the user opens, nothing installed) and Build with me watching, in
 * the server's order (Windows: building with you watching first), which
 * starts an attended build. Docker already running is shown as ready but not
 * usable yet; a failed status read still allows building with you watching.
 */
import {
  API_ROUTES,
  apiPath,
  ATTENDED_EXPLAINED_TEXT,
  BUILD_DIALOG_LOAD_FAILED,
  BUILD_DIALOG_TITLE,
  DOCKER_INSTALL_URL,
  DOCKER_READY_BUT_UNSUPPORTED_TEXT,
  SANDBOX_UNAVAILABLE_MESSAGE,
  TicketsResponse,
  type SandboxStatus,
} from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SESSION = {
  id: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4',
  workspaceId: WS,
  kind: 'build',
  state: 'working',
  driver: 'ui',
  permissionMode: 'ask',
  title: null,
  adapterRefs: {},
  createdAt: '2026-10-04T00:00:00.000Z',
  updatedAt: '2026-10-04T00:00:00.000Z',
};
const RUN = {
  id: 'run_01J9Z3K4M5N6P7Q8R9S0T1V2W5',
  workspaceId: WS,
  sessionId: SESSION.id,
  ticketRef: '1.1',
  worktreePath: '/data/w/abcdefgh',
  deadline: null,
  outcome: 'running',
  reason: null,
  sandbox: 'attended',
  createdAt: '2026-10-04T00:00:00.000Z',
  updatedAt: '2026-10-04T00:00:00.000Z',
};

const state = vi.hoisted(() => ({
  status: undefined as unknown,
  calls: [] as string[],
  bodies: [] as unknown[],
  attended: undefined as unknown,
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
      if (method === 'GET' && path.endsWith('/build-sandbox')) {
        const found = state.status as { status?: number } | SandboxStatus;
        return typeof (found as { status?: number }).status === 'number' ? answer({ error: { code: 'internal_error', message: 'No.' } }, 500) : answer({ status: found });
      }
      if (method === 'POST' && path.endsWith('/builds')) {
        const body = JSON.parse(String(init.body)) as { mode?: string };
        state.bodies.push(body);
        if (body.mode === 'attended') return answer(state.attended ?? { run: RUN, session: SESSION }, (state.attended as { error?: unknown } | undefined)?.error === undefined ? 201 : 409);
        return answer({ error: { code: 'sandbox_unavailable', message: SANDBOX_UNAVAILABLE_MESSAGE } }, 409);
      }
      return new Response('{}', { status: 404 });
    },
  },
}));

const { BoardTickets } = await import('../src/planning/board-tickets');
const { BuildDialog } = await import('../src/planning/build-dialog');
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
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

const UNAVAILABLE: SandboxStatus = {
  platform: 'linux',
  available: false,
  kind: null,
  summary: "Claude Code's sandbox on Linux needs bubblewrap (bwrap) and socat installed.",
  probes: [{ kind: 'bubblewrap', state: 'missing', note: "Claude Code's sandbox on Linux needs bubblewrap (bwrap) and socat installed." }],
  choices: ['other_agent', 'install_docker', 'attended'],
  installHint: 'Install bubblewrap and socat with your package manager.',
};
const WINDOWS: SandboxStatus = {
  platform: 'windows',
  available: false,
  kind: null,
  summary: "Claude Code has no sandbox of its own on Windows, so it can't build unattended here.",
  probes: [],
  choices: ['attended', 'install_docker', 'other_agent'],
  installHint: 'Docker Desktop is optional on Windows. Building with you watching works without it.',
};

beforeEach(() => {
  state.calls.length = 0;
  state.bodies.length = 0;
  state.attended = undefined;
});
afterEach(() => cleanup());

const order = () => screen.getAllByTestId('build-dialog-choice').map((item) => item.getAttribute('data-choice'));

describe('the Build dialog (story 5.6)', () => {
  it('opens when a Build is refused for want of a sandbox, with the status in words and the three choices', async () => {
    state.status = UNAVAILABLE;
    const started: string[] = [];
    mount(<BoardTickets wsId={WS} builds={{ onStarted: (id) => started.push(id) }} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Build 1.1' }));
    await settle();
    await settle();
    // A dialog, never the alert.
    expect(screen.queryByTestId('board-build-error')).toBeNull();
    expect(screen.getByRole('dialog', { name: BUILD_DIALOG_TITLE })).toBeTruthy();
    expect(state.calls).toContain(`GET ${apiPath(API_ROUTES.workspaceBuildSandbox, { wsId: WS })}`);
    expect(screen.getByTestId('build-dialog-summary').textContent).toBe(UNAVAILABLE.summary);
    expect(screen.getByTestId('build-dialog-probes').textContent).toContain('bubblewrap');
    expect(screen.getByTestId('build-dialog-install-hint').textContent).toBe(UNAVAILABLE.installHint);
    expect(order()).toEqual(['other_agent', 'install_docker', 'attended']);
    expect(screen.getByRole('button', { name: 'Use another agent' }).hasAttribute('disabled')).toBe(true);
    const docker = screen.getByTestId('build-dialog-install-docker') as HTMLAnchorElement;
    expect(docker.getAttribute('href')).toBe(DOCKER_INSTALL_URL);
    expect(docker.getAttribute('target')).toBe('_blank');
    expect(docker.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText(ATTENDED_EXPLAINED_TEXT)).toBeTruthy();

    // Build with me watching starts an attended build and hands its session on.
    fireEvent.click(screen.getByRole('button', { name: 'Build with me watching' }));
    await settle();
    expect(state.bodies).toEqual([{ ref: '1.1' }, { ref: '1.1', mode: 'attended' }]);
    expect(started).toEqual([SESSION.id]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('on Windows puts Build with me watching first, where focus lands, and says Docker Desktop is optional', async () => {
    state.status = WINDOWS;
    mount(<BuildDialog wsId={WS} ticketRef="1.1" onClose={() => {}} onStarted={() => {}} />);
    await settle();
    expect(order()).toEqual(['attended', 'install_docker', 'other_agent']);
    expect(screen.getByTestId('build-dialog-install-hint').textContent).toContain('Docker Desktop is optional');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Build with me watching' }));
  });

  it('shows Docker that is already running as ready but not usable yet, with no link to install it', async () => {
    state.status = { ...UNAVAILABLE, probes: [{ kind: 'docker', state: 'detected', note: DOCKER_READY_BUT_UNSUPPORTED_TEXT }] };
    mount(<BuildDialog wsId={WS} ticketRef="1.1" onClose={() => {}} onStarted={() => {}} />);
    await settle();
    const install = screen.getByTestId('build-dialog-install-docker');
    expect(install.tagName).toBe('BUTTON');
    expect(install.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('a status that cannot be read says so and still offers building with you watching', async () => {
    state.status = { status: 500 };
    mount(<BuildDialog wsId={WS} ticketRef="1.1" onClose={() => {}} onStarted={() => {}} />);
    await settle();
    expect(screen.getByTestId('build-dialog-load-error').textContent).toContain(BUILD_DIALOG_LOAD_FAILED);
    expect(order()).toEqual(['other_agent', 'install_docker', 'attended']);
    expect(screen.getByTestId('build-dialog-attended')).toBeTruthy();
  });

  it('a refused attended build says why in the dialog and keeps it open', async () => {
    state.status = WINDOWS;
    state.attended = { error: { code: 'plan_uncommitted', message: 'This ticket plan has uncommitted changes.' } };
    const closed = vi.fn();
    mount(<BuildDialog wsId={WS} ticketRef="1.1" onClose={closed} onStarted={() => {}} />);
    await settle();
    fireEvent.click(screen.getByTestId('build-dialog-attended'));
    await settle();
    expect(screen.getByTestId('build-dialog-error').textContent).toContain('This ticket plan has uncommitted changes.');
    expect(closed).not.toHaveBeenCalled();
  });
});
