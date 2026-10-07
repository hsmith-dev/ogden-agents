import { describe, expect, it } from 'vitest';
import { resolveLinkedCommand, splitCommandLine } from '../src/acp-base/linked-command.js';

describe('splitCommandLine', () => {
  it('splits a bare command with no arguments', () => {
    expect(splitCommandLine('codex-acp')).toEqual(['codex-acp']);
  });

  it('splits on plain spaces, collapsing repeats', () => {
    expect(splitCommandLine('grok  agent   --no-leader stdio')).toEqual(['grok', 'agent', '--no-leader', 'stdio']);
  });

  it('keeps a double-quoted argument with spaces as one token', () => {
    expect(splitCommandLine('"/usr/local/bin/my codex" --flag')).toEqual(['/usr/local/bin/my codex', '--flag']);
  });

  it('keeps a single-quoted argument with spaces as one token', () => {
    expect(splitCommandLine("'/opt/my grok/bin/grok' agent")).toEqual(['/opt/my grok/bin/grok', 'agent']);
  });

  it('unescapes \\" and \\\\ inside double quotes only', () => {
    expect(splitCommandLine('"say \\"hi\\""')).toEqual(['say "hi"']);
    expect(splitCommandLine('"C:\\\\tools\\\\codex.exe"')).toEqual(['C:\\tools\\codex.exe']);
  });

  it('keeps a backslash literal outside quotes (an unquoted Windows path)', () => {
    expect(splitCommandLine('C:\\tools\\codex.exe --flag')).toEqual(['C:\\tools\\codex.exe', '--flag']);
  });

  it('ignores leading, trailing and doubled whitespace', () => {
    expect(splitCommandLine('  codex-acp  ')).toEqual(['codex-acp']);
  });

  it('returns no tokens for a blank line', () => {
    expect(splitCommandLine('   ')).toEqual([]);
  });
});

describe('resolveLinkedCommand', () => {
  it('refuses a blank command line', () => {
    const result = resolveLinkedCommand({ command: '   ' }, {});
    expect(result).toEqual({ ok: false, reason: 'Type the command to run.' });
  });

  it('resolves an absolute path directly when it is runnable', () => {
    const result = resolveLinkedCommand({ command: '/usr/local/bin/codex-acp --foo' }, {}, { isExecutable: (file) => file === '/usr/local/bin/codex-acp' });
    expect(result).toEqual({ ok: true, resolved: { command: '/usr/local/bin/codex-acp', args: ['--foo'] } });
  });

  it('refuses an absolute path that is not runnable', () => {
    const result = resolveLinkedCommand({ command: '/usr/local/bin/codex-acp' }, {}, { isExecutable: () => false });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('codex-acp') });
  });

  it('refuses a relative path (with a separator), never resolving it against the server\'s own working directory', () => {
    const seen: string[] = [];
    const result = resolveLinkedCommand(
      { command: './bin/codex-acp' },
      { PATH: '/usr/bin' },
      { platform: 'linux', isExecutable: (file) => (seen.push(file), true) },
    );
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('./bin/codex-acp') });
    expect(seen).toEqual([]);
  });

  it('searches PATH for a bare name, trying each directory in order', () => {
    const seen: string[] = [];
    const result = resolveLinkedCommand(
      { command: 'codex-acp' },
      { PATH: ['/usr/bin', '/usr/local/bin'].join(':') },
      { platform: 'linux', isExecutable: (file) => (seen.push(file), file === '/usr/local/bin/codex-acp') },
    );
    expect(result).toEqual({ ok: true, resolved: { command: '/usr/local/bin/codex-acp', args: [] } });
    expect(seen).toEqual(['/usr/bin/codex-acp', '/usr/local/bin/codex-acp']);
  });

  it('refuses a bare name found on no PATH directory', () => {
    const result = resolveLinkedCommand({ command: 'no-such-thing' }, { PATH: '/usr/bin' }, { platform: 'linux', isExecutable: () => false });
    expect(result.ok).toBe(false);
  });

  it('on Windows, tries the bare name itself before the PATHEXT extensions', () => {
    const seen: string[] = [];
    const result = resolveLinkedCommand(
      { command: 'grok' },
      { Path: 'C:\\tools' },
      { platform: 'win32', isExecutable: (file) => (seen.push(file), file === 'C:\\tools\\grok.EXE') },
    );
    expect(result).toEqual({ ok: true, resolved: { command: 'C:\\tools\\grok.EXE', args: [] } });
    expect(seen[0]).toBe('C:\\tools\\grok');
  });

  it('on Windows, honours a custom PATHEXT over the default list', () => {
    const result = resolveLinkedCommand(
      { command: 'grok' },
      { PATH: 'C:\\tools', PATHEXT: '.FOO' },
      { platform: 'win32', isExecutable: (file) => file === 'C:\\tools\\grok.FOO' },
    );
    expect(result).toEqual({ ok: true, resolved: { command: 'C:\\tools\\grok.FOO', args: [] } });
  });

  it('on Windows, a backslash in a bare-looking token means a path, not a PATH search, and a relative one is refused', () => {
    const result = resolveLinkedCommand({ command: 'tools\\grok.exe' }, { PATH: 'C:\\somewhere' }, { platform: 'win32', isExecutable: () => true });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('tools\\grok.exe') });
  });

  it('refuses a working directory given as a relative path, never resolving it against the server\'s own working directory', () => {
    const result = resolveLinkedCommand({ command: '/bin/codex-acp', cwd: 'work' }, {}, { isExecutable: () => true, isDirectory: () => true });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('work') });
  });

  it('resolves an absolute working directory that exists', () => {
    const result = resolveLinkedCommand(
      { command: '/bin/codex-acp', cwd: '/home/user/project/work' },
      {},
      { isExecutable: () => true, isDirectory: (dir) => dir === '/home/user/project/work' },
    );
    expect(result).toEqual({ ok: true, resolved: { command: '/bin/codex-acp', args: [], cwd: '/home/user/project/work' } });
  });

  it('refuses a working directory that does not exist, persisting nothing', () => {
    const result = resolveLinkedCommand({ command: '/bin/codex-acp', cwd: '/no/such/dir' }, {}, { isExecutable: () => true, isDirectory: () => false });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('/no/such/dir') });
  });

  it('carries the spec\'s own env into the resolved result, untouched', () => {
    const result = resolveLinkedCommand({ command: '/bin/codex-acp', env: { FOO: 'bar' } }, {}, { isExecutable: () => true });
    expect(result).toEqual({ ok: true, resolved: { command: '/bin/codex-acp', args: [], env: { FOO: 'bar' } } });
  });

  it('never runs the command through a shell: the args are the literal tokens after the program', () => {
    const result = resolveLinkedCommand({ command: '/bin/grok agent --no-leader stdio' }, {}, { isExecutable: () => true });
    expect(result).toEqual({ ok: true, resolved: { command: '/bin/grok', args: ['agent', '--no-leader', 'stdio'] } });
  });
});
