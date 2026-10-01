/**
 * The one process-tree kill (story 9.6) the launcher, the Claude Code adapter
 * and `terminal-pty` share: a process group on POSIX, `taskkill /T /F` by
 * absolute path on Windows, and nothing at all for a pid that isn't a
 * positive integer. The real kill is covered by the terminal and launcher tests.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { killProcessTree, taskkillPath, type ProcessTreeSystem } from '../src/process-tree.js';

function fakeSystem(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}, fail?: 'run' | 'signal') {
  const ran: Array<{ file: string; args: readonly string[] }> = [];
  const signalled: number[] = [];
  const system: ProcessTreeSystem = {
    platform,
    env,
    run: (file, args) => {
      ran.push({ file, args });
      if (fail === 'run') throw new Error('spawn failed');
    },
    killGroup: (pid) => {
      signalled.push(pid);
      if (fail === 'signal') throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
    },
  };
  return { system, ran, signalled };
}

describe('killProcessTree', () => {
  it('POSIX: SIGKILLs the process group it leads', () => {
    const { system, ran, signalled } = fakeSystem('linux');
    killProcessTree(4242, system);
    expect(signalled).toEqual([4242]);
    expect(ran).toEqual([]);
  });

  it('POSIX: a group that is already gone is not an error', () => {
    const { system, signalled } = fakeSystem('darwin', {}, 'signal');
    expect(() => killProcessTree(4242, system)).not.toThrow();
    expect(signalled).toHaveLength(1);
  });

  it('Windows: runs taskkill /T /F by absolute path under SystemRoot, and signals nothing', () => {
    const { system, ran, signalled } = fakeSystem('win32', { SystemRoot: 'D:\\Win' });
    killProcessTree(4242, system);
    expect(ran).toEqual([{ file: join('D:\\Win', 'System32', 'taskkill.exe'), args: ['/pid', '4242', '/T', '/F'] }]);
    expect(signalled).toEqual([]);
  });

  it("Windows: falls back to SYSTEMROOT, then C:\\Windows; a taskkill that can't run is not an error", () => {
    expect(taskkillPath({ SYSTEMROOT: 'E:\\Sys' })).toBe(join('E:\\Sys', 'System32', 'taskkill.exe'));
    expect(taskkillPath({})).toBe(join('C:\\Windows', 'System32', 'taskkill.exe'));
    const { system, ran } = fakeSystem('win32', {}, 'run');
    expect(() => killProcessTree(7, system)).not.toThrow();
    expect(ran).toHaveLength(1);
  });

  it('does nothing for a pid that is undefined, 0, negative, fractional or NaN', () => {
    for (const platform of ['linux', 'win32'] as const) {
      const { system, ran, signalled } = fakeSystem(platform);
      for (const pid of [undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) killProcessTree(pid, system);
      expect(ran).toEqual([]);
      expect(signalled).toEqual([]);
    }
  });
});
