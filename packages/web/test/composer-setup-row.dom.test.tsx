// @vitest-environment happy-dom
/**
 * The composer's setup row in the new-chat draft (epic 27, 27.1): Agent,
 * Model, Mode and Location chips on the project's defaults; a send creates
 * the chat with the row's place, sets a picked mode through the set-mode
 * route, then sends; a refused mode is shown and the retry reuses that
 * chat. The Location chip on its own: Worktree disabled while a machine is
 * picked, a started chat's place fixed. The router, the REST calls and the
 * remote machines are stand-ins.
 */
import { CHAT_LOCATION_FIXED_TEXT, CHAT_WORKTREE_REMOTE_TEXT, type ChatAgentsResponse, type Session } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../src/ui/tooltip';

/** Opens a Radix menu the way a pointer does (happy-dom has no layout). */
function openMenu(trigger: HTMLElement) {
  act(() => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  });
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
};

const fake = vi.hoisted(() => ({
  calls: [] as string[],
  created: [] as Array<{ agentId: string | undefined; model: string | null | undefined; machineId: string | null | undefined; location: string | undefined }>,
  modeResult: (() => Promise.resolve()) as () => Promise<unknown>,
  settings: {} as Record<string, unknown>,
  navigations: [] as unknown[],
  next: 0,
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ wsId: 'ws_1' }),
  useSearch: () => ({}),
  useNavigate: () => async (to: unknown) => void fake.navigations.push(to),
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock('@/shell/workspace-header', () => ({ WorkspaceHeader: ({ children }: { children?: ReactNode }) => <header>{children}</header> }));
vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [] }) }));
vi.mock('@/appearance/appearance-provider', () => ({
  useAppearance: () => ({ appearance: { developerMode: true, density: 'comfortable', terminalScreenReader: false } }),
}));
vi.mock('@/workspaces/workspace-api', () => ({ fetchWorkspace: async () => ({ id: 'ws_1', path: '/repo' }), workspaceName: () => 'repo' }));
vi.mock('@/workspaces/workspace-settings-api', () => ({
  useWorkspaceSettings: () => ({ data: { cautionLevel: 'ask_for_commands', bmadPieces: [], bmadScriptsTrusted: false, ...fake.settings }, isError: false }),
}));
vi.mock('@/remote-machines/remote-machines-api', () => ({ useRemoteMachines: () => ({ data: [] }), checkRemoteMachineHostKey: vi.fn() }));
vi.mock('@/chat/chat-api', async (importOriginal) => {
  const session = (id: string, over: Partial<Session> = {}): Session =>
    ({ id, workspaceId: 'ws_1', kind: 'chat', state: 'idle', driver: 'ui', permissionMode: 'ask', agentId: 'claude-code', machineId: null, worktreePath: null, branch: null, title: null, adapterRefs: {}, createdAt: '', updatedAt: '', ...over }) as Session;
  return {
    ...(await importOriginal<typeof import('../src/chat/chat-api')>()),
    fetchChatAgents: async (): Promise<ChatAgentsResponse> =>
      ({
        agents: [
          { agentId: 'claude-code', displayName: 'Claude Code', provider: 'Anthropic', signInMethods: [], install: 'installed', auth: 'signed_in', terminalResume: true, needsProjectTrust: false, permissionModes: ['ask', 'auto', 'skip_all'], models: [{ id: 'opus', name: 'Opus' }] },
          { agentId: 'codex', displayName: 'Codex', provider: 'OpenAI', signInMethods: [], install: 'installed', auth: 'signed_in', terminalResume: false, needsProjectTrust: false, permissionModes: ['ask'] },
        ],
        defaultAgentId: 'claude-code',
      }) as ChatAgentsResponse,
    createChatSession: async (_wsId: string, _auth: unknown, agentId?: string, model?: string | null, machineId?: string | null, location?: string) => {
      fake.calls.push('create');
      fake.created.push({ agentId, model, machineId, location });
      return session(`ses_${++fake.next}`, location === 'worktree' ? { worktreePath: '/data/cw/abcdefgh', branch: `ogden/chat/ses_${fake.next}` } : {});
    },
    setPermissionMode: async (_wsId: string, sesId: string, mode: string, confirm: boolean) => {
      fake.calls.push(`mode ${mode}${confirm ? ' confirmed' : ''}`);
      await fake.modeResult();
      return { session: session(sesId, { permissionMode: mode as Session['permissionMode'] }) };
    },
    sendMessage: async (_wsId: string, sesId: string, text: string) => {
      fake.calls.push(`send ${sesId} ${text}`);
      return { messageId: 'msg_1', queued: false };
    },
  };
});

const { NewChatPage } = await import('../src/routes/new-chat-page');
const { LocationChip } = await import('../src/chat/setup-row');
const { draftModeOptions } = await import('../src/permissions/permission-mode-picker');

beforeEach(() => {
  fake.calls = [];
  fake.created = [];
  fake.modeResult = () => Promise.resolve();
  fake.settings = {};
  fake.navigations = [];
  fake.next = 0;
  localStorage.clear();
});
afterEach(() => cleanup());

async function mountDraft() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <NewChatPage />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await flush();
}

async function send(text: string) {
  const field = screen.getByRole('textbox');
  fireEvent.change(field, { target: { value: text } });
  fireEvent.submit(screen.getByTestId('composer'));
  await flush();
}

describe('the new-chat draft setup row (27.1)', () => {
  it("shows Agent, Model, Mode and Location on the project's defaults", async () => {
    fake.settings = { defaultPermissionMode: 'auto', defaultModels: { 'claude-code': 'opus' } };
    await mountDraft();
    const row = screen.getByTestId('setup-row');
    expect(row.querySelector('[data-testid="agent-picker"]')?.getAttribute('data-agent')).toBe('claude-code');
    expect(row.querySelector('[data-testid="model-picker"]')?.getAttribute('data-model')).toBe('opus');
    expect(row.querySelector('[data-testid="permission-mode-picker"]')?.getAttribute('data-mode')).toBe('auto');
    expect(row.querySelector('[data-testid="location-chip"]')?.getAttribute('data-location')).toBe('this_folder');
  });

  it('This folder creates a chat as before (no location sent), then sends', async () => {
    await mountDraft();
    await send('hello');
    expect(fake.created).toEqual([{ agentId: 'claude-code', model: undefined, machineId: null, location: 'this_folder' }]);
    expect(fake.calls).toEqual(['create', 'send ses_1 hello']);
  });

  it('Worktree creates the chat in its own worktree', async () => {
    await mountDraft();
    openMenu(screen.getByTestId('location-chip'));
    fireEvent.click(await screen.findByTestId('location-worktree'));
    await flush();
    expect(screen.getByTestId('location-chip').getAttribute('data-location')).toBe('worktree');
    await send('hello');
    expect(fake.created[0]?.location).toBe('worktree');
  });

  it('a picked mode is set after the chat is made and before the message; a refusal is shown and the retry reuses the chat', async () => {
    await mountDraft();
    openMenu(screen.getByTestId('permission-mode-picker'));
    fireEvent.click(await screen.findByTestId('permission-mode-auto'));
    await flush();
    fake.modeResult = () => Promise.reject(new Error('Claude Code on this computer doesn’t offer Auto.'));
    await send('hello');
    expect(fake.calls).toEqual(['create', 'mode auto']);
    expect(screen.getByTestId('composer-error').textContent).toContain('Auto');
    fake.modeResult = () => Promise.resolve();
    fireEvent.submit(screen.getByTestId('composer'));
    await flush();
    expect(fake.calls).toEqual(['create', 'mode auto', 'mode auto', 'send ses_1 hello']);
  });
});

describe('the Location chip', () => {
  it('in a draft, Worktree is disabled with its reason while a machine is picked', () => {
    const onChange = vi.fn();
    render(<LocationChip value="this_folder" onChange={onChange} worktreeReason={CHAT_WORKTREE_REMOTE_TEXT} />);
    openMenu(screen.getByTestId('location-chip'));
    const worktree = screen.getByTestId('location-worktree');
    expect(worktree.getAttribute('aria-disabled')).toBe('true');
    expect(worktree.textContent).toContain(CHAT_WORKTREE_REMOTE_TEXT);
    fireEvent.click(worktree);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("in a started chat, shows the place and the other one can't be chosen", () => {
    render(<LocationChip value="worktree" />);
    expect(screen.getByTestId('location-chip').textContent).toContain('Worktree');
    openMenu(screen.getByTestId('location-chip'));
    const folder = screen.getByTestId('location-this_folder');
    expect(folder.getAttribute('aria-disabled')).toBe('true');
    expect(folder.textContent).toContain(CHAT_LOCATION_FIXED_TEXT);
  });
});

describe('draftModeOptions', () => {
  it('offers what the agent declares, Skip all only in Developer mode', () => {
    const agent = { displayName: 'Codex', permissionModes: ['ask', 'auto', 'skip_all'] as const };
    expect(draftModeOptions({ ...agent, permissionModes: [...agent.permissionModes] }, true).every((option) => option.available)).toBe(true);
    const off = draftModeOptions({ ...agent, permissionModes: [...agent.permissionModes] }, false);
    expect(off.find((option) => option.mode === 'skip_all')).toMatchObject({ available: false });
    const askOnly = draftModeOptions({ displayName: 'Codex', permissionModes: ['ask'] }, true);
    expect(askOnly.find((option) => option.mode === 'auto')).toMatchObject({ available: false, reason: "Codex doesn't offer Auto." });
  });
});
