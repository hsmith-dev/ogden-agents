/**
 * The Local model's generated config and environment (epic 14, story 14.2):
 * the config holds no key and only references one, every tool that runs asks,
 * every switch that keeps the harness on the machine is set (each one by
 * name: dropping one fails here), and the harness is never started on the
 * user's own home or folders. No test runs the real harness.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTEXT_TOKENS,
  ENDPOINT_KEY_ENV,
  localHome,
  NPM_REGISTRY_SINK,
  OPENCODE_SWITCHES,
  opencodeChatEnv,
  opencodeConfig,
  opencodeEnvProblems,
  writeOpenCodeConfig,
} from '../src/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-local-config-'));
  dirs.push(dir);
  return dir;
};

const input = { baseUrl: 'http://localhost:1234/v1', models: [{ id: 'small' }, { id: 'big', name: 'Big one', contextTokens: 65_536, outputTokens: 8_192, toolCall: false }], model: 'big', hasKey: false };

describe('the generated config', () => {
  it('points one openai-compatible provider at the endpoint, with the models Ogden listed and their limits', () => {
    const config = opencodeConfig(input) as Record<string, any>;
    expect(config.model).toBe('ogden/big');
    expect(config.enabled_providers).toEqual(['ogden']);
    expect(config.provider.ogden).toMatchObject({ npm: '@ai-sdk/openai-compatible', options: { baseURL: 'http://localhost:1234/v1' } });
    expect(config.provider.ogden.models.small).toEqual({ name: 'small', limit: { context: DEFAULT_CONTEXT_TOKENS, output: 4096 }, tool_call: true });
    expect(config.provider.ogden.models.big).toEqual({ name: 'Big one', limit: { context: 65_536, output: 8_192 }, tool_call: false });
  });

  it('never gives a model an answer limit above its context', () => {
    const config = opencodeConfig({ ...input, models: [{ id: 'tiny', contextTokens: 2_048, outputTokens: 9_999 }], model: 'tiny' }) as Record<string, any>;
    expect(config.provider.ogden.models.tiny.limit).toEqual({ context: 2_048, output: 2_048 });
  });

  it('makes every tool that runs, writes or reaches out ask, and switches off updates, sharing, language servers, plugins and title requests', () => {
    const config = opencodeConfig(input) as Record<string, any>;
    expect(config.permission).toEqual({ bash: 'ask', edit: 'ask', webfetch: 'ask', external_directory: 'ask', doom_loop: 'ask' });
    expect(config).toMatchObject({ autoupdate: false, share: 'disabled', plugin: [], lsp: false, formatter: false, agent: { title: { disable: true } } });
  });

  it('references the key by variable and never holds it', () => {
    const none = opencodeConfig(input) as Record<string, any>;
    expect(none.provider.ogden.options).not.toHaveProperty('apiKey');
    const keyed = opencodeConfig({ ...input, hasKey: true }) as Record<string, any>;
    expect(keyed.provider.ogden.options.apiKey).toBe('{env:OGDEN_ENDPOINT_KEY}');
    expect(JSON.stringify(keyed)).not.toMatch(/sk-/);
  });

  it('refuses no models, and a model that is not in the list', () => {
    expect(() => opencodeConfig({ ...input, models: [] })).toThrow();
    expect(() => opencodeConfig({ ...input, model: 'absent' })).toThrow();
  });
});

describe('the config file', () => {
  it('is written owner-only into the data folder under a name made from its content, and holds no key', () => {
    const dataDir = tempDir();
    const file = writeOpenCodeConfig(dataDir, opencodeConfig({ ...input, hasKey: true }));
    expect(file.startsWith(localHome(dataDir).configDir)).toBe(true);
    expect(file).toMatch(/opencode-[0-9a-f]{16}\.json$/);
    const text = readFileSync(file, 'utf8');
    expect(JSON.parse(text).provider.ogden.options.apiKey).toBe('{env:OGDEN_ENDPOINT_KEY}');
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    // The same content is the same file; another endpoint is another file, so chats never overwrite each other's.
    expect(writeOpenCodeConfig(dataDir, opencodeConfig({ ...input, hasKey: true }))).toBe(file);
    const other = writeOpenCodeConfig(dataDir, opencodeConfig({ ...input, baseUrl: 'http://localhost:11434/v1' }));
    expect(other).not.toBe(file);
    expect(readdirSync(localHome(dataDir).configDir).filter((name) => name.endsWith('.json'))).toHaveLength(2);
  });

  it('makes the empty home and the four XDG folders, owner-only', () => {
    const dataDir = tempDir();
    writeOpenCodeConfig(dataDir, opencodeConfig(input));
    const home = localHome(dataDir);
    for (const dir of [home.home, ...Object.values(home.xdg)]) expect(existsSync(dir)).toBe(true);
    expect(readdirSync(home.home)).toEqual([]);
    expect(home.home.startsWith(dataDir)).toBe(true);
    if (process.platform !== 'win32') expect(statSync(home.home).mode & 0o777).toBe(0o700);
  });
});

describe('the environment switches (spike 14.1: not optional)', () => {
  const names = [
    'OPENCODE_DISABLE_AUTOUPDATE',
    'OPENCODE_DISABLE_MODELS_FETCH',
    'OPENCODE_DISABLE_SHARE',
    'OPENCODE_DISABLE_LSP_DOWNLOAD',
    'OPENCODE_DISABLE_DEFAULT_PLUGINS',
    'OPENCODE_DISABLE_PROJECT_CONFIG',
    'OPENCODE_DISABLE_CLAUDE_CODE_SKILLS',
    'OPENCODE_PURE',
    'NPM_CONFIG_REGISTRY',
  ];

  it.each(names)('%s is set', (name) => {
    expect(OPENCODE_SWITCHES[name]).toBe(name === 'NPM_CONFIG_REGISTRY' ? 'http://127.0.0.1:9/' : '1');
  });

  it('is exactly those, and the npm registry is a closed loopback port', () => {
    expect(Object.keys(OPENCODE_SWITCHES).sort()).toEqual([...names].sort());
    expect(NPM_REGISTRY_SINK).toBe('http://127.0.0.1:9/');
  });

  it('puts the harness in the data folder: its config, an empty home and the four XDG folders, which win over core\'s own home', () => {
    const dataDir = tempDir();
    const file = writeOpenCodeConfig(dataDir, opencodeConfig(input));
    const env = opencodeChatEnv({ dataDir, configFile: file, platform: 'linux' });
    const home = localHome(dataDir);
    expect(env).toEqual({
      OPENCODE_CONFIG: file,
      HOME: home.home,
      USERPROFILE: home.home,
      XDG_CONFIG_HOME: home.xdg.config,
      XDG_DATA_HOME: home.xdg.data,
      XDG_CACHE_HOME: home.xdg.cache,
      XDG_STATE_HOME: home.xdg.state,
    });
    expect(opencodeChatEnv({ dataDir, configFile: file, platform: 'win32' })).toMatchObject({ APPDATA: join(home.home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home.home, 'AppData', 'Local') });
  });

  it('adds the key only for an endpoint that has one, as OGDEN_ENDPOINT_KEY', () => {
    const dataDir = tempDir();
    const file = writeOpenCodeConfig(dataDir, opencodeConfig(input));
    expect(opencodeChatEnv({ dataDir, configFile: file })).not.toHaveProperty(ENDPOINT_KEY_ENV);
    expect(opencodeChatEnv({ dataDir, configFile: file, key: '' })).not.toHaveProperty(ENDPOINT_KEY_ENV);
    expect(opencodeChatEnv({ dataDir, configFile: file, key: 'dummy' })[ENDPOINT_KEY_ENV]).toBe('dummy');
  });

  it('refuses an environment whose home, config or XDG folders are not Ogden\'s own', () => {
    const dataDir = tempDir();
    const file = writeOpenCodeConfig(dataDir, opencodeConfig(input));
    const good = opencodeChatEnv({ dataDir, configFile: file });
    expect(opencodeEnvProblems(good, dataDir)).toEqual([]);
    for (const name of Object.keys(good)) {
      const { [name]: _dropped, ...without } = good;
      expect(opencodeEnvProblems(without, dataDir), `without ${name}`).not.toEqual([]);
    }
    expect(opencodeEnvProblems({ ...good, HOME: '/home/someone' }, dataDir)).toHaveLength(1);
    expect(opencodeEnvProblems({ ...good, OPENCODE_CONFIG: '/home/someone/.config/opencode/opencode.json' }, dataDir)).toHaveLength(1);
    expect(opencodeEnvProblems({ ...good, OPENCODE_CONFIG: join(localHome(dataDir).configDir, '..', 'evil.json') }, dataDir)).toHaveLength(1);
  });
});
