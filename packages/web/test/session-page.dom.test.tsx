// @vitest-environment happy-dom
/**
 * The session page's driver wiring (story 3.9; 3.6 review F7), in a DOM:
 * the view switches only on `session.driver_changed`, keyboard focus goes
 * into xterm and back to the composer, `?driver=terminal` follows who
 * drives, a 409 reads the session again, and the "waiting for you" bar stays
 * off while the terminal drives. The router, the event stream, the REST
 * calls, xterm and the terminal socket are stand-ins; the parts have their
 * own tests in `driver-toggle.dom.test.tsx` and `terminal-panel.dom.test.tsx`.
 */
import type { CoreEvent, SessionDriver, SessionResponse } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../src/ui/tooltip';

const WS = 'ws_1';
const SES = 'ses_1';

const fake = vi.hoisted(() => ({
  /** The router's `navigate`: one function for the page's life, as the router's is. */
  navigate: async (to: { search: { driver?: 'terminal' }; replace?: boolean }) => {
    fake.navigations.push({ search: to.search, replace: to.replace });
    fake.search = to.search;
  },
  events: [] as unknown[],
  search: {} as { driver?: 'terminal' },
  navigations: [] as Array<{ search: unknown; replace?: boolean }>,
  fetches: 0,
  driver: 'ui' as 'ui' | 'terminal',
  switches: [] as string[],
  switchResult: (() => Promise.resolve()) as () => Promise<unknown>,
  focused: 0,
  connections: 0,
  /** Every message `sendMessage` was asked to send (CAP-24, epic 19 story 19.7: proving "Try again" resends). */
  sent: [] as string[],
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ wsId: 'ws_1', sesId: 'ses_1' }),
  useSearch: () => fake.search,
  useNavigate: () => fake.navigate,
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock('@/shell/workspace-header', () => ({ WorkspaceHeader: ({ children }: { children?: ReactNode }) => <header>{children}</header> }));
vi.mock('@/events/event-stream', () => ({
  // The agent lists' invalidation (epic 6) reads the stream: nothing new arrives here.
  useEventStream: () => ({ events: [] }),
  useSessionEvents: (_wsId: string, streamId: string) => (streamId === 'ses_1' ? fake.events : []),
  useCaughtUp: () => true,
  useEarlierHistory: () => ({ hasEarlier: false, loading: false, error: undefined, loadEarlier: () => undefined }),
}));
vi.mock('@/appearance/appearance-provider', () => ({
  useAppearance: () => ({ appearance: { developerMode: true, density: 'comfortable', terminalScreenReader: false } }),
}));
vi.mock('@/workspaces/workspace-api', () => ({ fetchWorkspace: async () => ({ id: 'ws_1', path: '/repo' }), workspaceName: () => 'repo' }));
vi.mock('@/agents/agent-setup-api', () => ({ useAgents: () => ({ data: [] }), useSignIn: () => ({}) }));
vi.mock('@/chat/chat-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/chat/chat-api')>()),
  fetchChatAgents: async () => ({
    agents: [
      {
        agentId: 'claude-code',
        displayName: 'Claude Code',
        provider: 'Anthropic',
        signInMethods: [],
        install: 'installed',
        auth: 'signed_in',
        terminalResume: true,
        needsProjectTrust: false,
        permissionModes: ['ask', 'auto', 'skip_all'],
      },
    ],
    defaultAgentId: 'claude-code',
  }),
  fetchSession: async (): Promise<SessionResponse> => {
    fake.fetches++;
    return {
      session: { id: 'ses_1', workspaceId: 'ws_1', state: 'idle', driver: fake.driver, adapterRefs: {} },
      terminal: { available: true },
    } as unknown as SessionResponse;
  },
  switchDriver: (_wsId: string, _sesId: string, next: string) => {
    fake.switches.push(next);
    return fake.switchResult();
  },
  sendMessage: async (_wsId: string, _sesId: string, text: string) => {
    fake.sent.push(text);
    return { messageId: 'msg_x', queued: false };
  },
  cancelSession: async () => undefined,
}));
// xterm and its socket: the panel's real effect runs, and xterm's focus lands on a textarea of its own.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    input: HTMLTextAreaElement | undefined;
    unicode = { activeVersion: '6' };
    loadAddon() {}
    open(element: HTMLElement) {
      this.input = document.createElement('textarea');
      this.input.setAttribute('data-testid', 'xterm-input');
      element.append(this.input);
    }
    focus() {
      fake.focused++;
      this.input?.focus();
    }
    dispose() {
      this.input?.remove();
    }
    write() {}
    reset() {}
    resize() {}
    onData = () => ({ dispose() {} });
    onResize = () => ({ dispose() {} });
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('../src/terminal/terminal-socket', () => ({
  connectTerminal: () => {
    fake.connections++;
    return { type() {}, resize() {}, close() {} };
  },
}));

const { SessionPage } = await import('../src/routes/session-page');
const { ChatApiError } = await import('../src/chat/chat-api');

let seq = 0;
const event = (type: string, payload: Record<string, unknown>) =>
  ({ id: `evt_${++seq}`, seq, at: '2026-10-01T12:00:00.000Z', type, workspaceId: WS, streamId: SES, payload }) as unknown as CoreEvent;
const created = () => event('session.created', { session: { id: SES, workspaceId: WS, state: 'idle', driver: 'ui' } });
const driverChanged = (driver: SessionDriver) => event('session.driver_changed', { sessionId: SES, driver, previous: driver === 'ui' ? 'terminal' : 'ui', cause: 'user' });

/** Lets queries, effects and the panel's dynamic imports run. */
async function flush() {
  for (let i = 0; i < 10; i++) await act(async () => {});
}

/** Renders the page; `push` adds events to the session's stream, as the socket would. */
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node = () => (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <SessionPage />
      </TooltipProvider>
    </QueryClientProvider>
  );
  const view = render(node());
  await flush();
  const push = async (...added: CoreEvent[]) => {
    fake.events = [...fake.events, ...added];
    view.rerender(node());
    await flush();
  };
  return { push };
}

const composerInput = () => screen.getByTestId('composer').querySelector('textarea');

beforeEach(() => {
  seq = 0;
  fake.events = [created()];
  fake.search = {};
  fake.navigations = [];
  fake.fetches = 0;
  fake.driver = 'ui';
  fake.switches = [];
  fake.switchResult = () => Promise.resolve();
  fake.focused = 0;
  fake.connections = 0;
  fake.sent = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the session page’s driver wiring (story 3.9; 3.6 review F7)', () => {
  it('a switch only asks: the view changes on session.driver_changed, and each one reads the session again', async () => {
    const { push } = await mount();
    const fetchesBefore = fake.fetches;
    fireEvent.click(screen.getByTestId('switch-to-terminal'));
    await flush();
    expect(fake.switches).toEqual(['terminal']);
    // Asked, not switched: still the chat.
    expect(screen.queryByTestId('terminal-panel')).toBeNull();
    expect(screen.queryByTestId('read-only-banner')).toBeNull();
    expect(screen.getByTestId('switch-to-chat').getAttribute('data-state')).toBe('on');

    fake.driver = 'terminal';
    await push(driverChanged('terminal'));
    expect(screen.getByTestId('terminal-panel')).toBeTruthy();
    expect(screen.getByTestId('read-only-banner')).toBeTruthy();
    expect(screen.getByTestId('switch-to-terminal').getAttribute('data-state')).toBe('on');
    expect(screen.getByTestId('composer-switch-to-chat')).toBeTruthy();
    expect(fake.connections).toBe(1);
    expect(fake.fetches).toBeGreaterThan(fetchesBefore);
  });

  it('focus goes into xterm when the terminal drives, and back to the composer on switching back', async () => {
    const { push } = await mount();
    fake.driver = 'terminal';
    await push(driverChanged('terminal'));
    expect(fake.focused).toBe(1);
    expect(document.activeElement).toBe(screen.getByTestId('xterm-input'));

    fireEvent.click(screen.getByTestId('composer-switch-to-chat'));
    await flush();
    expect(fake.switches).toEqual(['ui']);
    fake.driver = 'ui';
    await push(driverChanged('ui'));
    expect(screen.queryByTestId('terminal-panel')).toBeNull();
    expect(document.activeElement).toBe(composerInput());
  });

  it('?driver=terminal follows who drives, replacing the history entry', async () => {
    const { push } = await mount();
    // The chat drives and the URL has no driver: nothing to do.
    expect(fake.navigations).toEqual([]);
    fake.driver = 'terminal';
    await push(driverChanged('terminal'));
    expect(fake.navigations).toEqual([{ search: { driver: 'terminal' }, replace: true }]);
    fake.driver = 'ui';
    await push(driverChanged('ui'));
    expect(fake.navigations.at(-1)).toEqual({ search: {}, replace: true });
    expect(fake.navigations).toHaveLength(2);
  });

  it('a refused switch (409) says why and reads the session again', async () => {
    await mount();
    const fetchesBefore = fake.fetches;
    fake.switchResult = () => Promise.reject(new ChatApiError('Claude Code is busy. Switch to the terminal when it is idle.', 409));
    fireEvent.click(screen.getByTestId('switch-to-terminal'));
    await flush();
    expect(screen.getByTestId('session-action-error').textContent).toBe('Claude Code is busy. Switch to the terminal when it is idle.');
    expect(fake.fetches).toBe(fetchesBefore + 1);
    expect(screen.queryByTestId('terminal-panel')).toBeNull();
  });

  it('the "waiting for you" bar shows for a card out of view, and stays off while the terminal drives', async () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void) {}
        observe() {
          this.callback([{ isIntersecting: false }]);
        }
        disconnect() {}
      },
    );
    fake.events = [
      created(),
      event('permission.requested', {
        sessionId: SES,
        requestId: 'perm_1',
        toolCall: { toolCallId: 'call_1', title: 'Run ls', kind: 'execute', command: 'ls' },
        alwaysAllowScope: null,
        cautionLevel: 'ask_for_commands',
      }),
      event('session.state_changed', { sessionId: SES, state: 'waiting' }),
    ];
    const { push } = await mount();
    expect(screen.getByTestId('waiting-bar')).toBeTruthy();
    fake.driver = 'terminal';
    await push(driverChanged('terminal'));
    expect(screen.queryByTestId('waiting-bar')).toBeNull();
  });
});

describe('a dropped remote connection needs no new UI (CAP-24, epic 19 story 19.7)', () => {
  it('shows the existing fatal-error notice with 19.6’s connection_lost reason, and Try again resends the last message', async () => {
    const CONNECTION_LOST_REASON = 'The connection to the remote machine was lost. Retry to carry on.';
    fake.events = [
      created(),
      event('session.message_completed', { messageId: 'msg_1', role: 'user', content: 'keep going' }),
      event('session.state_changed', { sessionId: SES, state: 'error', previous: 'working', reason: CONNECTION_LOST_REASON, errorCode: 'connection_lost' }),
    ];
    await mount();

    // The generic fatal-error Notice (unconditional for any errorCode other than auth_required), never a second,
    // remote-specific error UI: SignInAgain's own "needs sign in" path never renders for this errorCode.
    expect(screen.queryByTestId('sign-in-again')).toBeNull();
    const notice = screen.getByTestId('session-error');
    expect(notice.getAttribute('data-error-code')).toBe('connection_lost');
    expect(notice.textContent).toContain(CONNECTION_LOST_REASON);

    fireEvent.click(screen.getByTestId('try-again'));
    await flush();
    // Resent over what would be a fresh connection server-side (`agentFor`'s own `begin()`, a connect-time concern
    // this view never has to know about): the client's only job is to resend the same text.
    expect(fake.sent).toEqual(['keep going']);
  });
});
