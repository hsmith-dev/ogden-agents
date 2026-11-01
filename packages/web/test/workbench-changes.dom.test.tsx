// @vitest-environment happy-dom
/**
 * The Workbench's Changes panel (story 8.4): Unstaged by default without a
 * chat (no This turn), This turn with the turn picker for a chat, each
 * view's empty sentence, the files and their diffs (only the first 100
 * fetched), and Commit these changes for a chat with a worktree of its
 * own, with its message and the server's refusal. Story 8.5: each view's
 * hunk and file buttons, Revert's one confirmation, Undo, the buttons
 * disabled while an agent works in the folder, and the 409 notices. Story
 * 8.6: line comments, their bar, Send to (This turn's chat, or the picker)
 * writing the chat's composer draft, Outdated, the cap and a reload. The
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
  COMMENT_OUTDATED_LABEL,
  COMMENTS_FULL_TEXT,
  MAX_LINE_COMMENTS,
  type ChangedFile,
  type ChangesResponse,
  type FileDiffResponse,
} from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  navigate: (() => undefined) as (to: unknown) => void,
  /** A file's hunks, when not the one-line default. */
  hunks: {} as Record<string, unknown>,
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => fake.navigate }));

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
const { chatDraftKey, newChatDraftKey, readDraft, writeDraft } = await import('../src/chat/drafts');
const { lineCommentsKey, readLineComments, writeLineComments } = await import('../src/workbench/line-comments');
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
      if (file === undefined) return undefined;
      const diff = diffOf(file, view);
      return fake.hunks[file.path] === undefined ? diff : { ...diff, hunks: fake.hunks[file.path] };
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
  fake.hunks = {};
  fake.navigate = () => undefined;
  localStorage.clear();
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

describe('line comments in Changes (story 8.6)', () => {
  const comment = (button: HTMLElement, text: string, shift = false) => {
    fireEvent.click(button, { shiftKey: shift });
    fireEvent.change(screen.getByTestId('diff-comment-input'), { target: { value: text } });
    fireEvent.click(screen.getByTestId('diff-comment-save'));
  };
  const commentButton = (path: string, name: string) => within(screen.getByRole('table', { name: `Changes in ${path}` })).getByRole('button', { name });

  it("collects comments on two files and Send to Claude Code appends one message to This turn's chat draft, then opens it", async () => {
    serve({ [`turn:${TURN_2}`]: [changed('a.ts'), changed('b.css')] });
    fake.sessions = [sessionRow(false)];
    fake.hunks['b.css'] = [
      {
        id: 'h1-0123456789',
        oldStart: 70,
        oldLines: 0,
        newStart: 71,
        newLines: 4,
        lines: [71, 72, 73, 74].map((line) => ({ kind: 'add', text: `rule ${line}`, newLine: line })),
      },
    ];
    const opened: unknown[] = [];
    fake.navigate = (to) => void opened.push(to);
    writeDraft(chatDraftKey(WS, SES), 'hello');
    await mount({ session: SES });
    comment(commentButton('a.ts', 'Comment on line 1'), 'Round after summing.');
    expect(screen.getByTestId('diff-comment').textContent).toContain('Round after summing.');
    // A range: line 71 focused (its button clicked), then Shift with line 74's.
    fireEvent.click(commentButton('b.css', 'Comment on line 71'));
    fireEvent.click(screen.getByTestId('diff-comment-cancel'));
    comment(commentButton('b.css', 'Comment on line 74'), 'Use formatPrice.', true);
    expect(screen.getByTestId('comments-bar-title').textContent).toBe('Comments to send (2)');
    expect(screen.getAllByTestId('comments-bar-item').map((item) => item.textContent)).toEqual([expect.stringContaining('a.ts:1'), expect.stringContaining('b.css:71-74')]);
    // Nothing went to the server.
    expect(fake.calls.some((call) => call.body !== undefined)).toBe(false);
    const send = screen.getByTestId('comments-send');
    expect(send.textContent).toBe('Send to Claude Code');
    fireEvent.click(send);
    await flush();
    expect(readDraft(chatDraftKey(WS, SES))).toBe(
      ['hello', 'Please address these review comments:', 'a.ts:1\n> + in a.ts\nRound after summing.', 'b.css:71-74\n> + rule 71\n> + rule 72\n> + rule 73\n> + rule 74\nUse formatPrice.'].join('\n\n'),
    );
    expect(opened).toEqual([{ to: '/w/$wsId/s/$sesId', params: { wsId: WS, sesId: SES } }]);
    expect(screen.queryByTestId('comments-bar')).toBeNull();
  });

  it('while the agent works, Send to still only fills the composer (its own rule queues the send)', async () => {
    serve({ [`turn:${TURN_2}`]: [changed('a.ts')] });
    fake.sessions = [sessionRow(false, 'working')];
    const opened: unknown[] = [];
    fake.navigate = (to) => void opened.push(to);
    await mount({ session: SES });
    comment(commentButton('a.ts', 'Comment on line 1'), 'Later.');
    fireEvent.keyDown(screen.getByTestId('comments-bar'), { key: 'Enter', metaKey: true });
    await flush();
    expect(readDraft(chatDraftKey(WS, SES))).toContain('a.ts:1');
    expect(opened).toHaveLength(1);
    expect(fake.calls.some((call) => call.body !== undefined)).toBe(false);
  });

  it('C after j moves makes a range from where they started (Flow 6: lines 71 to 74)', async () => {
    serve({ unstaged: [changed('b.css')] });
    fake.hunks['b.css'] = [{ id: 'h1-0123456789', oldStart: 70, oldLines: 0, newStart: 71, newLines: 4, lines: [71, 72, 73, 74].map((line) => ({ kind: 'add', text: `rule ${line}`, newLine: line })) }];
    await mount();
    const row = commentButton('b.css', 'Comment on line 71').closest<HTMLElement>('tr')!;
    act(() => row.focus());
    for (let step = 0; step < 3; step++) fireEvent.keyDown(document.activeElement!, { key: 'j' });
    await flush();
    expect((document.activeElement as HTMLElement).getAttribute('data-line-new')).toBe('74');
    fireEvent.keyDown(document.activeElement!, { key: 'C', shiftKey: true });
    expect(screen.getByTestId('diff-comment-field').textContent).toContain('Your comment on lines 71 to 74');
  });

  it('with no chats, Send to offers New chat only', async () => {
    serve({ unstaged: [changed('a.ts')] });
    fake.sessions = [];
    await mount();
    comment(commentButton('a.ts', 'Comment on line 1'), 'Fix.');
    fireEvent.keyDown(screen.getByTestId('comments-send-to'), { key: 'Enter' });
    await flush();
    expect(screen.queryAllByTestId('comments-send-to-chat')).toHaveLength(0);
    expect(screen.getByTestId('comments-send-to-new').textContent).toContain('New chat');
  });

  it('removing the last comment from the bar leaves no send', async () => {
    serve({ unstaged: [changed('a.ts')] });
    await mount();
    comment(commentButton('a.ts', 'Comment on line 1'), 'Fix.');
    fireEvent.click(screen.getByTestId('comments-bar-remove'));
    expect(screen.queryByTestId('comments-bar')).toBeNull();
    expect(screen.queryByTestId('comments-send-to')).toBeNull();
  });

  it('quotes a removed line by its old number', async () => {
    serve({ unstaged: [changed('a.ts')] });
    fake.hunks['a.ts'] = [{ id: 'h1-0123456789', oldStart: 40, oldLines: 1, newStart: 39, newLines: 0, lines: [{ kind: 'remove', text: 'gone();', oldLine: 40 }] }];
    fake.sessions = [];
    await mount();
    comment(commentButton('a.ts', 'Comment on removed line 40'), 'Keep this.');
    expect(screen.getByTestId('comments-bar-item').textContent).toContain('a.ts:40 (removed line)');
    fireEvent.keyDown(screen.getByTestId('comments-send-to'), { key: 'Enter' });
    await flush();
    fireEvent.click(screen.getByTestId('comments-send-to-new'));
    await flush();
    expect(readDraft(newChatDraftKey(WS))).toContain('a.ts:40 (removed line)\n> - gone();\nKeep this.');
  });

  it('from Unstaged, Send to lists the chats, latest first, and New chat', async () => {
    serve({ unstaged: [changed('a.ts')] });
    const other = { ...sessionRow(false), id: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2X9', title: 'Older chat', createdAt: '2026-10-31T00:00:00.000Z' };
    fake.sessions = [other, { ...sessionRow(false), title: 'Latest chat' }];
    const opened: unknown[] = [];
    fake.navigate = (to) => void opened.push(to);
    await mount();
    comment(commentButton('a.ts', 'Comment on line 1'), 'Fix.');
    fireEvent.keyDown(screen.getByTestId('comments-send-to'), { key: 'Enter' });
    await flush();
    expect(screen.getAllByTestId('comments-send-to-chat').map((item) => item.textContent)).toEqual([expect.stringContaining('Latest chat'), expect.stringContaining('Older chat')]);
    expect(screen.getByTestId('comments-send-to-new').textContent).toContain('New chat');
    fireEvent.click(screen.getAllByTestId('comments-send-to-chat')[1]!);
    await flush();
    expect(readDraft(chatDraftKey(WS, other.id))).toContain('a.ts:1');
    expect(opened).toEqual([{ to: '/w/$wsId/s/$sesId', params: { wsId: WS, sesId: other.id } }]);
  });

  it('keeps comments over a reload, says Outdated for a line that changed, and refuses the 51st', async () => {
    serve({ unstaged: [changed('a.ts')] });
    await mount();
    comment(commentButton('a.ts', 'Comment on line 1'), 'Still here.');
    cleanup();
    await mount();
    expect(screen.getByTestId('diff-comment').textContent).toContain('Still here.');
    expect(screen.getByTestId('comments-bar-item').getAttribute('data-outdated')).toBe('false');
    cleanup();
    fake.hunks['a.ts'] = [{ id: 'h1-0123456789', oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: [{ kind: 'add', text: 'changed since', newLine: 1 }] }];
    await mount();
    expect(screen.queryByTestId('diff-comment')).toBeNull();
    expect(screen.getByTestId('comments-bar-outdated').textContent).toBe(COMMENT_OUTDATED_LABEL);
    cleanup();
    const stored = readLineComments(lineCommentsKey(WS, 'project'));
    writeLineComments(lineCommentsKey(WS, 'project'), Array.from({ length: MAX_LINE_COMMENTS }, (_, index) => ({ ...stored[0]!, id: `c${index}` })));
    await mount();
    fireEvent.click(commentButton('a.ts', 'Comment on line 1'));
    expect(screen.queryByTestId('diff-comment-field')).toBeNull();
    expect(screen.getByTestId('comments-bar-status').textContent).toBe(COMMENTS_FULL_TEXT);
  });

  it('masks a secret in the stored quote and the message', async () => {
    serve({ unstaged: [changed('.env')] });
    fake.hunks['.env'] = [{ id: 'h1-0123456789', oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: [{ kind: 'add', text: 'TOKEN=abc', newLine: 1 }] }];
    await mount();
    comment(commentButton('.env', 'Comment on line 1'), 'Rename it.');
    expect(JSON.stringify({ ...localStorage })).not.toContain('abc');
    expect(readLineComments(lineCommentsKey(WS, 'project'))[0]!.quote).toEqual(['+ TOKEN=[redacted]']);
    fireEvent.keyDown(screen.getByTestId('comments-send-to'), { key: 'Enter' });
    await flush();
    fireEvent.click(screen.getByTestId('comments-send-to-new'));
    await flush();
    const handed = readDraft(newChatDraftKey(WS));
    expect(handed).toContain('.env:1\n> + TOKEN=[redacted]\nRename it.');
    expect(handed).not.toContain('abc');
  });
});
