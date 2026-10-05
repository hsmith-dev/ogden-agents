/**
 * Whether the installed Grok still accepts an xAI API access token over ACP
 * (epic 12 entry 8). The `xai.api_key` method is not advertised (spike 12.2),
 * so a release could drop it: Install asks the checked binary once, with a
 * dummy token that never reaches xAI (`initialize` then `authenticate`, no
 * session, no model call), and refuses the install in plain words when it
 * says no. The binary runs in an empty temp home, with the base environment
 * only, and is always stopped.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GROK_API_KEY_ENV, GROK_AUTH_METHOD_IDS, GROK_DISABLE_AUTOUPDATER_ENV, GROK_HOME_ENV } from '../acp-grok/constants.js';
import { baseEnvironment } from '../child-env.js';

/** The most output the probe reads without a line end before it gives up. */
const MAX_PROBE_OUTPUT = 1024 * 1024;

/** The longest the probe waits for the binary's two answers. */
export const TOKEN_PROBE_TIMEOUT_MS = 20_000;

/** The default probe: spawns `binary` as `agent stdio` and asks. `false` on any failure or timeout. */
export async function grokAcceptsToken(binary: string, timeoutMs = TOKEN_PROBE_TIMEOUT_MS): Promise<boolean> {
  const home = mkdtempSync(join(tmpdir(), 'ogden-agents-grok-probe-'));
  try {
    return await new Promise<boolean>((resolve) => {
      let done = false;
      let child: ReturnType<typeof spawn> | undefined;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          child?.stdin?.end();
          child?.kill();
          // A binary that ignores the first signal is stopped for good shortly after.
          const target = child;
          if (target !== undefined) setTimeout(() => target.kill('SIGKILL'), 2_000).unref();
        } catch {
          // Already gone.
        }
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      try {
        child = spawn(binary, ['agent', '--no-leader', 'stdio'], {
          cwd: tmpdir(),
          // Everything the binary could write to lives in the temp folder: not the user's home, config or cache folders.
          env: {
            ...baseEnvironment(),
            HOME: home,
            USERPROFILE: home,
            XDG_CONFIG_HOME: home,
            XDG_CACHE_HOME: home,
            XDG_DATA_HOME: home,
            ...(process.platform === 'win32' ? { APPDATA: home, LOCALAPPDATA: home } : {}),
            [GROK_HOME_ENV]: home, [GROK_DISABLE_AUTOUPDATER_ENV]: '1', [GROK_API_KEY_ENV]: `xai-${'0'.repeat(40)}` },
          stdio: ['pipe', 'pipe', 'ignore'],
          windowsHide: true,
          shell: false,
        });
      } catch {
        return finish(false);
      }
      child.on('error', () => finish(false));
      child.on('close', () => finish(false));
      let buffer = '';
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        buffer += chunk;
        if (buffer.length > MAX_PROBE_OUTPUT) return finish(false);
        let at: number;
        while ((at = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          let message: { id?: number; result?: unknown; error?: unknown };
          try {
            message = JSON.parse(line) as typeof message;
          } catch {
            continue;
          }
          if (message.id === 1 && message.error === undefined) {
            child?.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'authenticate', params: { methodId: GROK_AUTH_METHOD_IDS.apiKey } })}\n`);
          } else if (message.id === 1 || message.id === 2) {
            finish(message.id === 2 && message.error === undefined);
          }
        }
      });
      child.stdin?.on('error', () => {});
      child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } })}\n`);
    });
  } finally {
    try {
      rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // A folder the stopped binary still holds (Windows) is left for the OS temp cleanup: never changes the answer.
    }
  }
}
