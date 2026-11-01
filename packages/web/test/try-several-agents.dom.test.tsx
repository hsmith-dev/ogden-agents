// @vitest-environment happy-dom
/**
 * Try with several agents in the UI (epic 27, 27.8): the Agent chip's item
 * in a draft; the dialog (the draft's text, the agents as checkboxes with
 * readiness, one that can't start disabled with its reason, 2 to 4 picked
 * before Start, the line that each works in its own copy and the retention
 * line); a refusal stays in the dialog. Keep this one: Put away by default,
 * or Delete, which lists each copy's ignored files and names the copies
 * with changes not committed, so its one confirmation sends only their ids
 * as `discard`, and Confirm waits until every copy was read. The REST calls
 * are stand-ins.
 */
import {
  TRIAL_DELETE_DESCRIPTION,
  TRIAL_LINE_TEXT,
  TRIAL_MENU_LABEL,
  TRIAL_PUT_AWAY_DESCRIPTION,
  trialDeleteUncommittedText,
  trialKeepTitle,
  trialRetentionText,
  type ChatAgent,
  type Trial,
} from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../src/ui/tooltip';

const fake = vi.hoisted(() => ({
  started: [] as Array<{ text: string; agentIds: readonly string[] }>,
  startFails: undefined as string | undefined,
  kept: [] as unknown[],
  keepFails: undefined as { message: string; code: string } | undefined,
  dirty: new Set<string>(),
  ignored: {} as Record<string, string[]>,
  /** While set, each copy's reads wait on it. */
  reads: undefined as Promise<void> | undefined,
}));

vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children?: ReactNode }) => <a href="/settings/agents">{children}</a> }));
vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [] }) }));
vi.mock('@/worktrees/worktree-retention', async () => {
  const { useQuery } = await import('@tanstack/react-query');
  return { useWorktreeRetention: () => useQuery({ queryKey: ['worktree-retention'], queryFn: async () => ({ keep: 15 }) }) };
});
vi.mock('@/workbench/changes-api', async () => {
  const { useQuery } = await import('@tanstack/react-query');
  return {
    useChanges: (_wsId: string, target: { view: string; session?: string }) =>
      useQuery({
        queryKey: ['changes', target.view, target.session],
        queryFn: async () => {
          await fake.reads;
          return { view: target.view, files: target.view === 'unstaged' && fake.dirty.has(target.session ?? '') ? [{ path: 'notes.md', change: 'added', additions: 1, deletions: 0, binary: false, tooLarge: false }] : [], truncated: false };
        },
      }),
  };
});
vi.mock('@/chat/chat-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/chat/chat-api')>()),
  fetchCopyIgnoredFiles: async (_wsId: string, sesId: string) => ({ files: fake.ignored[sesId] ?? [], more: 0, listed: true }),
}));
vi.mock('@/trials/trials-api', async (importOriginal) => {
  const { ChatApiError } = await import('../src/chat/chat-api');
  return {
    ...(await importOriginal<typeof import('../src/trials/trials-api')>()),
    startTrial: async (_wsId: string, text: string, agentIds: readonly string[]) => {
      fake.started.push({ text, agentIds });
      if (fake.startFails !== undefined) throw new ChatApiError(fake.startFails, 409, 'invalid_operation');
      return trial;
    },
    keepTrial: async (_wsId: string, _tryId: string, body: unknown) => {
      fake.kept.push(body);
      if (fake.keepFails !== undefined) throw new ChatApiError(fake.keepFails.message, 409, fake.keepFails.code as never);
      return { ...trial, keptSessionId: SES_A };
    },
  };
});

const { TryDialog } = await import('../src/trials/try-dialog');
const { KeepDialog } = await import('../src/trials/keep-dialog');
const { AgentPicker } = await import('../src/chat/agent-picker');

const SES_A = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4' as Trial['keptSessionId'] & string;
const SES_B = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W5' as Trial['keptSessionId'] & string;
const SES_C = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W6' as Trial['keptSessionId'] & string;
const trial: Trial = {
  id: 'try_01J9Z3K4M5N6P7Q8R9S0T1V2W6' as Trial['id'],
  workspaceId: 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as Trial['workspaceId'],
  text: 'Fix the login bug',
  sessionIds: [SES_A, SES_B, SES_C],
  chats: [
    { sessionId: SES_A, agentId: 'claude-code', result: 'open' },
    { sessionId: SES_B, agentId: 'codex', result: 'open' },
    { sessionId: SES_C, agentId: 'grok', result: 'open' },
  ],
  keptSessionId: null,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const agent = (agentId: string, displayName: string, over: Partial<ChatAgent> = {}): ChatAgent => ({
  agentId,
  displayName,
  provider: 'Test',
  signInMethods: [{ kind: 'subscription', label: 'Sign in' }],
  install: 'installed',
  auth: 'signed_in',
  terminalResume: false,
  needsProjectTrust: false,
  permissionModes: ['ask'],
  ...over,
});
const AGENTS: ChatAgent[] = [
  agent('claude-code', 'Claude Code'),
  agent('codex', 'Codex'),
  agent('grok', 'Grok', { auth: 'needs_sign_in', unavailable: { code: 'agent_signed_out', reason: 'Sign in to Grok first.', action: 'sign_in' } }),
  agent('gemini', 'Gemini'),
  agent('local', 'Local model', { localOnly: 'It runs only on this computer.' }),
];

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
};

function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>{node}</TooltipProvider>
    </QueryClientProvider>,
  );
}

const box = (agentId: string) => screen.getAllByTestId('try-agent').find((each) => each.getAttribute('data-agent') === agentId)!;

beforeEach(() => {
  fake.started = [];
  fake.startFails = undefined;
  fake.kept = [];
  fake.keepFails = undefined;
  fake.dirty = new Set();
  fake.ignored = {};
  fake.reads = undefined;
});
afterEach(() => cleanup());

describe('the Agent chip (27.8)', () => {
  it('ends with Try with several agents... in a draft only', async () => {
    const tries: number[] = [];
    mount(<AgentPicker agents={AGENTS} value="claude-code" onChange={() => undefined} onTrySeveral={() => tries.push(1)} />);
    act(() => {
      fireEvent.pointerDown(screen.getByTestId('agent-picker'), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    });
    const item = await screen.findByTestId('agent-try-several');
    expect(item.textContent).toBe(TRIAL_MENU_LABEL);
    fireEvent.click(item);
    expect(tries).toEqual([1]);
    cleanup();
    mount(<AgentPicker agents={AGENTS} value="claude-code" onChange={() => undefined} />);
    act(() => {
      fireEvent.pointerDown(screen.getByTestId('agent-picker'), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    });
    await screen.findAllByTestId('agent-option');
    expect(screen.queryByTestId('agent-try-several')).toBeNull();
  });
});

describe('the Try dialog (27.8)', () => {
  it("takes the draft's text, disables an agent that can't start with its reason, says the retention line, and starts with 2 to 4", async () => {
    const started: Trial[] = [];
    mount(<TryDialog open onOpenChange={() => undefined} wsId="ws_1" agents={AGENTS} initialText="Fix the login bug" initialAgentId="claude-code" onStarted={(made) => started.push(made)} />);
    await flush();
    const dialog = screen.getByTestId('try-dialog');
    expect(dialog.textContent).toContain(TRIAL_LINE_TEXT);
    expect((screen.getByTestId('try-task') as HTMLTextAreaElement).value).toBe('Fix the login bug');
    // The draft's agent starts checked; Grok can't start a chat now and says why.
    expect(box('claude-code').getAttribute('data-state')).toBe('checked');
    expect((box('grok') as HTMLButtonElement).disabled).toBe(true);
    expect(dialog.textContent).toContain('Sign in to Grok first.');
    // A local-only agent can be tried: a trial never takes a machine.
    expect((box('local') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId('try-retention').textContent).toBe(trialRetentionText(15, 2));
    // One agent: Start does nothing.
    const start = screen.getByTestId('try-start');
    expect(start.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(start);
    await flush();
    expect(fake.started).toEqual([]);
    fireEvent.click(box('codex'));
    fireEvent.click(box('gemini'));
    fireEvent.click(box('local'));
    await flush();
    expect(screen.getByTestId('try-retention').textContent).toBe(trialRetentionText(15, 4));
    // Four picked: the fifth waits.
    expect((box('local') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(box('local'));
    await flush();
    fireEvent.click(screen.getByTestId('try-start'));
    await flush();
    expect(fake.started).toEqual([{ text: 'Fix the login bug', agentIds: ['claude-code', 'codex', 'gemini'] }]);
    expect(started).toEqual([trial]);
    expect(document.body.textContent).not.toMatch(/[–—]/);
  });

  it('keeps a refusal in the dialog, nothing started', async () => {
    fake.startFails = "Codex can't start a chat now, so nothing was started. Sign in first.";
    const started: Trial[] = [];
    mount(<TryDialog open onOpenChange={() => undefined} wsId="ws_1" agents={AGENTS} initialText="Fix it" initialAgentId="claude-code" onStarted={(made) => started.push(made)} />);
    await flush();
    fireEvent.click(box('codex'));
    await flush();
    fireEvent.click(screen.getByTestId('try-start'));
    await flush();
    expect(screen.getByTestId('try-error').textContent).toBe(fake.startFails);
    expect(started).toEqual([]);
  });
});

describe('Keep this one (27.8)', () => {
  const others = [
    { sessionId: SES_B, agentName: 'Codex', hasCopy: true, savedFiles: 0 },
    { sessionId: SES_C, agentName: 'Grok', hasCopy: true, savedFiles: 0 },
  ];

  it('puts the others away by default', async () => {
    const kept: Trial[] = [];
    mount(<KeepDialog open onOpenChange={() => undefined} wsId="ws_1" trial={trial} sessionId={SES_A} agentName="Claude Code" others={others} putAwayLoaded onKept={(done) => kept.push(done)} />);
    await flush();
    const dialog = screen.getByTestId('trial-keep-confirm');
    expect(dialog.textContent).toContain(trialKeepTitle('Claude Code'));
    expect(dialog.textContent).toContain(TRIAL_PUT_AWAY_DESCRIPTION);
    expect(screen.queryByTestId('trial-keep-copy')).toBeNull();
    fireEvent.click(screen.getByTestId('trial-keep-confirm-button'));
    await flush();
    expect(fake.kept).toEqual([{ sessionId: SES_A, others: 'put_away', discard: [] }]);
    expect(kept).toHaveLength(1);
  });

  it("deletes instead: lists each copy's ignored files, names the changed copy, and discards only then", async () => {
    fake.dirty.add(SES_C);
    fake.ignored = { [SES_B]: ['.env'], [SES_C]: ['secrets.json'] };
    mount(<KeepDialog open onOpenChange={() => undefined} wsId="ws_1" trial={trial} sessionId={SES_A} agentName="Claude Code" others={others} putAwayLoaded onKept={() => undefined} />);
    await flush();
    fireEvent.click(screen.getByTestId('trial-keep-delete'));
    await flush();
    const dialog = screen.getByTestId('trial-keep-confirm');
    expect(dialog.getAttribute('data-choice')).toBe('delete');
    expect(dialog.textContent).toContain(TRIAL_DELETE_DESCRIPTION);
    expect(screen.getAllByTestId('trial-keep-copy')).toHaveLength(2);
    expect(screen.getAllByTestId('copy-ignored-file').map((each) => each.textContent)).toEqual(['.env', 'secrets.json']);
    expect(screen.getByTestId('trial-keep-uncommitted').textContent).toBe(trialDeleteUncommittedText(['Grok']));
    fireEvent.click(screen.getByTestId('trial-keep-confirm-button'));
    await flush();
    expect(fake.kept).toEqual([{ sessionId: SES_A, others: 'delete', discard: [SES_C] }]);
  });

  it("asks again, naming every other copy, when the server finds changes the dialog didn't", async () => {
    fake.keepFails = { message: 'changed', code: 'uncommitted_changes' };
    mount(<KeepDialog open onOpenChange={() => undefined} wsId="ws_1" trial={trial} sessionId={SES_A} agentName="Claude Code" others={others} putAwayLoaded onKept={() => undefined} />);
    await flush();
    fireEvent.click(screen.getByTestId('trial-keep-delete'));
    await flush();
    expect(screen.queryByTestId('trial-keep-uncommitted')).toBeNull();
    fireEvent.click(screen.getByTestId('trial-keep-confirm-button'));
    await flush();
    expect(screen.getByTestId('trial-keep-uncommitted').textContent).toBe(trialDeleteUncommittedText(['Codex', 'Grok']));
    fake.keepFails = undefined;
    fireEvent.click(screen.getByTestId('trial-keep-confirm-button'));
    await flush();
    expect(fake.kept).toEqual([
      { sessionId: SES_A, others: 'delete', discard: [] },
      { sessionId: SES_A, others: 'delete', discard: [SES_B, SES_C] },
    ]);
  });

  it('keeps Confirm disabled for a delete until every copy was read and the put-away list is known', async () => {
    let finish = () => undefined as void;
    fake.reads = new Promise<void>((resolve) => (finish = resolve));
    fake.dirty.add(SES_B);
    const props = { onOpenChange: () => undefined, wsId: 'ws_1', trial, sessionId: SES_A, agentName: 'Claude Code', others, onKept: () => undefined };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <KeepDialog open {...props} putAwayLoaded={false} />
      </QueryClientProvider>,
    );
    await flush();
    // Putting away needs no reads.
    expect(screen.getByTestId('trial-keep-confirm-button').getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(screen.getByTestId('trial-keep-delete'));
    await flush();
    const confirm = () => screen.getByTestId('trial-keep-confirm-button');
    expect(confirm().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(confirm());
    await flush();
    expect(fake.kept).toEqual([]);
    finish();
    await flush();
    // Read, but the put-away list isn't known yet.
    expect(confirm().getAttribute('aria-disabled')).toBe('true');
    view.rerender(
      <QueryClientProvider client={client}>
        <KeepDialog open {...props} putAwayLoaded />
      </QueryClientProvider>,
    );
    await flush();
    expect(confirm().getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(confirm());
    await flush();
    // Only the copy it named.
    expect(fake.kept).toEqual([{ sessionId: SES_A, others: 'delete', discard: [SES_B] }]);
  });

  it('shows a mid-turn refusal in the dialog', async () => {
    fake.keepFails = { message: 'Keep one once the other agents have finished.', code: 'agent_mid_turn' };
    mount(<KeepDialog open onOpenChange={() => undefined} wsId="ws_1" trial={trial} sessionId={SES_A} agentName="Claude Code" others={others} putAwayLoaded onKept={() => undefined} />);
    await flush();
    fireEvent.click(screen.getByTestId('trial-keep-confirm-button'));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('Keep one once the other agents have finished.');
  });
});
