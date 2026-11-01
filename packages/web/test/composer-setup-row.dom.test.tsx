// @vitest-environment happy-dom
/**
 * The composer's setup row in the new-chat draft (epic 27, 27.1): Agent,
 * Model, Mode and Location chips on the project's defaults; a send creates
 * the chat with the row's place, sets a picked mode through the set-mode
 * route, then sends; a refused mode is shown and the retry reuses that
 * chat. Location lists the confirmed remote machines with their live state
 * (27.5): a machine starts the chat there, one the agent can't take or that
 * can't be reached is disabled with why, and Add a remote machine goes to
 * Settings. The Location chip on its own: a started chat's place fixed. The
 * router, the REST calls and the remote machines are stand-ins.
 */
import { CHAT_LOCATION_FIXED_TEXT, CHAT_MACHINE_UNREACHABLE_TEXT, type ChatAgentsResponse, type RemoteMachine, type Session } from '@ogden-agents/shared';
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

const LOCAL_ONLY = 'The Local model runs only on this computer, so its endpoint and key never leave it.';
const BOX = 'mach_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as const;
const BENCH = 'mach_01J9Z3K4M5N6P7Q8R9S0T1V2W4' as const;
const machine = (id: RemoteMachine['id'], label: string, over: Partial<RemoteMachine> = {}): RemoteMachine => ({
  id,
  host: `${label}.local`,
  port: 22,
  username: 'ada',
  label,
  hostKeyFingerprint: 'fp-pinned',
  publicKey: null,
  hostKeyConfirmed: true,
  createdAt: '2026-11-01T00:00:00.000Z',
  ...over,
});

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
  search: {} as Record<string, unknown>,
  machines: [] as unknown[],
  /** What each machine's host-key probe answers, by id: a fingerprint, or a throw. */
  probe: {} as Record<string, string | Error>,
  probes: [] as string[],
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ wsId: 'ws_1' }),
  useSearch: () => fake.search,
  useNavigate: () => async (to: unknown) => void fake.navigations.push(to),
  Link: ({ children, to, ...rest }: { children: ReactNode; to?: string } & Record<string, unknown>) => (
    <a href="/" data-to={to} {...rest}>
      {children}
    </a>
  ),
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
vi.mock('@/remote-machines/remote-machines-api', () => ({
  useRemoteMachines: () => ({ data: fake.machines }),
  checkRemoteMachineHostKey: async (id: string) => {
    fake.probes.push(id);
    const answer = fake.probe[id] ?? 'fp-pinned';
    if (answer instanceof Error) throw answer;
    return { fingerprint: answer };
  },
}));
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
          { agentId: 'local', displayName: 'Local model', provider: 'You', signInMethods: [], install: 'installed', auth: 'signed_in', terminalResume: false, needsProjectTrust: false, noAccount: true, localOnly: LOCAL_ONLY, permissionModes: ['ask'] },
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
const { MACHINE_HOST_KEY_CHANGED_REASON } = await import('../src/remote-machines/machine-checks');
const { LocationChip } = await import('../src/chat/setup-row');
const { draftModeOptions } = await import('../src/permissions/permission-mode-picker');

beforeEach(() => {
  fake.calls = [];
  fake.created = [];
  fake.modeResult = () => Promise.resolve();
  fake.settings = {};
  fake.navigations = [];
  fake.next = 0;
  fake.search = {};
  fake.machines = [];
  fake.probe = {};
  fake.probes = [];
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
  it("in a started chat, shows the place and the other one can't be chosen", () => {
    render(<LocationChip value="worktree" />);
    expect(screen.getByTestId('location-chip').textContent).toContain('Worktree');
    openMenu(screen.getByTestId('location-chip'));
    const folder = screen.getByTestId('location-this_folder');
    expect(folder.getAttribute('aria-disabled')).toBe('true');
    expect(folder.textContent).toContain(CHAT_LOCATION_FIXED_TEXT);
  });
});

describe('a remote machine from the Location chip (27.5)', () => {
  const machineItem = (id: string) => screen.getAllByTestId('location-machine').find((node) => node.getAttribute('data-machine') === id)!;
  const pickAgent = async (agentId: string) => {
    openMenu(screen.getByTestId('agent-picker'));
    fireEvent.click((await screen.findAllByTestId('agent-option')).find((node) => node.getAttribute('data-agent') === agentId)!);
    await flush();
  };

  it('with no confirmed machine lists This folder, Worktree and Add a remote machine', async () => {
    fake.machines = [machine(BOX, 'build-box', { hostKeyConfirmed: false, hostKeyFingerprint: null })];
    await mountDraft();
    openMenu(screen.getByTestId('location-chip'));
    await flush();
    expect(screen.queryAllByTestId('location-machine')).toEqual([]);
    expect(screen.getByTestId('location-this_folder')).toBeTruthy();
    expect(screen.getByTestId('location-worktree')).toBeTruthy();
    const add = screen.getByTestId('location-add-machine');
    expect(add.textContent).toBe('Add a remote machine');
    expect(add.getAttribute('data-to')).toBe('/settings/remote-machines');
    // An unconfirmed machine is never probed either.
    expect(fake.probes).toEqual([]);
  });

  it('lists each confirmed machine with its live state once the menu opens; one that can\'t connect or whose key changed is disabled with why', async () => {
    const OTHER = 'mach_01J9Z3K4M5N6P7Q8R9S0T1V2W5' as const;
    fake.machines = [machine(BOX, 'build-box'), machine(BENCH, 'bench'), machine(OTHER, 'other')];
    fake.probe = { [BENCH]: new Error('unreachable'), [OTHER]: 'fp-changed' };
    await mountDraft();
    expect(fake.probes).toEqual([]);
    openMenu(screen.getByTestId('location-chip'));
    await flush();
    expect(fake.probes.sort()).toEqual([BOX, BENCH, OTHER].sort());
    expect(machineItem(BOX).textContent).toContain('build-box, connected');
    expect(machineItem(BOX).textContent).toContain('ada@build-box.local');
    expect(machineItem(BOX).getAttribute('aria-disabled')).toBeNull();
    expect(machineItem(BENCH).textContent).toContain("bench, can't connect");
    expect(machineItem(BENCH).textContent).toContain(CHAT_MACHINE_UNREACHABLE_TEXT);
    expect(machineItem(BENCH).getAttribute('aria-disabled')).toBe('true');
    expect(machineItem(OTHER).textContent).toContain('other, host key changed');
    expect(machineItem(OTHER).textContent).toContain(MACHINE_HOST_KEY_CHANGED_REASON);
    expect(machineItem(OTHER).getAttribute('aria-disabled')).toBe('true');
    // Disabled: picking it changes nothing.
    fireEvent.click(machineItem(BENCH));
    await flush();
    expect(screen.getByTestId('location-chip').getAttribute('data-machine')).toBeNull();
  });

  it('a picked machine starts the chat there, in its own folder, never a worktree', async () => {
    fake.machines = [machine(BOX, 'build-box')];
    await mountDraft();
    openMenu(screen.getByTestId('location-chip'));
    await flush();
    fireEvent.click(machineItem(BOX));
    await flush();
    const chip = screen.getByTestId('location-chip');
    expect(chip.getAttribute('data-machine')).toBe(BOX);
    expect(chip.textContent).toContain('build-box');
    // The draft holds one place: Worktree after the machine puts the chat back on this computer.
    openMenu(chip);
    fireEvent.click(await screen.findByTestId('location-worktree'));
    await flush();
    expect(screen.getByTestId('location-chip').getAttribute('data-machine')).toBeNull();
    openMenu(screen.getByTestId('location-chip'));
    await flush();
    fireEvent.click(machineItem(BOX));
    await flush();
    await send('hello');
    expect(fake.created).toEqual([{ agentId: 'claude-code', model: undefined, machineId: BOX, location: 'this_folder' }]);
    // The machine picker left the draft.
    expect(screen.queryByTestId('machine-picker')).toBeNull();
  });

  it("with an agent tied to this computer, every machine is disabled with that agent's reason", async () => {
    fake.machines = [machine(BOX, 'build-box')];
    await mountDraft();
    await pickAgent('local');
    openMenu(screen.getByTestId('location-chip'));
    await flush();
    expect(machineItem(BOX).getAttribute('aria-disabled')).toBe('true');
    expect(machineItem(BOX).textContent).toContain(LOCAL_ONLY);
  });

  it("an agent tied to this computer picked after the machine: the status line says its reason, and the send still goes to the server", async () => {
    fake.machines = [machine(BOX, 'build-box')];
    await mountDraft();
    openMenu(screen.getByTestId('location-chip'));
    await flush();
    fireEvent.click(machineItem(BOX));
    await flush();
    expect(screen.queryByTestId('agent-local-only')).toBeNull();
    await pickAgent('local');
    expect(screen.getByTestId('agent-local-only').textContent).toBe(LOCAL_ONLY);
    expect(screen.getByRole('textbox').getAttribute('aria-describedby')).toContain('agent-unavailable');
    await send('hello');
    expect(fake.created).toEqual([{ agentId: 'local', model: undefined, machineId: BOX, location: 'this_folder' }]);
  });

  it('opened with ?machine= starts on that machine; an unknown or unconfirmed one falls back to This folder', async () => {
    fake.machines = [machine(BOX, 'build-box'), machine(BENCH, 'bench', { hostKeyConfirmed: false })];
    fake.search = { machine: BOX };
    await mountDraft();
    expect(screen.getByTestId('location-chip').getAttribute('data-machine')).toBe(BOX);
    cleanup();
    fake.search = { machine: BENCH };
    await mountDraft();
    expect(screen.getByTestId('location-chip').getAttribute('data-machine')).toBeNull();
    await send('hello');
    expect(fake.created.at(-1)).toMatchObject({ machineId: null, location: 'this_folder' });
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
