// @vitest-environment happy-dom
/**
 * A port per worktree in the UI (epic 27, 27.7): beside the branch badge,
 * "Port 41000" with its tooltip and the setup run's state with Show output
 * (the run's masked output, fetched only once asked for); nothing for a
 * chat in this folder or with neither. Workspace settings' Worktree setup:
 * the trust prompt in a project not trusted yet, the field with Save and
 * Remove through `PUT …/project-commands`, every other command kept. The
 * REST calls are a stand-in that records every URL asked for.
 */
import { API_ROUTES, apiPath, WORKTREE_SETUP_UNTRUSTED_TEXT, type ProjectCommand, type SessionLocation } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SES = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4';
const RUN = 'pcr_01J9Z3K4M5N6P7Q8R9S0T1V2W6';
const LOCATION = apiPath(API_ROUTES.sessionLocation, { wsId: WS, sesId: SES });
const COMMANDS = apiPath(API_ROUTES.workspaceProjectCommands, { wsId: WS });
const RUN_DETAIL = apiPath(API_ROUTES.workspaceProjectCommandRun, { wsId: WS, runId: RUN });

const fake = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; method: string; body?: unknown }>,
  answer: (() => undefined) as (url: string, method: string, body: unknown) => unknown,
  trusted: false,
}));

vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/http')>()),
  call: async (_auth: unknown, url: string, init: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const method = init?.method ?? 'GET';
    fake.calls.push({ url, method, ...(body === undefined ? {} : { body }) });
    const answer = fake.answer(url, method, body);
    if (answer === undefined) throw new Error(`unexpected call ${method} ${url}`);
    if (answer instanceof Error) throw answer;
    return answer;
  },
}));
vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [] }) }));
vi.mock('@/workspaces/workspace-settings-api', () => ({
  trustProjectScripts: async () => {
    fake.trusted = true;
    return { bmadScriptsTrusted: true };
  },
}));

const { WorktreeCopyStatus } = await import('../src/worktrees/worktree-copy-status');
const { WorktreeSetupSection, withSetup } = await import('../src/worktrees/worktree-setup-section');
const { ChatApiError } = await import('../src/api/http');
const { TooltipProvider } = await import('../src/ui/tooltip');

async function flush() {
  for (let i = 0; i < 10; i++) await act(async () => {});
}

function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  );
}

const worktree = (overrides: Partial<Extract<SessionLocation, { kind: 'worktree' }>> = {}): SessionLocation => ({ kind: 'worktree', branch: `ogden/chat/${SES}`, port: 41_000, setup: null, putAway: false, ...overrides });
const command = (overrides: Partial<ProjectCommand>): ProjectCommand => ({ id: 'test', label: 'Tests', command: 'node test.js', source: 'settings', confirmed: true, lastRun: null, ...overrides });

afterEach(() => {
  cleanup();
  fake.calls = [];
  fake.trusted = false;
});

describe("beside a worktree chat's branch badge (27.7)", () => {
  it('shows the port with its tooltip text', async () => {
    fake.answer = (url) => (url === LOCATION ? { location: worktree() } : undefined);
    mount(<WorktreeCopyStatus wsId={WS} sesId={SES} />);
    const port = await screen.findByTestId('worktree-port');
    expect(port.textContent).toBe('Port 41000');
    // Reachable by keyboard, so the tooltip opens on focus too.
    expect(port.getAttribute('tabindex')).toBe('0');
    expect(screen.queryByTestId('worktree-setup')).toBeNull();
  });

  it("shows the setup run's state, and its output only once Show output is pressed", async () => {
    fake.answer = (url) => {
      if (url === LOCATION) return { location: worktree({ setup: { runId: RUN, state: 'failed' } }) };
      if (url === RUN_DETAIL) return { run: { id: RUN, commandId: 'setup', state: 'failed', exitCode: 1, itemCount: 0, startedAt: '2026-11-01T00:00:00.000Z', finishedAt: '2026-11-01T00:00:01.000Z' }, output: 'npm ERR! [redacted]\n', truncated: false, items: [], parsed: false };
      return undefined;
    };
    mount(<WorktreeCopyStatus wsId={WS} sesId={SES} />);
    expect((await screen.findByTestId('worktree-setup')).textContent).toBe('Setup failed');
    await flush();
    expect(fake.calls.some((call) => call.url === RUN_DETAIL)).toBe(false);
    fireEvent.click(screen.getByTestId('worktree-setup-output'));
    expect((await screen.findByTestId('worktree-setup-text')).textContent).toBe('npm ERR! [redacted]\n');
    expect(fake.calls.some((call) => call.url === RUN_DETAIL)).toBe(true);
  });

  it('shows nothing for a chat in this folder, a copy with no port and no setup, or a put-away copy', async () => {
    for (const location of [{ kind: 'this_folder' }, worktree({ port: null }), worktree({ putAway: true })]) {
      fake.answer = (url) => (url === LOCATION ? { location } : undefined);
      mount(<WorktreeCopyStatus wsId={WS} sesId={SES} />);
      await flush();
      expect(screen.queryByTestId('worktree-copy-status')).toBeNull();
      cleanup();
    }
  });
});

describe("Workspace settings' Worktree setup (27.7)", () => {
  it('keeps every other command when the setup is set or removed', () => {
    const data = { declared: [command({}), command({ id: 'setup', label: 'Worktree setup', command: 'node old.js' })], offered: [] };
    expect(withSetup(data, 'node setup.js')).toEqual([
      { id: 'test', label: 'Tests', command: 'node test.js', source: 'settings', confirmedText: 'node test.js' },
      { id: 'setup', label: 'Worktree setup', command: 'node setup.js', source: 'settings', confirmedText: 'node setup.js' },
    ]);
    expect(withSetup(data, null)).toEqual([{ id: 'test', label: 'Tests', command: 'node test.js', source: 'settings', confirmedText: 'node test.js' }]);
  });

  it('asks for trust in a project not trusted yet, and shows the field once trusted', async () => {
    fake.answer = (url, method) => {
      if (url !== COMMANDS || method !== 'GET') return undefined;
      return fake.trusted ? { declared: [], offered: [] } : new ChatApiError('Trust this project first.', 409, 'scripts_not_trusted');
    };
    mount(<WorktreeSetupSection wsId={WS} />);
    expect((await screen.findByTestId('worktree-setup-trust')).textContent).toContain(WORKTREE_SETUP_UNTRUSTED_TEXT);
    expect(screen.queryByTestId('worktree-setup-input')).toBeNull();
    fireEvent.click(screen.getByTestId('worktree-setup-trust-allow'));
    expect(await screen.findByTestId('worktree-setup-input')).toBeTruthy();
    expect(screen.queryByTestId('worktree-setup-remove')).toBeNull();
  });

  it('saves the setup command beside the others, then removes it', async () => {
    let declared: ProjectCommand[] = [command({})];
    fake.answer = (url, method, body) => {
      if (url !== COMMANDS) return undefined;
      if (method === 'PUT') {
        const { commands } = body as { commands: Array<{ id: string; label: string; command: string }> };
        declared = commands.map((one) => command({ id: one.id, label: one.label, command: one.command }));
      }
      return { declared, offered: [] };
    };
    mount(<WorktreeSetupSection wsId={WS} />);
    fireEvent.change(await screen.findByTestId('worktree-setup-input'), { target: { value: '  node setup.js ' } });
    fireEvent.click(screen.getByTestId('worktree-setup-save'));
    await flush();
    expect(fake.calls.filter((call) => call.method === 'PUT').at(-1)?.body).toEqual({
      commands: [
        { id: 'test', label: 'Tests', command: 'node test.js', source: 'settings', confirmedText: 'node test.js' },
        { id: 'setup', label: 'Worktree setup', command: 'node setup.js', source: 'settings', confirmedText: 'node setup.js' },
      ],
    });
    expect(screen.getByTestId('worktree-setup-status').textContent).toBe('Saved. It runs in each new worktree copy.');
    expect((screen.getByTestId('worktree-setup-input') as HTMLInputElement).value).toBe('node setup.js');

    fireEvent.click(screen.getByTestId('worktree-setup-remove'));
    await flush();
    expect(fake.calls.filter((call) => call.method === 'PUT').at(-1)?.body).toEqual({ commands: [{ id: 'test', label: 'Tests', command: 'node test.js', source: 'settings', confirmedText: 'node test.js' }] });
    expect(screen.getByTestId('worktree-setup-status').textContent).toBe('Removed. New copies run nothing.');
    expect((screen.getByTestId('worktree-setup-input') as HTMLInputElement).value).toBe('');
  });

  it("shows the server's refusal of a command that needs a shell", async () => {
    fake.answer = (url, method) => {
      if (url !== COMMANDS) return undefined;
      if (method === 'PUT') return new ChatApiError("Ogden runs one program with its arguments, without a shell, so it can't use &&.", 400, 'validation_failed');
      return { declared: [], offered: [] };
    };
    mount(<WorktreeSetupSection wsId={WS} />);
    fireEvent.change(await screen.findByTestId('worktree-setup-input'), { target: { value: 'npm i && npm run build' } });
    fireEvent.click(screen.getByTestId('worktree-setup-save'));
    await flush();
    expect(screen.getByTestId('worktree-setup-status').getAttribute('role')).toBe('alert');
    expect(screen.getByTestId('worktree-setup-status').textContent).toContain('without a shell');
  });
});
