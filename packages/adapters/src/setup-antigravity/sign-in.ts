/**
 * Signing in to Antigravity with Google (epic 6 entry 7; the user accepted
 * Google's terms risk, 2026-10-02), by the route spike 6.1 found: the
 * server's own `authenticate oauth-personal`, which waits until the browser
 * flow ends. The URL never comes over ACP: the server prints it on stderr
 * ("Open the following link to authenticate the ACP server: <url>") and
 * hands it to Python's `webbrowser`, which honours `BROWSER`. Its redirect is
 * a loopback `http://127.0.0.1:<port>/`, so the browser must be on the same
 * computer as Ogden.
 *
 * - macOS and Linux: `BROWSER` is an Ogden helper script in a private temp
 *   folder that writes the URL to a file only Ogden can read, and opens
 *   nothing, so the page opens the tab itself (`signInTab: page`).
 * - Windows: `BROWSER` can't be a script (spike 6.1: Python runs a `.cmd`
 *   through `cmd.exe`, which splits the URL at `&`), so it is left unset and
 *   the server opens the default browser itself (`signInTab: agent`); the
 *   page shows the link too.
 * - The URL is taken from whichever comes first, the helper's file or a
 *   stderr line, only as an `https:` URL on Google's sign-in host. It is
 *   handed back once, for core's `no-store` answer, and never logged,
 *   evented or kept: the helper's file is deleted on read and its folder
 *   when the sign-in ends.
 * - The server gets no API key. Cancel, the timeout, and the end of the
 *   sign-in stop its whole process tree.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { AgentSetupError, type AgentSignIn } from '@ogden-agents/core';
import { findSignInUrl } from '../setup-claude-code/sign-in-output.js';
import { SETUP_INITIALIZE, startSetupServer, withTimeout, type ServerCommand } from './acp-probe.js';

/** Where Google's sign-in page is. */
export const GOOGLE_SIGN_IN_HOSTS: readonly string[] = Object.freeze(['accounts.google.com']);

/** The helper's poll interval for the URL file. */
const POLL_MS = 200;

export interface GoogleSignInInput {
  server: ServerCommand;
  /** Exactly the server's environment, its `GEMINI_HOME` included and no API key. */
  env: Readonly<Record<string, string>>;
  cwd: string;
  platform: NodeJS.Platform;
  methodId: string;
  displayName: string;
  hosts: readonly string[];
  startTimeoutMs: number;
  urlTimeoutMs: number;
  signInTimeoutMs: number;
  /** Called once Google sign-in finished, before `done` resolves `signed_in`. */
  onSignedIn: () => void;
  diagnostic: (message: string, fields?: Record<string, unknown>) => void;
  /**
   * Where the private work folder (the `BROWSER` helper and its URL file) is
   * made: Ogden's owner-only data folder, not the temp folder, which may be
   * mounted `noexec`.
   */
  workRoot: string;
  /** Called once the server is spawned, with the sign-in's cancel, so it can be stopped before its link arrives. */
  onStarted?: (cancel: () => Promise<void>) => void;
}

/** A single-quoted POSIX shell word. */
const shellQuote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

/** Writes the `BROWSER` helper into `dir`; `undefined` when its path can't be a `BROWSER` value (it has the list separator). */
function writeBrowserHelper(dir: string): string | undefined {
  const script = join(dir, 'open-url');
  if (script.includes(delimiter)) return undefined;
  const part = join(dir, 'url.part');
  const done = join(dir, 'url');
  writeFileSync(script, `#!/bin/sh\numask 077\nprintf '%s' "$1" > ${shellQuote(part)} && mv -f ${shellQuote(part)} ${shellQuote(done)}\n`, { mode: 0o700 });
  chmodSync(script, 0o700);
  return script;
}

export async function startGoogleSignIn(input: GoogleSignInInput): Promise<AgentSignIn> {
  const couldNotStart = `${input.displayName} couldn't start signing in. Try again.`;
  const noUrl = `${input.displayName} didn't show a Google sign-in link. Try again.`;
  const work = mkdtempSync(join(input.workRoot, '.signin-'));
  if (input.platform !== 'win32') chmodSync(work, 0o700);
  const cleanup = () => {
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      // Best effort: it holds at most a URL file, owner-only, in the temp folder.
    }
  };
  const env: Record<string, string> = Object.fromEntries(Object.entries(input.env).filter(([name]) => name.toUpperCase() !== 'BROWSER'));
  const helper = input.platform === 'win32' ? undefined : writeBrowserHelper(work);
  if (helper !== undefined) env.BROWSER = helper;

  let urlTimer: ReturnType<typeof setTimeout> | undefined;
  let foundUrl: ((url: string | null) => void) | undefined;
  let failUrl: ((error: Error) => void) | undefined;
  // `null` when it finished without a link (a sign-in already kept in its home).
  const url = new Promise<string | null>((resolve, reject) => {
    foundUrl = resolve;
    failUrl = reject;
  });
  url.catch(() => {});
  const offer = (candidate: string | undefined) => {
    if (candidate === undefined || foundUrl === undefined) return;
    const resolve = foundUrl;
    foundUrl = undefined;
    failUrl = undefined;
    clearTimeout(urlTimer);
    resolve(candidate);
  };
  const refuseUrl = (error: Error) => {
    if (failUrl === undefined) return;
    const reject = failUrl;
    foundUrl = undefined;
    failUrl = undefined;
    reject(error);
  };

  let server;
  try {
    server = startSetupServer({
      server: input.server,
      env,
      cwd: input.cwd,
      // Each line is looked at in memory and dropped; none is ever logged.
      onStderrLine: (line) => offer(findSignInUrl(`${line}\n`, input.hosts)),
    });
  } catch (error) {
    cleanup();
    input.diagnostic('Antigravity sign-in could not start', { step: 'spawn', code: (error as { code?: unknown }).code ?? 'unknown' });
    throw new AgentSetupError(couldNotStart, { cause: error });
  }
  input.diagnostic('Antigravity sign-in started', { step: 'spawn', browserHelper: helper !== undefined });

  const poll =
    helper === undefined
      ? undefined
      : setInterval(() => {
          let text: string;
          try {
            text = readFileSync(join(work, 'url'), 'utf8');
          } catch {
            return;
          }
          try {
            rmSync(join(work, 'url'), { force: true });
          } catch {
            // Removed with its folder when the sign-in ends.
          }
          offer(findSignInUrl(`${text.trim()}\n`, input.hosts));
        }, POLL_MS);
  poll?.unref?.();

  let finish!: (outcome: 'signed_in' | 'failed' | 'cancelled') => void;
  let settled = false;
  let signInTimer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<'signed_in' | 'failed' | 'cancelled'>((resolve) => {
    finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(signInTimer);
      clearTimeout(urlTimer);
      if (poll !== undefined) clearInterval(poll);
      server.stop();
      cleanup();
      // Signed in before any link was shown: there is none to open.
      if (outcome === 'signed_in' && foundUrl !== undefined) {
        const resolveUrl = foundUrl;
        foundUrl = undefined;
        failUrl = undefined;
        resolveUrl(null);
      }
      refuseUrl(new AgentSetupError(outcome === 'cancelled' ? couldNotStart : noUrl));
      resolve(outcome);
    };
  });
  urlTimer = setTimeout(() => {
    input.diagnostic('Antigravity showed no sign-in link in time', { step: 'wait_for_url' });
    refuseUrl(new AgentSetupError(noUrl));
    finish('failed');
  }, input.urlTimeoutMs);
  urlTimer.unref?.();
  signInTimer = setTimeout(() => {
    input.diagnostic('Antigravity sign-in timed out', { step: 'sign_in_timeout' });
    finish('failed');
  }, input.signInTimeoutMs);
  signInTimer.unref?.();

  void server.exited.then((code) => {
    if (settled) return;
    input.diagnostic('Antigravity sign-in server exited', { step: 'server_exit', exitCode: code });
    finish('failed');
  });

  void (async () => {
    try {
      const init = await withTimeout(server.connection.initialize(SETUP_INITIALIZE), input.startTimeoutMs, 'initialize');
      if (!(init.authMethods ?? []).some((method) => method.id === input.methodId)) {
        input.diagnostic('Antigravity offers no Google sign-in', { step: 'check_auth_method' });
        refuseUrl(new AgentSetupError(`${input.displayName} doesn't offer Google sign-in here.`));
        finish('failed');
        return;
      }
      await server.connection.authenticate({ methodId: input.methodId });
      if (settled) return;
      input.onSignedIn();
      input.diagnostic('Antigravity sign-in finished', { step: 'authenticate', signedIn: true });
      finish('signed_in');
    } catch (error) {
      if (settled) return;
      const code = (error as { code?: unknown }).code;
      input.diagnostic('Antigravity sign-in failed', { step: 'authenticate', code: typeof code === 'string' || typeof code === 'number' ? code : 'unknown' });
      finish('failed');
    }
  })();

  input.onStarted?.(async () => finish('cancelled'));
  let signInUrl: string | null;
  try {
    signInUrl = await url;
  } catch (error) {
    finish('failed');
    throw error;
  }
  return {
    url: signInUrl,
    done,
    cancel: async () => finish('cancelled'),
  };
}
