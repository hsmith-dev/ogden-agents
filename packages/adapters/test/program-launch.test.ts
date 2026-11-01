/**
 * The launch rule (`program-launch.ts`, 8.12): only absolute PATH folders
 * (Windows: drive letters), the allowlisted environment, and a working
 * folder that is the user's home or the filesystem's root, never the temp
 * folder.
 */
import { describe, expect, it } from 'vitest';
import { absolutePathFolders, launchEnvironment, safeWorkingFolder, windowsCmd, withAbsolutePath } from '../src/program-launch.js';

describe('program-launch', () => {
  it('keeps only absolute PATH folders: empty, `.` and relative entries are dropped', () => {
    expect(absolutePathFolders(':/usr/bin::.:rel/bin:/opt/bin:', 'linux')).toEqual(['/usr/bin', '/opt/bin']);
    expect(absolutePathFolders(undefined, 'darwin')).toEqual([]);
    expect(absolutePathFolders('"C:\\Program Files\\x";;.;rel;\\rooted;\\\\host\\share;D:/tools', 'win32')).toEqual(['C:\\Program Files\\x', 'D:/tools']);
  });

  it('rewrites PATH (each spelling on Windows) and leaves the rest', () => {
    expect(withAbsolutePath({ PATH: '/a::rel', HOME: '/h' }, 'linux')).toEqual({ PATH: '/a', HOME: '/h' });
    expect(withAbsolutePath({ Path: 'C:\\a;rel', PATH: ';C:\\b' }, 'win32')).toEqual({ Path: 'C:\\a', PATH: 'C:\\b' });
  });

  it('the launch environment is the allowlist, never a key, with the absolute PATH', () => {
    const env = launchEnvironment(['DISPLAY'], { PATH: '/a:', HOME: '/h', DISPLAY: ':0', ANTHROPIC_API_KEY: 'sk-planted', STRAY: 'x' }, 'linux');
    expect(env).toEqual({ PATH: '/a', HOME: '/h', DISPLAY: ':0' });
  });

  it('starts in the home folder, else the filesystem root, never the temp folder', () => {
    expect(safeWorkingFolder({ HOME: '/home/u', TMPDIR: '/tmp' }, 'linux')).toBe('/home/u');
    expect(safeWorkingFolder({ HOME: 'rel', TMPDIR: '/tmp' }, 'darwin')).toBe('/');
    expect(safeWorkingFolder({}, 'linux')).toBe('/');
    expect(safeWorkingFolder({ USERPROFILE: 'C:\\Users\\u' }, 'win32')).toBe('C:\\Users\\u');
    expect(safeWorkingFolder({ USERPROFILE: '\\Users\\u', SystemRoot: 'D:\\Win', TEMP: 'C:\\Temp' }, 'win32')).toBe('D:\\Win');
    expect(safeWorkingFolder({ SystemRoot: '\\\\share\\win' }, 'win32')).toBe('C:\\Windows');
  });

  it('takes cmd.exe from ComSpec or SystemRoot only when drive-absolute', () => {
    expect(windowsCmd({ ComSpec: 'D:\\W\\System32\\cmd.exe' })).toBe('D:\\W\\System32\\cmd.exe');
    expect(windowsCmd({ ComSpec: 'evil.exe', SystemRoot: 'E:\\Win' })).toBe('E:\\Win\\System32\\cmd.exe');
    expect(windowsCmd({ COMSPEC: '\\\\host\\cmd.exe', SYSTEMROOT: 'rel' })).toBe('C:\\Windows\\System32\\cmd.exe');
  });
});

describe('existingFolder', () => {
  it('keeps a folder that exists, and takes the root for one that does not', async () => {
    const { existingFolder } = await import('../src/program-launch.js');
    const { tmpdir } = await import('node:os');
    expect(existingFolder(tmpdir(), {}, process.platform)).toBe(tmpdir());
    if (process.platform !== 'win32') expect(existingFolder('/nonexistent-ogden-8c1d', {}, 'linux')).toBe('/');
  });
});
