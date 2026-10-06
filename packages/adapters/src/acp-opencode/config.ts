/**
 * The harness's generated config and environment (epic 14, story 14.2):
 * everything Ogden hands the Local model, as data written into the data
 * folder, so the harness reads nothing of the user's own (spike 14.1).
 *
 * - {@link opencodeConfig}: the whole config. One provider (`ogden`, an
 *   OpenAI-compatible endpoint), the models Ogden listed itself (the harness
 *   never calls `/v1/models`), every tool call asking first, and every
 *   switch the harness has for updates, sharing, language servers, plugins
 *   and title requests. A key is only a reference to a variable.
 * - {@link localHome}: the folders it runs in, all inside the data folder
 *   (an empty `HOME`, so `~/.claude/skills` and the like are never read, and
 *   the four `XDG_*` folders, so its database and logs stay in Ogden's).
 * - {@link opencodeChatEnv}: the variables to add to the chat's environment,
 *   which win over core's own `HOME` and `USERPROFILE`.
 *
 * The harness's database (`opencode.db`, under the data home) holds every
 * prompt and reply in plain text; the privacy statement says so.
 */
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ENDPOINT_KEY_ENV,
  ENDPOINT_KEY_REFERENCE,
  ENDPOINT_URL_ENV,
  LOCAL_AGENT_ID,
  OPENCODE_CONFIG_ENV,
  OPENCODE_PROVIDER_ID,
  OPENCODE_SWITCHES,
} from './constants.js';

/** One model Ogden lists for the harness, with what it knows of its limits. */
export interface LocalModel {
  /** The server's own model id, a free string (never a catalogue's). */
  id: string;
  /** What the picker shows; defaults to the id. */
  name?: string | undefined;
  /** The context window the server reports; unknown falls back to {@link DEFAULT_CONTEXT_TOKENS}. */
  contextTokens?: number | undefined;
  /** The most it may answer with; defaults to {@link DEFAULT_OUTPUT_TOKENS}. */
  outputTokens?: number | undefined;
  /** `false` when the server says the model can't call tools; otherwise tools are on. */
  toolCall?: boolean | undefined;
}

/** What the harness is told when the server reports no context length (the floor the card cautions about). */
export const DEFAULT_CONTEXT_TOKENS = 32_768;
/** The answer limit the harness is told when the server reports none (spike 14.1: 4096). */
export const DEFAULT_OUTPUT_TOKENS = 4_096;

export interface OpenCodeConfigInput {
  /** The endpoint's base URL, `…/v1` included (it is only ever written, never fetched here). */
  baseUrl: string;
  /** The models the picker offers, in order. At least one. */
  models: readonly LocalModel[];
  /** The model a chat starts on; one of `models`. */
  model: string;
  /** Whether the endpoint has a key (the config then references {@link ENDPOINT_KEY_ENV}); never the key itself. */
  hasKey: boolean;
}

/** The permissions the config sets to `ask`: every tool that runs, writes or reaches out (spike 14.1, and the other tools that can). */
const ASKED = ['bash', 'edit', 'webfetch', 'websearch', 'codesearch', 'task', 'external_directory', 'doom_loop'] as const;

/**
 * A model id the harness may be told. The harness replaces `{env:NAME}` and `{file:PATH}` in its config text,
 * so an id from a server (which may not be trusted) with a brace in it could read a file or a variable and
 * send it back in every request: such an id is never written. Real ids (`qwen2.5-coder:7b`,
 * `org/model-name`, `hf.co/x/y:Q4_K_M`) fit.
 */
export const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,189}$/;

/** Whether `baseUrl` may be written to the config: http(s), no user or password, no query or fragment, no brace. */
function safeBaseUrl(baseUrl: string): boolean {
  if (/[{}\s]/.test(baseUrl)) return false;
  try {
    const url = new URL(baseUrl);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === '' && url.search === '' && url.hash === '' && !baseUrl.includes('?') && !baseUrl.includes('#');
  } catch {
    return false;
  }
}

/** The generated config, as a plain object. Holds no key. */
export function opencodeConfig(input: OpenCodeConfigInput): Record<string, unknown> {
  if (!safeBaseUrl(input.baseUrl)) throw new Error('opencodeConfig: the address cannot be written to the config');
  const models = input.models.filter((model) => SAFE_MODEL_ID.test(model.id));
  if (models.length === 0) throw new Error('opencodeConfig: no usable models');
  if (!models.some((model) => model.id === input.model)) throw new Error('opencodeConfig: the model is not in the list');
  return {
    $schema: 'https://opencode.ai/config.json',
    autoupdate: false,
    share: 'disabled',
    enabled_providers: [OPENCODE_PROVIDER_ID],
    plugin: [],
    lsp: false,
    formatter: false,
    // One request per message, not two (spike 14.1: the first prompt also asks the model for a title).
    agent: { title: { disable: true } },
    model: `${OPENCODE_PROVIDER_ID}/${input.model}`,
    permission: Object.fromEntries(ASKED.map((tool) => [tool, 'ask'])),
    provider: {
      [OPENCODE_PROVIDER_ID]: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Local model',
        options: { baseURL: input.baseUrl, ...(input.hasKey ? { apiKey: ENDPOINT_KEY_REFERENCE } : {}) },
        models: Object.fromEntries(
          models.map((model) => [
            model.id,
            {
              name: model.id,
              limit: { context: model.contextTokens ?? DEFAULT_CONTEXT_TOKENS, output: Math.min(model.outputTokens ?? DEFAULT_OUTPUT_TOKENS, model.contextTokens ?? DEFAULT_CONTEXT_TOKENS) },
              tool_call: model.toolCall !== false,
            },
          ]),
        ),
      },
    },
  };
}

/** The folders the Local model runs in, all under `<dataDir>/agents/local-home` (beside, never inside, its install). */
export interface LocalHome {
  root: string;
  /** An empty folder: `HOME` and `USERPROFILE` (and Windows' `APPDATA`, `LOCALAPPDATA` inside it). */
  home: string;
  xdg: { config: string; data: string; cache: string; state: string };
  /**
   * Where the generated config files go, one per distinct config (named by a hash of its
   * content): chats on different endpoints or models each have their own and never overwrite
   * another's while it runs.
   */
  configDir: string;
}

export function localHome(dataDir: string): LocalHome {
  const root = join(dataDir, 'agents', `${LOCAL_AGENT_ID}-home`);
  return {
    root,
    home: join(root, 'home'),
    xdg: { config: join(root, 'xdg', 'config'), data: join(root, 'xdg', 'data'), cache: join(root, 'xdg', 'cache'), state: join(root, 'xdg', 'state') },
    configDir: join(root, 'configs'),
  };
}

/** How long an unused generated config is kept before the next write removes it. */
const CONFIG_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Makes the folders (owner-only) and writes `config` atomically with mode 0600
 * into `<home>/configs/opencode-<hash>.json`. Returns the config file's path.
 * Configs not touched for a week are removed.
 */
export function writeOpenCodeConfig(dataDir: string, config: Record<string, unknown>): string {
  const home = localHome(dataDir);
  for (const dir of [home.root, home.home, home.configDir, ...Object.values(home.xdg)]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') chmodSync(dir, 0o700);
  }
  const text = `${JSON.stringify(config, null, 2)}\n`;
  const file = join(home.configDir, `opencode-${createHash('sha256').update(text).digest('hex').slice(0, 16)}.json`);
  // The same content is the same file: it is not written again, so a harness holding it open is never disturbed (Windows refuses a rename over one).
  let current: string | undefined;
  try {
    current = readFileSync(file, 'utf8');
  } catch {
    current = undefined;
  }
  if (current !== text) {
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, text, { mode: 0o600 });
    renameSync(temp, file);
  }
  const now = Date.now();
  for (const name of readdirSync(home.configDir)) {
    if (!/^opencode-[0-9a-f]{16}\.json(?:\.\d+\.tmp)?$/.test(name) || join(home.configDir, name) === file) continue;
    try {
      if (now - statSync(join(home.configDir, name)).mtimeMs > CONFIG_KEEP_MS) rmSync(join(home.configDir, name), { force: true });
    } catch {
      // A config that can't be removed now is tried again at the next write.
    }
  }
  return file;
}

/**
 * The variables the harness's chat process gets beyond core's allowlist and
 * its own launch switches: its config, its folders and, for an endpoint with
 * a key, the key. They win over core's own `HOME` and `USERPROFILE`.
 */
export function opencodeChatEnv(input: { dataDir: string; configFile: string; key?: string | undefined; baseUrl?: string | undefined; platform?: NodeJS.Platform }): Record<string, string> {
  const home = localHome(input.dataDir);
  const platform = input.platform ?? process.platform;
  return {
    [OPENCODE_CONFIG_ENV]: input.configFile,
    HOME: home.home,
    USERPROFILE: home.home,
    XDG_CONFIG_HOME: home.xdg.config,
    XDG_DATA_HOME: home.xdg.data,
    XDG_CACHE_HOME: home.xdg.cache,
    XDG_STATE_HOME: home.xdg.state,
    ...(platform === 'win32' ? { APPDATA: join(home.home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home.home, 'AppData', 'Local') } : {}),
    ...(input.key === undefined || input.key === '' ? {} : { [ENDPOINT_KEY_ENV]: input.key }),
    ...(input.baseUrl === undefined ? {} : { [ENDPOINT_URL_ENV]: input.baseUrl }),
  };
}

/**
 * Why `env` is not safe to start the harness with, or `[]`: its home, config
 * or `XDG_*` folders are not Ogden's own inside the data folder. The launch
 * refuses to start on any (fail closed): a wiring that forgot them would let
 * the harness read the user's own `~/.claude/skills` or write beside their files.
 * (The network switches are added by the launch itself, so they can't be forgotten.)
 */
export function opencodeEnvProblems(env: Readonly<Record<string, string>>, dataDir: string, platform: NodeJS.Platform = process.platform): string[] {
  const problems: string[] = [];
  const config = env[OPENCODE_CONFIG_ENV];
  // Only a config file Ogden wrote, in its own folder (a file name, never a path out of it).
  const home = localHome(dataDir);
  const configOk = typeof config === 'string' && config.startsWith(join(home.configDir, 'opencode-')) && /^opencode-[0-9a-f]{16}\.json$/.test(config.slice(home.configDir.length + 1));
  if (!configOk) problems.push(`${OPENCODE_CONFIG_ENV} is not set as Ogden Agents needs it`);
  for (const [name, value] of Object.entries(opencodeChatEnv({ dataDir, configFile: config ?? '', platform }))) {
    if (name !== OPENCODE_CONFIG_ENV && env[name] !== value) problems.push(`${name} is not set as Ogden Agents needs it`);
  }
  return problems;
}
