/**
 * `setup-claude-code` and `terminal-pty` (story 9.1): the auth method check,
 * reading the sign-in URL, and every sign-in outcome through an injected fake
 * terminal, then the real `node-pty` running the fake login program
 * (`tests/fixtures/fake-claude-login.mjs`, through the fake ACP agent's
 * `--cli`). No test runs a real login or touches an account. The API key
 * check (story 9.2) runs against a fake `fetch`: no test reaches Anthropic.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentSetupError, type AgentAuthMethod } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ANTHROPIC_API_KEY_ENV,
  ANTHROPIC_VERIFY_URL,
  BAD_API_KEY,
  CLAUDE_AI_LOGIN_ARGS,
  createClaudeApiKey,
  UNSUPPORTED_SIGN_IN,
  checkAuthMethods,
  createClaudeCodeSetup,
  createPtyLoader,
  findSignInUrl,
  hiddenPtySpawner,
  isAllowedSignInUrl,
  loadPty,
  stripTerminalEscapes,
  type ClaudeCodeSetup,
  type ClaudeCodeSetupOptions,
  type HiddenPty,
  type HiddenPtyOptions,
  type PtyLoader,
} from '../src/index.js';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures');
const FAKE_AGENT = join(FIXTURES, 'fake-acp-agent.mjs');
const ESC = '\u001b';
const URL_OK = 'https://claude.ai/oauth/authorize?code=true&redirect_uri=http%3A%2F%2Flocalhost%3A5555%2Fcallback&state=s1';

const dirs: string[] = [];
const setups: ClaudeCodeSetup[] = [];
afterEach(() => {
  for (const setup of setups.splice(0)) setup.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-setup-'));
  dirs.push(dir);
  return dir;
}

const CLAUDE_METHOD: AgentAuthMethod = { id: 'claude-ai-login', name: 'Claude Subscription', kind: 'terminal', args: ['--cli', 'auth', 'login', '--claudeai'] };

describe('the auth method check', () => {
  it('accepts only claude-ai-login with exactly its arguments and no environment', () => {
    expect(checkAuthMethods([CLAUDE_METHOD])).toEqual({ ok: true, args: CLAUDE_AI_LOGIN_ARGS });
    expect(checkAuthMethods([{ ...CLAUDE_METHOD, env: {} }]).ok).toBe(true);
    const refused = [
      [],
      [{ ...CLAUDE_METHOD, id: 'console-login' }],
      [{ ...CLAUDE_METHOD, id: 'claude-login', args: ['--cli'] }],
      [{ ...CLAUDE_METHOD, kind: 'agent' as const }],
      [{ ...CLAUDE_METHOD, args: ['--cli', 'auth', 'login', '--claudeai', '--extra'] }],
      [{ ...CLAUDE_METHOD, args: ['--cli', 'auth', 'login', '--console'] }],
      [{ ...CLAUDE_METHOD, args: undefined }],
      [{ ...CLAUDE_METHOD, env: { NODE_OPTIONS: '--require /tmp/evil.js' } }],
    ];
    for (const methods of refused) expect(checkAuthMethods(methods), JSON.stringify(methods)).toEqual({ ok: false, reason: UNSUPPORTED_SIGN_IN });
  });
});

describe('reading the sign-in URL', () => {
  it('strips colors and OSC 8 links, and takes an https URL on an allowed host', () => {
    const colored = `${ESC}[1mClaude${ESC}[0m visit: ${ESC}]8;;${URL_OK}${ESC}\\${URL_OK}${ESC}]8;;${ESC}\\\r\n`;
    expect(stripTerminalEscapes(colored)).toBe(`Claude visit: ${URL_OK}\r\n`);
    expect(findSignInUrl(colored)).toBe(new URL(URL_OK).href);
    // The OSC 8 target counts even when the visible text is not the URL (BEL-terminated too).
    expect(findSignInUrl(`${ESC}]8;;${URL_OK}\u0007Open the sign-in page${ESC}]8;;\u0007`)).toBe(new URL(URL_OK).href);
    expect(findSignInUrl(`visit https://console.anthropic.com/login?x=1 now`)).toBe('https://console.anthropic.com/login?x=1');
    expect(findSignInUrl(`see https://claude.com/a.\n`)).toBe('https://claude.com/a');
  });

  it('refuses http, other hosts, look-alikes, credentials, and a URL still arriving', () => {
    expect(findSignInUrl(`visit: http://claude.ai/oauth?x=1\n`)).toBeUndefined();
    expect(findSignInUrl(`visit: https://evil.example/claude.ai\n`)).toBeUndefined();
    expect(findSignInUrl(`visit: https://claude.ai.evil.example/x\n`)).toBeUndefined();
    expect(findSignInUrl(`visit: https://notclaude.ai/x\n`)).toBeUndefined();
    expect(findSignInUrl(`visit: https://user:pw@claude.ai/x\n`)).toBeUndefined();
    // An explicit port, even 443 spelled out on another, is refused.
    expect(findSignInUrl(`visit: https://claude.ai:8443/oauth\n`)).toBeUndefined();
    expect(isAllowedSignInUrl('https://claude.ai:1/x', ['claude.ai'])).toBe(false);
    expect(isAllowedSignInUrl('https://sub.claude.ai/x', ['claude.ai'])).toBe(true);
    expect(isAllowedSignInUrl('https://claude.ai/x', ['example.test'])).toBe(false);
    // Half a URL at the end of what has arrived so far is not taken.
    expect(findSignInUrl('visit: https://claude.ai/oauth/auth')).toBeUndefined();
  });
});

describe('the hidden terminal', () => {
  it.runIf(process.platform !== 'win32')('never signals a process group for a pid that is not a positive integer', () => {
    const signalled: Array<number | string> = [];
    const original = process.kill;
    process.kill = ((pid: number) => {
      signalled.push(pid);
      return true;
    }) as typeof process.kill;
    try {
      for (const pid of [0, -1, Number.NaN]) {
        const spawn = hiddenPtySpawner({
          spawn: () => ({ pid, onData: () => {}, onExit: () => {}, write: () => {}, kill: () => {} }),
        });
        spawn('node', [], { env: {}, cwd: '.', cols: 80, rows: 24 }).kill();
      }
    } finally {
      process.kill = original;
    }
    expect(signalled).toEqual([]);
  });

  it("on Windows, kill closes the terminal without node-pty's console list once taskkill has run (no AttachConsole noise)", () => {
    // A SystemRoot with no taskkill.exe: the taskkill this runs finds nothing, on every OS.
    const saved = process.env.SystemRoot;
    process.env.SystemRoot = join(tmpdir(), 'ogden-agents-no-such-windows');
    try {
      const killWith = (pid: number) => {
        const lists: string[] = [];
        const agent = { _getConsoleProcessList: () => (lists.push('forked'), Promise.resolve([1])) };
        const kills: unknown[] = [];
        const terminal = {
          pid,
          _agent: agent,
          onData: () => {},
          onExit: () => {},
          write: () => {},
          kill: (signal?: string) => {
            kills.push(signal);
            // What node-pty 1.1.0's Windows kill does first.
            void agent._getConsoleProcessList();
          },
        };
        const pty = hiddenPtySpawner({ spawn: () => terminal }, 'win32')('node', [], { env: {}, cwd: '.', cols: 80, rows: 24 });
        pty.kill();
        pty.kill();
        return { kills, lists };
      };
      // taskkill ran (a valid pid): the console list is skipped; node-pty's kill still runs, once, with no signal.
      expect(killWith(4242)).toEqual({ kills: [undefined], lists: [] });
      // No taskkill for a bad pid, so node-pty's own console list still stops what it can.
      expect(killWith(0)).toEqual({ kills: [undefined], lists: ['forked'] });
    } finally {
      if (saved === undefined) delete process.env.SystemRoot;
      else process.env.SystemRoot = saved;
    }
  });
});

/** A fake terminal the test drives: what was spawned, typed and killed. */
function fakePty() {
  const spawned: Array<{ file: string; args: readonly string[]; options: HiddenPtyOptions }> = [];
  const typed: string[] = [];
  let kills = 0;
  let data: (text: string) => void = () => {};
  let exit: (e: { exitCode: number; signal: number | null }) => void = () => {};
  let exited = false;
  const loader: PtyLoader = async () => ({
    ok: true,
    spawnHidden(file, args, options): HiddenPty {
      spawned.push({ file, args, options });
      return {
        pid: 4242,
        onData: (listener) => void (data = listener),
        onExit: (listener) => void (exit = listener),
        write: (text) => void typed.push(text),
        kill: () => {
          kills++;
          if (!exited) {
            exited = true;
            exit({ exitCode: 0, signal: 9 });
          }
        },
      };
    },
  });
  return {
    loader,
    spawned,
    typed,
    kills: () => kills,
    print: (text: string) => data(text),
    exit: (exitCode: number) => {
      exited = true;
      exit({ exitCode, signal: null });
    },
  };
}

/** A setup whose adapter "exists" (this test file) and whose status reads a fake status script. */
function setupWith(overrides: Partial<ClaudeCodeSetupOptions> & { signedInAfter?: boolean } = {}) {
  const diagnostics: string[] = [];
  const dir = tempDir();
  // A stand-in adapter script: `--cli auth status --json` prints the state file.
  const adapter = join(dir, 'adapter.mjs');
  const state = join(dir, 'state.json');
  writeFileSync(
    adapter,
    `import { existsSync, readFileSync } from 'node:fs';\n` +
      `const s = ${JSON.stringify(state)};\n` +
      `const loggedIn = existsSync(s) && JSON.parse(readFileSync(s, 'utf8')).loggedIn === true;\n` +
      `process.stdout.write(JSON.stringify({ loggedIn }) + '\\n');\n`,
  );
  const setup = createClaudeCodeSetup({
    adapterPath: adapter,
    env: () => ({ PATH: process.env.PATH ?? '', SECRET_THING: 'nope' }),
    claudeExecutable: '/opt/claude/bin/claude',
    listAuthMethods: async () => [CLAUDE_METHOD],
    onDiagnostic: (message, fields) => diagnostics.push(`${message} ${JSON.stringify(fields ?? {})}`),
    ...overrides,
  });
  setups.push(setup);
  return { setup, diagnostics, signIn: () => writeFileSync(state, JSON.stringify({ loggedIn: true })) };
}

describe('signing in through a fake terminal', () => {
  it('runs this Node, the adapter and the fixed arguments with only the allowlisted env, then reports signed in', async () => {
    const pty = fakePty();
    const { setup, diagnostics, signIn } = setupWith({ loadPty: pty.loader });
    expect((await setup.status()).auth).toBe('needs_sign_in');
    const starting = setup.signIn();
    await expect.poll(() => pty.spawned.length).toBe(1);
    const [spawn] = pty.spawned;
    expect(spawn!.file).toBe(process.execPath);
    expect(spawn!.args.slice(1)).toEqual(['--cli', 'auth', 'login', '--claudeai']);
    expect(spawn!.options.cols).toBeGreaterThanOrEqual(1000);
    expect(spawn!.options.env).toEqual({
      PATH: process.env.PATH ?? '',
      SECRET_THING: 'nope',
      CLAUDE_CODE_EXECUTABLE: '/opt/claude/bin/claude',
      TERM: 'xterm-256color',
    });
    // Split across reads, with colors and an OSC 8 link.
    pty.print(`${ESC}[1mClaude Code${ESC}[0m\r\nIf the browser didn't open, visit: ${ESC}]8;;${URL_OK.slice(0, 30)}`);
    pty.print(`${URL_OK.slice(30)}${ESC}\\${URL_OK}${ESC}]8;;${ESC}\\\r\nPaste code here if prompted > `);
    const handle = await starting;
    expect(handle.url).toBe(new URL(URL_OK).href);

    signIn();
    pty.exit(0);
    await expect(handle.done).resolves.toBe('signed_in');
    expect(await setup.status()).toMatchObject({ install: 'installed', auth: 'signed_in', method: 'subscription', signInTab: 'agent' });
    // Only step names and exit codes: never the URL or the output.
    const log = diagnostics.join('\n');
    expect(log).not.toContain('claude.ai');
    expect(log).not.toContain('Paste code');
    expect(log).toContain('"exitCode":0');
  });

  it('a nonzero exit, or an exit that leaves the CLI signed out, is failed', async () => {
    for (const [exitCode, signedIn] of [
      [1, false],
      [0, false],
    ] as const) {
      const pty = fakePty();
      const { setup, signIn } = setupWith({ loadPty: pty.loader });
      const starting = setup.signIn();
      await expect.poll(() => pty.spawned.length).toBe(1);
      pty.print(`visit: ${URL_OK}\r\n`);
      const handle = await starting;
      if (signedIn) signIn();
      pty.exit(exitCode);
      await expect(handle.done).resolves.toBe('failed');
    }
  });

  it('cancel kills the terminal and resolves cancelled; a second cancel is harmless', async () => {
    const pty = fakePty();
    const { setup } = setupWith({ loadPty: pty.loader });
    const starting = setup.signIn();
    await expect.poll(() => pty.spawned.length).toBe(1);
    pty.print(`visit: ${URL_OK}\r\n`);
    const handle = await starting;
    await handle.cancel();
    await handle.cancel();
    await expect(handle.done).resolves.toBe('cancelled');
    expect(pty.kills()).toBe(1);
  });

  it('no URL in time kills the terminal and fails with a plain reason', async () => {
    const pty = fakePty();
    const { setup } = setupWith({ loadPty: pty.loader, timeouts: { urlMs: 50 } });
    const starting = setup.signIn();
    await expect.poll(() => pty.spawned.length).toBe(1);
    pty.print('Something went wrong before a link was ready.\r\n');
    await expect(starting).rejects.toThrow("Claude Code didn't show a sign-in link. Try again.");
    expect(pty.kills()).toBe(1);
  });

  it('a URL on another host is never taken', async () => {
    const pty = fakePty();
    const { setup } = setupWith({ loadPty: pty.loader, timeouts: { urlMs: 50 } });
    const starting = setup.signIn();
    await expect.poll(() => pty.spawned.length).toBe(1);
    pty.print('visit: https://evil.example/oauth\r\n');
    await expect(starting).rejects.toBeInstanceOf(AgentSetupError);
  });

  it('the sign-in timeout kills the terminal and fails', async () => {
    const pty = fakePty();
    const { setup } = setupWith({ loadPty: pty.loader, timeouts: { signInMs: 50 } });
    const starting = setup.signIn();
    await expect.poll(() => pty.spawned.length).toBe(1);
    pty.print(`visit: ${URL_OK}\r\n`);
    const handle = await starting;
    await expect(handle.done).resolves.toBe('failed');
    expect(pty.kills()).toBe(1);
  });

  it('an unexpected method, arguments or environment fails with the plain reason and spawns nothing', async () => {
    for (const methods of [[{ ...CLAUDE_METHOD, args: ['--cli', 'evil'] }], [{ ...CLAUDE_METHOD, env: { X: '1' } }], []]) {
      const pty = fakePty();
      const { setup } = setupWith({ loadPty: pty.loader, listAuthMethods: async () => methods });
      await expect(setup.signIn()).rejects.toThrow(UNSUPPORTED_SIGN_IN);
      expect(pty.spawned).toHaveLength(0);
    }
  });

  it('a pasted code is typed into the terminal with Enter; a malformed one is refused', async () => {
    const pty = fakePty();
    const { setup } = setupWith({ loadPty: pty.loader });
    const starting = setup.signIn();
    await expect.poll(() => pty.spawned.length).toBe(1);
    pty.print(`visit: ${URL_OK}\r\n`);
    const handle = await starting;
    await handle.submitCode!('abc.DEF_123#x~y-z');
    expect(pty.typed).toEqual(['abc.DEF_123#x~y-z\r']);
    await expect(handle.submitCode!('abc\r\nrm -rf /')).rejects.toBeInstanceOf(AgentSetupError);
    await handle.cancel();
    await expect(handle.submitCode!('abc')).rejects.toBeInstanceOf(AgentSetupError);
  });

  it('a new sign-in cancels the one before, and close kills the running one', async () => {
    const pty = fakePty();
    const { setup } = setupWith({ loadPty: pty.loader });
    const first = setup.signIn();
    await expect.poll(() => pty.spawned.length).toBe(1);
    pty.print(`visit: ${URL_OK}\r\n`);
    const firstHandle = await first;
    void setup.signIn().catch(() => {});
    await expect(firstHandle.done).resolves.toBe('cancelled');
    setup.close();
    expect(pty.kills()).toBeGreaterThanOrEqual(2);
  });

  it('when node-pty fails to load, sign-in fails with the reason and status says so; the detail goes to the log', async () => {
    const broken = createPtyLoader(async () => {
      throw new Error('Failed to load native module: pty.node\n    at somewhere');
    });
    const { setup, diagnostics } = setupWith({ loadPty: broken });
    await expect(setup.signIn()).rejects.toThrow("Sign-in isn't available on this computer: Failed to load native module: pty.node");
    expect(await setup.status()).toMatchObject({ install: 'installed', auth: 'failed', reason: "Sign-in isn't available on this computer: Failed to load native module: pty.node" });
    expect(diagnostics.join('\n')).toContain('at somewhere');
  });

  it('without the adapter it is not installed, and sign-in refuses', async () => {
    const setup = createClaudeCodeSetup({ adapterPath: undefined, env: () => ({}), listAuthMethods: async () => [CLAUDE_METHOD] });
    expect(await setup.status()).toMatchObject({ install: 'not_installed', auth: 'needs_sign_in' });
    await expect(setup.signIn()).rejects.toBeInstanceOf(AgentSetupError);
    const missingCli = createClaudeCodeSetup({ adapterPath: join(tempDir(), 'nope.mjs'), env: () => ({}), listAuthMethods: async () => [] });
    expect((await missingCli.status()).install).toBe('not_installed');
    await expect(createClaudeCodeSetup({ adapterPath: undefined, env: () => ({}), listAuthMethods: async () => [] }).install(() => {})).rejects.toBeInstanceOf(AgentSetupError);
  });

  it('two sign-ins started together orphan no terminal: cancel and close kill every one spawned', async () => {
    const spawned: Array<{ killed: boolean; exit: () => void }> = [];
    const loader: PtyLoader = async () => ({
      ok: true,
      spawnHidden(): HiddenPty {
        const exits: Array<(e: { exitCode: number; signal: number | null }) => void> = [];
        const entry = { killed: false, exit: () => exits.forEach((listener) => listener({ exitCode: 0, signal: 9 })) };
        spawned.push(entry);
        return {
          pid: 1000 + spawned.length,
          onData: () => {},
          onExit: (listener) => void exits.push(listener),
          write: () => {},
          kill: () => {
            if (entry.killed) return;
            entry.killed = true;
            entry.exit();
          },
        };
      },
    });
    // listAuthMethods resolves late, so both sign-ins are between awaits at once.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { setup } = setupWith({ loadPty: loader, listAuthMethods: async () => (await gate, [CLAUDE_METHOD]), timeouts: { urlMs: 200 } });
    const first = setup.signIn().catch((error: unknown) => error);
    const second = setup.signIn().catch((error: unknown) => error);
    release();
    await expect(first).resolves.toBeInstanceOf(AgentSetupError);
    // Only the newer one may spawn; the older one was superseded before it did.
    await expect.poll(() => spawned.length).toBe(1);
    setup.close();
    await second;
    expect(spawned.every((entry) => entry.killed)).toBe(true);

    // Cancel and the sign-in timeout kill their own terminal even after a newer sign-in took over.
    const pty = fakePty();
    const again = setupWith({ loadPty: pty.loader, timeouts: { signInMs: 100 } });
    const starting = again.setup.signIn();
    await expect.poll(() => pty.spawned.length).toBe(1);
    pty.print(`visit: ${URL_OK}\r\n`);
    const handle = await starting;
    await handle.cancel();
    expect(pty.kills()).toBe(1);
    await expect(handle.done).resolves.toBe('cancelled');
  });

  it('a spawn helper that could not be made executable is logged by its code only', async () => {
    const pty = fakePty();
    const loader: PtyLoader = async () => ({ ...(await pty.loader()), helperRepairFailed: 'EACCES' } as Awaited<ReturnType<PtyLoader>>);
    const { setup, diagnostics } = setupWith({ loadPty: loader });
    void setup.signIn().catch(() => {});
    await expect.poll(() => pty.spawned.length).toBe(1);
    expect(diagnostics.join('\n')).toContain('"code":"EACCES"');
  });

  it('a failed listing logs a code, never its message; odd method ids are only counted', async () => {
    const pty = fakePty();
    const failing = setupWith({ loadPty: pty.loader, listAuthMethods: async () => Promise.reject(Object.assign(new Error('agent printed SECRET-OUTPUT'), { code: 'agent_unavailable' })) });
    await expect(failing.setup.signIn()).rejects.toBeInstanceOf(AgentSetupError);
    expect(failing.diagnostics.join('\n')).not.toContain('SECRET-OUTPUT');
    expect(failing.diagnostics.join('\n')).toContain('agent_unavailable');
    const odd = setupWith({ loadPty: pty.loader, listAuthMethods: async () => [{ ...CLAUDE_METHOD, id: 'Evil id https://x' }, { ...CLAUDE_METHOD, id: 'console-login' }] });
    await expect(odd.setup.signIn()).rejects.toThrow(UNSUPPORTED_SIGN_IN);
    const log = odd.diagnostics.join('\n');
    expect(log).not.toContain('https://x');
    expect(log).toContain('"methods":["console-login"],"otherMethods":1');
  });

  it('with a cliBrowser the page opens the tab and the CLI gets that BROWSER', async () => {
    const pty = fakePty();
    const { setup } = setupWith({ loadPty: pty.loader, cliBrowser: 'true' });
    expect((await setup.status()).signInTab).toBe('page');
    void setup.signIn().catch(() => {});
    await expect.poll(() => pty.spawned.length).toBe(1);
    expect(pty.spawned[0]!.options.env.BROWSER).toBe('true');
  });
});

/** Whether a process with this pid exists. */
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** GETs `url` on localhost. */
const get = (url: string) =>
  new Promise<number>((resolve, reject) => {
    const req = request(url, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });

// The real node-pty, running the fake login through the fake agent. Required on CI; skipped locally only if node-pty can't load.
const realPty = await loadPty();
describe.runIf(realPty.ok || process.env.CI !== undefined)('signing in through the real terminal (fake login program)', () => {
  const realSetup = (env: Record<string, string>, overrides: Partial<ClaudeCodeSetupOptions> = {}) => {
    const setup = createClaudeCodeSetup({
      adapterPath: FAKE_AGENT,
      env: () => ({ PATH: process.env.PATH ?? '', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' } : {}), ...env }),
      claudeExecutable: null,
      listAuthMethods: async () => [CLAUDE_METHOD],
      ...overrides,
    });
    setups.push(setup);
    return setup;
  };

  it('node-pty loads', () => {
    expect(realPty).toMatchObject({ ok: true });
  });

  it('finishes through the localhost callback and reads signed in from auth status', async () => {
    const state = join(tempDir(), 'state.json');
    const setup = realSetup({ FAKE_LOGIN_STATE: state });
    expect((await setup.status()).auth).toBe('needs_sign_in');
    const handle = await setup.signIn();
    const callback = new URL(handle.url!).searchParams.get('redirect_uri')!;
    expect(callback).toMatch(/^http:\/\/localhost:\d+\/callback$/);
    expect(await get(callback.replace('localhost', '127.0.0.1'))).toBe(200);
    await expect(handle.done).resolves.toBe('signed_in');
    expect(await setup.status()).toMatchObject({ install: 'installed', auth: 'signed_in' });
  }, 30_000);

  it('a pasted code completes the sign-in', async () => {
    const state = join(tempDir(), 'state.json');
    const setup = realSetup({ FAKE_LOGIN_STATE: state, FAKE_LOGIN_MODE: 'code', FAKE_LOGIN_CODE: 'the-code-42' });
    const handle = await setup.signIn();
    await handle.submitCode!('the-code-42');
    await expect(handle.done).resolves.toBe('signed_in');
    expect(JSON.parse(readFileSync(state, 'utf8'))).toEqual({ loggedIn: true });
  }, 30_000);

  it('a failing login is failed', async () => {
    const setup = realSetup({ FAKE_LOGIN_MODE: 'fail' });
    const handle = await setup.signIn();
    await expect(handle.done).resolves.toBe('failed');
  }, 30_000);

  it('cancel kills the whole tree: the adapter and the CLI it started', async () => {
    const pidFile = join(tempDir(), 'cli.pid');
    const setup = realSetup({ FAKE_LOGIN_MODE: 'hang', FAKE_LOGIN_PID_FILE: pidFile });
    const handle = await setup.signIn();
    await expect.poll(() => existsSync(pidFile)).toBe(true);
    const cliPid = Number(readFileSync(pidFile, 'utf8'));
    expect(alive(cliPid)).toBe(true);
    await handle.cancel();
    await expect(handle.done).resolves.toBe('cancelled');
    await expect.poll(() => alive(cliPid), { timeout: 10_000 }).toBe(false);
  }, 30_000);

  it('no URL: the terminal is killed and the reason is plain', async () => {
    const pidFile = join(tempDir(), 'cli.pid');
    const setup = realSetup({ FAKE_LOGIN_MODE: 'nourl', FAKE_LOGIN_PID_FILE: pidFile }, { timeouts: { urlMs: 1500 } });
    await expect(setup.signIn()).rejects.toThrow("Claude Code didn't show a sign-in link. Try again.");
    const cliPid = Number(readFileSync(pidFile, 'utf8'));
    await expect.poll(() => alive(cliPid), { timeout: 10_000 }).toBe(false);
  }, 30_000);
});

const KEY = 'sk-ant-api03-TEST_ONLY_not_a_real_key_0123456789abcd';

/** A fake `fetch` recording each request; `answer` decides the outcome. */
function fakeFetch(answer: (init: RequestInit) => Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return answer(init ?? {});
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("Claude Code's API key (story 9.2)", () => {
  it('declares ANTHROPIC_API_KEY and accepts only sk-ant- keys, never echoing one', () => {
    const apiKey = createClaudeApiKey({ fetch: fakeFetch(async () => new Response(null, { status: 200 })).fetchImpl });
    expect(apiKey.envName).toBe('ANTHROPIC_API_KEY');
    expect(ANTHROPIC_API_KEY_ENV).toBe('ANTHROPIC_API_KEY');
    expect(apiKey.check(KEY)).toBeUndefined();
    for (const bad of ['', '   ', 'sk-ant-short', 'sk-proj-0123456789abcdefghijklmnop', `${KEY} trailing`, `x${KEY}`, 'sk-ant-api03-has space inside 0123456789']) {
      expect(apiKey.check(bad), bad).toBe(BAD_API_KEY);
    }
    expect(BAD_API_KEY).toBe("That doesn't look like an Anthropic API key.");
  });

  it('checks the key with a GET of /v1/models on the fixed host, the key only in x-api-key, redirects refused', async () => {
    const { fetchImpl, calls } = fakeFetch(async () => new Response('{"data":[]}', { status: 200 }));
    const apiKey = createClaudeApiKey({ fetch: fetchImpl });
    await expect(apiKey.verify(KEY, new AbortController().signal)).resolves.toBe('ok');
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe('https://api.anthropic.com/v1/models');
    expect(ANTHROPIC_VERIFY_URL).toBe('https://api.anthropic.com/v1/models');
    expect(call!.init.method).toBe('GET');
    expect(call!.init.redirect).toBe('error');
    expect(call!.init.headers).toEqual({ 'x-api-key': KEY, 'anthropic-version': '2023-06-01' });
    expect(call!.init.body).toBeUndefined();
    expect(call!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('401 and 403 are refused; 500, a thrown error and a timeout are unchecked; the log never holds the key or the body', async () => {
    const diagnostics: string[] = [];
    const outcome = async (answer: (init: RequestInit) => Promise<Response>, timeoutMs?: number) =>
      createClaudeApiKey({
        fetch: fakeFetch(answer).fetchImpl,
        onDiagnostic: (message, fields) => diagnostics.push(`${message} ${JSON.stringify(fields ?? {})}`),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      }).verify(KEY, new AbortController().signal);

    const body = `{"error":{"message":"invalid x-api-key ${KEY}"}}`;
    expect(await outcome(async () => new Response(body, { status: 401 }))).toBe('refused');
    expect(await outcome(async () => new Response(body, { status: 403 }))).toBe('refused');
    expect(await outcome(async () => new Response(body, { status: 500 }))).toBe('unchecked');
    expect(await outcome(async () => new Response(body, { status: 529 }))).toBe('unchecked');
    expect(
      await outcome(async () => {
        throw Object.assign(new TypeError(`fetch failed for ${KEY}`), { cause: { code: 'ENOTFOUND' } });
      }),
    ).toBe('unchecked');
    // A request that never answers: stopped by the timeout, through its signal.
    const hang = (init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'TimeoutError'))));
    expect(await outcome(hang, 10)).toBe('unchecked');

    const log = diagnostics.join('\n');
    expect(log).not.toContain(KEY);
    expect(log).not.toContain('sk-ant');
    expect(log).not.toContain('invalid x-api-key');
    expect(log).toContain('"status":401');
    expect(log).toContain('"status":500');
    expect(log).toContain('"code":"ENOTFOUND"');
    expect(log).toContain('"code":"timeout"');
  });

  it('stops when the caller aborts (the server stopping)', async () => {
    const controller = new AbortController();
    const apiKey = createClaudeApiKey({
      fetch: fakeFetch((init) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))).fetchImpl,
    });
    const pending = apiKey.verify(KEY, controller.signal);
    controller.abort();
    await expect(pending).resolves.toBe('unchecked');
  });

  it('the setup port carries it, and a stub replaces the check', async () => {
    const { setup } = setupWith({ apiKey: { verify: async () => 'refused' } });
    expect(setup.apiKey?.envName).toBe('ANTHROPIC_API_KEY');
    await expect(setup.apiKey!.verify(KEY, new AbortController().signal)).resolves.toBe('refused');
  });

  it('sign-in and auth status never see an API key, whatever its case, so the status is the subscription alone', async () => {
    const pty = fakePty();
    const dir = tempDir();
    // A stand-in adapter that says "signed in" whenever it was given a key: it must never be.
    const adapter = join(dir, 'adapter.mjs');
    writeFileSync(
      adapter,
      `const keyed = Object.keys(process.env).some((name) => name.toUpperCase() === 'ANTHROPIC_API_KEY');\n` +
        `process.stdout.write(JSON.stringify({ loggedIn: keyed }) + '\\n');\n`,
    );
    const setup = createClaudeCodeSetup({
      adapterPath: adapter,
      env: () => ({ PATH: process.env.PATH ?? '', ANTHROPIC_API_KEY: KEY, anthropic_api_key: KEY }),
      claudeExecutable: '/opt/claude/bin/claude',
      listAuthMethods: async (env) => {
        expect(Object.keys(env).map((name) => name.toUpperCase())).not.toContain('ANTHROPIC_API_KEY');
        return [CLAUDE_METHOD];
      },
      loadPty: pty.loader,
    });
    setups.push(setup);
    expect(await setup.status()).toMatchObject({ install: 'installed', auth: 'needs_sign_in', subscription: 'signed_out' });
    void setup.signIn().catch(() => {});
    await expect.poll(() => pty.spawned.length).toBe(1);
    expect(Object.keys(pty.spawned[0]!.options.env).map((name) => name.toUpperCase())).not.toContain('ANTHROPIC_API_KEY');
    expect(JSON.stringify(pty.spawned[0]!.options.env)).not.toContain(KEY);
  });

  it('status reports the subscription: signed in, signed out, or unknown when it can\'t tell', async () => {
    const { setup, signIn } = setupWith({ loadPty: fakePty().loader });
    expect((await setup.status()).subscription).toBe('signed_out');
    signIn();
    expect((await setup.status()).subscription).toBe('signed_in');
    const missing = createClaudeCodeSetup({ adapterPath: undefined, env: () => ({}), listAuthMethods: async () => [] });
    expect((await missing.status()).subscription).toBe('unknown');
  });
});
