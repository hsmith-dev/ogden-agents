/**
 * Epic 8 entry 2's contracts (AD-36 to AD-39): the caps, every path field a
 * `WorkspaceRelativePath` (absolute paths refused), the views' actions, the
 * chat worktree's branch and `Session` fields, the route list, and the four
 * new events: in the unions, and strict, so a payload with a file's
 * content, output, a diff, a patch, a preview or a path is rejected.
 */
import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  API_ROUTES,
  ChangesQuery,
  ChangedFile,
  chatWorktreeBranch,
  CommitWorktreeRequest,
  CoreEvent,
  DIFF_FILES_OPEN,
  EDITOR_NONE_FOUND_TEXT,
  FileDiffQuery,
  HunkActionRequest,
  MAX_CHANGED_FILES,
  MAX_DIFF_FILE_BYTES,
  NewCoreEvent,
  OpenInEditorRequest,
  PROJECT_COMMAND_MAX_ITEMS,
  PROJECT_COMMAND_OUTPUT_MAX_BYTES,
  ProblemItem,
  ProjectCommandRunDetail,
  Session,
  SetProjectCommandsRequest,
  WORKSPACE_SEARCH_CAPPED_TEXT,
  WORKSPACE_SEARCH_MAX_FILES,
  WORKSPACE_SEARCH_MAX_MATCHES,
  WORKSPACE_SEARCH_MAX_PREVIEW,
  WORKSPACE_SEARCH_MAX_QUERY,
  WORKSPACE_SEARCH_TIMEOUT_MS,
  WorkspaceFilesQuery,
  WorkspaceSearchQuery,
  WorkspaceSearchResponse,
  agentMidTurnText,
  changesEmptyText,
  HUNK_OUTDATED_TEXT,
  ID_PREFIXES,
  TurnId,
  ProjectCommandRunId,
} from '../src/index.js';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SES = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4';
const TRN = 'trn_01J9Z3K4M5N6P7Q8R9S0T1V2W5';
const PCR = 'pcr_01J9Z3K4M5N6P7Q8R9S0T1V2W6';
const TREE = 'a'.repeat(40);
const envelope = { id: 'evt_01J9Z3K4M5N6P7Q8R9S0T1V2W7', seq: 1, at: '2026-11-01T00:00:00.000Z', workspaceId: WS };

/** The four new events, each with a valid payload. */
const EVENTS = [
  { type: 'session.turn_changes_recorded', streamId: SES, payload: { sessionId: SES, turnId: TRN, startTree: TREE, endTree: 'b'.repeat(40), files: 3, additions: 12, deletions: 3 } },
  { type: 'session.worktree_committed', streamId: SES, payload: { sessionId: SES, branch: chatWorktreeBranch(SES), revision: 'c'.repeat(40), files: 2 } },
  { type: 'workspace.project_command_started', streamId: WS, payload: { runId: PCR, commandId: 'test' } },
  { type: 'workspace.project_command_finished', streamId: WS, payload: { runId: PCR, commandId: 'test', state: 'failed', exitCode: 1, itemCount: 2 } },
] as const;

describe('workbench contracts (epic 8 entry 2)', () => {
  it('holds the caps the plan settles', () => {
    expect([WORKSPACE_SEARCH_MAX_MATCHES, WORKSPACE_SEARCH_MAX_QUERY, WORKSPACE_SEARCH_MAX_PREVIEW, WORKSPACE_SEARCH_MAX_FILES, WORKSPACE_SEARCH_TIMEOUT_MS]).toEqual([500, 200, 240, 20_000, 5_000]);
    expect([PROJECT_COMMAND_OUTPUT_MAX_BYTES, PROJECT_COMMAND_MAX_ITEMS]).toEqual([1024 * 1024, 500]);
    expect([MAX_DIFF_FILE_BYTES, MAX_CHANGED_FILES, DIFF_FILES_OPEN]).toEqual([1024 * 1024, 1000, 20]);
    expect(WORKSPACE_SEARCH_CAPPED_TEXT).toBe('Showing the first 500 matches. Narrow the search to see more.');
    expect(WorkspaceSearchQuery.safeParse({ q: 'x'.repeat(200) }).success).toBe(true);
    expect(WorkspaceSearchQuery.safeParse({ q: 'x'.repeat(201) }).success).toBe(false);
    expect(WorkspaceSearchQuery.safeParse({ q: '' }).success).toBe(false);
    expect(WorkspaceSearchQuery.parse({ q: 'a' })).toEqual({ q: 'a', mode: 'text', matchCase: false });
    expect(WorkspaceSearchResponse.safeParse({ files: [{ path: 'a.ts', matches: [{ line: 1, column: 1, preview: 'x'.repeat(241) }] }], truncated: false, limit: 500 }).success).toBe(false);
    expect(ProjectCommandRunDetail.shape.items.safeParse(Array.from({ length: 501 }, () => ({ path: 'a.ts', line: 1, message: 'x', format: 'typescript' }))).success).toBe(false);
  });

  it('refuses absolute and escaping paths in every request and answer', () => {
    for (const path of ['/etc/passwd', 'C:/x', '../x', 'a\\b', '']) {
      expect(WorkspaceFilesQuery.safeParse({ path }).success, path).toBe(false);
      expect(OpenInEditorRequest.safeParse({ path }).success, path).toBe(false);
      expect(FileDiffQuery.safeParse({ view: 'unstaged', path }).success, path).toBe(false);
      expect(HunkActionRequest.safeParse({ action: 'stage', view: 'unstaged', path }).success, path).toBe(false);
      expect(ChangedFile.safeParse({ path, change: 'changed', additions: 0, deletions: 0, binary: false, tooLarge: false }).success, path).toBe(false);
      expect(ProblemItem.safeParse({ path, line: 1, message: 'x', format: 'eslint' }).success, path).toBe(false);
    }
    expect(OpenInEditorRequest.safeParse({ path: 'src/a.ts', line: 4, editorId: 'vscode', session: SES }).success).toBe(true);
    // Strict: no stray field (an absolute path under another name) rides along.
    expect(OpenInEditorRequest.safeParse({ path: 'src/a.ts', absolutePath: '/etc/passwd' }).success).toBe(false);
    expect(OpenInEditorRequest.safeParse({ path: 'src/a.ts', editorId: 'code -g /etc' }).success).toBe(false);
  });

  it("offers each view's actions only, and This turn needs a chat", () => {
    const base = { path: 'a.ts', session: SES };
    expect(HunkActionRequest.safeParse({ ...base, action: 'revert', view: 'turn', turn: TRN }).success).toBe(true);
    expect(HunkActionRequest.safeParse({ ...base, action: 'stage', view: 'unstaged', hunkId: 'h1' }).success).toBe(true);
    expect(HunkActionRequest.safeParse({ ...base, action: 'unstage', view: 'staged' }).success).toBe(true);
    for (const [action, view] of [['stage', 'turn'], ['revert', 'staged'], ['stage', 'branch'], ['revert', 'branch'], ['unstage', 'unstaged']] as const) {
      expect(HunkActionRequest.safeParse({ ...base, action, view }).success, `${action} ${view}`).toBe(false);
    }
    expect(ChangesQuery.safeParse({ view: 'turn' }).success).toBe(false);
    expect(ChangesQuery.safeParse({ view: 'unstaged', turn: TRN }).success).toBe(false);
    expect(ChangesQuery.safeParse({ view: 'turn', session: SES, turn: TRN }).success).toBe(true);
    expect(CommitWorktreeRequest.safeParse({ message: '   ' }).success).toBe(false);
  });

  it('confirms each project command with its exact text, once per id', () => {
    const command = { id: 'test', label: 'Test', command: 'npm test', source: 'package_json', confirmedText: 'npm test' } as const;
    expect(SetProjectCommandsRequest.safeParse({ commands: [command] }).success).toBe(true);
    expect(SetProjectCommandsRequest.safeParse({ commands: [{ ...command, confirmedText: 'npm test && curl x' }] }).success).toBe(false);
    expect(SetProjectCommandsRequest.safeParse({ commands: [command, command] }).success).toBe(false);
  });

  it('gives a chat worktree its branch, and reads sessions from before it as no worktree', () => {
    expect(chatWorktreeBranch(SES)).toBe(`ogden/chat/${SES}`);
    const session = { id: SES, workspaceId: WS, kind: 'chat', state: 'idle', driver: 'ui', title: null, adapterRefs: {}, createdAt: envelope.at, updatedAt: envelope.at };
    expect(Session.parse(session)).toMatchObject({ worktreePath: null, branch: null });
    expect(Session.parse({ ...session, worktreePath: '/data/worktrees/x', branch: chatWorktreeBranch(SES) })).toMatchObject({ worktreePath: '/data/worktrees/x' });
    expect(ID_PREFIXES).toMatchObject({ turn: 'trn', projectCommandRun: 'pcr' });
    expect(TurnId.safeParse(TRN).success && ProjectCommandRunId.safeParse(PCR).success).toBe(true);
  });

  it('names the routes, codes and texts', () => {
    for (const code of ['agent_mid_turn', 'hunk_outdated', 'editor_unavailable', 'invalid_operation'] as const) expect(API_ERROR_CODES).toContain(code);
    expect(API_ROUTES.workspaceFileSearch).toBe('/api/v1/workspaces/:wsId/files/search');
    expect(API_ROUTES.workspaceChangesHunks).toBe('/api/v1/workspaces/:wsId/changes/hunks');
    expect(API_ROUTES.sessionWorktreeCommit).toBe('/api/v1/workspaces/:wsId/sessions/:sesId/worktree/commit');
    expect(API_ROUTES.editors).toBe('/api/v1/editors');
    expect(agentMidTurnText('Claude Code')).toBe('Claude Code is working in this folder. Wait for it to finish, or stop it.');
    expect(changesEmptyText('branch', 'main')).toBe('This branch matches main.');
    // No em or en dash in a UI string.
    for (const text of [HUNK_OUTDATED_TEXT, EDITOR_NONE_FOUND_TEXT, WORKSPACE_SEARCH_CAPPED_TEXT]) expect(text).not.toMatch(/[\u2013\u2014]/);
  });

  it('puts the four events in both unions, and rejects any payload carrying content, output, a diff, a patch, a preview or a path', () => {
    for (const event of EVENTS) {
      expect(NewCoreEvent.safeParse({ workspaceId: WS, ...event }).success, event.type).toBe(true);
      expect(CoreEvent.safeParse({ ...envelope, ...event }).success, event.type).toBe(true);
      for (const field of ['content', 'output', 'diff', 'patch', 'preview', 'path']) {
        const smuggled = { ...event, payload: { ...event.payload, [field]: 'src/secret.ts' } };
        expect(NewCoreEvent.safeParse({ workspaceId: WS, ...smuggled }).success, `${event.type} ${field}`).toBe(false);
        expect(CoreEvent.safeParse({ ...envelope, ...smuggled }).success, `${event.type} ${field}`).toBe(false);
      }
    }
  });
});
