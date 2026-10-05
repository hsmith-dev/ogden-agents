/**
 * AD-16 (epic 6 entry 10): the one allowlist every child process's
 * environment is built from. Helpers never get a key, whatever this server's
 * environment holds; the architecture test checks every spawn uses it.
 */
import { describe, expect, it } from 'vitest';
import { baseEnvironment, DESKTOP_SESSION, helperEnvironment, NPM_NETWORK, uvEnvironment, WINDOWS_FOLDERS } from '../src/index.js';

const PLANTED = {
  ANTHROPIC_API_KEY: 'sk-ant-planted',
  GEMINI_API_KEY: 'AIza-planted',
  GOOGLE_API_KEY: 'AIza-planted-2',
  GITHUB_TOKEN: 'ghp_planted',
  AWS_SECRET_ACCESS_KEY: 'planted',
  OGDEN_AGENTS_TEST_CLAUDE_INSTALL: '/planted.json',
  NODE_OPTIONS: '--require /planted.js',
  CLAUDECODE: '1',
  LC_API_TOKEN: 'planted-lc',
};

describe('the child process allowlist (AD-16)', () => {
  it('the base keeps what a program needs to run as the user, and nothing else', () => {
    const env = baseEnvironment({ PATH: '/bin', HOME: '/h', USER: 'u', LANG: 'en', LC_CTYPE: 'UTF-8', TERM: 'x', SHELL: '/bin/sh', TMPDIR: '/t', APPDATA: 'a', ...PLANTED }, 'linux');
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', USER: 'u', LANG: 'en', LC_CTYPE: 'UTF-8', TERM: 'x', SHELL: '/bin/sh', TMPDIR: '/t' });
  });

  it("on Windows, names match without case and the system's own variables pass; a key in any case does not", () => {
    const env = baseEnvironment({ Path: 'C:\\bin', SYSTEMROOT: 'C:\\Windows', ComSpec: 'cmd', PATHEXT: '.EXE', Anthropic_Api_Key: 'k', gemini_api_key: 'k' }, 'win32');
    expect(env).toEqual({ Path: 'C:\\bin', SYSTEMROOT: 'C:\\Windows', ComSpec: 'cmd', PATHEXT: '.EXE' });
    expect(baseEnvironment({ SystemRoot: 'C:\\Windows' }, 'linux')).toEqual({});
  });

  it("each helper's environment (kill helper, PowerShell, npm, the browser opener, uv) has none of the planted secrets", () => {
    const source = { PATH: '/bin', HOME: '/h', ...PLANTED };
    for (const env of [
      helperEnvironment([], source, 'linux'),
      helperEnvironment(WINDOWS_FOLDERS, source, 'win32'),
      helperEnvironment(NPM_NETWORK, source, 'linux'),
      helperEnvironment(DESKTOP_SESSION, source, 'linux'),
      uvEnvironment(source, 'linux'),
    ]) {
      for (const name of Object.keys(PLANTED)) expect(env, name).not.toHaveProperty(name);
      expect(Object.values(env).join('\n')).not.toContain('planted');
    }
  });

  it('a helper is never given a name that looks like a credential', () => {
    expect(() => helperEnvironment(['ANTHROPIC_API_KEY'])).toThrow(/looks like a credential/);
    expect(() => helperEnvironment(['GH_TOKEN'])).toThrow(/looks like a credential/);
    expect(() => helperEnvironment(['DB_PASSWORD'])).toThrow(/looks like a credential/);
    expect(() => helperEnvironment([...NPM_NETWORK, ...DESKTOP_SESSION, ...WINDOWS_FOLDERS])).not.toThrow();
  });
});
