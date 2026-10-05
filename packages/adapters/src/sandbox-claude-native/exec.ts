/**
 * Running one command inside a sandbox (story 5.8: the verification's
 * independent test re-run, AD-17). The same containment Claude Code's
 * native sandbox gives a build's commands, made by Ogden Agents from the
 * run's `AgentSandbox` (its writable roots, denied paths and reads):
 *
 * - macOS: `sandbox-exec` with a Seatbelt profile that allows everything,
 *   then denies the network and every file write, then allows writes to the
 *   writable roots and the system's temporary folders, denies the denied
 *   paths again, and fences reads of the denied folders (the data folder,
 *   the credential folders) but the allowed ones.
 * - Linux: bubblewrap with a read-only root, every namespace unshared (so no
 *   network), the writable roots bound read-write, denied paths read-only,
 *   denied folders hidden by an empty folder and the allowed ones bound back.
 *
 * The command is one line run by the shell (`sh -c`); it comes from the
 * user's own project files, never from the worktree. Output is kept from
 * its end only, up to a bound. A timeout stops the whole process tree.
 */
import { spawn } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AgentSandbox, SandboxRunRequest, SandboxRunResult } from '@ogden-agents/core';
import { killProcessTree } from '../process-tree.js';

/** A path as a Seatbelt string: quoted, with `\` and `"` escaped. */
export function sbplString(path: string): string {
  return `"${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** The folders any command may write, whatever the run: a command needs somewhere temporary. */
function temporaryFolders(): string[] {
  const folders = ['/private/tmp', '/private/var/folders', '/tmp', '/var/tmp'];
  try {
    folders.push(realpathSync.native(tmpdir()));
  } catch {
    // Not there: the fixed ones stand.
  }
  return folders;
}

/** The Seatbelt profile for `sandbox` (see the header). */
export function seatbeltProfile(sandbox: AgentSandbox, temporary: readonly string[] = temporaryFolders()): string {
  const subpaths = (paths: readonly string[]) => paths.map((path) => `(subpath ${sbplString(path)})`).join(' ');
  const lines = ['(version 1)', '(allow default)', '(deny network*)', '(deny file-write*)', '(allow file-write* (literal "/dev/null") (literal "/dev/tty") (literal "/dev/dtracehelper"))'];
  const writable = [...sandbox.writableRoots, ...temporary];
  if (writable.length > 0) lines.push(`(allow file-write* ${subpaths(writable)})`);
  if (sandbox.deniedPaths.length > 0) lines.push(`(deny file-write* ${subpaths(sandbox.deniedPaths)})`);
  if (sandbox.deniedReads.length > 0) lines.push(`(deny file-read* ${subpaths(sandbox.deniedReads)})`);
  if (sandbox.allowedReads.length > 0) lines.push(`(allow file-read* ${subpaths(sandbox.allowedReads)})`);
  return lines.join('\n');
}

/** The bubblewrap arguments (before the program and its command) for `sandbox` running in `cwd`. */
export function bubblewrapArgs(sandbox: AgentSandbox, cwd: string, exists: (path: string) => 'dir' | 'file' | undefined = kindOf): string[] {
  const args = ['--unshare-all', '--die-with-parent', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp', '--tmpfs', '/run'];
  // Denied reads first: an empty folder over a folder, nothing over a file; the allowed reads and roots are bound back after.
  for (const path of sandbox.deniedReads) {
    const kind = exists(path);
    if (kind === 'dir') args.push('--tmpfs', path);
    else if (kind === 'file') args.push('--ro-bind', '/dev/null', path);
  }
  for (const path of sandbox.allowedReads) if (exists(path) !== undefined) args.push('--ro-bind', path, path);
  for (const path of sandbox.writableRoots) if (exists(path) !== undefined) args.push('--bind', path, path);
  for (const path of sandbox.deniedPaths) if (exists(path) !== undefined) args.push('--ro-bind', path, path);
  args.push('--chdir', cwd);
  return args;
}

function kindOf(path: string): 'dir' | 'file' | undefined {
  try {
    const info = statSync(path);
    return info.isDirectory() ? 'dir' : info.isFile() ? 'file' : undefined;
  } catch {
    return undefined;
  }
}

/** Runs `file` with `args` as the request asks (cwd, environment only as given, bounded output and time). Never throws. */
export function runBounded(file: string, args: readonly string[], request: Pick<SandboxRunRequest, 'cwd' | 'env' | 'timeoutMs' | 'maxOutputBytes'>, options: { shell?: boolean } = {}): Promise<SandboxRunResult> {
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let settled = false;
    const done = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, timedOut, output });
    };
    let child: ReturnType<typeof spawn>;
    try {
      // Its own process group (POSIX), so a timeout stops everything it started.
      child = spawn(file, [...args], { cwd: request.cwd, env: { ...request.env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32', shell: options.shell === true });
    } catch {
      resolve({ exitCode: null, timedOut: false, output: '' });
      return;
    }
    const keep = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      // The end of the output is what matters: bounded in characters (UTF-8 bytes are at least as many).
      if (output.length > request.maxOutputBytes * 2) output = output.slice(-request.maxOutputBytes);
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid);
    }, request.timeoutMs);
    child.on('error', () => done(null));
    // A process that left the group may hold the pipes open for ever: after the child itself exits, wait only a moment for them.
    child.on('exit', (code) => setTimeout(() => done(timedOut ? null : code), 2000).unref());
    child.on('close', (code) => {
      output = output.slice(-request.maxOutputBytes);
      done(timedOut ? null : code);
    });
  });
}

/** Runs the request inside Seatbelt (macOS). */
export function runInSeatbelt(request: SandboxRunRequest): Promise<SandboxRunResult> {
  return runBounded('/usr/bin/sandbox-exec', ['-p', seatbeltProfile(request.sandbox), '/bin/sh', '-c', request.command], request);
}

/** Runs the request inside bubblewrap (Linux), `bwrap` being the program found on the agent's PATH. */
export function runInBubblewrap(bwrap: string, request: SandboxRunRequest): Promise<SandboxRunResult> {
  return runBounded(bwrap, [...bubblewrapArgs(request.sandbox, request.cwd), '/bin/sh', '-c', request.command], request);
}

/**
 * Runs the request with NO sandbox: only for the test stand-in
 * (`createFixedSandbox`, which says its kind is `test`) and fixture commands.
 * The real sandboxes never call it.
 */
export function runUnsandboxedForTests(request: SandboxRunRequest): Promise<SandboxRunResult> {
  return runBounded(request.command, [], request, { shell: true });
}

