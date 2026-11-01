/**
 * Epic 8 entry 2's core contracts (AD-36 to AD-39): `createSession`'s
 * worktree fields; a chat's worktree as the files root (a foreign or
 * unknown chat is not found); search present only with a port that can
 * search, clamped to the cap; the Changes use-case's views, turns, the
 * mid-turn and outdated refusals and the worktree commit; and Open in
 * editor's path refusals before the launcher is asked anything.
 */
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  chatWorktreeBranch,
  COMMIT_NOTHING_MESSAGE,
  HUNK_CHANGED_SINCE_TEXT,
  HUNK_OUTDATED_TEXT,
  HUNK_UNSUPPORTED_MESSAGE,
  UNDO_OUTDATED_TEXT,
  type ChangedFile, type DiffHunk, type EditorInfo, type SessionId, type WorkspaceId, type WorkspaceSearchFile } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  AgentMidTurnError,
  EditorUnavailableError,
  HunkOutdatedError,
  InvalidOperationError,
  newId,
  NotFoundError,
  NotImplementedError,
  PathProtectedError,
  serializedByRepo,
  ValidationError,
  type Core,
  type EditorLauncherPort,
  type VcsChangesTarget,
  type VcsFolder,
  type VcsWorkingTreePort,
  type WorkspaceFilesPort,
  type WorkspaceRootKind,
} from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

const TREE_A = 'a'.repeat(40);
const TREE_B = 'b'.repeat(40);
const UNDO = 'd'.repeat(32);

/** A files port that records each call with its root and kind; `search` and `locate` only when asked. */
function filesPort({ search, locate = true }: { search?: WorkspaceSearchFile[]; locate?: boolean } = {}) {
  const calls: Array<{ op: string; root: string; kind: WorkspaceRootKind | undefined; path: string }> = [];
  const port: WorkspaceFilesPort = {
    list: async (root, path, kind) => {
      calls.push({ op: 'list', root, kind, path });
      return { path, entries: [], truncated: false };
    },
    read: async (root, path, kind) => {
      calls.push({ op: 'read', root, kind, path });
      return { kind: 'text', path, content: 'x', size: 1, masked: false };
    },
  };
  if (search !== undefined) {
    port.search = async (root, query, kind) => {
      calls.push({ op: 'search', root, kind, path: query.q });
      return { files: search, truncated: false };
    };
  }
  if (locate) {
    port.locate = async (root, path, kind) => {
      calls.push({ op: 'locate', root, kind, path });
      return { realPath: join(root, path) };
    };
  }
  return { port, calls };
}

const file = (path: string): ChangedFile => ({ path, change: 'changed', additions: 1, deletions: 1, binary: false, tooLarge: false });
const hunk = (id: string): DiffHunk => ({ id, oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [{ kind: 'remove', text: 'a', oldLine: 1 }, { kind: 'add', text: 'b', newLine: 1 }] });

/** A working-tree port that records its calls; `outdated` hunks answer so. */
function vcsPort({ files = [file('src/a.ts')], commit = { revision: 'c'.repeat(40), files: 2 } }: { files?: ChangedFile[]; commit?: { revision: string; files: number } | 'nothing' } = {}) {
  const calls: Array<{ op: string; root: string; worktree?: VcsFolder['worktree']; target?: VcsChangesTarget; detail?: string }> = [];
  const outdated = new Set<string>();
  const unsupported = new Set<string>();
  const at = (folder: VcsFolder) => ({ root: folder.path, ...(folder.worktree === undefined ? {} : { worktree: folder.worktree }) });
  const port: VcsWorkingTreePort = {
    changedFiles: async (folder, target) => {
      calls.push({ op: 'changedFiles', ...at(folder), target });
      return { base: 'main', files, truncated: false };
    },
    fileDiff: async (folder, target, path) => {
      calls.push({ op: 'fileDiff', ...at(folder), target, detail: path });
      return path === 'src/a.ts' ? { file: file(path), hunks: [hunk('h1')] } : undefined;
    },
    applyHunk: async (folder, input) => {
      calls.push({ op: 'applyHunk', ...at(folder), target: input.target, detail: `${input.action} ${input.path} ${input.hunkId ?? input.hunkIds?.join(',') ?? '*'}` });
      if (unsupported.has(input.path)) return { outcome: 'unsupported' };
      if (input.hunkId !== undefined && outdated.has(input.hunkId)) return { outcome: 'outdated' };
      return input.action === 'revert' ? { outcome: 'applied', undo: UNDO } : { outcome: 'applied' };
    },
    undoRevert: async (folder, input) => {
      calls.push({ op: 'undoRevert', ...at(folder), detail: `${input.undo} ${input.path}` });
      if (input.undo !== UNDO) return { outcome: 'not_found' };
      return outdated.has(input.undo) ? { outcome: 'outdated' } : { outcome: 'applied' };
    },
    snapshot: async (folder) => {
      calls.push({ op: 'snapshot', ...at(folder) });
      return TREE_A;
    },
    commitAll: async (folder, message) => {
      calls.push({ op: 'commitAll', ...at(folder), detail: message });
      return commit;
    },
  };
  return { port, calls, outdated, unsupported };
}

function project(core: Core) {
  const repo = tempDir();
  const workspace = core.entities.ensureWorkspace(repo);
  return { repo: realpathSync.native(repo), workspace };
}

function worktreeChat(core: Core, workspaceId: WorkspaceId) {
  const id = newId('ses');
  const worktreePath = join(tempDir(), 'worktree');
  return core.entities.createSession({ workspaceId, kind: 'chat', id, worktreePath, branch: chatWorktreeBranch(id) });
}

describe('createSession worktree fields (AD-8 CAP-33 note)', () => {
  it('stores a worktree and its branch, on session.created; others read null', () => {
    const core = openTestCore();
    const { workspace } = project(core);
    const plain = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
    expect(plain).toMatchObject({ worktreePath: null, branch: null });
    const chat = worktreeChat(core, workspace.id);
    expect(chat.branch).toBe(`ogden/chat/${chat.id}`);
    expect(core.entities.getSession(chat.id)).toEqual(chat);
    const created = core.events.readAfter(0).find((event) => event.type === 'session.created' && event.payload.session.id === chat.id);
    expect(created?.type === 'session.created' && created.payload.session.worktreePath).toBe(chat.worktreePath);
  });

  it('refuses a wrong branch, a relative path, one without the other, or a taken id', () => {
    const core = openTestCore();
    const { workspace } = project(core);
    const id = newId('ses');
    const at = join(tempDir(), 'w');
    for (const input of [
      { id, worktreePath: at, branch: 'ogden/chat/ses_other' },
      { id, worktreePath: at, branch: chatWorktreeBranch(newId('ses')) },
      { id, worktreePath: 'relative/w', branch: chatWorktreeBranch(id) },
      { id, worktreePath: at },
      { id, branch: chatWorktreeBranch(id) },
      { id: 'run_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as SessionId },
    ]) {
      expect(() => core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', ...input }), JSON.stringify(input)).toThrow(ValidationError);
    }
    core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', id });
    expect(() => core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', id })).toThrow(ValidationError);
  });
});

describe('workspace files with a session root and search (epic 8 entry 2)', () => {
  it("roots list, read, search and locate at the chat's worktree, and a plain chat at the project", async () => {
    const { port, calls } = filesPort({ search: [] });
    const core = openTestCore(undefined, undefined, { workspaceFilesPort: port });
    const { repo, workspace } = project(core);
    const chat = worktreeChat(core, workspace.id);
    const plain = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
    const files = core.workspaceFiles!;
    await files.list(workspace.id, '', chat.id);
    await files.read(workspace.id, 'a.ts', chat.id);
    await files.search!(workspace.id, { q: 'x', session: chat.id });
    await files.locate!(workspace.id, 'a.ts', chat.id);
    await files.read(workspace.id, 'a.ts', plain.id);
    expect(calls).toEqual([
      { op: 'list', root: chat.worktreePath, kind: 'chat_worktree', path: '' },
      { op: 'read', root: chat.worktreePath, kind: 'chat_worktree', path: 'a.ts' },
      { op: 'search', root: chat.worktreePath, kind: 'chat_worktree', path: 'x' },
      { op: 'locate', root: chat.worktreePath, kind: 'chat_worktree', path: 'a.ts' },
      { op: 'read', root: repo, kind: undefined, path: 'a.ts' },
    ]);
  });

  it('answers a session of another project, or an unknown one, as not found, asking the port nothing', async () => {
    const { port, calls } = filesPort({ search: [] });
    const core = openTestCore(undefined, undefined, { workspaceFilesPort: port });
    const { workspace } = project(core);
    const other = project(core).workspace;
    const foreign = core.entities.createSession({ workspaceId: other.id, kind: 'chat' });
    for (const session of [foreign.id, newId('ses'), 'nope']) {
      await expect(core.workspaceFiles!.list(workspace.id, '', session), session).rejects.toBeInstanceOf(NotFoundError);
      await expect(core.workspaceFiles!.read(workspace.id, 'a.ts', session), session).rejects.toBeInstanceOf(NotFoundError);
      await expect(core.workspaceFiles!.search!(workspace.id, { q: 'x', session }), session).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(calls).toEqual([]);
  });

  it('has no search or locate without the port having one', () => {
    const core = openTestCore(undefined, undefined, { workspaceFilesPort: filesPort({ locate: false }).port });
    expect(core.workspaceFiles!.search).toBeUndefined();
    expect(core.workspaceFiles!.locate).toBeUndefined();
  });

  it('clamps 600 matches to 500 with truncated, cuts previews, and refuses a bad query', async () => {
    const many: WorkspaceSearchFile[] = Array.from({ length: 6 }, (_, f) => ({ path: `f${f}.ts`, matches: Array.from({ length: 100 }, (_, i) => ({ line: i + 1, column: 1, preview: 'x'.repeat(300) })) }));
    const core = openTestCore(undefined, undefined, { workspaceFilesPort: filesPort({ search: many }).port });
    const { workspace } = project(core);
    const found = await core.workspaceFiles!.search!(workspace.id, { q: 'x' });
    expect(found.truncated).toBe(true);
    expect(found.limit).toBe(500);
    expect(found.files.reduce((sum, one) => sum + one.matches.length, 0)).toBe(500);
    expect(found.files.every((one) => one.matches.every((match) => match.preview.length === 240))).toBe(true);
    // A match past column 240 stays in its cut preview; its column still counts in the whole line.
    const far = openTestCore(undefined, undefined, { workspaceFilesPort: filesPort({ search: [{ path: 'long.ts', matches: [{ line: 1, column: 300, preview: `${'x'.repeat(299)}needle${'y'.repeat(200)}` }] }] }).port });
    const farWorkspace = project(far).workspace;
    const [match] = (await far.workspaceFiles!.search!(farWorkspace.id, { q: 'needle' })).files[0]!.matches;
    expect(match!.column).toBe(300);
    expect(match!.preview).toHaveLength(240);
    expect(match!.preview).toContain('needle');
    for (const query of [{ q: '' }, { q: 'x'.repeat(201) }, { q: 'x', mode: 'regex' }, { q: 'x', extra: 1 }]) {
      await expect(core.workspaceFiles!.search!(workspace.id, query), JSON.stringify(query)).rejects.toBeInstanceOf(ValidationError);
    }
  });
});

describe('workspace changes (AD-37)', () => {
  it('is undefined without a working-tree port', () => {
    expect(openTestCore().workspaceChanges).toBeUndefined();
  });

  it("lists a view at the chat's folder, and This turn from the chat's recorded turns", async () => {
    const vcs = vcsPort();
    const core = openTestCore(undefined, undefined, { vcsWorkingTreePort: vcs.port });
    const { repo, workspace } = project(core);
    const chat = worktreeChat(core, workspace.id);
    expect(await core.workspaceChanges!.changes(workspace.id, { view: 'branch' })).toEqual({ view: 'branch', base: 'main', files: [file('src/a.ts')], truncated: false });
    expect(vcs.calls.at(-1)).toEqual({ op: 'changedFiles', root: repo, target: { view: 'branch' } });
    // No turn recorded yet: nothing to show, the port isn't asked.
    expect(await core.workspaceChanges!.changes(workspace.id, { view: 'turn', session: chat.id })).toEqual({ view: 'turn', files: [], truncated: false });
    const turnId = newId('trn');
    core.sessionEvents.appendSessionEvent(chat.id, { type: 'session.turn_changes_recorded', payload: { sessionId: chat.id, turnId, startTree: TREE_A, endTree: TREE_B, files: 1, additions: 1, deletions: 1 } });
    expect(await core.workspaceChanges!.changes(workspace.id, { view: 'turn', session: chat.id })).toMatchObject({ view: 'turn', turn: turnId, files: [file('src/a.ts')] });
    expect(vcs.calls.at(-1)).toEqual({ op: 'changedFiles', root: chat.worktreePath, worktree: { repoPath: repo, branch: chat.branch }, target: { view: 'turn', startTree: TREE_A, endTree: TREE_B } });
    await expect(core.workspaceChanges!.changes(workspace.id, { view: 'turn', session: chat.id, turn: newId('trn') })).rejects.toBeInstanceOf(NotFoundError);
    expect((await core.workspaceChanges!.turns(workspace.id, chat.id)).turns).toEqual([expect.objectContaining({ id: turnId, sessionId: chat.id, files: 1 })]);
  });

  it('refuses a refused path, a foreign chat and an unknown file', async () => {
    const vcs = vcsPort();
    const core = openTestCore(undefined, undefined, { vcsWorkingTreePort: vcs.port });
    const { workspace } = project(core);
    const foreign = core.entities.createSession({ workspaceId: project(core).workspace.id, kind: 'chat' });
    await expect(core.workspaceChanges!.fileDiff(workspace.id, { view: 'unstaged', path: '.git/config' })).rejects.toBeInstanceOf(PathProtectedError);
    await expect(core.workspaceChanges!.fileDiff(workspace.id, { view: 'unstaged', path: '../x' })).rejects.toBeInstanceOf(ValidationError);
    await expect(core.workspaceChanges!.changes(workspace.id, { view: 'unstaged', session: foreign.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(core.workspaceChanges!.fileDiff(workspace.id, { view: 'unstaged', path: 'gone.ts' })).rejects.toBeInstanceOf(NotFoundError);
    expect(await core.workspaceChanges!.fileDiff(workspace.id, { view: 'unstaged', path: 'src/a.ts' })).toEqual({ view: 'unstaged', file: file('src/a.ts'), hunks: [hunk('h1')] });
  });

  it('refuses a hunk action while a chat in the same folder works or waits, and applies it otherwise', async () => {
    const vcs = vcsPort();
    const core = openTestCore(undefined, undefined, { vcsWorkingTreePort: vcs.port });
    const { workspace } = project(core);
    const here = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
    const elsewhere = worktreeChat(core, workspace.id);
    const action = { action: 'stage', view: 'unstaged', path: 'src/a.ts', hunkId: 'h1' };
    for (const state of ['working', 'waiting'] as const) {
      core.entities.setSessionState(here.id, state);
      await expect(core.workspaceChanges!.hunk(workspace.id, action)).rejects.toBeInstanceOf(AgentMidTurnError);
    }
    expect(vcs.calls.filter((call) => call.op === 'applyHunk')).toEqual([]);
    // A chat working in its own worktree doesn't block the project folder.
    core.entities.setSessionState(here.id, 'idle');
    core.entities.setSessionState(elsewhere.id, 'working');
    expect(await core.workspaceChanges!.hunk(workspace.id, action)).toEqual({ file: file('src/a.ts') });
    // Nor does a build (in its run's worktree) or a chat on a remote machine.
    for (const input of [{ kind: 'build' as const }, { kind: 'chat' as const, machineId: newId('mach') }]) {
      const other = core.entities.createSession({ workspaceId: workspace.id, ...input });
      core.entities.setSessionState(other.id, 'working');
      expect(await core.workspaceChanges!.hunk(workspace.id, action), input.kind).toEqual({ file: file('src/a.ts') });
      core.entities.setSessionState(other.id, 'idle');
    }
    // But it blocks its own worktree.
    await expect(core.workspaceChanges!.hunk(workspace.id, { ...action, session: elsewhere.id })).rejects.toBeInstanceOf(AgentMidTurnError);
    vcs.outdated.add('h1');
    await expect(core.workspaceChanges!.hunk(workspace.id, action)).rejects.toBeInstanceOf(HunkOutdatedError);
    await expect(core.workspaceChanges!.hunk(workspace.id, { ...action, view: 'branch' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('checks for an agent inside the repo lock, so one that starts while the action waits refuses it', async () => {
    const vcs = vcsPort();
    const core = openTestCore(undefined, undefined, { vcsWorkingTreePort: vcs.port });
    const { workspace } = project(core);
    const chat = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
    let release!: () => void;
    const held = serializedByRepo(workspace.realPath ?? workspace.path, () => new Promise<void>((resolve) => (release = resolve)));
    const action = core.workspaceChanges!.hunk(workspace.id, { action: 'stage', view: 'unstaged', path: 'src/a.ts', hunkId: 'h1' });
    const undo = core.workspaceChanges!.undo(workspace.id, { undo: UNDO, path: 'src/a.ts', view: 'unstaged' });
    // Idle when asked; working by the time the lock is free.
    core.entities.setSessionState(chat.id, 'working');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(vcs.calls.filter((call) => call.op === 'applyHunk' || call.op === 'undoRevert')).toEqual([]);
    release();
    await held;
    await expect(action).rejects.toBeInstanceOf(AgentMidTurnError);
    await expect(undo).rejects.toBeInstanceOf(AgentMidTurnError);
    expect(vcs.calls.filter((call) => call.op === 'applyHunk' || call.op === 'undoRevert')).toEqual([]);
    // And an action waits for the lock: nothing is asked of the port while another holds it.
    core.entities.setSessionState(chat.id, 'idle');
    const again = serializedByRepo(workspace.realPath ?? workspace.path, () => new Promise<void>((resolve) => (release = resolve)));
    const waiting = core.workspaceChanges!.hunk(workspace.id, { action: 'stage', view: 'unstaged', path: 'src/a.ts', hunkId: 'h1' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(vcs.calls.filter((call) => call.op === 'applyHunk')).toEqual([]);
    release();
    await again;
    expect(await waiting).toEqual({ file: file('src/a.ts') });
  });

  it("says each view's outdated sentence, refuses an unsupported file, and passes a whole file's ids", async () => {
    const vcs = vcsPort();
    const core = openTestCore(undefined, undefined, { vcsWorkingTreePort: vcs.port });
    const { workspace } = project(core);
    const chat = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
    const turnId = newId('trn');
    core.sessionEvents.appendSessionEvent(chat.id, { type: 'session.turn_changes_recorded', payload: { sessionId: chat.id, turnId, startTree: TREE_A, endTree: TREE_B, files: 1, additions: 1, deletions: 1 } });
    vcs.outdated.add('h1');
    await expect(core.workspaceChanges!.hunk(workspace.id, { action: 'revert', view: 'turn', session: chat.id, path: 'src/a.ts', hunkId: 'h1' })).rejects.toThrow(new HunkOutdatedError(HUNK_OUTDATED_TEXT));
    await expect(core.workspaceChanges!.hunk(workspace.id, { action: 'stage', view: 'unstaged', path: 'src/a.ts', hunkId: 'h1' })).rejects.toThrow(new HunkOutdatedError(HUNK_CHANGED_SINCE_TEXT));
    vcs.unsupported.add('src/a.ts');
    await expect(core.workspaceChanges!.hunk(workspace.id, { action: 'stage', view: 'unstaged', path: 'src/a.ts', hunkId: 'h2' })).rejects.toThrow(new InvalidOperationError(HUNK_UNSUPPORTED_MESSAGE));
    vcs.unsupported.clear();
    // Neither a hunk nor the file's ids: refused before the port is asked.
    const asked = vcs.calls.length;
    await expect(core.workspaceChanges!.hunk(workspace.id, { action: 'stage', view: 'unstaged', path: 'src/a.ts' })).rejects.toBeInstanceOf(ValidationError);
    await expect(core.workspaceChanges!.hunk(workspace.id, { action: 'stage', view: 'unstaged', path: 'src/a.ts', hunkId: 'h2', hunkIds: ['h2'] })).rejects.toBeInstanceOf(ValidationError);
    expect(vcs.calls).toHaveLength(asked);
    expect(await core.workspaceChanges!.hunk(workspace.id, { action: 'unstage', view: 'staged', path: 'src/a.ts', hunkIds: ['h2', 'h3'] })).toEqual({ file: file('src/a.ts') });
    expect(vcs.calls.find((call) => call.op === 'applyHunk' && call.detail === 'unstage src/a.ts h2,h3')).toBeDefined();
  });

  it("a chat working in another worktree blocks neither a hunk action nor an undo on the project; in its own worktree it blocks both", async () => {
    const vcs = vcsPort();
    const core = openTestCore(undefined, undefined, { vcsWorkingTreePort: vcs.port });
    const { workspace } = project(core);
    const chat = worktreeChat(core, workspace.id);
    core.entities.setSessionState(chat.id, 'working');
    const action = { action: 'revert', view: 'unstaged', path: 'src/a.ts', hunkId: 'h1' };
    const undo = { undo: UNDO, path: 'src/a.ts', view: 'unstaged' };
    expect(await core.workspaceChanges!.hunk(workspace.id, action)).toEqual({ file: file('src/a.ts'), undo: UNDO });
    expect(await core.workspaceChanges!.undo(workspace.id, undo)).toEqual({ file: file('src/a.ts') });
    const asked = vcs.calls.length;
    await expect(core.workspaceChanges!.hunk(workspace.id, { ...action, session: chat.id })).rejects.toBeInstanceOf(AgentMidTurnError);
    await expect(core.workspaceChanges!.undo(workspace.id, { ...undo, session: chat.id })).rejects.toBeInstanceOf(AgentMidTurnError);
    expect(vcs.calls).toHaveLength(asked);
  });

  it("answers a revert's undo, and undoes it in the same folder; a gone undo is not found, an edited file outdated", async () => {
    const vcs = vcsPort();
    const core = openTestCore(undefined, undefined, { vcsWorkingTreePort: vcs.port });
    const { workspace } = project(core);
    expect(await core.workspaceChanges!.hunk(workspace.id, { action: 'revert', view: 'unstaged', path: 'src/a.ts', hunkId: 'h2' })).toEqual({ file: file('src/a.ts'), undo: UNDO });
    expect(await core.workspaceChanges!.undo(workspace.id, { undo: UNDO, path: 'src/a.ts', view: 'unstaged' })).toEqual({ file: file('src/a.ts') });
    await expect(core.workspaceChanges!.undo(workspace.id, { undo: 'e'.repeat(32), path: 'src/a.ts', view: 'unstaged' })).rejects.toBeInstanceOf(NotFoundError);
    vcs.outdated.add(UNDO);
    await expect(core.workspaceChanges!.undo(workspace.id, { undo: UNDO, path: 'src/a.ts', view: 'unstaged' })).rejects.toThrow(new HunkOutdatedError(UNDO_OUTDATED_TEXT));
    for (const body of [{ undo: 'nope', path: 'src/a.ts', view: 'unstaged' }, { undo: UNDO, path: 'src/a.ts', view: 'staged' }, { undo: UNDO, path: 'src/a.ts', view: 'turn' }]) {
      await expect(core.workspaceChanges!.undo(workspace.id, body), JSON.stringify(body)).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(core.workspaceChanges!.undo(workspace.id, { undo: UNDO, path: '.git/config', view: 'unstaged' })).rejects.toBeInstanceOf(PathProtectedError);
    delete (vcs.port as { undoRevert?: unknown }).undoRevert;
    await expect(core.workspaceChanges!.undo(workspace.id, { undo: UNDO, path: 'src/a.ts', view: 'unstaged' })).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("commits a worktree chat's changes, appending counts only; refuses a plain chat and mid-turn", async () => {
    const vcs = vcsPort();
    const core = openTestCore(undefined, undefined, { vcsWorkingTreePort: vcs.port });
    const { workspace } = project(core);
    const plain = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
    const chat = worktreeChat(core, workspace.id);
    await expect(core.workspaceChanges!.commit(workspace.id, plain.id, { message: 'Fix it' })).rejects.toBeInstanceOf(InvalidOperationError);
    await expect(core.workspaceChanges!.commit(workspace.id, chat.id, { message: '' })).rejects.toBeInstanceOf(ValidationError);
    core.entities.setSessionState(chat.id, 'working');
    await expect(core.workspaceChanges!.commit(workspace.id, chat.id, { message: 'Fix it' })).rejects.toBeInstanceOf(AgentMidTurnError);
    core.entities.setSessionState(chat.id, 'idle');
    expect(vcs.calls.filter((call) => call.op === 'commitAll')).toEqual([]);
    expect(await core.workspaceChanges!.commit(workspace.id, chat.id, { message: 'Fix it' })).toEqual({ revision: 'c'.repeat(40), files: 2 });
    expect(vcs.calls.at(-1)).toEqual({ op: 'commitAll', root: chat.worktreePath, worktree: { repoPath: realpathSync.native(workspace.realPath ?? workspace.path), branch: chat.branch }, detail: 'Fix it' });
    const committed = core.events.readAfter(0).filter((event) => event.type === 'session.worktree_committed');
    expect(committed.map((event) => event.payload)).toEqual([{ sessionId: chat.id, branch: chat.branch, revision: 'c'.repeat(40), files: 2 }]);
    expect(JSON.stringify(committed)).not.toContain('Fix it');
  });
});

describe('workspace changes on the git port (story 8.4)', () => {
  it("answers only paths Ogden shows: a refused or malformed path the port names is left out", async () => {
    const files = ['src/a.ts', '.git/config', 'a/.ssh/id_rsa', '../up.txt', '/etc/passwd', 'a\\b'].map(file);
    const vcs = vcsPort({ files: [...files, { ...file('moved.ts'), change: 'renamed', previousPath: '.git/HEAD' }] });
    const core = openTestCore(undefined, undefined, { vcsWorkingTreePort: vcs.port });
    const { workspace } = project(core);
    expect((await core.workspaceChanges!.changes(workspace.id, { view: 'unstaged' })).files.map((one) => one.path)).toEqual(['src/a.ts']);
  });

  it('answers a hunk action 501 when the port has none, asking nothing', async () => {
    const vcs = vcsPort();
    delete (vcs.port as { applyHunk?: unknown }).applyHunk;
    const core = openTestCore(undefined, undefined, { vcsWorkingTreePort: vcs.port });
    const { workspace } = project(core);
    await expect(core.workspaceChanges!.hunk(workspace.id, { action: 'stage', view: 'unstaged', path: 'src/a.ts' })).rejects.toBeInstanceOf(NotImplementedError);
    expect(vcs.calls).toEqual([]);
  });

  it('refuses a commit with nothing to commit, appending nothing', async () => {
    const vcs = vcsPort({ commit: 'nothing' });
    const core = openTestCore(undefined, undefined, { vcsWorkingTreePort: vcs.port });
    const { workspace } = project(core);
    const chat = worktreeChat(core, workspace.id);
    await expect(core.workspaceChanges!.commit(workspace.id, chat.id, { message: 'Fix it' })).rejects.toThrow(COMMIT_NOTHING_MESSAGE);
    expect(core.events.readAfter(0).some((event) => event.type === 'session.worktree_committed')).toBe(false);
  });
});

describe('open in editor (AD-39)', () => {
  function launcher(editors: EditorInfo[] = [{ id: 'vscode', name: 'VS Code' }]) {
    const opens: unknown[][] = [];
    const port: EditorLauncherPort = {
      list: async () => editors,
      open: async (...args) => {
        opens.push(args);
        return 'opened';
      },
    };
    return { port, opens };
  }

  it('refuses a malformed or protected path before the launcher is asked anything', async () => {
    const editor = launcher();
    const files = filesPort();
    const core = openTestCore(undefined, undefined, { workspaceFilesPort: files.port, editorLauncherPort: editor.port });
    const { workspace } = project(core);
    for (const path of ['../x', '/etc/passwd', 'a\\b']) await expect(core.editorLaunch!.open(workspace.id, { path }), path).rejects.toBeInstanceOf(ValidationError);
    for (const path of ['.git/config', '.ssh/id_rsa']) await expect(core.editorLaunch!.open(workspace.id, { path }), path).rejects.toBeInstanceOf(PathProtectedError);
    // An unknown project is not found, whatever the path, as for the files routes.
    await expect(core.editorLaunch!.open('ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3', { path: '../x' })).rejects.toBeInstanceOf(NotFoundError);
    expect(editor.opens).toEqual([]);
    expect(files.calls).toEqual([]);
  });

  it('opens a located file at its line in the default or named editor; none found is unavailable', async () => {
    const editor = launcher([{ id: 'vscode', name: 'VS Code' }, { id: 'zed', name: 'Zed' }]);
    const core = openTestCore(undefined, undefined, { workspaceFilesPort: filesPort().port, editorLauncherPort: editor.port });
    const { repo, workspace } = project(core);
    expect(await core.editorLaunch!.editors()).toEqual({ editors: [{ id: 'vscode', name: 'VS Code' }, { id: 'zed', name: 'Zed' }], defaultEditorId: 'vscode' });
    expect(await core.editorLaunch!.open(workspace.id, { path: 'src/a.ts', line: 42 })).toEqual({ editorId: 'vscode', editorName: 'VS Code' });
    expect(await core.editorLaunch!.open(workspace.id, { path: 'src/a.ts', line: 1, column: 2, editorId: 'zed' })).toEqual({ editorId: 'zed', editorName: 'Zed' });
    expect(editor.opens).toEqual([
      ['vscode', join(repo, 'src/a.ts'), 42, undefined],
      ['zed', join(repo, 'src/a.ts'), 1, 2],
    ]);
    await expect(core.editorLaunch!.open(workspace.id, { path: 'src/a.ts', editorId: 'emacs' })).rejects.toBeInstanceOf(EditorUnavailableError);
    const none = openTestCore(undefined, undefined, { workspaceFilesPort: filesPort().port, editorLauncherPort: launcher([]).port });
    const other = project(none).workspace;
    await expect(none.editorLaunch!.open(other.id, { path: 'src/a.ts' })).rejects.toBeInstanceOf(EditorUnavailableError);
  });

  it('is undefined without a launcher, or a files port that can locate', () => {
    expect(openTestCore(undefined, undefined, { workspaceFilesPort: filesPort().port }).editorLaunch).toBeUndefined();
    expect(openTestCore(undefined, undefined, { workspaceFilesPort: filesPort({ locate: false }).port, editorLauncherPort: launcher().port }).editorLaunch).toBeUndefined();
  });
});
