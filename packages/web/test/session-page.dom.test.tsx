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
import {
  CHAT_REMOTE_FIXED_TEXT,
  chatOnMachineText,
  DELETE_AND_DISCARD_LABEL,
  DELETE_CHAT_CONFIRM_TITLE,
  DELETE_CHAT_NOT_DELETABLE_TEXT,
  DELETE_CHAT_UNCOMMITTED_TEXT,
  deleteChatBusyText,
  DELETE_CHAT_REMOTE_TEXT,
  deleteChatConfirmText,
  RESTORE_PATH_TAKEN_TEXT,
  WORKTREE_BADGE_TOOLTIP_TEXT,
  WORKTREE_PUT_AWAY_COMPOSER_TEXT,
  WORKTREE_PUT_AWAY_TEXT,
  WORKTREE_RESTORE_LABEL,
  WORKTREE_RESTORE_RETRY_LABEL,
  worktreeBadgeLabel,
  type CoreEvent,
  type SessionDriver,
  type SessionResponse,
} from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markNeedsYouOpened } from '../src/shell/needs-you-target';
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
  /** The session's agent (story 21.4); undefined is the install's default. */
  agentId: undefined as string | undefined,
  /** Whether the agent list still has Claude Code (story 21.4: a removed agent is no longer listed). */
  claudeListed: true,
  /** What `sendMessage` does after recording the text. */
  sendResult: (() => Promise.resolve({ messageId: 'msg_x', queued: false })) as () => Promise<unknown>,
  /** The location's hash, without `#` (a Needs you row names its card there, epic 26). */
  hash: '',
  /** The chat's own worktree (27.1), or `null` for one in the project's folder. */
  worktreePath: null as string | null,
  machineId: null as string | null,
  /** The location's path: another page's while the router is on its way there (story 26.10). */
  pathname: '/w/ws_1/s/ses_1',
  /** The session's kind (Delete chat, 27.3). */
  kind: 'chat' as string,
  /** The session's state as the REST read gives it. */
  state: 'idle' as string,
  /** Each Delete chat asked: whether it discarded uncommitted changes. */
  deletes: [] as boolean[],
  /** What each Delete chat answers, in turn (the last repeats). */
  deleteResults: [] as Array<() => Promise<unknown>>,
  /** The new-chat drafts opened. */
  newChats: [] as string[],
  /** The install's remote machines (27.5: a remote chat names its own). */
  machines: [] as unknown[],
  /** Host-key probes asked (a started chat's chip never probes). */
  probes: 0,
  /** Whether the chat's copy is put away (27.6), and each Restore asked with what it answers. */
  putAway: false,
  /** The chat was deleted: its read answers 404. */
  gone: false,
  restores: [] as string[],
  restoreResult: (() => Promise.resolve()) as () => Promise<unknown>,
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ wsId: 'ws_1', sesId: 'ses_1' }),
  useSearch: () => fake.search,
  useNavigate: () => fake.navigate,
  useRouterState: ({ select }: { select: (state: { location: { pathname: string; hash: string; href: string; state: Record<string, string> } }) => unknown }) =>
    select({ location: { pathname: fake.pathname, hash: fake.hash, href: `${fake.pathname}#${fake.hash}`, state: { __TSR_key: 'key_1' } } }),
  Link: ({ children, to, params: _params, search, activeOptions: _active, ...rest }: { children: ReactNode; to?: string; params?: unknown; search?: unknown; activeOptions?: unknown } & Record<string, unknown>) => (
    <a href="/" data-to={to} data-search={search === undefined ? undefined : JSON.stringify(search)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/chat/new-chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/chat/new-chat')>()),
  useOpenNewChat: () => (wsId: string) => fake.newChats.push(wsId),
}));
vi.mock('@/worktrees/worktree-retention', () => ({
  usePutAwayWorktrees: () => ({
    data: fake.putAway ? [{ id: 'wsn_1', sessionId: 'ses_1', workspaceId: 'ws_1', branch: 'ogden/chat/ses_1', files: 2, cause: 'retention', putAwayAt: '2026-11-01T00:00:00.000Z' }] : [],
  }),
  useRestoreWorktree: () => async (sesId: string) => {
    fake.restores.push(sesId);
    await fake.restoreResult();
  },
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
vi.mock('@/remote-machines/remote-machines-api', () => ({
  useRemoteMachines: () => ({ data: fake.machines }),
  checkRemoteMachineHostKey: async () => {
    fake.probes++;
    return { fingerprint: 'fp' };
  },
}));
vi.mock('@/agents/agent-setup-api', () => ({ useAgents: () => ({ data: [] }), useSignIn: () => ({}) }));
vi.mock('@/chat/chat-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/chat/chat-api')>()),
  fetchChatAgents: async () => ({
    agents: [
      {
        agentId: 'codex',
        displayName: 'Codex',
        provider: 'OpenAI',
        signInMethods: [],
        install: 'installed',
        auth: 'signed_in',
        terminalResume: true,
        needsProjectTrust: false,
        permissionModes: ['ask', 'auto', 'skip_all'],
      },
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
    ].filter((agent) => fake.claudeListed || agent.agentId !== 'claude-code'),
    defaultAgentId: 'codex',
  }),
  fetchSession: async (): Promise<SessionResponse> => {
    fake.fetches++;
    if (fake.gone) {
      const { ChatApiError: Gone } = await import('../src/chat/chat-api');
      throw new Gone('That chat is gone.', 404, 'not_found');
    }
    return {
      session: {
        id: 'ses_1',
        workspaceId: 'ws_1',
        kind: fake.kind,
        state: fake.state,
        driver: fake.driver,
        adapterRefs: {},
        machineId: fake.machineId,
        worktreePath: fake.worktreePath,
        branch: fake.worktreePath === null ? null : 'ogden/chat/ses_1',
        ...(fake.agentId === undefined ? {} : { agentId: fake.agentId }),
      },
      terminal: { available: true },
    } as unknown as SessionResponse;
  },
  switchDriver: (_wsId: string, _sesId: string, next: string) => {
    fake.switches.push(next);
    return fake.switchResult();
  },
  sendMessage: async (_wsId: string, _sesId: string, text: string) => {
    fake.sent.push(text);
    return fake.sendResult();
  },
  cancelSession: async () => undefined,
  deleteChat: async (_wsId: string, _sesId: string, discard: boolean) => {
    fake.deletes.push(discard);
    const result = fake.deleteResults[Math.min(fake.deletes.length - 1, fake.deleteResults.length - 1)];
    return result === undefined ? { sessionId: 'ses_1', worktreeRemoved: false, branchKept: false } : result();
  },
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
const created = () =>
  event('session.created', { session: { id: SES, workspaceId: WS, state: 'idle', driver: 'ui', ...(fake.agentId === undefined ? {} : { agentId: fake.agentId }) } });
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
  fake.hash = '';
  fake.pathname = '/w/ws_1/s/ses_1';
  fake.navigations = [];
  fake.fetches = 0;
  fake.driver = 'ui';
  fake.switches = [];
  fake.switchResult = () => Promise.resolve();
  fake.focused = 0;
  fake.connections = 0;
  fake.sent = [];
  fake.worktreePath = null;
  fake.machineId = null;
  fake.machines = [];
  fake.probes = 0;
  fake.kind = 'chat';
  fake.state = 'idle';
  fake.deletes = [];
  fake.deleteResults = [];
  fake.newChats = [];
  fake.putAway = false;
  fake.gone = false;
  fake.restores = [];
  fake.restoreResult = () => Promise.resolve();
  fake.agentId = undefined;
  fake.claudeListed = true;
  fake.sendResult = () => Promise.resolve({ messageId: 'msg_x', queued: false });
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

describe('a Needs you row opens its chat on its card (epic 26, story 26.1)', () => {
  const asked = () => [
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

  it('the hash naming a pending card scrolls to and focuses it', async () => {
    fake.events = asked();
    fake.hash = 'permission-perm_1';
    await mount();
    expect(document.activeElement).toBe(document.getElementById('permission-perm_1'));
  });

  it('opening the same row again, on the URL already shown, focuses the card again', async () => {
    fake.events = asked();
    fake.hash = 'permission-perm_1';
    await mount();
    const card = document.getElementById('permission-perm_1')!;
    expect(document.activeElement).toBe(card);
    card.blur();
    expect(document.activeElement).not.toBe(card);
    // No new history entry (the same location): only the open counts.
    act(() => markNeedsYouOpened('perm_1'));
    expect(document.activeElement).toBe(card);
  });

  it('a hash naming no pending card opens the chat plainly', async () => {
    fake.events = asked();
    fake.hash = 'permission-perm_gone';
    await mount();
    expect(document.activeElement?.closest('[data-testid="permission-card"]') ?? null).toBeNull();
  });

  it('not while the terminal drives', async () => {
    fake.events = asked();
    fake.hash = 'permission-perm_1';
    fake.driver = 'terminal';
    fake.events.push(driverChanged('terminal'));
    await mount();
    expect(document.activeElement?.closest('[data-testid="permission-card"]') ?? null).toBeNull();
  });
});

describe('a page on its way to another one (story 26.10)', () => {
  it('disables the composer while the location is no longer this chat, so nothing typed reaches it', async () => {
    fake.pathname = '/w/ws_1/new';
    await mount();
    expect(composerInput()?.readOnly).toBe(true);
    cleanup();
    fake.pathname = '/w/ws_1/s/ses_1/';
    await mount();
    expect(composerInput()?.readOnly).toBe(false);
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

describe('a chat whose agent was removed opens read-only (story 21.4)', () => {
  const permissionRequested = () =>
    event('permission.requested', {
      sessionId: SES,
      requestId: 'perm_1',
      toolCall: { toolCallId: 'call_1', title: 'Run ls', kind: 'execute', command: 'ls' },
      alwaysAllowScope: null,
      cautionLevel: 'ask_for_commands',
    });
  const waiting = () => event('session.state_changed', { sessionId: SES, state: 'waiting' });

  it('shows the banner, no composer, no controls that start work, and inert permission cards', async () => {
    fake.agentId = 'my-custom-agent';
    fake.events = [created(), event('session.message_completed', { messageId: 'msg_1', role: 'user', content: 'hello' }), permissionRequested(), waiting()];
    await mount();

    expect((await screen.findByTestId('agent-removed-banner')).textContent).toBe('This agent was removed. You can read this chat, but not continue it.');
    expect(screen.queryByTestId('composer')).toBeNull();
    expect(screen.queryByTestId('permission-mode-picker')).toBeNull();
    expect(screen.queryByTestId('driver-toggle')).toBeNull();
    // Continue with another agent stays: the server hands a removed agent's chat over.
    expect(screen.getByTestId('session-menu')).toBeTruthy();
    // The transcript stays readable.
    expect(screen.getByTestId('transcript').textContent).toContain('hello');
    const card = screen.getByTestId('permission-card');
    const answers = [...card.querySelectorAll('button')];
    expect(answers.length).toBeGreaterThan(0);
    for (const answer of answers) expect(answer.getAttribute('aria-disabled')).toBe('true');
  });

  it('a chat whose agent is listed keeps its composer and controls', async () => {
    fake.agentId = 'claude-code';
    fake.events = [created(), permissionRequested(), waiting()];
    await mount();

    expect(await screen.findByTestId('session-menu')).toBeTruthy();
    expect(screen.queryByTestId('agent-removed-banner')).toBeNull();
    expect(screen.getByTestId('composer')).toBeTruthy();
    expect(screen.getByTestId('permission-mode-picker')).toBeTruthy();
    expect(screen.getByTestId('driver-toggle')).toBeTruthy();
    expect(screen.getByTestId('session-menu')).toBeTruthy();
    const card = screen.getByTestId('permission-card');
    expect(card.querySelector('button')?.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('a send refused with 409 agent_removed says so and closes the chat', async () => {
    fake.agentId = 'claude-code';
    await mount();
    fake.claudeListed = false;
    fake.sendResult = () => Promise.reject(new ChatApiError('This agent was removed.', 409, 'agent_removed'));
    const input = composerInput();
    if (input === null) throw new Error('no composer input');
    fireEvent.change(input, { target: { value: 'still there?' } });
    fireEvent.submit(screen.getByTestId('composer'));
    await flush();

    expect(fake.sent).toEqual(['still there?']);
    expect(screen.getByTestId('session-action-error').textContent).toBe('This agent was removed.');
    expect(screen.getByTestId('agent-removed-banner')).toBeTruthy();
    expect(screen.queryByTestId('composer')).toBeNull();
  });
});

describe('the composer setup row (epic 27, 27.1)', () => {
  it('has the Agent, Model, Mode and Location chips, and the header has no mode picker', async () => {
    fake.agentId = 'claude-code';
    await mount();
    const row = await screen.findByTestId('setup-row');
    const header = document.querySelector('header')!;
    expect(header.querySelector('[data-testid="permission-mode-picker"]')).toBeNull();
    for (const chip of ['session-agent-chip', 'model-picker', 'permission-mode-picker', 'location-chip']) {
      expect(row.querySelector(`[data-testid="${chip}"]`), chip).not.toBeNull();
    }
    expect(row.querySelector('[data-testid="session-agent-chip"]')!.textContent).toContain('Claude Code');
    expect(row.querySelector('[data-testid="location-chip"]')!.getAttribute('data-location')).toBe('this_folder');
  });

  it("shows a worktree chat's place, which can't be changed", async () => {
    fake.agentId = 'claude-code';
    fake.worktreePath = '/data/cw/abcdefgh';
    await mount();
    const chip = await screen.findByTestId('location-chip');
    expect(chip.getAttribute('data-location')).toBe('worktree');
    expect(chip.textContent).toContain('Worktree');
    // 27.3: the branch beside the word.
    expect(chip.querySelector('[data-testid="location-branch"]')!.textContent).toBe('ogden/chat/ses_1');
  });
});

/** Opens a Radix menu the way a pointer does (happy-dom has no layout). */
function openMenu(trigger: HTMLElement) {
  act(() => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  });
}

describe('a worktree chat\'s branch badge (27.3)', () => {
  it('shows the branch in the header, linking to the Workbench rooted at the chat, with its tooltip', async () => {
    fake.worktreePath = '/data/cw/abcdefgh';
    await mount();
    const badge = await screen.findByTestId('worktree-badge');
    expect(badge.textContent).toBe('ogden/chat/ses_1');
    expect(badge.getAttribute('data-to')).toBe('/w/$wsId/workbench');
    expect(JSON.parse(badge.getAttribute('data-search')!)).toEqual({ session: SES });
    expect(badge.getAttribute('aria-label')).toBe(worktreeBadgeLabel('ogden/chat/ses_1'));
    await act(async () => {
      fireEvent.focus(badge);
    });
    expect((await screen.findAllByText(WORKTREE_BADGE_TOOLTIP_TEXT)).length).toBeGreaterThan(0);
  });

  it('a chat in the project folder has no badge', async () => {
    await mount();
    await screen.findByTestId('location-chip');
    expect(screen.queryByTestId('worktree-badge')).toBeNull();
    expect(screen.queryByTestId('location-branch')).toBeNull();
  });
});

describe('a remote chat (27.5)', () => {
  const MACHINE = 'mach_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
  const buildBox = { id: MACHINE, host: 'box.local', port: 22, username: 'ada', label: 'build-box', hostKeyFingerprint: 'fp', publicKey: null, hostKeyConfirmed: true, createdAt: '' };

  it('says its machine in the header and on the Location chip, where the place is fixed', async () => {
    fake.machineId = MACHINE;
    fake.machines = [buildBox];
    await mount();
    expect((await screen.findByTestId('machine-badge')).textContent).toBe(chatOnMachineText('build-box'));
    const chip = screen.getByTestId('location-chip');
    expect(chip.getAttribute('data-machine')).toBe(MACHINE);
    expect(chip.textContent).toContain('build-box');
    expect(chip.getAttribute('aria-label')).toBe('Location: build-box');
    openMenu(chip);
    const own = await screen.findByTestId('location-machine');
    expect(own.getAttribute('aria-checked')).toBe('true');
    expect(own.textContent).toContain(CHAT_REMOTE_FIXED_TEXT);
    for (const place of ['location-this_folder', 'location-worktree']) {
      expect(screen.getByTestId(place).getAttribute('aria-disabled')).toBe('true');
      expect(screen.getByTestId(place).textContent).toContain(CHAT_REMOTE_FIXED_TEXT);
    }
    // A started chat lists no other machine, offers no Add, and probes nothing.
    expect(screen.queryByTestId('location-add-machine')).toBeNull();
    await flush();
    expect(fake.probes).toBe(0);
  });

  it('whose machine was removed says "on a remote machine"', async () => {
    fake.machineId = MACHINE;
    await mount();
    expect((await screen.findByTestId('machine-badge')).textContent).toBe('on a remote machine');
  });

  it('a local chat has no machine badge', async () => {
    fake.machines = [buildBox];
    await mount();
    await screen.findByTestId('location-chip');
    expect(screen.queryByTestId('machine-badge')).toBeNull();
    expect(screen.getByTestId('location-chip').getAttribute('data-machine')).toBeNull();
  });
});

describe('Delete chat (27.3)', () => {
  const openDelete = async () => {
    openMenu(await screen.findByTestId('session-menu'));
    fireEvent.click(await screen.findByTestId('session-menu-delete'));
    return screen.findByTestId('delete-chat-confirm');
  };

  it('confirms a plain chat once, deletes it and opens the new-chat draft', async () => {
    await mount();
    const dialog = await openDelete();
    expect(dialog.textContent).toContain(DELETE_CHAT_CONFIRM_TITLE);
    expect(dialog.textContent).toContain(deleteChatConfirmText(null));
    fireEvent.click(screen.getByTestId('delete-chat-confirm-button'));
    await flush();
    expect(fake.deletes).toEqual([false]);
    expect(fake.newChats).toEqual([WS]);
    expect(screen.queryByTestId('delete-chat-confirm')).toBeNull();
  });

  it('a worktree chat names its copy and branch, and its one confirmation discards uncommitted changes', async () => {
    fake.worktreePath = '/data/cw/abcdefgh';
    await mount();
    const dialog = await openDelete();
    expect(dialog.textContent).toContain(deleteChatConfirmText('ogden/chat/ses_1'));
    expect(dialog.textContent).toContain('any changes not committed');
    fireEvent.click(screen.getByTestId('delete-chat-confirm-button'));
    await flush();
    expect(fake.deletes).toEqual([true]);
    expect(fake.newChats).toEqual([WS]);
  });

  it('a plain chat refused for uncommitted changes all the same names them and asks again (fallback)', async () => {
    fake.deleteResults = [() => Promise.reject(new ChatApiError('changes', 409, 'uncommitted_changes')), () => Promise.resolve({ sessionId: SES, worktreeRemoved: true, branchKept: false })];
    await mount();
    const dialog = await openDelete();
    fireEvent.click(screen.getByTestId('delete-chat-confirm-button'));
    await flush();
    expect(fake.deletes).toEqual([false]);
    expect(dialog.textContent).toContain(DELETE_CHAT_UNCOMMITTED_TEXT);
    expect(screen.getByTestId('delete-chat-confirm-button').textContent).toBe(DELETE_AND_DISCARD_LABEL);
    fireEvent.click(screen.getByTestId('delete-chat-confirm-button'));
    await flush();
    expect(fake.deletes).toEqual([false, true]);
    expect(fake.newChats).toEqual([WS]);
  });

  it('another refusal stays in the dialog', async () => {
    fake.deleteResults = [() => Promise.reject(new ChatApiError('Only a chat you started can be deleted on its own.', 409, 'invalid_operation'))];
    await mount();
    await openDelete();
    fireEvent.click(screen.getByTestId('delete-chat-confirm-button'));
    await flush();
    expect(screen.getByRole('alert').textContent).toContain('Only a chat you started');
    expect(fake.newChats).toEqual([]);
  });

  it('is reachable but does nothing while the agent works, saying why', async () => {
    fake.state = 'working';
    fake.events = [created(), event('session.state_changed', { sessionId: SES, state: 'working', previous: 'idle' })];
    await mount();
    openMenu(await screen.findByTestId('session-menu'));
    const item = await screen.findByTestId('session-menu-delete');
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('session-menu-delete-reason').textContent).toBe(deleteChatBusyText('Codex'));
    fireEvent.click(item);
    await flush();
    expect(screen.queryByTestId('delete-chat-confirm')).toBeNull();
  });

  it('a remote chat says it is not deleted on its own', async () => {
    fake.machineId = 'mach_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
    await mount();
    openMenu(await screen.findByTestId('session-menu'));
    expect((await screen.findByTestId('session-menu-delete-reason')).textContent).toBe(DELETE_CHAT_REMOTE_TEXT);
  });

  it('a planning session says it is not deleted on its own; a build has no item', async () => {
    fake.kind = 'planning';
    await mount();
    openMenu(await screen.findByTestId('session-menu'));
    expect((await screen.findByTestId('session-menu-delete-reason')).textContent).toBe(DELETE_CHAT_NOT_DELETABLE_TEXT);
  });
});

describe("a chat whose copy was put away (27.6)", () => {
  it('says so with Restore, and the composer takes no message until then', async () => {
    fake.worktreePath = '/data/cw/abcdefgh';
    fake.putAway = true;
    await mount();
    const notice = await screen.findByTestId('worktree-put-away');
    expect(notice.textContent).toContain(WORKTREE_PUT_AWAY_TEXT);
    expect(screen.getByTestId('worktree-restore').textContent).toBe(WORKTREE_RESTORE_LABEL);
    expect(screen.getByTestId('composer').textContent).toContain(WORKTREE_PUT_AWAY_COMPOSER_TEXT);

    const fetchesBefore = fake.fetches;
    fireEvent.click(screen.getByTestId('worktree-restore'));
    await flush();
    expect(fake.restores).toEqual([SES]);
    // The session is read again once restored.
    expect(fake.fetches).toBeGreaterThan(fetchesBefore);
  });

  it("shows why Restore couldn't finish, with Try again", async () => {
    fake.worktreePath = '/data/cw/abcdefgh';
    fake.putAway = true;
    fake.restoreResult = () => Promise.reject(new ChatApiError(RESTORE_PATH_TAKEN_TEXT, 409, 'restore_failed'));
    await mount();
    fireEvent.click(await screen.findByTestId('worktree-restore'));
    await flush();
    expect(screen.getByTestId('worktree-restore-error').textContent).toBe(RESTORE_PATH_TAKEN_TEXT);
    expect(screen.getByTestId('worktree-restore').textContent).toBe(WORKTREE_RESTORE_RETRY_LABEL);
    fake.restoreResult = () => Promise.resolve();
    fireEvent.click(screen.getByTestId('worktree-restore'));
    await flush();
    expect(fake.restores).toEqual([SES, SES]);
  });

  it('a worktree chat that is not put away has no notice', async () => {
    fake.worktreePath = '/data/cw/abcdefgh';
    await mount();
    await screen.findByTestId('worktree-badge');
    expect(screen.queryByTestId('worktree-put-away')).toBeNull();
  });

  it('a worktree chat deleted while open reads as gone, without a hooks error', async () => {
    fake.worktreePath = '/data/cw/abcdefgh';
    const { push } = await mount();
    await screen.findByTestId('worktree-badge');
    fake.gone = true;
    fake.driver = 'terminal';
    await push(driverChanged('terminal'));
    expect(await screen.findByTestId('session-not-found')).toBeTruthy();
    expect(screen.queryByTestId('worktree-badge')).toBeNull();
  });
});
