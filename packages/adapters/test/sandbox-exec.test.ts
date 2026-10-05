/**
 * Running one command inside a sandbox (story 5.8): the Seatbelt profile and
 * bubblewrap arguments as text, and, where this computer's own sandbox works,
 * a real run that proves a write outside the roots, a read of a fenced
 * folder and the network are refused. Windows has no sandbox: nothing runs.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentSandbox } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { bubblewrapArgs, runBounded, runUnsandboxedForTests, sbplString, seatbeltProfile } from '../src/sandbox-claude-native/exec.js';
import { createFixedSandbox, createNativeSandboxStep } from '../src/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
/** A folder outside every temporary folder (a sandbox lets a command write those): under the working folder, removed after. */
const temp = () => {
  const dir = realpathSync.native(mkdtempSync(join(process.cwd(), '.ogden-agents-exec-')));
  dirs.push(dir);
  return dir;
};

const sandbox: AgentSandbox = { kind: 'seatbelt', writableRoots: ['/data/w/abc'], deniedPaths: ['/data/w/abc/.claude'], deniedReads: ['/data', '/home/u/.ssh'], allowedReads: ['/data/w/abc'] };

describe('the profile and arguments (story 5.8)', () => {
  it('Seatbelt: network denied, writes denied but the roots and temporary folders, the denied paths again, reads fenced but the allowed ones, in that order', () => {
    const profile = seatbeltProfile(sandbox, ['/private/tmp']);
    const lines = profile.split('\n');
    expect(lines[0]).toBe('(version 1)');
    expect(lines).toContain('(deny network*)');
    const at = (needle: string) => lines.findIndex((line) => line.includes(needle));
    expect(at('(deny file-write*)')).toBeLessThan(at('(allow file-write* (subpath "/data/w/abc") (subpath "/private/tmp"))'));
    expect(at('(allow file-write* (subpath')).toBeLessThan(at('(deny file-write* (subpath "/data/w/abc/.claude"))'));
    expect(at('(deny file-read* (subpath "/data") (subpath "/home/u/.ssh"))')).toBeLessThan(at('(allow file-read* (subpath "/data/w/abc"))'));
    expect(sbplString('/a "b"\\c')).toBe('"/a \\"b\\"\\\\c"');
  });

  it('bubblewrap: every namespace unshared, a read-only root, denied reads emptied first, roots bound read-write, denied paths read-only', () => {
    const kinds: Record<string, 'dir' | 'file'> = { '/data': 'dir', '/home/u/.ssh': 'dir', '/home/u/.netrc': 'file', '/data/w/abc': 'dir', '/data/w/abc/.claude': 'dir' };
    const args = bubblewrapArgs({ ...sandbox, deniedReads: ['/data', '/home/u/.netrc', '/gone'] }, '/data/w/abc', (path) => kinds[path]);
    expect(args.slice(0, 3)).toEqual(['--unshare-all', '--die-with-parent', '--ro-bind']);
    const text = args.join(' ');
    expect(text).toContain('--tmpfs /data');
    expect(text).toContain('--ro-bind /dev/null /home/u/.netrc');
    expect(text).not.toContain('/gone');
    expect(text.indexOf('--tmpfs /data')).toBeLessThan(text.indexOf('--bind /data/w/abc /data/w/abc'));
    expect(text.indexOf('--bind /data/w/abc /data/w/abc')).toBeLessThan(text.indexOf('--ro-bind /data/w/abc/.claude /data/w/abc/.claude'));
    expect(args.slice(-2)).toEqual(['--chdir', '/data/w/abc']);
  });
});

describe('running a bounded command (story 5.8)', () => {
  const request = { cwd: tmpdir(), env: { PATH: process.env.PATH ?? '' }, timeoutMs: 20_000, maxOutputBytes: 100 };

  it('keeps the end of the output, the exit code, and stops a command that runs too long', async () => {
    const ok = await runBounded(process.execPath, ['-e', "process.stdout.write('x'.repeat(500) + 'END'); process.exitCode = 3"], request);
    expect(ok).toMatchObject({ exitCode: 3, timedOut: false });
    expect(ok.output.length).toBeLessThanOrEqual(100);
    expect(ok.output.endsWith('END')).toBe(true);
    const slow = await runBounded(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { ...request, timeoutMs: 300 });
    expect(slow).toMatchObject({ exitCode: null, timedOut: true });
    expect(await runBounded('/definitely/not/a/program', [], request)).toMatchObject({ exitCode: null });
  });

  it('the fixed sandbox runs a command with no sandbox for its own kind (test) only; any other kind gets nothing', async () => {
    const fixed = createFixedSandbox({ available: true, kind: 'test' });
    const ran = await fixed.run({ sandbox: { ...sandbox, kind: 'test' }, cwd: tmpdir(), command: `"${process.execPath}" -e "console.log('hi')"`, env: request.env, timeoutMs: 20_000, maxOutputBytes: 1000 });
    expect(ran).toMatchObject({ exitCode: 0, output: expect.stringContaining('hi') });
    expect(await fixed.run({ sandbox, cwd: tmpdir(), command: 'echo hi', env: request.env, timeoutMs: 1000, maxOutputBytes: 1000 })).toBeUndefined();
    void runUnsandboxedForTests;
  });
});

// The real thing, only where this computer's own sandbox works (macOS Seatbelt; bubblewrap where unprivileged namespaces are allowed).
describe('a real sandboxed run (story 5.8)', async () => {
  const step = createNativeSandboxStep();
  const inspected = await step.inspect();
  const usable = inspected.kind !== undefined && step.run !== undefined;

  it.runIf(usable)('writes inside its roots, and is refused a write outside them, a read of a fenced folder, and the network', async () => {
    const root = temp();
    const worktree = join(root, 'w');
    const outside = join(root, 'outside');
    const fenced = join(root, 'secret');
    mkdirSync(worktree);
    mkdirSync(outside);
    mkdirSync(fenced);
    writeFileSync(join(fenced, 'key.txt'), 'top secret');
    const contained: AgentSandbox = { kind: inspected.kind!, writableRoots: [worktree], deniedPaths: [], deniedReads: [fenced], allowedReads: [worktree] };
    const script = [
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(join(worktree, 'in.txt'))}, 'ok');`,
      `try { fs.writeFileSync(${JSON.stringify(join(outside, 'out.txt'))}, 'no'); console.log('WROTE_OUTSIDE'); } catch { console.log('write refused'); }`,
      `try { fs.readFileSync(${JSON.stringify(join(fenced, 'key.txt'))}); console.log('READ_FENCED'); } catch { console.log('read refused'); }`,
      "require('node:net').connect(80, '127.0.0.1').on('connect', () => { console.log('NETWORK_OPEN'); process.exit(0); }).on('error', () => { console.log('network refused'); process.exit(0); });",
    ].join('\n');
    const file = join(worktree, 'probe.cjs');
    writeFileSync(file, script);
    const ran = await step.run!({ sandbox: contained, cwd: worktree, command: `"${process.execPath}" probe.cjs`, env: { PATH: process.env.PATH ?? '', HOME: root }, timeoutMs: 30_000, maxOutputBytes: 4000 });
    expect(ran, 'the sandbox ran it').toBeDefined();
    expect(ran!.output).not.toContain('WROTE_OUTSIDE');
    expect(ran!.output).not.toContain('READ_FENCED');
    expect(ran!.output).not.toContain('NETWORK_OPEN');
    expect(ran!.output).toContain('write refused');
    expect(ran!.output).toContain('read refused');
    expect(ran!.output).toContain('network refused');
    expect(readFileSync(join(worktree, 'in.txt'), 'utf8')).toBe('ok');
    expect(existsSync(join(outside, 'out.txt'))).toBe(false);
    // Another sandbox's kind, or a kind of no step, is not run: never unsandboxed instead.
    expect(await step.run!({ sandbox: { ...contained, kind: 'docker' }, cwd: worktree, command: 'echo hi', env: {}, timeoutMs: 1000, maxOutputBytes: 100 })).toBeUndefined();
  });
});
