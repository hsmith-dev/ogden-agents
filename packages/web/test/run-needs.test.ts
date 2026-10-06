/** Story 11.4: blocked runs and runs ready for review as Needs you entries, their words and announcements. */
import type { Run, Workspace } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { notificationText } from '../src/notifications/notifier';
import { buildRunNeeds, buildSidebar, diffForAnnouncements } from '../src/shell/sidebar-model';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const workspace = { id: WS, path: '/home/me/Letterpress', realPath: '/home/me/Letterpress', createdAt: '2026-10-05T00:00:00.000Z' } as Workspace;
let counter = 0;
const run = (ref: string, fields: Record<string, unknown>): Run => {
  counter += 1;
  return {
    id: `run_01J9Z3K4M5N6P7Q8R9S0T1V2W${counter}`,
    sessionId: `ses_01J9Z3K4M5N6P7Q8R9S0T1V2W${counter}`,
    workspaceId: WS,
    ticketRef: ref,
    worktreePath: '/w/x',
    sandbox: 'seatbelt',
    deadline: null,
    outcome: 'running',
    reason: null,
    blockedCode: null,
    queuePosition: null,
    decision: null,
    agent: null,
    branch: null,
    baseRevision: null,
    baseBranch: null,
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T01:00:00.000Z',
    ...fields,
  } as unknown as Run;
};
const needs = (runs: Run[]) => buildRunNeeds([workspace], new Map([[WS, runs]]));

describe('blocked runs and runs ready for review in Needs you (story 11.4)', () => {
  it('a blocked run and a checkpoint pause are blocked needs; a run ready for review links to its review; others are nothing', () => {
    const found = needs([
      run('1.1', { outcome: 'blocked', blockedCode: 'other' }),
      run('1.2', { outcome: 'blocked', blockedCode: 'checkpoint_plan' }),
      run('1.3', { outcome: 'verified' }),
      run('1.4', { outcome: 'verified', decision: 'approved' }),
      run('1.5', { outcome: 'failed' }),
      run('1.6', { outcome: 'running' }),
      run('1.7', { outcome: 'blocked', blockedCode: 'interrupted' }),
      run('1.8', { outcome: 'stopped', decision: 'rejected' }),
    ]);
    expect(found.map((entry) => [entry.kind, entry.chatName, entry.text, entry.reviewRef])).toEqual([
      ['run_blocked', 'Build 1.1', 'Build 1.1 is blocked', undefined],
      ['run_blocked', 'Build 1.2', 'Build 1.2 is blocked', undefined],
      ['run_review', 'Build 1.3', 'Build 1.3 is ready for review', '1.3'],
    ]);
    expect(found[0]).toMatchObject({ workspaceName: 'Letterpress', wsId: WS });
  });

  it("only a ticket's latest run counts (newest first), so a retried run replaces the old need", () => {
    const newer = run('1.1', { outcome: 'running' });
    const older = run('1.1', { outcome: 'blocked', blockedCode: 'other' });
    expect(needs([newer, older])).toEqual([]);
  });

  it('joins Needs you with the count, a notification that names the project and the build and never what happened', () => {
    const entries = needs([run('1.3', { outcome: 'verified', reason: 'secret-sk-123 in a path /Users/me/x' })]);
    const model = buildSidebar([workspace], [], { windows: new Map() } as never, Date.now(), undefined, undefined, undefined, entries);
    expect(model.needsYou).toHaveLength(1);
    expect(notificationText(entries[0]!)).toEqual({ title: 'Ready for review', body: 'Letterpress: Build 1.3' });
  });

  it('a new one is said in the polite region once its build session is known', () => {
    const entries = needs([run('1.1', { outcome: 'blocked', blockedCode: 'other' })]);
    const session = { sesId: entries[0]!.sesId, wsId: WS, title: 'Build', userTitle: null, state: 'idle', updatedAt: '2026-10-05T01:00:00.000Z', agentName: 'Claude Code' };
    const group = { wsId: WS, name: 'Letterpress', rows: [session], earlier: [], summary: [] };
    const before = { groups: [group], needsYou: [] } as never;
    const after = { groups: [group], needsYou: entries } as never;
    expect(diffForAnnouncements(before, after).polite).toEqual([{ sesId: entries[0]!.sesId, text: 'Letterpress: Build 1.1 is blocked' }]);
  });
});

describe('a build need in the notifier (story 11.4)', () => {
  it('is news once, and again when it leaves the list and comes back', async () => {
    const { createNotifier } = await import('../src/notifications/notifier');
    const { DEFAULT_NOTIFICATION_SETTINGS } = await import('../src/notifications/notification-settings');
    const shown: string[] = [];
    const notifier = createNotifier({ isLeader: () => true, anyTabFocused: () => false, permission: () => 'granted', show: (need) => (shown.push(need.id), undefined), chime: () => undefined });
    const settings = { ...DEFAULT_NOTIFICATION_SETTINGS, desktop: true };
    const sessions = new Set(['ses_01J9Z3K4M5N6P7Q8R9S0T1V2W1']);
    const need = buildRunNeeds([workspace], new Map([[WS, [run('1.1', { outcome: 'blocked', blockedCode: 'other' })]]]));
    const entry = { ...need[0]!, sesId: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W1' };
    notifier.update([], settings, true, sessions);
    notifier.update([entry], settings, true, sessions);
    notifier.update([{ ...entry, at: '2030-01-01T00:00:00.000Z' }], settings, true, sessions);
    expect(shown).toEqual([entry.id]);
    // Retried (gone from the list), then blocked again.
    notifier.update([], settings, true, sessions);
    notifier.update([entry], settings, true, sessions);
    expect(shown).toEqual([entry.id, entry.id]);
  });
});
