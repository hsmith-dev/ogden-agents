/**
 * The environment `uv` runs BMad Method's scripts with (story 4.1): the
 * agents' allowlist plus uv's own folders, never an agent key (any case on
 * Windows) or an unlisted variable, and `PYTHONUTF8=1`.
 */
import { describe, expect, it } from 'vitest';
import { uvEnvironment } from '../src/start-env.js';

describe('uvEnvironment (story 4.1)', () => {
  it('keeps PATH, HOME and uv’s folders, drops keys and everything else, and sets PYTHONUTF8', () => {
    const env = uvEnvironment(
      { PATH: '/bin', HOME: '/h', XDG_CACHE_HOME: '/c', XDG_DATA_HOME: '/d', ANTHROPIC_API_KEY: 'sk-x', SECRET_TOKEN: 's', NODE_OPTIONS: '--x', PYTHONUTF8: '0' },
      'linux',
    );
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', XDG_CACHE_HOME: '/c', XDG_DATA_HOME: '/d', PYTHONUTF8: '1' });
  });

  it('on Windows, keeps LOCALAPPDATA and APPDATA and drops the key whatever its case', () => {
    const env = uvEnvironment(
      { Path: 'C:\\bin', USERPROFILE: 'C:\\u', SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\l', AppData: 'C:\\a', Anthropic_Api_Key: 'k', anthropic_api_key: 'k2', OTHER: 'o' },
      'win32',
    );
    expect(env).toEqual({ Path: 'C:\\bin', USERPROFILE: 'C:\\u', SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\l', AppData: 'C:\\a', PYTHONUTF8: '1' });
  });
});
