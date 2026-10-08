/**
 * The harness for the builds use-case tests (stories 5.2 to 5.5): a real
 * core with fake ports (an in-memory VCS, sandbox, build runner, ticket
 * store and chat).
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { BUILD_RESULT_FILE, BuildRunResult, type SandboxStatus, type SessionId, type TicketDetail, type TicketStatus, type WorkspaceId } from '@ogden-agents/shared';
import { createBuilds, type BuildRunnerPort, type BuildSessionSetup, type BuildsDeps, type BuildsUseCases, type BuildRefusedError, type Core, type SandboxCheck, type SandboxPort, type SandboxRunRequest, type SandboxRunResult, type TicketStorePort, type UnattendedBuildSetup, type VcsCheck, type VcsHead, type VcsPort } from '../src/index.js';
import type { createStarter } from '../src/build-start.js';
import { openTestCore, tempDir, unusedCatalogParts } from './helpers.js';

export const PLAN = '_bmad-output/initiative-demo/epic-first/story-thing-plan.md';

/** A build runner for these tests: names no skill, maps the fake agent's halt to a code (story 5.3's port). */
export const testRunner: BuildRunnerPort = {
  agent: 'claude-code',
  invocation: (ref) => `/build ${ref}`,
  blockedCode: (condition) => (condition === 'unclear intent' ? 'unclear_intent' : 'other'),
  // The real adapter's read, in short: the file core wrote in the run's folder, parsed, for this run and ticket.
  readResult: async (folder, expected) => {
    try {
      const parsed = BuildRunResult.safeParse(JSON.parse(readFileSync(join(folder, BUILD_RESULT_FILE), 'utf8')));
      return parsed.success && parsed.data.runId === expected.runId && parsed.data.ticketRef === expected.ticketRef ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  },
};
export const REVISION = 'a'.repeat(40);

/** The commands a fake sandbox was asked to run, and what they answer (story 5.8). */
export interface Rerun {
  runs: SandboxRunRequest[];
  result: SandboxRunResult | undefined;
  /** When set, a re-run does not answer until its signal aborts (a test re-run in progress). */
  hang?: boolean;
}
export const newRerun = (): Rerun => ({ runs: [], result: { exitCode: 0, timedOut: false, output: 'Tests: 5 passed, 5 total\n' } });

/** A sandbox port answering `check` from `answer` (story 5.6: and a status that agrees). */
export function fakeSandbox(answer: () => SandboxCheck, rerun: Rerun = newRerun()): SandboxPort {
  const status = (): SandboxStatus => {
    const check = answer();
    return check.available
      ? { platform: 'other', available: true, kind: check.kind, summary: 'ok', probes: [], choices: [], installHint: null }
      : { platform: 'other', available: false, kind: null, summary: check.reason, probes: [], choices: [...(check.choices ?? [])], installHint: null };
  };
  return {
    check: async () => answer(),
    status: async () => status(),
    // The re-run of the project's tests: passes unless a test says otherwise (`runs` records each command).
    run: async (request) => {
      rerun.runs.push(request);
      if (rerun.hang === true) {
        await new Promise<void>((resolve) => (request.signal?.aborted === true ? resolve() : request.signal?.addEventListener('abort', () => resolve(), { once: true })));
        return { exitCode: null, timedOut: false, output: '' };
      }
      return rerun.result;
    },
  };
}

/** A session's setup, which must be an unattended one (story 5.6). */
export function unattendedOf(setup: BuildSessionSetup | undefined): UnattendedBuildSetup {
  if (setup === undefined || setup.attended === true) throw new Error('expected an unattended build setup');
  return setup;
}

export interface Ticket {
  ref: string;
  title: string;
  after: Array<string | number>;
}
export const TICKETS: Ticket[] = [
  { ref: '1.1', title: 'Build the thing', after: [] },
  { ref: '1.2', title: 'Build the next thing', after: [1] },
];
export const STATE_OF: Record<string, string> = { 'ready-for-dev': 'backlog', 'in-review': 'review', built: 'review', done: 'done', blocked: 'in-progress', draft: 'backlog' };

/** A ticket store whose statuses are kept per folder (the main checkout, or a worktree). */
export function fakeTickets(repoPath: string, list: readonly Ticket[] = TICKETS) {
  const statuses = new Map<string, Map<string, string>>([[repoPath, new Map(list.map((ticket) => [ticket.ref, 'ready-for-dev'] as const))]]);
  const blockedAt = new Map<string, string>();
  const reasons = new Map<string, string>();
  const checkpoints = new Map<string, { plan?: boolean; done?: boolean }>();
  const calls: unknown[][] = [];
  const statusIn = (path: string) => statuses.get(path) ?? statuses.set(path, new Map()).get(path)!;
  const detail = (path: string, ticket: Ticket): TicketDetail => {
    const status = statusIn(path).get(ticket.ref) ?? '';
    return {
      ref: ticket.ref,
      id: Number(ticket.ref.split('.')[1]),
      epic: 'epic-first',
      title: ticket.title,
      type: 'story',
      status,
      state: STATE_OF[status] ?? 'planned',
      blocked_reason: reasons.get(`${path}:${ticket.ref}`) ?? '',
      file: null,
      tracker_id: '',
      assignee: '',
      hitl: false,
      covers: [],
      after: ticket.after,
      blocks: [],
      blocked_at: blockedAt.get(`${path}:${ticket.ref}`) ?? '',
      description: '',
      verify: '',
      references: [],
      notes: [],
      unknown: '',
      hasPlan: status !== '',
      plan: status === '' ? null : PLAN,
      plan_checkpoint: (checkpoints.get(`${path}:${ticket.ref}`) ?? checkpoints.get(ticket.ref))?.plan === true,
      done_checkpoint: (checkpoints.get(`${path}:${ticket.ref}`) ?? checkpoints.get(ticket.ref))?.done === true,
    };
  };
  const store: TicketStorePort = {
    async tree(path) {
      calls.push(['tree', path]);
      return { tickets: list.map((ticket) => detail(path, ticket)), problems: [], folder: 'initiative-demo', epics: [] };
    },
    async find(path, ref) {
      calls.push(['find', path, ref]);
      return detail(path, list.find((ticket) => ticket.ref === ref)!);
    },
    async mark(path, ref, status, _guard, options = {}) {
      calls.push(['mark', path, ref, status, options.approve === true]);
      statusIn(path).set(ref, status);
      return { ref, status };
    },
    watch: async () => ({ close() {} }),
  };
  return {
    store,
    calls,
    set: (path: string, ref: string, status: TicketStatus, reason?: string, at?: string) => {
      statusIn(path).set(ref, status);
      if (reason !== undefined) reasons.set(`${path}:${ref}`, reason);
      if (at !== undefined) blockedAt.set(`${path}:${ref}`, at);
    },
    status: (path: string, ref: string) => statusIn(path).get(ref),
    /** The ticket's checkpoint flags everywhere, or only in the folder `path` (a worktree the agent edited). */
    checkpoint: (ref: string, which: { plan?: boolean; done?: boolean }, path?: string) => void checkpoints.set(path === undefined ? ref : `${path}:${ref}`, which),
  };
}

/** A VCS in memory: what it was asked, in order. */
export function fakeVcs() {
  const calls: string[] = [];
  const state = {
    head: { branch: 'main', revision: REVISION } as VcsHead | undefined,
    status: [] as string[],
    files: ['src/thing.ts', PLAN],
    merged: false,
    merge: 'merged' as 'merged' | 'conflict' | 'refused',
    onMerge: () => {},
    /** Runs when the diff is read (a command moving the branch under the end checks, story 5.7). */
    onDiff: () => {},
    top: undefined as string | undefined,
    staged: [] as string[],
    inProgress: false,
    revisions: new Map<string, string>(),
    worktrees: new Set<string>(),
    branches: new Set<string>(['main']),
    git: { ok: true, version: '2.45.0' } as VcsCheck,
    ancestor: true,
    committed: [] as string[][],
    removeFails: false,
    applyPatch: 'applied' as 'applied' | 'refused',
    rebase: 'rebased' as 'rebased' | 'conflict' | 'refused',
    /** The files an applied patch was asked to refuse (the protected check, story 11.1). */
    refused: [] as boolean[],
    importResult: 'nothing' as 'imported' | 'nothing' | 'refused',
    /** Every `importObjects` call: the branch and its base. */
    imports: [] as Array<[string, string]>,
  };
  const vcs: VcsPort = {
    check: async () => state.git,
    regularFileAtRevision: async () => false,
    isAncestor: async () => state.ancestor,
    async importObjects(_repo, branch, base) {
      state.imports.push([branch, base]);
      return state.importResult;
    },
    async commitPaths(_repo, paths) {
      calls.push(`commit paths ${paths.join(',')}`);
      state.committed.push([...paths]);
      state.status = state.status.filter((path) => !paths.includes(path));
      return 'c'.repeat(40);
    },
    head: async () => state.head,
    topLevel: async (repo) => state.top ?? repo,
    branchRevision: async (_repo, branch) => (state.branches.has(branch) ? (state.revisions.get(branch) ?? 'b'.repeat(40)) : undefined),
    operationInProgress: async () => state.inProgress,
    staged: async () => state.staged,
    async restore(_repo, paths) {
      calls.push(`restore ${paths.join(',')}`);
    },
    async addWorktree(_repo, { path, branch, base }) {
      calls.push(`worktree add ${branch} ${base}`);
      mkdirSync(path, { recursive: true });
      state.worktrees.add(path);
      state.branches.add(branch);
    },
    worktreeGitPaths: async (_path, branch) => ({
      commonDir: '/repo/.git',
      gitDir: '/repo/.git/worktrees/x',
      branchRefDir: `/repo/.git/refs/heads/${branch.split('/').slice(0, -1).join('/')}`,
      branchLogDir: `/repo/.git/logs/refs/heads/${branch.split('/').slice(0, -1).join('/')}`,
    }),
    async removeWorktree(_repo, path, options = {}) {
      calls.push(`worktree remove${options.deleteBranch === undefined ? '' : ` and ${options.mergedOnly === true ? 'merged ' : ''}${options.deleteBranch}`}`);
      if (state.removeFails) throw new Error('a file is still open there');
      state.worktrees.delete(path);
      // As git does: the folder goes (story 5.5's sweep checks what is left on disk).
      rmSync(path, { recursive: true, force: true });
      if (options.deleteBranch !== undefined) state.branches.delete(options.deleteBranch);
    },
    status: async () => state.status,
    diff: async () => {
      state.onDiff();
      return { diff: state.files.length === 0 ? '' : 'diff --git a/src/thing.ts b/src/thing.ts\n', truncated: false, files: state.files };
    },
    isMerged: async () => state.merged,
    async merge(_repo, revision) {
      calls.push(`merge ${revision.slice(0, 4)}`);
      state.onMerge();
      return state.merge;
    },
    async abortMerge() {
      calls.push('abort');
    },
    async add(_repo, paths) {
      calls.push(`add ${paths.join(',')}`);
    },
    async commit() {
      calls.push('commit');
      state.merged = true;
    },
    diffStats: async () => ({ files: state.files.length, insertions: 1, deletions: 0 }),
    // The run stores the worktree's real path (macOS: `/private/var/…`).
    worktreeExists: async (_repo, path) => [...state.worktrees].some((each) => each === path || (existsSync(each) && realpathSync.native(each) === path)),
    rebase: async (input) => {
      calls.push(`rebase ${input.onto.slice(0, 4)}`);
      return state.rebase;
    },
    applyPatch: async ({ patchPath, refuse }) => {
      calls.push(`applyPatch ${patchPath}`);
      state.refused = ['.claude/settings.json', '_bmad/scripts/tickets.py', '_bmad-output/a/tickets.toml', 'src/ok.ts'].map((file) => refuse?.(file) === true);
      return state.applyPatch;
    },
    // CAP-24 story 19.4 (remote-worktree-sync.ts): no build use-case here calls either, so these are never exercised.
    async bundleRef() {
      calls.push('bundleRef');
      return Buffer.alloc(0);
    },
    async importBundle() {
      calls.push('importBundle');
      return 'nothing';
    },
  };
  return { vcs, calls, state };
}

export interface Harness {
  core: Core;
  builds: BuildsUseCases;
  wsId: WorkspaceId;
  repo: string;
  dataDir: string;
  tickets: ReturnType<typeof fakeTickets>;
  git: ReturnType<typeof fakeVcs>;
  sent: Array<{ sessionId: SessionId; text: string }>;
  released: SessionId[];
  fingerprints: Map<string, string>;
  worktreeFingerprint: { value: string };
  sandbox: { available: boolean };
  /** The sandbox's test re-runs (story 5.8): each command asked, and what the next ones answer. */
  rerun: Rerun;
  /** The run time limits armed (story 5.8): `fire()` runs every one that is still armed. */
  timers: { armed: Array<{ ms: number; run: () => void; cancelled: boolean }>; fire(): void };
  /** Makes the next build prompts fail to send (a chat that refuses them). */
  sendFails: { value: boolean };
  /** Ends the build session's turn (working, then `idle` or `error`) and waits for the outcome. */
  endTurn(sessionId: SessionId, state?: 'idle' | 'error'): Promise<void>;
  /**
   * The internal starter (CAP-24, epic 19 story 19.6): `startLocked`'s own
   * `machineId` has no REST field yet (19.7's job), so a remote-build test
   * calls `h.start.startLocked(h.wsId, h.repo, ref, agent, mode, note, machineId)`
   * directly rather than through `h.builds.start` (`StartBuildRequest`, which
   * never carries one).
   */
  start: ReturnType<typeof createStarter>;
}

export async function harness({
  pieces = ['board', 'builds'] as const,
  trusted = true,
  freeBytes,
  runner = testRunner,
  ticketList,
  devTools,
  remote,
}: {
  pieces?: readonly string[];
  trusted?: boolean;
  freeBytes?: (dir: string) => number | undefined;
  runner?: BuildRunnerPort;
  ticketList?: readonly Ticket[];
  /** The generic dev tools' sandbox-gate lookup (CAP-25). Default: nothing denied. */
  devTools?: { deniedReadPathsFor: (workspaceId: WorkspaceId) => Promise<string[]> };
  /** The remote-build capability (CAP-24, epic 19 story 19.6); default: absent, exactly as before this story (no ripple). */
  remote?: BuildsDeps['remote'];
} = {}): Promise<Harness> {
  const dataDir = tempDir('ogden-agents-builds-data-');
  const repo = tempDir('ogden-agents-builds-repo-');
  const fingerprints = new Map<string, string>();
  /** What every new worktree's `_bmad/scripts/` hash to (the committed scripts). */
  const worktreeFingerprint = { value: 'trusted' };
  const core = openTestCore(dataDir, undefined, {
    availableBmadPieces: ['planning', 'board', 'builds'],
    bmadCatalog: {
      detect: async () => ({ hasBmad: true, hasOutput: true }),
      skills: async () => [],
      ...unusedCatalogParts,
      // Every copy of the project (the checkout, each worktree) has the trusted scripts unless a test says otherwise.
      scriptsFingerprint: async (path) => fingerprints.get(path) ?? (path.startsWith(join(realpathSync.native(dataDir), 'w')) ? worktreeFingerprint.value : 'trusted'),
    },
  });
  const workspace = core.entities.ensureWorkspace(repo);
  core.permissions.updateSettings(workspace.id, { bmadPieces: [...pieces] });
  if (trusted) await core.bmadScriptTrust.trustScripts(workspace.id);
  const tickets = fakeTickets(workspace.realPath!, ticketList);
  const git = fakeVcs();
  const sent: Array<{ sessionId: SessionId; text: string }> = [];
  const released: SessionId[] = [];
  const sandbox = { available: true };
  const sendFails = { value: false };
  const rerun = newRerun();
  const timers = { armed: [] as Array<{ ms: number; run: () => void; cancelled: boolean }>, fire() { for (const timer of this.armed.filter((each) => !each.cancelled)) timer.run(); } };
  // The project's own test command (story 5.8), so the re-run has one to run.
  core.buildSettings.setWorkspaceSettings(workspace.id, { testCommand: 'run-tests' });
  let starter: ReturnType<typeof createStarter> | undefined;
  const builds = createBuilds({
    settings: core.buildSettings,
    ...(devTools === undefined ? {} : { devTools }),
    commandEnv: () => ({ PATH: '/bin' }),
    setTimer: (run, ms) => {
      const timer = { ms, run, cancelled: false };
      timers.armed.push(timer);
      return { cancel: () => void (timer.cancelled = true) };
    },
    bmad: core.bmad,
    trust: core.bmadScriptTrust,
    source: { requireReady() {} },
    entities: core.entities,
    events: core.events,
    tickets: tickets.store,
    vcs: git.vcs,
    sandbox: fakeSandbox(() => (sandbox.available ? { available: true, kind: 'test' } : { available: false, reason: 'none' }), rerun),
    runner,
    chat: {
      chatAgents: async () => ({ agents: [], defaultAgentId: 'claude-code' }),
      createChatSession: async (wsId, options) => core.entities.createSession({ workspaceId: wsId, kind: options?.kind ?? 'chat' }),
      sendMessage: (_wsId, sessionId, text, options) => {
        if (options?.build !== true) throw new Error('a build session takes only the build prompt');
        if (sendFails.value) throw new Error('the chat refused it');
        sent.push({ sessionId, text });
        return { messageId: 'msg_1', queued: false };
      },
      releaseAgent: async (_wsId, sessionId) => void released.push(sessionId),
    },
    buildSessions: core.buildSessions,
    dataDir,
    ...(remote === undefined ? {} : { remote }),
    ...(freeBytes === undefined ? {} : { freeBytes }),
  }, { captureStarter: (started) => (starter = started) });
  return {
    core,
    builds,
    start: starter!,
    wsId: workspace.id,
    repo: workspace.realPath!,
    dataDir,
    tickets,
    git,
    sent,
    released,
    fingerprints,
    worktreeFingerprint,
    sandbox,
    rerun,
    timers,
    sendFails,
    async endTurn(sessionId, state = 'idle') {
      core.entities.setSessionState(sessionId, 'working');
      core.entities.setSessionState(sessionId, state, state === 'error' ? { reason: 'It broke.' } : {});
      await builds.settled();
    },
  };
}

export const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal');
};

export const codeOf = async (promise: Promise<unknown>) => ((await refusal(promise)) as BuildRefusedError).code;

