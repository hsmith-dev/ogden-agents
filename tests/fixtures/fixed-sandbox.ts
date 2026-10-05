import { spawn } from 'node:child_process';

type Choice = 'other_agent' | 'install_docker' | 'attended';

/**
 * A fixed sandbox answer with the status that agrees (story 5.6), and a `run`
 * for the verification's fixture test command (story 5.8) that runs it with
 * no sandbox for the kind `test` only, as `createFixedSandbox` does.
 */
export const fixedSandbox = (check: { available: true; kind: string } | { available: false; reason: string; choices?: Choice[] }) => ({
  check: async () => check,
  status: async () => (check.available
    ? { platform: 'other' as const, available: true, kind: check.kind, summary: 'ok', probes: [], choices: [], installHint: null }
    : { platform: 'other' as const, available: false, kind: null, summary: check.reason, probes: [], choices: check.choices ?? ['other_agent', 'install_docker', 'attended'], installHint: null }),
  run: (request: { sandbox: { kind: string }; cwd: string; command: string; env: Readonly<Record<string, string>>; timeoutMs: number }) =>
    request.sandbox.kind !== 'test'
      ? Promise.resolve(undefined)
      : new Promise<{ exitCode: number | null; timedOut: boolean; output: string }>((resolve) => {
          let output = '';
          const child = spawn(request.command, { cwd: request.cwd, env: { ...request.env }, shell: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
          child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
          child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
          const timer = setTimeout(() => child.kill('SIGKILL'), request.timeoutMs);
          child.on('error', () => resolve({ exitCode: null, timedOut: false, output }));
          child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ exitCode: code, timedOut: false, output });
          });
        }),
});
