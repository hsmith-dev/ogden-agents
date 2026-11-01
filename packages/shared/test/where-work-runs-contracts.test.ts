/**
 * Epic 27 entry 2's contracts (CAP-35): a chat's Location, the hand-off,
 * the retention setting (1 to 100, default 15), put-away copies, the port
 * range, trials (2 to 4 different agents), the new ids, codes and routes,
 * the EXPERIENCE.md words (no em or en dash), and the eight new events: in
 * both unions, and strict, so a payload with a path, a file's content or
 * the task's text is rejected.
 */
import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  API_ROUTES,
  CoreEvent,
  CreateTrialRequest,
  HANDOFF_CONFLICT_MESSAGE,
  HANDOFF_FAILED_TEXT,
  HANDOFF_FOLDER_BUSY_TEXT,
  handOffWorktreeConflictText,
  HANDOFF_TO_THIS_FOLDER_DESCRIPTION,
  HANDOFF_TO_WORKTREE_DESCRIPTION,
  HandOffRequest,
  ID_PREFIXES,
  KeepTrialRequest,
  NewCoreEvent,
  PutAwayWorktree,
  RESTORE_FAILED_MESSAGE,
  RESTORE_PATH_TAKEN_TEXT,
  SessionLocation,
  TRIAL_AGENTS_MAX,
  TRIAL_AGENTS_MIN,
  TRIAL_LINE_TEXT,
  TRIAL_TEXT_MAX,
  Trial,
  TrialId,
  WORKTREE_PORT_RANGE,
  WORKTREE_PUT_AWAY_TEXT,
  WORKTREE_RESTORED_TEXT,
  WORKTREE_RETENTION_DEFAULT,
  WorktreeRetentionSetting,
  WorktreeSnapshotId,
  chatOfWorktreeBranch,
  chatWorktreeBranch,
  restoredChatWorktreeBranch,
  RestoreWorktreeResponse,
  worktreeRestoredText,
  handOffConflictText,
  handOffDividerText,
  handOffMidTurnText,
  restoreBranchMissingText,
  trialKeepConfirmText,
  trialTooltipText,
  worktreePortText,
  worktreeRetentionLabel,
} from '../src/index.js';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SES = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4';
const SES2 = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W5';
const TRY = 'try_01J9Z3K4M5N6P7Q8R9S0T1V2W6';
const WSN = 'wsn_01J9Z3K4M5N6P7Q8R9S0T1V2W7';
const AT = '2026-11-01T00:00:00.000Z';
const envelope = { id: 'evt_01J9Z3K4M5N6P7Q8R9S0T1V2W8', seq: 1, at: AT };

/** The eight new events, each with a valid payload. */
const EVENTS = [
  { type: 'session.location_changed', workspaceId: WS, streamId: SES, payload: { sessionId: SES, location: 'worktree', previous: 'this_folder', branch: chatWorktreeBranch(SES), files: 2, resumes: true } },
  { type: 'session.worktree_put_away', workspaceId: WS, streamId: SES, payload: { sessionId: SES, snapshotId: WSN, cause: 'retention', files: 4 } },
  { type: 'session.worktree_restored', workspaceId: WS, streamId: SES, payload: { sessionId: SES, snapshotId: WSN } },
  { type: 'session.port_assigned', workspaceId: WS, streamId: SES, payload: { sessionId: SES, port: 41_000 } },
  { type: 'session.port_released', workspaceId: WS, streamId: SES, payload: { sessionId: SES, port: 41_000 } },
  { type: 'settings.worktree_retention_changed', workspaceId: null, streamId: 'settings', payload: { keep: 20, previous: 15 } },
  { type: 'workspace.trial_started', workspaceId: WS, streamId: WS, payload: { trialId: TRY, sessionIds: [SES, SES2] } },
  { type: 'workspace.trial_kept', workspaceId: WS, streamId: WS, payload: { trialId: TRY, sessionId: SES, putAway: [SES2] } },
] as const;

describe('where work runs contracts (epic 27 entry 2)', () => {
  it("describes a chat's place without a path", () => {
    expect(SessionLocation.safeParse({ kind: 'this_folder' }).success).toBe(true);
    expect(SessionLocation.safeParse({ kind: 'worktree', branch: chatWorktreeBranch(SES), port: null, putAway: false }).success).toBe(true);
    expect(SessionLocation.safeParse({ kind: 'worktree', branch: chatWorktreeBranch(SES), port: 3011, putAway: true }).success).toBe(true);
    expect(SessionLocation.safeParse({ kind: 'remote', machineId: 'mach_01J9Z3K4M5N6P7Q8R9S0T1V2W9' }).success).toBe(true);
    expect(SessionLocation.safeParse({ kind: 'worktree', branch: 'b', port: 0, putAway: false }).success).toBe(false);
    expect(SessionLocation.safeParse({ kind: 'worktree', branch: 'b', port: null, putAway: false, path: '/data/w' }).success).toBe(false);
    expect(SessionLocation.safeParse({ kind: 'this_folder', path: '/repo' }).success).toBe(false);
    expect(HandOffRequest.safeParse({ to: 'worktree' }).success && HandOffRequest.safeParse({ to: 'this_folder' }).success).toBe(true);
    expect(HandOffRequest.safeParse({ to: 'remote' }).success).toBe(false);
    expect(HandOffRequest.safeParse({ to: 'worktree', path: '/x' }).success).toBe(false);
  });

  it('keeps 1 to 100 worktrees, whole numbers, 15 by default', () => {
    expect(WORKTREE_RETENTION_DEFAULT).toBe(15);
    for (const keep of [1, 15, 100]) expect(WorktreeRetentionSetting.safeParse({ keep }).success, String(keep)).toBe(true);
    for (const keep of [0, 101, 2.5, -1, '15']) expect(WorktreeRetentionSetting.safeParse({ keep }).success, String(keep)).toBe(false);
    expect(PutAwayWorktree.safeParse({ id: WSN, sessionId: SES, workspaceId: WS, branch: chatWorktreeBranch(SES), files: 3, cause: 'not_kept', putAwayAt: AT }).success).toBe(true);
    expect(PutAwayWorktree.safeParse({ id: WSN, sessionId: SES, workspaceId: WS, branch: 'b', files: 3, cause: 'deleted', putAwayAt: AT }).success).toBe(false);
    expect(WORKTREE_PORT_RANGE).toEqual({ first: 41_000, last: 41_999 });
  });

  it('tries one task with 2 to 4 different agents', () => {
    expect([TRIAL_AGENTS_MIN, TRIAL_AGENTS_MAX, TRIAL_TEXT_MAX]).toEqual([2, 4, 20_000]);
    const ok = { text: 'Fix the login bug', agentIds: ['claude-code', 'codex'] };
    expect(CreateTrialRequest.safeParse(ok).success).toBe(true);
    expect(CreateTrialRequest.safeParse({ ...ok, agentIds: ['claude-code'] }).success).toBe(false);
    expect(CreateTrialRequest.safeParse({ ...ok, agentIds: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false);
    expect(CreateTrialRequest.safeParse({ ...ok, agentIds: ['codex', 'codex'] }).success).toBe(false);
    expect(CreateTrialRequest.safeParse({ ...ok, text: '   ' }).success).toBe(false);
    expect(CreateTrialRequest.safeParse({ ...ok, text: 'x'.repeat(20_001) }).success).toBe(false);
    expect(Trial.safeParse({ id: TRY, workspaceId: WS, sessionIds: [SES, SES2], keptSessionId: null, createdAt: AT }).success).toBe(true);
    expect(Trial.safeParse({ id: TRY, workspaceId: WS, sessionIds: [SES], keptSessionId: null, createdAt: AT }).success).toBe(false);
    expect(KeepTrialRequest.safeParse({ sessionId: SES }).success).toBe(true);
  });

  it('names the ids, codes and routes', () => {
    expect(ID_PREFIXES).toMatchObject({ trial: 'try', worktreeSnapshot: 'wsn' });
    expect(TrialId.safeParse(TRY).success && WorktreeSnapshotId.safeParse(WSN).success).toBe(true);
    for (const code of ['handoff_conflict', 'restore_failed', 'agent_mid_turn', 'invalid_operation'] as const) expect(API_ERROR_CODES).toContain(code);
    expect(API_ROUTES.sessionLocation).toBe('/api/v1/workspaces/:wsId/sessions/:sesId/location');
    expect(API_ROUTES.sessionWorktreeRestore).toBe('/api/v1/workspaces/:wsId/sessions/:sesId/worktree/restore');
    expect(API_ROUTES.workspacePutAwayWorktrees).toBe('/api/v1/workspaces/:wsId/worktrees/put-away');
    expect(API_ROUTES.worktreeRetention).toBe('/api/v1/settings/worktree-retention');
    expect(API_ROUTES.workspaceTrials).toBe('/api/v1/workspaces/:wsId/trials');
    expect(API_ROUTES.workspaceTrial).toBe('/api/v1/workspaces/:wsId/trials/:tryId');
    expect(API_ROUTES.workspaceTrialKeep).toBe('/api/v1/workspaces/:wsId/trials/:tryId/keep');
  });

  it("says EXPERIENCE.md's words, with no em or en dash", () => {
    expect(handOffDividerText('this_folder', null)).toBe('Moved to this folder');
    expect(handOffDividerText('worktree', 'ogden/fix-login')).toBe('Moved to its own worktree: ogden/fix-login');
    expect(handOffConflictText(2)).toBe('This folder has its own changes to 2 of the same files. Commit or set them aside first, then move.');
    expect(handOffMidTurnText('Claude Code')).toBe('Move once Claude Code has finished.');
    expect(WORKTREE_PUT_AWAY_TEXT).toBe("This chat's copy was put away to save space.");
    expect(WORKTREE_RESTORED_TEXT).toBe('Restored.');
    const branch = `ogden/chat/${SES}`;
    expect(worktreeRestoredText('saved', branch)).toBe('Restored.');
    expect(worktreeRestoredText('newer', branch)).toBe(`Restored on ${branch} at its newer commit.`);
    expect(worktreeRestoredText('moved', `${branch}-restored`)).toBe(`The branch had moved, so this copy is on a new branch: ${branch}-restored.`);
    expect(worktreeRestoredText('gone', `${branch}-restored-2`)).toBe(`The branch was gone, so this copy is on a new branch: ${branch}-restored-2.`);
    for (const on of ['saved', 'newer', 'moved', 'gone'] as const) expect(worktreeRestoredText(on, branch)).not.toMatch(/[\u2013\u2014]/);
    expect(restoreBranchMissingText('ogden/fix-login')).toBe("Restore couldn't finish: the branch ogden/fix-login no longer exists. The saved changes are kept.");
    expect(worktreeRetentionLabel(15)).toBe('Keep the last 15 worktrees');
    expect(worktreePortText(3011)).toBe('Runs on port 3011 in this copy');
    expect(TRIAL_LINE_TEXT).toBe("Each agent works in its own copy, so none sees the others' changes.");
    expect(trialKeepConfirmText('Codex')).toBe("Keep Codex's result? The other copies are put away; you can restore them.");
    expect(trialTooltipText('Fix the login bug', 1, 3)).toBe('Try: Fix the login bug, 1 of 3');
    const texts = [
      HANDOFF_TO_THIS_FOLDER_DESCRIPTION,
      HANDOFF_TO_WORKTREE_DESCRIPTION,
      HANDOFF_CONFLICT_MESSAGE,
      RESTORE_FAILED_MESSAGE,
      RESTORE_PATH_TAKEN_TEXT,
      handOffDividerText('worktree', null),
      handOffConflictText(1),
      restoreBranchMissingText('b'),
      trialKeepConfirmText('A'),
    ];
    for (const text of texts) expect(text).not.toMatch(/[–—]/);
  });

  it("says the hand-off's failure, kept-branch conflict and busy-folder words (27.4), with no em or en dash", () => {
    expect(handOffWorktreeConflictText(2)).toBe("This chat's branch changed 2 of the same files since, so its changes can't go there. Commit or set them aside first, then move.");
    expect(HANDOFF_FOLDER_BUSY_TEXT).toBe('Move once the agents working in this folder have finished.');
    for (const text of [HANDOFF_FAILED_TEXT, HANDOFF_FOLDER_BUSY_TEXT, handOffWorktreeConflictText(1)]) expect(text).not.toMatch(/[–—]/);
  });

  it('puts the eight events in both unions, and rejects any payload carrying a path, content or text', () => {
    for (const event of EVENTS) {
      expect(NewCoreEvent.safeParse(event).success, event.type).toBe(true);
      expect(CoreEvent.safeParse({ ...envelope, ...event }).success, event.type).toBe(true);
      for (const field of ['worktreePath', 'path', 'text', 'content', 'repoPath']) {
        const smuggled = { ...event, payload: { ...event.payload, [field]: '/Users/me/secret' } };
        expect(NewCoreEvent.safeParse(smuggled).success, `${event.type} ${field}`).toBe(false);
        expect(CoreEvent.safeParse({ ...envelope, ...smuggled }).success, `${event.type} ${field}`).toBe(false);
      }
    }
    // A hand-off names only this folder or a worktree; a retention setting stays in its range.
    const [moved, , , , , retention] = EVENTS;
    expect(NewCoreEvent.safeParse({ ...moved, payload: { ...moved.payload, location: 'remote' } }).success).toBe(false);
    expect(NewCoreEvent.safeParse({ ...retention, payload: { keep: 0, previous: 15 } }).success).toBe(false);
  });
});

describe("a chat worktree's branches (Restore onto a new branch, user decision 2026-11-01)", () => {
  it("names the chat's own branch and its Restore branches, nothing else", () => {
    const own = chatWorktreeBranch(SES as never);
    expect(restoredChatWorktreeBranch(SES as never)).toBe(`${own}-restored`);
    for (const branch of [own, `${own}-restored`, `${own}-restored-2`, `${own}-restored-17`]) expect(chatOfWorktreeBranch(branch)).toBe(SES);
    for (const branch of [`${own}-restored-1`, `${own}-restored-02`, `${own}-other`, `${own}-restored-`, `${own}/x`, 'main', `ogden/chat/ses_bad-restored`, `x${own}`]) expect(chatOfWorktreeBranch(branch)).toBeUndefined();
  });

  it("answers Restore with the chat's place and where the copy went", () => {
    const location = { kind: 'worktree', branch: `ogden/chat/${SES}-restored`, port: null, putAway: false } as const;
    expect(RestoreWorktreeResponse.parse({ location, restored: 'moved' })).toEqual({ location, restored: 'moved' });
    expect(RestoreWorktreeResponse.safeParse({ location }).success).toBe(false);
    expect(RestoreWorktreeResponse.safeParse({ location, restored: 'elsewhere' }).success).toBe(false);
  });
});
