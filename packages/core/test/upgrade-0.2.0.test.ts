/**
 * A 0.2.0 data folder upgrades with everything kept (story 10.7; E10-R7,
 * CAP-19, AD-5): 0.2.0's migrations are frozen, opening the folder runs only
 * the migrations added since and appends no event, every stored event still
 * parses with today's schema and reads back unchanged, and every project
 * keeps its caution level, rules and chats with all BMad pieces off and its
 * offer not dismissed. Folders left by 10.1's migration 0004 and 10.3's 0005
 * keep what those builds stored.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoreEvent, type SessionId, type WorkspaceId } from '@ogden-agents/shared';
import Sqlite from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createDataFolder020, LIVE_MIGRATIONS, MIGRATIONS_020, type DataFolder020 } from '../../../tests/fixtures/data-folder-0.2.0.js';
import { canonicalWorkspacePath, realWorkspacePath, type BmadCatalogPort, type Core } from '../src/index.js';
import { openTestCore, removeAfterTest } from './helpers.js';

/** SHA-256 of each migration 0.2.0 shipped, as released: they never change. */
const FROZEN_020: Record<(typeof MIGRATIONS_020)[number], string> = {
  '0000_init': '8ffbbd09925156dfac08b9806eb87bbfdfe8c27bc99488d38746f734a444524c',
  '0001_workspace_real_path': '3a096d7ec4b427913f970f26e3ad5a6a137a693fb0270cc86cede0b2b514bb4f',
  '0002_permission_rules': 'e0cba35e286877181293ef6c51491367ada6c76395b9f5079571796e92bbb7d4',
  '0003_caution_level': '65c3df9bd3aff5a06f899bb0a45f70b20610469efb68ef0e33ef78a9765c84b6',
};

/** The journal entries of 0.2.0's migrations, as released (`5765a09`): they decide what drizzle runs again. */
const FROZEN_JOURNAL_020 = [
  { idx: 0, version: '6', when: 1790739450131, tag: '0000_init', breakpoints: true },
  { idx: 1, version: '6', when: 1790754247900, tag: '0001_workspace_real_path', breakpoints: true },
  { idx: 2, version: '6', when: 1790781763595, tag: '0002_permission_rules', breakpoints: true },
  { idx: 3, version: '6', when: 1790789547428, tag: '0003_caution_level', breakpoints: true },
];

/** Detection as the real catalog answers it: `_bmad/` and `_bmad-output/` exist or not, read-only. */
const fsCatalog: BmadCatalogPort = {
  detect: async (repoPath) => ({ hasBmad: existsSync(join(repoPath, '_bmad')), hasOutput: existsSync(join(repoPath, '_bmad-output')) }),
};

function folder(stopAt?: 3 | 4 | 5): DataFolder020 {
  const created = createDataFolder020(stopAt === undefined ? {} : { stopAt });
  // Removed by helpers.ts's shared hook, after the cores on it are closed.
  for (const dir of [created.dataDir, created.repos.bmad.path, created.repos.plain.path]) removeAfterTest(dir);
  return created;
}

function open(data: DataFolder020): Core {
  return openTestCore(data.dataDir, undefined, { bmadCatalog: fsCatalog });
}

/** Every row of `table` in the folder's database, read without core. */
function rowsOf(dataDir: string, sql: string): unknown[] {
  const db = new Sqlite(join(dataDir, 'ogden-agents.db'), { readonly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

describe('upgrading a 0.2.0 data folder (story 10.7)', () => {
  it("0.2.0's migrations 0000 to 0003 are frozen", () => {
    const journal = JSON.parse(readFileSync(join(LIVE_MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.filter((entry) => entry.idx <= 3)).toEqual(FROZEN_JOURNAL_020);
    expect(FROZEN_JOURNAL_020.map((entry) => entry.tag)).toEqual([...MIGRATIONS_020]);
    for (const tag of MIGRATIONS_020) {
      expect(createHash('sha256').update(readFileSync(join(LIVE_MIGRATIONS, `${tag}.sql`))).digest('hex'), tag).toBe(FROZEN_020[tag]);
    }
  });

  it('builds the fixture with the workspace keys core computes', () => {
    const data = folder();
    expect(rowsOf(data.dataDir, 'SELECT path, real_path FROM workspaces ORDER BY created_at')).toEqual([
      { path: canonicalWorkspacePath(data.repos.bmad.path), real_path: realWorkspacePath(data.repos.bmad.path) },
      { path: canonicalWorkspacePath(data.repos.plain.path), real_path: realWorkspacePath(data.repos.plain.path) },
    ]);
  });

  it('keeps every event as stored, each parsing with today\'s schema, and appends none on open', async () => {
    const data = folder();
    const core = open(data);
    const read = core.events.readAfter(0);
    expect(read).toHaveLength(data.events.length);
    expect(core.events.lastSeq()).toBe(data.events.at(-1)!.seq);
    for (const [i, row] of data.events.entries()) {
      const event = read[i]!;
      expect(event).toEqual({ id: row.id, seq: row.seq, workspaceId: row.workspace_id, streamId: row.stream_id, type: row.type, at: row.at, payload: JSON.parse(row.payload) });
      const parsed = CoreEvent.safeParse(event);
      expect(parsed.success, `${row.type} #${row.seq}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      // Parsing adds and drops nothing: the payload reads back exactly as stored.
      expect(parsed.data?.payload).toEqual(JSON.parse(row.payload));
    }
    // The 0.2.0 event types the fixture covers.
    expect(new Set(read.map((event) => event.type))).toEqual(
      new Set([
        'server.started',
        'workspace.created',
        'workspace.settings_changed',
        'workspace.permission_rule_added',
        'workspace.permission_rule_removed',
        'session.created',
        'session.state_changed',
        'session.message_queued',
        'session.message_completed',
        'session.tool_call',
        'session.tool_call_updated',
        'permission.requested',
        'permission.resolved',
        'session.resumed',
      ]),
    );

    // Reading settings, rules, sessions and detection appends nothing either.
    await core.bmadDetection.detect(data.workspaceIds.bmad as WorkspaceId);
    core.permissions.getSettings(data.workspaceIds.bmad as WorkspaceId);
    expect(core.events.lastSeq()).toBe(data.events.at(-1)!.seq);
    core.close();
    // The stored rows are byte-identical after core opened and closed the folder.
    expect(rowsOf(data.dataDir, 'SELECT seq, id, workspace_id, stream_id, type, at, payload FROM events ORDER BY seq')).toEqual(data.events);
  });

  it('keeps every project, caution level, rule and chat, with all pieces off and the offer not dismissed', async () => {
    const data = folder();
    const bmad = data.workspaceIds.bmad as WorkspaceId;
    const plain = data.workspaceIds.plain as WorkspaceId;
    const core = open(data);

    expect(core.entities.listWorkspaces().map((workspace) => workspace.id).sort()).toEqual([bmad, plain].sort());
    expect(core.permissions.getSettings(bmad)).toEqual({ cautionLevel: 'ask_for_commands', bmadPieces: [] });
    expect(core.permissions.getSettings(plain)).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: [] });
    expect(core.permissions.listRules(bmad).map((rule) => rule.scope)).toEqual([{ kind: 'command_prefix', value: 'npm install', label: 'npm install' }]);
    expect(core.permissions.listRules(plain)).toEqual([]);

    const bmadChats = core.entities.listSessions(bmad);
    const plainChats = core.entities.listSessions(plain);
    expect(bmadChats.map((session) => [session.id, session.kind, session.state])).toEqual([[data.sessionIds.bmad, 'chat', 'idle']]);
    expect(plainChats.map((session) => [session.id, session.kind, session.state])).toEqual([[data.sessionIds.plain, 'chat', 'idle']]);
    const transcript = (id: string) => core.entities.listCompletedMessages(id as SessionId).map((message) => `${message.role}: ${message.content}`);
    expect(transcript(data.sessionIds.bmad)).toEqual(expect.arrayContaining(['user: Say hello', 'agent: Edited.', 'agent: Ran npm install stripe.', 'agent: Denied npm test.', 'user: Thanks, carry on']));
    expect(transcript(data.sessionIds.plain)).toEqual(['user: wait for the build', 'agent: Waiting, done.', 'user: And add a footer', 'agent: Hello from the fake agent.']);

    expect(await core.bmadDetection.detect(bmad)).toEqual({ hasBmad: true, hasOutput: false, offerDismissed: false });
    expect(await core.bmadDetection.detect(plain)).toEqual({ hasBmad: false, hasOutput: false, offerDismissed: false });
    expect(rowsOf(data.dataDir, 'SELECT bmad_pieces, bmad_offer_dismissed FROM workspaces')).toEqual([
      { bmad_pieces: '[]', bmad_offer_dismissed: 0 },
      { bmad_pieces: '[]', bmad_offer_dismissed: 0 },
    ]);
  });

  it.each([
    [4, ['planning'], false],
    [5, ['planning'], true],
  ] as const)('a folder migrated through %i keeps what that build stored and defaults the rest', async (stopAt, pieces, dismissed) => {
    const data = folder(stopAt);
    const bmad = data.workspaceIds.bmad as WorkspaceId;
    const plain = data.workspaceIds.plain as WorkspaceId;
    const core = open(data);
    expect(core.permissions.getSettings(bmad)).toEqual({ cautionLevel: 'ask_for_commands', bmadPieces: pieces });
    expect(core.permissions.getSettings(plain)).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: [] });
    expect(await core.bmadDetection.detect(bmad)).toEqual({ hasBmad: true, hasOutput: false, offerDismissed: dismissed });
    expect(await core.bmadDetection.detect(plain)).toEqual({ hasBmad: false, hasOutput: false, offerDismissed: false });
    const read = core.events.readAfter(0);
    expect(read).toHaveLength(data.events.length);
    for (const event of read) expect(CoreEvent.safeParse(event).success, `${event.type} #${event.seq}`).toBe(true);
  });

  it('writes nothing in either repo', async () => {
    const data = folder();
    const before = { bmad: data.repos.bmad.hash(), plain: data.repos.plain.hash() };
    const core = open(data);
    await core.bmadDetection.detect(data.workspaceIds.bmad as WorkspaceId);
    await core.bmadDetection.detect(data.workspaceIds.plain as WorkspaceId);
    core.close();
    expect({ bmad: data.repos.bmad.hash(), plain: data.repos.plain.hash() }).toEqual(before);
    expect(existsSync(join(data.repos.plain.path, '_bmad'))).toBe(false);
  });
});
