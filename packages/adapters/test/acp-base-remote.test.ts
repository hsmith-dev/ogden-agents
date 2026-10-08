/**
 * The shared ACP client's agent process spawned over SSH instead of locally
 * (CAP-24, story 19.5): the I/O matrix of the story's plan, against the real
 * `fake-acp-agent.mjs` fixture (`tests/fixtures/fake-acp-agent.mjs`, the same
 * one `acp-base.test.ts` runs locally) over `createMemoryRemoteHostPort()`
 * (the fake adapter story 19.4 built). `createAcpAgent`, the permission-card
 * machinery and every event shape are exercised completely unchanged: the
 * only difference from `acp-base.test.ts`'s own tests is `remote` on
 * `startSession`/`reopenSession`.
 *
 * "Channel closes unexpectedly" and "Stop / kill" need to observe things
 * `createMemoryRemoteHostPort()`'s one-shot `setConnectionLost` can't give a
 * still-open, mid-session channel (it only affects the *next* `exec`), so
 * those two tests use a small tracked connection of their own
 * (`createTrackedConnection`) that still runs the real fixture as a real
 * local process (standing in for the remote one, exactly as the memory
 * adapter's own `exec` does) but lets the test drop or count a kill on the
 * one channel already in flight.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentError,
  PROTECTED_PATHS,
  RemoteHostError,
  type AgentDescriptor,
  type AgentEvent,
  type AgentPermissionRequest,
  type AgentSession,
  type RemoteHostChannel,
  type RemoteHostConnection,
} from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRemoteCommand, createAcpAgent, MASKED, slashSkillInvocation, type AcpAgentQuirks } from '../src/acp-base/index.js';
import { baseEnvironment } from '../src/child-env.js';
import { killProcessTree } from '../src/process-tree.js';
import { createMemoryRemoteHostPort, type MemoryRemoteHostPort } from '../src/remote-host-memory/index.js';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');
const dirs: string[] = [];
const sessions: AgentSession[] = [];

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-acp-base-remote-'));
  dirs.push(dir);
  return dir;
}

/** The same minimal second agent `acp-base.test.ts` uses locally: Ask and Skip all under its own mode ids. */
const SECOND: AgentDescriptor = {
  agentId: 'second-agent',
  displayName: 'Second Agent',
  provider: 'Second Provider',
  install: { kind: 'npm', package: '@second/agent', version: '1.0.0' },
  signInMethods: [{ id: 'second-login', kind: 'subscription', label: 'Sign in' }],
  permissionModes: { ask: 'careful', skip_all: 'yolo' },
  needsProjectTrust: false,
  skillsFolder: '.second/skills',
};

/** The environment it gets: enough to run Node, its modes, and its name for `whoami` (`acp-base.test.ts`'s own `baseEnv`). */
const baseEnv = (extra: Record<string, string> = {}): Record<string, string> => ({
  PATH: process.env.PATH ?? '',
  FAKE_ACP_MODES: 'careful:Careful,edits:Accept edits,yolo:Yolo',
  FAKE_ACP_START_MODE: 'careful',
  FAKE_ACP_AGENT_NAME: 'second-agent',
  ...extra,
});

function remoteAgent(quirks: Partial<AcpAgentQuirks> = {}) {
  return createAcpAgent(SECOND, {
    launch: () => ({ command: process.execPath, args: [FAKE_AGENT], logFields: { program: 'fake' } }),
    toolInputPaths: { pathFields: ['target'], patternFields: [] },
    askingModeIds: ['careful'],
    skillInvocation: slashSkillInvocation,
    ...quirks,
  });
}

/** Starts a remote chat: a fresh `createMemoryRemoteHostPort()` connection (unless one is given), handed to `startSession` as `remote`. */
async function startRemote(options: {
  hosts?: MemoryRemoteHostPort;
  env?: Record<string, string>;
  onPermissionRequest?: (request: AgentPermissionRequest) => Promise<{ outcome: 'allow_once' } | { outcome: 'deny' }>;
} = {}) {
  const hosts = options.hosts ?? createMemoryRemoteHostPort();
  const { fingerprint } = await hosts.checkHostKey({ host: 'remote-a', port: 22, username: 'u' });
  const connection = await hosts.connect({ host: 'remote-a', port: 22, username: 'u' }, { privateKey: 'fake' }, fingerprint);
  const agent = remoteAgent();
  const session = await agent.startSession({
    cwd: tempDir(),
    env: baseEnv(options.env),
    onPermissionRequest: options.onPermissionRequest,
    protectedPaths: PROTECTED_PATHS,
    remote: connection,
  });
  sessions.push(session);
  const events: AgentEvent[] = [];
  session.onEvent((event) => events.push(event));
  return { agent, session, events, hosts, connection };
}

const replyText = (events: AgentEvent[]) => events.flatMap((e) => (e.type === 'message_chunk' ? [e.text] : [])).join('');

const until = async (predicate: () => boolean, what: string, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

/**
 * A `RemoteHostConnection` whose `exec` still runs the command through a
 * real local `sh -c` (exactly as `createMemoryRemoteHostPort`'s own `exec`
 * does, standing in for the remote machine), but records every command it
 * ran, counts how many times a channel's own `kill()` ran, and lets the test
 * reject the most recently opened channel's `exitCode` on demand -- a
 * dropped SSH connection, mid-command, that `createMemoryRemoteHostPort`'s
 * one-shot `setConnectionLost` can't simulate for a channel already open.
 */
interface TrackedConnection extends RemoteHostConnection {
  readonly execCommands: readonly string[];
  kills: number;
  /** Rejects the most recently opened `exec`'s `exitCode` with `connection_lost`, then kills the real process behind it. */
  dropLatest(): void;
}

function createTrackedConnection(): TrackedConnection {
  const execCommands: string[] = [];
  let dropLatestCommand: (() => void) | undefined;
  const connection: TrackedConnection = {
    execCommands,
    kills: 0,
    async exec(command, options): Promise<RemoteHostChannel> {
      execCommands.push(command);
      // Its own process group on POSIX (as `spawnAcpProcess`'s own local spawn already does), so
      // `killProcessTree` below can reach the whole tree, not just this one shell.
      const child = spawn('sh', ['-c', command], {
        env: { ...baseEnvironment(), ...options?.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
      let settled = false;
      let resolveExit!: (code: number) => void;
      let rejectExit!: (error: unknown) => void;
      const exitCode = new Promise<number>((resolve, reject) => {
        resolveExit = resolve;
        rejectExit = reject;
      });
      child.stdin.on('error', () => undefined);
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        rejectExit(error);
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        resolveExit(code ?? 1);
      });
      dropLatestCommand = () => {
        if (settled) return;
        settled = true;
        rejectExit(new RemoteHostError('The connection to the machine was lost.', {}, 'connection_lost'));
        // `killProcessTree`, not a plain `child.kill('SIGKILL')`: this `sh -c '… && exec …'` stands in
        // for a real remote exec channel (see this function's own doc comment), but on `windows-latest`
        // there is no POSIX `exec` to replace the shell's own image in place -- `sh.exe` (Git for
        // Windows' MSYS bash) runs the fake agent as a *child* process instead, so killing only the
        // top-level `sh.exe` leaves that real agent process (and its lock on `tempDir()`'s directory)
        // running, orphaned, which is exactly what made `afterEach`'s `rmSync` fail with `EPERM` on
        // Windows CI (the temp dir was still a running process's cwd / had an open handle under it).
        // POSIX `exec` genuinely replaces the shell's image, so this was always a no-op difference
        // there -- only `windows-latest` ever had a tree to walk.
        killProcessTree(child.pid);
      };
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        exitCode,
        kill: () => {
          connection.kills += 1;
          killProcessTree(child.pid);
        },
      };
    },
    async close() {
      /* Nothing is held open beyond each exec's own child, same as the memory adapter. */
    },
    dropLatest() {
      dropLatestCommand?.();
    },
  };
  return connection;
}

describe('a remote chat over SSH (CAP-24, story 19.5)', () => {
  it('starts, streams a reply, shows and resolves a permission card, and close() ends it -- the same assertions as the local fixture test', async () => {
    const asked: AgentPermissionRequest[] = [];
    const { session, events, hosts } = await startRemote({ onPermissionRequest: async (request) => (asked.push(request), { outcome: 'allow_once' }) });
    await session.prompt('whoami');
    expect(replyText(events)).toBe('agent=second-agent');
    expect(events[0]).toEqual({ type: 'state', state: 'working' });
    expect(events.at(-1)).toEqual({ type: 'state', state: 'idle' });

    events.length = 0;
    await session.prompt('permission');
    expect(asked).toEqual([{ toolCallId: 'call-permission', title: 'Run npm test', kind: 'execute', command: 'npm test', paths: [], rawPaths: [] }]);
    expect(replyText(events)).toBe('Ran npm test.');

    await session.close();
    // One exec channel ran the whole session's ACP process, exactly as one local process would have.
    expect(hosts.calls.filter((call) => call.startsWith('exec'))).toHaveLength(1);
  });

  it('reopenSession over remote resumes exactly as a local reopen does', async () => {
    const hosts = createMemoryRemoteHostPort();
    const { fingerprint } = await hosts.checkHostKey({ host: 'remote-b', port: 22, username: 'u' });
    const connection = await hosts.connect({ host: 'remote-b', port: 22, username: 'u' }, { privateKey: 'fake' }, fingerprint);
    const agent = remoteAgent();
    const { session, restored } = await agent.reopenSession({
      cwd: tempDir(),
      env: baseEnv({ FAKE_ACP_RESUME: 'both' }),
      agentSessionId: 'a-session-id-from-a-previous-run',
      remote: connection,
    });
    sessions.push(session);
    expect(restored).toBe('resumed');
    const events: AgentEvent[] = [];
    session.onEvent((event) => events.push(event));
    await session.prompt('whoami');
    expect(replyText(events)).toBe('agent=second-agent');
  });

  it("the connection dropping mid-session reports one fatal error, and the next prompt() fails exactly as a local crash would", async () => {
    const connection = createTrackedConnection();
    const agent = remoteAgent();
    const session = await agent.startSession({ cwd: tempDir(), env: baseEnv(), protectedPaths: PROTECTED_PATHS, remote: connection });
    sessions.push(session);
    const events: AgentEvent[] = [];
    session.onEvent((event) => events.push(event));

    const turn = session.prompt('hold'); // stays "working" until cancelled or the process goes away.
    await until(() => events.some((e) => e.type === 'message_chunk'), 'the first chunk');
    connection.dropLatest();

    // CAP-24 epic 19 story 19.6: a dropped connection is its own code, never the generic `agent_failed`.
    await expect(turn).rejects.toMatchObject({ code: 'connection_lost' });
    const errors = events.filter((e) => e.type === 'state' && e.state === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ fatal: true, code: 'connection_lost' });
    // A dead session refuses further prompts at once -- never a distinct "remote" error shape.
    await expect(session.prompt('whoami')).rejects.toBeInstanceOf(AgentError);
  });

  it("session.close() runs the channel's own kill, and the exec it ran was the remote-launch command, never a local spawn", async () => {
    const connection = createTrackedConnection();
    const agent = remoteAgent();
    const cwd = tempDir();
    const session = await agent.startSession({ cwd, env: baseEnv(), protectedPaths: PROTECTED_PATHS, remote: connection });
    sessions.push(session);
    expect(connection.execCommands).toEqual([buildRemoteCommand({ cwd, command: process.execPath, args: [FAKE_AGENT] })]);
    expect(connection.kills).toBe(0);
    await session.close();
    expect(connection.kills).toBeGreaterThanOrEqual(1);
  });

  it("keeps a secret-shaped env value off the command line, delivering it only through exec's env option (AD-16)", async () => {
    const secretValue = 'sk-test-should-never-appear-on-a-command-line';
    const { session, events, hosts } = await startRemote({ env: { ANTHROPIC_API_KEY: secretValue, MY_PLAIN_PROBE: 'hello-plain-value' } });
    await session.prompt('echo-env');
    const reply = replyText(events);
    // Delivered: a plain-named variable reaches the process untouched...
    expect(reply).toContain('MY_PLAIN_PROBE=hello-plain-value');
    // ...and a secret-shaped one too, but masked in the event the UI sees (AD-16, unchanged for a remote chat).
    expect(reply).toContain(`ANTHROPIC_API_KEY=${MASKED}`);
    expect(reply).not.toContain(secretValue);
    // Never on the command line either (the stricter, I/O-matrix-specific check): asserted on the exact string `exec` was called with.
    const execCommands = hosts.calls.filter((call) => call.startsWith('exec'));
    expect(execCommands).toHaveLength(1);
    expect(execCommands[0]).not.toContain(secretValue);
  });
});

describe('buildRemoteCommand (CAP-24 story 19.5)', () => {
  it('shell-quotes cwd, command and args, so ones containing a space and a single quote still run correctly through a real sh -c (mirroring story 19.4)', async () => {
    const dir = tempDir();
    // `realpathSync` (the plain JS one) only resolves symlinks, so on `windows-latest` it leaves a
    // short (8.3) path segment untouched when the runner's own %TEMP% is set that way (observed:
    // `...\RUNNER~1\...`), while the child process below, after a real `cd` into it, reports its
    // `process.cwd()` back through Windows' own canonicalization, which resolves that alias to its
    // long form (`...\runneradmin\...`) -- a mismatch `buildRemoteCommand` itself never caused (its
    // quoting is exactly right either way; the `argv` half of this same assertion already proves
    // that). `realpathSync.native` asks the OS to canonicalize up front, the same resolution the
    // child's own `process.cwd()` already does, so both sides agree on every platform.
    const cwd = realpathSync.native(dir);
    const weirdCwd = join(cwd, "weird 'cwd");
    mkdirSync(weirdCwd);
    const weirdCommand = join(cwd, "weird 'node");
    symlinkSync(process.execPath, weirdCommand);
    const scriptPath = join(cwd, 'probe.mjs');
    writeFileSync(scriptPath, 'process.stdout.write(JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2) }));\n');
    const weirdArg = "weird 'arg";

    const command = buildRemoteCommand({ cwd: weirdCwd, command: weirdCommand, args: [scriptPath, weirdArg] });
    const result = await new Promise<{ code: number; stdout: string }>((resolve) => {
      const child = spawn('sh', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.on('close', (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(chunks).toString('utf8') }));
    });

    expect(result.code).toBe(0);
    // `process.argv.slice(2)` drops Node's own argv[0] (its executable) and argv[1] (the script path), leaving only `weirdArg`.
    expect(JSON.parse(result.stdout)).toEqual({ cwd: weirdCwd, argv: [weirdArg] });
  });

  it('shell-quotes every field as pure strings, with no OS-specific path logic (separators, drive letters, case) applied along the way -- a real Windows path survives byte-for-byte even when the controller itself runs this on win32', () => {
    // No spawn, no real shell, no temp dir: `buildRemoteCommand` only ever has to splice its three
    // fields into a string, since the remote end is always a POSIX shell regardless of what OS Ogden
    // Agents' own controller process runs on (see this file's module doc comment and
    // `process-launch.ts`'s own). A controller-side "fix" that ran the Windows-style `cwd` it gets
    // handed through `path.win32`/`path.normalize`/backslash-to-forward-slash translation before
    // quoting it would be wrong (the remote's own `sh -c` never wants that), and this test would catch
    // it: nothing here ever touches `node:path`.
    const windowsStyleCwd = String.raw`C:\Users\RUNNER~1\AppData\Local\Temp\weird 'cwd`;
    const command = buildRemoteCommand({ cwd: windowsStyleCwd, command: 'node', args: ['probe.mjs'] });
    expect(command).toBe(`cd '${windowsStyleCwd.replace(/'/g, `'\\''`)}' && exec 'node' 'probe.mjs'`);
    // The backslashes are untouched, never doubled, converted to `/`, or otherwise reinterpreted.
    expect(command).toContain(windowsStyleCwd.replace("'", `'\\''`));
  });
});
