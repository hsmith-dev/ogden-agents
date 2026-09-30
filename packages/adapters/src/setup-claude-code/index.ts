/**
 * `setup-claude-code` (story 9.1): core's `AgentSetupPort` for Claude Code.
 * Signing in with a Claude subscription runs the adapter's own terminal
 * login, `node <claude-agent-acp> --cli auth login --claudeai`, in a hidden
 * pseudo-terminal (`terminal-pty`, AD-19), so no terminal is ever shown
 * (AD-21). The sign-in URL is read from its output and handed back once; the
 * login finishes through the CLI's own localhost callback (or a code the
 * user pastes), and success is read from `--cli auth status --json`.
 *
 * - The method is validated before anything runs (`auth-method.ts`), and
 *   what runs is always `nodePath`, the resolved adapter and fixed arguments.
 * - The terminal's environment is exactly the agent allowlist it is given,
 *   plus `CLAUDE_CODE_EXECUTABLE` and `TERM` (AD-16).
 * - Credentials stay in the CLI. The terminal's output, the URL, a pasted
 *   code and the status JSON are never logged or stored; diagnostics carry
 *   only step names and exit codes (AD-16).
 * - Cancel, the sign-in timeout, `close` and every failure kill the
 *   terminal's whole process tree.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { AgentSetupError, type AgentAuthMethod, type AgentSetupPort, type AgentSignIn } from '@ogden-agents/core';
import { SIGN_IN_CODE_PATTERN, MAX_SIGN_IN_CODE_LENGTH, type AgentSetupStatus } from '@ogden-agents/shared';
import { CLAUDE_CODE } from '../acp-claude-code/claude-code-agent.js';
import { findClaudeExecutable } from '../acp-claude-code/detect.js';
import { loadPty as defaultLoadPty, type HiddenPty, type PtyLoader } from '../terminal-pty/index.js';
import { CLAUDE_AI_LOGIN_ARGS, CLAUDE_AUTH_STATUS_ARGS, checkAuthMethods } from './auth-method.js';
import { DEFAULT_SIGN_IN_HOSTS, findSignInUrl } from './sign-in-output.js';

export { CLAUDE_AI_LOGIN_ARGS, CLAUDE_AI_LOGIN_ID, CLAUDE_AUTH_STATUS_ARGS, UNSUPPORTED_SIGN_IN, checkAuthMethods } from './auth-method.js';
export { DEFAULT_SIGN_IN_HOSTS, findSignInUrl, isAllowedSignInUrl, stripTerminalEscapes } from './sign-in-output.js';

export const CLAUDE_CODE_AGENT_ID = 'claude-code';

/** How long the login may take to print its URL. */
export const URL_TIMEOUT_MS = 30_000;
/** How long a sign-in may stay open before it is stopped. */
export const SIGN_IN_TIMEOUT_MS = 10 * 60_000;
/** How long `auth status` may take. */
export const STATUS_TIMEOUT_MS = 5_000;
/** Terminal width: wide enough that the URL never wraps. */
export const PTY_COLUMNS = 2000;
const PTY_ROWS = 50;
/** The most recent output kept (in memory only) while looking for the URL. */
const OUTPUT_KEEP_CHARS = 64 * 1024;

const COULD_NOT_START = `${CLAUDE_CODE} couldn't start signing in. Try again.`;
const NO_URL = `${CLAUDE_CODE} didn't show a sign-in link. Try again.`;
const UNAVAILABLE = (reason: string) => `Sign-in isn't available on this computer: ${reason}`;
const CANT_CHECK = `Ogden Agents couldn't check whether ${CLAUDE_CODE} is signed in. Try again.`;

export interface ClaudeCodeSetupOptions {
  /** The Claude Agent ACP adapter's entry script, or `undefined` when it isn't installed. */
  adapterPath: string | undefined;
  /** The Node that runs the adapter. Default: this one. */
  nodePath?: string;
  /** The agent environment allowlist (AD-16), read at each run. Never logged. */
  env: () => Readonly<Record<string, string>>;
  /**
   * The `claude` CLI the adapter runs. Default: one found on `PATH` or at
   * Claude Code's install locations; `null` lets the adapter use its bundled one.
   */
  claudeExecutable?: string | null;
  /** Claude Code's advertised sign-in methods (the `acp-claude-code` adapter's `listAuthMethods`). */
  listAuthMethods: (env: Readonly<Record<string, string>>) => Promise<AgentAuthMethod[]>;
  /** Default: `terminal-pty`'s lazy `node-pty` loader. */
  loadPty?: PtyLoader;
  /** Hosts a sign-in URL may be on. Default {@link DEFAULT_SIGN_IN_HOSTS}. */
  allowedHosts?: readonly string[];
  timeouts?: { urlMs?: number; signInMs?: number; statusMs?: number };
  /**
   * A `BROWSER` value that stops the CLI opening its own sign-in tab, so the
   * page opens it instead. Unset (the default until a live check proves one
   * works): the CLI opens its own tab and the page shows a link.
   */
  cliBrowser?: string;
  /** Step names, exit codes and load failures, for the log. Never output, a URL or a code. */
  onDiagnostic?: (message: string, fields?: Record<string, unknown>) => void;
}

export interface ClaudeCodeSetup extends AgentSetupPort {
  /** Kills a running sign-in's terminal (server stop). Safe to call more than once. */
  close(): void;
}

interface Running {
  pty: HiddenPty;
  cancelled: boolean;
  /** Set by the first stop; its terminal is killed once. */
  stopped: boolean;
  finish(outcome: 'signed_in' | 'failed' | 'cancelled'): void;
}

export function createClaudeCodeSetup(options: ClaudeCodeSetupOptions): ClaudeCodeSetup {
  const nodePath = options.nodePath ?? process.execPath;
  const loadPty = options.loadPty ?? defaultLoadPty;
  const hosts = options.allowedHosts ?? DEFAULT_SIGN_IN_HOSTS;
  const urlMs = options.timeouts?.urlMs ?? URL_TIMEOUT_MS;
  const signInMs = options.timeouts?.signInMs ?? SIGN_IN_TIMEOUT_MS;
  const statusMs = options.timeouts?.statusMs ?? STATUS_TIMEOUT_MS;
  let running: Running | undefined;
  /**
   * Bumped by every sign-in and by `close`, before any await: a sign-in that
   * finds it changed after an await was superseded and spawns nothing.
   */
  let generation = 0;
  /** Every terminal still alive, whatever sign-in owns it, so `close` kills them all. */
  const live = new Set<HiddenPty>();

  const diagnostic = (message: string, fields?: Record<string, unknown>) => {
    try {
      options.onDiagnostic?.(message, fields);
    } catch {
      // Logging never breaks a sign-in.
    }
  };

  const adapter = (): string | undefined =>
    options.adapterPath !== undefined && existsSync(options.adapterPath) ? options.adapterPath : undefined;

  /** The allowlisted environment, plus the user's own `claude` and a terminal type (AD-16). */
  const cliEnv = (): Record<string, string> => {
    const env: Record<string, string> = { ...options.env() };
    if (env.CLAUDE_CODE_EXECUTABLE === undefined) {
      const claude = options.claudeExecutable === undefined ? findClaudeExecutable(env) : options.claudeExecutable;
      if (claude !== null && claude !== undefined) env.CLAUDE_CODE_EXECUTABLE = claude;
    }
    env.TERM = 'xterm-256color';
    if (options.cliBrowser !== undefined) env.BROWSER = options.cliBrowser;
    return env;
  };

  /** `auth status --json`: signed in, not signed in, or `undefined` when it can't tell. Its output is never logged. */
  const readAuthStatus = (script: string): Promise<{ loggedIn: boolean } | 'missing' | undefined> =>
    new Promise((resolve) => {
      let child;
      try {
        child = execFile(
          nodePath,
          [script, ...CLAUDE_AUTH_STATUS_ARGS],
          { env: cliEnv(), cwd: homedir(), timeout: statusMs, windowsHide: true, maxBuffer: 256 * 1024, encoding: 'utf8' },
          (error, stdout) => {
            const parsed = parseStatus(stdout);
            if (parsed !== undefined) return resolve(parsed);
            const failure = error as (NodeJS.ErrnoException & { killed?: boolean; code?: unknown }) | null;
            diagnostic('Claude Code sign-in status unreadable', {
              step: 'auth_status',
              exitCode: typeof failure?.code === 'number' ? failure.code : null,
              timedOut: failure?.killed === true,
            });
            // Timed out: it is there but slow. Anything else without JSON: the CLI isn't usable.
            resolve(failure?.killed === true ? undefined : 'missing');
          },
        );
      } catch (error) {
        diagnostic('Claude Code sign-in status could not start', { step: 'auth_status', reason: String(error) });
        resolve('missing');
        return;
      }
      child.on('error', () => {});
      child.stdin?.on('error', () => {});
      child.stdin?.end();
    });

  const base = (): Pick<AgentSetupStatus, 'agentId' | 'displayName' | 'signInTab'> => ({
    agentId: CLAUDE_CODE_AGENT_ID,
    displayName: CLAUDE_CODE,
    signInTab: options.cliBrowser === undefined ? 'agent' : 'page',
  });

  /** Stops one sign-in: always kills its own terminal, whether or not it is still the running one. */
  const stop = (target: Running, outcome: 'failed' | 'cancelled') => {
    if (running === target) running = undefined;
    if (target.stopped) return;
    target.stopped = true;
    target.cancelled = outcome === 'cancelled';
    target.pty.kill();
    target.finish(outcome);
  };

  const stopRunning = (outcome: 'failed' | 'cancelled') => {
    if (running !== undefined) stop(running, outcome);
  };

  return {
    agentId: CLAUDE_CODE_AGENT_ID,
    displayName: CLAUDE_CODE,

    async status() {
      const script = adapter();
      if (script === undefined) return { ...base(), install: 'not_installed', version: null, auth: 'needs_sign_in' };
      const status = await readAuthStatus(script);
      if (status === 'missing') return { ...base(), install: 'not_installed', version: null, auth: 'needs_sign_in' };
      if (status === undefined) return { ...base(), install: 'installed', version: null, auth: 'needs_sign_in', reason: CANT_CHECK };
      if (status.loggedIn) return { ...base(), install: 'installed', version: null, auth: 'signed_in', method: 'subscription' };
      const pty = await loadPty();
      if (!pty.ok) return { ...base(), install: 'installed', version: null, auth: 'failed', reason: UNAVAILABLE(pty.reason) };
      return { ...base(), install: 'installed', version: null, auth: 'needs_sign_in' };
    },

    async install() {
      throw new AgentSetupError(`Installing ${CLAUDE_CODE} from Ogden Agents isn't available yet.`);
    },

    async signIn(): Promise<AgentSignIn> {
      // One sign-in at a time: a new one stops the one before, and claims its turn before any await.
      stopRunning('cancelled');
      const mine = ++generation;
      const superseded = () => generation !== mine;
      const script = adapter();
      if (script === undefined) throw new AgentSetupError(`${CLAUDE_CODE} isn't set up for Ogden Agents on this computer yet.`);

      const pty = await loadPty();
      if (superseded()) throw new AgentSetupError(COULD_NOT_START);
      if (!pty.ok) {
        diagnostic('the terminal module failed to load', { step: 'load_pty', reason: pty.detail });
        throw new AgentSetupError(UNAVAILABLE(pty.reason));
      }
      if (pty.helperRepairFailed !== undefined) {
        diagnostic("the terminal's spawn helper could not be made executable", { step: 'load_pty', code: pty.helperRepairFailed });
      }

      const env = cliEnv();
      let methods: AgentAuthMethod[];
      try {
        methods = await options.listAuthMethods(env);
      } catch (error) {
        // A code only: an error message could carry what the agent printed.
        const code = (error as { code?: unknown } | null)?.code;
        diagnostic('Claude Code sign-in methods unavailable', { step: 'list_auth_methods', code: typeof code === 'string' || typeof code === 'number' ? code : 'unknown' });
        throw new AgentSetupError(COULD_NOT_START, { cause: error });
      }
      if (superseded()) throw new AgentSetupError(COULD_NOT_START);
      const method = checkAuthMethods(methods);
      if (!method.ok) {
        const ids = methods.map((m) => m.id);
        const plainIds = ids.filter((id) => /^[a-z-]{1,40}$/.test(id));
        diagnostic('Claude Code offers no sign-in Ogden Agents runs', { step: 'check_auth_method', methods: plainIds, otherMethods: ids.length - plainIds.length });
        throw new AgentSetupError(method.reason);
      }

      let terminal: HiddenPty;
      try {
        terminal = pty.spawnHidden(nodePath, [script, ...method.args], { env, cwd: homedir(), cols: PTY_COLUMNS, rows: PTY_ROWS });
      } catch (error) {
        diagnostic('Claude Code sign-in could not start', { step: 'spawn', reason: error instanceof Error ? error.message : String(error) });
        throw new AgentSetupError(COULD_NOT_START, { cause: error });
      }
      live.add(terminal);
      terminal.onExit(() => live.delete(terminal));
      diagnostic('Claude Code sign-in started', { step: 'spawn' });

      let signInTimer: ReturnType<typeof setTimeout> | undefined;
      let finish!: (outcome: 'signed_in' | 'failed' | 'cancelled') => void;
      const done = new Promise<'signed_in' | 'failed' | 'cancelled'>((resolve) => {
        let settled = false;
        finish = (outcome) => {
          if (settled) return;
          settled = true;
          clearTimeout(signInTimer);
          resolve(outcome);
        };
      });
      const self: Running = { pty: terminal, cancelled: false, stopped: false, finish };
      running = self;
      signInTimer = setTimeout(() => {
        diagnostic('Claude Code sign-in timed out', { step: 'sign_in_timeout' });
        stop(self, 'failed');
      }, signInMs);
      signInTimer.unref?.();

      // Found in the output (kept in memory only), or the reason there is none.
      let output = '';
      let urlFound: ((url: string) => void) | undefined;
      let urlFailed: ((error: Error) => void) | undefined;
      const url = new Promise<string>((resolve, reject) => {
        urlFound = resolve;
        urlFailed = reject;
      });
      const urlTimer = setTimeout(() => {
        if (urlFailed === undefined) return;
        diagnostic('Claude Code showed no sign-in link in time', { step: 'wait_for_url' });
        urlFailed(new AgentSetupError(NO_URL));
      }, urlMs);
      urlTimer.unref?.();

      terminal.onData((data) => {
        if (urlFound === undefined) return;
        output = (output + data).slice(-OUTPUT_KEEP_CHARS);
        const found = findSignInUrl(output, hosts);
        if (found === undefined) return;
        const resolveUrl = urlFound;
        urlFound = undefined;
        urlFailed = undefined;
        output = '';
        clearTimeout(urlTimer);
        resolveUrl(found);
      });

      terminal.onExit(({ exitCode, signal }) => {
        diagnostic('Claude Code sign-in exited', { step: 'login_exit', exitCode, signal });
        if (urlFailed !== undefined) {
          const reject = urlFailed;
          urlFound = undefined;
          urlFailed = undefined;
          clearTimeout(urlTimer);
          reject(new AgentSetupError(self.cancelled ? COULD_NOT_START : NO_URL));
        }
        if (running !== self) return;
        if (exitCode !== 0) {
          running = undefined;
          finish('failed');
          return;
        }
        // The login says it finished: the CLI's own status decides.
        void readAuthStatus(script).then((status) => {
          if (running !== self) return;
          running = undefined;
          const signedIn = typeof status === 'object' && status.loggedIn;
          diagnostic('Claude Code sign-in finished', { step: 'auth_status', signedIn });
          finish(signedIn ? 'signed_in' : 'failed');
        });
      });

      let signInUrl: string;
      try {
        signInUrl = await url;
      } catch (error) {
        stop(self, self.cancelled ? 'cancelled' : 'failed');
        throw error;
      }
      output = '';

      return {
        url: signInUrl,
        done,
        cancel: async () => stop(self, 'cancelled'),
        submitCode: async (code: string) => {
          if (running !== self) throw new AgentSetupError(`No ${CLAUDE_CODE} sign-in is waiting for a code.`);
          if (code.length === 0 || code.length > MAX_SIGN_IN_CODE_LENGTH || !SIGN_IN_CODE_PATTERN.test(code)) {
            throw new AgentSetupError("That doesn't look like a sign-in code.");
          }
          terminal.write(`${code}\r`);
        },
      };
    },

    close() {
      generation++;
      stopRunning('cancelled');
      for (const terminal of live) terminal.kill();
      live.clear();
    },
  };
}

/** The `loggedIn` of the last JSON object line in `stdout`, or `undefined` when there is none. */
function parseStatus(stdout: string | undefined): { loggedIn: boolean } | undefined {
  if (stdout === undefined) return undefined;
  const lines = stdout.split(/\r?\n/).map((line) => line.trim());
  const candidates = [stdout.trim(), ...lines.reverse()].filter((line) => line.startsWith('{'));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as { loggedIn?: unknown };
      if (typeof value.loggedIn === 'boolean') return { loggedIn: value.loggedIn };
    } catch {
      // Not this line.
    }
  }
  return undefined;
}
