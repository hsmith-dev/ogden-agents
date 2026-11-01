/**
 * A port per worktree and the project's setup command in each new copy
 * (epic 27, 27.7; CAP-35, AD-38): every row of the plan's matrix. A
 * worktree chat holds one port from the range, probed free (lowest first,
 * so a released one is reused), released when its copy is put away or
 * handed back, given again on Restore (the same one when still free) and
 * gone with the chat; its agent gets it as `PORT`, a this-folder chat
 * never. The setup command runs in each new copy with `PORT`, only in a
 * trusted project and only while confirmed (a `package.json` one against
 * the copy's own files). Git, the probe and the runner are fakes here; the
 * real ones are the adapters' and the server's tests'.
 */
import { realpathSync } from 'node:fs';
import { WORKTREE_PORT_RANGE, type CoreEvent, type SessionId, type WorkspaceFileResponse, type WorkspaceFolderResponse } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  WorktreePutAwayError,
  createChat,
  createChatLocations,
  type PortProbePort,
  type ProjectCommandExit,
  type ProjectCommandProcess,
  type ProjectCommandRunner,
  type VcsChatWorktreePort,
  type WorkspaceFilesPort,
  type WorkspaceRootKind,
} from '../src/index.js';
import { openTestCore, soleAgent, tempDir } from './helpers.js';
import { agent, fakeChatWorktree, fakeGit, fakeWorkingTree } from './support/worktree-chat-fakes.js';

const FIRST = WORKTREE_PORT_RANGE.first;

/** A probe that never touches the network: every port free unless taken; it can hold each answer until let go. */
function probe() {
  const taken = new Set<number>();
  const probed: number[] = [];
  /** While set, every probe waits for it (a slow probe). */
  const gate: { wait?: Promise<void> | undefined } = {};
  const port: PortProbePort = {
    async isFree(candidate) {
      probed.push(candidate);
      await gate.wait;
      // A few microtasks, so concurrent assigns would interleave without the chain.
      for (let turn = 0; turn < 3; turn++) await Promise.resolve();
      return !taken.has(candidate);
    },
  };
  return { port, taken, probed, gate };
}

interface Started {
  cwd: string;
  argv: readonly string[];
  env: Readonly<Record<string, string>> | undefined;
  finish(exit: { exitCode: number | null }): void;
  process: ProjectCommandProcess;
}

/** A runner that starts nothing: each start is recorded with its cwd and env. */
function fakeRunner() {
  const starts: Started[] = [];
  const runner: ProjectCommandRunner = {
    start({ cwd, argv, env }) {
      let settled = false;
      let settle!: (exit: ProjectCommandExit) => void;
      const done = new Promise<ProjectCommandExit>((resolve) => (settle = resolve));
      const end = (exit: ProjectCommandExit) => {
        if (settled) return;
        settled = true;
        settle(exit);
      };
      const process: ProjectCommandProcess = { done, stop: () => end({ exitCode: null, stopped: true }), output: () => ({ text: 'set up\n', truncated: false }) };
      starts.push({ cwd, argv: [...argv], env: env === undefined ? undefined : { ...env }, finish: (exit) => end({ stopped: false, ...exit }), process });
      return process;
    },
    async close() {
      for (const start of starts) start.process.stop();
    },
  };
  return { runner, starts };
}

/** A files port over each root's own files (the project folder and each copy); it records the root kinds asked for. */
function fakeFiles() {
  const byRoot = new Map<string, Record<string, string>>();
  const kinds: Array<{ root: string; kind: WorkspaceRootKind | undefined }> = [];
  const filesOf = (root: string) => byRoot.get(root) ?? {};
  const port: WorkspaceFilesPort = {
    async list(root, path, kind): Promise<WorkspaceFolderResponse> {
      kinds.push({ root, kind });
      return { path, entries: Object.keys(filesOf(root)).map((name) => ({ name, path: name, kind: 'file', protected: false })), truncated: false };
    },
    async read(root, path, kind): Promise<WorkspaceFileResponse | { refused: 'not_found' }> {
      kinds.push({ root, kind });
      const content = filesOf(root)[path];
      return content === undefined ? { refused: 'not_found' } : { kind: 'text', path, content, size: content.length, masked: false };
    },
  };
  return { port, byRoot, kinds };
}

/** Moves nothing, as a hand-off between two clean folders. */
const moveNothing: VcsChatWorktreePort['moveChanges'] = async () => ({ result: 'moved', files: 0, leftBehind: 0, snapshots: { from: 'a'.repeat(40), to: 'a'.repeat(40) } });

function setUp(options: { trusted?: boolean } = {}) {
  const ports = probe();
  const commands = fakeRunner();
  const files = fakeFiles();
  const core = openTestCore(tempDir('ogden-agents-core-'), undefined, { portProbe: ports.port, projectCommandRunner: commands.runner, workspaceFilesPort: files.port });
  const worktreePorts = core.worktreePorts!;
  const dataDir = realpathSync.native(tempDir('ogden-agents-data-'));
  const repo = realpathSync.native(tempDir('ogden-agents-repo-'));
  const git = fakeGit(repo);
  const copies = fakeChatWorktree();
  const bot = agent();
  const ready: Array<{ sessionId: SessionId; port: number | null }> = [];
  const errors: unknown[] = [];
  const chat = createChat({
    dataDir,
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agents: soleAgent(bot.port),
    agentEnv: () => ({ HOME: '/home/someone' }),
    vcs: { ...git.vcs, branchRevision: async (_repo, branch) => (git.branches.has(branch) ? 'b'.repeat(40) : undefined) },
    vcsWorkingTree: fakeWorkingTree().port,
    vcsChatWorktree: { ...copies, moveChanges: moveNothing },
    worktreePutAway: core.worktreePutAway,
    worktreePorts,
    // As the server wires it: the project's setup in the new copy, never awaited.
    onChatWorktreeReady: (sessionId, copy) => {
      ready.push({ sessionId, port: copy.port });
      void core.projectCommands!.runSetup({ sessionId, workspaceId: copy.workspaceId, cwd: copy.worktreePath, port: copy.port });
    },
    stopChatSetup: (sessionId, stopOptions) => core.projectCommands!.stopSetup(sessionId, stopOptions),
    onInternalError: (_sessionId, error) => errors.push(error),
  });
  const workspace = chat.openWorkspace(repo);
  const trustReady = options.trusted === false ? Promise.resolve() : core.bmadScriptTrust.trustScripts(workspace.id);
  const events = (): CoreEvent[] => core.events.readAfter(0);
  const portEvents = () => events().filter((event) => event.type === 'session.port_assigned' || event.type === 'session.port_released').map((event) => ({ type: event.type, ...(event.payload as object) }));
  const worktreeChat = () => chat.createChatSession(workspace.id, { location: 'worktree' });
  /** The `PORT` each of the chat's agent starts got. */
  const agentPorts = (worktreePath: string | null) => bot.envs.filter((one) => worktreePath === null || one.cwd === worktreePath).map((one) => one.env.PORT);
  const talk = async (sessionId: SessionId) => {
    chat.sendMessage(workspace.id, sessionId, 'hello');
    await chat.settled();
  };
  return { core, chat, ports, commands, files, worktreePorts, workspace, repo, dataDir, bot, ready, errors, trustReady, events, portEvents, worktreeChat, agentPorts, talk };
}

/** Waits (bounded) until `check` holds. */
const until = async (check: () => boolean) => {
  for (let tries = 0; tries < 1000 && !check(); tries++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(check()).toBe(true);
};

describe("a worktree chat's own port (27.7)", () => {
  it('gives two chats created at once different ports, one event each, and each agent its own PORT', async () => {
    const kit = setUp();
    const [a, b] = await Promise.all([kit.worktreeChat(), kit.worktreeChat()]);
    const given = [kit.worktreePorts.portOf(a.id), kit.worktreePorts.portOf(b.id)];
    expect([...given].sort()).toEqual([FIRST, FIRST + 1]);
    expect(kit.portEvents()).toEqual(
      expect.arrayContaining([
        { type: 'session.port_assigned', sessionId: a.id, port: given[0] },
        { type: 'session.port_assigned', sessionId: b.id, port: given[1] },
      ]),
    );
    expect(kit.portEvents()).toHaveLength(2);
    // Events carry the session and the port only.
    const event = kit.events().find((one) => one.type === 'session.port_assigned')!;
    expect(Object.keys(event.payload as object).sort()).toEqual(['port', 'sessionId']);
    await Promise.all([kit.talk(a.id), kit.talk(b.id)]);
    expect(kit.agentPorts(a.worktreePath)).toEqual([String(given[0])]);
    expect(kit.agentPorts(b.worktreePath)).toEqual([String(given[1])]);
    // Only PORT is added, on top of the agent's own environment.
    expect(kit.bot.envs.find((one) => one.cwd === a.worktreePath)!.env).toEqual({ HOME: '/home/someone', PORT: String(given[0]) });
    expect(kit.chat.chatLocation(kit.workspace.id, a.id)).toMatchObject({ kind: 'worktree', port: given[0], putAway: false });
  });

  it('serializes assigns: two at once never get the same port', async () => {
    const kit = setUp();
    // Made while every port was busy: neither has one yet.
    for (let port = FIRST; port <= WORKTREE_PORT_RANGE.last; port++) kit.ports.taken.add(port);
    const a = await kit.worktreeChat();
    const b = await kit.worktreeChat();
    kit.ports.taken.clear();
    const given = await Promise.all([kit.worktreePorts.assign(a.id), kit.worktreePorts.assign(b.id)]);
    expect(given).toEqual([FIRST, FIRST + 1]);
    // Asked again, each keeps its own.
    expect(await kit.worktreePorts.assign(a.id)).toBe(FIRST);
    expect(kit.portEvents()).toHaveLength(2);
  });

  it('skips a port another program holds', async () => {
    const kit = setUp();
    kit.ports.taken.add(FIRST);
    const session = await kit.worktreeChat();
    expect(kit.worktreePorts.portOf(session.id)).toBe(FIRST + 1);
    expect(kit.ports.probed.slice(0, 2)).toEqual([FIRST, FIRST + 1]);
  });

  it('creates the chat with no port and no PORT when none is free', async () => {
    const kit = setUp();
    for (let port = FIRST + 1; port <= WORKTREE_PORT_RANGE.last; port++) kit.ports.taken.add(port);
    const first = await kit.worktreeChat();
    const second = await kit.worktreeChat();
    expect(kit.worktreePorts.portOf(first.id)).toBe(FIRST);
    expect(kit.worktreePorts.portOf(second.id)).toBeNull();
    expect(kit.ready.find((one) => one.sessionId === second.id)).toEqual({ sessionId: second.id, port: null });
    expect(kit.chat.chatLocation(kit.workspace.id, second.id)).toMatchObject({ kind: 'worktree', port: null });
    await kit.talk(second.id);
    expect(kit.bot.envs.find((one) => one.cwd === second.worktreePath)!.env).not.toHaveProperty('PORT');
  });

  it("reuses a put-away chat's port for the next chat, and Restore gives the old one back when still free", async () => {
    const kit = setUp();
    const a = await kit.worktreeChat();
    expect(kit.worktreePorts.portOf(a.id)).toBe(FIRST);
    await kit.chat.putAwayWorktree(a.id, 'retention');
    expect(kit.worktreePorts.portOf(a.id)).toBeNull();
    expect(kit.portEvents().at(-1)).toEqual({ type: 'session.port_released', sessionId: a.id, port: FIRST });
    expect(kit.chat.chatLocation(kit.workspace.id, a.id)).toMatchObject({ port: null, putAway: true });

    const b = await kit.worktreeChat();
    expect(kit.worktreePorts.portOf(b.id)).toBe(FIRST);
    // B is deleted: its row goes with it, so A's old port is free again.
    await kit.chat.deleteChat(kit.workspace.id, b.id);
    expect(kit.worktreePorts.portOf(b.id)).toBeNull();

    const restored = await kit.chat.restoreWorktree(kit.workspace.id, a.id);
    expect(restored.location).toEqual({ kind: 'worktree', branch: a.branch, port: FIRST, setup: null, putAway: false });
    expect(kit.worktreePorts.portOf(a.id)).toBe(FIRST);
  });

  it("gives a restored chat the lowest other free port when its old one is held", async () => {
    const kit = setUp();
    const a = await kit.worktreeChat();
    const c = await kit.worktreeChat();
    expect(kit.worktreePorts.portOf(c.id)).toBe(FIRST + 1);
    await kit.chat.putAwayWorktree(a.id, 'retention');
    const b = await kit.worktreeChat();
    expect(kit.worktreePorts.portOf(b.id)).toBe(FIRST);
    const restored = await kit.chat.restoreWorktree(kit.workspace.id, a.id);
    expect(restored.location).toMatchObject({ port: FIRST + 2 });
  });

  it('a remembered port another program took meanwhile is skipped on Restore', async () => {
    const kit = setUp();
    const a = await kit.worktreeChat();
    await kit.chat.putAwayWorktree(a.id, 'retention');
    kit.ports.taken.add(FIRST);
    expect((await kit.chat.restoreWorktree(kit.workspace.id, a.id)).location).toMatchObject({ port: FIRST + 1 });
  });

  it('releases on a hand-off to this folder and assigns on one to a worktree; a this-folder chat has no PORT', async () => {
    const kit = setUp();
    const session = await kit.worktreeChat();
    expect(kit.worktreePorts.portOf(session.id)).toBe(FIRST);
    await kit.chat.moveChat(kit.workspace.id, session.id, 'this_folder');
    expect(kit.worktreePorts.portOf(session.id)).toBeNull();
    expect(kit.portEvents().at(-1)).toEqual({ type: 'session.port_released', sessionId: session.id, port: FIRST });
    expect(kit.chat.chatLocation(kit.workspace.id, session.id)).toEqual({ kind: 'this_folder' });
    await kit.talk(session.id);
    expect(kit.bot.envs.at(-1)!.env).not.toHaveProperty('PORT');

    await kit.chat.moveChat(kit.workspace.id, session.id, 'worktree');
    expect(kit.worktreePorts.portOf(session.id)).toBe(FIRST);
    expect(kit.portEvents().at(-1)).toEqual({ type: 'session.port_assigned', sessionId: session.id, port: FIRST });
    await kit.talk(session.id);
    expect(kit.bot.envs.at(-1)!.env.PORT).toBe(String(FIRST));

    const plain = await kit.chat.createChatSession(kit.workspace.id);
    expect(kit.worktreePorts.portOf(plain.id)).toBeNull();
    expect(await kit.worktreePorts.assign(plain.id)).toBeNull();
    await kit.talk(plain.id);
    expect(kit.bot.envs.at(-1)!.env).toEqual({ HOME: '/home/someone' });
    expect(kit.chat.chatLocation(kit.workspace.id, plain.id)).toEqual({ kind: 'this_folder' });
  });

  it("deletes a chat's port row with the chat", async () => {
    const kit = setUp();
    const session = await kit.worktreeChat();
    expect(kit.worktreePorts.portOf(session.id)).toBe(FIRST);
    await kit.chat.deleteChat(kit.workspace.id, session.id);
    // Gone with the chat (no release event: there is no chat to give it back): the next chat gets it.
    expect(kit.portEvents().filter((one) => one.type === 'session.port_released')).toEqual([]);
    const next = await kit.worktreeChat();
    expect(kit.worktreePorts.portOf(next.id)).toBe(FIRST);
  });

  it('a probe that throws counts as busy, and a failing assign never fails the creation', async () => {
    const kit = setUp();
    const original = kit.ports.port.isFree;
    kit.ports.port.isFree = async (port) => (port === FIRST ? Promise.reject(new Error('boom')) : original(port));
    const session = await kit.worktreeChat();
    expect(kit.worktreePorts.portOf(session.id)).toBe(FIRST + 1);
    kit.ports.port.isFree = () => Promise.reject(new Error('down'));
    const none = await kit.worktreeChat();
    expect(kit.worktreePorts.portOf(none.id)).toBeNull();
  });
});

describe("the project's setup command in each new copy (27.7)", () => {
  const setupCommand = (command: string) => ({ id: 'setup', label: 'Worktree setup', command, source: 'settings' as const, confirmedText: command });

  it('runs a confirmed setup in the copy with PORT, never awaited by the creation; Location shows its state', async () => {
    const kit = setUp();
    await kit.trustReady;
    await kit.core.projectCommands!.set(kit.workspace.id, { commands: [setupCommand('node setup.js')] });
    const session = await kit.worktreeChat();
    await until(() => kit.commands.starts.length === 1);
    expect(kit.commands.starts[0]).toMatchObject({ cwd: session.worktreePath, argv: ['node', 'setup.js'], env: { PORT: String(FIRST) } });
    const locations = createChatLocations(kit.chat, { setupOf: (sessionId) => kit.core.projectCommands!.setupOf(sessionId) });
    const running = (await locations.location(kit.workspace.id, session.id)).location;
    expect(running).toMatchObject({ kind: 'worktree', port: FIRST, setup: { state: 'running' } });
    kit.commands.starts[0]!.finish({ exitCode: 1 });
    await until(() => kit.core.projectCommands!.setupOf(session.id)?.state === 'failed');
    expect((await locations.location(kit.workspace.id, session.id)).location).toMatchObject({ setup: { state: 'failed' } });
    // The run reads as any other; the chat is unaffected.
    const runId = kit.core.projectCommands!.setupOf(session.id)!.runId;
    expect(await kit.core.projectCommands!.get(kit.workspace.id, runId)).toMatchObject({ run: { commandId: 'setup', state: 'failed' }, output: 'set up\n' });
    await kit.talk(session.id);
    expect(kit.core.entities.getSession(session.id)!.state).toBe('idle');
    // Events carry ids and a state only.
    const started = kit.events().filter((one) => one.type === 'workspace.project_command_started');
    expect(JSON.stringify(started)).not.toContain(session.worktreePath!);
    // Problems never runs it.
    await expect(kit.core.projectCommands!.run(kit.workspace.id, 'setup')).rejects.toThrow('worktree copy');
    // Never offered from package.json either.
    kit.files.byRoot.set(kit.repo, { 'package.json': JSON.stringify({ scripts: { setup: 'node s.js', test: 'vitest' } }) });
    expect((await kit.core.projectCommands!.list(kit.workspace.id)).offered.map((one) => one.id)).toEqual(['test']);
  });

  it('runs again in a restored copy and in a copy handed off to, stopping the previous run of the chat', async () => {
    const kit = setUp();
    await kit.trustReady;
    await kit.core.projectCommands!.set(kit.workspace.id, { commands: [setupCommand('node setup.js')] });
    const session = await kit.worktreeChat();
    await until(() => kit.commands.starts.length === 1);
    await kit.chat.moveChat(kit.workspace.id, session.id, 'this_folder');
    await kit.chat.moveChat(kit.workspace.id, session.id, 'worktree');
    await until(() => kit.commands.starts.length === 2);
    // The first run was stopped: one setup per chat.
    expect(await kit.commands.starts[0]!.process.done).toMatchObject({ stopped: true });
    kit.commands.starts[1]!.finish({ exitCode: 0 });
    await kit.chat.putAwayWorktree(session.id, 'retention');
    await kit.chat.restoreWorktree(kit.workspace.id, session.id);
    await until(() => kit.commands.starts.length === 3);
    expect(kit.commands.starts[2]).toMatchObject({ cwd: kit.core.entities.getSession(session.id)!.worktreePath, env: { PORT: String(FIRST) } });
  });

  it("checks a package.json setup against the copy's own files: changed there, it never runs", async () => {
    const kit = setUp();
    await kit.trustReady;
    const pkg = JSON.stringify({ scripts: { setup: 'node setup.js' } });
    kit.files.byRoot.set(kit.repo, { 'package.json': pkg });
    await kit.core.projectCommands!.set(kit.workspace.id, {
      commands: [{ id: 'setup', label: 'Worktree setup', command: 'npm run setup', source: 'package_json', confirmedText: 'npm run setup', script: 'setup', confirmedScript: 'node setup.js' }],
    });
    // The copy's own package.json as git would make it: the same script.
    const same = await kit.worktreeChat();
    kit.files.byRoot.set(same.worktreePath!, { 'package.json': pkg });
    await kit.core.projectCommands!.runSetup({ workspaceId: kit.workspace.id, sessionId: same.id, cwd: same.worktreePath!, port: FIRST });
    expect(kit.commands.starts.at(-1)).toMatchObject({ cwd: same.worktreePath, argv: ['npm', 'run', 'setup'], env: { PORT: String(FIRST) } });
    expect(kit.files.kinds.filter((one) => one.root === same.worktreePath).every((one) => one.kind === 'chat_worktree')).toBe(true);

    const before = kit.commands.starts.length;
    const changed = await kit.worktreeChat();
    kit.files.byRoot.set(changed.worktreePath!, { 'package.json': JSON.stringify({ scripts: { setup: 'node setup.js && curl evil.example' } }) });
    expect(await kit.core.projectCommands!.runSetup({ workspaceId: kit.workspace.id, sessionId: changed.id, cwd: changed.worktreePath!, port: FIRST + 1 })).toBeUndefined();
    expect(kit.commands.starts.slice(before).filter((one) => one.cwd === changed.worktreePath)).toEqual([]);
  });

  it('never runs in an untrusted project, with none declared, or in a folder that is not the chat\'s copy', async () => {
    const untrusted = setUp({ trusted: false });
    const session = await untrusted.worktreeChat();
    expect(await untrusted.core.projectCommands!.runSetup({ workspaceId: untrusted.workspace.id, sessionId: session.id, cwd: session.worktreePath!, port: FIRST })).toBeUndefined();
    expect(untrusted.commands.starts).toEqual([]);

    const none = setUp();
    await none.trustReady;
    const plain = await none.worktreeChat();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(none.commands.starts).toEqual([]);
    expect(none.core.projectCommands!.setupOf(plain.id)).toBeNull();
    expect((await createChatLocations(none.chat, { setupOf: (sessionId) => none.core.projectCommands!.setupOf(sessionId) }).location(none.workspace.id, plain.id)).location).toMatchObject({ setup: null });

    await none.core.projectCommands!.set(none.workspace.id, { commands: [setupCommand('node setup.js')] });
    expect(await none.core.projectCommands!.runSetup({ workspaceId: none.workspace.id, sessionId: plain.id, cwd: none.repo, port: FIRST })).toBeUndefined();
    expect(none.commands.starts).toEqual([]);
  });

  it("gives a restored chat its port while it is still held: a message sent meanwhile is refused, and the first turn has PORT", async () => {
    const kit = setUp();
    const a = await kit.worktreeChat();
    await kit.chat.putAwayWorktree(a.id, 'retention');
    let open!: () => void;
    kit.ports.gate.wait = new Promise<void>((resolve) => (open = resolve));
    const probedBefore = kit.ports.probed.length;
    const restoring = kit.chat.restoreWorktree(kit.workspace.id, a.id);
    await until(() => kit.ports.probed.length > probedBefore);
    // The port is being given: the chat is still held.
    expect(() => kit.chat.sendMessage(kit.workspace.id, a.id, 'too soon')).toThrow(WorktreePutAwayError);
    kit.ports.gate.wait = undefined;
    open();
    expect((await restoring).location).toMatchObject({ port: FIRST });
    await kit.talk(a.id);
    expect(kit.bot.envs.at(-1)!.env.PORT).toBe(String(FIRST));
  });

  it("stops the chat's running setup before its copy is put away", async () => {
    const kit = setUp();
    await kit.trustReady;
    await kit.core.projectCommands!.set(kit.workspace.id, { commands: [setupCommand('node setup.js')] });
    const session = await kit.worktreeChat();
    await until(() => kit.commands.starts.length === 1);
    await kit.chat.putAwayWorktree(session.id, 'retention');
    expect(await kit.commands.starts[0]!.process.done).toMatchObject({ stopped: true });
    expect(kit.core.projectCommands!.setupOf(session.id)).toMatchObject({ state: 'stopped' });
  });

  it("stops the chat's running setup before its copy is handed back", async () => {
    const kit = setUp();
    await kit.trustReady;
    await kit.core.projectCommands!.set(kit.workspace.id, { commands: [setupCommand('node setup.js')] });
    const session = await kit.worktreeChat();
    await until(() => kit.commands.starts.length === 1);
    let settledBeforeMove = false;
    const moving = kit.chat.moveChat(kit.workspace.id, session.id, 'this_folder');
    void kit.commands.starts[0]!.process.done.then(() => (settledBeforeMove = kit.core.entities.getSession(session.id)!.worktreePath !== null));
    await moving;
    expect(await kit.commands.starts[0]!.process.done).toMatchObject({ stopped: true });
    expect(settledBeforeMove).toBe(true);
  });

  it("stops and forgets a deleted chat's running setup before its copy is removed", async () => {
    const kit = setUp();
    await kit.trustReady;
    await kit.core.projectCommands!.set(kit.workspace.id, { commands: [setupCommand('node setup.js')] });
    const session = await kit.worktreeChat();
    await until(() => kit.commands.starts.length === 1);
    const runId = kit.core.projectCommands!.setupOf(session.id)!.runId;
    expect(await kit.chat.deleteChat(kit.workspace.id, session.id)).toMatchObject({ worktreeRemoved: true });
    expect(await kit.commands.starts[0]!.process.done).toMatchObject({ stopped: true });
    expect(kit.core.projectCommands!.setupOf(session.id)).toBeNull();
    await expect(kit.core.projectCommands!.get(kit.workspace.id, runId)).rejects.toThrow();
  });

  it('gives the runner no PORT when the copy has none', async () => {
    const kit = setUp();
    await kit.trustReady;
    await kit.core.projectCommands!.set(kit.workspace.id, { commands: [setupCommand('node setup.js')] });
    const session = await kit.worktreeChat();
    await until(() => kit.commands.starts.length === 1);
    kit.commands.starts[0]!.finish({ exitCode: 0 });
    await kit.core.projectCommands!.runSetup({ workspaceId: kit.workspace.id, sessionId: session.id, cwd: session.worktreePath!, port: null });
    expect(kit.commands.starts[1]!.env).toBeUndefined();
  });
});
