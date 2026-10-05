/**
 * Planning and the board in core (story 4.1; story 4.2's contract): each
 * use-case calls the guard first, so a project with the piece off is never
 * scanned and its tickets never read; the board also needs the project's
 * script trust (story 4.2), checked after the piece; the repo is the
 * workspace's stored real path; a skill must be well-formed and in the
 * catalog; a planning session is a chat session of kind `planning` whose
 * first message is the agent's invocation of the skill, with the idea when
 * given; the board never asks the store for `done`. Entry 4.11: last of the
 * board's guards, a project whose BMad Method lacks the ticket tree is
 * refused with `reduced_mode` before the store runs anything.
 */
import { CatalogSkill, MAX_IDEA_LENGTH, REDUCED_MODE_MESSAGE, TicketRow, type BmadCapability, type Catalog, type SessionId, type TicketsResponse, type WorkspaceId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  BmadDownloadError,
  BmadNotDownloadedError,
  createBmadSource,
  createBoard,
  createChat,
  createPlanning,
  FeatureOffError,
  NotFoundError,
  ReducedModeError,
  ReopenNotConfirmedError,
  ScriptsChangedError,
  ScriptsNotTrustedError,
  StatusNotAllowedError,
  TicketChangedError,
  TicketsUnavailableError,
  ValidationError,
  type AgentPort,
  type AgentSession,
  type BmadCatalogPort,
  type BmadSourcePort,
  type Core,
  type TicketStorePort,
} from '../src/index.js';
import { openTestCore, soleAgent, tempDir, unusedCatalogParts } from './helpers.js';

const UNKNOWN = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as WorkspaceId;
const SKILLS: CatalogSkill[] = [CatalogSkill.parse({ name: 'bmad-spec', description: 'Write a spec.' }), CatalogSkill.parse({ name: 'bmad-ticket', description: 'Make tickets.' })];
const CATALOG: Catalog = { modules: [], skills: SKILLS, agents: [], entryAction: null, capabilities: { plain_labels: false, ticket_tree: true } };
const TICKETS: TicketsResponse = {
  tickets: [TicketRow.parse({ ref: '1.1', id: 1, epic: 'epic-one', title: 'First', type: 'story', status: '', state: 'planned', blocked_reason: '' })],
  problems: [],
  folder: 'initiative-demo',
  epics: [],
};

/** A catalog that records which repos it scanned. */
function fakeCatalog(catalog: Catalog = CATALOG): BmadCatalogPort & { scanned: string[] } {
  const scanned: string[] = [];
  return {
    scanned,
    detect: async () => ({ hasBmad: true, hasOutput: true }),
    skills: async () => catalog.skills,
    ...unusedCatalogParts,
    catalog: async (repoPath) => {
      scanned.push(repoPath);
      return catalog;
    },
  };
}

/** An agent whose sessions record every prompt and answer at once. */
function promptRecorder(): AgentPort & { prompts: string[] } {
  const prompts: string[] = [];
  const session = (id: string): AgentSession => {
    const listeners = new Set<(event: Parameters<Parameters<AgentSession['onEvent']>[0]>[0]) => void>();
    return {
      agentSessionId: id,
      async prompt(text) {
        prompts.push(text);
        for (const listener of listeners) listener({ type: 'message_chunk', text: 'ok' });
        for (const listener of listeners) listener({ type: 'state', state: 'idle' });
        return { stopReason: 'end_turn' };
      },
      cancel: async () => {},
      close: async () => {},
      onEvent(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  };
  let opened = 0;
  return {
    prompts,
    displayName: 'Test Agent',
    skillInvocation: (skill, idea) => (idea === undefined ? `run-skill:${skill}` : `run-skill:${skill} idea:${idea}`),
    listAuthMethods: async () => [],
    startSession: async () => session(`agent-${++opened}`),
    reopenSession: async (input) => ({ session: session(input.agentSessionId), restored: 'resumed' }),
  };
}

/** A pinned BMad Method that is ready or not, counting status reads; it never downloads here. */
function fakeSource(ready: boolean): BmadSourcePort & { reads: number } {
  const source = {
    reads: 0,
    status: () => {
      source.reads++;
      return { state: ready ? ('ready' as const) : ('missing' as const), version: '6.13.0', commit: 'a'.repeat(40) };
    },
    download: () => Promise.reject(new BmadDownloadError('offline')),
    file: () => undefined,
  };
  return source;
}

/** The board's BMad Method check (entry 4.11): `_bmad/` unless `hasBmad` is false, lacking `missing`, recording each capability question. */
function capabilityCatalog(missing: readonly BmadCapability[] = [], hasBmad = true) {
  const asked: Array<[string, BmadCapability[]]> = [];
  const catalog: Pick<BmadCatalogPort, 'detect' | 'missingCapabilities'> = {
    detect: async () => ({ hasBmad, hasOutput: false }),
    missingCapabilities: async (repoPath, wanted) => {
      asked.push([repoPath, [...wanted]]);
      return wanted.filter((capability) => missing.includes(capability));
    },
  };
  return { catalog, asked };
}

async function setup(
  pieces: ('planning' | 'board')[] = ['planning', 'board'],
  { trusted = true, downloaded = true, missing = [], hasBmad = true }: { trusted?: boolean; downloaded?: boolean; missing?: BmadCapability[]; hasBmad?: boolean } = {},
) {
  // The project's scripts as the script trust reads them (story 4.13): a test changes `scripts.value`.
  const scripts: { value: string | undefined } = { value: 'none' };
  const core: Core = openTestCore(tempDir(), undefined, {
    availableBmadPieces: ['planning', 'board'],
    bmadCatalog: { detect: async () => ({ hasBmad: true, hasOutput: true }), skills: async () => [], ...unusedCatalogParts, scriptsFingerprint: async () => scripts.value },
  });
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  if (pieces.length > 0) core.permissions.updateSettings(workspace.id, { bmadPieces: pieces });
  if (trusted) await core.bmadScriptTrust.trustScripts(workspace.id);
  const catalog = fakeCatalog();
  const agent = promptRecorder();
  const chat = createChat({ dataDir: tempDir(), entities: core.entities, sessionEvents: core.sessionEvents, agents: soleAgent(agent) });
  const planning = createPlanning({ bmad: core.bmad, entities: core.entities, catalog, chat, agent });
  const read: string[] = [];
  const marks: unknown[][] = [];
  let answer: TicketsResponse | Error = TICKETS;
  const tickets: TicketStorePort = {
    tree: async (repoPath) => {
      read.push(repoPath);
      if (answer instanceof Error) throw answer;
      return answer;
    },
    find: async (repoPath, ref) => {
      read.push(repoPath);
      if (ref !== '1.1') throw new NotFoundError('ticket', ref);
      return { ...TICKETS.tickets[0]!, description: '', verify: '', references: [], notes: [], unknown: '', hasPlan: false, plan: null, plan_checkpoint: false, done_checkpoint: false };
    },
    mark: async (repoPath, ref, status, _guard, options) => {
      marks.push([repoPath, ref, status, options]);
      return { ref, status };
    },
    watch: () => Promise.reject(new Error('not watched in this test')),
  };
  const source = fakeSource(downloaded);
  const capabilities = capabilityCatalog(missing, hasBmad);
  const board = createBoard({ bmad: core.bmad, trust: core.bmadScriptTrust, source: createBmadSource(source), entities: core.entities, catalog: capabilities.catalog, tickets });
  return { core, workspace, catalog, agent, chat, planning, board, read, marks, source, scripts, asked: capabilities.asked, fail: (error: Error) => (answer = error) };
}

const firstUserMessage = (core: Core, sessionId: SessionId) =>
  core.events.readAfter(0).find((event) => event.streamId === sessionId && event.type === 'session.message_completed' && event.payload.role === 'user')?.payload;

describe('planning (story 4.1)', () => {
  it('lists the catalog of the workspace’s stored real path', async () => {
    const { planning, workspace, catalog } = await setup();
    expect(await planning.catalog(workspace.id)).toEqual(CATALOG);
    expect(catalog.scanned).toEqual([workspace.realPath]);
  });

  it('with Planning off, refuses with feature_off and scans nothing', async () => {
    const { planning, workspace, catalog, core } = await setup(['board']);
    await expect(planning.catalog(workspace.id)).rejects.toThrow(FeatureOffError);
    await expect(planning.start(workspace.id, 'bmad-spec')).rejects.toThrow(FeatureOffError);
    expect(catalog.scanned).toEqual([]);
    expect(core.entities.listSessions(workspace.id)).toEqual([]);
  });

  it('an unknown workspace is not found', async () => {
    const { planning } = await setup();
    await expect(planning.catalog(UNKNOWN)).rejects.toThrow(NotFoundError);
    await expect(planning.start(UNKNOWN, 'bmad-spec')).rejects.toThrow(NotFoundError);
  });

  it('a skill not in the catalog is not found, and a malformed one is invalid; neither creates a session', async () => {
    const { planning, workspace, core, catalog } = await setup();
    await expect(planning.start(workspace.id, 'bmad-nothing')).rejects.toThrow(NotFoundError);
    for (const bad of ['../x', 'Bmad', '', '-x', 'a'.repeat(65), 'a/b']) {
      await expect(planning.start(workspace.id, bad)).rejects.toThrow(ValidationError);
    }
    expect(catalog.scanned).toEqual([workspace.realPath]);
    expect(core.entities.listSessions(workspace.id)).toEqual([]);
  });

  it('starts a planning session whose first message is the agent’s invocation of the skill', async () => {
    const { planning, workspace, core, agent, chat } = await setup();
    const session = await planning.start(workspace.id, 'bmad-spec');
    expect(session.kind).toBe('planning');
    expect(core.entities.getSession(session.id)?.kind).toBe('planning');
    expect(firstUserMessage(core, session.id)).toEqual(expect.objectContaining({ role: 'user', content: 'run-skill:bmad-spec' }));
    // Named after the action as the Plan page shows it (its label, here none: its description), never after the skill invocation (backlog story 12).
    expect(core.entities.getSession(session.id)?.autoTitle).toBe('Write a spec.');
    await chat.settled();
    expect(agent.prompts).toEqual(['run-skill:bmad-spec']);
    // A plain chat is still a chat.
    expect((await chat.createChatSession(workspace.id)).kind).toBe('chat');
    await chat.close();
  });

  it('starts with the idea when given: trimmed, and refused when blank or too long (story 4.2)', async () => {
    const { planning, workspace, core, chat } = await setup();
    for (const bad of ['', '   ', 'x'.repeat(MAX_IDEA_LENGTH + 1)]) {
      await expect(planning.start(workspace.id, 'bmad-spec', bad)).rejects.toThrow(ValidationError);
    }
    expect(core.entities.listSessions(workspace.id)).toEqual([]);
    const session = await planning.start(workspace.id, 'bmad-spec', '  A pottery booking site  ');
    expect(firstUserMessage(core, session.id)).toEqual(expect.objectContaining({ content: 'run-skill:bmad-spec idea:A pottery booking site' }));
    await chat.close();
  });

  it('does not need the script trust: planning runs no project script (story 4.2)', async () => {
    const { planning, workspace, chat } = await setup(['planning'], { trusted: false });
    expect(await planning.catalog(workspace.id)).toEqual(CATALOG);
    await planning.start(workspace.id, 'bmad-spec');
    await chat.close();
  });
});

describe('board (story 4.1)', () => {
  it('reads the tickets of the workspace’s stored real path', async () => {
    const { board, workspace, read } = await setup();
    expect(await board.tickets(workspace.id)).toEqual(TICKETS);
    expect(read).toEqual([workspace.realPath]);
  });

  it('with Board off, refuses with feature_off and reads nothing', async () => {
    const { board, workspace, read } = await setup(['planning']);
    await expect(board.tickets(workspace.id)).rejects.toThrow(FeatureOffError);
    expect(read).toEqual([]);
  });

  it('passes the store’s TicketsUnavailableError on', async () => {
    const { board, workspace, fail } = await setup();
    fail(new TicketsUnavailableError('uv_missing'));
    const error = await board.tickets(workspace.id).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TicketsUnavailableError);
    expect((error as TicketsUnavailableError).code).toBe('tickets_unavailable');
    expect((error as TicketsUnavailableError).message).toMatch(/uv/);
  });
});

describe('board trust and the rest of the contract (story 4.2)', () => {
  it('without the project’s trust every board use-case refuses with scripts_not_trusted and runs nothing', async () => {
    const { board, workspace, read, marks } = await setup(['board'], { trusted: false });
    await expect(board.tickets(workspace.id)).rejects.toThrow(ScriptsNotTrustedError);
    await expect(board.ticket(workspace.id, '1.1')).rejects.toThrow(ScriptsNotTrustedError);
    await expect(board.mark(workspace.id, '1.1', { status: 'ready-for-dev' })).rejects.toThrow(ScriptsNotTrustedError);
    expect(read).toEqual([]);
    expect(marks).toEqual([]);
  });

  it('scripts changed since the trust (story 4.13): every board use-case refuses with scripts_changed and runs nothing; allowed again, it runs', async () => {
    const { core, board, workspace, read, marks, scripts } = await setup(['board']);
    scripts.value = 'sha256:planted';
    await expect(board.tickets(workspace.id)).rejects.toThrow(ScriptsChangedError);
    await expect(board.ticket(workspace.id, '1.1')).rejects.toThrow(ScriptsChangedError);
    await expect(board.mark(workspace.id, '1.1', { status: 'ready-for-dev' })).rejects.toThrow(ScriptsChangedError);
    expect(read).toEqual([]);
    expect(marks).toEqual([]);
    await core.bmadScriptTrust.trustScripts(workspace.id);
    await board.tickets(workspace.id);
    expect(read).toEqual([workspace.realPath]);
  });

  it('checks the piece before the trust: Board off answers feature_off even untrusted', async () => {
    const { board, workspace } = await setup(['planning'], { trusted: false });
    await expect(board.tickets(workspace.id)).rejects.toThrow(FeatureOffError);
  });

  it('without the pinned BMad Method downloaded every board use-case refuses with bmad_not_downloaded and runs nothing (story 4.14)', async () => {
    const { board, workspace, read, marks } = await setup(['board'], { downloaded: false });
    for (const attempt of [board.tickets(workspace.id), board.ticket(workspace.id, '1.1'), board.mark(workspace.id, '1.1', { status: 'ready-for-dev' })]) {
      const error = await attempt.then(
        () => undefined,
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(BmadNotDownloadedError);
      expect((error as BmadNotDownloadedError).code).toBe('bmad_not_downloaded');
    }
    expect(read).toEqual([]);
    expect(marks).toEqual([]);
  });

  it('checks the piece, then the trust, then the download: neither off nor untrusted asks whether it is downloaded (story 4.14)', async () => {
    const off = await setup(['planning'], { trusted: false, downloaded: false });
    await expect(off.board.tickets(off.workspace.id)).rejects.toThrow(FeatureOffError);
    expect(off.source.reads).toBe(0);
    const untrusted = await setup(['board'], { trusted: false, downloaded: false });
    await expect(untrusted.board.tickets(untrusted.workspace.id)).rejects.toThrow(ScriptsNotTrustedError);
    expect(untrusted.source.reads).toBe(0);
  });

  it('without the ticket tree every board use-case refuses with reduced_mode, after the other guards, and runs nothing (entry 4.11)', async () => {
    const { board, workspace, read, marks, asked } = await setup(['board'], { missing: ['ticket_tree'] });
    for (const attempt of [board.tickets(workspace.id), board.ticket(workspace.id, '1.1'), board.mark(workspace.id, '1.1', { status: 'ready-for-dev' })]) {
      const error = await attempt.then(
        () => undefined,
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(ReducedModeError);
      expect(error).toMatchObject({ code: 'reduced_mode', message: REDUCED_MODE_MESSAGE, capability: 'ticket_tree' });
    }
    expect(read).toEqual([]);
    expect(marks).toEqual([]);
    expect(asked).toEqual(Array.from({ length: 3 }, () => [workspace.realPath, ['ticket_tree']]));

    // Off, untrusted or not downloaded never asks for the capabilities.
    for (const options of [{ trusted: false }, { downloaded: false }]) {
      const other = await setup(['board'], { ...options, missing: ['ticket_tree'] });
      await expect(other.board.tickets(other.workspace.id)).rejects.not.toBeInstanceOf(ReducedModeError);
      expect(other.asked).toEqual([]);
    }
    const off = await setup(['planning'], { missing: ['ticket_tree'] });
    await expect(off.board.tickets(off.workspace.id)).rejects.toThrow(FeatureOffError);
    expect(off.asked).toEqual([]);
  });

  it('without _bmad/ every board use-case refuses with bmad_not_set_up, never asking for capabilities (entry 4.11)', async () => {
    const { board, workspace, read, marks, asked } = await setup(['board'], { hasBmad: false, missing: ['ticket_tree'] });
    for (const attempt of [board.tickets(workspace.id), board.ticket(workspace.id, '1.1'), board.mark(workspace.id, '1.1', { status: 'ready-for-dev' })]) {
      await expect(attempt).rejects.toMatchObject({ code: 'bmad_not_set_up' });
    }
    expect(asked).toEqual([]);
    expect(read).toEqual([]);
    expect(marks).toEqual([]);
  });

  it('reads one ticket, and a missing one is not found; a malformed ref is invalid and runs nothing', async () => {
    const { board, workspace, read } = await setup();
    expect((await board.ticket(workspace.id, '1.1')).ref).toBe('1.1');
    await expect(board.ticket(workspace.id, '9.9')).rejects.toThrow(NotFoundError);
    for (const bad of ['', '-x', 'a/b', '../1', 'a b']) await expect(board.ticket(workspace.id, bad)).rejects.toThrow(ValidationError);
    expect(read).toEqual([workspace.realPath, workspace.realPath]);
  });

  it('marks through the store, never done, and checks the request', async () => {
    const { board, workspace, marks } = await setup();
    expect(await board.mark(workspace.id, '1.1', { status: 'ready-for-dev' })).toEqual({ ref: '1.1', status: 'ready-for-dev' });
    await board.mark(workspace.id, '1.1', { status: 'blocked', blockedReason: '  Waiting on the API  ' });
    await expect(board.mark(workspace.id, '1.1', { status: 'done' })).rejects.toThrow(StatusNotAllowedError);
    for (const bad of [{ status: 'shipped' }, {}, { status: 'draft', blockedReason: 'why' }, 'ready-for-dev']) {
      await expect(board.mark(workspace.id, '1.1', bad)).rejects.toThrow(ValidationError);
    }
    expect(marks).toEqual([
      [workspace.realPath, '1.1', 'ready-for-dev', { blockedReason: undefined, expectedStatus: undefined }],
      [workspace.realPath, '1.1', 'blocked', { blockedReason: 'Waiting on the API', expectedStatus: undefined }],
    ]);
  });
});

describe('changing a status from the board (story 4.10)', () => {
  /** A board over a store whose marks wait for `release`, compare `expectedStatus` and record when each starts and ends. */
  async function gated() {
    const base = await setup();
    const log: string[] = [];
    let status = '';
    const guards: string[] = [];
    const releases: Array<() => void> = [];
    const store: TicketStorePort = {
      tree: () => Promise.reject(new Error('unused')),
      find: () => Promise.reject(new Error('unused')),
      watch: () => Promise.reject(new Error('unused')),
      mark: async (_repoPath, ref, next, guard, options = {}) => {
        guards.push(guard.scripts);
        log.push(`start ${next}`);
        await new Promise<void>((resolve) => releases.push(resolve));
        try {
          if (options.expectedStatus !== undefined && options.expectedStatus !== status) throw new TicketChangedError(ref, options.expectedStatus, status);
          if (next === 'built') throw new TicketsUnavailableError('failed');
          status = next;
          return { ref, status: next };
        } finally {
          log.push(`end ${next}`);
        }
      },
    };
    const board = createBoard({ bmad: base.core.bmad, trust: base.core.bmadScriptTrust, source: createBmadSource(fakeSource(true)), entities: base.core.entities, catalog: capabilityCatalog().catalog, tickets: store });
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    return { ...base, board, log, releases, guards, flush, statusNow: () => status };
  }

  it('runs two marks of one repo one after the other, and a failed mark does not break the chain', async () => {
    const { board, workspace, log, releases, flush } = await gated();
    const first = board.mark(workspace.id, '1.1', { status: 'built' });
    const second = board.mark(workspace.id, '1.1', { status: 'ready-for-dev' });
    await flush();
    expect(log).toEqual(['start built']);
    releases.shift()!();
    await expect(first).rejects.toThrow(TicketsUnavailableError);
    await flush();
    expect(log).toEqual(['start built', 'end built', 'start ready-for-dev']);
    releases.shift()!();
    expect(await second).toEqual({ ref: '1.1', status: 'ready-for-dev' });
    expect(log).toEqual(['start built', 'end built', 'start ready-for-dev', 'end ready-for-dev']);
  });

  it('hands the store the fingerprint of the scripts the user trusted, which its run checks again (maintained-fork story)', async () => {
    const { board, workspace, releases, guards, flush } = await gated();
    const marked = board.mark(workspace.id, '1.1', { status: 'draft' });
    await flush();
    releases.shift()!();
    await marked;
    expect(guards).toEqual(['none']);
  });

  it('a queued mark checks the guards again on its turn: Board turned off meanwhile runs nothing', async () => {
    const { board, core, workspace, log, releases, flush } = await gated();
    const first = board.mark(workspace.id, '1.1', { status: 'draft' });
    const second = board.mark(workspace.id, '1.1', { status: 'ready-for-dev' });
    await flush();
    core.permissions.updateSettings(workspace.id, { bmadPieces: [] });
    releases.shift()!();
    await first;
    await expect(second).rejects.toThrow(FeatureOffError);
    expect(log).toEqual(['start draft', 'end draft']);
  });

  it('an expected status that no longer matches is ticket_changed and nothing is written', async () => {
    const { board, workspace, releases, flush, statusNow } = await gated();
    const first = board.mark(workspace.id, '1.1', { status: 'in-progress', expectedStatus: '' });
    // The second click saw the same board: by its turn the first changed the ticket.
    const second = board.mark(workspace.id, '1.1', { status: 'ready-for-dev', expectedStatus: '' });
    await flush();
    releases.shift()!();
    await first;
    await flush();
    releases.shift()!();
    const error = await second.catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(TicketChangedError);
    expect((error as TicketChangedError).code).toBe('ticket_changed');
    expect(statusNow()).toBe('in-progress');
  });

  it('passes the expected status through, and refuses done and a bad expected status before the store', async () => {
    const { board, workspace, marks } = await setup();
    await board.mark(workspace.id, '1.1', { status: 'ready-for-dev', expectedStatus: '' });
    await expect(board.mark(workspace.id, '1.1', { status: 'done', expectedStatus: '' })).rejects.toThrow(StatusNotAllowedError);
    await expect(board.mark(workspace.id, '1.1', { status: 'draft', expectedStatus: 'shipped' })).rejects.toThrow(ValidationError);
    expect(marks).toEqual([[workspace.realPath, '1.1', 'ready-for-dev', { blockedReason: undefined, expectedStatus: '' }]]);
  });

  it('out of Done needs the confirmed reopen (user decision 2026-10-02): without it reopen_not_confirmed and nothing runs; into Done stays refused', async () => {
    const { board, workspace, marks } = await setup();
    for (const request of [{ status: 'ready-for-dev', expectedStatus: 'done' }, { status: 'blocked', blockedReason: 'Broke again', expectedStatus: 'done' }]) {
      const error = await board.mark(workspace.id, '1.1', request).catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(ReopenNotConfirmedError);
      expect((error as ReopenNotConfirmedError).code).toBe('reopen_not_confirmed');
    }
    // `reopen` goes only with a Done ticket, and is only ever `true`.
    await expect(board.mark(workspace.id, '1.1', { status: 'draft', expectedStatus: 'built', reopen: true })).rejects.toThrow(ValidationError);
    await expect(board.mark(workspace.id, '1.1', { status: 'draft', reopen: true })).rejects.toThrow(ValidationError);
    await expect(board.mark(workspace.id, '1.1', { status: 'draft', expectedStatus: 'done', reopen: false })).rejects.toThrow(ValidationError);
    // Into Done is refused even with a reopen.
    await expect(board.mark(workspace.id, '1.1', { status: 'done', expectedStatus: 'done', reopen: true })).rejects.toThrow(StatusNotAllowedError);
    expect(marks).toEqual([]);
    expect(await board.mark(workspace.id, '1.1', { status: 'in-progress', expectedStatus: 'done', reopen: true })).toEqual({ ref: '1.1', status: 'in-progress' });
    expect(marks).toEqual([[workspace.realPath, '1.1', 'in-progress', { blockedReason: undefined, expectedStatus: 'done' }]]);
  });

  it('Board off, untrusted or not downloaded refuse a mark before the store', async () => {
    for (const [pieces, options, error] of [
      [['planning'], {}, FeatureOffError],
      [['board'], { trusted: false }, ScriptsNotTrustedError],
      [['board'], { downloaded: false }, BmadNotDownloadedError],
    ] as const) {
      const { board, workspace, marks } = await setup([...pieces], options);
      await expect(board.mark(workspace.id, '1.1', { status: 'ready-for-dev', expectedStatus: '' })).rejects.toThrow(error);
      expect(marks).toEqual([]);
    }
  });
});
