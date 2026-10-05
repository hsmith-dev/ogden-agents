// SPIKE 16.1 (TEMPORARY): install detection by lookup on the user's PATH and well-known folders. Never installs.
// A `--version` probe is the only execution, with the allowlisted environment, a timeout and no shell.
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { execFile } from 'node:child_process';
import { helperEnvironment } from '../../../packages/adapters/src/child-env.ts';

/** Descriptor data, one per launcher. Names come from agent-matrix.md and each vendor's docs; the real ones are the user's live checks. */
export const LAUNCHERS = [
  { id: 'claude', names: ['claude'], known: { posix: ['~/.local/bin', '~/.claude/local', '~/.npm-global/bin', '/opt/homebrew/bin', '/usr/local/bin'], win32: ['~\\.local\\bin', '%APPDATA%\\npm'] }, install: 'https://docs.anthropic.com/en/docs/claude-code' },
  { id: 'codex', names: ['codex'], known: { posix: ['~/.npm-global/bin', '/opt/homebrew/bin', '/usr/local/bin', '~/.local/bin'], win32: ['%APPDATA%\\npm'] }, install: 'https://github.com/openai/codex' },
  { id: 'grok', names: ['grok'], known: { posix: ['~/.local/bin', '~/.grok/bin', '~/.npm-global/bin', '/opt/homebrew/bin'], win32: ['%APPDATA%\\npm', '~\\.grok\\bin'] }, install: 'https://x.ai/cli' },
  { id: 'antigravity', names: ['agy', 'antigravity'], known: { posix: ['~/.local/bin', '/usr/local/bin'], win32: ['%LOCALAPPDATA%\\Programs'] }, install: 'https://antigravity.google' },
  { id: 'gemini', names: ['gemini'], known: { posix: ['~/.npm-global/bin', '/opt/homebrew/bin', '/usr/local/bin'], win32: ['%APPDATA%\\npm'] }, install: 'https://github.com/google-gemini/gemini-cli' },
  { id: 'copilot', names: ['copilot'], known: { posix: ['~/.npm-global/bin', '/opt/homebrew/bin', '/usr/local/bin'], win32: ['%APPDATA%\\npm'] }, install: 'https://github.com/github/copilot-cli' },
];

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};
const isExec = (p, platform) => {
  if (!isFile(p)) return false;
  if (platform === 'win32') return true;
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** The path of `name` on `env.PATH` (Windows: with each PATHEXT extension), or the first well-known folder that has it. */
export function findOnPath(name, { env, platform = process.platform, known = [] }) {
  const win = platform === 'win32';
  const pathValue = env.PATH ?? env.Path ?? env.path ?? '';
  const exts = win ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const home = env.HOME ?? env.USERPROFILE ?? '';
  const expand = (dir) => dir.replace(/^~/, home).replace(/%([A-Za-z]+)%/g, (_, v) => env[v] ?? '');
  const dirs = [...pathValue.split(delimiter).filter(Boolean), ...known.map(expand)];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, win ? `${name}${ext.toLowerCase()}` : name);
      if (isExec(candidate, platform)) return { path: candidate, via: pathValue.split(delimiter).includes(dir) ? 'PATH' : 'well-known folder' };
    }
  }
  return undefined;
}

/** `--version` under the allowlist, shell-free, with a timeout. The reply text is not kept beyond one short line. */
export function probeVersion(path, { env, timeoutMs = 5000, platform = process.platform }) {
  return new Promise((resolve) => {
    const win = platform === 'win32';
    const isShim = win && /\.(cmd|bat)$/i.test(path);
    // Node refuses to run a .cmd or .bat without a shell (CVE-2024-27980 fix); a shim is run through cmd.exe, quoted.
    const file = isShim ? (env.ComSpec ?? 'cmd.exe') : path;
    const args = isShim ? ['/d', '/s', '/c', `"${path}" --version`] : ['--version'];
    execFile(file, args, { env, timeout: timeoutMs, windowsHide: true, windowsVerbatimArguments: isShim }, (error, stdout) => {
      if (error) resolve({ ok: false, code: error.code ?? error.signal ?? 'error' });
      else resolve({ ok: true, version: String(stdout).trim().split(/\r?\n/)[0].slice(0, 80) });
    });
  });
}

/** found | not-found | found-but-failed, for one launcher. */
export async function detect(launcher, { env, platform = process.platform }) {
  const fenv = helperEnvironment([], env, platform);
  const known = launcher.known[platform === 'win32' ? 'win32' : 'posix'];
  for (const name of launcher.names) {
    const hit = findOnPath(name, { env: { ...fenv, ...(env.APPDATA ? { APPDATA: env.APPDATA } : {}), ...(env.LOCALAPPDATA ? { LOCALAPPDATA: env.LOCALAPPDATA } : {}) }, platform, known });
    if (!hit) continue;
    const probe = await probeVersion(hit.path, { env: fenv, platform });
    return probe.ok ? { state: 'found', path: hit.path, via: hit.via, version: probe.version } : { state: 'found-but-failed', path: hit.path, via: hit.via, code: probe.code };
  }
  return { state: 'not-found', install: launcher.install };
}
