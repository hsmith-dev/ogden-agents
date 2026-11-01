// @vitest-environment happy-dom
/**
 * The Workbench's Changes panel (story 8.4): Unstaged by default without a
 * chat (no This turn), This turn with the turn picker for a chat, each
 * view's empty sentence, the files and their diffs (only the first 100
 * fetched), and Commit these changes for a chat with a worktree of its
 * own, with its message and the server's refusal. Story 8.5: each view's
 * hunk and file buttons, Revert's one confirmation, Undo, the buttons
 * disabled while an agent works in the folder, and the 409 notices. The
 * REST call is a stand-in that records every URL asked for.
 */
import {
  agentMidTurnText,
  agentStartedHereText,
  AGENT_MID_TURN_MESSAGE,
  API_ROUTES,
  apiPath,
  HUNK_CHANGED_SINCE_TEXT,
  HUNK_REVERTED_LABEL,
  PUT_BACK_TEXT,
  REVERT_CONFIRM_DESCRIPTION,
  CHANGES_NO_TURNS_TEXT,
  changesEmptyText,
  changesMoreFilesText,
  COMMIT_NOTHING_MESSAGE,
  committedText,
  type ChangedFile,
  type ChangesResponse,
  type FileDiffResponse,
} from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SES = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4';
const TURN_1 = 'trn_01J9Z3K4M5N6P7Q8R9S0T1V2W5';
const TURN_2 = 'trn_01J9Z3K4M5N6P7Q8R9S0T1V2W6';
const CHANGES = apiPath(API_ROUTES.workspaceChanges, { wsId: WS });
const FILE = apiPath(API_ROUTES.workspaceChangesFile, { wsId: WS });
const TURNS = apiPath(API_ROUTES.sessionTurns, { wsId: WS, sesId: SES });
const SESSION = apiPath(API_ROUTES.workspaceSession, { wsId: WS, sesId: SES });
const COMMIT = apiPath(API_ROUTES.sessionWorktreeCommit, { wsId: WS, sesId: SES });
const SESSIONS = apiPath(API_ROUTES.workspaceSessions, { wsId: WS });
const HUNKS = apiPath(API_ROUTES.workspaceChangesHunks, { wsId: WS });
const UNDO = apiPath(API_ROUTES.workspaceChangesHunksUndo, { wsId: WS });
const UNDO_ID = 'a'.repeat(32);

const fake = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; body?: unknown }>,
  answer: (() => undefined) as (url: string, query: URLSearchParams, body: unknown) => unknown,
  /** The project's chats as the sessions list answers them. */
  sessions: [] as unknown[],
  /** What the next hunk action and Undo answer (an error to refuse). */
  hunk: undefined as unknown,
  undo: undefined as unknown,
}));

vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [], caughtUp: true }) }));
vi.mock('@/chat/use-chat-agents', () => ({ useChatAgents: () => ({ data: { agents: [{ agentId: 'claude-code', displayName: 'Claude Code' }], defaultAgentId: 'claude-code' } }) }));

vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/http')>()),
  call: async (_auth: unknown, url: string, init: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    fake.calls.push({ url, ...(body === undefined ? {} : { body }) });
    const [base, query] = url.split('?');
    const answer = fake.answer(base!, new URLSearchParams(query ?? ''), body);
    if (answer === undefined) throw new Error(`unexpected call ${url}`);
    if (answer instanceof Error) throw answer;
    return answer;
  },
}));

const { WorkbenchChanges } = await import('../src/workbench/workbench-changes');
const { ChatApiError } = await import('../src/api/http');
const { TooltipProvider } = await import('../src/ui/tooltip');
type Navigation = import('../src/workbench/workbench-changes').ChangesNavigation;

const changed = (path: string, change: ChangedFile['change'] = 'changed'): ChangedFile => ({ path, change, additions: 1, deletions: 0, binary: false, tooLarge: false });
const diffOf = (file: ChangedFile, view: string): FileDiffResponse => ({
  view: view as FileDiffResponse['view'],
  file,
  hunks: [{ id: 'h1-0123456789', oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: [{ kind: 'add', text: `in ${file.path}`, newLine: 1 }] }],
});
const session = (worktree: boolean, state = 'idle') => ({
  session: sessionRow(worktree, state),
});
const sessionRow = (worktree: boolean, state = 'idle') => ({
  id: SES,
  workspaceId: WS,
  kind: 'chat',
  state,
  title: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  agentId: 'claude-code',
  adapterRefs: {},
  driver: 'ui',
  machineId: null,
  worktreePath: worktree ? '/data/w/chat' : null,
  branch: worktree ? `ogden/chat/${SES}` : null,
});

async function flush() {
  for (let i = 0; i < 6; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

function Harness({ initial }: { initial: { view?: Navigation['view']; session?: string; turn?: string } }) {
  const [at, setAt] = useState(initial);
  return <WorkbenchChanges wsId={WS} view={at.view} session={at.session} turn={at.turn} onNavigate={(next) => setAt({ ...at, view: next.view, turn: next.turn })} />;
}

async function mount(initial: { view?: Navigation['view']; session?: string; turn?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Harness initial={initial} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await flush();
}

/** Each view's files, by view (This turn by turn). */
function serve(files: Partial<Record<string, ChangedFile[]>>, { worktree = false, turns = [TURN_2, TURN_1], base = 'main' as string | undefined } = {}) {
  fake.answer = (base_, query, body) => {
    if (base_ === SESSION) return session(worktree);
    if (base_ === SESSIONS) return { sessions: fake.sessions };
    if (base_ === HUNKS) return fake.hunk ?? { file: null, ...((body as { action: string }).action === 'revert' ? { undo: UNDO_ID } : {}) };
    if (base_ === UNDO) return fake.undo ?? { file: null };
    if (base_ === TURNS) return { turns: turns.map((id, index) => ({ id, sessionId: SES, at: `2026-11-01T10:0${index}:00.000Z`, files: 1, additions: 1, deletions: 0 })) };
    if (base_ === COMMIT) return (body as { message: string }).message === 'Nothing' ? new ChatApiError(COMMIT_NOTHING_MESSAGE, 409, 'invalid_operation') : { revision: 'c'.repeat(40), files: 2 };
    const view = query.get('view') as ChangesResponse['view'];
    const turn = view === 'turn' ? (query.get('turn') ?? turns[0]) : undefined;
    const key = turn === undefined ? view : `turn:${turn}`;
    if (base_ === CHANGES) return { view, ...(view === 'branch' && base !== undefined ? { base } : {}), ...(turn === undefined || turns.length === 0 ? {} : { turn }), files: turns.length === 0 && view === 'turn' ? [] : (files[key] ?? []), truncated: false };
    if (base_ === FILE) {
      const file = (files[key] ?? []).find((one) => one.path === query.get('path'));
      return file === undefined ? undefined : diffOf(file, view);
    }
    return undefined;
  };
}

const viewButtons = () => [...screen.getByTestId('changes-view').querySelectorAll('[role="radio"]')].map((button) => button.textContent);
const listed = () => screen.getAllByTestId('diff-file-list-item').map((item) => item.getAttribute('data-path'));

afterEach(() => {
  cleanup();
  fake.calls = [];
  fake.sessions = [];
  fake.hunk = undefined;
  fake.undo = undefined;
});

const posted = (url: string) => fake.calls.filter((call) => call.url === url).map((call) => call.body);
const named = (name: string) => screen.getByRole('button', { name });

describe('Workbench Changes', () => {
  it('opens on Unstaged without a chat, lists the files over their diffs, and says when a view is empty', async () => {
    serve({ unstaged: [changed('new.ts', 'added'), changed('src/a.ts')] });
    await mount();
    expect(viewButtons()).toEqual(['Unstaged', 'Staged', 'Branch']);
    expect(screen.getByTestId('workbench-changes').getAttribute('data-view')).toBe('unstaged');
    expect(listed()).toEqual(['new.ts', 'src/a.ts']);
    expect(screen.getByTestId('diff-viewer').textContent).toContain('in src/a.ts');
    expect(fake.calls.filter((call) => call.url.startsWith(FILE)).map((call) => new URLSearchParams(call.url.split('?')[1]).get('path'))).toEqual(['new.ts', 'src/a.ts']);
    fireEvent.click(screen.getByRole('radio', { name: 'Staged' }));
    await flush();
    expect(screen.getByTestId('changes-empty').textContent).toBe(changesEmptyText('staged'));
    fireEvent.click(screen.getByRole('radio', { name: 'Branch' }));
    await flush();
    expect(screen.getByTestId('changes-empty').textContent).toBe('This branch matches main.');
  });

  it("opens on This turn for a chat, on the latest turn named in the picker; a named turn opens that turn", async () => {
    serve({ [`turn:${TURN_2}`]: [changed('b.txt', 'added')], [`turn:${TURN_1}`]: [changed('a.txt', 'added')] });
    await mount({ session: SES });
    expect(viewButtons()).toEqual(['This turn', 'Unstaged', 'Staged', 'Branch']);
    expect(listed()).toEqual(['b.txt']);
    const picker = screen.getByTestId('changes-turn-picker');
    expect(picker.getAttribute('data-turn')).toBe(TURN_2);
    expect(picker.textContent).toContain('Latest turn');
    // No commit for a chat without a worktree of its own.
    expect(screen.queryByTestId('worktree-commit')).toBeNull();
    await mount({ session: SES, view: 'turn', turn: TURN_1 });
    expect(screen.getAllByTestId('diff-file-list-item').at(-1)?.getAttribute('data-path')).toBe('a.txt');
    expect(fake.calls.some((call) => call.url.startsWith(FILE) && call.url.includes(`turn=${TURN_1}`))).toBe(true);
  });

  it('says so when a chat has recorded no turn yet', async () => {
    serve({}, { turns: [] });
    await mount({ session: SES });
    expect(screen.getByTestId('changes-empty').textContent).toBe(CHANGES_NO_TURNS_TEXT);
    expect(screen.queryByTestId('changes-turn-picker')).toBeNull();
  });

  it('fetches the diffs of the first 100 files only, and says the rest are not shown', async () => {
    serve({ unstaged: Array.from({ length: 101 }, (_, index) => changed(`f${String(index).padStart(3, '0')}.ts`)) });
    await mount();
    expect(listed()).toHaveLength(101);
    expect(fake.calls.filter((call) => call.url.startsWith(FILE))).toHaveLength(100);
    expect(screen.getByTestId('changes-more').textContent).toBe(changesMoreFilesText(100));
  });

  it("commits a worktree chat's changes with a message, and shows the server's refusal", async () => {
    serve({ unstaged: [changed('a.txt')] }, { worktree: true });
    await mount({ session: SES, view: 'unstaged' });
    const button = screen.getByTestId('worktree-commit-button');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('worktree-commit').textContent).toContain('Never pushed. Merge it yourself when ready.');
    fireEvent.click(button);
    await flush();
    expect(fake.calls.some((call) => call.url === COMMIT)).toBe(false);
    fireEvent.change(screen.getByTestId('worktree-commit-message'), { target: { value: '  Save the chat  ' } });
    fireEvent.click(button);
    await flush();
    expect(fake.calls.filter((call) => call.url === COMMIT)).toEqual([{ url: COMMIT, body: { message: 'Save the chat' } }]);
    expect(screen.getByTestId('worktree-committed').textContent).toBe(committedText(2));
    fireEvent.change(screen.getByTestId('worktree-commit-message'), { target: { value: 'Nothing' } });
    fireEvent.click(button);
    await flush();
    expect(screen.getByTestId('worktree-commit-error').textContent).toContain(COMMIT_NOTHING_MESSAGE);
  });
  it("offers each view's actions on every hunk and file: Stage and Revert in Unstaged, Unstage in Staged, Revert in This turn, none in Branch", async () => {
    serve({ unstaged: [changed('src/a.ts')], staged: [changed('src/a.ts')], branch: [changed('src/a.ts')], [`turn:${TURN_2}`]: [changed('src/a.ts')] });
    await mount({ session: SES, view: 'unstaged' });
    const actions = () => [...screen.getByTestId('diff-viewer').querySelectorAll('[data-testid="changes-hunk-action"], [data-testid="changes-file-action"]')].map((button) => button.getAttribute('aria-label'));
    expect(actions()).toEqual(['Stage all of a.ts', 'Revert all of a.ts', 'Stage line 1', 'Revert line 1']);
    fireEvent.click(screen.getByRole('radio', { name: 'Staged' }));
    await flush();
    expect(actions()).toEqual(['Unstage all of a.ts', 'Unstage line 1']);
    fireEvent.click(screen.getByRole('radio', { name: 'Branch' }));
    await flush();
    expect(actions()).toEqual([]);
    fireEvent.click(screen.getByRole('radio', { name: 'This turn' }));
    await flush();
    expect(actions()).toEqual(['Revert all of a.ts', 'Revert line 1']);
  });

  it('stages a hunk at once and a whole file by the ids shown, naming hunk ids only', async () => {
    serve({ unstaged: [changed('src/a.ts')] });
    await mount();
    fireEvent.click(named('Stage line 1'));
    await flush();
    fireEvent.click(named('Stage all of a.ts'));
    await flush();
    expect(posted(HUNKS)).toEqual([
      { action: 'stage', view: 'unstaged', path: 'src/a.ts', hunkId: 'h1-0123456789' },
      { action: 'stage', view: 'unstaged', path: 'src/a.ts', hunkIds: ['h1-0123456789'] },
    ]);
    // The views are read again after each.
    expect(fake.calls.filter((call) => call.url.startsWith(CHANGES)).length).toBeGreaterThan(1);
  });

  it("confirms a revert once, then says what went back with Undo, and Put back after it", async () => {
    serve({ [`turn:${TURN_2}`]: [changed('src/a.ts')] });
    await mount({ session: SES });
    fireEvent.click(named('Revert line 1'));
    await flush();
    expect(screen.getByTestId('changes-revert-confirm').textContent).toContain(REVERT_CONFIRM_DESCRIPTION);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await flush();
    expect(posted(HUNKS)).toEqual([]);
    fireEvent.click(named('Revert line 1'));
    await flush();
    fireEvent.click(screen.getByTestId('changes-revert-confirm-button'));
    await flush();
    expect(posted(HUNKS)).toEqual([{ action: 'revert', view: 'turn', path: 'src/a.ts', hunkId: 'h1-0123456789', session: SES, turn: TURN_2 }]);
    expect(screen.queryByTestId('changes-revert-confirm')).toBeNull();
    expect(screen.getByTestId('changes-reverted').textContent).toContain('Reverted line 1 in a.ts.');
    // This turn still shows the hunk (its snapshots don't change): it says Reverted, with no Revert, nor a whole-file one.
    expect(screen.getByTestId('changes-hunk-reverted').textContent).toBe(HUNK_REVERTED_LABEL);
    expect(screen.queryByRole('button', { name: 'Revert line 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revert all of a.ts' })).toBeNull();
    fireEvent.click(screen.getByTestId('changes-undo'));
    await flush();
    expect(posted(UNDO)).toEqual([{ undo: UNDO_ID, path: 'src/a.ts', view: 'turn', session: SES }]);
    expect(screen.getByTestId('changes-reverted').textContent).toBe(PUT_BACK_TEXT);
    expect(screen.queryByTestId('changes-undo')).toBeNull();
    // Put back: Revert is offered again.
    expect(screen.queryByTestId('changes-hunk-reverted')).toBeNull();
    expect(named('Revert line 1')).toBeDefined();
  });

  it('disables every action while an agent works in the folder, naming it; a chat in another worktree does not', async () => {
    serve({ unstaged: [changed('src/a.ts')] });
    fake.sessions = [{ ...sessionRow(false, 'working'), id: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W9' }];
    await mount();
    expect(screen.getByTestId('changes-busy').textContent).toBe(agentMidTurnText('Claude Code'));
    expect(named('Stage line 1').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(named('Stage line 1'));
    fireEvent.click(named('Revert all of a.ts'));
    await flush();
    expect(posted(HUNKS)).toEqual([]);
    expect(screen.queryByTestId('changes-revert-confirm')).toBeNull();
    cleanup();
    fake.sessions = [{ ...sessionRow(true, 'working'), id: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W9' }];
    await mount();
    expect(screen.queryByTestId('changes-busy')).toBeNull();
    expect(named('Stage line 1').getAttribute('aria-disabled')).toBeNull();
  });

  it('says an agent started here on a 409 agent_mid_turn, and the view\'s sentence on a 409 hunk_outdated, reading the diffs again', async () => {
    serve({ unstaged: [changed('src/a.ts')] });
    await mount();
    fake.hunk = new ChatApiError(AGENT_MID_TURN_MESSAGE, 409, 'agent_mid_turn');
    fireEvent.click(named('Stage line 1'));
    await flush();
    expect(screen.getByTestId('changes-action-error').textContent).toContain(agentStartedHereText('An agent'));
    fake.hunk = new ChatApiError(HUNK_CHANGED_SINCE_TEXT, 409, 'hunk_outdated');
    const reads = fake.calls.filter((call) => call.url.startsWith(FILE)).length;
    fireEvent.click(named('Stage line 1'));
    await flush();
    expect(screen.getByTestId('changes-action-error').textContent).toContain(HUNK_CHANGED_SINCE_TEXT);
    expect(fake.calls.filter((call) => call.url.startsWith(FILE)).length).toBeGreaterThan(reads);
  });
});
