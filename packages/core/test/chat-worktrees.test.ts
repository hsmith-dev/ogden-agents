/**
 * A chat started in its own worktree (epic 27, 27.1; CAP-35): the worktree
 * is `<data>/cw/<8>` on `ogden/chat/<ses>` from the project's commit, made
 * through `VcsPort`, stored as the chat's `worktreePath` and `branch`, and
 * its agent and terminal run there. Every refusal makes no chat and no
 * folder. Git is a fake here (core depends on no adapter); the real git is
 * `tests/e2e/composer-setup-row.spec.ts`'s.
 */
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { CHAT_WORKTREE_FAILED_TEXT, CHAT_WORKTREE_NOT_REPO_TEXT, CHAT_WORKTREE_NOT_TOP_TEXT, chatWorktreeBranch } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  CHAT_WORKTREES_DIR,
  createChat,
  InvalidOperationError,
  isChatWorktreePath,
  newId,
  ValidationError,
  type AgentEvent,
  type AgentPort,
  type AgentSession,
  type Core,
  type StartAgentSession,
  type TerminalPort,
  type VcsPort,
} from '../src/index.js';
import { openTestCore, soleAgent, tempDir } from './helpers.js';
import { fakeTerminal } from './support/fake-terminal.js';

const REVISION = 'a'.repeat(40);

/** An agent that records each start's `cwd`, answers at once, and can hand its chat to a terminal. */
function recordingAgent() {
  const cwds: string[] = [];
  const transcriptCwds: string[] = [];
  const open = (input: StartAgentSession, agentSessionId: string): AgentSession => {
    cwds.push(input.cwd);
    const listeners = new Set<(event: AgentEvent) => void>();
    return {
      agentSessionId,
      onEvent(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async prompt() {
        for (const listener of [...listeners]) listener({ type: 'state', state: 'working' });
        for (const listener of [...listeners]) listener({ type: 'message_chunk', text: 'ok' });
        for (const listener of [...listeners]) listener({ type: 'state', state: 'idle' });
        return { stopReason: 'end_turn' };
      },
      async cancel() {},
      async close() {},
    };
  };
  let sessions = 0;
  const port: AgentPort = {
    displayName: 'Test Agent',
    skillInvocation: (skill) => `/${skill}`,
    listAuthMethods: async () => [],
    startSession: async (input) => open(input, `agent-${++sessions}`),
    reopenSession: async (input) => ({ session: open(input, input.agentSessionId), restored: 'resumed' as const }),
    terminalResume: {
      command: async (id, env) => ({ file: 'agent', args: ['--resume', id], env: { ...env } }),
      locate: async () => ({ found: true }),
      transcript: async (input) => {
        transcriptCwds.push(input.cwd);
        return [];
      },
    },
  };
  return { port, cwds, transcriptCwds };
}

/** A fake git: the project is a repository's top folder with a commit unless told otherwise; `addWorktree` makes the folder. */
function fakeVcs(repo: string) {
  const calls: string[] = [];
  let top: string | undefined = repo;
  let head: { revision: string; branch: string } | undefined = { revision: REVISION, branch: 'main' };
  let fails = false;
  const vcs: Pick<VcsPort, 'topLevel' | 'head' | 'addWorktree' | 'removeWorktree' | 'isMerged'> = {
    async topLevel(path) {
      calls.push(`topLevel ${path}`);
      return top;
    },
    async head(path) {
      calls.push(`head ${path}`);
      return head;
    },
    async addWorktree(path, input) {
      calls.push(`addWorktree ${path} ${input.path} ${input.branch} ${input.base}`);
      mkdirSync(input.path);
      if (fails) throw new Error('git failed');
    },
    async removeWorktree(path, worktree, options = {}) {
      calls.push(`removeWorktree ${path} ${worktree}${options.deleteBranch === undefined ? '' : ` ${options.deleteBranch}`}`);
      rmSync(worktree, { recursive: true, force: true });
      return { branchKept: false };
    },
    async isMerged() {
      return true;
    },
  };
  return {
    vcs,
    calls,
    notARepo: () => (top = undefined),
    topIs: (path: string) => (top = path),
    noCommit: () => (head = undefined),
    fail: () => (fails = true),
  };
}

function setUp(options: { core?: Core; terminal?: TerminalPort; withVcs?: boolean } = {}) {
  const core = options.core ?? openTestCore();
  const agent = recordingAgent();
  const dataDir = tempDir('ogden-agents-data-');
  const repo = realpathSync.native(tempDir('ogden-agents-repo-'));
  const git = fakeVcs(repo);
  const chat = createChat({
    dataDir,
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agents: soleAgent(agent.port),
    agentEnv: () => ({}),
    ...(options.withVcs === false ? {} : { vcs: git.vcs }),
    ...(options.terminal === undefined ? {} : { terminal: options.terminal }),
  });
  const workspace = chat.openWorkspace(repo);
  return { core, chat, agent, dataDir, repo, git, workspace };
}

const refusal = async (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => error as Error,
  );

describe('a chat started in its own worktree (27.1)', () => {
  it('makes <data>/cw/<8> on ogden/chat/<ses> from HEAD, stores it, and runs the agent there', async () => {
    const { chat, agent, dataDir, repo, git, workspace, core } = setUp();
    const session = await chat.createChatSession(workspace.id, { location: 'worktree' });

    expect(session.branch).toBe(chatWorktreeBranch(session.id));
    expect(session.worktreePath).not.toBeNull();
    const path = session.worktreePath!;
    expect(basename(path)).toMatch(/^[a-z2-7]{8}$/);
    expect(dirname(path)).toBe(realpathSync.native(join(dataDir, CHAT_WORKTREES_DIR)));
    expect(isChatWorktreePath(dataDir, path)).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(git.calls).toContain(`addWorktree ${repo} ${join(dataDir, CHAT_WORKTREES_DIR, basename(path))} ${chatWorktreeBranch(session.id)} ${REVISION}`);
    // Stored: the read gives the same place.
    expect(core.entities.getSession(session.id)).toMatchObject({ worktreePath: path, branch: chatWorktreeBranch(session.id) });

    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();
    expect(agent.cwds).toEqual([path]);
  });

  it('This folder (or no location) is a chat as before: no git, the project folder', async () => {
    const { chat, agent, repo, git, workspace } = setUp();
    const first = await chat.createChatSession(workspace.id, { location: 'this_folder' });
    const second = await chat.createChatSession(workspace.id);
    for (const session of [first, second]) {
      expect(session).toMatchObject({ worktreePath: null, branch: null });
      chat.sendMessage(workspace.id, session.id, 'hello');
    }
    await chat.settled();
    expect(git.calls).toEqual([]);
    expect(agent.cwds).toEqual([repo, repo]);
  });

  it.each([
    ['not a repository', (git: ReturnType<typeof fakeVcs>) => git.notARepo(), CHAT_WORKTREE_NOT_REPO_TEXT],
    ['a folder inside another repository', (git: ReturnType<typeof fakeVcs>, repo: string) => git.topIs(dirname(repo)), CHAT_WORKTREE_NOT_TOP_TEXT],
    ['a repository with no commit', (git: ReturnType<typeof fakeVcs>) => git.noCommit(), CHAT_WORKTREE_NOT_REPO_TEXT],
    ['git failing', (git: ReturnType<typeof fakeVcs>) => git.fail(), CHAT_WORKTREE_FAILED_TEXT],
  ])('refuses %s, making no chat and leaving no folder', async (_name, arrange, message) => {
    const { chat, dataDir, repo, git, workspace } = setUp();
    arrange(git, repo);
    const error = await refusal(chat.createChatSession(workspace.id, { location: 'worktree' }));
    expect(error).toBeInstanceOf(InvalidOperationError);
    expect(error?.message).toBe(message);
    expect(chat.listSessions(workspace.id)).toEqual([]);
    const root = join(dataDir, CHAT_WORKTREES_DIR);
    expect(existsSync(root) ? readdirSync(root) : []).toEqual([]);
  });

  it('refuses a remote machine with a worktree (validation), before any git', async () => {
    const { chat, git, workspace } = setUp();
    const error = await refusal(chat.createChatSession(workspace.id, { location: 'worktree', machineId: newId('mach') }));
    expect(error).toBeInstanceOf(ValidationError);
    expect(git.calls).toEqual([]);
    expect(chat.listSessions(workspace.id)).toEqual([]);
  });

  it('refuses a build or planning session in a worktree, and a chat when git is not wired', async () => {
    const { chat, workspace } = setUp();
    for (const kind of ['build', 'planning'] as const) {
      expect(await refusal(chat.createChatSession(workspace.id, { kind, location: 'worktree' }))).toBeInstanceOf(InvalidOperationError);
    }
    const bare = setUp({ withVcs: false });
    expect(await refusal(bare.chat.createChatSession(bare.workspace.id, { location: 'worktree' }))).toBeInstanceOf(InvalidOperationError);
    expect(chat.listSessions(workspace.id)).toEqual([]);
  });

  it("opens the chat's terminal in its worktree", async () => {
    const terminal = fakeTerminal();
    const opened: string[] = [];
    const port: TerminalPort = {
      ...terminal.port,
      open: (input) => {
        opened.push(input.cwd);
        return terminal.port.open(input);
      },
    };
    const { chat, agent, workspace } = setUp({ terminal: port });
    const session = await chat.createChatSession(workspace.id, { location: 'worktree' });
    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();
    await chat.switchDriver(workspace.id, session.id, 'terminal');
    expect(opened).toEqual([session.worktreePath]);
    await chat.switchDriver(workspace.id, session.id, 'ui');
    expect(agent.transcriptCwds.every((cwd) => cwd === session.worktreePath)).toBe(true);
    await chat.close();
  });
});
