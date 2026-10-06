/**
 * The Local model's names, as a leaf module (epic 14, story 14.2): its chat
 * adapter, descriptor, install and config all read them, so they live apart
 * to keep imports acyclic (as Grok's `constants.ts`). The facts are spike
 * 14.1's (`opencode` 1.18.34 over `opencode acp`, probed on macOS, Linux and
 * Windows against a fake OpenAI-compatible server).
 *
 * The harness is named only here and in the folders of this route; core,
 * shared and `acp-base` name neither it nor any local server (architecture test).
 */

/** The Local model's stable agent id (the picker's "Local model"). */
export const LOCAL_AGENT_ID = 'local';

/** The product name the UI shows. The harness is named on the card only. */
export const LOCAL = 'Local model';

/** The harness the Local model runs through, for the card's words. */
export const OPENCODE = 'OpenCode';

/** The one provider id the generated config declares; a model is `ogden/<id>` to the harness. */
export const OPENCODE_PROVIDER_ID = 'ogden';

/** The variable that selects the generated config file (it is the only config the harness reads). */
export const OPENCODE_CONFIG_ENV = 'OPENCODE_CONFIG';

/**
 * The one variable an endpoint's key reaches the harness in (user decision,
 * 2026-10-05, AD-16): the generated config says `{env:OGDEN_ENDPOINT_KEY}`,
 * so the key is never written to a file. Present only for an endpoint that has a key.
 */
export const ENDPOINT_KEY_ENV = 'OGDEN_ENDPOINT_KEY';

/** What the config's `apiKey` says: the harness reads the variable itself. */
export const ENDPOINT_KEY_REFERENCE = `{env:${ENDPOINT_KEY_ENV}}`;

/**
 * Where the harness's `@opencode-ai/plugin` fetch goes (spike 14.1: at start it
 * asks the npm registry; this variable moves the registry to a closed loopback port).
 */
export const NPM_REGISTRY_SINK = 'http://127.0.0.1:9/';

/**
 * The switches that keep the harness on the machine (spike 14.1, "Outbound
 * connections, one switch at a time"). Not optional: the launch refuses to
 * start the harness without every one of them (`opencodeEnvProblems`), and a
 * test pins each. `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` keeps the other
 * agents' skill folders from leaking in (BMad's skills reach it through `.agents/skills`).
 */
export const OPENCODE_SWITCHES: Readonly<Record<string, string>> = Object.freeze({
  OPENCODE_DISABLE_AUTOUPDATE: '1',
  OPENCODE_DISABLE_MODELS_FETCH: '1',
  OPENCODE_DISABLE_SHARE: '1',
  OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
  OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
  OPENCODE_DISABLE_PROJECT_CONFIG: '1',
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
  OPENCODE_PURE: '1',
  NPM_CONFIG_REGISTRY: NPM_REGISTRY_SINK,
});

/**
 * Its one mode. OpenCode's own `mode` option (`build`, `plan`) is not a permission
 * mode (spike 14.1: `plan` still ran a command); asking is the config's `permission`.
 * The descriptor names `build` as Ask's own id: the mode the session always runs in.
 */
export const LOCAL_MODE_IDS = { ask: 'build' } as const;

/** Where the harness's skills for a project go (`.agents/skills`, with the Claude folder switched off). */
export const LOCAL_SKILLS_FOLDER = '.agents/skills';
