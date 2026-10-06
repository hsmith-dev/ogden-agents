/**
 * The one environment allowlist every child process Ogden Agents starts is
 * built from (AD-16; epic 6 entry 10 closes the 6.5 review's "helper
 * processes inherit the server's whole environment"). Exported on its own
 * (`@ogden-agents/adapters/child-env`) so the launcher doesn't load the
 * adapters index.
 *
 * - {@link baseEnvironment}: what a program needs to run as the user
 *   (`PATH`, home, user, locale, terminal, temp, shell, and on Windows what
 *   a process can't start without). Never a key, a token or an
 *   `OGDEN_AGENTS_*` switch.
 * - {@link helperEnvironment}: the same plus a few named, non-secret
 *   variables a helper needs (npm's proxies, PowerShell's folders). A helper
 *   never gets an API key: the names are checked against {@link SECRET_NAME}.
 * - An agent's process gets the base, its own home variable and only its own
 *   key, from its descriptor (server `start-agents.ts`, `chatEnv`).
 *
 * `tests/architecture.test.ts` fails when a spawn in `packages/` passes
 * `process.env`, wholesale or spread, or no `env` at all.
 */

/** What a program needs to run as the user, on every OS. */
const BASE_ALLOWED = ['PATH', 'HOME', 'USERPROFILE', 'USER', 'USERNAME', 'LANG', 'TERM', 'TMPDIR', 'TEMP', 'TMP', 'SHELL'] as const;
/** The same on Windows only, where a process can't start without them. */
const BASE_ALLOWED_WINDOWS = ['SystemRoot', 'ComSpec', 'PATHEXT'] as const;

/**
 * A name that looks like a credential: a helper's extra names are refused
 * when they match, so no later change can hand a helper a key by name.
 */
export const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i;

/** The real locale categories: `LC_*` by prefix would carry any value through (as sshd's AcceptEnv), so only these pass. */
const LOCALE_CATEGORIES: ReadonlySet<string> = new Set([
  'LC_ALL', 'LC_CTYPE', 'LC_NUMERIC', 'LC_TIME', 'LC_COLLATE', 'LC_MONETARY', 'LC_MESSAGES', 'LC_PAPER', 'LC_NAME', 'LC_ADDRESS', 'LC_TELEPHONE', 'LC_MEASUREMENT', 'LC_IDENTIFICATION',
]);

/** Windows variable names are case-insensitive (`Path`, `SYSTEMROOT`). */
const folder = (platform: NodeJS.Platform) => (name: string) => (platform === 'win32' ? name.toUpperCase() : name);

function pick(
  source: Readonly<Record<string, string | undefined>>,
  names: readonly string[],
  platform: NodeJS.Platform,
): Record<string, string> {
  const fold = folder(platform);
  const allowed = new Set(names.map(fold));
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    // Locale variables by prefix, but never one named like a credential (`LC_*` is a known way to carry values through, as sshd's AcceptEnv).
    if (allowed.has(fold(name)) || LOCALE_CATEGORIES.has(name)) env[name] = value;
  }
  return env;
}

/**
 * {@link BASE_ALLOWED} (and on Windows its additions), `LC_ALL` and `LC_*`,
 * from `source`. Nothing else. Never logged.
 */
export function baseEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  return pick(source, [...BASE_ALLOWED, ...(platform === 'win32' ? BASE_ALLOWED_WINDOWS : [])], platform);
}

/**
 * The environment of a helper process (the kill helper, PowerShell, npm, the
 * browser opener): {@link baseEnvironment} plus the `extra` names, none of
 * which may look like a credential ({@link SECRET_NAME}; throws, a
 * programming error). Never an agent key, whatever `source` holds.
 */
export function helperEnvironment(
  extra: readonly string[] = [],
  source: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const secret = extra.find((name) => SECRET_NAME.test(name));
  if (secret !== undefined) throw new Error(`helperEnvironment: ${secret} looks like a credential; helpers never get one (AD-16)`);
  return pick(source, [...BASE_ALLOWED, ...(platform === 'win32' ? BASE_ALLOWED_WINDOWS : []), ...extra], platform);
}

/** Windows' own folders, which PowerShell and the Start Menu shortcut script read. */
export const WINDOWS_FOLDERS = ['APPDATA', 'LOCALAPPDATA', 'ProgramData', 'windir', 'PSModulePath'] as const;

/**
 * What npm needs beyond the base to reach its registry as the user set it up:
 * proxies and certificate authorities. Never `npm_*` (npx sets those, story
 * 9.3) and never an auth token (a registry token lives in `.npmrc`).
 */
export const NPM_NETWORK = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'APPDATA',
  'LOCALAPPDATA',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
] as const;

/** What a browser opener (`open`, `xdg-open`) needs beyond the base to reach the user's desktop. */
export const DESKTOP_SESSION = [
  'DISPLAY',
  'XAUTHORITY',
  'WAYLAND_DISPLAY',
  'XDG_RUNTIME_DIR',
  'XDG_CURRENT_DESKTOP',
  'XDG_SESSION_TYPE',
  'XDG_DATA_DIRS',
  'XDG_CONFIG_DIRS',
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME',
  'DBUS_SESSION_BUS_ADDRESS',
  'DESKTOP_SESSION',
  'BROWSER',
  'WSL_DISTRO_NAME',
  'WSL_INTEROP',
  ...WINDOWS_FOLDERS,
] as const;

/** Variables a terminal pane's program needs beyond the base to behave as it does in the user's own terminal (spike 16.1, finding 10). */
export const PANE_EXTRA = ['LOGNAME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME'] as const;
/** The same on Windows only: npm's global folder, the program folders, the machine and the user's profile drive. */
export const PANE_EXTRA_WINDOWS = [
  ...WINDOWS_FOLDERS,
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'CommonProgramFiles',
  'CommonProgramFiles(x86)',
  'CommonProgramW6432',
  'ALLUSERSPROFILE',
  'USERDOMAIN',
  'COMPUTERNAME',
  'HOMEDRIVE',
  'HOMEPATH',
  'OS',
  'PROCESSOR_ARCHITECTURE',
] as const;
/** What a proxy is told by: opt in only, because a proxy URL can hold a password (spike 16.1, finding 10). */
export const PANE_PROXIES = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy'] as const;
/** Lets a pane use the user's SSH keys: opt in only. */
export const PANE_SSH_AGENT = ['SSH_AUTH_SOCK'] as const;

export interface PaneEnvironmentOptions {
  /** Pass the user's proxy variables (a proxy URL can hold a password). Default `false`. */
  proxies?: boolean;
  /** Pass `SSH_AUTH_SOCK`, so the pane can use the user's SSH keys. Default `false`. */
  sshAgent?: boolean;
}

/**
 * The whole environment of a terminal pane's program (epic 16, E16-R2; spike
 * 16.1 finding 10): {@link baseEnvironment} plus what a user's shell and CLIs
 * need (`COLORTERM`, the XDG folders, on Windows the program and profile
 * folders). Still never a key, a token or an `OGDEN_AGENTS_*` switch: every
 * name is checked against {@link SECRET_NAME}, so no later change can hand a
 * pane a credential by name. Proxies and `SSH_AUTH_SOCK` only when the user
 * opted in. The user's own CLI logins are never touched: a CLI finds its own
 * login in the user's home, as it does in any terminal.
 */
export function paneEnvironment(
  options: PaneEnvironmentOptions = {},
  source: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const names = [
    ...PANE_EXTRA,
    ...(platform === 'win32' ? PANE_EXTRA_WINDOWS : []),
    ...(options.proxies === true ? PANE_PROXIES : []),
    ...(options.sshAgent === true ? PANE_SSH_AGENT : []),
  ].filter((name) => !SECRET_NAME.test(name));
  const env = {
    ...helperEnvironment(names, source, platform),
    // The terminal is xterm.js, which draws truecolor: said regardless of the server's own terminal.
    COLORTERM: 'truecolor',
  };
  return env;
}
