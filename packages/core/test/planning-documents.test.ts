/**
 * Document cards in core (story 4.7): a `planning` session's completed write
 * into the output folder appends one `session.document_written` with the
 * next suggested step of the session's skill; a write outside the folder, a
 * non-Markdown file, a call not completed, a chat session, Planning off or no
 * output folder appends nothing. The document use-case reads only a `.md`
 * inside the output folder, through the port.
 */
import { join } from 'node:path';
import { BMAD_PIECES, CatalogSkill, DOCUMENT_INVALID_PATH_MESSAGE, type BmadPiece, type BmadSetupStatus, type Catalog, type SessionDocumentWrittenEvent, type SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  createChat,
  createPlanning,
  createPlanningDocuments,
  documentPath,
  FeatureOffError,
  insideOutputFolder,
  MAX_DOCUMENT_PATH_LENGTH,
  MAX_DOCUMENTS_PER_CALL,
  NotFoundError,
  repoRelativeOf,
  sessionSkill,
  ValidationError,
  type AgentEvent,
  type AgentPort,
  type AgentSession,
  type BmadCatalogPort,
  type Core,
  type PlanningDocumentsStep,
} from '../src/index.js';
import { openTestCore, soleAgent, tempDir } from './helpers.js';

const NEXT = { skill: 'bmad-ticket', label: 'Turn this spec into tickets' };
const SKILLS: CatalogSkill[] = [
  CatalogSkill.parse({ name: 'bmad-spec', description: 'Write a spec.', next: NEXT }),
  CatalogSkill.parse({ name: 'bmad-ticket', description: 'Make tickets.' }),
];
const CATALOG: Catalog = { modules: [], skills: SKILLS, agents: [], entryAction: null, capabilities: { plain_labels: true, ticket_tree: true, look_back: true } };
const SET_UP: BmadSetupStatus = { state: 'current', outputFolder: '_bmad-output', bundledVersion: '7.0.0', installedVersion: '7.0.0', problems: [] };

/** A catalog port answering {@link CATALOG}, the given setup status, and documents from `documents`. */
type FakeCatalog = BmadCatalogPort & { status: BmadSetupStatus; reads: Array<[string, string, string]> };

function fakeCatalog(documents: Record<string, string> = {}): FakeCatalog {
  const port: FakeCatalog = {
    status: SET_UP,
    reads: [],
    detect: async () => ({ hasBmad: true, hasOutput: true }),
    skills: async () => CATALOG.skills,
    catalog: async () => structuredClone(CATALOG),
    setupStatus: async () => structuredClone(port.status),
    setup: () => Promise.reject(new Error('not used')),
    missingCapabilities: () => Promise.reject(new Error('not used')),
    scriptsFingerprint: async () => 'none',
    readDocument: async (repoPath: string, outputFolder: string, path: string) => {
      port.reads.push([repoPath, outputFolder, path]);
      const content = documents[path];
      return content === undefined ? null : { content, truncated: false };
    },
  };
  return port;
}

/** An agent whose sessions answer each prompt with `script(text)`'s events, then `idle`. */
function scriptedAgent(script: (text: string) => AgentEvent[]): AgentPort {
  const session = (id: string): AgentSession => {
    const listeners = new Set<(event: AgentEvent) => void>();
    return {
      agentSessionId: id,
      async prompt(text) {
        for (const event of [...script(text), { type: 'state', state: 'idle' } as const]) for (const listener of listeners) listener(event);
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
    displayName: 'Test Agent',
    skillInvocation: (skill, idea) => (idea === undefined ? `/${skill}` : `/${skill} ${idea}`),
    listAuthMethods: async () => [],
    startSession: async () => session(`agent-${++opened}`),
    reopenSession: async (input) => ({ session: session(input.agentSessionId), restored: 'resumed' }),
  };
}

/** `write <status> <path>[|<path>…]`: an edit tool call, then an update to `status` with a diff of each path. */
function writes(text: string): AgentEvent[] {
  const match = /^write (\S+) (.+)$/.exec(text);
  if (match === null) return [{ type: 'message_chunk', text: 'ok' }];
  const [, status, paths] = match;
  const id = `call-${text.length}-${Math.random().toString(36).slice(2)}`;
  const diffs = paths!.split('|').map((path) => ({ path, oldText: null, newText: '# Doc\n' }));
  return [
    { type: 'tool_call', toolCallId: id, title: 'Write', kind: 'edit', status: 'in_progress' },
    { type: 'tool_call_update', toolCallId: id, status, diffs },
  ];
}

function setup({ pieces = ['planning'] as BmadPiece[], documents = {} as Record<string, string>, throwing = false } = {}) {
  const core: Core = openTestCore(tempDir(), undefined, { availableBmadPieces: BMAD_PIECES });
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  if (pieces.length > 0) core.permissions.updateSettings(workspace.id, { bmadPieces: pieces });
  const catalog = fakeCatalog(documents);
  const agent = scriptedAgent(writes);
  const told: Array<[SessionId, PlanningDocumentsStep]> = [];
  const documentsUseCase = createPlanningDocuments({
    bmad: core.bmad,
    entities: core.entities,
    catalog,
    agent,
    sessionEvents: core.sessionEvents,
    onError: (sessionId, step) => told.push([sessionId, step]),
  });
  const internal: unknown[] = [];
  const chat = createChat({
    dataDir: tempDir(),
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agents: soleAgent(agent),
    onInternalError: (_, error) => internal.push(error),
    onToolCallCompleted: (sessionId, toolCallId, diffs) => {
      if (throwing) throw new Error('hook failed');
      documentsUseCase.toolCallCompleted(sessionId, toolCallId, diffs);
    },
  });
  const planning = createPlanning({ bmad: core.bmad, entities: core.entities, catalog, chat, agent });
  const repo = workspace.realPath!;
  /** Sends `text` to the session and waits for its turn and any detection to end. */
  const send = async (sessionId: SessionId, text: string) => {
    chat.sendMessage(workspace.id, sessionId, text);
    await chat.settled();
    await documentsUseCase.settled();
  };
  const written = (sessionId: SessionId) =>
    core.events.readAfter(0).filter((event): event is SessionDocumentWrittenEvent => event.streamId === sessionId && event.type === 'session.document_written');
  const start = async (skill = 'bmad-spec') => {
    const session = await planning.start(workspace.id, skill);
    await chat.settled();
    return session;
  };
  return { core, workspace, repo, catalog, chat, planning, send, written, start, told, internal, agent };
}

describe('document detection (story 4.7)', () => {
  it('a completed write of a spec into the output folder appends one event with the next step', async () => {
    const { repo, send, written, start, chat, core } = setup();
    const session = await start();
    await send(session.id, `write completed ${join(repo, '_bmad-output', 'specs', 'spec-x.md')}`);
    const events = written(session.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({ path: '_bmad-output/specs/spec-x.md', toolCallId: expect.stringMatching(/^call-/), next: NEXT });
    // The card follows its tool-call row in the log.
    const completed = core.events.readAfter(0).find((event) => event.streamId === session.id && event.type === 'session.tool_call_updated' && event.payload.status === 'completed');
    expect(events[0]!.seq).toBeGreaterThan(completed!.seq);
    await chat.close();
  });

  it('a relative diff path is taken relative to the repo', async () => {
    const { send, written, start, chat } = setup();
    const session = await start();
    await send(session.id, 'write completed _bmad-output/brief.md');
    expect(written(session.id).map((event) => event.payload.path)).toEqual(['_bmad-output/brief.md']);
    await chat.close();
  });

  it('a write outside the output folder, outside the repo, or not Markdown appends nothing', async () => {
    const { repo, send, written, start, chat, catalog } = setup();
    const session = await start();
    for (const path of [join(repo, 'src', 'x.md'), join(repo, '_bmad-output', 'tickets.toml'), '../x.md', join(repo, '..', 'x.md'), '/etc/x.md', join(repo, '_bmad-output-other', 'x.md'), join(repo, '_bmad-output')]) {
      await send(session.id, `write completed ${path}`);
    }
    expect(written(session.id)).toEqual([]);
    // Nothing was read for a write that is no document: the lexical check comes first.
    expect(catalog.reads).toEqual([]);
    await chat.close();
  });

  it('a call that is still in progress or failed appends nothing; a completed one only once', async () => {
    const { repo, send, written, start, chat } = setup();
    const session = await start();
    const file = join(repo, '_bmad-output', 'spec.md');
    await send(session.id, `write in_progress ${file}`);
    await send(session.id, `write failed ${file}`);
    expect(written(session.id)).toEqual([]);
    await chat.close();
  });

  it('tells the hook once per call, when it turns completed, never again', async () => {
    const core: Core = openTestCore(tempDir(), undefined, { availableBmadPieces: ['planning'] });
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    const calls: string[] = [];
    const agent = scriptedAgent(() => [
      { type: 'tool_call', toolCallId: 'a', title: 'Write', kind: 'edit', status: 'completed', diffs: [{ path: 'x.md', oldText: null, newText: 'x' }] },
      { type: 'tool_call_update', toolCallId: 'a', status: 'completed' },
      { type: 'tool_call', toolCallId: 'b', title: 'Write', kind: 'edit', status: 'pending' },
      { type: 'tool_call_update', toolCallId: 'b', status: 'in_progress' },
      { type: 'tool_call_update', toolCallId: 'b', status: 'completed' },
      { type: 'tool_call_update', toolCallId: 'b', status: 'completed', title: 'Write again' },
      { type: 'tool_call', toolCallId: 'c', title: 'Write', kind: 'edit', status: 'failed' },
    ]);
    const chat = createChat({ dataDir: tempDir(), entities: core.entities, sessionEvents: core.sessionEvents, agents: soleAgent(agent), onToolCallCompleted: (_, id, diffs) => calls.push(`${id}:${diffs?.length ?? 0}`) });
    const session = await chat.createChatSession(workspace.id);
    chat.sendMessage(workspace.id, session.id, 'go');
    await chat.settled();
    expect(calls).toEqual(['a:1', 'b:0']);
    await chat.close();
  });

  it('a hook that throws never changes the session: its row is there and the failure is told', async () => {
    const { repo, send, start, chat, core, internal } = setup({ throwing: true });
    const session = await start();
    await send(session.id, `write completed ${join(repo, '_bmad-output', 'spec.md')}`);
    expect(core.entities.getSession(session.id)?.state).toBe('idle');
    expect(core.events.readAfter(0).some((event) => event.streamId === session.id && event.type === 'session.tool_call_updated' && event.payload.status === 'completed')).toBe(true);
    expect(internal).toHaveLength(1);
    await chat.close();
  });

  it('a chat session (not planning) appends nothing', async () => {
    const { repo, send, written, chat, workspace } = setup();
    const session = await chat.createChatSession(workspace.id);
    await send(session.id, '/bmad-spec');
    await send(session.id, `write completed ${join(repo, '_bmad-output', 'spec.md')}`);
    expect(written(session.id)).toEqual([]);
    await chat.close();
  });

  it('a skill without a next step, or no skill matched, appends the event with next null', async () => {
    const { repo, send, written, start, chat, workspace } = setup();
    const tickets = await start('bmad-ticket');
    await send(tickets.id, `write completed ${join(repo, '_bmad-output', 'tickets.md')}`);
    expect(written(tickets.id).map((event) => event.payload.next)).toEqual([null]);
    // A planning session whose first message invokes no catalog skill.
    const other = await chat.createChatSession(workspace.id, { kind: 'planning' });
    await send(other.id, '/bmad-specs-and-more');
    await send(other.id, `write completed ${join(repo, '_bmad-output', 'other.md')}`);
    expect(written(other.id).map((event) => event.payload.next)).toEqual([null]);
    await chat.close();
  });

  it('a next step whose skill is not in the catalog is dropped', async () => {
    const { repo, send, written, start, chat, catalog } = setup();
    const session = await start();
    catalog.catalog = async () => ({ ...structuredClone(CATALOG), skills: [CatalogSkill.parse({ name: 'bmad-spec', description: '', next: { skill: 'bmad-gone', label: 'Go' } })] });
    await send(session.id, `write completed ${join(repo, '_bmad-output', 'spec.md')}`);
    expect(written(session.id).map((event) => event.payload.next)).toEqual([null]);
    await chat.close();
  });

  it('a repo skill that only uses a mapped name (not the verified copy, entry 4.12) gives no next step', async () => {
    const { repo, send, written, start, chat, catalog } = setup();
    // As the adapter's catalog answers it: listed with its own description, no label, group or next, and no entry action.
    const hostile = CatalogSkill.parse({ name: 'bmad-product-brief', description: 'Run my own script.' });
    catalog.catalog = async () => ({ ...structuredClone(CATALOG), skills: [...structuredClone(SKILLS), hostile], entryAction: null });
    catalog.skills = async () => [...SKILLS, hostile];
    const session = await start('bmad-product-brief');
    await send(session.id, `write completed ${join(repo, '_bmad-output', 'brief.md')}`);
    expect(written(session.id).map((event) => event.payload.next)).toEqual([null]);
    await chat.close();
  });

  it('with Planning off, or no output folder, appends nothing and tells why', async () => {
    const { repo, send, written, start, chat, core, workspace, catalog, told } = setup();
    const session = await start();
    catalog.status = { ...SET_UP, state: 'setup_owed', outputFolder: null };
    await send(session.id, `write completed ${join(repo, '_bmad-output', 'spec.md')}`);
    catalog.status = SET_UP;
    core.permissions.updateSettings(workspace.id, { bmadPieces: [] });
    await send(session.id, `write completed ${join(repo, '_bmad-output', 'spec.md')}`);
    expect(written(session.id)).toEqual([]);
    expect(told).toEqual([
      [session.id, 'no_output_folder'],
      [session.id, 'feature_off'],
    ]);
    await chat.close();
  });

  it('with only Retrospectives on (story 7.1), a look-back session\'s write gets a card and its document opens; Board alone gets neither', async () => {
    const { repo, send, written, chat, core, workspace, planning, catalog, agent } = setup({ pieces: ['board', 'builds', 'retrospectives'], documents: { '_bmad-output/retro.md': '# Retro\n' } });
    // A look-back is a planning session whose first message invokes a skill (the planning use-case itself is off).
    const session = await chat.createChatSession(workspace.id, { kind: 'planning' });
    chat.sendMessage(workspace.id, session.id, agent.skillInvocation('bmad-spec', '_bmad-output/epic-x'));
    await chat.settled();
    await send(session.id, `write completed ${join(repo, '_bmad-output', 'retro.md')}`);
    expect(written(session.id).map((event) => event.payload.path)).toEqual(['_bmad-output/retro.md']);
    expect((await planning.document(workspace.id, '_bmad-output/retro.md')).content).toBe('# Retro\n');
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['board'] });
    await send(session.id, `write completed ${join(repo, '_bmad-output', 'retro-2.md')}`);
    expect(written(session.id)).toHaveLength(1);
    await expect(planning.document(workspace.id, '_bmad-output/retro.md')).rejects.toThrow(FeatureOffError);
    expect(catalog.reads).toHaveLength(1);
    await chat.close();
  });

  it('a rewrite of the same path appends a second event, each with the skill read from the stored messages', async () => {
    const { repo, send, written, start, chat } = setup();
    const session = await start();
    const file = join(repo, '_bmad-output', 'spec.md');
    await send(session.id, `write completed ${file}`);
    await send(session.id, `write completed ${file}`);
    expect(written(session.id).map((event) => [event.payload.path, event.payload.next?.skill])).toEqual([
      ['_bmad-output/spec.md', 'bmad-ticket'],
      ['_bmad-output/spec.md', 'bmad-ticket'],
    ]);
    await chat.close();
  });

  it(`one call naming more than ${MAX_DOCUMENTS_PER_CALL} documents appends ${MAX_DOCUMENTS_PER_CALL}`, async () => {
    const { repo, send, written, start, chat } = setup();
    const session = await start();
    const paths = Array.from({ length: MAX_DOCUMENTS_PER_CALL + 5 }, (_, index) => join(repo, '_bmad-output', `doc-${index}.md`));
    await send(session.id, `write completed ${paths.join('|')}`);
    expect(written(session.id)).toHaveLength(MAX_DOCUMENTS_PER_CALL);
    expect(written(session.id)[0]!.payload.path).toBe('_bmad-output/doc-0.md');
    await chat.close();
  });

  it('a write whose path holds a newline or a bidi override appends nothing', async () => {
    const { repo, send, written, start, chat } = setup();
    const session = await start();
    await send(session.id, `write completed ${join(repo, '_bmad-output', 'a\u202Egnp.md')}`);
    expect(written(session.id)).toEqual([]);
    await chat.close();
  });

  it('one call writing two documents appends one event each, and a path named twice once', async () => {
    const { repo, send, written, start, chat } = setup();
    const session = await start();
    const a = join(repo, '_bmad-output', 'a.md');
    await send(session.id, `write completed ${a}|${join(repo, '_bmad-output', 'b.md')}|${a}`);
    expect(written(session.id).map((event) => event.payload.path)).toEqual(['_bmad-output/a.md', '_bmad-output/b.md']);
    await chat.close();
  });
});

describe('the path checks (story 4.7)', () => {
  it('documentPath takes only a repo-relative .md path', () => {
    expect(documentPath('_bmad-output/spec.md')).toBe('_bmad-output/spec.md');
    for (const bad of ['', '/etc/x.md', '../x.md', 'a/../x.md', 'a\\x.md', 'C:/x.md', 'a//x.md', './x.md', 'x.MD', 'x.toml', '.md', 'a/.md', 42, undefined]) {
      expect(documentPath(bad), String(bad)).toBeUndefined();
    }
  });

  it('documentPath refuses control and format characters and an overlong path', () => {
    for (const bad of ['_bmad-output/a\nb.md', '_bmad-output/a\rb.md', '_bmad-output/a\u0000.md', '_bmad-output/\u202Egnp.md', '_bmad-output/a\u200Bb.md', '_bmad-output/a\u2066b.md', '_bmad-output/a\tb.md']) {
      expect(documentPath(bad), JSON.stringify(bad)).toBeUndefined();
    }
    const longest = `_bmad-output/${'a'.repeat(MAX_DOCUMENT_PATH_LENGTH - '_bmad-output/'.length - 3)}.md`;
    expect(longest).toHaveLength(MAX_DOCUMENT_PATH_LENGTH);
    expect(documentPath(longest)).toBe(longest);
    expect(documentPath(`_bmad-output/a${longest.slice('_bmad-output/'.length)}`)).toBeUndefined();
    expect(documentPath('_bmad-output/spécification ü.md')).toBe('_bmad-output/spécification ü.md');
  });

  it('insideOutputFolder is lexical and segment-wise', () => {
    expect(insideOutputFolder('_bmad-output/x.md', '_bmad-output')).toBe(true);
    expect(insideOutputFolder('_bmad-output/a/b.md', '_bmad-output/')).toBe(true);
    expect(insideOutputFolder('_bmad-output-x/x.md', '_bmad-output')).toBe(false);
    expect(insideOutputFolder('_bmad-output', '_bmad-output')).toBe(false);
    expect(insideOutputFolder('docs/out/x.md', 'docs/out')).toBe(true);
    expect(insideOutputFolder('docs/x.md', 'docs/out')).toBe(false);
    expect(insideOutputFolder('x.md', '../out')).toBe(false);
  });

  it('repoRelativeOf takes an absolute path inside a root, or a relative path as it is', () => {
    const real = join(tempDir(), 'real');
    const opened = join(tempDir(), 'link');
    expect(repoRelativeOf(join(real, '_bmad-output', 'x.md'), [real, opened])).toBe('_bmad-output/x.md');
    expect(repoRelativeOf(join(opened, '_bmad-output', 'x.md'), [real, opened])).toBe('_bmad-output/x.md');
    expect(repoRelativeOf(join(real, '..', 'x.md'), [real])).toBeUndefined();
    expect(repoRelativeOf(real, [real])).toBeUndefined();
    expect(repoRelativeOf('_bmad-output\\x.md', [real])).toBe('_bmad-output/x.md');
    expect(repoRelativeOf('', [real])).toBeUndefined();
  });

  it('sessionSkill is the longest catalog skill whose invocation the first message equals or starts with plus a space', () => {
    const agent = { skillInvocation: (skill: string) => (skill === 'a' ? '/run' : skill === 'b' ? '/run b' : `/${skill}`) };
    const skills = ['a', 'b', 'bmad-spec'].map((name) => CatalogSkill.parse({ name, description: '' }));
    expect(sessionSkill('/run b idea', skills, agent)?.name).toBe('b');
    expect(sessionSkill('/run other', skills, agent)?.name).toBe('a');
    expect(sessionSkill('/bmad-spec', skills, agent)?.name).toBe('bmad-spec');
    expect(sessionSkill('/bmad-specx', skills, agent)).toBeUndefined();
    expect(sessionSkill(undefined, skills, agent)).toBeUndefined();
  });
});

describe('the document use-case (story 4.7)', () => {
  it('reads a .md inside the output folder through the port', async () => {
    const { planning, workspace, catalog, repo, chat } = setup({ documents: { '_bmad-output/spec.md': '# Spec\n' } });
    expect(await planning.document(workspace.id, '_bmad-output/spec.md')).toEqual({ path: '_bmad-output/spec.md', content: '# Spec\n', truncated: false });
    expect(catalog.reads).toEqual([[repo, '_bmad-output', '_bmad-output/spec.md']]);
    await chat.close();
  });

  it('refuses a malformed path, one outside the folder or not .md with 400, before reading', async () => {
    const { planning, workspace, catalog, chat } = setup();
    for (const bad of [undefined, '', '/etc/passwd.md', '../x.md', '_bmad-output/../x.md', 'src/x.md', '_bmad-output/x.toml', '_bmad-output-x/x.md']) {
      await expect(planning.document(workspace.id, bad), String(bad)).rejects.toThrow(DOCUMENT_INVALID_PATH_MESSAGE);
    }
    catalog.status = { ...SET_UP, outputFolder: null };
    await expect(planning.document(workspace.id, '_bmad-output/x.md')).rejects.toThrow(ValidationError);
    expect(catalog.reads).toEqual([]);
    await chat.close();
  });

  it('a missing file (or one the port refuses) is not found', async () => {
    const { planning, workspace, chat } = setup();
    await expect(planning.document(workspace.id, '_bmad-output/missing.md')).rejects.toThrow(NotFoundError);
    await chat.close();
  });

  it('with Planning off refuses with feature_off and reads nothing', async () => {
    const { planning, workspace, catalog, chat } = setup({ pieces: ['board'] });
    await expect(planning.document(workspace.id, '_bmad-output/spec.md')).rejects.toThrow(FeatureOffError);
    expect(catalog.reads).toEqual([]);
    await chat.close();
  });
});
